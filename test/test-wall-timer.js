
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';



// Aufruf darauf zu.
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const {
  readWallTimer, startWallTimer, clearWallTimer, formatWallTimer,
  renderWallTimer, WALL_TIMER_PRESETS,
} = await import('../public/components/wall-timer.js');

const SOURCE = readFileSync(new URL('../public/components/wall-timer.js', import.meta.url), 'utf8');
const WALL_MODE = readFileSync(new URL('../public/utils/wall-mode.js', import.meta.url), 'utf8');

test.beforeEach(() => store.clear());

// --------------------------------------------------------

// --------------------------------------------------------

test('ohne Eintrag laeuft keiner', () => {
  assert.equal(readWallTimer().state, 'idle');
});

test('ein Zeitpunkt in der Zukunft laeuft, einer in der Vergangenheit ist fertig', () => {
  const now = 1_700_000_000_000;
  startWallTimer(5, now);
  assert.equal(readWallTimer(now).state, 'running');
  assert.equal(readWallTimer(now + 4 * 60_000).state, 'running', 'eine Minute vor Schluss laeuft er noch');
  assert.equal(readWallTimer(now + 5 * 60_000).state, 'done', 'auf die Sekunde genau ist er fertig');
  assert.equal(readWallTimer(now + 60 * 60_000).state, 'done', 'und bleibt es, bis jemand quittiert');
});

test('Abbrechen und Quittieren gehen denselben Weg', () => {
  startWallTimer(5);
  clearWallTimer();
  assert.equal(readWallTimer().state, 'idle');
});

test('ein unlesbarer Eintrag ist kein Timer, kein NaN in der Anzeige', () => {


  global.localStorage.setItem('aashiyana-wall-timer', 'gestern');
  assert.equal(readWallTimer().state, 'idle');
});

test('der laufende Timer ueberlebt einen Neuaufbau der Flaeche', () => {



  const now = 1_700_000_000_000;
  startWallTimer(10, now);
  const ersteAnzeige = renderWallTimer(readWallTimer(now)).display;
  const zweiteAnzeige = renderWallTimer(readWallTimer(now + 1000)).display;
  assert.match(ersteAnzeige, /10:00/, 'frisch gestartet');
  assert.match(zweiteAnzeige, /09:59/, 'eine Sekunde spaeter, ohne dass etwas im DOM ueberlebt haette');
});

test('mm:ss rundet auf: ein angebrochener Rest ist fuer den Lesenden noch da', () => {
  assert.equal(formatWallTimer(0), '00:00');
  assert.equal(formatWallTimer(400), '00:01', 'vier Zehntel sind noch eine Sekunde');
  assert.equal(formatWallTimer(59_000), '00:59');
  assert.equal(formatWallTimer(60_000), '01:00');
  assert.equal(formatWallTimer(30 * 60_000), '30:00', 'die laengste Voreinstellung bleibt zweistellig');
  assert.equal(formatWallTimer(-5000), '00:00', 'ein negativer Rest ist keine negative Zeit');
});

// --------------------------------------------------------

// --------------------------------------------------------

test('(a) der Timer navigiert nicht - kein Link, keine Route, kein Modal', () => {
  const now = 1_700_000_000_000;
  const stuecke = [
    renderWallTimer({ state: 'idle', remainingMs: 0 }),
    (startWallTimer(5, now), renderWallTimer(readWallTimer(now))),
    renderWallTimer({ state: 'done', remainingMs: 0 }),
  ];

  // fehlerfrei "keine Verstoesse".
  const markup = stuecke.map((s) => s.display + s.controls);
  assert.equal(markup.filter((m) => m.trim().length > 0).length, 3, 'drei Zustaende haben Markup');
  for (const m of markup) {
    assert.ok(!/<a\b|href=|data-route=|data-modal|openModal/.test(m),
      `ein Zustand des Timers fuehrt von der Wand weg: ${m.slice(0, 120)}`);
  }
});

test('(b) er aendert nichts am Haushalt - das Modul kennt die API gar nicht', () => {
  assert.ok(!/from '.*\/api\.js'|api\.(get|post|put|patch|delete)\(|fetch\(/.test(SOURCE),
    'ein Server-Aufruf im Timer waere ein Zustand, der auf einem zweiten Geraet ankommt');
});

test('(c) er bleibt auf diesem Geraet - localStorage, wie der Modus selbst', () => {
  assert.match(SOURCE, /localStorage/, 'der Zustand liegt geraetelokal');

  // Einstellung startete allen Familienmitgliedern den Timer.
  assert.ok(!/sessionStorage|document\.cookie/.test(SOURCE), 'und nirgends sonst');
});

test('(d) er ist aus zwei Metern bedienbar - wenige grosse Ziele, kein Eingabefeld', () => {
  const { controls } = renderWallTimer({ state: 'idle', remainingMs: 0 });
  const knoepfe = controls.match(/<button/g) ?? [];
  assert.equal(knoepfe.length, WALL_TIMER_PRESETS.length, 'ein Knopf je Voreinstellung');
  assert.ok(WALL_TIMER_PRESETS.length <= 6, 'mehr als eine Handvoll trifft aus zwei Metern niemand');
  assert.ok(!/<input|<select|contenteditable/.test(controls),
    'ein Tastenfeld ist aus zwei Metern nicht bedienbar');

  assert.ok(!/<details|aria-expanded|data-popover/.test(controls),
    'ein Menue waere ein zweiter Tipp - und sein offener Zustand ueberlebte den stillen Refresh nicht');
});

test('die Aufnahmeregel steht dort, wo die anderen Entscheidungen des Modus stehen', () => {

  // Wunsch wieder eine Einzelfallentscheidung.
  assert.match(WALL_MODE, /AUFNAHMEREGEL/, 'die Regel steht im Kopf von wall-mode.js');
  assert.match(WALL_MODE, /#844/, 'und nennt den Fall, der sie ausgeloest hat');
});

// --------------------------------------------------------

// --------------------------------------------------------

test('der Screensaver liest dasselbe Attribut, das der Timer setzt', () => {
  const screensaver = readFileSync(new URL('../public/components/photo-screensaver.js', import.meta.url), 'utf8');



  assert.match(SOURCE, /data-wall-timer/, 'der Timer setzt das Attribut');
  assert.match(screensaver, /data-wall-timer/, 'der Screensaver liest es');





  const zweig = screensaver.slice(screensaver.indexOf("hasAttribute('data-wall-timer')"));
  const block = zweig.slice(0, zweig.indexOf('\n  }') + 4);
  assert.match(block, /return false/, 'solange das Attribut steht, startet er nicht');
  assert.ok(!/overlay\s*=|appendChild/.test(block), 'und baut auch kein Overlay');





  assert.match(block, /idleTimer\s*=\s*setTimeout\(\s*start/,
    'der Attribut-Zweig plant einen neuen Versuch, statt den letzten zu verbrauchen');
});

// --------------------------------------------------------

// --------------------------------------------------------

test('der Audiokontext lebt ausserhalb des Renders - sonst klingelt es nie', () => {




  //

  // Funktion steht eingerueckt.
  assert.match(SOURCE, /^let audioCtx = null;$/m,
    'audioCtx wird auf Modulebene gehalten, nicht je Render');
  assert.ok(!/^\s+let audio(Ctx)? =/m.test(SOURCE),
    'keine zweite, render-lokale Fassung daneben');
  assert.match(SOURCE, /chime\(audioCtx\)/, 'und genau der wird beim Ablauf gelaeutet');
});

test('das Attribut wird auch beim Verlassen der Wand zurueckgenommen', () => {




  const at = SOURCE.indexOf("signal.addEventListener('abort'");
  assert.ok(at > 0, 'Reichweite: der Abbruch-Pfad wurde gefunden');
  const abort = SOURCE.slice(at, at + 260);
  assert.match(abort, /setRunningAttr\(false\)/,
    'der Abbruch raeumt das Attribut, nicht nur den Takt');

  assert.match(abort, /stopTick\(\)|clearInterval/, 'und den Takt weiterhin auch');
});

test('ein Aufruf raeumt den vorigen Takt ab - sonst laeuten zwei (Review zu #844)', () => {



  // neu zeichnen.
  assert.match(SOURCE, /^let tick = null;$/m, 'der Takt liegt auf Modulebene');
  const at = SOURCE.indexOf('export function wireWallTimer');
  const kopf = SOURCE.slice(at, at + 400);
  assert.match(kopf, /stopTick\(\)/, 'und wird zu Beginn jedes Aufrufs abgeraeumt');


  assert.ok(kopf.indexOf('stopTick()') < kopf.indexOf('if (!wall) return'),
    'auch dann, wenn diesmal gar keine Flaeche da ist');
});

test('der Timer wird verdrahtet, bevor auf die Dashboard-Daten gewartet wird', () => {
  const dash = readFileSync(new URL('../public/pages/dashboard.js', import.meta.url), 'utf8');



  // Screensaver duerfte sich darueberlegen.




  const renderAt = dash.indexOf('export async function render(');
  assert.ok(renderAt > 0, 'Reichweite: render() gefunden');
  const bisAwait = dash.slice(renderAt, dash.indexOf('await ', renderAt));
  assert.ok(bisAwait.length > 0 && bisAwait.length < dash.length, 'Reichweite: das erste await liegt in render()');
  assert.match(bisAwait, /wireWallTimer\(/,
    'die Wandflaeche bekommt ihren Takt, sobald sie im DOM steht - nicht erst, wenn die Daten da sind');
});

test('auch der Ausstieg wird verdrahtet, bevor auf die Daten gewartet wird', () => {
  const dash = readFileSync(new URL('../public/pages/dashboard.js', import.meta.url), 'utf8');



  const renderAt = dash.indexOf('export async function render(');
  const bisAwait = dash.slice(renderAt, dash.indexOf('await ', renderAt));
  assert.match(bisAwait, /wireWallExit\(/, 'der Ausstieg haengt nicht am Datenladen');



  // Rendern wieder tot.
  const at = dash.indexOf('function wireWallExit');
  const fn = dash.slice(at, dash.indexOf('\n}', at));
  assert.match(fn, /container\.addEventListener\(\s*'click'/,
    'delegiert am Container, damit die eine Verdrahtung beide Renders ueberlebt');
  assert.ok(!/container\.querySelector\('#wall-exit'\)\?\.addEventListener/.test(fn),
    'nicht am Knopf selbst');
});
