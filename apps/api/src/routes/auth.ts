import { Router, type Request } from "express";
import { jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";
import { adminEmails } from "../auth";
import { pool } from "../db";
import { beginSignIn, beginSignUp, signInSucceeded } from "../loginGuard";
import { hashPassword, MIN_PASSWORD_LENGTH, NO_ACCOUNT_HASH, passwordProblem, verifyPassword } from "../password";
import { audit, h, HttpError } from "../util";

export const publicAuth = Router();

/* Sign-up and sign-in take no user token, since there is no user yet, but
   they are not open to the internet either. The web app proves each call is
   its own with a one-minute token signed with API_JWT_SECRET, and passes
   along the visitor's address, which is what loginGuard counts attempts by.
   Called directly, these endpoints answer 401: every attempt has to come
   through the website. */
async function fromWebApp(req: Request): Promise<{ ip: string }> {
  const refuse = new HttpError(401, "Sign in on the website.", "web_only");
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const secret = process.env.API_JWT_SECRET;
  if (!token || !secret) throw refuse;
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      requiredClaims: ["exp"],
    }));
  } catch {
    throw refuse;
  }
  // A signed-in user's token is signed with the same secret; it is not this.
  if (payload.kind !== "auth") throw refuse;
  return { ip: typeof payload.ip === "string" ? payload.ip.slice(0, 64) : "" };
}

const signupBody = z.object({
  email: z.string().trim().email().max(200).transform((s) => s.toLowerCase()),
  password: z.string().min(MIN_PASSWORD_LENGTH, `must be at least ${MIN_PASSWORD_LENGTH} characters`).max(200),
  name: z.string().trim().max(80).optional().default(""),
});

const loginBody = z.object({
  email: z.string().trim().email().max(200).transform((s) => s.toLowerCase()),
  password: z.string().min(1).max(200),
});

/* Puts a new sign-up in front of the admins, as a notification that leads to
   Admin > Users. */
async function tellAdmins(userId: number) {
  const admins = await pool.query<{ id: number }>("select id from users where role = 'admin' and active");
  await audit(userId, "signup", "user", userId, undefined, admins.rows.map((a) => a.id));
}

publicAuth.post(
  "/auth/signup",
  h(async (req, res) => {
    const { ip } = await fromWebApp(req);
    const { email, password, name } = signupBody.parse(req.body);
    const display = name || email.split("@")[0];
    const problem = passwordProblem(password, { email, name: display });
    if (problem) throw new HttpError(400, problem);
    await beginSignUp(email, ip);
    const password_hash = await hashPassword(password);

    /* A new account is inactive until an admin approves it on Admin > Users.
       Anyone can reach the sign-up form, and everyone signed in can read the
       whole team's data, so creating an account must not be enough to get in.

       One exception lets a new installation start: an address listed in
       ADMIN_EMAILS is active at once while there is no active admin yet. */
    let created: { id: number; email: string; name: string; active: boolean };
    try {
      const { rows } = await pool.query<typeof created>(
        `insert into users (email, name, role, password_hash, team_id, active)
         values ($1, $2, 'member', $3, (select id from teams order by id limit 1),
                 $4::boolean and not exists (select 1 from users where role = 'admin' and active))
         returning id, email, name, active`,
        [email, display, password_hash, adminEmails().includes(email)],
      );
      created = rows[0];
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "23505") throw new HttpError(409, "An account with that email already exists");
      throw err;
    }
    if (!created.active) {
      /* Best-effort. The account exists and is listed as waiting either way;
         failing to announce it must not turn a successful sign-up into an error. */
      await tellAdmins(created.id).catch((err) => console.error("sign-up notice failed for user", created.id, err));
    }
    res.status(201).json(created);
  }),
);

publicAuth.post(
  "/auth/login",
  h(async (req, res) => {
    const { ip } = await fromWebApp(req);
    const { email, password } = loginBody.parse(req.body);
    await beginSignIn(email, ip);
    const { rows } = await pool.query<{
      id: number;
      email: string;
      name: string;
      active: boolean;
      password_hash: string | null;
    }>("select id, email, name, active, password_hash from users where email=$1", [email]);
    const user = rows[0];
    /* The password is checked even when the email has no account or no
       password, against a hash nothing matches. The answer then takes as
       long either way, so its timing does not reveal which emails exist. */
    const right = await verifyPassword(password, user?.password_hash ?? NO_ACCOUNT_HASH);
    if (!user?.password_hash || !right) throw new HttpError(401, "Invalid email or password");
    await signInSucceeded(email);
    // Said only to someone who has the right password, so it gives nothing away.
    if (!user.active) {
      throw new HttpError(403, "This account isn't active yet. An admin needs to approve it before you can sign in.", "inactive");
    }
    res.json({ id: user.id, email: user.email, name: user.name });
  }),
);
