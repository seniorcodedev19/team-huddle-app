import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z, ZodError } from "zod";
import { bus } from "./bus";
import { pool } from "./db";
import { validDate } from "./dates";

export const h =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const dateStr = z.string().refine(validDate, "Use a valid date like 2026-10-12");

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return res.status(400).json({ error: `Invalid input: ${first?.path.join(".") || "body"} ${first?.message ?? ""}`.trim(), issues: err.issues });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  const code = (err as { code?: string })?.code;
  if (code === "23505") return res.status(409).json({ error: "That already exists" });
  if (code === "23503") return res.status(400).json({ error: "Referenced record does not exist" });
  console.error(err);
  res.status(500).json({ error: "Server error" });
}

/* Records what happened, and optionally who should be told.

   `notify` is the only new part: an audit_log row with no recipients is a
   plain audit entry, as every existing call site produces. One with
   recipients is a notification. Returns the activity id so a caller can
   publish it on the live bus. */
export async function audit(
  actorId: number | null,
  action: string,
  entity: string,
  entityId: string | number | null,
  detail?: unknown,
  notify?: number[],
): Promise<number> {
  const { rows } = await pool.query(
    "insert into audit_log (actor_id, action, entity, entity_id, detail) values ($1,$2,$3,$4,$5) returning id",
    [actorId, action, entity, entityId === null ? null : String(entityId), detail ? JSON.stringify(detail) : null],
  );
  const activityId = Number(rows[0].id);

  if (notify?.length) {
    /* Two rules enforced here rather than at each call site, so no caller can
       get them wrong: nobody is notified of their own action, and a user
       named twice is still one recipient. */
    const to = [...new Set(notify)].filter((id) => id !== actorId);
    if (to.length) {
      /* Best-effort. The action itself has already happened and been
         audited; failing to tell someone about it must not turn a saved
         comment into an error for the person who wrote it. Logged, so a
         broken notification path is still visible. */
      try {
        await pool.query(
          `insert into activity_recipients (activity_id, user_id)
           select $1, unnest($2::int[])
           on conflict do nothing`,
          [activityId, to],
        );
        bus.publish(to, activityId);
      } catch (err) {
        console.error("notify failed for activity", activityId, err);
      }
    }
  }
  return activityId;
}
