
import { api } from '/api.js';
import { stagger, vibrate, scheduleUndoableDelete } from '/utils/ux.js';
import { wireSwipeRows, maybeShowSwipeHint } from '/utils/swipe-row.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { promptModal, openModal, closeModal, confirmModal, reportFieldError, refocusAfterRender } from '/components/modal.js';
import { DEFAULT_CATEGORY_NAME, categoryLabel } from '/utils/shopping-categories.js';
import { addLocalDays, todayKey } from '/utils/date.js';
import { renderKitchenTabsBar, refreshKitchenBadges } from '/utils/kitchen-tabs.js';
import { mountEmptyState, mountLoadError } from '/utils/empty-state.js';
import { popoverMenuHtml, installPopoverMenus } from '/utils/popover-menu.js';
import '/components/category-manager.js';
import { findPageFab } from '/utils/fab.js';
import { setBulkPill, clearBulkPill, bulkPillLayer } from '/utils/bulk-pill.js';
import { makeSortable } from '/utils/sortable.js';
import { amountPlaceholder, centsToAmountInput, amountInputToCents, toDecimalString, breaksOffAtSeparator } from '/utils/money.js';
import { startLiveFeed } from '/utils/live-feed.js';
import { createPageController } from '/utils/page-lifecycle.js';


// --------------------------------------------------------
// Konstanten
// --------------------------------------------------------

function catIcon(name) {
  return state.categories.find((c) => c.name === name)?.icon ?? 'tag';
}

/** Kategorienamen in DB-Reihenfolge. */
function categoryNames() {
  return state.categories.map((c) => c.name);
}

// --------------------------------------------------------
// State
// --------------------------------------------------------

const state = {
  lists:         [],
  activeListId:  null,
  items:         [],
  activeList:    null,
  categories:    [],   // { id, name, icon, sort_order }[]
  stores:        [],   // verwaltete Laeden fuer den Preis am Artikel (#1003)
  currency:      'INR',// Haushaltswaehrung, nur fuer die Preisdarstellung
  listsError:    null,
  itemsError:    null,
  currentUserId: null,
  collapsedCategories: new Set(),
};

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

function groupItemsByCategory(items) {
  const grouped = {};
  for (const item of items) {
    const cat = item.category || (state.categories[0]?.name ?? DEFAULT_CATEGORY_NAME);
    (grouped[cat] = grouped[cat] || []).push(item);
  }

  const names   = categoryNames();
  const known   = names.filter((c) => grouped[c]).map((c) => [c, grouped[c]]);
  const unknown = Object.keys(grouped).filter((c) => !names.includes(c)).map((c) => [c, grouped[c]]);
  return [...known, ...unknown];
}

// --------------------------------------------------------
// Kategorie-Einklappen (#1039)
//



// geteilte Zeile haette â€žMoabit" und â€žNeukoelln" dieselbe Klapp-Ansicht

// zugeklappt vorgesetzt.
//



// normalisierten Namen zurueck - das einzige, was sie stabil identifiziert.
// --------------------------------------------------------

const COLLAPSED_CATEGORIES_VERSION = 1;

function collapsedCategoriesStorageKey(userId, listId) {
  return `aashiyana:shopping:collapsedCategories:v${COLLAPSED_CATEGORIES_VERSION}:${userId ?? 'anon'}:${listId}`;
}

function categoryStorageKey(name) {
  const known = state.categories.find((c) => c.name === name);
  return known ? `id:${known.id}` : `name:${String(name ?? '').trim().toLowerCase()}`;
}

function loadCollapsedCategories(userId, listId) {
  try {
    const raw = JSON.parse(localStorage.getItem(collapsedCategoriesStorageKey(userId, listId)) ?? 'null');
    if (!raw || raw.version !== COLLAPSED_CATEGORIES_VERSION || !Array.isArray(raw.collapsed)) {
      return new Set();
    }
    return new Set(raw.collapsed.filter((key) => typeof key === 'string'));
  } catch {
    // Privatmodus/kaputtes JSON/Quota: die Gruppen starten dann offen, statt

    return new Set();
  }
}

function saveCollapsedCategories(userId, listId, collapsedSet) {
  try {
    localStorage.setItem(
      collapsedCategoriesStorageKey(userId, listId),
      JSON.stringify({ version: COLLAPSED_CATEGORIES_VERSION, collapsed: [...collapsedSet] }),
    );
  } catch { /* Privatmodus/Quota: der Zustand gilt dann nur fuer diese Sitzung */ }
}

function pruneCollapsedCategories(groups) {
  const validKeys = new Set(groups.map(([cat]) => categoryStorageKey(cat)));
  let changed = false;
  for (const key of [...state.collapsedCategories]) {
    if (!validKeys.has(key)) {
      state.collapsedCategories.delete(key);
      changed = true;
    }
  }
  if (changed) saveCollapsedCategories(state.currentUserId, state.activeListId, state.collapsedCategories);
}

function toggleCategoryCollapse(button) {
  const key = button.dataset.categoryToggle;
  const rowsEl = button.closest('.list-group')?.querySelector('.list-rows');
  const chevron = button.querySelector('.list-group__chevron');
  const nowCollapsed = !state.collapsedCategories.has(key);

  if (nowCollapsed) state.collapsedCategories.add(key);
  else state.collapsedCategories.delete(key);

  button.setAttribute('aria-expanded', String(!nowCollapsed));
  chevron?.classList.toggle('list-group__chevron--collapsed', nowCollapsed);
  if (rowsEl) rowsEl.hidden = nowCollapsed;

  saveCollapsedCategories(state.currentUserId, state.activeListId, state.collapsedCategories);
}

function shouldIgnoreShoppingRowToggle(target) {
  return Boolean(target?.closest?.('button, a, input, select, textarea, [data-no-row-toggle]'));
}

// --------------------------------------------------------
// Sammelaktions-Pille: Zustandsautomat (#1039)
//





//
// JETZT vier Zustaende:

//   visible    - Pille steht, Fuenf-Sekunden-Frist laeuft




//                erneut, bis sie auf 0 faellt
//








// Dokument, bevor er etwas anfasst.
// --------------------------------------------------------

let BULK_PILL_HOLD_MS_OVERRIDE = null; // nur fuer Tests, siehe __test unten
const BULK_PILL_HOLD_MS = 5000;

let pillTimer = null;
let pillPhase = 'idle'; // 'idle' | 'visible' | 'deferred' | 'suppressed'
let pillInteracting = false;
let pillOwnerContainer = null;

function clearPillTimer() {
  if (pillTimer) { clearTimeout(pillTimer); pillTimer = null; }
}

function schedulePillHide(container) {
  clearPillTimer();
  pillTimer = setTimeout(() => {
    pillTimer = null;


    // Listenwechsel/Seitenaufbau selbst per `clearPillTimer()` auf, deshalb

    if (!container.isConnected) return;
    if (pillInteracting) { pillPhase = 'deferred'; return; }
    pillPhase = 'suppressed';
    clearBulkPill();
  }, BULK_PILL_HOLD_MS_OVERRIDE ?? BULK_PILL_HOLD_MS);
}

function wirePillInteractionGuards() {
  const layer = bulkPillLayer();
  if (!layer || layer.dataset.shoppingPillWired) return;
  layer.dataset.shoppingPillWired = '1';

  layer.addEventListener('mouseenter', () => { pillInteracting = true; });
  layer.addEventListener('focusin', () => { pillInteracting = true; });

  const endInteraction = () => {
    pillInteracting = false;
    if (pillPhase !== 'deferred') return;
    pillPhase = 'suppressed';





    // 'deferred' vom letzten Einkaufsbesuch war.
    if (pillOwnerContainer?.isConnected) clearBulkPill();
  };
  layer.addEventListener('mouseleave', endInteraction);
  layer.addEventListener('focusout', (e) => {
    if (layer.contains(e.relatedTarget)) return; // Fokus bleibt innerhalb der Pille
    endInteraction();
  });
}

function resetPillMachine() {
  clearPillTimer();
  pillPhase = 'idle';
  pillInteracting = false;
  pillOwnerContainer = null;
}

const intents = new Map();
let _checkSeq = 0;
const pendingRemovals = new Map();
const settledAt = new Map();

let _loadSeq = 0;
const _appliedLoad = new Map();
const _loadsInFlight = new Set();

function beginLoad() {
  const startedAt = ++_loadSeq;
  _loadsInFlight.add(startedAt);
  return startedAt;
}

function endLoad(startedAt) {
  _loadsInFlight.delete(startedAt);
  pruneSettledRemovals();
}

function removalHides(entry, startedAt) {
  return entry.removedAt == null || entry.removedAt >= startedAt;
}

function confirmRemovals(ids) {
  for (const id of ids) {
    const entry = pendingRemovals.get(id);
    if (entry) entry.removedAt = _loadSeq;
  }
  pruneSettledRemovals();
}

function pruneSettledRemovals() {
  let oldest = Infinity;
  for (const seq of _loadsInFlight) if (seq < oldest) oldest = seq;
  for (const [id, entry] of pendingRemovals) {
    if (entry.removedAt != null && entry.removedAt < oldest) pendingRemovals.delete(id);
  }
}
let _itemsListId = null;

function clearItems() {
  state.items = [];
  _itemsListId = null;
}

function checkedOf(item) {
  const intent = intents.get(item?.id);
  return intent ? intent.value : (item?.is_checked ?? 0);
}

function settleIntents(items, listId, { fromCache = false, startedAt = 0 } = {}) {



  if (fromCache) return;
  for (const item of items) {
    const intent = intents.get(item.id);
    if (!intent || intent.listId !== listId) continue;

    const erfuellt = item.is_checked === intent.value;


    const bestaetigt = settledAt.get(item.id);
    const ueberholt = bestaetigt != null && bestaetigt < startedAt;
    if (erfuellt || ueberholt) intents.delete(item.id);
  }
}

async function toggleShoppingItem(id, checked, container) {
  const newVal = checked ? 0 : 1;
  const listId = state.activeListId;
  const item   = state.items.find((i) => i.id === id);


  //


  // Schreibvorgang spaeter schweigend scheitert (er ist ja ueberstimmt).
  //




  const vorher = intents.get(id);
  if (vorher) updateListCounter(vorher.listId, 0, -vorher.delta);



  // ihre eigene Buchung.
  const delta = (newVal ? 1 : 0) - (item?.is_checked ? 1 : 0);

  const seq = ++_checkSeq;
  intents.set(id, { value: newVal, seq, listId, delta });
  if (item) {


    updateItemRow(container, item);

    // Artikels eroeffnet keinen neuen Feedback-Batch.
    updateCheckedActions(container, { userChecked: newVal === 1 });
    updateListCounter(listId, 0, delta);
    renderTabs(container);
  }

  try {
    acknowledgeOwnChange(await api.patch(`/shopping/items/${id}`, { is_checked: newVal }));



    //



    // spaeteren Antippen gehoert.



    const current = state.items.find((i) => i.id === id);
    if (current) {





      const offen = intents.get(id);
      if (offen) offen.delta -= (newVal ? 1 : 0) - (current.is_checked ? 1 : 0);
      current.is_checked = newVal;
    }
    settledAt.set(id, _loadSeq);
    vibrate(10);
  } catch (err) {

    // auseinander. Ueberstimmt: ein neueres Antippen steht an, dessen Ausgang




    const intent = intents.get(id);
    if (intent && intent.seq !== seq) return;
    if (intent) {




      intents.delete(id);


      updateListCounter(intent.listId, 0, -intent.delta);
      const current = state.items.find((i) => i.id === id);
      if (current) {
        updateItemRow(container, current);
        updateCheckedActions(container);
      }
      renderTabs(container);
    }
    window.aashiyana.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
  }
}

function deleteItemUndoable(id, container) {
  const item     = state.items.find((i) => i.id === id);
  const snapshot = item ? { ...item } : null;




  //



  // Mal (gemessen: `item_total: 0, item_checked: -1`). Mit getrennter Absicht

  const gebucht = Boolean(item && checkedOf(item));



  // gemessen `item_checked: -1` an einer einelementigen Liste.
  const offen = intents.get(id);
  if (offen) offen.delta = 0;


  // `state.items` samt `state.activeListId` aus. Wer danach zurueckholte, legte


  // treffen.
  const listId = state.activeListId;



  pendingRemovals.set(id, { listId, checked: gebucht, removedAt: null });
  state.items = state.items.filter((i) => i.id !== id);
  updateItemsList(container);
  updateListCounter(listId, -1, gebucht ? -1 : 0);
  renderTabs(container);

  scheduleUndoableDelete({
    message: t('shopping.itemDeletedToast', { name: snapshot?.name ?? '' }),
    commit: async ({ keepalive }) => {
      let response;
      try {
        response = await api.delete(`/shopping/items/${id}`, { keepalive });
      } catch (err) {

        // jede Antwort darf sie wieder tragen - sofort, nicht erst spaeter.
        pendingRemovals.delete(id);
        throw err;
      }
      acknowledgeOwnChange(response);


      confirmRemovals([id]);




      intents.delete(id);
    },
    restore: (err) => {
      pendingRemovals.delete(id);
      if (snapshot) {




        // wieder da ist - sonst stuende sie zweimal.
        if (state.activeListId === listId && !state.items.some((i) => i.id === id)) {
          state.items.push(snapshot);
          state.items.sort((a, b) => a.id - b.id);
          updateItemsList(container);
        }



        // Serverstand des Schnappschusses.
        if (offen && intents.get(id) === offen) {
          offen.delta = (offen.value ? 1 : 0) - (snapshot.is_checked ? 1 : 0);
        }
        updateListCounter(listId, 1, checkedOf(snapshot) ? 1 : 0);
        renderTabs(container);
      }
      if (err) window.aashiyana.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
    },
  });
}

// --------------------------------------------------------
// Render-Bausteine
// --------------------------------------------------------

function renderTabs(container) {
  const bar = container.querySelector('#list-tabs-bar');
  if (!bar) return;

  const tabsHtml = state.lists.map((list) => {
    const unchecked = list.item_total - list.item_checked;



    return `
      <button class="list-tab ${list.id === state.activeListId ? 'list-tab--active' : ''}"
              data-action="switch-list" data-id="${list.id}"
              ${list.item_total > 0 ? `aria-label="${esc(list.name)}, ${esc(t('nav.shoppingOpen', { count: unchecked }))}"` : ''}>
        ${esc(list.name)}
        ${list.item_total > 0 ? `<span class="list-tab__count" aria-hidden="true">${unchecked > 0 ? unchecked : 'âœ“'}</span>` : ''}
      </button>`;
  }).join('');

  bar.replaceChildren();


  //





  //




  // hier abgeschnitten worden.
  const actionsHtml = state.activeList ? `
    <div class="list-tabs-bar__actions">
      ${popoverMenuHtml({
        id: 'list-actions-menu',



        label: t('shopping.listActionsLabel', { name: state.activeList.name }),
        items: [
          { action: 'rename-list', label: t('shopping.renameListLabel'), icon: 'pencil', id: state.activeList.id },
          { action: 'duplicate-list', label: t('shopping.duplicateListLabel'), icon: 'copy' },
          { action: 'import-meals', label: t('shopping.importMeals'), icon: 'utensils' },
          { action: 'send-list', label: t('shopping.sendList'), icon: 'mail' },
          { action: 'manage-categories', label: t('shopping.manageCategories'), icon: 'tags' },
          { action: 'manage-stores', label: t('shopping.manageStores'), icon: 'store' },
          { action: 'delete-list', label: t('shopping.deleteListLabel'), icon: 'trash', id: state.activeList.id, danger: true },
        ],
      })}
    </div>` : '';

  bar.insertAdjacentHTML('beforeend', `
    <i data-lucide="list" class="list-tabs-bar__marker" aria-hidden="true"></i>
    ${tabsHtml}
    <button class="list-tab__new" data-action="new-list" aria-label="${t('shopping.newListButton')}">
      <i data-lucide="plus" class="icon-md" aria-hidden="true"></i>
    </button>
    ${actionsHtml}
  `);
  if (window.lucide) window.lucide.createIcons({ el: bar });
}

async function openSendListDialog(container) {
  const listId = state.activeListId;
  const openCount = state.items.filter((item) => !checkedOf(item)).length;
  if (!openCount) {
    window.aashiyana.showToast(t('shopping.sendListEmpty'), 'warning');
    return;
  }

  let members = [];
  try {




    //



    // Route laesst ihn dann weg).
    const res = await api.get('/shopping/send-recipients');
    members = res.data || [];
  } catch {
    window.aashiyana.showToast(t('common.errorGeneric'), 'danger');
    return;
  }






  if (state.activeListId !== listId) return;

  if (!members.length) {
    window.aashiyana.showToast(t('shopping.sendListNoRecipients'), 'warning');
    return;
  }

  openModal({
    title: t('shopping.sendListTitle'),
    content: `
      <p class="form-hint">${esc(t('shopping.sendListDescription', { count: openCount }))}</p>
      <div class="form-group">
        <label class="form-label" for="send-list-recipient">${esc(t('shopping.sendListRecipient'))}</label>
        <select id="send-list-recipient" class="form-input">
          ${members.map((m) => `<option value="${m.id}">${esc(m.display_name)}</option>`).join('')}
        </select>
      </div>
      <p class="form-hint">${esc(t('shopping.sendListSnapshotHint'))}</p>
      <div class="modal-panel__footer modal-panel__footer--plain">
        <button type="button" class="btn btn--secondary" data-action="close-modal">${esc(t('common.cancel'))}</button>
        <button type="button" class="btn btn--primary" id="send-list-confirm">${esc(t('shopping.sendListSubmit'))}</button>
      </div>`,
    onSave(panel) {
      panel.querySelector('#send-list-confirm').addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        const select = panel.querySelector('#send-list-recipient');
        const userId = Number(select.value);
        const name = members.find((m) => m.id === userId)?.display_name ?? '';
        btn.disabled = true;
        try {
          await api.post(`/shopping/${listId}/send`, { userId });
          closeModal({ force: true });

          // 50 Bestaetigungen dauerhaft stummgeschaltet (`TOAST_SUCCESS_MAX` in





          window.aashiyana.showToast(t('shopping.sendListSent', { name }), 'info');
        } catch (err) {




          const byReason = {
            recipient_no_email: 'shopping.sendListRecipientNoEmail',
            smtp_unconfigured: 'shopping.sendListSmtpMissing',
            nothing_open: 'shopping.sendListEmpty',
          }[err.data?.reason];
          window.aashiyana.showToast(
            byReason ? t(byReason) : (err.data?.error ?? t('shopping.sendListError')),
            'danger',
          );
          btn.disabled = false;
        }
      });
    },
  });
}

async function openDuplicateListDialog(container) {
  const source = state.activeList;
  if (!source) return;

  openModal({
    title: t('shopping.duplicateListTitle', { name: source.name }),
    content: `
      <div class="form-group">
        <label class="form-label" for="duplicate-list-name">${esc(t('shopping.duplicateListNameLabel'))}</label>
        <input class="form-input" type="text" id="duplicate-list-name"
               value="${esc(t('shopping.duplicateDefaultName', { name: source.name }))}" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="toggle">
          <input type="checkbox" id="duplicate-reset-checked" checked>
          <span class="toggle__track"></span>
          <span>${esc(t('shopping.duplicateResetChecked'))}</span>
        </label>
      </div>
      <div class="form-group">
        <label class="toggle">
          <input type="checkbox" id="duplicate-keep-quantities" checked>
          <span class="toggle__track"></span>
          <span>${esc(t('shopping.duplicateKeepQuantities'))}</span>
        </label>
      </div>
      <div class="form-group">
        <label class="toggle">
          <input type="checkbox" id="duplicate-keep-notes" checked>
          <span class="toggle__track"></span>
          <span>${esc(t('shopping.duplicateKeepNotes'))}</span>
        </label>
      </div>
      <div class="modal-panel__footer modal-panel__footer--plain">
        <button type="button" class="btn btn--secondary" data-action="close-modal">${esc(t('common.cancel'))}</button>
        <button type="button" class="btn btn--primary" id="duplicate-list-confirm">${esc(t('shopping.duplicateSubmit'))}</button>
      </div>`,
    onSave(panel) {
      panel.querySelector('#duplicate-list-confirm').addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        const name = panel.querySelector('#duplicate-list-name').value.trim();
        if (!name) {
          reportFieldError(panel.querySelector('#duplicate-list-name'), t('common.nameRequired'));
          return;
        }
        const resetChecked   = panel.querySelector('#duplicate-reset-checked').checked;
        const keepQuantities = panel.querySelector('#duplicate-keep-quantities').checked;
        const keepNotes      = panel.querySelector('#duplicate-keep-notes').checked;

        btn.disabled = true;
        try {
          const data = await api.post(`/shopping/${source.id}/duplicate`, {
            name, resetChecked, keepQuantities, keepNotes,
          });
          const itemTotal   = state.items.length;
          const itemChecked = resetChecked ? 0 : state.items.filter(checkedOf).length;
          state.lists.push({ ...data.data, item_total: itemTotal, item_checked: itemChecked });
          closeModal({ force: true });
          await switchList(data.data.id, container);
          refocusAfterRender();
        } catch (err) {
          window.aashiyana.showToast(err.data?.error ?? t('shopping.duplicateError'), 'danger');
          btn.disabled = false;
        }
      });
    },
  });
}

function renderListContent(container) {
  const content = container.querySelector('#list-content');
  if (!content) return;
  content.removeAttribute('aria-busy');





  // Ausweg angeboten (Critique P0, 2026-07-30).
  if (state.listsError) {
    mountLoadError(content, {
      title: t('shopping.listsLoadError'),
      description: t('common.loadErrorDescription'),
      error: state.listsError,
      retryLabel: t('common.retry'),


      onRetry: () => render(container, { user: { id: state.currentUserId }, signal: _routeSignal }),
    });
    return;
  }

  if (!state.activeList) {


    // Geteilter Renderer (utils/empty-state.js), damit dieser Zustand dieselbe

    mountEmptyState(content, {
      icon: 'shopping-cart',
      title: t('shopping.noLists'),
      description: t('shopping.noListsDescription'),



      hint: t('shopping.noListsHint'),
      action: {
        label: t('shopping.newListButton'),
        icon: 'plus',
        onClick: () => container.querySelector('[data-action="new-list"]')?.click(),
      },
    });
    return;
  }

  content.replaceChildren();
  content.insertAdjacentHTML('beforeend', `
    <!-- Quick-Add -->
    <div class="quick-add">
      <form class="quick-add__form" id="quick-add-form" novalidate autocomplete="off">
        <div class="quick-add__input-wrap">
          <input class="quick-add__input" type="text" id="item-name-input"
                 placeholder="${t('shopping.itemNamePlaceholder')}" aria-label="${t('shopping.itemNameLabel')}" autocomplete="off">
          <div class="autocomplete-dropdown" id="autocomplete-dropdown" hidden></div>
        </div>
        <input class="quick-add__qty" type="text" id="item-qty-input"
               placeholder="${t('shopping.itemQtyPlaceholder')}" aria-label="${t('shopping.itemQtyLabel')}" autocomplete="off">
        <select class="quick-add__cat" id="item-cat-select" aria-label="${t('shopping.categoryLabel')}">
          ${state.categories.map((c) => `<option value="${esc(c.name)}" ${c.name === DEFAULT_CATEGORY_NAME ? 'selected' : ''}>${esc(categoryLabel(c.name))}</option>`).join('')}
        </select>
        <button class="quick-add__btn" type="submit" aria-label="${t('shopping.addItemLabel')}">
          <i data-lucide="plus" class="icon-lg" aria-hidden="true"></i>
        </button>
      </form>
    </div>

    <!-- Die Sammelaktions-Leiste stand hier als statischer Block Ã¼ber der
         Liste. Seit Etappe 5 ist sie eine Pille in der unteren Shell-Zone
         (utils/bulk-pill.js) - der Grund steht dort und an .list-bulkbar in
         layout.css: 103px ListenflÃ¤che fÃ¼r einen einzigen abgehakten Artikel.
         Die alte BegrÃ¼ndung (â€žGeschwister der Liste, nicht Kind: mountItems()
         leert
         mehr in dieser Seite hÃ¤ngt, kann von ihrem Rendern nicht getroffen
         werden. -->

    <!-- Artikel-Liste; Inhalt via mountItems(), damit der Leerzustand Ã¼ber den
         geteilten Renderer lÃ¤uft statt als HTML-String hier drin. -->
    <div class="list-scroller page-scrollport items-list" id="items-list"></div>

    <!-- Ansage fÃ¼r Umsortierungen (#678), wie im Kategorie-Manager: das
         aria-label des Griffs allein ist zu leise - ob ein Screenreader die
         Label-Ã„nderung am fokussierten Element vorliest, ist von Programm zu
         Programm verschieden. Eine Live-Region ist die verlÃ¤ssliche Zusage. -->
    <div class="sr-only" role="status" aria-live="polite" id="items-reorder-announce"></div>
  `);




  //





  updateItemsList(container);



  if (window.lucide) window.lucide.createIcons({ el: content });
  wireAutocomplete(container);
  wireQuickAdd(container);
  syncQuickAddDisclosure(container, false);
}

function mountItems(listEl, container) {
  if (!listEl) return;




  if (state.itemsError) {
    mountLoadError(listEl, {
      title: t('shopping.itemsLoadError'),
      description: t('common.loadErrorDescription'),
      error: state.itemsError,
      retryLabel: t('common.retry'),
      onRetry: container
        ? () => switchList(state.activeListId, container)
        : undefined,
    });
    return;
  }

  if (!state.items.length) {
    mountEmptyState(listEl, {
      icon: 'shopping-cart',
      title: t('shopping.emptyList'),
      description: t('shopping.emptyListDescription'),
      hint: t('emptyHint.shopping'),
      action: {
        label: t('shopping.emptyAction'),
        icon: 'plus',
        onClick: () => document.querySelector('.page-fab')?.click(),
      },
    });
    return;
  }

  listEl.replaceChildren();
  listEl.insertAdjacentHTML('beforeend', renderItems());
}

function renderItems() {
  const groups = groupItemsByCategory(state.items);
  pruneCollapsedCategories(groups);
  // Geteilte Gruppen-Grammatik (styles/list-row.css): .list-group ordnet,



  //




  // zuzuklappen.
  return groups.map(([cat, items], idx) => {
    const key = categoryStorageKey(cat);
    const collapsed = state.collapsedCategories.has(key);
    const rowsId = `shopping-category-rows-${idx}`;
    return `
    <div class="list-group item-category" data-category="${esc(cat)}">
      <h2 class="list-group__title">
        <button type="button" class="list-group__toggle" data-category-toggle="${esc(key)}"
                aria-expanded="${collapsed ? 'false' : 'true'}" aria-controls="${rowsId}">
          <i data-lucide="chevron-down" aria-hidden="true"
             class="list-group__chevron${collapsed ? ' list-group__chevron--collapsed' : ''}"></i>
          <i data-lucide="${catIcon(cat)}" class="icon-sm" aria-hidden="true"></i>
          <span>${esc(categoryLabel(cat))}</span>
        </button>
        <span class="list-group__count">${items.length}</span>
      </h2>
      <div class="list-rows" id="${rowsId}" ${collapsed ? 'hidden' : ''}>
        ${items.map(renderItem).join('')}
      </div>
    </div>`;
  }).join('');
}

function renderItemMeta(item) {
  const bits = [];
  if (item.url)   bits.push('<i data-lucide="link" class="item-meta__icon" aria-hidden="true"></i>');
  if (item.notes) bits.push('<i data-lucide="sticky-note" class="item-meta__icon" aria-hidden="true"></i>');
  return bits.length ? `<span class="item-meta">${bits.join('')}</span>` : '';
}





const ITEM_TAGS_VISIBLE = 1;

function renderItemTags(tags) {
  if (!tags?.length) return '';
  const shown = tags.slice(0, ITEM_TAGS_VISIBLE);
  const rest  = tags.length - shown.length;
  const chips = shown.map((tag) => `<span class="list-row__tag">${esc(tag)}</span>`);
  if (rest > 0) {
    chips.push(`<span class="list-row__tag list-row__tag--more"
                      title="${esc(tags.slice(ITEM_TAGS_VISIBLE).join(', '))}">+${rest}</span>`);
  }



  // ganze Streuung des Einkaufs.
  return chips.join('');
}

function renderItem(item) {
  const isDone = Boolean(checkedOf(item));
  return `
    <div class="swipe-row" data-swipe-id="${item.id}" data-swipe-checked="${checkedOf(item)}">
      <div class="swipe-reveal swipe-reveal--done swipe-reveal--leading" aria-hidden="true">
        <i data-lucide="${isDone ? 'rotate-ccw' : 'check'}" class="icon-xl" aria-hidden="true"></i>
        <span>${isDone ? t('shopping.swipeBack') : t('shopping.swipeCheck')}</span>
      </div>
      <div class="swipe-reveal swipe-reveal--delete swipe-reveal--trailing" aria-hidden="true">
        <i data-lucide="trash-2" class="icon-xl" aria-hidden="true"></i>
        <span>${t('shopping.swipeDelete')}</span>
      </div>
      <div class="list-row shopping-item ${isDone ? 'shopping-item--checked' : ''}"
           data-item-id="${item.id}">
        <button class="item-check ${isDone ? 'item-check--checked' : ''}"
                data-action="toggle-item" data-id="${item.id}" data-checked="${checkedOf(item)}"
                aria-label="${isDone ? t('shopping.markUndoneLabel', { name: esc(item.name) }) : t('shopping.markDoneLabel', { name: esc(item.name) })}">
          <i data-lucide="check" class="item-check__icon" aria-hidden="true"></i>
        </button>
        <div class="list-row__main">
          <div class="list-row__name">${esc(item.name)}${renderItemMeta(item)}</div>
          ${item.quantity || item.tags?.length ? `<div class="list-row__meta">
            ${item.quantity ? `<span class="shopping-item__quantity">${esc(item.quantity)}</span>` : ''}
            ${renderItemTags(item.tags)}
          </div>` : ''}
        </div>
        <!-- Geteilte .row-action-Grammatik aus layout.css (app-weit von sieben
             Modulen genutzt), gruppiert in der geteilten .list-row__actions -
             vorher hingen die zwei Buttons als direkte Flex-Kinder in der Zeile,
             wodurch die Bedienzone in jedem Tab anders zusammengesetzt war. -->
        <div class="list-row__actions">
          <!-- Griff fÃ¼r die Handsortierung (#678). Ein BUTTON, kein role="img"
               wie im Kategorie-Manager: dort steht daneben ein Auf/Ab-Paar als
               Tastaturpfad, hier trÃ¤gt der Griff ihn selbst (Pfeiltasten bei
               Fokus). Die Einkaufszeile hat schon Abhaken, Details, LÃ¶schen und
               zwei Wischgesten - zwei weitere KnÃ¶pfe hÃ¤tten die Bedienzone auf
               dem Handy zugestellt. -->
          <button class="row-action list-row__drag" data-action="reorder-handle" data-id="${item.id}"
                  aria-label="${t('shopping.reorderHandle', { name: esc(item.name) })}"
                  title="${t('shopping.reorderHandleHint')}">
            <i data-lucide="grip-vertical" class="icon-md" aria-hidden="true"></i>
          </button>
          <button class="row-action" data-action="item-details" data-id="${item.id}"
                  aria-label="${t('shopping.detailsLabel', { name: esc(item.name) })}">
            <i data-lucide="pencil" class="icon-md" aria-hidden="true"></i>
          </button>
          <button class="row-action row-action--danger" data-action="delete-item" data-id="${item.id}"
                  aria-label="${t('shopping.deleteItemLabel', { name: esc(item.name) })}">
            ${/* trash-2 statt x: das Kreuz heisst app-weit â€žSchliessen"
                 (Modals, Chips), Loeschen traegt ueberall den Papierkorb
                 (Aufgaben, Geburtstage, Mahlzeiten). Der Einkauf war die eine
                 Zeile, die fuer dieselbe Tat ein anderes Zeichen sprach
                 (Critique 2026-08-27, P3). */ ''}
            <i data-lucide="trash-2" class="icon-md" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </div>`;
}

// --------------------------------------------------------
// Autocomplete
// --------------------------------------------------------

let autocompleteTimeout = null;

function applyAutocompleteSuggestion(container, el) {
  const nameInput = container.querySelector('#item-name-input');
  const qtyInput  = container.querySelector('#item-qty-input');
  const catSelect = container.querySelector('#item-cat-select');
  if (!nameInput) return;

  nameInput.value = el.dataset.name ?? '';
  if (catSelect && el.dataset.category
    && [...catSelect.options].some((o) => o.value === el.dataset.category)) {
    catSelect.value = el.dataset.category;
  }
  if (qtyInput && el.dataset.quantity) {
    qtyInput.value = el.dataset.quantity;
  }
}

function wireAutocomplete(container) {
  const input    = container.querySelector('#item-name-input');
  const dropdown = container.querySelector('#autocomplete-dropdown');
  if (!input || !dropdown) return;

  let activeIdx = -1;

  input.addEventListener('input', () => {
    clearTimeout(autocompleteTimeout);
    const q = input.value.trim();
    if (q.length < 1) { dropdown.hidden = true; return; }

    autocompleteTimeout = setTimeout(async () => {
      try {
        const data = await api.get(`/shopping/suggestions?q=${encodeURIComponent(q)}`);
        const suggestions = data.data ?? [];
        if (!suggestions.length) { dropdown.hidden = true; return; }

        dropdown.replaceChildren();


        dropdown.insertAdjacentHTML('beforeend', suggestions.map((s, i) =>
          `<div class="autocomplete-item" data-idx="${i}" data-name="${esc(s.name)}"
                data-category="${esc(s.category ?? '')}" data-quantity="${esc(s.quantity ?? '')}">${esc(s.name)}</div>`
        ).join(''));
        dropdown.hidden = false;
        activeIdx = -1;

        dropdown.querySelectorAll('.autocomplete-item').forEach((el) => {
          el.addEventListener('mousedown', (e) => {
            e.preventDefault();
            applyAutocompleteSuggestion(container, el);
            dropdown.hidden = true;
          });
        });

        if (window.lucide) window.lucide.createIcons({ el: dropdown });
      } catch { dropdown.hidden = true; }
    }, 200);
  });

  input.addEventListener('keydown', (e) => {
    if (dropdown.hidden) return;
    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('autocomplete-item--active', i === activeIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      items.forEach((el, i) => el.classList.toggle('autocomplete-item--active', i === activeIdx));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      applyAutocompleteSuggestion(container, items[activeIdx]);
      dropdown.hidden = true;
    } else if (e.key === 'Escape') {
      dropdown.hidden = true;
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { dropdown.hidden = true; }, 150);
  });
}

// --------------------------------------------------------
// Quick-Add Form
// --------------------------------------------------------

function _flashAddBtn(btn) {
  if (!btn) return;
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

  const saved = [...btn.childNodes];
  btn.classList.add('btn--success');
  btn.replaceChildren(svg);
  setTimeout(() => {
    btn.classList.remove('btn--success');
    btn.replaceChildren(...saved);
    if (window.lucide) window.lucide.createIcons({ el: btn });
  }, 700);
}

// --------------------------------------------------------

// --------------------------------------------------------

function syncQuickAddDisclosure(container, open) {
  const page = container.querySelector('.shopping-page');
  const fab = findPageFab('fab-new-item');
  if (!page || !fab) return;

  const collapsible = window.matchMedia('(hover: none)').matches && Boolean(state.activeList);
  page.classList.toggle('shopping-page--adding', collapsible && open);




  if (collapsible) {
    fab.setAttribute('aria-expanded', String(open));
    fab.setAttribute('aria-controls', 'quick-add-form');
  } else {
    fab.removeAttribute('aria-expanded');
    fab.removeAttribute('aria-controls');
  }
}

function resetQuickAddCategory(catSelect) {
  if ([...catSelect.options].some((o) => o.value === DEFAULT_CATEGORY_NAME)) {
    catSelect.value = DEFAULT_CATEGORY_NAME;
  }
}

function wireQuickAdd(container) {
  const form = container.querySelector('#quick-add-form');
  if (!form) return;



  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const page = container.querySelector('.shopping-page');
    if (!page?.classList.contains('shopping-page--adding')) return;
    e.stopPropagation();
    syncQuickAddDisclosure(container, false);
    findPageFab('fab-new-item')?.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = container.querySelector('#item-name-input');
    const qtyInput  = container.querySelector('#item-qty-input');
    const catSelect = container.querySelector('#item-cat-select');

    const name     = nameInput.value.trim();
    const quantity = qtyInput.value.trim() || null;
    const category = catSelect.value;

    if (!name) { nameInput.focus(); return; }

    try {
      const data = await api.post(`/shopping/${state.activeListId}/items`, { name, quantity, category });
      acknowledgeOwnChange(data);
      state.items.push(data.data);

      updateItemsList(container);
      updateListCounter(state.activeListId, 1, 0);
      renderTabs(container);
      nameInput.value = '';
      qtyInput.value  = '';
      resetQuickAddCategory(catSelect);

      _flashAddBtn(form.querySelector('.quick-add__btn'));
      nameInput.focus();
      nameInput.classList.add('quick-add__input--flash');
      nameInput.addEventListener('animationend', () => nameInput.classList.remove('quick-add__input--flash'), { once: true });
    } catch (err) {
      window.aashiyana.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
    }
  });
}

// --------------------------------------------------------
// Swipe-Affordance Hint (Long Loop)

// --------------------------------------------------------

// --------------------------------------------------------
// Handsortierung innerhalb einer Kategorie (#678)
// --------------------------------------------------------

let itemSortables = [];

function destroyItemSortables() {
  itemSortables.forEach((inst) => { try { inst.destroy(); } catch { /* schon abgerÃ¤umt */ } });
  itemSortables = [];
}

function movableRows(rowsEl) {
  return Array.from(rowsEl.querySelectorAll(':scope > .swipe-row:not([data-swipe-checked="1"])'));
}

function refreshHandleLabels(rowsEl) {
  if (!rowsEl) return;
  const rows = movableRows(rowsEl);
  rows.forEach((row, idx) => {
    const handle = row.querySelector('.list-row__drag');
    const name   = row.querySelector('.list-row__name')?.textContent?.trim() ?? '';
    if (!handle) return;
    handle.removeAttribute('disabled');
    handle.setAttribute('aria-label', `${t('shopping.reorderHandle', { name })}, ${
      t('shopping.reorderPosition', { index: idx + 1, total: rows.length })}`);
  });



  //



  rowsEl.querySelectorAll(':scope > [data-swipe-checked="1"] .list-row__drag')
    .forEach((handle) => handle.setAttribute('disabled', ''));
}

function announceItemMove(container, row) {
  const el = container?.querySelector('#items-reorder-announce');
  if (!el || !row) return;
  const rows = movableRows(row.parentElement);
  const idx  = rows.indexOf(row);
  if (idx === -1) return;
  el.textContent = t('category.reorderAnnounce', {
    name:     row.querySelector('.list-row__name')?.textContent?.trim() ?? '',
    position: idx + 1,
    total:    rows.length,
  });
}

/** Kategorien mit laufender Sicherung: Name -> { again: boolean }. */
const orderRuns = new Map();

async function sendItemOrder(groupEl, container, listId) {
  const rowsEl   = groupEl.querySelector('.list-rows');
  const category = groupEl.dataset.category;
  if (!rowsEl) return true;



  const order = Array.from(rowsEl.querySelectorAll(':scope > .swipe-row'))
    .map((row) => Number(row.dataset.swipeId));
  if (!order.length) return true;

  try {
    const data = await api.patch(`/shopping/${listId}/items/reorder`, { category, order });
    acknowledgeOwnChange(data);



    //



    if (listId === state.activeListId) state.items = data.data ?? state.items;
    return true;
  } catch (err) {


    if (listId !== state.activeListId) return false;
    window.aashiyana.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
    updateItemsList(container);
    return false;
  }
}

function persistItemOrder(groupEl, container, movedRow) {
  const category = groupEl?.dataset.category;
  if (!groupEl || !category) return;

  refreshHandleLabels(groupEl.querySelector('.list-rows'));
  announceItemMove(container, movedRow);

  const running = orderRuns.get(category);
  if (running) { running.again = true; return; }

  const run    = { again: false };
  const listId = state.activeListId;
  orderRuns.set(category, run);
  (async () => {
    try {
      let ok = true;
      do {
        run.again = false;
        ok = await sendItemOrder(groupEl, container, listId);
      } while (run.again && ok);
    } finally {
      orderRuns.delete(category);
    }
  })();
}

function moveItemRow(row, delta, container) {
  const rowsEl = row.parentElement;
  const rows   = movableRows(rowsEl);
  const idx    = rows.indexOf(row);
  const target = idx + delta;
  if (idx === -1 || target < 0 || target >= rows.length) return;

  if (delta < 0) rowsEl.insertBefore(row, rows[target]);
  else           rowsEl.insertBefore(row, rows[target].nextSibling);

  vibrate(15);
  row.querySelector('.list-row__drag')?.focus();
  persistItemOrder(rowsEl.closest('.list-group'), container, row);
}

function wireItemReorder(container) {
  const listEl = container.querySelector('#items-list');
  if (!listEl) return;
  destroyItemSortables();

  listEl.querySelectorAll('.list-group').forEach((groupEl) => {
    const rowsEl = groupEl.querySelector('.list-rows');
    if (!rowsEl) return;
    refreshHandleLabels(rowsEl);

    makeSortable(rowsEl, {
      handle: '.list-row__drag',
      draggable: '.swipe-row',


      filter: '[data-swipe-checked="1"]',
      onEnd: (evt) => persistItemOrder(groupEl, container, evt?.item),
    }).then((inst) => { if (inst) itemSortables.push(inst); })
      .catch(() => { /* ohne SortableJS bleibt der Tastaturpfad */ });
  });




  if (listEl.dataset.reorderWired) return;
  listEl.dataset.reorderWired = '1';
  listEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const handle = e.target.closest?.('.list-row__drag');
    if (!handle || handle.disabled) return;
    e.preventDefault();
    moveItemRow(handle.closest('.swipe-row'), e.key === 'ArrowUp' ? -1 : 1, container);
  });
}

// --------------------------------------------------------
// Swipe-Gesten
// --------------------------------------------------------

function wireSwipeGestures(container) {
  const listEl = container.querySelector('#items-list');
  if (!listEl) return;

  wireSwipeRows(listEl, {
    card: '.shopping-item',
    ignore: '.list-row__drag',


    sidesSwapped: true,


    //


    // wechselt (Issue #276: kein Re-Render der Liste).
    leading: {
      reveal: '.swipe-reveal--done',
      flyOut: true,
      run: (row) => toggleShoppingItem(
        Number(row.dataset.swipeId),
        Number(row.dataset.swipeChecked),
        container,
      ),
    },




    // offen steht.
    trailing: {
      reveal: '.swipe-reveal--delete',
      run: (row) => deleteItemUndoable(Number(row.dataset.swipeId), container),
    },
  });
}

// --------------------------------------------------------
// DOM-Updates (ohne komplettes Re-Render)
// --------------------------------------------------------

function updateItemRow(container, item) {
  const row = container.querySelector(`.swipe-row[data-swipe-id="${item.id}"]`);
  if (!row) return;
  const isDone = Boolean(checkedOf(item));

  row.dataset.swipeChecked = String(checkedOf(item));

  row.querySelector('.shopping-item')?.classList.toggle('shopping-item--checked', isDone);

  const checkBtn = row.querySelector('.item-check');
  if (checkBtn) {
    checkBtn.classList.toggle('item-check--checked', isDone);
    checkBtn.dataset.checked = String(checkedOf(item));
    checkBtn.setAttribute('aria-label', isDone
      ? t('shopping.markUndoneLabel', { name: item.name })
      : t('shopping.markDoneLabel', { name: item.name }));
  }



  refreshHandleLabels(row.closest('.list-rows'));

  // Swipe-Affordance (links) spiegelt den neuen Status
  const reveal = row.querySelector('.swipe-reveal--done');
  if (reveal) {
    reveal.replaceChildren();
    reveal.insertAdjacentHTML('beforeend', `
      <i data-lucide="${isDone ? 'rotate-ccw' : 'check'}" class="icon-xl" aria-hidden="true"></i>
      <span>${isDone ? t('shopping.swipeBack') : t('shopping.swipeCheck')}</span>`);
    if (window.lucide) window.lucide.createIcons({ el: reveal });
  }
}

function refreshItemName(container, item) {
  const card = container.querySelector(`.shopping-item[data-item-id="${item.id}"]`);
  const nameEl = card?.querySelector('.list-row__name');
  if (!nameEl) return;

  nameEl.replaceChildren(document.createTextNode(item.name));
  const metaHtml = renderItemMeta(item);
  if (metaHtml) {
    nameEl.insertAdjacentHTML('beforeend', metaHtml);
    if (window.lucide) window.lucide.createIcons({ el: nameEl });
  }

  const main = card.querySelector('.list-row__main');
  const metaEl = main?.querySelector('.list-row__meta');
  const hasTags = !!item.tags?.length;
  if (item.quantity || hasTags) {
    if (!metaEl) {
      main?.insertAdjacentHTML('beforeend', `<div class="list-row__meta">
        ${item.quantity ? `<span class="shopping-item__quantity">${esc(item.quantity)}</span>` : ''}
        ${renderItemTags(item.tags)}
      </div>`);
    } else {
      const qtyEl = metaEl.querySelector('.shopping-item__quantity');
      if (item.quantity && qtyEl) {
        qtyEl.textContent = item.quantity;
      } else if (item.quantity) {
        metaEl.insertAdjacentHTML('afterbegin', `<span class="shopping-item__quantity">${esc(item.quantity)}</span>`);
      } else {
        qtyEl?.remove();
      }
    }
  } else {
    metaEl?.remove();
  }
}

function openItemDetails(itemId, container) {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return;

  const linkPreview = (value) => {
    const v = String(value ?? '').trim();
    if (!/^https?:\/\//i.test(v)) return '';
    return `
      <a class="item-details__link" href="${esc(v)}" target="_blank" rel="noopener noreferrer">
        <i data-lucide="external-link" class="icon-sm" aria-hidden="true"></i>${t('shopping.openLink')}
      </a>`;
  };

  openModal({
    title: t('common.editItem'),
    size: 'md',
    content: `
      <form id="item-details-form" class="item-details-form" novalidate autocomplete="off">
        <div class="form-group">
          <label class="form-label" for="item-details-name">${t('common.nameLabel')}</label>
          <input class="form-input" type="text" id="item-details-name" required
                 value="${esc(item.name)}">
        </div>
        <div class="pantry-form-row">
          <div class="form-group">
            <label class="form-label" for="item-details-qty">${t('shopping.itemQtyLabel')}</label>
            <input class="form-input" type="text" id="item-details-qty"
                   placeholder="${t('shopping.itemQtyPlaceholder')}" value="${esc(item.quantity || '')}">
          </div>
          <div class="form-group">
            <label class="form-label" for="item-details-cat">${t('shopping.categoryLabel')}</label>
            <select class="form-input" id="item-details-cat">
              ${state.categories.map((c) => `<option value="${esc(c.name)}" ${c.name === item.category ? 'selected' : ''}>${esc(categoryLabel(c.name))}</option>`).join('')}
            </select>
          </div>
        </div>
        ${/* PREIS UND LADEN (#1003).
            *
            * NICHT ALS ZWANGSDIALOG BEIM ABHAKEN. Das Ticket sagt "erfasst,
            * wenn man abhakt - da ist die Zahl bekannt", und das stimmt; ein
            * Dialog, der sich bei JEDEM Haken oeffnet, waere im Laden aber
            * unertraeglich: das Abhaken ist die schnellste Geste der App und
            * bleibt es. Die Felder stehen deshalb hier, wo der Artikel ohnehin
            * geoeffnet wird - nachtragen statt unterbrechen.
            *
            * Betont bei einem abgehakten Artikel: dann ist die Frage aktuell. */ ''}
        <div class="pantry-form-row">
          <div class="form-group">
            <label class="form-label" for="item-details-price">${t('shopping.priceLabel')}</label>
            <input class="form-input" type="text" id="item-details-price" inputmode="decimal"
                   placeholder="${esc(amountPlaceholder(state.currency))}"
                   value="${item.price_cents != null ? esc(centsToAmountInput(item.price_cents, state.currency)) : ''}">
          </div>
          <div class="form-group">
            <label class="form-label" for="item-details-store">${t('shopping.storeLabel')}</label>
            ${/* COMBOBOX, KEIN SELECT (#1003).
                *
                * Eine reine Auswahlliste ist bei einem frischen Haushalt leer und
                * bleibt es: der erste Laden muesste anderswo entstehen. Ein Knopf
                * daneben hilft hier nicht - das geteilte Modal kennt bewusst kein
                * Stacking (siehe modal.js), ein Manager darueber raeumte dieses
                * Formular samt getippter Eingaben weg.
                *
                * Also tippen oder waehlen: die Liste kommt als datalist dazu, und
                * ein unbekannter Name legt beim Speichern den Laden an. Umbenennen
                * und Loeschen liegen im Listenmenue, wo der Manager ein Dialog
                * erster Ebene sein darf. */ ''}
            <input class="form-input" type="text" id="item-details-store" list="item-details-store-options"
                   autocomplete="off" placeholder="${esc(t('shopping.storePlaceholder'))}"
                   value="${esc(state.stores.find((st) => st.id === item.store_id)?.name ?? '')}">
            <datalist id="item-details-store-options">
              ${state.stores.map((st) => `<option value="${esc(st.name)}"></option>`).join('')}
            </datalist>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="item-details-url">${t('shopping.urlLabel')}</label>
          <input class="form-input" type="url" id="item-details-url" inputmode="url"
                 placeholder="${t('shopping.urlPlaceholder')}" value="${esc(item.url || '')}">
          <div class="item-details__link-wrap" id="item-details-link">${linkPreview(item.url)}</div>
        </div>
        <div class="form-group">
          <label class="form-label" for="item-details-notes">${t('shopping.notesLabel')}</label>
          <textarea class="form-input" id="item-details-notes" rows="4"
                    placeholder="${t('shopping.notesPlaceholder')}">${esc(item.notes || '')}</textarea>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn--secondary" id="item-details-cancel">${t('common.cancel')}</button>
          <button type="submit" class="btn btn--primary">${t('common.save')}</button>
        </div>
      </form>`,
    onSave: (panel) => {
      const form    = panel.querySelector('#item-details-form');
      const nameEl  = panel.querySelector('#item-details-name');
      const qtyEl   = panel.querySelector('#item-details-qty');
      const catEl   = panel.querySelector('#item-details-cat');
      const urlEl   = panel.querySelector('#item-details-url');
      const notesEl = panel.querySelector('#item-details-notes');
      const preview = panel.querySelector('#item-details-link');

      panel.querySelector('#item-details-cancel')?.addEventListener('click', () => closeModal());

      urlEl?.addEventListener('input', () => {
        preview.replaceChildren();
        const html = linkPreview(urlEl.value);
        if (html) {
          preview.insertAdjacentHTML('beforeend', html);
          if (window.lucide) window.lucide.createIcons({ el: preview });
        }
      });

      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = nameEl.value.trim();
        if (!name) {
          reportFieldError(nameEl, t('common.nameRequired'));
          return;
        }
        const priceEl = panel.querySelector('#item-details-price');
        const storeEl = panel.querySelector('#item-details-store');


        // spaeter darauf aufbaut, addiert genau solche Zahlen. Ein leeres Feld
        // heisst "kein Preis", nicht "null Cent".
        const priceRoh = priceEl?.value.trim() ?? '';
        const priceCents = priceRoh === '' ? null : amountInputToCents(priceRoh, state.currency);
        if (priceRoh !== '' && priceCents === null) {
          reportFieldError(priceEl, t('budget.validAmountRequired'));
          return;
        }
        try {


          // einem schon vorhandenen Namen dieselbe Zeile zurueck (COLLATE

          const storeName = storeEl?.value.trim() ?? '';
          let storeId = null;
          if (storeName) {
            const bekannt = state.stores.find((st) => st.name.toLowerCase() === storeName.toLowerCase());
            if (bekannt) {
              storeId = bekannt.id;
            } else {
              const angelegt = await api.post('/shopping/stores', { name: storeName });
              state.stores.push(angelegt.data);
              storeId = angelegt.data.id;
            }
          }
          const payload = {
            name,
            quantity: qtyEl.value.trim() || null,
            category: catEl.value,
            notes: notesEl.value.trim() || null,
            url: urlEl.value.trim() || null,
            price_cents: priceCents,
            store_id: storeId,
          };
          const data = await api.patch(`/shopping/items/${item.id}`, payload);
          acknowledgeOwnChange(data);









          const aktuell = state.items.find((i) => i.id === item.id);
          if (!aktuell) {
            closeModal({ force: true });
            updateItemsList(container);
            return;
          }
          const categoryChanged = data.data.category !== aktuell.category;
          Object.assign(aktuell, data.data);



          closeModal({ force: true });




          if (categoryChanged) {
            updateItemsList(container);
          } else {
            updateItemRow(container, aktuell);
            refreshItemName(container, aktuell);
          }
        } catch (err) {
          window.aashiyana.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
        }
      });
    },
  });
}

function updateItemsList(container) {
  const listEl = container.querySelector('#items-list');
  if (listEl) {


    mountItems(listEl, container);
    if (window.lucide) window.lucide.createIcons({ el: listEl });
    stagger(listEl.querySelectorAll('.shopping-item'));
    wireSwipeGestures(container);
    wireItemReorder(container);
    maybeShowSwipeHint(container);
  }
  updateCheckedActions(container);
}

function parseShoppingQuantity(raw) {
  const fallback = { quantity: 1, unit: 'pcs' };
  const text = String(raw ?? '').trim();
  if (!text) return fallback;







  // stand einfach auf 1.
  //



  //




  const decimal = toDecimalString(text, { freeText: true });
  if (!decimal) return fallback;





  const match = decimal.match(/^(\d+(?:\.\d+)?)\s*(?:(kg|g|ml|l)\b)?/i);
  if (!match) return fallback;







  //




  if (breaksOffAtSeparator(decimal.slice(match[1].length))) return fallback;

  const quantity = Number(match[1]);
  if (!Number.isFinite(quantity) || quantity <= 0) return fallback;

  return { quantity, unit: match[2] ? match[2].toLowerCase() : 'pcs' };
}

async function openPantryTransfer(container) {
  const checked = state.items.filter((i) => checkedOf(i));
  if (!checked.length) return;

  let locations = [];
  try {
    const res = await api.get('/pantry/locations');
    locations = res.data ?? [];
  } catch (err) {
    window.aashiyana.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
    return;
  }

  const { PANTRY_UNITS } = await import('/utils/pantry-units.js');
  const { locationLabel } = await import('/utils/pantry-locations.js');

  const unitOptions = (selected) => PANTRY_UNITS
    .map((u) => `<option value="${esc(u)}" ${u === selected ? 'selected' : ''}>${esc(t(`pantry.units.${u}`))}</option>`)
    .join('');

  const rows = checked.map((item) => {
    const parsed = parseShoppingQuantity(item.quantity);
    return `
      <li class="pantry-transfer__row" data-id="${item.id}">
        <span class="pantry-transfer__name">${esc(item.name)}</span>
        <input class="form-input pantry-transfer__qty" type="number" min="0" step="any" inputmode="decimal"
               value="${parsed.quantity}" aria-label="${esc(`${t('pantry.quantityLabel')}: ${item.name}`)}">
        <select class="form-input pantry-transfer__unit" aria-label="${esc(`${t('pantry.unitLabel')}: ${item.name}`)}">
          ${unitOptions(parsed.unit)}
        </select>
      </li>`;
  }).join('');

  openModal({
    title: t('shopping.toPantryTitle'),
    size: 'lg',
    content: `
      <p class="pantry-transfer__intro">${esc(t('shopping.toPantryDescription', { count: checked.length }))}</p>
      <div class="form-group">
        <label class="form-label" for="pantry-transfer-location">${esc(t('pantry.locationLabel'))}</label>
        <select id="pantry-transfer-location" class="form-input">
          <option value="">${esc(t('pantry.unlocated'))}</option>
          ${locations.map((loc) => `<option value="${loc.id}">${esc(locationLabel(loc.name))}</option>`).join('')}
        </select>
      </div>
      <ul class="pantry-transfer__list">${rows}</ul>
      <!-- Geteiltes .form-check (layout.css): 20px-Box in Modul-Akzent, Label mit
           eigener Trefferflaeche. Das war die folgenreichste Checkbox des Moduls -
           sie loescht die eingekauften Artikel von der Liste, ist standardmaessig
           aktiv, und war als nackte System-Checkbox in System-Groesse die
           unauffaelligste (Critique 2026-07-30, P2). Der Default bleibt aktiv: wer
           eingekauft und eingeraeumt hat, will nicht doppelt kaufen. -->
      <label class="form-check pantry-transfer__clear">
        <input type="checkbox" id="pantry-transfer-clear" checked>
        <span>${esc(t('shopping.toPantryClearList'))}</span>
      </label>
      <div class="modal-panel__footer modal-panel__footer--plain">
        <button type="button" class="btn btn--secondary" data-action="close-modal">${esc(t('common.cancel'))}</button>
        <button type="button" class="btn btn--primary" id="pantry-transfer-confirm">${esc(t('common.apply'))}</button>
      </div>`,
    onSave(panel) {


      if (locations.length) panel.querySelector('#pantry-transfer-location').value = String(locations[0].id);

      panel.querySelector('#pantry-transfer-confirm').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const locationId = panel.querySelector('#pantry-transfer-location').value || null;
        const clearList = panel.querySelector('#pantry-transfer-clear').checked;
        const listId = state.activeListId;

        const items = [...panel.querySelectorAll('.pantry-transfer__row')].map((row) => ({
          shopping_item_id: Number(row.dataset.id),
          quantity: Number(row.querySelector('.pantry-transfer__qty').value) || 1,
          unit: row.querySelector('.pantry-transfer__unit').value,
          location_id: locationId,
        }));

        btn.disabled = true;
        try {
          const res = await api.post('/pantry/import-shopping', { list_id: listId, items });
          const stored = (res.data?.added ?? 0) + (res.data?.merged ?? 0);

          if (clearList && stored) {



            await api.delete(`/shopping/${listId}/items/checked`);
            const removed = checked.length;
            state.items = state.items.filter((i) => !checkedOf(i));
            updateItemsList(container);
            updateListCounter(listId, -removed, -removed);
            renderTabs(container);
          }

          closeModal({ force: true });


          // Dialog gerade getroffen hat.
          const locationName = locationId
            ? (locations.find((l) => String(l.id) === String(locationId))?.name ?? '')
            : '';
          window.aashiyana.showToast(
            stored
              ? (locationName
                ? t('shopping.toPantryDoneAt', { count: stored, location: locationLabel(locationName) })
                : t('shopping.toPantryDone', { count: stored }))
              : t('shopping.toPantryNothing'),
            stored ? 'success' : 'info'
          );

          refreshKitchenBadges();
        } catch (err) {
          btn.disabled = false;
          window.aashiyana.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
        }
      });
    },
  });
}

function updateCheckedActions(container, { userChecked = false } = {}) {
  const checkedCount = state.items.filter((i) => checkedOf(i)).length;
  if (!checkedCount) {
    clearPillTimer();
    pillPhase = 'idle';
    pillInteracting = false;
    pillOwnerContainer = null;
    clearBulkPill();
    return;
  }




  if (!((userChecked && pillPhase === 'idle') || pillPhase === 'visible' || pillPhase === 'deferred')) {
    return;
  }

  const actions = [];
  if (!window.aashiyana?.isModuleDisabled?.('pantry')) {
    actions.push({
      label: t('shopping.toPantry'),
      onClick: () => openPantryTransfer(container),
    });
  }



  actions.push({
    label: t('common.delete'),
    ariaLabel: t('shopping.clearChecked', { count: checkedCount }),




    count: checkedCount,





    danger: true,
    confirm: { question: t('shopping.clearCheckedConfirm', { count: checkedCount }) },
    onClick: () => clearCheckedUndoable(container),
  });





  // Zeichen darin (dieselbe Form wie .toast__undo).
  setBulkPill({
    label: t('shopping.checkedHint', { count: checkedCount }),
    actions,
  });

  if (pillPhase === 'idle') {


    pillPhase = 'visible';
    pillOwnerContainer = container;
    wirePillInteractionGuards();
    schedulePillHide(container);
  }

  // bzw. die Interaktions-Verlaengerung bleibt unangetastet (Anforderung: kein
  // Aufschub durch weitere Treffer).
}

function clearCheckedUndoable(container) {
  const checked = state.items.filter((i) => checkedOf(i));
  const count   = checked.length;
  if (!count) return;

  const snapshot = checked.map((i) => ({ ...i }));





  const listId = state.activeListId;



  for (const item of checked) pendingRemovals.set(item.id, { listId, checked: true, removedAt: null });
  state.items = state.items.filter((i) => !checkedOf(i));
  updateItemsList(container);
  updateListCounter(listId, -count, -count);
  renderTabs(container);

  scheduleUndoableDelete({
    message: t('shopping.itemsRemovedToast', { count }),
    commit: async ({ keepalive }) => {
      let response;
      try {





        response = await api.delete(`/shopping/${listId}/items/checked`, {
          keepalive,
          body: JSON.stringify({ ids: checked.map((item) => item.id) }),
        });
      } catch (err) {

        // darf sie wieder tragen.
        for (const item of checked) pendingRemovals.delete(item.id);
        throw err;
      }







      if (response?.deleted === count) acknowledgeOwnChange(response);
      confirmRemovals(checked.map((item) => item.id));
    },
    restore: (err) => {
      for (const item of checked) pendingRemovals.delete(item.id);
      if (state.activeListId === listId) {

        const vorhanden = new Set(state.items.map((i) => i.id));
        snapshot.forEach((item) => { if (!vorhanden.has(item.id)) state.items.push(item); });
        state.items.sort((a, b) => a.id - b.id);
        updateItemsList(container);
      }
      updateListCounter(listId, count, count);
      renderTabs(container);
      if (err) window.aashiyana.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
    },
  });
}

function updateListCounter(listId, totalDelta, checkedDelta) {
  const list = state.lists.find((l) => l.id === listId);
  if (list) {
    list.item_total   = (list.item_total   || 0) + totalDelta;
    list.item_checked = (list.item_checked || 0) + checkedDelta;
  }
}

function openMealPlanImport(container) {
  if (!state.activeListId) return;
  const today = todayKey();
  const defaultTo = addLocalDays(today, 6);

  openModal({
    title: t('shopping.importMealsTitle'),
    size: 'sm',
    content: `
      <form id="shopping-import-meals-form" class="shopping-import-meals-form" novalidate autocomplete="off">
        <div class="form-group">
          <label class="form-label" for="shopping-import-from">${t('calendar.fromLabel')}</label>
          <aashiyana-datepicker type="date" id="shopping-import-from" value="${esc(today)}"></aashiyana-datepicker>
        </div>
        <div class="form-group">
          <label class="form-label" for="shopping-import-to">${t('calendar.toLabel')}</label>
          <aashiyana-datepicker type="date" id="shopping-import-to" value="${esc(defaultTo)}"></aashiyana-datepicker>
        </div>
        <p class="form-hint" id="shopping-import-preview" role="status" aria-live="polite"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn--secondary" id="shopping-import-cancel">${t('common.cancel')}</button>
          <!-- Startet deaktiviert und wird von updatePreview() freigeschaltet, sobald
               der Zeitraum Zutaten enthaelt. Die Schwesteraktion â€žPlan zufaellig
               fuellen" macht das seit dem Audit korrekt; hier blieb â€žUebernehmen"
               bei 0 Treffern klickbar und quittierte mit einem Info-Toast, dass
               nichts passiert ist (Critique 2026-07-30, P2). -->
          <button type="submit" class="btn btn--primary" id="shopping-import-submit" disabled>${t('common.apply')}</button>
        </div>
      </form>`,
    onSave: (panel) => {
      const form = panel.querySelector('#shopping-import-meals-form');
      const cancelBtn = panel.querySelector('#shopping-import-cancel');
      cancelBtn?.addEventListener('click', () => closeModal());



      const previewEl = panel.querySelector('#shopping-import-preview');
      const submitBtn = panel.querySelector('#shopping-import-submit');
      async function updatePreview() {
        const from = panel.querySelector('#shopping-import-from')?.value || '';
        const to = panel.querySelector('#shopping-import-to')?.value || '';
        if (!from || !to || !previewEl) return;
        try {
          const data = await api.post(`/shopping/${state.activeListId}/import-meal-plan`, { from, to, preview: true });
          const transferred = Number(data.data?.transferred) || 0;
          const meals = Number(data.data?.meals) || 0;


          // pluralisierter Teilstring herein (Audit A2-21: "aus 1 Mahlzeiten").
          previewEl.textContent = transferred
            ? t('shopping.importMealsPreview', {
              count: transferred,
              mealsText: t('shopping.importMealsPreviewMeals', { count: meals }),
            })
            : t('shopping.importMealsEmpty');
          submitBtn.disabled = !transferred;
        } catch {
          previewEl.textContent = '';


          // Nebenanfrage scheiterte.
          submitBtn.disabled = false;
        }
      }
      updatePreview();
      panel.querySelector('#shopping-import-from')?.addEventListener('change', updatePreview);
      panel.querySelector('#shopping-import-to')?.addEventListener('change', updatePreview);
      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const from = panel.querySelector('#shopping-import-from')?.value || '';
        const to = panel.querySelector('#shopping-import-to')?.value || '';
        if (!from || !to) return;
        try {
          const data = await api.post(`/shopping/${state.activeListId}/import-meal-plan`, { from, to });
          if (!data.data?.transferred) {
            window.aashiyana.showToast(t('shopping.importMealsEmpty'), 'default');
            return;
          }
          await Promise.all([loadLists(), loadItems(state.activeListId)]);
          renderTabs(container);
          renderListContent(container);
          wireListContentEvents(container);


          closeModal({ force: true });
          const count = Number(data.data.transferred) || 0;
          window.aashiyana.showToast(t('meals.transferSuccess', { count }), 'success');
        } catch (err) {
          window.aashiyana.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
        }
      });
    },
  });
}

// --------------------------------------------------------
// API-Aktionen
// --------------------------------------------------------

async function loadLists() {


  const startedAt = beginLoad();
  try {
    const data   = await api.get('/shopping');
    state.lists  = data.data ?? [];





    for (const entry of pendingRemovals.values()) {
      if (removalHides(entry, startedAt)) updateListCounter(entry.listId, -1, entry.checked ? -1 : 0);
    }
    state.listsError = null;
  } catch (err) {
    console.error('[Shopping] loadLists Fehler:', err);
    state.lists = [];

    // [Neue Liste erstellen]" stehen blieb - bei 31 vorhandenen Artikeln
    // (Critique P0, 2026-07-30).
    state.listsError = err;
  } finally {
    endLoad(startedAt);
  }
}

async function loadCategories() {
  try {
    const data       = await api.get('/shopping/categories');
    state.categories = data.data ?? [];
  } catch {
    state.categories = [];
  }
}

async function loadStores() {
  try {
    const data   = await api.get('/shopping/stores');
    state.stores = data.data ?? [];
  } catch {
    state.stores = [];
  }
  try {
    const prefs    = await api.get('/preferences');
    state.currency = prefs.data?.currency ?? 'INR';
  } catch { /* EUR bleibt */ }
}

async function loadItems(listId) {
  const startedAt = beginLoad();


  try {




    const { data, fromCache } = await api.getWithSource(`/shopping/${listId}/items`);

    // Aufrufer laden die GERADE aktive Liste - `switchList` setzt






    // bedienbar ist.
    if (state.activeListId !== listId) return;




    if (startedAt < (_appliedLoad.get(listId) ?? 0)) return;




    // Beste, was es gibt.



    if (fromCache && _appliedLoad.has(listId) && _itemsListId === listId) return;
    if (!fromCache) _appliedLoad.set(listId, startedAt);





    // ZURUECKGEDREHT. Die Antwort selbst bleibt gueltig - ihre uebrigen Artikel,


    const vorherige = new Map(state.items.map((i) => [i.id, i]));






    const frisch = (data.data ?? []).filter((i) => {
      const entry = pendingRemovals.get(i.id);
      return !entry || !removalHides(entry, startedAt);
    });
    for (const item of frisch) {
      const bestaetigt = settledAt.get(item.id);
      if (bestaetigt != null && bestaetigt >= startedAt) {
        const alt = vorherige.get(item.id);
        if (alt) item.is_checked = alt.is_checked;
      }
    }
    state.items = frisch;
    _itemsListId = listId;
    settleIntents(state.items, listId, { fromCache, startedAt });
    state.activeList = data.list ?? null;




    _liveFeed?.hold(listId, data.version);

    if (data.categories?.length) state.categories = data.categories;
  } finally {
    endLoad(startedAt);
  }
}

async function switchList(listId, container) {


  // neue nicht treffen (#1039).
  resetPillMachine();
  clearBulkPill();
  state.activeListId = listId;
  state.collapsedCategories = loadCollapsedCategories(state.currentUserId, listId);
  renderTabs(container);

  // Screenreadern â€žbusy" â€” bis renderListContent den neuen Inhalt setzt.
  container.querySelector('#list-content')?.setAttribute('aria-busy', 'true');
  try {
    await loadItems(listId);
    state.itemsError = null;
  } catch (err) {
    console.error('[Shopping] loadItems Fehler:', err);
    clearItems();
    state.activeList = state.lists.find((l) => l.id === listId) ?? null;
    state.itemsError = err;
  }
  renderListContent(container);
  wireListContentEvents(container);
}

// --------------------------------------------------------
// Live-Aktualisierung
// --------------------------------------------------------

const LIVE_POLL_MS = 10_000;

let _liveController = null;
let _liveFeed = null;
let _routeSignal = null;

function acknowledgeOwnChange(response) {
  _liveFeed?.acknowledge(response?.list_change);
}

function liveRefreshPlan(previous, fresh) {
  const shape = (i) => JSON.stringify([
    i.id, i.category, i.name, i.quantity ?? '', i.notes ? 1 : 0, i.url ? 1 : 0,
    i.price_cents ?? '', i.store_id ?? '', i.tags ?? [], i.sort_order ?? '',
  ]);
  const before = previous.map(shape).sort();
  const after  = fresh.map(shape).sort();
  if (before.length !== after.length || before.some((s, idx) => s !== after[idx])) {
    return { rebuild: true, changed: [] };
  }
  const checkedBefore = new Map(previous.map((i) => [i.id, i.is_checked]));
  return {
    rebuild: false,
    changed: fresh.filter((i) => checkedBefore.get(i.id) !== i.is_checked),
  };
}

async function refreshFromFeed(container, listId, signal) {
  if (state.listsError) return;
  const active        = listId === state.activeListId;
  const previous      = state.items;
  const previousLists = state.lists;






  const [, items] = await Promise.allSettled([loadLists(), active ? loadItems(listId) : null]);
  const itemsFailed = items.status === 'rejected';
  if (itemsFailed) console.warn('[Shopping] Live-Aktualisierung fehlgeschlagen:', items.reason);





  const listsFailed = Boolean(state.listsError);
  if (listsFailed) {
    state.listsError = null;
    state.lists = previousLists;
  }
  if (signal.aborted) return;



  // naechste Meldung vergleicht Serverstand mit Serverstand (`liveRefreshPlan`),

  //




  if (!listsFailed && state.activeListId != null && !state.lists.some((l) => l.id === state.activeListId)) {
    if (state.lists.length) {
      await switchList(state.lists[0].id, container);
      return;
    }
    state.activeListId = null;
    state.activeList = null;
    clearItems();
    renderTabs(container);
    renderListContent(container);
    return;
  }
  renderTabs(container);
  // Inzwischen umgeschaltet: switchList zeichnet die neue Liste selbst.
  if (!active || state.activeListId !== listId) return;

  if (itemsFailed) return;
  if (state.itemsError) {

    state.itemsError = null;
    updateItemsList(container);
    return;
  }
  const plan = liveRefreshPlan(previous, state.items);
  if (plan.rebuild) {
    updateItemsList(container);
    return;
  }
  for (const item of plan.changed) updateItemRow(container, item);
  if (plan.changed.length) updateCheckedActions(container);
}

function wireLiveUpdates(container, routeSignal) {
  _liveController?.abort();
  const controller = createPageController(routeSignal);
  _liveController = controller;
  const { signal } = controller;
  if (signal.aborted) return;

  const queue = new Set();
  let draining = false;
  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      while (queue.size && !signal.aborted) {
        const [listId] = queue;
        queue.delete(listId);
        await refreshFromFeed(container, listId, signal);
      }
    } finally {
      draining = false;
    }
  };
  const request = (listId) => {
    if (signal.aborted || listId == null) return;
    queue.add(listId);
    drain();
  };

  const feed = startLiveFeed({
    fetchVersions: async () => (await api.get('/shopping/versions')).data ?? [],
    onChange: request,
    signal,
    intervalMs: LIVE_POLL_MS,
  });
  _liveFeed = feed;
  signal.addEventListener('abort', () => { if (_liveFeed === feed) _liveFeed = null; });


  feed.poll();
  const wake = () => { if (!document.hidden) feed.poll(); };
  document.addEventListener('visibilitychange', wake, { signal });
  window.addEventListener('focus', wake, { signal });
}

// --------------------------------------------------------
// Event-Verdrahtung
// --------------------------------------------------------

function wireTabBar(container) {
  container.querySelector('#list-tabs-bar')?.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    if (target.dataset.action === 'switch-list') {
      await switchList(Number(target.dataset.id), container);
    }

    if (target.dataset.action === 'new-list') {
      const name = await promptModal(t('shopping.newListPrompt'));
      if (!name) return;
      try {
        const data = await api.post('/shopping', { name });
        state.lists.push({ ...data.data, item_total: 0, item_checked: 0 });
        await switchList(data.data.id, container);
        refocusAfterRender();
      } catch (err) {
        window.aashiyana.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
      }
    }
  });
}

function wireListContentEvents(container) {

  // Liste (rename-list, import-meals, manage-categories, delete-list) stehen im


  // #list-content vorher - pro render() genau einmal erzeugt, womit die
  // Einmal-Bindung unten weiter gilt.
  const root = container.querySelector('.shopping-page');
  if (!root) return;







  installPopoverMenus(root);

  if (root.dataset.eventsWired) return;
  root.dataset.eventsWired = 'true';

  root.addEventListener('click', async (e) => {
    // ---- Kategorie auf-/zuklappen (#1039) ----


    // toggelt nur lokal sichtbares DOM - kein `await`, kein try/catch noetig.
    const catToggle = e.target.closest('[data-category-toggle]');
    if (catToggle) {
      toggleCategoryCollapse(catToggle);
      return;
    }

    const target = e.target.closest('[data-action]');
    if (!target) {
      if (shouldIgnoreShoppingRowToggle(e.target)) return;
      const row = e.target.closest('.shopping-item');
      if (!row) return;
      const toggle = row.querySelector('[data-action="toggle-item"]');
      if (!toggle) return;
      await toggleShoppingItem(Number(row.dataset.itemId), Number(toggle.dataset.checked), container);
      return;
    }
    const action = target.dataset.action;

    // ---- Artikel abhaken ----
    if (action === 'toggle-item') {
      const id      = Number(target.dataset.id);
      const checked = Number(target.dataset.checked);
      await toggleShoppingItem(id, checked, container);
    }

    // ---- Artikel-Details (URL/Notiz) bearbeiten ----
    if (action === 'item-details') {
      openItemDetails(Number(target.dataset.id), container);
    }


    if (action === 'delete-item') {
      deleteItemUndoable(Number(target.dataset.id), container);
    }

    // ---- Kategorien verwalten ----
    if (action === 'manage-categories') {
      openCategoryManager(container);
    }

    // ---- Laeden verwalten (#1003) ----
    if (action === 'manage-stores') {
      openStoreManager(container);
    }

    if (action === 'import-meals') {
      openMealPlanImport(container);
    }

    if (action === 'send-list') {
      await openSendListDialog(container);
    }

    // ---- Liste duplizieren (#1103) ----
    if (action === 'duplicate-list') {
      await openDuplicateListDialog(container);
    }

    // ---- Liste umbenennen ----
    if (action === 'rename-list') {
      const newName = await promptModal(t('shopping.renameListPrompt'), state.activeList?.name ?? '');
      if (!newName || newName === state.activeList?.name) return;
      try {
        const data = await api.put(`/shopping/${state.activeListId}`, { name: newName });
        const idx  = state.lists.findIndex((l) => l.id === state.activeListId);
        if (idx >= 0) state.lists[idx].name = data.data.name;
        state.activeList = data.data;
        renderTabs(container);
        renderListContent(container);
        wireListContentEvents(container);
        refocusAfterRender();
      } catch (err) {
        window.aashiyana.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
      }
    }


    //





    //




    // Haushalts dran.
    if (action === 'delete-list') {
      const deletedListId = state.activeListId;
      const snapshot = {
        list: state.activeList ? { ...state.activeList } : null,
        listEntry: state.lists.find((l) => l.id === deletedListId),
        items: state.items.map((i) => ({ ...i })),
        index: state.lists.findIndex((l) => l.id === deletedListId),
      };


      const confirmed = await confirmModal(
        state.items.length
          ? t('shopping.deleteListConfirm', { name: state.activeList?.name ?? '', count: state.items.length })
          : t('shopping.deleteListConfirmEmpty', { name: state.activeList?.name ?? '' }),
        { danger: true, confirmLabel: t('common.delete'), detail: t('shopping.deleteListConfirmDetail') },
      );
      if (!confirmed) return;


      state.lists = state.lists.filter((l) => l.id !== deletedListId);
      state.activeListId = state.lists[0]?.id ?? null;
      if (state.activeListId) {
        await switchList(state.activeListId, container);
        refocusAfterRender();
      } else {
        clearItems();
        state.activeList = null;
        renderTabs(container);
        renderListContent(container);
        wireListContentEvents(container);
      }

      scheduleUndoableDelete({
        message: t('shopping.deletedListToast'),
        commit: async ({ keepalive }) => {
          await api.delete(`/shopping/${deletedListId}`, { keepalive });


          try {
            localStorage.removeItem(collapsedCategoriesStorageKey(state.currentUserId, deletedListId));
          } catch { /* Privatmodus/Quota - unschaedlich, die Zeile war ohnehin verwaist */ }
        },
        restore: async (err) => {


          if (snapshot.listEntry) {
            state.lists.splice(Math.max(0, snapshot.index), 0, snapshot.listEntry);
          }
          state.activeListId = deletedListId;
          state.activeList = snapshot.list;
          state.items = snapshot.items;
          renderTabs(container);
          renderListContent(container);
          wireListContentEvents(container);
          if (err) window.aashiyana.showToast(err.data?.error ?? t('common.unknownError'), 'danger');
        },
      });
    }
  });
}







// --------------------------------------------------------

// --------------------------------------------------------

function openStoreManager(container) {






  const onChanged = async () => {
    await Promise.all([loadStores(), loadItems(state.activeListId)]);
    updateItemsList(container);
  };

  openModal({
    title: t('shopping.manageStores'),
    content: '<aashiyana-category-manager></aashiyana-category-manager>',
    onSave: (panel) => {
      const manager = panel.querySelector('aashiyana-category-manager');
      if (!manager) return;
      manager.addEventListener('category-manager-changed', onChanged);
      manager.configure({
        basePath: '/shopping/stores',
        titleKey: 'shopping.manageStores',
        hintKey: 'shopping.storesHint',


        addPlaceholderKey: 'shopping.addStore',




        deleteConfirmKey: 'shopping.storeDeleteConfirm',
        deleteDetailKey: 'shopping.storeDeleteConfirmDetail',
      });
    },








  });
}

async function openCategoryManager(container, { fromDeepLink = false } = {}) {
  const { openModal } = await import('/components/modal.js');



  //





  //



  // die Artikelzeilen: Umbenennen per `UPDATE shopping_items SET category = ?`,



  const onCategoriesChanged = async () => {



    // sie ganz neu auf (`content.replaceChildren(...)` plus frisches



    if (!container.isConnected) return;
    await loadCategories();
    const listId = state.activeListId;
    if (listId) {
      try {
        await loadItems(listId);


        // unangetastet gelassen.
        if (state.activeListId !== listId) return;
        state.itemsError = null;
      } catch (err) {





        console.error('[Shopping] loadItems Fehler:', err);


        if (state.activeListId !== listId) return;
        state.items      = [];
        state.itemsError = err;
      }
    }
    if (state.activeList) {
      renderListContent(container);
      wireListContentEvents(container);
    }
    refocusAfterRender();
  };

  openModal({
    title: t('shopping.manageCategories'),
    content: '<aashiyana-category-manager></aashiyana-category-manager>',
    onSave: (panel) => {
      const manager = panel.querySelector('aashiyana-category-manager');
      if (!manager) return;
      manager.addEventListener('category-manager-changed', onCategoriesChanged);
      manager.configure({
        basePath: '/shopping/categories',
        labelResolver: (item) => categoryLabel(item.name),
        titleKey: 'shopping.manageCategories',
        hintKey: 'settings.shoppingCategoriesHint',


        deleteDetailKey: 'shopping.categoryDeleteConfirmDetail',
      });
    },



    onClose: () => {

      if (fromDeepLink && new URLSearchParams(window.location.search).has('manage')) {
        window.aashiyana?.navigate?.('/shopping');
      }
    },
  });
}

// --------------------------------------------------------
// Haupt-Render
// --------------------------------------------------------

export async function render(container, { user, signal: routeSignal = null } = {}) {
  state.currentUserId = user?.id ?? null;
  _routeSignal = routeSignal;


  resetPillMachine();






  // faellt, laedt hoechstens einmal umsonst; die Ladeordnung (`_loadSeq`)
  // haelt die Antworten auseinander.
  wireLiveUpdates(container, routeSignal);
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <div class="shopping-page page-measure--narrow">
      <div class="list-tabs-bar" id="list-tabs-bar">
        <div class="skeleton skeleton-line skeleton-line--medium" style="height:36px;width:120px;border-radius:var(--radius-full)"></div>
        <div class="skeleton skeleton-line skeleton-line--short"  style="height:36px;width:80px; border-radius:var(--radius-full)"></div>
      </div>
      <div id="list-content" style="flex:1;display:flex;flex-direction:column">
        <div style="padding:var(--space-6)">
          ${[1,2,3].map(() => `
            <div class="skeleton skeleton-line skeleton-line--full" style="height:48px;margin-bottom:var(--space-2);border-radius:var(--radius-sm)"></div>
          `).join('')}
        </div>
      </div>
    </div>
  `);
  state.itemsError = null;
  try {



    await Promise.all([loadCategories(), loadStores(), loadLists()]);
    if (!state.listsError && state.lists.length) {
      const listParam = parseInt(new URLSearchParams(window.location.search).get('list'), 10) || null;
      const target = listParam && state.lists.find((l) => l.id === listParam);
      state.activeListId = target ? target.id : state.lists[0].id;
      state.collapsedCategories = loadCollapsedCategories(state.currentUserId, state.activeListId);
      try {
        await loadItems(state.activeListId);
      } catch (err) {
        console.error('[Shopping] loadItems Fehler:', err);
        clearItems();
        state.activeList = state.lists.find((l) => l.id === state.activeListId) ?? null;
        state.itemsError = err;
      }
    }
  } catch (err) {
    console.error('[Shopping] Ladefehler:', err);
    state.listsError = err;
  }

  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <div class="shopping-page page-measure--narrow">
      <h1 class="sr-only">${t('nav.shopping')}</h1>
      <!-- Die Listenwahl ist zugleich der Titel der Seite: der aktive Chip nennt
           die Liste, sein Nachbar am hinteren Ende traegt ihre Aktionen. Hier
           stand bis 2026-08-11 zusaetzlich ein page-toolbar-Kopf, der denselben
           Namen ein zweites Mal zeigte (Keine-sichtbare-Titelwiederholung-Regel,
           DESIGN.md) und mobil rund 64px kostete: /shopping lag bei 53 %
           Contentflaeche, waehrend /tasks und /budget nach ihrer Kopf-Diaet bei
           62-63 % standen.
           KEINE BACKTICKS IN DIESEM KOMMENTAR: er steht INNERHALB des
           Template-Literals, ein Backtick-Paar schliesst es und macht aus dem
           Rest ein Tagged Template ("TypeError: toolbar is not a function"). -->
      <div class="list-tabs-bar" id="list-tabs-bar"></div>
      <div id="list-content" style="flex:1;display:flex;flex-direction:column;overflow:hidden"></div>
      <button class="page-fab" id="fab-new-item" aria-label="${t('shopping.addItemLabel')}" data-dock-label="${t('newLabel.shopping')}">
        <i data-lucide="plus" class="icon-xl" aria-hidden="true"></i>
      </button>
    </div>
  `);

  renderKitchenTabsBar(container, '/shopping');
  renderTabs(container);
  wireTabBar(container);
  renderListContent(container);
  wireListContentEvents(container);

  findPageFab('fab-new-item')?.addEventListener('click', (e) => {
    const input = container.querySelector('#item-name-input');
    if (!input) {
      // Keine Liste aktiv â†’ neue Liste erstellen
      container.querySelector('[data-action="new-list"]')?.click();
      return;
    }



    if (e.currentTarget.getAttribute('aria-expanded') === 'true') {
      syncQuickAddDisclosure(container, false);
      return;
    }
    syncQuickAddDisclosure(container, true);



    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input.focus();
    input.classList.add('quick-add__input--flash');
    input.addEventListener('animationend', () => input.classList.remove('quick-add__input--flash'), { once: true });
  });

  // Deep-Link: ?highlight=<id> scrollt zum Artikel
  const highlightId = parseInt(new URLSearchParams(window.location.search).get('highlight'), 10) || null;
  if (highlightId) {
    const el = container.querySelector(`[data-action="toggle-item"][data-id="${highlightId}"]`);
    if (el) {


      // Suchtreffer darf nie hinter persistiertem Zustand verschwinden.
      const rowsEl = el.closest('.list-rows');
      if (rowsEl?.hidden) {
        const toggleBtn = rowsEl.closest('.list-group')?.querySelector('[data-category-toggle]');
        if (toggleBtn) toggleCategoryCollapse(toggleBtn);
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }


  if (new URLSearchParams(window.location.search).get('manage') === 'categories') {
    openCategoryManager(container, { fromDeepLink: true });
  }
}

export const __test = {
  shouldIgnoreShoppingRowToggle,


  parseShoppingQuantity,
  // Kategorie-Einklappen (#1039): reine Schluessel-/Speicherfunktionen, ohne


  state,
  categoryStorageKey,
  collapsedCategoriesStorageKey,
  loadCollapsedCategories,
  saveCollapsedCategories,
  pruneCollapsedCategories,
  toggleCategoryCollapse,
  // Sammelaktions-Automat (#1039): eine echte, aber knapp bemessene Frist statt



  updateCheckedActions,
  resetPillMachine,
  getPillPhaseForTest: () => pillPhase,
  setPillInteractingForTest: (value) => { pillInteracting = value; },
  setBulkPillHoldMsForTest: (ms) => { BULK_PILL_HOLD_MS_OVERRIDE = ms; },




  toggleShoppingItem,
  loadItems,
  deleteItemUndoable,
  clearCheckedUndoable,


  openItemDetails,


  pendingRemovals,
  // GET /shopping/suggestions liefert seit #1103 Objekte ({name, category,



  applyAutocompleteSuggestion,
  // Quick-Add-Kategorie-Rueckfall (#548, Review #1165): als eigene Funktion


  resetQuickAddCategory,


  // die Ueberlagerung zeigt.
  intents,
  checkedOf,



  clearItems,
  resetLoadOrderForTest: () => { _appliedLoad.clear(); settledAt.clear(); _loadsInFlight.clear(); _itemsListId = null; },


  liveRefreshPlan,
  refreshFromFeed,
  wireLiveUpdates,
  acknowledgeOwnChange,
  getLiveFeedForTest: () => _liveFeed,
  abortLiveUpdatesForTest: () => { _liveController?.abort(); _liveController = null; _liveFeed = null; },
};

