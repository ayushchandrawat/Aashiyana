import { test } from 'node:test';
import assert from 'node:assert/strict';

global.HTMLElement = class HTMLElement {};
global.customElements = { define() {}, get() { return undefined; } };

function makeNode() {
  const node = {
    style: {}, dataset: {}, children: [],
    className: '', textContent: '', type: '', hidden: false, disabled: false,
    isConnected: true,
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    appendChild(child) { node.children.push(child); return child; },
    append(...kids) { node.children.push(...kids); },
    replaceChildren() { node.children = []; },
    replaceWith() {},
    insertAdjacentHTML() {},
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {},
  };
  return node;
}

global.window = { matchMedia: () => ({ matches: false }), addEventListener() {}, aashiyana: {} };
global.document = {
  createElement: () => makeNode(),
  getElementById: () => null,
  querySelector: () => null,
  addEventListener() {},
  documentElement: { lang: 'de' },
  activeElement: null,
};

const { __test } = await import('../public/pages/pantry.js');

function makeRow(step = 1) {
  const quantityEl = makeNode();
  const minus = makeNode();
  const stepper = makeNode();
  stepper.dataset.step = String(step);
  const row = makeNode();
  row.querySelector = (sel) => {
    if (sel === '.pantry-row__quantity') return quantityEl;
    if (sel === '[data-action="decrease"]') return minus;
    if (sel === '.pantry-stepper') return stepper;
    return null;
  };
  return { row, quantityEl, minus };
}

function rice(quantity, extra = {}) {
  return {
    id: 5, name: 'Reis', quantity, unit: 'pcs',
    min_quantity: null, expires_on: null, category: 'Sonstiges', location_id: null,
    ...extra,
  };
}

function resetPantry() {
  __test.intents.clear();
  __test.resetLoadOrderForTest();
  __test.state.items = [];
  __test.state.locations = [];
  __test.state.categories = [];
  __test.state.filter = 'all';
  __test.state.query = '';
  __test.setContainerForTest(null);
  __test.setQuantityDebounceMsForTest(null);
  delete globalThis.__apiStub;
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 25));

test('ein Schritt ueberlebt eine Auffrischung mitten im Entprell-Fenster', async () => {
  resetPantry();
  __test.state.items = [rice(2)];
  __test.setQuantityDebounceMsForTest(5);

  let patched = null;
  globalThis.__apiStub = {

    get: async () => ({ data: [rice(2)], locations: [], categories: [] }),
    patch: async (_path, body) => { patched = body; return { data: rice(body.quantity) }; },
  };

  const { row } = makeRow();
  __test.adjustQuantity(__test.state.items[0], +1, row);
  assert.equal(__test.quantityOf(__test.state.items[0]), 3, 'optimistisch erhoeht');


  await __test.loadPantry();
  assert.equal(__test.quantityOf(__test.state.items[0]), 3,
    'die alte Antwort darf den Schritt nicht zuruecknehmen');

  await settled();
  assert.deepEqual(patched, { quantity: 3 }, 'der Server bekommt den gewollten Wert');
});

test('die Antwort landet im NEUEN Artikelobjekt, nicht im abgehaengten', async () => {
  resetPantry();
  __test.state.items = [rice(2)];
  __test.setQuantityDebounceMsForTest(5);

  globalThis.__apiStub = {
    get: async () => ({ data: [rice(2)], locations: [], categories: [] }),



    // Objekt getroffen.
    patch: async () => ({ data: rice(2.5) }),
  };

  const { row } = makeRow();
  __test.adjustQuantity(__test.state.items[0], +1, row);
  await __test.loadPantry();   // tauscht `state.items` gegen neue Objekte aus
  await settled();

  assert.equal(__test.quantityOf(__test.state.items[0]), 2.5,
    'ohne frische Aufloesung schreibt die Antwort in ein Objekt, das an nichts mehr haengt');
});

test('die PATCH-Antwort ueberschreibt keine frisch geladenen Fremdfelder', async () => {




  resetPantry();
  __test.state.items = [rice(2)];
  __test.setQuantityDebounceMsForTest(5);

  globalThis.__apiStub = {

    get: async () => ({ data: [rice(2, { name: 'Basmatireis' })], locations: [], categories: [] }),

    patch: async (_p, body) => ({ data: rice(body.quantity, { name: 'Reis' }) }),
  };

  const { row } = makeRow();
  __test.adjustQuantity(__test.state.items[0], +1, row);
  await __test.loadPantry();
  assert.equal(__test.state.items[0].name, 'Basmatireis');
  await settled();

  assert.equal(__test.quantityOf(__test.state.items[0]), 3, 'die Menge kommt aus der Antwort');
  assert.equal(__test.state.items[0].name, 'Basmatireis',
    'der frisch geladene Name darf nicht auf den Stand der Antwort zurueckfallen');
});

test('ein zweiter Schritt springt nicht am ersten, erfolgreichen vorbei zurueck', async () => {




  resetPantry();
  __test.state.items = [rice(2)];
  __test.setQuantityDebounceMsForTest(5);

  const toasts = [];
  global.window.aashiyana.showToast = (msg) => toasts.push(msg);
  const alt = deferred();
  let patchZaehler = 0;
  globalThis.__apiStub = {
    get: () => alt.promise,
    patch: async (_p, body) => {
      patchZaehler += 1;
      if (patchZaehler === 1) return { data: rice(body.quantity) };   // Schritt 1: Erfolg
      throw Object.assign(new Error('nope'), { data: { error: 'kaputt' } });
    },
  };

  const laden = __test.loadPantry();          // Schnappschuss: 2
  const { row } = makeRow();
  __test.adjustQuantity(__test.state.items[0], +1, row);   // 2 -> 3
  await settled();                                          // bestaetigt
  assert.equal(__test.quantityOf(__test.state.items[0]), 3);

  __test.adjustQuantity(__test.state.items[0], +1, row);   // 3 -> 4, ausstehend
  alt.resolve({ data: [rice(2)], locations: [], categories: [] });
  await laden;
  await settled();                                          // Schritt 2 scheitert

  assert.equal(__test.quantityOf(__test.state.items[0]), 3,
    'der Ruecksprung gehoert auf die bestaetigte 3, nicht auf die 2 des alten Schnappschusses');
  delete global.window.aashiyana.showToast;
});

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

test('eine Antwort, die den PATCH ueberholt hat, dreht den Schritt nicht zurueck', async () => {
  resetPantry();
  __test.state.items = [rice(2)];
  __test.setQuantityDebounceMsForTest(5);

  const gate = deferred();
  globalThis.__apiStub = {
    get: () => gate.promise,
    patch: async (_p, body) => ({ data: rice(body.quantity) }),
  };


  const loading = __test.loadPantry();

  const { row } = makeRow();
  __test.adjustQuantity(__test.state.items[0], +1, row);
  await settled();
  assert.equal(__test.quantityOf(__test.state.items[0]), 3);

  //    PATCH-Erfolg verschwaende, waere hier schon weg.
  gate.resolve({ data: [rice(2)], locations: [], categories: [] });
  await loading;

  assert.equal(__test.quantityOf(__test.state.items[0]), 3,
    'die bestaetigte Menge muss die aeltere Antwort ueberstehen');
});

test('ein spaeter begonnenes Laden raeumt den Merker - fremde Aenderungen kommen durch', async () => {
  resetPantry();
  __test.state.items = [rice(2)];
  __test.setQuantityDebounceMsForTest(5);

  globalThis.__apiStub = {
    get: async () => ({ data: [rice(9)], locations: [], categories: [] }),
    patch: async (_p, body) => ({ data: rice(body.quantity) }),
  };

  const { row } = makeRow();
  __test.adjustQuantity(__test.state.items[0], +1, row);
  await settled();
  assert.equal(__test.quantityOf(__test.state.items[0]), 3);



  await __test.loadPantry();
  assert.equal(__test.quantityOf(__test.state.items[0]), 9);
  assert.equal(__test.intents.size, 0, 'kein Rest im Merker');
});

test('scheitert der PATCH, bleibt kein Merker stehen', async () => {
  resetPantry();
  __test.state.items = [rice(2)];
  __test.setQuantityDebounceMsForTest(5);

  const toasts = [];
  global.window.aashiyana.showToast = (msg) => toasts.push(msg);
  globalThis.__apiStub = {
    get: async () => ({ data: [rice(2)], locations: [], categories: [] }),
    patch: async () => { throw Object.assign(new Error('nope'), { data: { error: 'kaputt' } }); },
  };

  const { row } = makeRow();
  __test.adjustQuantity(__test.state.items[0], +1, row);
  await settled();

  assert.equal(__test.quantityOf(__test.state.items[0]), 2, 'zurueckgedreht');
  assert.equal(__test.intents.size, 0, 'ein gescheiterter Wunsch darf nichts auftragen');
  assert.equal(toasts.length, 1);
  delete global.window.aashiyana.showToast;
});

test('eine aeltere Antwort, die NACH einer juengeren landet, fasst den Stand nicht mehr an', async () => {

  resetPantry();
  __test.state.items = [rice(2)];
  __test.setQuantityDebounceMsForTest(5);

  const alt = deferred();
  const neu = deferred();
  const gates = [alt, neu];
  globalThis.__apiStub = {
    get: () => gates.shift().promise,
    patch: async (_p, body) => ({ data: rice(body.quantity) }),
  };

  const ladenAlt = __test.loadPantry();            // beginnt zuerst
  const { row } = makeRow();
  __test.adjustQuantity(__test.state.items[0], +1, row);
  await settled();                                  // PATCH bestaetigt
  const ladenNeu = __test.loadPantry();            // beginnt danach

  neu.resolve({ data: [rice(3)], locations: [], categories: [] });
  await ladenNeu;
  assert.equal(__test.quantityOf(__test.state.items[0]), 3);
  assert.equal(__test.intents.size, 0, 'die juengere Antwort kennt den Wert, der Eintrag darf gehen');

  alt.resolve({ data: [rice(2)], locations: [], categories: [] });
  await ladenAlt;
  assert.equal(__test.quantityOf(__test.state.items[0]), 3,
    'eine ueberholte Antwort darf den bereits angewandten Stand nicht mehr ueberschreiben');
});

test('scheitert der PATCH, springt die Menge auf den FRISCHEN Serverstand zurueck', async () => {



  resetPantry();
  __test.state.items = [rice(2)];
  __test.setQuantityDebounceMsForTest(5);

  const toasts = [];
  global.window.aashiyana.showToast = (msg) => toasts.push(msg);
  globalThis.__apiStub = {
    get: async () => ({ data: [rice(5)], locations: [], categories: [] }),
    patch: async () => { throw Object.assign(new Error('nope'), { data: { error: 'kaputt' } }); },
  };

  const { row } = makeRow();
  __test.adjustQuantity(__test.state.items[0], +1, row);
  await __test.loadPantry();
  assert.equal(__test.quantityOf(__test.state.items[0]), 3, 'der Schritt ueberlebt die Auffrischung');

  await settled();
  assert.equal(__test.quantityOf(__test.state.items[0]), 5,
    'der Ruecksprung muss den frischen Serverstand treffen, nicht den Stand von vor dem Tippen');
  assert.equal(toasts.length, 1);
  delete global.window.aashiyana.showToast;
});

test('die Zeile zeigt die Absicht, nicht den Serverstand', async () => {




  resetPantry();
  __test.state.items = [rice(2)];
  __test.setQuantityDebounceMsForTest(5000);

  globalThis.__apiStub = { patch: async () => ({ data: rice(3) }) };
  const { row } = makeRow();
  __test.adjustQuantity(__test.state.items[0], +1, row);

  assert.equal(__test.state.items[0].quantity, 2, 'der Serverstand bleibt unberuehrt');
  assert.equal(__test.quantityOf(__test.state.items[0]), 3, 'die Zeile zeigt die Absicht');
  const gezeigt = __test.withIntent(__test.state.items[0]);
  assert.equal(gezeigt.quantity, 3, 'und die abgeleiteten Angaben rechnen damit');
  assert.equal(__test.state.items[0].quantity, 2, 'die Ueberlagerung ist eine Kopie, kein Schreiben');
});

test('ein ueberholter, aber erfolgreicher Schritt landet im Serverstand', async () => {



  resetPantry();
  __test.state.items = [rice(2)];
  __test.setQuantityDebounceMsForTest(5);

  const tore = [deferred(), deferred()];
  let n = 0;
  globalThis.__apiStub = { get: async () => ({ data: [rice(2)], locations: [], categories: [] }),
                           patch: () => tore[n++].promise };
  const { row } = makeRow();
  __test.adjustQuantity(__test.state.items[0], +1, row);           // 2 -> 3
  await new Promise((r) => setTimeout(r, 15));                     // Timer 1 feuert
  __test.adjustQuantity(__test.state.items[0], +1, row);           // 3 -> 4, ueberstimmt
  await new Promise((r) => setTimeout(r, 15));                     // Timer 2 feuert

  tore[0].resolve({ data: rice(3) });                              // erster: Erfolg
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(__test.state.items[0].quantity, 3,
    'der bestaetigte Wert des ueberholten Schritts gehoert in den Serverstand');
  assert.equal(__test.quantityOf(__test.state.items[0]), 4, 'die Zeile zeigt weiter die 4');

  global.window.aashiyana.showToast = () => {};
  tore[1].promise.catch(() => {});
  tore[1].resolve(Promise.reject(Object.assign(new Error('nope'), { data: { error: 'kaputt' } })));
  await settled();
  assert.equal(__test.quantityOf(__test.state.items[0]), 3,
    'der Fehlschlag faellt auf die bestaetigte 3, nicht auf die 2 von vor beiden');
  delete global.window.aashiyana.showToast;
});

test('eine aeltere Auffrischung ueberschreibt keine juengere', async () => {


  resetPantry();
  __test.state.items = [rice(2)];

  const alt = deferred();
  const antworten = [() => alt.promise,
                     async () => ({ data: [rice(9)], locations: [], categories: [] })];
  globalThis.__apiStub = { get: () => antworten.shift()() };

  const ladenAlt = __test.loadPantry();      // beginnt zuerst
  await __test.loadPantry();                 // beginnt danach, landet zuerst
  assert.equal(__test.state.items[0].quantity, 9);

  alt.resolve({ data: [rice(2)], locations: [], categories: [] });
  await ladenAlt;
  assert.equal(__test.state.items[0].quantity, 9,
    'die ueberholte Antwort darf den juengeren Stand nicht ersetzen');
});
