
import { chromium } from '/opt/homebrew/lib/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DOCS = resolve(ROOT, 'docs');
const SHOTS = resolve(DOCS, 'screenshots');



//








//



const WIDTHS = {
  web:           { '2x': 1400, '1x': 700 },
  'mobile-lead': { '2x': 1020, '1x': 510 },  // 340px Slot x DPR3
  mobile:        { '2x': 480,  '1x': 240 },  // 176px Slot, mit Reserve
};
const QUALITY = 0.82;

const SHOT_ATTR = /(?:src|data-light|data-dark|data-light-m|data-dark-m)="screenshots\/([^"]+\.png)"/g;
const IS_MOBILE = /-mobile(?=[.@]|$)/;

function referencedShots() {
  const shots = new Map();
  for (const file of readdirSync(DOCS).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(resolve(DOCS, file), 'utf8');
    for (const tag of html.matchAll(/<img\b[^>]*>/g)) {
      const lead = /data-shot-profile="lead"/.test(tag[0]);
      for (const m of tag[0].matchAll(SHOT_ATTR)) {
        const name = m[1];
        const profile = !IS_MOBILE.test(name.replace(/\.png$/, '')) ? 'web'
          : lead ? 'mobile-lead' : 'mobile';


        const seen = shots.get(name);
        if (!seen || WIDTHS[profile]['2x'] > WIDTHS[seen]['2x']) shots.set(name, profile);
      }
    }
  }
  return shots;
}

function shotsWithExistingWebp(dir) {
  const names = new Set();
  if (!existsSync(dir)) return names;
  for (const f of readdirSync(dir)) {
    const m = f.match(/^(.+?)(?:@1x)?\.webp$/);
    if (m) names.add(`${m[1]}.png`);
  }
  return names;
}

const LOCALE_DIR = /^[a-z]{2}(-[a-z]{2})?$/;
function localeDirs() {
  const dirs = [SHOTS];
  for (const entry of readdirSync(SHOTS, { withFileTypes: true })) {
    if (!entry.isDirectory() || !LOCALE_DIR.test(entry.name)) continue;
    dirs.push(resolve(SHOTS, entry.name));
  }
  return dirs;
}

async function convert(page, pngPath, outPath, width) {
  const base64 = readFileSync(pngPath).toString('base64');
  const dataUrl = await page.evaluate(async ({ b64, w, q }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = Math.round((img.naturalHeight / img.naturalWidth) * w);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', q);
  }, { b64: base64, w: width, q: QUALITY });

  if (!dataUrl.startsWith('data:image/webp')) {
    throw new Error(`Chromium returned no WebP for ${pngPath}`);
  }
  writeFileSync(outPath, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8"><title>webp</title>');

  const filters = process.argv.slice(2);
  const wantedByFilter = (name) => !filters.length || filters.some((f) => name.includes(f));
  if (filters.length) console.log(`Filter: ${filters.join(', ')}`);

  let written = 0;
  let skipped = 0;
  let filtered = 0;

  try {
    for (const dir of localeDirs()) {
      const label = dir === SHOTS ? 'en' : dir.slice(SHOTS.length + 1);


      // Aenderung ohnehin im kleinen Profil.
      const wanted = new Map(referencedShots());
      for (const name of shotsWithExistingWebp(dir)) {
        if (!wanted.has(name)) {
          wanted.set(name, IS_MOBILE.test(name.replace(/\.png$/, '')) ? 'mobile' : 'web');
        }
      }
      console.log(`\n── ${label} (${wanted.size} shots) ──`);

      for (const [name, profile] of [...wanted].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (!wantedByFilter(name)) { filtered++; continue; }
        const png = resolve(dir, name);
        if (!existsSync(png)) {
          console.log(`  – ${name} (no PNG in this locale)`);
          skipped++;
          continue;
        }
        const stem = name.replace(/\.png$/, '');
        await convert(page, png, resolve(dir, `${stem}.webp`), WIDTHS[profile]['2x']);
        await convert(page, png, resolve(dir, `${stem}@1x.webp`), WIDTHS[profile]['1x']);
        written += 2;
        console.log(`  ✓ ${stem}.webp + @1x.webp  (${profile}: ${WIDTHS[profile]['2x']}/${WIDTHS[profile]['1x']}px)`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\nDone. ${written} WebP files written, ${skipped} shot(s) skipped`
    + (filtered ? `, ${filtered} filtered out.` : '.'));
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
