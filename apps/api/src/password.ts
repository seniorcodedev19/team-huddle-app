import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  const key = (await scryptAsync(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  if (key.length !== expected.length) return false;
  return timingSafeEqual(key, expected);
}

/* A well-formed hash that no password matches. Sign-in checks the password
   against this when the email has no account or no password, so the answer
   takes as long either way and the delay does not reveal which emails are
   registered. */
export const NO_ACCOUNT_HASH = `${"0".repeat(32)}:${"0".repeat(128)}`;

export const MIN_PASSWORD_LENGTH = 8;

/* Passwords of eight or more characters that are tried first by anyone
   guessing. Not a breach corpus, only the ones that turn a guess into a
   certainty; lower-case, compared without case. */
const COMMON = new Set(
  `password password1 password12 password123 password1234 password! password1! passw0rd p@ssw0rd p@ssword
   12345678 123456789 1234567890 0123456789 87654321 987654321 11111111 00000000 88888888 66666666 12121212
   12341234 11223344 123123123 147258369 abc12345 abcd1234 abcdefgh a1b2c3d4 1q2w3e4r 1qaz2wsx q1w2e3r4
   qwertyui qwertyuiop qwerty123 qwerty1234 asdfghjk asdfghjkl zxcvbnm1 1234qwer qwer1234 qazwsxedc
   iloveyou iloveyou1 sunshine princess football baseball superman starwars trustno1 computer whatever
   letmein1 letmein123 welcome1 welcome123 changeme changeme1 changeit default1 testtest test1234 testing123
   admin123 admin1234 adminadmin administrator admin@123 root1234 master123 dragon123 monkey123 hello123
   google123 teamhuddle huddle123 huddle1234`
    .split(/\s+/)
    .filter(Boolean),
);

/* Why a new password is not acceptable, in words for the person choosing it,
   or null if it is fine. Length and guessability only: no rules about symbols
   or capitals, which make passwords harder to remember without making them
   harder to guess. `who` lets it refuse a password built from the person's
   own name or email. */
export function passwordProblem(password: string, who: { email?: string; name?: string } = {}): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return "That password is one of the most commonly used. Choose one that is harder to guess.";
  if (new Set(lower).size < 4) return "That password repeats the same few characters. Choose one that is harder to guess.";
  const own = [
    (who.email ?? "").split("@")[0],
    ...(who.name ?? "").split(/\s+/),
  ]
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length >= 4);
  if (own.some((part) => lower.includes(part))) return "Don't use your own name or email in your password.";
  return null;
}
