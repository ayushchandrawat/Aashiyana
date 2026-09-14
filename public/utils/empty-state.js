
import { esc } from '/utils/html.js';

const VARIANTS = {
  'empty':      { role: null,     icon: 'inbox',          tone: 'primary'   },
  'no-results': { role: 'status', icon: 'search',         tone: 'secondary' },
  'error':      { role: 'alert',  icon: 'triangle-alert', tone: 'primary'   },
};

export function emptyStateEl({
  variant = 'empty', icon, title, description, hint, action, actions, details,
  className, compact = false,
} = {}) {
  const spec = VARIANTS[variant] ?? VARIANTS.empty;







  title       = plainText(title);
  description = plainText(description);
  hint        = plainText(hint);

  const box = document.createElement('div');

  // Grammatik-Klasse; `.empty-state` selbst setzt der Renderer, damit keine
  // Aufrufstelle sie versehentlich ersetzt (dann faellt das gesamte Layout weg).
  box.className = [
    'empty-state',
    ...(compact ? ['empty-state--compact'] : []),
    ...String(className ?? '').split(/\s+/).filter(Boolean),
  ].join(' ');
  if (spec.role) box.setAttribute('role', spec.role);

  // Feste Reihenfolge Icon → Titel → Beschreibung → Hinweis. Genau die





  const iconName = icon || (compact ? null : spec.icon);
  const parts = [];
  if (iconName) {
    parts.push(`<i data-lucide="${esc(iconName)}" class="empty-state__icon" aria-hidden="true"></i>`);
  }




  //




  if (title) parts.push(`<h2 class="empty-state__title">${esc(title)}</h2>`);


  // nullt ihn fuer alles. (Die kompakte Form fuehrte ihre Beschreibung schon

  // zwischen den beiden Fassungen.)
  if (description) parts.push(`<p class="empty-state__description">${esc(description)}</p>`);
  if (hint) parts.push(`<p class="empty-state__hint">${esc(hint)}</p>`);
  box.insertAdjacentHTML('beforeend', parts.join(''));





  if (plainText(details?.text)) {
    const box2 = document.createElement('details');
    box2.className = 'empty-state__details';
    const summary = document.createElement('summary');
    summary.textContent = plainText(details.summary) ?? '';
    const pre = document.createElement('pre');
    pre.textContent = plainText(details.text);
    box2.append(summary, pre);
    box.appendChild(box2);
  }





  const list = (actions ?? (action ? [action] : [])).filter((a) => plainText(a?.label));
  if (list.length) {
    const buttons = list.map((entry, index) => ctaEl(entry, index === 0 ? spec.tone : 'secondary'));
    if (buttons.length === 1) {
      box.appendChild(buttons[0]);
    } else {
      // Zwei nebeneinander brauchen eine Reihe; einzeln untereinander waeren sie

      const row = document.createElement('div');
      row.className = 'empty-state__actions';
      row.append(...buttons);
      box.appendChild(row);
    }
  }

  return box;
}

function ctaEl(action, fallbackTone) {
  const cta = document.createElement('button');
  cta.type = 'button';
  cta.className = [
    'btn', `btn--${action.tone || fallbackTone}`, 'empty-state__cta',
    ...String(action.className ?? '').split(/\s+/).filter(Boolean),
  ].join(' ');
  if (action.icon) {
    cta.insertAdjacentHTML('afterbegin',
      `<i data-lucide="${esc(action.icon)}" aria-hidden="true" class="icon-md"></i>`);
  }


  cta.append(document.createTextNode(plainText(action.label)));

  // koennen - allen voran die String-Ausgabe (`emptyStateHTML`), deren



  for (const [name, value] of Object.entries(action.attrs ?? {})) {
    if (value != null) cta.setAttribute(name, String(value));
  }
  if (typeof action.onClick === 'function') cta.addEventListener('click', action.onClick);
  return cta;
}

export function mountEmptyState(target, opts) {
  if (!target) return null;
  const box = emptyStateEl(opts);
  target.replaceChildren(box);
  if (window.lucide) window.lucide.createIcons({ el: box });
  return box;
}

export function mountLoadError(target, { title, description, error, retryLabel, onRetry } = {}) {
  return mountEmptyState(target, {
    variant: 'error',
    title,
    description,
    hint: errorDetail(error),
    action: typeof onRetry === 'function'
      ? { label: retryLabel, icon: 'refresh-cw', onClick: onRetry }
      : undefined,
  });
}

export function emptyHintEl(text, { icon, className } = {}) {




  return emptyStateEl({ compact: true, icon, className, description: text });
}

export function emptyStateHTML(opts = {}) {
  if (typeof opts.action?.onClick === 'function') {
    throw new TypeError(
      'emptyStateHTML(): action.onClick ueberlebt die String-Ausgabe nicht. '
      + 'action.attrs setzen (id/data-action) und den Listener am eingehaengten Knoten binden.',
    );
  }
  return emptyStateEl(opts).outerHTML;
}

export function emptyHintHTML(text, opts) {
  return emptyHintEl(text, opts).outerHTML;
}

function errorDetail(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status > 0 ? `HTTP ${status}` : null;
}

function plainText(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  return value.trim() ? value : null;
}
