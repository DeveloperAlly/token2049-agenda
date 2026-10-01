// Streaming engine: runs the same adapter with Cloudflare's HTMLRewriter (lol-html).
// Low CPU, no DOM tree. The HTMLRewriter class is injected so this module also runs
// under tests (html-rewriter-wasm / workerd).
import { joinTextNodes, decodeEntities } from './text.js';

/**
 * @param {string} html
 * @param {object} adapter
 * @param {typeof HTMLRewriter} HTMLRewriterClass
 * @returns {Promise<object[]>} raw records
 */
export async function parseHtmlRewriter(html, adapter, HTMLRewriterClass) {
  const records = [];
  let item = null;          // current record
  let group = null;         // { name, rec }

  // One handler per field selector. HTMLRewriter text handlers receive the text of the matched
  // element AND its descendants, so each capture collects exactly its own text (cheap: no
  // document-wide text handler).
  const field = (target, key) => {
    let cap = null;
    return {
      element(el) {
        const obj = target();
        if (!obj || key in obj) { cap = null; return; } // querySelector semantics: first match wins
        cap = { nodes: [], buf: '' };
        const mine = cap;
        el.onEndTag(() => {
          if (mine.buf) mine.nodes.push(mine.buf);
          obj[key] = joinTextNodes(mine.nodes.map(decodeEntities));
          if (cap === mine) cap = null;
        });
      },
      text(t) {
        if (!cap) return;
        cap.buf += t.text;
        if (t.lastInTextNode) { cap.nodes.push(cap.buf); cap.buf = ''; }
      },
    };
  };

  let rw = new HTMLRewriterClass()
    .on(adapter.item, {
      element(el) {
        const rec = { __skip: false };
        item = rec;
        el.onEndTag(() => {
          if (!rec.__skip) {
            delete rec.__skip;
            for (const k of Object.keys(adapter.fields)) if (!(k in rec)) rec[k] = '';
            for (const [g, spec] of Object.entries(adapter.groups || {})) {
              rec[g] = (rec[g] || []).map((sub) => {
                for (const k of Object.keys(spec.fields)) if (!(k in sub)) sub[k] = '';
                return sub;
              });
            }
            records.push(rec);
          }
          item = null;
        });
      },
    });

  if (adapter.skip) {
    rw = rw.on(`${adapter.item} ${adapter.skip}`, { element() { if (item) item.__skip = true; } });
  }

  for (const [k, sel] of Object.entries(adapter.fields)) {
    rw = rw.on(`${adapter.item} ${sel}`, field(() => item, k));
  }

  for (const [g, spec] of Object.entries(adapter.groups || {})) {
    rw = rw.on(`${adapter.item} ${spec.item}`, {
      element(el) {
        if (!item) return;
        const sub = {};
        (item[g] ||= []).push(sub);
        group = { name: g, rec: sub };
        el.onEndTag(() => { group = null; });
      },
    });
    for (const [k, sel] of Object.entries(spec.fields)) {
      rw = rw.on(`${adapter.item} ${spec.item} ${sel}`, field(() => (group && group.name === g ? group.rec : null), k));
    }
  }

  // Drain the transformed stream so all handlers run.
  await rw.transform(new Response(html)).text();
  return records;
}
