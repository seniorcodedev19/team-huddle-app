import { randomBytes } from "node:crypto";
import { makePool } from "./db";
import { hashPassword, passwordProblem } from "./password";

const pool = makePool(process.env.DIRECT_URL || process.env.DATABASE_URL);

/* Who the first admin is, and with what password, comes from the
   environment, never from this file:

   - The email is SEED_ADMIN_EMAIL, or else the first address in ADMIN_EMAILS.
   - The password is SEED_ADMIN_PASSWORD. Without one, a new admin gets a
     random password, printed once below, and an admin that already exists
     keeps whatever it has.

   So seeding again never resets a working password, and seeding with
   SEED_ADMIN_PASSWORD set is the way back in for an admin who has lost
   theirs. */
async function main() {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || (process.env.ADMIN_EMAILS ?? "").split(",")[0] || "")
    .trim()
    .toLowerCase();
  if (!adminEmail.includes("@")) {
    throw new Error("Set ADMIN_EMAILS (or SEED_ADMIN_EMAIL) in apps/api/.env to the admin's email before seeding.");
  }
  const given = process.env.SEED_ADMIN_PASSWORD ?? "";
  if (given) {
    const problem = passwordProblem(given, { email: adminEmail });
    if (problem) throw new Error(`SEED_ADMIN_PASSWORD: ${problem}`);
  }

  await pool.query("insert into teams (name) values ('Engineering') on conflict do nothing");
  const team = await pool.query<{ id: number }>("select id from teams where name = 'Engineering'");
  const teamId = team.rows[0]?.id ?? null;

  const existing = await pool.query("select 1 from users where email = $1", [adminEmail]);
  const generated = !given && !existing.rowCount ? randomBytes(12).toString("base64url") : "";
  const password = given || generated;
  await pool.query(
    `insert into users (email, name, role, password_hash, team_id, active)
     values ($1, $2, 'admin', $3, $4, true)
     on conflict (email) do update set
       role = 'admin',
       active = true,
       password_hash = coalesce(excluded.password_hash, users.password_hash),
       name = coalesce(nullif(users.name, ''), excluded.name),
       team_id = coalesce(users.team_id, excluded.team_id)`,
    [adminEmail, "Admin", password ? await hashPassword(password) : null, teamId],
  );
  await pool.query("update users set team_id = $1 where team_id is null", [teamId]);
  // Global metrics (team_id null) apply to every team. Managers add their own per team in the app.
  await pool.query(
    `insert into metrics (key, name, formula_type, weight, cap, target, overtime_rate, unit) values
       ('time_tracking', 'Time Tracking', 'overtime', 40, 1.2, 90, 1, 'hours'),
       ('tasks_completed', 'Tasks completed', 'ratio', 50, 1.2, 10, 0, 'tasks'),
       ('code_reviews', 'Code reviews', 'ratio', 30, 1.2, 5, 0, 'reviews'),
       ('bugs_fixed', 'Bugs fixed', 'count', 1, 1.2, 0, 0, 'bugs'),
       ('docs_shared', 'Docs or talks shared', 'count', 2, 1.2, 0, 0, 'items')
     on conflict (key) do nothing`,
  );
  console.log(`seeded a team, the starter metrics, and the admin user ${adminEmail}`);
  if (generated) console.log(`\nAdmin password, shown this once. Change it after signing in: ${generated}\n`);
  else if (given) console.log("The admin's password was set from SEED_ADMIN_PASSWORD.");
  else console.log("That admin already existed, so its password was left as it is.");
  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
