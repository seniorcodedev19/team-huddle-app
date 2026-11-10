"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/* A confirmation in the app's own style, in place of the browser's
   window.confirm.

   Portalled to <body> so it can be opened from inside another modal — the
   card modal, for one — and still sit above it rather than inside its
   scrolling body. */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Styles the confirming button as destructive. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    /* Focus starts on Cancel: for a destructive action, the key under the
       user's finger should be the safe one. */
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      /* Capture phase, and stopped here: a modal underneath also closes on
         Escape, and one press should dismiss only the dialog on top. */
      e.stopPropagation();
      onCancel();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return createPortal(
    <div
      className="confirm-backdrop"
      onMouseDown={(e) => {
        // Kept from reaching whatever is underneath, which may close on an outside click.
        e.stopPropagation();
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
      >
        <div className={`confirm-icon${danger ? " danger" : ""}`} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8.5v4.5" />
            <path d="M12 16.5h.01" />
            <path d="M10.3 3.9 2.6 17.2a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
        </div>
        <div className="confirm-text">
          <h2 id="confirm-title">{title}</h2>
          <p id="confirm-message">{message}</p>
        </div>
        <div className="confirm-actions">
          <button ref={cancel} className="btn secondary" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={`btn${danger ? " danger-solid" : ""}`}
            type="button"
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
