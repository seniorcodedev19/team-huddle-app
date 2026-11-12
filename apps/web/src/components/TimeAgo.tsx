"use client";

import { useSyncExternalStore } from "react";
import { momentLabel, type Described } from "@/lib/activity";
import { ago } from "@/lib/ago";

/* "5m ago", safe to render inside server-rendered pages.

   A relative time depends on the clock at the moment it is rendered. The
   server renders it once, the browser renders it again a little later, and
   the two strings differ — which React reports as a hydration error. The
   same goes for the tooltip, which depends on the reader's locale and time
   zone, neither of which the server knows.

   So the server, and the browser's first pass, render an empty span, and the
   text appears once the component is live. The clock is read through a store
   rather than in the render itself, which also keeps the label current: it
   re-reads every 30 seconds instead of freezing at whatever it said when the
   page loaded. */
function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, 30_000);
  return () => clearInterval(timer);
}
// Whole minutes, so the snapshot only changes when the label could.
const minuteNow = () => Math.floor(Date.now() / 60_000);
const onServer = () => null;

export default function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  const minute = useSyncExternalStore(subscribe, minuteNow, onServer);
  if (minute === null) return <span className={className} />;
  return (
    <span className={className} title={new Date(iso).toLocaleString()}>
      {ago(iso, minute * 60_000)}
    </span>
  );
}

/* A calendar date in the reader's own locale and time zone, for the same
   reason: the server has neither, so it would print a different date for
   anyone not in its zone. Nothing to tick here, so the store never fires;
   it is used only to tell the first pass from a live render. */
const never = () => () => {};
const live = () => true;
const notLive = () => false;

export function LocalDate({ iso }: { iso: string }) {
  const ready = useSyncExternalStore(never, live, notLive);
  if (!ready) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return <>—</>;
  return <>{d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</>;
}

/* An activity's sentence. Most are plain text; a reschedule ends with two
   times, and those are added only once live in the browser, for the same
   reason as everything else in this file. Until then the line reads
   complete without them. */
export function ActivityText({ d }: { d: Described }) {
  const ready = useSyncExternalStore(never, live, notLive);
  return (
    <>
      {d.text}
      {d.times && ready && ` from ${momentLabel(d.times.from)} to ${momentLabel(d.times.to)}`}
    </>
  );
}
