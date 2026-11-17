/* npm run mt:sync [-- --from 2026-11-01 [--to 2026-11-21]]

   One ManicTime sync, then exit. For a Windows scheduled task on the machine
   that runs ManicTime Server, when the API itself runs somewhere that can't
   reach it. Without dates it syncs last week and this week. */
import { pool } from "./db";
import { runSync } from "./manictime";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

runSync({ from: arg("from"), to: arg("to") })
  .then((s) => {
    console.log(
      `ManicTime sync ${s.from} → ${s.to}: ${s.days} day(s), ${s.tags} tag row(s), ${s.linked}/${s.people} people linked` +
        (s.locked ? `, ${s.locked} day(s) left alone in locked weeks` : ""),
    );
    for (const w of s.warnings) console.warn(`Note: ${w}`);
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
