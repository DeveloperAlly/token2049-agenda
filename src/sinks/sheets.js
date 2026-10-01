// Google Sheets sink. Service-account auth via WebCrypto (RS256 JWT), so the same code runs
// in Node 20+ and Cloudflare Workers with no Google SDK. Credentials come from a secret at runtime.
import { sessionRow, googleCalendarUrl } from '../core/index.js';

const b64url = (buf) => {
  const bytes = buf instanceof Uint8Array ? buf : new TextEncoder().encode(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
};

async function accessToken(sa, f) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`)));
  const res = await f('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`Google token error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token;
}

/**
 * Which variable holds an event's sheet id. Convention: <EVENT_ID_IN_UPPER_SNAKE>_SHEET_ID
 * (token2049-singapore-2026 -> TOKEN2049_SINGAPORE_2026_SHEET_ID); override with event.sheet.idVar.
 * One sheet per event, no code change per event.
 */
export function sheetIdVarName(event) {
  return event.sheet?.idVar || `${event.id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_SHEET_ID`;
}

export const SESSION_HEADERS = ['status', 'id', 'day', 'start', 'end', 'timezone', 'durationMin', 'stage', 'type', 'title',
  'speakers', 'moderators', 'venue', 'firstSeen', 'lastChanged', 'addToGoogleCalendar'];

/** Build the tab contents from sync output (pure; tested). */
export function buildTables(out) {
  const rows = Object.entries(out.state.rows).map(([id, r]) => ({ id, ...r }));
  rows.sort((a, b) => (a.status === b.status ? 0 : a.status === 'live' ? -1 : 1) || a.session.start.localeCompare(b.session.start)
    || (a.session.stage || '').localeCompare(b.session.stage || ''));
  const sessions = [SESSION_HEADERS, ...rows.map((r) => {
    const base = sessionRow(r.session);
    return [r.status, base.id, base.day, base.start, base.end, base.timezone, base.durationMin, base.stage, base.type, base.title,
      base.speakers, base.moderators, base.venue, r.firstSeen, r.lastChanged, googleCalendarUrl(r.session)];
  })];
  const counts = {};
  for (const s of out.sessions) counts[s.stage || '(general / all stages)'] = (counts[s.stage || '(general / all stages)'] || 0) + 1;
  const stages = [['stage', 'liveSessions'], ...Object.entries(counts).sort((a, b) => b[1] - a[1])];
  const changelog = [['at', 'change', 'id', 'title', 'fields'], ...out.state.changelog.map((c) => [c.at, c.change, c.id, c.title, c.fields])];
  return { sessions, stages, changelog };
}

/**
 * @param {{serviceAccountJson: string, sheetId: string, fetch?: typeof fetch}} opts
 */
export function sheetsSink({ serviceAccountJson, sheetId, fetch: f = fetch }) {
  return {
    name: 'google-sheets',
    async publish(out) {
      const sa = JSON.parse(serviceAccountJson);
      const token = await accessToken(sa, f);
      const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
      const call = async (method, url, body) => {
        const res = await f(url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
        if (!res.ok) throw new Error(`Sheets ${method} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
        return res.json();
      };
      // Tabs: sessions / stages / changelog. Set event.sheet.tabPrefix only if several events share one sheet.
      const prefix = out.event.sheet?.tabPrefix ? `${out.event.sheet.tabPrefix} ` : '';
      const tables = buildTables(out);
      const tabs = { [`${prefix}sessions`]: tables.sessions, [`${prefix}stages`]: tables.stages, [`${prefix}changelog`]: tables.changelog };

      const meta = await call('GET', `${base}?fields=sheets.properties.title`);
      const existing = new Set(meta.sheets.map((s) => s.properties.title));
      const missing = Object.keys(tabs).filter((t) => !existing.has(t));
      if (missing.length) await call('POST', `${base}:batchUpdate`, { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) });

      const q = (t) => `'${t.replace(/'/g, "''")}'`;
      await call('POST', `${base}/values:batchClear`, { ranges: Object.keys(tabs).map(q) });
      // RAW: never evaluate site text as formulas (blocks formula injection).
      await call('POST', `${base}/values:batchUpdate`, {
        valueInputOption: 'RAW',
        data: Object.entries(tabs).map(([t, values]) => ({ range: `${q(t)}!A1`, values })),
      });
    },
  };
}
