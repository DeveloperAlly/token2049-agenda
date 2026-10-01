// The one sync pipeline both backends run. All I/O is injected, so the same code runs
// in Node (GitHub Actions) and in a Cloudflare Worker.
import { getAdapter } from '../adapters/index.js';
import { normalise, diff, isEmptyDiff, sanityCheck, toCsv, toIcs } from '../core/index.js';
import { applyToState } from './state.js';

/**
 * @param {object} event  events/*.json
 * @param {object} deps
 * @param {(url: string) => Promise<string>} deps.fetchText
 * @param {(html: string, adapter: object) => Promise<object[]>} deps.parse   engine
 * @param {() => Promise<{sessions: object[], state: object} | null>} deps.loadPrevious
 * @param {(out: object) => Promise<void>} deps.publish     write snapshot/state/feed (one commit)
 * @param {Array<{name: string, publish: (out: object) => Promise<void>}>} [deps.sinks]  extra outputs (sheets)
 * @param {(event: object, reasons: string[]) => Promise<void>} deps.reportFailure
 * @param {() => Date} [deps.now]
 * @param {(msg: string) => void} [deps.log]
 */
export async function sync(event, deps) {
  const log = deps.log || (() => {});
  const now = (deps.now || (() => new Date()))();
  const adapter = getAdapter(event);

  // 1. fetch + parse every page
  const raws = [];
  const maxPages = event.pagination?.maxPages || 20;
  for (let n = 1; n <= maxPages; n++) {
    const html = await deps.fetchText(adapter.pageUrl(event, n));
    const recs = await deps.parse(html, adapter);
    raws.push(...recs);
    log(`page ${n}: ${recs.length} items`);
    if (!event.pagination?.param || !adapter.hasNextPage(html)) break;
  }

  // 2. normalise + sanity check against previous run
  const { sessions, problems } = normalise(raws, event);
  const prev = await deps.loadPrevious();
  const reasons = sanityCheck(sessions, prev?.sessions, problems, event.sanity);
  if (reasons.length) {
    log(`REFUSING to publish: ${reasons.join(' | ')}`);
    await deps.reportFailure(event, reasons);
    return { ok: false, reasons, count: sessions.length };
  }

  // 3. diff + state (first seen / last changed / removed)
  const d = diff(prev?.sessions || [], sessions);
  const changed = !prev || !isEmptyDiff(d);
  const state = applyToState(prev?.state, sessions, d, now);
  log(`${sessions.length} sessions; +${d.added.length} -${d.removed.length} ~${d.changed.length}`);

  const out = {
    event, sessions, diff: d, state, now, changed,
    files: {
      'sessions.json': JSON.stringify(sessions, null, 2) + '\n',
      'sessions.csv': toCsv(sessions),
      'feed.ics': toIcs(sessions, { name: event.name, domain: `${event.id}.agenda`, now: new Date(state.lastChangedAt) }),
      'state.json': JSON.stringify(state, null, 2) + '\n',
    },
  };

  // 4. publish (skip when nothing changed, so the feed and history stay quiet)
  if (changed) {
    await deps.publish(out);
    for (const sink of deps.sinks || []) {
      log(`sink: ${sink.name}`);
      await sink.publish(out);
    }
  } else {
    log('no changes; nothing published');
  }
  return { ok: true, count: sessions.length, changed, diff: { added: d.added.length, removed: d.removed.length, changed: d.changed.length } };
}
