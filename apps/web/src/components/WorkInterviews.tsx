import type { WorkLog } from "@/lib/types";

/* The team's interviews for the weeks on screen, from the numbers typed on
   each profile — not from the calendar, which is not yet where interviews
   are reliably recorded.

   Two counts side by side rather than a donut: an interview that was
   scheduled may also be done, so the two overlap and do not add up to a
   whole. */
export default function WorkInterviews({ rows }: { rows: WorkLog[] }) {
  const sum = (metric: WorkLog["metric"]) => rows.reduce((a, r) => a + (r.metric === metric ? r.value : 0), 0);
  const scheduled = sum("interview_scheduled");
  const done = sum("interview_done");

  if (scheduled === 0 && done === 0) {
    return <div className="empty">No interviews recorded on profiles for these weeks.</div>;
  }
  return (
    <>
      <div className="work-figures">
        <div>
          <span className="work-figure">{scheduled}</span>
          <span className="muted small">Interviews scheduled</span>
        </div>
        <div>
          <span className="work-figure">{done}</span>
          <span className="muted small">Interviews done</span>
        </div>
      </div>
      <p className="muted small" style={{ margin: "10px 0 0" }}>
        From the daily work entered on each profile.
      </p>
    </>
  );
}
