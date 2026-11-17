/* Reading ManicTime Server API responses. Pure: no I/O, no clock, so it can
   be tested without a ManicTime server.

   The server speaks two shapes. API v3 (what we ask for) returns
   `entities`, each an activity, group or groupList with its fields under
   `values`, and an activity carries a start plus a duration in seconds.
   API v2 returns flat `activities` and `groups` arrays with start and end
   times. Both are accepted, so a server that answers in v2 still works. */

const DAY_MS = 86_400_000;

/** A stretch of time. start/end are epoch ms; offset is the device's UTC
    offset in minutes, which decides which local day the time belongs to. */
export type Span = { start: number; end: number; offset: number };

export type MtActivity = Span & {
  name: string;
  notes: string | null;
  /** Keys of the groups the activity belongs to, e.g. "ManicTime/Active". */
  groupKeys: string[];
  /** Display names of those groups, e.g. "Active". */
  groupNames: string[];
};

export type TimelineKind = "usage" | "tags" | "autotags" | "other";

export type MtTimeline = {
  key: string;
  schema: string;
  kind: TimelineKind;
  owner: { username: string; displayName: string };
  device: string;
  /** The timeline's own activities link, when the server gave one. */
  activitiesHref: string | null;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/* "2026-11-17T09:18:47+02:00" → the instant, plus +120. A stamp with no
   offset is a wall-clock time: it is read as UTC with offset 0, which puts
   it on the day it names — the only day that matters here. */
export function parseStamp(s: string): { at: number; offset: number } | null {
  const t = s.trim();
  if (!t) return null;
  let iso = t;
  let offset = 0;
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(t);
  if (/[zZ]$/.test(t)) offset = 0;
  else if (m && t.includes("T")) offset = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  else iso = t.includes("T") ? `${t}Z` : `${t}T00:00:00Z`;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? { at, offset } : null;
}

export function timelineKind(schema: string): TimelineKind {
  const s = schema.toLowerCase();
  if (s === "manictime/computerusage") return "usage";
  if (s.includes("autotag")) return "autotags";
  if (s === "manictime/tags") return "tags";
  return "other";
}

export function parseTimelines(json: unknown): MtTimeline[] {
  const out: MtTimeline[] = [];
  for (const raw of list(obj(json).timelines)) {
    const t = obj(raw);
    const key = str(t.timelineKey) || str(t.timelineId);
    if (!key) continue;
    const schema = str(obj(t.schema).name) || str(obj(t.timelineType).typeName);
    const owner = obj(t.owner);
    const username = str(owner.username) || str(owner.userId);
    const link = list(t.links)
      .map(obj)
      .find((l) => str(l.rel).toLowerCase() === "manictime/activities");
    out.push({
      key,
      schema,
      kind: timelineKind(schema),
      owner: { username, displayName: str(owner.displayName) || username },
      device:
        str(t.deviceDisplayName) || str(obj(t.clientEnvironment).deviceName) || str(obj(t.homeEnvironment).deviceName),
      activitiesHref: link ? str(link.href) || null : null,
    });
  }
  return out;
}

export function parseActivities(json: unknown): MtActivity[] {
  const root = obj(json);
  return Array.isArray(root.entities) ? fromV3(root.entities) : fromV2(root);
}

function fromV3(entities: unknown[]): MtActivity[] {
  const groups = new Map<string, { key: string; name: string }>();
  const groupLists = new Map<string, string[]>();
  const acts: Obj[] = [];
  for (const raw of entities) {
    const e = obj(raw);
    const id = str(e.entityId);
    const v = obj(e.values);
    const type = str(e.entityType).toLowerCase();
    if (type === "group") groups.set(id, { key: str(v.key), name: str(v.name) });
    else if (type === "grouplist") groupLists.set(id, list(v.groupIds).map(str));
    else if (type === "activity") acts.push(v);
  }
  const out: MtActivity[] = [];
  for (const v of acts) {
    const ti = obj(v.timeInterval);
    const start = parseStamp(str(ti.start));
    const seconds = Number(ti.duration);
    if (!start || !Number.isFinite(seconds) || seconds <= 0) continue;
    const ids = v.groupId !== undefined && v.groupId !== null ? [str(v.groupId)] : (groupLists.get(str(v.groupListId)) ?? []);
    const gs = ids.map((id) => groups.get(id)).filter((g): g is { key: string; name: string } => Boolean(g));
    out.push({
      start: start.at,
      end: start.at + seconds * 1000,
      offset: start.offset,
      name: str(v.name),
      notes: str(v.notes) || null,
      groupKeys: gs.map((g) => g.key),
      groupNames: gs.map((g) => g.name),
    });
  }
  return out;
}

function fromV2(root: Obj): MtActivity[] {
  const groups = new Map<string, { key: string; name: string }>();
  for (const raw of list(root.groups)) {
    const g = obj(raw);
    groups.set(str(g.groupId), { key: str(g.displayKey), name: str(g.displayName) });
  }
  const out: MtActivity[] = [];
  for (const raw of list(root.activities)) {
    const a = obj(raw);
    const start = parseStamp(str(a.startTime));
    const end = parseStamp(str(a.endTime));
    if (!start || !end || end.at <= start.at) continue;
    const g = groups.get(str(a.groupId));
    out.push({
      start: start.at,
      end: end.at,
      offset: start.offset,
      name: str(a.displayName) || str(a.name),
      notes: str(a.notes) || null,
      groupKeys: g ? [g.key] : [],
      groupNames: g ? [g.name] : [],
    });
  }
  return out;
}

/* On a Computer usage timeline every stretch is Active, Away, Session
   locked or Power off. Only Active counts. ManicTime's key for it is
   "ManicTime/Active"; the display name is the fallback. */
export function isActiveUsage(a: MtActivity): boolean {
  if (a.groupKeys.some((k) => k.toLowerCase() === "manictime/active")) return true;
  if (a.groupNames.some((n) => n.toLowerCase() === "active")) return true;
  return a.groupKeys.length === 0 && a.groupNames.length === 0 && a.name.toLowerCase() === "active";
}

/** Joins overlapping spans, so time seen on two devices at once counts once. */
export function mergeSpans<T extends Span>(spans: T[]): Span[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end, offset: s.offset });
  }
  return out;
}

/** Adds a span's milliseconds to the local days it covers, within from..to. */
function addByLocalDay(into: Map<string, number>, span: Span, from: string, to: string) {
  let s = span.start + span.offset * 60_000;
  const e = span.end + span.offset * 60_000;
  while (s < e) {
    const dayStart = Math.floor(s / DAY_MS) * DAY_MS;
    const cut = Math.min(e, dayStart + DAY_MS);
    const day = new Date(dayStart).toISOString().slice(0, 10);
    if (day >= from && day <= to) into.set(day, (into.get(day) ?? 0) + (cut - s));
    s = cut;
  }
}

const toMinutes = (ms: number) => Math.min(1440, Math.round(ms / 60_000));

/** Active minutes per local day, merged across every device first. */
export function activeMinutesByDay(activities: MtActivity[], from: string, to: string): Map<string, number> {
  const ms = new Map<string, number>();
  for (const span of mergeSpans(activities.filter(isActiveUsage))) addByLocalDay(ms, span, from, to);
  const out = new Map<string, number>();
  for (const [day, v] of ms) {
    const m = toMinutes(v);
    if (m > 0) out.set(day, m);
  }
  return out;
}

export type TagDay = { day: string; tag: string; minutes: number; notes: string | null };

/** Minutes per tag per local day. The same tag twice at once counts once. */
export function tagMinutesByDay(activities: MtActivity[], from: string, to: string): TagDay[] {
  const byTag = new Map<string, MtActivity[]>();
  for (const a of activities) {
    const tag = a.name.trim();
    if (!tag) continue;
    byTag.set(tag, [...(byTag.get(tag) ?? []), a]);
  }
  const out: TagDay[] = [];
  for (const [tag, acts] of byTag) {
    const ms = new Map<string, number>();
    for (const span of mergeSpans(acts)) addByLocalDay(ms, span, from, to);
    for (const [day, v] of ms) {
      const minutes = toMinutes(v);
      if (minutes <= 0) continue;
      // Notes from that tag's stretches on that day, each once.
      const notes = [
        ...new Set(
          acts
            .filter((a) => a.notes && localDay(a) === day)
            .map((a) => a.notes!.trim())
            .filter(Boolean),
        ),
      ].join("; ");
      out.push({ day, tag: tag.slice(0, 200), minutes, notes: notes ? notes.slice(0, 1000) : null });
    }
  }
  return out.sort((a, b) => (a.day === b.day ? a.tag.localeCompare(b.tag) : a.day < b.day ? -1 : 1));
}

const localDay = (s: Span) => new Date(s.start + s.offset * 60_000).toISOString().slice(0, 10);

/* ---------- Timelines and the active-time report ---------- */

/** A stretch within one local day, in seconds from that day's midnight. */
export type Interval = { start: number; end: number };
export type DaySpan = Interval & { day: string };

const DAY_SEC = 86_400;

/** Cuts spans at each local midnight and keeps the pieces on days from..to. */
export function splitByLocalDay(spans: Span[], from: string, to: string): DaySpan[] {
  const out: DaySpan[] = [];
  for (const span of spans) {
    let s = span.start + span.offset * 60_000;
    const e = span.end + span.offset * 60_000;
    while (s < e) {
      const dayStart = Math.floor(s / DAY_MS) * DAY_MS;
      const cut = Math.min(e, dayStart + DAY_MS);
      const day = new Date(dayStart).toISOString().slice(0, 10);
      const start = Math.round((s - dayStart) / 1000);
      const end = Math.round((cut - dayStart) / 1000);
      if (day >= from && day <= to && end > start) out.push({ day, start, end });
      s = cut;
    }
  }
  return out;
}

/* Active or Away on a Computer usage timeline. Session locked and Power off
   are neither: ManicTime leaves them blank on its timelines too. */
export function usageState(a: MtActivity): "active" | "away" | null {
  if (isActiveUsage(a)) return "active";
  if (a.groupKeys.some((k) => k.toLowerCase() === "manictime/away")) return "away";
  if (a.groupNames.some((n) => n.toLowerCase() === "away")) return "away";
  return a.groupKeys.length === 0 && a.groupNames.length === 0 && a.name.toLowerCase() === "away" ? "away" : null;
}

/** One computer's Active and Away stretches per local day. */
export function usageSpans(activities: MtActivity[], from: string, to: string) {
  const out: (DaySpan & { kind: "active" | "away" })[] = [];
  for (const kind of ["active", "away"] as const) {
    const merged = mergeSpans(activities.filter((a) => usageState(a) === kind));
    for (const s of splitByLocalDay(merged, from, to)) out.push({ ...s, kind });
  }
  return out;
}

/** Each tag's stretches per local day; the same tag twice at once draws once. */
export function tagSpans(activities: MtActivity[], from: string, to: string) {
  const byTag = new Map<string, MtActivity[]>();
  for (const a of activities) {
    const tag = a.name.trim();
    if (tag) byTag.set(tag, [...(byTag.get(tag) ?? []), a]);
  }
  const out: (DaySpan & { label: string })[] = [];
  for (const [tag, acts] of byTag) {
    for (const s of splitByLocalDay(mergeSpans(acts), from, to)) out.push({ ...s, label: tag.slice(0, 200) });
  }
  return out;
}

/** Joins intervals that overlap or touch. */
export function mergeIntervals(xs: Interval[]): Interval[] {
  const sorted = xs.filter((x) => x.end > x.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const x of sorted) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
    else out.push({ start: x.start, end: x.end });
  }
  return out;
}

/* One person's day the way ManicTime's Active time report counts it, from
   their Active stretches on every computer:
   - active: the time any computer was active;
   - away: the rest of the time between the day's first and last activity;
   - interruptions: how many times activity stopped and started again. */
export function dayStats(active: Interval[]): { active: number; away: number; interruptions: number } {
  const m = mergeIntervals(active);
  if (!m.length) return { active: 0, away: 0, interruptions: 0 };
  const total = m.reduce((s, x) => s + (x.end - x.start), 0);
  return { active: total, away: m[m.length - 1].end - m[0].start - total, interruptions: m.length - 1 };
}

/** The share (0..1) of each slot of the day that was active. 900 s slots → 96 a day. */
export function activeShare(active: Interval[], slotSec = 900): number[] {
  const out = Array.from({ length: Math.ceil(DAY_SEC / slotSec) }, () => 0);
  for (const x of mergeIntervals(active)) {
    for (let i = Math.floor(x.start / slotSec); i * slotSec < x.end && i < out.length; i++) {
      const lo = Math.max(x.start, i * slotSec);
      const hi = Math.min(x.end, (i + 1) * slotSec);
      if (hi > lo) out[i] += (hi - lo) / slotSec;
    }
  }
  return out;
}
