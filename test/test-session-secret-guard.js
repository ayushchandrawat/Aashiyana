process.env.DB_PATH = ':memory:';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let scenario = 0;

async function bootAuth(secret) {
  if (secret === null) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = secret;
  return import(`../server/auth.js?session-secret=${++scenario}`);
}

test('der Platzhalter aus .env.example bricht den Start ab', async () => {
  await assert.rejects(
    () => bootAuth('REPLACE_WITH_A_LONG_RANDOM_STRING'),
    /SESSION_SECRET is still the placeholder/,
  );
});

test('die Meldung nennt den Ausweg und seinen Preis', async () => {



  const err = await bootAuth('REPLACE_WITH_A_LONG_RANDOM_STRING').catch((e) => e);
  assert.match(err.message, /openssl rand -base64 48/);
  assert.match(err.message, /sign in again/);
});

test('geprüft wird das Präfix, nicht ein einzelner Literalwert', async () => {
  await assert.rejects(
    () => bootAuth('REPLACE_WITH_SOMETHING_ELSE'),
    /SESSION_SECRET is still the placeholder/,
    'sonst rutscht jede umbenannte Platzhalter-Variante durch',
  );
});

test('eine fehlende Variable behält ihre eigene Meldung', async () => {
  await assert.rejects(
    () => bootAuth(null),
    /SESSION_SECRET must be set/,
    'die beiden Fälle brauchen verschiedene Auswege: setzen vs. ersetzen',
  );
});

test('ein echtes Secret startet weiterhin', async () => {
  const mod = await bootAuth('R+7k2wQmXn4pL9vTzYbF3jHsA6dEuGcK1oNrPiWxMlZ0');
  assert.ok(mod.router, 'auth.js lädt vollständig durch');
});

test('.env.example trägt einen Platzhalter, den der Guard auch erkennt', () => {




  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const line = example.split('\n').find((l) => l.startsWith('SESSION_SECRET='));
  assert.ok(line, 'SESSION_SECRET fehlt in .env.example');

  const value = line.slice('SESSION_SECRET='.length).trim();
  assert.ok(
    value.startsWith('REPLACE_WITH_'),
    `.env.example liefert "${value}" - der Guard in server/auth.js prüft aber auf das Präfix REPLACE_WITH_ und ginge daran vorbei`,
  );
});
