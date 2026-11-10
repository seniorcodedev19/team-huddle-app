"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Interview, InterviewKind, TeamProfile } from "@/lib/types";

/* A week calendar for interviews, in the viewer's own time zone.

   Deliberately local, not UTC: the weekly scoring code is UTC because a week
   boundary must mean the same thing for everyone, but a meeting at 2pm is at
   2pm where you are. So this file uses local Date methods throughout and
   never touches lib/dates.ts, which is UTC by design.

   Month and day views build on the same pieces; week is the one in use now.

   Scale note: the page asks the API for just the range it is showing
   (`/interviews?from=…&to=…`), so a year of history costs nothing to render. */

const HOUR_PX = 48;

/** Midnight local on the Sunday of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  s.setDate(s.getDate() - s.getDay());
  return s;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Midnight local on the 1st of the month containing `d`. */
export function startOfMonth(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(1);
  return x;
}

export function addMonths(d: Date, n: number): Date {
  const x = startOfMonth(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

/* The grid a month view draws: whole weeks, Sunday-first, covering every day
   of the month. Six rows keeps the grid a constant height as months change,
   so the page does not jump when you page through. */
export function monthGrid(month: Date): Date[] {
  const first = startOfWeek(startOfMonth(month));
  return [...Array(42)].map((_, i) => addDays(first, i));
}

const sameMonth = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString(undefined, o);

/** "Nov 1 – Nov 7, 2026", collapsing the month when both ends share one. */
function rangeLabel(from: Date, to: Date): string {
  const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
  const left = fmt(from, { month: "short", day: "numeric" });
  const right = sameMonth
    ? `${to.getDate()}, ${to.getFullYear()}`
    : `${fmt(to, { month: "short", day: "numeric" })}, ${to.getFullYear()}`;
  return `${left} – ${right}`;
}

const hourLabel = (h: number) =>
  h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;

export default function InterviewCalendar({
  interviews,
  profiles,
  filters,
  onOpen,
  onCreate,
}: {
  interviews: Interview[];
  /** The profiles listed down the side, for the colour key and the filter. */
  profiles: TeamProfile[];
  /* Owned by the panel so its controls sit beside the view toggle. 0 and ""
     mean "no filter". */
  filters: { profile: number; user: number; kind: InterviewKind | "" };
  onOpen?: (i: Interview) => void;
  /** Called with the clicked slot, local time, so a parent can prefill a form. */
  onCreate?: (at: Date) => void;
}) {
  const { profile: fProfile, user: fUser, kind: fKind } = filters;
  const [view, setView] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()));
  /** Profile ids switched off in the side list. */
  /* Which profiles the grid is narrowed to. Empty means no narrowing, so
     everything shows — the useful default, and the only sensible starting
     point when nothing has been picked yet. Picking profiles shows those
     and only those; picking them all again is the same as picking none. */
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [now, setNow] = useState(() => new Date());
  const gridRef = useRef<HTMLDivElement>(null);

  // The "now" line only needs to be roughly right; once a minute is plenty.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const days = useMemo(() => [...Array(7)].map((_, i) => addDays(anchor, i)), [anchor]);

  /* An interview names its profile directly. Rows from the older internal
     1:1, which have no profile_id, fall back to the profile their member is
     assigned to so they still group and colour sensibly. */
  const profileOfUser = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of profiles) {
      for (const a of p.assignees) if (!m.has(a.user_id)) m.set(a.user_id, p.id);
    }
    return m;
  }, [profiles]);

  const profileOf = (ev: Interview): number | undefined =>
    ev.profile_id ?? (ev.member_id === null ? undefined : profileOfUser.get(ev.member_id));

  /* One colour per profile, by position in the list, so a profile keeps its
     colour as the week changes. Events with no profile fall back to the
     first colour. */
  const colourOf = useMemo(() => {
    const m = new Map<number, number>();
    profiles.forEach((p, i) => m.set(p.id, i % 6));
    return m;
  }, [profiles]);

  const colourForEvent = (ev: Interview) => {
    const pid = profileOf(ev);
    return pid === undefined ? 0 : colourOf.get(pid) ?? 0;
  };

  /* Events with no profile stay visible: hiding a profile should hide that
     profile's interviews, never quietly swallow ones it has no claim on. */
  const assigneesOf = useMemo(
    () => new Map(profiles.map((p) => [p.id, p.assignees])),
    [profiles],
  );

  const shown = useMemo(
    () =>
      interviews.filter((i) => {
        const pid = i.profile_id ?? (i.member_id === null ? undefined : profileOfUser.get(i.member_id));
        if (picked.size > 0 && (pid === undefined || !picked.has(pid))) return false;
        if (fProfile && pid !== fProfile) return false;
        if (fKind && i.kind !== fKind) return false;
        /* "User" is whoever the event involves on our side: the profile's
           assignees, or whoever booked it. */
        if (fUser) {
          const assignees = pid === undefined ? [] : (assigneesOf.get(pid) ?? []);
          const mine = i.interviewer_id === fUser || assignees.some((a) => a.user_id === fUser);
          if (!mine) return false;
        }
        return true;
      }),
    [interviews, picked, profileOfUser, fProfile, fKind, fUser, assigneesOf],
  );


  /* Lay events out per day. Overlapping events split the column width between
     them, the way a calendar does, rather than stacking out of sight. */
  const byDay = useMemo(() => {
    const map = new Map<
      number,
      { ev: Interview; at: Date; mins: number; col: number; of: number }[]
    >();
    for (const d of days) map.set(d.getTime(), []);
    for (const ev of shown) {
      const at = new Date(ev.scheduled_at);
      const key = days.find((d) => sameDay(d, at))?.getTime();
      if (key === undefined) continue;
      /* The block's height is its real length, so a 30-minute meeting is
         half the height of an hour one. An all-day event fills the day, and
         a row from before end times were stored falls back to an hour. */
      const end = ev.ends_at ? new Date(ev.ends_at) : null;
      const mins = ev.all_day
        ? 24 * 60
        : end && end > at
          ? (end.getTime() - at.getTime()) / 60_000
          : 60;
      map.get(key)!.push({ ev, at, mins, col: 0, of: 1 });
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.at.getTime() - b.at.getTime());
      /* Events share a row only when they genuinely overlap in time. The old
         sweep assumed every event was an hour long, so two consecutive
         half-hour meetings were split into narrow columns although neither
         covered the other. */
      let group: typeof list = [];
      let groupEnd = 0;
      const flush = () => {
        group.forEach((g, i) => {
          g.col = i;
          g.of = group.length;
        });
        group = [];
        groupEnd = 0;
      };
      for (const item of list) {
        const start = item.at.getTime();
        if (group.length && start >= groupEnd) flush();
        group.push(item);
        groupEnd = Math.max(groupEnd, start + item.mins * 60_000);
      }
      flush();
    }
    return map;
  }, [shown, days]);

  /* Month view: the same filtered events, bucketed by local day. */
  const monthDays = useMemo(() => (view === "month" ? monthGrid(anchor) : []), [view, anchor]);
  const byDate = useMemo(() => {
    const m = new Map<string, Interview[]>();
    if (view !== "month") return m;
    for (const ev of shown) {
      const at = new Date(ev.scheduled_at);
      const k = `${at.getFullYear()}-${at.getMonth()}-${at.getDate()}`;
      const list = m.get(k);
      if (list) list.push(ev);
      else m.set(k, [ev]);
    }
    for (const list of m.values()) list.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    return m;
  }, [shown, view]);

  // Open on the working day rather than midnight.
  useEffect(() => {
    if (view === "week" && gridRef.current) gridRef.current.scrollTop = 8 * HOUR_PX;
  }, [view]);

  const today = new Date();
  const weekEnd = addDays(anchor, 6);
  const nowInWeek = now >= anchor && now.getTime() < addDays(anchor, 7).getTime();

  return (
    <div className="cal">
      <aside className="cal-side">
        <div className="panel cal-legend">
          {/* The count says what the grid is showing, since a selection of
              one or two is easy to forget about when the rest of the page
              looks empty. Clearing it is one click away. */}
          <div className="cal-people-head">
            <h2 className="panel-title">Profiles</h2>
            {picked.size > 0 && (
              <button
                className="btn secondary small"
                type="button"
                onClick={() => setPicked(new Set())}
                title="Show every profile again"
              >
                Clear ({picked.size})
              </button>
            )}
          </div>
          {/* The list scrolls, not the panel: the heading stays put and the
              scrollbar runs beside the names rather than the whole card. */}
          <div className="cal-people">
            {profiles.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>
                No profiles yet.
              </p>
            ) : (
              profiles.map((p) => (
                /* The row itself is the control, so there is no checkbox: the
                   dot fills in and the name lifts when a profile is picked.
                   With nothing picked every row sits grey, which matches the
                   grid showing everything. */
                <button
                  className="cal-person"
                  type="button"
                  key={p.id}
                  aria-pressed={picked.has(p.id)}
                  title={
                    picked.has(p.id)
                      ? `Stop showing only ${p.full_name}`
                      : `Show only ${p.full_name}`
                  }
                  onClick={() =>
                    setPicked((s) => {
                      const next = new Set(s);
                      if (next.has(p.id)) next.delete(p.id);
                      else next.add(p.id);
                      return next;
                    })
                  }
                >
                  <span className={`cal-dot s${colourOf.get(p.id) ?? 0}`} aria-hidden="true" />
                  <span className="cal-person-text">
                    <strong>{p.full_name}</strong>
                    <span className="muted small">
                      {p.assignees.length === 0
                        ? "Unassigned"
                        : p.assignees.map((a) => a.name).join(", ")}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
        <p className="muted small cal-tz">
          Times are {Intl.DateTimeFormat().resolvedOptions().timeZone}.
        </p>
      </aside>

      <div className="cal-main">
        <div className="cal-toolbar">
          <button
            className="btn secondary"
            type="button"
            onClick={() =>
              setAnchor(view === "month" ? startOfMonth(new Date()) : startOfWeek(new Date()))
            }
          >
            Today
          </button>
          <button
            className="icon-btn"
            type="button"
            aria-label={view === "month" ? "Previous month" : "Previous week"}
            onClick={() => setAnchor((a) => (view === "month" ? addMonths(a, -1) : addDays(a, -7)))}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <button
            className="icon-btn"
            type="button"
            aria-label={view === "month" ? "Next month" : "Next week"}
            onClick={() => setAnchor((a) => (view === "month" ? addMonths(a, 1) : addDays(a, 7)))}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <h2 className="cal-range">
            {view === "month"
              ? fmt(anchor, { month: "long", year: "numeric" })
              : rangeLabel(anchor, weekEnd)}
          </h2>

          <div className="viewswitch cal-viewswitch" role="group" aria-label="Calendar view">
            <button
              type="button"
              className={view === "week" ? "on" : ""}
              aria-pressed={view === "week"}
              onClick={() => {
                setView("week");
                setAnchor((a) => startOfWeek(sameMonth(a, new Date()) ? new Date() : a));
              }}
            >
              Week
            </button>
            <button
              type="button"
              className={view === "month" ? "on" : ""}
              aria-pressed={view === "month"}
              onClick={() => {
                setView("month");
                setAnchor((a) => startOfMonth(a));
              }}
            >
              Month
            </button>
          </div>
        </div>


        {view === "month" ? (
          <div className="cal-month">
            {/* One header row of weekday names, then six weeks of cells, so
                the grid keeps its height as the month changes. */}
            {monthDays.slice(0, 7).map((d) => (
              <span className="cal-mhead" key={`mh${d.getDay()}`}>
                {fmt(d, { weekday: "short" })}
              </span>
            ))}
            {monthDays.map((d) => {
              const list = byDate.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) ?? [];
              const outside = !sameMonth(d, anchor);
              return (
                <div
                  className={`cal-mcell${outside ? " outside" : ""}${sameDay(d, today) ? " today" : ""}`}
                  key={`m${d.getTime()}`}
                >
                  <button
                    type="button"
                    className="cal-mdate"
                    aria-label={`New interview on ${fmt(d, { month: "long", day: "numeric" })}`}
                    onClick={() => {
                      const at = new Date(d);
                      at.setHours(9, 0, 0, 0);
                      onCreate?.(at);
                    }}
                  >
                    {d.getDate()}
                  </button>
                  <div className="cal-mevents">
                    {list.slice(0, 3).map((ev) => (
                      <button
                        type="button"
                        key={ev.id}
                        className={`cal-mevent s${colourForEvent(ev)} status-${ev.status}`}
                        title={[
                          new Date(ev.scheduled_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
                          ev.profile_name ?? ev.member_name,
                          ev.client_name || null,
                          ev.topic || null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        onClick={() => onOpen?.(ev)}
                      >
                        <span className="cal-mdot" aria-hidden="true" />
                        <span className="cal-mtime">
                          {ev.all_day
                            ? "All day"
                            : new Date(ev.scheduled_at).toLocaleTimeString(undefined, { hour: "numeric" })}
                        </span>
                        <span className="cal-mtitle">
                          {ev.client_name || ev.profile_name || ev.member_name || "Interview"}
                        </span>
                      </button>
                    ))}
                    {list.length > 3 && (
                      <span className="cal-mmore">+{list.length - 3} more</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
        /* Headers and hour grid share one grid so their columns can never
           disagree — see the .cal-grid comment in globals.css. Row 1 is the
           sticky header; row 2 is the gutter plus the seven day columns. */
        <div className="cal-grid" ref={gridRef}>
          <span className="cal-corner" aria-hidden="true" />
          {days.map((d) => (
            <span className={`cal-dayhead${sameDay(d, today) ? " today" : ""}`} key={`h${d.getTime()}`}>
              <span className="cal-dayname">{fmt(d, { weekday: "short" })}</span>
              <span className="cal-daynum">{d.getDate()}</span>
            </span>
          ))}

          <div className="cal-gutter">
            {[...Array(24)].map((_, h) => (
              <span className="cal-hour" key={h} style={{ height: HOUR_PX }}>
                {h > 0 && <span>{hourLabel(h)}</span>}
              </span>
            ))}
          </div>

          {days.map((d) => (
            <div className="cal-col" key={d.getTime()}>
              {[...Array(24)].map((_, h) => (
                <button
                  type="button"
                  className="cal-slot"
                  key={h}
                  style={{ height: HOUR_PX }}
                  aria-label={`New interview on ${fmt(d, { month: "short", day: "numeric" })} at ${hourLabel(h)}`}
                  onClick={() => {
                    const at = new Date(d);
                    at.setHours(h, 0, 0, 0);
                    onCreate?.(at);
                  }}
                />
              ))}

              {nowInWeek && sameDay(d, now) && (
                <span
                  className="cal-now"
                  style={{ top: (now.getHours() + now.getMinutes() / 60) * HOUR_PX }}
                  aria-hidden="true"
                />
              )}

              {(byDay.get(d.getTime()) ?? []).map(({ ev, at, mins, col, of }) => (
                <button
                  type="button"
                  key={ev.id}
                  className={`cal-event s${colourForEvent(ev)} status-${ev.status}`}
                  data-short={mins <= 30 || undefined}
                  style={{
                    top: (at.getHours() + at.getMinutes() / 60) * HOUR_PX,
                    /* Scaled to the real duration, less a 2px gap so stacked
                       blocks do not touch. A 30-minute event is therefore
                       exactly half an hour block. The 18px floor only catches
                       shorter events, where the time would be unreadable. */
                    height: Math.max(18, (mins / 60) * HOUR_PX - 2),
                    left: `${(col / of) * 100}%`,
                    width: `${100 / of}%`,
                  }}
                  title={[
                    at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
                    ev.profile_name ?? ev.member_name,
                    ev.client_name || null,
                    ev.topic || null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  onClick={() => onOpen?.(ev)}
                >
                  {/* Time and name share the first line: an hour block is
                      only so tall, and a third line gets clipped. The topic
                      follows if it fits. The title carries the full text. */}
                  <span className="cal-event-top">
                    <span className="cal-event-time">
                      {at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </span>
                    <span className="cal-event-title">
                      {ev.client_name || ev.profile_name || ev.member_name || "Interview"}
                    </span>
                  </span>
                  {ev.topic && <span className="cal-event-sub">{ev.topic}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  );
}
