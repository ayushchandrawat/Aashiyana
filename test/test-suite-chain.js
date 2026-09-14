
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const chain = pkg.scripts.test;
const suiteScripts = Object.keys(pkg.scripts).filter((k) => k.startsWith('test:'));

const suiteFile = (name) => pkg.scripts[name].match(/test\/[\w.-]+\.js/)?.[0];

const BROWSER_CHAIN = 'test:document-guards';

function needsBrowser(name) {
  const file = suiteFile(name);
  if (!file) return false;
  const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');




  const imports = [...src.matchAll(/^\s*import[^;]*from\s*'([^']+)'/gm)].map((m) => m[1]);
  return imports.some((spec) => spec === 'puppeteer' || spec.includes('document-guards-harness'));
}

const nameEnd = '(?![\\w:.-])';
const fileEnd = '(?![\\w.-])';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const runsIn = (script, name) => {
  if (new RegExp(`npm run ${escapeRe(name)}${nameEnd}`).test(script)) return true;
  const file = suiteFile(name);
  return Boolean(file && new RegExp(`${escapeRe(file)}${fileEnd}`).test(script));
};

test('jedes test:*-Script hängt in genau einer Kette', () => {


  const wrong = [];
  for (const name of suiteScripts) {
    if (name === BROWSER_CHAIN) continue; // die Kette selbst, siehe oben
    const browser = needsBrowser(name);
    const inChain = runsIn(chain, name);
    if (browser && inChain) {
      wrong.push(`${name} fährt einen Browser und hängt trotzdem in npm test - dort ist kein Server`);
    }
    if (!browser && !inChain) {
      wrong.push(`${name} läuft nirgends - in die test-Kette einhängen (Schritt 3 in docs/test-suites.md)`);
    }
  }
  assert.deepEqual(wrong, [], wrong.join('\n  '));
});

test('die Browser-Suiten laufen unter test:document-guards', () => {
  const browserSuites = suiteScripts.filter((n) => n !== BROWSER_CHAIN && needsBrowser(n));
  const entry = pkg.scripts[BROWSER_CHAIN];
  assert.ok(entry, `${BROWSER_CHAIN} fehlt - die Browser-Kette braucht einen Einstieg.`);







  // Falschmeldung statt eines Befunds.
  assert.ok(needsBrowser(BROWSER_CHAIN),
    'needsBrowser() erkennt den Browserbedarf nicht mehr - ab hier prueft dieser Test nichts');
  const missing = browserSuites.filter((n) => !runsIn(entry, n));
  assert.deepEqual(
    missing,
    [],
    `Browser-Suiten ohne Einstieg - an test:document-guards anhängen: ${missing.join(', ')}`,
  );
});

const TEST_FILE = /test\/[\w.-]+\.m?js/g;

test('jede test/test-*.{js,mjs}-Datei hat ein npm-Script', () => {
  const referenced = new Set(
    Object.values(pkg.scripts).flatMap((v) => [...v.matchAll(TEST_FILE)].map((m) => m[0])),
  );
  const orphans = readdirSync(new URL('../test', import.meta.url))
    .filter((f) => /^test-.*\.m?js$/.test(f))
    .filter((f) => !referenced.has(`test/${f}`));
  assert.deepEqual(
    orphans,
    [],
    `Testdateien ohne test:-Script - anlegen und in die Kette einhängen: ${orphans.join(', ')}`,
  );
});

test('keine Suite baut ihren Temp-DB-Pfad von Hand zusammen', () => {
  const offenders = readdirSync(new URL('../test', import.meta.url))
    .filter((f) => f.startsWith('test-') && f.endsWith('.js'))
    .filter((f) => {
      const src = readFileSync(new URL(`../test/${f}`, import.meta.url), 'utf8');
      return /process\.env\.DB_PATH\s*=\s*path\.join\(os\.tmpdir\(\)/.test(src);
    });
  assert.deepEqual(
    offenders,
    [],
    'DB_PATH im Temp-Ordner gehoert ueber freshTestDbPath() aus test/tmp-db.js - '
    + `sonst erbt ein Lauf die Datei eines abgebrochenen mit derselben PID: ${offenders.join(', ')}`,
  );
});
