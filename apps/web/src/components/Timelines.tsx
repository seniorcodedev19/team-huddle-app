import Link from "next/link";
import { dayMonth, shortDay } from "@/lib/dates";
import { clock, coveredSec, duration, hrs } from "@/lib/timeReport";
import type { TimeReport, TimelineSpan } from "@/lib/types";

const HOUR = 3600;
const KIND_LABEL: Record<TimelineSpan["kind"], string> = {
  active: "Active",
  away: "Away",
  tag: "Tag",
  autotag: "AutoTag",
};

/* ManicTime's Team → Timelines for one day: per person, their tags and
   each computer's usage, Active and Away, on an axis that covers their day.
   Locked and powered-off time is left blank, as ManicTime does. */
export default function Timelines({ data }: { data: TimeReport }) {
  const shown = new Set(data.timeline.map((t) => t.user_id));
  const idle = data.people.filter((p) => p.linked && !shown.has(p.user_id)).map((p) => p.name);

  return (
    <div className="stack">
      <div className="tl-bar">
        <nav className="tl-days" aria-label="Day">
          {data.days.map((d) => (
            <Link
              key={d}
              href={`/time?week=${data.week_start}&day=${d}`}
              scroll={false}
              className={`tl-day${d === data.day ? " on" : ""}${data.active_days.includes(d) ? "" : " quiet"}`}
              aria-current={d === data.day ? "date" : undefined}
            >
              <span>{shortDay(d)}</span>
              <small>{dayMonth(d)}</small>
            </Link>
          ))}
        </nav>
        <div className="tl-legend" aria-label="Legend">
          {(["active", "away", "tag", "autotag"] as const).map((k) => (
            <span key={k}>
              <i className={`tl-key tl-${k}`} aria-hidden />
              {KIND_LABEL[k]}
            </span>
          ))}
        </div>
      </div>

      {data.timeline.length === 0 ? (
        <div className="panel">
          <div className="empty">No ManicTime activity on {dayMonth(data.day)}.</div>
        </div>
      ) : (
        data.timeline.map((t) => <PersonTimeline key={t.user_id} name={t.name} spans={t.spans} />)
      )}

      {idle.length > 0 && data.timeline.length > 0 && (
        <p className="muted small" style={{ margin: 0 }}>
          No activity on {dayMonth(data.day)}: {idle.join(", ")}.
        </p>
      )}
    </div>
  );
}

function PersonTimeline({ name, spans }: { name: string; spans: TimelineSpan[] }) {
  const active = spans.filter((s) => s.kind === "active");
  const first = Math.min(...spans.map((s) => s.start));
  const last = Math.max(...spans.map((s) => s.end));

  // The axis covers their day in whole hours, at least two.
  let lo = Math.floor(first / HOUR) * HOUR;
  let hi = Math.ceil(last / HOUR) * HOUR;
  if (hi - lo < 2 * HOUR) {
    hi = Math.min(24 * HOUR, lo + 2 * HOUR);
    lo = hi - 2 * HOUR;
  }
  const step = [HOUR / 2, HOUR, 2 * HOUR, 3 * HOUR].find((s) => (hi - lo) / s <= 9) ?? 3 * HOUR;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  const x = (sec: number) => ((sec - lo) / (hi - lo)) * 100;

  const devices = [...new Set(spans.filter((s) => s.device).map((s) => s.device))].sort();
  const tags = spans.filter((s) => s.kind === "tag");
  const autotags = spans.filter((s) => s.kind === "autotag");
  const activeFirst = active.length ? Math.min(...active.map((s) => s.start)) : null;
  const activeLast = active.length ? Math.max(...active.map((s) => s.end)) : null;

  const lane = (label: string, items: TimelineSpan[], aria: string) => (
    <div className="tl-lane">
      <span className="tl-label">{label}</span>
      <div className="tl-track" role="img" aria-label={aria}>
        {ticks.map((t) => (
          <span key={t} className="tl-grid" style={{ left: `${x(t)}%` }} />
        ))}
        {items.map((s, i) => (
          <span
            key={i}
            className={`tl-seg tl-${s.kind}`}
            style={{ left: `${x(s.start)}%`, width: `${x(s.end) - x(s.start)}%` }}
            title={`${s.label || KIND_LABEL[s.kind]} · ${clock(s.start)} – ${clock(s.end)} · ${duration(s.end - s.start)}`}
          />
        ))}
      </div>
    </div>
  );

  const tagSummary = (items: TimelineSpan[]) =>
    [...new Set(items.map((s) => s.label))].map((l) => `${l} ${duration(coveredSec(items.filter((s) => s.label === l)))}`).join(", ");

  return (
    <section className="panel tl-person" aria-label={`${name}'s timeline`}>
      <div className="tl-head">
        <strong>{name}</strong>
        <span className="muted small">
          {active.length
            ? `${hrs(coveredSec(active))} active · ${clock(activeFirst!)} – ${clock(activeLast!)}`
            : "No computer activity"}
        </span>
      </div>

      <div className="tl-lane tl-axis" aria-hidden>
        <span className="tl-label" />
        <div className="tl-track">
          {ticks.map((t) => (
            <span key={t} className="tl-tick" style={{ left: `${x(t)}%` }}>
              {clock(t)}
            </span>
          ))}
        </div>
      </div>

      {(tags.length > 0 || autotags.length > 0) && (
        <div className="tl-group">
          <div className="tl-group-name">Tags</div>
          {tags.length > 0 && lane("Tags", tags, `Tags: ${tagSummary(tags)}`)}
          {autotags.length > 0 && lane("AutoTags", autotags, `AutoTags: ${tagSummary(autotags)}`)}
        </div>
      )}

      {devices.map((d) => {
        const mine = spans.filter((s) => s.device === d);
        const on = mine.filter((s) => s.kind === "active");
        const off = mine.filter((s) => s.kind === "away");
        return (
          <div className="tl-group" key={d}>
            <div className="tl-group-name">{d}</div>
            {lane(
              "Computer usage",
              mine,
              `Computer usage on ${d}: ${duration(coveredSec(on))} active, ${duration(coveredSec(off))} away`,
            )}
          </div>
        );
      })}
    </section>
  );
}
