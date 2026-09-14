import { api } from '/api.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { toggleRowHtml } from '/settings/components.js';
import { getPreferences, savePreferences } from '/settings/preferences-cache.js';
import { VITAL_METRICS } from '/utils/health-vitals.js';

function visibilityScopes() {
  return [
    {
      titleKey: 'health.tabs.vitals',
      rows: VITAL_METRICS.map((m) => ({ key: `vital:${m.type}`, label: t(m.labelKey) })),
    },
    {
      titleKey: 'settings.healthVisibilityOther',
      rows: [
        { key: 'meds', label: t('health.tabs.meds') },
        { key: 'labs', label: t('health.tabs.labs') },
        { key: 'activities', label: t('health.tabs.activity') },
      ],
    },
  ];
}

function scopeRowHtml(row, current) {
  const isFamily = current === 'family';
  return `
    <div class="form-group">
      <label class="form-label" for="hv-${esc(row.key)}">${esc(row.label)}</label>
      <select class="form-input" id="hv-${esc(row.key)}" data-scope="${esc(row.key)}">
        <option value="private"${isFamily ? '' : ' selected'}>${esc(t('health.vitals.visibility.private'))}</option>
        <option value="family"${isFamily ? ' selected' : ''}>${esc(t('health.vitals.visibility.family'))}</option>
      </select>
    </div>`;
}


function renderPage(container, preferences, defaults) {



  const householdEnabled = preferences.health_cycle_enabled !== false;
  const personalEnabled = preferences.health_cycle_enabled_user !== false;

  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <section class="settings-section">
      <!-- Bewusst NICHT der Blatt-Titel "Gesundheit": die Shell zeigt ihn bereits
           darüber, und ein h2, das ihn wiederholt, ist eine Überschrift ohne
           Aussage (Guard in test-typography.js). -->
      <h2 class="settings-section__title">${t('health.tabs.cycle')}</h2>
      <div class="settings-card">
        <p class="settings-card-description">${t('settings.healthCyclePersonalHint')}</p>
        ${toggleRowHtml({
          label: t('settings.healthCyclePersonalLabel'),
          checked: personalEnabled,
          disabled: !householdEnabled,
          attrs: { id: 'health-cycle-personal' },
        })}
        ${householdEnabled ? '' : `<p class="form-hint">${t('settings.healthCyclePersonalHouseholdOff')}</p>`}
      </div>
    </section>
    <section class="settings-section">
      <h2 class="settings-section__title">${t('settings.healthVisibilityTitle')}</h2>
      <div class="settings-card">
        <p class="settings-card-description">${t('settings.healthVisibilityHint')}</p>
        ${visibilityScopes().map((group) => `
          <h3 class="settings-card__title">${esc(t(group.titleKey))}</h3>
          ${group.rows.map((row) => scopeRowHtml(row, defaults[row.key])).join('')}
        `).join('')}
        <div class="form-group" id="hv-apply" hidden>
          <p class="form-hint" id="hv-apply-text"></p>
          <button type="button" class="btn btn--secondary btn--sm" id="hv-apply-btn"></button>
        </div>
      </div>
    </section>
  `);
}

function bindEvents(container) {
  const input = container.querySelector('#health-cycle-personal');
  input?.addEventListener('change', async () => {
    input.disabled = true;
    try {
      await savePreferences({ health_cycle_enabled_user: input.checked });
      window.aashiyana?.showToast(t('settings.healthCyclePersonalSaved'), 'success');
    } catch (error) {
      input.checked = !input.checked;
      window.aashiyana?.showToast(error.message || t('common.errorGeneric'), 'danger');
    } finally {
      if (input.isConnected) input.disabled = false;
    }
  });
}

function bindVisibilityEvents(container) {
  const applyBox = container.querySelector('#hv-apply');
  const applyText = container.querySelector('#hv-apply-text');
  const applyBtn = container.querySelector('#hv-apply-btn');
  if (!applyBox || !applyText || !applyBtn) return;
  let pending = null;

  const hideApply = () => {
    applyBox.hidden = true;
    pending = null;
  };

  for (const select of container.querySelectorAll('[data-scope]')) {
    select.addEventListener('change', async () => {
      const scope = select.dataset.scope;
      const visibility = select.value;
      const label = container.querySelector(`label[for="hv-${CSS.escape(scope)}"]`)?.textContent || scope;
      select.disabled = true;
      try {
        await api.put('/health/visibility-defaults', { defaults: { [scope]: visibility } });
        pending = { scope, visibility };
        applyText.textContent = t('settings.healthVisibilityApplyHint', { area: label });
        applyBtn.textContent = t('settings.healthVisibilityApply');
        applyBox.hidden = false;
      } catch (error) {
        hideApply();
        window.aashiyana?.showToast(error.message || t('common.errorGeneric'), 'danger');
      } finally {
        if (select.isConnected) select.disabled = false;
      }
    });
  }

  applyBtn.addEventListener('click', async () => {
    if (!pending) return;
    applyBtn.disabled = true;
    try {
      const res = await api.patch('/health/visibility-defaults/apply', pending);
      const updated = Number(res?.data?.updated || 0);
      window.aashiyana?.showToast(t('settings.healthVisibilityApplied', { count: updated }), 'success');
      hideApply();
    } catch (error) {
      window.aashiyana?.showToast(error.message || t('common.errorGeneric'), 'danger');
    } finally {
      applyBtn.disabled = false;
    }
  });
}

export async function render(container, { user }) {
  void user;


  const [preferences, defaults] = await Promise.all([
    getPreferences(),
    api.get('/health/visibility-defaults')
      .then((res) => res?.data?.defaults || {})
      .catch(() => ({})),
  ]);
  renderPage(container, preferences, defaults);
  bindEvents(container);
  bindVisibilityEvents(container);
}
