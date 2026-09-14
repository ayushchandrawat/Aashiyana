
const LAYOUT_HINT_KEY = 'aashiyana-dash-layout-hint';

function readHint() {
  try {
    const stored = JSON.parse(localStorage.getItem(LAYOUT_HINT_KEY) ?? 'null');
    if (Array.isArray(stored)) return { sizes: stored, query: null };
    if (stored && typeof stored === 'object') return { sizes: stored.sizes, query: stored.query ?? null };
  } catch { /* unlesbar: Standard */ }
  return { sizes: null, query: null };
}

export function rememberLayoutHint(cfg, query = null) {
  try {
    localStorage.setItem(LAYOUT_HINT_KEY, JSON.stringify({
      sizes: cfg.filter((w) => w.visible).map((w) => w.size),
      ...(query ? { query } : {}),
    }));
  } catch { /* z.B. voller oder gesperrter Speicher: der Hinweis ist entbehrlich */ }
}

/** Gemerkte Formen, sonst die uebergebenen Standardformen. */
export function layoutHintSizes(fallbackSizes) {
  const { sizes } = readHint();
  if (Array.isArray(sizes) && sizes.length && sizes.every((s) => typeof s === 'string')) return sizes;
  return fallbackSizes;
}

/** Gemerkter Abfragepfad, sonst der uebergebene Standardpfad. */
export function layoutHintQuery(fallbackQuery) {
  const { query } = readHint();


  // laeuft.
  return typeof query === 'string' && query.startsWith('/dashboard') ? query : fallbackQuery;
}

export function forgetLayoutHint() {
  try {
    localStorage.removeItem(LAYOUT_HINT_KEY);
  } catch { /* gesperrter Speicher: dann bleibt hoechstens ein Skelett falsch */ }
}
