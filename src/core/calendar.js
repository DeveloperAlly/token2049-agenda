// Calendar output: Google Calendar "add event" links and iCalendar (RFC 5545). Pure.
import { zonedToUtc, toUtcStamp } from './time.js';

export function describe(session) {
  const lines = [];
  if (session.type) lines.push(session.type);
  if (session.stage) lines.push(`Stage: ${session.stage}`);
  const people = session.speakers.filter((s) => s.role === 'speaker');
  const mods = session.speakers.filter((s) => s.role === 'moderator');
  const fmt = (s) => [s.name, [s.job, s.company].filter(Boolean).join(', ')].filter(Boolean).join(' - ');
  if (people.length) lines.push('', 'Speakers:', ...people.map((s) => `• ${fmt(s)}`));
  if (mods.length) lines.push('', 'Moderator:', ...mods.map((s) => `• ${fmt(s)}`));
  if (session.sourceUrl) lines.push('', session.sourceUrl);
  return lines.join('\n');
}

/** Full venue address first (so Maps/Calendar can resolve it), room/stage last. */
export function location(session) {
  return [session.venue, session.stage].filter(Boolean).join(' - ');
}

export function utcRange(session) {
  return {
    start: zonedToUtc(session.start, session.timezone),
    end: zonedToUtc(session.end, session.timezone),
  };
}

/** Google Calendar pre-filled event URL (times sent as UTC, displayed in the event's zone). */
export function googleCalendarUrl(session) {
  const { start, end } = utcRange(session);
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: session.title,
    dates: `${toUtcStamp(start)}/${toUtcStamp(end)}`,
    details: describe(session),
    location: location(session),
    ctz: session.timezone,
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold content lines at 75 octets (RFC 5545 §3.1). */
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + b > limit) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function vevent(session, { domain, stamp }) {
  const { start, end } = utcRange(session);
  return [
    'BEGIN:VEVENT',
    `UID:${session.id}@${domain}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${toUtcStamp(start)}`,
    `DTEND:${toUtcStamp(end)}`,
    `SUMMARY:${esc(session.title)}`,
    `DESCRIPTION:${esc(describe(session))}`,
    `LOCATION:${esc(location(session))}`,
    session.sourceUrl ? `URL:${session.sourceUrl}` : null,
    session.type ? `CATEGORIES:${esc(session.type)}` : null,
    'END:VEVENT',
  ].filter(Boolean);
}

/**
 * @param {object[]} sessions
 * @param {{name?: string, domain?: string, now?: Date}} opts
 */
export function toIcs(sessions, opts = {}) {
  const domain = opts.domain || 'token2049-agenda';
  const stamp = toUtcStamp(opts.now || new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DeveloperAlly//token2049-agenda//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    opts.name ? `X-WR-CALNAME:${esc(opts.name)}` : null,
    'X-PUBLISHED-TTL:PT1H',
    ...sessions.flatMap((s) => vevent(s, { domain, stamp })),
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(fold).join('\r\n') + '\r\n';
}
