import Accordion from "@/components/Accordion";
import PointsChart from "@/components/PointsChart";
import QuerySelect from "@/components/QuerySelect";
import TeamAchievements from "@/components/TeamAchievements";
import TeamWeekTable from "@/components/TeamWeekTable";
import WeekPicker from "@/components/WeekPicker";
import { apiFetch, tryFetch } from "@/lib/api";
import { todayUtc, weekParam } from "@/lib/dates";
import type { Metric, Team, TeamWeekRow, User } from "@/lib/types";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; team?: string; weeks?: string }>;
}) {
  const sp = await searchParams;
  const week = weekParam(sp.week);
  const weeks = Math.min(Math.max(Number(sp.weeks) || 1, 1), 13);
  const me = await apiFetch<User>("/me");

  const teams = me.role === "admin" ? await apiFetch<Team[]>("/teams") : [];
  const teamId = me.role === "admin" && sp.team ? Number(sp.team) : undefined;
  const qs = [
    week ? `week_start=${week}` : "",
    teamId ? `team_id=${teamId}` : "",
    weeks > 1 ? `weeks=${weeks}` : "",
  ]
    .filter(Boolean)
    .join("&");
  /* The results table takes the metric list so a metric nobody has points for
     still gets a column; without it the columns come only from the rows. */
  const [res, mets] = await Promise.all([
    tryFetch<{ week_start: string; week_end: string; rows: TeamWeekRow[] }>(
      `/team-week${qs ? `?${qs}` : ""}`,
    ),
    tryFetch<Metric[]>("/metrics"),
  ]);

  if (!res.ok) return <div className="banner error">{res.error}</div>;

  const chartRows = res.data.rows.filter((r) => r.role !== "admin");

  const extra: Record<string, string> = {};
  if (sp.team) extra.team = sp.team;

  return (
    <>
      <div className="head">
        <div>
          <h1>Team</h1>
          <p className="sub" style={{ margin: 0 }}>
            People waiting for review this week. Open a name for the daily form and trend.
          </p>
        </div>
        <WeekPicker
          base="/team"
          weekStart={res.data.week_start}
          weekEnd={res.data.week_end}
          today={todayUtc()}
          weeks={weeks}
          extra={extra}
          trailing={
            <>
              {me.role === "admin" && (
                <QuerySelect
                  base="/team"
                  name="team"
                  label="Team"
                  value={sp.team ?? ""}
                  extra={week ? { week } : {}}
                  options={[
                    { value: "", label: "All teams" },
                    ...teams.map((t) => ({ value: String(t.id), label: t.name })),
                  ]}
                />
              )}
              {me.role !== "member" && (
                <a className="chip" href={`/api/proxy/export.csv?${qs || `week_start=${res.data.week_start}`}`}>
                  CSV
                </a>
              )}
            </>
          }
        />
      </div>

      <TeamAchievements me={me} weekStart={res.data.week_start} rows={res.data.rows} />

      {/* Moved here from the Dashboard: it compares people, which is what
          this page is for. Admins do not report a week, so they are left out
          of the chart exactly as they were there. */}
      <div style={{ marginTop: 12 }}>
        {chartRows.length === 0 ? (
          <Accordion title="Everyone's points">
            <div className="empty">No people to chart yet this week.</div>
          </Accordion>
        ) : (
          <PointsChart rows={chartRows} meId={me.id} week={res.data.week_start} />
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <Accordion title="Team results">
          <TeamWeekTable
            me={me}
            weekStart={res.data.week_start}
            rows={res.data.rows}
            metrics={mets.ok ? mets.data : undefined}
          />
        </Accordion>
      </div>
    </>
  );
}
