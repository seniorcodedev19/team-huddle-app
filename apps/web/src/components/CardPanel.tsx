"use client";

import { useState } from "react";
import { useAction } from "@/lib/client";
import { STATUS_LABEL, STATUS_TONE, STATUSES } from "@/lib/training";
import { cardKey, type BoardCard, type TrainingStatus } from "@/lib/types";
import Avatar from "./Avatar";
import CardComments from "./CardComments";
import RichText from "./RichText";
import WorkFields from "./WorkFields";
import { AI_WORK } from "@/lib/work";
import Dropdown from "./Dropdown";
import SiteLogo from "./SiteLogo";
import { LocalDate } from "./TimeAgo";

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
            {/* The profile's details, read from the profile each time the card
                opens, so an edit on the Profiles page shows here at once. The
                site account's own email is listed separately only when it was
                recorded and differs from the profile's. */}
            {card.profile_email || card.profile_phone || card.profile_linkedin || card.account_email ? (
              <dl className="card-account">
                {card.profile_email && (
                  <>
                    <dt>Email</dt>
                    <dd>
                      <a href={`mailto:${card.profile_email}`}>{card.profile_email}</a>
                    </dd>
                  </>
                )}
                {card.account_email && card.account_email !== card.profile_email && (
                  <>
                    <dt>Site login</dt>
                    <dd>{card.account_email}</dd>
                  </>
                )}
                {card.profile_phone && (
                  <>
                    <dt>Phone</dt>
                    <dd className="input-phone">{card.profile_phone}</dd>
                  </>
                )}
                {card.profile_linkedin && (
                  <>
                    <dt>LinkedIn</dt>
                    <dd>
                      {/^https?:\/\//i.test(card.profile_linkedin) ? (
                        <a href={card.profile_linkedin} target="_blank" rel="noreferrer noopener">
                          Open profile
                        </a>
                      ) : (
                        card.profile_linkedin
                      )}
                    </dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="muted small">No contact details on this profile yet. Add them on the Profiles page.</p>
            )}
            {card.note && <p className="card-prose muted">{card.note}</p>}
          </section>

          {/* The site's own notes, written once per site by an admin on the
              Training sites page and shared by every card for that site.
              Shown here formatted and read-only. */}
          <section>
            <h3 className="card-section">Site notes</h3>
            {card.site_summary ? (
              <RichText text={card.site_summary} className="card-prose" />
            ) : (
              <p className="muted small">No notes for this site yet. An admin adds them under Training sites.</p>
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


          {/* The day's numbers for this card. They roll up to the profile
              and its assignee on the dashboard. */}
          <WorkFields subject={{ card_no: card.card_no }} metrics={AI_WORK} />

          <div>
            <h3 className="card-section">Created</h3>
            <p className="muted small">
              <LocalDate iso={card.created_at} />
            </p>
          </div>

          <div>
            <h3 className="card-section">Updated</h3>
            <p className="muted small">
              <LocalDate iso={card.updated_at} />
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
