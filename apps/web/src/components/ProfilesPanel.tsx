"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Avatar from "./Avatar";
import Dropdown from "./Dropdown";
import SiteLogo from "./SiteLogo";
import Switch from "./Switch";
import { useAction } from "@/lib/client";
import {
  BIDDER_LABEL,
  BIDDER_STATUSES,
  BIDDER_TONE,
  PROFILE_USES,
  profileUse,
  type ProfileUse,
  STATUS_LABEL,
  STATUS_TONE,
  STATUSES,
  USE_LABEL,
  USE_TONE,
} from "@/lib/training";
import type { BidderStatus, ProfileAssignee, ProfilePerson, TeamProfile, TrainingSite, TrainingStatus, User } from "@/lib/types";



type View = "cards" | "list";

/* Format a phone number as it's typed, without ever rejecting what was typed:
   profiles hold international numbers and extensions, and a formatter that
   fights the typist is worse than none.

   A plain 10-digit US number (optionally with a leading 1) gets the familiar
   (555) 010-0100 grouping. Anything else — a leading +, a longer number, any
   other shape — is passed through untouched apart from collapsing runs of
   spaces, so existing values and non-US numbers keep working. */
export function formatPhone(raw: string): string {
  if (raw.trim().startsWith("+")) return raw.replace(/\s{2,}/g, " ");
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  // Only reformat once it can't be anything but a US-shaped number.
  if (local.length > 10) return raw.replace(/\s{2,}/g, " ");
  if (local.length > 6) return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  if (local.length > 3) return `(${local.slice(0, 3)}) ${local.slice(3)}`;
  if (local.length > 0 && /[()\- ]/.test(raw)) return `(${local}`;
  return raw;
}

const blank = {
  full_name: "",
  email: "",
  phone: "",
  linkedin_url: "",
  notes: "",
  assignee_ids: [] as number[],
  bidder_id: null as number | null,
  bidder_status: "none" as BidderStatus,
  // A new profile is for both until someone says otherwise.
  for_job: true,
  for_ai_training: true,
};

export default function ProfilesPanel({
  profiles,
  sites,
  people,
  me,
}: {
  profiles: TeamProfile[];
  sites: TrainingSite[];
  people: ProfilePerson[];
  me: User;
}) {
  const { error, busy, run, setError } = useAction();
  const [view, setView] = useState<View>("cards");
  const [query, setQuery] = useState("");
  /* 0 = everyone, -1 = unassigned only, otherwise a user id. Kept as a number
     so it can feed Dropdown<number> like the other pickers. */
  const [assignee, setAssignee] = useState<number>(0);
  /* "" means no filter; otherwise one of the derived profile uses. */
  const [use, setUse] = useState<ProfileUse | "">("");
  /* 0 = any bidder, -1 = profiles with no bidder, otherwise a user id. The
     same shape as the assignee filter above it. */
  const [bidder, setBidder] = useState<number>(0);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState(blank);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return profiles.filter((p) => {
      if (use && profileUse(p) !== use) return false;
      if (assignee === -1 && p.assignees.length > 0) return false;
      if (assignee > 0 && !p.assignees.some((a) => a.user_id === assignee)) return false;
      if (bidder === -1 && p.bidder_id !== null) return false;
      if (bidder > 0 && p.bidder_id !== bidder) return false;
      if (!q) return true;
      return (
        p.full_name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        p.assignees.some((a) => a.name.toLowerCase().includes(q))
      );
    });
  }, [profiles, query, assignee, use, bidder]);

  /* Only people actually assigned to something are worth offering — a list of
     every user would mostly be options that match nothing. */
  const assigneeOptions = useMemo(() => {
    const seen = new Map<number, ProfileAssignee>();
    for (const p of profiles) for (const a of p.assignees) seen.set(a.user_id, a);
    return [...seen.values()].sort((x, y) => x.name.localeCompare(y.name));
  }, [profiles]);

  /* How the profiles currently on screen break down. Counted from `shown`,
     not `profiles`, so the line describes what the filters left rather than
     contradicting them. A profile used for both counts toward Job and AI
     training alike — the question is what each is used for, not which
     bucket it falls in, so these deliberately overlap and do not sum to the
     total. */
  /* The accounts flagged is_bidder — the dedicated bidder users, as opposed
     to any colleague who happens to be named on a profile. */
  const bidderIds = useMemo(
    () => new Set(people.filter((x) => x.is_bidder).map((x) => x.id)),
    [people],
  );

  const counts = useMemo(() => {
    let job = 0;
    let training = 0;
    let bidding = 0;
    for (const p of shown) {
      if (p.for_job) job += 1;
      if (p.for_ai_training) training += 1;
      /* Profiles a bidder account is actively bidding on. Both halves
         matter: 'assigned' means the work is owned but not yet in flight,
         and a profile can name an ordinary colleague rather than one of the
         bidder accounts. Neither counts here, so this is 0 until a real
         bidder is mid-bid. */
      if (p.bidder_status === "bidding" && p.bidder_id !== null && bidderIds.has(p.bidder_id)) {
        bidding += 1;
      }
    }
    return { job, training, bidding, total: shown.length };
  }, [shown, bidderIds]);

  /* Only people actually set as a bidder somewhere, for the same reason as
     assigneeOptions: offering every user would mostly list dead options. */
  const bidderOptions = useMemo(() => {
    const seen = new Map<number, NonNullable<TeamProfile["bidder"]>>();
    for (const p of profiles) if (p.bidder) seen.set(p.bidder.user_id, p.bidder);
    return [...seen.values()].sort((x, y) => x.name.localeCompare(y.name));
  }, [profiles]);

  /* The editor renders above the grid, so clicking Edit on a card further
     down the page changes something off-screen and reads as a dead button.
     Scroll it into view once it exists — in an effect rather than the click
     handler, because the panel is not in the DOM until this renders.
     Focus goes with it, so keyboard and screen-reader users land there too. */
  useEffect(() => {
    if (editing === null) return;
    const el = editorRef.current;
    if (!el) return;
    /* Focus the first field rather than the panel: the panel is not
       interactive, and this puts the caret where typing should go.
       preventScroll, because the scroll below is the one that should win. */
    el.querySelector<HTMLInputElement>("#pf-name")?.focus({ preventScroll: true });
    /* Wait a frame before scrolling. Inserting the editor reflows the grid
       below it, and a smooth scroll started in the same frame aims at the
       pre-reflow position and lands somewhere else entirely. */
    const id = requestAnimationFrame(() => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      // A little headroom so the panel is not flush against the viewport.
      window.scrollTo({ top: Math.max(0, top - 12), behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [editing]);

  const openNew = () => {
    setError(null);
    setForm({ ...blank, assignee_ids: [me.id] });
    setEditing("new");
  };

  const openEdit = (p: TeamProfile) => {
    setError(null);
    setForm({
      full_name: p.full_name,
      email: p.email,
      phone: p.phone,
      linkedin_url: p.linkedin_url,
      notes: p.notes,
      assignee_ids: p.assignees.map((a) => a.user_id),
      bidder_id: p.bidder_id,
      bidder_status: p.bidder_status,
      for_job: p.for_job,
      for_ai_training: p.for_ai_training,
    });
    setEditing(p.id);
  };

  /* Bidding is the job side of a profile: a bidder bids for work the profile
     is put forward for. A profile used only for AI training has nothing to
     bid on, so its bidder controls are disabled rather than hidden — hiding
     them would make an already-set bidder vanish without explanation. */
  const biddingOff = form.for_ai_training && !form.for_job;

  const save = async () => {
    if (!form.full_name.trim()) {
      setError("A profile needs a name.");
      return;
    }
    const ok =
      editing === "new"
        ? await run("POST", "/profiles", form)
        : await run("PATCH", `/profiles/${editing}`, form);
    if (ok) setEditing(null);
  };

  const remove = async (p: TeamProfile) => {
    if (await run("DELETE", `/profiles/${p.id}`)) setEditing(null);
  };

  /* A profile has one assignee. The API still stores a list — the join
     table is many-to-many — so this writes a one- or zero-element array
     rather than changing the schema for a UI rule. */
  const pickAssignee = (id: number) =>
    setForm((f) => ({
      ...f,
      assignee_ids: id === 0 ? [] : [id],
    }));


  // Only offer people who aren't assigned yet, so the list shrinks as you pick.
  const assigneeId = form.assignee_ids[0] ?? 0;
  /* Any user can be named the bidder on a profile — it's a job on this profile,
     not a property of the account. Users flagged `is_bidder` on Admin › Users
     sort first, since they're the usual picks. */
  const bidders = [...people].sort(
    (a, b) => Number(b.is_bidder) - Number(a.is_bidder) || a.id - b.id,
  );

  const setAccount = (profileId: number, siteId: number, status: TrainingStatus) =>
    run("PUT", "/training-accounts", { profile_id: profileId, site_id: siteId, status });

  const removeAccount = (accountId: number) => run("DELETE", `/training-accounts/${accountId}`);

  return (
    <>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      <div className="profiles-bar">
        <div className="searchbar table-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.6-3.6" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search profiles"
            aria-label="Search profiles"
          />
        </div>
        <div className="profiles-use">
          <Dropdown<ProfileUse | "">
            value={use}
            ariaLabel="Filter by what the profile is used for"
            onChange={setUse}
            /* "All uses" clears the filter; "Both" narrows to profiles used
               for both purposes, excluding the job-only and training-only
               ones. They read similarly but are not the same filter. */
            options={[
              { value: "", label: "All uses" },
              ...PROFILE_USES.map((u) => ({
                value: u,
                label: USE_LABEL[u],
                media: <span className={`dd-dot tone-${USE_TONE[u]}`} />,
              })),
            ]}
          />
        </div>
        <div className="profiles-assignee">
          <Dropdown<number>
            value={assignee}
            ariaLabel="Filter by assignee"
            onChange={setAssignee}
            options={[
              { value: 0, label: "All assignees" },
              { value: -1, label: "Unassigned" },
              ...assigneeOptions.map((a) => ({
                value: a.user_id,
                label: a.name,
                media: <Avatar name={a.name} email={a.email} src={a.avatar} size={20} />,
              })),
            ]}
          />
        </div>
        <div className="profiles-assignee">
          <Dropdown<number>
            value={bidder}
            ariaLabel="Filter by bidder"
            onChange={setBidder}
            options={[
              { value: 0, label: "All bidders" },
              { value: -1, label: "No bidder" },
              ...bidderOptions.map((b) => ({
                value: b.user_id,
                label: b.name,
                media: <Avatar name={b.name} email={b.email} src={b.avatar} size={20} />,
              })),
            ]}
          />
        </div>
        <div className="viewswitch" role="group" aria-label="View">
          <button
            type="button"
            className={view === "cards" ? "on" : ""}
            onClick={() => setView("cards")}
            aria-pressed={view === "cards"}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
              <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
              <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
              <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
            </svg>
            Cards
          </button>
          <button
            type="button"
            className={view === "list" ? "on" : ""}
            onClick={() => setView("list")}
            aria-pressed={view === "list"}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 6.5h16M4 12h16M4 17.5h16" />
            </svg>
            List
          </button>
        </div>
        <button className="btn" type="button" onClick={openNew} disabled={busy}>
          New profile
        </button>
      </div>

      {/* What the filters left, broken down. Job and AI training overlap: a
          profile used for both is counted in each, so these do not sum to
          the total. */}
      <div className="profiles-counts chips">
        <span className="chip">
          {counts.total} {counts.total === 1 ? "profile" : "profiles"}
        </span>
        <span className={`chip status-${USE_TONE.job}`}>Job: {counts.job}</span>
        <span className={`chip status-${USE_TONE.training}`}>AI training: {counts.training}</span>
        <span className={`chip status-${BIDDER_TONE.bidding}`}>Bidding: {counts.bidding}</span>
      </div>

      {editing !== null && (
        <div className="panel profile-editor" ref={editorRef}>
          <h2 className="panel-title">{editing === "new" ? "New profile" : "Edit profile"}</h2>
          <div className="two">
            <div>
              <label htmlFor="pf-name">Full name</label>
              <input
                id="pf-name"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                placeholder="Jane Doe"
              />
            </div>
            <div>
              <label htmlFor="pf-email">Email</label>
              <input
                id="pf-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="jane@example.com"
              />
            </div>
          </div>

          {/* Phone, what the profile is used for, and LinkedIn on one row:
              the first two are short, the URL needs the remaining width. */}
          <div className="profile-row3">
            <div>
              <label htmlFor="pf-phone">Phone</label>
              <input
                id="pf-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                className="input-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: formatPhone(e.target.value) })}
                placeholder="(555) 010-0100"
              />
            </div>

            {/* What this profile is for. Both are usual; clearing AI training
                takes it off that board instead of leaving an empty column. */}
            <div>
              <label id="pf-use-label" htmlFor="pf-use-job">
                Used for
              </label>
              {/* role=group + aria-labelledby gives the pair the accessible
                  name a <fieldset>/<legend> would, while styling like the
                  label-and-field pairs either side of it. */}
              <div className="purpose" role="group" aria-labelledby="pf-use-label">
                <span className="purpose-opt">
                  <Switch
                    id="pf-use-job"
                    checked={form.for_job}
                    onChange={(for_job) =>
                      setForm((f) => {
                        /* Turning a profile into training-only disables
                           bidding, so clear the bidder rather than leave one
                           set behind a control the user cannot reach. */
                        const drop = !for_job && f.for_ai_training;
                        return {
                          ...f,
                          for_job,
                          bidder_id: drop ? null : f.bidder_id,
                          bidder_status: drop ? ("none" as BidderStatus) : f.bidder_status,
                        };
                      })
                    }
                  />
                  <label htmlFor="pf-use-job">Job</label>
                </span>
                <span className="purpose-opt">
                  <Switch
                    id="pf-use-training"
                    checked={form.for_ai_training}
                    onChange={(for_ai_training) =>
                      setForm((f) => {
                        const drop = for_ai_training && !f.for_job;
                        return {
                          ...f,
                          for_ai_training,
                          bidder_id: drop ? null : f.bidder_id,
                          bidder_status: drop ? ("none" as BidderStatus) : f.bidder_status,
                        };
                      })
                    }
                  />
                  <label htmlFor="pf-use-training">AI training</label>
                </span>
              </div>
            </div>

            <div>
              <label htmlFor="pf-li">LinkedIn URL</label>
              <input
                id="pf-li"
                value={form.linkedin_url}
                onChange={(e) => setForm({ ...form, linkedin_url: e.target.value })}
                placeholder="https://linkedin.com/in/jane"
              />
            </div>
          </div>

          <label htmlFor="pf-notes">Notes</label>
          <textarea
            id="pf-notes"
            rows={3}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Anything worth remembering about this profile."
          />

          {/* Assignee, bidder and bidder status line up in one row: they are
              the three "who is on this" choices. Pick an assignee from the
              dropdown, one at a time; chosen people show below as removable
              pills. A multiple-select hides the unpicked names behind a
              scroll and is awkward to deselect. */}
          <div className="people-row">
            <div>
              <label htmlFor="pf-assignee">Assigned to</label>
              <Dropdown<number>
                id="pf-assignee"
                value={assigneeId}
                placeholder="Nobody"
                ariaLabel="Assigned to"
                onChange={pickAssignee}
                options={[
                  { value: 0, label: "Nobody" },
                  ...people.map((p) => ({
                    value: p.id,
                    label: p.name || p.email,
                    hint: p.name ? p.email : undefined,
                    media: <Avatar name={p.name} email={p.email} src={p.avatar} size={22} />,
                  })),
                ]}
              />
            </div>

            <div>
              <label htmlFor="pf-bidder">Bidder</label>
              <Dropdown<number>
                id="pf-bidder"
                value={form.bidder_id ?? 0}
                placeholder="No bidder"
                ariaLabel="Assign a bidder"
                disabled={biddingOff}
                onChange={(id) =>
                  setForm((f) => ({
                    ...f,
                    bidder_id: id === 0 ? null : id,
                    // Clearing the bidder clears the status with it; naming
                    // one starts the work off as assigned.
                    bidder_status:
                      id === 0 ? "none" : f.bidder_status === "none" ? "assigned" : f.bidder_status,
                  }))
                }
                options={[
                  { value: 0, label: "No bidder" },
                  ...bidders.map((p) => ({
                    value: p.id,
                    label: p.name || p.email,
                    // Flagged bidders are called out; anyone else is still pickable.
                    hint: p.is_bidder ? "Bidder" : p.name ? p.email : undefined,
                    media: <Avatar name={p.name} email={p.email} src={p.avatar} size={22} />,
                  })),
                ]}
              />
            </div>
            <div>
              <label htmlFor="pf-bidder-status">Bidder status</label>
              <Dropdown<BidderStatus>
                id="pf-bidder-status"
                value={form.bidder_status}
                tone={BIDDER_TONE[form.bidder_status]}
                ariaLabel="Bidder status"
                disabled={biddingOff || !form.bidder_id}
                onChange={(st) => setForm((f) => ({ ...f, bidder_status: st }))}
                options={BIDDER_STATUSES.map((st) => ({
                  value: st,
                  label: BIDDER_LABEL[st],
                  media: <span className={`dd-dot tone-${BIDDER_TONE[st]}`} />,
                }))}
              />
              {/* A disabled control with no reason reads as broken. */}
              {biddingOff && (
                <p className="muted small field-hint">Bidding applies to profiles used for Job.</p>
              )}
            </div>
          </div>

          <div className="row" style={{ marginTop: 14, gap: 8 }}>
            <button className="btn" type="button" onClick={save} disabled={busy}>
              {editing === "new" ? "Create profile" : "Save changes"}
            </button>
            <button className="btn secondary" type="button" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </button>
            {editing !== "new" && (
              <button
                className="btn danger"
                type="button"
                style={{ marginLeft: "auto" }}
                onClick={() => {
                  const p = profiles.find((x) => x.id === editing);
                  if (p) remove(p);
                }}
                disabled={busy}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="empty">
          {profiles.length === 0 ? "No profiles yet. Create one to get started." : "No profiles match that search."}
        </div>
      ) : view === "cards" ? (
        <div className="profile-grid">
          {shown.map((p) => (
            <article className="panel profile-card" key={p.id}>
              <header>
                <h3>{p.full_name}</h3>
                <UseTag profile={p} />
                <button
                  className="icon-action"
                  type="button"
                  onClick={() => openEdit(p)}
                  disabled={busy}
                  aria-label={`Edit ${p.full_name}`}
                  title="Edit"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 20h8" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7.5 18.5l-4 1 1-4Z" />
                  </svg>
                </button>
              </header>
              <dl className="profile-fields">
                {p.email && (
                  <div>
                    <dt>Email</dt>
                    <dd>{p.email}</dd>
                  </div>
                )}
                {p.phone && (
                  <div>
                    <dt>Phone</dt>
                    <dd>{p.phone}</dd>
                  </div>
                )}
                {p.linkedin_url && (
                  <div>
                    <dt>LinkedIn</dt>
                    <dd>
                      <a href={p.linkedin_url} target="_blank" rel="noreferrer noopener">
                        Open profile
                      </a>
                    </dd>
                  </div>
                )}
              </dl>

              <dl className="profile-people">
                <div>
                  <dt>Assigned to</dt>
                  <dd>
                    {p.assignees.length === 0 ? (
                      <span className="muted">Nobody</span>
                    ) : (
                      p.assignees.map((a) => (
                        <span className="assignee" key={a.user_id} title={a.email}>
                          <Avatar name={a.name} email={a.email} src={a.avatar} size={22} />
                          {a.name}
                        </span>
                      ))
                    )}
                  </dd>
                </div>
                {/* Bidding only applies to the job side, so a training-only
                    profile says so rather than showing an empty bidder. */}
                <div>
                  <dt>Bidder</dt>
                  <dd>
                    {!p.for_job ? (
                      <span className="muted">Not for job</span>
                    ) : p.bidder ? (
                      <BidderTag profile={p} />
                    ) : (
                      <span className="muted">Nobody</span>
                    )}
                  </dd>
                </div>
              </dl>

              <AccountRow
                profile={p}
                sites={sites}
                busy={busy}
                onSet={setAccount}
                onRemove={removeAccount}
              />
            </article>
          ))}
        </div>
      ) : (
        <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
          <table className="profiles-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Used for</th>
                <th>Assigned to</th>
                <th>AI training</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.full_name}</strong>
                    {p.linkedin_url && (
                      <>
                        <br />
                        <a className="muted small" href={p.linkedin_url} target="_blank" rel="noreferrer noopener">
                          LinkedIn
                        </a>
                      </>
                    )}
                  </td>
                  <td>
                    {p.email || <span className="muted">—</span>}
                    {p.phone && (
                      <>
                        <br />
                        <span className="muted small">{p.phone}</span>
                      </>
                    )}
                  </td>
                  <td>
                    <UseTag profile={p} />
                  </td>
                  <td>
                    {p.assignees.length === 0 ? (
                      <div className="profile-assignees">
                        <span className="muted">Unassigned</span>
                        <BidderTag profile={p} />
                      </div>
                    ) : (
                      <div className="profile-assignees">
                        {p.assignees.map((a) => (
                          <span className="assignee" key={a.user_id} title={a.email}>
                            <Avatar name={a.name} email={a.email} src={a.avatar} size={20} />
                            {a.name}
                          </span>
                        ))}
                        <BidderTag profile={p} />
                      </div>
                    )}
                  </td>
                  <td>
                    {p.accounts.length === 0 ? (
                      <span className="muted">None</span>
                    ) : (
                      <div className="chips">
                        {p.accounts.map((a) => (
                          <span className={`chip status-${STATUS_TONE[a.status]}`} key={a.id}>
                            {a.site_name}: {STATUS_LABEL[a.status]}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="icon-action"
                      type="button"
                      onClick={() => openEdit(p)}
                      disabled={busy}
                      aria-label={`Edit ${p.full_name}`}
                      title="Edit"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 20h8" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7.5 18.5l-4 1 1-4Z" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* Per-profile AI training accounts. Only sites this profile actually has an
   account on are listed — the rest sit behind "Add a site", so a profile with
   two accounts doesn't render a row for every site in the org. */
function AccountRow({
  profile,
  sites,
  busy,
  onSet,
  onRemove,
}: {
  profile: TeamProfile;
  sites: TrainingSite[];
  busy: boolean;
  onSet: (profileId: number, siteId: number, status: TrainingStatus) => void;
  onRemove: (accountId: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  const byId = new Map(profile.accounts.map((a) => [a.site_id, a]));
  const available = sites.filter((s) => !byId.has(s.id));

  if (sites.length === 0) {
    return (
      <p className="muted small accounts-empty">
        No AI training sites yet. Add one on the AI Training page.
      </p>
    );
  }

  /* This profile is not used for AI training, so there is nothing to add to.
     Any accounts it already has stay visible and removable — hiding them
     would strand data the profile still holds — but the add button goes. */
  if (!profile.for_ai_training && profile.accounts.length === 0) {
    return <p className="muted small accounts-empty">Not used for AI training.</p>;
  }

  return (
    <div className="accounts">
      {/* No text for an empty list: the add button below says what to do.
          The rows scroll inside a capped box; the add button sits outside it
          so it stays reachable however many accounts a profile has. */}
      {/* Read-only chips reading "Site: Status", the same format the list
          view uses. Statuses are changed on the AI Training board; the x
          still removes the account from this profile. */}
      <div className="profile-accounts chips">
        {profile.accounts.map((a) => (
          <span className={`account-chip chip status-${STATUS_TONE[a.status]}`} key={a.id}>
            <span className="account-chip-text">
              {a.site_name}: {STATUS_LABEL[a.status]}
            </span>
            <button
              type="button"
              className="account-remove"
              onClick={() => onRemove(a.id)}
              disabled={busy}
              aria-label={`Remove ${a.site_name} from ${profile.full_name}`}
              title="Remove this account"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </span>
        ))}
      </div>

      {adding ? (
        <div className="account-add">
          <Dropdown<number>
            value=""
            placeholder="Pick a site…"
            ariaLabel={`Add an AI training site for ${profile.full_name}`}
            disabled={busy}
            onChange={(siteId) => {
              // A new account starts at the first status; change it after.
              onSet(profile.id, siteId, STATUSES[0]);
              setAdding(false);
            }}
            options={available.map((s) => ({
              value: s.id,
              label: s.name,
              media: <SiteLogo name={s.name} iconUrl={s.icon_url} siteUrl={s.url} size={20} />,
            }))}
          />
          <button className="btn secondary small" type="button" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      ) : available.length > 0 && profile.for_ai_training ? (
        <button className="btn secondary small account-addbtn" type="button" onClick={() => setAdding(true)} disabled={busy}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add AI training site
        </button>
      ) : null}
    </div>
  );
}

/* The bidder assigned to a profile, with their status. Renders nothing when
   no bidder is set, so cards without one look as they did before. */
/* What the profile is used for, as a chip. Always shown rather than only
   when unusual: on a board of mixed profiles the reader should not have to
   infer "both" from the absence of a badge. */
function UseTag({ profile }: { profile: TeamProfile }) {
  const use = profileUse(profile);
  return <span className={`chip status-${USE_TONE[use]}`}>{USE_LABEL[use]}</span>;
}

function BidderTag({ profile }: { profile: TeamProfile }) {
  if (!profile.bidder) return null;
  const tone = BIDDER_TONE[profile.bidder_status];
  return (
    <span className={`assignee bidder-tag status-${tone}`} title={`Bidder: ${profile.bidder.email}`}>
      <Avatar name={profile.bidder.name} email={profile.bidder.email} src={profile.bidder.avatar} size={20} />
      {profile.bidder.name}
      <span className="bidder-state">{BIDDER_LABEL[profile.bidder_status]}</span>
    </span>
  );
}
