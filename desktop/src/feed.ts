/* Which notifications deserve an alert.

   The same rule the web app follows (apps/web/src/components/Notifications.tsx):
   what was already waiting when the app started is shown by the unread
   count, not announced as if it had just happened. Only something that
   arrives while the app is running pops up.

   Pure, so the rule is tested without a server. */

import type { ActivityLike } from "./activityText";

export type FeedItem = ActivityLike & {
  id: number;
  at: string;
  read_at: string | null;
};

export type Feed = { items: FeedItem[]; unread: number };

/** At most this many separate alerts for one check; more become one summary. */
export const MAX_ALERTS = 3;

export type Announcement = {
  /** The newest id now accounted for: pass it back in next time. */
  newestSeen: number;
  /** Unread items that arrived since the last check, oldest first. */
  fresh: FeedItem[];
};

/* `since` is null on the first read after starting or signing in, which only
   sets the baseline. */
export function announce(items: FeedItem[], since: number | null): Announcement {
  const newest = items.reduce((m, i) => Math.max(m, i.id), 0);
  const newestSeen = Math.max(since ?? 0, newest);
  if (since === null) return { newestSeen, fresh: [] };
  const fresh = items.filter((i) => i.id > since && !i.read_at).sort((a, b) => a.id - b.id);
  return { newestSeen, fresh };
}

/** The feed as the server sent it, or null when it is not a feed at all. */
export function parseFeed(body: unknown): Feed | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  if (!Array.isArray(o.items)) return null;
  const items: FeedItem[] = [];
  for (const raw of o.items) {
    if (!raw || typeof raw !== "object") continue;
    const i = raw as Record<string, unknown>;
    if (typeof i.id !== "number" || typeof i.action !== "string" || typeof i.entity !== "string") continue;
    const actor = (i.actor && typeof i.actor === "object" ? i.actor : {}) as Record<string, unknown>;
    items.push({
      id: i.id,
      action: i.action,
      entity: i.entity,
      entity_id: i.entity_id == null ? null : String(i.entity_id),
      detail: i.detail && typeof i.detail === "object" ? (i.detail as Record<string, unknown>) : null,
      at: typeof i.at === "string" ? i.at : "",
      read_at: typeof i.read_at === "string" ? i.read_at : null,
      actor: { name: typeof actor.name === "string" ? actor.name : null },
    });
  }
  return { items, unread: typeof o.unread === "number" && o.unread > 0 ? Math.floor(o.unread) : 0 };
}

/** The count as it is drawn on a badge: capped so it always fits. */
export function badgeLabel(unread: number) {
  if (unread <= 0) return "";
  return unread > 9 ? "9+" : String(unread);
}
