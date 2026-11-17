import { pool } from "./db";
import { isoDate, weekDays } from "./dates";
import {
  computeScore,
  dayPoints,
  isTimeTracking,
  sumDaily,
  TIME_TRACKING_KEY,
  type DailyMap,
  type MetricScore,
  type Score,
  type WeeklyMetric,
} from "./scoring";

const r2 = (n: number) => Math.round(n * 100) / 100;

export type ReportStatus = "draft" | "submitted" | "approved" | "returned";

export interface ReportRow {
  id: number;
  user_id: number;
  week_start: string;
  status: ReportStatus;
  summary: string | null;
  submitted_at: string | null;
  reviewer_id: number | null;
  reviewed_at: string | null;
  review_comment: string | null;
  bonus: number;
  total: number | null;
  achievement_pct: number | null;
  breakdown: MetricScore[] | null;
}

export type MetricRow = WeeklyMetric & { team_id: number | null; active: boolean };

// Metrics a person reports on: the global ones plus their team's.
export async function metricsForTeam(teamId: number | null, onlyActive: boolean): Promise<MetricRow[]> {
  const { rows } = await pool.query<MetricRow>(
    `select id, key, name, formula_type, weight, cap, target, overtime_rate, unit, team_id, active
     from metrics
     where (team_id is null or team_id = $1) and ($2::boolean = false or active)
     order by (key = $3) desc, id`,
    [teamId, onlyActive, TIME_TRACKING_KEY],
  );
  return rows;
}

export async function getReport(userId: number, weekStart: string): Promise<ReportRow | null> {
  const { rows } = await pool.query<ReportRow>(
    "select * from weekly_reports where user_id=$1 and week_start=$2",
    [userId, weekStart],
  );
  return rows[0] ?? null;
}

export async function dailyMap(userId: number, days: string[]): Promise<DailyMap> {
  const { rows } = await pool.query<{ metric_id: number; entry_date: string | Date; value: number }>(
    "select metric_id, entry_date, value from daily_entries where user_id=$1 and entry_date between $2 and $3",
    [userId, days[0], days[6]],
  );
  const out: DailyMap = {};
  for (const r of rows) (out[r.metric_id] ??= {})[dayKey(r.entry_date)] = Number(r.value);
  return out;
}

const dayKey = (v: string | Date) => (v instanceof Date ? isoDate(v) : String(v).slice(0, 10));

/* Tracked hours per day: ManicTime active time, nothing else. Time logged by
   hand before ManicTime (time_logs) is no longer read; weeks scored from it
   were approved, and approved weeks keep their stored score. */
export async function timeHoursByDay(userId: number, days: string[]): Promise<number[]> {
  const { rows } = await pool.query<{ log_date: string | Date; active_minutes: number }>(
    "select log_date, active_minutes from manictime_days where user_id=$1 and log_date between $2 and $3",
    [userId, days[0], days[6]],
  );
  const by: Record<string, number> = {};
  for (const r of rows) by[dayKey(r.log_date)] = Number(r.active_minutes);
  return days.map((d) => Math.round(((by[d] ?? 0) / 60) * 100) / 100);
}

function applyTrackedTime(metrics: MetricRow[], daily: DailyMap, hoursByDay: number[], days: string[]) {
  for (const m of metrics) {
    if (!isTimeTracking(m)) continue;
    daily[m.id] = {};
    days.forEach((d, i) => {
      if (hoursByDay[i] > 0) daily[m.id][d] = hoursByDay[i];
    });
  }
}

export function finalScore(r: ReportRow): Score {
  const breakdown = r.breakdown ?? [];
  const metricBase = r2(breakdown.reduce((s, b) => s + Number(b.base), 0));
  const total = r.total ?? r2(metricBase + breakdown.reduce((s, b) => s + Number(b.bonus), 0) + Number(r.bonus));
  return {
    total,
    base: metricBase,
    bonus: r2(total - metricBase),
    achievement_pct: r.achievement_pct,
    breakdown,
  };
}

// Everything about one person's week. Approved weeks return the stored final score.
export async function weekSnapshot(user: { id: number; team_id: number | null }, weekStart: string) {
  const days = weekDays(weekStart);
  const [metrics, daily, report, hoursByDay] = await Promise.all([
    metricsForTeam(user.team_id, true),
    dailyMap(user.id, days),
    getReport(user.id, weekStart),
    timeHoursByDay(user.id, days),
  ]);
  applyTrackedTime(metrics, daily, hoursByDay, days);
  const live = computeScore(
    metrics,
    metrics.map((m) => ({
      metric_id: m.id,
      planned: Number(m.target),
      done: sumDaily(daily[m.id]),
      bonus: 0,
    })),
  );
  const score = report?.status === "approved" && report.breakdown ? finalScore(report) : live;
  const timeHours = hoursByDay.reduce((s, h) => s + h, 0);
  const hasData = timeHours > 0 || Object.values(daily).some((d) => Object.keys(d).length > 0);
  return {
    days,
    metrics,
    daily,
    report,
    live,
    score,
    hasData,
    time_hours: r2(timeHours),
    day_points: dayPoints(
      metrics.filter(isTimeTracking),
      daily,
      days,
    ),
  };
}

export const publicReport = (r: ReportRow | null) =>
  r && {
    id: r.id,
    status: r.status,
    summary: r.summary,
    submitted_at: r.submitted_at,
    reviewed_at: r.reviewed_at,
    review_comment: r.review_comment,
    bonus: r.bonus,
  };
