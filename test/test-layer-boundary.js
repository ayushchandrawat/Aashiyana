import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const SERVER_DIR = path.join(ROOT, 'server');

const SHARED_ISOMORPHIC = new Set([
  // Notes category identity must match in the API and duplicate-name picker.
  // This pure Unicode normalization has no browser or server dependencies.
  'public/utils/note-category-name.js',






  'public/utils/quick-link-url.js',
  'public/utils/recipe-meal-types.js',
  'public/utils/contact-name.js',
  'public/utils/pantry-units.js',






  'public/utils/digits.js',

  // was Event-Modal und Einstellungen bauen - zwei Definitionen desselben

  'public/utils/sync-target.js',
  // #944: HTML-Escaping. Eine Erinnerungsmail traegt Nutzertexte (Aufgaben-,



  // damit Frontend-Code, kein geteiltes Util.
  'public/utils/html-escape.js',




  // Zwei Fassungen liefen genau dort auseinander, wo es niemandem auffaellt:



  'public/utils/event-color.js',




  'public/utils/mentions.js',







  'public/utils/date.js',







  'public/utils/currency-codes.js',


  // entscheidet damit, welche Zeile einen Haken aendern darf. Zwei Fassungen


  // ueber die Route umschreiben. Reine Textfunktionen, kein DOM, kein Node.
  'public/utils/markdown-checklist.js',


  // Dokumente je Ordner, die Route filtert damit ihre Abfrage. Zwei Fassungen





  // Vorschlag. Reine Funktionen ueber eine Ordnerliste, kein DOM, kein Node.
  'public/utils/folder-tree.js',

  // Periodenbeginn, Eisprung, fruchtbares Fenster. Der Zyklus-Tab zeichnet





  'public/utils/health-cycle.js',
]);

const SOURCE_EXT = /\.(js|mjs)$/;

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (SOURCE_EXT.test(name)) out.push(full);
  }
  return out;
}

function importSpecifiers(code) {
  const out = [];
  // static: import ... from '…'  |  export ... from '…'  |  import '…'
  const staticRe = /\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g;

  const dynRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const re of [staticRe, dynRe]) {
    let m;
    while ((m = re.exec(code)) !== null) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      const line = code.slice(0, m.index).split('\n').length;
      out.push({ spec, line });
    }
  }
  return out;
}

function layerOf(absPath) {
  const rel = path.relative(ROOT, absPath);
  if (rel === 'public' || rel.startsWith('public' + path.sep)) return 'public';
  if (rel === 'server' || rel.startsWith('server' + path.sep)) return 'server';
  return null;
}

function resolveRelative(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  return path.resolve(path.dirname(fromFile), spec);
}

test('public/ importiert niemals aus server/', () => {
  const violations = [];
  for (const file of sourceFiles(PUBLIC_DIR)) {
    const code = readFileSync(file, 'utf8');
    for (const { spec, line } of importSpecifiers(code)) {
      const target = resolveRelative(file, spec);
      if (target && layerOf(target) === 'server') {
        violations.push(`${path.relative(ROOT, file)}:${line} → importiert '${spec}' (server/)`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    'Frontend-Code darf keine Server-Module importieren — die Logik gehört hinter die API:\n' +
      violations.join('\n'),
  );
});

test('server/ importiert aus public/ nur geteilte isomorphe Utils (Allowlist)', () => {
  const violations = [];
  for (const file of sourceFiles(SERVER_DIR)) {
    const code = readFileSync(file, 'utf8');
    for (const { spec, line } of importSpecifiers(code)) {
      const target = resolveRelative(file, spec);
      if (target && layerOf(target) === 'public') {
        const relTarget = path.relative(ROOT, target).split(path.sep).join('/');
        if (!SHARED_ISOMORPHIC.has(relTarget)) {
          violations.push(
            `${path.relative(ROOT, file)}:${line} → importiert '${spec}' (${relTarget})`,
          );
        }
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    'Backend darf aus public/ nur bewusst freigegebene isomorphe Utils importieren.\n' +
      'Ist das Modul wirklich isomorph (rein, ohne DOM/Node), in SHARED_ISOMORPHIC aufnehmen —\n' +
      'sonst die Logik ins Backend verschieben:\n' +
      violations.join('\n'),
  );
});

// ── Keine Quelldatei ist fuer Textwerkzeuge unsichtbar ───────────────────────
//





//





//



test('keine Quelldatei enthaelt ein rohes NUL-Byte', () => {
  const roots = ['server', 'public', 'tools', 'test'];
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|mjs|json|css|html)$/.test(entry.name)) files.push(full);
    }
  };
  for (const r of roots) walk(path.join(ROOT, r));

  assert.ok(files.length >= 200, `nur ${files.length} Quelldateien gefunden - die Suche greift nicht mehr`);

  const binary = files
    .filter((f) => readFileSync(f).includes(0x00))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(binary, [],
    'Diese Dateien enthalten ein rohes NUL-Byte und gelten damit als Binaerdateien - '
    + 'grep und Konsorten ueberspringen sie stumm. Schreib das Zeichen als \\x00:\n  '
    + binary.join('\n  '));
});
