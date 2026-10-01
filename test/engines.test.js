import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { HTMLRewriter } from 'html-rewriter-wasm';
import { getAdapter } from '../src/adapters/index.js';
import { parseDom } from '../src/engines/dom.js';
import { parseHtmlRewriter } from '../src/engines/htmlrewriter.js';
import { normalise } from '../src/core/index.js';

const event = JSON.parse(await readFile(new URL('../events/token2049-singapore-2026.json', import.meta.url)));
const html = await readFile(new URL('./fixtures/webflow-finsweet-page.html', import.meta.url), 'utf8');
const adapter = getAdapter(event);

// html-rewriter-wasm has a different API from the Workers global; wrap it to the Workers shape.
class WasmRewriter {
  constructor() { this.handlers = []; this.doc = null; }
  on(sel, h) { this.handlers.push([sel, h]); return this; }
  onDocument(h) { this.doc = h; return this; }
  transform(res) {
    const self = this;
    return {
      async text() {
        const out = [];
        const enc = new TextEncoder();
        const rw = new HTMLRewriter((chunk) => out.push(chunk));
        for (const [s, h] of self.handlers) rw.on(s, h);
        if (self.doc) rw.onDocument(self.doc);
        await rw.write(enc.encode(await res.text()));
        await rw.end();
        rw.free();
        return new TextDecoder().decode(Buffer.concat(out.map((c) => Buffer.from(c))));
      },
    };
  }
}

const domRecords = () => parseDom(parseHTML(html).document, adapter);

test('DOM engine parses the fixture', () => {
  const recs = domRecords();
  assert.equal(recs.length, 5); // 6 items minus 1 day header
  const { sessions, problems } = normalise(recs, event);
  assert.deepEqual(problems, []);
  const byTitle = Object.fromEntries(sessions.map((s) => [s.title, s]));

  const reg = byTitle['Registration and Continental Breakfast'];
  assert.equal(reg.stage, null);                 // highlight card: hidden stage list must be ignored
  assert.equal(reg.type, 'General');
  assert.equal(reg.durationMin, 90);

  const fire = byTitle['Polymarket Fireside Chat'];
  assert.equal(fire.stage, 'OKX Main Stage');
  assert.deepEqual(fire.speakers.map((s) => [s.name, s.role]), [['Shayne Coplan', 'speaker'], ['Balaji Srinivasan', 'moderator']]);

  const z = byTitle["Privacy & Zcash: What's Next"];
  assert.equal(z.day, '2026-10-08');
  assert.equal(z.speakers[0].name, 'Zooko');

  const late = byTitle['Late Night Close'];
  assert.equal(late.end, '2026-10-09T00:15');    // crosses midnight
  assert.equal(late.speakers.length, 0);
});

test('HTMLRewriter engine output is identical to DOM engine', async () => {
  const a = normalise(domRecords(), event).sessions;
  const b = normalise(await parseHtmlRewriter(html, adapter, WasmRewriter), event).sessions;
  assert.equal(JSON.stringify(b), JSON.stringify(a));
});

test('pagination helpers', () => {
  assert.equal(adapter.pageUrl(event, 3), 'https://token2049.com/singapore/agenda?630073d5_page=3');
  assert.equal(adapter.hasNextPage(html), true);
  assert.equal(adapter.hasNextPage('<div></div>'), false);
});
