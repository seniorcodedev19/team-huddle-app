import Link from "next/link";
import NotificationList from "@/components/NotificationList";
import { ActivityText } from "@/components/TimeAgo";
import { describeActivity } from "@/lib/activity";
import { apiFetch, tryFetch } from "@/lib/api";
import type { ActivityPage, AuditPage, NotificationFeed, User } from "@/lib/types";

const PAGE_SIZE = 20;
const FEED_SIZE = 30;

type Tab = "history" | "activity" | "notifications";

/* Three views of one log.

   History is every audited change. Activity is the part of it people did on
   the things they work on, written as sentences. Notification is the part of
   it addressed to whoever is looking. All three read audit_log; nothing here
   has a second source.

   Everyone can open the page, because everyone has notifications. The first
   two views expose other people's actions, so they stay with admins. */
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string; before?: string; unread?: string }>;
}) {
  const me = await apiFetch<User>("/me");
  const admin = me.role === "admin";
  const sp = await searchParams;

  const asked = sp.tab === "activity" || sp.tab === "notifications" ? sp.tab : "history";
  const tab: Tab = admin ? asked : "notifications";
  const page = Math.max(1, Number(sp.page) || 1);

  const tabs: { id: Tab; label: string; href: string }[] = [
    { id: "history", label: "History", href: "/admin/history" },
    { id: "activity", label: "Activity", href: "/admin/history?tab=activity" },
    { id: "notifications", label: "Notification", href: "/admin/history?tab=notifications" },
  ];

  const sub: Record<Tab, string> = {
    history: "Every consequential change, newest first. This log is append-only.",
    activity: "What people did on cards, comments, the calendar and profile assignments, and who was told.",
    notifications: "Activity that names you: your cards and profiles, your calendar events, and comments that mention you.",
  };

  return (
    <>
      <h1>{admin ? "History" : "Notifications"}</h1>
      <p className="sub">{sub[tab]}</p>

      {/* A switch with one option is not a switch, so non-admins get none. */}
      {admin && (
        <div className="viewswitch" role="group" aria-label="View" style={{ marginBottom: 14 }}>
          {tabs.map((t) => (
            <Link key={t.id} href={t.href} className={t.id === tab ? "on" : ""} aria-current={t.id === tab ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </div>
      )}

      {tab === "history" && <HistoryTab page={page} />}
      {tab === "activity" && <ActivityTab page={page} />}
      {tab === "notifications" && (
        <NotificationsTab meId={me.id} before={Number(sp.before) || 0} unreadOnly={sp.unread === "1"} />
      )}
    </>
  );
}

async function HistoryTab({ page }: { page: number }) {
  const res = await tryFetch<AuditPage>(`/audit?limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`);
  if (!res.ok) return <div className="banner error">{res.error}</div>;
  const audit = res.data;

  return (
    <>
      <Pager title="Recent changes" base="/admin/history?" page={page} data={audit} />
      <div className="panel tablewrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>User</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {audit.rows.map((a) => (
              <tr key={a.id}>
                <td className="muted">{new Date(a.at).toLocaleString("en-US")}</td>
                <td>{a.actor ?? "unknown"}</td>
                <td>
                  {a.action} {a.entity} {a.entity_id}
                </td>
              </tr>
            ))}
            {audit.rows.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  Nothing yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function ActivityTab({ page }: { page: number }) {
  const res = await tryFetch<ActivityPage>(`/activity?limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`);
  if (!res.ok) return <div className="banner error">{res.error}</div>;
  const data = res.data;

  return (
    <>
      <Pager title="Recent activity" base="/admin/history?tab=activity&" page={page} data={data} />
      <div className="panel tablewrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Activity</th>
              <th>Notified</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((a) => {
              // No "you" here: this is an account of what happened, not a message to the reader.
              const d = describeActivity(a);
              return (
                <tr key={a.id}>
                  <td className="muted">{new Date(a.at).toLocaleString("en-US")}</td>
                  <td>
                    {d.href ? (
                      <Link href={d.href}>
                        <ActivityText d={d} />
                      </Link>
                    ) : (
                      <ActivityText d={d} />
                    )}
                    {d.extra && <div className="muted small">“{d.extra}”</div>}
                  </td>
                  <td className="muted">{a.notified.length ? a.notified.join(", ") : "—"}</td>
                </tr>
              );
            })}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  No activity yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function NotificationsTab({
  meId,
  before,
  unreadOnly,
}: {
  meId: number;
  before: number;
  unreadOnly: boolean;
}) {
  const qs = `limit=${FEED_SIZE}${before ? `&before=${before}` : ""}${unreadOnly ? "&unread=1" : ""}`;
  const res = await tryFetch<NotificationFeed>(`/notifications?${qs}`);
  if (!res.ok) return <div className="banner error">{res.error}</div>;
  const { items, unread } = res.data;

  const base = "/admin/history?tab=notifications";
  const last = items[items.length - 1];

  return (
    <>
      <div className="head">
        <h2 style={{ margin: 0 }}>{unreadOnly ? "Unread" : "All notifications"}</h2>
        <Link className="btn secondary small" href={unreadOnly ? base : `${base}&unread=1`}>
          {unreadOnly ? "Show all" : "Only show unread"}
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          {before ? "Nothing older." : unreadOnly ? "You're all caught up." : "No notifications yet."}
        </div>
      ) : (
        <div className="panel" style={{ padding: 6 }}>
          <NotificationList items={items} unread={unread} meId={meId} />
        </div>
      )}

      {/* Paged by id rather than by offset: new notifications arrive while
          someone is reading, and an offset would shift under them. */}
      {(before > 0 || items.length === FEED_SIZE) && (
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          {before > 0 && (
            <Link className="btn secondary small" href={`${base}${unreadOnly ? "&unread=1" : ""}`}>
              Newest
            </Link>
          )}
          {items.length === FEED_SIZE && last && (
            <Link
              className="btn secondary small"
              href={`${base}&before=${last.id}${unreadOnly ? "&unread=1" : ""}`}
            >
              Older
            </Link>
          )}
        </div>
      )}
    </>
  );
}

/** The heading row with previous/next, shared by the two paged tables. */
function Pager({
  title,
  base,
  page,
  data,
}: {
  title: string;
  /** Ends in "?" or "&", ready for "page=N". */
  base: string;
  page: number;
  data: { total: number; limit: number; offset: number; rows: unknown[] };
}) {
  const pages = Math.max(1, Math.ceil(data.total / data.limit));
  const current = Math.min(page, pages);
  const first = base.replace(/[?&]$/, "");
  return (
    <div className="head">
      <h2 style={{ margin: 0 }}>{title}</h2>
      {data.total > 0 && (
        <div className="row" style={{ alignItems: "center" }}>
          <Link
            className="btn secondary"
            href={current <= 2 ? first : `${base}page=${current - 1}`}
            aria-label="Previous page"
            aria-disabled={current <= 1}
            style={current <= 1 ? { pointerEvents: "none", opacity: 0.4 } : undefined}
          >
            ←
          </Link>
          <span className="muted">
            {data.offset + 1}–{Math.min(data.offset + data.rows.length, data.total)} of {data.total}
          </span>
          <Link
            className="btn secondary"
            href={`${base}page=${current + 1}`}
            aria-label="Next page"
            aria-disabled={current >= pages}
            style={current >= pages ? { pointerEvents: "none", opacity: 0.4 } : undefined}
          >
            →
          </Link>
        </div>
      )}
    </div>
  );
}
