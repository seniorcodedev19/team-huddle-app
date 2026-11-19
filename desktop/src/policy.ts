/* Where the window may go.

   The window shows one site: the Team Huddle server it was pointed at.
   Everything it loads from there is as trusted as the web app is in a
   browser, and nothing else is loaded in it at all — an outside link opens
   in the person's own browser, where it has their bookmarks, their password
   manager and none of this app's session.

   Pure: no Electron here, so every rule below has a test. */

export type ServerUrl = { ok: true; origin: string } | { ok: false; error: string };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLoopback(hostname: string) {
  return LOOPBACK.has(hostname.toLowerCase());
}

/* What someone typed into "Server address", as an origin.

   Only the origin is kept: a pasted link to a page inside the app still
   connects to the app. Plain http is accepted for this computer alone,
   because the sign-in cookie would otherwise cross the network unencrypted. */
export function normalizeServerUrl(input: string): ServerUrl {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Enter the address of your Team Huddle server." };

  let text = raw;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    const host = text.split(/[/:?#]/)[0] ?? "";
    text = `${isLoopback(host) || host.startsWith("[") ? "http" : "https"}://${text}`;
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "That doesn't look like a web address." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "The address has to start with https://." };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Leave the user name and password out of the address." };
  }
  if (!url.hostname) return { ok: false, error: "That doesn't look like a web address." };
  if (url.protocol === "http:" && !isLoopback(url.hostname)) {
    return {
      ok: false,
      error: "Use an https:// address. Plain http is only accepted for this computer (localhost).",
    };
  }
  return { ok: true, origin: url.origin };
}

/* Sign-in pages that have to run inside the window: the flow ends with a
   redirect back to the server, and that redirect must arrive in the window
   that holds the session. Google is the web app's own sign-in; Slack is the
   agent's "Connect Slack" on Admin. */
const AUTH_HOSTS = new Set(["accounts.google.com", "accounts.youtube.com", "slack.com"]);

function isAuthHost(hostname: string) {
  const host = hostname.toLowerCase();
  return AUTH_HOSTS.has(host) || host.endsWith(".slack.com");
}

/** app: the server itself or this app's own pages. auth: a sign-in page allowed
    in the window. external: hand to the system browser. deny: go nowhere. */
export type Verdict = "app" | "auth" | "external" | "deny";

export function classify(target: string, serverOrigin: string | null, localPrefix: string): Verdict {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return "deny";
  }

  if (url.protocol === "file:") {
    // Only the pages shipped with the app, never an arbitrary file on disk.
    return url.href.toLowerCase().startsWith(localPrefix.toLowerCase()) ? "app" : "deny";
  }
  if (url.protocol === "mailto:" || url.protocol === "tel:") return "external";
  if (url.protocol !== "https:" && url.protocol !== "http:") return "deny";

  if (serverOrigin && url.origin === serverOrigin) return "app";
  if (url.protocol === "https:" && isAuthHost(url.hostname)) return "auth";
  return "external";
}

/** Whether a link may be handed to the operating system to open. */
export function safeToOpenExternally(target: string) {
  try {
    const p = new URL(target).protocol;
    return p === "https:" || p === "http:" || p === "mailto:" || p === "tel:";
  } catch {
    return false;
  }
}

/* A path inside the app, from a notification or a menu item, as a full URL.
   Anything that is not a plain absolute path is refused, so a crafted href
   ("//evil.example", "https://…") cannot steer the window off the server. */
export function appUrl(serverOrigin: string, path: string): string | null {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
  try {
    const url = new URL(path, serverOrigin);
    return url.origin === serverOrigin ? url.href : null;
  } catch {
    return null;
  }
}
