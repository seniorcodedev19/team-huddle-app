# Team Huddle for the desktop

Team Huddle in its own window, with the things a browser tab cannot do: it stays in the tray, raises
system notifications with nothing open, shows the unread count on the taskbar, and reminds people to
submit their week.

**Status: MVP (0.1.0).** Built and tested on Windows 10. macOS and Linux targets are configured but
have never been built or run.

## How it works

The window shows the web app from the server it is pointed at. There is no second copy of any screen:
a feature added to the web app is in the desktop app the moment the server is deployed, and the two
can never disagree.

```
 desktop app (Electron)
   ├─ window ──────────────▶ https://your-server      the web app, unchanged
   └─ tray watcher ────────▶ https://your-server/api/proxy/…
                              with the window's own session cookie
```

The desktop app holds **no secret**. It signs in the way a browser does and calls the same
`/api/proxy` routes the pages call, so it has the signed-in person's rights and nothing more.
`API_JWT_SECRET` stays on the server.

What the desktop adds:

| | |
|---|---|
| **Tray** | Stays running when the window is closed. The menu shows who is signed in, how this week stands, the unread count and shortcuts to the main pages. |
| **Notifications** | A system notification when something arrives while the app is not in front. Clicking it opens the right page and marks it read. What was already waiting at start is shown by the badge, not announced. |
| **Badge** | Unread count on the taskbar button and a dot on the tray icon. |
| **Submit reminders** | A week that came back from review, last week still a draft (Sunday to Tuesday), this week still a draft (Friday afternoon, Saturday). Once a day each, never at night, never for an empty week. |
| **Connect screen** | First run asks for the server address and checks it is a Team Huddle server. The same screen appears, and retries by itself, when the server cannot be reached. |
| **Start with Windows** | Optional, from the tray menu. Starts in the tray. |

Tray menu switches: Show notifications, Remind me to submit my week, Keep running in the tray when
closed, Start with Windows.

## Run it

`desktop/` is deliberately **not** an npm workspace: it has its own `node_modules` and lockfile, so
installing Electron never touches the web and API installs or a Vercel build.

```bash
cd desktop
npm install
npm start            # compile and open the app
```

From the repo root the same commands are `npm run desktop:start`, `desktop:test`, `desktop:dist`.

First run asks for the server address: the deployed web app, or `localhost:3000` for `npm run dev`.
To skip the question for the whole team, put the address in `package.json` under
`huddle.defaultServerUrl` before building the installer.

| Command | What |
|---|---|
| `npm start` | Compile and run |
| `npm test` | Unit tests for the pure modules (`node --test`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run e2e` | Drive the real app with Playwright; see below |
| `npm run dist` | Windows installer in `release/` |
| `npm run pack` | Unpacked app in `release/win-unpacked/`, no installer |
| `npm run icons` | Redraw every icon from `apps/web/public/icon.svg` |

## Build the installer

```bash
npm run dist         # release/Team Huddle Setup 0.1.0.exe
```

A per-user installer (no admin rights). **It is not code-signed**, so Windows SmartScreen warns the
first time it is run ("More info" → "Run anyway"). Signing needs a certificate; there is none yet.
There is no auto-update: a new version means running a new installer.

## Layout

```
src/main.ts          wiring: window, tray, menus, alerts
src/preload.ts       the only bridge into a page, and only for the app's own pages
src/policy.ts        where the window may go                     (pure, tested)
src/feed.ts          which notifications deserve an alert        (pure, tested)
src/reminder.ts      when to remind someone about their week     (pure, tested)
src/activityText.ts  the sentence a notification is shown as     (pure, tested)
src/settings.ts      what is remembered between runs             (tested)
src/watcher.ts       the poll that feeds tray, badge and alerts
src/server.ts        calls to the server through /api/proxy
static/              the connect screen and the icons
e2e/run.mjs          end-to-end checks
scripts/             icon drawing; an Electron launcher
```

## Security model

- The window loads one origin: the server. Its pages run sandboxed with context isolation and no
  Node, exactly as untrusted as a web page.
- A page from the server gets **no bridge** into the app. The three calls the connect screen uses are
  exposed only to the app's own `file:` pages, and the main process checks the caller again.
- Navigation is decided by `classify()` in `policy.ts`: the server stays in the window; Google and
  Slack sign-in pages are allowed in the window because their flow ends in a redirect back; every
  other link opens in the system browser; anything that is not http(s), mailto or tel goes nowhere.
- Pages are refused every permission except clipboard write and fullscreen.
- Plain `http://` is accepted for `localhost` only. Any other server must be `https://`.
- Changing server clears the old server's cookies and stored data.
- Settings are one JSON file in the app's data folder and hold nothing secret. The sign-in is a
  cookie in the window's session, as in a browser.

## Tests

`npm test` runs 44 unit tests on the pure modules.

`npm run e2e` starts the real app (source, or a built `.exe` via `HUDDLE_E2E_EXE`) and drives it:

```bash
# Signed-out checks only. Changes nothing; safe against a live server.
HUDDLE_E2E_URL=https://your-server npm run e2e

# Also the signed-in checks that only read.
HUDDLE_E2E_URL=… HUDDLE_E2E_EMAIL=… HUDDLE_E2E_PASSWORD=… npm run e2e

# Everything, including a sign-up, a daily entry and a submitted week.
# ONLY against a throwaway database.
HUDDLE_E2E_URL=… HUDDLE_E2E_EMAIL=… HUDDLE_E2E_PASSWORD=… HUDDLE_E2E_WRITES=1 npm run e2e
```

In a test run the app records notifications and outside links instead of raising them
(`HUDDLE_E2E=1`), uses its own data folder (`HUDDLE_USER_DATA`), and can have its clock set
(`HUDDLE_NOW`) so a Saturday reminder can be seen on any day.

## Known gaps

- **Google sign-in is untested in the window.** Google can refuse sign-in from embedded browsers.
  Password sign-in works. The proper fix is to sign in through the system browser and hand the
  session to the app, which needs a small server-side endpoint.
- **Not code-signed, no auto-update** (above).
- **A real system notification has not been seen by eye from an installed copy.** The tests read
  what the app decided to show; they do not look at the screen.
- **The notification sentences are a copy** of `apps/web/src/lib/activity.ts`, because the repo has
  no shared package. A new kind of activity added there still shows up here, as a plain generic line,
  until it is added to `src/activityText.ts`.
- **The watcher polls** (notifications every 45 s, the week every 15 min) instead of holding the web
  app's event stream open. Cheap at this team size; each running copy adds one small request per
  poll on top of what the page itself does.
- **Reminders are local to each computer.** Someone who never opens the desktop app is never
  reminded. A server-side nudge (IDEAS.md 4.1) would still be worth having.
- macOS and Linux are configured in `package.json` and untested.
