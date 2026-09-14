
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DB_MODULE = resolve(ROOT, 'server/db.js');

const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));



const STATIC_IMPORT  = /\bfrom\s+['"](\.[^'"]+)['"]/g;        // import x from './y.js'
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"](\.[^'"]+)['"]/g; // await import('./y.js')

function reachableFiles(entry, staticOnly = false) {
  const patterns = staticOnly ? [STATIC_IMPORT] : [STATIC_IMPORT, DYNAMIC_IMPORT];
  const seen = new Set();
  const queue = [entry];

  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);

    const src = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      for (const match of src.matchAll(pattern)) {
        queue.push(resolve(dirname(file), match[1]));
      }
    }
  }
  return seen;
}

const STATIC_BINDINGS = /^\s*import\s+([^;]+?)\s+from\s+['"](\.[^'"]+)['"]/gm;

function staticHelpers(entry) {
  const src = readFileSync(entry, 'utf8');
  const helpers = [];
  for (const match of src.matchAll(STATIC_BINDINGS)) {
    const clause = match[1];
    const names = [

      ...(clause.match(/\{([^}]*)\}/)?.[1] ?? '')
        .split(',')
        .map((part) => part.trim().split(/\s+as\s+/).pop())
        .filter(Boolean),

      ...(clause.replace(/\{[^}]*\}/g, '').split(',').map((n) => n.trim()).filter((n) => /^\w+$/.test(n))),
    ];
    helpers.push({ file: resolve(dirname(entry), match[2]), names });
  }
  return helpers;
}

function setsDbPathInTime(entry, seen = new Set()) {
  if (seen.has(entry) || !existsSync(entry)) return false;
  seen.add(entry);
  if (reachableFiles(entry, true).has(DB_MODULE)) return false;

  const src = readFileSync(entry, 'utf8');



  const from = [];




  // "nicht gesetzt" behandelt.
  //
  // ZWEITE FORM: `freshTestDbPath()` aus test/tmp-db.js. Sie setzt DB_PATH




  // strenger setzen als zuvor.
  const assignment = /process\.env\.DB_PATH\s*=\s*([^;\n]+)|freshTestDbPath\s*\(\s*['"][^'"]+['"]\s*\)/.exec(src);
  const emptyValue = assignment?.[1] !== undefined && /^(['"])\s*\1$/.test(assignment[1].trim());
  if (assignment && !emptyValue) from.push(assignment.index);

  // DRITTE FORM: ein statisch importierter Helfer erledigt beides - er setzt




  for (const helper of staticHelpers(entry)) {
    if (!setsDbPathInTime(helper.file, seen)) continue;
    for (const name of helper.names) {
      const call = new RegExp(`\\b${name}\\s*\\(`).exec(src);
      if (call) from.push(call.index);
    }
  }

  if (!from.length) return false;
  const first = Math.min(...from);

  const loadPositions = [...src.matchAll(DYNAMIC_IMPORT)]
    .filter((m) => reachableFiles(resolve(dirname(entry), m[1])).has(DB_MODULE))
    .map((m) => m.index);

  return loadPositions.every((pos) => first < pos);
}

function nodeInvocations(command) {
  return command
    .split('&&')
    .map((segment) => segment.trim())
    .filter((segment) => /(^|\s)node\s/.test(segment))
    .map((segment) => {
      const match = segment.match(/(test\/[\w.-]+\.m?js)/);
      return match ? { segment, entry: resolve(ROOT, match[1]) } : null;
    })
    .filter(Boolean);
}

test('jede Suite, die server/db.js lädt, setzt DB_PATH', () => {
  const offenders = [];

  for (const [name, command] of Object.entries(pkg.scripts)) {
    if (name !== 'test' && !name.startsWith('test:')) continue;

    for (const { segment, entry } of nodeInvocations(command)) {
      if (!reachableFiles(entry).has(DB_MODULE)) continue;



      if (/\bDB_PATH=[^\s'"]/.test(segment)) continue;
      if (setsDbPathInTime(entry)) continue;

      offenders.push(`${name} → ${relative(ROOT, entry)}`);
    }
  }

  assert.deepStrictEqual(
    offenders, [],
    'Diese Suiten laden server/db.js ohne DB_PATH und legen dadurch eine echte '
    + `aashiyana.db im Repo an. Setze DB_PATH=:memory: davor:\n  ${offenders.join('\n  ')}`
  );
});

test('die Reihenfolgeprüfung erkennt wirkungslose Zuweisungen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aashiyana-dbguard-'));
  const dbPath = relative(dir, DB_MODULE).replaceAll('\\', '/');
  const write = (name, body) => {
    const file = join(dir, name);
    writeFileSync(file, body);
    return file;
  };

  try {


    const tooLate = write('too-late.js',
      `import * as db from '${dbPath}';\nprocess.env.DB_PATH = ':memory:';\n`);
    assert.strictEqual(setsDbPathInTime(tooLate), false, 'statischer Import zuerst');


    const inTime = write('in-time.js',
      `process.env.DB_PATH = ':memory:';\nconst db = await import('${dbPath}');\n`);
    assert.strictEqual(setsDbPathInTime(inTime), true, 'Zuweisung vor dem Laden');


    const wrongOrder = write('wrong-order.js',
      `const db = await import('${dbPath}');\nprocess.env.DB_PATH = ':memory:';\n`);
    assert.strictEqual(setsDbPathInTime(wrongOrder), false, 'Zuweisung nach dem Laden');


    const empty = write('empty.js',
      `process.env.DB_PATH = '';\nconst db = await import('${dbPath}');\n`);
    assert.strictEqual(setsDbPathInTime(empty), false, 'leerer Wert ist wirkungslos');


    const computed = write('computed.js',
      `process.env.DB_PATH = join(tmpdir(), 'x.db');\nconst db = await import('${dbPath}');\n`);
    assert.strictEqual(setsDbPathInTime(computed), true, 'berechneter Pfad zählt');



    // Form, die er kennt.
    const viaHelper = write('helper.js',
      `import { freshTestDbPath } from './tmp-db.js';\nfreshTestDbPath('x');\nconst db = await import('${dbPath}');\n`);
    assert.strictEqual(setsDbPathInTime(viaHelper), true, 'freshTestDbPath zählt');


    const helperTooLate = write('helper-late.js',
      `import * as db from '${dbPath}';\nimport { freshTestDbPath } from './tmp-db.js';\nfreshTestDbPath('x');\n`);
    assert.strictEqual(setsDbPathInTime(helperTooLate), false, 'statischer Import schlägt auch den Helfer');



    write('good-helper.js',
      `process.env.DB_PATH = ':memory:';\nexport async function boot() { return import('${dbPath}'); }\n`);
    const viaBoot = write('via-boot.js',
      `import { boot } from './good-helper.js';\nawait boot();\n`);
    assert.strictEqual(setsDbPathInTime(viaBoot), true, 'Helfer, der DB_PATH setzt und db.js lädt, zählt');



    write('bad-helper.js',
      `const db = await import('${dbPath}');\nprocess.env.DB_PATH = ':memory:';\nexport function boot() {}\n`);
    const viaBadBoot = write('via-bad-boot.js',
      `import { boot } from './bad-helper.js';\nboot();\n`);
    assert.strictEqual(setsDbPathInTime(viaBadBoot), false, 'ein Helfer mit falscher Reihenfolge zählt nicht');


    const callTooLate = write('call-late.js',
      `import { boot } from './good-helper.js';\nconst db = await import('${dbPath}');\nawait boot();\n`);
    assert.strictEqual(setsDbPathInTime(callTooLate), false, 'Helferaufruf nach dem eigenen Import zählt nicht');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('der Importverfolger erkennt db.js überhaupt', () => {


  const known = resolve(ROOT, 'test/test-holidays.js');
  assert.ok(existsSync(known), 'Referenz-Suite fehlt');
  assert.ok(
    reachableFiles(known).has(DB_MODULE),
    'test-holidays.js importiert server/db.js, der Verfolger sieht es aber nicht'
  );
});
