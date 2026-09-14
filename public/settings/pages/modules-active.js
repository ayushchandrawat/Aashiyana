import { api } from '/api.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { getPreferences, savePreferences } from '/settings/preferences-cache.js';
import { bindDisclosure, thirdPartyStatusLabel, toggleRowHtml } from '/settings/components.js';
import {
  BUILT_IN_MODULES,
  DEFAULT_MODULE_ACCENT,
  KITCHEN_CHILD_IDS,
  KITCHEN_CHILD_LABEL_KEYS,
  NAV_SECTION,
  NAV_SECTIONS,
  NAV_SECTION_LABEL_KEYS,
  moduleSection,
} from '/settings/module-order.js';
import { MODULE_ICON, moduleIconHTML } from '/nav-icons.js';
import { moduleAccentVar } from '/utils/module-accent.js';
import { moduleDisplayLabel } from '/utils/extension-i18n.js';


function buildRows(preferences, thirdPartyModules) {
  const disabled = new Set(Array.isArray(preferences.disabled_modules) ? preferences.disabled_modules : []);
  const rows = [];

  for (const module of BUILT_IN_MODULES) {
    if (KITCHEN_CHILD_IDS.includes(module.id) || module.locked) continue;
    rows.push({
      type: 'built-in',
      id: module.id,
      section: moduleSection(module.id),
      label: t(module.labelKey),
      icon: MODULE_ICON[module.id],
      enabled: !disabled.has(module.id),
    });
  }

  const children = KITCHEN_CHILD_IDS.map((id) => ({
    id,
    label: t(KITCHEN_CHILD_LABEL_KEYS[id]),
    icon: MODULE_ICON[id],
    enabled: !disabled.has(id),
  }));
  const enabledChildren = children.filter((child) => child.enabled).length;
  rows.push({
    type: 'kitchen',
    id: 'kitchen',
    section: NAV_SECTION.household,
    label: t('nav.kitchen'),
    icon: MODULE_ICON.kitchen,
    children,
    enabledChildren,
    enabled: enabledChildren > 0,
  });

  for (const module of thirdPartyModules) {
    rows.push({
      type: 'third-party',
      id: module.id,
      section: NAV_SECTION.customModules,
      label: moduleDisplayLabel(module),
      icon: module.menu?.icon || module.icon || 'box',
      enabled: module.enabled && module.status === 'enabled',
      status: module.menu?.show === false ? t('settings.modulesMenuDisabled') : thirdPartyStatusLabel(module),
      error: module.error,
      toggleDisabled: module.status === 'error',
      hasError: module.status === 'error',
      accent: module.accent,
    });
  }

  return rows;
}

function statusChipHtml(row) {
  if (row.type === 'third-party') {
    const cls = row.hasError
      ? 'settings-module-status--error'
      : row.enabled ? 'settings-module-status--enabled' : 'settings-module-status--disabled';
    return `<span class="settings-module-status ${cls}">${esc(row.status)}</span>`;
  }
  const label = row.enabled ? t('settings.thirdPartyModulesStatusEnabled') : t('settings.thirdPartyModulesStatusDisabled');
  const cls = row.enabled ? 'settings-module-status--enabled' : 'settings-module-status--disabled';
  return `<span class="settings-module-status ${cls}">${esc(label)}</span>`;
}

function rowHtml(row) {
  const stateClass = row.enabled ? 'settings-module-row--enabled' : 'settings-module-row--disabled';




  const accent = row.type === 'third-party'
    ? (esc(row.accent) || DEFAULT_MODULE_ACCENT)
    : moduleAccentVar(row.id);
  const accentStyle = accent ? ` style="--module-row-accent:${accent}"` : '';

  // fuenfter Schalter darueber koennte nur wiederholen, was sie zusammen sagen.
  const toggleAttr = row.type === 'third-party'
    ? { 'data-third-party-module-toggle': row.id }
    : { 'data-built-in-module-toggle': row.id };

  const kitchenPanel = row.type === 'kitchen' ? `
    <button type="button" class="settings-disclosure__trigger settings-module-kitchen__trigger" aria-expanded="false" data-kitchen-expand>
      <span>${t('settings.kitchenActiveCount', { count: row.enabledChildren })}</span>
      <i data-lucide="chevron-down" class="settings-disclosure__icon" aria-hidden="true"></i>
    </button>
    <div class="settings-disclosure__panel settings-module-kitchen__children" data-kitchen-children hidden>
      ${row.children.map((child) => toggleRowHtml({
    label: child.label,
    checked: child.enabled,
    className: 'settings-module-kitchen__child',
    icon: child.icon,
    attrs: { 'data-kitchen-child-toggle': child.id },
  })).join('')}
    </div>` : '';

  return `
    <div class="settings-module-row settings-module-row--fixed ${stateClass}${row.hasError ? ' settings-module-row--error' : ''}" data-module-row-id="${esc(row.id)}">
      <div class="settings-module-row__icon vivid-mark"${accentStyle}>
        ${moduleIconHTML(row.icon)}
      </div>
      <div class="settings-module-row__body">
        <div class="settings-module-row__title">
          <strong>${esc(row.label)}</strong>
          ${row.type === 'third-party' ? `<span class="settings-module-origin">${esc(t('settings.modulesExternalBadge'))}</span>` : ''}
          ${statusChipHtml(row)}
        </div>
        ${row.error ? `<p class="form-error" role="alert">${esc(row.error)}</p>` : ''}
        ${kitchenPanel}
      </div>
      ${row.type === 'kitchen' ? '' : toggleRowHtml({
    label: t('settings.modulesEnableForHousehold', { module: row.label }),
    checked: row.enabled,
    disabled: row.toggleDisabled,
    className: 'settings-module-row__toggle',
    labelVisible: false,
    attrs: toggleAttr,
  })}
    </div>
  `;
}

function sectionHtml(section, rows) {
  const inSection = rows.filter((row) => row.section === section);
  if (!inSection.length) return '';
  return `
    <section class="settings-navigation-group" data-module-section="${esc(section)}">
      <h3 class="settings-navigation-group__title">${t(NAV_SECTION_LABEL_KEYS[section])}</h3>
      <div class="row-carrier settings-modules-list">${inSection.map(rowHtml).join('')}</div>
    </section>
  `;
}

export function collectDisabledModuleIds(list) {
  const ids = new Set();
  for (const input of list.querySelectorAll('[data-built-in-module-toggle]')) {
    if (!input.checked) ids.add(input.dataset.builtInModuleToggle);
  }
  for (const input of list.querySelectorAll('[data-kitchen-child-toggle]')) {
    if (!input.checked) ids.add(input.dataset.kitchenChildToggle);
  }
  return [...ids];
}

export function buildActiveModulesPayload(disabledIds) {
  return { disabled_modules: [...new Set(disabledIds)] };
}

export async function persistHouseholdToggle(input, enabled, save, rerender) {
  input.disabled = true;
  try {
    await save();
  } catch (error) {
    input.checked = !enabled;
    input.disabled = false;
    throw error;
  }
  await rerender();
}

async function saveActiveModules(list) {
  const payload = buildActiveModulesPayload(collectDisabledModuleIds(list));
  const response = await savePreferences(payload);
  const saved = response?.data?.disabled_modules ?? payload.disabled_modules;
  window.aashiyana?.setDisabledModules?.(saved);
}

function bindEvents(container, user) {
  const list = container.querySelector('#module-toggles');
  if (!list) return;

  list.addEventListener('change', async (event) => {
    const input = event.target.closest(
      '[data-built-in-module-toggle], [data-third-party-module-toggle], [data-kitchen-child-toggle]',
    );
    if (!input) return;
    const enabled = input.checked;
    try {
      await persistHouseholdToggle(input, enabled, async () => {
        if (input.dataset.thirdPartyModuleToggle) {
          await api.patch(`/modules/${encodeURIComponent(input.dataset.thirdPartyModuleToggle)}`, { enabled });
          await window.aashiyana?.refreshThirdPartyModules?.();
        }
        await saveActiveModules(list);
        window.aashiyana?.showToast(t('settings.thirdPartyModulesSaved'), 'success');
      }, () => render(container, { user }));
    } catch (error) {
      window.aashiyana?.showToast(error.message ?? t('common.errorGeneric'), 'danger');
    }
  });
}

export async function render(container, { user }) {
  container.replaceChildren();

  let preferences = {};
  let thirdPartyModules = [];
  try {
    const [prefs, modules] = await Promise.all([
      getPreferences(),
      api.get('/modules?admin=1').then((res) => res?.data ?? []).catch(() => []),
    ]);
    preferences = prefs ?? {};
    thirdPartyModules = Array.isArray(modules) ? modules : [];
  } catch (error) {
    container.insertAdjacentHTML('beforeend',
      `<p class="form-error" role="alert">${esc(error.message ?? t('common.errorGeneric'))}</p>`);
    return;
  }

  const rows = buildRows(preferences, thirdPartyModules);

  container.insertAdjacentHTML('beforeend', `
    <section class="settings-section">
      <section class="settings-navigation-panel">
        <h2 class="settings-navigation-panel__title">${t('settings.activeModulesTitle')}</h2>
        <p class="form-hint">${t('settings.activeModulesHint')}</p>
        <div class="settings-navigation-groups" id="module-toggles">
          ${NAV_SECTIONS.map((section) => sectionHtml(section, rows)).join('')}
        </div>
      </section>
    </section>
  `);

  bindDisclosure(container, { triggerSelector: '[data-kitchen-expand]', panelSelector: '[data-kitchen-children]', id: 'kitchen-children-active' });
  bindEvents(container, user);
  window.lucide?.createIcons({ el: container });
}
