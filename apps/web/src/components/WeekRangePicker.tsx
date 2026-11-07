"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { addDays, weekStartOf } from "@/lib/dates";

/* Two months side by side, with the selected week highlighted across its row.

   The whole dashboard is keyed to one week, so this picks a week, not an
   arbitrary range: clicking any day selects the Sunday-to-Saturday week that
   day falls in. Dates are 'YYYY-MM-DD' in UTC throughout, matching lib/dates
   and the API, so nothing shifts for a reader behind UTC. */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** 'YYYY-MM' of the month containing a date string. */
const monthOf = (s: string) => s.slice(0, 7);

function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/* Six weeks of day cells covering `ym`, Sunday-first, so the grid keeps a
   constant height as months change and the popover does not jump. */
function monthCells(ym: string): string[] {
  const start = weekStartOf(`${ym}-01`);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function Month({
  ym,
  spanStart,
  spanEnd,
  today,
  maxWeek,
  onPick,
}: {
  ym: string;
  /** First and last day of the selected span, inclusive. */
  spanStart: string;
  spanEnd: string;
  today: string;
  maxWeek: string;
  onPick: (day: string) => void;
}) {
  const [y, m] = ym.split("-").map(Number);
  return (
    <div className="wrp-month">
      <div className="wrp-mtitle">{`${MONTHS[m - 1]} ${y}`}</div>
      <div className="wrp-grid">
        {DOW.map((d) => (
          <span className="wrp-dow" key={d}>
            {d}
          </span>
        ))}
        {monthCells(ym).map((day) => {
          const outside = monthOf(day) !== ym;
          const inWeek = day >= spanStart && day <= spanEnd;
          /* A future week has no data, so it is not selectable — the same
             rule the next-week arrow follows. */
          const future = weekStartOf(day) > maxWeek;
          const cls = [
            "wrp-day",
            outside ? "outside" : "",
            inWeek ? "inweek" : "",
            day === spanStart ? "edge start" : "",
            day === spanEnd ? "edge end" : "",
            day === today ? "today" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              type="button"
              key={day}
              className={cls}
              disabled={future}
              aria-current={inWeek ? "date" : undefined}
              onClick={() => onPick(day)}
            >
              {Number(day.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function WeekRangePicker({
  weekStart,
  weeks = 1,
  today,
  label,
  onPick,
}: {
  /** The last week of the selected span. */
  weekStart: string;
  /** How many weeks the span covers, ending at weekStart. */
  weeks?: number;
  today: string;
  /** The text on the pill, e.g. "Nov 2 - Nov 8, 2026". */
  label: string;
  onPick: (weekStart: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // The month shown on the left; the right is always the one after it.
  const [leftMonth, setLeftMonth] = useState(() => monthOf(addDays(weekStart, -7 * (weeks - 1))));
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const thisWeek = weekStartOf(today);
  /* The span the pill describes: `weeks` weeks ending with weekStart. */
  const spanStart = addDays(weekStart, -7 * (weeks - 1));
  const spanEnd = addDays(weekStart, 6);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // The panel is portalled to <body>, so it is not inside `wrap`.
      if (!wrap.current?.contains(t) && !sheet.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const place = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const width = 560;
    /* Keep it on screen: prefer left-aligned with the pill, but pull it back
       from the right edge when there is not room. */
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos({ left, top: r.bottom + 6 });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const on = () => place();
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on, true);
    };
  }, [open]);

  const pick = (day: string) => {
    onPick(weekStartOf(day));
    setOpen(false);
  };

  return (
    <div className="wrp" ref={wrap}>
      <button
        type="button"
        ref={trigger}
        className={`wrp-pill${open ? " open" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          /* Opening always starts on the selected week's month, so paging
             around and reopening does not strand you in another year. */
          if (!open) setLeftMonth(monthOf(spanStart));
          setOpen((v) => !v);
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M8 3v4M16 3v4M3 10h18" />
        </svg>
        <span>{label}</span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            className="wrp-panel"
            id={panelId}
            ref={sheet}
            role="dialog"
            aria-label="Choose a week"
            style={{ left: pos.left, top: pos.top }}
          >
            <button
              type="button"
              className="wrp-nav prev"
              aria-label="Previous month"
              onClick={() => setLeftMonth((m) => shiftMonth(m, -1))}
            >
              ‹
            </button>
            <Month ym={leftMonth} spanStart={spanStart} spanEnd={spanEnd} today={today} maxWeek={thisWeek} onPick={pick} />
            <Month
              ym={shiftMonth(leftMonth, 1)}
              spanStart={spanStart}
              spanEnd={spanEnd}
              today={today}
              maxWeek={thisWeek}
              onPick={pick}
            />
            <button
              type="button"
              className="wrp-nav next"
              aria-label="Next month"
              onClick={() => setLeftMonth((m) => shiftMonth(m, 1))}
            >
              ›
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
