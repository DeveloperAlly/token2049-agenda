// Google Sheets sink against a fake Google: checks the RS256 JWT is valid and the API calls are right.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { sheetsSink, sheetIdVarName } from '../src/sinks/sheets.js';
import { normalise } from '../src/core/index.js';
import { applyToState } from '../src/sync/state.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = {
  client_email: 'bot@project.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
};
const event = { id: 'ev', timezone: 'Asia/Singapore', venue: 'V', agendaUrl: 'https://x.test', sheet: { tabPrefix: 'SG26' } };
const { sessions } = normalise([{ day: 'October 7, 2026', range: '9:00 am - 9:30 am', title: '=HYPERLINK("http://evil")', type: 'Keynote', stage: 'A', speakers: [] }], event);
const now = new Date('2026-10-01T00:00:00Z');
const out = { event, sessions, state: applyToState(undefined, sessions, { added: sessions, removed: [], changed: [] }, now) };

test('sheets sink: valid JWT, creates missing tabs, writes RAW values', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    if (url === 'https://oauth2.googleapis.com/token') {
      const assertion = new URLSearchParams(init.body).get('assertion');
      const [h, c, s] = assertion.split('.');
      const claims = JSON.parse(Buffer.from(c, 'base64url'));
      assert.equal(claims.iss, sa.client_email);
      assert.equal(claims.scope, 'https://www.googleapis.com/auth/spreadsheets');
      assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
      const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url'));
      assert.ok(ok, 'JWT signature verifies with the service account public key');
      return Response.json({ access_token: 'tok' });
    }
    assert.equal(init.headers.authorization, 'Bearer tok');
    if (init.method === 'GET') return Response.json({ sheets: [{ properties: { title: 'Sheet1' } }, { properties: { title: 'SG26 stages' } }] });
    return Response.json({});
  };
  await sheetsSink({ serviceAccountJson: JSON.stringify(sa), sheetId: 'SHEET', fetch: fakeFetch }).publish(out);

  const add = calls.find((c) => c.url.endsWith(':batchUpdate'));
  assert.deepEqual(JSON.parse(add.init.body).requests.map((r) => r.addSheet.properties.title), ['SG26 sessions', 'SG26 changelog']);
  const write = JSON.parse(calls.find((c) => c.url.endsWith('/values:batchUpdate')).init.body);
  assert.equal(write.valueInputOption, 'RAW'); // site text is never evaluated as a formula
  const sessionsTab = write.data.find((d) => d.range === "'SG26 sessions'!A1").values;
  assert.equal(sessionsTab[1][9], '=HYPERLINK("http://evil")');
  assert.ok(calls.every((c) => c.url.startsWith('https://oauth2.googleapis.com/') || c.url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/SHEET')));
});

test('sheet id variable name follows the event id', () => {
  assert.equal(sheetIdVarName({ id: 'token2049-singapore-2026' }), 'TOKEN2049_SINGAPORE_2026_SHEET_ID');
  assert.equal(sheetIdVarName({ id: 'x', sheet: { idVar: 'MY_SHEET' } }), 'MY_SHEET');
});
