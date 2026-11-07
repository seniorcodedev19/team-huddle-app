"use client";

import { useSyncExternalStore } from "react";
import type { Interview } from "@/lib/types";

/* "Today" on the dashboard: the interviews scheduled for the viewer's own
   day.

   Which day "today" is depends on the reader's time zone, and the server
   renders in its own, so picking the day on the server can be off by one for
   anyone far enough east or west. The page therefore hands over a window
   around today and this component narrows it to the real local day after
   mount. Until then it renders nothing rather than a guess that might flip. */

/* Never emits; the difference between the client and server snapshots below
   is the whole signal. */
const subscribe = () => () => {};

const sameLocalDay = (iso: string, day: Date) => {
  const d = new Date(iso);
  return (
    d.getFullYear() === day.getFullYear() &&
    d.getMonth() === day.getMonth() &&
    d.getDate() === day.getDate()
  );
};

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function CalendarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 11h18" />
    </svg>
  );
}

export default function TodayInterviews({ interviews }: { interviews: Interview[] }) {
  /* False on the server and during hydration, true afterwards, so the first
     client render matches the server's and the day is only decided once the
     browser's zone is known. */
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const today = mounted ? new Date() : null;

  const mine = today
    ? interviews
        .filter((i) => i.status !== "cancelled" && sameLocalDay(i.scheduled_at, today))
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    : [];

  return (
    <section className="panel today" style={{ marginBottom: 12 }}>
      <h2 className="panel-title">Today</h2>

      {today && mine.length > 0 ? (
        <ul className="today-list">
          {mine.map((i) => (
            <li className="today-item" key={i.id}>
              <span className="today-time">
                {i.all_day ? "All day" : time(i.scheduled_at)}
                {!i.all_day && i.ends_at ? ` – ${time(i.ends_at)}` : ""}
              </span>
              <span className="today-text">
                <strong>{i.topic}</strong>
                <span className="muted small">
                  {[i.profile_name ?? i.member_name, i.client_name || null]
                    .filter(Boolean)
                    .join(" · ") || "No profile"}
                </span>
              </span>
              {i.location && (
                <a className="today-link" href={i.location} target="_blank" rel="noreferrer">
                  Join
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="today-empty">
          <span className="today-icon" aria-hidden="true">
            <CalendarIcon />
          </span>
          <strong>Nothing scheduled today</strong>
          <p>Interviews across all your profiles show up here on the day.</p>
          <a href="/calendar">See what&rsquo;s happening this week</a>
        </div>
      )}
    </section>
  );
}
