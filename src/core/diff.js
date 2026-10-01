// Snapshot comparison + sanity checks + CSV. Pure.

const FIELDS = ['day', 'start', 'end', 'stage', 'type', 'title', 'speakers', 'venue'];
const val = (s, f) => (f === 'speakers' ? s.speakers.map((p) => `${p.name}|${p.job}|${p.company}|${p.role}`).join(';') : s[f]);

/** @returns {{added: object[], removed: object[], changed: {id, title, fields: string[]}[]}} */
export function diff(prev = [], next = []) {
  const before = new Map(prev.map((s) => [s.id, s]));
  const after = new Map(next.map((s) => [s.id, s]));
  const added = next.filter((s) => !before.has(s.id));
  const removed = prev.filter((s) => !after.has(s.id));
  const changed = [];
  for (const s of next) {
    const p = before.get(s.id);
    if (!p) continue;
    const fields = FIELDS.filter((f) => val(p, f) !== val(s, f));
    if (fields.length) changed.push({ id: s.id, title: s.title, fields });
  }
  return { added, removed, changed };
}

export const isEmptyDiff = (d) => !d.added.length && !d.removed.length && !d.changed.length;

/**
 * Guard against a site redesign silently wiping data.
 * @returns {string[]} reasons the result should NOT be published (empty = ok)
 */
export function sanityCheck(next, prev, problems, { minSessions = 1, maxDropRatio = 0.2 } = {}) {
  const reasons = [];
  if (next.length < minSessions) reasons.push(`only ${next.length} sessions parsed (min ${minSessions})`);
  if (prev && prev.length && next.length < prev.length * (1 - maxDropRatio)) {
    reasons.push(`session count fell from ${prev.length} to ${next.length} (more than ${maxDropRatio * 100}%)`);
  }
  const hard = problems.filter((p) => !p.includes('defaulted'));
  if (hard.length) reasons.push(`${hard.length} items failed to parse: ${hard.slice(0, 5).join('; ')}`);
  return reasons;
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const CSV_COLUMNS = ['id', 'day', 'start', 'end', 'timezone', 'durationMin', 'stage', 'type', 'title', 'speakers', 'moderators', 'venue'];

export function sessionRow(s) {
  const names = (role) => s.speakers.filter((p) => p.role === role)
    .map((p) => [p.name, [p.job, p.company].filter(Boolean).join(', ')].filter(Boolean).join(' - ')).join('; ');
  return {
    id: s.id, day: s.day, start: s.start, end: s.end, timezone: s.timezone, durationMin: s.durationMin,
    stage: s.stage || '', type: s.type || '', title: s.title,
    speakers: names('speaker'), moderators: names('moderator'), venue: s.venue || '',
  };
}

export function toCsv(sessions) {
  const rows = sessions.map(sessionRow);
  return [CSV_COLUMNS.join(','), ...rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
}
