import { decryptSecret, encryptSecret, isSealed, underCurrentSecret } from "./crypto";
import { makePool } from "./db";

/* Moves every stored encrypted value onto the current encryption secret.

   Values can end up under different secrets: AGENT_TOKEN_SECRET was added
   after some were written, two environments shared a database, or a secret
   was changed and the old one kept in AGENT_TOKEN_SECRET_OLD. The API reads
   all of them; this script is what lets an old secret finally be dropped.

   It only reports unless run with --write:

     npm run db:rekey              what would change, nothing written
     npm run db:rekey -- --write   re-encrypt

   Before --write, make sure EVERY deployment that uses this database has
   the same AGENT_TOKEN_SECRET and is running code that reads more than one
   secret. A deployment that lacks the current secret cannot read anything
   this script has re-encrypted.

   Safe to run more than once. A value is replaced only if it is still the
   text read here, so a save made while this runs is not overwritten. */
const pool = makePool(process.env.DIRECT_URL || process.env.DATABASE_URL);
const write = process.argv.includes("--write");

const COLUMNS: [table: string, column: string][] = [
  ["slack_app_config", "client_secret_enc"],
  ["slack_app_config", "signing_secret_enc"],
  ["slack_app_config", "app_token_enc"],
  ["slack_app_config", "openai_key_enc"],
  ["slack_app_install", "bot_token_enc"],
  ["slack_connections", "user_token_enc"],
  ["agent_user_settings", "openai_key_enc"],
  ["manictime_config", "secret_enc"],
  ["profiles", "notes"],
  ...["name", "job_title", "location", "email", "phone", "linkedin_url", "github_url", "portfolio_url", "note"].map(
    (column): [string, string] => ["contacts", column],
  ),
];

async function main() {
  let pending = 0;
  let lost = 0;
  for (const [table, column] of COLUMNS) {
    let values: string[];
    try {
      const { rows } = await pool.query<{ v: string | null }>(`select ${column} as v from ${table}`);
      values = rows.map((r) => r.v ?? "").filter(isSealed);
    } catch (err) {
      // A table from a migration this database has not had yet.
      if ((err as { code?: string }).code !== "42P01") throw err;
      continue;
    }
    let current = 0;
    let moved = 0;
    let unreadable = 0;
    for (const stored of values) {
      if (underCurrentSecret(stored)) {
        current++;
        continue;
      }
      let plain: string;
      try {
        plain = decryptSecret(stored);
      } catch {
        unreadable++;
        continue;
      }
      if (!write) {
        moved++;
        continue;
      }
      const { rowCount } = await pool.query(`update ${table} set ${column} = $1 where ${column} = $2`, [
        encryptSecret(plain),
        stored,
      ]);
      moved += rowCount ?? 0;
    }
    pending += write ? 0 : moved;
    lost += unreadable;
    if (values.length) {
      console.log(
        `${table}.${column}: ${values.length} encrypted; ${current} already under the current secret; ` +
          `${moved} ${write ? "re-encrypted" : "to re-encrypt"}; ${unreadable} unreadable with any configured secret`,
      );
    }
  }
  if (!write && pending) console.log(`\nNothing was written. Run with --write to re-encrypt ${pending} values.`);
  if (!write && !pending) console.log("\nEverything readable is already under the current secret.");
  if (lost) {
    console.log(
      `\n${lost} values cannot be read. The secret they were written with is not configured here; ` +
        "add it to AGENT_TOKEN_SECRET_OLD and run this again.",
    );
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
