"use client";

import { useEffect, useMemo, useState } from "react";
import { callJson } from "@/lib/client";
import { dayMonth } from "@/lib/dates";
import type { TeamProfile, WorkLog, WorkMetric, WorkRange } from "@/lib/types";
import {
  AI_WORK,
  JOB_WORK,
  PERIOD_LABEL,
  WORK_LABEL,
  entitiesFor,
  periodStart,
  totalsFor,
  type GroupBy,
  type Period,
} from "@/lib/work";
import Dropdown from "./Dropdown";
import WorkBars, { type BarMetric } from "./WorkBars";

/* The three amounts each chart shows, in the same three series colours, so
   the first bar of every group is always the application count. */
const COLORS = ["var(--s0)", "var(--s1)", "var(--s2)"];
const asBars = (metrics: WorkMetric[]): BarMetric[] =>
  metrics.map((m, i) => ({ key: m, label: WORK_LABEL[m], color: COLORS[i] }));

/* Daily work on the dashboard: how much each profile or person did, for job
   hunting and for AI training, over today, this week, this month or any
   range of days.

   Read-only: the numbers are typed on the profile's panel (job) and on the
   board card's panel (AI training). One row of controls scopes both charts,
   so they always describe the same people over the same days. */
export default function WorkCharts({ profiles, data }: { profiles: TeamProfile[]; data: WorkRange }) {
  const today = data.today;
  const [group, setGroup] = useState<GroupBy>("assignee");
  /* The range is always two dates. The preset buttons only fill them in, and
     a preset shows as selected while the dates still match it. */
  const [{ from, to }, setRange] = useState({ from: today, to: today });
  const presets = (["today", "week", "month"] as Period[]).map((p) => ({
    p,
    on: to === today && from === periodStart(today, p),
  }));

  /* The page arrives with this month and this week already loaded. A custom
     range inside that needs nothing more; one reaching further back fetches
     its own days. */
  const covered = from >= data.from && to <= data.to;
  const key = `${from}:${to}`;
  const [fetched, setFetched] = useState<{ key: string; rows: WorkLog[] } | null>(null);
  const [failed, setFailed] = useState<{ key: string; error: string } | null>(null);

  useEffect(() => {
    if (covered) return;
    const ac = new AbortController();
    callJson<WorkRange>("GET", `/work?from=${from}&to=${to}`, undefined, ac.signal)
      .then((r) => setFetched({ key, rows: r.rows }))
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setFailed({ key, error: e instanceof Error ? e.message : "Couldn't load that range" });
      });
    return () => ac.abort();
  }, [covered, from, to, key]);

  /* While a new range loads, the charts keep their last picture, dimmed,
     rather than blanking: the totals are only filtered to the new days once
     those days have arrived. */
  const pending = !covered && fetched?.key !== key && failed?.key !== key;
  const logs = covered ? data.rows : fetched?.rows ?? data.rows;
  const error = !covered && failed?.key === key ? failed.error : null;

  const preset = presets.find((x) => x.on)?.p;
  const rangeText = preset
    ? PERIOD_LABEL[preset].toLowerCase()
    : from === to
      ? dayMonth(from)
      : `${dayMonth(from)} to ${dayMonth(to)}`;

  return (
    <section className="work-charts">
      <div className="work-bar">
        <h2 className="work-title">Daily work</h2>
        <Dropdown<GroupBy>
          ariaLabel="Show by"
          value={group}
          onChange={setGroup}
          options={[
            { value: "assignee", label: "By assignee" },
            { value: "profile", label: "By profile" },
          ]}
        />
        <div className="work-range">
          <input
            type="date"
            className="work-date"
            aria-label="From"
            value={from}
            max={today}
            onChange={(e) => {
              const v = e.target.value;
              if (!v || v > today) return;
              // Moving the start past the end drags the end along with it.
              setRange((r) => ({ from: v, to: r.to < v ? v : r.to }));
            }}
          />
          <span className="muted small">to</span>
          <input
            type="date"
            className="work-date"
            aria-label="To"
            value={to}
            max={today}
            onChange={(e) => {
              const v = e.target.value;
              if (!v || v > today) return;
              setRange((r) => ({ from: r.from > v ? v : r.from, to: v }));
            }}
          />
        </div>
        <div className="viewswitch" role="group" aria-label="Quick ranges">
          {presets.map(({ p, on }) => (
            <button
              key={p}
              type="button"
              className={on ? "on" : ""}
              aria-pressed={on}
              onClick={() => setRange({ from: periodStart(today, p), to: today })}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      <div className={`work-panels${pending ? " pending" : ""}`} aria-busy={pending}>
        <WorkPanel
          title="Job"
          hint="Entered on each profile, in the Profiles page."
          profiles={profiles}
          metrics={JOB_WORK}
          logs={logs}
          group={group}
          from={from}
          to={to}
          rangeText={rangeText}
        />
        <WorkPanel
          title="AI training"
          hint="Entered on each card, in the AI Training board."
          profiles={profiles}
          metrics={AI_WORK}
          logs={logs}
          group={group}
          from={from}
          to={to}
          rangeText={rangeText}
        />
      </div>
    </section>
  );
}

function WorkPanel({
  title,
  hint,
  profiles,
  metrics,
  logs,
  group,
  from,
  to,
  rangeText,
}: {
  title: string;
  hint: string;
  profiles: TeamProfile[];
  metrics: WorkMetric[];
  logs: WorkLog[];
  group: GroupBy;
  from: string;
  to: string;
  rangeText: string;
}) {
  /* The profiles used for this purpose, plus any other that has these
     numbers in the range: work that was recorded happened, even on a
     profile whose purpose has since changed, and the chart must agree with
     the Interviews panel, which counts every profile. */
  const relevant = useMemo(() => {
    const wanted = new Set<string>(metrics);
    const withNumbers = new Set(
      logs.filter((l) => wanted.has(l.metric) && l.log_date >= from && l.log_date <= to).map((l) => l.profile_id),
    );
    return profiles.filter((p) => withNumbers.has(p.id) || (title === "Job" ? p.for_job : p.for_ai_training));
  }, [profiles, logs, metrics, from, to, title]);

  const values = useMemo(
    () => totalsFor(logs, relevant, group, metrics, from, to),
    [logs, relevant, group, metrics, from, to],
  );
  /* Busiest first, so the people doing the most are on the left; names
     break ties so the order is stable. Everyone stays on the chart, including
     those with nothing recorded — that is worth seeing too. */
  const entities = useMemo(() => {
    const total = (id: number) => Object.values(values.get(id) ?? {}).reduce((a, b) => a + b, 0);
    return entitiesFor(relevant, group).sort((a, b) => total(b.id) - total(a.id) || a.name.localeCompare(b.name));
  }, [relevant, group, values]);

  const sums = metrics.map((m) => entities.reduce((a, e) => a + (values.get(e.id)?.[m] ?? 0), 0));

  return (
    <div className="panel work">
      <div className="work-panel-head">
        <h3 className="panel-title" style={{ margin: 0 }}>
          {title}
        </h3>
        {/* The range's totals in words, so the headline numbers do not
            depend on reading bar heights. */}
        <p className="muted small" style={{ margin: 0 }}>
          {/* Lowercased for the sentence, except an acronym like "AI". */}
          {metrics.map((m, i) => `${sums[i]} ${WORK_LABEL[m].replace(/^(?!AI)\w/, (c) => c.toLowerCase())}`).join(" · ")}
        </p>
      </div>
      {entities.length === 0 ? (
        <div className="empty">No profiles are used for {title.toLowerCase()} yet.</div>
      ) : (
        <WorkBars
          entities={entities}
          metrics={asBars(metrics)}
          values={values}
          label={`${title}: ${metrics.map((m) => WORK_LABEL[m]).join(", ")} by ${group}, ${rangeText}`}
        />
      )}
      <p className="muted small" style={{ margin: 0 }}>
        {hint}
      </p>
    </div>
  );
}
