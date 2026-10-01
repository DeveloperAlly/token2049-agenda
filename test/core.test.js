import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDay, parseClock, parseRange, parseDuration, zonedToUtc, toUtcStamp,
  normalise, googleCalendarUrl, toIcs, diff, sanityCheck, toCsv,
} from '../src/core/index.js';

const event = { id: 'e', timezone: 'Asia/Singapore', venue: 'Marina Bay Sands, 10 Bayfront Avenue, Singapore 018956', agendaUrl: 'https://x.test/agenda' };

test('time parsing', () => {
  assert.equal(parseDay('October 7, 2026'), '2026-10-07');
  assert.equal(parseClock('12:00 am'), '00:00');
  assert.equal(parseClock('12:15 pm'), '12:15');
  assert.equal(parseClock('9:30 am'), '09:30');
  assert.deepEqual(parseRange('9:30 am - 10:00 am'), { start: '09:30', end: '10:00' });
  assert.equal(parseDuration('1 h 30 min'), 90);
  assert.equal(parseDuration('20 min'), 20);
});

test('Singapore -> UTC (and Melbourne display) is correct', () => {
  const d = zonedToUtc('2026-10-07T09:10', 'Asia/Singapore');
  assert.equal(toUtcStamp(d), '20261007T011000Z');
  const melb = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).format(d);
  assert.equal(melb, '12:10'); // Melbourne is on AEDT (UTC+11) from 4 Oct 2026
});

test('DST-aware conversion', () => {
  assert.equal(toUtcStamp(zonedToUtc('2026-07-01T09:00', 'Australia/Melbourne')), '20260630T230000Z');
  assert.equal(toUtcStamp(zonedToUtc('2026-12-01T09:00', 'Australia/Melbourne')), '20261130T220000Z');
});

const raw = {
  day: 'October 7, 2026', type: 'Fireside', range: '9:30 am - 10:00 am', duration: '30 min',
  stage: 'OKX Main Stage', title: 'Polymarket Fireside Chat',
  speakers: [
    { firstname: 'Shayne', lastname: 'Coplan', job: 'Founder and CEO', company: 'Polymarket', tag: '' },
    { firstname: 'Balaji', lastname: 'Srinivasan', job: 'Founder', company: 'The Network State', tag: 'Moderator' },
  ],
};

test('normalise builds a full session with stable id', () => {
  const { sessions, problems } = normalise([raw], event);
  assert.deepEqual(problems, []);
  const s = sessions[0];
  assert.equal(s.start, '2026-10-07T09:30');
  assert.equal(s.end, '2026-10-07T10:00');
  assert.equal(s.durationMin, 30);
  assert.equal(s.speakers[1].role, 'moderator');
  assert.equal(normalise([raw], event).sessions[0].id, s.id);
});

test('missing fields are reported, not silently dropped', () => {
  const { sessions, problems } = normalise([{ ...raw, day: '' }], event);
  assert.equal(sessions.length, 0);
  assert.match(problems[0], /missing day/);
});

test('google calendar url', () => {
  const s = normalise([raw], event).sessions[0];
  const u = new URL(googleCalendarUrl(s));
  assert.equal(u.searchParams.get('action'), 'TEMPLATE');
  assert.equal(u.searchParams.get('dates'), '20261007T013000Z/20261007T020000Z');
  assert.equal(u.searchParams.get('ctz'), 'Asia/Singapore');
  assert.equal(u.searchParams.get('location'), 'Marina Bay Sands, 10 Bayfront Avenue, Singapore 018956 - OKX Main Stage');
  assert.match(u.searchParams.get('details'), /Moderator:\n• Balaji Srinivasan - Founder, The Network State/);
});

test('ics is RFC-shaped: CRLF, folded <=75 octets, escaped', () => {
  const s = normalise([{ ...raw, title: 'A, B; C' }], event).sessions[0];
  const ics = toIcs([s], { name: 'Test', now: new Date('2026-10-01T00:00:00Z') });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.includes('DTSTART:20261007T013000Z'));
  assert.ok(ics.includes('SUMMARY:A\\, B\\; C'));
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
});

test('diff + sanity', () => {
  const a = normalise([raw], event).sessions;
  const b = normalise([{ ...raw, stage: 'MEXC Stage' }], event).sessions; // stage is part of id -> add+remove
  const d = diff(a, b);
  assert.equal(d.added.length, 1);
  assert.equal(d.removed.length, 1);
  const c = structuredClone(a); c[0].type = 'Panel';
  assert.deepEqual(diff(a, c).changed[0].fields, ['type']);
  assert.equal(sanityCheck(a, [...a, ...a, ...a], []).length, 1);
  assert.equal(sanityCheck(a, a, []).length, 0);
});

test('csv quoting', () => {
  const csv = toCsv(normalise([{ ...raw, title: 'Say "hi", world' }], event).sessions);
  assert.ok(csv.includes('"Say ""hi"", world"'));
});
