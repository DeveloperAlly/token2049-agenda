// Raw adapter records -> validated Session objects. Pure.
import { parseDay, parseRange, parseClock, parseDuration, addMinutes, diffMinutes } from './time.js';

export const clean = (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim());

/** Stable short id: FNV-1a over the key, twice with different seeds -> 16 hex chars. */
export function stableId(key) {
  const h = (seed) => {
    let x = seed >>> 0;
    for (let i = 0; i < key.length; i++) {
      x ^= key.charCodeAt(i);
      x = Math.imul(x, 0x01000193) >>> 0;
    }
    return x.toString(16).padStart(8, '0');
  };
  return h(0x811c9dc5) + h(0x01000193);
}

function normaliseStage(raw, aliases = {}) {
  const s = clean(raw);
  if (!s) return null;
  const hit = Object.entries(aliases).find(([k]) => k.toLowerCase() === s.toLowerCase());
  return hit ? hit[1] : s;
}

function speaker(raw) {
  const firstName = clean(raw.firstname);
  const lastName = clean(raw.lastname);
  const tag = clean(raw.tag).toLowerCase();
  return {
    name: clean(`${firstName} ${lastName}`),
    firstName,
    lastName,
    job: clean(raw.job),
    company: clean(raw.company),
    role: tag === 'moderator' ? 'moderator' : 'speaker',
  };
}

/**
 * @param {Array<object>} raws  records from an engine: {day,type,range,duration,stage,title,speakers:[...]}
 * @param {object} event        event config (events/*.json)
 * @returns {{sessions: object[], problems: string[]}}
 */
export function normalise(raws, event) {
  const problems = [];
  const sessions = [];
  const seen = new Map();

  raws.forEach((r, i) => {
    const day = parseDay(r.day);
    const range = parseRange(r.range);
    const start = range.start || parseClock(r.time);
    const title = clean(r.title);
    if (!day || !start || !title) {
      problems.push(`item ${i}: missing ${[!day && 'day', !start && 'start', !title && 'title'].filter(Boolean).join(', ')}`);
      return;
    }
    const startLocal = `${day}T${start}`;
    let endLocal = null;
    const duration = parseDuration(r.duration);
    if (range.end) {
      endLocal = `${day}T${range.end}`;
      if (diffMinutes(startLocal, endLocal) <= 0) endLocal = addMinutes(endLocal, 24 * 60);
    } else if (duration) {
      endLocal = addMinutes(startLocal, duration);
    } else {
      endLocal = addMinutes(startLocal, event.defaultDurationMin || 30);
      problems.push(`item ${i} (${title}): no end time, defaulted`);
    }
    const stage = normaliseStage(r.stage, event.stageAliases);
    const baseId = stableId(`${event.id}|${startLocal}|${stage || ''}|${title.toLowerCase()}`);
    const n = (seen.get(baseId) || 0) + 1;
    seen.set(baseId, n);

    sessions.push({
      id: n === 1 ? baseId : `${baseId}-${n}`,
      event: event.id,
      day,
      start: startLocal,
      end: endLocal,
      timezone: event.timezone,
      durationMin: diffMinutes(startLocal, endLocal),
      stage,
      type: clean(r.type) || null,
      title,
      speakers: (r.speakers || []).map(speaker).filter((s) => s.name),
      venue: event.venue || null,
      sourceUrl: event.agendaUrl,
    });
  });

  sessions.sort((a, b) => a.start.localeCompare(b.start) || (a.stage || '').localeCompare(b.stage || '') || a.title.localeCompare(b.title));
  return { sessions, problems };
}
