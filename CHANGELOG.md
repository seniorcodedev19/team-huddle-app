# Changelog

Milestones the owner tags by hand. Not a public API contract.

| Version | Date | Highlights |
|---|---|---|
| [1.1.1](#111--2026-11-09) | 2026-11-09 | Calendar durations · profile selection · unified scrollbars |
| [1.1](#11--2026-11-08) | 2026-11-08 | Agent & Slack · Profiles · AI Training · Calendar |
| [0.1.0](#010--2026-10-25) | 2026-10-25 | Weekly evaluation core |

---

## [1.1.1] — 2026-11-09

> Fixes to the calendar and profiles, plus one piece of cleanup.

### Fixed

| Area | Fix |
|---|---|
| Calendar | Event blocks are drawn to their real length. Every block was an hour tall, so `ends_at` was ignored and a 30-minute meeting looked like a 60-minute one |
| Calendar | Overlapping events share a column only when they genuinely overlap. The old sweep assumed hour-long events, so two consecutive half-hours were needlessly narrowed |
| Calendar | A plain event no longer requires a profile. An interview is of someone; an event is a team happening with no subject |
| Calendar | New events default to 30 minutes rather than an hour |
| Profiles | Deleting from the editor asks first, and names what else goes with it — assignees and training accounts cascade |

### Changed

| Area | Change |
|---|---|
| Calendar | The profile list selects rather than hides. Clicking narrows the grid to the profiles you pick; picking none shows everything. Multi-select adds, and "Clear (n)" resets |
| Calendar | The checkbox is gone — the row itself is the control, and the dot fills in when picked |
| Profiles | In the editor, Delete sits left and Save sits right, so the destructive button is not beside the one used every time |
| Nav | The agent icon is a spark rather than a robot head, which muddied at 15px |

### Internal

- Scrollbars are one definition covering all 13 scrolling surfaces, replacing
  two drifted implementations (only one had Firefox support or a hover state)
  and eleven containers that had no styling at all.
- The selector lists are written out rather than nested. Nesting compiles to
  `:is()`, and WebKit drops a `::-webkit-scrollbar` rule whose subject sits
  inside it — every bar would have silently reverted to the OS default.

### Docs

- `docs/v1.2-architecture.md` and `docs/v1.2-design.md` — the proposal for
  board cards, activity history and real-time notifications. Not yet built.

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

### Fixed

- Backend deploy failure.
- Assorted UI breakage from the interface rework.

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
