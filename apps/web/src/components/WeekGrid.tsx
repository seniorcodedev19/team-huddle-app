"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useAction } from "@/lib/client";
import { weekStartOf } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { isTimeTracking, type Metric, type WeekData } from "@/lib/types";
import ConfirmDialog from "./ConfirmDialog";
import { WeekSelect } from "./WeekPicker";

function weekTotal(data: WeekData, m: Metric) {
  if (isTimeTracking(m)) return data.time_hours ?? 0;
  return Object.values(data.daily[m.id] ?? {}).reduce((s, v) => s + Number(v), 0);
}

// One weekly value per metric. Time Tracking hours come from the Time page.
export default function WeekGrid({ data }: { data: WeekData }) {
  const save = useAction();
  const submit = useAction();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const thisWeek = weekStartOf(data.today);

  function goToWeek(start: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (start === thisWeek) p.delete("week");
    else p.set("week", start);
    const q = p.toString();
    router.push(q ? `${pathname}?${q}` : pathname);
  }
  /* Fields still empty for an open week start from the daily work typed on
     this person's profiles. Anything already entered is left as it is. The
     filled numbers are not saved until the week is saved or submitted. */
  const [autoFilled] = useState<Set<number>>(
    () =>
      new Set(
        data.metrics
          .filter((m) => !isTimeTracking(m) && !weekTotal(data, m) && (data.work_fill?.[m.id] ?? 0) > 0)
          .map((m) => m.id),
      ),
  );
  const [vals, setVals] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      data.metrics
        .filter((m) => !isTimeTracking(m))
        .map((m) => [m.id, String((autoFilled.has(m.id) ? data.work_fill?.[m.id] : weekTotal(data, m)) || "")]),
    ),
  );
  // Fields the person has since changed, so they stop claiming to be filled in.
  const [touched, setTouched] = useState<Set<number>>(() => new Set());
  const [summary, setSummary] = useState(data.report?.summary ?? "");
  const [confirmSubmit, setConfirmSubmit] = useState(false);

  if (data.metrics.length === 0) {
    return (
      <div className="panel empty">
        <strong>No metrics to report on yet.</strong>
        <div>Your manager adds them on this page. If you aren&apos;t on a team yet, ask an admin to add you.</div>
      </div>
    );
  }

  const entries = data.metrics
    .filter((m) => !isTimeTracking(m))
    .map((m) => {
      const raw = vals[m.id]?.trim() ?? "";
      return { metric_id: m.id, value: raw === "" ? null : Number(raw) };
    });
  const invalid = entries.some((e) => e.value !== null && (Number.isNaN(e.value) || e.value < 0));

  async function saveNumbers() {
    if (invalid) {
      save.setError("Enter a number of 0 or more for each metric.");
      return false;
    }
    return save.run("PUT", "/weekly", { week_start: data.week_start, entries });
  }

  return (
    <div className="panel">
      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <div className="head" style={{ marginBottom: 12, alignItems: "center" }}>
          <legend style={{ padding: 0, margin: 0, fontWeight: 600 }}>Weekly results</legend>
          <div className="filters">
            <WeekSelect id="report-week" label="Reporting week" value={data.week_start} today={data.today} onChange={goToWeek} />
          </div>
        </div>
        <div className="stack">
          {data.metrics.map((m) => {
            const tracking = isTimeTracking(m);
            const done = tracking ? data.time_hours ?? 0 : Number(vals[m.id]) || 0;
            return (
              <div className="row" key={m.id} style={{ alignItems: "end" }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <label htmlFor={tracking ? undefined : `m-${m.id}`}>{m.name}</label>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {tracking
                      ? `Logged on Time tracking · target ${fmt(m.target)} ${m.unit || "hours"}`
                      : m.formula_type === "overtime"
                        ? `Weekly total · target ${fmt(m.target)} ${m.unit || "units"} · extra × overtime bonus`
                        : m.formula_type === "ratio"
                          ? `Weekly total · target ${fmt(m.target)} ${m.unit || "units"}`
                          : `Weekly total · ${m.unit || "units"}`}
                  </div>
                </div>
                {tracking ? (
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt(done)}</div>
                    {data.editable && (
                      <div>
                        <Link href="/time">Log time</Link>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <input
                      id={`m-${m.id}`}
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      value={vals[m.id] ?? ""}
                      disabled={!data.editable}
                      onChange={(e) => {
                        setVals((v) => ({ ...v, [m.id]: e.target.value }));
                        setTouched((t) => new Set(t).add(m.id));
                      }}
                    />
                    {autoFilled.has(m.id) && !touched.has(m.id) && (
                      <div className="muted small" style={{ marginTop: 3 }}>
                        From daily work · not saved yet
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

      <div className="stack" style={{ marginTop: 16 }}>
        {data.status === "returned" && data.report?.review_comment && (
          <div className="banner note">
            <strong>Your manager returned this week:</strong> {data.report.review_comment}
          </div>
        )}
        {data.status === "submitted" && (
          <div className="banner note">Submitted. Waiting for your manager to review it.</div>
        )}
        {data.status === "approved" && (
          <div className="banner note">
            Approved{data.report?.review_comment ? `: ${data.report.review_comment}.` : "."} Entries are locked.
          </div>
        )}
        {data.editable && (
          <>
            <div>
              <label htmlFor="summary">Notes for your manager (optional)</label>
              <textarea id="summary" maxLength={2000} value={summary} onChange={(e) => setSummary(e.target.value)} />
            </div>
            <div className="row">
              <button className="btn secondary" disabled={save.busy || invalid} onClick={() => saveNumbers()}>
                Save
              </button>
              <button
                className="btn"
                disabled={submit.busy || save.busy}
                onClick={() => setConfirmSubmit(true)}
              >
                {data.status === "returned" ? "Resubmit week" : "Submit week for review"}
              </button>
              {confirmSubmit && (
                <ConfirmDialog
                  title="Submit this week for review?"
                  message="You won't be able to edit it unless it's returned."
                  confirmLabel="Submit"
                  busy={submit.busy || save.busy}
                  onConfirm={async () => {
                    // Closed first: a failed save shows its message under the form.
                    setConfirmSubmit(false);
                    if (!(await saveNumbers())) return;
                    submit.run("POST", "/report/submit", { week_start: data.week_start, summary });
                  }}
                  onCancel={() => setConfirmSubmit(false)}
                />
              )}
            </div>
            {(save.error || submit.error) && (
              <div className="msg error" role="alert">
                {save.error || submit.error}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
