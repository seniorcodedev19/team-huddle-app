import assert from "node:assert/strict";
import { test } from "node:test";
import { appUrl, classify, normalizeServerUrl, safeToOpenExternally } from "./policy";

const SERVER = "https://huddle.example.com";
const LOCAL = "file:///C:/Program%20Files/Team%20Huddle/resources/app.asar/static/";

test("a typed address becomes an origin", () => {
  assert.deepEqual(normalizeServerUrl("huddle.example.com"), { ok: true, origin: SERVER });
  assert.deepEqual(normalizeServerUrl("  https://huddle.example.com/dashboard?week=2026-11-15  "), {
    ok: true,
    origin: SERVER,
  });
  assert.deepEqual(normalizeServerUrl("HTTPS://Huddle.Example.com:8443/"), {
    ok: true,
    origin: "https://huddle.example.com:8443",
  });
});

test("this computer may use plain http, and gets it by default", () => {
  assert.deepEqual(normalizeServerUrl("localhost:3000"), { ok: true, origin: "http://localhost:3000" });
  assert.deepEqual(normalizeServerUrl("http://127.0.0.1:3000/login"), { ok: true, origin: "http://127.0.0.1:3000" });
  assert.deepEqual(normalizeServerUrl("[::1]:3000"), { ok: true, origin: "http://[::1]:3000" });
});

test("plain http to another machine is refused", () => {
  for (const bad of ["http://huddle.example.com", "http://192.168.1.20:3000", "http://localhost.evil.example"]) {
    const r = normalizeServerUrl(bad);
    assert.equal(r.ok, false, bad);
  }
});

test("addresses that are not web addresses are refused with a sentence", () => {
  for (const bad of ["", "   ", "ftp://huddle.example.com", "file:///C:/Windows", "javascript://x", "https://user:pw@huddle.example.com", "https://"]) {
    const r = normalizeServerUrl(bad);
    assert.equal(r.ok, false, bad);
    if (!r.ok) assert.ok(r.error.length > 10);
  }
});

test("the server's own pages stay in the window", () => {
  assert.equal(classify(`${SERVER}/dashboard`, SERVER, LOCAL), "app");
  assert.equal(classify(`${SERVER}/api/proxy/export.csv?week_start=2026-11-15`, SERVER, LOCAL), "app");
});

test("look-alike addresses are not the server", () => {
  for (const url of [
    "https://huddle.example.com.evil.example/dashboard",
    "https://evil.example/huddle.example.com",
    "https://huddle.example.com@evil.example/",
    "http://huddle.example.com/dashboard",
    "https://huddle.example.com:444/dashboard",
    "https://sub.huddle.example.com/",
  ]) {
    assert.equal(classify(url, SERVER, LOCAL), "external", url);
  }
});

test("sign-in pages the app depends on run in the window", () => {
  assert.equal(classify("https://accounts.google.com/o/oauth2/v2/auth?client_id=x", SERVER, LOCAL), "auth");
  assert.equal(classify("https://slack.com/oauth/v2/authorize?client_id=x", SERVER, LOCAL), "auth");
  assert.equal(classify("https://myteam.slack.com/signin", SERVER, LOCAL), "auth");
  // Not over plain http, and not a host that merely ends the same way.
  assert.equal(classify("http://accounts.google.com/", SERVER, LOCAL), "external");
  assert.equal(classify("https://notslack.com/", SERVER, LOCAL), "external");
  assert.equal(classify("https://evilslack.com/", SERVER, LOCAL), "external");
  assert.equal(classify("https://accounts.google.com.evil.example/", SERVER, LOCAL), "external");
});

test("everything else on the web goes to the browser", () => {
  assert.equal(classify("https://www.linkedin.com/in/someone", SERVER, LOCAL), "external");
  assert.equal(classify("mailto:someone@example.com", SERVER, LOCAL), "external");
  assert.equal(classify("tel:+15550100", SERVER, LOCAL), "external");
});

test("only the app's own files open from disk", () => {
  assert.equal(classify(`${LOCAL}connect.html`, SERVER, LOCAL), "app");
  assert.equal(classify(`${LOCAL.toUpperCase().replace("FILE:", "file:")}connect.html`, SERVER, LOCAL), "app");
  assert.equal(classify("file:///C:/Users/someone/Documents/secret.txt", SERVER, LOCAL), "deny");
  assert.equal(classify(`${LOCAL}../../../../Windows/win.ini`, SERVER, LOCAL), "deny");
});

test("schemes that run code or reach into the system go nowhere", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,<script>1</script>", "blob:https://x/1", "ms-settings:", "about:blank", "not a url", ""]) {
    assert.equal(classify(url, SERVER, LOCAL), "deny", url);
  }
});

test("with no server yet, nothing counts as the app but its own pages", () => {
  assert.equal(classify("https://huddle.example.com/", null, LOCAL), "external");
  assert.equal(classify(`${LOCAL}connect.html`, null, LOCAL), "app");
});

test("only ordinary links are handed to the system", () => {
  assert.equal(safeToOpenExternally("https://example.com"), true);
  assert.equal(safeToOpenExternally("mailto:a@example.com"), true);
  assert.equal(safeToOpenExternally("file:///C:/Windows/System32/calc.exe"), false);
  assert.equal(safeToOpenExternally("ms-msdt:/id"), false);
  assert.equal(safeToOpenExternally("javascript:alert(1)"), false);
  assert.equal(safeToOpenExternally("nonsense"), false);
});

test("a path from a notification cannot leave the server", () => {
  assert.equal(appUrl(SERVER, "/ai-training/board/12"), `${SERVER}/ai-training/board/12`);
  assert.equal(appUrl(SERVER, "/dashboard?week=2026-11-15"), `${SERVER}/dashboard?week=2026-11-15`);
  assert.equal(appUrl(SERVER, "//evil.example/x"), null);
  assert.equal(appUrl(SERVER, "https://evil.example/x"), null);
  assert.equal(appUrl(SERVER, "/\\evil.example"), null);
  assert.equal(appUrl(SERVER, "dashboard"), null);
  assert.equal(appUrl(SERVER, ""), null);
});
