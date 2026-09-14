
/** PascalCase → Bindestrich-Form. `AlarmClock` → `alarm-clock`. */
function kebab(pascal) {
  return pascal
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Bindestrich-Form → PascalCase, mit Lucides eigener Regel.
 * `alarm-clock` → `AlarmClock`, `grid2x2` → `Grid2x2`.
 */
function pascalize(name) {
  return String(name).replace(/(\w)(\w*)(_|-|\s*)/g, (_all, head, tail) => head.toUpperCase() + tail.toLowerCase());
}

let cachedNames = null;

export function iconNames() {
  if (cachedNames) return cachedNames;

  const icons = window.lucide?.icons;
  if (!icons) return [];

  const names = Object.keys(icons)
    .map(kebab)


    // die leer bleiben.
    .filter((name) => Boolean(icons[pascalize(name)]));

  // Doppelte entstehen, wo Lucide zwei Schreibweisen auf dieselbe Zeichnung

  const unique = [...new Set(names)].sort();
  if (unique.length) cachedNames = unique;
  return unique;
}

/** Kennt Lucide dieses Symbol? */
export function hasIcon(name) {
  const icons = window.lucide?.icons;
  return Boolean(name && icons?.[pascalize(name)]);
}

export function iconElement(name, { class: className, size } = {}) {
  const icons = window.lucide?.icons;
  const node = icons?.[pascalize(name)];
  if (!node || typeof window.lucide?.createElement !== 'function') return null;

  const svg = window.lucide.createElement(node);
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  if (size) {
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
  }
  return svg;
}
