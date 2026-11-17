import { Router } from "express";
import { z } from "zod";
import { canView } from "../auth";
import { pool } from "../db";
import { isoDate, parseWeek, todayUtc, weekDays } from "../dates";
import { isConfigured, loadConfig } from "../manictime";
import { activeShare, dayStats, type Interval } from "../manictimeParse";
import type { User } from "../types";
import { dateStr, h, HttpError } from "../util";

/* Time Tracking comes from ManicTime (see ../manictime.ts); nothing here
   writes. Time logged by hand before ManicTime stays in time_logs as
   history and is no longer shown. */
export const time = Router();

const dayKey = (v: string | Date) => (v instanceof Date ? isoDate(v) : String(v).slice(0, 10));

// One person's week: active minutes per day and their ManicTime tags.
time.get("/time", h(async (req, res) => {
  const actor = req.user!;
  const q = z.object({ week_start: z.string().optional(), user_id: z.coerce.number().int().optional() }).parse(req.query);
  const ws = parseWeek(q.week_start);
  const days = weekDays(ws);

  let target: Pick<User, "id" | "team_id"> = actor;
  if (q.user_id && q.user_id !== actor.id) {
    const u = await pool.query("select id, team_id from users where id=$1", [q.user_id]);
    if (!u.rows[0]) throw new HttpError(404, "User not found");
    target = u.rows[0];
  }
  if (!canView(actor, target)) throw new HttpError(403, "Not allowed");

  const [tracked, tags, link, cfg] = await Promise.all([
    pool.query<{ log_date: string; active_minutes: number }>(
      "select log_date, active_minutes from manictime_days where user_id=$1 and log_date between $2 and $3",
      [target.id, days[0], days[6]],
    ),
    pool.query(
      `select log_date, tag, auto, minutes, notes from manictime_tags
       where user_id=$1 and log_date between $2 and $3 order by log_date, auto, minutes desc, tag`,
      [target.id, days[0], days[6]],
    ),
    pool.query("select 1 from manictime_people where user_id=$1", [target.id]),
    loadConfig(),
  ]);
  const byDay = days.map((d) => tracked.rows.find((r) => dayKey(r.log_date) === d)?.active_minutes ?? 0);
  res.json({
    week_start: ws,
    week_end: days[6],
    today: todayUtc(),
    days,
    by_day: byDay,
    total_minutes: byDay.reduce((s, m) => s + m, 0),
    tags: tags.rows,
    manictime: {
      configured: isConfigured(cfg),
      linked: link.rows.length > 0,
      synced_at: cfg?.synced_at ?? null,
    },
  });
}));

/* Everyone's week the way ManicTime's Team views show it: the Active time
   report (per person and averaged over the days each was active), and the
   timelines of one day. Read from manictime_spans, which every sync
   replaces, so it shows what ManicTime has even for a locked week. */
time.get("/time-report", h(async (req, res) => {
  const q = z.object({ week_start: z.string().optional(), day: dateStr.optional() }).parse(req.query);
  const ws = parseWeek(q.week_start);
  const days = weekDays(ws);

  const [people, spanRows, cfg] = await Promise.all([
    pool.query<{ user_id: number; name: string; email: string; avatar: string | null; linked: boolean }>(
      `select u.id as user_id, coalesce(nullif(u.name,''), u.email) as name, u.email, u.avatar,
              exists (select 1 from manictime_people p where p.user_id = u.id) as linked
       from users u
       where u.active
         and ((u.role <> 'admin' and not u.is_bidder) or exists (select 1 from manictime_people p where p.user_id = u.id))
       order by name`,
    ),
    pool.query<{
      user_id: number;
      log_date: string | Date;
      device: string;
      kind: "active" | "away" | "tag" | "autotag";
      label: string;
      start_sec: number;
      end_sec: number;
    }>(
      `select user_id, log_date, device, kind, label, start_sec, end_sec
       from manictime_spans where log_date between $1 and $2
       order by user_id, log_date, device, start_sec`,
      [days[0], days[6]],
    ),
    loadConfig(),
  ]);

  // Active stretches per person per day, every computer together.
  const active = new Map<number, Map<string, Interval[]>>();
  for (const r of spanRows.rows) {
    if (r.kind !== "active") continue;
    const byDay = active.get(r.user_id) ?? new Map<string, Interval[]>();
    const d = dayKey(r.log_date);
    byDay.set(d, [...(byDay.get(d) ?? []), { start: r.start_sec, end: r.end_sec }]);
    active.set(r.user_id, byDay);
  }

  const slots = activeShare([]).length;
  const byTime = Array.from({ length: slots }, () => 0);
  const activeDays = new Set<string>();
  const rows = people.rows.map((p) => {
    let a = 0;
    let away = 0;
    let interruptions = 0;
    let n = 0;
    const share = Array.from({ length: slots }, () => 0);
    for (const [d, spans] of active.get(p.user_id) ?? []) {
      const s = dayStats(spans);
      if (s.active <= 0) continue;
      activeDays.add(d);
      a += s.active;
      away += s.away;
      interruptions += s.interruptions;
      n++;
      activeShare(spans).forEach((v, i) => (share[i] += v));
    }
    // Their typical day: each slot's share averaged over the days they were active.
    if (n) share.forEach((v, i) => (byTime[i] += v / n));
    return {
      user_id: p.user_id,
      name: p.name,
      email: p.email,
      avatar: p.avatar,
      linked: p.linked,
      days: n,
      active_sec: a,
      away_sec: away,
      interruptions,
    };
  });

  // The day the timelines show: the one asked for, else today, else the latest with activity.
  const today = todayUtc();
  const withData = days.filter((d) => activeDays.has(d));
  const day =
    q.day && days.includes(q.day)
      ? q.day
      : days.includes(today) && (activeDays.has(today) || !withData.length)
        ? today
        : (withData[withData.length - 1] ?? days[0]);

  const names = new Map(people.rows.map((p) => [p.user_id, p.name]));
  const timeline = new Map<number, { user_id: number; name: string; spans: unknown[] }>();
  for (const r of spanRows.rows) {
    if (dayKey(r.log_date) !== day) continue;
    const t = timeline.get(r.user_id) ?? { user_id: r.user_id, name: names.get(r.user_id) ?? "Unknown", spans: [] };
    t.spans.push({ device: r.device, kind: r.kind, label: r.label, start: r.start_sec, end: r.end_sec });
    timeline.set(r.user_id, t);
  }

  res.json({
    week_start: ws,
    week_end: days[6],
    today,
    days,
    day,
    active_days: withData,
    people: rows,
    by_time: byTime.map((v) => Math.round(v * 100) / 100),
    timeline: [...timeline.values()].sort((x, y) => x.name.localeCompare(y.name)),
    manictime: { configured: isConfigured(cfg), synced_at: cfg?.synced_at ?? null },
  });
}));
