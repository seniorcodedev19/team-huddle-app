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
export type Described = {
  text: string;
  extra?: string;
  href: string | null;
  /* A reschedule's two moments, as ISO strings. Kept out of `text` because
     a time can only be worded in the reader's own zone, which the server
     does not know: the renderer formats these in the browser. */
  times?: { from: string; to: string };
};

export function describeActivity(n: ActivityLike, meId?: number): Described {
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
    if (n.action === "create") return { text: `${who} added ${key}`, href };
  }
  if (n.entity === "interview") {
    const what = `${EVENT_WORD[String(d.kind)] ?? "event"}${typeof d.topic === "string" && d.topic ? `: ${d.topic}` : ""}`;
    const cal = "/calendar";
    if (n.action === "create") return { text: `${who} created the ${what}`, href: cal };
    if (n.action === "cancel") return { text: `${who} cancelled the ${what}`, href: cal };
    if (n.action === "delete") return { text: `${who} deleted the ${what}`, href: cal };
    if (n.action === "reschedule") {
      const times =
        typeof d.from === "string" && typeof d.to === "string" ? { from: d.from, to: d.to } : undefined;
      return { text: `${who} rescheduled the ${what}`, href: cal, times };
    }
    if (n.action === "update") return { text: `${who} updated the ${what}`, href: cal };
  }
  if (n.entity === "profile" && n.action === "assign") {
    const name = typeof d.full_name === "string" ? d.full_name : "a profile";
    /* A notification for this only ever goes to the people added, so with a
       reader it is always "you". Without one — the admin Activity view — the
       Notified column carries the names. */
    return {
      text: meId !== undefined ? `${who} added you to the profile ${name}` : `${who} assigned the profile ${name}`,
      href: "/profiles",
    };
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

const EVENT_WORD: Record<string, string> = {
  interview: "interview",
  ai_interview: "AI interview",
  event: "event",
};

/** A moment as "Nov 12, 10:00 AM" in the caller's locale and zone. Browser only. */
export function momentLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The whole line as one string, for a desktop alert. Browser only. */
export function plainActivity(d: Described) {
  return d.times ? `${d.text} from ${momentLabel(d.times.from)} to ${momentLabel(d.times.to)}` : d.text;
}
