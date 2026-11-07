"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useBusy } from "@/components/Busy";
import Dropdown from "@/components/Dropdown";
import WeekRangePicker from "@/components/WeekRangePicker";
import { addDays, rangeLabel, recentWeeks, weekLabel, weekStartOf } from "@/lib/dates";

function href(
  base: string,
  extra: Record<string, string>,
  week: string | undefined,
  param: string,
  weeks?: number,
) {
  const p = new URLSearchParams(extra);
  if (week) p.set(param, week);
  else p.delete(param);
  // 1 week is the default view, so it stays out of the URL.
  if (weeks && weeks > 1) p.set("weeks", String(weeks));
  else p.delete("weeks");
  const q = p.toString();
  return q ? `${base}?${q}` : base;
}

/* The presets, in menu order. `weeks` is how many weeks the range covers,
   counting back from and including the selected one — 5 and 13 are 30 and 90
   days rounded to whole weeks, which is the only unit the API scores in. */
const PRESETS = [
  { value: "this", label: "This Week", weeks: 1 },
  { value: "last", label: "Last Week", weeks: 1 },
  { value: "d30", label: "Last 30 Days", weeks: 5 },
  { value: "d90", label: "Last 90 Days", weeks: 13 },
  { value: "custom", label: "Custom Range", weeks: 1 },
] as const;

export function WeekSelect({
  id = "week",
  label = "Week",
  value,
  today,
  onChange,
}: {
  id?: string;
  label?: string;
  value: string;
  today: string;
  onChange: (weekStart: string) => void;
}) {
  const thisWeek = weekStartOf(today);
  let weeks = recentWeeks(today);
  if (value && !weeks.some((w) => w.start === value)) {
    weeks = [{ start: value, end: addDays(value, 6) }, ...weeks].sort((a, b) => b.start.localeCompare(a.start));
  }
  return (
    <Dropdown<string>
      id={id}
      ariaLabel={label}
      value={value}
      onChange={onChange}
      options={weeks.map((w) => ({
        value: w.start,
        label: `${weekLabel(w.start, w.end)}${w.start === thisWeek ? " · this week" : ""}`,
      }))}
    />
  );
}

export default function WeekPicker({
  base,
  weekStart,
  weekEnd,
  today,
  weeks = 1,
  extra = {},
  param = "week",
  selectId,
  trailing,
}: {
  base: string;
  weekStart: string;
  weekEnd: string;
  today: string;
  /** How many weeks the view covers, ending at weekStart. 1 is a single week. */
  weeks?: number;
  extra?: Record<string, string>;
  param?: string;
  selectId?: string;
  trailing?: ReactNode;
}) {
  const router = useRouter();
  const { startNav } = useBusy();
  const thisWeek = weekStartOf(today);
  const lastWeek = addDays(thisWeek, -7);
  const go = (start?: string, n = 1) => href(base, extra, start, param, n);
  const push = (url: string) => {
    startNav();
    router.push(url);
  };
  /* "This week" is the default view, so it is the URL with no ?week= at all;
     every other week carries the param. */
  const toWeek = (start: string, n = 1) => push(go(start === thisWeek && n === 1 ? undefined : start, n));

  /* Which preset the current URL amounts to. A multi-week range always ends
     at the present week; anything else is a one-off the user picked. */
  const preset =
    weeks === 5 && weekStart === thisWeek
      ? "d30"
      : weeks === 13 && weekStart === thisWeek
        ? "d90"
        : weeks > 1
          ? "custom"
          : weekStart === thisWeek
            ? "this"
            : weekStart === lastWeek
              ? "last"
              : "custom";

  /* The pill shows the whole span, which for a range starts weeks-1 back. */
  const spanStart = addDays(weekStart, -7 * (weeks - 1));

  return (
    <div className="weekpick" role="group" aria-label="Week">
      <button
        type="button"
        className="icon-btn"
        aria-label={weeks > 1 ? "Previous period" : "Previous week"}
        onClick={() => toWeek(addDays(weekStart, -7 * weeks), weeks)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m14 6-6 6 6 6" />
        </svg>
      </button>

      <Dropdown<string>
        id={selectId ?? param}
        ariaLabel="Week preset"
        className="weekpick-preset"
        value={preset}
        onChange={(v) => {
          if (v === "this") toWeek(thisWeek);
          else if (v === "last") toWeek(lastWeek);
          else if (v === "d30") toWeek(thisWeek, 5);
          else if (v === "d90") toWeek(thisWeek, 13);
          // "custom" labels a week chosen on the calendar rather than being an
          // action of its own — opening the pill is how you pick one.
        }}
        options={PRESETS.map((x) => ({ value: x.value, label: x.label }))}
      />

      <WeekRangePicker
        weekStart={weekStart}
        weeks={weeks}
        today={today}
        label={rangeLabel(spanStart, weekEnd)}
        onPick={(start) => toWeek(start)}
      />

      <button
        type="button"
        className="icon-btn"
        aria-label={weeks > 1 ? "Next period" : "Next week"}
        disabled={weekStart >= thisWeek}
        onClick={() => toWeek(addDays(weekStart, 7 * weeks), weeks)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m10 6 6 6-6 6" />
        </svg>
      </button>

      {trailing}
    </div>
  );
}
