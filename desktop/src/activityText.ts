/* The sentence a notification is shown as, and where it leads.

   A copy of `describeActivity` and `plainActivity` in
   apps/web/src/lib/activity.ts, because the repo has no shared package: the
   server stores action/entity/detail and each client words the line. If a
   new kind of activity is added there, add it here too. Until then the
   desktop app still shows it, through the generic line at the bottom. */

export type ActivityLike = {
  action: string;
  entity: string;
  entity_id: string | null;
  detail: Record<string, unknown> | null;
  actor: { name: string | null };
};

export type Described = {
  text: string;
  extra?: string;
  href: string | null;
  times?: { from: string; to: string };
};

const CARD_PREFIX = "TRN";

const STATUS_LABEL: Record<string, string> = {
  created: "Created",
  applied: "Applied",
  approved: "Approved",
  ongoing: "Ongoing",
  rejected: "Rejected",
};

const EVENT_WORD: Record<string, string> = {
  interview: "interview",
  ai_interview: "AI interview",
  event: "event",
};

const status = (v: unknown) => STATUS_LABEL[String(v)] ?? String(v ?? "—");

export function describeActivity(n: ActivityLike, meId?: number): Described {
  const who = n.actor?.name ?? "Someone";
  const d = n.detail ?? {};
  const no = Number(d.card_no ?? (n.entity === "card" ? n.entity_id : NaN));
  const onCard = Number.isInteger(no) && no > 0;
  const key = onCard ? `${CARD_PREFIX}-${no}` : "a card";
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
    return {
      text: meId !== undefined ? `${who} added you to the profile ${name}` : `${who} assigned the profile ${name}`,
      href: "/profiles",
    };
  }
  if (n.entity === "user" && n.action === "signup") {
    return { text: `${who} signed up and is waiting for approval`, href: "/admin/users" };
  }
  if (n.entity === "comment") {
    if (n.action === "update") return { text: `${who} edited a comment on ${key}`, href };
    if (n.action === "delete") return { text: `${who} deleted a comment on ${key}`, href };
  }
  return { text: `${who} ${n.action} ${n.entity}${n.entity_id ? ` ${n.entity_id}` : ""}`, href: null };
}

/** A moment as "Nov 12, 10:00 AM" in this computer's locale and time zone. */
export function momentLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The whole notification as the text of a system alert. */
export function alertBody(d: Described) {
  const line = d.times ? `${d.text} from ${momentLabel(d.times.from)} to ${momentLabel(d.times.to)}` : d.text;
  return d.extra ? `${line}\n“${d.extra}”` : line;
}
