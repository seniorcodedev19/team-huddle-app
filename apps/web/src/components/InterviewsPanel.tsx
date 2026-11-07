"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction } from "@/lib/client";
import type { Interview, TeamProfile, User } from "@/lib/types";
import Dropdown from "./Dropdown";
import InterviewCalendar from "./InterviewCalendar";
import NewInterviewModal from "./NewInterviewModal";
import PersonCell from "./PersonCell";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Card({ i, canManage }: { i: Interview; canManage: boolean }) {
  const { error, busy, run } = useAction();
  const [status, setStatus] = useState(i.status);
  const [notes, setNotes] = useState(i.notes ?? "");
  const dirty = status !== i.status || notes !== (i.notes ?? "");

  return (
    <div className="item">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <strong>{i.topic}</strong>
          <div className="row" style={{ marginTop: 8, gap: 16 }}>
            {/* The profile being interviewed, and the client on the other
                side. Old internal 1:1 rows have no profile, so they show the
                member instead. */}
            <PersonCell
              name={i.profile_name ?? i.member_name ?? "—"}
              email={i.profile_email ?? i.member_email ?? ""}
              avatar={i.profile_name ? null : i.member_avatar}
              size={28}
              sub={i.profile_name ? "Profile" : "Member"}
            />
            {(i.client_name || i.client_email) && (
              <PersonCell name={i.client_name || i.client_email} email={i.client_email} size={28} sub="Client" />
            )}
            <PersonCell
              name={i.interviewer_name}
              email={i.interviewer_email}
              avatar={i.interviewer_avatar}
              size={28}
              sub="Booked by"
            />
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            <span suppressHydrationWarning>{when(i.scheduled_at)}</span>
          </div>
        </div>
        <span className="pill">{i.status}</span>
      </div>
      {canManage ? (
        <div className="stack" style={{ marginTop: 10 }}>
          <div className="row">
            <div>
              <label htmlFor={`s-${i.id}`}>Status</label>
              <Dropdown<Interview["status"]>
                id={`s-${i.id}`}
                ariaLabel="Status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: "scheduled", label: "scheduled" },
                  { value: "done", label: "done" },
                  { value: "passed", label: "passed" },
                  { value: "failed", label: "failed" },
                  { value: "cancelled", label: "cancelled" },
                ]}
              />
            </div>
          </div>
          <div>
            <label htmlFor={`n-${i.id}`}>Notes (visible to {i.member_name})</label>
            <textarea id={`n-${i.id}`} value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="row">
            <button className="btn secondary" disabled={!dirty || busy} onClick={() => run("PATCH", `/interviews/${i.id}`, { status, notes })}>
              Save
            </button>
          </div>
          {error && <div className="msg error" role="alert">{error}</div>}
        </div>
      ) : (
        i.notes && <p style={{ margin: "10px 0 0", whiteSpace: "pre-wrap" }}>{i.notes}</p>
      )}
    </div>
  );
}

export default function InterviewsPanel({
  me,
  interviews,
  profiles,
}: {
  me: User;
  interviews: Interview[];
  profiles: TeamProfile[];
}) {
  const router = useRouter();
  const manage = me.role !== "member";
  const [view, setView] = useState<"calendar" | "list">("calendar");
  /* The slot the New event dialog is open for, or null when it is closed. */
  const [newAt, setNewAt] = useState<Date | null>(null);
  /* The existing event being edited, or null when creating. */
  const [editing, setEditing] = useState<Interview | null>(null);

  return (
    <div className="stack">
      <div className="viewswitch" role="group" aria-label="View">
        <button
          type="button"
          className={view === "calendar" ? "on" : ""}
          onClick={() => setView("calendar")}
          aria-pressed={view === "calendar"}
        >
          Calendar
        </button>
        <button
          type="button"
          className={view === "list" ? "on" : ""}
          onClick={() => setView("list")}
          aria-pressed={view === "list"}
        >
          List
        </button>
      </div>

      {view === "calendar" ? (
        <InterviewCalendar
          interviews={interviews}
          profiles={profiles}
          onCreate={manage ? (d) => { setEditing(null); setNewAt(d); } : undefined}
          onOpen={
            manage
              ? (ev) => {
                  setEditing(ev);
                  setNewAt(new Date(ev.scheduled_at));
                }
              : undefined
          }
        />
      ) : (
        <div className="panel">
          {interviews.length === 0 ? (
            <div className="empty">{manage ? "No interviews scheduled yet." : "No interviews scheduled with you yet."}</div>
          ) : (
            interviews.map((i) => <Card key={`${i.id}-${i.status}-${i.notes ?? ""}`} i={i} canManage={manage} />)
          )}
        </div>
      )}

      {newAt && (
        <NewInterviewModal
          /* Remounts between events so every field re-reads from the one
             just opened, rather than keeping the last one's state. */
          key={editing ? `e${editing.id}` : `n${newAt.getTime()}`}
          at={newAt}
          editing={editing ?? undefined}
          profiles={profiles}
          onClose={() => {
            setNewAt(null);
            setEditing(null);
          }}
          onCreated={() => {
            setNewAt(null);
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
