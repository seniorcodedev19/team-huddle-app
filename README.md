# Team Huddle

A weekly performance and operations tool for a single small organization. Members log numbers each day,
submit the week, and a manager or admin approves it with an optional bonus. Everyone sees how the team
is tracking.

**Status: MVP.** It runs end to end and is in daily use, but expect rough edges. See
[Known limitations](#known-limitations) before deploying it anywhere real.

```
apps/web    Next.js 15 (App Router) · React 19 · Auth.js v5 · Recharts
apps/api    Express 4 · node-postgres · Zod · JWT · scoring · audit log
desktop     Electron shell around the web app: tray, notifications, submit reminders
```

---

## The core idea

Everything in Team Huddle is a projection of **one person's one week**. The dashboard, the team table,
the CSV export, the history chart and the AI agent all read the same weekly snapshot, so no two views
can disagree about a number.

```
                         ┌──────────────────────┐
     daily entries ─────▶│                      │
                         │   one person's week  │──▶ score + achievement %
     time logs ─────────▶│   (Sun → Sat, UTC)   │
                         │                      │
     metrics ───────────▶└──────────┬───────────┘
                                    │
            ┌───────────────┬───────┴───────┬───────────────┐
            ▼               ▼               ▼               ▼
        Dashboard      Team table       CSV export      History chart
```

### The week lifecycle

```
   ┌─────────┐  submit   ┌───────────┐  approve   ┌──────────┐
   │  draft  │──────────▶│ submitted │───────────▶│ approved │  (terminal)
   └─────────┘           └───────────┘            └──────────┘
        ▲                      │                   frozen snapshot
        │        return        ▼
        │                ┌──────────┐
        └────────────────│ returned │  editable again
           resubmit      └──────────┘
```

Entries lock while a week is `submitted` or `approved`. Returning it unlocks editing. **Approved weeks
are immutable** — the score is frozen at approval time, so changing a formula later never rewrites
history.

Nobody reviews their own report. An admin reviews managers' weeks.

### Scoring

Weeks run **Sunday to Saturday, in UTC**. Three formula types:

| Type | Formula | Counts toward achievement % |
|---|---|---|
| **ratio** | `min(done ÷ target, cap) × weight` | Yes |
| **count** | `done × weight` | No — it has no target |
| **overtime** | `(min(done, target) ÷ target × weight)` + `(max(0, done − target) × rate)` | Base row only |

Overtime splits into two rows so the base can never reward hours above target — the surplus is paid at
the bonus rate instead. Example at 95 hours against a 90-hour target:

```
base   90 ÷ 90 × weight
bonus   5 × overtime rate
```

A `target` of `0` on a ratio or overtime metric means "n/a": it contributes bonus only and is left out
of the achievement percentage. The week total is the sum of all metrics plus any bonus the reviewer
adds on approval.

Logic lives in `apps/api/src/scoring.ts`, which is pure and is the repo's tested code (`npm test`).

### Roles

| Role | Can |
|---|---|
| **member** | Enter and submit their own week |
| **manager** | Their team's reviews and interviews, plus team views |
| **admin** | Everything, plus people, teams and metrics |

Every signed-in user can **read** anyone's week — deliberate for this org, where status and results are
open. Editing is the restricted action.

Users can also be flagged as **bidders**, which is a flag rather than a role. Bidders are excluded from
all weekly-metrics views, since they aren't scored on the weekly cycle.

---

## What's in the app

| Area | What it does |
|---|---|
| **Dashboard** | This week at a glance: today's entry box, running total, day-by-day chart |
| **Team** | Every member's week side by side, orderable, with a bar chart |
| **Time tracking** | Logged minutes, which feed the built-in Time Tracking metric |
| **Interviews** | 1:1 meetings a manager schedules, with notes both people can read |
| **Agent** | A chat agent that can read your week and write daily values for you |
| **Profiles** | Per-person profiles with assignees, bidder status and training accounts |
| **AI Training** | Training sites and a matrix of who has an account where |
| **Admin** | History (audit log), Users, Metrics, Agent connect, Training sites |

### Time Tracking is special

The metric keyed `time_tracking` is built in and global. Its daily values come **only** from logged
time, never from typed daily entries, and it always sorts first. The API refuses to change its formula
type or deactivate it.

### The AI agent

A per-user chat agent over OpenAI chat-completions (default model `gpt-4o-mini`), with tools to read a
week, list metrics, write daily values, and search, read and post Slack messages.

Write tools are **two-phase**: the agent previews the change, you agree, and only then does it write.
Keys and tokens are AES-256-GCM encrypted at rest and are never returned to the browser in full.

Slack arrives over Socket Mode in local dev, so you get DMs and @mentions without a public URL.

---

## Run locally

Requirements: **Node 20+** and **PostgreSQL 16** (local Docker, or a hosted Postgres such as Supabase).

```bash
npm install

cp apps/api/.env.example apps/api/.env          # DATABASE_URL, ADMIN_EMAILS
cp apps/web/.env.example apps/web/.env.local    # AUTH_SECRET, API_JWT_SECRET

npm run db:up          # local Postgres in Docker — skip if you're using a hosted one
npm run db:migrate
npm run db:seed        # one team, five starter metrics, one admin

npm run dev            # web on :3000, API on :4000
```

Then open **http://localhost:3000**.

> `API_JWT_SECRET` must be **identical** in both env files, or the web app can't talk to the API.
> Generate secrets with `openssl rand -base64 32`.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Web and API together, in watch mode |
| `npm test` | Scoring and CSV tests |
| `npm run typecheck` | Both workspaces |
| `npm run lint` | Both workspaces |
| `npm run build` | API lint, then the web production build |
| `npm run db:up` | Start local Postgres via Docker Compose |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Seed a team, metrics and the first admin (email from `ADMIN_EMAILS`) |
| `npm run db:rekey` | Report stored values not under the current encryption secret; `-- --write` re-encrypts them |

`npm run build` is the closest thing to a CI gate — run it, plus `npm test`, before calling a change
done.

### Signing in

Two ways in, both configured in `apps/web/.env.local`:

- **Email and password** — `/signup` creates an account; passwords are scrypt-hashed with a per-user salt.
- **Google** — Google Cloud Console → Credentials → OAuth client (Web), redirect URI
  `http://localhost:3000/api/auth/callback/google`.

Set `ALLOWED_EMAIL_DOMAIN` to restrict Google sign-in to one domain, or leave it empty to allow any
Google account.

**A new account cannot sign in until an admin approves it** on Admin → Users, whichever way it was
created. Admins get a notification when someone signs up. Any address listed in `ADMIN_EMAILS` is
promoted to admin on sign-in.

`npm run db:seed` creates the first admin from `ADMIN_EMAILS`. It prints a random password once, or
uses `SEED_ADMIN_PASSWORD` if you set one, and it never changes the password of an admin that already
exists unless `SEED_ADMIN_PASSWORD` is set. That makes it the way back in for an admin who has lost
their password; there is no email service, so there is no reset link.

Passwords need 8 or more characters, can't be one of the common ones, and can't contain your own name
or email. Change yours on **My profile → Password**. Wrong passwords are limited to 5 per email and
address in 15 minutes, and new accounts to 10 per address per hour.

### Hosted Postgres (Supabase)

In the project: **Settings → Database**.

| Env var | Which URI | Port | Used by |
|---|---|---|---|
| `DATABASE_URL` | Transaction pooler | `6543` | The API at runtime |
| `DIRECT_URL` | Session pooler or direct | `5432` | `db:migrate` and `db:seed` |

Migrations and seeding need a direct session because they run DDL. The API turns SSL on automatically
for any non-localhost host.

---

## How the two services fit together

Requests take two hops, and the trust boundary is **between Next.js and Express**, not at the browser:

```
  Browser
     │  Auth.js session cookie (JWT strategy)
     ▼
  Next.js ──────────── server-side only ───────────┐
     │                                             │
     │  mints a 2-minute HS256 token               │  signed with
     │  carrying only { email, name }              │  API_JWT_SECRET
     ▼                                             │
  Express ◀──────────────────────────────────────── ┘
     │  verifies the token, upserts the user by email,
     │  reads their role from the database every request
     ▼
  PostgreSQL
```

The token deliberately carries **no role and no user id** — the role is always read fresh from the
database, so a change takes effect on the next request rather than when a token expires.

Express is **not meant to be publicly reachable**. Browser calls route through a Next.js proxy that
attaches the token server-side, so the signing secret never reaches the client.

> **`API_JWT_SECRET` is the entire perimeter.** Anything holding it can mint a token for any email
> address and will have an account created for it. Keep it server-side, keep it the same in both env
> files, and never ship it to the browser.

### Frontend conventions

Server components fetch; client components mutate and then refresh the server data. There's no
client-side data cache — `router.refresh()` is the state management, deliberately.

Styling is plain CSS with custom-property tokens and a `[data-theme]` dark mode applied pre-paint to
avoid a flash. No Tailwind, no CSS-in-JS.

### Database

Migrations are **forward-only and immutable once applied** — the filename is recorded, so editing an
applied file does nothing. Always add a new numbered file. Each runs in one transaction and is written
idempotently.

`audit_log` is append-only and is the only record of who changed what. Don't delete from it.

---

## Deploy

Two Vercel projects from the same repo:

| Project | Root directory |
|---|---|
| web | `apps/web` |
| api | `apps/api` — zero-config Express, entry `src/index.ts` |

Run `npm run db:migrate` against the production database before the first deploy, and again whenever
a release adds migrations.

Deploy the two projects together. The API accepts sign-ups and sign-ins only from the web app, which
proves itself with a token signed by `API_JWT_SECRET`; an API that is ahead of its web app refuses
password sign-ins until the web app catches up.

**Web env:** `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `API_URL` (the api project's URL),
`API_JWT_SECRET`, optional `ALLOWED_EMAIL_DOMAIN`.

**API env:** `DATABASE_URL`, `DIRECT_URL`, `API_JWT_SECRET`, `ADMIN_EMAILS`, `AGENT_TOKEN_SECRET`,
optional `OPENAI_API_KEY`.

Add `https://<your-web-domain>/api/auth/callback/google` to the Google OAuth redirect URIs.

> **`AGENT_TOKEN_SECRET` encrypts what is stored encrypted:** Slack, OpenAI and ManicTime secrets,
> contacts, and profile notes. Without it the API encrypts under `API_JWT_SECRET` instead. Every
> deployment that shares a database needs the same value, or one cannot read what another wrote.
>
> To change it, move the old value into `AGENT_TOKEN_SECRET_OLD` (still used to read, never to write),
> set the new one, and run `npm run db:rekey -- --write`. Drop the old value once `npm run db:rekey`
> reports nothing left under it. Values written under `API_JWT_SECRET` stay readable the same way.

---

## Desktop app

`desktop/` is Team Huddle in its own window for Windows (MVP). It shows the web app from your server,
so it has every feature of the web app and nothing to keep in step, and adds what a browser tab
cannot do: a tray icon, system notifications with nothing open, an unread badge on the taskbar, and
reminders to submit the week.

```bash
cd desktop
npm install
npm start          # asks for the server address on first run
npm run dist       # Windows installer in desktop/release/
```

It is not an npm workspace on purpose, so Electron is never installed by the web or API builds. It
holds no secret: it signs in like a browser and calls the same `/api/proxy` routes the pages do.
Details, the security model and known gaps are in [desktop/README.md](desktop/README.md).

---

## Known limitations

Honest about where the MVP stands. These are documented, not fixed.

**Before any real deployment**
- A database seeded before the seed script stopped hardcoding credentials still has an admin whose
  password is `"admin"`. **Change it on My profile → Password before anything else.**
- There is no email service: no email verification and no "forgot password" link. An admin's approval
  stands in for the first; an admin cannot yet reset someone else's password.
- Sign-in has no second factor, sessions last 30 days, and changing a password does not end sessions
  that are already open.
- Profiles (names, emails, phones), comments and agent chats are stored as plain text. Contacts,
  profile notes and stored secrets are encrypted.

**Scale**
- The team, review-queue and history endpoints read one week at a time in a loop — four queries per
  person, per week. Fine for a small team; the first thing to fix as it grows.
- Avatars are stored as base64 data URLs in a text column and come back with the user row.

**Known behaviours that look like bugs**
- A manager's team view returns everyone, not just their team.
- The day-by-day chart reflects Time Tracking only, not all metrics.
- The weekly grid writes a metric's whole weekly total onto the week's first day, so weekly and daily
  entry aren't interchangeable in the day chart.

**Elsewhere**
- `apps/api/src/routes/admin.ts` and `data.ts` are **orphaned fossils** from an earlier
  quarterly-periods design. They aren't mounted, aren't typechecked, and wouldn't compile. If you grep
  for a route and land there, you've found dead code.
- There are no frontend tests. `apps/web/src/lib/types.ts` mirrors the API's JSON shapes **by hand** —
  change an API response and you must update it yourself, because nothing enforces it.
