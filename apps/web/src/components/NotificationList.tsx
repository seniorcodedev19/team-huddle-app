"use client";

import { useRouter } from "next/navigation";
import type { NotificationItem } from "@/lib/types";
import { NotificationRow, useNotifications } from "./Notifications";

/* The full notification list on the History page.

   The rows come from the server, a page at a time. Marking read goes through
   the same provider the account menu uses, so the badge there drops at once,
   and then the server list is re-pulled so this page agrees with it. */
export default function NotificationList({
  items,
  unread,
  meId,
}: {
  items: NotificationItem[];
  unread: number;
  meId: number;
}) {
  const router = useRouter();
  const ctx = useNotifications();

  const mark = (ids: number[]) => ctx?.markRead(ids).then(() => router.refresh());

  return (
    <>
      {unread > 0 && (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 10 }}>
          <button
            className="btn secondary small"
            type="button"
            onClick={() => ctx?.markAllRead().then(() => router.refresh())}
          >
            Mark all as read ({unread})
          </button>
        </div>
      )}
      <ul className="notif-list notif-page">
        {items.map((n) => (
          <li key={n.id}>
            <NotificationRow
              item={n}
              meId={meId}
              onFollow={() => {
                if (!n.read_at) void ctx?.markRead([n.id]);
              }}
              onMark={() => void mark([n.id])}
            />
          </li>
        ))}
      </ul>
    </>
  );
}
