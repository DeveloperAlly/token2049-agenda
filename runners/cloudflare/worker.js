// Cloudflare Worker backend.
//  - Cron: runs the same sync() as the GitHub Action, only when SYNC_BACKEND (a GitHub repo variable) = "cloudflare".
//  - HTTP: serves the feed and snapshots from the repo, whichever backend produced them.
//      GET /                         index of events + feed URLs
//      GET /feeds/<event>.ics        subscribable calendar feed
//      GET /data/<event>/<file>      sessions.json | sessions.csv
//      POST /run  (Authorization: Bearer RUN_TOKEN)   manual sync, only if RUN_TOKEN is set
// Secrets (wrangler secret put): GITHUB_TOKEN, GOOGLE_SERVICE_ACCOUNT_JSON (optional), RUN_TOKEN (optional)
// Vars (wrangler.toml): GITHUB_REPOSITORY. Per-event sheet ids are read from the GitHub repo variables
// (<EVENT_ID>_SHEET_ID), the same ones the Action uses, so there is one place to configure them.
import { parseHtmlRewriter } from '../../src/engines/htmlrewriter.js';
import { sync } from '../../src/sync/sync.js';
import { github } from '../../src/sinks/github.js';
import { snapshotStore, dataDir } from '../../src/sinks/snapshot.js';
import { sheetsSink, sheetIdVarName } from '../../src/sinks/sheets.js';

const BACKEND = 'cloudflare';
const UA = 'token2049-agenda-sync (+https://github.com/DeveloperAlly/token2049-agenda)';

const gh = (env) => github({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY, branch: env.SYNC_BRANCH || 'main' });

async function loadEvents(client) {
  const files = (await client.listDir('events')).filter((f) => f.type === 'file' && f.name.endsWith('.json'));
  const texts = await Promise.all(files.map((f) => client.readFile(f.path)));
  return texts.filter(Boolean).map((t) => JSON.parse(t));
}

async function runAll(env, { force = false } = {}) {
  const client = gh(env);
  const selected = ((await client.getVariable('SYNC_BACKEND')) || 'github').toLowerCase();
  if (selected !== BACKEND && !force) {
    console.log(`SYNC_BACKEND=${selected}; the ${BACKEND} backend is not selected. Exiting without changes.`);
    return { skipped: true, selected };
  }
  const store = snapshotStore(client);
  const results = {};
  for (const event of (await loadEvents(client)).filter((e) => e.active)) {
    try {
      const sheetId = env.GOOGLE_SERVICE_ACCOUNT_JSON ? await client.getVariable(sheetIdVarName(event)) : null;
      const sinks = sheetId ? [sheetsSink({ serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON, sheetId })] : [];
      results[event.id] = await sync(event, {
        fetchText: async (url) => {
          const res = await fetch(url, { headers: { 'user-agent': UA } });
          if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
          return res.text();
        },
        parse: (html, adapter) => parseHtmlRewriter(html, adapter, HTMLRewriter),
        sinks,
        log: (m) => console.log(`[${event.id}] ${m}`),
        loadPrevious: () => store.loadPrevious(event),
        publish: (out) => store.publish(out, BACKEND),
        reportFailure: (e, reasons) => store.reportFailure(e, reasons, BACKEND),
      });
    } catch (err) {
      console.error(`[${event.id}]`, err);
      results[event.id] = { ok: false, error: String(err) };
    }
  }
  return results;
}

const FILES = { 'sessions.json': 'application/json; charset=utf-8', 'sessions.csv': 'text/csv; charset=utf-8' };

async function serveRepoFile(request, env, ctx, path, contentType) {
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;
  const text = await gh(env).readFile(path);
  if (text == null) return new Response('Not found', { status: 404 });
  const res = new Response(text, {
    headers: { 'content-type': contentType, 'cache-control': 'public, max-age=600', 'access-control-allow-origin': '*' },
  });
  ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runAll(env).then((r) => console.log(JSON.stringify(r))));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    if (request.method === 'POST' && url.pathname === '/run') {
      if (!env.RUN_TOKEN || request.headers.get('authorization') !== `Bearer ${env.RUN_TOKEN}`) {
        return new Response('Forbidden', { status: 403 });
      }
      return Response.json(await runAll(env, { force: url.searchParams.get('force') === '1' }));
    }
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

    if (parts[0] === 'feeds' && parts.length === 2 && parts[1].endsWith('.ics')) {
      const id = parts[1].slice(0, -4);
      if (!/^[a-z0-9-]+$/.test(id)) return new Response('Bad event id', { status: 400 });
      return serveRepoFile(request, env, ctx, `${dataDir({ id })}/feed.ics`, 'text/calendar; charset=utf-8');
    }
    if (parts[0] === 'data' && parts.length === 3 && FILES[parts[2]] && /^[a-z0-9-]+$/.test(parts[1])) {
      return serveRepoFile(request, env, ctx, `${dataDir({ id: parts[1] })}/${parts[2]}`, FILES[parts[2]]);
    }
    if (parts.length === 0) {
      const events = await loadEvents(gh(env));
      return Response.json(events.map((e) => ({
        id: e.id, name: e.name, active: e.active,
        feed: `${url.origin}/feeds/${e.id}.ics`,
        json: `${url.origin}/data/${e.id}/sessions.json`,
        csv: `${url.origin}/data/${e.id}/sessions.csv`,
      })));
    }
    return new Response('Not found', { status: 404 });
  },
};
