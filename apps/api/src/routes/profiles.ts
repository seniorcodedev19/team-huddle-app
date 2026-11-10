import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth";
import { pool } from "../db";
import { csvLine, parseCsvObjects } from "../csv";
import { fetchSiteMeta } from "../siteMeta";
import { audit, h, HttpError } from "../util";

export const profiles = Router();

export const TRAINING_STATUSES = ["created", "applied", "approved", "ongoing", "rejected"] as const;

/* How far the assigned bidder has got on a profile. Separate from the
   training-account statuses: a bidder works the opportunity, not a site. */
export const BIDDER_STATUSES = ["none", "assigned", "bidding"] as const;

/* A profile plus its assignees and training accounts, folded into JSON so one
   query answers the list. */
const profileSql = `
  select p.id, p.full_name, p.email, p.phone, p.linkedin_url, p.notes,
         p.created_by, p.created_at, p.updated_at,
         p.for_job, p.for_ai_training,
         p.bidder_id, p.bidder_status,
         (select json_build_object(
            'user_id', b.id,
            'name', coalesce(nullif(b.name,''), b.email),
            'email', b.email,
            'avatar', b.avatar)
          from users b where b.id = p.bidder_id) as bidder,
         coalesce(
           (select json_agg(json_build_object(
              'user_id', u.id,
              'name', coalesce(nullif(u.name,''), u.email),
              'email', u.email,
              'avatar', u.avatar
            ) order by coalesce(nullif(u.name,''), u.email))
            from profile_assignees pa join users u on u.id = pa.user_id
            where pa.profile_id = p.id),
           '[]'::json) as assignees,
         coalesce(
           (select json_agg(json_build_object(
              'id', ta.id,
              'card_no', ta.card_no,
              'site_id', ta.site_id,
              'site_name', ts.name,
              'status', ta.status,
              'account_email', ta.account_email,
              'note', ta.note,
              'updated_at', ta.updated_at
            ) order by ts.sort_order, ts.name)
            from training_accounts ta join training_sites ts on ts.id = ta.site_id
            where ta.profile_id = p.id),
           '[]'::json) as accounts
  from profiles p`;

async function oneProfile(id: number) {
  const { rows } = await pool.query(`${profileSql} where p.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, "Profile not found");
  return rows[0];
}

/* Minimal people list for the assignee picker. /users is manager+ only, but
   every role may assign a profile, so expose just id/name/email/avatar here.
   canView() already treats all signed-in users as able to see each other. */
profiles.get(
  "/profile-people",
  h(async (_req, res) => {
    const { rows } = await pool.query(
      `select id, coalesce(nullif(name,''), email) as name, email, avatar, is_bidder
       from users where active order by is_bidder, coalesce(nullif(name,''), email)`,
    );
    res.json(rows);
  }),
);

profiles.get(
  "/profiles",
  h(async (req, res) => {
    // mine=1 narrows to profiles assigned to the person asking.
    const mine = String(req.query.mine ?? "") === "1";
    const sql = mine
      ? `${profileSql} where exists (select 1 from profile_assignees pa
           where pa.profile_id = p.id and pa.user_id = $1) order by p.full_name`
      : `${profileSql} order by p.full_name`;
    const { rows } = await pool.query(sql, mine ? [req.user!.id] : []);
    res.json(rows);
  }),
);

profiles.get(
  "/profiles/:id",
  h(async (req, res) => {
    res.json(await oneProfile(Number(req.params.id)));
  }),
);

const profileBody = z.object({
  full_name: z.string().trim().min(1, "needs a name").max(120),
  email: z.string().trim().email("must be a valid email").max(160).or(z.literal("")).default(""),
  phone: z.string().trim().max(40).default(""),
  linkedin_url: z.string().trim().url("must be a full URL").max(300).or(z.literal("")).default(""),
  notes: z.string().trim().max(2000).default(""),
  assignee_ids: z.array(z.number().int()).max(50).default([]),
  /* What the profile is used for. A profile is normally both, so these
     default to true; clearing for_ai_training takes it off that board. */
  for_job: z.boolean().default(true),
  for_ai_training: z.boolean().default(true),
  // null clears the bidder; omitted leaves it alone.
  bidder_id: z.number().int().nullable().optional(),
  bidder_status: z.enum(BIDDER_STATUSES).optional(),
});

/* Replace a profile's assignees with exactly the ids given. */
async function setAssignees(profileId: number, ids: number[], actorId: number) {
  const unique = [...new Set(ids)];
  await pool.query("delete from profile_assignees where profile_id=$1", [profileId]);
  for (const userId of unique) {
    await pool.query(
      `insert into profile_assignees (profile_id, user_id, assigned_by) values ($1,$2,$3)
       on conflict do nothing`,
      [profileId, userId, actorId],
    );
  }
}

profiles.post(
  "/profiles",
  h(async (req, res) => {
    const actor = req.user!;
    const b = profileBody.parse(req.body);
    const { rows } = await pool.query(
      `insert into profiles (full_name, email, phone, linkedin_url, notes, created_by,
                             bidder_id, bidder_status, for_job, for_ai_training)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [
        b.full_name, b.email, b.phone, b.linkedin_url, b.notes, actor.id,
        b.bidder_id ?? null,
        // Naming a bidder without a status means the work is assigned.
        b.bidder_status ?? (b.bidder_id ? "assigned" : "none"),
        b.for_job, b.for_ai_training,
      ],
    );
    const id = rows[0].id as number;
    // A profile with no assignee belongs to whoever made it.
    await setAssignees(id, b.assignee_ids.length ? b.assignee_ids : [actor.id], actor.id);
    await audit(actor.id, "create", "profile", id, { full_name: b.full_name });
    res.status(201).json(await oneProfile(id));
  }),
);

profiles.patch(
  "/profiles/:id",
  h(async (req, res) => {
    const actor = req.user!;
    const id = Number(req.params.id);
    const b = profileBody.partial().parse(req.body);
    await oneProfile(id);

    await pool.query(
      `update profiles set
         full_name = coalesce($2, full_name),
         email = coalesce($3, email),
         phone = coalesce($4, phone),
         linkedin_url = coalesce($5, linkedin_url),
         notes = coalesce($6, notes),
         bidder_id = case when $7::boolean then $8::int else bidder_id end,
         bidder_status = coalesce($9, bidder_status),
         for_job = coalesce($10::boolean, for_job),
         for_ai_training = coalesce($11::boolean, for_ai_training),
         updated_at = now()
       where id = $1`,
      [
        id, b.full_name ?? null, b.email ?? null, b.phone ?? null, b.linkedin_url ?? null,
        b.notes ?? null,
        // bidder_id is nullable, so "sent as null" and "not sent" differ:
        // the flag says whether to write it at all.
        "bidder_id" in b,
        b.bidder_id ?? null,
        b.bidder_status ?? null,
        b.for_job ?? null,
        b.for_ai_training ?? null,
      ],
    );
    if (b.assignee_ids) await setAssignees(id, b.assignee_ids, actor.id);
    await audit(actor.id, "update", "profile", id, b);
    res.json(await oneProfile(id));
  }),
);

profiles.delete(
  "/profiles/:id",
  h(async (req, res) => {
    const actor = req.user!;
    const id = Number(req.params.id);
    await oneProfile(id);
    // Assignees and accounts go with it (on delete cascade).
    await pool.query("delete from profiles where id=$1", [id]);
    await audit(actor.id, "delete", "profile", id);
    res.json({ ok: true });
  }),
);

/* ---------- training sites (admin-managed) ---------- */

profiles.get(
  "/training-sites",
  h(async (req, res) => {
    const all = String(req.query.all ?? "") === "1";
    const { rows } = await pool.query(
      `select id, name, url, summary, icon_url, active, sort_order from training_sites
       ${all ? "" : "where active"} order by sort_order, name`,
    );
    res.json(rows);
  }),
);

const siteBody = z.object({
  name: z.string().trim().min(1, "needs a name").max(80),
  url: z.string().trim().url("must be a full URL").max(300).or(z.literal("")).default(""),
  summary: z.string().trim().max(500).default(""),
  icon_url: z.string().trim().max(500).default(""),
  sort_order: z.number().int().min(0).max(999).default(0),
  active: z.boolean().default(true),
});

/* ---------- training sites: CSV export and import ---------- */

const SITE_CSV_HEADERS = ["name", "url", "summary", "icon_url", "active", "sort_order"];

profiles.get(
  "/training-sites.csv",
  requireRole("admin"),
  h(async (_req, res) => {
    const { rows } = await pool.query(
      `select name, url, summary, icon_url, active, sort_order
       from training_sites order by sort_order, name`,
    );
    const lines = [csvLine(SITE_CSV_HEADERS)].concat(
      rows.map((r) => csvLine([r.name, r.url, r.summary, r.icon_url, r.active, r.sort_order])),
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="training-sites.csv"`);
    res.send(lines.join("\n"));
  }),
);

/* Import sites from CSV text. `name` is the key: a row whose name already
   exists updates that site, anything else is created. Nothing is deleted —
   sites carry training accounts, so removal stays a deliberate single act.
   Reports per-row outcomes so the UI can show what happened. */
profiles.post(
  "/training-sites/import",
  requireRole("admin"),
  h(async (req, res) => {
    const { csv } = z
      .object({ csv: z.string().min(1, "needs CSV text").max(300_000) })
      .parse(req.body);

    const rows = parseCsvObjects(csv);
    if (rows.length === 0) throw new HttpError(400, "That file has no rows.");
    if (!("name" in rows[0])) {
      throw new HttpError(400, `The first line must name the columns, starting with "name".`);
    }
    if (rows.length > 500) throw new HttpError(400, "That file has more than 500 rows.");

    const truthy = (v: string, fallback: boolean) => {
      const s = v.trim().toLowerCase();
      if (s === "") return fallback;
      return s === "true" || s === "1" || s === "yes" || s === "y" || s === "active";
    };

    let created = 0;
    let updated = 0;
    const skipped: string[] = [];

    // One transaction: a half-applied import would leave the matrix rows in a
    // state nobody asked for.
    const client = await pool.connect();
    try {
      await client.query("begin");
      for (const [i, r] of rows.entries()) {
        const line = i + 2; // +1 for the header, +1 for 1-based counting.
        const name = (r.name ?? "").trim();
        if (!name) {
          skipped.push(`line ${line}: no name`);
          continue;
        }
        if (name.length > 80) {
          skipped.push(`line ${line}: name is longer than 80 characters`);
          continue;
        }
        const url = (r.url ?? "").trim();
        if (url && !/^https?:\/\/\S+$/i.test(url)) {
          skipped.push(`line ${line}: "${url}" is not an http(s) URL`);
          continue;
        }
        const sortRaw = (r.sort_order ?? "").trim();
        const sort = sortRaw === "" ? null : Number(sortRaw);
        if (sort !== null && (!Number.isInteger(sort) || sort < 0 || sort > 999)) {
          skipped.push(`line ${line}: sort_order must be a whole number from 0 to 999`);
          continue;
        }

        const existing = await client.query("select id from training_sites where lower(name)=lower($1)", [
          name,
        ]);
        if (existing.rows[0]) {
          await client.query(
            `update training_sites set url=$2, summary=$3, icon_url=$4, active=$5,
               sort_order=coalesce($6, sort_order)
             where id=$1`,
            [
              existing.rows[0].id,
              url.slice(0, 300),
              (r.summary ?? "").slice(0, 500),
              (r.icon_url ?? "").slice(0, 500),
              truthy(r.active ?? "", true),
              sort,
            ],
          );
          updated++;
        } else {
          await client.query(
            `insert into training_sites (name, url, summary, icon_url, active, sort_order)
             values ($1,$2,$3,$4,$5,$6)`,
            [
              name,
              url.slice(0, 300),
              (r.summary ?? "").slice(0, 500),
              (r.icon_url ?? "").slice(0, 500),
              truthy(r.active ?? "", true),
              sort ?? 0,
            ],
          );
          created++;
        }
      }
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }

    await audit(req.user!.id, "import", "training_site", null, { created, updated, skipped: skipped.length });
    res.json({ created, updated, skipped });
  }),
);

/* Read a URL and report back what the site says about itself, so adding a
   site is one paste instead of four fields. Nothing is saved here — the
   browser shows the result and the user confirms with POST /training-sites. */
profiles.post(
  "/training-sites/fetch",
  h(async (req, res) => {
    const { url } = z
      .object({ url: z.string().trim().min(1, "needs a URL").max(300) })
      .parse(req.body);
    res.json(await fetchSiteMeta(url));
  }),
);

profiles.post(
  "/training-sites",
  h(async (req, res) => {
    const b = siteBody.parse(req.body);
    const { rows } = await pool.query(
      `insert into training_sites (name, url, summary, icon_url, sort_order, active)
       values ($1,$2,$3,$4,$5,$6)
       returning id, name, url, summary, icon_url, active, sort_order`,
      [b.name, b.url, b.summary, b.icon_url, b.sort_order, b.active],
    );
    await audit(req.user!.id, "create", "training_site", rows[0].id, { name: b.name });
    res.status(201).json(rows[0]);
  }),
);

profiles.patch(
  "/training-sites/:id",
  requireRole("admin"),
  h(async (req, res) => {
    const id = Number(req.params.id);
    const b = siteBody.partial().parse(req.body);
    const { rows } = await pool.query(
      `update training_sites set name=coalesce($2,name), url=coalesce($3,url),
         summary=coalesce($4,summary), icon_url=coalesce($5,icon_url),
         sort_order=coalesce($6,sort_order), active=coalesce($7,active)
       where id=$1 returning id, name, url, summary, icon_url, active, sort_order`,
      [id, b.name ?? null, b.url ?? null, b.summary ?? null, b.icon_url ?? null,
       b.sort_order ?? null, b.active ?? null],
    );
    if (!rows[0]) throw new HttpError(404, "Training site not found");
    await audit(req.user!.id, "update", "training_site", id, b);
    res.json(rows[0]);
  }),
);

profiles.delete(
  "/training-sites/:id",
  requireRole("admin"),
  h(async (req, res) => {
    const id = Number(req.params.id);
    const { rowCount } = await pool.query("delete from training_sites where id=$1", [id]);
    if (!rowCount) throw new HttpError(404, "Training site not found");
    await audit(req.user!.id, "delete", "training_site", id);
    res.json({ ok: true });
  }),
);

/* ---------- training accounts (the status matrix cells) ---------- */

/* Rows are sites, columns are profiles: the shape the table renders from. */
profiles.get(
  "/training-matrix",
  h(async (_req, res) => {
    const [sites, cols, cells] = await Promise.all([
      pool.query(
        "select id, name, url, summary, icon_url from training_sites where active order by sort_order, name",
      ),
      /* Only profiles actually used for AI training. One not marked for it
         would otherwise be a permanently empty column on the board.

         Assignees come along so the board can filter by who owns a profile;
         folded into JSON here rather than fetched per profile. */
      pool.query(
        `select p.id, p.full_name,
                coalesce(
                  (select json_agg(json_build_object(
                     'user_id', u.id,
                     'name', coalesce(nullif(u.name,''), u.email),
                     'email', u.email,
                     'avatar', u.avatar
                   ) order by coalesce(nullif(u.name,''), u.email))
                   from profile_assignees pa join users u on u.id = pa.user_id
                   where pa.profile_id = p.id),
                  '[]'::json) as assignees
         from profiles p where p.for_ai_training order by p.full_name`,
      ),
      pool.query(
        `select ta.id, ta.card_no, ta.profile_id, ta.site_id, ta.status, ta.account_email, ta.note, ta.updated_at
         from training_accounts ta`,
      ),
    ]);
    res.json({ sites: sites.rows, profiles: cols.rows, accounts: cells.rows });
  }),
);

const accountBody = z.object({
  profile_id: z.number().int(),
  site_id: z.number().int(),
  status: z.enum(TRAINING_STATUSES).default("created"),
  account_email: z.string().trim().email("must be a valid email").max(160).or(z.literal("")).default(""),
  note: z.string().trim().max(500).default(""),
});

/* Upsert: adding an account to a profile, or moving its status along. */
profiles.put(
  "/training-accounts",
  h(async (req, res) => {
    const actor = req.user!;
    const b = accountBody.parse(req.body);
    const { rows } = await pool.query(
      `insert into training_accounts (profile_id, site_id, status, account_email, note, updated_by)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (profile_id, site_id) do update set
         status = excluded.status,
         account_email = excluded.account_email,
         note = excluded.note,
         updated_by = excluded.updated_by,
         updated_at = now()
       returning id, card_no, profile_id, site_id, status, account_email, note, updated_at`,
      [b.profile_id, b.site_id, b.status, b.account_email, b.note, actor.id],
    );
    await audit(actor.id, "update", "training_account", rows[0].id, { status: b.status });
    res.json(rows[0]);
  }),
);

profiles.delete(
  "/training-accounts/:id",
  h(async (req, res) => {
    const id = Number(req.params.id);
    const { rowCount } = await pool.query("delete from training_accounts where id=$1", [id]);
    if (!rowCount) throw new HttpError(404, "Account not found");
    await audit(req.user!.id, "delete", "training_account", id);
    res.json({ ok: true });
  }),
);


/* ---------- board cards ---------- */

/* A card is one training_accounts row: the (profile, site) pairing the board
   shows. It is addressed by card_no, not by id — the number in TRN-184 and in
   the card's URL — so a link keeps meaning something after the row behind it
   is replaced. */
const cardSql = `
  select ta.id, ta.card_no, ta.status, ta.account_email, ta.note,
         ta.created_at, ta.updated_at,
         ta.profile_id, p.full_name as profile_name,
         ta.site_id, ts.name as site_name, ts.url as site_url,
         ts.summary as site_summary, ts.icon_url as site_icon_url,
         (select json_build_object(
            'user_id', u.id,
            'name', coalesce(nullif(u.name,''), u.email),
            'email', u.email,
            'avatar', u.avatar)
          from users u where u.id = ta.updated_by) as updated_by,
         coalesce(
           (select json_agg(json_build_object(
              'user_id', u.id,
              'name', coalesce(nullif(u.name,''), u.email),
              'email', u.email,
              'avatar', u.avatar
            ) order by coalesce(nullif(u.name,''), u.email))
            from profile_assignees pa join users u on u.id = pa.user_id
            where pa.profile_id = ta.profile_id),
           '[]'::json) as assignees
  from training_accounts ta
  join profiles p on p.id = ta.profile_id
  join training_sites ts on ts.id = ta.site_id`;

async function cardByNo(cardNo: number) {
  const { rows } = await pool.query(`${cardSql} where ta.card_no = $1`, [cardNo]);
  if (!rows[0]) throw new HttpError(404, "That card doesn't exist");
  return rows[0];
}

profiles.get(
  "/cards/:cardNo",
  h(async (req, res) => {
    const cardNo = Number(req.params.cardNo);
    /* A non-numeric path segment would otherwise reach Postgres as NaN and
       come back as a type error rather than a plain not-found. */
    if (!Number.isInteger(cardNo) || cardNo < 1) throw new HttpError(404, "That card doesn't exist");
    res.json(await cardByNo(cardNo));
  }),
);

/* Editing a card from its modal or detail page. Every field is optional: the
   status dropdown and the note save independently, as they do on the board. */
const cardPatch = z
  .object({
    status: z.enum(TRAINING_STATUSES),
    account_email: z.string().trim().email("must be a valid email").max(160).or(z.literal("")),
    note: z.string().trim().max(500),
  })
  .partial();

profiles.patch(
  "/cards/:cardNo",
  h(async (req, res) => {
    const actor = req.user!;
    const cardNo = Number(req.params.cardNo);
    if (!Number.isInteger(cardNo) || cardNo < 1) throw new HttpError(404, "That card doesn't exist");
    const b = cardPatch.parse(req.body);

    const before = await cardByNo(cardNo);

    const { rowCount } = await pool.query(
      `update training_accounts set
         status        = coalesce($2, status),
         account_email = coalesce($3, account_email),
         note          = coalesce($4, note),
         updated_by    = $5,
         updated_at    = now()
       where card_no = $1`,
      [cardNo, b.status ?? null, b.account_email ?? null, b.note ?? null, actor.id],
    );
    if (!rowCount) throw new HttpError(404, "That card doesn't exist");

    /* Record the status move specifically, with both ends of it: the activity
       feed reads "moved TRN-184 from Created to Approved", which it cannot do
       from the new value alone. */
    const detail: Record<string, unknown> = { card_no: cardNo };
    if (b.status && b.status !== before.status) {
      detail.from = before.status;
      detail.to = b.status;
    }
    /* Only a status move is worth a notification. Editing a note or an
       account email is not something anyone needs told about. */
    const moved = Boolean(b.status && b.status !== before.status);
    await audit(
      actor.id,
      moved ? "move" : "update",
      "card",
      cardNo,
      detail,
      moved ? await watchersOfCard(cardNo) : undefined,
    );

    res.json(await cardByNo(cardNo));
  }),
);

/* Who to tell about a card: the profile's assignees. A card has no assignee
   of its own, so this is the only answer available. */
async function watchersOfCard(cardNo: number): Promise<number[]> {
  const { rows } = await pool.query(
    `select pa.user_id
     from training_accounts ta
     join profile_assignees pa on pa.profile_id = ta.profile_id
     where ta.card_no = $1`,
    [cardNo],
  );
  return rows.map((r) => r.user_id as number);
}

/* ---------- card comments ---------- */

const commentSql = `
  select c.id::int as id, c.body, c.mentions, c.created_at, c.edited_at,
         json_build_object(
           'user_id', u.id,
           'name', coalesce(nullif(u.name,''), u.email),
           'email', u.email,
           'avatar', u.avatar) as author
  from card_comments c
  join users u on u.id = c.author_id`;

/** The card's row id, or a 404. Comments hang off the id, not the card_no. */
async function accountIdOf(cardNo: number) {
  if (!Number.isInteger(cardNo) || cardNo < 1) throw new HttpError(404, "That card doesn't exist");
  const { rows } = await pool.query("select id from training_accounts where card_no=$1", [cardNo]);
  if (!rows[0]) throw new HttpError(404, "That card doesn't exist");
  return rows[0].id as number;
}

profiles.get(
  "/cards/:cardNo/comments",
  h(async (req, res) => {
    const accountId = await accountIdOf(Number(req.params.cardNo));
    const { rows } = await pool.query(
      `${commentSql} where c.account_id = $1 order by c.created_at, c.id`,
      [accountId],
    );
    res.json(rows);
  }),
);

profiles.post(
  "/cards/:cardNo/comments",
  h(async (req, res) => {
    const actor = req.user!;
    const cardNo = Number(req.params.cardNo);
    const accountId = await accountIdOf(cardNo);
    const b = z
      .object({
        body: z.string().trim().min(1, "Write something first").max(4000),
        /* The ids the @ picker resolved. Validated against real users below,
           so a hand-made request cannot attach someone who was never named. */
        mentions: z.array(z.number().int()).max(20).default([]),
      })
      .parse(req.body);

    let mentions: number[] = [];
    if (b.mentions.length) {
      const { rows } = await pool.query(
        "select id from users where active and id = any($1::int[])",
        [b.mentions],
      );
      mentions = rows.map((r) => r.id as number);
    }

    const { rows } = await pool.query(
      `insert into card_comments (account_id, author_id, body, mentions)
       values ($1,$2,$3,$4) returning id`,
      [accountId, actor.id, b.body, mentions],
    );

    /* Assignees hear about every comment on their card; anyone named with
       @ hears about it whether or not the card is theirs. audit() drops the
       author and de-duplicates, so the overlap costs nothing. */
    const watchers = await watchersOfCard(cardNo);
    await audit(
      actor.id,
      "comment",
      "card",
      cardNo,
      { card_no: cardNo, comment_id: rows[0].id, mentions, excerpt: b.body.slice(0, 140) },
      [...watchers, ...mentions],
    );

    const { rows: back } = await pool.query(`${commentSql} where c.id = $1`, [rows[0].id]);
    res.status(201).json(back[0]);
  }),
);

/* Who the @ picker offers. Active users only: a comment naming someone who
   has left would notify nobody. */
profiles.get(
  "/mentionables",
  h(async (_req, res) => {
    const { rows } = await pool.query(
      `select id as user_id, coalesce(nullif(name,''), email) as name, email, avatar
       from users where active order by coalesce(nullif(name,''), email)`,
    );
    res.json(rows);
  }),
);

/* Editing and deleting a comment.

   Only the author may change their own words. An admin may delete any
   comment — moderation — but never edit one, because an edit under someone
   else's name misrepresents them. */
async function ownComment(actor: Express.Request["user"], id: number) {
  const { rows } = await pool.query(
    `select c.id, c.author_id, ta.card_no
     from card_comments c join training_accounts ta on ta.id = c.account_id
     where c.id = $1`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, "That comment doesn't exist");
  return rows[0] as { id: number; author_id: number; card_no: number };
}

profiles.patch(
  "/comments/:id",
  h(async (req, res) => {
    const actor = req.user!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(404, "That comment doesn't exist");
    const row = await ownComment(actor, id);
    if (row.author_id !== actor.id) throw new HttpError(403, "You can only edit your own comments");

    const b = z
      .object({
        body: z.string().trim().min(1, "Write something first").max(4000),
        mentions: z.array(z.number().int()).max(20).default([]),
      })
      .parse(req.body);

    let mentions: number[] = [];
    if (b.mentions.length) {
      const { rows } = await pool.query(
        "select id from users where active and id = any($1::int[])",
        [b.mentions],
      );
      mentions = rows.map((r) => r.id as number);
    }

    await pool.query(
      "update card_comments set body=$2, mentions=$3, edited_at=now() where id=$1",
      [id, b.body, mentions],
    );
    await audit(actor.id, "update", "comment", id, { card_no: row.card_no });

    const { rows: back } = await pool.query(`${commentSql} where c.id = $1`, [id]);
    res.json(back[0]);
  }),
);

profiles.delete(
  "/comments/:id",
  h(async (req, res) => {
    const actor = req.user!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(404, "That comment doesn't exist");
    const row = await ownComment(actor, id);
    if (row.author_id !== actor.id && actor.role !== "admin") {
      throw new HttpError(403, "You can only delete your own comments");
    }
    await pool.query("delete from card_comments where id=$1", [id]);
    await audit(actor.id, "delete", "comment", id, { card_no: row.card_no });
    res.json({ ok: true });
  }),
);
