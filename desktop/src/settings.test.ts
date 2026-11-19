import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULTS, pruneReminded, sanitize, SettingsStore } from "./settings";

test("nothing on disk gives the defaults", () => {
  assert.deepEqual(sanitize(undefined), DEFAULTS);
  assert.deepEqual(sanitize("garbage"), DEFAULTS);
  assert.deepEqual(sanitize([]), DEFAULTS);
});

test("each field falls back on its own", () => {
  const s = sanitize({
    serverUrl: "https://huddle.example.com",
    notifications: "yes",
    reminders: false,
    closeToTray: null,
    startAtLogin: true,
    reminded: { "submit:2026-11-15": "2026-11-20", junk: 5, worse: "tomorrow" },
    window: { width: 900.4, height: "tall", x: -1200, y: 40, maximized: true },
  });
  assert.equal(s.serverUrl, "https://huddle.example.com");
  assert.equal(s.notifications, true);
  assert.equal(s.reminders, false);
  assert.equal(s.closeToTray, true);
  assert.equal(s.startAtLogin, true);
  assert.deepEqual(s.reminded, { "submit:2026-11-15": "2026-11-20" });
  assert.deepEqual(s.window, { width: 900, height: DEFAULTS.window.height, x: -1200, y: 40, maximized: true });
});

test("a stored server address must be a bare origin", () => {
  for (const bad of ["huddle.example.com", "https://huddle.example.com/dashboard", "file:///C:/x", "javascript:alert(1)", 7]) {
    assert.equal(sanitize({ serverUrl: bad }).serverUrl, null, String(bad));
  }
  assert.equal(sanitize({ serverUrl: "http://localhost:3000" }).serverUrl, "http://localhost:3000");
});

test("a window too small to use is not restored", () => {
  const s = sanitize({ window: { width: 10, height: 10 } });
  assert.equal(s.window.width, DEFAULTS.window.width);
  assert.equal(s.window.height, DEFAULTS.window.height);
});

test("only the newest reminder dates are kept", () => {
  const many: Record<string, string> = {};
  for (let d = 1; d <= 20; d++) many[`submit:${d}`] = `2026-11-${String(d).padStart(2, "0")}`;
  const kept = pruneReminded(many, 5);
  assert.deepEqual(Object.keys(kept).sort(), ["submit:16", "submit:17", "submit:18", "submit:19", "submit:20"]);
});

test("settings survive a restart, and a broken file does not stop the app", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "huddle-settings-"));
  const file = path.join(dir, "nested", "settings.json");
  try {
    const a = new SettingsStore(file);
    assert.deepEqual(a.get(), DEFAULTS);
    a.set({ serverUrl: "https://huddle.example.com", reminders: false });
    assert.equal(new SettingsStore(file).get().serverUrl, "https://huddle.example.com");
    assert.equal(new SettingsStore(file).get().reminders, false);
    assert.equal(fs.existsSync(`${file}.tmp`), false);

    fs.writeFileSync(file, "{ not json", "utf8");
    assert.deepEqual(new SettingsStore(file).get(), DEFAULTS);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
