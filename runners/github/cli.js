#!/usr/bin/env node
// GitHub Actions backend (also usable locally).
//   node runners/github/cli.js --list-active            -> JSON array of active event ids (for the matrix)
//   node runners/github/cli.js --event <id>             -> sync one event (needs GITHUB_TOKEN, GITHUB_REPOSITORY)
//   node runners/github/cli.js --event <id> --dry-run   -> fetch + parse only, write ./out/<id>/*, touch nothing remote
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { parseDom } from '../../src/engines/dom.js';
import { sync } from '../../src/sync/sync.js';
import { github } from '../../src/sinks/github.js';
import { snapshotStore } from '../../src/sinks/snapshot.js';
import { sheetsSink, sheetIdVarName } from '../../src/sinks/sheets.js';

const BACKEND = 'github';
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const eventsDir = new URL('../../events/', import.meta.url);

async function loadEvents() {
  const files = (await readdir(eventsDir)).filter((f) => f.endsWith('.json'));
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(new URL(f, eventsDir), 'utf8'))));
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'token2049-agenda-sync (+https://github.com/DeveloperAlly/token2049-agenda)' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

const parse = async (html, adapter) => parseDom(parseHTML(html).document, adapter);

async function main() {
  const events = await loadEvents();
  if (flag('--list-active')) {
    process.stdout.write(JSON.stringify(events.filter((e) => e.active).map((e) => e.id)));
    return;
  }
  const event = events.find((e) => e.id === opt('--event'));
  if (!event) throw new Error(`Unknown event "${opt('--event')}". Known: ${events.map((e) => e.id).join(', ')}`);

  const selected = (process.env.SYNC_BACKEND || 'github').toLowerCase();
  if (!flag('--dry-run') && selected !== BACKEND) {
    console.log(`SYNC_BACKEND=${selected}; the ${BACKEND} backend is not selected. Exiting without changes.`);
    return;
  }

  if (flag('--dry-run')) {
    const dir = new URL(`../../out/${event.id}/`, import.meta.url);
    const result = await sync(event, {
      fetchText, parse, log: console.log,
      loadPrevious: async () => null,
      publish: async (out) => {
        await mkdir(dir, { recursive: true });
        for (const [n, t] of Object.entries(out.files)) await writeFile(new URL(n, dir), t);
      },
      reportFailure: async (_e, reasons) => console.error('sanity failure:', reasons),
    });
    console.log(JSON.stringify(result));
    return;
  }

  const gh = github({ token: process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPOSITORY, branch: process.env.SYNC_BRANCH || 'main' });
  const store = snapshotStore(gh);
  // Repository variables arrive as JSON (ACTIONS_VARS: ${{ toJSON(vars) }}), so each event finds its own sheet id.
  const vars = JSON.parse(process.env.ACTIONS_VARS || '{}');
  const sheetVar = sheetIdVarName(event);
  const sheetId = vars[sheetVar] || process.env.SHEET_ID;
  const sinks = [];
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON && sheetId) {
    sinks.push(sheetsSink({ serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON, sheetId }));
  } else {
    console.log(`Google Sheets not configured (secret GOOGLE_SERVICE_ACCOUNT_JSON + variable ${sheetVar}); skipping sheet.`);
  }

  const result = await sync(event, {
    fetchText, parse, sinks, log: console.log,
    loadPrevious: () => store.loadPrevious(event),
    publish: (out) => store.publish(out, BACKEND),
    reportFailure: (e, reasons) => store.reportFailure(e, reasons, BACKEND),
  });
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
