import { hostname } from "node:os";
import { decryptSecret } from "./crypto";
import { addDays, todayUtc, validDate, weekStartOf } from "./dates";
import { pool } from "./db";
import {
  activeMinutesByDay,
  parseActivities,
  parseTimelines,
  tagMinutesByDay,
  tagSpans,
  usageSpans,
  type MtActivity,
  type MtTimeline,
} from "./manictimeParse";
import { HttpError } from "./util";

/* ManicTime Server → Huddle.

   Reads every Computer usage and Tags timeline over the ManicTime Server
   API and writes, per linked person per local day, their active minutes
   (manictime_days, the Time Tracking score), the minutes under each tag
   (manictime_tags), and every Active, Away and tag stretch for the Time
   tracking page's timelines and report (manictime_spans).

   It runs wherever the API can reach ManicTime: in local dev the API
   process runs it every 15 minutes, `npm run mt:sync` runs it once (for a
   Windows scheduled task on the ManicTime machine), and admins press Sync
   now. ManicTime is only ever read. */

const ACCEPT = "application/vnd.manictime.v3+json";
const TIMEOUT_MS = 20_000;
const MAX_RANGE_DAYS = 92;

export type ManicTimeConfig = {
  server_url: string;
  auth_mode: "token" | "password";
  username: string;
  secret_enc: string | null;
  synced_at: string | null;
  sync_error: string | null;
  sync_summary: SyncSummary | null;
};

export type SyncSummary = {
  from: string;
  to: string;
  people: number;
  linked: number;
  days: number;
  tags: number;
  /** Person-days left alone because that week is submitted or approved. */
  locked: number;
  timelines: { usage: number; tags: number; autotags: number };
  warnings: string[];
};

export async function loadConfig(): Promise<ManicTimeConfig | null> {
  const { rows } = await pool.query<ManicTimeConfig>(
    "select server_url, auth_mode, username, secret_enc, synced_at, sync_error, sync_summary from manictime_config where id=1",
  );
  return rows[0] ?? null;
}

export const isConfigured = (c: ManicTimeConfig | null): c is ManicTimeConfig =>
  Boolean(c?.server_url && c.secret_enc && (c.auth_mode === "token" || c.username));

/** "http://host:8080/api/" → "http://host:8080". */
export const baseUrl = (url: string) => url.trim().replace(/\/+$/, "").replace(/\/api$/i, "");

/* When ManicTime runs on this machine, dial it over IPv4 loopback. Node
   resolves "localhost" and the machine's own name to IPv6 first (the own
   name to a link-local address only), and on some PCs a firewall or VPN
   blocks those, so the connection fails with EACCES while 127.0.0.1 works. */
const dialUrl = (url: string) => {
  const u = new URL(baseUrl(url));
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host === "[::1]" || host === hostname().toLowerCase()) u.hostname = "127.0.0.1";
  return u.origin + u.pathname.replace(/\/+$/, "");
};

class Client {
  private constructor(
    private readonly base: string,
    private readonly shown: string,
    private readonly token: string,
  ) {}

  static async connect(c: ManicTimeConfig): Promise<Client> {
    const base = dialUrl(c.server_url);
    const shown = baseUrl(c.server_url);
    let secret: string;
    try {
      secret = decryptSecret(c.secret_enc ?? "");
    } catch {
      throw new HttpError(
        400,
        "The saved ManicTime sign-in can't be read any more, because the server's secret key changed. Save it again on Admin → ManicTime.",
      );
    }
    if (c.auth_mode === "token") return new Client(base, shown, secret);

    const res = await reach(shown, `${base}/api/token`, {
      method: "POST",
      headers: { Accept: ACCEPT, "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams({ grant_type: "password", username: c.username, password: secret }).toString(),
    });
    if (res.status === 400 || res.status === 401) {
      throw new HttpError(400, "ManicTime didn't accept that username and password.");
    }
    if (!res.ok) throw new HttpError(502, `ManicTime sign-in failed (HTTP ${res.status}).`);
    const j = (await res.json().catch(() => ({}))) as { token?: string; access_token?: string };
    const token = j.token ?? j.access_token;
    if (!token) throw new HttpError(502, "ManicTime signed in but sent no token back.");
    return new Client(base, shown, token);
  }

  /** A path ("/api/timelines") or a link ManicTime gave us. Links are
      re-pointed at the configured address, since the server may name
      itself by a host this machine can't resolve. */
  async get(pathOrHref: string, params?: Record<string, string>): Promise<unknown> {
    const given = new URL(pathOrHref, this.base);
    const url = new URL(given.pathname + given.search, new URL(this.base).origin);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
    const res = await reach(this.shown, url.toString(), {
      headers: { Accept: ACCEPT, Authorization: `Bearer ${this.token}` },
    });
    if (res.status === 401) {
      throw new HttpError(400, "ManicTime didn't accept the saved sign-in. Check it on Admin → ManicTime.");
    }
    if (res.status === 403) {
      throw new HttpError(
        400,
        "The ManicTime account used for syncing isn't allowed to read this. Give it the Administrator role in ManicTime.",
      );
    }
    if (!res.ok) throw new HttpError(502, `ManicTime answered HTTP ${res.status} for ${url.pathname}.`);
    return res.json();
  }

  async timelines(): Promise<MtTimeline[]> {
    return parseTimelines(await this.get("/api/timelines"));
  }

  async activities(t: MtTimeline, fromTime: string, toTime: string): Promise<MtActivity[]> {
    const href = t.activitiesHref ?? `/api/timelines/${encodeURIComponent(t.key)}/activities`;
    return parseActivities(await this.get(href, { fromTime, toTime }));
  }
}

async function reach(shown: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    // fetch hides the socket error in `cause`; show its code so an admin can tell
    // a stopped service (ECONNREFUSED) from a blocked one (EACCES) or a timeout.
    const cause = (e as { cause?: { code?: string } }).cause;
    const why = cause?.code ?? ((e as Error).name === "TimeoutError" ? "timed out" : "");
    throw new HttpError(
      502,
      `Can't reach ManicTime at ${shown}${why ? ` (${why})` : ""}. Check that the ManicTime Server service is running and the address is right.`,
    );
  }
}

/* Records every ManicTime user who owns a timeline, and links the ones it
   can match to a Huddle user: by email, then by full name, then by a first
   name only one person on each side has. Links an admin set are kept. */
async function recordPeople(timelines: MtTimeline[]) {
  const people = new Map<string, { name: string; devices: Set<string> }>();
  for (const t of timelines) {
    if (!t.owner.username) continue;
    const p = people.get(t.owner.username) ?? { name: t.owner.displayName, devices: new Set<string>() };
    if (t.kind === "usage") p.devices.add(t.key);
    people.set(t.owner.username, p);
  }
  for (const [username, p] of people) {
    await pool.query(
      `insert into manictime_people (mt_username, display_name, devices, seen_at) values ($1,$2,$3,now())
       on conflict (mt_username) do update set display_name=excluded.display_name, devices=excluded.devices, seen_at=now()`,
      [username, p.name, p.devices.size],
    );
  }

  const [{ rows: mt }, { rows: users }] = await Promise.all([
    pool.query<{ mt_username: string; display_name: string; user_id: number | null }>(
      "select mt_username, display_name, user_id from manictime_people",
    ),
    pool.query<{ id: number; name: string; email: string }>(
      "select id, coalesce(name,'') as name, email from users where active",
    ),
  ]);
  const taken = new Set(mt.map((p) => p.user_id).filter((id): id is number => id !== null));
  const lc = (s: string) => s.trim().toLowerCase();
  const first = (s: string) => lc(s).split(/\s+/)[0] ?? "";
  const unique = <T>(xs: T[]) => (xs.length === 1 ? xs[0] : undefined);
  const free = mt.filter((p) => p.user_id === null);

  for (const p of free) {
    const name = lc(p.display_name);
    const candidates = users.filter((u) => !taken.has(u.id));
    const match =
      candidates.find((u) => lc(u.email) === lc(p.mt_username)) ??
      unique(candidates.filter((u) => name && lc(u.name) === name)) ??
      (name && !name.includes(" ") && unique(free.filter((q) => first(q.display_name) === name)) === p
        ? unique(candidates.filter((u) => first(u.name) === name))
        : undefined);
    if (!match) continue;
    await pool.query("update manictime_people set user_id=$1 where mt_username=$2 and user_id is null", [
      match.id,
      p.mt_username,
    ]);
    taken.add(match.id);
  }
}

/** Signs in and lists who owns which timelines. Used by "Check connection". */
export async function checkConnection() {
  const c = await loadConfig();
  if (!isConfigured(c)) throw new HttpError(400, "Save the ManicTime server address and sign-in first.");
  const client = await Client.connect(c);
  const timelines = await client.timelines();
  await recordPeople(timelines);
  return {
    people: new Set(timelines.map((t) => t.owner.username)).size,
    timelines: countKinds(timelines),
  };
}

const countKinds = (ts: MtTimeline[]) => ({
  usage: ts.filter((t) => t.kind === "usage").length,
  tags: ts.filter((t) => t.kind === "tags").length,
  autotags: ts.filter((t) => t.kind === "autotags").length,
});

let running: Promise<SyncSummary> | null = null;

/** One sync at a time per process. A second request while one runs is refused. */
export function runSync(opts: { from?: string; to?: string } = {}): Promise<SyncSummary> {
  if (running) throw new HttpError(409, "A ManicTime sync is already running. Try again in a minute.");
  running = sync(opts).finally(() => {
    running = null;
  });
  return running;
}

async function sync(opts: { from?: string; to?: string }): Promise<SyncSummary> {
  const today = todayUtc();
  // Last week and this week; a day ahead, since local time can be ahead of UTC.
  const from = opts.from ?? addDays(weekStartOf(today), -7);
  const to = opts.to ?? addDays(today, 1);
  if (!validDate(from) || !validDate(to) || from > to) throw new HttpError(400, "Pick a valid date range to sync.");
  if (addDays(from, MAX_RANGE_DAYS) < to) {
    throw new HttpError(400, `Sync at most ${MAX_RANGE_DAYS} days at a time.`);
  }

  const c = await loadConfig();
  if (!isConfigured(c)) {
    throw new HttpError(400, "ManicTime isn't connected yet. Save the server address and sign-in on Admin → ManicTime.");
  }

  try {
    const summary = await pull(c, from, to);
    await pool.query("update manictime_config set synced_at=now(), sync_error=null, sync_summary=$1 where id=1", [
      JSON.stringify(summary),
    ]);
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : "The ManicTime sync failed.";
    await pool.query("update manictime_config set sync_error=$1 where id=1", [message]).catch(() => undefined);
    throw err;
  }
}

async function pull(c: ManicTimeConfig, from: string, to: string): Promise<SyncSummary> {
  const client = await Client.connect(c);
  const timelines = await client.timelines();
  await recordPeople(timelines);

  const { rows: links } = await pool.query<{ mt_username: string; display_name: string; user_id: number | null }>(
    "select mt_username, display_name, user_id from manictime_people",
  );
  const userOf = new Map(links.filter((l) => l.user_id !== null).map((l) => [l.mt_username, l.user_id as number]));

  // Ask a day wider on each side: the server's idea of a day may not be the person's.
  const fromTime = addDays(from, -1);
  const toTime = addDays(to, 2);
  const warnings: string[] = [];
  const days: { user_id: number; day: string; minutes: number }[] = [];
  const tags: { user_id: number; day: string; tag: string; auto: boolean; minutes: number; notes: string | null }[] = [];
  const spans: SpanRow[] = [];
  const unlinkedWithTime = new Set<string>();
  const groupsSeen = new Set<string>();
  let usageActivities = 0;

  const byOwner = new Map<string, MtTimeline[]>();
  for (const t of timelines) byOwner.set(t.owner.username, [...(byOwner.get(t.owner.username) ?? []), t]);

  // Everything is fetched before anything is written, so a failure midway changes nothing.
  for (const [username, owned] of byOwner) {
    const userId = userOf.get(username);
    const wanted = owned.filter((t) => t.kind !== "other");
    if (!userId) {
      if (wanted.some((t) => t.kind === "usage")) unlinkedWithTime.add(owned[0].owner.displayName || username);
      continue;
    }
    const fetched = await Promise.all(
      wanted.map(async (t) => ({ t, acts: await client.activities(t, fromTime, toTime) })),
    );

    const usage = fetched.filter((f) => f.t.kind === "usage").flatMap((f) => f.acts);
    usageActivities += usage.length;
    for (const a of usage) for (const g of [...a.groupKeys, ...a.groupNames]) groupsSeen.add(g);
    for (const [day, minutes] of activeMinutesByDay(usage, from, to)) days.push({ user_id: userId, day, minutes });

    // For the timelines: each computer on its own, as ManicTime draws it.
    for (const f of fetched.filter((x) => x.t.kind === "usage")) {
      const device = (f.t.device || "Computer").slice(0, 200);
      for (const s of usageSpans(f.acts, from, to)) spans.push({ user_id: userId, device, label: "", ...s });
    }

    for (const auto of [false, true]) {
      const acts = fetched.filter((f) => f.t.kind === (auto ? "autotags" : "tags")).flatMap((f) => f.acts);
      for (const d of tagMinutesByDay(acts, from, to)) tags.push({ user_id: userId, auto, ...d });
      for (const s of tagSpans(acts, from, to)) {
        spans.push({ user_id: userId, device: "", kind: auto ? "autotag" : "tag", ...s });
      }
    }
  }

  if (usageActivities > 0 && days.length === 0) {
    warnings.push(
      `Computer usage came back, but none of it was marked Active. Groups seen: ${[...groupsSeen].slice(0, 8).join(", ") || "none"}.`,
    );
  }
  if (unlinkedWithTime.size) {
    warnings.push(
      `Not linked to anyone here, so not imported: ${[...unlinkedWithTime].sort().join(", ")}. Link them on Admin → ManicTime.`,
    );
  }

  const locked = await write(from, to, days, tags, spans);
  return {
    from,
    to,
    people: byOwner.size,
    linked: [...byOwner.keys()].filter((u) => userOf.has(u)).length,
    days: days.length - locked.days,
    tags: tags.length - locked.tags,
    locked: locked.days,
    timelines: countKinds(timelines),
    warnings,
  };
}

type SpanRow = {
  user_id: number;
  day: string;
  device: string;
  kind: "active" | "away" | "tag" | "autotag";
  label: string;
  start: number;
  end: number;
};

/* Replaces the range in one transaction. A week that is submitted or
   approved keeps its active time and tags exactly as they were — the same
   lock that stops hand edits (PUT /daily, PUT /weekly, the agent's
   eval_write_daily) applies here. Timeline spans are display only and are
   always replaced. */
async function write(
  from: string,
  to: string,
  days: { user_id: number; day: string; minutes: number }[],
  tags: { user_id: number; day: string; tag: string; auto: boolean; minutes: number; notes: string | null }[],
  spans: SpanRow[],
) {
  const db = await pool.connect();
  try {
    await db.query("begin");
    const { rows: lockedRows } = await db.query<{ user_id: number; week_start: string }>(
      `select user_id, week_start from weekly_reports
       where status in ('submitted','approved') and week_start between $1 and $2`,
      [weekStartOf(from), to],
    );
    const lockedWeeks = new Set(lockedRows.map((r) => `${r.user_id}:${String(r.week_start).slice(0, 10)}`));
    const isLocked = (userId: number, day: string) => lockedWeeks.has(`${userId}:${weekStartOf(day)}`);
    const notLocked = `not exists (
        select 1 from weekly_reports r
        where r.user_id = x.user_id and r.status in ('submitted','approved')
          and r.week_start = x.log_date - extract(dow from x.log_date)::int)`;

    await db.query(`delete from manictime_days x where log_date between $1 and $2 and ${notLocked}`, [from, to]);
    await db.query(`delete from manictime_tags x where log_date between $1 and $2 and ${notLocked}`, [from, to]);

    const d = days.filter((r) => !isLocked(r.user_id, r.day));
    if (d.length) {
      await db.query(
        `insert into manictime_days (user_id, log_date, active_minutes, synced_at)
         select * , now() from unnest($1::int[], $2::date[], $3::int[])
         on conflict (user_id, log_date) do update set active_minutes=excluded.active_minutes, synced_at=now()`,
        [d.map((r) => r.user_id), d.map((r) => r.day), d.map((r) => r.minutes)],
      );
    }
    const t = tags.filter((r) => !isLocked(r.user_id, r.day));
    if (t.length) {
      await db.query(
        `insert into manictime_tags (user_id, log_date, tag, auto, minutes, notes, synced_at)
         select *, now() from unnest($1::int[], $2::date[], $3::text[], $4::boolean[], $5::int[], $6::text[])
         on conflict (user_id, log_date, tag, auto) do update
           set minutes=excluded.minutes, notes=excluded.notes, synced_at=now()`,
        [
          t.map((r) => r.user_id),
          t.map((r) => r.day),
          t.map((r) => r.tag),
          t.map((r) => r.auto),
          t.map((r) => r.minutes),
          t.map((r) => r.notes),
        ],
      );
    }
    await db.query("delete from manictime_spans where log_date between $1 and $2", [from, to]);
    if (spans.length) {
      await db.query(
        `insert into manictime_spans (user_id, log_date, device, kind, label, start_sec, end_sec)
         select * from unnest($1::int[], $2::date[], $3::text[], $4::text[], $5::text[], $6::int[], $7::int[])`,
        [
          spans.map((r) => r.user_id),
          spans.map((r) => r.day),
          spans.map((r) => r.device),
          spans.map((r) => r.kind),
          spans.map((r) => r.label),
          spans.map((r) => r.start),
          spans.map((r) => r.end),
        ],
      );
    }
    await db.query("commit");
    return { days: days.length - d.length, tags: tags.length - t.length };
  } catch (err) {
    await db.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    db.release();
  }
}

/* Local dev: the API process syncs every 15 minutes while ManicTime is
   connected. Failures are already recorded on the config row for the admin
   page; here they are only logged. */
export function startManicTimeSchedule(everyMs = 15 * 60_000) {
  const tick = async () => {
    try {
      if (!isConfigured(await loadConfig())) return;
      const s = await runSync();
      console.log(`ManicTime sync: ${s.days} day(s), ${s.tags} tag row(s) for ${s.linked} linked people`);
    } catch (err) {
      console.warn("ManicTime sync failed:", err instanceof Error ? err.message : err);
    }
  };
  setTimeout(tick, 30_000).unref();
  setInterval(tick, everyMs).unref();
}
