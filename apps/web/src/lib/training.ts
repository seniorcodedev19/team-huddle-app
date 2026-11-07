import type { BidderStatus, TrainingStatus } from "./types";

/* Declaration order is display order: STATUSES is derived from these keys,
   so the board columns and every dropdown follow it. */
export const STATUS_LABEL: Record<TrainingStatus, string> = {
  created: "Created",
  applied: "Applied",
  approved: "Approved",
  ongoing: "Ongoing",
  rejected: "Rejected",
};

/** Tone per status, mapped onto the existing chip colours. */
export const STATUS_TONE: Record<TrainingStatus, string> = {
  created: "neutral",
  applied: "warn",
  approved: "ok",
  ongoing: "violet",
  rejected: "danger",
};

export const STATUSES = Object.keys(STATUS_LABEL) as TrainingStatus[];

export const BIDDER_LABEL: Record<BidderStatus, string> = {
  none: "Not assigned",
  assigned: "Assigned",
  bidding: "Bidding",
};

export const BIDDER_TONE: Record<BidderStatus, string> = {
  none: "muted",
  assigned: "neutral",
  bidding: "ok",
};

export const BIDDER_STATUSES = Object.keys(BIDDER_LABEL) as BidderStatus[];

/* What a profile is used for, derived from its two flags rather than stored
   as a third column: one source of truth, so a badge can never disagree with
   the checkboxes that set it. "none" is reachable — both boxes can be
   cleared — and is worth showing, because such a profile appears on no board. */
export type ProfileUse = "both" | "job" | "training" | "none";

export function profileUse(p: { for_job: boolean; for_ai_training: boolean }): ProfileUse {
  if (p.for_job && p.for_ai_training) return "both";
  if (p.for_job) return "job";
  if (p.for_ai_training) return "training";
  return "none";
}

export const USE_LABEL: Record<ProfileUse, string> = {
  both: "Both",
  job: "Job",
  training: "AI training",
  none: "Unused",
};

export const USE_TONE: Record<ProfileUse, string> = {
  both: "neutral",
  job: "ok",
  training: "violet",
  none: "muted",
};

export const PROFILE_USES = Object.keys(USE_LABEL) as ProfileUse[];
