import ActiveTimeReport from "@/components/ActiveTimeReport";
import TimeAgo from "@/components/TimeAgo";
import TimeDetails from "@/components/TimeDetails";
import Timelines from "@/components/Timelines";
import WeekPicker from "@/components/WeekPicker";
import { tryFetch } from "@/lib/api";
import { weekParam } from "@/lib/dates";
import { hours } from "@/lib/format";
import type { TimeReport, TimeWeek } from "@/lib/types";

/* Time tracking, from ManicTime: the team's Active time report for the
   week, one day's timelines, and your own tags. */
export default async function TimePage({ searchParams }: { searchParams: Promise<{ week?: string; day?: string }> }) {
  const sp = await searchParams;
  const week = weekParam(sp.week);
  const wq = week ? `?week_start=${week}` : "";
  const rq = new URLSearchParams();
  if (week) rq.set("week_start", week);
  if (sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day)) rq.set("day", sp.day);

  const [mine, report] = await Promise.all([
    tryFetch<TimeWeek>(`/time${wq}`),
    tryFetch<TimeReport>(`/time-report${rq.size ? `?${rq}` : ""}`),
  ]);
  if (!mine.ok) return <div className="banner error">{mine.error}</div>;
  const d = mine.data;

  return (
    <>
      <div className="head">
        <div>
          <h1>Time tracking</h1>
          <p className="sub" style={{ margin: 0 }}>
            Active computer time from ManicTime.
            {d.manictime.linked && <> You: {hours(d.total_minutes)} this week, which the Time Tracking score uses.</>}
            {d.manictime.synced_at && (
              <>
                {" "}
                Synced <TimeAgo iso={d.manictime.synced_at} />.
              </>
            )}
          </p>
        </div>
        <WeekPicker base="/time" weekStart={d.week_start} weekEnd={d.week_end} today={d.today} />
      </div>

      {!d.manictime.configured ? (
        <div className="banner note">
          ManicTime isn&apos;t connected yet, so no time is coming in. An admin can connect it on Admin → ManicTime.
        </div>
      ) : !d.manictime.linked ? (
        <div className="banner note">
          Your account isn&apos;t linked to a ManicTime user yet, so your time isn&apos;t imported. Ask an admin to link
          you on Admin → ManicTime.
        </div>
      ) : null}

      {!report.ok ? (
        <div className="banner error">{report.error}</div>
      ) : (
        <>
          <h2>Active time</h2>
          <p className="muted small tr-note">
            Averages are per day each person was active. Away is the time between their first and last activity that
            wasn&apos;t active; an interruption is each time activity stopped and started again.
          </p>
          <ActiveTimeReport data={report.data} />

          <h2>Timelines</h2>
          <p className="muted small tr-note">Each person&apos;s day in their own local time. Hover a bar for its times.</p>
          <Timelines data={report.data} />
        </>
      )}

      {d.manictime.linked && (
        <>
          <h2>Your tags</h2>
          <TimeDetails data={d} />
        </>
      )}
    </>
  );
}
