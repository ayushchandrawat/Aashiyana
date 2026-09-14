import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

let scenario = 0;
async function boot(value) {
  if (value === null) delete process.env.MAX_UPLOAD_MB;
  else process.env.MAX_UPLOAD_MB = String(value);
  return import(`../server/utils/upload-limit.js?upload=${++scenario}`);
}

test('ohne Variable bleibt alles, wie es war', async () => {
  const m = await boot(null);
  assert.equal(m.MAX_UPLOAD_MB, 5);
  assert.equal(m.MAX_UPLOAD_BYTES, 5 * 1024 * 1024);
  assert.equal(m.BODY_LIMIT, '7mb', 'genau der Wert, der vor #806 fest verdrahtet war');
});

test('MAX_UPLOAD_MB hebt die Grenze, die Body-Grenze wächst mit', async () => {
  const m = await boot(25);
  assert.equal(m.MAX_UPLOAD_MB, 25);
  assert.equal(m.MAX_UPLOAD_BYTES, 25 * 1024 * 1024);
  assert.equal(m.BODY_LIMIT, '35mb',
    'base64 wächst um ein Drittel - bliebe die Body-Grenze stehen, lehnte express ab, was die Route erlaubt');
});

test('Unsinn fällt auf den Vorgabewert zurück, statt den Start zu verhindern', async () => {
  for (const value of ['', 'viel', '-3', '0']) {
    const m = await boot(value);
    assert.equal(m.MAX_UPLOAD_MB, 5, `"${value}" muss auf 5 zurückfallen`);
  }
});

test('der Wert wird auf 1-100 MB geklemmt', async () => {
  assert.equal((await boot(5000)).MAX_UPLOAD_MB, 100, 'nach oben gedeckelt: der Body liegt im Arbeitsspeicher');



  assert.equal((await boot(0.5)).MAX_UPLOAD_MB, 1, 'nach unten geklemmt, nicht auf den Vorgabewert gehoben');
});

test('keine Datei trägt die Grenze mehr selbst', () => {



  const ERLAUBT = new Set([
    'server/mcp/tools.js',
    'server/services/subscription-logo.js',
    'server/utils/upload-limit.js',
    'public/utils/upload-limit.js',         // dito im Browser
    'test/test-upload-limit.js',            // diese Datei





    // Zahl EINMAL statt zweimal: die beiden Settings-Blaetter trugen sie
    // vorher jedes fuer sich.
    'public/utils/avatar-crop.js',
  ]);
  const treffer = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(path); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const rel = path.replace(/^\.\//, '');
      if (ERLAUBT.has(rel)) continue;
      if (/5\s*\*\s*1024\s*\*\s*1024/.test(readFileSync(path, 'utf8'))) treffer.push(rel);
    }
  };
  walk('./server');
  walk('./public');

  assert.deepEqual(treffer, [],
    `Diese Dateien tragen wieder eine eigene 5-MB-Grenze statt der gemeinsamen: ${treffer.join(', ')}`);
});

test('keine Server-Meldung nennt eine feste Megabyte-Zahl', () => {




  // sieht eine ausgeschriebene Zahl nie.
  const ERLAUBT = new Set([
    'server/routes/backup.js',      // eigene Grenze fuer die Wiederherstellung, nennt RESTORE_LIMIT
    'server/utils/upload-limit.js',
  ]);
  const treffer = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(path); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const rel = path.replace(/^\.\//, '');
      if (ERLAUBT.has(rel)) continue;
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue;
        if (/\b(max|maximum|hoechstens|höchstens)\b[^\n]{0,20}\b\d+\s*MB/i.test(line)) treffer.push(`${rel}: ${line.trim()}`);
      }
    }
  };
  walk('./server');

  assert.deepEqual(treffer, [],
    `Diese Meldungen nennen eine Groesse, die nicht aus MAX_UPLOAD_MB kommt:\n${treffer.join('\n')}`);
});

test('die Texte nennen keine feste Zahl mehr', () => {
  const KEYS = ['attachmentTooLarge', 'fileHint', 'fileTooLarge'];
  const fehler = [];
  for (const file of readdirSync('./public/locales').filter((f) => f.endsWith('.json'))) {
    for (const line of readFileSync(`./public/locales/${file}`, 'utf8').split('\n')) {
      const m = line.match(/^\s*"([A-Za-z]+)":\s*"(.*)",?$/);
      if (m && KEYS.includes(m[1]) && !m[2].includes('{{size}}')) fehler.push(`${file}:${m[1]}`);
    }
  }
  assert.deepEqual(fehler, [],
    `Diese Texte behaupten eine Größe, die der Server gar nicht mehr führt: ${fehler.join(', ')}`);
});
