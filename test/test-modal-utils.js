import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eachRule } from './css-rules.js';


const {
  wireBlurValidation,
  btnSuccess,
  btnError,
  focusRestoreTarget,
  rememberFocus,
  __test: modalTest,
  restoreFocusAfterClose, refocusAfterRender, forgetRestore,
} = await import('../public/components/modal.js');


global.matchMedia = () => ({ matches: false });

const _makeSvgEl = (tag) => {
  const attrs = {};
  const children = [];
  return {
    tag,
    setAttribute(k, v) { attrs[k] = v; },
    appendChild(child) { children.push(child); },
    get outerHTML() {
      const attrStr = Object.entries(attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
      const inner = children.map(c => c.outerHTML ?? '').join('');
      return `<${tag}${attrStr}>${inner}</${tag}>`;
    },
    _attrs: attrs,
    _children: children,
  };
};
global.document = {
  createElementNS: (_ns, tag) => _makeSvgEl(tag),

  createElement: (tag) => ({ tagName: tag.toUpperCase(), className: '', id: '', textContent: '' }),

  // Ersatz; die Sonden unten bestuecken beides je Fall.
  getElementById: () => null,
  getElementsByTagName: () => [],
};

const _origSetTimeout = setTimeout;

// --------------------------------------------------------
// DOM-Mocks
// --------------------------------------------------------

function makeField({ withDom = true } = {}) {
  const classes = new Set();
  const listeners = {};
  const dataset = {};
  const children = [];
  const field = {
    dataset,
    offsetWidth: 0,
    classList: {
      toggle(cls, force) { force ? classes.add(cls) : classes.delete(cls); },
      add(cls) { classes.add(cls); },
      remove(cls) { classes.delete(cls); },
      contains(cls) { return classes.has(cls); },
    },
    addEventListener(event, fn) { listeners[event] = fn; },
    _classes: classes,
    _listeners: listeners,
    _children: children,
  };
  if (withDom) {
    field.querySelector = (sel) => children.find((c) => `.${c.className}` === sel) ?? null;
    field.appendChild = (node) => { children.push(node); return node; };
  }
  return field;
}

function makeInput({ value = '', required = true } = {}) {
  const listeners = {};
  const attrs = {};
  const field = makeField();
  return {
    value,
    required,
    _field: field,
    _listeners: listeners,
    _attrs: attrs,
    addEventListener(event, fn) { listeners[event] = fn; },
    closest() { return field; },
    parentElement: field,
    setAttribute(k, v) { attrs[k] = v; },
    getAttribute(k) { return attrs[k] ?? null; },
    removeAttribute(k) { delete attrs[k]; },
  };
}

function makeContainer(inputs = []) {
  return {
    querySelectorAll(selector) {
      if (selector.includes('required')) return inputs;
      return [];
    },
  };
}

function makeBtn({ textContent = 'Speichern' } = {}) {
  const classes = new Set();
  const listeners = {};
  let _children = [];
  return {
    textContent,
    get innerHTML() {
      return _children.map(c => c?.outerHTML ?? '').join('');
    },
    offsetWidth: 0,
    classList: {
      add(cls) { classes.add(cls); },
      remove(cls) { classes.delete(cls); },
      contains(cls) { return classes.has(cls); },
    },
    replaceChildren(...nodes) { _children = nodes; },
    addEventListener(event, fn) { listeners[event] = fn; },
    _classes: classes,
    _listeners: listeners,
  };
}

// --------------------------------------------------------
// wireBlurValidation
// --------------------------------------------------------

test('confirmOverModal finalisiert das geparkte Modal gemäß closeOnConfirm', async () => {
  const suspended = { id: 'editor' };
  const resumed = [];
  const closed = [];
  const dependencies = {
    resume: (token) => resumed.push(token),
    close: async (options) => closed.push(options),
  };

  assert.equal(await modalTest.finishSuspendedConfirmation(
    false, true, suspended, dependencies
  ), false);
  assert.deepEqual(resumed, [suspended]);
  assert.deepEqual(closed, []);

  assert.equal(await modalTest.finishSuspendedConfirmation(
    true, false, suspended, dependencies
  ), true);
  assert.deepEqual(resumed, [suspended, suspended]);
  assert.deepEqual(closed, []);

  assert.equal(await modalTest.finishSuspendedConfirmation(
    true, true, suspended, dependencies
  ), true);
  assert.deepEqual(resumed, [suspended, suspended, suspended]);
  assert.deepEqual(closed, [{ force: true }]);
});

test('confirmOverModal orchestration passes closeOnConfirm through the real suspended path', async () => {
  const suspended = { id: 'editor' };
  const confirmations = [];
  const resumed = [];
  const closed = [];
  const confirmOverModal = modalTest.createConfirmOverModal({
    getActiveOverlay: () => ({ id: 'active-overlay' }),
    getModalState: () => 'open',
    showConfirmation: async () => assert.fail('the fallback confirmation must not run'),
    suspend: () => suspended,
    confirmSuspended: async (message, options, token) => {
      confirmations.push({ message, options, token });
      return true;
    },
    resume: (token) => resumed.push(token),
    close: async (options) => closed.push(options),
  });

  assert.equal(await confirmOverModal('Continue saving?', {
    closeOnConfirm: false,
    danger: true,
  }), true);
  assert.deepEqual(confirmations, [{
    message: 'Continue saving?',
    options: { danger: true },
    token: suspended,
  }]);
  assert.deepEqual(resumed, [suspended]);
  assert.deepEqual(closed, []);

  assert.equal(await confirmOverModal('Delete this event?'), true);
  assert.deepEqual(resumed, [suspended, suspended]);
  assert.deepEqual(closed, [{ force: true }]);
});

test('wireBlurValidation: registriert blur-Listener auf required inputs', () => {
  const input = makeInput();
  wireBlurValidation(makeContainer([input]));
  assert.equal(typeof input._listeners['blur'], 'function');
});

test('wireBlurValidation: blur mit leerem Wert setzt form-field--error', () => {
  const input = makeInput({ value: '' });
  wireBlurValidation(makeContainer([input]));
  input._listeners['blur']();
  assert.ok(input._field._classes.has('form-field--error'));
  assert.ok(!input._field._classes.has('form-field--valid'));
  assert.equal(input._attrs['aria-invalid'], 'true');
});

test('wireBlurValidation: blur mit gültigem Wert setzt form-field--valid', () => {
  const input = makeInput({ value: 'Hallo' });
  wireBlurValidation(makeContainer([input]));
  input._listeners['blur']();
  assert.ok(input._field._classes.has('form-field--valid'));
  assert.ok(!input._field._classes.has('form-field--error'));
  assert.equal(input._attrs['aria-invalid'], 'false');
});

test('wireBlurValidation: Whitespace-only gilt als leer → form-field--error', () => {
  const input = makeInput({ value: '   ' });
  wireBlurValidation(makeContainer([input]));
  input._listeners['blur']();
  assert.ok(input._field._classes.has('form-field--error'));
  assert.equal(input._attrs['aria-invalid'], 'true');
});

test('wireBlurValidation: kein Fehler wenn closest() null zurückgibt', () => {
  const input = makeInput({ value: '' });
  input.closest = () => null;
  input.parentElement = null;
  wireBlurValidation(makeContainer([input]));
  assert.doesNotThrow(() => input._listeners['blur']());
});

// Feldbezogene Fehlermeldung + aria-describedby (Critique-Nachlauf #534):


test('wireBlurValidation: legt Fehlermeldung an und verknüpft sie per aria-describedby', () => {
  const input = makeInput({ value: '' });
  input.id = 'cardav-name';
  wireBlurValidation(makeContainer([input]));
  input._listeners['blur']();

  const errorEl = input._field._children.find((c) => c.className === 'form-field__error');
  assert.ok(errorEl, 'Fehlermeldung wurde angelegt');
  assert.equal(errorEl.id, 'cardav-name-error');
  assert.ok(errorEl.textContent.length > 0, 'Meldung hat Text');
  assert.equal(input._attrs['aria-describedby'], 'cardav-name-error');
});

test('wireBlurValidation: legt die Meldung nur einmal an', () => {
  const input = makeInput({ value: '' });
  input.id = 'cardav-url';
  wireBlurValidation(makeContainer([input]));
  input._listeners['blur']();
  input._listeners['blur']();
  const errors = input._field._children.filter((c) => c.className === 'form-field__error');
  assert.equal(errors.length, 1);
  assert.equal(input._attrs['aria-describedby'], 'cardav-url-error');
});

test('wireBlurValidation: schlanker Container ohne DOM-API bleibt fehlerfrei', () => {
  const input = makeInput({ value: '' });
  input._field = makeField({ withDom: false });
  input.closest = () => input._field;
  input.parentElement = input._field;
  wireBlurValidation(makeContainer([input]));
  assert.doesNotThrow(() => input._listeners['blur']());
  assert.ok(input._field._classes.has('form-field--error'));
});

// --------------------------------------------------------
// btnSuccess
// --------------------------------------------------------

test('btnSuccess: fügt btn--success-Klasse hinzu', () => {
  global.setTimeout = () => {};
  const btn = makeBtn();
  btnSuccess(btn, 'Test');
  assert.ok(btn._classes.has('btn--success'));
  global.setTimeout = _origSetTimeout;
});

test('btnSuccess: setzt SVG-Checkmark als innerHTML', () => {
  global.setTimeout = () => {};
  const btn = makeBtn();
  btnSuccess(btn, 'Test');
  assert.ok(btn.innerHTML.includes('<svg'));
  assert.ok(btn.innerHTML.includes('polyline'));
  global.setTimeout = _origSetTimeout;
});

test('btnSuccess: stellt Label nach 700ms wieder her', () => {
  let capturedFn, capturedMs;
  global.setTimeout = (fn, ms) => { capturedFn = fn; capturedMs = ms; };
  const btn = makeBtn({ textContent: 'Speichern' });
  btnSuccess(btn, 'Speichern');
  assert.equal(capturedMs, 700);
  capturedFn();
  assert.ok(!btn._classes.has('btn--success'));
  assert.equal(btn.textContent, 'Speichern');
  global.setTimeout = _origSetTimeout;
});

test('btnSuccess: nutzt btn.textContent als Fallback wenn kein Label übergeben', () => {
  let capturedFn;
  global.setTimeout = (fn) => { capturedFn = fn; };
  const btn = makeBtn({ textContent: 'Automatisch' });
  btnSuccess(btn);
  capturedFn();
  assert.equal(btn.textContent, 'Automatisch');
  global.setTimeout = _origSetTimeout;
});

// --------------------------------------------------------
// btnError
// --------------------------------------------------------

test('btnError: fügt btn--shaking-Klasse hinzu', () => {
  const btn = makeBtn();
  btnError(btn);
  assert.ok(btn._classes.has('btn--shaking'));
});

test('btnError: entfernt btn--shaking nach animationend', () => {
  const btn = makeBtn();
  btnError(btn);
  btn._listeners['animationend']();
  assert.ok(!btn._classes.has('btn--shaking'));
});

test('btnError: entfernt btn--shaking zuerst um Animation-Restart zu erzwingen', () => {
  const order = [];
  const btn = makeBtn();
  const origAdd = btn.classList.add.bind(btn);
  const origRemove = btn.classList.remove.bind(btn);
  btn.classList.remove = (cls) => { order.push(`remove:${cls}`); origRemove(cls); };
  btn.classList.add    = (cls) => { order.push(`add:${cls}`);    origAdd(cls); };
  btnError(btn);
  assert.equal(order[0], 'remove:btn--shaking');
  assert.equal(order[1], 'add:btn--shaking');
});

// --------------------------------------------------------
// Panel-Overflow (#805)
// --------------------------------------------------------

const layoutCss = readFileSync(new URL('../public/styles/layout.css', import.meta.url), 'utf8');

function overflowValuesOf(css, selector) {
  const out = [];
  for (const rule of eachRule(css)) {
    if (!rule.selector.split(',').map((s) => s.trim()).includes(selector)) continue;
    const m = rule.body.match(/(?:^|;)\s*overflow\s*:\s*([^;]+)/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

test('#805: .modal-panel bekommt overflow:clip, nie hidden', () => {
  const werte = overflowValuesOf(layoutCss, '.modal-panel');
  assert.ok(werte.length > 0, '.modal-panel setzt gar kein overflow - die Zusage steht nirgends');
  assert.ok(
    werte.every((v) => v === 'clip'),
    `.modal-panel muss overflow:clip tragen, gefunden: ${werte.join(', ')}. `
    + 'hidden macht das Panel programmatisch scrollbar und schiebt das Schliessen-X aus dem Bild (#805).',
  );
});

test('#805: der Modal-Body bleibt der scrollende Container', () => {
  const rule = [...eachRule(layoutCss)].find((r) => r.selector.trim() === '.modal-panel__body');
  assert.ok(rule, '.modal-panel__body fehlt');
  assert.match(
    rule.body, /overflow-y\s*:\s*auto/,
    '.modal-panel__body muss overflow-y:auto behalten - nimmt man ihm das Scrollen, '
    + 'ist langer Modal-Inhalt hinter dem clip des Panels unerreichbar.',
  );
});


test('#805: .modal-overlay bekommt overflow:clip, nie hidden', () => {
  const werte = overflowValuesOf(layoutCss, '.modal-overlay');
  assert.ok(werte.length > 0, '.modal-overlay setzt gar kein overflow - die Zusage steht nirgends');
  assert.ok(
    werte.every((v) => v === 'clip'),
    `.modal-overlay muss overflow:clip tragen, gefunden: ${werte.join(', ')}. `
    + 'hidden macht das Overlay programmatisch scrollbar und schiebt das ganze Panel '
    + 'samt Schliessen-X aus dem Bild (#805).',
  );
});

test('#805: .modal-panel ist auf jeder Breite der Containing Block', () => {
  const regeln = [...eachRule(layoutCss)]
    .filter((r) => r.selector.split(',').map((s) => s.trim()).includes('.modal-panel'))
    .filter((r) => /(?:^|;)\s*position\s*:\s*relative/.test(r.body));
  assert.ok(
    regeln.some((r) => r.at.length === 0),
    '.modal-panel braucht position:relative in der BASISREGEL, nicht nur in einer '
    + `Media-Query (gefunden in: ${regeln.map((r) => r.at.join(' ') || 'Basis').join(' | ') || 'keiner Regel'}). `
    + 'Sonst haengen absolut positionierte Nachfahren am .modal-overlay statt am Panel (#805).',
  );
});


// --------------------------------------------------------

// --------------------------------------------------------


function makeNode(tag, { id = '', cls = null, data = {}, connected = true, attrs = {}, row = null } = {}) {
  return {
    tagName: tag.toUpperCase(), id, isConnected: connected, dataset: { ...data },
    _attrs: { ...attrs },
    getAttribute: (name) => (name === 'class' ? cls : null),


    closest: (sel) => (sel === '[data-id]' && row !== null ? { dataset: { id: row } } : null),
    hasAttribute(n) { return n in this._attrs; },
    setAttribute(n, v) { this._attrs[n] = String(v); },    focus() { this._focused = true; },
  };
}

function withDom({ byId = {}, byTag = {} }, fn) {
  const vorherId  = global.document.getElementById;
  const vorherTag = global.document.getElementsByTagName;
  global.document.getElementById = (id) => byId[id] ?? null;
  global.document.getElementsByTagName = (tag) => byTag[tag] ?? [];
  try { return fn(); } finally {
    global.document.getElementById = vorherId;
    global.document.getElementsByTagName = vorherTag;
  }
}

test('der Fokus geht auf den Ausloeser zurueck, solange er im Dokument haengt', () => {
  const knopf = makeNode('button', { id: 'budget-manage-categories' });
  withDom({}, () => {
    assert.equal(focusRestoreTarget(rememberFocus(knopf)), knopf,
      'ein lebender Ausloeser bleibt das Ziel - der Rueckfall darf den Normalfall nicht umleiten');
  });
});

test('ein ausgetauschter Ausloeser wird ueber seine id wiedergefunden', () => {
  const alt = makeNode('button', { id: 'budget-manage-categories', connected: false });
  const neu = makeNode('button', { id: 'budget-manage-categories' });
  withDom({ byId: { 'budget-manage-categories': neu, 'main-content': makeNode('main', { id: 'main-content' }) } }, () => {
    assert.equal(focusRestoreTarget(rememberFocus(alt)), neu,
      'steht unter derselben id ein lebendes Element, gehoert ihm der Fokus');
  });
});

test('eine Listenzeile ohne id wird ueber ihre data-Attribute wiedergefunden', () => {
  const alt = makeNode('button', { cls: 'note-card', data: { id: '42' }, connected: false });
  const neu = makeNode('button', { cls: 'note-card', data: { id: '42' } });
  const fremd = makeNode('button', { cls: 'note-card', data: { id: '43' } });
  withDom({ byTag: { BUTTON: [fremd, neu] }, byId: { 'main-content': makeNode('main', { id: 'main-content' }) } }, () => {
    assert.equal(focusRestoreTarget(rememberFocus(alt)), neu,
      'die neu gebaute Zeile mit denselben data-Werten muss den Fokus bekommen, nicht die Nachbarzeile');
  });
});

test('eine andere Klasse gilt nicht als dieselbe Zeile', () => {
  const alt = makeNode('button', { cls: 'note-card', data: { id: '42' }, connected: false });
  const andere = makeNode('button', { cls: 'task-row', data: { id: '42' } });
  const wurzel = makeNode('main', { id: 'main-content' });
  withDom({ byTag: { BUTTON: [andere] }, byId: { 'main-content': wurzel } }, () => {
    assert.equal(focusRestoreTarget(rememberFocus(alt)), wurzel,
      'gleiche data-id in einer anderen Liste ist ein anderes Element - lieber die Wurzel als das falsche Ziel');
  });
});

test('ohne id und ohne data-Attribute wird nicht geraten, sondern die Wurzel genommen', () => {
  const alt = makeNode('button', { cls: 'btn btn--ghost', connected: false });
  const gleichartig = makeNode('button', { cls: 'btn btn--ghost' });
  const wurzel = makeNode('main', { id: 'main-content' });
  withDom({ byTag: { BUTTON: [gleichartig] }, byId: { 'main-content': wurzel } }, () => {
    assert.equal(focusRestoreTarget(rememberFocus(alt)), wurzel,
      'ein gleich aussehender Knopf ist nicht derselbe Knopf');
  });
});

test('verschwundener Ausloeser ohne Ersatz landet auf der Seitenwurzel', () => {
  const alt = makeNode('button', { id: 'contacts-manage-cats', connected: false });
  const wurzel = makeNode('main', { id: 'main-content' });
  withDom({ byId: { 'main-content': wurzel } }, () => {
    assert.equal(focusRestoreTarget(rememberFocus(alt)), wurzel,
      'findet die Suche nichts, bleibt die Seitenwurzel - document.body ist kein Fokusziel');
  });
});

test('ohne Seitenwurzel liefert der Rueckfall null statt zu werfen', () => {
  const alt = makeNode('button', { id: 'setup-btn', connected: false });
  withDom({}, () => {
    assert.equal(focusRestoreTarget(rememberFocus(alt)), null,
      'ausserhalb der App-Shell gibt es keine Wurzel');
  });
});

test('ohne gemerkten Ausloeser bleibt es bei null', () => {
  withDom({ byId: { 'main-content': makeNode('main', { id: 'main-content' }) } }, () => {
    assert.equal(focusRestoreTarget(null), null, 'nie ein Ausloeser gemerkt, also nichts zurueckzugeben');
    assert.equal(rememberFocus(null), null, 'und kein Merkzettel fuer nichts');
  });
});

test('ein Knoten ohne focus() bekommt keinen Merkzettel', () => {
  assert.equal(rememberFocus({ tagName: 'DIV' }), null, 'ohne focus() ist es kein Fokusziel');
});

test('document.body bekommt keinen Merkzettel, obwohl es focus() hat', () => {
  const body = { tagName: 'BODY', focus() {}, id: '', dataset: {}, isConnected: true };
  assert.equal(rememberFocus(body), null,
    'body ist kein Fokusziel, sondern das Fehlen eines - als Merker schaltet es das '
    + 'Nachfassen fuer diesen Schliessvorgang dauerhaft ab');
});


test('_doClose fokussiert das Ergebnis des Rueckfalls, nicht den gemerkten Zeiger', () => {
  const src = readFileSync(new URL('../public/components/modal.js', import.meta.url), 'utf8');
  const doClose = src.match(/function _doClose\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(doClose, '_doClose nicht gefunden');
  assert.match(doClose, /focusRestoreTarget\(merkzettel\)/,
    '_doClose muss das Fokusziel ueber focusRestoreTarget() bestimmen');
  assert.doesNotMatch(doClose, /previouslyFocused\.focus\(/,
    '_doClose darf nicht mehr direkt auf dem gemerkten Zeiger fokussieren - '
    + 'genau dieser Aufruf ist auf einem abgehaengten Knoten ein stiller No-op');
});

test('_doClose fasst nach, und das Nachfassen behaelt seine Wachen', () => {
  const src = readFileSync(new URL('../public/components/modal.js', import.meta.url), 'utf8');
  const doClose = src.match(/function _doClose\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(doClose, /_refocusIfDropped\(merkzettel, gesetzt\)/,
    '_doClose muss nachfassen - und zwar auf dem TATSAECHLICH gesetzten Ziel');
  assert.match(doClose, /_fokussiereMitRueckfall\(restoreTarget\)/,
    'nimmt der Ersatz den Fokus nicht an, muss _doClose auf die Wurzel ausweichen');




  const wachen = src.match(/function _tryRefocus\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(wachen, '_tryRefocus nicht gefunden');
  assert.match(wachen, /ziel\.isConnected && document\.activeElement === ziel && !istRueckfall/,
    'nicht die ANWESENHEIT des Ziels beendet den Lauf, sondern sein FOKUSBESITZ - eine Zeile auf '
    + '`display: none` haengt weiter im Dokument und haelt trotzdem keinen Fokus');
  assert.match(wachen, /document\.activeElement === document\.body/,
    'hat die Seite selbst etwas fokussiert, ist ihre Wahl die bessere');
  assert.match(wachen, /if \(activeOverlay\) return;/,
    'sonst risse das Nachfassen den Fokus aus einem Modal, das in derselben Geste aufgegangen ist');
  assert.doesNotMatch(wachen, /ersatz === ziel\) return|\|\| ersatz === ziel/,
    'ein Abbruch bei "derselbe Ersatz" verfehlt den Fall, der hierher fuehrt: das Ziel haelt den '
    + 'Fokus nicht, ist aber noch verbunden - dann gibt focusRestoreTarget es unveraendert zurueck, '
    + 'und der Rueckfall auf die Wurzel wuerde nie erreicht');
  assert.match(wachen, /_fokussiereMitRueckfall\(ersatz\)/,
    'der Versuch muss durch die Wirkungspruefung mit Rueckfall laufen');

  const oeffentlich = src.match(/export function refocusAfterRender\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(oeffentlich, /_tryRefocus\(/,
    'der oeffentliche Griff muss durch dieselben Wachen wie das automatische Nachfassen');


  const fok = src.match(/function _fokussiere\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(fok, /return document\.activeElement === el;/,
    '_fokussiere muss zurueckmelden, OB der Fokus angekommen ist - ein disabled oder '
    + 'ausgeblendeter Ersatz nimmt ihn nicht an, und genau das ist der stille Ausfall');
});

test('ein vorhandenes tabindex wird nicht ueberschrieben', () => {
  const alt = makeNode('button', { id: 'irgendwas', connected: false });
  const wurzel = makeNode('main', { id: 'main-content', attrs: { tabindex: '0' } });
  withDom({ byId: { 'main-content': wurzel } }, () => {
    focusRestoreTarget(rememberFocus(alt));
    assert.equal(wurzel._attrs.tabindex, '0',
      'eine Seite, die ihrer Wurzel bewusst ein anderes tabindex gibt, behaelt es');
  });
});

test('auch ein Ersatz, der selbst die Seitenwurzel ist, wird fokussierbar gemacht', () => {
  const alt = makeNode('main', { id: 'main-content', connected: false });
  const neueWurzel = makeNode('main', { id: 'main-content' });        // Auth-Seite: kein tabindex
  withDom({ byId: { 'main-content': neueWurzel } }, () => {
    const ziel = focusRestoreTarget(rememberFocus(alt));
    assert.equal(ziel, neueWurzel, 'die neue Wurzel ist das Ziel');
    assert.equal(ziel.hasAttribute('tabindex'), true,
      'die id-Suche darf nicht am Fokussierbar-Machen vorbeifuehren - sonst ist `.focus()` '
      + 'auf der Auth-Seite wieder ein stiller No-op');
  });
});

test('eine Zeile wird ueber ihren Vorfahren unterschieden, nicht ueber den Knopf allein', () => {
  const opts = { cls: 'list-row__main', data: { action: 'open-detail' } };
  const alt   = makeNode('button', { ...opts, row: '42', connected: false });
  const zeile1 = makeNode('button', { ...opts, row: '7' });
  const zeile42 = makeNode('button', { ...opts, row: '42' });
  withDom({ byTag: { BUTTON: [zeile1, zeile42] }, byId: { 'main-content': makeNode('main', { id: 'main-content' }) } }, () => {
    assert.equal(focusRestoreTarget(rememberFocus(alt)), zeile42,
      'der Fokus gehoert der Zeile, aus der der Dialog kam - nicht der ersten der Liste');
  });
});

test('mehrdeutige Treffer werden abgelehnt statt geraten', () => {
  const opts = { cls: 'list-row__main', data: { action: 'open-detail' } };
  const alt = makeNode('button', { ...opts, connected: false });   // kein row-Anker
  const a = makeNode('button', opts);
  const b = makeNode('button', opts);
  const wurzel = makeNode('main', { id: 'main-content' });
  withDom({ byTag: { BUTTON: [a, b] }, byId: { 'main-content': wurzel } }, () => {
    assert.equal(focusRestoreTarget(rememberFocus(alt)), wurzel,
      'zwei gleich aussehende Zeilen: lieber die Wurzel als die falsche');
  });
});


test('_fokussiere meldet, ob der Fokus wirklich angekommen ist', () => {
  const src = readFileSync(new URL('../public/components/modal.js', import.meta.url), 'utf8');
  const fok = src.match(/function _fokussiere\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(fok, '_fokussiere nicht gefunden');
  assert.match(fok, /return document\.activeElement === el;/,
    '`.focus()` meldet nichts - erst der Vergleich mit activeElement zeigt, ob es griff');
  const mit = src.match(/function _fokussiereMitRueckfall\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(mit, '_fokussiereMitRueckfall nicht gefunden');
  assert.match(mit, /PAGE_ROOT_ID/,
    'griff der Fokus nicht, muss auf die Seitenwurzel ausgewichen werden - sonst bleibt er auf body');
});

test('ein Fokus auf der Seitenwurzel darf spaeter vom echten Ziel abgeloest werden', () => {
  const src = readFileSync(new URL('../public/components/modal.js', import.meta.url), 'utf8');
  const wachen = src.match(/function _tryRefocus\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(wachen, /const istRueckfall = ziel\.id === PAGE_ROOT_ID;/,
    'der eigene Rueckfall muss als solcher erkannt werden');
  assert.match(wachen, /document\.activeElement === document\.body \|\| document\.activeElement === ziel/,
    'liegt der Fokus auf dem Ziel selbst, gilt das als "noch niemand hat gewaehlt" - sonst bliebe '
    + 'er am Rueckfall haengen, obwohl der Knopf laengst wieder da ist');
});

test('ein verbundenes, aber unbedienbares Ziel beendet den Lauf nicht', () => {
  const src = readFileSync(new URL('../public/components/modal.js', import.meta.url), 'utf8');
  const wachen = src.match(/function _tryRefocus\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.doesNotMatch(wachen, /if \(ziel\.isConnected\)\s*return;/,
    'die Anwesenheit allein darf den Lauf nicht beenden - sie sagt nichts darueber, '
    + 'ob das Ziel den Fokus auch haelt');
  assert.match(wachen, /document\.activeElement === ziel/,
    'geprueft gehoert der Fokusbesitz');
});

test('ein geaendertes Nutzlast-Feld verhindert das Wiederfinden nicht', () => {
  const gemeinsam = { cls: 'subtask-item__action' };
  const alt = makeNode('button', { ...gemeinsam, data: { action: 'rename-subtask', id: '7', title: 'Alt' }, connected: false });
  const neu = makeNode('button', { ...gemeinsam, data: { action: 'rename-subtask', id: '7', title: 'Neu' } });
  const wurzel = makeNode('main', { id: 'main-content' });
  withDom({ byTag: { BUTTON: [neu] }, byId: { 'main-content': wurzel } }, () => {
    assert.equal(focusRestoreTarget(rememberFocus(alt)), neu,
      'die Identitaet steht in action und id - ein geaenderter Titel darf den Knopf nicht verstecken');
  });
});

test('der zweite Anlauf raet nicht - Mehrdeutigkeit bleibt Mehrdeutigkeit', () => {
  const gemeinsam = { cls: 'subtask-item__action' };
  const alt = makeNode('button', { ...gemeinsam, data: { action: 'rename-subtask', title: 'Alt' }, connected: false });
  const a = makeNode('button', { ...gemeinsam, data: { action: 'rename-subtask', title: 'X' } });
  const b = makeNode('button', { ...gemeinsam, data: { action: 'rename-subtask', title: 'Y' } });
  const wurzel = makeNode('main', { id: 'main-content' });
  withDom({ byTag: { BUTTON: [a, b] }, byId: { 'main-content': wurzel } }, () => {
    assert.equal(focusRestoreTarget(rememberFocus(alt)), wurzel,
      'ohne unterscheidende id bleiben zwei Kandidaten - dann die Wurzel statt der falschen');
  });
});

test('refocusAfterRender behaelt seinen Merker fuer weitere Neuaufbauten', () => {
  const src = readFileSync(new URL('../public/components/modal.js', import.meta.url), 'utf8');
  const fn = src.match(/export function refocusAfterRender\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(fn, 'refocusAfterRender nicht gefunden');
  assert.doesNotMatch(fn, /_lastRestore = null/,
    'der Merker darf beim Gebrauch NICHT verfallen - ein Vorgang kann mehrfach neu aufbauen, '
    + 'und der zweite Weg (Toast-Rueckgaengig) meint denselben Knopf');
  assert.match(src, /export function forgetRestore\(\)/,
    'zum Verwerfen braucht es einen eigenen Griff fuer alle, die an dieser Schicht vorbei schliessen');
});

test('closeDetailView verwirft den Merker, wenn es am Modal vorbei schliesst', () => {
  const src = readFileSync(new URL('../public/components/detail-view.js', import.meta.url), 'utf8');
  const fn = src.match(/export function closeDetailView\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(fn, 'closeDetailView nicht gefunden');
  assert.match(fn, /forgetRestore\(\)/,
    'der Popover-Zweig kehrt ohne closeModal() zurueck - ohne Verwerfen bliebe der Merker '
    + 'des vorigen Dialogs stehen');
});

test('der Merker aus dem Popover traegt auch den Neuaufbau danach (#1083)', () => {
  const vorher = { active: global.document.activeElement, body: global.document.body };
  global.document.body = makeNode('body');
  const fokussierbar = (n) => { n.focus = () => { global.document.activeElement = n; }; return n; };
  const wurzel = fokussierbar(makeNode('main', { id: 'main-content' }));
  const anker = fokussierbar(makeNode('div', { cls: 'calendar-chip', data: { eventId: '7' } }));
  try {
    const merker = rememberFocus(anker);
    withDom({ byId: { 'main-content': wurzel } }, () => {
      global.document.activeElement = global.document.body;
      assert.equal(restoreFocusAfterClose(merker), anker,
        'haengt der Ausloeser noch, bekommt er den Fokus selbst');
      assert.equal(global.document.activeElement, anker);
    });


    anker.isConnected = false;
    const neu = fokussierbar(makeNode('div', { cls: 'calendar-chip', data: { eventId: '7' } }));
    withDom({ byTag: { DIV: [neu] }, byId: { 'main-content': wurzel } }, () => {
      global.document.activeElement = global.document.body;
      refocusAfterRender();
      assert.equal(global.document.activeElement, neu,
        'ohne den Merker aus dem Popover bliebe der Fokus nach dem Neuaufbau auf body');
    });

    assert.equal(restoreFocusAfterClose(null), null, 'ohne Merker gibt es nichts zurueckzugeben');
  } finally {
    forgetRestore();
    global.document.activeElement = vorher.active;
    global.document.body = vorher.body;
  }
});

test('das Popover gibt den Fokus nur zurueck, wo niemand woanders hin wollte (#1083)', () => {
  const src = readFileSync(new URL('../public/components/detail-view.js', import.meta.url), 'utf8');
  const fn = src.match(/export function closeDetailView\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(fn, /if \(fokus && merker\) restoreFocusAfterClose\(merker\);\s*else forgetRestore\(\);/,
    'Rueckgabe mit eigenem Merker, sonst verwerfen - nie einen fremden stehen lassen');
  assert.match(src, /!popover\.contains\(e\.target\)\) closeDetailView\(\{ fokus: false \}\)/,
    'ein Klick daneben wollte woanders hin - der Fokus springt nicht zurueck');
  assert.match(src, /if \(activePopover\) closeDetailView\(\{ fokus: false \}\)/,
    'eine neue Ansicht nimmt den Fokus selbst');
});

test('eine geaenderte Modifier-Klasse verhindert das Wiederfinden nicht', () => {



  // #1070). Das Repo fuehrt 24 solcher Schluesselfelder.
  const alt = makeNode('button', { cls: 'meal-card__open', data: { action: 'edit-meal', mealId: '9' }, connected: false });
  const neu = makeNode('button', { cls: 'meal-card__open meal-card__open--with-thumb', data: { action: 'edit-meal', mealId: '9' } });
  const wurzel = makeNode('main', { id: 'main-content' });
  withDom({ byTag: { BUTTON: [neu] }, byId: { 'main-content': wurzel } }, () => {
    assert.equal(focusRestoreTarget(rememberFocus(alt)), neu,
      'die Identitaet steht in action und id - eine Darstellungsklasse darf den Knopf nicht verstecken');
  });
});

test('der Anlauf ohne Klasse besteht weiter auf Eindeutigkeit', () => {


  const alt = makeNode('button', { cls: 'meal-card__open', data: { action: 'edit-meal', mealId: '9' }, connected: false });
  const a = makeNode('button', { cls: 'meal-card__open--with-thumb', data: { action: 'edit-meal', mealId: '9' } });
  const b = makeNode('button', { cls: 'meal-card__open--compact', data: { action: 'edit-meal', mealId: '9' } });
  const wurzel = makeNode('main', { id: 'main-content' });
  withDom({ byTag: { BUTTON: [a, b] }, byId: { 'main-content': wurzel } }, () => {
    assert.equal(focusRestoreTarget(rememberFocus(alt)), wurzel,
      'ohne unterscheidende id bleiben zwei Kandidaten - dann die Wurzel statt der falschen');
  });
});

test('_tryRefocus schreibt das tatsaechlich gesetzte Ziel in den Merker zurueck', () => {
  const src = readFileSync(new URL('../public/components/modal.js', import.meta.url), 'utf8');
  const fn = src.match(/function _tryRefocus\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(fn, '_tryRefocus nicht gefunden');
  assert.match(fn, /const gesetzt = _fokussiereMitRueckfall\(ersatz\)/,
    'der Rueckgabewert traegt, WO der Fokus wirklich gelandet ist - er darf nicht verfallen');
  assert.match(fn, /_lastRestore\.ziel = gesetzt/,
    'ohne das Zurueckschreiben urteilt der naechste Lauf ueber ein Ziel, das es nicht mehr gibt');
});

// --------------------------------------------------------



// geoeffneter Dialog steht immer oben, also begann jede Wischgeste so.
// --------------------------------------------------------
const { __test: modalInternals } = await import('../public/components/modal.js');

function fakeSheet() {
  const handlers = {};
  const writes = [];
  let transform = '';
  const panel = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    querySelector: () => ({ scrollTop: 0 }),
    getBoundingClientRect: () => ({ top: 100 }),
    style: {
      get transform() { return transform; },
      set transform(v) { writes.push(v); transform = v; },
    },
  };
  modalInternals.wireSheetSwipe(panel);
  const at = (y) => ({ touches: [{ clientY: y }], changedTouches: [{ clientY: y }] });
  return {
    writes,
    get transform() { return transform; },
    start: (y) => handlers.touchstart(at(y)),
    move: (y) => handlers.touchmove(at(y)),
    end: (y) => handlers.touchend(at(y)),
  };
}

test('Sheet-Swipe: aufwaerts im Inhalt schreibt nichts ans Panel (#981)', () => {
  const sheet = fakeSheet();
  sheet.start(600);
  for (const y of [590, 560, 500, 420, 330]) sheet.move(y);
  sheet.end(330);
  assert.deepEqual(sheet.writes, [], 'kein Stil-Schreibzugriff, waehrend eine Aufwaertsgeste den Inhalt scrollt');
});

test('Sheet-Swipe: ein Zittern nach oben verwirft eine Schliessgeste nicht', () => {



  const sheet = fakeSheet();
  sheet.start(600);
  sheet.move(598);
  sheet.move(592);
  assert.deepEqual(sheet.writes, [], 'innerhalb der Schwelle kein Schreibzugriff');
  sheet.move(650);
  assert.equal(sheet.transform, 'translateY(24px)', 'die Geste zieht das Sheet trotz des Zitterns');
});

test('Sheet-Swipe: ein begonnener Zug bleibt verfolgt und setzt das Panel einmal zurueck', () => {
  global.requestAnimationFrame = (fn) => fn();
  try {
    const sheet = fakeSheet();
    sheet.start(600);
    sheet.move(650);
    assert.equal(sheet.transform, 'translateY(24px)');
    sheet.move(590);
    assert.equal(sheet.transform, '', 'zurueckgesetzt, sobald der Finger ueber dem Start steht (b7c0312c)');
    const writesAfterReset = sheet.writes.length;
    sheet.move(570);
    sheet.move(550);
    assert.equal(sheet.writes.length, writesAfterReset, 'zurueckgesetzt wird einmal, nicht in jedem Frame');
    sheet.move(640);
    sheet.end(640);
    assert.equal(sheet.transform, '', 'touchend raeumt den Zug ab');
  } finally {
    delete global.requestAnimationFrame;
  }
});
