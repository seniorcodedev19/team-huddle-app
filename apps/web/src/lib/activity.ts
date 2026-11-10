import { STATUS_LABEL } from "./training";
import { cardKey, type TrainingStatus } from "./types";

/** The parts of an audit_log row a sentence is built from. */
export type ActivityLike = {
  action: string;
  entity: string;
  entity_id: string | null;
  detail: Record<string, unknown> | null;
  actor: { name: string | null };
};

/* Turns a stored activity into the line a person reads, and where it leads.

   One function for the notification panel, the Notification tab and the
   admin Activity tab, so the same event never reads two different ways.
   Pass `meId` where the reader may be the subject: the line then says "you"
   instead of naming them. Anything unrecognised still gets an honest generic
   line rather than being dropped. */
export function describeActivity(
  n: ActivityLike,
  meId?: number,
): { text: string; extra?: string; href: string | null } {
  const who = n.actor.name ?? "Someone";
  const d = n.detail ?? {};
  const no = Number(d.card_no ?? (n.entity === "card" ? n.entity_id : NaN));
  const onCard = Number.isInteger(no) && no > 0;
  const key = onCard ? cardKey(no) : "a card";
  const href = onCard ? `/ai-training/board/${no}` : null;

  if (n.entity === "card") {
    if (n.action === "comment") {
      const mentioned = meId !== undefined && Array.isArray(d.mentions) && d.mentions.includes(meId);
      return {
        text: mentioned ? `${who} mentioned you on ${key}` : `${who} commented on ${key}`,
        extra: typeof d.excerpt === "string" ? d.excerpt : undefined,
        href,
      };
    }
    if (n.action === "move") {
      return { text: `${who} moved ${key} from ${status(d.from)} to ${status(d.to)}`, href };
    }
    if (n.action === "update") return { text: `${who} updated ${key}`, href };
  }
  if (n.entity === "comment") {
    if (n.action === "update") return { text: `${who} edited a comment on ${key}`, href };
    if (n.action === "delete") return { text: `${who} deleted a comment on ${key}`, href };
  }
  return { text: `${who} ${n.action} ${n.entity}${n.entity_id ? ` ${n.entity_id}` : ""}`, href: null };
}

function status(v: unknown) {
  return STATUS_LABEL[v as TrainingStatus] ?? String(v ?? "—");
}
