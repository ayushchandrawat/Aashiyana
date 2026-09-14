import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEST_DIR = fileURLToPath(new URL('../test', import.meta.url));

const LIMIT_MS = 90_000;

function runFixture(env) {
  const result = spawnSync(process.execPath, ['test/exit-code-fixture.js'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: LIMIT_MS,
    env: { ...process.env, ...env },
  });


  // ihrem `exit`-Handler kommt. Schlaegt der Guard an, killt `timeout` sie per


  // PID kennen wir hier.
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { unlinkSync(join(tmpdir(), `aashiyana-exit-code-fixture-${result.pid}.db${suffix}`)); }
    catch { /* sauber beendet, also schon weg */ }
  }
  return result;
}

test('eine gruene Server-Suite endet von selbst mit Code 0', () => {
  const run = runFixture({});
  assert.equal(run.signal, null,
    `Die Fixture endete nicht von selbst (Signal ${run.signal}) - ein Handle haelt den Prozess offen.\n${run.stderr}`);
  assert.equal(run.status, 0, `Erwartet 0, erhalten ${run.status}.\n${run.stdout}\n${run.stderr}`);
});

test('eine fehlgeschlagene Assertion macht die Server-Suite rot', () => {
  const run = runFixture({ FIXTURE_EXPECT_STATUS: '999' });
  assert.equal(run.signal, null,
    `Die Fixture endete nicht von selbst (Signal ${run.signal}) - ein Handle haelt den Prozess offen.\n${run.stderr}`);



  assert.match(run.stdout, /fail 1/,
    `Die Fixture meldet keinen fehlgeschlagenen Testblock.\n${run.stdout}\n${run.stderr}`);
  assert.equal(run.status, 1,
    `Ein fehlgeschlagener test()-Block muss Code 1 liefern, erhalten ${run.status}. `
    + `Genau so sah der Fehler aus, den diese Suite verhindert.\n${run.stdout}`);
});

function startsTheServer(src) {
  const specs = [
    ...src.matchAll(/^\s*import[^;]*from\s*'([^']+)'/gm),
    ...src.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g),
  ].map((m) => m[1]);
  return specs.some((spec) => spec.endsWith('server/index.js') || spec.endsWith('server-ready.js'));
}

test('keine Suite, die den Server startet, beendet den Prozess selbst', () => {
  const offenders = readdirSync(TEST_DIR)
    .filter((f) => f.startsWith('test-') && f.endsWith('.js'))
    .filter((f) => {
      const src = readFileSync(`${TEST_DIR}/${f}`, 'utf8');


      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      return startsTheServer(code) && /(?<!\.)\bprocess\.exit\s*\(/.test(code);
    });
  assert.deepEqual(offenders, [],
    'Diese Suiten starten server/index.js und rufen process.exit() - das ueberschreibt den '
    + `Exit-Code von node:test: ${offenders.join(', ')}`);
});

test('die Fixture haengt an dieser Suite und an keiner Kette', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const scripts = Object.values(pkg.scripts).join(' ');
  assert.ok(!scripts.includes('exit-code-fixture'),
    'Die Fixture darf keine eigene Suite sein - sie ist absichtlich zeitweise rot.');


  // beiden Programmlaeufe oben ins Leere und meldeten trotzdem etwas.
  const src = readFileSync(new URL('./test-suite-exit-code.js', import.meta.url), 'utf8');
  const referenced = src.match(/'test\/(exit-code-fixture\.js)'/)?.[1];
  assert.ok(referenced && readdirSync(TEST_DIR).includes(referenced),
    'test/exit-code-fixture.js fehlt - die Programmlaeufe oben pruefen nichts mehr.');
});
