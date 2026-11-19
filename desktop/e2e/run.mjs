/* End-to-end checks: starts the real desktop app and drives it.

     HUDDLE_E2E_URL=https://your-server  npm run e2e

   What runs depends on what it is given, so the same script is safe to
   point at a live server and thorough against a throwaway one:

     HUDDLE_E2E_URL        the server to test against (required)
     HUDDLE_E2E_EMAIL      \  an account to sign in with. Without these only the
     HUDDLE_E2E_PASSWORD   /  signed-out checks run, which change nothing.
     HUDDLE_E2E_WRITES=1   also run the checks that create data: a sign-up, a
                           daily entry, a submitted week. ONLY against a
                           throwaway database, never a real one.
     HUDDLE_E2E_EXE        test this built executable instead of the source

   The app is started with HUDDLE_E2E=1, which makes it record alerts and
   outside links instead of raising them, and with its own data folder, so a
   run never touches the real app's sign-in or settings. */

import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, "..");
const outDir = path.join(here, "out");

const SERVER = (process.env.HUDDLE_E2E_URL ?? "").replace(/\/+$/, "");
const EMAIL = process.env.HUDDLE_E2E_EMAIL ?? "";
const PASSWORD = process.env.HUDDLE_E2E_PASSWORD ?? "";
const WRITES = process.env.HUDDLE_E2E_WRITES === "1";
const EXE = process.env.HUDDLE_E2E_EXE ?? "";
const LABEL = process.env.HUDDLE_E2E_LABEL ?? (EXE ? "packaged" : "source");

if (!SERVER) {
  console.error("Set HUDDLE_E2E_URL to the server to test against.");
  process.exit(2);
}
const ORIGIN = new URL(SERVER).origin;

fs.mkdirSync(outDir, { recursive: true });
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "huddle-e2e-"));
const dataDir = (name) => path.join(tmpRoot, name);

/* ---------- small helpers ---------- */

const results = [];
async function check(name, fn) {
  const started = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, note: note ?? "", ms: Date.now() - started });
    console.log(`  PASS  ${name}${note ? `  (${note})` : ""}`);
    return true;
  } catch (err) {
    const message = String(err?.message ?? err).split("\n")[0];
    results.push({ name, ok: false, note: message, ms: Date.now() - started });
    console.log(`  FAIL  ${name}\n        ${message}`);
    return false;
  }
}
function skip(name, why) {
  results.push({ name, ok: null, note: why, ms: 0 });
  console.log(`  SKIP  ${name}  (${why})`);
}
const assert = (cond, message) => {
  if (!cond) throw new Error(message);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(read, ok, label, timeout = 20_000) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      last = await read();
      if (ok(last)) return last;
    } catch (err) {
      last = String(err?.message ?? err);
    }
    if (Date.now() > end) throw new Error(`${label}: gave up after ${timeout / 1000}s, last saw ${JSON.stringify(last)?.slice(0, 200)}`);
    await sleep(250);
  }
}

async function launch(name, extraEnv = {}) {
  const env = {
    ...process.env,
    HUDDLE_E2E: "1",
    HUDDLE_USER_DATA: dataDir(name),
    HUDDLE_POLL_MS: "1500",
    HUDDLE_WEEK_MS: "4000",
    ...extraEnv,
  };
  // Handed down by Electron-based editors; it would make Electron run as plain Node.
  delete env.ELECTRON_RUN_AS_NODE;
  if (!("HUDDLE_SERVER_URL" in extraEnv)) delete env.HUDDLE_SERVER_URL;
  const app = await electron.launch(
    EXE ? { executablePath: EXE, args: [], env } : { executablePath: require("electron"), args: [appDir], env },
  );
  const page = await app.firstWindow();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  return { app, page, problems };
}

const hooks = (app) =>
  app.evaluate(() => {
    const h = globalThis.__huddle;
    return { toasts: h.toasts, externals: h.externals, downloads: h.downloads, badge: h.badge, state: h.state() };
  });
const clickToast = (app, i) => app.evaluate((_e, index) => globalThis.__huddle.clickToast(index), i);
const windowInfo = (app) =>
  app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    const w = all[0];
    return {
      count: all.length,
      visible: w?.isVisible() ?? false,
      url: w?.webContents.getURL() ?? "",
      prefs: w?.webContents.getLastWebPreferences(),
    };
  });
const menuClick = (app, top, label) =>
  app.evaluate(
    ({ Menu }, [t, l]) => {
      const item = Menu.getApplicationMenu()
        ?.items.find((i) => i.label === t)
        ?.submenu?.items.find((i) => i.label === l);
      if (!item) throw new Error(`no menu item ${t} > ${l}`);
      item.click();
    },
    [top, label],
  );
const onPath = (page, pathname) => {
  const u = new URL(page.url());
  return u.origin === ORIGIN && u.pathname === pathname;
};
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${LABEL}-${name}.png`) }).catch(() => {});

async function closedPort() {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  return port;
}

async function connectTo(page, address) {
  await page.fill("#address", address);
  await page.click("#go");
}

/* ---------- 1. first run, signed out ---------- */

async function firstRun() {
  console.log(`\nFirst run and the signed-out app  [${LABEL} → ${ORIGIN}]`);
  const { app, page, problems } = await launch("first");
  // Something that answers but is not Team Huddle.
  const stranger = http.createServer((_q, s) => s.end("hello"));
  await new Promise((r) => stranger.listen(0, "127.0.0.1", r));

  try {
    await check("with no server saved, the connect screen opens", async () => {
      await page.waitForSelector("#address", { timeout: 20_000 });
      assert(page.url().startsWith("file:"), `expected the app's own page, got ${page.url()}`);
      assert((await page.textContent("#title")) === "Connect to Team Huddle", "wrong heading");
      await shot(page, "01-connect");
    });

    await check("plain http to another machine is refused with a reason", async () => {
      await connectTo(page, "http://example.com");
      const text = await until(() => page.textContent("#error"), (t) => Boolean(t), "error text");
      assert(/https:\/\//.test(text), `unexpected message: ${text}`);
    });

    await check("an address that is not Team Huddle is refused", async () => {
      await connectTo(page, `http://127.0.0.1:${stranger.address().port}`);
      const text = await until(() => page.textContent("#error"), (t) => /Team Huddle server/.test(t ?? ""), "error text");
      return text;
    });

    await check("an address nothing answers on is refused", async () => {
      await connectTo(page, `http://127.0.0.1:${await closedPort()}`);
      await until(() => page.textContent("#error"), (t) => /Can't reach/.test(t ?? ""), "error text");
    });

    await check("the real address connects and lands on the sign-in page", async () => {
      await connectTo(page, `${SERVER}/some/page?x=1`);
      await page.waitForURL((u) => u.origin === ORIGIN && u.pathname === "/login", { timeout: 45_000 });
      await page.waitForSelector("#email", { timeout: 20_000 });
      await shot(page, "02-login");
    });

    await check("the address is remembered as a bare origin", async () => {
      const saved = JSON.parse(fs.readFileSync(path.join(dataDir("first"), "settings.json"), "utf8"));
      assert(saved.serverUrl === ORIGIN, `saved ${saved.serverUrl}`);
    });

    await check("the page is sandboxed and has no access to Node or the app", async () => {
      const { prefs } = await windowInfo(app);
      assert(prefs.contextIsolation === true && prefs.sandbox === true && prefs.nodeIntegration === false, JSON.stringify(prefs));
      const inPage = await page.evaluate(() => ({
        require: typeof globalThis.require,
        process: typeof globalThis.process,
        bridge: typeof globalThis.huddleDesktop,
      }));
      assert(inPage.require === "undefined" && inPage.process === "undefined", JSON.stringify(inPage));
      assert(inPage.bridge === "undefined", "the connect screen's bridge is exposed to a server page");
    });

    await check("the page can tell it is in the desktop app, and leaves alerts to it", async () => {
      const inPage = await page.evaluate(() => ({ ua: navigator.userAgent, notification: typeof Notification }));
      assert(/TeamHuddleDesktop\/\d/.test(inPage.ua), inPage.ua);
      assert(inPage.notification === "undefined", "the web app would show its own Desktop alerts switch");
    });

    await check("the page is refused permissions it never needs", async () => {
      const state = await page.evaluate(() => navigator.permissions.query({ name: "geolocation" }).then((p) => p.state));
      assert(state === "denied", `geolocation is ${state}`);
    });

    await check("outside links open in the browser, never in the window", async () => {
      await page.evaluate(() => {
        const a = document.createElement("a");
        a.href = "https://example.org/new-tab";
        a.target = "_blank";
        a.rel = "noreferrer noopener";
        document.body.append(a);
        a.click();
        window.open("https://example.org/popup");
      });
      const h = await until(() => hooks(app), (x) => x.externals.length >= 2, "new-tab links recorded");
      await sleep(400);
      const w = await windowInfo(app);
      assert(w.count === 1, `${w.count} windows are open`);
      assert(new URL(w.url).origin === ORIGIN, `the window went to ${w.url}`);
      return h.externals.join(", ");
    });

    await check("signed out, the tray shows nobody and no badge", async () => {
      const h = await until(() => hooks(app), (x) => x.state.signedIn === false, "signed-out state");
      assert(h.state.tray && h.state.tray.width > 0, `no tray icon: ${JSON.stringify(h.state.tray)}`);
      assert(h.badge === "" && h.state.unread === 0, JSON.stringify(h.state));
      assert(h.toasts.length === 0, `unexpected alerts: ${JSON.stringify(h.toasts)}`);
    });

    await check("the sign-in page loads without errors", async () => {
      assert(problems.length === 0, problems.slice(0, 3).join(" | "));
    });

    if (EMAIL && PASSWORD) await signedIn(app, page);
    else skip("signed-in checks", "no HUDDLE_E2E_EMAIL / HUDDLE_E2E_PASSWORD given");
  } finally {
    stranger.close();
    await app.close().catch(() => {});
  }
}

/* ---------- 2. signed in ---------- */

async function signIn(page) {
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("form button.auth-submit");
  await page.waitForURL((u) => u.origin === ORIGIN && u.pathname === "/dashboard", { timeout: 45_000 });
}

async function signedIn(app, page) {
  console.log("\nSigned in");
  const ok = await check("signing in with a password reaches the dashboard", async () => {
    await signIn(page);
    await page.waitForSelector("nav.side, .shell", { timeout: 20_000 });
    await shot(page, "03-dashboard");
  });
  if (!ok) return;

  let baseline = 0;
  await check("the tray knows who is signed in and how their week stands", async () => {
    const h = await until(() => hooks(app), (x) => x.state.signedIn === true && x.state.me && x.state.week, "signed-in state", 30_000);
    baseline = h.state.unread;
    assert(["draft", "submitted", "approved", "returned"].includes(h.state.week.status), JSON.stringify(h.state.week));
    assert(h.toasts.length === 0, "what was already waiting must not be announced");
    return `${h.state.me.name}, ${h.state.me.role}, week ${h.state.week.week_start} is ${h.state.week.status}, ${baseline} unread`;
  });

  await check("the CSV export downloads as a file", async () => {
    await page.click('a[href*="export.csv"]');
    const h = await until(() => hooks(app), (x) => x.downloads.length > 0, "the download", 30_000);
    const d = h.downloads[0];
    assert(d.state === "completed", `download ${d.state}`);
    // The file starts with a byte-order mark, which is what tells Excel it is UTF-8.
    const text = fs.readFileSync(d.file, "utf8").replace(/^﻿/, "");
    const rows = text.split("\n");
    // A team with nobody in it still exports its header row.
    assert(rows[0].startsWith("name,email,"), `not the export: ${text.slice(0, 80)}`);
    assert(new URL((await windowInfo(app)).url).pathname === "/dashboard", "the window left the page");
    return `${path.basename(d.file)}, ${rows.length} lines, first: ${rows[0].slice(0, 70)}`;
  });

  for (const [label, pathname] of [
    ["Team", "/team"],
    ["Time tracking", "/time"],
    ["Calendar", "/calendar"],
    ["Agent", "/agent"],
  ]) {
    await check(`Go > ${label} opens ${pathname}`, async () => {
      await menuClick(app, "Go", label);
      await page.waitForURL((u) => u.origin === ORIGIN && u.pathname === pathname, { timeout: 30_000 });
      await page.waitForLoadState("domcontentloaded");
      const failed = await page.locator("text=Application error").count();
      assert(failed === 0, "the page shows an application error");
      await shot(page, `04-${pathname.slice(1)}`);
    });
  }

  await check("Back returns to the previous page", async () => {
    await menuClick(app, "Go", "Back");
    await page.waitForURL((u) => u.pathname === "/calendar", { timeout: 15_000 });
  });

  await check("closing the window keeps the app in the tray, and says so once", async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    const w = await until(() => windowInfo(app), (x) => x.count === 1 && x.visible === false, "window hidden");
    const h = await hooks(app);
    assert(h.toasts.filter((t) => /still running/.test(t.title)).length === 1, JSON.stringify(h.toasts));
    return w.url;
  });

  if (WRITES) await notifications(app, page, baseline);
  else skip("a notification arriving in the tray", "needs HUDDLE_E2E_WRITES=1 (it creates a sign-up)");

  await check("the sign-in survives a restart", async () => {
    await app.close();
    const again = await launch("first");
    try {
      await again.page.waitForURL((u) => u.origin === ORIGIN && u.pathname === "/dashboard", { timeout: 45_000 });
      await until(() => hooks(again.app), (x) => x.state.signedIn === true, "signed-in state", 30_000);
    } finally {
      await again.app.close().catch(() => {});
    }
  });

  if (WRITES) await reminder();
  else skip("the submit reminder", "needs HUDDLE_E2E_WRITES=1 (it writes an entry and submits a week)");
}

/* A second copy of the app, as a newcomer, signs up through the real page.
   That is what notifies the admin signed in to the first copy. */
async function notifications(app, page, baseline) {
  const email = `newcomer.${Date.now()}@huddle.test`;
  await check("a newcomer signs up from a second copy of the app", async () => {
    const other = await launch("newcomer", { HUDDLE_SERVER_URL: SERVER });
    try {
      await other.page.waitForURL((u) => u.pathname === "/login", { timeout: 45_000 });
      await other.page.goto(`${ORIGIN}/signup`);
      await other.page.fill("#name", "Nia Newcomer");
      await other.page.fill('input[name="email"]', email);
      await other.page.fill('input[name="password"]', "Quiet-Harbor-Lamp-42");
      await other.page.click("form button.auth-submit");
      await other.page.waitForURL((u) => u.pathname === "/login" && u.search.includes("pending"), { timeout: 45_000 });
      await shot(other.page, "05-signup-pending");
    } finally {
      await other.app.close().catch(() => {});
    }
  });

  let index = -1;
  await check("the admin's hidden app raises a notification for it", async () => {
    const h = await until(
      () => hooks(app),
      (x) => x.toasts.some((t) => /signed up and is waiting for approval/.test(t.body)),
      "the alert",
      30_000,
    );
    index = h.toasts.findIndex((t) => /signed up and is waiting for approval/.test(t.body));
    const t = h.toasts[index];
    assert(t.title === "Team Huddle" && t.href === "/admin/users", JSON.stringify(t));
    assert(h.state.unread === baseline + 1, `unread is ${h.state.unread}, expected ${baseline + 1}`);
    assert(h.badge === (baseline + 1 > 9 ? "9+" : String(baseline + 1)), `badge is "${h.badge}"`);
    return `"${t.body}", badge ${h.badge}`;
  });

  await check("clicking it shows the window on the right page and marks it read", async () => {
    await clickToast(app, index);
    await until(() => windowInfo(app), (w) => w.visible && new URL(w.url).pathname === "/admin/users", "window on /admin/users", 30_000);
    const h = await until(() => hooks(app), (x) => x.state.unread === baseline, "unread back to where it was", 20_000);
    assert(h.badge === (baseline ? String(Math.min(baseline, 9)) : "") || baseline > 9, `badge is "${h.badge}"`);
    await page.waitForLoadState("domcontentloaded");
    await shot(page, "06-admin-users-from-alert");
  });

  await check("with the window in front, nothing pops up for a second arrival twice", async () => {
    const before = (await hooks(app)).toasts.length;
    await sleep(3500);
    const after = (await hooks(app)).toasts.length;
    assert(after === before, `${after - before} repeated alerts`);
  });
}

/* The reminder is due on a Saturday; the app is started with its clock set
   to this week's, after giving the week something to submit. */
async function reminder() {
  console.log("\nSubmit reminder");
  let weekStart = "";
  let wrote = false;

  const first = await launch("first");
  try {
    await first.page.waitForURL((u) => u.pathname === "/dashboard", { timeout: 45_000 });
    await check("a daily entry is saved through the app's session", async () => {
      const out = await first.page.evaluate(async () => {
        const week = await (await fetch("/api/proxy/week")).json();
        const metric = week.metrics.find((m) => m.key !== "time_tracking");
        if (!metric) return { week_start: week.week_start, saved: false, why: "no metric to type into" };
        const res = await fetch("/api/proxy/daily", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metric_id: metric.id, entry_date: week.today, value: 3 }),
        });
        return { week_start: week.week_start, saved: res.ok, why: res.ok ? metric.name : await res.text() };
      });
      weekStart = out.week_start;
      assert(out.saved, out.why);
      wrote = true;
      return `${out.why} = 3 in week ${weekStart}`;
    });
  } finally {
    await first.app.close().catch(() => {});
  }
  if (!wrote) return skip("the submit reminder", "the entry could not be saved");

  // Saturday noon of the current week, in this computer's own time.
  const [y, m, d] = weekStart.split("-").map(Number);
  const saturday = new Date(y, m - 1, d + 6, 12, 0, 0).toISOString();

  const sat = await launch("first", { HUDDLE_NOW: saturday });
  try {
    let index = -1;
    await check("on Saturday, a draft week with data gets a reminder", async () => {
      const h = await until(() => hooks(sat.app), (x) => x.toasts.some((t) => /isn't submitted yet/.test(t.title)), "the reminder", 40_000);
      index = h.toasts.findIndex((t) => /isn't submitted yet/.test(t.title));
      const t = h.toasts[index];
      assert(t.title === "This week isn't submitted yet", t.title);
      assert(t.href === `/dashboard?week=${weekStart}`, t.href);
      return t.body;
    });
    await check("clicking the reminder opens that week", async () => {
      await clickToast(sat.app, index);
      await sat.page.waitForURL((u) => u.pathname === "/dashboard" && u.searchParams.get("week") === weekStart, { timeout: 30_000 });
    });
    await check("the reminder is not repeated the same day", async () => {
      await sleep(9000);
      const n = (await hooks(sat.app)).toasts.filter((t) => /isn't submitted yet/.test(t.title)).length;
      assert(n === 1, `shown ${n} times`);
    });
  } finally {
    await sat.app.close().catch(() => {});
  }

  const again = await launch("first", { HUDDLE_NOW: saturday });
  try {
    await again.page.waitForURL((u) => u.pathname === "/dashboard", { timeout: 45_000 });
    await check("nor after a restart on the same day", async () => {
      await until(() => hooks(again.app), (x) => x.state.week, "week read", 30_000);
      await sleep(6000);
      const n = (await hooks(again.app)).toasts.filter((t) => /isn't submitted yet/.test(t.title)).length;
      assert(n === 0, `shown ${n} more times`);
    });
    await check("submitting the week in the page updates the tray at once", async () => {
      const res = await again.page.evaluate(async (week_start) => {
        const r = await fetch("/api/proxy/report/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ week_start, summary: "Submitted by the desktop end-to-end test" }),
        });
        return { ok: r.ok, text: await r.text() };
      }, weekStart);
      assert(res.ok, res.text);
      await until(() => hooks(again.app), (x) => x.state.week?.status === "submitted", "week status", 3500);
    });
  } finally {
    await again.app.close().catch(() => {});
  }
}

/* ---------- 3. the server is down ---------- */

async function unreachable() {
  console.log("\nServer unreachable");
  const dead = `http://127.0.0.1:${await closedPort()}`;
  const { app, page } = await launch("down", { HUDDLE_SERVER_URL: dead });
  try {
    await check("a server that does not answer gets a screen that says so", async () => {
      await page.waitForSelector("#retry", { state: "visible", timeout: 30_000 });
      assert((await page.textContent("#title")) === "Can't reach Team Huddle", "wrong heading");
      const why = await page.textContent("#problem");
      assert(/isn't answering|can't be reached/.test(why), why);
      await shot(page, "07-unreachable");
      return why;
    });
    await check("Try again stays put while it is still down", async () => {
      await page.click("#retry");
      await until(() => page.textContent("#retry"), (t) => t === "Try again", "button reset");
      assert(page.url().startsWith("file:"), page.url());
    });
    await check("a different address can be given from there", async () => {
      await page.click("#other");
      await connectTo(page, SERVER);
      await page.waitForURL((u) => u.origin === ORIGIN && u.pathname === "/login", { timeout: 45_000 });
      await page.waitForSelector("#email", { timeout: 20_000 });
    });
    /* Last in its run on purpose: the test driver waits for ever on a
       navigation that the app has refused, so nothing may follow it. The
       window itself carries on as normal, which is what is checked here,
       from the app's side. */
    await check("a page cannot steer the window off the server", async () => {
      await page.evaluate(() => {
        location.href = "https://example.org/takeover";
      });
      const h = await until(() => hooks(app), (x) => x.externals.includes("https://example.org/takeover"), "navigation recorded");
      await sleep(800);
      const alive = await app.evaluate(async ({ BrowserWindow }) => {
        const wc = BrowserWindow.getAllWindows()[0].webContents;
        return { url: wc.getURL(), form: await wc.executeJavaScript("Boolean(document.querySelector('#email'))") };
      });
      assert(new URL(alive.url).origin === ORIGIN && alive.form, JSON.stringify(alive));
      return `handed to the browser instead: ${h.externals.join(", ")}`;
    });
  } finally {
    await app.close().catch(() => {});
  }
}

/* ---------- run ---------- */

const started = Date.now();
try {
  await firstRun();
  await unreachable();
} catch (err) {
  results.push({ name: "the run itself", ok: false, note: String(err?.stack ?? err), ms: 0 });
  console.error(err);
}

const passed = results.filter((r) => r.ok === true).length;
const failed = results.filter((r) => r.ok === false).length;
const skipped = results.filter((r) => r.ok === null).length;
const summary = { label: LABEL, server: ORIGIN, signedIn: Boolean(EMAIL && PASSWORD), writes: WRITES, passed, failed, skipped, seconds: Math.round((Date.now() - started) / 1000), results };
fs.writeFileSync(path.join(outDir, `${LABEL}-results.json`), JSON.stringify(summary, null, 2));
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped in ${summary.seconds}s  →  e2e/out/${LABEL}-results.json`);
fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3 });
process.exit(failed ? 1 : 0);
