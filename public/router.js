
import { api, auth } from '/api.js';
import { canAccessNavModule, navModuleAccess, setExtensionNavMap } from '/permissions.js';
import { setExtensionModules, selectThirdPartyModuleList } from '/utils/extension-widgets.js';
import { initExtensionI18n, moduleDisplayLabel, reloadExtensionLocales } from '/utils/extension-i18n.js';
import { clearApiCache } from '/sw-register.js';
import { forgetLayoutHint } from '/utils/dashboard-layout-hint.js';
import { initI18n, getLocale, t, formatDate, formatTime } from '/i18n.js';
import { esc } from '/utils/html.js';
import { emptyHintEl, emptyStateEl } from '/utils/empty-state.js';
import { wireScrollFade, wireCollapsingHeader, wireSwipeToDismiss } from '/utils/ux.js';
import { TOAST_SURFACES, toastSurface } from '/utils/toast-surface.js';
import { BULK_PILL_LAYER, clearBulkPill } from '/utils/bulk-pill.js';
import { COMPOSITION_MODES } from '/utils/page-layout.js';
import { init as initReminders, stop as stopReminders } from '/reminders.js';
import { initPush, stopPush } from '/push.js';
import { numberLocaleFor } from '/settings/region-presets.js';
import { setDisplayTimeZone } from '/utils/timezone.js';
import { isKitchenRoute, getLastKitchenRoute } from '/utils/kitchen-tabs.js';
import { moduleAccentToken, moduleAccentVar } from '/utils/module-accent.js';
import { getLastHealthRoute, HEALTH_ROUTES } from '/utils/health-tabs.js';
import { SCHEDULE_ROUTES } from '/utils/schedule-tabs.js';
import { activityType } from '/utils/health-activity.js';
import { buildHelpRows } from '/utils/help.js';
import { renderSkeletonList } from '/utils/skeleton.js';
import {
  handleBackNavigation, closeAllOverlays, consumeOverlayMarker,
  pushOverlay, dropOverlay, attachOverlay,
} from '/utils/overlay-history.js';
import {
  applyNavBadges, setNavBadge, resetNavBadges, navBadgeRoutes,
  moduleCountsFrom, navBadgeCountsFrom,
} from '/utils/nav-badges.js';
import { isNewerVersion, displayVersion, releasesNewForMe } from '/utils/version.js';
import { setMaxUploadBytes } from '/utils/upload-limit.js';
import { syncWallMode } from '/utils/wall-mode.js';
import {
  rememberScrollPosition,
  scrollPositionFor,
  forgetScrollPositions,
} from '/utils/scroll-restore.js';
import { openModal, confirmModal } from '/components/modal.js';
import '/components/datepicker.js';
import { NAV_ICONS, MODULE_ICON, moduleIconEl } from '/nav-icons.js';
import { RENAMED_SETTINGS_SOURCE_PATHS, SETTINGS_LEAVES } from '/settings/registry.js';
import {
  NAV_SECTION,
  resolveMobileNavOrder,
  sortNavigationItems,
} from '/settings/module-order.js';

// --------------------------------------------------------
// Routen-Definitionen


//


// /forgot-password, /reset-password und /join lieferten â€žAashiyana Â· Aashiyana" -




//



// --------------------------------------------------------
const ROUTES = [
  { path: '/signup', page: '/pages/signup.js', requiresAuth: false, module: null, titleKey: null },
  { path: '/login',    page: '/pages/login.js',    requiresAuth: false, module: null,        titleKey: null },
  { path: '/setup',    page: '/pages/setup.js',    requiresAuth: false, module: null,        titleKey: null },
  { path: '/forgot-password', page: '/pages/forgot-password.js', requiresAuth: false, module: null, titleKey: 'forgotPassword.title' },
  { path: '/reset-password',  page: '/pages/reset-password.js',  requiresAuth: false, module: null, titleKey: 'resetPassword.title' },
  { path: '/join',     page: '/pages/join.js',     requiresAuth: false, module: null,        titleKey: 'join.title' },
  { path: '/',         page: '/pages/dashboard.js', requiresAuth: true, module: 'dashboard', titleKey: 'dashboard.title' },
  { path: '/tasks',    page: '/pages/tasks.js',     requiresAuth: true, module: 'tasks',     titleKey: 'nav.tasks' },
  { path: '/shopping', page: '/pages/shopping.js',  requiresAuth: true, module: 'shopping',  titleKey: 'nav.shopping' },
  { path: '/meals',    page: '/pages/meals.js',     requiresAuth: true, module: 'meals',     titleKey: 'nav.meals' },
  { path: '/calendar', page: '/pages/calendar.js',  requiresAuth: true, module: 'calendar',  titleKey: 'nav.calendar' },
  { path: '/birthdays', page: '/pages/birthdays.js', requiresAuth: true, module: 'birthdays', titleKey: 'nav.birthdays' },
  { path: '/notes',    page: '/pages/notes.js',     requiresAuth: true, module: 'notes',     titleKey: 'nav.notes' },
  { path: '/recipes',  page: '/pages/recipes.js',   requiresAuth: true, module: 'recipes',   titleKey: 'nav.recipes' },
  { path: '/pantry',   page: '/pages/pantry.js',    requiresAuth: true, module: 'pantry',    titleKey: 'nav.pantry' },
  { path: '/inventory', page: '/pages/inventory.js', requiresAuth: true, module: 'inventory', titleKey: 'nav.inventory' },
  { path: '/contacts', page: '/pages/contacts.js',  requiresAuth: true, module: 'contacts',  titleKey: 'nav.contacts' },
  { path: '/budget',   page: '/pages/budget.js',    requiresAuth: true, module: 'budget',    titleKey: 'nav.budget' },
  { path: '/documents', page: '/pages/documents.js', requiresAuth: true, module: 'documents', titleKey: 'nav.documents' },
  { path: '/housekeeping', page: '/pages/housekeeping.js', requiresAuth: true, module: 'housekeeping', titleKey: 'nav.housekeeping' },
  { path: '/waste', page: '/pages/waste.js', requiresAuth: true, module: 'waste', titleKey: 'nav.waste' },
  { path: '/rewards',  page: '/pages/rewards.js',    requiresAuth: true, module: 'rewards',   titleKey: 'nav.rewards' },
];



// doppelten Pfad-Definitionen gibt.



const SETTINGS_ROUTES = [
  { path: '/settings', page: '/pages/settings.js', requiresAuth: true, module: 'settings', titleKey: 'nav.settings' },
  ...SETTINGS_LEAVES.map(({ path }) => ({ path, page: '/pages/settings.js', requiresAuth: true, module: 'settings', titleKey: 'nav.settings' })),


  ...RENAMED_SETTINGS_SOURCE_PATHS.map((path) => ({ path, page: '/pages/settings.js', requiresAuth: true, module: 'settings', titleKey: 'nav.settings' })),
];

ROUTES.push(...SETTINGS_ROUTES);




const HEALTH_PAGE_ROUTES = HEALTH_ROUTES.map((path) => ({
  path, page: '/pages/health.js', requiresAuth: true, module: 'health', titleKey: 'nav.health',
}));

ROUTES.push(...HEALTH_PAGE_ROUTES);




// update()-Funktion.
const SCHEDULE_PAGE_ROUTES = SCHEDULE_ROUTES.map((path) => ({
  path, page: '/pages/schedule.js', requiresAuth: true, module: 'schedule', titleKey: 'nav.schedule',
}));

ROUTES.push(...SCHEDULE_PAGE_ROUTES);

// --------------------------------------------------------
// Standalone-Modus: Dynamische theme-color Anpassung
// Statusbar-Farbe spiegelt aktuelle Seite / Modal-State wider
// --------------------------------------------------------
const isStandalone = window.matchMedia('(display-mode: standalone)').matches
  || navigator.standalone === true;

const darkSchemeQuery = window.matchMedia?.('(prefers-color-scheme: dark)') ?? null;

function setThemeColor(lightColor, darkColor) {
  if (!isStandalone) return;
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  const dark = darkColor || lightColor;


  //

  // `media="(prefers-color-scheme: â€¦)"`; welche davon gilt, entscheidet also das





  //



  // Quelle.
  const forced = document.documentElement.getAttribute('data-theme');
  const [first, second] = forced === 'dark' ? [dark, dark]
    : forced === 'light' ? [lightColor, lightColor]
      : [lightColor, dark];

  if (metas.length >= 2) {
    metas[0].setAttribute('content', first);
    metas[1].setAttribute('content', second);
  } else if (metas.length === 1) {
    metas[0].setAttribute('content', first);
  }
}

/** Liest eine CSS Custom Property vom :root */
function getCSSToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function applyModuleAccentForRoute(route) {
  const accentToken = moduleAccentToken(route?.module);
  const accent = route?.thirdPartyModule?.accent || (accentToken ? getCSSToken(accentToken) : '');
  document.documentElement.style.setProperty('--active-module-accent', accent);
}

function updateThemeColorForRoute(route) {
  if (route?.thirdPartyModule?.accent) {
    setThemeColor(route.thirdPartyModule.accent, route.thirdPartyModule.accent);
    return;
  }
  setThemeColor('#F5F3ED', '#191816');
}

// --------------------------------------------------------
// Dynamisches Stylesheet-Loading pro Seitenmodul
// --------------------------------------------------------
let activePageStyle = null;

function loadPageStyle(moduleName, routeStyle = null) {
  if (!moduleName && !routeStyle) return { ready: Promise.resolve(), cleanup: () => {} };
  const href = routeStyle || `/styles/${moduleName}.css`;
  if (activePageStyle?.getAttribute('href') === href) {
    return { ready: Promise.resolve(), cleanup: () => {} };
  }

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;

  const oldLink = activePageStyle;

  const ready = new Promise((resolve) => {
    link.onload = resolve;
    link.onerror = resolve;
  });

  document.head.appendChild(link);
  activePageStyle = link;

  return {
    ready,
    cleanup: () => { if (oldLink) oldLink.remove(); },
  };
}

// --------------------------------------------------------
// Modul-Cache: verhindert redundante dynamic imports bei Navigation
// --------------------------------------------------------
const moduleCache = new Map();

// --------------------------------------------------------
// Veraltete Shell nach SW-Update (#616)
//







//




// --------------------------------------------------------
let shellStale = false;



// Bug statt Versions-Mischzustand). Zeitbasiert statt einmalig, damit ein

const RELOAD_GUARD_KEY = 'aashiyana-stale-shell-reload';
const RELOAD_GUARD_MS  = 30000;

function reloadOnce() {
  try {
    const last = parseInt(sessionStorage.getItem(RELOAD_GUARD_KEY) || '0', 10);
    if (Date.now() - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch { /* sessionStorage gesperrt (Private Mode) â†’ Reload trotzdem wagen */ }
  location.reload();
  return true;
}

function isStaleModuleError(err) {
  if (err instanceof SyntaxError) return true;
  return err instanceof TypeError && navigator.onLine;
}

async function importPage(pagePath) {



  if (shellStale && reloadOnce()) {
    return new Promise(() => {});
  }
  if (!moduleCache.has(pagePath)) {
    try {
      moduleCache.set(pagePath, await import(pagePath));
    } catch (err) {
      moduleCache.delete(pagePath);



      if (isStaleModuleError(err) && reloadOnce()) {
        return new Promise(() => {});
      }
      throw err;
    }
  }
  return moduleCache.get(pagePath);
}

// --------------------------------------------------------







// --------------------------------------------------------
const _prefetchedPages = new Set();
const _prefetchedStyles = new Set();

function prefetchRoute(path) {
  if (!path) return;


  // alten geteilten Module binden, bevor der Reload greift (#616).
  if (shellStale) return;
  const route = allRoutes().find((r) => r.path === path);
  if (!route) return;

  if (route.page && !moduleCache.has(route.page) && !_prefetchedPages.has(route.page)) {
    _prefetchedPages.add(route.page);
    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = route.page;
    document.head.appendChild(link);
  }

  const cssHref = route.style || (route.module && !route.thirdPartyModule ? `/styles/${route.module}.css` : null);
  if (cssHref && !_prefetchedStyles.has(cssHref)) {
    _prefetchedStyles.add(cssHref);
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'style';
    link.href = cssHref;
    document.head.appendChild(link);
  }
}





function warmPrimaryRoutes() {
  if (navigator.connection?.saveData) return;
  const run = () => {
    try {
      navItems().forEach((item) => {
        if (item.path && item.path !== currentPath) prefetchRoute(item.path);
      });
    } catch { /* Prefetch ist rein spekulativ â€” Fehler nie eskalieren. */ }
  };
  if ('requestIdleCallback' in window) {
    requestIdleCallback(run, { timeout: 2500 });
  } else {
    setTimeout(run, 1200);
  }
}

// --------------------------------------------------------
// Globaler App-State
// --------------------------------------------------------
let currentUser = null;



let _navBuiltForUserId = null;
let currentPath = null;
let isNavigating = false;
// Zuletzt erfolgreich gerendertes Seiten-Modul. Erlaubt Soft-Navigation
// innerhalb desselben Moduls (z. B. Settings-Blatt â†’ Blatt): Statt das Modul


let _renderedModule = null;
let _pageController = null;
let _renderedModuleName = null;
let _preferencesLoaded = false;
let _disabledModules = new Set();
// Persoenlich ausgeblendete Module (#673). Bewusst eine ZWEITE Menge neben





let _hiddenModules = new Set();
let _thirdPartyModules = [];
let _moduleOrder = [];
let _mobileNavOrder = [];
let _moduleRefreshTimer = null;


let _pendingLoginRedirect = false;

let _setupRequired = false;

// --------------------------------------------------------
// Router
// --------------------------------------------------------

const ROUTE_ORDER = ['/', '/calendar', '/schedule', '/tasks', '/meals', '/recipes', '/shopping', '/pantry',
                     '/birthdays', '/notes', '/contacts', '/budget', '/inventory', '/documents', '/housekeeping', '/waste', '/health', '/settings'];

const MOBILE_FAVORITE_COUNT = 3;




const NAV_SECTION_LABEL_KEYS = Object.freeze({
  [NAV_SECTION.overview]: 'nav.sectionOverview',
  [NAV_SECTION.plan]: 'nav.sectionPlan',
  [NAV_SECTION.household]: 'nav.sectionHousehold',
  [NAV_SECTION.people]: 'nav.sectionPeople',
  [NAV_SECTION.finance]: 'nav.sectionFinance',
  [NAV_SECTION.customModules]: 'nav.sectionCustomModules',
});

const DEFAULT_APP_NAME = 'Aashiyana';
const APP_NAME_STORAGE_KEY = 'aashiyana-app-name';
const APP_VERSION_STORAGE_KEY = 'aashiyana-app-version';



// gilt als gleiche Sektion (keine seitliche Seitentransition).
function topLevelSection(path) {
  if (typeof path === 'string' && path.startsWith('/settings')) return '/settings';


  if (typeof path === 'string' && path.startsWith('/health')) return '/health';




  if (typeof path === 'string' && (path === '/schedule' || path.startsWith('/schedule/'))) return '/schedule';
  return path ?? '/';
}

function getDirection(fromPath, toPath) {
  const fromSection = topLevelSection(fromPath ?? '/');
  const toSection   = topLevelSection(toPath);
  const fromIdx = ROUTE_ORDER.indexOf(fromSection);
  const toIdx   = ROUTE_ORDER.indexOf(toSection);
  if (fromIdx === -1 || toIdx === -1 || fromSection === toSection) return 'right';
  return toIdx > fromIdx ? 'right' : 'left';
}

function getAppName() {
  return localStorage.getItem(APP_NAME_STORAGE_KEY) || DEFAULT_APP_NAME;
}

function getAppVersion() {
  return localStorage.getItem(APP_VERSION_STORAGE_KEY) || '';
}

function setAppName(name) {
  const next = String(name || '').trim();
  if (next) {
    localStorage.setItem(APP_NAME_STORAGE_KEY, next);
  } else {
    localStorage.removeItem(APP_NAME_STORAGE_KEY);
  }
}

function setAppVersion(version) {
  const next = String(version || '').trim();
  if (next) {
    localStorage.setItem(APP_VERSION_STORAGE_KEY, next);
  } else {
    localStorage.removeItem(APP_VERSION_STORAGE_KEY);
  }
}

function routeTitle(path) {
  const titleKey = ROUTES.find((route) => route.path === path)?.titleKey;
  if (titleKey) return t(titleKey);



  const thirdParty = _thirdPartyModules.find((module) => module.route?.path === path);
  if (thirdParty) return moduleDisplayLabel(thirdParty);



  return getAppName();
}

function updateBranding(path = currentPath) {
  const appName = getAppName();
  const sidebarLogoName = document.querySelector('.nav-sidebar__brand-name');
  if (sidebarLogoName) sidebarLogoName.textContent = appName;
  const sidebarVersion = document.querySelector('.nav-sidebar__version');
  if (sidebarVersion) {
    const version = getAppVersion();
    sidebarVersion.textContent = version ? t('login.version', { version }) : '';
    sidebarVersion.hidden = !version;
  }

  const loginTitle = document.querySelector('.auth-hero__title');
  if ((path === '/login' || path === '/setup') && loginTitle) loginTitle.textContent = appName;






  const declaresOwnTitle = ROUTES.find((route) => route.path === path)?.titleKey === null;
  document.title = declaresOwnTitle
    ? appName
    : `${routeTitle(path || '/')} Â· ${appName}`;

  document.querySelectorAll('meta[name="apple-mobile-web-app-title"]').forEach((meta) => {
    meta.setAttribute('content', appName);
  });
}

function setOverlayInteractive(el, interactive) {
  if (!el) return;
  el.inert = !interactive;
  el.setAttribute('aria-hidden', String(!interactive));
}

function returnFocus(target) {
  if (target && typeof target.focus === 'function') {
    setTimeout(() => target.focus(), 0);
  }
}

function focusMainContentAfterNavigation(path) {
  if (path === '/login' || path === '/setup') return;
  const main = document.getElementById('main-content');
  if (!main || typeof main.focus !== 'function') return;
  requestAnimationFrame(() => {
    main.focus({ preventScroll: true });
  });
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function visibleFocusable(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter((el) => !el.hidden && !el.closest('[hidden]') && !el.inert);
}

function createFocusTrap(container) {
  return (e) => {
    if (e.key !== 'Tab') return;
    const focusable = visibleFocusable(container);
    if (!focusable.length) {
      e.preventDefault();
      container.focus?.();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
}

async function navigate(path, userOrPushState = true, pushState = true) {
  if (isNavigating) return;
  isNavigating = true;




  if (window._closeMoreSheet) window._closeMoreSheet({ restoreFocus: false });

  try {

    if (typeof userOrPushState === 'object' && userOrPushState !== null) {
      currentUser = userOrPushState;
      _setupRequired = false;
      await syncPreferencesOnce();
      startThirdPartyModulePolling();


      if (currentUser && currentUser.access_scope !== 'split_guest') {
        loadReminderStyles();
        initReminders();
        initPush();
      }
    } else {
      pushState = userOrPushState;
    }


    const previousPath = currentPath;
    const basePath = path.split('?')[0];
    currentPath = basePath;





    if (previousPath) {
      rememberScrollPosition(previousPath, document.getElementById('main-content')?.scrollTop ?? 0);
    }


    const scrollTarget = scrollPositionFor(basePath, { restore: !pushState });



    if (_setupRequired && !currentUser && basePath !== '/setup') {
      currentPath = null;
      isNavigating = false;
      navigate('/setup');
      return;
    }

    if (!_setupRequired && basePath === '/setup') {
      currentPath = null;
      isNavigating = false;
      navigate('/login');
      return;
    }

    let route = allRoutes().find((r) => r.path === basePath) ?? ROUTES.find((r) => r.path === '/');



    // ein bedingungsloses navigate('/budget') vom Modul-Guard (canAccessNavModule)




    if (currentUser?.access_scope === 'split_guest'
        && route.path !== '/budget'
        && canAccessNavModule('budget')) {
      currentPath = null;
      isNavigating = false;
      navigate('/budget');
      return;
    }


    // Dashboard um (Rechte-Guard #467; die verbindliche 403-Sperre liegt am Server).
    if (route.module
        && route.path !== '/'
        && (_disabledModules.has(route.module) || !canAccessNavModule(route.module))) {
      currentPath = null;
      isNavigating = false;
      navigate('/');
      return;
    }

    // Auth-Guard
    if (route.requiresAuth && !currentUser) {
      try {
        const result = await auth.me();
        currentUser = result.user;
        await syncPreferencesOnce();
        startThirdPartyModulePolling();


        if (currentUser && currentUser.access_scope !== 'split_guest') {
          loadReminderStyles();
          initReminders();
          initPush();
        }
      } catch {
        currentPath = null;
        isNavigating = false;



        _pendingLoginRedirect = false;
        navigate(_setupRequired ? '/setup' : (path === '/' ? '/signup' : '/login'));
        return;
      }
    }

    route = allRoutes().find((r) => r.path === basePath) ?? route;



    // ein bedingungsloses navigate('/budget') vom Modul-Guard (canAccessNavModule)




    if (currentUser?.access_scope === 'split_guest'
        && route.path !== '/budget'
        && canAccessNavModule('budget')) {
      currentPath = null;
      isNavigating = false;
      navigate('/budget');
      return;
    }


    // Rolle/dieses Mitglied gesperrtes Modul â†’ Dashboard). #467
    if (route.module && route.path !== '/' && !canAccessNavModule(route.module)) {
      currentPath = null;
      isNavigating = false;
      navigate('/');
      return;
    }

    if (!route.requiresAuth && currentUser && path === '/login') {
      currentPath = null;
      isNavigating = false;
      navigate('/');
      return;
    }

    if (pushState) {
      if (consumeOverlayMarker()) history.replaceState({ path }, '', path);
      else history.pushState({ path }, '', path);
    }

    // Soft-Navigation innerhalb desselben Moduls (z. B. Settings-Blatt â†’ Blatt


    // keine Slide-Transition, kein erneuter Auth-Refresh. Gibt update() false


    if (
      route.module
      && route.module === _renderedModuleName
      && typeof _renderedModule?.update === 'function'
    ) {
      let handled = false;
      try {
        handled = await _renderedModule.update({
          user: currentUser,
          path: basePath,
          query: new URLSearchParams(path.split('?')[1] ?? ''),
        });
      } catch (error) {
        console.error('[Router] Soft-Update fehlgeschlagen, vollstÃ¤ndiges Rendern folgt:', error);
        handled = false;
      }
      if (handled) {



        const main = document.getElementById('main-content');
        if (main) main.scrollTop = scrollTarget;


        adoptPageFab();
        updateNav(topLevelSection(basePath));
        return;
      }
    }






    // bei applyTheme).
    syncWallMode(basePath);






    // tokens.css, Wortlaut bei moduleAccentToken().
    applyModuleAccentForRoute(route);

    // Optimistisches Chrome-Feedback: aktive Nav-Markierung + Indikator-Pille und




    // autoritative Aktualisierung danach.
    if (document.querySelector('.nav-bottom')) {
      updateNav(topLevelSection(basePath));
      updateThemeColorForRoute(route);
    }

    await renderPage(route, previousPath, scrollTarget);

    // markiert ggf. seiten-interne [data-route]-Links (idempotent).

    updateNav(topLevelSection(basePath));
    updateThemeColorForRoute(route);
    updateBranding(basePath);
    focusMainContentAfterNavigation(basePath);
  } finally {
    isNavigating = false;

    // paralleler API-Call 401 zurueckgab). Jetzt wo die Navigation abgeschlossen

    if (_pendingLoginRedirect) {
      _pendingLoginRedirect = false;
      navigate(currentPath === '/' ? '/signup' : '/login');
    }
  }
}

async function syncPreferencesOnce() {
  if (_preferencesLoaded) return;
  _preferencesLoaded = true;
  try {
    const res = await api.get('/preferences');
    const dateFormat = res?.data?.date_format;
    if (dateFormat) {
      localStorage.setItem('aashiyana-date-format', dateFormat);
    }
    const timeFormat = res?.data?.time_format;
    if (timeFormat) {
      localStorage.setItem('aashiyana-time-format', timeFormat);
    }





    setDisplayTimeZone(res?.data?.timezone ?? null);


    const numberLocale = numberLocaleFor({
      region: res?.data?.region,
      currency: res?.data?.currency,
      date_format: res?.data?.date_format,
      time_format: res?.data?.time_format,
    });
    if (numberLocale) {
      localStorage.setItem('aashiyana-number-locale', numberLocale);
    } else {
      localStorage.removeItem('aashiyana-number-locale');
    }
    if (res?.data?.app_name) {
      setAppName(res.data.app_name);
      updateBranding();
    }
    if (Array.isArray(res?.data?.disabled_modules)) {
      _disabledModules = new Set(res.data.disabled_modules);
    }
    if (Array.isArray(res?.data?.hidden_modules)) {
      _hiddenModules = new Set(res.data.hidden_modules);
    }
    if (Array.isArray(res?.data?.module_order)) {
      _moduleOrder = res.data.module_order;
    }
    if (Array.isArray(res?.data?.mobile_nav_order)) {
      _mobileNavOrder = res.data.mobile_nav_order;
    }
  } catch {
    // Non-critical. The settings page can refresh this later.
  }
  try {
    const res = await api.get('/version');
    if (res?.version) setAppVersion(res.version);
    if (res?.app_name) setAppName(res.app_name);

    // dieselbe Zahl nennen wie er (#806).
    setMaxUploadBytes(res?.max_upload_bytes);
    updateBranding();
  } catch {
    // Non-critical. The login page and settings page can refresh branding later.
  }
  await syncThirdPartyModules();
}

async function syncThirdPartyModules() {
  try {
    const res = await api.get('/modules');
    _thirdPartyModules = selectThirdPartyModuleList(_thirdPartyModules, { ok: true, data: res?.data });
  } catch {
    _thirdPartyModules = selectThirdPartyModuleList(_thirdPartyModules, { ok: false });
  }
  setExtensionModules(_thirdPartyModules);
  setExtensionNavMap(_thirdPartyModules);
  await reloadExtensionLocales(_thirdPartyModules);
}

function moduleSnapshot() {
  return JSON.stringify(_thirdPartyModules.map((module) => ({
    id: module.id,
    enabled: module.enabled,
    status: module.status,
    path: module.route?.path,
    label: module.menu?.label,
  })));
}

function startThirdPartyModulePolling() {
  if (_moduleRefreshTimer || currentUser?.access_scope === 'split_guest') return;
  _moduleRefreshTimer = setInterval(async () => {
    const before = moduleSnapshot();
    await syncThirdPartyModules();
    if (before !== moduleSnapshot()) rebuildNavigation();
  }, 30_000);
}

function stopThirdPartyModulePolling() {
  if (!_moduleRefreshTimer) return;
  clearInterval(_moduleRefreshTimer);
  _moduleRefreshTimer = null;
}

function allRoutes() {
  const moduleRoutes = _thirdPartyModules
    .filter((module) => module.enabled && module.status === 'enabled' && module.route?.path && module.route?.entry)
    .map((module) => ({
      path: module.route.path,
      page: module.route.entry,
      style: module.route.style,
      requiresAuth: true,
      module: `third-party-${module.id}`,
      thirdPartyModule: module,
    }));
  return [...ROUTES, ...moduleRoutes];
}

function currentRoute() {
  return allRoutes().find((r) => r.path === currentPath);
}

function refreshThemeColorForTheme() {




  if (document.getElementById('shared-modal-overlay')) return;
  updateThemeColorForRoute(currentRoute());
}





async function confirmAndLogout() {



  const confirmed = await confirmModal(t('settings.logoutConfirm'), {
    confirmLabel: t('settings.logout'),
  });
  if (!confirmed) return false;
  try {
    await auth.logout();
  } finally {
    window.aashiyana?.clearSession?.();
    navigate('/login');
  }
  return true;
}

function sidebarActionEl({ labelKey, icon, className, onClick }) {
  const label = t(labelKey);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `nav-item ${className}`;
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  button.addEventListener('click', onClick);

  const wrap = document.createElement('div');
  wrap.className = 'nav-item__icon-wrap';
  const well = document.createElement('div');
  well.className = 'nav-item__icon-well';
  const iconEl = document.createElement('i');
  iconEl.dataset.lucide = icon;
  iconEl.className = 'nav-item__icon';
  iconEl.setAttribute('aria-hidden', 'true');
  well.appendChild(iconEl);
  wrap.appendChild(well);

  const labelEl = document.createElement('span');
  labelEl.className = 'nav-item__label';
  labelEl.textContent = label;
  button.append(wrap, labelEl);
  return button;
}



// monochrome System-Cluster, klar abgesetzt vom farbigen Modul-Grid.

function moreActionEl({ labelKey, icon, className = '', onClick, route, navHref }) {
  const label = t(labelKey);
  const el = document.createElement(route ? 'a' : 'button');
  if (route) {
    el.href = navHref || route;
    el.dataset.route = route;
    if (navHref) el.dataset.navHref = navHref;
  } else {
    el.type = 'button';
  }
  el.className = `more-action ${className}`.trim();
  el.setAttribute('aria-label', label);
  if (onClick) el.addEventListener('click', onClick);

  const iconEl = document.createElement('i');
  iconEl.dataset.lucide = icon;
  iconEl.className = 'more-action__icon';
  iconEl.setAttribute('aria-hidden', 'true');

  const labelEl = document.createElement('span');
  labelEl.className = 'more-action__label';
  labelEl.textContent = label;
  el.append(iconEl, labelEl);
  return el;
}

let _moduleCounts = {};
let _moduleCountsAt = 0;


let _moduleCountsGen = 0;
const MODULE_COUNTS_TTL = 60_000;


function resetModuleCounts() {
  _moduleCounts = {};
  _moduleCountsAt = 0;


  _moduleCountsGen += 1;
}

function primeNavBadges(data) {
  const counts = navBadgeCountsFrom(data);
  setNavBadge('/tasks', counts['/tasks'],
    (count) => (count > 0 ? t('tasks.navLabelOverdue', { count }) : t('tasks.title')));

  // nav-badges.js).
  setNavBadge('/birthdays', counts['/birthdays'], undefined, 'accent');
}

let _moduleCountsRefreshTimer = null;
function invalidateModuleCounts() {
  _moduleCountsAt = 0;
  _moduleCountsGen += 1;
  if (_moduleCountsRefreshTimer) clearTimeout(_moduleCountsRefreshTimer);
  _moduleCountsRefreshTimer = setTimeout(() => {
    _moduleCountsRefreshTimer = null;
    refreshModuleCounts();
  }, 300);
}

function primeModuleCountsFrom(data, { filtered = false } = {}) {
  if (filtered || !data) return;
  _moduleCounts = moduleCountsFrom(data, {
    isAdmin: currentUser?.role === 'admin',
    shoppingVisible: navItems().some((item) => item.module === 'shopping'),
  });
  _moduleCountsAt = Date.now();
  primeNavBadges(data);
}

function refreshModuleCountsUnlessPageProvides(path) {
  if (path !== '/') { refreshModuleCounts(); return; }
  setTimeout(() => { if (!_moduleCountsAt) refreshModuleCounts(); }, 1500);
}

async function refreshModuleCounts() {
  if (Date.now() - _moduleCountsAt < MODULE_COUNTS_TTL) return false;
  const gen = _moduleCountsGen;
  try {
    const res = await api.get('/dashboard');
    if (gen !== _moduleCountsGen) return false;
    _moduleCounts = moduleCountsFrom(res, {
      isAdmin: currentUser?.role === 'admin',


      shoppingVisible: navItems().some((item) => item.module === 'shopping'),
    });
    _moduleCountsAt = Date.now();
    primeNavBadges(res);
    return true;
  } catch (err) {
    console.error('[Router] ZÃ¤hlstÃ¤nde konnten nicht geladen werden:', err);
    return false;
  }
}

function paintMoreSheetBadges(sheet) {
  if (!sheet) return;
  sheet.querySelectorAll('.more-item[data-nav-id]').forEach((item) => {
    const count = _moduleCounts[item.dataset.navId] ?? 0;
    const existing = item.querySelector('.more-item__badge');
    if (count > 0) {
      if (existing) existing.replaceWith(moreBadgeEl(count));
      else item.appendChild(moreBadgeEl(count));
      // Ansage am Link, nicht am Badge - siehe moreBadgeEl.
      const labelText = item.querySelector('.more-item__label')?.textContent;
      if (labelText) item.setAttribute('aria-label', `${labelText}, ${t('nav.moreBadge', { count })}`);
    } else {
      existing?.remove();
      item.removeAttribute('aria-label');
    }
  });
}

function buildMoreSheetBody() {
  const body = document.createElement('div');
  body.className = 'more-sheet__body';
  const nodes = [];







  const secondary = secondaryMobileItems();
  const settingsItem = secondary.find((item) => item.module === 'settings');




  const modules = secondary.filter((item) => item.module !== 'settings');
  const grid = document.createElement('div');
  grid.className = 'more-sheet__grid';
  modules.forEach((item) => grid.appendChild(moreItemEl(item)));
  nodes.push(grid);

  const divider = document.createElement('div');
  divider.className = 'more-sheet__divider';
  divider.setAttribute('aria-hidden', 'true');
  nodes.push(divider);


  const system = document.createElement('div');
  system.className = 'more-sheet__system';
  if (settingsItem) {
    system.appendChild(moreActionEl({
      labelKey: 'nav.settings',
      icon: settingsItem.icon || 'settings',
      route: settingsItem.path,
      navHref: settingsItem.navHref,
    }));
  }
  system.appendChild(moreActionEl({
    labelKey: 'nav.help',
    icon: 'circle-help',
    className: 'more-item--help',
    onClick: () => {
      if (window._closeMoreSheet) window._closeMoreSheet({ restoreFocus: false });
      showHelpModal();
    },
  }));
  system.appendChild(moreActionEl({
    labelKey: 'nav.changelog',
    icon: 'history',
    className: 'more-item--changelog',
    onClick: () => {
      if (window._closeMoreSheet) window._closeMoreSheet({ restoreFocus: false });
      showChangelogModal();
    },
  }));
  system.appendChild(moreActionEl({
    labelKey: 'settings.logout',
    icon: 'log-out',
    className: 'more-item--logout',
    onClick: () => {
      if (window._closeMoreSheet) window._closeMoreSheet({ restoreFocus: false });



      document.getElementById('more-btn')?.focus();
      confirmAndLogout();
    },
  }));




  system.style.setProperty('--more-system-cols', String(system.children.length || 1));
  nodes.push(system);

  body.append(...nodes);
  return [body];
}

async function renderPage(route, previousPath = null, scrollTarget = 0) {
  const app = document.getElementById('app');
  const loading = document.getElementById('app-loading');

  // Loading verstecken
  if (loading) loading.hidden = true;

  try {
    const style = loadPageStyle(route.thirdPartyModule ? null : route.module, route.style);
    const [module] = await Promise.all([
      importPage(route.page),
      style.ready,
    ]);

    if (typeof module.render !== 'function') {
      throw new Error(`Seite ${route.page} exportiert keine render()-Funktion.`);
    }




    // Navigationsleiste neben dem Login-Formular sichtbar (#478).
    if (!route.requiresAuth) {
      if (document.querySelector('.nav-bottom')) {
        app.replaceChildren();
        _navBuiltForUserId = null;
      }
    }
    // App-Shell einmalig aufbauen BEVOR render() aufgerufen wird -

    // in Seiten-Modulen funktioniert.
    else if (!document.querySelector('.nav-bottom') && currentUser) {
      renderAppShell(app);
      _navBuiltForUserId = currentUser.id;

      checkForUpdate();
      applyNavBadges();
      refreshModuleCountsUnlessPageProvides(route.path);
    } else if (currentUser && _navBuiltForUserId !== currentUser.id) {

      // Modul-Rechten des aktuellen Nutzers neu aufbauen (#467).
      rebuildNavigation();
      _navBuiltForUserId = currentUser.id;


      applyNavBadges();
      refreshModuleCountsUnlessPageProvides(route.path);
    }

    const content = document.getElementById('main-content') || app;


    const direction = getDirection(previousPath, route.path);
    const inClass   = direction === 'right' ? 'page-transition--in-right' : 'page-transition--in-left';
    const shouldAnimate = Boolean(previousPath);



    if (shouldAnimate) document.documentElement.classList.add('navigating');


    const pageWrapper = document.createElement('div');
    pageWrapper.className = 'page-transition';
    pageWrapper.style.opacity = '0';
    content.replaceChildren(pageWrapper);



    //




    // sie steht deshalb unten hinter dem await.
    content.scrollTop = 0;




    clearPageFab();



    // setzt sie beim Rendern.
    clearBulkPill();
    style.cleanup();



    // Listener daran (Bruecke: utils/page-lifecycle.js). Bis dahin gab es




    // naechsten Seite.
    _pageController?.abort();
    _pageController = new AbortController();



    _renderedModule = null;
    _renderedModuleName = null;







    //





    const target = route.thirdPartyModule
      ? mountExtensionPage(pageWrapper, route.thirdPartyModule)
      : pageWrapper;
    const context = route.thirdPartyModule
      ? { user: currentUser, page: { ...route.thirdPartyModule.page }, signal: _pageController.signal }
      : { user: currentUser, signal: _pageController.signal };
    const renderPromise = module.render(target, context);




    adoptPageFab();
    wirePageToolbars();


    pageWrapper.style.opacity = shouldAnimate ? '' : '1';
    if (shouldAnimate) {
      pageWrapper.classList.add(inClass);


      // Fallback-Timeout falls animationend nicht feuert (z.B. prefers-reduced-motion).
      const navEndTimeout = setTimeout(() => {
        document.documentElement.classList.remove('navigating');
      }, 300);
      pageWrapper.addEventListener('animationend', () => {
        clearTimeout(navEndTimeout);
        document.documentElement.classList.remove('navigating');
      }, { once: true });
    } else {
      document.documentElement.classList.remove('navigating');
    }

    await renderPromise;




    if (scrollTarget > 0) content.scrollTop = scrollTarget;


    _renderedModule = module;
    _renderedModuleName = route.module;

    wirePageToolbars();

    // FAB Long Loop: Einstiegsanimation nach FAB_SEEN_MAX Views pro Modul deaktivieren
    const pageFab = adoptPageFab();
    if (pageFab) {

      // Tooltip-Titel + aria-keyshortcuts sichtbar bzw. vorlesbar machen.
      markFabShortcut(pageFab);

      const fabKey = FAB_SEEN_KEY(route.module);
      let fabCount = parseInt(localStorage.getItem(fabKey) ?? '0', 10);
      if (fabCount < FAB_SEEN_MAX) {
        fabCount++;
        localStorage.setItem(fabKey, String(fabCount));
      }
      document.documentElement.classList.toggle('fab-anim-done', fabCount >= FAB_SEEN_MAX);
    }





    applyModuleReadonly(route.module, pageWrapper);


    const announcer = document.getElementById('route-announcer');
    if (announcer) {
      const pageLabel = navCatalog().find((n) => n.path === route.path)?.label ?? route.path;
      announcer.textContent = '';
      setTimeout(() => { announcer.textContent = pageLabel; }, 50);
    }

  } catch (err) {
    document.documentElement.classList.remove('navigating');
    console.error('[Router] Seiten-Render-Fehler:', err);
    if (route.thirdPartyModule?.id) {
      await disableFailedThirdPartyModule(route.thirdPartyModule.id);
    }





    renderError(document.getElementById('main-content') ?? app, err);
  }
}

function renderAppShell(container) {
  const isGuest = currentUser?.access_scope === 'split_guest';
  const skipLink = document.createElement('a');
  skipLink.href = '#main-content';
  skipLink.className = 'sr-only';
  skipLink.textContent = t('common.skipToContent');

  const sidebar = document.createElement('nav');
  sidebar.className = 'nav-sidebar';
  sidebar.setAttribute('aria-label', t('nav.main'));
  const sidebarLogo = document.createElement('div');
  sidebarLogo.className = 'nav-sidebar__logo';

  // SVG-Logomark aus docs/logo.svg â€” Gradient via CSS-Tokens
  const logomark = document.createElement('div');
  logomark.className = 'nav-sidebar__logomark';
  logomark.setAttribute('aria-hidden', 'true');
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const logoSvg = document.createElementNS(SVG_NS, 'svg');
  logoSvg.setAttribute('viewBox', '0 0 160 160');
  logoSvg.setAttribute('fill', 'none');
  const defs = document.createElementNS(SVG_NS, 'defs');
  const grad = document.createElementNS(SVG_NS, 'linearGradient');
  const gradId = `aashiyana-logo-bg-${Math.random().toString(36).slice(2, 7)}`;
  grad.setAttribute('id', gradId);
  grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
  grad.setAttribute('x2', '160'); grad.setAttribute('y2', '160');
  grad.setAttribute('gradientUnits', 'userSpaceOnUse');
  const stop0 = document.createElementNS(SVG_NS, 'stop');
  stop0.setAttribute('offset', '0%');
  stop0.style.stopColor = 'var(--color-accent)';
  const stop1 = document.createElementNS(SVG_NS, 'stop');
  stop1.setAttribute('offset', '100%');
  stop1.style.stopColor = 'var(--color-accent-secondary)';
  grad.appendChild(stop0); grad.appendChild(stop1);
  defs.appendChild(grad);
  logoSvg.appendChild(defs);
  const bgRect = document.createElementNS(SVG_NS, 'rect');
  bgRect.setAttribute('width', '160'); bgRect.setAttribute('height', '160');
  bgRect.setAttribute('rx', '36'); bgRect.setAttribute('fill', `url(#${gradId})`);
  logoSvg.appendChild(bgRect);

  const marks = document.createElementNS(SVG_NS, 'g');
  marks.setAttribute('fill', 'white');
  marks.setAttribute('fill-opacity', '0.82');
  for (const [cx, cy, r] of [[64, 72, 27], [100, 78, 25], [80, 106, 24]]) {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', String(cx)); c.setAttribute('cy', String(cy)); c.setAttribute('r', String(r));
    marks.appendChild(c);
  }
  logoSvg.appendChild(marks);
  logomark.appendChild(logoSvg);
  sidebarLogo.appendChild(logomark);

  const sidebarBrandText = document.createElement('div');
  sidebarBrandText.className = 'nav-sidebar__brand-text';
  const sidebarLogoSpan = document.createElement('span');
  sidebarLogoSpan.className = 'nav-sidebar__brand-name';
  sidebarLogoSpan.textContent = getAppName();
  const sidebarVersion = document.createElement('small');
  sidebarVersion.className = 'nav-sidebar__version';
  const cachedVersion = getAppVersion();
  sidebarVersion.textContent = cachedVersion ? t('login.version', { version: cachedVersion }) : '';
  sidebarVersion.hidden = !cachedVersion;
  sidebarBrandText.append(sidebarLogoSpan, sidebarVersion);
  sidebarLogo.appendChild(sidebarBrandText);

  const sidebarToggle = document.createElement('button');
  sidebarToggle.type = 'button';
  sidebarToggle.className = 'nav-sidebar__toggle';
  const _sidebarInitCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  sidebarToggle.setAttribute('aria-label', _sidebarInitCollapsed ? t('nav.sidebarExpand') : t('nav.sidebarCollapse'));
  sidebarToggle.setAttribute('title', _sidebarInitCollapsed ? t('nav.sidebarExpand') : t('nav.sidebarCollapse'));
  const _toggleIcon = document.createElement('i');
  _toggleIcon.dataset.lucide = _sidebarInitCollapsed ? 'panel-left-open' : 'panel-left-close';
  _toggleIcon.setAttribute('aria-hidden', 'true');
  sidebarToggle.appendChild(_toggleIcon);
  sidebarToggle.addEventListener('click', (event) => {
    const nowCollapsed = !document.documentElement.classList.contains('sidebar-collapsed');
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, nowCollapsed ? '1' : '0');
    applySidebarCollapsed(nowCollapsed);
    if (event.detail > 0) {
      document.documentElement.classList.toggle('sidebar-collapse-pointer-lock', nowCollapsed);
    }
    // Pointer clicks leave the toggle focused, which immediately re-expands the
    // collapsed rail via .nav-sidebar:focus-within. Blur only for pointer-driven
    // activation so keyboard users keep the expected focus behavior.
    if (nowCollapsed && event.detail > 0) {
      requestAnimationFrame(() => sidebarToggle.blur());
    }
    const lbl = nowCollapsed ? t('nav.sidebarExpand') : t('nav.sidebarCollapse');
    sidebarToggle.setAttribute('aria-label', lbl);
    sidebarToggle.setAttribute('title', lbl);
    replaceLucideIcon(sidebarToggle, 'i[data-lucide]', nowCollapsed ? 'panel-left-open' : 'panel-left-close');
  });

  const sidebarItems = document.createElement('div');
  sidebarItems.className = 'nav-sidebar__items nav-sidebar__items--liquid';




  //







  // weitergeht, ohne dass man hinkaeme.
  //




  const pinnedSidebarItems = [];
  sidebarNavItems().forEach((item) => {
    if (item.classList?.contains('nav-item--pinned-end')) pinnedSidebarItems.push(item);
    else sidebarItems.appendChild(item);
  });

  // Scroll-Affordanz (Audit F-01): weiche Fade-Anrisse oben/unten, sobald die


  wireScrollFade(sidebarItems, { axis: 'y' });



  wireFabDockingBoundary();




  const previewHover = (item) => {
    const hov = sidebarItems.querySelector('.nav-sidebar__hover');
    if (!hov) return;
    if (item.getAttribute('aria-current') === 'page') { hov.style.opacity = '0'; return; }
    const cr = sidebarItems.getBoundingClientRect();
    const ir = item.getBoundingClientRect();

    const centerOffset = (ir.height - hov.getBoundingClientRect().height) / 2;
    hov.style.transform = `translateY(${ir.top - cr.top + sidebarItems.scrollTop + centerOffset}px)`;
    hov.style.opacity = '1';
  };
  const hideHover = () => {
    const hov = sidebarItems.querySelector('.nav-sidebar__hover');
    if (hov) hov.style.opacity = '0';
  };
  sidebarItems.addEventListener('mouseover', (ev) => {
    const item = ev.target.closest('.nav-item');
    if (item) previewHover(item);
  });
  sidebarItems.addEventListener('mouseleave', hideHover);


  sidebarItems.addEventListener('focusin', (ev) => {
    const item = ev.target.closest('.nav-item');
    if (item) previewHover(item);
  });
  sidebarItems.addEventListener('focusout', (ev) => {
    if (!sidebarItems.contains(ev.relatedTarget)) hideHover();
  });

  const syncSidebarIndicator = () => {
    requestAnimationFrame(() => positionSidebarIndicator());
  };
  // In collapsed mode the section headers are hidden. Expanding the rail on
  // hover/focus puts them back into layout, which shifts the nav items down.
  // Re-sync the active pill after those layout changes.
  sidebar.addEventListener('mouseenter', syncSidebarIndicator);
  sidebar.addEventListener('mouseleave', syncSidebarIndicator);
  sidebar.addEventListener('focusin', syncSidebarIndicator);
  sidebar.addEventListener('focusout', syncSidebarIndicator);
  sidebar.addEventListener('mouseleave', () => {
    document.documentElement.classList.remove('sidebar-collapse-pointer-lock');
  });

  sidebar.appendChild(sidebarLogo);
  sidebar.appendChild(sidebarToggle);



  // data-route, damit Delegation/Indikator das Item ignorieren.
  const sidebarSearch = sidebarActionEl({
    labelKey: 'nav.search',
    icon: 'search',
    className: 'nav-item--search',
    onClick: () => _openSearch?.(),
  });
  sidebarSearch.setAttribute('aria-keyshortcuts', '/');
  sidebarSearch.setAttribute('title', `${t('nav.search')} (/)`);
  sidebar.appendChild(sidebarSearch);

  sidebar.appendChild(sidebarItems);




  pinnedSidebarItems.forEach((el) => sidebar.appendChild(el));

  // Footer-Aktionen (keine Routen â†’ kein data-route, damit Delegation/Indikator
  // sie ignorieren): Hilfe und Live-Changelog.
  const sidebarFooter = document.createElement('div');
  sidebarFooter.className = 'nav-sidebar__footer-actions';
  sidebarFooter.append(
    sidebarActionEl({
      labelKey: 'nav.help',
      icon: 'circle-help',
      className: 'nav-item--help',
      onClick: () => showHelpModal(),
    }),
    sidebarActionEl({
      labelKey: 'nav.changelog',
      icon: 'history',
      className: 'nav-item--changelog',
      onClick: () => showChangelogModal(),
    }),


    // Geschwister â€” Danger-Rot erscheint erst im Confirm.
    sidebarActionEl({
      labelKey: 'settings.logout',
      icon: 'log-out',
      className: 'nav-item--logout',
      onClick: () => confirmAndLogout(),
    }),
  );
  sidebar.appendChild(sidebarFooter);

  if (window.lucide) window.lucide.createIcons({ el: sidebar });

  const main = document.createElement('main');
  main.className = 'app-content';
  main.id = 'main-content';
  main.tabIndex = -1;




  const fabLayer = document.createElement('div');
  fabLayer.className = 'fab-layer';
  fabLayer.id = 'fab-layer';

  const bottomNav = document.createElement('nav');
  bottomNav.className = 'nav-bottom';
  bottomNav.setAttribute('aria-label', t('nav.navigation'));
  const bottomItems = document.createElement('div');
  bottomItems.className = 'nav-bottom__items';
  if (isGuest) {
    navItems().forEach((item) => bottomItems.appendChild(navItemEl(item)));
  }

  let backdrop, moreSheet;

  if (!isGuest) {
    bottomItems.replaceChildren(...buildBottomNavItems());

    backdrop = document.createElement('div');
    backdrop.className = 'more-backdrop';
    backdrop.id = 'more-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    moreSheet = document.createElement('div');
    moreSheet.className = 'more-sheet';
    moreSheet.id = 'more-sheet';
    moreSheet.setAttribute('role', 'dialog');
    moreSheet.setAttribute('aria-modal', 'true');
    moreSheet.setAttribute('aria-label', t('nav.more'));
    setOverlayInteractive(moreSheet, false);
    const dragHandle = document.createElement('div');
    dragHandle.className = 'more-sheet__handle';
    dragHandle.setAttribute('aria-hidden', 'true');
    moreSheet.insertAdjacentElement('afterbegin', dragHandle);

    const moreSearchBar = document.createElement('button');
    moreSearchBar.type = 'button';
    moreSearchBar.className = 'more-sheet__search';
    moreSearchBar.id = 'more-sheet-search';
    moreSearchBar.setAttribute('aria-label', t('search.placeholder'));
    const moreSearchIcon = document.createElement('i');
    moreSearchIcon.dataset.lucide = 'search';
    moreSearchIcon.className = 'more-sheet__search-icon';
    moreSearchIcon.setAttribute('aria-hidden', 'true');
    const moreSearchPlaceholder = document.createElement('span');
    moreSearchPlaceholder.className = 'more-sheet__search-placeholder';
    moreSearchPlaceholder.textContent = t('search.placeholder');
    moreSearchBar.appendChild(moreSearchIcon);
    moreSearchBar.appendChild(moreSearchPlaceholder);
    moreSheet.appendChild(moreSearchBar);

    // Hinweis + App-Launcher-Grid + System-Cluster. Geteilte Logik mit
    // rebuildNavigation() (Sprachwechsel / Modul-Toggle) â€” sonst driften die
    // zwei Render-Pfade auseinander.
    moreSheet.append(...buildMoreSheetBody());
  }

  bottomNav.appendChild(bottomItems);


  if (!isGuest) {
    const tabIndicator = document.createElement('div');
    tabIndicator.className = 'nav-bottom__indicator';
    tabIndicator.setAttribute('aria-hidden', 'true');
    bottomNav.appendChild(tabIndicator);
  }

  const searchOverlay = document.createElement('div');
  searchOverlay.className = 'search-overlay';
  searchOverlay.id = 'search-overlay';
  searchOverlay.setAttribute('role', 'dialog');
  searchOverlay.setAttribute('aria-modal', 'true');
  searchOverlay.setAttribute('aria-label', t('search.title'));
  setOverlayInteractive(searchOverlay, false);
  const searchHeader = document.createElement('div');
  searchHeader.className = 'search-overlay__header';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'search-overlay__input';
  searchInput.id = 'search-input';
  searchInput.placeholder = t('search.placeholder');
  searchInput.setAttribute('aria-label', t('search.title'));
  const searchClose = document.createElement('button');
  searchClose.className = 'search-overlay__close';
  searchClose.id = 'search-close';
  searchClose.type = 'button';
  searchClose.setAttribute('aria-label', t('common.close'));
  const closeIcon = document.createElement('i');
  closeIcon.dataset.lucide = 'x';
  closeIcon.className = 'search-overlay__close-icon';
  closeIcon.setAttribute('aria-hidden', 'true');
  searchClose.appendChild(closeIcon);
  searchHeader.appendChild(searchInput);
  const searchResults = document.createElement('div');
  searchResults.className = 'search-overlay__results';
  searchResults.id = 'search-results';



  const searchPanel = document.createElement('div');
  searchPanel.className = 'search-overlay__panel';
  searchPanel.appendChild(searchHeader);
  searchPanel.appendChild(searchResults);



  const searchStatus = document.createElement('p');
  searchStatus.className = 'sr-only';
  searchStatus.id = 'search-status';
  searchStatus.setAttribute('role', 'status');
  searchStatus.setAttribute('aria-live', 'polite');
  searchPanel.appendChild(searchStatus);



  searchPanel.appendChild(searchClose);
  searchOverlay.appendChild(searchPanel);



  const toastContainerPolite = document.createElement('div');
  toastContainerPolite.className = 'toast-container';
  toastContainerPolite.id = TOAST_SURFACES.polite;
  toastContainerPolite.setAttribute('aria-live', 'polite');

  const toastContainerAssertive = document.createElement('div');
  toastContainerAssertive.className = 'toast-container';
  toastContainerAssertive.id = TOAST_SURFACES.assertive;
  toastContainerAssertive.setAttribute('aria-live', 'assertive');





  const bulkPillLayerEl = document.createElement('div');
  bulkPillLayerEl.className = 'bulk-pill-layer';
  bulkPillLayerEl.id = BULK_PILL_LAYER;






  const bottomStack = document.createElement('div');
  bottomStack.className = 'shell-bottom-stack';
  bottomStack.append(bulkPillLayerEl, toastContainerPolite, toastContainerAssertive);

  const routeAnnouncer = document.createElement('div');
  routeAnnouncer.id = 'route-announcer';
  routeAnnouncer.className = 'sr-only';
  routeAnnouncer.setAttribute('aria-live', 'polite');
  routeAnnouncer.setAttribute('aria-atomic', 'true');


  // Erstes Shell-Kind: liegt via z-index: -1 (glass.css Section 40) hinter

  // Blob 1 folgt --active-module-accent â†’ rekoloriert pro Sektion.
  const lgBackdrop = document.createElement('div');
  lgBackdrop.className = 'lg-backdrop';
  lgBackdrop.setAttribute('aria-hidden', 'true');




  for (let i = 1; i <= 4; i++) {
    const blob = document.createElement('div');
    blob.className = `lg-blob lg-blob--${i}`;
    const ink = document.createElement('div');
    ink.className = 'lg-blob__ink';
    blob.appendChild(ink);
    lgBackdrop.appendChild(blob);
  }







  //




  //


  const shellNodes = [skipLink, lgBackdrop, sidebar, main, fabLayer, bottomStack, bottomNav];
  if (backdrop)   shellNodes.push(backdrop);
  if (moreSheet)  shellNodes.push(moreSheet);
  shellNodes.push(searchOverlay, routeAnnouncer);
  container.replaceChildren(...shellNodes);

  // sonst am verworfenen (siehe observeNavCapsule weiter unten).
  observeNavCapsule();
  applySidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');
  updateBranding(currentPath || '/');


  container.querySelectorAll('[data-route]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(el.dataset.navHref ?? el.dataset.route);
    });
  });




  const prefetchFromEvent = (e) => {
    const el = e.target.closest?.('[data-route]');
    if (el) prefetchRoute(el.dataset.navHref?.split('?')[0] ?? el.dataset.route);
  };
  container.addEventListener('mouseover', prefetchFromEvent);
  container.addEventListener('pointerdown', prefetchFromEvent);

  const openSearch = initSearch(container);
  _openSearch = openSearch;
  initMoreSheet(container, openSearch);
  initOfflineBanner();
  initKeyboardShortcuts();


  // ohne Kaltstart-Wasserfall auskommen.
  warmPrimaryRoutes();
}

function adoptPageFab() {
  const layer = document.getElementById('fab-layer');
  if (!layer) return null;
  const fresh = document.querySelector('#main-content .page-fab');
  if (fresh && dockFabIntoToolbar(fresh)) return null;




  if (fresh) layer.replaceChildren(fresh.closest('.page-fab-group') ?? fresh);
  return layer.querySelector('.page-fab');
}

function dockFabIntoToolbar(fab) {
  if (!isDesktopViewport()) return false;
  if (fab.closest('.page-fab-group')) return false;
  const main = document.getElementById('main-content');
  if (main?.querySelector('.toolbar-new-btn')) return false;
  const slot = main?.querySelector('.page-toolbar__actions');
  if (!slot) return false;
  const label = fab.dataset.dockLabel;
  if (!label) return false;


  // `document.querySelector('.page-fab').click()` auf (Rezepte, Einkauf); wer


  fab.classList.add('btn', 'btn--primary', 'page-fab--docked');
  if (!fab.querySelector('.toolbar-new-btn__label')) {
    const span = document.createElement('span');
    span.className = 'toolbar-new-btn__label';
    span.textContent = label;
    fab.appendChild(span);
  }
  slot.appendChild(fab);
  markFabShortcut(fab);
  return true;
}

function markFabShortcut(fab) {
  fab.setAttribute('aria-keyshortcuts', 'n');
  const fabLabel = fab.getAttribute('aria-label');
  if (fabLabel && !/\(n\)$/.test(fab.getAttribute('title') || '')) {
    fab.setAttribute('title', `${fabLabel} (n)`);
  }
}

function isDesktopViewport() {
  return window.matchMedia('(min-width: 1024px)').matches;
}

function undockFabFromToolbar(fab) {
  const layer = document.getElementById('fab-layer');
  if (!layer) return false;
  fab.classList.remove('btn', 'btn--primary', 'page-fab--docked');
  fab.querySelector('.toolbar-new-btn__label')?.remove();
  layer.replaceChildren(fab.closest('.page-fab-group') ?? fab);
  return true;
}

function wireFabDockingBoundary() {
  const query = window.matchMedia?.('(min-width: 1024px)');
  if (!query?.addEventListener) return;
  query.addEventListener('change', () => {
    const docked = document.querySelector('#main-content .page-fab--docked');
    if (docked && !isDesktopViewport()) {
      undockFabFromToolbar(docked);
      return;
    }
    if (!docked && isDesktopViewport()) {
      const floating = document.querySelector('#fab-layer .page-fab');


      if (floating) dockFabIntoToolbar(floating);
    }
  });
}

let _toolbarObserverRoot = null;
const _toolbarHandles = new WeakMap();

function headSealIcon(mod) {
  const name = mod ? MODULE_ICON[mod] : null;
  return name ? () => moduleIconEl(name) : null;
}

function wireToolbar(el) {
  const handle = wireCollapsingHeader(el, { sealIcon: headSealIcon(currentRoute()?.module) });



  if (handle && !_toolbarHandles.has(el)) _toolbarHandles.set(el, handle);
}

function unwireToolbar(el) {
  _toolbarHandles.get(el)?.destroy();
  _toolbarHandles.delete(el);
}

function wirePageToolbars() {
  const main = document.getElementById('main-content');
  if (!main) return;
  main.querySelectorAll('.page-toolbar').forEach(wireToolbar);
  if (_toolbarObserverRoot === main) return;
  _toolbarObserverRoot = main;
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches('.page-toolbar')) wireToolbar(node);
        else node.querySelectorAll('.page-toolbar').forEach(wireToolbar);
      }
    }
    for (const m of mutations) {
      for (const node of m.removedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches('.page-toolbar')) unwireToolbar(node);
        else node.querySelectorAll('.page-toolbar').forEach(unwireToolbar);
      }
    }
  }).observe(main, { childList: true, subtree: true });
}

function clearPageFab() {
  document.getElementById('fab-layer')?.replaceChildren();
}

const FAB_SEEN_KEY = (module) => `aashiyana:fabSeen:${module}`;
const FAB_SEEN_MAX = 5;
const SIDEBAR_COLLAPSED_KEY = 'aashiyana.sidebar.collapsed';

const SHORTCUTS = [


  { key: '/',   description: () => t('shortcuts.search'),  action: () => _openSearch?.() },



  { key: 'n',   description: () => t('shortcuts.new'),     action: () => document.querySelector('.page-fab')?.click() },
  { key: 'f',   description: () => t('shortcuts.searchCalendar'), action: async () => {


    if (location.pathname !== '/calendar') await navigate('/calendar');
    document.querySelector('#cal-search')?.click();
  } },
  { key: '?',   description: () => t('shortcuts.help'),    action: () => showHelpModal() },
  { key: 'g d', description: () => t('shortcuts.goDash'),  action: () => navigate('/') },
  { key: 'g t', description: () => t('shortcuts.goTasks'), action: () => navigate('/tasks') },
  { key: 'g c', description: () => t('shortcuts.goCal'),   action: () => navigate('/calendar') },
  { key: 'g s', description: () => t('shortcuts.goShop'),  action: () => navigate('/shopping') },
  { key: 'g n', description: () => t('shortcuts.goNotes'),   action: () => navigate('/notes')              },
  { key: 'g h', description: () => t('shortcuts.goHealth'),  action: () => navigate(getLastHealthRoute())  },
  // Die 3er-Chords nennen ihr konkretes Ziel (Essensplan/Rezepte/Einkauf):

  // (Audit A1-13).
  { key: 'g k',   description: () => t('shortcuts.goKitchen'), action: () => navigate(getLastKitchenRoute()) },
  { key: 'g k m', description: () => t('nav.meals'),           action: () => navigate('/meals')             },
  { key: 'g k r', description: () => t('nav.recipes'),         action: () => navigate('/recipes')           },
  { key: 'g k s', description: () => t('nav.shopping'),        action: () => navigate('/shopping')          },
  { key: 'g k v', description: () => t('nav.pantry'),          action: () => navigate('/pantry')            },
  { key: 'g i', description: () => t('shortcuts.goInventory'), action: () => navigate('/inventory') },


  // deutscher Merkhilfe (Budget, Einstellungen); die uebrigen Kandidaten
  // (Kontakte, Dokumente, Schichtplan, Haushaltshilfe, Belohnungen,


  { key: 'g b', description: () => t('nav.budget'),   action: () => navigate('/budget') },
  { key: 'g e', description: () => t('nav.settings'), action: () => navigate('/settings') },
];

let _pendingKey = null;
let _pendingTimer = null;

let _openSearch = null;

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.activeElement?.isContentEditable) return;
    if (document.querySelector('.modal-overlay') && e.key !== 'Escape') return;
    // Modifikatoren durchlassen: Cmd/Ctrl/Alt-Kombis (z. B. Cmd+F â€žIm Browser

    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const key = e.key.toLowerCase();

    // 3-Tasten-Chord: g k {m|r|s}
    if (_pendingKey === 'g k') {
      clearTimeout(_pendingTimer);
      _pendingKey = null;
      const chord3 = `g k ${key}`;
      const s3 = SHORTCUTS.find((s) => s.key === chord3);
      if (s3) { e.preventDefault(); s3.action(); return; }

      const gk = SHORTCUTS.find((s) => s.key === 'g k');
      if (gk) { e.preventDefault(); gk.action(); }
      return;
    }

    // 2-Tasten-Chord: g {d|t|c|s|n|k}
    if (_pendingKey === 'g' && key !== 'g') {
      clearTimeout(_pendingTimer);
      if (key === 'k') {

        _pendingKey = 'g k';
        _pendingTimer = setTimeout(() => {
          _pendingKey = null;
          const gk = SHORTCUTS.find((s) => s.key === 'g k');
          if (gk) gk.action();
        }, 1000);
        return;
      }
      _pendingKey = null;
      const combo = `g ${key}`;
      const shortcut = SHORTCUTS.find((s) => s.key === combo);
      if (shortcut) { e.preventDefault(); shortcut.action(); }
      return;
    }

    if (key === 'g') {
      _pendingKey = 'g';
      _pendingTimer = setTimeout(() => { _pendingKey = null; }, 1000);
      return;
    }

    const shortcut = SHORTCUTS.find((s) => s.key === key && !s.key.includes(' '));
    if (shortcut) { e.preventDefault(); shortcut.action(); }
  });
}

function showHelpModal() {
  // Mirrors the CSS sidebarâ†”bottom-nav breakpoint (sidebar is min-width:1024px):
  // without a keyboard, shortcut rows are useless â€” show a plain-language guide.
  const coarsePointer = window.matchMedia('(max-width: 1023px)').matches;
  const helpRows = buildHelpRows({ coarsePointer, shortcuts: SHORTCUTS, t });

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('aria-modal', 'true');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const panel = document.createElement('div');
  panel.className = 'modal-panel modal-panel--sm';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('help.title'));

  const rows = helpRows.map((r) => r.key
    ? `<div class="help-row">
         <kbd class="shortcut-kbd">${esc(r.key)}</kbd>
         <span class="shortcut-desc">${esc(r.desc)}</span>
       </div>`
    : `<div class="help-row">
         <i data-lucide="${esc(r.icon)}" class="help-row__icon icon-md" aria-hidden="true"></i>
         <span class="shortcut-desc">${esc(r.desc)}</span>
       </div>`
  ).join('');

  panel.insertAdjacentHTML('beforeend', `
    <div class="modal-panel__header">
      <span class="modal-panel__title">${esc(t('help.title'))}</span>
      <button class="modal-panel__close btn--ghost" aria-label="${esc(t('common.close'))}">
        <i data-lucide="x" class="icon-md" aria-hidden="true"></i>
      </button>
    </div>
    <div class="modal-panel__body">
      <div class="shortcuts-list">${rows}</div>
      <!-- Nutzerhandbuch aus der Community (#799). Es lebt in einem fremden
           Repository und in fremder Regie - deshalb steht die Herkunft im
           Linktext und nicht nur im Hinweis darunter: wer hier klickt,
           verlaesst das Projekt, und das soll er vorher wissen. -->
      <p class="help-guide">
        <a href="https://kyrodan.github.io/aashiyana-docs/" target="_blank" rel="noopener noreferrer">
          ${esc(t('help.guideLink'))}
        </a>
        <span class="help-guide__hint">${esc(t('help.guideHint'))}</span>
      </p>
    </div>
  `);

  panel.querySelector('.modal-panel__close').addEventListener('click', () => overlay.remove());
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); }
  });

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // statt `pushOverlay`, weil er auf drei Wegen per `remove()` verschwindet.
  attachOverlay(overlay, () => overlay.remove());
  if (window.lucide) window.lucide.createIcons({ el: panel });
}

// --------------------------------------------------------
// Update-Hinweis (#490)
// --------------------------------------------------------

// Zuletzt vom Server gemeldete neueste Release-Version. Persistiert, damit der


const UPDATE_LATEST_KEY = 'aashiyana.update.latest';
const UPDATE_CHECKED_AT_KEY = 'aashiyana.update.checkedAt';

function changelogSeen() {
  return currentUser?.changelog_seen || { version: null, latest: null };
}


const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function pendingUpdateVersion() {
  const latest = localStorage.getItem(UPDATE_LATEST_KEY) || '';
  if (!latest) return '';
  if (!isNewerVersion(latest, getAppVersion())) return '';
  const seen = changelogSeen().latest || '';
  if (seen && !isNewerVersion(latest, seen)) return '';
  return latest;
}

function toggleUpdateDot(el, on) {
  const existing = el.querySelector('.nav-dot');
  if (!on) { existing?.remove(); return; }
  if (existing) return;
  const dot = document.createElement('span');
  dot.className = 'nav-dot';
  dot.setAttribute('aria-hidden', 'true');


  (el.querySelector('.nav-item__icon-wrap') ?? el).appendChild(dot);
}

function withUpdateHint(label, version) {
  if (!version) return label;
  return `${label} - ${t('changelog.updateAvailable', { version: displayVersion(version) })}`.trim();
}

function applyUpdateBadge() {
  const version = pendingUpdateVersion();
  for (const el of document.querySelectorAll('.nav-item--changelog, .more-item--changelog, #more-btn')) {
    toggleUpdateDot(el, Boolean(version));
  }



  for (const el of document.querySelectorAll('.nav-item--changelog, .more-item--changelog')) {
    const label = withUpdateHint(t('nav.changelog'), version);
    el.setAttribute('aria-label', label);
    if (el.hasAttribute('title')) el.setAttribute('title', label);
  }
}

async function checkForUpdate({ force = false } = {}) {
  const lastCheck = Number(localStorage.getItem(UPDATE_CHECKED_AT_KEY) || 0);
  const age = Date.now() - lastCheck;
  if (!force && lastCheck && age >= 0 && age < UPDATE_CHECK_INTERVAL_MS) {
    applyUpdateBadge();
    return;
  }

  try {
    const payload = await api.get('/changelog');
    const latest = String(payload?.data?.latest_version || '').trim();




    if (payload?.data?.source !== 'local') {
      localStorage.setItem(UPDATE_CHECKED_AT_KEY, String(Date.now()));
    }
    if (latest) localStorage.setItem(UPDATE_LATEST_KEY, latest);
  } catch { /* still: siehe oben */ }
  applyUpdateBadge();
}

function versionText(value) {
  return String(value || '').trim() || t('changelog.unknownVersion');
}

function versionKey(value) {
  return String(value || '').trim().replace(/^v/i, '').toLowerCase();
}

function renderChangelogStatus(panel, message, tone = 'muted') {
  const status = panel.querySelector('#changelog-status');
  if (!status) return;
  status.hidden = false;
  status.className = `changelog-status changelog-status--${tone}`;
  status.textContent = message;
}

function entryNode(entry) {
  const li = document.createElement('li');
  const lead = String(entry?.lead || '');
  const detail = String(entry?.detail || '');
  if (!detail) {
    li.className = 'changelog-entry changelog-entry--plain';
    li.textContent = lead;
    return li;
  }
  li.className = 'changelog-entry';
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.className = 'changelog-entry__lead';
  summary.textContent = lead;
  const body = document.createElement('p');
  body.className = 'changelog-entry__detail';
  body.textContent = detail;
  details.appendChild(summary);
  details.appendChild(body);
  li.appendChild(details);
  return li;
}

function sectionEntries(section) {
  if (Array.isArray(section?.entries) && section.entries.length) return section.entries;
  return (Array.isArray(section?.items) ? section.items : [])
    .map((item) => ({ lead: String(item || ''), detail: '' }));
}

function appendReleaseSection(parent, section) {
  const block = document.createElement('section');
  block.className = 'changelog-section';

  const title = document.createElement('h4');
  title.className = 'changelog-section__title';
  title.textContent = section.title || t('changelog.changes');
  block.appendChild(title);

  const list = document.createElement('ul');
  list.className = 'changelog-section__list';
  for (const entry of sectionEntries(section)) list.appendChild(entryNode(entry));
  block.appendChild(list);
  parent.appendChild(block);
}

function appendReleaseCard(parent, release, currentVersion) {
  const isCurrent = Boolean(versionKey(release.version))
    && versionKey(release.version) === versionKey(currentVersion);
  const card = document.createElement('article');
  card.className = `changelog-release${isCurrent ? ' changelog-release--current' : ''}`;

  const header = document.createElement('div');
  header.className = 'changelog-release__header';
  const title = document.createElement('h3');
  title.className = 'changelog-release__version';
  title.textContent = versionText(release.version);
  header.appendChild(title);

  if (isCurrent) {
    const badge = document.createElement('span');
    badge.className = 'changelog-release__badge';
    badge.textContent = t('changelog.currentBadge');
    header.appendChild(badge);
  }
  card.appendChild(header);

  const sections = Array.isArray(release.sections) ? release.sections : [];
  if (sections.length) {
    for (const section of sections) appendReleaseSection(card, section);
  } else {
    const empty = document.createElement('p');
    empty.className = 'changelog-release__empty';
    empty.textContent = t('changelog.noReleaseNotes');
    card.appendChild(empty);
  }
  parent.appendChild(card);
}




// abgeschnitten.
const WHATS_NEW_MAX = 12;

function appendWhatsNew(parent, releases, currentVersion, seenInstalled) {
  const fresh = releasesNewForMe(releases, currentVersion, seenInstalled);
  if (!fresh.length) return;

  const entries = fresh.flatMap((release) =>
    (Array.isArray(release.sections) ? release.sections : []).flatMap(sectionEntries));
  if (!entries.length) return;

  const box = document.createElement('section');
  box.className = 'changelog-whats-new';

  const title = document.createElement('h3');
  title.className = 'changelog-whats-new__title';
  title.textContent = t('changelog.whatsNewTitle');
  box.appendChild(title);

  const since = document.createElement('p');
  since.className = 'changelog-whats-new__since';
  since.textContent = t('changelog.whatsNewSince', { version: displayVersion(seenInstalled) });
  box.appendChild(since);

  const list = document.createElement('ul');
  list.className = 'changelog-section__list';
  for (const entry of entries.slice(0, WHATS_NEW_MAX)) list.appendChild(entryNode(entry));
  box.appendChild(list);

  const hidden = entries.length - WHATS_NEW_MAX;
  if (hidden > 0) {
    const more = document.createElement('p');
    more.className = 'changelog-whats-new__more';
    more.textContent = t('changelog.whatsNewMore', { count: hidden });
    box.appendChild(more);
  }
  parent.appendChild(box);
}

function renderChangelog(panel, payload) {
  const data = payload?.data ?? {};
  const currentVersion = data.current_version;
  const latestVersion = data.latest_version;
  const releases = Array.isArray(data.releases) ? data.releases : [];

  panel.querySelector('#changelog-current-version').textContent = versionText(currentVersion);
  panel.querySelector('#changelog-latest-version').textContent = versionText(latestVersion);


  // GitHub-Liste auftaucht, interessiert dann niemanden mehr.
  //

  // ueber neuere Versionen wissen, also waere sowohl "Version X ist verfuegbar"

  // etwas, das gerade niemand nachsehen konnte (#838).
  const local = data.source === 'local';
  const updateAvailable = !local && isNewerVersion(latestVersion, currentVersion);
  const note = panel.querySelector('#changelog-version-note');
  if (local) {
    note.textContent = t('changelog.offlineNotice');
  } else if (updateAvailable) {
    note.textContent = t('changelog.updateAvailable', { version: displayVersion(latestVersion) });
  } else {
    note.textContent = data.current_in_releases
      ? t('changelog.currentFound')
      : t('changelog.currentMissing');
  }
  note.classList.toggle('changelog-version-note--warning', local || (!updateAvailable && !data.current_in_releases));
  note.classList.toggle('changelog-version-note--update', updateAvailable);



  if (latestVersion) {
    localStorage.setItem(UPDATE_LATEST_KEY, String(latestVersion));
    localStorage.setItem(UPDATE_CHECKED_AT_KEY, String(Date.now()));
  }

  const status = panel.querySelector('#changelog-status');
  if (status) status.hidden = true;

  const list = panel.querySelector('#changelog-list');
  list.replaceChildren();
  if (!releases.length) {
    renderChangelogStatus(panel, t('changelog.empty'), 'muted');
    return;
  }

  const fragment = document.createDocumentFragment();


  // die Antwort "nichts Neues" - jedes Mal.
  const seenInstalled = changelogSeen().version || '';
  appendWhatsNew(fragment, releases, currentVersion, seenInstalled);
  for (const release of releases) appendReleaseCard(fragment, release, currentVersion);
  list.appendChild(fragment);
  markChangelogSeen(latestVersion);
}

function markChangelogSeen(latestVersion) {
  const seen = changelogSeen();
  if (currentUser) {
    currentUser.changelog_seen = {
      version: getAppVersion() || seen.version,
      latest: latestVersion || seen.latest,
    };
  }
  applyUpdateBadge();
  api.post('/auth/changelog-seen', latestVersion ? { latest: String(latestVersion) } : {})
    .catch(() => { /* still: siehe oben */ });
}

function showChangelogModal() {
  openModal({
    title: t('changelog.title'),
    size: 'xl',
    content: `
      <div class="changelog-modal">
        <div class="changelog-summary" aria-live="polite">
          <div class="changelog-summary__item">
            <span>${esc(t('changelog.currentVersion'))}</span>
            <strong id="changelog-current-version">${esc(t('changelog.loadingShort'))}</strong>
          </div>
          <div class="changelog-summary__item">
            <span>${esc(t('changelog.latestVersion'))}</span>
            <strong id="changelog-latest-version">${esc(t('changelog.loadingShort'))}</strong>
          </div>
        </div>
        <p class="changelog-version-note" id="changelog-version-note"></p>
        <div class="changelog-status changelog-status--muted" id="changelog-status" role="status">
          ${esc(t('changelog.loading'))}
        </div>
        <div class="changelog-list" id="changelog-list"></div>
      </div>
    `,
    onSave(panel) {
      api.get('/changelog')
        .then((payload) => renderChangelog(panel, payload))
        .catch(() => {
          panel.querySelector('#changelog-list')?.replaceChildren();
          renderChangelogStatus(panel, t('changelog.loadError'), 'error');
        });
    },
  });
}

function loadReminderStyles() {
  if (document.querySelector('link[href="/styles/reminders.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/styles/reminders.css';
  document.head.appendChild(link);
}

function initOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  if (!banner) return;
  const i18nSpan = banner.querySelector('[data-i18n]');
  function update() {
    banner.hidden = navigator.onLine;
    if (i18nSpan) i18nSpan.textContent = t('offline.banner');
    document.documentElement.style.setProperty(
      '--offline-banner-height', navigator.onLine ? '0px' : `${banner.offsetHeight || 40}px`
    );
  }
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function initMoreSheet(container, openSearch) {
  const moreBtn  = container.querySelector('#more-btn');
  const backdrop = container.querySelector('#more-backdrop');
  const sheet    = container.querySelector('#more-sheet');
  if (!moreBtn || !backdrop || !sheet) return;
  let lastFocusedBeforeSheet = null;
  const moreSheetTrap = createFocusTrap(sheet);
  const currentMoreBtn = () => container.querySelector('#more-btn') || moreBtn;


  let sheetOverlayToken = null;

  function openSheet() {
    lastFocusedBeforeSheet = document.activeElement;
    sheetOverlayToken = pushOverlay(() => closeSheet());
    setOverlayInteractive(sheet, true);
    sheet.addEventListener('keydown', moreSheetTrap);
    backdrop.classList.add('more-backdrop--visible');
    currentMoreBtn().setAttribute('aria-expanded', 'true');
    sheet.querySelector('#more-sheet-search, [data-route]')?.focus();
    if (window.lucide) window.lucide.createIcons({ el: sheet });
    paintMoreSheetBadges(sheet);
    refreshModuleCounts().then((fresh) => {
      if (fresh && sheet.getAttribute('aria-hidden') !== 'true') paintMoreSheetBadges(sheet);
    });
  }

  function closeSheet({ restoreFocus = true } = {}) {
    if (sheet.getAttribute('aria-hidden') === 'true') return;
    if (sheetOverlayToken !== null) {
      const token = sheetOverlayToken;
      sheetOverlayToken = null;
      dropOverlay(token);
    }
    setOverlayInteractive(sheet, false);
    sheet.removeEventListener('keydown', moreSheetTrap);
    backdrop.classList.remove('more-backdrop--visible');
    currentMoreBtn().setAttribute('aria-expanded', 'false');
    if (restoreFocus) returnFocus(lastFocusedBeforeSheet || currentMoreBtn());
  }

  container.addEventListener('click', (e) => {
    if (!e.target.closest('#more-btn')) return;
    e.preventDefault();
    const isOpen = sheet.getAttribute('aria-hidden') === 'false';
    isOpen ? closeSheet() : openSheet();
  });

  backdrop.addEventListener('click', () => closeSheet());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheet.getAttribute('aria-hidden') === 'false') {
      closeSheet();
    }
  });

  let _touchStartY = 0;
  let _touchStartAtTop = true;
  sheet.addEventListener('touchstart', (e) => {
    _touchStartY = e.touches[0].clientY;
    const body = sheet.querySelector('.more-sheet__body');
    _touchStartAtTop = !body || body.scrollTop <= 0;
  }, { passive: true });
  sheet.addEventListener('touchend', (e) => {
    if (!_touchStartAtTop) return;
    if (e.changedTouches[0].clientY - _touchStartY > 60) closeSheet();
  }, { passive: true });

  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-route]')) closeSheet({ restoreFocus: false });
  });

  const moreSearchBar = sheet.querySelector('#more-sheet-search');
  if (moreSearchBar && openSearch) {
    const triggerSearch = () => {

      sheet.style.transition = 'none';
      closeSheet({ restoreFocus: false });
      requestAnimationFrame(() => {
        openSearch();
        sheet.style.transition = '';
      });
    };
    moreSearchBar.addEventListener('click', triggerSearch);
  }

  window._closeMoreSheet = closeSheet;
}

/**
 * Initialisiert die Suchfunktion (Overlay + API-Calls).
 */


// Haupt-Navigation, damit Suche und Nav dieselbe Sprache sprechen).
const SEARCH_SCOPES = [
  { labelKey: 'nav.tasks',    route: '/tasks'    },
  { labelKey: 'nav.calendar', route: '/calendar' },
  { labelKey: 'nav.notes',    route: '/notes'    },
  { labelKey: 'nav.contacts', route: '/contacts' },
  { labelKey: 'nav.shopping', route: '/shopping' },
  { labelKey: 'nav.health',   route: '/health'   },
];

function initSearch(container) {
  const searchClose = container.querySelector('#search-close');
  const overlay      = container.querySelector('#search-overlay');
  const input        = container.querySelector('#search-input');
  const results      = container.querySelector('#search-results');
  const status       = container.querySelector('#search-status');
  if (!overlay || !input || !results) return null;

  function setStatus(text) {
    if (status) status.textContent = text || '';
  }




  let _searchTrapHandler = null;
  let lastFocusedBeforeSearch = null;





  function renderSearchHint() {
    results.replaceChildren();
    results.removeAttribute('aria-busy');
    setStatus('');
    results.appendChild(emptyHintEl(t('search.emptyHint')));

    const scopes = document.createElement('div');
    scopes.className = 'search-scopes';
    const scopesHeading = document.createElement('h3');
    scopesHeading.className = 'search-section__heading';
    scopesHeading.textContent = t('search.scopesLabel');
    scopes.appendChild(scopesHeading);
    const list = document.createElement('div');
    list.className = 'search-scopes__list';
    SEARCH_SCOPES.forEach((scope) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'search-scope';
      // Markensiegel (Herkunfts-Regel, Block 2): die Kachel benennt ihr

      const seal = document.createElement('span');
      seal.className = 'module-seal module-seal--sm search-scope__seal';
      seal.setAttribute('aria-hidden', 'true');
      seal.style.setProperty('--seal-accent', moduleAccentVar(scope.route.slice(1)));
      seal.appendChild(moduleIconEl(MODULE_ICON[scope.route.slice(1)]));
      const label = document.createElement('span');
      label.textContent = t(scope.labelKey);
      btn.append(seal, label);
      btn.addEventListener('click', () => {
        closeSearch({ restoreFocus: false });
        navigate(scope.route);
      });
      list.appendChild(btn);
    });
    scopes.appendChild(list);
    results.appendChild(scopes);


    window.lucide?.createIcons({ el: results });
  }


  let searchOverlayToken = null;

  function openSearch() {
    if (window._closeMoreSheet) window._closeMoreSheet({ restoreFocus: false });
    lastFocusedBeforeSearch = document.activeElement;
    if (searchOverlayToken === null) searchOverlayToken = pushOverlay(() => closeSearch());
    setOverlayInteractive(overlay, true);
    overlay.classList.add('search-overlay--visible');
    if (!input.value.trim()) renderSearchHint();
    setTimeout(() => input.focus(), 50);
    if (window.lucide) window.lucide.createIcons({ el: overlay });

    _searchTrapHandler = createFocusTrap(overlay);
    overlay.addEventListener('keydown', _searchTrapHandler);
  }

  function closeSearch({ restoreFocus = true } = {}) {
    if (searchOverlayToken !== null) {
      const token = searchOverlayToken;
      searchOverlayToken = null;
      dropOverlay(token);
    }


    clearTimeout(searchTimer);
    setOverlayInteractive(overlay, false);
    overlay.classList.remove('search-overlay--visible');
    if (_searchTrapHandler) {
      overlay.removeEventListener('keydown', _searchTrapHandler);
      _searchTrapHandler = null;
    }
    input.value = '';
    results.replaceChildren();
    results.removeAttribute('aria-busy');
    setStatus('');
    if (restoreFocus) returnFocus(lastFocusedBeforeSearch);
  }

  if (searchClose) searchClose.addEventListener('click', closeSearch);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('search-overlay--visible')) {
      closeSearch();
    }
  });



  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const hits = [...results.querySelectorAll('.search-result')];
    if (!hits.length) return;
    e.preventDefault();
    const idx = hits.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      (idx < 0 ? hits[0] : hits[Math.min(idx + 1, hits.length - 1)]).focus();
    } else if (idx > 0) {
      hits[idx - 1].focus();
    } else if (idx === 0) {
      input.focus();
    }
  });

  let searchTimer = null;
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) {
      renderSearchHint();
      return;
    }
    searchTimer = setTimeout(async () => {


      // langsamem Home-Server (Critique P1). Kein Flackern bei schnellem Tippen.
      results.replaceChildren();
      results.setAttribute('aria-busy', 'true');
      results.insertAdjacentHTML('beforeend', renderSkeletonList({ rows: 4, lines: 2 }));
      setStatus(t('search.loading'));
      try {
        const data = await api.get(`/search?q=${encodeURIComponent(q)}`);
        const count = renderSearchResults(results, data, () => closeSearch({ restoreFocus: false }));
        results.setAttribute('aria-busy', 'false');
        setStatus(
          count === 0 ? t('search.noResults')
            : count === 1 ? t('search.resultCountOne', { count })
            : t('search.resultCountMany', { count }),
        );
      } catch {



        results.replaceChildren();
        results.setAttribute('aria-busy', 'false');
        results.appendChild(emptyHintEl(t('search.error')));
        setStatus(t('search.error'));
      }
    }, 300);
  });

  return openSearch;
}

function renderSearchResults(container, data, onClose) {
  container.replaceChildren();
  const { tasks = [], events = [], notes = [], contacts = [], items = [], meds = [], activities = [], waste = [] } = data;
  const total = tasks.length + events.length + notes.length + contacts.length + items.length
    + meds.length + activities.length + waste.length;

  if (total === 0) {
    container.appendChild(emptyHintEl(t('search.noResults')));
    return 0;
  }


  const activityLabel = (item) => {
    const preset = activityType(item.title);
    return preset ? t(preset.labelKey) : item.title;
  };





  // (Zeilenlisten-Regel) statt als Karte pro Treffer.
  function makeSection(labelKey, sealModule, items, routeFn, labelFn, metaFn) {
    if (!items.length) return;
    const section = document.createElement('div');
    section.className = 'search-section';
    const heading = document.createElement('h3');
    heading.className = 'search-section__heading';
    if (sealModule) {
      const sealEl = document.createElement('span');
      sealEl.className = 'module-seal module-seal--sm';
      sealEl.setAttribute('aria-hidden', 'true');
      sealEl.style.setProperty('--seal-accent', moduleAccentVar(sealModule));
      sealEl.appendChild(moduleIconEl(MODULE_ICON[sealModule]));
      heading.appendChild(sealEl);
    }
    heading.appendChild(document.createTextNode(t(labelKey)));
    section.appendChild(heading);
    const rows = document.createElement('div');
    rows.className = 'search-section__rows';
    items.forEach((item) => {
      const btn = document.createElement('button');
      btn.className = 'search-result';
      const title = document.createElement('span');
      title.className = 'search-result__title';
      title.textContent = labelFn ? labelFn(item) : item.title;
      btn.appendChild(title);

      // unterscheidbar (Audit A1-14).
      const metaText = metaFn?.(item);
      if (metaText) {
        const meta = document.createElement('span');
        meta.className = 'search-result__meta';
        meta.textContent = metaText;
        btn.appendChild(meta);
      }
      btn.addEventListener('click', () => {
        onClose();
        navigate(routeFn(item));
      });
      rows.appendChild(btn);
    });
    section.appendChild(rows);
    container.appendChild(section);
  }

  makeSection('nav.tasks',    'tasks',    tasks,    (i) => `/tasks?open=${i.id}`, null,
    (i) => (i.due_date ? formatDate(i.due_date) : ''));
  makeSection('nav.calendar', 'calendar', events,   (i) => `/calendar?open=${i.id}`, null,
    (i) => (i.start_datetime ? `${formatDate(i.start_datetime)}${i.all_day ? '' : ` Â· ${formatTime(i.start_datetime)}`}` : ''));
  makeSection('nav.notes',    'notes',    notes,    (i) => `/notes?open=${i.id}`);
  makeSection('nav.contacts', 'contacts', contacts, (i) => `/contacts?open=${i.id}`);
  makeSection('nav.shopping', 'shopping', items,    (i) => `/shopping?list=${i.list_id}&highlight=${i.id}`);
  makeSection('health.tabs.meds',     'health', meds,       () => '/health/meds', null,
    (i) => i.dosage_text || '');
  makeSection('health.tabs.activity', 'health', activities, () => '/health/activity', activityLabel,
    (i) => (i.performed_at ? formatDate(i.performed_at) : ''));
  makeSection('nav.waste', 'waste', waste, (i) => `/waste?type=${i.id}`);



  window.lucide?.createIcons({ el: container });

  return total;
}





function mountExtensionPage(wrapper, thirdPartyModule) {
  const page = thirdPartyModule?.page || {};
  const mode = COMPOSITION_MODES.includes(page.composition) ? page.composition : 'reading';
  const root = document.createElement('div');
  root.className = `app-page app-page--${mode} extension-page`;
  root.dataset.composition = mode;
  if (page.width) root.dataset.pageWidth = String(page.width);
  wrapper.appendChild(root);
  return root;
}

function applyModuleReadonly(moduleName, pageWrapper) {
  const readOnly = navModuleAccess(moduleName) === 'read';
  document.documentElement.toggleAttribute('data-module-readonly', readOnly);
  if (!readOnly || !pageWrapper || pageWrapper.querySelector('.module-readonly-banner')) return;
  const banner = document.createElement('div');
  banner.className = 'module-readonly-banner';
  banner.setAttribute('role', 'status');
  banner.insertAdjacentHTML(
    'afterbegin',
    `<i data-lucide="eye" aria-hidden="true"></i><span>${esc(t('settings.permReadOnlyBanner'))}</span>`,
  );
  pageWrapper.insertBefore(banner, pageWrapper.firstChild);
  window.lucide?.createIcons({ el: banner });
}

function navItems({ catalog = false } = {}) {
  if (currentUser?.access_scope === 'split_guest') {
    return [
      { path: '/budget', label: t('splitExpenses.tabLabel'), icon: MODULE_ICON['split-expenses'], module: 'budget' },
    ];
  }
  const withIcon = (item) => ({ ...item, icon: MODULE_ICON[item.module] });
  const baseItems = [
    // Overview
    { path: '/',          label: t('nav.dashboard'), module: 'dashboard', section: NAV_SECTION.overview },
    // Plan
    { path: '/calendar',  label: t('nav.calendar'),  module: 'calendar',  section: NAV_SECTION.plan },
    { path: '/schedule',  label: t('nav.schedule'),  module: 'schedule',  section: NAV_SECTION.plan },
    { path: '/tasks',     label: t('nav.tasks'),     module: 'tasks',     section: NAV_SECTION.plan },
    { path: '/notes',     label: t('nav.notes'),     module: 'notes',     section: NAV_SECTION.plan },

    { path: '/meals',     label: t('nav.meals'),     module: 'meals',    section: NAV_SECTION.household, kitchenGroup: true },
    { path: '/recipes',   label: t('nav.recipes'),   module: 'recipes',  section: NAV_SECTION.household, kitchenGroup: true },
    { path: '/shopping',  label: t('nav.shopping'),  module: 'shopping', section: NAV_SECTION.household, kitchenGroup: true },
    { path: '/pantry',    label: t('nav.pantry'),    module: 'pantry',   section: NAV_SECTION.household, kitchenGroup: true },
    { path: '/housekeeping', label: t('nav.housekeeping'), module: 'housekeeping', section: NAV_SECTION.household },
    { path: '/waste',     label: t('nav.waste'),     module: 'waste',    section: NAV_SECTION.household },
    { path: '/documents', label: t('nav.documents'), module: 'documents',   section: NAV_SECTION.household },
    { path: '/inventory', label: t('nav.inventory'), module: 'inventory',   section: NAV_SECTION.household },
    { path: '/rewards',   label: t('nav.rewards'),   module: 'rewards',     section: NAV_SECTION.household },
    // Menschen
    { path: '/contacts',  label: t('nav.contacts'),  module: 'contacts',    section: NAV_SECTION.people },
    { path: '/birthdays', label: t('nav.birthdays'), module: 'birthdays',   section: NAV_SECTION.people },
    { path: '/health',    label: t('nav.health'),    module: 'health',      section: NAV_SECTION.people },
    // Finanzen
    { path: '/budget',    label: t('nav.budget'),    module: 'budget',      section: NAV_SECTION.finance },
    // Settings ist am Ende gepinnt (siehe unten).
    { path: '/settings',  navHref: '/settings?view=domains', label: t('nav.settings'),  module: 'settings',    section: NAV_SECTION.household },
  ].map(withIcon);
  const thirdPartyItems = _thirdPartyModules
    .filter((module) => module.enabled && module.status === 'enabled' && module.menu?.show && module.route?.path)
    .map((module) => ({
      path: module.route.path,
      label: moduleDisplayLabel(module),
      icon: module.menu.icon || module.icon || 'box',
      module: `third-party-${module.id}`,
      accent: module.accent,
      order: module.menu.order ?? 1000,
      orderId: `third-party-${module.id}`,
      section: NAV_SECTION.customModules,
    }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  const settings = baseItems.find((item) => item.module === 'settings');
  const all = [...baseItems, ...thirdPartyItems];
  if (catalog) return all;
  const sortable = [
    ...baseItems.filter((item) =>
      item.module !== 'settings'
      && !_disabledModules.has(item.module)
      && !_hiddenModules.has(item.module)
      && canAccessNavModule(item.module)),
    ...thirdPartyItems,
  ];
  const ordered = sortNavigationItems(sortable, _moduleOrder);
  return settings ? [...ordered, settings] : ordered;
}

function navCatalog() {
  return navItems({ catalog: true });
}

function currentKitchenDestination() {
  const kitchenItems = navItems().filter((item) => item.kitchenGroup);
  return kitchenItems.find((item) => item.path === getLastKitchenRoute()) ?? kitchenItems[0] ?? null;
}

function mobileNavigationCandidates() {
  const candidates = [];
  let kitchenAdded = false;

  for (const item of navItems()) {
    if (item.module === 'dashboard' || item.module === 'settings') continue;
    if (item.kitchenGroup) {
      if (!kitchenAdded) {
        const kitchen = currentKitchenDestination();
        if (kitchen) {
          candidates.push({
            ...kitchen,
            label: t('nav.kitchen'),
            icon: MODULE_ICON.kitchen,
            navId: 'kitchen',
          });
        }
        kitchenAdded = true;
      }
      continue;
    }
    candidates.push({ ...item, navId: item.module });
  }

  return candidates;
}

function mobileFavoriteItems() {
  const candidates = mobileNavigationCandidates();
  const byId = new Map(candidates.map((item) => [item.navId, item]));
  const selectedIds = resolveMobileNavOrder(_mobileNavOrder, [...byId.keys()])
    .slice(0, MOBILE_FAVORITE_COUNT);
  return selectedIds.map((id) => byId.get(id)).filter(Boolean);
}

function secondaryMobileItems() {
  const favoriteIds = new Set(mobileFavoriteItems().map((item) => item.navId));
  const settings = navItems().find((item) => item.module === 'settings');
  return [
    ...mobileNavigationCandidates().filter((item) => !favoriteIds.has(item.navId)),
    ...(settings ? [{ ...settings, navId: settings.module }] : []),
  ];
}

function sidebarNavItems() {
  const elements = [];
  // Zwei entkoppelte Elemente hinter den Nav-Items (z-index: 0):
  // 1. Die persistente Aktiv-Pille bleibt am aktiven Item verankert â€” sie wandert



  const indicator = document.createElement('div');
  indicator.className = 'nav-sidebar__indicator';
  indicator.setAttribute('aria-hidden', 'true');
  elements.push(indicator);

  const hover = document.createElement('div');
  hover.className = 'nav-sidebar__hover';
  hover.setAttribute('aria-hidden', 'true');
  elements.push(hover);

  let kitchenAdded = false;
  let currentSection = null;
  let currentGroup = null;




  const HEADERLESS_SECTIONS = new Set([NAV_SECTION.overview]);



  // Label-Divs zwischen Links). Items landen im aktuellen Gruppen-Container.
  const startSection = (section) => {
    if (section === currentSection) return;
    currentSection = section;
    if (HEADERLESS_SECTIONS.has(section)) { currentGroup = null; return; }
    const labelKey = NAV_SECTION_LABEL_KEYS[section];
    if (!labelKey) { currentGroup = null; return; }
    const labelId = `nav-section-${section}`;
    const label = document.createElement('div');
    label.className = 'nav-section-label';
    label.id = labelId;
    label.textContent = t(labelKey);
    const group = document.createElement('div');
    group.className = 'nav-sidebar__group';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-labelledby', labelId);
    group.appendChild(label);
    elements.push(group);
    currentGroup = group;
  };

  const appendNavEl = (el) => {
    (currentGroup ?? { appendChild: (n) => elements.push(n) }).appendChild(el);
  };

  navItems().forEach((item) => {



    if (item.module !== 'settings') startSection(item.section);

    if (item.kitchenGroup) {
      if (!kitchenAdded) {
        appendNavEl(sidebarKitchenEl());
        kitchenAdded = true;
      }
      return;
    }
    const el = navItemEl(item);
    if (item.module === 'settings') {



      el.classList.add('nav-item--pinned-end');
      elements.push(el);
      return;
    }
    appendNavEl(el);
  });
  return elements;
}

function isModuleDisabled(moduleName) {
  return _disabledModules.has(moduleName);
}

function applySidebarCollapsed(collapsed) {
  document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
  if (!collapsed) {
    document.documentElement.classList.remove('sidebar-collapse-pointer-lock');
  }
}

function setHiddenModules(modules) {
  _hiddenModules = new Set(Array.isArray(modules) ? modules : []);


  // Einkaufszaehler gilt, entscheidet `navItems()`.
  resetModuleCounts();
  rebuildNavigation();
}

function setDisabledModules(modules) {
  _disabledModules = new Set(Array.isArray(modules) ? modules : []);
  resetModuleCounts();
  rebuildNavigation();
}

function setModuleOrder(order) {
  _moduleOrder = Array.isArray(order) ? order : [];
  rebuildNavigation();
}

function setMobileNavOrder(order) {
  _mobileNavOrder = Array.isArray(order) ? order : [];
  rebuildNavigation();
}

async function refreshThirdPartyModules() {
  await syncThirdPartyModules();
  rebuildNavigation();
}

async function disableFailedThirdPartyModule(moduleId) {
  if (!moduleId) return;
  try {
    await api.patch(`/modules/${encodeURIComponent(moduleId)}`, { enabled: false });
    // Only remove locally if admin successfully disabled it
    _thirdPartyModules = _thirdPartyModules.filter((module) => module.id !== moduleId);
    rebuildNavigation();
  } catch (err) {
    // Non-admins cannot disable modules; keep module visible
    // For actual failures (not 403), still remove from local state to avoid broken UI
    if (err?.status !== 403) {
      _thirdPartyModules = _thirdPartyModules.filter((module) => module.id !== moduleId);
      rebuildNavigation();
    }
  }
}


function navItemEl({ path, navHref, label, icon, module: mod, accent, navId }) {
  const a = document.createElement('a');
  a.href = navHref ?? path;
  a.dataset.route = path;
  a.dataset.navId = navId ?? mod;
  if (navHref) a.dataset.navHref = navHref;
  a.className = 'nav-item';
  a.setAttribute('aria-label', label);
  a.setAttribute('title', label);
  if (accent) a.style.setProperty('--item-module-accent', accent);
  else if (mod) a.style.setProperty('--item-module-accent', moduleAccentVar(mod));
  const iconWrap = document.createElement('div');
  iconWrap.className = 'nav-item__icon-wrap';
  const well = document.createElement('div');
  well.className = 'nav-item__icon-well';
  well.appendChild(moduleIconEl(icon, 'nav-item__icon'));
  iconWrap.appendChild(well);
  const span = document.createElement('span');
  span.className = 'nav-item__label';
  span.textContent = label;
  a.appendChild(iconWrap);
  a.appendChild(span);
  return a;
}

function kitchenNavButtonEl() {
  const kitchenBtn = document.createElement('button');
  kitchenBtn.className = 'nav-item nav-item--kitchen';
  kitchenBtn.id = 'kitchen-btn';
  kitchenBtn.type = 'button';
  kitchenBtn.dataset.navId = 'kitchen';


  // verlassen hat (Critique 2026-07-29).
  kitchenBtn.style.setProperty('--item-module-accent', 'var(--module-kitchen)');
  kitchenBtn.setAttribute('aria-label', t('nav.kitchen'));
  kitchenBtn.setAttribute('title', t('nav.kitchen'));

  const iconWrap = document.createElement('div');
  iconWrap.className = 'nav-item__icon-wrap';
  const well = document.createElement('div');
  well.className = 'nav-item__icon-well';
  well.appendChild(moduleIconEl(MODULE_ICON.kitchen, 'nav-item__icon'));
  iconWrap.appendChild(well);

  const label = document.createElement('span');
  label.className = 'nav-item__label';
  label.textContent = t('nav.kitchen');
  kitchenBtn.append(iconWrap, label);
  kitchenBtn.addEventListener('click', () => {
    const destination = currentKitchenDestination();
    if (destination) navigate(destination.path);
  });
  return kitchenBtn;
}

function moreNavButtonEl() {
  const moreBtn = document.createElement('button');
  moreBtn.className = 'nav-item nav-item--more';
  moreBtn.id = 'more-btn';
  moreBtn.type = 'button';






  moreBtn.setAttribute('aria-label', t('nav.more'));
  moreBtn.setAttribute('title', t('nav.more'));

  // aria-expanded/-controls spiegeln den Offen-Zustand (Audit P3, Sam-Persona).
  moreBtn.setAttribute('aria-haspopup', 'dialog');
  moreBtn.setAttribute('aria-expanded', 'false');
  moreBtn.setAttribute('aria-controls', 'more-sheet');

  const iconWrap = document.createElement('div');
  iconWrap.className = 'nav-item__icon-wrap';
  const well = document.createElement('div');
  well.className = 'nav-item__icon-well';
  well.appendChild(moduleIconEl('more-horizontal', 'nav-item__icon'));
  iconWrap.appendChild(well);

  const label = document.createElement('span');
  label.className = 'nav-item__label';
  label.textContent = t('nav.more');
  moreBtn.append(iconWrap, label);
  return moreBtn;
}

function mobileDestinationEl(item) {
  return item.navId === 'kitchen' ? kitchenNavButtonEl() : navItemEl(item);
}

function buildBottomNavItems(moreBtn = moreNavButtonEl()) {
  const dashboard = navItems().find((item) => item.module === 'dashboard');
  return [
    ...(dashboard ? [navItemEl({ ...dashboard, navId: 'dashboard' })] : []),
    ...mobileFavoriteItems().map(mobileDestinationEl),
    moreBtn,
  ];
}

function replaceLucideIcon(container, selector, iconName) {
  const current = container.querySelector(selector);
  if (!current) return;
  const next = document.createElement('i');
  next.dataset.lucide = iconName;
  const classes = (current.getAttribute('class') || '')
    .split(/\s+/)
    .filter((className) => className && className !== 'lucide' && !className.startsWith('lucide-'));
  next.className = classes.join(' ') || 'nav-item__icon';
  next.setAttribute('aria-hidden', 'true');
  current.replaceWith(next);
  if (window.lucide) window.lucide.createIcons({ el: container });
}

function replaceNavIcon(container, selector, lucideIconName) {
  const current = container.querySelector(selector);
  if (!current) return;
  const iconFactory = NAV_ICONS[lucideIconName];
  if (iconFactory) {
    const classes = (current.getAttribute('class') || '')
      .split(/\s+/)
      .filter((cls) => cls && cls !== 'lucide' && !cls.startsWith('lucide-'));
    const svg = iconFactory();
    svg.className.baseVal = classes.join(' ') || 'nav-item__icon';
    current.replaceWith(svg);
  } else {
    replaceLucideIcon(container, selector, lucideIconName);
  }
}

function positionSidebarIndicator() {
  const container = document.querySelector('.nav-sidebar__items');
  const indicator = container?.querySelector('.nav-sidebar__indicator');
  if (!indicator) return;
  const active = container.querySelector('.nav-item[aria-current="page"]');
  if (!active) {
    indicator.style.opacity = '0';
    return;
  }


  // Navigation verlor ihren â€žDu bist hier"-Anker. Manuelles Scrollen statt



  const margin = 8;
  const top = active.offsetTop;
  const bottom = top + active.offsetHeight;
  if (top < container.scrollTop + margin) {
    container.scrollTop = Math.max(0, top - margin);
  } else if (bottom > container.scrollTop + container.clientHeight - margin) {
    container.scrollTop = bottom - container.clientHeight + margin;
  }


  const centerOffset = (active.offsetHeight - indicator.getBoundingClientRect().height) / 2;
  indicator.style.transform = `translateY(${top + centerOffset}px)`;
  indicator.style.opacity = '';
}





const TAB_INDICATOR_INSET = 4;
const TAB_INDICATOR_MAX_WIDTH = 64;

function positionTabIndicator() {
  const nav = document.querySelector('.nav-bottom');
  const indicator = nav?.querySelector('.nav-bottom__indicator');
  if (!indicator || !nav) return;
  const active = document.querySelector(
    '.nav-bottom__items .nav-item[aria-current="page"], .nav-bottom__items .nav-item--active',
  );
  if (!active) {
    indicator.style.opacity = '0';
    return;
  }
  const nr = nav.getBoundingClientRect();
  const ar = active.getBoundingClientRect();
  const well = active.querySelector('.nav-item__icon-well');
  const wr = well ? well.getBoundingClientRect() : ar;
  const width = Math.max(
    wr.width,
    Math.min(ar.width - TAB_INDICATOR_INSET * 2, TAB_INDICATOR_MAX_WIDTH),
  );


  const top = wr.top - nr.top - nav.clientTop;
  const left = ar.left - nr.left + (ar.width - width) / 2;
  indicator.style.width = `${width}px`;
  indicator.style.height = `${wr.height}px`;
  indicator.style.transform = `translate(${left}px, ${top}px)`;
  indicator.style.opacity = '';
}

function sidebarKitchenEl() {
  const item = {
    path: getLastKitchenRoute(),
    label: t('nav.kitchen'),
    icon: MODULE_ICON.kitchen,
    module: navItems().find((n) => n.path === getLastKitchenRoute())?.module || 'meals',
    navId: 'kitchen',
  };
  const a = navItemEl(item);
  a.id = 'sidebar-kitchen-nav';
  a.setAttribute('aria-label', kitchenNavAriaLabel(currentPath));
  a.setAttribute('title', t('nav.kitchen'));
  return a;
}

function moreItemEl({ path, navHref, label, icon, module: mod, accent, navId }) {
  const a = document.createElement('a');
  a.href = navHref ?? path;
  a.dataset.route = path;
  a.dataset.navId = navId ?? mod;
  if (navHref) a.dataset.navHref = navHref;
  a.className = 'more-item';
  if (accent) a.style.setProperty('--item-module-accent', accent);
  else if (mod) a.style.setProperty('--item-module-accent', moduleAccentVar(mod));
  const well = document.createElement('div');


  well.className = 'module-seal more-item__icon-well';
  well.appendChild(moduleIconEl(icon, 'more-item__icon'));
  const span = document.createElement('span');
  span.className = 'more-item__label';
  span.textContent = label;
  a.appendChild(well);
  a.appendChild(span);



  // Zugabe, kein Bestandteil.
  const count = _moduleCounts[navId ?? mod];
  if (count > 0) {
    a.appendChild(moreBadgeEl(count));
    a.setAttribute('aria-label', `${label}, ${t('nav.moreBadge', { count })}`);
  }
  return a;
}

function moreBadgeEl(count) {
  const badge = document.createElement('span');
  badge.className = 'more-item__badge';
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.setAttribute('aria-hidden', 'true');
  return badge;
}

function kitchenSectionLabel(path) {
  const kitchenItems = navItems().filter((i) => i.kitchenGroup);
  const targetRoute = isKitchenRoute(path) ? path : getLastKitchenRoute();
  return kitchenItems.find((i) => i.path === targetRoute)?.label ?? t('nav.meals');
}

function kitchenNavAriaLabel(path) {
  if (isKitchenRoute(path)) {
    return t('nav.kitchenActiveLabel', { section: kitchenSectionLabel(path) });
  }



  return t('nav.kitchenGoLabel', { section: kitchenSectionLabel(path) });
}

function setMoreButtonState(moreBtn, activeSecondary) {
  const inMoreSheet = !!activeSecondary;
  const moreLabel = activeSecondary
    ? t('nav.moreActiveLabel', { section: activeSecondary.label })
    : t('nav.more');

  moreBtn.classList.toggle('nav-item--active', inMoreSheet);
  if (inMoreSheet) {
    moreBtn.setAttribute('aria-current', 'page');
    if (activeSecondary.accent) {
      moreBtn.style.setProperty('--item-module-accent', activeSecondary.accent);
    } else if (activeSecondary.module) {
      moreBtn.style.setProperty('--item-module-accent', moduleAccentVar(activeSecondary.module));
    }
  } else {
    moreBtn.removeAttribute('aria-current');
    moreBtn.style.setProperty('--item-module-accent', 'var(--color-accent)');
  }



  moreBtn.setAttribute('aria-label', withUpdateHint(moreLabel, pendingUpdateVersion()));
  moreBtn.setAttribute('title', t('nav.more'));

  const moreBtnLabel = moreBtn.querySelector('.nav-item__label');
  if (moreBtnLabel) moreBtnLabel.textContent = t('nav.more');
  replaceNavIcon(moreBtn, '.nav-item__icon', 'more-horizontal');
}

function updateNav(path) {
  const kitchenDestination = currentKitchenDestination();
  document.querySelectorAll('[data-route]').forEach((el) => {
    if (el.dataset.navId === 'kitchen' && kitchenDestination) {
      el.dataset.route = kitchenDestination.path;
      if (el.tagName === 'A') el.href = kitchenDestination.path;
    }
    el.removeAttribute('aria-current');
    const isActiveKitchenDestination = el.dataset.navId === 'kitchen' && isKitchenRoute(path);
    if (el.dataset.route === path || isActiveKitchenDestination) {
      el.setAttribute('aria-current', 'page');
    }
  });

  const kitchenNavBtn = document.querySelector('#kitchen-btn');
  if (kitchenNavBtn) {
    const isKitchen = isKitchenRoute(path);
    kitchenNavBtn.classList.toggle('nav-item--active', isKitchen);


    if (isKitchen) {
      kitchenNavBtn.setAttribute('aria-current', 'page');
    } else {
      kitchenNavBtn.removeAttribute('aria-current');
    }

    const kitchenBtnLabel = kitchenNavBtn.querySelector('.nav-item__label');
    if (kitchenBtnLabel) kitchenBtnLabel.textContent = t('nav.kitchen');
    kitchenNavBtn.setAttribute('aria-label', kitchenNavAriaLabel(path));
    kitchenNavBtn.setAttribute('title', t('nav.kitchen'));
  }

  const sidebarKitchenNav = document.querySelector('#sidebar-kitchen-nav');
  if (sidebarKitchenNav) {
    const isKitchen = isKitchenRoute(path);
    if (isKitchen) {
      sidebarKitchenNav.setAttribute('aria-current', 'page');
    } else {
      sidebarKitchenNav.removeAttribute('aria-current');
    }
    sidebarKitchenNav.setAttribute('aria-label', kitchenNavAriaLabel(path));
    sidebarKitchenNav.setAttribute('title', t('nav.kitchen'));
  }

  const moreBtn = document.querySelector('#more-btn');
  if (moreBtn) {
    const activeSecondary = secondaryMobileItems().find((item) => (
      item.navId === 'kitchen' ? isKitchenRoute(path) : item.path === path
    ));
    setMoreButtonState(moreBtn, activeSecondary);
  }

  if (window.lucide) {
    const navRoot = document.getElementById('app');
    window.lucide.createIcons(navRoot ? { el: navRoot } : undefined);
  }

  requestAnimationFrame(() => {
    positionSidebarIndicator();
    positionTabIndicator();
  });
}

function renderError(container, err) {




  //




  const state = emptyStateEl({
    variant: 'error',
    title: t('common.errorOccurred'),
    description: friendlyError(err),
    details: { summary: t('common.errorDetails'), text: errorDetails(err) },
    action: {
      label: t('common.reload'),
      attrs: { id: 'error-reload-btn' },
      onClick: () => location.reload(),
    },
  });


  state.tabIndex = -1;

  container.replaceChildren(state);
  if (window.lucide) window.lucide.createIcons({ el: state });
  state.focus({ preventScroll: true });
}

function errorDetails(err) {
  if (!err) return '';
  const head = [err.name, err.message].filter(Boolean).join(': ');
  const stack = typeof err.stack === 'string' ? err.stack.trim() : '';
  // Manche Engines wiederholen "Name: Message" als erste Stack-Zeile.
  if (stack) return stack.startsWith(head) ? stack : `${head}\n${stack}`;
  return head || String(err);
}

// --------------------------------------------------------
// Toast-Benachrichtigungen (global)
// --------------------------------------------------------

/**
 * Zeigt eine Toast-Benachrichtigung an.
 * @param {string} message
 * @param {'default'|'success'|'danger'|'warning'} type
 * @param {number} duration - ms
 */
const TOAST_SUCCESS_KEY = 'aashiyana:toastSuccessCount';
const TOAST_SUCCESS_MAX = 50;

function _toastSvg(children) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'toast__icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of children) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}

const TOAST_ICONS = {
  success: () => _toastSvg([['polyline', { points: '20 6 9 17 4 12' }]]),
  danger:  () => _toastSvg([
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['line',   { x1: '12', y1: '8',  x2: '12',   y2: '12' }],
    ['line',   { x1: '12', y1: '16', x2: '12.01', y2: '16' }],
  ]),
  warning: () => _toastSvg([
    ['path', { d: 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z' }],
    ['line', { x1: '12', y1: '9',  x2: '12',   y2: '13' }],
    ['line', { x1: '12', y1: '17', x2: '12.01', y2: '17' }],
  ]),
};

function showToast(message, type = 'default', duration = 3000, onUndo = null) {
  const container = toastSurface((type === 'danger' || type === 'warning') ? 'assertive' : 'polite');
  if (!container) return;

  // Aktions-Button: Legacy-Undo (Funktion) oder benannte Aktion ({ label, onClick }).
  const action = typeof onUndo === 'function'
    ? { label: t('common.undo'), onClick: onUndo }
    : (onUndo && typeof onUndo.onClick === 'function' ? onUndo : null);



  if (type === 'success' && !action) {
    const successCount = parseInt(localStorage.getItem(TOAST_SUCCESS_KEY) ?? '0', 10) + 1;
    localStorage.setItem(TOAST_SUCCESS_KEY, String(successCount));
    if (successCount > TOAST_SUCCESS_MAX) return;
  }


  const existing = document.querySelectorAll('.toast-container .toast');
  if (existing.length >= 3) existing[0].remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type !== 'default' ? `toast--${type}` : ''}`;
  toast.setAttribute('role', 'alert');

  const iconEl = TOAST_ICONS[type]?.();
  if (iconEl) toast.appendChild(iconEl);
  const span = document.createElement('span');
  span.textContent = message;
  toast.appendChild(span);

  if (action) {
    const actionBtn = document.createElement('button');
    actionBtn.className = 'toast__undo';
    actionBtn.textContent = action.label;
    actionBtn.addEventListener('click', () => {
      clearTimeout(dismissTimer);
      toast.remove();
      action.onClick();
    });
    toast.appendChild(actionBtn);
  }

  container.appendChild(toast);
  const dismiss = () => {
    clearTimeout(dismissTimer);
    toast.classList.add('toast--out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  const dismissTimer = setTimeout(dismiss, duration);



  // `touch-action: pan-y` auf `.toast`.
  wireSwipeToDismiss(toast, { onDismiss: dismiss });
}

// --------------------------------------------------------
// Event-Listener
// --------------------------------------------------------

// --------------------------------------------------------
// Fehler-Hilfsfunktion
// --------------------------------------------------------

function friendlyError(err) {


  if (err?.status === 0) return t('common.errorOfflineMutation');
  if (!navigator.onLine) return t('common.errorOffline');
  const status = err?.status ?? err?.response?.status;
  if (status === 403) return t('common.errorForbidden');
  if (status === 404) return t('common.errorNotFound');
  if (status >= 500) return t('common.errorServer');
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return t('common.errorTimeout');
  if (/Failed to fetch|NetworkError|Load failed/i.test(err?.message || '')) return t('common.errorServer');
  if (err?.name === 'TypeError') return t('common.unexpectedError');
  return err?.data?.error || err?.message || t('common.errorGeneric');
}

// --------------------------------------------------------
// Globale Fehler-Handler (Error Boundary)
// --------------------------------------------------------

const RESIZE_OBSERVER_NOTICE = /^ResizeObserver loop/;

window.addEventListener('error', (e) => {
  // Ressource-Ladefehler (z.B. fehlgeschlagenes Bild): ignorieren
  if (e.target && e.target !== window) return;
  if (RESIZE_OBSERVER_NOTICE.test(e.message || '')) return;
  console.error('[Aashiyana] Unbehandelter Fehler:', e.error ?? e.message);
  showToast(t('common.unexpectedError'), 'danger');
});

window.addEventListener('unhandledrejection', (e) => {

  if (e.reason?.status === 401) return;
  console.error('[Aashiyana] Unbehandeltes Promise-Rejection:', e.reason);
  showToast(friendlyError(e.reason), 'danger');
  e.preventDefault();
});

// SW-Update: neue Version im Hintergrund installiert â†’ Toast anzeigen
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'SW_UPDATED') {





      shellStale = true;
      showToast(t('common.updateAvailable'), 'default', 8000);
      setTimeout(() => location.reload(), 8000);
    }
  });
}


//




//



// beantwortet die Frage erst danach.
window.addEventListener('popstate', (e) => {
  const target = e.state?.path || location.pathname;
  handleBackNavigation().then((handled) => {
    if (!handled) navigate(target, false);
  });
});

function forgetSessionState() {
  currentUser = null;
  _preferencesLoaded = false;
  _hiddenModules = new Set();
  _moduleOrder = [];
  _mobileNavOrder = [];


  clearApiCache();


  forgetLayoutHint();


  forgetScrollPositions();

  resetModuleCounts();

  resetNavBadges();



  // Anmeldeseite stehen.
  closeAllOverlays();
  stopThirdPartyModulePolling();
  stopReminders();
  stopPush();
}

// Session abgelaufen
window.addEventListener('auth:expired', () => {
  forgetSessionState();
  if (isNavigating) {

    // der laufenden Navigation nachgeholt.
    _pendingLoginRedirect = true;
  } else {
    navigate('/login');
  }
});



function dropBadgesForRemovedRoutes() {
  for (const route of navBadgeRoutes()) {
    if (!document.querySelector(`.nav-sidebar [data-route="${route}"], .nav-bottom [data-route="${route}"]`)) {
      setNavBadge(route, 0);
    }
  }
}

function rebuildNavigation({ updateLabels = true } = {}) {
  const skipLink     = document.querySelector('.sr-only[href="#main-content"]');
  const navSidebar   = document.querySelector('.nav-sidebar');
  const navSidebarItems = document.querySelector('.nav-sidebar__items');
  const navBottom    = document.querySelector('.nav-bottom');
  const bottomItems  = document.querySelector('.nav-bottom__items');
  const moreSheet    = document.querySelector('#more-sheet');
  const moreBtnLabel = document.querySelector('#more-btn .nav-item__label');

  if (updateLabels) {
    if (skipLink)     skipLink.textContent = t('common.skipToContent');
    if (navSidebar)   navSidebar.setAttribute('aria-label', t('nav.main'));
    if (navBottom)    navBottom.setAttribute('aria-label', t('nav.navigation'));
    if (moreBtnLabel) moreBtnLabel.textContent = t('nav.more');
  }

  if (navSidebarItems) {
    // replaceChildren recria toda a Ã¡rvore da navegaÃ§Ã£o (por exemplo, apÃ³s
    // replaceChildren baut die Navigation komplett neu (Routenwechsel, Sprache,



    // Springen zwischen erstem und letztem Eintrag.
    const previousScrollTop = navSidebarItems.scrollTop;
    const sidebarEls = sidebarNavItems();
    navSidebarItems.replaceChildren(...sidebarEls);
    if (window.lucide) window.lucide.createIcons({ el: navSidebarItems });
    requestAnimationFrame(() => {
      navSidebarItems.scrollTop = Math.min(
        previousScrollTop,
        Math.max(0, navSidebarItems.scrollHeight - navSidebarItems.clientHeight),
      );
      positionSidebarIndicator();
    });
  }
  if (bottomItems) {
    const moreBtn = bottomItems.querySelector('#more-btn') ?? moreNavButtonEl();
    bottomItems.replaceChildren(...buildBottomNavItems(moreBtn));
    requestAnimationFrame(() => positionTabIndicator());
  }
  if (moreSheet) {
    const handle = moreSheet.querySelector('.more-sheet__handle');
    const searchBar = moreSheet.querySelector('#more-sheet-search');
    if (searchBar) {
      const placeholder = searchBar.querySelector('.more-sheet__search-placeholder');
      if (placeholder) placeholder.textContent = t('search.placeholder');
      searchBar.setAttribute('aria-label', t('search.placeholder'));
    }

    // Funktion neu bauen â€” identisch zu renderAppShell().
    moreSheet.replaceChildren(handle, ...(searchBar ? [searchBar] : []), ...buildMoreSheetBody());
    if (window.lucide) window.lucide.createIcons({ el: moreSheet });
  }

  document.querySelectorAll('[data-route]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(el.dataset.navHref ?? el.dataset.route);
    });
  });

  updateNav(currentPath);
  updateBranding(currentPath || '/');


  applyUpdateBadge();



  // nie.
  applyNavBadges();

  dropBadgesForRemovedRoutes();
}


window.addEventListener('locale-changed', () => {
  rebuildNavigation();
  refreshCurrentRoute();
});

window.addEventListener('app-name-changed', () => {
  updateBranding(currentPath || '/');
});

function refreshCurrentRoute() {
  if (!currentPath) return;
  setTimeout(() => {
    if (!currentPath) return;
    navigate(currentPath, false);
  }, 0);
}

window.addEventListener('date-format-changed', refreshCurrentRoute);


window.addEventListener('timezone-changed', refreshCurrentRoute);
window.addEventListener('time-format-changed', refreshCurrentRoute);

window.addEventListener('resize', () => {
  positionSidebarIndicator();
  positionTabIndicator();
}, { passive: true });

function observeNavCapsule() {
  if (typeof ResizeObserver !== 'function') return;
  const items = document.querySelector('.nav-bottom__items');
  if (!items || items.dataset.indicatorObserved === '1') return;
  items.dataset.indicatorObserved = '1';
  new ResizeObserver(() => requestAnimationFrame(() => positionTabIndicator())).observe(items);
}
observeNavCapsule();

// --------------------------------------------------------
// Virtuelle Tastatur: FAB ausblenden, solange sie offen ist.

// keine virtuelle Tastatur.
//









//






// --------------------------------------------------------

const NON_TEXT_INPUT_TYPES = new Set([
  'button', 'checkbox', 'color', 'date', 'datetime-local', 'file', 'hidden',
  'image', 'month', 'radio', 'range', 'reset', 'submit', 'time', 'week',
]);

function isTextEntry(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return !NON_TEXT_INPUT_TYPES.has(el.type);
}

function syncKeyboardVisible() {
  const focused = isTextEntry(document.activeElement);
  const vv = window.visualViewport;

  const shrunk = !vv || vv.height < window.innerHeight * 0.75;
  document.body.classList.toggle('keyboard-visible', focused && shrunk);
}

// `focusout` feuert, bevor der neue Fokus steht - erst danach messen, sonst

//




let keyboardSyncTimer = 0;
function scheduleKeyboardSync() {
  if (keyboardSyncTimer) return;
  keyboardSyncTimer = setTimeout(() => {
    keyboardSyncTimer = 0;
    syncKeyboardVisible();
  }, 0);
}

document.addEventListener('focusin', scheduleKeyboardSync);
document.addEventListener('focusout', scheduleKeyboardSync);


window.visualViewport?.addEventListener('resize', syncKeyboardVisible);

// --------------------------------------------------------
// iOS PWA: Viewport-Zoom bei Tastatur-Erscheinen verhindern.



//



// --------------------------------------------------------
if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
  const metaViewport = document.querySelector('meta[name="viewport"]');
  if (metaViewport) {
    const originalContent = metaViewport.getAttribute('content');
    const noZoomContent = originalContent.replace(/maximum-scale=\d+/, 'maximum-scale=1');

    document.addEventListener('focusin', ({ target }) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        metaViewport.setAttribute('content', noZoomContent);
      }
    });

    document.addEventListener('focusout', ({ target }) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {


        setTimeout(() => metaViewport.setAttribute('content', originalContent), 150);
      }
    });
  }
}

// --------------------------------------------------------
// Initialisierung
// --------------------------------------------------------
(async () => {
  try {

    const stored = localStorage.getItem('aashiyana-theme');
    if (stored === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (stored === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }

    // Theme â€žAutomatisch" (kein data-theme) folgt prefers-color-scheme rein per






    darkSchemeQuery?.addEventListener?.('change', () => {
      applyModuleAccentForRoute(currentRoute());
      refreshThemeColorForTheme();
    });

    await initI18n();
    initExtensionI18n();
    try {
      const v = await api.get('/version');
      _setupRequired = v?.setup_required === true;
      if (v?.version) setAppVersion(v.version);
      if (v?.app_name) setAppName(v.app_name);
    } catch {
      _setupRequired = false; // Fail-safe: kein Setup erzwingen
    }
    navigate(location.pathname, false);
  } catch (err) {
    console.error('[Router] Initialisierung fehlgeschlagen:', err);
    const loading = document.getElementById('app-loading');
    if (loading) loading.hidden = true;
    renderError(document.getElementById('app'), err);
  }
})();

// Globale Exporte
window.aashiyana = {
  navigate,
  showToast,
  friendlyError,
  setThemeColor,
  setDisabledModules,
  setHiddenModules,
  setModuleOrder,
  setMobileNavOrder,
  refreshThirdPartyModules,
  isModuleDisabled,

  // Begruendung an `invalidateModuleCounts`.
  invalidateModuleCounts,

  // zweites Mal holen zu lassen. Begruendung an `primeModuleCountsFrom`.
  primeModuleCountsFrom,
  applyTheme: (value) => {
    if (value === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (value === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }




    applyModuleAccentForRoute(currentRoute());

    // Momentaufnahme, siehe refreshThemeColorForTheme.
    refreshThemeColorForTheme();





    // geschrieben, hier geht also nichts verloren.
    try {
      localStorage.setItem('aashiyana-theme', value);
    } catch {

    }
  },
  restoreThemeColor: () => {
    updateThemeColorForRoute(currentRoute());
  },




  clearSession: () => {
    forgetSessionState();
    _navBuiltForUserId = null;
  },
};





window.oikos = window.aashiyana;



