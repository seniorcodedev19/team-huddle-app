import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const PREFIX = "v1";

/* The secrets a stored value may be encrypted under.

   The first one encrypts. Every one is tried when decrypting, so a value
   written under an earlier secret stays readable after the secret changes:

   - AGENT_TOKEN_SECRET is the encryption secret.
   - API_JWT_SECRET was the key whenever AGENT_TOKEN_SECRET was unset, so
     anything written by a deployment without one is still under it. It stays
     in the list for that reason, and is the encryption secret only if
     AGENT_TOKEN_SECRET is missing.
   - AGENT_TOKEN_SECRET_OLD (comma-separated) holds retired secrets. To change
     the secret, move the old value there and set the new one; nothing has to
     be entered again. `npm run db:rekey` then re-encrypts what is stored, and
     the old value can be dropped once it reports nothing left.

   Secrets shorter than 16 characters are ignored, as before. */
function secrets(): string[] {
  const all = [
    process.env.AGENT_TOKEN_SECRET,
    process.env.API_JWT_SECRET,
    ...(process.env.AGENT_TOKEN_SECRET_OLD ?? "").split(","),
  ]
    .map((value) => (value ?? "").trim())
    .filter((secret) => secret.length >= 16);
  if (!all.length) throw new Error("AGENT_TOKEN_SECRET or API_JWT_SECRET must be set (16+ characters)");
  return [...new Set(all)];
}

/* scrypt is slow on purpose, and a key only changes if its secret does.
   Derived once per secret: decrypting a list of contacts would otherwise pay
   that cost once per field. */
const derived = new Map<string, Buffer>();

function keyFor(secret: string): Buffer {
  let key = derived.get(secret);
  if (!key) {
    key = scryptSync(secret, "eval-agent-tokens", 32);
    derived.set(secret, key);
  }
  return key;
}

function parts(packed: string) {
  const [ver, ivB64, dataB64, tagB64] = packed.split(".");
  if (ver !== PREFIX || !ivB64 || !dataB64 || !tagB64) throw new Error("Invalid encrypted secret");
  return {
    iv: Buffer.from(ivB64, "base64url"),
    data: Buffer.from(dataB64, "base64url"),
    tag: Buffer.from(tagB64, "base64url"),
  };
}

/* GCM authenticates what it decrypts, so the wrong key is an error rather
   than garbage. That is what makes trying each key in turn safe. */
function open(p: ReturnType<typeof parts>, secret: string): string {
  const d = createDecipheriv("aes-256-gcm", keyFor(secret), p.iv);
  d.setAuthTag(p.tag);
  return Buffer.concat([d.update(p.data), d.final()]).toString("utf8");
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyFor(secrets()[0]), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return `${PREFIX}.${iv.toString("base64url")}.${enc.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptSecret(packed: string): string {
  const p = parts(packed);
  let failure: unknown;
  for (const secret of secrets()) {
    try {
      return open(p, secret);
    } catch (err) {
      failure = err;
    }
  }
  throw failure instanceof Error ? failure : new Error("Could not decrypt");
}

/** Whether a stored value is encrypted under the secret new values get. */
export function underCurrentSecret(packed: string): boolean {
  try {
    open(parts(packed), secrets()[0]);
    return true;
  } catch {
    return false;
  }
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

   Returns null if the value is encrypted but cannot be read: none of the
   configured secrets opens it. The caller must not treat that as empty:
   saving an empty field over it would destroy what is still recoverable
   with the right secret. */
export function openText(stored: string): string | null {
  if (!stored || !isSealed(stored)) return stored;
  try {
    return decryptSecret(stored);
  } catch {
    return null;
  }
}
