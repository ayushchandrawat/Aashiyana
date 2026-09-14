import { api } from '/api.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { caldavTargetValue, SYNC_TARGET_LOCAL } from '/utils/sync-target.js';
import { getPreferences, savePreferences } from '/settings/preferences-cache.js';


export function reminderTargetOptions(lists, labels, current = '') {
  const options = [{ value: SYNC_TARGET_LOCAL, label: labels.local, group: null }];

  for (const list of lists || []) {
    options.push({
      value: caldavTargetValue(list.accountId, list.listUrl),
      label: list.listName || list.listUrl,
      group: list.accountName,
    });
  }




  if (current && !options.some((option) => option.value === current)) {
    options.push({ value: current, label: labels.unavailable, group: null });
  }

  return options;
}

function targetFieldHtml(options, current) {
  let html = '';
  let openGroup = null;
  for (const option of options) {
    if (option.group !== openGroup) {
      if (openGroup) html += '</optgroup>';
      openGroup = option.group;
      if (openGroup) html += `<optgroup label="${esc(openGroup)}">`;
    }
    const selected = option.value === current ? ' selected' : '';
    html += `<option value="${esc(option.value)}"${selected}>${esc(option.label)}</option>`;
  }
  if (openGroup) html += '</optgroup>';

  return `
        <div class="form-group">
          <label class="form-label" for="tasks-default-target">${t('settings.tasksDefaultTargetLabel')}</label>
          <select id="tasks-default-target" class="form-input">${html}</select>
          <p class="form-hint">${t('settings.tasksDefaultTargetHint')}</p>
        </div>
  `;
}

function renderPage(container, preferences, lists = null) {
  const current = preferences.tasks_default_target || '';




  const options = lists ? reminderTargetOptions(lists, {
    local: t('tasks.syncTargetLocal'),
    unavailable: t('settings.tasksDefaultTargetUnavailable'),
  }, current) : [];

  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <section class="settings-section">
      <!-- Bewusst NICHT der Blatt-Titel: die Shell zeigt ihn bereits darüber,
           und ein h2, das ihn wiederholt, ist eine Überschrift ohne Aussage
           (Guard in test-typography.js). -->
      <h2 class="settings-section__title">${t('settings.tasksDefaultsTitle')}</h2>
      <div class="settings-card">
        <p class="settings-card-description">${t('settings.tasksDefaultsDescription')}</p>
${options.length > 1 ? targetFieldHtml(options, current) : `        <p class="form-hint">${t('settings.tasksDefaultTargetEmpty')}</p>`}
      </div>
    </section>
  `);
}


// abgelehnter Wert nicht sichtbar stehenbleibt.
function bindEvents(container) {
  const select = container.querySelector('#tasks-default-target');
  if (!select) return;

  let persisted = select.value;
  select.addEventListener('change', async () => {
    const value = select.value;
    select.disabled = true;
    try {
      await savePreferences({ tasks_default_target: value });
      persisted = value;
      window.aashiyana?.showToast(t('settings.tasksDefaultsSaved'), 'success');
    } catch (error) {
      select.value = persisted;
      window.aashiyana?.showToast(error.message || t('common.errorGeneric'), 'danger');
    } finally {
      if (select.isConnected) select.disabled = false;
    }
  });
}

export async function render(container, { user }) {
  void user;
  const [preferences, lists] = await Promise.all([
    getPreferences(),
    api.get('/tasks/sync-targets')
      .then((res) => res.data?.caldav || [])
      .catch(() => null),
  ]);
  renderPage(container, preferences, lists);
  bindEvents(container);
}
