// End-to-end test of the Cloudflare Worker backend in Node, with an in-memory fake of the
// GitHub API and the agenda site. Proves: backend switch, one-commit publish, feed serving.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { HTMLRewriter as WasmHTMLRewriter } from 'html-rewriter-wasm';

const fixture = (await readFile(new URL('./fixtures/webflow-finsweet-page.html', import.meta.url), 'utf8'))
  .replace(/<div role="navigation"[\s\S]*?<\/div>/, '');
const eventJson = JSON.stringify({ ...JSON.parse(await readFile(new URL('../events/token2049-singapore-2026.json', import.meta.url), 'utf8')), sanity: { minSessions: 1 } });

// Workers-shaped HTMLRewriter over html-rewriter-wasm (same shim as engines.test.js).
globalThis.HTMLRewriter = class {
  constructor() { this.h = []; }
  on(s, h) { this.h.push([s, h]); return this; }
  onDocument() { return this; }
  transform(res) {
    const self = this;
    return { async text() {
      const rw = new WasmHTMLRewriter(() => {});
      for (const [s, h] of self.h) rw.on(s, h);
      await rw.write(new TextEncoder().encode(await res.text())); await rw.end(); rw.free(); return '';
    } };
  }
};
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

function fakeWorld({ backend }) {
  const files = { 'events/token2049-singapore-2026.json': eventJson };
  const commits = [];
  const issues = [];
  const b64 = (s) => Buffer.from(s).toString('base64');
  const blobs = {};
  let n = 0;
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    if (u.hostname === 'token2049.com') return new Response(fixture);
    assert.equal(u.hostname, 'api.github.com');
    assert.match(init.headers.authorization, /^Bearer test-token$/);
    const p = u.pathname.replace('/repos/DeveloperAlly/token2049-agenda', '');
    if (p === '/actions/variables/SYNC_BACKEND') return backend ? json({ value: backend }) : new Response('', { status: 404 });
    if (p.startsWith('/contents/')) {
      const path = decodeURI(p.slice('/contents/'.length));
      if (path === 'events') return json([{ name: 'token2049-singapore-2026.json', path: 'events/token2049-singapore-2026.json', type: 'file' }]);
      return files[path] ? json({ content: b64(files[path]), sha: 'x' }) : new Response('', { status: 404 });
    }
    if (p === '/git/ref/heads/main') return json({ object: { sha: `c${n}` } });
    if (p.startsWith('/git/commits/') && method === 'GET') return json({ tree: { sha: `t${n}` } });
    if (p === '/git/blobs') { const sha = `b${Object.keys(blobs).length}`; blobs[sha] = Buffer.from(body.content, 'base64').toString(); return json({ sha }); }
    if (p === '/git/trees') { for (const t of body.tree) files[t.path] = blobs[t.sha]; return json({ sha: `t${n + 1}` }); }
    if (p === '/git/commits') { commits.push(body.message); n++; return json({ sha: `c${n}` }); }
    if (p === '/git/refs/heads/main') return json({});
    if (u.pathname === '/search/issues') return json({ items: [] });
    if (p === '/issues') { issues.push(body); return json({ number: 1 }); }
    throw new Error(`unhandled ${method} ${url}`);
  };
  return { files, commits, issues };
}

const { default: worker } = await import('../runners/cloudflare/worker.js');
const env = { GITHUB_TOKEN: 'test-token', GITHUB_REPOSITORY: 'DeveloperAlly/token2049-agenda', RUN_TOKEN: 'run' };
const ctx = { waitUntil: (p) => p };
const run = () => worker.fetch(new Request('https://w.test/run', { method: 'POST', headers: { authorization: 'Bearer run' } }), env, ctx).then((r) => r.json());

test('worker does nothing when SYNC_BACKEND is unset (github is the default)', async () => {
  const w = fakeWorld({ backend: null });
  const r = await run();
  assert.equal(r.skipped, true);
  assert.equal(w.commits.length, 0);
});

test('worker syncs in ONE commit when SYNC_BACKEND=cloudflare, then serves the feed', async () => {
  const w = fakeWorld({ backend: 'cloudflare' });
  const r = await run();
  assert.equal(r['token2049-singapore-2026'].ok, true, JSON.stringify(r));
  assert.equal(r['token2049-singapore-2026'].count, 5);
  assert.equal(w.commits.length, 1);
  assert.match(w.commits[0], /^data\(token2049-singapore-2026\): 5 sessions .*\[cloudflare\]$/);
  for (const f of ['sessions.json', 'sessions.csv', 'feed.ics', 'state.json']) assert.ok(w.files[`docs/data/token2049-singapore-2026/${f}`], f);

  const again = await run();                       // unchanged site -> no new commit
  assert.equal(again['token2049-singapore-2026'].changed, false);
  assert.equal(w.commits.length, 1);

  const feed = await worker.fetch(new Request('https://w.test/feeds/token2049-singapore-2026.ics'), env, ctx);
  assert.equal(feed.status, 200);
  assert.match(feed.headers.get('content-type'), /^text\/calendar/);
  const ics = await feed.text();
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 5);
  assert.ok(ics.includes('DTSTART:20261007T011000Z')); // 9:10 SGT
});

test('/run is closed without the token', async () => {
  fakeWorld({ backend: 'cloudflare' });
  const r = await worker.fetch(new Request('https://w.test/run', { method: 'POST' }), env, ctx);
  assert.equal(r.status, 403);
});
