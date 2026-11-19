import assert from "node:assert/strict";
import { test } from "node:test";
import { alertBody, describeActivity } from "./activityText";
import { announce, badgeLabel, parseFeed, type FeedItem } from "./feed";

const item = (id: number, over: Partial<FeedItem> = {}): FeedItem => ({
  id,
  action: "comment",
  entity: "card",
  entity_id: "12",
  detail: { card_no: 12, excerpt: "Looks good" },
  at: "2026-11-19T10:00:00Z",
  read_at: null,
  actor: { name: "Ana" },
  ...over,
});

test("what was waiting at start sets the baseline and is not announced", () => {
  const a = announce([item(7), item(5)], null);
  assert.equal(a.newestSeen, 7);
  assert.deepEqual(a.fresh, []);
});

test("an empty feed at start still sets a baseline, so the first arrival is announced", () => {
  const first = announce([], null);
  assert.equal(first.newestSeen, 0);
  const next = announce([item(1)], first.newestSeen);
  assert.deepEqual(next.fresh.map((i) => i.id), [1]);
});

test("only unread items newer than the baseline are announced, oldest first", () => {
  const a = announce([item(10), item(9, { read_at: "2026-11-19T10:01:00Z" }), item(8), item(7)], 7);
  assert.deepEqual(a.fresh.map((i) => i.id), [8, 10]);
  assert.equal(a.newestSeen, 10);
});

test("nothing is announced twice", () => {
  const first = announce([item(8)], 7);
  const again = announce([item(8)], first.newestSeen);
  assert.deepEqual(again.fresh, []);
  assert.equal(again.newestSeen, 8);
});

test("the baseline never moves backwards when the feed shrinks", () => {
  assert.equal(announce([item(3)], 9).newestSeen, 9);
  assert.equal(announce([], 9).newestSeen, 9);
});

test("the feed is read defensively", () => {
  const feed = parseFeed({
    unread: 2,
    items: [
      { id: 4, action: "signup", entity: "user", entity_id: 31, detail: null, at: "x", read_at: null, actor: { name: "Bo", avatar: "data:…" } },
      { id: "5", action: "x", entity: "y" },
      null,
      { id: 6, action: "move", entity: "card", entity_id: null, detail: "nope", read_at: 5, actor: null },
    ],
  });
  assert.equal(feed?.unread, 2);
  assert.deepEqual(feed?.items.map((i) => i.id), [4, 6]);
  assert.equal(feed?.items[0].entity_id, "31");
  assert.deepEqual(feed?.items[0].actor, { name: "Bo" });
  assert.equal(feed?.items[1].detail, null);
  assert.equal(feed?.items[1].read_at, null);
  assert.equal(feed?.items[1].actor.name, null);
});

test("an answer that is not a feed is not one", () => {
  for (const bad of [null, "x", [], {}, { error: "Not signed in" }, { items: "many" }]) assert.equal(parseFeed(bad), null);
  assert.equal(parseFeed({ items: [], unread: -3 })?.unread, 0);
  assert.equal(parseFeed({ items: [] })?.unread, 0);
});

test("the badge is capped so it always fits", () => {
  assert.equal(badgeLabel(0), "");
  assert.equal(badgeLabel(-1), "");
  assert.equal(badgeLabel(1), "1");
  assert.equal(badgeLabel(9), "9");
  assert.equal(badgeLabel(10), "9+");
  assert.equal(badgeLabel(250), "9+");
});

/* These sentences must match apps/web/src/lib/activity.ts word for word:
   the same event should read the same in the app and in its alert. */
test("a notification reads as it does in the web app", () => {
  const says = (over: Partial<FeedItem>, meId?: number) => describeActivity(item(1, over), meId);

  assert.deepEqual(says({}), { text: "Ana commented on TRN-12", extra: "Looks good", href: "/ai-training/board/12" });
  assert.equal(says({ detail: { card_no: 12, mentions: [3] } }, 3).text, "Ana mentioned you on TRN-12");
  assert.equal(says({ detail: { card_no: 12, mentions: [3] } }, 4).text, "Ana commented on TRN-12");
  assert.equal(
    says({ action: "move", detail: { card_no: 12, from: "applied", to: "ongoing" } }).text,
    "Ana moved TRN-12 from Applied to Ongoing",
  );
  assert.equal(says({ action: "create", detail: null }).text, "Ana added TRN-12");
  assert.deepEqual(says({ entity: "user", action: "signup", entity_id: "9", detail: null }), {
    text: "Ana signed up and is waiting for approval",
    href: "/admin/users",
  });
  assert.deepEqual(says({ entity: "profile", action: "assign", detail: { full_name: "Sam Lee" } }, 3), {
    text: "Ana added you to the profile Sam Lee",
    href: "/profiles",
  });
  assert.deepEqual(says({ entity: "interview", action: "create", detail: { kind: "ai_interview", topic: "Round 2" } }), {
    text: "Ana created the AI interview: Round 2",
    href: "/calendar",
  });
  assert.equal(says({ entity: "comment", action: "delete", detail: { card_no: 4 } }).text, "Ana deleted a comment on TRN-4");
});

test("an unknown kind of activity still gets an honest line, and a missing name a stand-in", () => {
  const d = describeActivity(item(1, { entity: "widget", action: "polished", entity_id: "7", detail: null, actor: { name: null } }));
  assert.deepEqual(d, { text: "Someone polished widget 7", href: null });
});

test("the alert carries the quoted comment and the two times of a reschedule", () => {
  assert.equal(alertBody(describeActivity(item(1))), "Ana commented on TRN-12\n“Looks good”");
  const moved = describeActivity(
    item(1, {
      entity: "interview",
      action: "reschedule",
      detail: { kind: "interview", from: "2026-11-20T10:00:00Z", to: "2026-11-21T11:30:00Z" },
    }),
  );
  assert.equal(moved.href, "/calendar");
  assert.match(alertBody(moved), /^Ana rescheduled the interview from .+ to .+$/);
});
