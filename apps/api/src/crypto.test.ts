import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptSecret, encryptSecret, isSealed, openText, sealText, underCurrentSecret } from "./crypto";

const A = "first-secret-for-tests-0123456789";
const B = "second-secret-for-tests-0123456789";
const C = "third-secret-for-tests-0123456789";

function env(agent?: string, jwt?: string, old?: string) {
  for (const [k, v] of [["AGENT_TOKEN_SECRET", agent], ["API_JWT_SECRET", jwt], ["AGENT_TOKEN_SECRET_OLD", old]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

test("round trip under the current secret", () => {
  env(A, B);
  const packed = encryptSecret("xoxb-not-a-real-token");
  assert.ok(isSealed(packed));
  assert.equal(decryptSecret(packed), "xoxb-not-a-real-token");
  assert.equal(underCurrentSecret(packed), true);
});

test("a value written before AGENT_TOKEN_SECRET was set is still readable", () => {
  // A deployment without AGENT_TOKEN_SECRET encrypts under API_JWT_SECRET.
  env(undefined, B);
  const packed = sealText("written by the deployed app");
  // Another environment, same database, has AGENT_TOKEN_SECRET as well.
  env(A, B);
  assert.equal(openText(packed), "written by the deployed app");
  assert.equal(underCurrentSecret(packed), false);
  // New values go under AGENT_TOKEN_SECRET, which the first deployment cannot read.
  const fresh = sealText("written here");
  env(undefined, B);
  assert.equal(openText(fresh), null);
});

test("a retired secret keeps working while it is listed in AGENT_TOKEN_SECRET_OLD", () => {
  env(A, B);
  const packed = encryptSecret("kept");
  env(C, B);
  assert.throws(() => decryptSecret(packed));
  assert.equal(openText(packed), null);
  env(C, B, ` ${A} , too-short `);
  assert.equal(decryptSecret(packed), "kept");
  assert.equal(underCurrentSecret(packed), false);
  assert.equal(underCurrentSecret(encryptSecret("new")), true);
});

test("changing API_JWT_SECRET does not lose values if the old one is kept as retired", () => {
  env(undefined, B);
  const packed = encryptSecret("under the signing secret");
  env(undefined, C, B);
  assert.equal(decryptSecret(packed), "under the signing secret");
});

test("a tampered value is rejected, not misread", () => {
  env(A, B);
  const [v, iv, data, tag] = encryptSecret("intact").split(".");
  const flipped = Buffer.from(data, "base64url");
  flipped[0] ^= 1;
  assert.throws(() => decryptSecret([v, iv, flipped.toString("base64url"), tag].join(".")));
  assert.throws(() => decryptSecret("not-encrypted"));
});

test("plain and empty text pass through openText untouched", () => {
  env(A, B);
  assert.equal(openText(""), "");
  assert.equal(openText("a note written before encryption"), "a note written before encryption");
  assert.equal(sealText(""), "");
});

test("no usable secret is an error, not silent plain text", () => {
  env("short", "also-short");
  assert.throws(() => encryptSecret("x"), /must be set/);
});
