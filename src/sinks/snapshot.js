// Snapshot store: docs/data/<event>/{sessions.json, sessions.csv, feed.ics, state.json}
// committed to the repo (git history = change log; GitHub Pages serves docs/).
// Same functions for both backends.

export const dataDir = (event) => `docs/data/${event.id}`;

export function snapshotStore(gh) {
  return {
    async loadPrevious(event) {
      const [s, st] = await Promise.all([
        gh.readFile(`${dataDir(event)}/sessions.json`),
        gh.readFile(`${dataDir(event)}/state.json`),
      ]);
      if (!s) return null;
      return { sessions: JSON.parse(s), state: st ? JSON.parse(st) : undefined };
    },

    async publish(out, backend) {
      const files = Object.fromEntries(Object.entries(out.files).map(([name, text]) => [`${dataDir(out.event)}/${name}`, text]));
      const d = out.diff;
      const msg = `data(${out.event.id}): ${out.sessions.length} sessions (+${d.added.length} -${d.removed.length} ~${d.changed.length}) [${backend}]`;
      return gh.commitFiles(files, msg);
    },

    async reportFailure(event, reasons, backend) {
      const body = [
        `The **${backend}** sync for \`${event.id}\` refused to publish, so the sheet, feed and snapshot were left unchanged.`,
        '',
        ...reasons.map((r) => `- ${r}`),
        '',
        `Agenda: ${event.agendaUrl}`,
        'Likely cause: the site markup changed. Check the adapter selectors (or `adapterOverrides` in the event config).',
      ].join('\n');
      return gh.reportIssue(`Sync failed: ${event.id}`, body);
    },
  };
}
