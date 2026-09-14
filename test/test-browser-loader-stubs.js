
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const loaderSrc = readFileSync(new URL('./test-browser-loader.mjs', import.meta.url), 'utf8');

function stubKeys(src) {
  const body = src.slice(src.indexOf('const STUBS'));
  return [...body.matchAll(/^\s{2}'(\/[^']+)':\s*`/gm)].map((m) => m[1]);
}

function stubBody(src, key) {
  const start = src.indexOf(`'${key}': \``);
  if (start < 0) return '';
  const from = src.indexOf('`', start) + 1;
  return src.slice(from, src.indexOf('`', from));
}

const KEYS = stubKeys(loaderSrc);

test('die Stub-Tabelle ist lesbar und jeder Eintrag exportiert etwas', () => {


  assert.ok(KEYS.length >= 5, `nur ${KEYS.length} Stubs gefunden - das Muster greift nicht mehr`);
  for (const key of KEYS) {
    assert.ok(stubBody(loaderSrc, key).includes('export'),
      `Stub ${key} enthält keinen einzigen export - das Auslesen ist kaputt`);
  }
});

test('/utils/date.js wird echt geladen, nicht nachgebaut', () => {
  assert.ok(!KEYS.includes('/utils/date.js'),
    '/utils/date.js ist wieder als Stub eingetragen - die Datei hat keine DOM- oder '
    + 'i18n-Abhängigkeit, läuft im Node-Kontext und war als Nachbau schon einmal gedriftet');
});

test('der Pfad-Fallback auf public/ steht - ohne ihn ist jeder ungestubbte Pfad tot', () => {
  assert.ok(/specifier\.startsWith\('\/'\)/.test(loaderSrc),
    'der Fallback, der /foo.js auf public/foo.js abbildet, fehlt');
  assert.ok(/'\.\.\/public' \+ specifier/.test(loaderSrc),
    'der Fallback zeigt nicht mehr auf public/');
});
