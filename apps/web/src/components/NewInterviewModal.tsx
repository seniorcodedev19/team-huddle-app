"use client";

import { useEffect, useRef, useState } from "react";
import { useAction } from "@/lib/client";
import { INTERVIEW_KINDS, KIND_LABEL } from "@/lib/training";
import type { Interview, InterviewKind, TeamProfile } from "@/lib/types";
import Dropdown from "./Dropdown";

/* The New event dialog, opened by clicking a slot on the interview calendar.

   An interview here is a meeting between one of our profiles and an outside
   client, so the profile is chosen from a dropdown and the client is typed in
   as a name and email — they have no account in this app.

   Times are local wall clock, matching the calendar. The date and the two
   times are kept as separate strings exactly as typed, and only combined into
   instants on submit, so typing an end before a start never silently reorders
   anything — it just fails validation. */

const pad = (n: number) => String(n).padStart(2, "0");

export const dateValue = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Combine a local date and time input into an instant. */
export function combine(date: string, time: string): Date | null {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

export default function NewInterviewModal({
  at,
  profiles,
  defaultProfileId,
  editing,
  onClose,
  onCreated,
}: {
  /** The clicked slot, local time. Ignored when editing. */
  at: Date;
  profiles: TeamProfile[];
  defaultProfileId?: number | null;
  /** An existing event to change, or undefined to create a new one. */
  editing?: Interview;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { error, busy, run } = useAction();
  /* When editing, every field starts from the stored event; the times are
     read back into local wall clock, the same way they were entered. */
  const startedAt = editing ? new Date(editing.scheduled_at) : at;
  /* A new event runs 30 minutes unless the user says otherwise. Most
     bookings here are short, and stretching a half-hour meeting to an hour
     by default made every block look longer than it was. */
  const endedAt = editing?.ends_at
    ? new Date(editing.ends_at)
    : new Date(startedAt.getTime() + 30 * 60_000);

  const [profileId, setProfileId] = useState(
    String(editing?.profile_id ?? defaultProfileId ?? profiles[0]?.id ?? ""),
  );
  const [title, setTitle] = useState(editing?.topic ?? "");
  const [date, setDate] = useState(() => dateValue(startedAt));
  const [start, setStart] = useState(() => timeValue(startedAt));
  const [end, setEnd] = useState(() => timeValue(endedAt));
  const [allDay, setAllDay] = useState(editing?.all_day ?? false);
  const [location, setLocation] = useState(editing?.location ?? "");
  const [description, setDescription] = useState(editing?.notes ?? "");
  const [clientName, setClientName] = useState(editing?.client_name ?? "");
  const [clientEmail, setClientEmail] = useState(editing?.client_email ?? "");
  const [kind, setKind] = useState<InterviewKind>(editing?.kind ?? "interview");
  const [status, setStatus] = useState<Interview["status"]>(editing?.status ?? "scheduled");
  const [localError, setLocalError] = useState<string | null>(null);
  /* Deleting is irreversible, so the button asks once before doing it. */
  const [confirmDelete, setConfirmDelete] = useState(false);

  const panel = useRef<HTMLDivElement>(null);

  // Escape closes, and focus starts inside the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panel.current?.querySelector<HTMLElement>("input, select, button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    setLocalError(null);
    /* An event has no subject, so it needs no profile. Interviews do. */
    if (!profileId && kind !== "event") {
      setLocalError("Choose which profile this interview is for.");
      return;
    }
    const startAt = allDay ? combine(date, "00:00") : combine(date, start);
    const endAt = allDay ? combine(date, "23:59") : combine(date, end);
    if (!startAt || !endAt) {
      setLocalError("Check the date and times.");
      return;
    }
    if (endAt <= startAt) {
      setLocalError("The end time has to be after the start time.");
      return;
    }
    const body = {
      ...(profileId ? { profile_id: Number(profileId) } : {}),
      topic: title.trim() || "Interview",
      scheduled_at: startAt.toISOString(),
      ends_at: endAt.toISOString(),
      all_day: allDay,
      location: location.trim(),
      notes: description.trim(),
      client_name: clientName.trim(),
      client_email: clientEmail.trim(),
      kind,
    };
    const ok = editing
      ? await run("PATCH", `/interviews/${editing.id}`, { ...body, status })
      : await run("POST", "/interviews", body);
    if (ok) onCreated();
  };

  const remove = async () => {
    if (!editing) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    if (await run("DELETE", `/interviews/${editing.id}`)) onCreated();
  };

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal modal-event"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ne-title"
        ref={panel}
      >
        <div className="modal-head">
          <div>
            <h2 id="ne-title">{editing ? "Edit event" : "New event"}</h2>
            <p className="muted small" style={{ margin: "2px 0 0" }}>
              Interview between the profile and a client. {zone}.
            </p>
          </div>
          <button className="icon-btn" type="button" aria-label="Close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="modal-body stack">
          <div>
            <label htmlFor="ne-profile">
              Profile {kind === "event" && <span className="muted small">(optional)</span>}
            </label>
            {profiles.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>
                {kind === "event"
                  ? "No profiles yet. An event does not need one."
                  : "No profiles yet — add one before scheduling an interview."}
              </p>
            ) : (
              <Dropdown<string>
                id="ne-profile"
                ariaLabel="Profile"
                value={profileId}
                placeholder={kind === "event" ? "No profile" : "Choose a profile…"}
                onChange={setProfileId}
                options={[
                  /* An event is a team happening, so it can stand on its own.
                     Interviews always have a subject, so no blank option. */
                  ...(kind === "event" ? [{ value: "", label: "No profile" }] : []),
                  ...profiles.map((p) => ({
                    value: String(p.id),
                    label: p.full_name,
                    hint: p.email || undefined,
                  })),
                ]}
              />
            )}
          </div>

          <div>
            <label htmlFor="ne-title-in">Title</label>
            <input
              id="ne-title-in"
              value={title}
              maxLength={120}
              placeholder="e.g. Interview with Acme - stage 2"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="ne-times">
            <div>
              <label htmlFor="ne-date">Date</label>
              <input id="ne-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label htmlFor="ne-start">Start</label>
              <input
                id="ne-start"
                type="time"
                value={start}
                disabled={allDay}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="ne-end">End</label>
              <input
                id="ne-end"
                type="time"
                value={end}
                disabled={allDay}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>

          <label className="ne-check">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            <span>All day</span>
          </label>

          <div className="ne-times ne-client">
            <div>
              <label htmlFor="ne-cname">Client name (optional)</label>
              <input
                id="ne-cname"
                value={clientName}
                maxLength={200}
                onChange={(e) => setClientName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="ne-cemail">Client email (optional)</label>
              <input
                id="ne-cemail"
                type="email"
                value={clientEmail}
                maxLength={200}
                onChange={(e) => setClientEmail(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label htmlFor="ne-kind">Type</label>
            <Dropdown<InterviewKind>
              id="ne-kind"
              ariaLabel="Event type"
              value={kind}
              onChange={(k) => {
                setKind(k);
                /* passed and failed describe an interview's outcome. If the
                   event stops being an interview, a verdict already set on
                   it no longer means anything, so fall back to scheduled. */
                if (k === "event" && (status === "passed" || status === "failed")) {
                  setStatus("scheduled");
                }
              }}
              options={INTERVIEW_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
            />
          </div>

          {/* Only when editing: a new booking is always 'scheduled', and the
              outcome is what someone comes back to change afterwards. */}
          {editing && (
            <div>
              <label htmlFor="ne-status">Status</label>
              <Dropdown<Interview["status"]>
                id="ne-status"
                ariaLabel="Status"
                value={status}
                onChange={setStatus}
                /* An interview has an outcome; a plain event only happens or
                   does not, so passed and failed are left out for one. */
                options={[
                  { value: "scheduled", label: "Scheduled" },
                  { value: "done", label: "Done — outcome not recorded" },
                  ...(kind === "event"
                    ? []
                    : [
                        { value: "passed" as const, label: "Passed" },
                        { value: "failed" as const, label: "Failed" },
                      ]),
                  { value: "cancelled", label: "Cancelled" },
                ]}
              />
            </div>
          )}

          <div>
            <label htmlFor="ne-loc">Location or link (optional)</label>
            <input id="ne-loc" value={location} maxLength={500} onChange={(e) => setLocation(e.target.value)} />
          </div>

          <div>
            <label htmlFor="ne-desc">Description (optional)</label>
            <textarea
              id="ne-desc"
              value={description}
              maxLength={4000}
              rows={3}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {(localError || error) && (
            <div className="msg error" role="alert">
              {localError ?? error}
            </div>
          )}
        </div>

        <div className="modal-foot">
          {editing && (
            <button
              className={`btn ghost-danger${confirmDelete ? " on" : ""}`}
              type="button"
              onClick={remove}
              disabled={busy}
            >
              {confirmDelete ? "Delete for good?" : "Delete"}
            </button>
          )}
          <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn" type="button" onClick={submit} disabled={busy || profiles.length === 0}>
            {busy ? "Saving…" : editing ? "Save changes" : "Create event"}
          </button>
        </div>
      </div>
    </div>
  );
}
