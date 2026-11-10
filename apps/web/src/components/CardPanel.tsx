"use client";

import { useState } from "react";
import { useAction } from "@/lib/client";
import { STATUS_LABEL, STATUS_TONE, STATUSES } from "@/lib/training";
import { cardKey, type BoardCard, type TrainingStatus } from "@/lib/types";
import Avatar from "./Avatar";
import CardComments from "./CardComments";
import Dropdown from "./Dropdown";
import SiteLogo from "./SiteLogo";

/* The body of a board card: site notes and the account on the left, the
   metadata rail on the right.

   One component for two mounts — inside the modal over the board, and on the
   card's own page at /ai-training/board/[cardNo]. The page exists so a card
   has a URL to link to; a modal alone has none, and a notification needs
   somewhere to point. */
export default function CardPanel({ card }: { card: BoardCard }) {
  const { error, busy, run } = useAction();
  /* The server is the source of truth and router.refresh() re-pulls it, but
     that round trip is visible on a dropdown. Showing the chosen value at
     once keeps the control from appearing to snap back. */
  const [status, setStatus] = useState<TrainingStatus>(card.status);

  const save = async (next: TrainingStatus) => {
    const previous = status;
    setStatus(next);
    const ok = await run("PATCH", `/cards/${card.card_no}`, { status: next });
    if (!ok) setStatus(previous);
  };

  return (
    <>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      <div className="card-body">
        <div className="card-main">
          <section>
            <h3 className="card-section">Account</h3>
            {card.account_email ? (
              <p className="card-prose">{card.account_email}</p>
            ) : (
              <p className="muted small">No account email recorded.</p>
            )}
            {card.note && <p className="card-prose muted">{card.note}</p>}
          </section>

          <section>
            <h3 className="card-section">Site notes</h3>
            {card.site_summary ? (
              <p className="card-prose">{card.site_summary}</p>
            ) : (
              <p className="muted small">No notes for this site yet.</p>
            )}
          </section>
        </div>

        <aside className="card-rail">
          <div>
            <h3 className="card-section">Assignee</h3>
            {/* A card has no assignee of its own: it inherits the profile's,
                so this is shown rather than edited. Changing it here would
                silently reassign every card for that profile. */}
            {card.assignees.length === 0 ? (
              <p className="muted small">Unassigned</p>
            ) : (
              <ul className="card-people">
                {card.assignees.map((a) => (
                  <li key={a.user_id}>
                    <Avatar name={a.name} email={a.email} src={a.avatar} size={22} />
                    <span>{a.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="card-section">Status</h3>
            <Dropdown<TrainingStatus>
              ariaLabel="Status"
              value={status}
              onChange={save}
              disabled={busy}
              options={STATUSES.map((st) => ({
                value: st,
                label: STATUS_LABEL[st],
                media: <span className={`dd-dot tone-${STATUS_TONE[st]}`} />,
              }))}
            />
          </div>


          <div>
            <h3 className="card-section">Created</h3>
            <p className="muted small">{dateOf(card.created_at)}</p>
          </div>

          <div>
            <h3 className="card-section">Updated</h3>
            <p className="muted small">
              {dateOf(card.updated_at)}
              {card.updated_by ? ` by ${card.updated_by.name}` : ""}
            </p>
          </div>
        </aside>
      </div>

      {/* Outside the two-column grid: the thread runs the full width of the
          card, not just the content column, so a comment has room to read. */}
      <CardComments cardNo={card.card_no} />
    </>
  );
}

/** The card's title line, shared by the modal header and the page header. */
export function CardTitle({ card }: { card: BoardCard }) {
  return (
    <div className="card-head">
      <SiteLogo name={card.site_name} iconUrl={card.site_icon_url} siteUrl={card.site_url} size={28} />
      <div className="card-head-text">
        {/* The site name is the link, so the notes do not need to repeat the
            URL underneath them. A site added by hand may have none, in which
            case the name stays plain text rather than a dead link. */}
        {card.site_url ? (
          <a
            className="card-site-link"
            href={card.site_url}
            target="_blank"
            rel="noreferrer"
            title={hostOf(card.site_url)}
          >
            {card.site_name}
          </a>
        ) : (
          <strong>{card.site_name}</strong>
        )}
        <span className="muted small">{card.profile_name}</span>
      </div>
      {/* The key carries the card's status as a dot, so the board's colour
          coding survives into the modal and the page. */}
      <span className="card-key">
        <span className={`dd-dot tone-${STATUS_TONE[card.status]}`} aria-hidden="true" />
        {cardKey(card.card_no)}
      </span>
    </div>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    // A site added by hand may hold something that isn't a URL.
    return url;
  }
}

function dateOf(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
