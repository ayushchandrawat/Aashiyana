
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { pushOverlay, dropOverlay, isOverlayOpen } from '/utils/overlay-history.js';

let activeOverlay = null;
let previouslyFocused = null;


let _lastRestore = null;
let focusTrapHandler = null;
let _initialFormSnapshot = null;
let _initialFormTimeout = null;
let _modalFormSeq = 0;




let _modalGeneration = 0;

let _dirtyGuardEnabled = true;




//   idle       - kein Modal offen
//   open       - Modal sichtbar und interaktiv


let modalState = 'idle';

export function captureModalContext() {
  return {
    generation: _modalGeneration,
    route: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    pageRoot: document.getElementById('main-content')?.firstElementChild ?? null,
  };
}

/** Ob seit captureModalContext() weder Dialog noch Seiteninstanz wechselte. */
export function isModalContextCurrent(context) {
  if (!context || context.generation !== _modalGeneration) return false;
  const route = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (context.route !== route) return false;
  return !context.pageRoot || context.pageRoot.isConnected;
}

let _overlayToken = null;

function _syncOverlayRegistration() {
  const open = Boolean(document.querySelector('.modal-overlay'));
  if (open) {
    if (_overlayToken === null || !isOverlayOpen(_overlayToken)) {
      _overlayToken = pushOverlay(_closeFromBackNavigation);
    }
    return;
  }
  if (_overlayToken !== null) {
    const token = _overlayToken;
    _overlayToken = null;
    dropOverlay(token);
  }
}

async function _closeFromBackNavigation({ force = false } = {}) {
  await closeModal({ force });
  if (force) {
    document.querySelectorAll('.modal-overlay').forEach((el) => el.remove());
  }
  _syncOverlayRegistration();
  return true;
}

// Overlay-Dimming: theme-color abdunkeln im Standalone-Modus
const OVERLAY_THEME_COLOR = '#1A1A1A';




// beginnt der Seiteninhalt".
const PAGE_ROOT_ID = 'main-content';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');



const FIRST_FIELD = 'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])';

// --------------------------------------------------------
// Focus-Trap (Spec §5.2)
// --------------------------------------------------------

function trapFocus(container, initialFocus = 'first-field') {
  focusTrapHandler = (e) => {
    // Tab-Trap: Fokus innerhalb des Modals halten
    if (e.key === 'Tab') {
      const focusable = container.querySelectorAll(FOCUSABLE);
      if (!focusable.length) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }

    // Enter in einzeiligen Inputs/Selects → Formular absenden (Standard-Web-
    // Konvention, Audit 1.4). Textareas behalten ihr Standardverhalten (Zeilen-

    if (e.key === 'Enter') {
      const active = document.activeElement;
      const isInput = active.tagName === 'INPUT' && active.type !== 'submit' && active.type !== 'button';
      const isSelect = active.tagName === 'SELECT';

      if (isInput || isSelect) {
        const submitBtn = container.querySelector('button[type="submit"], .btn--primary');
        if (submitBtn && !submitBtn.disabled) {
          e.preventDefault();
          submitBtn.click();
        }
      }
    }
  };
  container.addEventListener('keydown', focusTrapHandler);

  // Virtual Keyboard: Focused Input in sichtbaren Bereich scrollen
  function onInputFocus(e) {
    const tag = e.target.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return;
    setTimeout(() => {
      e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  }
  container.addEventListener('focusin', onInputFocus);
  container._onInputFocus = onInputFocus;

  applyInitialFocus(container, initialFocus);
}

function applyInitialFocus(container, initialFocus) {
  if (initialFocus === 'none') return;

  if (initialFocus && typeof initialFocus.focus === 'function') {
    setTimeout(() => initialFocus.focus(), 50);
    return;
  }

  const first = container.querySelector(FIRST_FIELD) ?? container.querySelector(FOCUSABLE);
  if (first) {
    setTimeout(() => first.focus(), 50);
  }
}

export function focusFirstField(panel) {
  if (!panel) return null;

  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (coarse) {
    const heading = panel.querySelector('.modal-panel__title');
    if (heading) {


      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus();
      return heading;
    }
  }

  const target = panel.querySelector(FIRST_FIELD) ?? panel.querySelector(FOCUSABLE);
  target?.focus();
  return target ?? null;
}

// --------------------------------------------------------
// Dirty-Check Helpers
// --------------------------------------------------------

// `[data-dirty-ignore]` opts a single control OUT of the dirty comparison
// (S-14): a purely structural/UI-mode field (e.g. a hidden `mode` input that a
// segmented control rewrites on every click, with no typed content of its
// own) would otherwise make `isFormDirty()` report a change the user never
// made - switching segments alone triggered "Discard changes?" with zero
// typed input. Opt-in per field, not a blanket exclusion of disabled/hidden
// fieldsets: a real field that starts disabled/hidden (e.g. a conditional
// fieldset a mode enables) must still count once it holds typed content.
function serializeForm(container) {
  const inputs = container.querySelectorAll(
    'input:not([type="file"]):not([data-dirty-ignore]), select:not([data-dirty-ignore]), textarea:not([data-dirty-ignore])'
  );
  return Array.from(inputs).map((el) => `${el.name || el.id}=${el.value}`).join('&');
}

function isFormDirty(container) {

  if (!_dirtyGuardEnabled) return false;
  if (_initialFormSnapshot === null) return false;
  return serializeForm(container) !== _initialFormSnapshot;
}

function _snapshotNow() {
  if (!activeOverlay) return;
  _initialFormSnapshot = serializeForm(activeOverlay.querySelector('.modal-panel') ?? activeOverlay);
}

export function refreshDirtySnapshot() {
  _snapshotNow();
  if (_initialFormTimeout) clearTimeout(_initialFormTimeout);
  _initialFormTimeout = setTimeout(_snapshotNow, 150);
}

// --------------------------------------------------------
// Escape-Handler
// --------------------------------------------------------

function onEscape(e) {
  if (e.key === 'Escape') closeModal();
}

// --------------------------------------------------------
// Swipe-to-Close (Mobile)
// --------------------------------------------------------


// davon entscheidet sie weder "Sheet ziehen" noch "Inhalt scrollen".
const SHEET_SWIPE_SLOP_PX = 10;

function _wireSheetSwipe(panel) {
  let startY = 0;
  let dragging = false;


  let pulled = false;

  // Scroll position is now on the body, not the panel itself
  const scrollBody = panel.querySelector('.modal-panel__body');

  panel.addEventListener('touchstart', (e) => {

    const touchY = e.touches[0].clientY;
    const rect = panel.getBoundingClientRect();
    const isHandleZone = touchY - rect.top < 48;
    const isScrolledToTop = (scrollBody ? scrollBody.scrollTop : panel.scrollTop) <= 0;
    if (!isHandleZone && !isScrolledToTop) return;
    startY = touchY;
    dragging = true;
    pulled = false;
  }, { passive: true });

  panel.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const dy = e.touches[0].clientY - startY;
    if (dy < 0) {






      // Simulator: 0 bis 30 px statt 500 bis 675 px fuer dieselbe Geste.


      //



      // passiert nichts - kein Abbruch, kein Schreibzugriff.
      if (!pulled) {
        if (dy < -SHEET_SWIPE_SLOP_PX) dragging = false;
        return;
      }



      if (panel.style.transform) panel.style.transform = '';
      return;
    }


    if (dy > SHEET_SWIPE_SLOP_PX) {
      pulled = true;
      panel.style.transform = `translateY(${(dy - SHEET_SWIPE_SLOP_PX) * 0.6}px)`;
    }
  }, { passive: true });

  panel.addEventListener('touchend', (e) => {
    if (!dragging) return;
    dragging = false;
    const dy = e.changedTouches[0].clientY - startY;
    if (dy > 80) {
      panel.style.transform = '';
      closeModal();
    } else {



      requestAnimationFrame(() => { panel.style.transform = ''; });
    }
  });
}

// --------------------------------------------------------

//





//

// --------------------------------------------------------

function _awaitOverlayRemoval(node, timeout = 600) {
  if (!node?.isConnected) return Promise.resolve();
  return new Promise((resolve) => {
    let fallback;
    const done = () => {
      clearTimeout(fallback);
      observer.disconnect();
      resolve();
    };
    const observer = new MutationObserver(() => { if (!node.isConnected) done(); });
    observer.observe(document.body, { childList: true });

    // das Entfernen ausbleibt (abgebrochene Animation, entkoppelter Knoten).
    fallback = setTimeout(done, timeout);
  });
}

function _suspendActiveModal() {
  const overlay = activeOverlay;








  const title = overlay.querySelector('#shared-modal-title');
  const panel = overlay.querySelector('.modal-panel');
  const token = {
    overlay,
    id: overlay.id,
    title,
    titleId: title?.id ?? null,




    snapshot: _initialFormSnapshot ?? (panel ? serializeForm(panel) : null),




    dirtyGuard: _dirtyGuardEnabled,
    restoreFocus: previouslyFocused,




    trigger: document.activeElement,
  };
  if (title) title.removeAttribute('id');
  overlay.removeAttribute('id');





  overlay.inert = true;
  activeOverlay = null;
  modalState = 'confirming';
  return token;
}

// Dialog beendet, Modal darunter lebt weiter → exakt wiederherstellen.
function _resumeSuspendedModal({ overlay, id, title, titleId, snapshot, dirtyGuard = true, restoreFocus, trigger }) {
  if (!overlay.isConnected) {
    _syncOverlayRegistration();
    return;
  }
  if (id) overlay.id = id;
  if (title && titleId) title.id = titleId;

  overlay.inert = false;
  activeOverlay = overlay;
  _initialFormSnapshot = snapshot;
  _dirtyGuardEnabled = dirtyGuard;
  previouslyFocused = restoreFocus;
  document.body.style.overflow = 'hidden';
  modalState = 'open';


  document.removeEventListener('keydown', onEscape);
  document.addEventListener('keydown', onEscape);


  // Schliessen mitgenommen, kommt er hier zurueck.
  _syncOverlayRegistration();
  if (window.aashiyana?.setThemeColor) {
    window.aashiyana.setThemeColor(OVERLAY_THEME_COLOR, OVERLAY_THEME_COLOR);
  }


  if (trigger?.isConnected && overlay.contains(trigger) && typeof trigger.focus === 'function') {
    trigger.focus();
  }
}

async function _confirmOverSuspended(message, opts, suspended) {
  const pending = confirmModal(message, opts);
  const dialogOverlay = document.getElementById('shared-modal-overlay');
  try {
    const confirmed = await pending;
    await _awaitOverlayRemoval(dialogOverlay);
    return confirmed;
  } catch (err) {


    _resumeSuspendedModal(suspended);
    throw err;
  }
}




function _discardSuspendedModal({ overlay, restoreFocus }) {


  overlay.inert = false;
  activeOverlay = overlay;
  previouslyFocused = restoreFocus;
}

// --------------------------------------------------------
// _doClose - gemeinsame Cleanup-Logik
// --------------------------------------------------------

export function rememberFocus(el) {
  if (!el || !el.tagName || typeof el.focus !== 'function') return null;




  // jedes spaetere Nachfassen an seiner ersten Wache ab - das Gegenteil dessen,

  //



  if (el === document.body || el.tagName === 'BODY') return null;
  return {
    el,
    id: el.id || null,
    tag: el.tagName,

    cls: el.getAttribute?.('class') ?? null,
    data: el.dataset ? { ...el.dataset } : {},


    // `<div class="list-row" data-id="42"><button data-action="open-detail">`



    rowId: el.closest?.('[data-id]')?.dataset?.id ?? null,
  };
}

function _findAgain(memo) {
  if (memo.id) {
    const byId = document.getElementById(memo.id);
    if (byId) return byId;
  }
  const alle = Object.keys(memo.data);
  if (!alle.length && memo.rowId === null) return null;




  // (Review zu #1070).
  //





  // Schluesselfelder - `data-meal-id`, `data-entry-id`, `data-expense-id` und



  // (Review zu #1070).
  const istIdentitaet = (k) => k === 'action' || k === 'id' || /Id$/.test(k);
  const identitaet = alle.filter(istIdentitaet);
  const engerAlsAlle = identitaet.length && identitaet.length < alle.length;






  const runden = [
    { keys: alle, mitKlasse: true },
    ...(engerAlsAlle ? [{ keys: identitaet, mitKlasse: true }] : []),




    ...(identitaet.includes('action') && identitaet.some((k) => k !== 'action')
      ? [{ keys: identitaet, mitKlasse: false }]
      : []),
  ];
  for (const { keys, mitKlasse } of runden) {
    const treffer = _kandidaten(memo, keys, mitKlasse);
    if (treffer.length === 1) return treffer[0];
  }
  return null;
}

function _kandidaten(memo, keys, mitKlasse) {
  const treffer = [];
  for (const kandidat of document.getElementsByTagName(memo.tag)) {
    if (mitKlasse && kandidat.getAttribute('class') !== memo.cls) continue;
    if (!keys.every((k) => kandidat.dataset[k] === memo.data[k])) continue;
    if ((kandidat.closest?.('[data-id]')?.dataset?.id ?? null) !== memo.rowId) continue;
    treffer.push(kandidat);

    if (treffer.length > 1) break;
  }
  // MEHRDEUTIG HEISST NEIN. Bleiben mehrere Kandidaten, ist keiner davon


  // Dann lieber die Seitenwurzel.
  return treffer;
}

function _focusable(el) {
  if (el && el.id === PAGE_ROOT_ID && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  return el;
}

export function focusRestoreTarget(memo) {
  if (!memo) return null;
  if (memo.el?.isConnected) return memo.el;


  // Rueckgabewert daran vorbei haette wieder kein tabindex (Review zu #1069).
  return _focusable(_findAgain(memo) ?? document.getElementById(PAGE_ROOT_ID));
}

function _fokussiere(el) {
  if (!el || typeof el.focus !== 'function') return false;
  el.focus(el.id === PAGE_ROOT_ID ? { preventScroll: true } : undefined);
  return document.activeElement === el;
}

function _fokussiereMitRueckfall(el) {
  if (_fokussiere(el)) return el;
  const wurzel = _focusable(document.getElementById(PAGE_ROOT_ID));
  if (wurzel && wurzel !== el && _fokussiere(wurzel)) return wurzel;
  return null;
}

function _tryRefocus(memo, ziel) {






  const istRueckfall = ziel.id === PAGE_ROOT_ID;






  // nehmen keinen Fokus (Review zu #1070).
  if (ziel.isConnected && document.activeElement === ziel && !istRueckfall) return;
  if (activeOverlay) return;


  // ein besseres Ziel ihn abloesen.
  const frei = document.activeElement === document.body || document.activeElement === ziel;
  if (!frei) return;
  const ersatz = focusRestoreTarget(memo);
  if (!ersatz) return;



  // verbunden, `focusRestoreTarget` gibt sie darum unveraendert zurueck, und



  const gesetzt = _fokussiereMitRueckfall(ersatz);




  // wieder aufgebauten Knopf (Review zu #1070).
  if (gesetzt && _lastRestore) _lastRestore.ziel = gesetzt;
}

function _refocusIfDropped(memo, ziel) {
  if (typeof requestAnimationFrame !== 'function') return;
  requestAnimationFrame(() => _tryRefocus(memo, ziel));
}

export function refocusAfterRender() {
  if (!_lastRestore) return;

  //




  //



  _tryRefocus(_lastRestore.memo, _lastRestore.ziel);
}

export function forgetRestore() {
  _lastRestore = null;
}

export function restoreFocusAfterClose(memo) {
  _lastRestore = null;
  if (!memo) return null;
  const gesetzt = _fokussiereMitRueckfall(focusRestoreTarget(memo));
  if (gesetzt) {
    _lastRestore = { memo, ziel: gesetzt };
    _refocusIfDropped(memo, gesetzt);
  }
  return gesetzt;
}

function _doClose(overlayEl) {
  const target = overlayEl ?? activeOverlay;
  if (!target) return;

  target.remove();


  if (activeOverlay === target) {
    activeOverlay = null;
    modalState = 'idle';



    _syncOverlayRegistration();

    // Scroll-Lock aufheben
    document.body.style.overflow = '';

    // Focus-Restore
    const merkzettel = previouslyFocused;
    previouslyFocused = null;
    const restoreTarget = focusRestoreTarget(merkzettel);


    // spaeteren Laeufe muessen von ihr ausgehen.
    const gesetzt = _fokussiereMitRueckfall(restoreTarget);
    if (gesetzt) {

      _lastRestore = { memo: merkzettel, ziel: gesetzt };
      _refocusIfDropped(merkzettel, gesetzt);
    }

    // Standalone: Statusbar-Farbe zur aktuellen Route wiederherstellen
    if (window.aashiyana?.restoreThemeColor) {
      window.aashiyana.restoreThemeColor();
    }
  }
}

// --------------------------------------------------------

// --------------------------------------------------------

export function mountFooter(panel) {
  const bodyFooter = [...panel.querySelectorAll('.modal-panel__body .modal-panel__footer')].pop();
  if (!bodyFooter) return null;

  bodyFooter.removeAttribute('style');






  const ownerForm = bodyFooter.closest('form');
  if (ownerForm) {
    if (!ownerForm.id) ownerForm.id = `modal-form-${++_modalFormSeq}`;
    bodyFooter.querySelectorAll('button, input, select, textarea').forEach((el) => {
      if (!el.hasAttribute('form')) el.setAttribute('form', ownerForm.id);
    });
  }



  [...panel.children]
    .filter((el) => el !== bodyFooter && el.classList?.contains('modal-panel__footer'))
    .forEach((el) => el.remove());

  panel.appendChild(bodyFooter);
  return bodyFooter;
}

// --------------------------------------------------------
// Kopf-Aktion
// --------------------------------------------------------

export function updateHeaderAction(panel, { label, onClick, hidden = false } = {}) {
  const btn = panel?.querySelector('.modal-panel__action');
  if (!btn) return null;
  if (typeof label === 'string') btn.textContent = label;
  if (onClick !== undefined) btn._onAction = onClick;
  btn.hidden = hidden;
  return btn;
}

// --------------------------------------------------------
// openModal
// --------------------------------------------------------

export function openModal({
  title, content, onSave, onDelete, onClose, size = 'md',
  initialFocus = 'first-field', headerAction = null, dirtyGuard = true,
} = {}) {

  if (activeOverlay) {
    activeOverlay.removeAttribute('id');
    // force:true ensures we don't trigger another dirty check while opening a new modal
    closeModal({ force: true });
  }

  // Focus-Restore vorbereiten
  previouslyFocused = rememberFocus(document.activeElement);

  _lastRestore = null;

  // Scroll-Lock
  document.body.style.overflow = 'hidden';

  const sizeClass = size !== 'md' ? ` modal-panel--${size}` : '';




  const headerActionHtml = headerAction
    ? `<button type="button" class="modal-panel__action" id="${esc(headerAction.id ?? 'modal-header-action')}">${esc(headerAction.label)}</button>`
    : '';

  const html = `
    <div class="modal-overlay" id="shared-modal-overlay" aria-label="${t('modal.overlayLabel')}">
      <div class="modal-panel${sizeClass}" role="dialog" aria-modal="true"
           aria-labelledby="shared-modal-title">
        <div class="modal-panel__header">
          <h2 class="modal-panel__title" id="shared-modal-title">${esc(title)}</h2>
          <div class="modal-panel__header-actions">
            ${headerActionHtml}
            <button class="modal-panel__close" data-action="close-modal" aria-label="${t('modal.closeLabel')}">
              <i data-lucide="x" class="icon-md" aria-hidden="true"></i>
            </button>
          </div>
        </div>
        <div class="modal-panel__body">
          ${content}
        </div>
      </div>
    </div>`;

  _modalGeneration += 1;
  document.body.insertAdjacentHTML('beforeend', html);
  activeOverlay = document.getElementById('shared-modal-overlay');
  activeOverlay._onCloseCallback = onClose;

  // Lucide-Icons rendern
  if (window.lucide) window.lucide.createIcons({ el: activeOverlay });

  // Focus-Trap
  const panel = activeOverlay.querySelector('.modal-panel');

  mountFooter(panel);



  // Listener neu zu binden.
  const actionBtn = panel.querySelector('.modal-panel__action');
  if (actionBtn) {
    actionBtn._onAction = headerAction?.onClick;
    actionBtn.addEventListener('click', () => actionBtn._onAction?.());
  }

  trapFocus(panel, initialFocus);







  //


  // eingesammelt worden.
  _dirtyGuardEnabled = dirtyGuard;
  if (_initialFormTimeout) clearTimeout(_initialFormTimeout);
  _snapshotNow();
  _initialFormTimeout = setTimeout(_snapshotNow, 150);

  // Swipe-to-Close auf Mobile
  if (window.innerWidth < 768) {
    _wireSheetSwipe(panel);
  }


  // darunter zu wechseln (#871).
  _syncOverlayRegistration();


  activeOverlay.addEventListener('click', (e) => {
    if (e.target === activeOverlay) closeModal();
  });

  // iOS PWA: touchend als Fallback
  activeOverlay.addEventListener('touchend', (e) => {
    if (e.target === activeOverlay) closeModal();
  }, { passive: true });



  //





  // mit Leseansicht: Aufgaben, Einkauf, Vorrat, Haushalt, Rezepte.
  activeOverlay.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('[data-action="close-modal"]')) closeModal();
  });

  // Escape (nur einmal binden)
  document.removeEventListener('keydown', onEscape);
  document.addEventListener('keydown', onEscape);


  if (typeof onSave === 'function') onSave(panel);

  // Loading-State
  panel.addEventListener('submit', (e) => {
    const btn = e.target.querySelector('[type="submit"], .btn--primary');
    if (!btn || btn.disabled) return;
    btn.classList.add('btn--loading');
    requestAnimationFrame(() => {
      if (!btn.disabled) { btn.classList.remove('btn--loading'); return; }
      const mo = new MutationObserver(() => {
        if (!btn.disabled) { btn.classList.remove('btn--loading'); mo.disconnect(); }
      });
      mo.observe(btn, { attributes: true, attributeFilter: ['disabled'] });
    });
  }, { capture: true });

  // Standalone: Statusbar abdunkeln
  if (window.aashiyana?.setThemeColor) {
    window.aashiyana.setThemeColor(OVERLAY_THEME_COLOR, OVERLAY_THEME_COLOR);
  }

  modalState = 'open';
}

// --------------------------------------------------------
// closeModal
// --------------------------------------------------------

export async function closeModal({ force = false } = {}) {


  if (!activeOverlay || modalState === 'closing') return true;

  if (!force) {
    const panel = activeOverlay.querySelector('.modal-panel');
    if (panel && isFormDirty(panel)) {

      const suspended = _suspendActiveModal();

      const confirmed = await _confirmOverSuspended(t('modal.unsavedChanges'), {
        // danger: „Verwerfen" wirft Eingaben unwiderruflich weg. Als


        danger: true,
        confirmLabel: t('modal.discardChanges'),
        detail: t('modal.unsavedChangesDetail'),
      }, suspended);

      if (!confirmed) {
        // Verwerfen abgebrochen → dirty Modal exakt wiederherstellen, samt

        _resumeSuspendedModal(suspended);
        return false;
      }


      _discardSuspendedModal(suspended);
    }
  }


  modalState = 'closing';

  if (_initialFormTimeout) {
    clearTimeout(_initialFormTimeout);
    _initialFormTimeout = null;
  }
  _initialFormSnapshot = null;


  _dirtyGuardEnabled = true;

  document.removeEventListener('keydown', onEscape);

  const capturedOverlay = activeOverlay;
  const panel = capturedOverlay.querySelector('.modal-panel');

  if (typeof capturedOverlay._onCloseCallback === 'function') {
    capturedOverlay._onCloseCallback();
  }

  // Focus-Trap Cleanup
  if (focusTrapHandler) {
    if (panel) panel.removeEventListener('keydown', focusTrapHandler);
    focusTrapHandler = null;
  }
  if (panel?._onInputFocus) {
    panel.removeEventListener('focusin', panel._onInputFocus);
  }

  // Animation handling
  const isMobile = window.innerWidth < 768;
  if (isMobile && panel) {
    panel.classList.add('modal-panel--closing');

    const fallback = setTimeout(() => {
      _doClose(capturedOverlay);
    }, 400); // Slightly longer fallback
    panel.addEventListener('animationend', () => {
      clearTimeout(fallback);
      _doClose(capturedOverlay);
    }, { once: true });
    return true;
  }

  _doClose(capturedOverlay);
  return true;
}

// --------------------------------------------------------
// promptModal
// --------------------------------------------------------

export function promptModal(label, defaultValue = '') {
  return new Promise((resolve) => {
    let resolved = false;

    function finish(value) {
      if (resolved) return;
      resolved = true;
      closeModal({ force: true });
      resolve(value);
    }

    openModal({
      title: label,
      size: 'sm',
      content: `
        <form id="prompt-modal-form" class="form-stack">
          <div class="form-field">
            <label class="sr-only" for="prompt-modal-input">${esc(label)}</label>
            <input class="form-input" id="prompt-modal-input" type="text"
                   value="${esc(defaultValue)}" autocomplete="off">
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn--secondary" id="prompt-modal-cancel">${t('common.cancel')}</button>
            <button type="submit" class="btn btn--primary" id="prompt-modal-ok">${t('common.save')}</button>
          </div>
        </form>`,
      onClose: () => finish(null),
      onSave(panel) {
        const form  = panel.querySelector('#prompt-modal-form');
        const input = panel.querySelector('#prompt-modal-input');
        const cancel = panel.querySelector('#prompt-modal-cancel');

        form.addEventListener('submit', (e) => {
          e.preventDefault();
          finish(input.value.trim() || null);
        });

        cancel.addEventListener('click', () => finish(null));

        setTimeout(() => {
          input.focus();
          input.select();
        }, 50);
      },
    });
  });
}

// --------------------------------------------------------
// selectModal
// --------------------------------------------------------

export function selectModal(label, options) {
  return new Promise((resolve) => {
    let resolved = false;

    function finish(value) {
      if (resolved) return;
      resolved = true;
      closeModal({ force: true });
      resolve(value);
    }

    const optionsHtml = options
      .map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`)
      .join('');

    openModal({
      title: label,
      size: 'sm',
      content: `
        <form id="select-modal-form" class="form-stack">
          <div class="form-field">
            <label class="sr-only" for="select-modal-input">${esc(label)}</label>
            <select class="form-input" id="select-modal-input">${optionsHtml}</select>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn--secondary" id="select-modal-cancel">${t('common.cancel')}</button>
            <button type="submit" class="btn btn--primary" id="select-modal-ok">${t('common.save')}</button>
          </div>
        </form>`,
      onClose: () => finish(null),
      onSave(panel) {
        const form   = panel.querySelector('#select-modal-form');
        const select = panel.querySelector('#select-modal-input');
        const cancel = panel.querySelector('#select-modal-cancel');

        form.addEventListener('submit', (e) => {
          e.preventDefault();
          finish(select.value);
        });

        cancel.addEventListener('click', () => finish(null));
      },
    });
  });
}

// --------------------------------------------------------
// confirmModal
// --------------------------------------------------------

export function confirmModal(message, { confirmLabel, cancelLabel, danger = false, detail = null } = {}) {
  return new Promise((resolve) => {
    let resolved = false;

    function finish(value) {
      if (resolved) return;
      resolved = true;
      closeModal({ force: true });
      resolve(value);
    }

    openModal({
      title: message,
      size: 'sm',
      content: `
        ${detail ? `<p class="modal-confirm__detail">${esc(detail)}</p>` : ''}
        <div class="modal-actions">
          <button type="button" class="btn btn--secondary" id="confirm-modal-cancel">${cancelLabel ?? t('common.cancel')}</button>
          <button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" id="confirm-modal-ok">
            ${confirmLabel ?? t('common.confirm')}
          </button>
        </div>`,
      onClose: () => finish(false),
      onSave(panel) {
        panel.querySelector('#confirm-modal-ok')?.addEventListener('click', () => finish(true));
        panel.querySelector('#confirm-modal-cancel')?.addEventListener('click', () => finish(false));
      },
    });
  });
}

async function finishSuspendedConfirmation(
  confirmed,
  closeOnConfirm,
  suspended,
  { resume = _resumeSuspendedModal, close = closeModal } = {},
) {
  resume(suspended);
  if (confirmed && closeOnConfirm) await close({ force: true });
  return confirmed;
}

function createConfirmOverModal({
  getActiveOverlay = () => activeOverlay,
  getModalState = () => modalState,
  showConfirmation = confirmModal,
  suspend = _suspendActiveModal,
  confirmSuspended = _confirmOverSuspended,
  resume = _resumeSuspendedModal,
  close = closeModal,
} = {}) {
  return async function confirmOverModal(message, { closeOnConfirm = true, ...opts } = {}) {



    if (!getActiveOverlay() || getModalState() !== 'open') return showConfirmation(message, opts);

    const suspended = suspend();
    const confirmed = await confirmSuspended(message, opts, suspended);



    return finishSuspendedConfirmation(
      confirmed,
      closeOnConfirm,
      suspended,
      { resume, close },
    );
  };
}

export const confirmOverModal = createConfirmOverModal();

export const __test = {
  wireSheetSwipe: _wireSheetSwipe,
  createConfirmOverModal,
  finishSuspendedConfirmation,
};

// --------------------------------------------------------
// Validation & Feedback
// --------------------------------------------------------

let _fieldErrorSeq = 0;

function _ensureFieldError(group, input, message) {


  if (typeof group.querySelector !== 'function' || typeof group.appendChild !== 'function') return;

  let el = group.querySelector('.form-field__error');
  if (!el) {
    el = document.createElement('p');
    el.className = 'form-field__error';


    el.setAttribute?.('role', 'alert');
    el.textContent = t('common.required');



    if (typeof input.insertAdjacentElement === 'function') {
      input.insertAdjacentElement('afterend', el);
    } else {
      group.appendChild(el);
    }
  }
  if (message && el.textContent !== message) {



    if (el.dataset && el.dataset.defaultText === undefined) el.dataset.defaultText = el.textContent;
    el.textContent = message;
  } else if (!message && el.dataset && el.dataset.defaultText !== undefined) {
    el.textContent = el.dataset.defaultText;
    delete el.dataset.defaultText;
  }
  if (!el.id) el.id = `${input.id || `modal-field-${++_fieldErrorSeq}`}-error`;
  const describedBy = (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  if (!describedBy.includes(el.id)) {
    describedBy.push(el.id);
    input.setAttribute('aria-describedby', describedBy.join(' '));
  }
}

function _focusField(input) {

  // stattdessen ihren inneren Formular-Knoten fokussieren.
  const isNative = typeof input.matches === 'function' && input.matches('input, select, textarea, button');
  const focusTarget = (!isNative && typeof input.querySelector === 'function'
    ? input.querySelector('input, select, textarea')
    : null) ?? input;
  if (typeof focusTarget.focus === 'function') focusTarget.focus({ preventScroll: true });
  if (typeof input.scrollIntoView === 'function') {
    // Bewusst instant statt smooth: Chrome bricht einen laufenden Smooth-


    input.scrollIntoView({ block: 'center' });
  }
}

function _validateField(input) {
  const group = input.closest('.form-field') ?? input.parentElement;
  const hasValue = input.value.trim().length > 0;
  if (group) _ensureFieldError(group, input);
  group?.classList.toggle('form-field--error', !hasValue);
  group?.classList.toggle('form-field--valid', hasValue);
  input.setAttribute('aria-invalid', String(!hasValue));

  if (!hasValue && group) {
    const count = parseInt(group.dataset.errorCount ?? '0', 10) + 1;
    group.dataset.errorCount = String(count);
    if (count >= 2) {
      group.classList.remove('form-field--error-repeat');
      void group.offsetWidth;
      group.classList.add('form-field--error-repeat');
      group.addEventListener('animationend', () => group.classList.remove('form-field--error-repeat'), { once: true });
    }
  } else if (hasValue && group) {
    group.dataset.errorCount = '0';
  }

  return hasValue;
}

export function wireBlurValidation(formContainer) {
  formContainer.querySelectorAll('input[required], select[required], textarea[required]').forEach((input) => {
    input.addEventListener('blur', () => _validateField(input));


    input.addEventListener('input', () => {
      if (input.getAttribute('aria-invalid') === 'true') _validateField(input);
    });
  });
}

export function validateAll(formContainer) {
  let firstInvalid = null;
  let allValid = true;

  formContainer.querySelectorAll('input[required], select[required], textarea[required]').forEach((input) => {
    const valid = _validateField(input);
    if (!valid && !firstInvalid) firstInvalid = input;
    if (!valid) allValid = false;
  });

  if (firstInvalid) _focusField(firstInvalid);
  return allValid;
}

export function reportFieldError(input, message) {
  if (!input) return false;
  const group = (typeof input.closest === 'function' ? input.closest('.form-field') : null) ?? input.parentElement;
  if (!group) return false;

  _ensureFieldError(group, input, message);
  group.classList?.add('form-field--error');
  group.classList?.remove('form-field--valid');
  input.setAttribute?.('aria-invalid', 'true');
  _focusField(input);

  if (typeof input.addEventListener === 'function' && typeof input.removeEventListener === 'function') {
    const clear = () => {
      input.removeEventListener('input', clear);
      input.removeEventListener('change', clear);
      group.classList?.remove('form-field--error');
      input.setAttribute?.('aria-invalid', 'false');
      const el = typeof group.querySelector === 'function' ? group.querySelector('.form-field__error') : null;
      if (el?.dataset?.defaultText !== undefined) {
        el.textContent = el.dataset.defaultText;
        delete el.dataset.defaultText;
      }
    };
    input.addEventListener('input', clear);
    input.addEventListener('change', clear);
  }
  return false;
}

export function btnSuccess(btn, originalLabel) {
  btn.classList.remove('btn--loading');
  const label = originalLabel ?? btn.textContent;
  btn.classList.add('btn--success');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reducedMotion) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.5');
    svg.setAttribute('aria-hidden', 'true');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', '20 6 9 17 4 12');
    svg.appendChild(poly);
    btn.replaceChildren(svg);
  }
  setTimeout(() => {
    btn.classList.remove('btn--success');
    btn.textContent = label;
  }, 700);
}

export function btnLoading(btn) {
  btn.classList.add('btn--loading');
  btn.disabled = true;
  return () => {
    btn.classList.remove('btn--loading');
    btn.disabled = false;
  };
}

export function btnError(btn) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    btn.classList.add('btn--error-static');
    setTimeout(() => btn.classList.remove('btn--error-static'), 700);
    return;
  }
  btn.classList.remove('btn--shaking');
  void btn.offsetWidth;
  btn.classList.add('btn--shaking');
  btn.addEventListener('animationend', () => btn.classList.remove('btn--shaking'), { once: true });
}

// --------------------------------------------------------
// Progressive Disclosure: „Weitere Einstellungen"
// --------------------------------------------------------

export function advancedSection(innerHtml, { label, open = false } = {}) {
  return `
    <details class="form-advanced"${open ? ' open' : ''}>
      <summary class="form-advanced__summary">
        <span>${esc(label ?? t('modal.moreSettings'))}</span>
        <i data-lucide="chevron-down" class="form-advanced__chevron" aria-hidden="true"></i>
      </summary>
      <div class="form-advanced__body">
        ${innerHtml}
      </div>
    </details>`;
}
