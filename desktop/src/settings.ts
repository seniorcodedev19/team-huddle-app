/* What the desktop app remembers between runs: one small JSON file in the
   app's own data folder. Nothing in it is secret — the sign-in itself is a
   cookie held by the window's session, not anything written here. */

import fs from "node:fs";
import path from "node:path";

export type WindowState = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
};

export type Settings = {
  /** The server's origin, or null until someone has connected. */
  serverUrl: string | null;
  /** Show a system notification when something new arrives. */
  notifications: boolean;
  /** Remind about a week that is not submitted, or was returned. */
  reminders: boolean;
  /** Closing the window keeps the app in the tray. */
  closeToTray: boolean;
  /** Start with the computer, in the tray. */
  startAtLogin: boolean;
  /** The "still running in the tray" note has been shown once. */
  trayHintShown: boolean;
  /** Reminder key -> the local date it was last shown on. */
  reminded: Record<string, string>;
  window: WindowState;
};

export const DEFAULTS: Settings = {
  serverUrl: null,
  notifications: true,
  reminders: true,
  closeToTray: true,
  startAtLogin: false,
  trayHintShown: false,
  reminded: {},
  window: { width: 1280, height: 860, maximized: false },
};

const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined);

/* Whatever is on disk, as settings that are safe to use. A file from an
   older version, a half-written one or one edited by hand must never stop
   the app from starting, so every field is checked and falls back alone. */
export function sanitize(raw: unknown): Settings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const w = (o.window && typeof o.window === "object" ? o.window : {}) as Record<string, unknown>;

  const reminded: Record<string, string> = {};
  if (o.reminded && typeof o.reminded === "object") {
    for (const [k, v] of Object.entries(o.reminded as Record<string, unknown>)) {
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) reminded[k] = v;
    }
  }

  const width = int(w.width);
  const height = int(w.height);
  const x = int(w.x);
  const y = int(w.y);
  return {
    serverUrl: typeof o.serverUrl === "string" && /^https?:\/\/[^/]+$/.test(o.serverUrl) ? o.serverUrl : null,
    notifications: bool(o.notifications, DEFAULTS.notifications),
    reminders: bool(o.reminders, DEFAULTS.reminders),
    closeToTray: bool(o.closeToTray, DEFAULTS.closeToTray),
    startAtLogin: bool(o.startAtLogin, DEFAULTS.startAtLogin),
    trayHintShown: bool(o.trayHintShown, DEFAULTS.trayHintShown),
    reminded,
    window: {
      width: width && width >= 480 ? width : DEFAULTS.window.width,
      height: height && height >= 360 ? height : DEFAULTS.window.height,
      // A position is kept only whole: half of one would put the window somewhere odd.
      ...(x !== undefined && y !== undefined ? { x, y } : {}),
      maximized: bool(w.maximized, false),
    },
  };
}

/* Reminder keys name a week, so they pile up one or two per week for ever.
   Only the newest few are worth keeping. */
export function pruneReminded(reminded: Record<string, string>, keep = 12) {
  const entries = Object.entries(reminded).sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0));
  return Object.fromEntries(entries.slice(0, keep));
}

export class SettingsStore {
  private data: Settings;

  constructor(private readonly file: string) {
    this.data = sanitize(SettingsStore.read(file));
  }

  private static read(file: string): unknown {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  }

  get(): Settings {
    return this.data;
  }

  /* Written to a temporary file and renamed over the real one, so a crash
     mid-write leaves the old settings, not an empty file. */
  set(patch: Partial<Settings>) {
    this.data = sanitize({ ...this.data, ...patch });
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
      fs.renameSync(tmp, this.file);
    } catch (err) {
      // The app keeps working from memory; it just will not remember next time.
      console.error("settings not saved", err);
    }
  }
}
