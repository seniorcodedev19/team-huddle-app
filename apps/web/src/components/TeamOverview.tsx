import DonutChart, { type Slice } from "./DonutChart";
import { shortDay } from "@/lib/dates";
import { fmt } from "@/lib/format";
import type { Interview, TeamWeekRow } from "@/lib/types";

const r1 = (n: number) => Math.round(n * 10) / 10;

/* How the week's interviews turned out, counted off the calendar.

   'done' means held but with no outcome recorded yet, so it is its own slice
   rather than being folded into passed or failed — see migration 022. */
export function TeamInterviewDonut({ interviews }: { interviews: Interview[] }) {
  const count = (s: Interview["status"]) => interviews.filter((i) => i.status === s).length;
  const scheduled = count("scheduled");
  const done = count("done");
  const passed = count("passed");
  const failed = count("failed");
  const cancelled = count("cancelled");

  const slices: Slice[] = [
    { label: "Passed", value: passed, tone: 5 },
    { label: "Failed", value: failed, tone: 4 },
    { label: "Scheduled", value: scheduled, tone: 2 },
    { label: "Awaiting outcome", value: done, tone: 0 },
    { label: "Cancelled", value: cancelled, tone: 1 },
  ].filter((x) => x.value > 0);

  if (interviews.length === 0) {
    return <div className="empty">No interviews booked this week.</div>;
  }

  /* Of the interviews that actually reached a verdict. Scheduled ones have no
     result yet and cancelled ones never will, so neither belongs in the rate. */
  const decided = passed + failed;
  const rate = decided ? r1((passed / decided) * 100) : null;

  return (
    <DonutChart
      slices={slices}
      centerValue={rate === null ? String(interviews.length) : `${rate}%`}
      centerLabel={rate === null ? "booked" : "passed"}
      legendUnit=""
      label="Interview outcomes this week"
    />
  );
}

/* Where the team stands this week, by report status. */
export function TeamStatusDonut({ rows }: { rows: TeamWeekRow[] }) {
  const approved = rows.filter((r) => r.status === "approved").length;
  const submitted = rows.filter((r) => r.status === "submitted").length;
  const returned = rows.filter((r) => r.status === "returned").length;
  const draft = rows.filter((r) => r.status === "draft").length;

  const slices: Slice[] = [
    { label: "Approved", value: approved, tone: 5 },
    { label: "In review", value: submitted, tone: 2 },
    { label: "Returned", value: returned, tone: 4 },
    { label: "In progress", value: draft, tone: 0 },
  ].filter((s) => s.value > 0);

  const pcts = rows.map((r) => r.achievement_pct).filter((p): p is number => p !== null);
  const avgPct = pcts.length ? r1(pcts.reduce((s, p) => s + p, 0) / pcts.length) : null;

  if (rows.length === 0) return <div className="empty">No people on the team yet.</div>;

  return (
    <DonutChart
      slices={slices.length ? slices : [{ label: "In progress", value: rows.length, tone: 0 }]}
      centerValue={avgPct === null ? "—" : `${avgPct}%`}
      centerLabel="achieved"
      legendUnit=""
      label="Team report status this week"
    />
  );
}

/* The team's points per day across the week, same donut treatment. */
export function TeamDailyDonut({ rows, days }: { rows: TeamWeekRow[]; days: string[] }) {
  const perDay = days.map((_, i) => r1(rows.reduce((s, r) => s + (r.day_points?.[i] ?? 0), 0)));
  const total = r1(perDay.reduce((s, v) => s + v, 0));

  const slices: Slice[] = days
    .map((d, i) => ({ label: shortDay(d), value: perDay[i], tone: i % 6 }))
    .filter((s) => s.value > 0);

  if (total <= 0) {
    return <div className="empty">No points logged yet this week.</div>;
  }

  return (
    <DonutChart
      slices={slices}
      centerValue={fmt(total)}
      centerLabel="points"
      label="Team points earned each day this week"
    />
  );
}
