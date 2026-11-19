/* Talking to the Team Huddle server from outside the page.

   Every call goes through the web app's own /api/proxy, with the cookie the
   window's session already holds — exactly what the page itself does. The
   desktop app therefore has the signed-in person's rights and no more, and
   holds no secret of its own: API_JWT_SECRET stays on the server. */

import { session } from "electron";

const TIMEOUT_MS = 12_000;

export type ApiResult = { status: number; body: unknown };

async function fetchJson(url: string, init: RequestInit): Promise<ApiResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await session.defaultSession.fetch(url, { ...init, signal: ctl.signal });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* Not JSON (an error page, say): the status alone is the answer. */
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/** A call to the API as the signed-in person. Rejects only when the server cannot be reached. */
export function api(origin: string, method: "GET" | "POST", pathname: string, body?: unknown) {
  return fetchJson(`${origin}/api/proxy${pathname}`, {
    method,
    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export type Probe = { ok: true } | { ok: false; error: string };

/* Is there a Team Huddle server at this address?

   Asked before an address is saved, so a typo gets a sentence instead of a
   blank window. /api/auth/providers is public, cheap and specific: it lists
   the ways to sign in, and every Team Huddle server has at least one. */
export async function probeServer(origin: string): Promise<Probe> {
  let res: ApiResult;
  try {
    res = await fetchJson(`${origin}/api/auth/providers`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
    });
  } catch {
    return { ok: false, error: `Can't reach ${origin}. Check the address and your connection.` };
  }
  const providers = res.body && typeof res.body === "object" ? Object.values(res.body as object) : [];
  const looksRight =
    res.status === 200 &&
    providers.some((p) => p && typeof p === "object" && typeof (p as { signinUrl?: unknown }).signinUrl === "string");
  if (!looksRight) {
    return { ok: false, error: `${origin} answered, but it isn't a Team Huddle server.` };
  }
  return { ok: true };
}
