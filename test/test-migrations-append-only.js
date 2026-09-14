
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';




const source = readFileSync(new URL('../server/db.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const VERSION_LINE = /^[ \t]*version:\s*(\d+)\s*,/gm;

function migrationsRange(text, where) {
  const start = text.indexOf('const MIGRATIONS = [');
  assert.notEqual(start, -1, `const MIGRATIONS = [ nicht in ${where} gefunden.`);
  let depth = 0;
  let index = text.indexOf('[', start);
  const from = index;
  while (index < text.length) {
    if (text[index] === '[') depth += 1;
    else if (text[index] === ']') {
      depth -= 1;
      if (depth === 0) return { from, to: index };
    }
    index += 1;
  }
  throw new Error(`Das MIGRATIONS-Array in ${where} ist nicht geschlossen.`);
}

function migrationsBlock() {
  const { from, to } = migrationsRange(source, 'server/db.js');
  return source.slice(from, to);
}

function declaredVersions(block = migrationsBlock()) {
  return [...block.matchAll(VERSION_LINE)].map((m) => Number(m[1]));
}

function git(...args) {
  try {
    const out = execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, out };
  } catch (error) {
    return { ok: false, out: '', err: String(error.stderr || error.message).trim() };
  }
}

function resolveBase() {
  const inCi = process.env.GITHUB_ACTIONS === 'true';





  const top = git('rev-parse', '--show-toplevel');
  let noRepo = null;
  if (!top.ok) noRepo = `kein git-Repository (${top.err})`;
  else if (realpathSync(top.out.trim()) !== realpathSync(repoRoot)) {
    noRepo = `git findet ${top.out.trim()} als Wurzel, nicht diesen Baum`;
  }

  if (inCi) {
    const parent = noRepo ? null : git('rev-parse', '--verify', '--quiet', 'HEAD^1^{commit}');
    if (parent?.ok) return { sha: parent.out.trim(), label: 'HEAD^1' };
    return {
      fail: `In der CI fehlt die Basis fuer den Vergleich bestehender Migrationen: ${noRepo ?? 'HEAD^1 liegt nicht im Klon'}. `
        + 'Der Checkout in .github/workflows/ci.yml braucht `with: fetch-depth: 2` - mit depth 1 hat HEAD '
        + 'keinen Elternteil. Rot statt Skip, weil ein in der CI still uebersprungener Guard gruen ueber nichts waere.',
    };
  }

  if (noRepo) return { skip: `${noRepo} - ohne git keine Basis fuer den Vergleich bestehender Migrationen` };
  if (!git('rev-parse', '--verify', '--quiet', 'origin/main^{commit}').ok) {
    return { skip: 'origin/main fehlt in diesem Klon - ohne sie keine Basis fuer den Vergleich bestehender Migrationen' };
  }
  const mergeBase = git('merge-base', 'HEAD', 'origin/main');
  if (!mergeBase.ok) return { skip: `keine gemeinsame Basis von HEAD und origin/main (${mergeBase.err})` };
  return { sha: mergeBase.out.trim(), label: 'merge-base HEAD origin/main' };
}

function lineAround(text, offset) {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  const end = text.indexOf('\n', offset);
  return { start, text: text.slice(start, end === -1 ? text.length : end) };
}

test('die Migrationen sind lueckenlos aufsteigend nummeriert', () => {
  const versions = declaredVersions();



  assert.ok(versions.length >= 100,
    `Nur ${versions.length} Versionsnummern im MIGRATIONS-Array gefunden. Entweder ist die `
    + 'Schreibweise `version: N,` entfallen - dann gehoert dieser Guard nachgezogen - oder '
    + 'das Array ist kaputt.');

  const findings = [];
  versions.forEach((version, index) => {
    if (index === 0) {
      if (version !== 1) findings.push(`Der erste Eintrag traegt version ${version}, erwartet 1.`);
      return;
    }
    const previous = versions[index - 1];
    if (version === previous) {
      findings.push(`version ${version} kommt zweimal vor (Eintrag ${index - 1} und ${index}) - `
        + 'eine Bestandsinstallation haelt die zweite fuer erledigt und ueberspringt sie.');
    } else if (version < previous) {
      findings.push(`Eintrag ${index} traegt version ${version} nach ${previous} - das Array ist umsortiert.`);
    } else if (version !== previous + 1) {
      findings.push(`Zwischen ${previous} und ${version} fehlt mindestens eine Nummer (Eintrag ${index}) - `
        + 'meist zwei Zweige, die parallel angehaengt haben.');
    }
  });

  assert.deepEqual(findings, [],
    'Das MIGRATIONS-Array in server/db.js ist append-only (CLAUDE.md). Neue Migrationen werden '
    + 'ANGEHAENGT und bekommen die naechste freie Nummer; bestehende Eintraege werden nie '
    + 'umsortiert und nie neu nummeriert.\n  ' + findings.join('\n  '));
});

test('bestehende Migrationen sind gegenueber der Basis unveraendert, neue nur angehaengt', (t) => {
  const base = resolveBase();
  if (base.skip) return t.skip(base.skip);
  if (base.fail) assert.fail(base.fail);

  const short = base.sha.slice(0, 8);
  const shown = git('show', `${base.sha}:server/db.js`);
  assert.ok(shown.ok, `server/db.js ist in der Basis ${base.label} (${short}) nicht lesbar: ${shown.err}`);
  const baseSource = shown.out;
  const baseRange = migrationsRange(baseSource, `server/db.js der Basis ${base.label} (${short})`);
  const currentRange = migrationsRange(source, 'server/db.js');
  const baseBlock = baseSource.slice(baseRange.from, baseRange.to);
  const currentBlock = source.slice(currentRange.from, currentRange.to);



  const baseCount = declaredVersions(baseBlock).length;
  assert.ok(baseCount >= 100,
    `Nur ${baseCount} Versionsnummern im MIGRATIONS-Array der Basis ${base.label} (${short}) - `
    + 'der Vergleich haette nichts gemessen.');




  const prefix = baseBlock.trimEnd().replace(/,$/, '');
  if (currentBlock.startsWith(prefix)) return;

  let at = 0;
  while (at < prefix.length && at < currentBlock.length && prefix[at] === currentBlock[at]) at += 1;




  const entry = [...baseBlock.matchAll(VERSION_LINE)].filter((m) => m.index <= at).pop();
  const column = at - lineAround(baseBlock, at).start + 1;


  // zwei gleiche Zeilen.
  const side = (text, range, block) => {
    if (at >= block.length) return '(hier endet das Array - Eintraege entfernt?)';
    const line = lineAround(block, at);
    const number = text.slice(0, range.from + line.start).split('\n').length;
    return `server/db.js:${number}  ${JSON.stringify(line.text)}`;
  };

  assert.fail([
    `Ein BESTEHENDER Eintrag im MIGRATIONS-Array weicht von der Basis ab - erster betroffener Eintrag: `
      + `${entry ? `version ${entry[1]}` : 'vor version 1'} (Spalte ${column}).`,
    'Bestehende Migrationen werden nie geaendert oder umsortiert, neue nur ANGEHAENGT (CLAUDE.md): '
      + 'eine Bestandsinstallation hat die alte Fassung schon ausgefuehrt und bekommt die neue nie.',
    `  Basis ${base.label} (${short}):  ${side(baseSource, baseRange, baseBlock)}`,
    `  Arbeitskopie:  ${side(source, currentRange, currentBlock)}`,
    `  Der ganze Unterschied: git diff ${short} -- server/db.js`,
  ].join('\n'));
});

test('jede Migration nennt neben ihrer Version auch eine Beschreibung', () => {

  // identifizierbar - `[DB] Migration 128 applied:` waere dann leer, und genau

  const block = migrationsBlock();
  const entries = block.split(/^[ \t]*version:\s*\d+\s*,/gm).slice(1);
  const versions = declaredVersions();
  const findings = [];
  entries.forEach((entry, index) => {

    const head = entry.slice(0, entry.indexOf('up:') === -1 ? entry.length : entry.indexOf('up:'));
    if (!/description:\s*['"`]\s*\S/.test(head)) {
      findings.push(`version ${versions[index]}: keine description.`);
    }
  });
  assert.deepEqual(findings, [], findings.join('\n  '));
});
