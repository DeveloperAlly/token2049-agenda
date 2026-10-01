// Time helpers. Pure, no I/O. Work in browsers, Node 20+ and Cloudflare Workers.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

const pad = (n) => String(n).padStart(2, '0');

/** "October 7, 2026" -> "2026-10-07" (null if unparseable) */
export function parseDay(text) {
  const m = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(text || '');
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
  if (!month) return null;
  return `${m[3]}-${pad(month)}-${pad(Number(m[2]))}`;
}

/** "9:30 am" / "12:00 PM" -> "09:30" (null if unparseable) */
export function parseClock(text) {
  const m = /(\d{1,2}):(\d{2})\s*([ap])\.?m\.?/i.exec(text || '');
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'p') h += 12;
  return `${pad(h)}:${m[2]}`;
}

/** "9:30 am - 10:00 am" -> { start: "09:30", end: "10:00" } */
export function parseRange(text) {
  const clocks = (text || '').match(/\d{1,2}:\d{2}\s*[ap]\.?m\.?/gi) || [];
  return { start: parseClock(clocks[0]), end: parseClock(clocks[1]) };
}

/** "1 h 30 min" / "20 min" / "2h" -> minutes (null if none) */
export function parseDuration(text) {
  const h = /(\d+)\s*h/i.exec(text || '');
  const m = /(\d+)\s*min/i.exec(text || '');
  if (!h && !m) return null;
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

/** Add minutes to a local "YYYY-MM-DDTHH:mm" wall-clock string. */
export function addMinutes(local, minutes) {
  const [d, t] = local.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const x = new Date(Date.UTC(y, mo - 1, da, h, mi + minutes));
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}T${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`;
}

/** Minutes between two local wall-clock strings. */
export function diffMinutes(a, b) {
  const toMs = (s) => {
    const [d, t] = s.split('T');
    const [y, mo, da] = d.split('-').map(Number);
    const [h, mi] = t.split(':').map(Number);
    return Date.UTC(y, mo - 1, da, h, mi);
  };
  return Math.round((toMs(b) - toMs(a)) / 60000);
}

/** Offset (minutes) of an IANA zone from UTC at a given UTC instant. */
function zoneOffset(utcMs, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - utcMs) / 60000);
}

/** Local wall-clock "YYYY-MM-DDTHH:mm" in timeZone -> Date (UTC instant). DST-safe. */
export function zonedToUtc(local, timeZone) {
  const [d, t] = local.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  let off = zoneOffset(guess, timeZone);
  let utc = guess - off * 60000;
  const off2 = zoneOffset(utc, timeZone);
  if (off2 !== off) utc = guess - off2 * 60000;
  return new Date(utc);
}

/** Date -> "20261007T013000Z" (iCalendar / Google Calendar UTC form) */
export function toUtcStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
