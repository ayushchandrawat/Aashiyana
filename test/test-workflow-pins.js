
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = new URL('../.github/workflows/', import.meta.url);

const PINNED = /^\s*(?:- )?uses:\s*([\w.-]+\/[\w.-]+(?:\/[\w./-]+)?)@([0-9a-f]{40})\s+#\s*v?\d+\.\d+\.\d+\S*\s*$/;

function usesLines(source) {
  return source.split('\n')
    .map((line, i) => ({ line, no: i + 1 }))
    .filter(({ line }) => /^\s*(?:- )?uses:/.test(line) && !line.trimStart().startsWith('#'));
}

const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort();

test('every workflow file has at least one action to check', () => {
  assert.ok(files.length > 0, 'keine Workflows gefunden - der Guard prueft ins Leere');
  const total = files.reduce((n, f) => n + usesLines(readFileSync(new URL(f, DIR), 'utf8')).length, 0);
  assert.ok(total > 0, 'keine uses:-Zeile gefunden - der Guard prueft ins Leere');
});

for (const file of files) {
  test(`${file}: every action is pinned to a commit SHA with a version comment`, () => {
    const source = readFileSync(new URL(file, DIR), 'utf8');
    const offenders = usesLines(source)
      .filter(({ line }) => !line.includes('uses: ./'))
      .filter(({ line }) => !PINNED.test(line))
      .map(({ line, no }) => `${file}:${no}: ${line.trim()}`);
    assert.deepEqual(offenders, [],
      'uses: <owner>/<repo>@<40-hex-sha>
      + 'ist fremder Code mit Schreibrecht auf ghcr.io.\n  ' + offenders.join('\n  '));
  });
}
