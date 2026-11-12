import { weekStartOf } from "./dates";
import type { CardWorkMetric, ProfileWorkMetric, TeamProfile, WorkLog, WorkMetric } from "./types";

/* Daily work amounts: labels, periods and totals.

   Pure functions only — no clock, no fetching — so the dashboard can be
   reasoned about, and checked, without a browser. "Today" always comes in
   as an argument, from the API. */

/** Typed per profile, on the profile's panel. */
export const JOB_WORK: ProfileWorkMetric[] = ["apply", "interview_scheduled", "interview_done"];
/** Typed per board card, on the card's panel. */
export const AI_WORK: CardWorkMetric[] = ["ai_apply", "ai_interview", "assessment"];

export const WORK_LABEL: Record<WorkMetric, string> = {
  apply: "Applications",
  interview_scheduled: "Interviews scheduled",
  interview_done: "Interviews done",
  ai_apply: "Applications",
  ai_interview: "AI interviews",
  assessment: "Assessments",
};

export type Period = "today" | "week" | "month";
export const PERIOD_LABEL: Record<Period, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
};

/** The first day a period covers. It always ends today. Weeks start on Sunday. */
export function periodStart(today: string, period: Period): string {
  if (period === "today") return today;
  if (period === "week") return weekStartOf(today);
  return `${today.slice(0, 7)}-01`;
}

/** The earliest day any period needs, so one fetch serves all three. */
export function rangeStart(today: string): string {
  const week = periodStart(today, "week");
  const month = periodStart(today, "month");
  // A week can begin in the previous month.
  return week < month ? week : month;
}

export type GroupBy = "profile" | "assignee";
export type Entity = { id: number; name: string };

/** The id used for work on a profile nobody is assigned to. */
export const UNASSIGNED = 0;

/* Who the bars are: the given profiles, or the people they are assigned to.

   Assignee credit follows the profile's CURRENT assignee — the numbers are
   recorded against the profile, so reassigning a profile moves its history
   to the new person. */
export function entitiesFor(profiles: TeamProfile[], group: GroupBy): Entity[] {
  if (group === "profile") return profiles.map((p) => ({ id: p.id, name: p.full_name }));
  const seen = new Map<number, string>();
  let unassigned = false;
  for (const p of profiles) {
    if (p.assignees.length === 0) unassigned = true;
    for (const a of p.assignees) seen.set(a.user_id, a.name);
  }
  const out = [...seen].map(([id, name]) => ({ id, name }));
  if (unassigned) out.push({ id: UNASSIGNED, name: "Unassigned" });
  return out;
}

/* Every metric's total over [from, today], per entity.
   Only the given profiles count, so the Job chart ignores profiles that are
   not used for jobs, and the AI chart those not used for AI training. */
export function totalsFor(
  logs: WorkLog[],
  profiles: TeamProfile[],
  group: GroupBy,
  metrics: WorkMetric[],
  from: string,
  today: string,
): Map<number, Record<string, number>> {
  const owners = new Map(
    profiles.map((p) => [
      p.id,
      group === "profile" ? [p.id] : p.assignees.length ? p.assignees.map((a) => a.user_id) : [UNASSIGNED],
    ]),
  );
  const wanted = new Set<string>(metrics);
  const out = new Map<number, Record<string, number>>();
  for (const l of logs) {
    if (!wanted.has(l.metric) || l.log_date < from || l.log_date > today) continue;
    for (const owner of owners.get(l.profile_id) ?? []) {
      const row = out.get(owner) ?? {};
      row[l.metric] = (row[l.metric] ?? 0) + l.value;
      out.set(owner, row);
    }
  }
  return out;
}

/** A y-axis top that is a round, even number at or above the largest value. */
export function niceMax(max: number): number {
  if (max <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(max));
  const top = [1, 2, 4, 5, 10].map((s) => s * pow).find((v) => v >= max) ?? 10 * pow;
  // Even, so the midpoint gridline is a whole number: these are counts.
  return top % 2 ? top + 1 : top;
}
