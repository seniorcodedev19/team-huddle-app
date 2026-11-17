import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeMinutesByDay,
  activeShare,
  dayStats,
  isActiveUsage,
  parseActivities,
  parseStamp,
  parseTimelines,
  splitByLocalDay,
  tagMinutesByDay,
  tagSpans,
  usageSpans,
  usageState,
  type MtActivity,
} from "./manictimeParse";

const usage = (start: string, minutes: number, group = "ManicTime/Active"): MtActivity => {
  const s = parseStamp(start)!;
  return {
    start: s.at,
    end: s.at + minutes * 60_000,
    offset: s.offset,
    name: "",
    notes: null,
    groupKeys: [group],
    groupNames: [group.split("/")[1]],
  };
};

test("parseStamp keeps the device's offset", () => {
  assert.deepEqual(parseStamp("2026-11-17T09:00:00+02:00"), { at: Date.parse("2026-11-17T07:00:00Z"), offset: 120 });
  assert.deepEqual(parseStamp("2026-11-17T09:00:00-0530"), { at: Date.parse("2026-11-17T14:30:00Z"), offset: -330 });
  assert.deepEqual(parseStamp("2026-11-17T09:00:00Z"), { at: Date.parse("2026-11-17T09:00:00Z"), offset: 0 });
  // No offset: a wall-clock time, kept on the day it names.
  assert.deepEqual(parseStamp("2026-11-17T23:30:00"), { at: Date.parse("2026-11-17T23:30:00Z"), offset: 0 });
  assert.equal(parseStamp("not a date"), null);
});

test("only Active computer usage counts", () => {
  assert.equal(isActiveUsage(usage("2026-11-17T09:00:00Z", 10)), true);
  assert.equal(isActiveUsage(usage("2026-11-17T09:00:00Z", 10, "ManicTime/Away")), false);
  assert.equal(isActiveUsage(usage("2026-11-17T09:00:00Z", 10, "ManicTime/SessionLocked")), false);
});

test("two devices active at once count once", () => {
  const acts = [
    usage("2026-11-17T09:00:00+00:00", 60), // laptop 09:00–10:00
    usage("2026-11-17T09:30:00+00:00", 60), // desktop 09:30–10:30
    usage("2026-11-17T12:00:00+00:00", 15),
  ];
  assert.deepEqual([...activeMinutesByDay(acts, "2026-11-17", "2026-11-17")], [["2026-11-17", 105]]);
});

test("away time is left out", () => {
  const acts = [usage("2026-11-17T09:00:00Z", 60), usage("2026-11-17T10:00:00Z", 30, "ManicTime/Away")];
  assert.deepEqual([...activeMinutesByDay(acts, "2026-11-17", "2026-11-17")], [["2026-11-17", 60]]);
});

test("time is split at the person's local midnight", () => {
  // 23:00–01:00 in UTC+9 is 14:00–16:00 UTC, but two local days.
  const acts = [usage("2026-11-17T23:00:00+09:00", 120)];
  assert.deepEqual(
    [...activeMinutesByDay(acts, "2026-11-01", "2026-11-30")],
    [
      ["2026-11-17", 60],
      ["2026-11-18", 60],
    ],
  );
});

test("days outside the range are dropped", () => {
  const acts = [usage("2026-11-14T10:00:00Z", 30), usage("2026-11-15T10:00:00Z", 30)];
  assert.deepEqual([...activeMinutesByDay(acts, "2026-11-15", "2026-11-21")], [["2026-11-15", 30]]);
});

test("parseActivities reads API v3 entities with a group per activity", () => {
  const json = {
    entities: [
      { entityType: "group", entityId: 1, values: { key: "ManicTime/Active", name: "Active" } },
      { entityType: "group", entityId: 2, values: { key: "ManicTime/Away", name: "Away" } },
      {
        entityType: "activity",
        entityId: 10,
        values: { groupId: 1, name: "Active", timeInterval: { start: "2026-11-17T09:00:00+02:00", duration: 600 } },
      },
      {
        entityType: "activity",
        entityId: 11,
        values: { groupId: 2, name: "Away", timeInterval: { start: "2026-11-17T09:10:00+02:00", duration: 300 } },
      },
    ],
  };
  const acts = parseActivities(json);
  assert.equal(acts.length, 2);
  assert.deepEqual(acts[0].groupKeys, ["ManicTime/Active"]);
  assert.equal(acts[0].end - acts[0].start, 600_000);
  assert.equal(acts[0].offset, 120);
  assert.deepEqual([...activeMinutesByDay(acts, "2026-11-17", "2026-11-17")], [["2026-11-17", 10]]);
});

test("parseActivities reads API v3 tag activities through group lists", () => {
  const json = {
    entities: [
      { entityType: "group", entityId: "g1", values: { key: "client a", name: "Client A" } },
      { entityType: "groupList", entityId: "l1", values: { groupIds: ["g1"] } },
      {
        entityType: "activity",
        entityId: "a1",
        values: {
          groupListId: "l1",
          name: "Client A, Design",
          notes: "Landing page",
          timeInterval: { start: "2026-11-17T09:00:00Z", duration: 5400 },
        },
      },
    ],
  };
  const acts = parseActivities(json);
  assert.deepEqual(acts[0].groupNames, ["Client A"]);
  assert.deepEqual(tagMinutesByDay(acts, "2026-11-17", "2026-11-17"), [
    { day: "2026-11-17", tag: "Client A, Design", minutes: 90, notes: "Landing page" },
  ]);
});

test("parseActivities reads the API v2 shape", () => {
  const json = {
    activities: [
      { activityId: "1", displayName: "Active", groupId: "1", startTime: "2018-05-08T12:59:17+02:00", endTime: "2018-05-08T13:29:17+02:00" },
    ],
    groups: [{ groupId: "1", displayName: "Active", displayKey: "ManicTime/Active" }],
  };
  assert.deepEqual([...activeMinutesByDay(parseActivities(json), "2018-05-08", "2018-05-08")], [["2018-05-08", 30]]);
});

test("tag time adds up per tag per day, and notes are listed once", () => {
  const tag = (start: string, minutes: number, name: string, notes: string | null): MtActivity => ({
    ...usage(start, minutes),
    name,
    notes,
    groupKeys: [],
    groupNames: [],
  });
  const acts = [
    tag("2026-11-17T09:00:00Z", 30, "TRN-12", "Setup"),
    tag("2026-11-17T11:00:00Z", 45, "TRN-12", "Setup"),
    tag("2026-11-17T11:00:00Z", 45, "Meetings", null),
    tag("2026-11-18T09:00:00Z", 20, "TRN-12", "Review"),
  ];
  assert.deepEqual(tagMinutesByDay(acts, "2026-11-15", "2026-11-21"), [
    { day: "2026-11-17", tag: "Meetings", minutes: 45, notes: null },
    { day: "2026-11-17", tag: "TRN-12", minutes: 75, notes: "Setup" },
    { day: "2026-11-18", tag: "TRN-12", minutes: 20, notes: "Review" },
  ]);
});

test("parseTimelines reads owner, schema and the activities link from either version", () => {
  const v3 = {
    timelines: [
      {
        timelineKey: "abc",
        owner: { username: "daniel@example.com", displayName: "Daniel" },
        schema: { name: "ManicTime/ComputerUsage", version: "1" },
        deviceDisplayName: "DESKTOP-1",
        links: [{ rel: "manictime/activities", href: "http://mt:8080/api/timelines/abc/activities" }],
      },
      { timelineKey: "def", owner: { username: "daniel@example.com" }, schema: { name: "ManicTime/Tags" } },
    ],
  };
  const t = parseTimelines(v3);
  assert.equal(t[0].kind, "usage");
  assert.equal(t[0].owner.displayName, "Daniel");
  assert.equal(t[0].activitiesHref, "http://mt:8080/api/timelines/abc/activities");
  assert.equal(t[1].kind, "tags");
  assert.equal(t[1].owner.displayName, "daniel@example.com");

  const v2 = {
    timelines: [
      {
        timelineId: "7",
        owner: { userId: 2, username: "jack", displayName: "Jack" },
        timelineType: { typeName: "ManicTime/ComputerUsage" },
        clientEnvironment: { deviceName: "PC-2" },
      },
    ],
  };
  assert.deepEqual(parseTimelines(v2)[0], {
    key: "7",
    schema: "ManicTime/ComputerUsage",
    kind: "usage",
    owner: { username: "jack", displayName: "Jack" },
    device: "PC-2",
    activitiesHref: null,
  });
});

/* ---------- Timelines and the active-time report ---------- */

test("usageState: Active and Away; locked and powered off are neither", () => {
  assert.equal(usageState(usage("2026-11-17T09:00:00Z", 10)), "active");
  assert.equal(usageState(usage("2026-11-17T09:00:00Z", 10, "ManicTime/Away")), "away");
  assert.equal(usageState(usage("2026-11-17T09:00:00Z", 10, "ManicTime/SessionLocked")), null);
  assert.equal(usageState(usage("2026-11-17T09:00:00Z", 10, "ManicTime/PowerOff")), null);
});

test("splitByLocalDay: seconds from the person's midnight, cut at midnight, clipped to the range", () => {
  const s = parseStamp("2026-11-17T23:30:00+09:00")!;
  const span = { start: s.at, end: s.at + 60 * 60_000, offset: s.offset };
  assert.deepEqual(splitByLocalDay([span], "2026-11-17", "2026-11-18"), [
    { day: "2026-11-17", start: 84_600, end: 86_400 },
    { day: "2026-11-18", start: 0, end: 1_800 },
  ]);
  assert.deepEqual(splitByLocalDay([span], "2026-11-18", "2026-11-18"), [{ day: "2026-11-18", start: 0, end: 1_800 }]);
});

test("usageSpans: one computer's Active and Away stretches, each run joined", () => {
  const acts = [
    usage("2026-11-17T09:00:00Z", 30),
    usage("2026-11-17T09:30:00Z", 30), // touches the first: one stretch
    usage("2026-11-17T10:00:00Z", 15, "ManicTime/Away"),
    usage("2026-11-17T10:15:00Z", 45, "ManicTime/SessionLocked"),
  ];
  assert.deepEqual(usageSpans(acts, "2026-11-17", "2026-11-17"), [
    { day: "2026-11-17", start: 32_400, end: 36_000, kind: "active" },
    { day: "2026-11-17", start: 36_000, end: 36_900, kind: "away" },
  ]);
});

test("tagSpans: each tag's stretches, labelled", () => {
  const tag = (start: string, minutes: number, name: string) => ({ ...usage(start, minutes), name, groupKeys: [], groupNames: [] });
  const out = tagSpans(
    [tag("2026-11-17T09:00:00Z", 60, "Client A"), tag("2026-11-17T09:30:00Z", 60, "Client A"), tag("2026-11-17T13:00:00Z", 30, "Lunch")],
    "2026-11-17",
    "2026-11-17",
  );
  assert.deepEqual(out, [
    { day: "2026-11-17", start: 32_400, end: 37_800, label: "Client A" },
    { day: "2026-11-17", start: 46_800, end: 48_600, label: "Lunch" },
  ]);
});

test("dayStats: away is the gaps between first and last activity; interruptions count them", () => {
  // Two computers, 9:00–11:00 and 10:30–12:00 overlap; then 13:00–17:00.
  const h = (x: number) => x * 3600;
  assert.deepEqual(
    dayStats([
      { start: h(9), end: h(11) },
      { start: h(10.5), end: h(12) },
      { start: h(13), end: h(17) },
    ]),
    { active: h(7), away: h(1), interruptions: 1 },
  );
  assert.deepEqual(dayStats([]), { active: 0, away: 0, interruptions: 0 });
});

test("activeShare: share of each 15-minute slot that was active", () => {
  const share = activeShare([{ start: 9 * 3600 + 450, end: 9 * 3600 + 1800 }]);
  assert.equal(share.length, 96);
  assert.equal(share[36], 0.5); // 9:00–9:15, active from 9:07:30
  assert.equal(share[37], 1); // 9:15–9:30
  assert.equal(share[38], 0);
});
