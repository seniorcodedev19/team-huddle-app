# Changelog

<<<<<<< HEAD
Milestones the owner tags by hand. Not a public API contract.

| Version | Date | Highlights |
|---|---|---|
| [1.1](#11-2026-11-08) | 2026-11-08 | Agent & Slack · Profiles · AI Training · Calendar |
| [0.1.0](#010-2026-10-25) | 2026-10-25 | Weekly evaluation core |

---

## [1.1] — 2026-11-08

> A weekly scoring tool becomes a team workspace.
> **3 new feature areas · 16 migrations (009–024) · 13 new pages**

### Added

**🤖 Agent & Slack**

| | |
|---|---|
| Chat agent | `/agent`, OpenAI chat completions, max 8 tool rounds |
| Tools | Read a week, list metrics, write daily values, Slack search/fetch/post |
| Write safety | Two-phase — preview with `confirm=false`, act only after the user agrees |
| Slack | Events API, OAuth callback, Socket Mode for local dev without a public URL |
| Secrets | AES-256-GCM at rest · org-wide, admin-managed · never returned to the browser |

**👤 Profiles**

| | |
|---|---|
| CRUD | `/profiles`, many-to-many assignees |
| Two purposes | `for_job` and `for_ai_training` switches. Not marked for training → off that board |
| Derived badge | "Used for" is computed from the pair, so it cannot disagree with the switches |
| Bidders | A `users.is_bidder` flag, not a role. One bidder per profile, with a status |
| Job-side only | Bidder controls disable and clear for an AI-training-only profile |
| Filters | Assignee, purpose, bidder — with counts beneath the bar |

**🎓 AI Training**

| | |
|---|---|
| Board & matrix | One row per `(profile_id, site_id)`, upserted on that pair |
| Sites | CRUD, plus fetching a site's own name, summary and icon from its page |
| Filters | Assignee, profile, training site |

**📅 Calendar**

| | |
|---|---|
| Route | Interviews → `/calendar`. Week and month views sized to the viewport. `/interviews` redirects |
| Reshaped | Profile-and-client meetings, not internal 1:1s — the client is plain text, having no account |
| Event kinds | Interview · AI interview · Event. Its own field, so future metrics can group on it |
| Outcomes | `passed` / `failed` join `scheduled` / `done` / `cancelled`. `done` = held, outcome unrecorded |
| Guard | Verdicts appear only for kinds that allow them; switching kind clears a now-invalid verdict |
| Filters | User, profile, event kind |

**🗓 Week picker**

| | |
|---|---|
| Presets | This Week · Last Week · Last 30 Days · Last 90 Days · Custom Range |
| Popover | Two-month calendar. Any day selects its Sun–Sat week; future weeks disabled |
| API | `/team-week` and `/export.csv` take `weeks` (1–13) and aggregate the range |

**Elsewhere** — admin pages (users, metrics, history, training sites, agent) · collapsible sidebar, applied pre-paint so it never snaps shut · error, global-error and not-found pages · CSV export extracted into a tested module.

### Changed

- Team result table moved from Dashboard → Team tab.
- Team Overview chart now shows interview status counts from calendar data.
- Agent settings are admin-only; removed from member pages.
- Hour chart removed from Dashboard.
- `CLAUDE.md`: added a Profiles section, corrected three stale claims.
=======
All notable changes to Team Huddle are recorded here. Dates are the release date.

This project is an MVP; versions are milestones the owner tags by hand, not a
public API contract.

## [1.1] — 2026-11-08

The release that turned a weekly scoring tool into a team workspace. Three
feature areas are new — Profiles, AI Training and the Calendar — alongside the
AI agent and Slack integration. Sixteen migrations (009–024).

### Added

**AI agent and Slack**
- A per-user chat agent (`/agent`) over OpenAI chat completions, max 8 tool
  rounds. Tools read a week, list metrics, write daily values and search, fetch
  and post Slack messages.
- Write tools are two-phase: the model previews with `confirm=false` and only
  acts after the user agrees.
- Slack app integration — Events API, OAuth callback, and Socket Mode so local
  development receives DMs and @mentions without a public URL.
- Keys and tokens are AES-256-GCM encrypted at rest. The OpenAI key and Slack
  app config are org-wide and admin-managed; secrets are never returned to the
  browser in full.

**Profiles**
- `profiles` with a many-to-many assignee join, full CRUD at `/profiles`.
- Two purposes per profile, `for_job` and `for_ai_training`, each a switch in
  the editor. A profile not marked for AI training is left off that board. The
  displayed "Used for" badge is derived from the pair, so it can never disagree
  with the switches that set it.
- Bidders: a `users.is_bidder` flag (not a role). A profile names one bidder
  with a bidder status. Because bidding belongs to the job side, those controls
  disable and clear for an AI-training-only profile.
- Filters for assignee, purpose and bidder, with per-filter counts shown
  beneath the bar.

**AI Training**
- A board and matrix view of training accounts, one row per
  `(profile_id, site_id)`, upserted on that pair.
- Training sites CRUD, including fetching a site's own name, summary and icon
  from its page.
- Board-view filters for assignee, profile and training site.

**Calendar**
- The interviews page became `/calendar`, with week and month views sized to
  the viewport. `/interviews` permanently redirects.
- Interviews were reshaped from an internal 1:1 to a profile-and-client
  meeting: the subject is a profile, the other side is plain-text client name
  and email, because a client has no account here.
- Event kinds — Interview, AI interview and Event — kept as their own field so
  future metrics can group on it.
- Outcome statuses `passed` and `failed` joined `scheduled`, `done` and
  `cancelled`. `done` means held with no outcome recorded. Passed and failed
  are offered only for the kinds where a verdict makes sense, and switching
  kind clears a verdict the new kind does not allow.
- Filters by user, profile and event kind.

**Week picker**
- Replaced with a preset menu — This Week, Last Week, Last 30 Days, Last 90
  Days, Custom Range — over a two-month calendar popover. Clicking any day
  selects that day's Sunday–Saturday week; future weeks are disabled.
- `/team-week` and `/export.csv` accept a `weeks` parameter (1–13) and
  aggregate the range. `/team-week` also returns `weeks` and `range_start`.

**Elsewhere**
- Admin pages for users, metrics, history, training sites and agent settings.
- A collapsible sidebar, with its state applied before paint so a collapsed
  sidebar does not render open and snap shut.
- Error, global-error and not-found pages.
- CSV export moved into its own tested module.

### Changed

- The team result table moved off the Dashboard and onto the Team tab.
- The Team Overview chart now shows interview status counts drawn from calendar
  data.
- Agent settings were removed from member-facing pages; they are admin-only.
- Dashboard no longer shows the hour chart.
- `CLAUDE.md` gained a Profiles section and had three stale claims corrected.
>>>>>>> f65f443549fd1ceac6da4c52b6cd3265b1fa2e6a

### Fixed

- Backend deploy failure.
- Assorted UI breakage from the interface rework.

<<<<<<< HEAD
### ⚠️ Known gaps

Documented, not fixed — matching `CLAUDE.md`.

| Area | Gap |
|---|---|
| 🔴 Security | `seed.ts` hardcodes a known-password admin. **Address before any real deploy.** |
| 🔴 Secrets | Rotating `AGENT_TOKEN_SECRET` makes stored tokens undecryptable. No re-encryption path |
| 🟡 Scoping | `teamWeekRows()` and `/time-team` hardcode `teamId = null` for non-admins → managers see everyone |
| 🟡 Performance | `/team-week`, `/review-queue`, `/history` loop `weekSnapshot` per user and week, 4 queries each |
| 🟡 Performance | Avatars are base64 data URLs in a `text` column, returned with the user row |
| ⚪ Correctness | `day_points` reflects Time Tracking only, not all metrics |
| ⚪ Dead code | `routes/admin.ts` and `routes/data.ts` are fossils of the quarterly design; would not compile |

---

## [0.1.0] — 2026-10-25

> First tagged milestone: the weekly evaluation core.

| | |
|---|---|
| Unit of work | One person's one week — daily entry, weekly grid, submit, approve with optional bonus |
| Weeks | Sunday→Saturday, UTC, decided in one place |
| Scoring | Three formula types — ratio, count, overtime (splitting into base + bonus). Pure, and the only tested code |
| Immutability | Approved weeks are frozen snapshots; changing a formula leaves them on their old numbers by design |
| Lifecycle | `draft → submitted → approved`, or `submitted → returned → submitted`. Entries lock when submitted or approved |
| Time Tracking | Built-in global metric, fed only from logged time, never daily entries |
| Views | Team table · CSV export · history chart · audit log |
| Auth | Session cookie to Next.js, short-lived signed token to Express, role read from the DB each request |
=======
### Known gaps

Carried forward and documented rather than fixed, per `CLAUDE.md`:

- `teamWeekRows()` and `/time-team` hardcode `teamId = null` for non-admins, so
  a manager's team views return everyone.
- `/team-week`, `/review-queue` and `/history` loop `weekSnapshot` per user
  (and per week), four queries each.
- `day_points` reflects Time Tracking only, not all metrics.
- Avatars are base64 data URLs in a `text` column, returned with the user row.
- `seed.ts` hardcodes a known-password admin. Address this before any real
  deploy.
- `apps/api/src/routes/admin.ts` and `data.ts` are orphaned fossils of the
  quarterly-periods design and would not compile.
- Rotating `AGENT_TOKEN_SECRET` makes every stored token undecryptable; there
  is no re-encryption path.

## [0.1.0] — 2026-10-25

First tagged milestone: the weekly evaluation core.

### Added

- One person's one week as the unit of everything — daily entry, weekly grid,
  submit, and manager or admin approval with an optional bonus.
- Weeks run Sunday to Saturday in UTC, decided in one place.
- Three scoring formula types: ratio, count and overtime, the last splitting
  into a base and a bonus row. Scoring is pure and is the only tested code.
- Approved weeks are immutable snapshots: changing a formula leaves past
  approved weeks on their old numbers by design.
- Report lifecycle `draft → submitted → approved`, or
  `submitted → returned → submitted`. Entries lock while submitted or approved.
- A built-in, global Time Tracking metric fed only from logged time, never
  daily entries.
- Team table, CSV export, history chart and audit log.
- Two-hop auth: an Auth.js session cookie to Next.js, then a short-lived
  signed token to Express, with the role read from the database each request.
>>>>>>> f65f443549fd1ceac6da4c52b6cd3265b1fa2e6a
