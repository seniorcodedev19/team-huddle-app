/* When to remind someone about their week.

   The whole product hangs on people remembering to submit, and nothing in
   the web app tells them to. A program that sits in the tray can: it looks
   at the person's own week and speaks up when that week needs them.

   Three cases, most pressing first:
     1. a week came back from review  -> fix it and submit again
     2. last week is still a draft    -> submit it (first days of the new week)
     3. this week is still a draft    -> submit it (Friday afternoon, Saturday)

   A week with nothing in it is never nagged about: the API would refuse to
   submit it anyway, and it is what an admin's or a bidder's week looks like.

   Weeks are Sunday to Saturday in UTC, as the API decides them
   (apps/api/src/dates.ts). The hour of day is the person's own, because
   "not at night" is about where they are, not about UTC.

   Pure: the clock and the weeks are passed in. */

export type WeekStatus = "draft" | "submitted" | "approved" | "returned";

export type WeekLite = {
  week_start: string;
  status: WeekStatus;
  hasData: boolean;
};

export type Reminder = {
  /** Names the case and the week, so each is shown at most once a day. */
  key: string;
  title: string;
  body: string;
  /** Where clicking the reminder leads. */
  href: string;
};

export type Clock = {
  /** The person's own date, YYYY-MM-DD. */
  localDate: string;
  /** The person's own hour, 0-23. */
  localHour: number;
  /** Day of the week in UTC: 0 is Sunday, the first day of a week. */
  utcDay: number;
};

const pad = (n: number) => String(n).padStart(2, "0");

export function clockOf(now: Date): Clock {
  return {
    localDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    localHour: now.getHours(),
    utcDay: now.getUTCDay(),
  };
}

export function todayUtc(now: Date) {
  return now.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Sunday that starts the week `date` falls in. */
export function weekStartOf(date: string) {
  return addDays(date, -new Date(`${date}T00:00:00Z`).getUTCDay());
}

/** "Nov 15 – Nov 21": the week as a person would say it. */
export function weekLabel(weekStart: string) {
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(weekStart)} – ${fmt(addDays(weekStart, 6))}`;
}

const STATUSES = new Set<string>(["draft", "submitted", "approved", "returned"]);

/** The parts of GET /week this file needs, or null if it is not a week. */
export function parseWeek(body: unknown): WeekLite | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  if (typeof o.week_start !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.week_start)) return null;
  if (typeof o.status !== "string" || !STATUSES.has(o.status)) return null;

  // The same test as `hasData` in apps/api/src/week.ts: tracked time, or any entry.
  const tracked = typeof o.time_hours === "number" && o.time_hours > 0;
  const daily = o.daily && typeof o.daily === "object" ? Object.values(o.daily as Record<string, unknown>) : [];
  const typed = daily.some((d) => d && typeof d === "object" && Object.keys(d).length > 0);
  return { week_start: o.week_start, status: o.status as WeekStatus, hasData: tracked || typed };
}

/* Reminders stay inside the working day. */
const DAY_STARTS = 10;
const DAY_ENDS = 22;
/* On Friday, not before the afternoon: the week is still being worked. */
const FRIDAY_FROM = 15;
/* How long into a new week last week is still worth mentioning (Sun, Mon, Tue). */
const LAST_WEEK_DAYS = 2;

const href = (w: WeekLite) => `/dashboard?week=${w.week_start}`;

export function dueReminder(args: {
  clock: Clock;
  current: WeekLite | null;
  previous: WeekLite | null;
  reminded: Record<string, string>;
}): Reminder | null {
  const { clock, current, previous, reminded } = args;
  if (clock.localHour < DAY_STARTS || clock.localHour >= DAY_ENDS) return null;

  const fresh = (key: string) => reminded[key] !== clock.localDate;

  for (const w of [current, previous]) {
    if (w?.status !== "returned") continue;
    const key = `returned:${w.week_start}`;
    if (!fresh(key)) continue;
    return {
      key,
      title: "Your week was returned",
      body: `The week of ${weekLabel(w.week_start)} came back from review. Open it to read the comment, fix it and submit again.`,
      href: href(w),
    };
  }

  if (previous?.status === "draft" && previous.hasData && clock.utcDay <= LAST_WEEK_DAYS) {
    const key = `submit:${previous.week_start}`;
    if (fresh(key)) {
      return {
        key,
        title: "Last week isn't submitted yet",
        body: `The week of ${weekLabel(previous.week_start)} is still a draft. Submit it so it can be reviewed.`,
        href: href(previous),
      };
    }
  }

  const closing =
    (clock.utcDay === 5 && clock.localHour >= FRIDAY_FROM) || clock.utcDay === 6;
  if (current?.status === "draft" && current.hasData && closing) {
    const key = `submit:${current.week_start}`;
    if (fresh(key)) {
      return {
        key,
        title: "This week isn't submitted yet",
        body: `The week of ${weekLabel(current.week_start)} closes on Saturday. Check your numbers and submit.`,
        href: href(current),
      };
    }
  }
  return null;
}

const STATUS_WORD: Record<WeekStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  returned: "Returned",
};

/** The week's status as the tray menu shows it. */
export function statusWord(s: WeekStatus) {
  return STATUS_WORD[s];
}
