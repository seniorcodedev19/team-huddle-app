"use client";

import { useEffect, useState } from "react";
import { callJson } from "@/lib/client";
import type { WorkMetric, WorkRange } from "@/lib/types";
import { WORK_LABEL } from "@/lib/work";

/* One day's work numbers, in a panel's right rail.

   The same control for a board card (AI applications, AI interviews,
   assessments) and for a profile (applications, interviews scheduled,
   interviews done). The subject decides which numbers it carries and where
   they are filed; the dashboard adds them up.

   The day defaults to the API's today rather than the browser's clock, so
   this panel and the dashboard agree on which day "today" is. */
export default function WorkFields({
  subject,
  metrics,
}: {
  subject: { card_no: number } | { profile_id: number };
  metrics: WorkMetric[];
}) {
  const key = "card_no" in subject ? `card_no=${subject.card_no}` : `profile_id=${subject.profile_id}`;

  /* null until the user picks a day: the first read asks the API for
     "today" and learns which day that is from the answer. */
  const [picked, setPicked] = useState<string | null>(null);
  const [data, setData] = useState<{ today: string; date: string; vals: Partial<Record<WorkMetric, number>> } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    const range = picked ? `&from=${picked}&to=${picked}` : "";
    callJson<WorkRange>("GET", `/work?${key}${range}`, undefined, ac.signal)
      .then((r) => {
        const vals: Partial<Record<WorkMetric, number>> = {};
        for (const row of r.rows) vals[row.metric] = row.value;
        setData({ today: r.today, date: r.to, vals });
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Couldn't load the daily numbers");
      });
    return () => ac.abort();
  }, [key, picked]);

  const save = async (metric: WorkMetric, raw: string) => {
    if (!data) return;
    const stored = data.vals[metric] ?? 0;
    const value = raw.trim() === "" ? 0 : Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      setError("Use a whole number, 0 or more.");
      setResetKey((k) => k + 1);
      return;
    }
    if (value === stored) return;
    setError(null);
    try {
      await callJson("PUT", "/work", { ...subject, log_date: data.date, metric, value });
      setData((d) => (d ? { ...d, vals: { ...d.vals, [metric]: value } } : d));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that number");
      setResetKey((k) => k + 1);
    }
  };

  return (
    <div className="card-work">
      <h3 className="card-section">Daily work</h3>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {!data ? (
        !error && <p className="muted small">Loading…</p>
      ) : (
        <>
          <input
            type="date"
            className="work-date"
            aria-label="Day"
            value={data.date}
            max={data.today}
            onChange={(e) => e.target.value && e.target.value <= data.today && setPicked(e.target.value)}
          />
          <div className="card-work-fields">
            {metrics.map((m) => (
              <label key={m}>
                <span>{WORK_LABEL[m]}</span>
                <input
                  // Remounts when the day or the stored value changes.
                  key={`${data.date}:${data.vals[m] ?? 0}:${resetKey}`}
                  className="work-input"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={9999}
                  defaultValue={data.vals[m] || ""}
                  placeholder="0"
                  onBlur={(e) => void save(m, e.target.value)}
                  onKeyDown={(e) => {
                    // Enter saves here; it must not also submit the form around it.
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                />
              </label>
            ))}
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            Saves when you leave a field. Clear it to remove.
          </p>
        </>
      )}
    </div>
  );
}
