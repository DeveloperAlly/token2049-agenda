import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { parseDom } from '../src/engines/dom.js';
import { sync } from '../src/sync/sync.js';
import { buildTables, SESSION_HEADERS } from '../src/sinks/sheets.js';

const event = JSON.parse(await readFile(new URL('../events/token2049-singapore-2026.json', import.meta.url)));
const fixture = await readFile(new URL('./fixtures/webflow-finsweet-page.html', import.meta.url), 'utf8');
const lastPage = fixture.replace(/<div role="navigation"[\s\S]*?<\/div>/, ''); // no "next" link
const ev = { ...event, sanity: { minSessions: 1, maxDropRatio: 0.5 } };

// In-memory backend: what GitHub would hold.
function memory() {
  const store = { snapshot: null, published: 0, failures: [], sheets: [] };
  const deps = (html, t) => ({
    fetchText: async () => html,
    parse: async (h, adapter) => parseDom(parseHTML(h).document, adapter),
    loadPrevious: async () => store.snapshot,
    publish: async (out) => { store.snapshot = { sessions: out.sessions, state: out.state }; store.published++; },
    sinks: [{ name: 'sheet', publish: async (out) => store.sheets.push(buildTables(out)) }],
    reportFailure: async (_e, reasons) => store.failures.push(reasons),
    now: () => new Date(t),
  });
  return { store, deps };
}

test('first run publishes; identical second run publishes nothing', async () => {
  const { store, deps } = memory();
  const r1 = await sync(ev, deps(lastPage, '2026-10-01T00:00:00Z'));
  assert.equal(r1.ok, true);
  assert.equal(r1.count, 5);
  assert.equal(store.published, 1);
  const r2 = await sync(ev, deps(lastPage, '2026-10-01T03:00:00Z'));
  assert.equal(r2.changed, false);
  assert.equal(store.published, 1);  // no new commit
  assert.equal(store.sheets.length, 2); // but the sheet is rewritten every run (self-healing)
});

test('field change and removal are logged; removed rows are kept and marked', async () => {
  const { store, deps } = memory();
  await sync(ev, deps(lastPage, '2026-10-01T00:00:00Z'));
  const edited = lastPage
    .replace('<div>Fireside</div>', '<div>Panel</div>')                     // type change on Polymarket
    .replace(/<div role="listitem" class="agenda-v2_item w-dyn-item"><div class="agenda-v2_card"><div class="agenda-v2_card_time-wrapper"><div class="agenda-v2_card_time">11:45 pm[\s\S]*?Late Night Close[\s\S]*?<\/div><\/div><\/div><\/div>\n/, '');
  const r = await sync(ev, deps(edited, '2026-10-01T03:00:00Z'));
  assert.deepEqual(r.diff, { added: 0, removed: 1, changed: 1 });
  const rows = Object.values(store.snapshot.state.rows);
  const late = rows.find((x) => x.session.title === 'Late Night Close');
  assert.equal(late.status, 'removed');
  assert.equal(late.removedAt, '2026-10-01T03:00:00.000Z');
  const changes = store.snapshot.state.changelog.map((c) => `${c.change}:${c.title}:${c.fields}`);
  assert.ok(changes.includes('changed:Polymarket Fireside Chat:type'));
  assert.ok(changes.includes('removed:Late Night Close:'));

  const sheet = store.sheets.at(-1);
  assert.deepEqual(sheet.sessions[0], SESSION_HEADERS);
  assert.equal(sheet.sessions.length, 1 + 5);               // removed row still present
  assert.equal(sheet.sessions.at(-1)[0], 'removed');         // sorted after live rows
  assert.match(sheet.sessions[1].at(-1), /^https:\/\/calendar\.google\.com\/calendar\/render\?/);
  assert.equal(sheet.changelog.length, 1 + 2);
});

test('sanity failure reports and publishes nothing', async () => {
  const { store, deps } = memory();
  await sync(ev, deps(lastPage, '2026-10-01T00:00:00Z'));
  const broken = '<html><body><div class="agenda-v2_list"></div></body></html>'; // redesign: no items
  const r = await sync(ev, deps(broken, '2026-10-01T03:00:00Z'));
  assert.equal(r.ok, false);
  assert.equal(store.published, 1);
  assert.equal(store.failures.length, 1);
  assert.match(store.failures[0].join(' '), /session count fell|only 0 sessions/);
});

test('pagination follows next links until the last page', async () => {
  const { deps } = memory();
  const pages = [];
  const d = deps('', '2026-10-01T00:00:00Z');
  d.fetchText = async (url) => { pages.push(url); return pages.length < 3 ? fixture : lastPage; };
  const r = await sync(ev, d);
  assert.equal(pages.length, 3);
  assert.match(pages[2], /630073d5_page=3$/);
  assert.equal(r.count, 15); // 3 pages x 5 sessions (duplicate keys get -2/-3 id suffixes)
});
