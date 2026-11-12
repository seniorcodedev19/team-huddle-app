import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth";
import { bus } from "../bus";
import { pool } from "../db";
import { h } from "../util";

export const notifications = Router();

/* One person's notifications: the audit_log rows they were named on.

   The phrasing is not stored. A sentence written at insert time freezes a
   name that may later change, and cannot be reworded without a migration, so
   the row keeps action/entity/detail and the client composes the line. */
const feedSql = `
  select a.id::int as id, a.action, a.entity, a.entity_id, a.detail, a.at,
         r.read_at,
         json_build_object(
           'user_id', u.id,
           'name', coalesce(nullif(u.name,''), u.email),
           'email', u.email,
           'avatar', u.avatar) as actor
  from activity_recipients r
  join audit_log a on a.id = r.activity_id
  left join users u on u.id = a.actor_id
  where r.user_id = $1`;

notifications.get(
  "/notifications",
  h(async (req, res) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(30),
        /* Paging by id, not offset: new rows arrive while someone is
           scrolling, and an offset would shift under them. */
        before: z.coerce.number().int().optional(),
        unread: z.coerce.boolean().optional(),
      })
      .parse(req.query);

    const params: unknown[] = [req.user!.id];
    let sql = feedSql;
    if (q.before) {
      params.push(q.before);
      sql += ` and a.id < $${params.length}`;
    }
    if (q.unread) sql += " and r.read_at is null";
    params.push(q.limit);
    sql += ` order by a.id desc limit $${params.length}`;

    const [rows, counts] = await Promise.all([
      pool.query(sql, params),
      pool.query(
        "select count(*)::int unread from activity_recipients where user_id=$1 and read_at is null",
        [req.user!.id],
      ),
    ]);
    res.json({ items: rows.rows, unread: counts.rows[0].unread });
  }),
);

/* Marking read. Opening the panel does not do this — that would defeat
   coming back to something later — so it is always an explicit act. */
notifications.post(
  "/notifications/read",
  h(async (req, res) => {
    const b = z
      .object({
        ids: z.array(z.number().int()).max(200).optional(),
        all: z.boolean().optional(),
      })
      .parse(req.body ?? {});

    if (b.all) {
      await pool.query(
        "update activity_recipients set read_at = now() where user_id=$1 and read_at is null",
        [req.user!.id],
      );
    } else if (b.ids?.length) {
      await pool.query(
        `update activity_recipients set read_at = now()
         where user_id=$1 and read_at is null and activity_id = any($2::bigint[])`,
        [req.user!.id, b.ids],
      );
    }

    const { rows } = await pool.query(
      "select count(*)::int unread from activity_recipients where user_id=$1 and read_at is null",
      [req.user!.id],
    );
    res.json({ unread: rows[0].unread });
  }),
);

/* The admin Activity view: what people did on the things they work on, as
   opposed to History, which is every audited change including settings and
   imports. Same audit_log rows, narrowed to these entities. */
const ACTIVITY_ENTITIES = ["card", "comment", "interview"];
/* A profile's own edits are settings, but being assigned to one is something
   that happened to a person, so that single action counts as activity. */
const ACTIVITY_WHERE = "(a.entity = any($1::text[]) or (a.entity = 'profile' and a.action = 'assign'))";

notifications.get(
  "/activity",
  requireRole("admin"),
  h(async (req, res) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);

    const [rows, total] = await Promise.all([
      pool.query(
        `select a.id::int as id, a.action, a.entity, a.entity_id, a.detail, a.at,
                json_build_object(
                  'user_id', u.id,
                  'name', coalesce(nullif(u.name,''), u.email),
                  'email', u.email,
                  'avatar', u.avatar) as actor,
                coalesce(
                  (select json_agg(coalesce(nullif(ru.name,''), ru.email)
                                   order by coalesce(nullif(ru.name,''), ru.email))
                   from activity_recipients r join users ru on ru.id = r.user_id
                   where r.activity_id = a.id),
                  '[]'::json) as notified
         from audit_log a
         left join users u on u.id = a.actor_id
         where ${ACTIVITY_WHERE}
         order by a.id desc limit $2 offset $3`,
        [ACTIVITY_ENTITIES, q.limit, q.offset],
      ),
      pool.query(`select count(*)::int n from audit_log a where ${ACTIVITY_WHERE}`, [
        ACTIVITY_ENTITIES,
      ]),
    ]);
    res.json({ rows: rows.rows, total: total.rows[0].n, limit: q.limit, offset: q.offset });
  }),
);

/* The live channel: tells an open browser that something new is waiting.

   It carries a signal, not the notification. The client answers every event
   — and every reconnect — by re-reading GET /notifications, so the feed in
   Postgres stays the only source of truth and nothing here needs replaying:
   a message lost while a connection was down is picked up by the read that
   follows the reconnect.

   The API token is checked once, when the stream opens. It lasts two
   minutes and the stream lasts much longer; the token gates opening a
   stream, not holding one. Each reconnect arrives with a fresh token.

   No database connection is held while the stream is open. */
const HEARTBEAT_MS = 25_000;

notifications.get("/notifications/stream", (req, res) => {
  const userId = req.user!.id;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Proxies that buffer responses would hold events back; this opts out.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write("retry: 5000\n\n");

  const unsubscribe = bus.subscribe(userId, (activityId) => {
    res.write(`event: activity\ndata: ${JSON.stringify({ id: activityId })}\n\n`);
  });
  /* A comment line, ignored by the browser. It keeps idle connections from
     being closed by anything in between, and a write to a dead socket is how
     a vanished client gets noticed. */
  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);

  const close = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on("close", close);
  res.on("error", close);
});
