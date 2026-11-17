import type { ContactStatus } from "./types";

/* Declaration order is menu order. */
export const CONTACT_STATUS_LABEL: Record<ContactStatus, string> = {
  none: "None",
  contacted: "Contacted",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

/** Tone per status, mapped onto the existing chip colours. */
export const CONTACT_STATUS_TONE: Record<ContactStatus, string> = {
  none: "muted",
  contacted: "neutral",
  pending: "warn",
  approved: "ok",
  rejected: "danger",
};

export const CONTACT_STATUSES = Object.keys(CONTACT_STATUS_LABEL) as ContactStatus[];
