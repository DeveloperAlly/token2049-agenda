// Content script: adds "Add to Google Calendar" and ".ics" buttons to every session card,
// plus a "Download all (.ics)" button. Uses the same adapter + core as the sync pipeline.
// Only network calls: the agenda site itself (for "Download all"). No storage, no secrets.
import events from './events.generated.js';
import { getAdapter } from '../../src/adapters/index.js';
import { parseItem, parseDom } from '../../src/engines/dom.js';
import { normalise, googleCalendarUrl, toIcs } from '../../src/core/index.js';

const PREFIX = 't2049x';
const globToRegex = (g) => new RegExp(`^${g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
const event = events.find((e) => (e.match || []).some((m) => globToRegex(m).test(location.href)));

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'session';

function button(label, title, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `${PREFIX}-btn`;
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
  return b;
}

function injectStyles() {
  if (document.getElementById(`${PREFIX}-style`)) return;
  const s = document.createElement('style');
  s.id = `${PREFIX}-style`;
  s.textContent = `
    .${PREFIX}-bar{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 4px}
    .${PREFIX}-btn{font:600 12px/1 system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.02em;
      padding:7px 10px;border-radius:6px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer;opacity:.85}
    .${PREFIX}-btn:hover{opacity:1}
    .${PREFIX}-btn.${PREFIX}-primary{background:#1a73e8;border-color:#1a73e8;color:#fff}
    .${PREFIX}-all{margin:0 0 16px}`;
  document.head.appendChild(s);
}

/** Same pagination as the sync pipeline: fetch every agenda page (same origin) and parse it. */
async function fetchAll(adapter) {
  const raws = [];
  for (let n = 1; n <= (event.pagination?.maxPages || 20); n++) {
    const html = await (await fetch(adapter.pageUrl(event, n), { credentials: 'omit' })).text();
    raws.push(...parseDom(new DOMParser().parseFromString(html, 'text/html'), adapter));
    if (!event.pagination?.param || !adapter.hasNextPage(html)) break;
  }
  return normalise(raws, event).sessions;
}

function main() {
  if (!event) return;
  const adapter = getAdapter(event);

  const process = () => {
    for (const el of document.querySelectorAll(adapter.item)) {
      if (el.dataset[`${PREFIX}Done`]) continue;
      el.dataset[`${PREFIX}Done`] = '1';
      const raw = parseItem(el, adapter);
      if (!raw) continue;
      const { sessions: [s] } = normalise([raw], event);
      if (!s) continue;
      const mount = el.querySelector(adapter.mount || adapter.fields.title);
      if (!mount) continue;
      const bar = document.createElement('div');
      bar.className = `${PREFIX}-bar`;
      const gcal = button('Add to Google Calendar', 'Opens Google Calendar with this session pre-filled', () => window.open(googleCalendarUrl(s), '_blank', 'noopener'));
      gcal.classList.add(`${PREFIX}-primary`);
      bar.append(gcal, button('.ics', 'Download this session for Apple / Outlook calendars',
        () => download(`${slug(s.title)}.ics`, toIcs([s], { name: event.name, domain: `${event.id}.agenda` }))));
      mount.insertAdjacentElement('afterend', bar);
    }
    const first = document.querySelector(adapter.item);
    if (first && !document.querySelector(`.${PREFIX}-all`)) {
      const all = document.createElement('div');
      all.className = `${PREFIX}-bar ${PREFIX}-all`;
      const allBtn = button('Download all sessions (.ics)', 'Every session on every page and stage, not just the ones shown', async () => {
        allBtn.disabled = true;
        allBtn.textContent = 'Fetching agenda...';
        try {
          const list = await fetchAll(adapter);
          download(`${event.id}.ics`, toIcs(list, { name: event.name, domain: `${event.id}.agenda` }));
          allBtn.textContent = `Downloaded ${list.length} sessions (.ics)`;
        } catch (err) {
          console.error(err);
          allBtn.textContent = 'Download failed - try again';
        } finally {
          allBtn.disabled = false;
        }
      });
      all.append(allBtn);
      first.parentElement.insertAdjacentElement('beforebegin', all);
    }
  };

  injectStyles();
  process();
  let t = null;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(process, 150); })
    .observe(document.body, { childList: true, subtree: true });
}

main();
