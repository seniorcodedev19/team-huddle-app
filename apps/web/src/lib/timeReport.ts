/* Formatting for the Time tracking report and timelines. Times are seconds
   from the person's local midnight, as ManicTime records them. */

/** 52_020 → "14.45 h", to two places like ManicTime's own report. */
export const hrs = (sec: number) => `${(sec / 3600).toFixed(2)} h`;

/** 52_200 → "2:30 PM"; whole hours drop the minutes ("2 PM"). */
export function clock(sec: number): string {
  const total = Math.round(sec / 60) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

/** 8_880 → "2 h 28 min"; under an hour "28 min"; under a minute "<1 min". */
export function duration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 1) return "<1 min";
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}

/** Total time covered by intervals, overlaps counted once. */
export function coveredSec(xs: { start: number; end: number }[]): number {
  const sorted = [...xs].sort((a, b) => a.start - b.start);
  let total = 0;
  let end = -1;
  for (const x of sorted) {
    if (x.end <= end) continue;
    total += x.end - Math.max(x.start, end);
    end = x.end;
  }
  return total;
}
