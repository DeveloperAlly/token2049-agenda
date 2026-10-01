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
