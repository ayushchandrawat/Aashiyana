
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function normalizePath(path) {
  return path
    .replace(/\?[\s\S]*$/, '')
    .replace(/\$\{[^}]*\}?/g, ':p')
    .replace(/:[A-Za-z_]\w*/g, ':p')
    .replace(/\/$/, '');
}

function importMap(source) {
  const map = new Map();
  for (const m of source.matchAll(/import\s+([^;]+?)\s+from\s+'(\.[^']+\.js)'/g)) {
    const [, spec, file] = m;
    const named = spec.match(/\{([^}]*)\}/);
    if (named) {
      for (const part of named[1].split(',')) {
        const alias = part.trim().split(/\s+as\s+/).pop().trim();
        if (alias) map.set(alias, file);
      }
    }
    const def = spec.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
    if (def) map.set(def, file);
  }
  return map;
}

function collectMounts() {
  const index = read('server/index.js');
  const imports = importMap(index);
  const top = [];
  for (const m of index.matchAll(/app\.use\('(\/api\/v1\/[^']+)',\s*(\w+)\)/g)) {
    const file = imports.get(m[2]);
    if (file) top.push({ prefix: m[1].replace('/api/v1', ''), file: file.replace(/^\.\//, 'server/') });
  }

  const expanded = [];
  for (const mount of top) {
    let src;
    try { src = read(mount.file); } catch { continue; }
    const local = importMap(src);

    const nested = [
      ...[...src.matchAll(/router\.use\('([^']+)',\s*(\w+)\)/g)].map((m) => [m[1], m[2]]),
      ...[...src.matchAll(/router\.use\((\w+Router)\)/g)].map((m) => ['', m[1]]),
    ];
    if (!nested.length) { expanded.push(mount); continue; }
    for (const [sub, name] of nested) {
      const rel = local.get(name);
      if (!rel) continue;
      expanded.push({ prefix: mount.prefix + sub, file: resolve('/' + dirname(mount.file), rel).slice(1) });
    }

    expanded.push(mount);
  }
  return expanded;
}

function collectHandlers() {
  const handlers = [];
  const seen = new Set();
  for (const mount of collectMounts()) {
    let src;
    try { src = read(mount.file); } catch { continue; }
    const starts = [...src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)];
    starts.forEach((h, i) => {
      const block = src.slice(h.index, i + 1 < starts.length ? starts[i + 1].index : src.length);
      const path = normalizePath((mount.prefix + h[2]) || mount.prefix);
      const key = `${h[1]} ${path} ${mount.file}`;
      if (seen.has(key)) return;
      seen.add(key);
      handlers.push({
        method: h[1].toUpperCase(),
        path,

        gated: /requireAdmin/.test(block.slice(0, 200)),
        perUser: /getUserId\(req\)|cfgUserSet\(/.test(block),
        file: mount.file,
      });
    });
  }
  return handlers;
}

function collectLeaves() {
  const registry = read('public/settings/registry.js');
  return [...registry.matchAll(
    /\{[^{}]*?id:\s*'([^']+)'[\s\S]*?adminOnly:\s*(true|false),\s*loader:\s*\(\)\s*=>\s*import\('([^']+)'\)/g,
  )].map((m) => ({ id: m[1], adminOnly: m[2] === 'true', file: 'public' + m[3] }));
}



test('die Messung erreicht Server und Registry ueberhaupt', () => {
  const handlers = collectHandlers();
  const leaves = collectLeaves();
  assert.ok(handlers.length >= 300, `nur ${handlers.length} Handler gefunden - die Mount-Kette greift nicht mehr`);
  assert.ok(handlers.filter((h) => h.method !== 'GET').length >= 200,
    'zu wenige schreibende Handler - das Muster greift nicht mehr');
  assert.ok(handlers.some((h) => h.perUser && !h.gated),
    'kein einziger ungegateter per-Nutzer-Handler gefunden - die Signatur trifft nicht mehr');
  assert.ok(leaves.length >= 20, `nur ${leaves.length} Settings-Blaetter gefunden`);
  assert.ok(leaves.filter((l) => l.adminOnly).length >= 10, 'zu wenige adminOnly-Blaetter gefunden');
});

// ── Die Regel ────────────────────────────────────────────────────────────────

test('kein adminOnly-Blatt bedient einen ungegateten per-Nutzer-Endpunkt', () => {
  const handlers = collectHandlers();
  const byPath = new Map();
  for (const h of handlers) byPath.set(`${h.method} ${h.path}`, h);

  const violations = [];
  const unresolved = [];
  let calls = 0;

  for (const leaf of collectLeaves().filter((l) => l.adminOnly)) {
    let src;
    try { src = read(leaf.file); } catch { continue; }
    for (const c of src.matchAll(/api\.(post|put|patch|delete)\(\s*[`']([^`']+)[`']/g)) {
      calls++;
      const key = `${c[1].toUpperCase()} ${normalizePath(c[2])}`;
      const handler = byPath.get(key);
      if (!handler) { unresolved.push(`${leaf.id}: ${key}`); continue; }
      if (!handler.gated && handler.perUser) {
        violations.push(`${leaf.id} ruft ${key} (${handler.file}) - ohne requireAdmin, arbeitet pro Nutzer`);
      }
    }
  }

  assert.ok(calls >= 20, `nur ${calls} schreibende Aufrufe in adminOnly-Blaettern - das Muster greift nicht mehr`);


  assert.deepEqual(unresolved, [],
    'Diese Aufrufe liessen sich keinem Handler zuordnen - der Guard kann ueber sie nichts sagen:\n  '
    + unresolved.join('\n  '));

  assert.deepEqual(violations, [],
    'Diese Endpunkte schreiben pro Nutzer und tragen kein Admin-Gate, ihr Blatt ist aber adminOnly - '
    + 'Mitglieder duerfen es und kommen nicht heran:\n  ' + violations.join('\n  '));
});

// ── Zweite Sonde: der Sammelendpunkt ─────────────────────────────────────────
//

// historischen Faelle (calendar-defaults, task-defaults #695, navigation)




// benutzt; beides waere wertlos.
//






function personalPreferenceKeys() {
  const src = read('server/routes/preferences.js');
  const perUser = new Set([...src.matchAll(/cfgUserSet\(\s*'([a-z_]+)'/g)].map((m) => m[1]));
  const household = new Set([...src.matchAll(/cfgSet\(\s*'([a-z_]+)'/g)].map((m) => m[1]));
  const ambiguous = [...perUser].filter((k) => household.has(k));
  return { keys: new Set([...perUser].filter((k) => !household.has(k))), ambiguous };
}

test('kein adminOnly-Blatt schreibt eine per-Nutzer-Preference', () => {
  const { keys: personal, ambiguous } = personalPreferenceKeys();
  assert.ok(personal.size >= 4,
    `nur ${personal.size} eindeutig persoenliche Schluessel gefunden - cfgUserSet trifft nicht mehr`);


  assert.ok(ambiguous.length <= 6,
    `${ambiguous.length} Schluessel kennen beide Wege (${ambiguous.join(', ')}) - `
    + 'der Guard verliert damit Reichweite; entweder trennen oder die Grenze hier bewusst anheben');

  const violations = [];
  let scanned = 0;

  for (const leaf of collectLeaves().filter((l) => l.adminOnly)) {
    let src;
    try { src = read(leaf.file); } catch { continue; }






    if (!/savePreferences|api\.put\(\s*'\/preferences'/.test(src)) continue;
    scanned++;
    for (const key of src.matchAll(/(?:^|[{,\s])([a-z_]{3,})\s*:/gm)) {
      if (personal.has(key[1])) {
        violations.push(`${leaf.id} schreibt '${key[1]}' - die Route legt den Wert per cfgUserSet pro Nutzer ab`);
      }
    }
  }

  assert.ok(scanned >= 3,
    `nur ${scanned} adminOnly-Blaetter schreiben ueberhaupt Preferences - das Muster greift nicht mehr`);
  assert.deepEqual(violations, [],
    'Diese Einstellungen wirken pro Nutzer, ihr Blatt ist aber adminOnly - jeder darf sie setzen, '
    + 'nur erreicht sie niemand ausser dem Admin:\n  ' + violations.join('\n  '));
});
