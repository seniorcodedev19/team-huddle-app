import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth";
import { encryptSecret } from "../crypto";
import { pool } from "../db";
import { baseUrl, checkConnection, isConfigured, loadConfig, runSync } from "../manictime";
import { audit, dateStr, h, HttpError } from "../util";

export const manictime = Router();

// Connection, sync status and the people links. Admin only; the secret never leaves the server.
manictime.get("/manictime", requireRole("admin"), h(async (_req, res) => {
  const c = await loadConfig();
  const [{ rows: people }, { rows: users }] = await Promise.all([
    pool.query(
      `select p.mt_username, p.display_name, p.devices, p.seen_at, p.user_id,
              coalesce(nullif(u.name,''), u.email) as user_name
       from manictime_people p left join users u on u.id = p.user_id
       order by lower(p.display_name)`,
    ),
    pool.query(
      `select id, coalesce(nullif(name,''), email) as name, email from users where active order by lower(coalesce(nullif(name,''), email))`,
    ),
  ]);
  res.json({
    configured: isConfigured(c),
    server_url: c?.server_url ?? "",
    auth_mode: c?.auth_mode ?? "password",
    username: c?.username ?? "",
    has_secret: Boolean(c?.secret_enc),
    synced_at: c?.synced_at ?? null,
    sync_error: c?.sync_error ?? null,
    sync_summary: c?.sync_summary ?? null,
    people,
    users,
  });
}));

manictime.put("/manictime/config", requireRole("admin"), h(async (req, res) => {
  const b = z
    .object({
      server_url: z
        .string()
        .trim()
        .min(1, "Enter the ManicTime server address")
        .max(300)
        .refine((v) => /^https?:\/\/[^\s/]+/i.test(v), "The server address must start with http:// or https://"),
      auth_mode: z.enum(["token", "password"]),
      username: z.string().trim().max(200).default(""),
      secret: z.string().max(2000).optional(),
    })
    .parse(req.body);
  if (b.auth_mode === "password" && !b.username) throw new HttpError(400, "Enter the ManicTime username");

  const cur = await loadConfig();
  const secret = b.secret?.trim();
  let secretEnc = cur?.secret_enc ?? null;
  // Switching between token and password makes the old secret meaningless.
  if (cur && cur.auth_mode !== b.auth_mode && !secret) secretEnc = null;
  if (secret) {
    try {
      secretEnc = encryptSecret(secret);
    } catch {
      throw new HttpError(500, "AGENT_TOKEN_SECRET or API_JWT_SECRET must be set (16+ characters)");
    }
  }
  if (!secretEnc) {
    throw new HttpError(400, b.auth_mode === "token" ? "Paste the ManicTime API token" : "Enter the ManicTime password");
  }

  await pool.query(
    `update manictime_config set server_url=$1, auth_mode=$2, username=$3, secret_enc=$4,
       updated_by=$5, updated_at=now() where id=1`,
    [baseUrl(b.server_url), b.auth_mode, b.auth_mode === "password" ? b.username : "", secretEnc, req.user!.id],
  );
  await audit(req.user!.id, "update", "manictime_config", 1, {
    server_url: baseUrl(b.server_url),
    auth_mode: b.auth_mode,
    secret_changed: Boolean(secret),
  });
  res.json({ ok: true });
}));

manictime.post("/manictime/test", requireRole("admin"), h(async (_req, res) => {
  res.json(await checkConnection());
}));

manictime.post("/manictime/sync", requireRole("admin"), h(async (req, res) => {
  const b = z.object({ from: dateStr.optional(), to: dateStr.optional() }).parse(req.body ?? {});
  const summary = await runSync(b);
  await audit(req.user!.id, "sync", "manictime", null, {
    from: summary.from,
    to: summary.to,
    days: summary.days,
    tags: summary.tags,
  });
  res.json(summary);
}));

// Which Huddle user a ManicTime user is. Takes effect on the next sync.
manictime.patch("/manictime/people/:username", requireRole("admin"), h(async (req, res) => {
  const { user_id } = z.object({ user_id: z.number().int().positive().nullable() }).parse(req.body);
  const username = String(req.params.username);
  const found = await pool.query<{ display_name: string }>(
    "select display_name from manictime_people where mt_username=$1",
    [username],
  );
  if (!found.rows[0]) throw new HttpError(404, "That ManicTime user isn't on the list any more. Reload the page.");

  if (user_id !== null) {
    const u = await pool.query("select 1 from users where id=$1 and active", [user_id]);
    if (!u.rows[0]) throw new HttpError(400, "That person isn't an active user.");
    const other = await pool.query<{ display_name: string }>(
      "select display_name from manictime_people where user_id=$1 and mt_username<>$2",
      [user_id, username],
    );
    if (other.rows[0]) {
      throw new HttpError(
        400,
        `That person is already linked to ManicTime user ${other.rows[0].display_name}. Unlink them there first.`,
      );
    }
  }
  await pool.query("update manictime_people set user_id=$1 where mt_username=$2", [user_id, username]);
  await audit(req.user!.id, user_id === null ? "unlink" : "link", "manictime_person", username, { user_id });
  res.json({ ok: true });
}));
