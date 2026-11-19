import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS, overLimit } from "./loginGuard";

test("attempts up to each limit are allowed, the next one is not", () => {
  assert.equal(overLimit({ pair: 1, email: 1, ip: 1 }), false);
  assert.equal(overLimit({ pair: LIMITS.pair, email: LIMITS.pair, ip: LIMITS.pair }), false);
  assert.equal(overLimit({ pair: LIMITS.pair + 1, email: LIMITS.pair + 1, ip: LIMITS.pair + 1 }), true);
});

test("guessing one account from many addresses is stopped by the per-email ceiling", () => {
  assert.equal(overLimit({ pair: 1, email: LIMITS.email, ip: 1 }), false);
  assert.equal(overLimit({ pair: 1, email: LIMITS.email + 1, ip: 1 }), true);
});

test("guessing many accounts from one address is stopped by the per-address ceiling", () => {
  assert.equal(overLimit({ pair: 1, email: 1, ip: LIMITS.ip }), false);
  assert.equal(overLimit({ pair: 1, email: 1, ip: LIMITS.ip + 1 }), true);
});

test("one person's wrong passwords do not reach the wider ceilings first", () => {
  assert.ok(LIMITS.pair < LIMITS.email && LIMITS.email < LIMITS.ip);
});
