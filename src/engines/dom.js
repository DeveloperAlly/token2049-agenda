// DOM engine: runs an adapter against any DOM Document/Element
// (the live page in the extension, or linkedom in Node).
import { joinTextNodes } from './text.js';

function textOf(el) {
  if (!el) return '';
  const nodes = [];
  // Adjacent text nodes (some parsers split at entities) form one logical text node;
  // element boundaries separate nodes. Matches HTMLRewriter's lastInTextNode semantics.
  const walk = (n) => {
    let run = null;
    for (const c of n.childNodes) {
      if (c.nodeType === 3) { run = (run ?? '') + c.nodeValue; continue; }
      if (run !== null) { nodes.push(run); run = null; }
      if (c.nodeType === 1) walk(c);
    }
    if (run !== null) nodes.push(run);
  };
  walk(el);
  return joinTextNodes(nodes);
}

/** Parse one item element into a raw record (null if skipped). */
export function parseItem(el, adapter) {
  if (adapter.skip && el.querySelector(adapter.skip)) return null;
  const rec = {};
  for (const [k, sel] of Object.entries(adapter.fields)) rec[k] = textOf(el.querySelector(sel));
  for (const [g, spec] of Object.entries(adapter.groups || {})) {
    rec[g] = [...el.querySelectorAll(spec.item)].map((ge) => {
      const sub = {};
      for (const [k, sel] of Object.entries(spec.fields)) sub[k] = textOf(ge.querySelector(sel));
      return sub;
    });
  }
  return rec;
}

/** Parse a whole document/root into raw records. */
export function parseDom(root, adapter) {
  return [...root.querySelectorAll(adapter.item)].map((el) => parseItem(el, adapter)).filter(Boolean);
}
