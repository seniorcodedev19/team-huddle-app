// Weeks run Sunday to Saturday; dates are 'YYYY-MM-DD' strings handled in UTC.
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const todayUtc = () => isoDate(new Date());

export function addDays(s: string, n: number): string {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

export function weekStartOf(s: string): string {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return isoDate(d);
}

const fmtUtc = (s: string, o: Intl.DateTimeFormatOptions) =>
  new Date(`${s}T00:00:00Z`).toLocaleDateString("en-US", { ...o, timeZone: "UTC" });

export const shortDay = (s: string) => fmtUtc(s, { weekday: "short" });
export const dayMonth = (s: string) => fmtUtc(s, { month: "short", day: "numeric" });
export const weekLabel = (start: string, end: string) => `${dayMonth(start)} to ${dayMonth(end)}`;

/* "Nov 2 - Nov 8, 2026", the week-picker pill's label. The year is stated
   once at the end, and only the months differ when a week straddles two. */
export function rangeLabel(start: string, end: string): string {
  const y = fmtUtc(end, { year: "numeric" });
  return `${dayMonth(start)} - ${dayMonth(end)}, ${y}`;
}

export function recentWeeks(today: string, count = 26): { start: string; end: string }[] {
  const thisWeek = weekStartOf(today);
  return Array.from({ length: count }, (_, i) => {
    const start = addDays(thisWeek, -7 * i);
    return { start, end: addDays(start, 6) };
  });
}

// A usable ?week= value or undefined.
export function weekParam(w?: string): string | undefined {
  return w && /^\d{4}-\d{2}-\d{2}$/.test(w) && !Number.isNaN(Date.parse(w)) ? w : undefined;
}
