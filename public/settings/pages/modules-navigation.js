import { api } from '/api.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { getPreferences, savePreferences } from '/settings/preferences-cache.js';
import { bindDisclosure, createRetryState, thirdPartyStatusLabel } from '/settings/components.js';
import {
  BUILT_IN_MODULES,
  DEFAULT_MODULE_ACCENT,
  KITCHEN_CHILD_IDS,
  KITCHEN_CHILD_LABEL_KEYS,
  NAV_SECTION,
  NAV_SECTIONS,
  NAV_SECTION_LABEL_KEYS,
  expandModuleOrder,
  moduleSection,
  normalizeModuleOrder,
  normalizeMobileNavOrder,
  resolveMobileNavOrder,
  sortNavigationItems,
} from '/settings/module-order.js';
import { MODULE_ICON, moduleIconHTML } from '/nav-icons.js';
import { moduleAccentVar } from '/utils/module-accent.js';
import { moduleDisplayLabel } from '/utils/extension-i18n.js';
import { emptyStateHTML } from '/utils/empty-state.js';



// normalisierten Modul-Reihenfolge der Preferences.
function buildRows(preferences, thirdPartyModules) {
  const disabled = new Set(Array.isArray(preferences.disabled_modules) ? preferences.disabled_modules : []);


  // in server/routes/preferences.js.
  const hidden = new Set(Array.isArray(preferences.hidden_modules) ? preferences.hidden_modules : []);
  const kitchenChildren = KITCHEN_CHILD_IDS.map((id) => ({
    id,
    label: t(KITCHEN_CHILD_LABEL_KEYS[id]),
    icon: MODULE_ICON[id],
    enabled: !disabled.has(id),
    hidden: hidden.has(id),
  }));

  const rows = [];
  let kitchenInserted = false;

  for (const module of BUILT_IN_MODULES) {
    if (KITCHEN_CHILD_IDS.includes(module.id)) continue;
    rows.push({
      type: 'built-in',
      id: module.id,
      orderId: module.id,
      section: moduleSection(module.id),
      label: t(module.labelKey),
      icon: MODULE_ICON[module.id],
      enabled: module.locked || !disabled.has(module.id),
      hidden: hidden.has(module.id),
      locked: module.locked === true,
      sortable: module.locked !== true,
    });
  }

  const kitchenEnabledChildren = kitchenChildren.filter((child) => child.enabled).length;
  const kitchenRow = {
    type: 'kitchen',
    id: 'kitchen',
    orderId: 'kitchen',
    section: NAV_SECTION.household,
    label: t('nav.kitchen'),
    icon: MODULE_ICON.kitchen,
    children: kitchenChildren,
    enabledChildren: kitchenEnabledChildren,
    enabled: kitchenEnabledChildren > 0,

    // Seitenleiste. Ihr Ausblenden-Knopf steht deshalb fuer die Gruppe: er gilt

    // Kinder bleiben im aufgeklappten Feld getrennt schaltbar.
    hidden: kitchenGroupHidden(kitchenChildren),
    locked: false,
    sortable: true,
  };

  const thirdPartyRows = thirdPartyModules.map((module) => {
    const menuHidden = module.menu?.show === false;
    return {
      type: 'third-party',
      id: module.id,
      orderId: `third-party-${module.id}`,
      section: NAV_SECTION.customModules,
      label: moduleDisplayLabel(module),
      icon: module.menu?.icon || module.icon || 'box',
      enabled: module.enabled && module.status === 'enabled',
      status: menuHidden ? t('settings.modulesMenuDisabled') : thirdPartyStatusLabel(module),
      error: module.error,
      toggleDisabled: module.status === 'error',
      hasError: module.status === 'error',
      menuHidden,
      sortable: !menuHidden,
      accent: module.accent,
      locked: false,
    };
  });



  const ordered = [];
  for (const row of rows) {
    if (!kitchenInserted && ['housekeeping', 'documents', 'rewards', 'contacts', 'birthdays', 'health', 'budget'].includes(row.id)) {
      ordered.push(kitchenRow);
      kitchenInserted = true;
    }
    ordered.push(row);
  }
  if (!kitchenInserted) ordered.push(kitchenRow);
  ordered.push(...thirdPartyRows);


  // Dashboard und Settings bleiben an ihren festen Positionen.
  const normalizedOrder = normalizeModuleOrder(preferences.module_order || []);
  return sortNavigationItems(ordered, normalizedOrder);
}

function rowControlsHtml(row) {
  if (!row.sortable) return '';
  return `
    <button type="button" class="settings-module-drag" aria-label="${esc(t('settings.modulesDragHandle'))}" title="${esc(t('settings.modulesDragHandle'))}">
      <i data-lucide="grip-vertical" aria-hidden="true"></i>
    </button>
    <div class="settings-module-move-buttons">
      <button type="button" class="settings-module-move" data-module-move="up" aria-label="${esc(t('settings.modulesMoveUp'))}" title="${esc(t('settings.modulesMoveUp'))}">
        <i data-lucide="chevron-up" aria-hidden="true"></i>
      </button>
      <button type="button" class="settings-module-move" data-module-move="down" aria-label="${esc(t('settings.modulesMoveDown'))}" title="${esc(t('settings.modulesMoveDown'))}">
        <i data-lucide="chevron-down" aria-hidden="true"></i>
      </button>
    </div>
  `;
}

function hideToggleHtml(row, { hasStatusChip = true } = {}) {
  const label = row.groupLabelKey
    ? t(row.groupLabelKey)
    : t('settings.modulesHideForMe', { module: row.label });



  // beheben sollte (Review zu PR #790).
  const describedBy = (!row.enabled && hasStatusChip)
    ? ` aria-describedby="module-status-${esc(row.id)}"`
    : '';
  return `
    <button type="button" class="settings-module-hide" data-module-hide="${esc(row.id)}"
            aria-pressed="${row.hidden ? 'true' : 'false'}" ${row.enabled ? '' : 'disabled'}
            aria-label="${esc(label)}" title="${esc(label)}"${describedBy}>
      <i data-lucide="eye-off" aria-hidden="true"></i>
    </button>
  `;
}

function statusChipHtml(row) {
  if (!row.enabled) {
    return `<span class="settings-module-status settings-module-status--disabled" id="module-status-${esc(row.id)}">${esc(t('settings.thirdPartyModulesStatusDisabled'))}</span>`;
  }
  if (row.hidden) {
    return `<span class="settings-module-status settings-module-status--hidden">${esc(t('settings.modulesHiddenForMe'))}</span>`;
  }
  return '';
}

function builtInRowHtml(row) {
  const stateClass = row.enabled ? 'settings-module-row--enabled' : 'settings-module-row--disabled';
  const lockedClass = row.locked ? ' settings-module-row--locked' : '';
  const hiddenClass = row.hidden && row.enabled ? ' settings-module-row--hidden' : '';
  return `
    <div class="settings-module-row settings-module-row--sortable ${stateClass}${lockedClass}${hiddenClass}${row.sortable ? '' : ' settings-module-row--fixed'}" data-module-row-id="${esc(row.orderId)}"${row.sortable ? ` draggable="true" data-module-order-id="${esc(row.orderId)}"` : ''}>
      ${rowControlsHtml(row)}
      <div class="settings-module-row__icon vivid-mark" style="--module-row-accent:${moduleAccentVar(row.id)}">
        ${moduleIconHTML(row.icon)}
      </div>
      <div class="settings-module-row__body">
        <div class="settings-module-row__title">
          <strong>${esc(row.label)}</strong>
          ${row.locked ? `<span class="settings-module-origin">${esc(t('settings.modulesBuiltInBadge'))}</span>` : ''}
          ${statusChipHtml(row)}
        </div>
      </div>
      ${row.locked ? '' : hideToggleHtml(row)}
    </div>
  `;
}

function kitchenRowHtml(row) {
  const stateClass = row.enabled ? 'settings-module-row--enabled' : 'settings-module-row--disabled';
  const hiddenClass = row.hidden && row.enabled ? ' settings-module-row--hidden' : '';
  return `
    <div class="settings-module-row settings-module-row--sortable settings-module-row--kitchen ${stateClass}${hiddenClass}" data-module-row-id="${esc(row.orderId)}" draggable="true" data-module-order-id="${esc(row.orderId)}">
      ${rowControlsHtml(row)}
      <div class="settings-module-row__icon vivid-mark" style="--module-row-accent:${moduleAccentVar('kitchen')}">
        ${moduleIconHTML(row.icon)}
      </div>
      <div class="settings-module-row__body">
        <div class="settings-module-row__title">
          <strong>${esc(row.label)}</strong>
          ${statusChipHtml(row)}
        </div>
        <button type="button" class="settings-disclosure__trigger settings-module-kitchen__trigger" aria-expanded="false" data-kitchen-expand>
          <span>${t('settings.kitchenActiveCount', { count: row.enabledChildren })}</span>
          <i data-lucide="chevron-down" class="settings-disclosure__icon" aria-hidden="true"></i>
        </button>
        <div class="settings-disclosure__panel settings-module-kitchen__children" data-kitchen-children hidden>
          ${row.children.map((child) => `
            <div class="settings-module-kitchen__child-row${child.hidden && child.enabled ? ' settings-module-kitchen__child-row--hidden' : ''}">
              <div class="settings-module-kitchen__child">
                ${moduleIconHTML(child.icon)}
                <span>${esc(child.label)}</span>
              </div>
              ${hideToggleHtml(child, { hasStatusChip: false })}
            </div>`).join('')}
        </div>
      </div>
      ${hideToggleHtml({ ...row, id: 'kitchen', groupLabelKey: 'settings.modulesHideKitchenForMe' })}
    </div>
  `;
}

function thirdPartyRowHtml(row) {
  const statusClass = row.hasError
    ? 'settings-module-status--error'
    : row.enabled ? 'settings-module-status--enabled' : 'settings-module-status--disabled';
  const stateClass = row.enabled ? 'settings-module-row--enabled' : 'settings-module-row--disabled';
  const errorClass = row.hasError ? ' settings-module-row--error' : '';
  return `
    <div class="settings-module-row settings-module-row--sortable ${stateClass}${errorClass}${row.sortable ? '' : ' settings-module-row--fixed'}" data-module-row-id="${esc(row.orderId)}"${row.sortable ? ` draggable="true" data-module-order-id="${esc(row.orderId)}"` : ''}>
      ${rowControlsHtml(row)}
      <div class="settings-module-row__icon vivid-mark" style="--module-row-accent:${esc(row.accent) || DEFAULT_MODULE_ACCENT}">
        ${moduleIconHTML(row.icon)}
      </div>
      <div class="settings-module-row__body">
        <div class="settings-module-row__title">
          <strong>${esc(row.label)}</strong>
          <span class="settings-module-origin">${esc(t('settings.modulesExternalBadge'))}</span>
          <span class="settings-module-status ${statusClass}">${esc(row.status)}</span>
        </div>
        ${row.error ? `<p class="form-error" role="alert">${esc(row.error)}</p>` : ''}
      </div>
    </div>
  `;
}

function rowHtml(row) {
  if (row.type === 'kitchen') return kitchenRowHtml(row);

  // gar nicht abgefragt, thirdPartyModules bleibt leer.
  if (row.type === 'third-party') return thirdPartyRowHtml(row);
  return builtInRowHtml(row);
}

function mobileCandidateRows(rows) {
  return rows.filter((row) => (
    row.enabled

    // Mobil-Favorit angeboten bekommen (#673).
    && !row.hidden
    && !row.locked
    && row.sortable
    && !row.menuHidden
  ));
}

function mobileSlotHtml(rows, selectedIds, index) {
  const selectedId = selectedIds[index] ?? '';
  const selectedElsewhere = new Set(selectedIds.filter((_, slot) => slot !== index));
  const label = t('settings.mobileNavigationSlotLabel', { position: index + 1 });

  return `
    <label class="settings-mobile-nav-slot">
      <span class="settings-mobile-nav-slot__label">${esc(label)}</span>
      <select class="form-input" data-mobile-nav-slot aria-label="${esc(label)}"${selectedId ? '' : ' disabled'}>
        ${selectedId ? '' : `<option value="" selected>${esc(t('settings.mobileNavigationEmptyOption'))}</option>`}
        ${rows.map((row) => `
          <option value="${esc(row.orderId)}"${row.orderId === selectedId ? ' selected' : ''}${selectedElsewhere.has(row.orderId) ? ' disabled' : ''}>
            ${esc(row.label)}
          </option>
        `).join('')}
      </select>
    </label>
  `;
}

function desktopGroupHtml(section, rows) {
  const sectionRows = rows.filter((row) => row.section === section);
  if (!sectionRows.length) return '';

  return `
    <section class="settings-navigation-group" data-module-section="${section}">
      <h3 class="settings-navigation-group__title">${esc(t(NAV_SECTION_LABEL_KEYS[section]))}</h3>
      <div class="row-carrier settings-modules-list settings-modules-list--sortable" data-module-list>
        ${sectionRows.map((row) => rowHtml(row)).join('')}
      </div>
    </section>
  `;
}

function renderPage(container, rows, mobileOrder) {
  container.replaceChildren();
  const desktopGroups = rows.length
    ? `<div class="settings-navigation-groups" id="module-toggles">${NAV_SECTIONS.map((section) => desktopGroupHtml(section, rows)).join('')}</div>`
    : emptyStateHTML({
      compact: true,
      title: t('settings.thirdPartyModulesEmptyTitle'),
      description: t('settings.thirdPartyModulesEmptyHint'),
    });
  const mobileRows = mobileCandidateRows(rows);

  container.insertAdjacentHTML('beforeend', `
    <section class="settings-section">
      <section class="settings-navigation-panel">
        <h2 class="settings-navigation-panel__title">${t('settings.mobileNavigationTitle')}</h2>
        <p class="form-hint">${t('settings.mobileNavigationHint')}</p>
        <div class="settings-mobile-nav-slots">
          ${[0, 1, 2].map((index) => mobileSlotHtml(mobileRows, mobileOrder, index)).join('')}
        </div>
      </section>
      <section class="settings-navigation-panel">
        <h2 class="settings-navigation-panel__title">${t('settings.desktopNavigationTitle')}</h2>
        <p class="form-hint">${t('settings.desktopNavigationHint')}</p>
        <p class="form-hint">${t('settings.modulesDragHint')}</p>
        <p class="form-hint">${t('settings.modulesHiddenScopeHint')}</p>
        ${desktopGroups}
      </section>
    </section>
  `);
  window.lucide?.createIcons({ el: container });
}



// kanonischen Kitchen-Kinder erweitert.
function collectVisibleGlobalOrder(list) {
  return [...list.querySelectorAll('[data-module-order-id]')]
    .map((rowEl) => rowEl.dataset.moduleOrderId)
    .filter(Boolean);
}

function collectHiddenModuleIds(buttons) {
  const ids = new Set();
  for (const btn of buttons) {
    if (btn.getAttribute('aria-pressed') !== 'true') continue;
    const id = btn.dataset.moduleHide;
    if (!id || id === 'kitchen') continue;
    ids.add(id);
  }
  return [...ids];
}

export function buildOrderPayload(visibleGlobalOrder, unrenderedIds = []) {
  const visible = expandModuleOrder(visibleGlobalOrder);

  // bekommt `/modules?admin=1` nicht, also stehen Drittanbieter-Module gar



  // PR #790).
  const missing = unrenderedIds.filter((id) => !visible.includes(id));
  return {
    module_order: [...visible, ...missing],
  };
}

export function buildMobileNavigationPayload(order) {
  return {
    mobile_nav_order: normalizeMobileNavOrder(order),
  };
}

async function saveNavigationState(list, unrenderedOrderIds = [], mobileOrder = null) {
  const payload = {
    ...buildOrderPayload(collectVisibleGlobalOrder(list), unrenderedOrderIds),
    hidden_modules: collectHiddenModuleIds(list.querySelectorAll('[data-module-hide]')),




    // (Codex-Review zu PR #790).
    ...(mobileOrder ? { mobile_nav_order: mobileOrder } : {}),
  };
  const response = await savePreferences(payload);
  window.aashiyana?.setHiddenModules?.(response?.data?.hidden_modules ?? payload.hidden_modules);
  window.aashiyana?.setModuleOrder?.(response?.data?.module_order ?? payload.module_order);
  if (mobileOrder) {
    window.aashiyana?.setMobileNavOrder?.(response?.data?.mobile_nav_order ?? payload.mobile_nav_order);
  }
}

function bindModuleListEvents(container, user, rows, unrenderedOrderIds = []) {
  const list = container.querySelector('#module-toggles');
  if (!list) return;
  let dragged = null;
  let dragStartOrder = '';

  let saving = false;
  let queued = false;
  let busy = false;

  const flush = async (toastKey) => {
    if (saving) { queued = true; return; }
    saving = true;
    try {
      await saveNavigationState(list, unrenderedOrderIds);
      window.aashiyana?.showToast(t(toastKey), 'success');
    } catch (error) {
      window.aashiyana?.showToast(error.message ?? t('common.errorGeneric'), 'danger');
      await render(container, { user });
      return;
    } finally {
      saving = false;
    }
    if (queued) {
      queued = false;
      await flush(toastKey);
    }
  };

  const saveIfChanged = async (previousOrder) => {
    const currentOrder = collectVisibleGlobalOrder(list).join('|');
    if (currentOrder === previousOrder) return;
    await flush('settings.modulesOrderSaved');
  };

  list.addEventListener('dragstart', (event) => {
    const row = event.target.closest('[data-module-order-id]');
    if (!row) return;
    dragged = row;
    dragStartOrder = collectVisibleGlobalOrder(list).join('|');
    row.classList.add('settings-module-row--dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', row.dataset.moduleOrderId);
  });

  list.addEventListener('dragend', async () => {
    const previousOrder = dragStartOrder;
    dragged?.classList.remove('settings-module-row--dragging');
    dragged = null;
    dragStartOrder = '';
    await saveIfChanged(previousOrder);
  });

  list.addEventListener('dragover', (event) => {
    if (!dragged) return;
    const row = event.target.closest('[data-module-order-id]');
    if (!row || row === dragged) return;
    const draggedGroup = dragged.closest('[data-module-section]');
    const targetGroup = row.closest('[data-module-section]');
    if (!draggedGroup || draggedGroup !== targetGroup) return;
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    row.parentElement.insertBefore(dragged, before ? row : row.nextSibling);
  });

  list.addEventListener('drop', (event) => {
    if (!dragged) return;
    event.preventDefault();
  });

  list.addEventListener('click', async (event) => {
    if (event.target.closest('[data-kitchen-expand]')) return;
    const btn = event.target.closest('[data-module-move]');
    if (!btn || btn.disabled) return;
    const row = btn.closest('[data-module-order-id]');
    if (!row) return;
    const previousOrder = collectVisibleGlobalOrder(list).join('|');
    if (btn.dataset.moduleMove === 'up') {
      const prev = row.previousElementSibling;
      if (prev?.matches('[data-module-order-id]')) row.parentElement.insertBefore(row, prev);
    } else {
      const next = row.nextElementSibling;
      if (next?.matches('[data-module-order-id]')) row.parentElement.insertBefore(next, row);
    }
    await saveIfChanged(previousOrder);
  });

  list.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-module-hide]');
    if (!btn || btn.disabled || busy) return;
    const wasHidden = btn.getAttribute('aria-pressed') === 'true';
    const previousMobile = readMobileSlotValues(container);

    applyHiddenState(btn, !wasHidden);
    markRowHidden(rows, btn.dataset.moduleHide, !wasHidden);


    if (btn.dataset.moduleHide === 'kitchen') {
      for (const child of list.querySelectorAll('[data-module-hide]')) {
        if (child !== btn && KITCHEN_CHILD_IDS.includes(child.dataset.moduleHide) && !child.disabled) {
          applyHiddenState(child, !wasHidden);
        }
      }
    } else if (KITCHEN_CHILD_IDS.includes(btn.dataset.moduleHide)) {


      syncKitchenGroupState(list, rows);
    }




    // geschrieben wird.
    busy = true;
    btn.setAttribute('aria-busy', 'true');



    refreshMobileSlots(container, rows, user);
    const nextMobile = readMobileSlotValues(container);
    const mobileChanged = nextMobile.join('|') !== previousMobile.join('|');

    try {
      if (saving) { queued = true; } else {
        saving = true;
        try {
          await saveNavigationState(list, unrenderedOrderIds, mobileChanged ? nextMobile : null);
        } finally {
          saving = false;
        }
        if (queued) { queued = false; await flush('settings.modulesOrderSaved'); }
      }
      window.aashiyana?.showToast(hideToastMessage(container, previousMobile), 'success');
    } catch (error) {
      window.aashiyana?.showToast(error.message ?? t('common.errorGeneric'), 'danger');
      await render(container, { user });
    } finally {
      busy = false;
      btn.removeAttribute('aria-busy');
    }
  });
}

function readMobileSlotValues(container) {
  return [...container.querySelectorAll('[data-mobile-nav-slot]')].map((select) => select.value);
}

function slotLabel(container, index) {
  const select = container.querySelectorAll('[data-mobile-nav-slot]')[index];
  return select?.selectedOptions?.[0]?.textContent?.trim() ?? '';
}

function hideToastMessage(container, previousMobile) {
  const current = readMobileSlotValues(container);
  const changed = current.findIndex((value, index) => value !== previousMobile[index]);
  if (changed === -1) return t('settings.modulesSaved');
  return t('settings.modulesHiddenSavedSlot', {
    position: changed + 1,
    module: slotLabel(container, changed),
  });
}

function refreshMobileSlots(container, rows, user) {
  const wrap = container.querySelector('.settings-mobile-nav-slots');
  if (!wrap) return;
  const candidates = mobileCandidateRows(rows);
  const order = resolveMobileNavOrder(readMobileSlotValues(container), candidates.map((row) => row.orderId));
  wrap.replaceChildren();
  wrap.insertAdjacentHTML('beforeend',
    [0, 1, 2].map((index) => mobileSlotHtml(candidates, order, index)).join(''));
  bindMobileNavigationEvents(container, user);
}

function markRowHidden(rows, id, hidden) {
  if (!Array.isArray(rows) || !id) return;
  for (const row of rows) {
    if (row.id === id) row.hidden = hidden;
    if (id === 'kitchen' && Array.isArray(row.children)) {
      row.children.forEach((child) => { if (child.enabled) child.hidden = hidden; });
    }
    if (Array.isArray(row.children) && row.children.some((child) => child.id === id)) {
      row.children.forEach((child) => { if (child.id === id) child.hidden = hidden; });
      row.hidden = kitchenGroupHidden(row.children);
    }
  }
}

function applyHiddenState(btn, hidden) {
  btn.setAttribute('aria-pressed', String(hidden));
  const childRow = btn.closest('.settings-module-kitchen__child-row');
  if (childRow) {
    childRow.classList.toggle('settings-module-kitchen__child-row--hidden', hidden);
    return;
  }

  const row = btn.closest('.settings-module-row');
  if (!row) return;
  const disabled = row.classList.contains('settings-module-row--disabled');
  row.classList.toggle('settings-module-row--hidden', hidden && !disabled);
  const title = row.querySelector('.settings-module-row__title');
  const chip = title?.querySelector('.settings-module-status--hidden');
  if (hidden && title && !chip && !disabled) {
    title.insertAdjacentHTML('beforeend',
      `<span class="settings-module-status settings-module-status--hidden">${esc(t('settings.modulesHiddenForMe'))}</span>`);
  } else if (!hidden && chip) {
    chip.remove();
  }
}

export function kitchenGroupHidden(children = []) {
  const relevant = children.filter((child) => child.enabled);
  if (!relevant.length) return false;
  return relevant.every((child) => child.hidden);
}

function syncKitchenGroupState(list, rows) {
  const groupBtn = list.querySelector('[data-module-hide="kitchen"]');
  const kitchen = rows?.find((row) => row.id === 'kitchen');
  if (!groupBtn || !kitchen) return;
  const hidden = kitchenGroupHidden(kitchen.children);
  if (groupBtn.getAttribute('aria-pressed') === String(hidden)) return;
  applyHiddenState(groupBtn, hidden);
}

function bindMobileNavigationEvents(container, user) {
  const selects = [...container.querySelectorAll('[data-mobile-nav-slot]')];
  if (!selects.length) return;

  selects.forEach((changedSelect) => {
    changedSelect.addEventListener('change', async () => {



      const payload = buildMobileNavigationPayload(selects.map((select) => select.value));
      selects.forEach((select) => { select.disabled = true; });

      try {
        const response = await savePreferences(payload);
        const savedOrder = response?.data?.mobile_nav_order ?? payload.mobile_nav_order;
        window.aashiyana?.setMobileNavOrder?.(savedOrder);
        window.aashiyana?.showToast(t('settings.mobileNavigationSaved'), 'success');
        await render(container, { user });
      } catch (error) {
        selects.forEach((select) => { select.disabled = false; });
        window.aashiyana?.showToast(error.message ?? t('common.errorGeneric'), 'danger');
      }
    });
  });
}

export async function render(container, { user }) {
  const isAdmin = user?.role === 'admin';
  const [preferencesResult, modulesResult] = await Promise.allSettled([
    getPreferences(),
    isAdmin ? api.get('/modules?admin=1') : Promise.resolve({ data: [] }),
  ]);

  if (preferencesResult.status !== 'fulfilled' || !preferencesResult.value) {
    container.replaceChildren();
    container.appendChild(createRetryState({
      message: preferencesResult.reason?.message ?? t('common.errorGeneric'),
      onRetry: () => render(container, { user }),
    }));
    return;
  }
  // getPreferences() liefert bereits das entpackte Preferences-Objekt (kein

  // `preferences` dauerhaft leer: disabled_modules war nie gesetzt, jeder

  const preferences = preferencesResult.value;
  const thirdPartyModules = modulesResult.status === 'fulfilled' ? (modulesResult.value?.data ?? []) : [];

  const rows = buildRows(preferences, thirdPartyModules);
  const renderedOrderIds = new Set(expandModuleOrder(rows.map((row) => row.orderId)));
  const unrenderedOrderIds = (Array.isArray(preferences.module_order) ? preferences.module_order : [])
    .filter((id) => !renderedOrderIds.has(id));
  const availableMobileIds = mobileCandidateRows(rows).map((row) => row.orderId);
  const mobileOrder = resolveMobileNavOrder(preferences.mobile_nav_order, availableMobileIds);
  renderPage(container, rows, mobileOrder);
  bindDisclosure(container, { triggerSelector: '[data-kitchen-expand]', panelSelector: '[data-kitchen-children]', id: 'kitchen-children-navigation' });
  bindModuleListEvents(container, user, rows, unrenderedOrderIds);
  bindMobileNavigationEvents(container, user);
}
