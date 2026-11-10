"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { describeActivity } from "@/lib/activity";
import {
  chime,
  claimAlert,
  desktopEnabled,
  desktopPermission,
  setDesktopEnabled,
  setSoundEnabled,
  showDesktop,
  soundEnabled,
  unlockAudio,
} from "@/lib/alerts";
import { callJson } from "@/lib/client";
import type { NotificationFeed, NotificationItem } from "@/lib/types";
import Avatar from "./Avatar";
import Switch from "./Switch";
import TimeAgo from "./TimeAgo";

/* How often the feed is re-read while the tab is visible. This is the whole
   transport, and it lives only in the provider below: swapping it for a
   stream later changes this file and nothing that uses the hook. */
const POLL_MS = 25_000;

/** Where the full list lives: the Notification switch of the History page. */
export const NOTIFICATIONS_HREF = "/admin/history?tab=notifications";

type Ctx = {
  items: NotificationItem[];
  unread: number;
  meId: number;
  /** Both resolve once the server has answered, so a caller can refresh after. */
  markRead: (ids: number[]) => Promise<void>;
  markAllRead: () => Promise<void>;
};

const NotificationContext = createContext<Ctx | null>(null);

export function useNotifications() {
  return useContext(NotificationContext);
}

export function NotificationProvider({ meId, children }: { meId: number; children: React.ReactNode }) {
  const [feed, setFeed] = useState<NotificationFeed>({ items: [], unread: 0 });

  /* The newest id already accounted for. Null until the first load, which
     only sets the baseline: what was waiting when the page opened is shown
     by the badge, not announced as if it had just happened. */
  const newestSeen = useRef<number | null>(null);

  useEffect(() => {
    const ac = new AbortController();

    const announce = (items: NotificationItem[]) => {
      const newest = items.reduce((m, i) => Math.max(m, i.id), 0);
      const since = newestSeen.current;
      newestSeen.current = Math.max(since ?? 0, newest);
      if (since === null) return;
      const fresh = items.filter((i) => i.id > since && !i.read_at);
      if (!fresh.length || !claimAlert(newest)) return;

      if (soundEnabled()) chime();
      /* A desktop alert is for when the app is not being looked at. With
         the tab in front, the sound and the badge already say it. */
      if (desktopEnabled() && (document.hidden || !document.hasFocus())) {
        for (const n of fresh.slice(0, 3)) {
          const d = describeActivity(n, meId);
          showDesktop({
            title: "Team Huddle",
            body: d.extra ? `${d.text}\n“${d.extra}”` : d.text,
            tag: `huddle-${n.id}`,
            href: d.href,
          });
        }
      }
    };

    /* Polls in a hidden tab too: an alert is exactly for someone who is
       looking elsewhere. Browsers slow a background tab's timers on their
       own, so this does not run at full rate there. */
    const load = () => {
      callJson<NotificationFeed>("GET", "/notifications?limit=30", undefined, ac.signal)
        .then((f) => {
          setFeed(f);
          announce(f.items);
        })
        .catch(() => {
          /* A failed poll is not worth a banner: the next one retries, and
             the badge simply keeps its last known count. */
        });
    };
    const onVisible = () => {
      if (!document.hidden) load();
    };

    load();
    const timer = setInterval(load, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    // Audio stays silent until the page has been interacted with once.
    document.addEventListener("pointerdown", unlockAudio, { once: true });
    document.addEventListener("keydown", unlockAudio, { once: true });
    return () => {
      ac.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("pointerdown", unlockAudio);
      document.removeEventListener("keydown", unlockAudio);
    };
  }, [meId]);

  const send = useCallback(
    (body: { ids: number[] } | { all: true }, mark: (i: NotificationItem) => boolean) =>
      callJson<{ unread: number }>("POST", "/notifications/read", body)
        .then((r) =>
          setFeed((f) => ({
            unread: r.unread,
            items: f.items.map((i) =>
              !i.read_at && mark(i) ? { ...i, read_at: new Date().toISOString() } : i,
            ),
          })),
        )
        .catch(() => {
          /* Left unread, which is the truthful state if the request failed. */
        }),
    [],
  );

  const markRead = useCallback((ids: number[]) => send({ ids }, (i) => ids.includes(i.id)), [send]);
  const markAllRead = useCallback(() => send({ all: true }, () => true), [send]);

  return (
    <NotificationContext.Provider value={{ ...feed, meId, markRead, markAllRead }}>
      {children}
    </NotificationContext.Provider>
  );
}

/** The unread count as a pill. Capped so a busy day cannot widen it. */
export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="notif-badge" aria-label={`${count} unread`}>
      {count > 9 ? "9+" : count}
    </span>
  );
}

const UNREAD_KEY = "notif-unread-only";

/* The notification panel, opened from the account menu.

   Portalled to <body> so the sidebar's own scrolling cannot clip it. `pos`
   is measured by the opener at the moment of the click; `anchor` is the
   opener's element, so a click on it is not treated as a click outside. */
export function NotificationPopover({
  pos,
  anchor,
  onClose,
}: {
  pos: { left: number; bottom: number };
  anchor: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const ctx = useNotifications();
  /* Read once when the panel opens. The panel only ever mounts after a
     click, so there is no server render for this to disagree with. */
  const [unreadOnly, setUnreadOnly] = useState(() => {
    try {
      return localStorage.getItem(UNREAD_KEY) === "1";
    } catch {
      return false;
    }
  });
  /* Alert preferences, read when the panel opens for the same reason. */
  const [sound, setSound] = useState(soundEnabled);
  const [desktop, setDesktop] = useState(desktopEnabled);
  const [permission, setPermission] = useState(desktopPermission);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, anchor]);

  if (!ctx) return null;

  const flip = () =>
    setUnreadOnly((v) => {
      try {
        localStorage.setItem(UNREAD_KEY, v ? "0" : "1");
      } catch {
        /* Private mode: the choice just does not persist. */
      }
      return !v;
    });

  const flipSound = () => {
    const next = !sound;
    setSoundEnabled(next);
    setSound(next);
    // Turning it on plays it, so the user hears what they have agreed to.
    if (next) chime();
  };

  const flipDesktop = async () => {
    // The browser's permission prompt is only allowed from a click like this one.
    const on = await setDesktopEnabled(!desktop);
    setDesktop(on);
    setPermission(desktopPermission());
  };

  const shown = unreadOnly ? ctx.items.filter((i) => !i.read_at) : ctx.items;

  return createPortal(
    <div
      className="notif-panel"
      role="dialog"
      aria-label="Notifications"
      ref={panel}
      style={{ left: pos.left, bottom: pos.bottom }}
    >
      <header className="notif-head">
        <h2>Notifications</h2>
        <label className="notif-toggle">
          <span>Only show unread</span>
          <Switch size="sm" checked={unreadOnly} onChange={flip} label="Only show unread" />
        </label>
        {/* The panel holds the latest few; the page holds all of them. */}
        <Link
          className="icon-btn"
          href={NOTIFICATIONS_HREF}
          aria-label="Open all notifications"
          title="Open all notifications"
          onClick={onClose}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 4h6v6" />
            <path d="M20 4 11 13" />
            <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
          </svg>
        </Link>
      </header>

      {shown.length === 0 ? (
        <p className="empty notif-empty">
          {unreadOnly && ctx.items.length > 0 ? "You're all caught up." : "No notifications yet."}
        </p>
      ) : (
        <ul className="notif-list">
          {shown.map((n) => (
            <li key={n.id}>
              <NotificationRow
                item={n}
                meId={ctx.meId}
                onFollow={() => {
                  if (!n.read_at) void ctx.markRead([n.id]);
                  onClose();
                }}
                onMark={() => void ctx.markRead([n.id])}
              />
            </li>
          ))}
        </ul>
      )}

      <footer className="notif-foot">
        <div className="notif-alerts">
          <label className="notif-toggle">
            <Switch size="sm" checked={sound} onChange={flipSound} label="Sound" />
            <span>Sound</span>
          </label>
          {permission !== "unsupported" && (
            <label className="notif-toggle">
              <Switch
                size="sm"
                checked={desktop}
                disabled={permission === "denied"}
                onChange={() => void flipDesktop()}
                label="Desktop alerts"
              />
              <span>Desktop alerts</span>
            </label>
          )}
        </div>
        {ctx.unread > 0 && (
          <button className="btn secondary small" type="button" onClick={() => void ctx.markAllRead()}>
            Mark all as read
          </button>
        )}
      </footer>
      {/* A blocked permission is a normal state, not an error: it gets a
          plain line saying where to change it, and everything else works. */}
      {permission === "denied" && (
        <p className="notif-hint muted small">
          Desktop alerts are blocked for this site in your browser settings.
        </p>
      )}
    </div>,
    document.body,
  );
}

/* One notification, in the panel and on the page alike. Opening a list marks
   nothing read; following an item does, because that is the moment it was
   actually seen. */
export function NotificationRow({
  item: n,
  meId,
  onFollow,
  onMark,
}: {
  item: NotificationItem;
  meId: number;
  onFollow: () => void;
  onMark: () => void;
}) {
  const d = describeActivity(n, meId);
  const cls = `notif-item${n.read_at ? "" : " unread"}`;
  const body = (
    <>
      <Avatar name={n.actor.name ?? "?"} email={n.actor.email ?? ""} src={n.actor.avatar} size={28} />
      <span className="notif-text">
        <span>{d.text}</span>
        {d.extra && <span className="notif-extra muted small">“{d.extra}”</span>}
        <TimeAgo className="muted small" iso={n.at} />
      </span>
      {!n.read_at && <span className="notif-dot" aria-label="Unread" />}
    </>
  );
  return d.href ? (
    <Link className={cls} href={d.href} onClick={onFollow}>
      {body}
    </Link>
  ) : (
    <button type="button" className={cls} onClick={() => !n.read_at && onMark()}>
      {body}
    </button>
  );
}
