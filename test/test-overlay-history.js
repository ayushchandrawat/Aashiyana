import { test } from 'node:test';
import assert from 'node:assert/strict';

// --------------------------------------------------------
// History-Attrappe
// --------------------------------------------------------

function makeHistory() {
  const entries = [{ state: { path: '/dashboard' }, href: '/dashboard' }];
  let index = 0;

  const navigations = [];
  let onPop = null;

  const emit = () => onPop?.(entries[index].state);

  return {
    get state() { return entries[index].state; },
    get depth() { return index; },
    get href() { return entries[index].href; },
    get forwardLength() { return entries.length - 1 - index; },
    pushState(state, _title, href) {
      entries.splice(index + 1);
      entries.push({ state, href: href ?? entries[index].href });
      index = entries.length - 1;
    },
    replaceState(state, _title, href) {
      entries[index] = { state, href: href ?? entries[index].href };
    },
    back() {


      queueMicrotask(() => {
        if (index === 0) return;
        index -= 1;
        emit();
      });
    },
    forward() {
      queueMicrotask(() => {
        if (index >= entries.length - 1) return;
        index += 1;
        emit();
      });
    },
    setPopHandler(fn) { onPop = fn; },
    navigations,
  };
}

let instanceSeq = 0;
let observers = [];

async function freshModule() {
  const history = makeHistory();
  observers = [];
  globalThis.history = history;
  globalThis.location = { get href() { return history.href; } };
  globalThis.document = {};
  globalThis.MutationObserver = class {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  const mod = await import(`../public/utils/overlay-history.js?instance=${++instanceSeq}`);
  history.setPopHandler(async (state) => {
    const handled = await mod.handleBackNavigation();
    if (!handled) history.navigations.push(state?.path ?? null);
  });
  return { ...mod, history };
}



const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// --------------------------------------------------------
// Der gemeldete Fall
// --------------------------------------------------------

test('die Zurueck-Geste schliesst den Dialog, statt die Seite zu wechseln', async () => {
  const { pushOverlay, history } = await freshModule();

  let closed = 0;
  pushOverlay(() => { closed += 1; });
  await settle();
  assert.equal(history.depth, 1, 'der offene Dialog haelt einen History-Eintrag');

  history.back();
  await settle();

  assert.equal(closed, 1, 'der Dialog wurde geschlossen');
  assert.deepEqual(history.navigations, [],
    'der Router hat NICHT navigiert - genau das war der gemeldete Fehler (#871)');
  assert.equal(history.depth, 0, 'der Marker ist verbraucht');
});

test('eine zweite Zurueck-Geste wechselt dann die Seite', async () => {
  const { pushOverlay, history } = await freshModule();



  history.pushState({ path: '/calendar' });
  pushOverlay(() => {});
  await settle();

  history.back();
  await settle();
  assert.deepEqual(history.navigations, [], 'die erste Geste gehoert dem Dialog');

  history.back();
  await settle();
  assert.deepEqual(history.navigations, ['/dashboard'],
    'ohne offenen Dialog gehoert die Geste wieder dem Router');
});

// --------------------------------------------------------

// --------------------------------------------------------

test('zwei gleichzeitig offene Overlays halten EINEN Eintrag, nicht zwei', async () => {
  const { pushOverlay, history } = await freshModule();
  pushOverlay(() => {});
  pushOverlay(() => {});
  await settle();
  assert.equal(history.depth, 1,
    'ein Marker je Overlay hiesse: jedes verschachtelte Overlay kostet spaeter eine '
    + 'eigene Zurueck-Geste, auch wenn es laengst zu ist');
});

test('zwei Overlays, die im selben Tick schliessen, lassen keinen Eintrag liegen', async () => {

  // zu entscheiden, ob sie „obenauf" liegt. `history.back()` wirkt aber erst


  const { pushOverlay, dropOverlay, history } = await freshModule();

  const outer = pushOverlay(() => {});
  const inner = pushOverlay(() => {});
  await settle();

  dropOverlay(inner);
  dropOverlay(outer);
  await settle();

  assert.equal(history.depth, 0, 'kein toter Eintrag - genau hier lag der Fehler');
  assert.deepEqual(history.navigations, [], 'unser eigenes back() ist keine Nutzergeste');
});

test('ein Overlay, das ein anderes mitreisst, laesst keinen Eintrag liegen', async () => {



  const { pushOverlay, dropOverlay, history } = await freshModule();

  const modal = pushOverlay(() => {});
  const preview = pushOverlay(() => {});
  await settle();

  dropOverlay(modal);    // das Modal geht zuerst - LIFO verletzt
  dropOverlay(preview);
  await settle();

  assert.equal(history.depth, 0);
  assert.deepEqual(history.navigations, []);
});

test('Blatt zu und Dialog auf im selben Tick fassen die History gar nicht an', async () => {




  const { pushOverlay, dropOverlay, history } = await freshModule();

  const sheet = pushOverlay(() => {});
  await settle();
  assert.equal(history.depth, 1);

  let dialogClosed = 0;
  dropOverlay(sheet);
  pushOverlay(() => { dialogClosed += 1; });
  await settle();

  assert.equal(history.depth, 1, 'netto hat sich nichts geaendert, also passiert nichts');

  history.back();
  await settle();
  assert.equal(dialogClosed, 1, 'die Geste schliesst den Dialog');
  assert.deepEqual(history.navigations, [],
    'und nicht einen toten Marker, der die Geste verschluckt');
});

// --------------------------------------------------------
// Die einzelnen Wege hinaus
// --------------------------------------------------------

test('das X gibt seinen Marker zurueck - die naechste Geste braucht keinen Leerlauf', async () => {
  const { pushOverlay, dropOverlay, history } = await freshModule();

  const token = pushOverlay(() => { throw new Error('darf nicht aufgerufen werden'); });
  await settle();
  dropOverlay(token);
  await settle();

  assert.equal(history.depth, 0, 'der Marker ist zurueckgegeben');
  assert.deepEqual(history.navigations, [],
    'das eigene back() darf nicht als Nutzergeste durchgehen - sonst navigiert '
    + 'der Router beim Schliessen per X');
});

test('das obere Overlay geht zuerst zu, das untere bleibt', async () => {
  const { pushOverlay, history } = await freshModule();

  const order = [];
  pushOverlay(() => { order.push('unten'); });
  pushOverlay(() => { order.push('oben'); });
  await settle();

  history.back();
  await settle();
  assert.deepEqual(order, ['oben'], 'die Geste meint das oberste Overlay');
  assert.equal(history.depth, 1, 'fuer das untere liegt der Marker wieder da');

  history.back();
  await settle();
  assert.deepEqual(order, ['oben', 'unten']);
  assert.deepEqual(history.navigations, [], 'erst die dritte Geste gehoert dem Router');
  assert.equal(history.depth, 0);
});

test('ein abgelehntes Schliessen behaelt seinen Marker', async () => {


  // hinauslaufen zu lassen.
  const { pushOverlay, history } = await freshModule();

  let allow = false;
  pushOverlay(() => (allow ? undefined : false));
  await settle();

  history.back();
  await settle();
  assert.equal(history.depth, 1, 'der Marker liegt wieder da');
  assert.deepEqual(history.navigations, [], 'die Geste ist verbraucht, nicht weitergereicht');

  allow = true;
  history.back();
  await settle();
  assert.equal(history.depth, 0);
  assert.deepEqual(history.navigations, [], 'auch der zweite Anlauf bleibt beim Dialog');
});

test('die Zurueck-Geste fragt ohne Zwang - der Dirty-Guard darf greifen', async () => {
  const { pushOverlay, history } = await freshModule();
  let seen = null;
  pushOverlay((opts) => { seen = opts; });
  await settle();

  history.back();
  await settle();
  assert.deepEqual(seen, { force: false });
});

// --------------------------------------------------------
// Navigation und Sitzungsende
// --------------------------------------------------------

test('eine Navigation schliesst offene Overlays und erbt ihren Eintrag', async () => {

  // falschen Seite, also wieder #871.
  const { pushOverlay, consumeOverlayMarker, history } = await freshModule();

  let forced = null;
  pushOverlay((opts) => { forced = opts; });
  await settle();

  assert.equal(consumeOverlayMarker(), true, 'der aktuelle Eintrag war unser Platzhalter');
  assert.deepEqual(forced, { force: true },
    'wer navigiert, hat die Frage nach ungespeicherten Aenderungen beantwortet');


  history.replaceState({ path: '/notes' });

  history.back();
  await settle();
  assert.deepEqual(history.navigations, ['/dashboard'],
    'EINE Geste fuehrt zurueck auf die Ausgangsseite, nicht auf einen leeren Zwischenschritt');
});

test('ohne offenes Overlay meldet die Navigation keinen Marker', async () => {
  const { consumeOverlayMarker } = await freshModule();
  assert.equal(consumeOverlayMarker(), false,
    'sonst ersetzte eine Navigation den Eintrag der Seite, von der sie kommt');
});

test('ein hakendes Overlay haelt die Navigation nicht auf', async () => {
  const { pushOverlay, consumeOverlayMarker } = await freshModule();
  pushOverlay(() => { throw new Error('kaputt'); });
  await settle();
  assert.doesNotThrow(() => consumeOverlayMarker());
});

test('das Sitzungsende schliesst, was noch steht - es vergisst es nicht nur', async () => {



  // schliessen - sie navigierte darunter weg.
  const { pushOverlay, closeAllOverlays, hasOpenOverlay } = await freshModule();

  let closedWith = null;
  pushOverlay((opts) => { closedWith = opts; });
  await settle();

  closeAllOverlays();
  assert.deepEqual(closedWith, { force: true },
    'beim Abmelden fragt niemand mehr nach ungespeicherten Aenderungen');
  assert.equal(hasOpenOverlay(), false);
});

test('nach einem Sitzungsende faengt die Geste wieder Dialoge ab', async () => {


  // Zurueck-Geste waere ab dem naechsten Login still wieder kaputt gewesen.
  const { pushOverlay, closeAllOverlays, history } = await freshModule();

  pushOverlay(() => {});
  await settle();
  closeAllOverlays();

  let closed = 0;
  pushOverlay(() => { closed += 1; });
  await settle();

  history.back();
  await settle();
  assert.equal(closed, 1);
  assert.deepEqual(history.navigations, []);
});

// --------------------------------------------------------
// attachOverlay
// --------------------------------------------------------

test('ein Overlay meldet sich ab, wenn sein Knoten aus dem Dokument faellt', async () => {



  const { attachOverlay, history } = await freshModule();

  const el = { isConnected: true };
  attachOverlay(el, () => { throw new Error('darf nicht aufgerufen werden'); });
  await settle();
  assert.equal(history.depth, 1);


  el.isConnected = false;
  observers[0].cb();
  await settle();

  assert.equal(history.depth, 0, 'der Marker ist zurueckgegeben');
  assert.equal(observers[0].disconnected, true, 'der Beobachter laeuft nicht weiter');
  assert.deepEqual(history.navigations, []);
});

test('die Zurueck-Geste schliesst ein angehaengtes Overlay ueber seinen Weg', async () => {
  const { attachOverlay, history } = await freshModule();

  let closed = 0;
  const el = { isConnected: true };
  attachOverlay(el, () => { closed += 1; el.isConnected = false; });
  await settle();

  history.back();
  await settle();
  assert.equal(closed, 1);
  assert.equal(history.depth, 0);
  assert.deepEqual(history.navigations, []);
});

test('eine zweite Geste waehrend einer laufenden Rueckfrage geht nicht an den Router', async () => {





  // diesem Zeitfenster.
  const { pushOverlay, history } = await freshModule();




  history.pushState({ path: '/calendar' });

  let antwort;
  const gefragt = new Promise((resolve) => { antwort = resolve; });
  pushOverlay(() => gefragt);
  await settle();

  history.back();
  await settle();
  assert.deepEqual(history.navigations, []);

  history.back();
  await settle();
  assert.deepEqual(history.navigations, [],
    'die zweite Geste gehoert dem Dialog, der gerade fragt - nicht dem Router');

  antwort(undefined);      // „verwerfen"
  await settle();
  assert.deepEqual(history.navigations, []);
});

test('ein abgelehntes Schliessen bekommt seinen Marker auch nach einer zweiten Geste', async () => {
  const { pushOverlay, history } = await freshModule();
  history.pushState({ path: '/calendar' });

  let antwort;
  const gefragt = new Promise((resolve) => { antwort = resolve; });
  pushOverlay(() => gefragt);
  await settle();

  history.back();
  await settle();
  history.back();
  await settle();

  antwort(false);
  await settle();


  assert.equal(history.state?.overlay, true, 'der Marker liegt wieder da');
  assert.equal(history.href, '/dashboard',
    'und auf der Adresse, auf der der Dialog steht - die zurueckgenommene '
    + 'Zweitgeste darf sie nicht verschoben haben');
  assert.deepEqual(history.navigations, []);
});

test('die zurueckgenommene Zweitgeste laesst die Adresse stehen', async () => {



  // `pushState` haette dann obendrein den echten Vorwaertszweig abgeschnitten.
  const { pushOverlay, history } = await freshModule();
  history.pushState({ path: '/calendar' }, '', '/calendar');

  let antwort;
  const gefragt = new Promise((resolve) => { antwort = resolve; });
  pushOverlay(() => gefragt);
  await settle();
  const adresseMitDialog = history.href;

  history.back();
  await settle();
  history.back();
  await settle();

  assert.equal(history.href, adresseMitDialog,
    'die Adresse ist mitgewandert - der Bildschirm zeigt eine andere Seite als die Leiste');

  antwort(undefined);
  await settle();
  assert.deepEqual(history.navigations, []);
});

test('das Sitzungsende laesst seinen Marker fuer die Anmeldeseite liegen', async () => {

  // Marker ERBEN (`replaceState`). Wer ihn schon verbraucht, laesst die



  const { pushOverlay, closeAllOverlays, consumeOverlayMarker } = await freshModule();

  pushOverlay(() => {});
  await settle();

  closeAllOverlays();
  assert.equal(consumeOverlayMarker(), true,
    'die folgende Navigation findet keinen Marker zum Erben');
});

test('ein herausgenommener Eintrag gilt nicht mehr als angemeldet', async () => {



  // hervorgeholtes Formular (Bestaetigungsdialog darueber, Zurueck-Geste)

  // weg. Das Modal-System fragt deshalb `isOverlayOpen(token)`.
  const { pushOverlay, isOverlayOpen, history } = await freshModule();

  let gesehen = null;
  const token = pushOverlay(() => { gesehen = isOverlayOpen(token); });
  await settle();
  assert.equal(isOverlayOpen(token), true, 'vor der Geste ist er angemeldet');

  history.back();
  await settle();
  assert.equal(gesehen, false,
    'waehrend des Schliessens ist er es nicht mehr - wer hier "ja" liest, '
    + 'meldet sich nie wieder an');
  assert.equal(isOverlayOpen(token), false);
});
