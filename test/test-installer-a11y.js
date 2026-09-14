import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

import { SUPPORTED_LOCALES } from '../tools/installer/i18n-mini.js';

const HTML_PATH = new URL('../tools/installer/install.html', import.meta.url);
const LOCALES_DIR = new URL('../tools/installer/locales/', import.meta.url);
const html = readFileSync(HTML_PATH, 'utf8');

function loadLocale(locale) {
  return JSON.parse(readFileSync(new URL(`${locale}.json`, LOCALES_DIR), 'utf8'));
}

// ── 1.2 Accordion-Trigger sind tastaturbedienbare Buttons ─────────────────────

test('kein toggle-header ist mehr ein <div> (alle sind <button>)', () => {
  assert.doesNotMatch(html, /<div[^>]*class="toggle-head"/,
    'toggle-head darf kein <div> mehr sein');
});

test('jeder data-toggle-Trigger ist ein <button> mit type, aria-expanded und aria-controls', () => {
  const allToggles = [...html.matchAll(/\bdata-toggle="([^"]+)"/g)].map(m => m[1]);
  assert.ok(allToggles.length >= 4, 'erwartet mindestens vier Accordion-Trigger');

  const buttonToggles = [...html.matchAll(/<button[^>]*\bdata-toggle="([^"]+)"[^>]*>/g)];
  assert.equal(buttonToggles.length, allToggles.length,
    'jeder data-toggle muss auf einem <button> sitzen');

  for (const m of buttonToggles) {
    const tag = m[0];
    const target = m[1];
    assert.match(tag, /type="button"/, `Trigger für ${target} braucht type="button"`);
    assert.match(tag, /aria-expanded="false"/, `Trigger für ${target} braucht aria-expanded`);
    assert.match(tag, new RegExp(`aria-controls="${target}"`),
      `Trigger für ${target} braucht aria-controls="${target}"`);
  }
});

test('der Toggle-Handler aktualisiert aria-expanded', () => {
  assert.match(html, /setAttribute\(\s*'aria-expanded'/,
    'Klick-Handler muss aria-expanded synchron halten');
});

// ── 1.3 ARIA-Live-Regionen ────────────────────────────────────────────────────

test('jedes error-banner trägt role="alert"', () => {
  const banners = [...html.matchAll(/<div[^>]*class="error-banner"[^>]*>/g)];
  assert.ok(banners.length >= 6, 'erwartet mindestens sechs Fehler-Banner');
  for (const m of banners) {
    assert.match(m[0], /role="alert"/, `Fehler-Banner ohne role="alert": ${m[0]}`);
  }
});

test('die Docker-Statuszeile ist eine Live-Region', () => {
  const row = html.match(/<div[^>]*class="status-row"[^>]*>/);
  assert.ok(row, 'status-row nicht gefunden');
  assert.match(row[0], /role="status"/, 'status-row braucht role="status"');
  assert.match(row[0], /aria-live="polite"/, 'status-row braucht aria-live="polite"');
});

test('der Spinner ist für Screenreader ausgeblendet', () => {
  const spinner = html.match(/<div[^>]*class="spinner"[^>]*>/);
  assert.ok(spinner, 'spinner nicht gefunden');
  assert.match(spinner[0], /aria-hidden="true"/, 'Spinner braucht aria-hidden="true"');
});

// ── 1.4 Fokus-Management bei Schrittwechsel ───────────────────────────────────

test('jede Schritt-Überschrift ist per Skript fokussierbar (tabindex="-1")', () => {


  const headings = [...html.matchAll(/<h[12][^>]*>/g)].filter(m => !/class="vh"/.test(m[0]));
  assert.ok(headings.length > 0, 'keine Schritt-Überschriften gefunden');
  for (const m of headings) {
    assert.match(m[0], /tabindex="-1"/, `Schritt-Überschrift ohne tabindex="-1": ${m[0]}`);
  }
});

test('genau eine <h1> (persistenter Seitentitel) plus <main>-Landmark', () => {
  const h1s = [...html.matchAll(/<h1[^>]*>/g)];
  assert.equal(h1s.length, 1, `genau eine <h1> erwartet, gefunden: ${h1s.length}`);
  assert.match(h1s[0][0], /class="vh"/, 'die einzige <h1> ist der versteckte Seitentitel');
  assert.match(html, /<main\b/, 'die Karte braucht einen <main>-Landmark');
});

test('showStep setzt den Fokus auf die aktive Überschrift', () => {
  assert.match(html, /\.focus\(\s*\{\s*preventScroll:\s*true\s*\}\s*\)/,
    'showStep muss den Fokus (ohne Scroll-Sprung) auf die Überschrift setzen');
});



test('jeder Augen-Button hat aria-label und data-i18n-aria', () => {
  const eyeButtons = [...html.matchAll(/<button[^>]*\bdata-eye="[^"]+"[^>]*>/g)];
  assert.ok(eyeButtons.length >= 3, 'erwartet mindestens drei Augen-Buttons');
  for (const m of eyeButtons) {
    assert.match(m[0], /aria-label="/, `Augen-Button ohne aria-label: ${m[0]}`);
    assert.match(m[0], /data-i18n-aria="/, `Augen-Button ohne data-i18n-aria: ${m[0]}`);
  }
});



test('kein veraltetes class="error" mehr (vereinheitlicht auf error-banner)', () => {
  assert.doesNotMatch(html, /class="error"/, 'class="error" existiert nicht im CSS');
});

test('cfg-err ist ein error-banner', () => {
  assert.match(html, /<div[^>]*id="cfg-err"[^>]*class="error-banner"|<div[^>]*class="error-banner"[^>]*id="cfg-err"/,
    'cfg-err muss ein error-banner sein');
});



test('keine hartcodierten "Step N of 7"-Zähler im Markup', () => {
  assert.doesNotMatch(html, /Step .* of 7/, 'hartcodierter "of 7"-Zähler gefunden');
});

test('Schrittzähler wird im Skript aus den Schritten berechnet', () => {
  assert.match(html, /common\.stepCounter/, 'stepCounter-Schlüssel wird nicht verwendet');
});

test('common.stepCounter existiert in jeder Locale mit {{n}}/{{total}}', () => {
  for (const locale of SUPPORTED_LOCALES) {
    const data = loadLocale(locale);
    const tpl = data.common && data.common.stepCounter;
    assert.ok(tpl, `${locale}.json fehlt common.stepCounter`);
    assert.match(tpl, /\{\{n\}\}/, `${locale}: stepCounter ohne {{n}}`);
    assert.match(tpl, /\{\{total\}\}/, `${locale}: stepCounter ohne {{total}}`);
  }
});

test('die nummerierten *.tag-Schlüssel sind entfernt, advanced.tag bleibt', () => {
  for (const locale of SUPPORTED_LOCALES) {
    const data = loadLocale(locale);
    for (const step of ['config', 'secrets', 'weather', 'calendar', 'review', 'docker', 'admin']) {
      assert.equal(data[step]?.tag, undefined, `${locale}: ${step}.tag sollte entfernt sein`);
    }
    assert.ok(data.advanced?.tag, `${locale}: advanced.tag muss erhalten bleiben`);
  }
});


//





//






const MOBILE_VIEWPORT = 390;

function stylesheet(source) {
  return [...source.matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map(m => m[1]).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function collectRules(css) {
  const out = [];
  const walk = (text, media) => {
    let idx = 0;
    while (idx < text.length) {
      const brace = text.indexOf('{', idx);
      if (brace === -1) break;
      const prelude = text.slice(idx, brace).trim();
      let depth = 1;
      let end = brace + 1;
      while (end < text.length && depth > 0) {
        if (text[end] === '{') depth++;
        else if (text[end] === '}') depth--;
        end++;
      }
      const body = text.slice(brace + 1, end - 1);
      if (prelude.startsWith('@')) {

        if (/^@media/i.test(prelude)) walk(body, prelude);
      } else {
        for (const sel of prelude.split(',')) out.push({ selector: sel.trim(), body, media });
      }
      idx = end;
    }
  };
  walk(css, null);
  return out;
}

const RULES = collectRules(stylesheet(html));

function declared(selectorMatches, prop, mediaMatches = media => media === null) {
  let value = null;
  for (const rule of RULES) {
    if (!mediaMatches(rule.media)) continue;
    if (!selectorMatches(rule.selector)) continue;
    const found = rule.body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i'));
    if (found) value = found[1].trim();
  }
  return value;
}

function appliesAt(width) {
  return media => {
    if (media === null) return true;
    const max = media.match(/max-width:\s*(\d+)px/i);
    if (max) return width <= Number(max[1]);

    // Breitenrechnung kein Faktor und bleibt bewusst draussen.
    return false;
  };
}

const ROOT_VARS = (() => {
  const map = new Map();
  for (const rule of RULES) {
    if (rule.selector !== ':root' || rule.media !== null) continue;
    for (const [, name, value] of rule.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) {
      map.set(name, value.trim());
    }
  }
  return map;
})();

function toPx(value, base = null) {
  if (value == null) return null;
  let raw = value.trim();
  const variable = raw.match(/^var\(\s*(--[\w-]+)/);
  if (variable) raw = ROOT_VARS.get(variable[1]) ?? raw;
  const rem = raw.match(/^(-?[\d.]+)rem/);
  if (rem) return Number(rem[1]) * 16;
  const px = raw.match(/^(-?[\d.]+)px/);
  if (px) return Number(px[1]);
  const pct = raw.match(/^(-?[\d.]+)%/);
  if (pct && base !== null) return (Number(pct[1]) / 100) * base;
  return null;
}

function paddingX(shorthand) {
  const parts = shorthand.trim().split(/\s+/);
  const right = parts.length === 1 ? parts[0] : parts[1];
  const left = parts.length >= 4 ? parts[3] : right;
  return { left: toPx(left) ?? 0, right: toPx(right) ?? 0 };
}

function cardContentWidth(viewport) {
  const media = appliesAt(viewport);
  const body = paddingX(declared(sel => sel === 'body', 'padding', media));
  const cardMax = toPx(declared(sel => sel === '.card', 'max-width', media));
  const cardBody = paddingX(declared(sel => sel === '.card-body', 'padding', media));
  const cardWidth = Math.min(cardMax, viewport - body.left - body.right);
  return cardWidth - cardBody.left - cardBody.right;
}

/** flex-Shorthand in { grow, shrink, basis } zerlegen. */
function flexParts(shorthand) {
  const parts = shorthand.trim().split(/\s+/);
  if (parts.length === 1) {

    return /^[\d.]+$/.test(parts[0])
      ? { grow: Number(parts[0]), shrink: 1, basis: '0%' }
      : { grow: 1, shrink: 1, basis: parts[0] };
  }
  if (parts.length === 2) return { grow: Number(parts[0]), shrink: Number(parts[1]), basis: '0%' };
  return { grow: Number(parts[0]), shrink: Number(parts[1]), basis: parts[2] };
}

function secretFieldWidth(viewport) {
  const media = appliesAt(viewport);
  const available = cardContentWidth(viewport);
  const gap = toPx(declared(sel => sel === '.secret-row', 'gap', media)) ?? 0;
  const wraps = (declared(sel => sel === '.secret-row', 'flex-wrap', media) || 'nowrap') === 'wrap';

  const flex = flexParts(declared(sel => sel === '.secret-row input', 'flex', media) || '0 1 auto');
  const basis = toPx(flex.basis, available) ?? 0;
  const minWidth = toPx(declared(sel => sel === '.secret-row input', 'min-width', media)) ?? 0;



  const rows = [...html.matchAll(/<div class="secret-row">([\s\S]*?)<\/div>\s*<\/div>/g)];
  const buttons = Math.max(...rows.map(m => (m[1].match(/<button/g) || []).length), 1);
  const buttonWidth = toPx(declared(sel => sel === '.btn-sm', 'min-width', media)) ?? 44;
  const buttonsBlock = buttons * buttonWidth + buttons * gap;



  if (wraps && basis + buttonsBlock > available) return available;
  return Math.max(minWidth, available - buttonsBlock);
}

test('das Secret-Feld bekommt auf dem Handy die volle Zeile, nicht den Rest', () => {
  const breite = secretFieldWidth(MOBILE_VIEWPORT);
  const voll = cardContentWidth(MOBILE_VIEWPORT);
  assert.ok(breite >= voll * 0.95,
    `#sec-db misst bei ${MOBILE_VIEWPORT}px nur ${breite.toFixed(0)}px von ${voll.toFixed(0)}px verfügbarer Breite. `
    + 'Ein 64-Zeichen-Schlüssel gehört auf eine eigene Zeile, die Buttons darunter.');
});

function reviewGridNeed(viewport, unbreakable) {
  const media = appliesAt(viewport);
  const columns = declared(sel => sel === '.review-grid', 'grid-template-columns', media) || '160px 1fr';
  const tracks = columns.match(/minmax\([^)]*\)|\S+/g) || [];
  const gapParts = (declared(sel => sel === '.review-grid', 'gap', media) || '0').trim().split(/\s+/);
  const gapX = toPx(gapParts[1] ?? gapParts[0]) ?? 0;

  const trackMin = track => {
    const m = track.match(/minmax\(\s*([^,]+),/);
    if (m) return toPx(m[1]) ?? 0;
    if (/fr$/.test(track)) return null;   // auto-Minimum: der Inhalt bestimmt
    return toPx(track) ?? 0;
  };
  const keyMin = trackMin(tracks[0] ?? '160px') ?? 0;

  const wrap = (declared(sel => sel === '.review-grid > :not(.review-key)', 'overflow-wrap', media) || 'normal').trim();

  const valueContentMin = wrap === 'anywhere' ? 0 : unbreakable;
  const valueTrackMin = trackMin(tracks[1] ?? '1fr');


  return keyMin + gapX + Math.max(valueTrackMin ?? valueContentMin, valueContentMin);
}

test('ein unzerbrechlicher Wert verbreitert die Pruefseite nicht (WCAG 1.4.10)', () => {
  const need = reviewGridNeed(MOBILE_VIEWPORT, 500);
  const available = cardContentWidth(MOBILE_VIEWPORT);
  assert.ok(need <= available,
    `Das Review-Grid braucht mit einem 500px-Wert ${need.toFixed(0)}px von ${available.toFixed(0)}px `
    + 'verfuegbarer Breite. Wertspalte minmax(0, ...) plus overflow-wrap: anywhere '
    + 'auf den Wertzellen halten lange URLs in der Karte.');
});

test('Redirect-URIs in Hints brechen um, statt an der Kartenkante zu clippen', () => {




  const rule = declared(sel => sel === '.hint code', 'word-break');
  const breaks = rule === 'break-all'
    || (declared(sel => sel === '.hint code', 'overflow-wrap') === 'anywhere');
  assert.ok(breaks,
    'Redirect-URIs (<code> in .hint) brauchen word-break: break-all oder '
    + 'overflow-wrap: anywhere - sonst clippt overflow:hidden der Toggle-Card sie mobil.');
});

test('das Secret-Feld ist mindestens 14px gross (12px war unlesbar)', () => {
  const size = toPx(declared(sel => sel === '.secret-row input', 'font-size'));
  assert.ok(size >= 14, `Secret-Felder stehen auf ${size}px, mindestens 14px sind nötig`);
});

test('Textfelder stehen auf mindestens 16px (sonst zoomt iOS Safari bei jedem Fokus)', () => {



  const size = toPx(declared(sel => /^input\[type=text\]/.test(sel), 'font-size'));
  assert.ok(size >= 16, `Textfelder stehen auf ${size}px, iOS zoomt unter 16px`);
});

test('Bedienelemente erfüllen die Zielgrössen (44px Höhe, 24px Kästchen)', () => {
  const media = appliesAt(MOBILE_VIEWPORT);
  const buttonHeight = toPx(declared(sel => sel === '.btn', 'min-height', media));
  assert.ok(buttonHeight >= 44, `.btn ist ${buttonHeight}px hoch, 44px sind das Touch-Minimum`);

  const selectHeight = toPx(declared(sel => /(^|,)\s*select$/.test(sel) || sel === 'select', 'min-height', media));
  assert.ok(selectHeight >= 44, `select ist ${selectHeight}px hoch, 44px sind das Touch-Minimum`);



  for (const prop of ['inline-size', 'block-size']) {
    const size = toPx(declared(sel => sel === 'input[type=checkbox]', prop));
    assert.ok(size >= 24, `Checkbox-${prop} ist ${size}px, WCAG 2.2 verlangt 24px`);
  }
});

const CONTROL_SELECTOR = /(?:^|[\s>+~])(?:button|select|textarea|input\b[^\s]*|a)$|\.(?:btn|btn-sm|toggle-head|link-btn|mode-card|open-link)\b[^\s]*$/;

test('keine Regel druckt ein Bedienelement unter 44px, ohne es wieder anzuheben', () => {
  const mobile = appliesAt(MOBILE_VIEWPORT);
  const offenders = [];

  RULES.forEach((rule, i) => {
    if (!mobile(rule.media)) return;
    if (!CONTROL_SELECTOR.test(rule.selector)) return;
    const found = rule.body.match(/(?:^|;)\s*min-height\s*:\s*([^;]+)/i);
    if (!found) return;
    const px = toPx(found[1].trim());
    if (!(px < 44)) return;



    const lifted = RULES.some((later, j) =>
      j > i && later.selector === rule.selector && mobile(later.media) &&
      toPx((later.body.match(/(?:^|;)\s*min-height\s*:\s*([^;]+)/i) || [])[1]?.trim()) >= 44);
    if (!lifted) offenders.push(`${rule.selector} = ${px}px`);
  });

  assert.deepEqual(offenders, [],
    `Bedienelemente unter der 44px-Zielgroesse, ohne spaetere Anhebung: ${offenders.join(', ')}`);
});

test('die Akkordeon-Koepfe sichern ihre Zielgroesse ausdruecklich', () => {
  const triggers = [...html.matchAll(/<button[^>]*\bdata-toggle="[^"]+"[^>]*>/g)];
  assert.ok(triggers.length >= 4, 'erwartet mindestens vier Akkordeon-Trigger');


  for (const m of triggers) {
    assert.match(m[0], /class="[^"]*\btoggle-head\b/,
      `Akkordeon-Trigger ohne .toggle-head-Klasse: ${m[0]}`);
  }
  const height = toPx(declared(sel => sel === '.toggle-head', 'min-height', appliesAt(MOBILE_VIEWPORT)));
  assert.ok(height >= 44,
    `.toggle-head sichert keine Zielgroesse (min-height ${height}px) - ${triggers.length} Koepfe stehen im Erweitert-Schritt untereinander`);
});


//



//





const tokensCss = readFileSync(new URL('../public/styles/tokens.css', import.meta.url), 'utf8');

function srgbToLinear(channel) {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? [...raw].map(c => c + c).join('') : raw.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/** Erster Hex-Wert von `name` ab Position `from`. */
function cssVar(css, name, from = 0) {
  const re = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`, 'g');
  re.lastIndex = from;
  const match = re.exec(css);
  assert.ok(match, `${name} nicht gefunden (ab Offset ${from})`);
  return match[1];
}

test('Platzhaltertext erfüllt AA auf dem Feldgrund, in beiden Themes', () => {

  assert.match(html, /input::placeholder/,
    'ohne eigene ::placeholder-Regel gilt Chromes
  assert.match(html, /::placeholder[\s\S]{0,200}?opacity:\s*1/,
    'Firefox setzt ::placeholder sonst auf opacity < 1 und senkt den Kontrast erneut');

  const htmlDark = html.indexOf('@media (prefers-color-scheme: dark)');
  const tokensDark = tokensCss.indexOf('@media (prefers-color-scheme: dark)');

  const paare = [
    ['Inline-Fallback hell', cssVar(html, '--color-text-placeholder'), cssVar(html, '--color-surface')],
    ['Inline-Fallback dunkel', cssVar(html, '--color-text-placeholder', htmlDark), cssVar(html, '--color-surface', htmlDark)],
    // tokens.css leitet --color-text-placeholder aus --color-text-tertiary ab.
    ['tokens.css hell', cssVar(tokensCss, '--_color-text-tertiary'), cssVar(tokensCss, '--_color-surface')],
    ['tokens.css dunkel', cssVar(tokensCss, '--_color-text-tertiary', tokensDark), cssVar(tokensCss, '--_color-surface', tokensDark)],
  ];

  for (const [label, fg, bg] of paare) {
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio >= 4.5,
      `${label}: Platzhalter ${fg} auf ${bg} erreicht nur ${ratio.toFixed(2)}:1, WCAG 1.4.3 verlangt 4.5:1`);
  }
});

test('Primäraktionen des Installers erfüllen AA auf Akzentgrund, in beiden Themes', () => {

  const htmlDark = html.indexOf('@media (prefers-color-scheme: dark)');
  assert.ok(htmlDark > 0, 'Dark-Block im Inline-Fallback nicht gefunden');


  const tokensDark = tokensCss.indexOf('@media (prefers-color-scheme: dark)');
  assert.ok(tokensDark > 0, 'Dark-Block in tokens.css nicht gefunden');

  const paare = [
    ['Inline-Fallback, Light', cssVar(html, '--color-ink-on-vivid'), cssVar(html, '--color-accent')],
    ['Inline-Fallback, Dark', cssVar(html, '--color-ink-on-vivid', htmlDark), cssVar(html, '--color-accent', htmlDark)],
    ['tokens.css, Light', cssVar(tokensCss, '--_color-ink-on-vivid'), cssVar(tokensCss, '--_color-accent')],
    ['tokens.css, Dark', cssVar(tokensCss, '--_color-ink-on-vivid', tokensDark), cssVar(tokensCss, '--_color-accent', tokensDark)],
  ];

  for (const [quelle, ink, accent] of paare) {
    const ratio = contrastRatio(ink, accent);
    assert.ok(ratio >= 4.5,
      `${quelle}: ${ink} auf ${accent} ergibt ${ratio.toFixed(2)}:1, AA verlangt 4.5:1`);
  }
});

test('der Installer nutzt kein




  assert.doesNotMatch(html, /var\(--color-text-on-accent/,
    'auf Akzentflächen gehört --color-ink-on-vivid, nicht --color-text-on-accent');
});

test('der Inline-Fallback stimmt Wert fuer Wert mit tokens.css ueberein', () => {
  const darkHtml = html.indexOf('@media (prefers-color-scheme: dark)');
  const darkTokens = tokensCss.indexOf('@media (prefers-color-scheme: dark)');
  assert.ok(darkHtml > 0 && darkTokens > 0, 'Dark-Block nicht gefunden');


  const fallbackVars = (from, to) => {
    const map = new Map();

    // Typo-Stufen), driften sonst stumm. Gemessen 2026-08-31: der Dark-



    // tokens.css als privates --_-Token fuehrt.
    for (const [, name, value] of html.slice(from, to).matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|[\d.][^;]*)/g)) {
      map.set(name, value.replace(/\s+/g, ' ').trim().toLowerCase());
    }
    return map;
  };
  const light = fallbackVars(0, darkHtml);
  const dark = fallbackVars(darkHtml, html.indexOf('</style>', darkHtml));

  const drift = [];
  for (const [theme, vars, tokensFrom] of [['light', light, 0], ['dark', dark, darkTokens]]) {
    for (const [name, value] of vars) {

      const privateName = name.replace(/^--/, '--_');
      const re = new RegExp(`${privateName}:\\s*([^;]+);`, 'g');
      re.lastIndex = tokensFrom;
      const hit = re.exec(tokensCss);
      if (!hit) continue;
      const tokensValue = hit[1].replace(/\s+/g, ' ').trim().toLowerCase();
      if (tokensValue !== value) {
        drift.push(`${theme}: ${name} = ${value}, tokens.css = ${tokensValue}`);
      }
    }
  }
  assert.deepEqual(drift, [],
    `Fallback-Tokens weichen von tokens.css ab (der Fallback greift nur, wenn tokens.css fehlt - dort waere die Abweichung dann sichtbar): ${drift.join(' | ')}`);
});

test('kein Wizard-Schritt sammelt wieder alle Entscheidungen auf einem Bildschirm', () => {
  const steps = [...html.matchAll(/<div class="step" id="step-([a-z-]+)">/g)].map(m => m[1]);
  assert.ok(steps.length >= 10, `nur ${steps.length} Schritte gefunden - der Scanner greift nicht`);

  /** Bereiche aller toggle-body-Blocks (Start/Ende) per div-Klammerzaehlung. */
  const hiddenRanges = (seg) => {
    const out = [];
    let at = 0;
    while ((at = seg.indexOf('<div class="toggle-body"', at)) !== -1) {
      let depth = 0, close = -1;
      for (let k = at; k < seg.length; k++) {
        if (seg.startsWith('<div', k)) depth++;
        else if (seg.startsWith('</div>', k)) {
          depth--;
          if (depth === 0) { close = k; break; }
        }
      }
      if (close === -1) break;
      out.push([at, close]);
      at = close;
    }
    return out;
  };

  const LIMIT = 10;
  const oversized = [];

  for (const name of steps) {
    const from = html.indexOf(`<div class="step" id="step-${name}">`);
    const nextStep = html.indexOf('<div class="step" id="step-', from + 10);
    const seg = html.slice(from, nextStep === -1 ? html.indexOf('</main>') : nextStep);

    const hidden = hiddenRanges(seg);
    const isHidden = (i) => hidden.some(([a, b]) => i > a && i < b);

    const heads = (seg.match(/data-toggle="/g) || []).length;
    let fields = 0;
    for (const m of seg.matchAll(/<(?:input|select|textarea)\b/g)) {
      if (!isHidden(m.index)) fields++;
    }

    const points = heads + fields;
    if (points > LIMIT) oversized.push(`step-${name}: ${points} (${heads} Akkordeons + ${fields} Felder)`);
  }

  assert.deepEqual(oversized, [],
    `Diese Schritte stellen beim Betreten mehr als ${LIMIT} Entscheidungen auf einmal: ${oversized.join(', ')}. `
    + 'Entweder hinter Akkordeons legen oder entlang einer Frage in zwei Schritte teilen.');
});
