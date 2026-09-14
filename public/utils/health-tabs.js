import { t } from '/i18n.js';
import { renderSubTabs } from '/utils/sub-tabs.js';




// aktive Panel aus (Soft-Navigation, kein Full-Reload).
export const HEALTH_ROUTES = Object.freeze([
  '/health',
  '/health/vitals',
  '/health/cycle',
  '/health/meds',
  '/health/labs',
  '/health/activity',
]);
export const HEALTH_STORAGE_KEY = 'aashiyana-health-tab';



export const HEALTH_TABS = ({ cycleEnabled = true } = {}) => [
  { route: '/health',          labelKey: 'health.tabs.overview', icon: 'heart-pulse'    },
  { route: '/health/vitals',   labelKey: 'health.tabs.vitals',   icon: 'activity'       },
  ...(cycleEnabled ? [{ route: '/health/cycle', labelKey: 'health.tabs.cycle', icon: 'droplet' }] : []),
  { route: '/health/meds',     labelKey: 'health.tabs.meds',     icon: 'pill'           },
  { route: '/health/labs',     labelKey: 'health.tabs.labs',     icon: 'flask-conical'  },
  { route: '/health/activity', labelKey: 'health.tabs.activity', icon: 'dumbbell'       },
];

export function isHealthRoute(path) {
  return HEALTH_ROUTES.includes(path);
}

export function getLastHealthRoute() {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const stored = sessionStorage.getItem(HEALTH_STORAGE_KEY);
      if (HEALTH_ROUTES.includes(stored)) return stored;
    }
  } catch { /* ignore */ }


  return '/health';
}

export function renderHealthTabsBar(container, activeRoute, { cycleEnabled = true } = {}) {
  const toolbar = container.querySelector('.page-toolbar');
  if (!toolbar) return;

  renderSubTabs(toolbar, {




    semantics: 'tabs',


    panelFor: (route) => container.querySelector(`[data-health-panel="${CSS.escape(route)}"]`),
    tabs: HEALTH_TABS({ cycleEnabled }).map(({ route, labelKey, icon }) => ({ id: route, label: t(labelKey), icon })),
    activeId: activeRoute,
    storageKey: HEALTH_STORAGE_KEY,

    // Werkzeugzeilen-Regel) - volle Kopfbreite statt Restbreite neben dem

    extraClass: 'health-tabs-bar page-toolbar__bar',
    ariaLabel: t('nav.health'),
    insertPosition: 'beforeend',
    onChange: (route) => window.aashiyana?.navigate(route),
  });
}
