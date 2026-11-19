/* Keeps an eye on the server while the app runs, window open or not.

   Two things are read, both as the signed-in person:
     - the notification feed, often: unread count, and what just arrived
     - the person's own week, rarely: its status, and whether to remind them

   A read that fails changes nothing: the next one tries again, and the
   badge keeps its last known count. This is deliberately a poll and not the
   web app's event stream: a stream holds a connection open for every
   running copy, and a tray app runs all day. */

import { announce, parseFeed, type FeedItem } from "./feed";
import {
  addDays,
  clockOf,
  dueReminder,
  parseWeek,
  todayUtc,
  weekStartOf,
  type Reminder,
  type WeekLite,
} from "./reminder";
import type { ApiResult } from "./server";

export type Me = { id: number; name: string; role: string };

export type WatchState = {
  /** null until the first answer; false when the server says nobody is signed in. */
  signedIn: boolean | null;
  /** false when the last read could not reach the server at all. */
  reachable: boolean;
  unread: number;
  me: Me | null;
  /** The person's current week, once it has been read. */
  week: WeekLite | null;
};

export type WatcherDeps = {
  origin: () => string | null;
  call: (origin: string, method: "GET" | "POST", pathname: string, body?: unknown) => Promise<ApiResult>;
  reminded: () => Record<string, string>;
  now: () => Date;
  pollMs: number;
  weekMs: number;
  onState: (state: WatchState) => void;
  onFresh: (items: FeedItem[], me: Me | null) => void;
  onReminder: (reminder: Reminder) => void;
};

const BLANK: WatchState = { signedIn: null, reachable: true, unread: 0, me: null, week: null };

export class Watcher {
  state: WatchState = { ...BLANK };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private stopped = true;
  /** Newest notification id accounted for; null means "set the baseline". */
  private since: number | null = null;
  private weekReadAt = 0;

  constructor(private readonly deps: WatcherDeps) {}

  start() {
    this.stopped = false;
    this.schedule(0);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Read soon, without waiting for the next turn: something just changed. */
  kick(delayMs = 1200) {
    if (!this.stopped) this.schedule(delayMs);
  }

  /** The person's week just changed (they submitted it, say): read it again now. */
  refreshWeek() {
    this.weekReadAt = 0;
    this.kick(800);
  }

  /* Forget who was signed in. Called when the server changes and when
     someone signs in or out, so one person's baseline is never used to
     decide what is new for another. */
  reset() {
    this.since = null;
    this.weekReadAt = 0;
    this.setState({ ...BLANK });
    this.kick(300);
  }

  private schedule(delayMs: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private setState(next: WatchState) {
    this.state = next;
    this.deps.onState(next);
  }

  private async tick() {
    if (this.busy) return this.schedule(500);
    this.busy = true;
    try {
      await this.read();
    } catch (err) {
      console.error("watcher", err);
    } finally {
      this.busy = false;
      if (!this.stopped) this.schedule(this.deps.pollMs);
    }
  }

  private async read() {
    const origin = this.deps.origin();
    if (!origin) {
      if (this.state.signedIn !== null) this.setState({ ...BLANK });
      return;
    }

    let res: ApiResult;
    try {
      res = await this.deps.call(origin, "GET", "/notifications?limit=30");
    } catch {
      if (this.state.reachable) this.setState({ ...this.state, reachable: false });
      return;
    }
    // The server changed while the answer was on its way.
    if (origin !== this.deps.origin()) return;

    if (res.status === 401) {
      this.since = null;
      this.weekReadAt = 0;
      this.setState({ ...BLANK, signedIn: false });
      return;
    }
    const feed = res.status === 200 ? parseFeed(res.body) : null;
    if (!feed) {
      // The web app answered but the API behind it did not. Keep what we know.
      if (!this.state.reachable) this.setState({ ...this.state, reachable: true });
      return;
    }

    let me = this.state.me;
    if (!me) me = await this.readMe(origin);

    const { newestSeen, fresh } = announce(feed.items, this.since);
    this.since = newestSeen;
    this.setState({ ...this.state, signedIn: true, reachable: true, unread: feed.unread, me });
    if (fresh.length) this.deps.onFresh(fresh, me);

    if (this.deps.now().getTime() - this.weekReadAt >= this.deps.weekMs) {
      this.weekReadAt = this.deps.now().getTime();
      await this.readWeek(origin);
    }
  }

  private async readMe(origin: string): Promise<Me | null> {
    try {
      const res = await this.deps.call(origin, "GET", "/me");
      const o = res.body as Record<string, unknown> | null;
      if (res.status !== 200 || !o || typeof o.id !== "number") return null;
      return {
        id: o.id,
        name: typeof o.name === "string" && o.name ? o.name : String(o.email ?? ""),
        role: typeof o.role === "string" ? o.role : "member",
      };
    } catch {
      return null;
    }
  }

  private async readWeek(origin: string) {
    const now = this.deps.now();
    const clock = clockOf(now);
    const thisWeek = weekStartOf(todayUtc(now));
    try {
      const cur = await this.deps.call(origin, "GET", `/week?week_start=${thisWeek}`);
      const current = cur.status === 200 ? parseWeek(cur.body) : null;
      /* Last week is only read while it could still be mentioned: a week's
         answer carries every metric and entry, so it is not asked for idly. */
      let previous: WeekLite | null = null;
      if (clock.utcDay <= 2) {
        const prev = await this.deps.call(origin, "GET", `/week?week_start=${addDays(thisWeek, -7)}`);
        previous = prev.status === 200 ? parseWeek(prev.body) : null;
      }
      if (origin !== this.deps.origin() || !this.state.signedIn) return;
      this.setState({ ...this.state, week: current });
      const reminder = dueReminder({ clock, current, previous, reminded: this.deps.reminded() });
      if (reminder) this.deps.onReminder(reminder);
    } catch {
      // Try again on the next turn instead of waiting a whole interval.
      this.weekReadAt = 0;
    }
  }
}
