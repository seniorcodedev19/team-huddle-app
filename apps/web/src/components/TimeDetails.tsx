import { dayMonth, shortDay } from "@/lib/dates";
import { hours } from "@/lib/format";
import type { TimeWeek } from "@/lib/types";

/* The week's ManicTime tags for one person. Read-only: time is tagged in
   ManicTime. */
export default function TimeDetails({ data }: { data: TimeWeek }) {
  return (
    <div className="panel tablewrap">
      {data.tags.length === 0 ? (
        <div className="empty">No tagged time this week. Time you tag in ManicTime shows up here after the next sync.</div>
      ) : (
        <table className="time-tags">
          <thead>
            <tr>
              <th>Day</th>
              <th>Tag</th>
              <th className="n">Time</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {data.tags.map((t) => (
              <tr key={`${t.log_date}:${t.auto}:${t.tag}`}>
                <td className="nowrap">
                  {shortDay(t.log_date)} {dayMonth(t.log_date)}
                </td>
                <td>
                  {t.tag}
                  {t.auto && (
                    <span className="chip status-muted time-auto" title="Tagged by a ManicTime AutoTag rule">
                      Auto
                    </span>
                  )}
                </td>
                <td className="n">{hours(t.minutes)}</td>
                <td className="muted">{t.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
