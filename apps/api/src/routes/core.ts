import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth";
import { pool } from "../db";
import { beginSignIn, signInSucceeded } from "../loginGuard";
import { hashPassword, MIN_PASSWORD_LENGTH, passwordProblem, verifyPassword } from "../password";
import { audit, h, HttpError } from "../util";

export const core = Router();

core.get("/me", h(async (req, res) => {
  res.json(req.user);
}));

const profileSql = `select u.id, u.email, u.name, u.role, u.team_id, t.name as team_name, u.job_title, u.bio, u.avatar,
                           (u.password_hash is not null) as has_password
                    from users u left join teams t on t.id = u.team_id where u.id = $1`;

core.get("/profile", h(async (req, res) => {
  const { rows } = await pool.query(profileSql, [req.user!.id]);
  res.json(rows[0]);
}));

core.patch("/profile", h(async (req, res) => {
  const b = z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      job_title: z.string().trim().max(80).optional(),
      bio: z.string().trim().max(500).optional(),
    })
    .parse(req.body);
  await pool.query(
    "update users set name=coalesce($2,name), job_title=coalesce($3,job_title), bio=coalesce($4,bio) where id=$1",
    [req.user!.id, b.name ?? null, b.job_title ?? null, b.bio ?? null],
  );
  const { rows } = await pool.query(profileSql, [req.user!.id]);
  res.json(rows[0]);
}));

/* Changing your own password. The current one is asked for again, so a
   session left open on a shared computer is not enough to take the account
   over, and wrong guesses count against the same limits as wrong sign-ins. */
core.post("/profile/password", h(async (req, res) => {
  const me = req.user!;
  const b = z
    .object({
      current: z.string().min(1).max(200),
      next: z.string().min(MIN_PASSWORD_LENGTH, `must be at least ${MIN_PASSWORD_LENGTH} characters`).max(200),
    })
    .parse(req.body);
  const { rows } = await pool.query<{ password_hash: string | null }>("select password_hash from users where id=$1", [me.id]);
  const stored = rows[0]?.password_hash;
  if (!stored) throw new HttpError(400, "This account has no password to change. It signs in with Google.");
  await beginSignIn(me.email, "");
  if (!(await verifyPassword(b.current, stored))) throw new HttpError(400, "Your current password isn't right.");
  await signInSucceeded(me.email);
  if (b.next === b.current) throw new HttpError(400, "That is the password you already have. Choose a new one.");
  const problem = passwordProblem(b.next, { email: me.email, name: me.name });
  if (problem) throw new HttpError(400, problem);
  await pool.query("update users set password_hash=$2 where id=$1", [me.id, await hashPassword(b.next)]);
  // That it changed, never what to.
  await audit(me.id, "update", "password", me.id);
  res.json({ ok: true });
}));

const avatarDataUrl = z
  .string()
  .max(350_000)
  .regex(/^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i, "Use a JPEG, PNG, WebP, or GIF image");

core.put("/profile/avatar", h(async (req, res) => {
  const b = z.object({ image: avatarDataUrl }).parse(req.body);
  await pool.query("update users set avatar=$2 where id=$1", [req.user!.id, b.image]);
  await audit(req.user!.id, "update", "avatar", req.user!.id);
  const { rows } = await pool.query(profileSql, [req.user!.id]);
  res.json(rows[0]);
}));

core.delete("/profile/avatar", h(async (req, res) => {
  await pool.query("update users set avatar=null where id=$1", [req.user!.id]);
  await audit(req.user!.id, "delete", "avatar", req.user!.id);
  const { rows } = await pool.query(profileSql, [req.user!.id]);
  res.json(rows[0]);
}));

core.get("/teams", h(async (_req, res) => {
  const { rows } = await pool.query("select id, name from teams order by name");
  res.json(rows);
}));

core.post("/teams", requireRole("admin"), h(async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
  const { rows } = await pool.query("insert into teams (name) values ($1) returning id, name", [b.name]);
  await audit(req.user!.id, "create", "team", rows[0].id, b);
  res.status(201).json(rows[0]);
}));

/* Admins see everyone; managers see their team.

   `pending` tells a sign-up that is still waiting for approval from an
   account an admin switched off. Both are simply inactive, and no column
   records which: an account is waiting if the History log holds no
   deactivation of it. */
core.get("/users", h(async (req, res) => {
  const actor = req.user!;
  if (actor.role === "member") throw new HttpError(403, "Not allowed");
  const { rows } = await pool.query(
    `select id, email, name, role, team_id, active, job_title, bio, avatar, is_bidder,
            (not active and not exists (
               select 1 from audit_log a
               where a.entity = 'user' and a.entity_id = users.id::text
                 and a.action = 'update' and a.detail->>'active' = 'false')) as pending
     from users
     where ($1::boolean or team_id = $2) order by name, email`,
    [actor.role === "admin", actor.team_id],
  );
  res.json(rows);
}));

core.patch("/users/:id", requireRole("admin"), h(async (req, res) => {
  const id = Number(req.params.id);
  const b = z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      email: z.string().trim().email().max(200).optional(),
      job_title: z.string().trim().max(80).optional(),
      bio: z.string().trim().max(500).optional(),
      role: z.enum(["admin", "manager", "member"]).optional(),
      team_id: z.number().int().nullable().optional(),
      active: z.boolean().optional(),
      // Bidders are assignable to profiles but excluded from weekly metrics.
      is_bidder: z.boolean().optional(),
    })
    .parse(req.body);
  if (id === req.user!.id && ((b.role && b.role !== "admin") || b.active === false)) {
    throw new HttpError(400, "You can't remove your own admin access or deactivate yourself");
  }
  if (b.email) {
    const taken = await pool.query("select 1 from users where lower(email)=lower($1) and id<>$2", [b.email, id]);
    if (taken.rowCount) throw new HttpError(400, "That email is already in use");
  }
  const { rows } = await pool.query(
    `update users set
       name = coalesce($2, name),
       email = coalesce($3, email),
       job_title = coalesce($4, job_title),
       bio = coalesce($5, bio),
       role = coalesce($6, role),
       team_id = case when $7::boolean then $8 else team_id end,
       active = coalesce($9, active),
       is_bidder = coalesce($10, is_bidder)
     where id = $1 returning id, email, name, role, team_id, active, job_title, bio, is_bidder`,
    [
      id,
      b.name ?? null,
      b.email?.toLowerCase() ?? null,
      b.job_title ?? null,
      b.bio ?? null,
      b.role ?? null,
      "team_id" in b,
      b.team_id ?? null,
      b.active ?? null,
      b.is_bidder ?? null,
    ],
  );
  if (!rows[0]) throw new HttpError(404, "User not found");
  await audit(req.user!.id, "update", "user", id, b);
  res.json(rows[0]);
}));

core.get("/audit", requireRole("admin"), h(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const total = await pool.query<{ n: number }>("select count(*)::int as n from audit_log");
  const { rows } = await pool.query(
    `select a.id, a.at, a.action, a.entity, a.entity_id, u.email as actor
     from audit_log a left join users u on u.id = a.actor_id order by a.id desc limit $1 offset $2`,
    [limit, offset],
  );
  res.json({ rows, total: total.rows[0]?.n ?? 0, limit, offset });
}));
