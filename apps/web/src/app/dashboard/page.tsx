import Accordion from "@/components/Accordion";
import Breakdown from "@/components/Breakdown";
import StatTiles from "@/components/StatTiles";
import StatusPill from "@/components/StatusPill";
import TeamTiles from "@/components/TeamTiles";
import { TeamDailyDonut } from "@/components/TeamOverview";
import WorkInterviews from "@/components/WorkInterviews";
import TodayInterviews from "@/components/TodayInterviews";
import TrainingSummary from "@/components/TrainingSummary";
import WeekGrid from "@/components/WeekGrid";
import WeekPicker from "@/components/WeekPicker";
import WorkCharts from "@/components/WorkCharts";
import { apiFetch, tryFetch } from "@/lib/api";
import { addDays, weekParam } from "@/lib/dates";
import type { Interview, TeamProfile, TeamWeekRow, TrainingMatrix, User, WeekData, WorkRange } from "@/lib/types";
import { rangeStart } from "@/lib/work";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; weeks?: string }>;
}) {
  const sp = await searchParams;
  const week = weekParam(sp.week);
  /* How many weeks the view covers, ending at the selected one. The API caps
     it at 13; anything else falls back to a single week. */
  const weeks = Math.min(Math.max(Number(sp.weeks) || 1, 1), 13);
  const q = new URLSearchParams();
  if (week) q.set("week_start", week);
  if (weeks > 1) q.set("weeks", String(weeks));
  const wq = q.toString() ? `?${q}` : "";
  const me = await apiFetch<User>("/me");
  const manager = me.role !== "member";

  const [data, team, profs, matrix] = await Promise.all([
    tryFetch<WeekData>(`/week${wq}`),
    tryFetch<{ rows: TeamWeekRow[] }>(`/team-week${wq}`),
    tryFetch<TeamProfile[]>("/profiles"),
    tryFetch<TrainingMatrix>("/training-matrix"),
  ]);

  if (!data.ok) return <div className="banner error">{data.error}</div>;
  const d = data.data;
  const rows = team.ok ? team.data.rows.filter((r) => r.role !== "admin") : [];

  /* A day either side of the API's today, so whichever day it is in the
     reader's own zone falls inside the window; TodayInterviews narrows it to
     their real local day once it knows the browser's zone. Taken from the
     API's date rather than the clock, so rendering stays pure. */
  const from = `${addDays(d.today, -1)}T00:00:00.000Z`;
  const to = `${addDays(d.today, 2)}T00:00:00.000Z`;

  /* The weeks the picker shows, as plain days, for the interviews panel.
     Daily work has no time of day, so there is no time zone to allow for. */
  const weekFrom = addDays(d.week_start, -7 * (weeks - 1));

  /* The period before this one, only to show the change on the team tiles.
     It has to be the same length, or the comparison is meaningless. */
  const prevQs = new URLSearchParams({ week_start: addDays(d.week_start, -7 * weeks) });
  if (weeks > 1) prevQs.set("weeks", String(weeks));

  // Last period, only to show the change on the team tiles.
  /* Daily work has its own periods (today, this week, this month), not the
     week picker's: one read covers all three, always ending today. */
  const [prev, todays, weekWork, work] = await Promise.all([
    tryFetch<{ rows: TeamWeekRow[] }>(`/team-week?${prevQs}`),
    tryFetch<Interview[]>(`/interviews?from=${from}&to=${to}`),
    tryFetch<WorkRange>(`/work?from=${weekFrom}&to=${d.week_end}`),
    tryFetch<WorkRange>(`/work?from=${rangeStart(d.today)}&to=${d.today}`),
  ]);
  const prevRows = prev.ok ? prev.data.rows.filter((r) => r.role !== "admin") : null;

  return (
    <>
      <div className="head">
        <div>
          <h1>Dashboard</h1>
          <p className="sub" style={{ margin: 0 }}>
            Team points and weekly results.
          </p>
        </div>
        <WeekPicker
          base="/dashboard"
          weekStart={d.week_start}
          weekEnd={d.week_end}
          today={d.today}
          weeks={weeks}
          trailing={
            manager ? (
              <a
                className="chip"
                href={`/api/proxy/export.csv?week_start=${d.week_start}${weeks > 1 ? `&weeks=${weeks}` : ""}`}
              >
                CSV
              </a>
            ) : null
          }
        />
      </div>

      <TodayInterviews interviews={todays.ok ? todays.data : []} />

      {rows.length > 0 ? <TeamTiles rows={rows} prevRows={prevRows} /> : null}
      {me.role !== "admin" ? <StatTiles data={d} /> : null}

      {rows.length > 0 ? (
        <div className="two" style={{ marginBottom: 12 }}>
          <div className="panel">
            <h2 className="panel-title">Interviews</h2>
            {weekWork.ok ? (
              <WorkInterviews rows={weekWork.data.rows} />
            ) : (
              <div className="banner error">{weekWork.error}</div>
            )}
          </div>
          <div className="panel">
            <h2 className="panel-title">Team daily score</h2>
            <TeamDailyDonut rows={rows} days={d.days} />
          </div>
        </div>
      ) : null}

      {profs.ok && matrix.ok ? (
        <div style={{ marginBottom: 12 }}>
          <TrainingSummary profiles={profs.data} matrix={matrix.data} />
        </div>
      ) : null}

      <div style={{ marginBottom: 12 }}>
        {!work.ok ? (
          <div className="panel">
            <h2 className="panel-title">Daily work</h2>
            <div className="banner error">{work.error}</div>
          </div>
        ) : profs.ok ? (
          <WorkCharts profiles={profs.data} data={work.data} />
        ) : null}
      </div>

      {me.role !== "admin" && (
        <div style={{ marginBottom: 12 }}>
          <Accordion title="My week">
            <div className="row" style={{ marginBottom: 12 }}>
              <StatusPill status={d.status} />
            </div>
            {d.metrics.length === 0 ? (
              <div className="empty">
                <strong>No metrics to report on yet.</strong>
                <div>An admin adds the metrics your team reports on.</div>
              </div>
            ) : (
              <>
                <WeekGrid key={d.week_start} data={d} />
                <div style={{ marginTop: 16 }}>
                  <Breakdown score={d.score} />
                </div>
              </>
            )}
          </Accordion>
        </div>
      )}
    </>
  );
}
