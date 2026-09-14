import assert from 'node:assert/strict';
import test from 'node:test';
import { contentMatchesMime, hasSignature, dataUrlContentMatches } from '../server/utils/file-signature.js';


const HEADS = {
  'application/pdf': Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n1 0 obj', 'binary'),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x0d]),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
  'image/webp': Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0x10, 0, 0]), Buffer.from('WEBPVP8 ')]),
  'image/gif': Buffer.from('GIF89a\x10\x00\x10\x00', 'binary'),
  'application/msword': Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  'application/vnd.ms-excel': Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]),
};

test('echte Köpfe werden als ihr eigener Typ erkannt', () => {
  for (const [mime, head] of Object.entries(HEADS)) {
    assert.equal(contentMatchesMime(head, mime), true, `${mime} wurde abgelehnt`);
  }
});

test('ein Kopf gilt nicht für einen anderen Typ', () => {
  // Paarweise: jeder Kopf gegen jeden fremden Typ. OLE- und ZIP-Formate teilen


  const sameShell = [
    new Set(['application/msword', 'application/vnd.ms-excel']),
    new Set([
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]),
  ];
  const shared = (a, b) => sameShell.some((set) => set.has(a) && set.has(b));

  for (const [mimeA, head] of Object.entries(HEADS)) {
    for (const mimeB of Object.keys(HEADS)) {
      if (mimeA === mimeB || shared(mimeA, mimeB)) continue;
      assert.equal(contentMatchesMime(head, mimeB), false,
        `${mimeA}-Kopf wurde als ${mimeB} akzeptiert`);
    }
  }
});

test('der Angriff aus dem Bericht: HTML, das sich als Bild ausgibt', () => {
  const html = Buffer.from('<html><script>alert(1)</script></html>');
  assert.equal(contentMatchesMime(html, 'image/png'), false);
  assert.equal(contentMatchesMime(html, 'application/pdf'), false);
  assert.equal(contentMatchesMime(html, 'image/webp'), false);
});

test('Typen ohne Signatur passieren - Text hat keinen Kopf', () => {

  assert.equal(hasSignature('text/plain'), false);
  assert.equal(hasSignature('text/csv'), false);
  for (const mime of ['text/plain', 'text/csv']) {
    assert.equal(contentMatchesMime(Buffer.from('a;b;c\n1;2;3'), mime), true);

    assert.equal(contentMatchesMime(Buffer.from('<nicht wirklich html>'), mime), true);
  }
});

test('PDF mit Vorlauf wird erkannt, PDF ohne Kennung nicht', () => {

  const padded = Buffer.concat([Buffer.alloc(600, 0x20), Buffer.from('%PDF-1.4')]);
  assert.equal(contentMatchesMime(padded, 'application/pdf'), true);

  const tooFar = Buffer.concat([Buffer.alloc(1200, 0x20), Buffer.from('%PDF-1.4')]);
  assert.equal(contentMatchesMime(tooFar, 'application/pdf'), false);
});

test('PDF: der Marker darf am Rand des Fensters stehen', () => {



  const at = (n) => Buffer.concat([Buffer.alloc(n, 0x20), Buffer.from('%PDF-1.4')]);
  for (const n of [0, 600, 1019, 1020, 1023, 1024]) {
    assert.equal(contentMatchesMime(at(n), 'application/pdf'), true, `Versatz ${n} abgelehnt`);
  }
  for (const n of [1025, 1200]) {
    assert.equal(contentMatchesMime(at(n), 'application/pdf'), false, `Versatz ${n} akzeptiert`);
  }
});

test('SVG wird auf seine Form geprueft, nicht durchgewunken', () => {



  // worden.
  const ok = [
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
    '<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"></svg>',
    '\uFEFF  \n<svg />',
    '<!-- (c) 2026 -->\n<svg></svg>',
    '<!DOCTYPE svg PUBLIC "x"><svg></svg>',
  ];
  for (const src of ok) {
    assert.equal(contentMatchesMime(Buffer.from(src), 'image/svg+xml'), true, src.slice(0, 30));
  }
  const nope = [
    '<html><script>alert(1)</script></html>',
    '<!DOCTYPE html><html><body></body></html>',
    'nur text, kein markup',
    '<?xml version="1.0"?><rss></rss>',
  ];
  for (const src of nope) {
    assert.equal(contentMatchesMime(Buffer.from(src), 'image/svg+xml'), false, src.slice(0, 30));
  }
});

test('dataUrlContentMatches liest den base64-Flag case-insensitiv', () => {



  const png = 'iVBORw0KGgo=';
  assert.equal(dataUrlContentMatches(`data:image/png;BASE64,${png}`), true);
  assert.equal(dataUrlContentMatches(`data:image/png;Base64,${png}`), true);
  const html = Buffer.from('<html>').toString('base64');
  assert.equal(dataUrlContentMatches(`data:image/png;BASE64,${html}`), false,
    'Grossschreibung darf die Pruefung nicht umgehen');
});

test('leerer Inhalt erfüllt keine Signatur', () => {
  assert.equal(contentMatchesMime(Buffer.alloc(0), 'image/png'), false);
  assert.equal(contentMatchesMime(null, 'image/png'), false);


  assert.equal(contentMatchesMime(Buffer.alloc(0), 'text/plain'), true);
});

test('image/jpg gilt wie image/jpeg', () => {

  assert.equal(contentMatchesMime(HEADS['image/jpeg'], 'image/jpg'), true);
  assert.equal(contentMatchesMime(HEADS['image/png'], 'image/jpg'), false);
});

test('Groß-/Kleinschreibung des Typs spielt keine Rolle', () => {
  assert.equal(contentMatchesMime(HEADS['image/png'], 'IMAGE/PNG'), true);
});

// --------------------------------------------------------

// --------------------------------------------------------

const dataUrl = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`;

test('dataUrlContentMatches: echtes Bild ja, vertauschter Typ nein', () => {
  assert.equal(dataUrlContentMatches(dataUrl('image/png', HEADS['image/png'])), true);
  assert.equal(dataUrlContentMatches(dataUrl('image/png', HEADS['image/jpeg'])), false);
  assert.equal(dataUrlContentMatches(dataUrl('image/webp', Buffer.from('<svg onload=alert(1)>'))), false);
});

test('dataUrlContentMatches: nur der Kopf wird dekodiert, nicht die ganze Datei', () => {

  const big = Buffer.concat([HEADS['image/png'], Buffer.alloc(4 * 1024 * 1024, 7)]);
  assert.equal(dataUrlContentMatches(dataUrl('image/png', big)), true);
});

test('dataUrlContentMatches: was keine base64-data-URL ist, ist kein Bild', () => {
  for (const bad of ['', null, undefined, 'https://example.com/x.png', 'data:image/png,roh']) {
    assert.equal(dataUrlContentMatches(bad), false, `${bad} wurde akzeptiert`);
  }
});

test('dataUrlContentMatches: Zeilenumbrüche im base64 stören nicht', () => {
  // Manche Clients falten lange data-URLs.
  const folded = dataUrl('image/png', HEADS['image/png']).replace(/,/, ',\n  ');
  assert.equal(dataUrlContentMatches(folded), true);
});

// --------------------------------------------------------

// --------------------------------------------------------






import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'routes');

function routeFiles(dir = ROUTES_DIR) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name.endsWith('.js') ? [path.relative(ROUTES_DIR, full)] : [];
  });
}



const ACCEPTS_UPLOAD = /data:image\/|data:\(\[\^|ALLOWED_MIME|;base64,/;





const CHECKS_CONTENT = /\b(?:contentMatchesMime|dataUrlContentMatches)\s*\([^)]/;
const withoutImports = (src) => src.replace(/^\s*import\s[^;]*;/gm, '');

test('jede Route, die eine data-URL annimmt, prueft auch deren Inhalt', () => {
  const offenders = [];
  let checked = 0;
  for (const file of routeFiles()) {
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    if (!ACCEPTS_UPLOAD.test(src)) continue;
    checked++;
    if (!CHECKS_CONTENT.test(withoutImports(src))) offenders.push(file);
  }



  //



  // `calendar/helpers.js` (Termin-Anhang) -, und beide nahmen ihre data-URL



  assert.ok(checked >= 7, `nur ${checked} Upload-Routen gefunden - der Sucher greift nicht mehr`);
  assert.deepEqual(offenders, [], `Upload-Routen ohne Inhaltspruefung: ${offenders.join(', ')}`);
});
