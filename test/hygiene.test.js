// Repo hygiene: secret files must be ignored by git.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('.gitignore blocks secret files', async () => {
  const gi = (await readFile(new URL('../.gitignore', import.meta.url), 'utf8')).split('\n').map((l) => l.trim());
  for (const p of ['.env', '.env.*', '.dev.vars', 'credentials/', '*service-account*.json', '*.pem']) {
    assert.ok(gi.includes(p), `.gitignore missing ${p}`);
  }
});
