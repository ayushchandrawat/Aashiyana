
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { iconNames, iconElement } from '/utils/lucide-icons.js';
import { attachOverlay, dropOverlay } from '/utils/overlay-history.js';

const MAX_RESULTS = 120;

const SUGGESTIONS = [
  'clapperboard', 'film', 'tv', 'music', 'headphones', 'radio',
  'image', 'camera', 'library', 'book-open', 'newspaper', 'rss',
  'server', 'database', 'hard-drive', 'cloud', 'folder', 'files',
  'house', 'lightbulb', 'thermometer', 'plug', 'wifi', 'router',
  'shield', 'lock', 'key-round', 'user-round', 'users', 'mail',
  'message-circle', 'calendar', 'list-checks', 'shopping-cart', 'wallet', 'chart-line',
  'gamepad-2', 'dumbbell', 'heart-pulse', 'stethoscope', 'car', 'plane',
  'utensils', 'coffee', 'leaf', 'dog', 'graduation-cap', 'wrench',
];

export function searchIcons(term, vocabulary = iconNames(), suggestions = SUGGESTIONS) {
  const needle = String(term ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!needle) {


    const known = new Set(vocabulary);
    return suggestions.filter((name) => known.has(name));
  }

  const starts = [];
  const contains = [];
  for (const name of vocabulary) {
    if (name.startsWith(needle)) starts.push(name);
    else if (contains.length < MAX_RESULTS && name.includes(needle)) contains.push(name);
    if (starts.length >= MAX_RESULTS) break;
  }
  return [...starts, ...contains].slice(0, MAX_RESULTS);
}

function tile(name, isCurrent) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `icon-picker__tile${isCurrent ? ' icon-picker__tile--current' : ''}`;
  btn.dataset.icon = name;
  btn.title = name;


  btn.setAttribute('aria-label', name);
  btn.setAttribute('aria-pressed', isCurrent ? 'true' : 'false');
  const svg = iconElement(name);
  if (svg) btn.appendChild(svg);
  return btn;
}

function buildDialog(current, resolve, suggestions) {
  const dialog = document.createElement('dialog');
  dialog.className = 'icon-picker';
  dialog.setAttribute('aria-label', t('iconPicker.title'));

  dialog.insertAdjacentHTML('afterbegin', `
    <div class="icon-picker__body">
      <header class="icon-picker__header">
        <h2 class="icon-picker__title">${esc(t('iconPicker.title'))}</h2>
      </header>
      <div class="icon-picker__search">
        <label class="sr-only" for="icon-picker-search">${esc(t('iconPicker.searchLabel'))}</label>
        <input type="search" class="form-input" id="icon-picker-search"
               placeholder="${esc(t('iconPicker.searchPlaceholder'))}" autocomplete="off">
      </div>
      <div class="icon-picker__results" id="icon-picker-results" role="group"
           aria-label="${esc(t('iconPicker.resultsLabel'))}"></div>
      <p class="icon-picker__empty" id="icon-picker-empty" hidden>${esc(t('iconPicker.noResults'))}</p>
      <footer class="icon-picker__footer">
        <button type="button" class="btn btn--ghost" id="icon-picker-clear">${esc(t('iconPicker.clear'))}</button>
        <button type="button" class="btn btn--secondary" id="icon-picker-cancel">${esc(t('common.cancel'))}</button>
      </footer>
    </div>`);

  const results = dialog.querySelector('#icon-picker-results');
  const empty = dialog.querySelector('#icon-picker-empty');
  const input = dialog.querySelector('#icon-picker-search');

  let token = null;
  let settled = false;
  let debounce = null;

  function finish(value) {
    if (settled) return;
    settled = true;
    clearTimeout(debounce);
    if (token !== null) dropOverlay(token);
    dialog.remove();
    resolve(value);
  }

  const paint = (term) => {
    const names = searchIcons(term, iconNames(), suggestions);
    results.replaceChildren(...names.map((n) => tile(n, n === current)));
    empty.hidden = names.length > 0;
  };

  paint('');

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => paint(input.value), 120);
  });

  results.addEventListener('click', (e) => {
    const chosen = e.target.closest('.icon-picker__tile');
    if (chosen) finish(chosen.dataset.icon);
  });

  dialog.querySelector('#icon-picker-clear').addEventListener('click', () => finish(null));
  dialog.querySelector('#icon-picker-cancel').addEventListener('click', () => finish(undefined));

  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    finish(undefined);
  });

  return {
    dialog,
    register() {


      // Zurueck-Geste den Eintrag darunter (#871).
      token = attachOverlay(dialog, () => finish(undefined));
    },
    focus() {
      input.focus();
    },
  };
}

export function openIconPicker(current = null, { suggestions = SUGGESTIONS } = {}) {
  return new Promise((resolve) => {
    if (!iconNames().length) {

      // schlechtere Antwort als keiner.
      window.aashiyana?.showToast(t('iconPicker.unavailable'), 'danger');
      resolve(undefined);
      return;
    }

    const picker = buildDialog(current, resolve, suggestions);
    document.body.appendChild(picker.dialog);
    picker.dialog.showModal();
    picker.register();
    picker.focus();
  });
}
