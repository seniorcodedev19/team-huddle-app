import { isSealed, sealText } from "./crypto";
import { makePool } from "./db";

/* One-off: encrypt profile notes written before encryption was switched on.

   New and edited notes are encrypted by the API; this catches the rows that
   were already there. Safe to run more than once: a note that is already
   encrypted is skipped. Each note is updated only if it is still the plain
   text read here, so an edit made while this runs is not overwritten.

   Run it with the same secret the API uses — a note encrypted with a
   different one cannot be read by the API afterwards. */
const pool = makePool(process.env.DIRECT_URL || process.env.DATABASE_URL);

async function main() {
  const { rows } = await pool.query<{ id: number; notes: string }>(
    "select id, notes from profiles where notes <> ''",
  );
  const plain = rows.filter((r) => !isSealed(r.notes));
  let done = 0;
  for (const r of plain) {
    const { rowCount } = await pool.query("update profiles set notes=$2 where id=$1 and notes=$3", [
      r.id,
      sealText(r.notes),
      r.notes,
    ]);
    done += rowCount ?? 0;
  }
  console.log(
    `profiles with notes: ${rows.length}; already encrypted: ${rows.length - plain.length}; encrypted now: ${done}`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
