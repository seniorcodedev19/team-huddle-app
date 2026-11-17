import { hrs } from "@/lib/timeReport";
import type { TimeReport, TimeReportPerson } from "@/lib/types";
import ActiveByTimeChart from "./ActiveByTimeChart";
import PersonCell from "./PersonCell";
import { Tile } from "./StatTiles";

const avg = (total: number, days: number) => (days ? total / days : 0);
const pctActive = (active: number, away: number) =>
  active + away > 0 ? Math.round((active / (active + away)) * 100) : null;
const one = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

/* ManicTime's Active time report for the week: averages per day each person
   was active, the team's typical day, and a row per person. */
export default function ActiveTimeReport({ data }: { data: TimeReport }) {
  const active = data.people.filter((p) => p.days > 0);
  const sum = (f: (p: TimeReportPerson) => number) => active.reduce((s, p) => s + f(p), 0);
  const personDays = sum((p) => p.days);
  const totalActive = sum((p) => p.active_sec);
  const totalAway = sum((p) => p.away_sec);
  const pct = pctActive(totalActive, totalAway);
  const dash = "–";

  // Most active first, as ManicTime sorts it; people with no time last.
  const rows = [...data.people].sort(
    (a, b) => avg(b.active_sec, b.days) - avg(a.active_sec, a.days) || a.name.localeCompare(b.name),
  );

  return (
    <div className="stack">
      <div className="tiles tr-tiles">
        <Tile label="Avg. active a day" value={personDays ? hrs(totalActive / personDays) : dash} icon="clock" />
        <Tile
          label="Avg. away a day"
          value={personDays ? hrs(totalAway / personDays) : dash}
          icon="pause"
          tone="violet"
        />
        <Tile
          label="Avg. interruptions a day"
          value={personDays ? one(sum((p) => p.interruptions) / personDays) : dash}
          icon="split"
        />
        <Tile label="Percent active" value={pct === null ? dash : `${pct}%`} icon="target" meter={pct ?? 0} />
      </div>

      <div className="panel">
        <h3 className="tr-title">Avg. people active by time of day</h3>
        {personDays ? (
          <ActiveByTimeChart values={data.by_time} />
        ) : (
          <div className="empty">No active time this week yet.</div>
        )}
      </div>

      <div className="panel tablewrap">
        <table className="tr-table">
          <thead>
            <tr>
              <th>Person</th>
              <th className="n">Avg. active</th>
              <th className="n">Avg. interruptions</th>
              <th className="n">Avg. away</th>
              <th className="n">Total active</th>
              <th className="n">Total away</th>
              <th>Percent active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const share = pctActive(p.active_sec, p.away_sec);
              const has = p.days > 0;
              return (
                <tr key={p.user_id}>
                  <td>
                    <PersonCell
                      name={p.name}
                      email={p.email}
                      avatar={p.avatar}
                      href={`/team/${p.user_id}?week=${data.week_start}`}
                      sub={
                        !p.linked
                          ? "Not linked to ManicTime"
                          : has
                            ? `${p.days} ${p.days === 1 ? "day" : "days"} active`
                            : undefined
                      }
                    />
                  </td>
                  <td className="n">{has ? hrs(avg(p.active_sec, p.days)) : dash}</td>
                  <td className="n">{has ? one(avg(p.interruptions, p.days)) : dash}</td>
                  <td className="n">{has ? hrs(avg(p.away_sec, p.days)) : dash}</td>
                  <td className="n">{has ? hrs(p.active_sec) : dash}</td>
                  <td className="n">{has ? hrs(p.away_sec) : dash}</td>
                  <td>
                    {share === null ? (
                      dash
                    ) : (
                      <span className="tr-share">
                        <span className="tr-meter" aria-hidden>
                          <span style={{ width: `${share}%` }} />
                        </span>
                        <span className="tr-share-n">{share}%</span>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
