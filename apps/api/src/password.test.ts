import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, NO_ACCOUNT_HASH, passwordProblem, verifyPassword } from "./password";

test("a hash verifies its own password and nothing else", async () => {
  const stored = await hashPassword("correct horse battery");
  assert.match(stored, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.equal(await verifyPassword("correct horse battery", stored), true);
  assert.equal(await verifyPassword("correct horse batterx", stored), false);
  assert.notEqual(await hashPassword("correct horse battery"), stored);
});

test("the stand-in hash is well formed and matches no password", async () => {
  assert.match(NO_ACCOUNT_HASH, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  for (const guess of ["", "admin", "password", "0".repeat(64)]) {
    assert.equal(await verifyPassword(guess, NO_ACCOUNT_HASH), false);
  }
  assert.equal(await verifyPassword("anything", "not-a-hash"), false);
});

test("short, common and repetitive passwords are refused", () => {
  assert.match(passwordProblem("admin") ?? "", /at least 8/);
  assert.match(passwordProblem("Password123") ?? "", /commonly used/);
  assert.match(passwordProblem("QWERTYUIOP") ?? "", /commonly used/);
  assert.match(passwordProblem("aaaaaaaaaaaa") ?? "", /same few characters/);
  assert.match(passwordProblem("abababababab") ?? "", /same few characters/);
});

test("a password built from the person's own name or email is refused", () => {
  const who = { email: "daniel.ong@example.com", name: "Daniel Ong" };
  assert.match(passwordProblem("Daniel2026!", who) ?? "", /own name or email/);
  assert.match(passwordProblem("xx-daniel.ong-xx", who) ?? "", /own name or email/);
  // Short name parts are too common inside ordinary words to be a signal.
  assert.equal(passwordProblem("along the river bank", who), null);
});

test("an ordinary strong password is accepted", () => {
  assert.equal(passwordProblem("river-otter-lamp-42"), null);
  assert.equal(passwordProblem("Tr4ined&Ready", { email: "sam@example.com", name: "Sam" }), null);
});
