/** "just now", "5m ago", "3h ago", then a short date. Shared by comments and
    notifications so the two never disagree about the same moment.

    `now` is passed in rather than read here: a function that reads the clock
    gives a different answer on the server and in the browser, which is what
    broke hydration. Render it through <TimeAgo>, which supplies the clock. */
export function ago(iso: string, now: number) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  // Never negative: the caller's clock is rounded down to the minute.
  const mins = Math.max(0, Math.round((now - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
