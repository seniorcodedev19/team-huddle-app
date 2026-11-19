/* Team Huddle for the desktop.

   The window shows the Team Huddle web app from the server it is pointed
   at, so every feature of the web app is here the day it ships, with no
   second implementation to keep in step. What the desktop adds is what a
   browser tab cannot do: it stays in the tray, raises system notifications
   with nothing open, shows the unread count on the taskbar, and reminds
   people to submit their week.

   This file is the wiring. The decisions live in the pure modules beside it
   (policy, feed, reminder, settings), which are the tested ones. */

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  screen,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { alertBody, describeActivity } from "./activityText";
import { badgeLabel, MAX_ALERTS, type FeedItem } from "./feed";
import { appUrl, classify, normalizeServerUrl, safeToOpenExternally } from "./policy";
import { clockOf, statusWord, type Reminder } from "./reminder";
import { api, probeServer } from "./server";
import { pruneReminded, SettingsStore } from "./settings";
import { Watcher, type Me, type WatchState } from "./watcher";

const APP_ID = "app.teamhuddle.desktop";
const STATIC = path.join(__dirname, "..", "static");
const LOCAL_PREFIX = `${pathToFileURL(STATIC).href}/`;
const CONNECT_PAGE = path.join(STATIC, "connect.html");
const HOME_PATH = "/dashboard";
const NOTIFICATIONS_PATH = "/admin/history?tab=notifications";

/* Test runs set these. HUDDLE_E2E records alerts and outside links instead
   of raising them, so a test can read what would have happened without
   anything popping up on the machine it runs on. */
const E2E = process.env.HUDDLE_E2E === "1";
const POLL_MS = Number(process.env.HUDDLE_POLL_MS) || 45_000;
const WEEK_MS = Number(process.env.HUDDLE_WEEK_MS) || 15 * 60_000;

/* A test run can also set the clock, to see a reminder that is only due on
   a Saturday without waiting for one. */
const fakeNow = E2E && process.env.HUDDLE_NOW ? new Date(process.env.HUDDLE_NOW) : null;
const now = () => (fakeNow && !Number.isNaN(fakeNow.getTime()) ? fakeNow : new Date());

// A separate data folder keeps a test run's sign-in apart from the real one.
if (process.env.HUDDLE_USER_DATA) app.setPath("userData", path.resolve(process.env.HUDDLE_USER_DATA));

type ConnectMode = "first" | "change" | "unreachable";

let store: SettingsStore;
let watcher: Watcher;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let connect: { mode: ConnectMode; error: string | null } = { mode: "first", error: null };
/** Where the window was heading when the server stopped answering. */
let lastAppUrl: string | null = null;

type Recorded = { title: string; body: string; href: string | null };
const e2e = {
  toasts: [] as Recorded[],
  clicks: [] as (() => void)[],
  externals: [] as string[],
  downloads: [] as { file: string; state: string }[],
  badge: "",
};

const serverOrigin = () => store.get().serverUrl;

/* ---------- opening things ---------- */

function openExternal(url: string) {
  if (!safeToOpenExternally(url)) return;
  if (E2E) {
    e2e.externals.push(url);
    return;
  }
  void shell.openExternal(url);
}

function showWindow() {
  if (!win) {
    createWindow(true);
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function loadApp(pathname = HOME_PATH) {
  const origin = serverOrigin();
  const url = origin ? appUrl(origin, pathname) : null;
  if (!win) return;
  if (!url) {
    showConnect("first", null);
    return;
  }
  lastAppUrl = url;
  void win.loadURL(url).catch(() => {
    /* did-fail-load shows why; a redirect also lands here and is not a failure. */
  });
}

/** Bring the window forward on a page of the app. */
function openPath(pathname: string) {
  showWindow();
  loadApp(pathname);
}

function showConnect(mode: ConnectMode, error: string | null) {
  connect = { mode, error };
  if (!win) return;
  void win.loadFile(CONNECT_PAGE).catch(() => {});
}

function loadErrorSentence(code: number, description: string) {
  const origin = serverOrigin() ?? "the server";
  if (code === -106) return "This computer is offline.";
  if (code === -105 || code === -137) return `The address ${origin} can't be found.`;
  if (code === -102 || code === -118 || code === -7) return `${origin} isn't answering.`;
  if (code <= -200 && code > -300) return `The security certificate of ${origin} isn't valid, so the connection was refused.`;
  return `${origin} can't be reached (${description || code}).`;
}

/* ---------- alerts ---------- */

/* Kept so a notification is not garbage-collected while it is on screen,
   which would silently drop its click. */
const liveToasts = new Set<Notification>();

function toast(title: string, body: string, href: string | null, onClick: () => void) {
  if (E2E) {
    e2e.toasts.push({ title, body, href });
    e2e.clicks.push(onClick);
    return;
  }
  if (!Notification.isSupported()) return;
  /* Silent: the web app plays its own chime for the same event, governed by
     the Sound switch in its notification panel. Two sounds for one event
     would be one too many. */
  const n = new Notification({ title, body, icon: path.join(STATIC, "icon.png"), silent: true });
  liveToasts.add(n);
  n.on("click", () => {
    liveToasts.delete(n);
    onClick();
  });
  n.on("close", () => liveToasts.delete(n));
  n.show();
}

function markRead(ids: number[]) {
  const origin = serverOrigin();
  if (!origin || !ids.length) return;
  void api(origin, "POST", "/notifications/read", { ids })
    .then(() => watcher.kick(200))
    .catch(() => {
      /* Left unread, which is the truthful state if the request failed. */
    });
}

function onFresh(items: FeedItem[], me: Me | null) {
  if (!store.get().notifications) return;
  /* An alert is for when the app is not being looked at. With the window in
     front, the web app's own badge and chime already say it. */
  if (win && win.isVisible() && win.isFocused()) return;

  if (items.length > MAX_ALERTS) {
    toast("Team Huddle", `${items.length} new notifications`, NOTIFICATIONS_PATH, () => openPath(NOTIFICATIONS_PATH));
    return;
  }
  for (const item of items) {
    const d = describeActivity(item, me?.id);
    toast("Team Huddle", alertBody(d), d.href, () => {
      // Following a notification is the moment it was actually seen.
      markRead([item.id]);
      openPath(d.href ?? NOTIFICATIONS_PATH);
    });
  }
}

function onReminder(r: Reminder) {
  if (!store.get().reminders) return;
  const reminded = pruneReminded({ ...store.get().reminded, [r.key]: clockOf(now()).localDate });
  store.set({ reminded });
  toast(r.title, r.body, r.href, () => openPath(r.href));
}

/* ---------- tray, badge, menus ---------- */

const image = (name: string) => nativeImage.createFromPath(path.join(STATIC, name));

function statusLine(s: WatchState) {
  if (!serverOrigin()) return "Not connected";
  if (!s.reachable) return "Can't reach the server";
  if (s.signedIn === null) return "Connecting…";
  if (!s.signedIn) return "Not signed in";
  return s.me ? `Signed in as ${s.me.name}` : "Signed in";
}

function applyBadge(unread: number) {
  const label = badgeLabel(unread);
  e2e.badge = label;
  const text = label ? `${unread} unread notification${unread === 1 ? "" : "s"}` : "";
  tray?.setImage(image(label ? "tray-unread.png" : "tray.png"));
  tray?.setToolTip(label ? `Team Huddle — ${text}` : "Team Huddle");
  if (process.platform === "win32") {
    win?.setOverlayIcon(label ? image(`badge-${label === "9+" ? "9plus" : label}.png`) : null, text);
  } else {
    app.setBadgeCount(unread);
  }
}

function trayMenu() {
  const s = watcher.state;
  const set = store.get();
  const connected = Boolean(set.serverUrl);
  const go = (label: string, pathname: string): MenuItemConstructorOptions => ({
    label,
    enabled: connected,
    click: () => openPath(pathname),
  });
  const toggle = (
    label: string,
    key: "notifications" | "reminders" | "closeToTray",
  ): MenuItemConstructorOptions => ({
    label,
    type: "checkbox",
    checked: set[key],
    click: (item) => {
      store.set({ [key]: item.checked });
      refreshChrome();
    },
  });

  const week = s.week;
  return Menu.buildFromTemplate([
    { label: "Open Team Huddle", click: showWindow },
    { type: "separator" },
    { label: statusLine(s), enabled: false },
    ...(week
      ? [
          {
            label: `This week: ${statusWord(week.status)}`,
            click: () => openPath(`/dashboard?week=${week.week_start}`),
          },
        ]
      : []),
    go(s.unread ? `Notifications (${s.unread} unread)` : "Notifications", NOTIFICATIONS_PATH),
    { type: "separator" },
    go("Dashboard", "/dashboard"),
    go("Team", "/team"),
    go("Time tracking", "/time"),
    go("Calendar", "/calendar"),
    { type: "separator" },
    toggle("Show notifications", "notifications"),
    toggle("Remind me to submit my week", "reminders"),
    toggle("Keep running in the tray when closed", "closeToTray"),
    {
      label: process.platform === "win32" ? "Start with Windows" : "Start at login",
      type: "checkbox",
      checked: set.startAtLogin,
      // Registering a development copy would start the wrong program at login.
      enabled: app.isPackaged,
      click: (item) => {
        store.set({ startAtLogin: item.checked });
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ["--hidden"] });
      },
    },
    { type: "separator" },
    { label: "Change server…", click: () => (showWindow(), showConnect("change", null)) },
    { label: "Quit Team Huddle", click: quit },
  ]);
}

function appMenu() {
  const connected = Boolean(serverOrigin());
  const go = (label: string, pathname: string, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    enabled: connected,
    click: () => openPath(pathname),
  });
  const history = () => win?.webContents.navigationHistory;
  return Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [
        { label: "Change server…", click: () => showConnect("change", null) },
        { type: "separator" },
        { label: "Quit", accelerator: "CmdOrCtrl+Q", click: quit },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Go",
      submenu: [
        { label: "Back", accelerator: "Alt+Left", click: () => goBack() },
        { label: "Forward", accelerator: "Alt+Right", click: () => history()?.canGoForward() && history()?.goForward() },
        { type: "separator" },
        go("Dashboard", "/dashboard", "CmdOrCtrl+1"),
        go("Team", "/team", "CmdOrCtrl+2"),
        go("Time tracking", "/time", "CmdOrCtrl+3"),
        go("Calendar", "/calendar", "CmdOrCtrl+4"),
        go("Agent", "/agent", "CmdOrCtrl+5"),
        go("Notifications", NOTIFICATIONS_PATH, "CmdOrCtrl+Shift+N"),
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About Team Huddle",
          click: () => {
            const box = {
              type: "info" as const,
              title: "About Team Huddle",
              message: `Team Huddle ${app.getVersion()}`,
              detail: `Server: ${serverOrigin() ?? "not connected"}\nElectron ${process.versions.electron}, Chromium ${process.versions.chrome}`,
            };
            void (win ? dialog.showMessageBox(win, box) : dialog.showMessageBox(box));
          },
        },
      ],
    },
  ]);
}

/* Back never returns to the connect screen: once connected, that page is
   reached through "Change server", not by accident. */
function goBack() {
  const h = win?.webContents.navigationHistory;
  if (!h || !h.canGoBack()) return;
  const previous = h.getEntryAtIndex(h.getActiveIndex() - 1);
  if (previous?.url.startsWith("file:")) return;
  h.goBack();
}

/** Redraw everything outside the page that reflects state. */
function refreshChrome() {
  tray?.setContextMenu(trayMenu());
  Menu.setApplicationMenu(appMenu());
  applyBadge(watcher.state.signedIn ? watcher.state.unread : 0);
}

function quit() {
  quitting = true;
  app.quit();
}

/* ---------- the window ---------- */

function savedBounds() {
  const w = store.get().window;
  const onScreen =
    w.x !== undefined &&
    w.y !== undefined &&
    screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return w.x! < a.x + a.width - 80 && w.x! + w.width > a.x + 80 && w.y! >= a.y - 10 && w.y! < a.y + a.height - 80;
    });
  return { width: w.width, height: w.height, ...(onScreen ? { x: w.x, y: w.y } : {}) };
}

function rememberBounds() {
  if (!win || win.isDestroyed()) return;
  const maximized = win.isMaximized();
  const b = win.getNormalBounds();
  store.set({ window: { width: b.width, height: b.height, x: b.x, y: b.y, maximized } });
}

function createWindow(show: boolean) {
  win = new BrowserWindow({
    ...savedBounds(),
    minWidth: 420,
    minHeight: 520,
    show: false,
    title: "Team Huddle",
    icon: path.join(STATIC, "icon.png"),
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f1218" : "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  });
  const wc = win.webContents;
  if (store.get().window.maximized) win.maximize();

  win.once("ready-to-show", () => {
    if (show) win?.show();
  });
  // The overlay belongs to the taskbar button, which a hidden window does not have.
  win.on("show", () => applyBadge(watcher.state.signedIn ? watcher.state.unread : 0));

  win.on("close", (e) => {
    rememberBounds();
    if (quitting || !store.get().closeToTray || !tray) return;
    e.preventDefault();
    win?.hide();
    if (!store.get().trayHintShown) {
      store.set({ trayHintShown: true });
      toast(
        "Team Huddle is still running",
        "It stays in the tray so notifications and reminders can reach you. Right-click the tray icon to quit.",
        null,
        showWindow,
      );
    }
  });
  win.on("closed", () => {
    win = null;
  });

  /* The rule for every way a page can try to go somewhere: the server and
     the sign-in pages it needs stay in the window, anything else is handed
     to the person's own browser, and the rest goes nowhere. */
  const guard = (event: { preventDefault: () => void }, url: string) => {
    const verdict = classify(url, serverOrigin(), LOCAL_PREFIX);
    if (verdict === "app" || verdict === "auth") return;
    event.preventDefault();
    if (verdict === "external") openExternal(url);
  };
  wc.on("will-navigate", (event, url) => guard(event, url));
  wc.on("will-redirect", (event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame) guard(event, url);
  });
  wc.setWindowOpenHandler(({ url }) => {
    const verdict = classify(url, serverOrigin(), LOCAL_PREFIX);
    // A link of the app that asks for a new tab opens here instead: there is one window.
    if (verdict === "app" && !url.startsWith("file:")) void wc.loadURL(url).catch(() => {});
    else if (verdict === "external" || verdict === "auth") openExternal(url);
    return { action: "deny" };
  });
  wc.on("will-attach-webview", (event) => event.preventDefault());

  wc.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
    // -3 is a load that was replaced by another one, not a failure.
    if (!isMainFrame || code === -3 || url.startsWith("file:")) return;
    const verdict = classify(url, serverOrigin(), LOCAL_PREFIX);
    if (verdict === "app") {
      lastAppUrl = url;
      showConnect("unreachable", loadErrorSentence(code, description));
    } else if (verdict === "auth") {
      // A sign-in page that did not load: back to the app's own sign-in.
      loadApp("/login");
    }
  });
  wc.on("did-navigate", (_e, url) => {
    if (classify(url, serverOrigin(), LOCAL_PREFIX) === "app" && !url.startsWith("file:")) lastAppUrl = url;
    // Arriving somewhere is the usual sign that someone has just signed in.
    if (!watcher.state.signedIn) watcher.kick();
  });

  // Electron has no right-click menu of its own.
  wc.on("context-menu", (_e, p) => {
    const items: MenuItemConstructorOptions[] = [];
    if (p.linkURL && safeToOpenExternally(p.linkURL)) {
      items.push(
        { label: "Open link in browser", click: () => openExternal(p.linkURL) },
        { label: "Copy link address", click: () => clipboard.writeText(p.linkURL) },
      );
    }
    if (p.isEditable) {
      for (const word of p.dictionarySuggestions.slice(0, 4)) {
        items.push({ label: word, click: () => wc.replaceMisspelling(word) });
      }
      if (items.length) items.push({ type: "separator" });
      items.push({ role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" });
    } else if (p.selectionText.trim()) {
      items.push({ role: "copy" });
    }
    if (items.length && win) Menu.buildFromTemplate(items).popup({ window: win });
  });

  // The back and forward buttons on a mouse.
  win.on("app-command", (_e, command) => {
    const h = wc.navigationHistory;
    if (command === "browser-backward") goBack();
    else if (command === "browser-forward" && h.canGoForward()) h.goForward();
  });

  if (serverOrigin()) loadApp();
  else showConnect("first", null);
}

/* ---------- the session ---------- */

/* What a page may ask the system for. The web app needs none of the usual
   prompts (camera, location, …) and says so in its own Permissions-Policy;
   this is the same answer from the other side. */
const ALLOWED_PERMISSIONS = new Set(["clipboard-sanitized-write", "fullscreen"]);

function originOf(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function hardenSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(originOf(details.requestingUrl) === serverOrigin() && ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler(
    (_wc, permission, requestingOrigin) =>
      originOf(requestingOrigin) === serverOrigin() && ALLOWED_PERMISSIONS.has(permission),
  );

  /* Things the page does that change what the tray should say. The page is
     not asked to tell us; its own requests are simply noticed. */
  ses.webRequest.onCompleted(
    { urls: ["*://*/api/proxy/notifications/read*", "*://*/api/proxy/report/submit*", "*://*/api/proxy/reports/*"] },
    (d) => {
      if (originOf(d.url) !== serverOrigin() || d.method === "GET") return;
      if (d.url.includes("/notifications/")) watcher.kick(300);
      else watcher.refreshWeek();
    },
  );

  /* A download asks where to save, as in any browser. A test run has nobody
     to answer, so it saves into its own data folder and notes the result. */
  if (E2E) {
    ses.on("will-download", (_e, item) => {
      const file = path.join(app.getPath("userData"), "downloads", item.getFilename());
      item.setSavePath(file);
      item.once("done", (_done, state) => e2e.downloads.push({ file, state }));
    });
  }

  /* Signing out removes the session cookie. That is the moment to forget
     who was here, so the next person's notifications are judged afresh.
     Auth.js also rewrites the cookie as it goes ("overwrite"), which is not
     a sign-out and is ignored. */
  ses.cookies.on("changed", (_e, cookie, cause, removed) => {
    if (!cookie.name.includes("authjs.session-token")) return;
    if (removed && cause !== "overwrite") watcher.reset();
    else if (!removed && !watcher.state.signedIn) watcher.kick(500);
  });
}

/* ---------- the connect screen's three calls ---------- */

/* Only the app's own pages may call these. A page from the server gets no
   bridge at all (see preload.ts); this check is for the case where that
   ever stops being true. */
const fromOwnPage = (e: IpcMainInvokeEvent) => Boolean(e.senderFrame?.url.toLowerCase().startsWith(LOCAL_PREFIX.toLowerCase()));

function defaultServer() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require(path.join(__dirname, "..", "package.json")) as { huddle?: { defaultServerUrl?: string } };
    return pkg.huddle?.defaultServerUrl ?? "";
  } catch {
    return "";
  }
}

function registerIpc() {
  ipcMain.handle("huddle:state", (e) => {
    if (!fromOwnPage(e)) return null;
    return {
      mode: connect.mode,
      error: connect.error,
      serverUrl: serverOrigin(),
      suggestion: defaultServer(),
      version: app.getVersion(),
    };
  });

  ipcMain.handle("huddle:connect", async (e, address: unknown) => {
    if (!fromOwnPage(e)) return { ok: false, error: "Not allowed." };
    const parsed = normalizeServerUrl(typeof address === "string" ? address : "");
    if (!parsed.ok) return parsed;
    const probe = await probeServer(parsed.origin);
    if (!probe.ok) return probe;

    const previous = serverOrigin();
    if (previous && previous !== parsed.origin) {
      // Leaving a server signs out of it: its cookies and stored data go.
      await session.defaultSession.clearStorageData({ origin: previous }).catch(() => {});
    }
    store.set({ serverUrl: parsed.origin });
    watcher.reset();
    refreshChrome();
    loadApp();
    win?.webContents.once("did-finish-load", () => win?.webContents.navigationHistory.clear());
    return { ok: true };
  });

  /* Asks first and only then loads, so a server that is still down leaves
     the connect screen where it is instead of flashing a failed page. */
  ipcMain.handle("huddle:retry", async (e) => {
    if (!fromOwnPage(e)) return { ok: false, error: "Not allowed." };
    const origin = serverOrigin();
    if (!origin) return { ok: false, error: "No server address yet." };
    const probe = await probeServer(origin);
    if (!probe.ok) return probe;
    const target = lastAppUrl && originOf(lastAppUrl) === origin ? lastAppUrl : appUrl(origin, HOME_PATH);
    if (target) void win?.loadURL(target).catch(() => {});
    win?.webContents.once("did-finish-load", () => win?.webContents.navigationHistory.clear());
    return { ok: true };
  });
}

/* ---------- start ---------- */

function start() {
  // Windows files notifications under this id; a development run has no installed shortcut to match.
  app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath);
  // Lets the web app tell this shell from a browser, should it ever need to.
  if (!app.userAgentFallback.includes("TeamHuddleDesktop/")) {
    app.userAgentFallback = `${app.userAgentFallback} TeamHuddleDesktop/${app.getVersion()}`;
  }

  store = new SettingsStore(path.join(app.getPath("userData"), "settings.json"));
  const preset = process.env.HUDDLE_SERVER_URL || (store.get().serverUrl ? "" : defaultServer());
  if (preset) {
    const parsed = normalizeServerUrl(preset);
    if (parsed.ok) store.set({ serverUrl: parsed.origin });
  }

  watcher = new Watcher({
    origin: serverOrigin,
    call: api,
    reminded: () => store.get().reminded,
    now,
    pollMs: POLL_MS,
    weekMs: WEEK_MS,
    onState: () => refreshChrome(),
    onFresh,
    onReminder,
  });

  hardenSession();
  registerIpc();

  tray = new Tray(image("tray.png"));
  tray.on("click", showWindow);
  refreshChrome();

  // Started with the computer: sit in the tray until asked for.
  createWindow(!process.argv.includes("--hidden"));
  watcher.start();

  if (E2E) {
    (globalThis as Record<string, unknown>).__huddle = {
      ...e2e,
      get badge() {
        return e2e.badge;
      },
      state: () => ({ ...watcher.state, settings: store.get(), tray: tray?.getBounds() ?? null }),
      clickToast: (i: number) => e2e.clicks[i]?.(),
      kick: () => watcher.kick(0),
    };
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.on("activate", showWindow);
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  /* No page may open a window of its own, whatever the window that asked. */
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
  void app.whenReady().then(start);
}
