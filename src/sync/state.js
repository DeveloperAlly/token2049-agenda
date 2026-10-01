// Per-event state kept alongside the snapshot: when each session was first seen, last changed,
// and whether it has been removed from the site (removed rows are kept, never deleted).

/**
 * @param {object|undefined} prevState
 * @param {object[]} sessions   current sessions
 * @param {{added, removed, changed}} d
 * @param {Date} now
 */
export function applyToState(prevState, sessions, d, now) {
  const ts = now.toISOString();
  const rows = { ...(prevState?.rows || {}) };
  const changedIds = new Set(d.changed.map((c) => c.id));
  const changelog = [];

  for (const s of sessions) {
    const r = rows[s.id];
    if (!r) {
      rows[s.id] = { status: 'live', firstSeen: ts, lastChanged: ts, session: s };
      if (prevState) changelog.push({ at: ts, change: 'added', id: s.id, title: s.title, fields: '' });
    } else {
      const wasRemoved = r.status === 'removed';
      const fieldChange = changedIds.has(s.id);
      rows[s.id] = { ...r, status: 'live', session: s, lastChanged: fieldChange || wasRemoved ? ts : r.lastChanged };
      delete rows[s.id].removedAt;
      if (wasRemoved) changelog.push({ at: ts, change: 'restored', id: s.id, title: s.title, fields: '' });
      if (fieldChange) changelog.push({ at: ts, change: 'changed', id: s.id, title: s.title, fields: d.changed.find((c) => c.id === s.id).fields.join(', ') });
    }
  }
  for (const s of d.removed) {
    const r = rows[s.id];
    if (r && r.status !== 'removed') {
      rows[s.id] = { ...r, status: 'removed', removedAt: ts, lastChanged: ts };
      changelog.push({ at: ts, change: 'removed', id: s.id, title: s.title, fields: '' });
    }
  }

  const anyChange = !prevState || changelog.length > 0;
  return {
    version: 1,
    lastRunAt: ts,
    lastChangedAt: anyChange ? ts : prevState.lastChangedAt,
    rows,
    changelog: [...changelog, ...(prevState?.changelog || [])].slice(0, 2000),
  };
}
