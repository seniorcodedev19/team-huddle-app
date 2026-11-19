import { pool } from "./db";
import { HttpError } from "./util";

/* Slows down password guessing and bulk sign-ups (migration 033).

   Attempts are rows in auth_attempts rather than counters in memory: on
   serverless hosting each request may land on a different instance, so only
   the database sees them all.

   The limits are per email and per address together, so one person fumbling
   their password does not lock anyone else out, with wider ceilings behind
   that for guessing spread across addresses or across accounts. */

export const WINDOW_MINUTES = 15;

export const LIMITS = {
  /** Wrong passwords for one email from one address, per window. */
  pair: 5,
  /** Wrong passwords for one email from anywhere, per window. */
  email: 20,
  /** Wrong passwords from one address for any email, per window. */
  ip: 50,
  /** Sign-ups from one address, per hour. */
  signups: 10,
} as const;

export type Counts = { pair: number; email: number; ip: number };

/** Whether a sign-in attempt goes over a limit. The counts include that attempt. */
export function overLimit(c: Counts): boolean {
  return c.pair > LIMITS.pair || c.email > LIMITS.email || c.ip > LIMITS.ip;
}

/* Until migration 033 has been applied there is nothing to count in. Signing
   in must keep working in that gap, so the guard stands aside and says so
   once, instead of failing every sign-in. */
let warned = false;

function tableMissing(err: unknown): boolean {
  if ((err as { code?: string } | null)?.code !== "42P01") return false;
  if (!warned) {
    warned = true;
    console.warn("Sign-in throttling is OFF: the auth_attempts table is missing. Run `npm run db:migrate`.");
  }
  return true;
}

/* Call before checking a password. Refuses with 429 once there have been too
   many wrong ones.

   The attempt is written first and counted second, so a burst of parallel
   requests cannot all slip through on the same stale count. A refused
   attempt is removed again: otherwise hammering a locked account would keep
   it locked for as long as the hammering went on. */
export async function beginSignIn(email: string, ip: string): Promise<void> {
  try {
    const { rows } = await pool.query<{ id: string }>(
      "insert into auth_attempts (kind, email, ip) values ('login', $1, $2) returning id",
      [email, ip],
    );
    const counts = await pool.query<Counts>(
      `select count(*) filter (where email = $1 and ip = $2)::int as pair,
              count(*) filter (where email = $1)::int as email,
              count(*) filter (where ip = $2 and $2 <> '')::int as ip
       from auth_attempts
       where kind = 'login' and at > now() - $3::int * interval '1 minute'
         and (email = $1 or (ip = $2 and $2 <> ''))`,
      [email, ip, WINDOW_MINUTES],
    );
    if (overLimit(counts.rows[0])) {
      await pool.query("delete from auth_attempts where id = $1", [rows[0].id]);
      throw new HttpError(429, `Too many sign-in attempts. Wait ${WINDOW_MINUTES} minutes and try again.`, "throttled");
    }
  } catch (err) {
    if (err instanceof HttpError || !tableMissing(err)) throw err;
  }
}

/* The password was right: this email's wrong attempts no longer count
   against it. Also where rows past a day old are dropped. */
export async function signInSucceeded(email: string): Promise<void> {
  try {
    await pool.query(
      "delete from auth_attempts where (kind = 'login' and email = $1) or at < now() - interval '1 day'",
      [email],
    );
  } catch (err) {
    if (!tableMissing(err)) throw err;
  }
}

/* Call before creating an account. Every sign-up counts, whether or not it
   ends in an account, so this also limits using the sign-up form to find out
   which emails are registered. */
export async function beginSignUp(email: string, ip: string): Promise<void> {
  try {
    const { rows } = await pool.query<{ id: string }>(
      "insert into auth_attempts (kind, email, ip) values ('signup', $1, $2) returning id",
      [email, ip],
    );
    const made = await pool.query<{ n: number }>(
      "select count(*)::int as n from auth_attempts where kind = 'signup' and ip = $1 and at > now() - interval '1 hour'",
      [ip],
    );
    if (made.rows[0].n > LIMITS.signups) {
      await pool.query("delete from auth_attempts where id = $1", [rows[0].id]);
      throw new HttpError(429, "Too many accounts have been created from this network. Try again in an hour.", "throttled");
    }
  } catch (err) {
    if (err instanceof HttpError || !tableMissing(err)) throw err;
  }
}
