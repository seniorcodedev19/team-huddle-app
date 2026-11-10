"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { callJson } from "@/lib/client";
import type { BoardCard } from "@/lib/types";
import CardPanel, { CardTitle } from "./CardPanel";

/* The card modal over the board.

   The board row only knows a card_no, so the card is fetched when the modal
   opens rather than threaded through the kanban: the board would otherwise
   have to carry every field the panel shows, for every card, to render a
   detail view that is usually never opened. */
export default function CardModal({ cardNo, onClose }: { cardNo: number; onClose: () => void }) {
  const [card, setCard] = useState<BoardCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    /* AbortController rather than a `live` flag. In development React runs an
       effect twice, and a flag captured by the first run is set false by its
       own cleanup before the second run's request resolves — which left the
       modal on "Loading…" forever even though both requests returned 200.
       Aborting ties the cancellation to the request it belongs to. */
    const ac = new AbortController();
    callJson<BoardCard>("GET", `/cards/${cardNo}`, undefined, ac.signal)
      .then(setCard)
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Couldn't load that card");
      });
    return () => ac.abort();
  }, [cardNo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panel.current?.querySelector<HTMLElement>("button, a")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal modal-card" role="dialog" aria-modal="true" aria-label="Card" ref={panel}>
        <div className="modal-head">
          {card ? (
            <CardTitle card={card} />
          ) : (
            <h2 style={{ margin: 0 }}>TRN-{cardNo}</h2>
          )}
          {/* Pinned to the modal corner rather than sitting beside the
              title, so a long site name cannot push them around. */}
          <div className="card-actions">
            {/* The page is the shareable form of this modal. */}
            <Link
              className="icon-btn"
              href={`/ai-training/board/${cardNo}`}
              aria-label="Open as a page"
              title="Open as a page"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 4h6v6" />
                <path d="M20 4 11 13" />
                <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
              </svg>
            </Link>
            <button className="icon-btn" type="button" aria-label="Close" onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="modal-body">
          {error ? (
            <div className="banner error" role="alert">
              {error}
            </div>
          ) : card ? (
            <CardPanel card={card} />
          ) : (
            <p className="muted small" style={{ margin: 0 }}>
              Loading…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
