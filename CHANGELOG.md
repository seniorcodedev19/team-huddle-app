# Changelog

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

### Fixed

- Backend deploy failure.
- Assorted UI breakage from the interface rework.

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
