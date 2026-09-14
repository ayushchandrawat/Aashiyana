
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const CROP_MODULE = path.join(PUBLIC_DIR, 'utils/avatar-crop.js');

const cropSource = readFileSync(CROP_MODULE, 'utf8');

function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'vendor' || entry === 'locales') continue;
      out.push(...jsFiles(full));
    } else if (entry.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const FILES = jsFiles(PUBLIC_DIR);
const rel = (f) => path.relative(ROOT, f);

// ---------------------------------------------------------------------------
// 1. Der Dialog bleibt privat
// ---------------------------------------------------------------------------

test('openCropDialog wird nicht exportiert', () => {
  assert.ok(
    /^function openCropDialog\(/m.test(cropSource),
    'openCropDialog muss modul-privat deklariert sein'
  );







  const exportStatements = cropSource.match(
    /^[ \t]*export\s+(?:\{[^}]*\}|default[^\n]*|(?:async\s+)?function\s+\w+|class\s+\w+|(?:const|let|var)[^\n]*)/gm
  ) || [];
  assert.ok(
    exportStatements.length >= 1,
    'kein export-Statement erkannt - pickCroppedImage muss exportiert sein, das Muster greift nicht mehr'
  );
  for (const statement of exportStatements) {
    assert.ok(
      !statement.includes('openCropDialog'),
      'openCropDialog darf nicht exportiert werden - sonst baut sich der nächste '
      + `Aufrufer wieder seinen eigenen Weg dorthin: ${statement.trim()}`
    );
  }
});

test('kein Modul greift am Zuschnitt vorbei auf den Dialog zu', () => {
  for (const file of FILES) {
    if (file === CROP_MODULE) continue;
    const source = readFileSync(file, 'utf8');
    assert.ok(
      !source.includes('openCropDialog'),
      `${rel(file)} nennt openCropDialog - der einzige Weg hinein ist pickCroppedImage()`
    );
  }
});

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

function acceptedTypes() {
  const match = cropSource.match(/const ACCEPTED_TYPES = \[([^\]]+)\]/);
  assert.ok(match, 'ACCEPTED_TYPES nicht in avatar-crop.js gefunden');
  return match[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
}

function usesPicker(source) {
  return /import\s*\{[^}]*\bpickCroppedImage\b[^}]*\}\s*from/.test(source)
    || /\{[^}]*\bpickCroppedImage\b[^}]*\}\s*=\s*await\s+import\(/.test(source);
}

function imageOnlyAcceptLists(source, file) {
  const lists = [];
  for (const m of source.matchAll(/accept=(?:"([^"]*)"|'([^']*)'|(\S+))/g)) {
    assert.ok(
      m[3] === undefined,
      `${rel(file)}: unverstandene Schreibweise des accept-Attributs: ${m[0]}`
    );
    const list = m[1] ?? m[2];


    if (!list.split(',').every((type) => type.startsWith('image/'))) continue;
    lists.push(list);
  }
  return lists;
}

test('jedes reine Bildfeld neben einem Zuschnitt filtert dieselben Typen', () => {
  const expected = acceptedTypes().join(',');
  let checked = 0;

  for (const file of FILES) {
    const source = readFileSync(file, 'utf8');
    if (!usesPicker(source)) continue;

    for (const list of imageOnlyAcceptLists(source, file)) {
      checked += 1;
      assert.strictEqual(
        list,
        expected,
        `${rel(file)}: accept="${list}" weicht von ACCEPTED_TYPES ab - der Dateidialog `
        + 'bietet dann etwas an, das pickCroppedImage() danach ablehnt'
      );
    }
  }

  assert.ok(checked >= 6, `nur ${checked} Bildfelder geprüft - erwartet mindestens 6`);
});

test('ein reines Bildfeld ohne Zuschnitt prüft Typ und Größe selbst', () => {
  let checked = 0;

  for (const file of FILES) {
    if (file === CROP_MODULE) continue;
    const source = readFileSync(file, 'utf8');
    if (usesPicker(source)) continue;
    const lists = imageOnlyAcceptLists(source, file);
    if (!lists.length) continue;
    checked += 1;







    for (const list of lists) {
      const literal = `['` + list.split(',').join(`', '`) + `']`;
      assert.ok(
        source.includes(literal),
        `${rel(file)}: kein Array-Literal ${literal} gefunden - die Typprüfung `
        + `muss dieselben Typen tragen wie accept="${list}"`
      );
    }
    assert.ok(
      /\.includes\(file\.type\)/.test(source),
      `${rel(file)}: prüft file.type nicht gegen die eigene Typliste`
    );
    assert.ok(
      /file\.size\s*>/.test(source),
      `${rel(file)}: prüft file.size nicht`
    );
  }




  assert.ok(checked >= 1, 'kein rohes Bildfeld gefunden - erwartet mindestens 1 (subscriptions.js)');
});

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

test('alle Meldungsschlüssel der Aufnahme existieren in der Referenz-Locale', () => {
  const de = JSON.parse(readFileSync(path.join(PUBLIC_DIR, 'locales/de.json'), 'utf8'));
  const lookup = (key) => key.split('.').reduce((acc, part) => acc?.[part], de);




  const keys = new Set();
  const collect = (source) => {
    const block = source.match(/(DEFAULT_MESSAGE_KEYS|messageKeys)\s*[:=]\s*\{([^}]*)\}/gs) || [];
    for (const b of block) {






      for (const m of b.matchAll(/'([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+)'/g)) keys.add(m[1]);
    }
  };
  collect(cropSource);
  for (const file of FILES) collect(readFileSync(file, 'utf8'));

  assert.ok(keys.size >= 7, `nur ${keys.size} Schlüssel gefunden - erwartet mindestens 7`);
  for (const key of keys) {
    assert.strictEqual(typeof lookup(key), 'string', `de.json kennt "${key}" nicht`);
  }
});
