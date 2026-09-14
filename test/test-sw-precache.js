import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { posix } from 'node:path';
import { withoutHtmlComments } from './source-text.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const SRC = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

function loadSwLists() {
  const noop = () => {};
  const cacheStub = {
    match: async () => undefined,
    put: async () => {},
    delete: async () => {},
    addAll: async () => {},
    keys: async () => [],
  };
  const sandbox = {
    self: { addEventListener: noop, skipWaiting: noop, clients: { claim: noop, matchAll: async () => [] }, location: { origin: 'https://app.test' } },
    caches: { open: async () => cacheStub, keys: async () => [], match: async () => undefined, delete: async () => {} },
    fetch: async () => ({ ok: false }),
    Request: class { constructor(url) { this.url = url; } },
    Response: class { constructor(body, init) { this.body = body; Object.assign(this, init); } },
    Headers: class { get() { return null; } set() {} },
    console,
    Date,
    Promise,
    parseInt,
  };
  sandbox.self.self = sandbox.self;
  const ctx = createContext(sandbox);
  const lists = runInContext(
    `${SRC}\n;({ APP_SHELL, PAGE_MODULES, APP_LOCALES, PAGE_MODULE_SET })`,
    ctx,
  );


  return {
    APP_SHELL: Array.from(lists.APP_SHELL),
    PAGE_MODULES: Array.from(lists.PAGE_MODULES),
    APP_LOCALES: Array.from(lists.APP_LOCALES),
    PAGE_MODULE_SET: new Set(Array.from(lists.PAGE_MODULE_SET)),
  };
}

const { APP_SHELL, PAGE_MODULES, APP_LOCALES, PAGE_MODULE_SET } = loadSwLists();

function staticImports(pathname) {
  const file = PUBLIC_DIR + pathname.replace(/^\//, '');
  if (!existsSync(file)) return [];
  const code = readFileSync(file, 'utf8');
  const dir = posix.dirname(pathname);
  const specs = [
    ...[...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]),

    // dynamischer Import und bleibt draussen).
    ...[...code.matchAll(/^\s*import\s+'([^']+)'/gm)].map((m) => m[1]),
  ];
  return specs
    .filter((spec) => spec.startsWith('/') || spec.startsWith('.'))
    .map((spec) => (spec.startsWith('/') ? spec : posix.resolve(dir, spec)));
}

const precached = new Set([...APP_SHELL, ...PAGE_MODULES, ...APP_LOCALES]);

test('jeder precachte Pfad existiert (addAll ist All-or-Nothing)', () => {
  const missing = [...precached].filter((p) => p !== '/' && !existsSync(PUBLIC_DIR + p.replace(/^\//, '')));
  assert.deepEqual(missing, [], `Precache verweist auf nicht existierende Dateien: ${missing.join(', ')}`);
});

test('der transitive Modulgraph ist vollständig precacht (#616)', () => {
  const roots = [...APP_SHELL, ...PAGE_MODULES].filter((p) => p.endsWith('.js') || p.endsWith('.mjs'));
  const seen = new Set(roots);
  const queue = [...roots];
  const gaps = [];

  while (queue.length) {
    const current = queue.shift();
    for (const dep of staticImports(current)) {
      if (!precached.has(dep)) gaps.push(`${dep}  <- importiert von ${current}`);
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }

  assert.deepEqual(
    gaps, [],
    'Diese Module werden von precachten Modulen importiert, sind aber selbst nicht precacht. '
    + 'Nach einem Update können sie in ihrer alten Fassung gegen ein neues Seitenmodul gebunden '
    + `werden:\n  ${gaps.join('\n  ')}`,
  );
});

test('jedes eager geladene Stylesheet aus index.html ist precacht', () => {
  const html = readFileSync(PUBLIC_DIR + 'index.html', 'utf8');



  // Schreibungstoleranz durchgehend, und "durchgehend" heisst JEDER Schritt.

  // /`ONLOAD=` genauso finden - sonst zaehlt ein grossgeschriebenes




  const eager = [...html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi)]
    .map((m) => m[0])
    .filter((tag) => !/\bmedia=/i.test(tag) && !/\bonload=/i.test(tag))
    .map((tag) => tag.match(/\bhref=["']([^"']+)["']/i)?.[1])
    .filter(Boolean);


  assert.ok(eager.length >= 10, `Nur ${eager.length} eager geladene Stylesheets gefunden - das Muster greift nicht mehr`);

  const shell = new Set(APP_SHELL);
  const missing = eager.filter((href) => !shell.has(href));
  assert.deepEqual(
    missing, [],
    'Diese Stylesheets lädt index.html eager, der Service Worker precacht sie aber nicht. '
    + `Der allererste Offline-Start rendert damit ungestylt:\n  ${missing.join('\n  ')}`,
  );
});







test('jedes von index.html geladene Skript ist precacht', () => {




  const html = withoutHtmlComments(readFileSync(PUBLIC_DIR + 'index.html', 'utf8'));
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map((m) => m[1])




    .filter((src) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src))
    .map((src) => (src.startsWith('/') ? src : posix.resolve('/', src)));


  assert.ok(scripts.length >= 5, `Nur ${scripts.length} Skripte gefunden - das Muster greift nicht mehr`);

  const shell = new Set(APP_SHELL);
  const missing = scripts.filter((src) => !shell.has(src));
  assert.deepEqual(
    missing, [],
    'Diese Skripte lädt index.html, der Service Worker precacht sie aber nicht. '
    + `Offline fehlen sie ersatzlos:\n  ${missing.join('\n  ')}`,
  );
});

test('Precache-Bucket und fetch-Routing stimmen überein', () => {




  const routedToPages = (p) => p.startsWith('/pages/') || p.startsWith('/settings/') || PAGE_MODULE_SET.has(p);

  const shellInPages = APP_SHELL.filter(routedToPages);
  assert.deepEqual(shellInPages, [], `In APP_SHELL precacht, aber aus PAGES_CACHE bedient: ${shellInPages.join(', ')}`);

  const pagesInShell = PAGE_MODULES.filter((p) => !routedToPages(p));
  assert.deepEqual(pagesInShell, [], `In PAGE_MODULES precacht, aber aus SHELL_CACHE bedient: ${pagesInShell.join(', ')}`);
});

test('keine Doppeleinträge zwischen den Precache-Listen', () => {
  const all = [...APP_SHELL, ...PAGE_MODULES, ...APP_LOCALES];
  const dupes = all.filter((p, i) => all.indexOf(p) !== i);
  assert.deepEqual([...new Set(dupes)], [], `Mehrfach precacht: ${dupes.join(', ')}`);
});

test('jedes Settings-Blatt der Registry ist precacht', () => {





  // online immer geht. Gemessen am 2026-08-15 fehlten sechs von 28, vier davon

  // personal-weather.
  //


  const registry = readFileSync(new URL('../public/settings/registry.js', import.meta.url), 'utf8');
  const leaves = [...registry.matchAll(/loader:\s*\(\)\s*=>\s*import\('([^']+)'\)/g)].map((m) => m[1]);

  assert.ok(leaves.length >= 20,
    `Nur ${leaves.length} Blätter in der Registry gefunden - das Muster greift nicht mehr`);

  const precached = new Set([...APP_SHELL, ...PAGE_MODULES]);
  const missing = leaves.filter((path) => !precached.has(path));
  assert.deepEqual(
    missing, [],
    'Diese Settings-Blätter stehen in der Registry, werden aber nicht precacht '
    + `und sind damit offline nicht erreichbar:\n  ${missing.join('\n  ')}`,
  );
});
