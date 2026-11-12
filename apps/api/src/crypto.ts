import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const PREFIX = "v1";

function secretMaterial(): string {
  for (const value of [process.env.AGENT_TOKEN_SECRET, process.env.API_JWT_SECRET]) {
    const secret = (value ?? "").trim();
    if (secret.length >= 16) return secret;
  }
  throw new Error("AGENT_TOKEN_SECRET or API_JWT_SECRET must be set (16+ characters)");
}

/* scrypt is slow on purpose, and the key only changes if the secret does.
   Derived once per secret: decrypting a list of profile notes would
   otherwise pay that cost once per row. */
let cached: { secret: string; key: Buffer } | null = null;

function key(): Buffer {
  const secret = secretMaterial();
  if (cached?.secret !== secret) cached = { secret, key: scryptSync(secret, "eval-agent-tokens", 32) };
  return cached.key;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return `${PREFIX}.${iv.toString("base64url")}.${enc.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptSecret(packed: string): string {
  const [ver, ivB64, dataB64, tagB64] = packed.split(".");
  if (ver !== PREFIX || !ivB64 || !dataB64 || !tagB64) throw new Error("Invalid encrypted secret");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64url"));
  d.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([d.update(Buffer.from(dataB64, "base64url")), d.final()]).toString("utf8");
}

/* Text fields stored encrypted, such as profile notes. Same key and format
   as the stored tokens above. */

const SEALED = /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/;

/** Whether a stored value is already encrypted. */
export const isSealed = (stored: string) => SEALED.test(stored);

/** Encrypts a value for storage. Empty stays empty, so "no notes" needs no key. */
export const sealText = (plain: string) => (plain ? encryptSecret(plain) : "");

/* Reads a stored value back. A row written before encryption was switched
   on is still plain text and is returned as it is; it is encrypted the next
   time it is saved, or by the one-off script.

   Returns null if the value is encrypted but cannot be read — the secret
   was changed. The caller must not treat that as empty: saving an empty
   field over it would destroy what is still recoverable with the old key. */
export function openText(stored: string): string | null {
  if (!stored || !isSealed(stored)) return stored;
  try {
    return decryptSecret(stored);
  } catch {
    return null;
  }
}
