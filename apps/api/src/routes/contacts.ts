import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth";
import { openText, sealText } from "../crypto";
import { csvLine, parseCsvObjects } from "../csv";
import { pool } from "../db";
import { audit, h, HttpError } from "../util";

export const contacts = Router();

/* Contacts (migration 030).

   Everyone can read, add and edit; only an admin can delete. Every field
   below is stored encrypted and decrypted here, on the way out, so nothing
   past this file sees the stored form. */

export const CONTACT_STATUSES = ["none", "contacted", "pending", "approved", "rejected"] as const;

/** The encrypted fields, in the order they appear on the form. */
const SEALED = [
  "name",
  "job_title",
  "location",
  "email",
  "phone",
  "linkedin_url",
  "github_url",
  "portfolio_url",
  "note",
] as const;

const webUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "must start with http:// or https://");

const contactBody = z.object({
  name: z.string().trim().min(1, "needs a name").max(120),
  job_title: z.string().trim().max(120).default(""),
  location: z.string().trim().max(120).default(""),
  email: z.string().trim().email("must be a valid email").max(160).or(z.literal("")).default(""),
  phone: z.string().trim().max(40).default(""),
  linkedin_url: webUrl.default(""),
  github_url: webUrl.default(""),
  portfolio_url: webUrl.default(""),
  note: z.string().trim().max(4000).default(""),
  status: z.enum(CONTACT_STATUSES).default("none"),
  // null is "Unassigned".
  assignee_id: z.number().int().nullable().default(null),
});

const contactSql = `
  select c.*,
         (select json_build_object(
            'user_id', u.id,
            'name', coalesce(nullif(u.name,''), u.email),
            'email', u.email,
            'avatar', u.avatar)
          from users u where u.id = c.assignee_id) as assignee
  from contacts c`;

/* Decrypts a stored row. `locked` is set when a field holds a value that
   cannot be read with the current secret: that field comes back empty, and
   because edits only send the fields that changed, saving the contact leaves
   the unreadable value where it is instead of overwriting it. */
function readable(row: Record<string, unknown>): Record<string, unknown> & { name: string; locked: boolean } {
  const out: Record<string, unknown> = { ...row };
  let locked = false;
  for (const f of SEALED) {
    const v = openText(String(row[f] ?? ""));
    if (v === null) locked = true;
    out[f] = v ?? "";
  }
  delete out.created_by;
  delete out.updated_by;
  return { ...out, name: String(out.name), locked };
}

async function oneContact(id: number) {
  const { rows } = await pool.query(`${contactSql} where c.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, "That contact doesn't exist");
  return readable(rows[0]);
}

/* Only active people can be assigned: the list offered is the same. */
async function checkAssignee(id: number | null | undefined) {
  if (id === null || id === undefined) return;
  const { rows } = await pool.query("select 1 from users where id=$1 and active", [id]);
  if (!rows[0]) throw new HttpError(400, "That person isn't an active user, so they can't be assigned");
}

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(CONTACT_STATUSES).optional(),
  // A user id, or -1 for contacts nobody is assigned to.
  assignee: z.coerce.number().int().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});

/* One page of contacts, filtered and sorted by name.

   Status and assignee are plain columns, so they narrow the rows in SQL.
   Everything else is ciphertext there, so the search and the sort happen
   here, after decrypting — which is also why the page is cut here and not
   with LIMIT/OFFSET: the database cannot order rows by a name it cannot
   read. Decrypting a few thousand rows takes milliseconds; only one page is
   sent to the browser. */
contacts.get(
  "/contacts",
  h(async (req, res) => {
    const q = listQuery.parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) {
      params.push(q.status);
      where.push(`c.status = $${params.length}`);
    }
    if (q.assignee === -1) where.push("c.assignee_id is null");
    else if (q.assignee && q.assignee > 0) {
      params.push(q.assignee);
      where.push(`c.assignee_id = $${params.length}`);
    }
    const { rows } = await pool.query(
      `${contactSql}${where.length ? ` where ${where.join(" and ")}` : ""}`,
      params,
    );

    const needle = q.q?.toLowerCase();
    const matched = rows
      .map(readable)
      .filter(
        (c) =>
          !needle ||
          [c.name, c.job_title, c.location, c.email, c.phone].some((v) =>
            String(v ?? "").toLowerCase().includes(needle),
          ),
      )
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    // A page past the end (say, after the last contact on it was deleted) shows the last page.
    const pages = Math.max(1, Math.ceil(matched.length / q.per_page));
    const page = Math.min(q.page, pages);
    const { rows: all } = await pool.query("select count(*)::int n from contacts");
    res.json({
      rows: matched.slice((page - 1) * q.per_page, page * q.per_page),
      total: matched.length,
      all: all[0].n,
      page,
      per_page: q.per_page,
    });
  }),
);

contacts.post(
  "/contacts",
  h(async (req, res) => {
    const actor = req.user!;
    const b = contactBody.parse(req.body);
    await checkAssignee(b.assignee_id);
    const { rows } = await pool.query(
      `insert into contacts (name, job_title, location, email, phone, linkedin_url, github_url,
                             portfolio_url, note, status, assignee_id, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) returning id`,
      [...SEALED.map((f) => sealText(b[f])), b.status, b.assignee_id, actor.id],
    );
    const id = rows[0].id as number;
    /* The History log is not encrypted, so it records that a contact was
       added, never who they are. */
    await audit(actor.id, "create", "contact", id, { status: b.status });
    res.status(201).json(await oneContact(id));
  }),
);

contacts.patch(
  "/contacts/:id",
  h(async (req, res) => {
    const actor = req.user!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(404, "That contact doesn't exist");
    const b = contactBody.partial().parse(req.body);
    await oneContact(id);
    if ("assignee_id" in b) await checkAssignee(b.assignee_id);

    /* Only the fields sent are written. The form sends just what changed,
       so a field nobody touched is never re-encrypted or overwritten. */
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const f of SEALED) {
      if (b[f] === undefined) continue;
      params.push(sealText(b[f] as string));
      sets.push(`${f} = $${params.length}`);
    }
    if (b.status !== undefined) {
      params.push(b.status);
      sets.push(`status = $${params.length}`);
    }
    if ("assignee_id" in b) {
      params.push(b.assignee_id ?? null);
      sets.push(`assignee_id = $${params.length}`);
    }
    if (sets.length) {
      params.push(actor.id);
      sets.push(`updated_by = $${params.length}`, "updated_at = now()");
      await pool.query(`update contacts set ${sets.join(", ")} where id = $1`, params);
      // Which fields changed, not what they now say.
      await audit(actor.id, "update", "contact", id, {
        fields: Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined),
        status: b.status,
      });
    }
    res.json(await oneContact(id));
  }),
);

/* ---------- CSV export / import ---------- */

const CSV_COLUMNS = [
  "name",
  "job_title",
  "location",
  "email",
  "phone",
  "linkedin_url",
  "github_url",
  "portfolio_url",
  "status",
  "assignee_email",
  "note",
] as const;

/* A spreadsheet runs a cell that starts with = + - or @ as a formula. These
   values come from outside the team, so the export prefixes such a cell
   with an apostrophe (the spreadsheet convention for "this is text"), and
   the import strips it again, so a round trip changes nothing. */
const FORMULA_START = /^[=+\-@\t\r]/;
const defuse = (v: unknown) => {
  const s = String(v ?? "");
  return FORMULA_START.test(s) ? `'${s}` : s;
};
const undefuse = (s: string) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);

/* Export: every detail decrypted into a plain CSV file. Admin only — the
   file leaves the encrypted store behind, so it is a deliberate act. It
   takes the same filters as the list, so it exports what the table shows. */
contacts.get(
  "/contacts.csv",
  requireRole("admin"),
  h(async (req, res) => {
    const q = listQuery.omit({ page: true, per_page: true }).parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) {
      params.push(q.status);
      where.push(`c.status = $${params.length}`);
    }
    if (q.assignee === -1) where.push("c.assignee_id is null");
    else if (q.assignee && q.assignee > 0) {
      params.push(q.assignee);
      where.push(`c.assignee_id = $${params.length}`);
    }
    const { rows } = await pool.query(
      `${contactSql}${where.length ? ` where ${where.join(" and ")}` : ""}`,
      params,
    );
    const needle = q.q?.toLowerCase();
    const list = rows
      .map(readable)
      .filter(
        (c) =>
          !needle ||
          [c.name, c.job_title, c.location, c.email, c.phone].some((v) =>
            String(v ?? "").toLowerCase().includes(needle),
          ),
      )
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    const lines = [csvLine([...CSV_COLUMNS])].concat(
      list.map((c) =>
        csvLine(
          CSV_COLUMNS.map((col) =>
            defuse(col === "assignee_email" ? ((c.assignee as { email?: string } | null)?.email ?? "") : c[col]),
          ),
        ),
      ),
    );
    await audit(req.user!.id, "export", "contact", null, { rows: list.length });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="contacts.csv"`);
    // A byte-order mark, so Excel reads accented names as UTF-8.
    res.send(`﻿${lines.join("\n")}`);
  }),
);

/* Import: anyone who can add and edit contacts can do it in bulk.

   A row is matched to an existing contact by email (ignoring case), or, when
   it has no email, by an exact name that only one contact has. A match is
   updated, anything else is added; nothing is deleted. Only the columns the
   file has are written, so a file with just name and status changes only
   those. Each row is checked on its own: a bad row is reported and skipped,
   the rest still go in. */
contacts.post(
  "/contacts/import",
  h(async (req, res) => {
    const actor = req.user!;
    const { csv } = z.object({ csv: z.string().min(1, "needs CSV text").max(380_000) }).parse(req.body);
    const rows = parseCsvObjects(csv.replace(/^﻿/, ""));
    if (rows.length === 0) throw new HttpError(400, "That file has no rows.");
    if (!("name" in rows[0])) {
      throw new HttpError(400, `The first line must name the columns, and one of them must be "name".`);
    }
    if (rows.length > 1000) throw new HttpError(400, "That file has more than 1,000 rows. Split it and import each part.");
    const present = new Set(Object.keys(rows[0]));

    // Existing contacts, decrypted once, for matching.
    const existing = (await pool.query("select id, name, email from contacts")).rows.map((r) => ({
      id: r.id as number,
      name: (openText(r.name) ?? "").trim().toLowerCase(),
      email: (openText(r.email) ?? "").trim().toLowerCase(),
    }));
    const byEmail = new Map(existing.filter((e) => e.email).map((e) => [e.email, e.id]));
    const byName = new Map<string, number[]>();
    for (const e of existing.filter((x) => !x.email && x.name)) {
      byName.set(e.name, [...(byName.get(e.name) ?? []), e.id]);
    }
    const users = new Map(
      (await pool.query("select id, lower(email) as email from users where active")).rows.map((u) => [
        u.email as string,
        u.id as number,
      ]),
    );

    let created = 0;
    let updated = 0;
    const skipped: string[] = [];

    for (const [i, raw] of rows.entries()) {
      const line = i + 2; // the header is line 1
      const row: Record<string, unknown> = {};
      for (const col of CSV_COLUMNS) {
        if (!present.has(col) || col === "assignee_email") continue;
        const v = undefuse(raw[col] ?? "");
        row[col] = col === "status" ? (v.toLowerCase() || "none") : v;
      }
      if (present.has("assignee_email")) {
        const e = undefuse(raw.assignee_email ?? "").trim().toLowerCase();
        if (!e) row.assignee_id = null;
        else if (users.has(e)) row.assignee_id = users.get(e);
        else {
          skipped.push(`Line ${line}: no active user has the email ${e}`);
          continue;
        }
      }

      const email = String(row.email ?? "").trim().toLowerCase();
      const name = String(row.name ?? "").trim().toLowerCase();
      let id: number | undefined = email ? byEmail.get(email) : undefined;
      if (id === undefined && !email && name) {
        const same = byName.get(name) ?? [];
        if (same.length > 1) {
          skipped.push(`Line ${line}: more than one contact is called "${row.name}"; add an email to tell them apart`);
          continue;
        }
        id = same[0];
      }

      const parsed = (id === undefined ? contactBody : contactBody.partial()).safeParse(row);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        skipped.push(`Line ${line}: ${issue.path.join(".") || "row"} ${issue.message}`);
        continue;
      }
      const b = parsed.data as Partial<z.infer<typeof contactBody>>;

      if (id === undefined) {
        const full = contactBody.parse(b);
        const { rows: ins } = await pool.query(
          `insert into contacts (name, job_title, location, email, phone, linkedin_url, github_url,
                                 portfolio_url, note, status, assignee_id, created_by, updated_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) returning id`,
          [...SEALED.map((f) => sealText(full[f])), full.status, full.assignee_id, actor.id],
        );
        // A second row with the same email in this file updates this one.
        if (email) byEmail.set(email, ins[0].id as number);
        created += 1;
      } else {
        const sets: string[] = [];
        const params: unknown[] = [id];
        for (const f of SEALED) {
          if (b[f] === undefined) continue;
          params.push(sealText(b[f] as string));
          sets.push(`${f} = $${params.length}`);
        }
        if (b.status !== undefined) {
          params.push(b.status);
          sets.push(`status = $${params.length}`);
        }
        if ("assignee_id" in b) {
          params.push(b.assignee_id ?? null);
          sets.push(`assignee_id = $${params.length}`);
        }
        params.push(actor.id);
        sets.push(`updated_by = $${params.length}`, "updated_at = now()");
        await pool.query(`update contacts set ${sets.join(", ")} where id = $1`, params);
        updated += 1;
      }
    }

    await audit(actor.id, "import", "contact", null, { created, updated, skipped: skipped.length });
    res.json({ created, updated, skipped });
  }),
);

contacts.delete(
  "/contacts/:id",
  requireRole("admin"),
  h(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(404, "That contact doesn't exist");
    const { rowCount } = await pool.query("delete from contacts where id=$1", [id]);
    if (!rowCount) throw new HttpError(404, "That contact doesn't exist");
    await audit(req.user!.id, "delete", "contact", id);
    res.json({ ok: true });
  }),
);
