import { t } from '/i18n.js';
import { api } from '/api.js';
import { renderSubTabs, setSubTabBadge, scrollActiveSubTabIntoView } from '/utils/sub-tabs.js';
import { MODULE_ICON, moduleIconEl } from '/nav-icons.js';
import { todayKey } from '/utils/date.js';
import { KITCHEN_MODULES as KITCHEN_MODULES_SOURCE } from '/utils/module-accent.js';


//






export { KITCHEN_MODULES } from '/utils/module-accent.js';
export const KITCHEN_ROUTES = Object.freeze(KITCHEN_MODULES_SOURCE.map((mod) => `/${mod}`));
export const KITCHEN_STORAGE_KEY = 'aashiyana-kitchen-tab';

const TABS = () => [
  { route: '/meals',    labelKey: 'nav.meals',    icon: 'utensils'      },
  { route: '/recipes',  labelKey: 'nav.recipes',  icon: 'book-text'     },
  { route: '/shopping', labelKey: 'nav.shopping', icon: 'shopping-cart' },
  { route: '/pantry',   labelKey: 'nav.pantry',   icon: 'archive'       },
].filter(({ route }) => !window.aashiyana?.isModuleDisabled(route.slice(1)));

export function getLastKitchenRoute() {
  try {
    const stored = sessionStorage.getItem(KITCHEN_STORAGE_KEY);
    if (KITCHEN_ROUTES.includes(stored) && !window.aashiyana?.isModuleDisabled(stored.slice(1))) {
      return stored;
    }
  } catch { /* ignore */ }
  const first = ['meals', 'recipes', 'shopping', 'pantry'].find((m) => !window.aashiyana?.isModuleDisabled(m));
  return first ? `/${first}` : '/meals';
}

export function isKitchenRoute(path) {
  return KITCHEN_ROUTES.includes(path);
}

export function isKitchenModule(mod) {
  return !!mod && KITCHEN_MODULES.includes(mod);
}

// --------------------------------------------------------

// --------------------------------------------------------





const BADGES = [
  {
    route: '/shopping',
    pick: (d) => d.shopping?.open ?? 0,
    label: (count) => `${t('nav.shopping')}: ${t('nav.shoppingOpen', { count })}`,
  },
  {
    route: '/pantry',
    pick: (d) => d.pantry?.attention ?? 0,


    tone: 'warning',
    label: (count) => `${t('nav.pantry')}: ${t('nav.pantryAttention', { count })}`,
  },
];

let _bar = null;
let _activeRoute = null;
let _refreshTimer = null;

async function loadBadges() {
  if (!_bar?.isConnected) return;
  try {

    // Server rechnet in UTC (siehe server/routes/kitchen.js).
    const res = await api.get(`/kitchen/summary?today=${encodeURIComponent(todayKey())}`);
    const data = res.data ?? {};
    if (!_bar?.isConnected) return;
    for (const { route, pick, label, tone } of BADGES) {
      const count = route === _activeRoute ? 0 : Number(pick(data)) || 0;
      setSubTabBadge(_bar, route, count > 0 ? { count, tone, label: label(count) } : null);
    }



    scrollActiveSubTabIntoView(_bar);
  } catch {


  }
}

export function refreshKitchenBadges() {
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(loadBadges, 200);
}

export function renderKitchenTabsBar(container, activeRoute) {
  container.classList.add('has-kitchen-tabs');
  _activeRoute = activeRoute;

  _bar = renderSubTabs(container, {

    // Module (eigener `module:`-Wert in router.js, eigene Seitendatei, einzeln


    semantics: 'nav',
    tabs: TABS().map(({ route, labelKey, icon }) => ({ id: route, label: t(labelKey), icon })),
    activeId: activeRoute,
    storageKey: KITCHEN_STORAGE_KEY,
    extraClass: 'kitchen-tabs-bar',
    ariaLabel: t('nav.kitchen'),
    title: t('nav.kitchen'),






    sealIcon: () => moduleIconEl(MODULE_ICON.kitchen),
    insertPosition: 'afterbegin',
    onChange: (route) => window.aashiyana?.navigate(route),
  });

  refreshKitchenBadges();
  return _bar;
}
