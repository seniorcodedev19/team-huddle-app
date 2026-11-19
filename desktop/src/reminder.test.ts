import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays,
  clockOf,
  dueReminder,
  parseWeek,
  todayUtc,
  weekLabel,
  weekStartOf,
  type Clock,
  type WeekLite,
} from "./reminder";

const THIS = "2026-11-15"; // a Sunday
const LAST = "2026-11-08";

const week = (week_start: string, status: WeekLite["status"], hasData = true): WeekLite => ({
  week_start,
  status,
  hasData,
});
const clock = (utcDay: number, localHour: number, localDate = "2026-11-20"): Clock => ({ utcDay, localHour, localDate });
const ask = (c: Clock, current: WeekLite | null, previous: WeekLite | null = null, reminded = {}) =>
  dueReminder({ clock: c, current, previous, reminded });

test("weeks start on Sunday, in UTC, like the API's", () => {
  assert.equal(weekStartOf("2026-11-15"), "2026-11-15");
  assert.equal(weekStartOf("2026-11-19"), "2026-11-15");
  assert.equal(weekStartOf("2026-11-21"), "2026-11-15");
  assert.equal(weekStartOf("2026-11-22"), "2026-11-22");
  assert.equal(addDays("2026-12-28", 7), "2027-01-04");
  assert.equal(addDays(THIS, -7), LAST);
  assert.equal(todayUtc(new Date("2026-11-19T23:59:59Z")), "2026-11-19");
  assert.equal(weekLabel(THIS), "Nov 15 – Nov 21");
});

test("a draft week with data is mentioned on Friday afternoon and on Saturday", () => {
  const r = ask(clock(5, 15), week(THIS, "draft"));
  assert.equal(r?.key, `submit:${THIS}`);
  assert.equal(r?.href, `/dashboard?week=${THIS}`);
  assert.match(r?.body ?? "", /Nov 15 – Nov 21/);
  assert.equal(ask(clock(6, 10), week(THIS, "draft"))?.key, `submit:${THIS}`);
});

test("not before Friday afternoon", () => {
  assert.equal(ask(clock(5, 14), week(THIS, "draft")), null);
  for (const day of [0, 1, 2, 3, 4]) assert.equal(ask(clock(day, 16), week(THIS, "draft")), null, `day ${day}`);
});

test("never at night", () => {
  assert.equal(ask(clock(6, 9), week(THIS, "draft")), null);
  assert.equal(ask(clock(6, 22), week(THIS, "draft")), null);
  assert.equal(ask(clock(6, 3), week(THIS, "returned")), null);
});

test("a week that is submitted or approved needs nothing", () => {
  assert.equal(ask(clock(6, 12), week(THIS, "submitted")), null);
  assert.equal(ask(clock(6, 12), week(THIS, "approved")), null);
});

test("an empty week is never nagged about", () => {
  assert.equal(ask(clock(6, 12), week(THIS, "draft", false)), null);
  assert.equal(ask(clock(1, 12), week(THIS, "draft"), week(LAST, "draft", false)), null);
});

test("last week's draft is mentioned for the first three days of the new week", () => {
  for (const day of [0, 1, 2]) {
    assert.equal(ask(clock(day, 11), week(THIS, "draft"), week(LAST, "draft"))?.key, `submit:${LAST}`, `day ${day}`);
  }
  assert.equal(ask(clock(3, 11), week(THIS, "draft"), week(LAST, "draft")), null);
});

test("a returned week comes first, whichever week it is, on any day", () => {
  const r = ask(clock(3, 11), week(THIS, "draft"), week(LAST, "returned"));
  assert.equal(r?.key, `returned:${LAST}`);
  assert.equal(r?.title, "Your week was returned");
  assert.equal(ask(clock(6, 12), week(THIS, "returned"), week(LAST, "draft"))?.key, `returned:${THIS}`);
});

test("each reminder is shown once a day, and again the next day", () => {
  const today = { [`submit:${THIS}`]: "2026-11-20" };
  assert.equal(ask(clock(5, 16, "2026-11-20"), week(THIS, "draft"), null, today), null);
  assert.equal(ask(clock(6, 11, "2026-11-21"), week(THIS, "draft"), null, today)?.key, `submit:${THIS}`);
});

test("once the first reminder has been shown, the next most pressing one may follow", () => {
  const shown = { [`returned:${LAST}`]: "2026-11-21" };
  const r = ask(clock(6, 11, "2026-11-21"), week(THIS, "draft"), week(LAST, "returned"), shown);
  assert.equal(r?.key, `submit:${THIS}`);
});

test("nothing is said when the week could not be read", () => {
  assert.equal(ask(clock(6, 12), null, null), null);
});

test("the clock is the person's own, except for the day of the week", () => {
  const c = clockOf(new Date("2026-11-20T18:30:00Z"));
  assert.equal(c.utcDay, 5);
  assert.match(c.localDate, /^2026-11-2[01]$/);
  assert.ok(c.localHour >= 0 && c.localHour <= 23);
});

test("a week from the API is read for status and whether it holds anything", () => {
  const base = { week_start: THIS, status: "draft", time_hours: 0, daily: {} };
  assert.deepEqual(parseWeek(base), { week_start: THIS, status: "draft", hasData: false });
  assert.equal(parseWeek({ ...base, time_hours: 3.5 })?.hasData, true);
  assert.equal(parseWeek({ ...base, daily: { 4: { "2026-11-16": 2 } } })?.hasData, true);
  assert.equal(parseWeek({ ...base, daily: { 4: {} } })?.hasData, false);
  assert.equal(parseWeek({ ...base, status: "returned" })?.status, "returned");
});

test("anything that is not a week is not mistaken for one", () => {
  for (const bad of [null, "x", {}, { week_start: THIS }, { week_start: "soon", status: "draft" }, { week_start: THIS, status: "lost" }, { error: "Not signed in" }]) {
    assert.equal(parseWeek(bad), null);
  }
});
