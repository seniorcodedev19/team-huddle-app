"use client";

import { useMemo, useState } from "react";
import { useAction } from "@/lib/client";
import CardModal from "./CardModal";
import Dropdown from "./Dropdown";
import SiteLogo from "./SiteLogo";
import { STATUS_LABEL, STATUS_TONE, STATUSES } from "@/lib/training";
import { cardKey, type TrainingMatrix as Matrix, type TrainingStatus } from "@/lib/types";

type Card = {
  /** The board key: TRN-<cardNo>, and the card's URL. */
  cardNo: number;
  profileId: number;
  profileName: string;
  /** Who owns the profile, for the assignee filter. */
  assigneeIds: number[];
  siteId: number;
  siteName: string;
  siteIcon: string;
  siteUrl: string;
  status: TrainingStatus;
};

/* Status board: one column per status, one card per (profile, site) account.
   Dragging a card onto a column moves that account to that status. */
export default function TrainingKanban({
  matrix,
  filters,
}: {
  matrix: Matrix;
  /* The toolbar owns these so its controls can sit beside Add site. 0 on
     any of them means "no filter". */
  filters: { profileId: number; siteId: number; assignee: number };
}) {
  const { error, busy, run } = useAction();
  const [dragging, setDragging] = useState<Card | null>(null);
  const [over, setOver] = useState<TrainingStatus | null>(null);
  /* Which card's modal is open, by card_no. */
  const [openCard, setOpenCard] = useState<number | null>(null);
  /* A drag ends with a click on most browsers, which would open the modal
     every time a card is moved. Set while dragging and cleared after, so the
     click that completes a drag is ignored. */
  const [didDrag, setDidDrag] = useState(false);
  const { profileId, siteId, assignee } = filters;

  const profileName = useMemo(
    () => new Map(matrix.profiles.map((p) => [p.id, p.full_name])),
    [matrix.profiles],
  );
  const assigneesOf = useMemo(
    () => new Map(matrix.profiles.map((p) => [p.id, p.assignees ?? []])),
    [matrix.profiles],
  );
  const siteById = useMemo(() => new Map(matrix.sites.map((s) => [s.id, s])), [matrix.sites]);

  const cards: Card[] = useMemo(
    () =>
      matrix.accounts.map((a) => ({
        cardNo: a.card_no,
        profileId: a.profile_id,
        profileName: profileName.get(a.profile_id) ?? "Unknown profile",
        assigneeIds: (assigneesOf.get(a.profile_id) ?? []).map((x) => x.user_id),
        siteId: a.site_id,
        siteName: siteById.get(a.site_id)?.name ?? "Unknown site",
        siteIcon: siteById.get(a.site_id)?.icon_url ?? "",
        siteUrl: siteById.get(a.site_id)?.url ?? "",
        status: a.status,
      })),
    [matrix.accounts, profileName, assigneesOf, siteById],
  );

  /* The cards the filters leave. Columns still render when empty, so the
     board keeps its shape and a status with no matches reads as zero
     rather than disappearing. */
  const shown = useMemo(
    () =>
      cards.filter((c) => {
        if (profileId && c.profileId !== profileId) return false;
        if (siteId && c.siteId !== siteId) return false;
        if (assignee && !c.assigneeIds.includes(assignee)) return false;
        return true;
      }),
    [cards, profileId, siteId, assignee],
  );

  const move = (card: Card, status: TrainingStatus) => {
    if (card.status === status) return;
    run("PUT", "/training-accounts", {
      profile_id: card.profileId,
      site_id: card.siteId,
      status,
    });
  };

  if (cards.length === 0) {
    return (
      <div className="empty">
        No AI training accounts yet. Add one from a profile on the Profiles page.
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      <div className="kanban">
        {STATUSES.map((status) => {
          const inColumn = shown.filter((c) => c.status === status);
          return (
            <section
              key={status}
              className={`kanban-col${over === status ? " over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(status);
              }}
              onDragLeave={() => setOver((o) => (o === status ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                if (dragging) move(dragging, status);
                setDragging(null);
              }}
              aria-label={STATUS_LABEL[status]}
            >
              <header className="kanban-head">
                <span className={`dot tone-${STATUS_TONE[status]}`} aria-hidden="true" />
                <h3>{STATUS_LABEL[status]}</h3>
                <span className="kanban-count">{inColumn.length}</span>
              </header>

              <div className="kanban-cards">
                {inColumn.length === 0 ? (
                  <p className="kanban-empty">Drop here</p>
                ) : (
                  inColumn.map((c) => (
                    <article
                      key={`${c.profileId}:${c.siteId}`}
                      className={`kanban-card${busy ? " busy" : ""}`}
                      draggable={!busy}
                      onDragStart={() => {
                        setDragging(c);
                        setDidDrag(true);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      onClick={(e) => {
                        /* The status dropdown lives inside the card; a click
                           on it is a status change, not a request to open. */
                        if ((e.target as HTMLElement).closest(".dd")) return;
                        if (didDrag) {
                          setDidDrag(false);
                          return;
                        }
                        setOpenCard(c.cardNo);
                      }}
                    >
                      <header className="kanban-card-head">
                        <strong>{c.profileName}</strong>
                        <span className="kanban-key">{cardKey(c.cardNo)}</span>
                      </header>
                      <span className="kanban-site">
                        <SiteLogo name={c.siteName} iconUrl={c.siteIcon} siteUrl={c.siteUrl} size={16} />
                        {c.siteName}
                      </span>
                      {/* Keyboard and touch path: dragging alone isn't accessible. */}
                      <Dropdown<TrainingStatus>
                        value={c.status}
                        tone={STATUS_TONE[c.status]}
                        ariaLabel={`${c.siteName} status for ${c.profileName}`}
                        disabled={busy}
                        onChange={(st) => move(c, st)}
                        options={STATUSES.map((st) => ({
                          value: st,
                          label: STATUS_LABEL[st],
                          media: <span className={`dd-dot tone-${STATUS_TONE[st]}`} />,
                        }))}
                      />
                    </article>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>

      {openCard !== null && (
        <CardModal cardNo={openCard} onClose={() => setOpenCard(null)} />
      )}
    </>
  );
}
