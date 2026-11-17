"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAction } from "@/lib/client";
import { CONTACT_STATUSES, CONTACT_STATUS_LABEL, CONTACT_STATUS_TONE } from "@/lib/contacts";
import type { Contact, ContactPage, ContactStatus, ProfilePerson, User } from "@/lib/types";
import Avatar from "./Avatar";
import ConfirmDialog from "./ConfirmDialog";
import ContactsCsv from "./ContactsCsv";
import Dropdown from "./Dropdown";
import RichNoteEditor from "./RichNoteEditor";

type Form = {
  name: string;
  job_title: string;
  location: string;
  email: string;
  phone: string;
  linkedin_url: string;
  github_url: string;
  portfolio_url: string;
  note: string;
  status: ContactStatus;
  assignee_id: number | null;
};

const blank: Form = {
  name: "",
  job_title: "",
  location: "",
  email: "",
  phone: "",
  linkedin_url: "",
  github_url: "",
  portfolio_url: "",
  note: "",
  status: "none",
  assignee_id: null,
};

const formOf = (c: Contact): Form => ({
  name: c.name,
  job_title: c.job_title,
  location: c.location,
  email: c.email,
  phone: c.phone,
  linkedin_url: c.linkedin_url,
  github_url: c.github_url,
  portfolio_url: c.portfolio_url,
  note: c.note,
  status: c.status,
  assignee_id: c.assignee_id,
});

/* The Contacts page: a table, filters above it, and one modal for adding and
   editing. Everyone can add and edit; only an admin sees Delete.

   One page at a time. The filters and the page number live in the URL; the
   server applies them (it is the only place the encrypted fields can be
   searched) and sends just that page. Saves refresh the page in place, so
   the same filters and page come back. */
type Filters = { q: string; status: ContactStatus | ""; assignee: number; page: number };

export default function ContactsPanel({
  data,
  filters,
  people,
  me,
}: {
  data: ContactPage;
  filters: Filters;
  people: ProfilePerson[];
  me: User;
}) {
  const contacts = data.rows;
  const router = useRouter();
  const pathname = usePathname();
  const { error, setError, busy, run } = useAction();
  // The search box is typed into locally and sent after a short pause.
  const [query, setQuery] = useState(filters.q);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [confirming, setConfirming] = useState<Contact | null>(null);
  const modal = useRef<HTMLDivElement>(null);

  const current = typeof editing === "number" ? (contacts.find((c) => c.id === editing) ?? null) : null;

  /* Writes the filters into the URL. Any change of filter starts again at
     page 1; only the pager moves between pages. */
  const go = (next: Partial<Filters>) => {
    const f = { ...filters, q: query, page: 1, ...next };
    const qs = new URLSearchParams();
    if (f.q.trim()) qs.set("q", f.q.trim());
    if (f.status) qs.set("status", f.status);
    if (f.assignee) qs.set("assignee", String(f.assignee));
    if (f.page > 1) qs.set("page", String(f.page));
    const s = qs.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  /* The search applies 350ms after the last keystroke, not on every one.
     It is compared with the last search SENT, not with the URL: the URL
     lags while a page loads, and comparing against it meant clearing the box
     mid-load was taken for "no change" — and the stale search then landed. */
  const sent = useRef(filters.q);
  useEffect(() => {
    if (query.trim() === sent.current.trim()) return;
    const t = setTimeout(() => {
      sent.current = query;
      go({ q: query });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const pages = Math.max(1, Math.ceil(data.total / data.per_page));
  const firstRow = data.total ? (data.page - 1) * data.per_page + 1 : 0;
  const lastRow = Math.min(data.page * data.per_page, data.total);
  const filtered = Boolean(filters.q || filters.status || filters.assignee);
  // The export takes the same filters as the table, so it downloads what is shown.
  const exportQuery = new URLSearchParams(
    Object.entries({ q: filters.q, status: filters.status, assignee: filters.assignee ? String(filters.assignee) : "" })
      .filter(([, v]) => v) as [string, string][],
  ).toString();

  /* Focus starts on the name. Escape closes — except while a dropdown in
     the modal is open, where Escape belongs to the dropdown. */
  useEffect(() => {
    if (editing === null) return;
    modal.current?.querySelector<HTMLInputElement>("#ct-name")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".dd-sheet")) return;
      setEditing(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing]);

  const openNew = () => {
    setError(null);
    setForm(blank);
    setEditing("new");
  };
  const openEdit = (c: Contact) => {
    setError(null);
    setForm(formOf(c));
    setEditing(c.id);
  };

  const save = async () => {
    if (!form.name.trim()) {
      setError("A contact needs a name.");
      return;
    }
    let ok: boolean;
    if (editing === "new") {
      ok = await run("POST", "/contacts", form);
    } else if (current) {
      /* Only what changed is sent. Each field is encrypted separately, so a
         field nobody touched — including one the server could not decrypt —
         is left exactly as it is stored. */
      const before = formOf(current);
      const changed = Object.fromEntries(
        (Object.keys(form) as (keyof Form)[])
          .filter((k) => form[k] !== before[k])
          .map((k) => [k, form[k]]),
      );
      ok = Object.keys(changed).length === 0 || (await run("PATCH", `/contacts/${current.id}`, changed));
    } else {
      ok = false;
    }
    if (ok) setEditing(null);
  };

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const field = (k: keyof Form, label: string, type = "text", placeholder = "") => (
    <div>
      <label htmlFor={`ct-${k}`}>{label}</label>
      <input
        id={`ct-${k}`}
        type={type}
        value={form[k] as string}
        onChange={(e) => set(k, e.target.value as never)}
        placeholder={placeholder}
      />
    </div>
  );

  const assigneeOptions = [
    { value: 0, label: "Unassigned" },
    ...people.map((p) => ({
      value: p.id,
      label: p.name,
      media: <Avatar name={p.name} email={p.email} src={p.avatar} size={20} />,
    })),
  ];

  return (
    <>
      {error && editing === null && (
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
            placeholder="Search name, title, location, email or phone"
            aria-label="Search contacts"
          />
        </div>
        <div className="profiles-use">
          <Dropdown<ContactStatus | "">
            value={filters.status}
            ariaLabel="Filter by status"
            onChange={(v) => go({ status: v })}
            options={[
              { value: "", label: "All statuses" },
              ...CONTACT_STATUSES.map((s) => ({
                value: s,
                label: CONTACT_STATUS_LABEL[s],
                media: <span className={`dd-dot tone-${CONTACT_STATUS_TONE[s]}`} />,
              })),
            ]}
          />
        </div>
        <div className="profiles-assignee">
          <Dropdown<number>
            value={filters.assignee}
            ariaLabel="Filter by assignee"
            onChange={(v) => go({ assignee: v })}
            options={[
              { value: 0, label: "All assignees" },
              { value: -1, label: "Unassigned" },
              ...people.map((p) => ({
                value: p.id,
                label: p.name,
                media: <Avatar name={p.name} email={p.email} src={p.avatar} size={20} />,
              })),
            ]}
          />
        </div>
        {/* Lays itself out in this bar: its buttons push right, and its
            messages drop onto a full-width line underneath. */}
        <ContactsCsv isAdmin={me.role === "admin"} exportQuery={exportQuery} />
        <button className="btn" type="button" onClick={openNew}>
          New contact
        </button>
      </div>

      <p className="muted small" style={{ margin: "0 0 10px" }}>
        {filtered
          ? `${data.total} of ${data.all} contacts match`
          : `${data.all} contact${data.all === 1 ? "" : "s"}`}
      </p>

      {data.all === 0 ? (
        <div className="empty">No contacts yet. Add the first one with New contact.</div>
      ) : data.total === 0 ? (
        <div className="empty">No contacts match those filters.</div>
      ) : (
        <div className="panel tablewrap" style={{ padding: 0 }}>
          <table className="contacts-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Job title</th>
                <th>Location</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Links</th>
                <th>Status</th>
                <th>Assignee</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td>
                    <button type="button" className="contact-name" onClick={() => openEdit(c)}>
                      {c.name || <span className="muted">(name unreadable)</span>}
                    </button>
                  </td>
                  <td>{c.job_title || <span className="muted">—</span>}</td>
                  <td>{c.location || <span className="muted">—</span>}</td>
                  <td>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : <span className="muted">—</span>}</td>
                  <td className="input-phone">{c.phone || <span className="muted">—</span>}</td>
                  <td>
                    <span className="contact-links">
                      {c.linkedin_url && <ExternalLink href={c.linkedin_url} label="LinkedIn" />}
                      {c.github_url && <ExternalLink href={c.github_url} label="GitHub" />}
                      {c.portfolio_url && <ExternalLink href={c.portfolio_url} label="Portfolio" />}
                      {!c.linkedin_url && !c.github_url && !c.portfolio_url && <span className="muted">—</span>}
                    </span>
                  </td>
                  {/* Status and assignee change right here, without opening the
                      contact. Keyed on the stored values, so after the save
                      the page re-reads and these start from the new ones. */}
                  <ContactQuickEdit
                    key={`${c.id}:${c.status}:${c.assignee_id ?? 0}`}
                    contact={c}
                    people={people}
                    onSave={(patch) => run("PATCH", `/contacts/${c.id}`, patch)}
                    disabled={busy}
                  />
                  <td>
                    <span className="contact-actions">
                      <button
                        className="icon-action"
                        type="button"
                        onClick={() => openEdit(c)}
                        aria-label={`Edit ${c.name}`}
                        title="Edit"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M12 20h8" />
                          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7.5 18.5l-4 1 1-4Z" />
                        </svg>
                      </button>
                      {me.role === "admin" && (
                        <button
                          className="icon-action danger"
                          type="button"
                          onClick={() => setConfirming(c)}
                          disabled={busy}
                          aria-label={`Delete ${c.name}`}
                          title="Delete"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M4 7h16" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
                            <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                          </svg>
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="contacts-pager" aria-label="Pages">
          <span className="muted small">
            {firstRow}–{lastRow} of {data.total}
          </span>
          <button
            className="btn secondary small"
            type="button"
            disabled={data.page <= 1}
            onClick={() => go({ q: filters.q, page: data.page - 1 })}
            aria-label="Previous page"
          >
            ← Previous
          </button>
          <span className="small">
            Page {data.page} of {pages}
          </span>
          <button
            className="btn secondary small"
            type="button"
            disabled={data.page >= pages}
            onClick={() => go({ q: filters.q, page: data.page + 1 })}
            aria-label="Next page"
          >
            Next →
          </button>
        </nav>
      )}

      {editing !== null && (
        <div className="modal-backdrop">
          <div
            className="modal modal-card contact-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ct-title"
            ref={modal}
          >
            <div className="modal-head">
              <h2 id="ct-title">{editing === "new" ? "New contact" : form.name || "Edit contact"}</h2>
              <div className="card-actions">
                <button className="icon-btn" type="button" aria-label="Close" onClick={() => setEditing(null)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="modal-body">
              {error && (
                <div className="banner error" role="alert">
                  {error}
                </div>
              )}
              {current?.locked && (
                <div className="banner note">
                  Some of this contact&apos;s details were encrypted with a key this server no longer has, so they
                  show as empty. They are kept as they are unless you type a new value.
                </div>
              )}

              <div className="contact-form">
                <div>
                  <label htmlFor="ct-name">Name</label>
                  <input
                    id="ct-name"
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="Jane Doe"
                  />
                </div>
                {field("job_title", "Job title", "text", "Senior engineer")}
                {field("location", "Location", "text", "Austin, TX")}
                <div>
                  <label htmlFor="ct-status">Status</label>
                  <Dropdown<ContactStatus>
                    id="ct-status"
                    ariaLabel="Status"
                    value={form.status}
                    onChange={(v) => set("status", v)}
                    options={CONTACT_STATUSES.map((s) => ({
                      value: s,
                      label: CONTACT_STATUS_LABEL[s],
                      media: <span className={`dd-dot tone-${CONTACT_STATUS_TONE[s]}`} />,
                    }))}
                  />
                </div>
                {field("email", "Gmail address", "email", "jane@gmail.com")}
                {field("phone", "Phone number", "tel", "+1 555 123 4567")}
              </div>

              <div className="contact-form three">
                {field("linkedin_url", "LinkedIn URL", "url", "https://linkedin.com/in/…")}
                {field("github_url", "GitHub URL", "url", "https://github.com/…")}
                {field("portfolio_url", "Portfolio URL", "url", "https://…")}
              </div>

              <div className="contact-form">
                <div>
                  <label htmlFor="ct-assignee">Assignee</label>
                  <Dropdown<number>
                    id="ct-assignee"
                    ariaLabel="Assignee"
                    value={form.assignee_id ?? 0}
                    onChange={(v) => set("assignee_id", v === 0 ? null : v)}
                    options={assigneeOptions}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="ct-note">Note</label>
                <RichNoteEditor
                  id="ct-note"
                  value={form.note}
                  onChange={(v) => set("note", v)}
                  maxLength={4000}
                  placeholder="Anything worth remembering about this contact."
                />
              </div>

              <p className="muted small" style={{ margin: "10px 0 0" }}>
                Every detail of a contact is stored encrypted.
              </p>
            </div>

            <div className="modal-foot">
              {/* Delete is admin-only, and sits hard left, away from Save. */}
              {current && me.role === "admin" && (
                <button className="btn danger" type="button" onClick={() => setConfirming(current)} disabled={busy}>
                  Delete
                </button>
              )}
              <button
                className="btn secondary"
                type="button"
                style={{ marginLeft: "auto" }}
                onClick={() => setEditing(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button className="btn" type="button" onClick={save} disabled={busy}>
                {editing === "new" ? "Add contact" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title={`Delete ${confirming.name || "this contact"}?`}
          message="The contact and everything recorded about them is removed for everyone. This cannot be undone."
          confirmLabel="Delete contact"
          danger
          busy={busy}
          onConfirm={async () => {
            if (await run("DELETE", `/contacts/${confirming.id}`)) setEditing(null);
            setConfirming(null);
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
}

/* The Status and Assignee cells of one row, as dropdowns. The choice shows
   at once; if the save fails it goes back, and the error appears above the
   table. */
function ContactQuickEdit({
  contact,
  people,
  onSave,
  disabled,
}: {
  contact: Contact;
  people: ProfilePerson[];
  onSave: (patch: { status?: ContactStatus; assignee_id?: number | null }) => Promise<boolean>;
  disabled: boolean;
}) {
  const [status, setStatus] = useState(contact.status);
  const [assignee, setAssignee] = useState(contact.assignee_id ?? 0);

  return (
    <>
      <td>
        <Dropdown<ContactStatus>
          className="contact-dd"
          ariaLabel={`Status of ${contact.name}`}
          value={status}
          tone={CONTACT_STATUS_TONE[status]}
          disabled={disabled}
          onChange={async (v) => {
            if (v === status) return;
            const before = status;
            setStatus(v);
            if (!(await onSave({ status: v }))) setStatus(before);
          }}
          options={CONTACT_STATUSES.map((s) => ({
            value: s,
            label: CONTACT_STATUS_LABEL[s],
            media: <span className={`dd-dot tone-${CONTACT_STATUS_TONE[s]}`} />,
          }))}
        />
      </td>
      <td>
        <Dropdown<number>
          className="contact-dd"
          ariaLabel={`Assignee of ${contact.name}`}
          value={assignee}
          disabled={disabled}
          onChange={async (v) => {
            if (v === assignee) return;
            const before = assignee;
            setAssignee(v);
            if (!(await onSave({ assignee_id: v === 0 ? null : v }))) setAssignee(before);
          }}
          options={[
            { value: 0, label: "Unassigned" },
            ...people.map((p) => ({
              value: p.id,
              label: p.name,
              media: <Avatar name={p.name} email={p.email} src={p.avatar} size={20} />,
            })),
          ]}
        />
      </td>
    </>
  );
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return /^https?:\/\//i.test(href) ? (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {label}
    </a>
  ) : null;
}
