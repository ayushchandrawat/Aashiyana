
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiSpec } from '../server/openapi.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const INDEX = readFileSync(resolve(ROOT, 'server/index.js'), 'utf8');

const spec = buildOpenApiSpec({});

function routerMounts() {
  const mounts = new Map();
  for (const m of INDEX.matchAll(/app\.use\(\s*'(\/api\/v1[^']*)'\s*,\s*(?:[\w.]+\s*,\s*)*(\w+)\s*\)/g)) {
    if (!m[2].endsWith('Router')) continue;
    if (!mounts.has(m[2])) mounts.set(m[2], m[1]);
  }
  return mounts;
}

function routerFiles() {
  const files = new Map();
  for (const m of INDEX.matchAll(/import\s+(\w+)\s+from\s+'\.\/([\w./-]+\.js)'/g)) {
    files.set(m[1], resolve(ROOT, 'server', m[2]));
  }
  for (const m of INDEX.matchAll(/import\s+\{([^}]+)\}\s+from\s+'\.\/([\w./-]+\.js)'/g)) {
    for (const part of m[1].split(',')) {
      const alias = part.trim().split(/\s+as\s+/).pop().trim();
      if (alias && !files.has(alias)) files.set(alias, resolve(ROOT, 'server', m[2]));
    }
  }
  return files;
}

function directAppRoutes() {
  return [...INDEX.matchAll(/app\.(get|post|put|patch|delete)\(\s*'(\/api\/v1[^']*)'/g)]
    .map((m) => ({ verb: m[1], path: m[2].replace(/:(\w+)/g, '{$1}'), file: 'server/index.js' }));
}

function routerSources(entry, prefix = '', seen = new Map()) {
  if (seen.has(entry) || !existsSync(entry)) return seen;
  seen.set(entry, prefix);
  const src = readFileSync(entry, 'utf8');

  const imports = new Map();
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+'(\.[^']+\.js)'/g)) {
    imports.set(m[1], resolve(dirname(entry), m[2]));
  }

  const mounted = new Set();
  for (const m of src.matchAll(/router\.use\(\s*'([^']*)'\s*,\s*(?:[\w.]+\s*,\s*)*(\w+)\s*\)/g)) {
    const file = imports.get(m[2]);
    if (!file) continue;
    mounted.add(file);
    routerSources(file, prefix + m[1].replace(/\/+$/, ''), seen);
  }

  // Aufgeteilte Module ohne Sub-Mount (calendar/, budget/, health/) haengen

  // Praefix des Elternrouters.
  for (const [, file] of imports) {
    if (mounted.has(file)) continue;
    if (!file.includes(`${resolve(ROOT, 'server/routes')}/`)) continue;
    routerSources(file, prefix, seen);
  }
  return seen;
}

function routesIn(file, mount) {
  const src = readFileSync(file, 'utf8');
  const out = [];
  for (const m of src.matchAll(/\b\w*[Rr]outer\.(get|post|put|patch|delete|all)\(\s*'([^']*)'/g)) {
    const path = m[2]
      .replace(/\{\*(\w+)\}/g, '{$1}')
      .replace(/:(\w+)/g, '{$1}')
      .replace(/\/+$/, '');
    const full = (mount + (path === '/' ? '' : path)).replace(/\/+$/, '') || mount;

    out.push({ verb: m[1] === 'all' ? 'get' : m[1], path: full, file });
  }
  return out;
}

function allRoutes() {
  const mounts = routerMounts();
  const files  = routerFiles();
  const routes = [];
  for (const [name, mount] of mounts) {
    const entry = files.get(name);
    if (!entry) continue;
    for (const [source, prefix] of routerSources(entry)) {
      routes.push(...routesIn(source, mount + prefix));
    }
  }
  routes.push(...directAppRoutes());
  return routes;
}

const INTENTIONALLY_UNDOCUMENTED = new Map([]);

test('jede Route unter /api/v1 steht in der OpenAPI-Spec', () => {
  const routes = allRoutes();


  // Zahl darf schwanken, aber nicht einbrechen.
  assert.ok(routes.length > 250,
    `unerwartet wenige Routen gefunden (${routes.length}) - der Router-Verfolger greift nicht mehr`);

  const missing = routes
    .filter((r) => !spec.paths[r.path]?.[r.verb])
    .map((r) => `${r.verb.toUpperCase()} ${r.path}`)
    .filter((label) => !INTENTIONALLY_UNDOCUMENTED.has(label));

  assert.deepEqual([...new Set(missing)].sort(), [],
    'Diese Routen fehlen in der Spec. /api/v1 ist eine zugesagte Oberflaeche - was dort nicht '
    + 'steht, existiert fuer einen Integrator nicht:\n  ' + [...new Set(missing)].sort().join('\n  '));
});

test('der Router-Verfolger sieht auch die aufgeteilten Module', () => {


  // weil er wie Abdeckung aussieht.
  const routes = allRoutes();
  for (const part of ['routes/calendar/', 'routes/budget/', 'routes/health/', 'routes/inventory/']) {
    assert.ok(routes.some((r) => r.file.includes(part)),
      `keine Route aus ${part} gefunden - der Verfolger geht nicht in die Unterdateien`);
  }
});

test('die Spec beschreibt keine Route, die es nicht gibt', () => {


  const real = new Set(allRoutes().map((r) => `${r.verb} ${r.path}`));
  const phantom = [];
  for (const [path, ops] of Object.entries(spec.paths)) {
    if (!path.startsWith('/api/v1/')) continue;
    for (const verb of Object.keys(ops)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(verb)) continue;
      if (!real.has(`${verb} ${path}`)) phantom.push(`${verb.toUpperCase()} ${path}`);
    }
  }
  assert.deepEqual(phantom.sort(), [],
    `Die Spec verspricht Routen, die kein Router bedient:\n  ${phantom.sort().join('\n  ')}`);
});
