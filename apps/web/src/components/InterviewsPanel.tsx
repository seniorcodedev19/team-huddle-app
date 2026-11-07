"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useAction } from "@/lib/client";
import { INTERVIEW_KINDS, KIND_LABEL } from "@/lib/training";
import type { Interview, InterviewKind, TeamProfile, User } from "@/lib/types";
import Avatar from "./Avatar";
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

  /* Calendar filters. Here rather than in InterviewCalendar so the controls
     can sit beside the Calendar/List toggle. 0 and "" mean "no filter". */
  const [fProfile, setFProfile] = useState(0);
  const [fUser, setFUser] = useState(0);
  const [fKind, setFKind] = useState<InterviewKind | "">("");
  const anyFilter = fProfile !== 0 || fUser !== 0 || fKind !== "";

  /* People who actually appear on an event, as a profile's assignee or as
     whoever booked it. Listing every user would mostly offer options that
     match nothing. */
  const userOptions = useMemo(() => {
    const seen = new Map<number, { id: number; name: string; email: string; avatar?: string | null }>();
    for (const p of profiles) {
      for (const a of p.assignees) {
        if (!seen.has(a.user_id)) {
          seen.set(a.user_id, { id: a.user_id, name: a.name, email: a.email, avatar: a.avatar });
        }
      }
    }
    for (const i of interviews) {
      if (!seen.has(i.interviewer_id)) {
        seen.set(i.interviewer_id, {
          id: i.interviewer_id,
          name: i.interviewer_name,
          email: i.interviewer_email,
          avatar: i.interviewer_avatar,
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [profiles, interviews]);

  return (
    <div className="stack">
      <div className="cal-bar">
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

        {/* Filters sit with the view toggle. Only the calendar uses them. */}
        {view === "calendar" && (
          <div className="cal-filters">
          <Dropdown<number>
            value={fProfile}
            ariaLabel="Filter by profile"
            onChange={setFProfile}
            options={[
              { value: 0, label: "All profiles" },
              ...profiles.map((p) => ({ value: p.id, label: p.full_name })),
            ]}
          />
          <Dropdown<number>
            value={fUser}
            ariaLabel="Filter by user"
            onChange={setFUser}
            options={[
              { value: 0, label: "All users" },
              ...userOptions.map((u) => ({
                value: u.id,
                label: u.name,
                media: <Avatar name={u.name} email={u.email} src={u.avatar} size={20} />,
              })),
            ]}
          />
          <Dropdown<InterviewKind | "">
            value={fKind}
            ariaLabel="Filter by event type"
            onChange={setFKind}
            options={[
              { value: "", label: "All types" },
              ...INTERVIEW_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })),
            ]}
          />
          {anyFilter && (
            <button
              className="btn secondary small"
              type="button"
              onClick={() => {
                setFProfile(0);
                setFUser(0);
                setFKind("");
              }}
            >
              Clear
              </button>
            )}
          </div>
        )}
      </div>

      {view === "calendar" ? (
        <InterviewCalendar
          filters={{ profile: fProfile, user: fUser, kind: fKind }}
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
