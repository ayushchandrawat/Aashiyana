
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = new URL('../.github/workflows/', import.meta.url);


// davon ab, eine wirkungslose Zahl durchzuwinken.
const MAX_MINUTES = 120;

function jobsOf(source, file) {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => l === 'jobs:');
  if (start === -1) return [];

  const jobs = [];
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!line.startsWith(' ')) break;

    if (/^ {2}\S/.test(line)) {


      const jobKey = line.match(/^ {2}(?:"([\w-]+)"|'([\w-]+)'|([\w-]+)):\s*(?:#.*)?$/);
      assert.ok(jobKey, `${file}: unverstandene Zeile auf Job-Ebene: "${line}"`);
      current = { name: jobKey[1] ?? jobKey[2] ?? jobKey[3], timeout: null };
      jobs.push(current);
      continue;
    }
    if (!current) continue;

    const timeout = line.match(/^ {4}timeout-minutes:\s*(\d+)\s*(?:#.*)?$/);
    if (timeout) current.timeout = Number(timeout[1]);
  }
  return jobs;
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

test('es gibt überhaupt Workflows zu prüfen', () => {
  assert.ok(files.length > 0, 'keine Workflow-Datei gefunden - der Guard läuft ins Leere');
});

for (const file of files) {
  test(`${file}: jeder Job hat einen Laufzeitdeckel`, () => {
    const jobs = jobsOf(readFileSync(new URL(file, DIR), 'utf8'), file);
    assert.ok(
      jobs.length > 0,
      `${file}: kein Job erkannt - erwartet Job-Keys auf Indent 2 unter einem `
      + "LF-'jobs:'. Ein anderer Indent-Stil (4 Spaces, CRLF) fällt hier "
      + 'absichtlich auf, statt still übergangen zu werden'
    );

    for (const job of jobs) {
      assert.notStrictEqual(
        job.timeout,
        null,
        `${file}, Job "${job.name}": timeout-minutes fehlt - der Job erbt 6 Stunden`
      );
      assert.ok(
        job.timeout > 0 && job.timeout <= MAX_MINUTES,
        `${file}, Job "${job.name}": timeout-minutes ${job.timeout} liegt ausserhalb 1..${MAX_MINUTES}`
      );
    }
  });
}
