import type { NextFunction, Request, Response } from "express";
import { jwtVerify } from "jose";
import { pool } from "./db";
import type { Role, User } from "./types";

const secret = () => new TextEncoder().encode(process.env.API_JWT_SECRET ?? "");

export const adminEmails = () =>
  (process.env.ADMIN_EMAILS ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// The web app signs a short-lived HS256 token for the signed-in Google user.
// We verify it, then find or create the matching row in `users`.
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "Missing token" });
    if (!process.env.API_JWT_SECRET) return res.status(500).json({ error: "API_JWT_SECRET is not set" });

    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const email = String(payload.email ?? "").toLowerCase();
    if (!email) return res.status(401).json({ error: "Token has no email" });
    const name = String(payload.name ?? "");
    const isAdmin = adminEmails().includes(email);

    /* A first sign-in creates the row, inactive: a new account can do nothing
       until an admin approves it on Admin > Users, the same rule /auth/signup
       applies. An address listed in ADMIN_EMAILS is the exception, which is
       how the first admin gets in. An existing row keeps the state it has. */
    const { rows } = await pool.query<User>(
      `insert into users (email, name, role, team_id, active)
       values ($1, $2, $3, (select id from teams order by id limit 1), $4)
       on conflict (email) do update set
         role = case when $4::boolean then 'admin' else users.role end
       returning id, email, name, role, team_id, active, avatar`,
      [email, name, isAdmin ? "admin" : "member", isAdmin],
    );
    const user = rows[0];
    if (!user.active) {
      return res
        .status(403)
        .json({ error: "This account isn't active yet. An admin needs to approve it.", code: "inactive" });
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Not allowed" });
    }
    next();
  };
}

// Who may see / edit a given user's data. Everyone in the project can see status and results.
export function canView(_actor: User, _target: { id: number; team_id: number | null }) {
  return true;
}

export function canEdit(actor: User, target: { id: number; team_id: number | null }) {
  if (actor.role === "admin") return true;
  return actor.role === "manager" && actor.team_id !== null && actor.team_id === target.team_id;
}
