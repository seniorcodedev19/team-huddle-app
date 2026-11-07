import { Router } from "express";
import { z } from "zod";
import { canEdit, requireRole } from "../auth";
import { pool } from "../db";
import { audit, h, HttpError } from "../util";

export const interviews = Router();

const listSql = `
  select i.id, i.member_id, i.interviewer_id, i.scheduled_at, i.topic, i.status, i.notes,
         i.profile_id, i.ends_at, i.all_day, i.location,
         i.client_name, i.client_email,
         pr.full_name as profile_name, pr.email as profile_email,
         coalesce(nullif(m.name,''), m.email) as member_name,
         m.email as member_email, m.avatar as member_avatar,
         coalesce(nullif(v.name,''), v.email) as interviewer_name,
         v.email as interviewer_email, v.avatar as interviewer_avatar
  from interviews i
  -- member_id is null for a profile-and-client interview, so this must be a
  -- left join or those rows vanish from every list.
  left join users m on m.id = i.member_id
  join users v on v.id = i.interviewer_id
  left join profiles pr on pr.id = i.profile_id`;

/* `from` and `to` are optional ISO instants bounding scheduled_at, half-open
   so a week's end is the next week's start with no overlap. The calendar asks
   for the range it is showing; without them this still answers with the 100
   most recent, as it always did. */
const rangeQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

interviews.get("/interviews", h(async (req, res) => {
  const a = req.user!;
  const { from, to } = rangeQuery.parse(req.query);
  const clauses: string[] = [];
  const params: unknown[] = [];
  /* A profile-and-client interview has no member, so scope it by the profile
     the viewer is assigned to; otherwise they would never see their own. */
  if (a.role === "manager") {
    params.push(a.team_id, a.id);
    clauses.push(
      `(m.team_id = $${params.length - 1} or i.interviewer_id = $${params.length}
        or exists (select 1 from profile_assignees pa
                   where pa.profile_id = i.profile_id and pa.user_id = $${params.length}))`,
    );
  } else if (a.role === "member") {
    params.push(a.id);
    clauses.push(
      `(i.member_id = $${params.length}
        or exists (select 1 from profile_assignees pa
                   where pa.profile_id = i.profile_id and pa.user_id = $${params.length}))`,
    );
  }
  if (from) {
    params.push(from);
    clauses.push(`i.scheduled_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    clauses.push(`i.scheduled_at < $${params.length}`);
  }
  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  /* A bounded range is already small, so return all of it — a busy week must
     not lose events to a limit meant for the unbounded list. */
  const limit = from || to ? "" : "limit 100";
  const { rows } = await pool.query(
    `${listSql} ${where} order by i.scheduled_at desc ${limit}`,
    params,
  );
  res.json(rows);
}));

async function memberOf(id: number) {
  const { rows } = await pool.query("select id, team_id from users where id=$1", [id]);
  if (!rows[0]) throw new HttpError(404, "Person not found");
  return rows[0] as { id: number; team_id: number | null };
}

interviews.post("/interviews", requireRole("manager", "admin"), h(async (req, res) => {
  const actor = req.user!;
  /* An interview is a meeting between one of our profiles and an outside
     client. The profile is the subject; the client has no account here, so
     they are recorded as name and email rather than a users row.

     member_id is still accepted for the older internal 1:1 form. */
  const b = z
    .object({
      profile_id: z.number().int().optional(),
      member_id: z.number().int().optional(),
      client_name: z.string().trim().max(200).default(""),
      client_email: z.string().trim().email().max(200).or(z.literal("")).default(""),
      scheduled_at: z.string().datetime(),
      ends_at: z.string().datetime().optional(),
      all_day: z.boolean().default(false),
      location: z.string().trim().max(500).default(""),
      notes: z.string().trim().max(4000).default(""),
      topic: z.string().trim().min(1).max(120).default("1:1 review"),
    })
    .parse(req.body);

  if (b.profile_id === undefined && b.member_id === undefined) {
    throw new HttpError(400, "Choose a profile for this interview");
  }
  if (b.ends_at && new Date(b.ends_at) <= new Date(b.scheduled_at)) {
    throw new HttpError(400, "The end time has to be after the start time");
  }

  /* Scheduling against a profile is scoped by who may edit that profile's
     assignees; an unassigned profile is still a valid subject, since the
     meeting is with the client, not with one of us. */
  let memberId: number | null = b.member_id ?? null;
  if (b.profile_id !== undefined) {
    const { rows } = await pool.query("select id from profiles where id=$1", [b.profile_id]);
    if (!rows[0]) throw new HttpError(404, "Profile not found");
    const assigned = await pool.query(
      "select user_id from profile_assignees where profile_id=$1 order by user_id limit 1",
      [b.profile_id],
    );
    memberId = assigned.rows[0]?.user_id ?? null;
  } else if (memberId !== null) {
    if (memberId === actor.id) throw new HttpError(400, "Pick someone else to interview");
    if (!canEdit(actor, await memberOf(memberId))) {
      throw new HttpError(403, "You can only schedule interviews with people on your team");
    }
  }

  const { rows } = await pool.query(
    `insert into interviews
       (member_id, interviewer_id, scheduled_at, topic, profile_id, ends_at,
        all_day, location, notes, client_name, client_email)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [memberId, actor.id, b.scheduled_at, b.topic, b.profile_id ?? null,
     b.ends_at ?? null, b.all_day, b.location, b.notes || null,
     b.client_name, b.client_email],
  );
  await audit(actor.id, "create", "interview", rows[0].id, {
    profile_id: b.profile_id ?? null,
    client_email: b.client_email || null,
  });
  res.status(201).json(rows[0]);
}));

/* Who may change this interview. A profile-and-client row has no member, so
   falling back to memberOf(null) would throw and make every such event
   uneditable; an admin may touch any, and whoever booked it may touch theirs. */
async function assertMayEdit(actor: Express.Request["user"], id: number) {
  const cur = await pool.query(
    "select member_id, interviewer_id from interviews where id=$1",
    [id],
  );
  if (!cur.rows[0]) throw new HttpError(404, "Interview not found");
  const row = cur.rows[0] as { member_id: number | null; interviewer_id: number };
  const a = actor!;
  if (a.role === "admin") return row;
  if (row.interviewer_id === a.id) return row;
  if (row.member_id !== null && canEdit(a, await memberOf(row.member_id))) return row;
  throw new HttpError(403, "You can only change interviews you booked");
}

interviews.patch("/interviews/:id", requireRole("manager", "admin"), h(async (req, res) => {
  const actor = req.user!;
  const id = Number(req.params.id);
  const b = z
    .object({
      scheduled_at: z.string().datetime(),
      ends_at: z.string().datetime(),
      all_day: z.boolean(),
      location: z.string().trim().max(500),
      client_name: z.string().trim().max(200),
      client_email: z.string().trim().email().max(200).or(z.literal("")),
      profile_id: z.number().int(),
      topic: z.string().trim().min(1).max(120),
      status: z.enum(["scheduled", "done", "passed", "failed", "cancelled"]),
      notes: z.string().trim().max(4000),
    })
    .partial()
    .parse(req.body);

  await assertMayEdit(actor, id);

  if (b.scheduled_at && b.ends_at && new Date(b.ends_at) <= new Date(b.scheduled_at)) {
    throw new HttpError(400, "The end time has to be after the start time");
  }

  await pool.query(
    `update interviews set
       scheduled_at = coalesce($2, scheduled_at),
       topic        = coalesce($3, topic),
       status       = coalesce($4, status),
       notes        = coalesce($5, notes),
       ends_at      = coalesce($6, ends_at),
       all_day      = coalesce($7, all_day),
       location     = coalesce($8, location),
       client_name  = coalesce($9, client_name),
       client_email = coalesce($10, client_email),
       profile_id   = coalesce($11, profile_id)
     where id = $1`,
    [id, b.scheduled_at ?? null, b.topic ?? null, b.status ?? null, b.notes ?? null,
     b.ends_at ?? null, b.all_day ?? null, b.location ?? null,
     b.client_name ?? null, b.client_email ?? null, b.profile_id ?? null],
  );
  await audit(actor.id, "update", "interview", id, { status: b.status });
  res.json({ ok: true });
}));

/* A real delete, not a cancel. Cancelling keeps the event on the calendar
   struck through, which is right for a meeting that was called off; removing
   is for one booked by mistake. */
interviews.delete("/interviews/:id", requireRole("manager", "admin"), h(async (req, res) => {
  const actor = req.user!;
  const id = Number(req.params.id);
  await assertMayEdit(actor, id);
  await pool.query("delete from interviews where id=$1", [id]);
  await audit(actor.id, "delete", "interview", id, {});
  res.json({ ok: true });
}));
