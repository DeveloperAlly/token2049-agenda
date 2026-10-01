# token2049-agenda

Turns conference agenda pages into:

- a **Chrome extension** that adds "Add to Google Calendar" and ".ics" buttons to every session card,
- a **Google Sheet** that stays in sync with the site,
- a subscribable **.ics feed**,
- a versioned **JSON/CSV snapshot** (git history = change log).

Config-driven: a new event is one file in [`events/`](events/). A new site platform is one adapter in [`src/adapters/`](src/adapters/).

## Layout

| Path | What |
|---|---|
| `events/*.json` | One config per event (URL, timezone, venue, adapter, pagination) |
| `src/core/` | Pure logic: session schema, time zones, calendar links, `.ics`, diff, CSV |
| `src/adapters/` | Selector maps per site platform (data, not code) |
| `src/engines/` | Run an adapter: `dom.js` (browser/linkedom), `htmlrewriter.js` (Cloudflare) |
| `src/sync/` | `sync(event, deps)`: fetch → parse → check → diff → publish (shared by both backends) |
| `src/sinks/` | Outputs: snapshot files, GitHub commit, Google Sheets, feed |
| `runners/github/` | GitHub Actions backend |
| `runners/cloudflare/` | Cloudflare Worker backend (also serves the feed) |
| `extension/` | Chrome extension (MV3) |

## Secrets

This repo is public. **No secret is ever committed.**

- GitHub backend: repository secrets (`Settings → Secrets and variables → Actions`).
- Cloudflare backend: `wrangler secret put …` (stored by Cloudflare).
- The extension holds no secrets.
- CI runs [gitleaks](https://github.com/gitleaks/gitleaks) on every push and PR. `.gitignore` blocks `.env*`, `.dev.vars*`, `credentials/`, `*service-account*.json`.

## Development

```bash
npm install
npm test
```

## Chrome extension (load unpacked)

```bash
npm install
npm run build:extension
```

Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick `extension/dist`.
Open the agenda page: every session card gets **Add to Google Calendar** and **.ics**; the top of the list gets
**Download all sessions (.ics)** (fetches every page and stage, not just what the filter shows).

The extension has no permissions beyond running on the agenda URLs in `events/*.json`, makes no network calls
except to the agenda site itself, and stores nothing.

## Sync backends

Both run the same `sync()` and write the same files to `docs/data/<event>/`. Exactly one runs, chosen by the
repository variable **`SYNC_BACKEND`** (`Settings → Secrets and variables → Actions → Variables`):

| `SYNC_BACKEND` | What runs |
|---|---|
| unset or `github` | GitHub Action `.github/workflows/sync.yml` (every 3 h + manual) |
| `cloudflare` | Cloudflare Worker cron (every 3 h); the Action skips itself |

### GitHub Actions
Nothing to configure beyond (optionally) the Google Sheets secret below. Free on public repos.

### Cloudflare Worker
```bash
cd runners/cloudflare && npm install && cd ../..
npx --prefix runners/cloudflare wrangler login
npx --prefix runners/cloudflare wrangler secret put GITHUB_TOKEN --config runners/cloudflare/wrangler.toml
npm run worker:deploy
```
`GITHUB_TOKEN` is a **fine-grained personal access token** limited to this repository with:
Contents: read and write, Issues: read and write, Variables: read.

Endpoints: `/` (index), `/feeds/<event>.ics`, `/data/<event>/sessions.json|csv`.

**Cost note:** parsing ~1 MB of agenda HTML measured ~20 ms per page in local workerd, above the Workers
Free plan's 10 ms CPU limit. Expect to need Workers Paid if Cloudflare is the active backend. Check the
CPU time of the first runs in the Cloudflare dashboard.

## Calendar feed

Subscribe in Google Calendar (**Other calendars → + → From URL**) to either:
- GitHub Pages: `https://developerally.github.io/token2049-agenda/data/<event>/feed.ics`
  (enable Pages: `Settings → Pages → Deploy from branch → main /docs`)
- Worker: `https://<worker-host>/feeds/<event>.ics`

Google refreshes subscribed calendars on its own schedule (can take many hours).

## Google Sheet (optional)

One sheet per event. Both backends read the sheet id from a GitHub **repository variable** named after the
event id in upper snake case + `_SHEET_ID`:

| Event config `id` | Variable |
|---|---|
| `token2049-singapore-2026` | `TOKEN2049_SINGAPORE_2026_SHEET_ID` |
| `token2049-dubai-2027` | `TOKEN2049_DUBAI_2027_SHEET_ID` |

(Override the name with `"sheet": { "idVar": "..." }` in the event config.)

- GitHub backend: secret `GOOGLE_SERVICE_ACCOUNT_JSON`.
- Cloudflare backend: `wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON`; the sheet id still comes from the
  GitHub variable (the Worker's token has Variables: read).
- Share each sheet with the service account's email as Editor.

Tabs: `sessions`, `stages`, `changelog` (set `"sheet": { "tabPrefix": "SG26" }` only if several events share
one sheet). Removed sessions stay, marked `removed`. Values are written RAW, so site text is never run as a
formula.

## Adding an event (e.g. Dubai)

1. Copy `events/token2049-singapore-2026.json` → `events/token2049-dubai-2027.json`.
2. Update `id`, `name`, `agendaUrl`, `match`, `timezone` (`Asia/Dubai`), `venue`, `dates`,
   and `pagination.param` (Webflow's `<listId>_page`, found in the agenda's "Load more" link).
3. `npm run sync -- --event token2049-dubai-2027 --dry-run` to check parsing, then commit.
   Rebuild the extension to pick up the new URL.
4. Optional sheet: create a sheet, share it with the service account, add variable `TOKEN2049_DUBAI_2027_SHEET_ID`.

If sync ever refuses to publish (site markup changed), it opens a `Sync failed: <event>` issue and leaves all
outputs untouched.
