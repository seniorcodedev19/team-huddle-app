import { Router } from "express";
import { z } from "zod";
import { addDays, todayUtc } from "../dates";
import { pool } from "../db";
import { dateStr, h, HttpError } from "../util";

export const work = Router();

/* Daily work amounts (migration 028).

   Profile metrics belong to a profile; card metrics belong to one board
   card. Which is which is fixed here and mirrored by a check constraint, so
   a profile number can never be filed against a card or the other way. */
const PROFILE_METRICS = ["apply", "interview_scheduled", "interview_done"] as const;
const CARD_METRICS = ["ai_apply", "ai_interview", "assessment"] as const;

/* The widest range one read may ask for. The dashboard's month view covers
   about half a year; this leaves room without letting a request scan
   everything. */
const MAX_RANGE_DAYS = 400;

work.get(
  "/work",
  h(async (req, res) => {
    const today = todayUtc();
    const q = z
      .object({
        from: dateStr.optional(),
        to: dateStr.optional(),
        // Narrows to one board card, for the card panel.
        card_no: z.coerce.number().int().min(1).optional(),
        // Narrows to one profile's own numbers (not its cards'), for the profile panel.
        profile_id: z.coerce.number().int().min(1).optional(),
      })
      .parse(req.query);

    const to = q.to ?? today;
    const from = q.from ?? to;
    if (from > to) throw new HttpError(400, "The start date has to be on or before the end date");
    if (addDays(from, MAX_RANGE_DAYS) < to) {
      throw new HttpError(400, "That range is too long. Ask for about a year or less.");
    }

    const params: unknown[] = [from, to];
    let where = "w.log_date between $1 and $2";
    if (q.card_no) {
      params.push(q.card_no);
      where += ` and ta.card_no = $${params.length}`;
    }
    if (q.profile_id) {
      params.push(q.profile_id);
      where += ` and w.profile_id = $${params.length} and w.account_id is null`;
    }
    const { rows } = await pool.query(
      `select w.log_date, w.profile_id, ta.card_no, w.metric, w.value
       from work_logs w
       left join training_accounts ta on ta.id = w.account_id
       where ${where}
       order by w.log_date`,
      params,
    );
    // `today` goes with it so the browser never has to decide what day it is.
    res.json({ today, from, to, rows });
  }),
);

/* Set one number for one day. Sending 0 clears it. */
work.put(
  "/work",
  h(async (req, res) => {
    const actor = req.user!;
    const b = z
      .object({
        log_date: dateStr,
        metric: z.enum([...PROFILE_METRICS, ...CARD_METRICS]),
        profile_id: z.number().int().optional(),
        card_no: z.number().int().optional(),
        value: z.number().int("Use a whole number").min(0).max(9999),
      })
      .parse(req.body);

    if (b.log_date > todayUtc()) {
      throw new HttpError(400, "That day hasn't happened yet, so there is no work to record for it");
    }

    const forCard = (CARD_METRICS as readonly string[]).includes(b.metric);
    let profileId: number;
    let accountId: number | null = null;

    if (forCard) {
      if (b.card_no === undefined) throw new HttpError(400, "Choose which card this number is for");
      const { rows } = await pool.query(
        "select id, profile_id from training_accounts where card_no=$1",
        [b.card_no],
      );
      if (!rows[0]) throw new HttpError(404, "That card doesn't exist");
      accountId = rows[0].id as number;
      profileId = rows[0].profile_id as number;
    } else {
      if (b.profile_id === undefined) throw new HttpError(400, "Choose which profile this number is for");
      const { rows } = await pool.query("select id from profiles where id=$1", [b.profile_id]);
      if (!rows[0]) throw new HttpError(404, "Profile not found");
      profileId = b.profile_id;
    }

    if (b.value === 0) {
      await pool.query(
        `delete from work_logs
         where log_date=$1 and metric=$2
           and ${forCard ? "account_id=$3" : "profile_id=$3 and account_id is null"}`,
        [b.log_date, b.metric, forCard ? accountId : profileId],
      );
    } else if (forCard) {
      await pool.query(
        `insert into work_logs (log_date, profile_id, account_id, metric, value, updated_by)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (log_date, account_id, metric) where account_id is not null
         do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
        [b.log_date, profileId, accountId, b.metric, b.value, actor.id],
      );
    } else {
      await pool.query(
        `insert into work_logs (log_date, profile_id, metric, value, updated_by)
         values ($1,$2,$3,$4,$5)
         on conflict (log_date, profile_id, metric) where account_id is null
         do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
        [b.log_date, profileId, b.metric, b.value, actor.id],
      );
    }

    res.json({
      log_date: b.log_date,
      profile_id: profileId,
      card_no: forCard ? b.card_no : null,
      metric: b.metric,
      value: b.value,
    });
  }),
);
