
const APP_RELEASE        = '2.66.1';
const APP_BUILD_REVISION = '__YUVOMI_BUILD_REVISION__';
const CACHE_RELEASE      = `${APP_RELEASE}-${APP_BUILD_REVISION}`;
const SHELL_CACHE        = `aashiyana-shell-${CACHE_RELEASE}`;
const PAGES_CACHE        = `aashiyana-pages-${CACHE_RELEASE}`;
const LOCALES_CACHE      = `aashiyana-locales-${CACHE_RELEASE}`;
const ASSETS_CACHE       = `aashiyana-assets-${CACHE_RELEASE}`;


const API_CACHE     = `aashiyana-api-${CACHE_RELEASE}`;
const BYPASS_CACHE  = 'aashiyana-bypass-flag';
const ALL_CACHES    = [SHELL_CACHE, PAGES_CACHE, LOCALES_CACHE, ASSETS_CACHE];



const API_CACHE_WHITELIST = ['/calendar', '/tasks', '/shopping', '/contacts', '/dashboard'];

const API_CACHE_EXCLUDE = ['/shopping/versions'];


const APP_SHELL = [
  '/',
  '/index.html',
  '/api.js',
  '/lang-init.js',
  '/router.js',
  '/i18n.js',
  '/rrule-ui.js',
  '/reminders.js',
  '/push.js',
  '/sw-register.js',
  '/lucide.min.js',
  '/lucide-scope.js',



  '/styles/tokens.css',
  '/styles/reset.css',
  '/styles/pwa.css',
  '/styles/layout.css',
  '/styles/glass.css',
  '/styles/typography.css',
  '/styles/filter-chip.css',
  '/styles/sub-tabs.css',
  '/styles/page-search.css',
  '/styles/kitchen-tabs.css',
  '/styles/list-row.css',
  '/styles/panel.css',
  '/styles/user-multi-select.css',
  '/styles/datepicker.css',
  '/styles/category-manager.css',
  '/styles/icon-picker.css',
  '/styles/document-attach.css',
  '/styles/auth.css',
  '/styles/reminders.css',
  '/styles/dashboard.css',
  '/styles/tasks.css',
  '/styles/shopping.css',
  '/styles/meals.css',
  '/styles/calendar.css',
  '/styles/schedule.css',
  '/styles/markdown-toolbar.css',
  '/styles/notes.css',
  '/styles/contacts.css',
  '/styles/birthdays.css',
  '/styles/budget.css',
  '/styles/documents.css',
  '/styles/settings.css',
  '/styles/recipes.css',
  '/styles/pantry.css',
  '/styles/inventory.css',
  '/styles/detail-view.css',
  '/styles/screensaver.css',
  '/components/aashiyana-install-prompt.js',





  '/nav-icons.js',
  '/permissions.js',



  '/components/datepicker.js',
  '/components/detail-view.js',
  '/components/document-attach.js',
  '/components/modal.js',
  '/components/photo-screensaver.js',
  '/components/quick-links-manager.js',
  '/components/task-detail.js',
  '/components/user-multi-select.js',
  '/components/wall-timer.js',
  '/utils/birthday-event.js',
  '/utils/bulk-pill.js',
  '/utils/category-labels.js',
  '/utils/chart.js',
  '/utils/color.js',
  '/utils/contact-name.js',
  '/utils/contrast.js',
  '/utils/countdown.js',
  '/utils/dashboard-layout-hint.js',
  '/utils/dashboard-widgets.js',
  '/utils/date.js',
  '/utils/digits.js',
  '/utils/day-label.js',
  '/utils/currency-codes.js',
  '/utils/calendar-delete.js',
  '/utils/document-folder-delete.js',
  '/utils/document-preview.js',
  '/utils/event-color.js',
  '/utils/empty-state.js',
  '/utils/extension-i18n.js',
  '/utils/extension-widgets.js',
  '/utils/fab.js',
  '/utils/folder-upload.js',
  '/utils/folder-tree.js',
  '/utils/health-activity.js',
  '/utils/health-cycle.js',
  '/utils/health-labs.js',
  '/utils/health-meds.js',
  '/utils/health-overview.js',
  '/utils/health-tabs.js',
  '/utils/health-vitals.js',
  '/utils/help.js',
  '/utils/household.js',
  '/utils/html-escape.js',
  '/utils/html.js',
  '/utils/ingredient-row.js',
  '/utils/inventory-warranty.js',
  '/utils/kitchen-tabs.js',
  '/utils/kitchen-transfer.js',
  '/utils/live-feed.js',
  '/utils/markdown-checklist.js',
  '/utils/markdown-toolbar.js',
  '/utils/meal-types.js',
  '/utils/mentions.js',
  '/utils/module-accent.js',
  '/utils/metric-card.js',
  '/utils/money.js',
  '/utils/nav-badges.js',
  '/utils/note-category-filter.js',
  '/utils/note-category-name.js',
  '/utils/note-category-overflow.js',
  '/utils/note-category-picker.js',
  '/utils/overlay-history.js',
  '/utils/page-layout.js',
  '/utils/page-lifecycle.js',
  '/utils/page-search.js',
  '/utils/pantry-locations.js',
  '/utils/pantry-status.js',
  '/utils/pantry-units.js',
  '/utils/permission-group.js',
  '/utils/phone.js',
  '/utils/popover-menu.js',
  '/utils/quick-link-url.js',
  '/utils/pwa-install.js',
  '/utils/recipe-meal-types.js',
  '/utils/recipe-thumb.js',
  '/utils/recipe-to-meal.js',
  '/utils/recurrence-scope.js',
  '/utils/reminder-offset.js',
  '/utils/schedule-tabs.js',
  '/utils/scroll-restore.js',
  '/utils/seal-pair.js',
  '/utils/shopping-categories.js',
  '/utils/skeleton.js',
  '/utils/sub-tabs.js',
  '/utils/swipe-row.js',
  '/utils/sync-target.js',
  '/utils/tablist.js',
  '/utils/task-fields.js',
  '/utils/timezone.js',
  '/utils/toast-surface.js',
  '/utils/ux.js',
  '/utils/vcard.js',
  '/utils/version.js',
  '/utils/upload-limit.js',
  '/utils/wall-mode.js',
  '/utils/web-share.js',
  '/offline.html',
  // offline.html laedt theme-init.js, damit die Huelle dieselbe Farbwelt


  // gebraucht wird - offline.
  '/theme-init.js',
  '/manifest.json',
  '/favicon.ico',
  '/icons/favicon-32.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
];

const APP_LOCALES = [
  '/locales/ar.json',
  '/locales/cs.json',
  '/locales/de.json',
  '/locales/el.json',
  '/locales/en.json',
  '/locales/es.json',
  '/locales/fa.json',
  '/locales/fil.json',
  '/locales/fr.json',
  '/locales/hi.json',
  '/locales/hu.json',
  '/locales/id.json',
  '/locales/it.json',
  '/locales/ja.json',
  '/locales/ko.json',
  '/locales/nl.json',
  '/locales/pl.json',
  '/locales/pt.json',
  '/locales/ru.json',
  '/locales/sv.json',
  '/locales/tr.json',
  '/locales/uk.json',
  '/locales/vi.json',
  '/locales/zh.json',
];







// zusammen hierher, nicht einzeln.
const PAGE_MODULES = [
  '/pages/dashboard.js',
  '/pages/tasks.js',
  '/pages/shopping.js',
  '/pages/meals.js',
  '/pages/calendar.js',
  '/pages/notes.js',
  '/pages/contacts.js',
  '/pages/birthdays.js',
  '/pages/budget.js',
  '/pages/documents.js',
  '/pages/rewards.js',
  '/pages/health.js',
  '/pages/settings.js',
  '/pages/login.js',
  '/pages/recipes.js',
  '/pages/pantry.js',
  '/pages/inventory.js',
  '/pages/budget-plans.js',
  '/pages/budget-stats.js',
  '/pages/split-expenses.js',
  '/pages/subscriptions.js',
  '/components/category-manager.js',
  '/components/icon-picker.js',
  '/components/tag-manager.js',
  '/utils/lucide-icons.js',
  '/utils/sortable.js',
  '/vendor/sortablejs/sortable.esm.min.js',
  // libphonenumber-js: lazy im Kontaktmodul, aber vorab gecacht → Telefon-
  // Formatierung funktioniert auch offline (Kernmodul). Versions-gecacht.
  '/vendor/libphonenumber/core.min.mjs',
  '/vendor/libphonenumber/metadata.min.json',
  '/settings/registry.js',
  '/settings/shell.js',

  // Einstellungsseite offline komplett - der Precache-Guard sah relative

  '/settings/dirty-guard.js',
  '/settings/components.js',
  '/settings/module-order.js',
  '/settings/cron-label.js',
  '/settings/currency.js',
  '/settings/preferences-cache.js',
  '/settings/region-presets.js',
  '/settings/weather-location.js',
  '/settings/family-users.js',
  '/settings/pages/personal-account.js',
  '/settings/pages/admin-email.js',
  '/settings/pages/admin-permissions.js',
  '/settings/pages/personal-calendar-subscriptions.js',
  '/settings/pages/personal-feeds.js',
  '/settings/pages/personal-health.js',
  '/settings/pages/personal-weather.js',
  '/settings/pages/personal-appearance.js',
  '/settings/pages/personal-device.js',
  '/settings/pages/personal-calendar.js',
  '/settings/pages/personal-tasks.js',
  '/settings/pages/modules-active.js',
  '/settings/pages/modules-navigation.js',
  '/settings/pages/modules-kitchen.js',
  '/settings/pages/modules-calendar.js',
  '/settings/pages/modules-options.js',
  '/settings/pages/modules-rewards.js',
  '/settings/pages/modules-countdowns.js',
  '/settings/pages/sync-calendar.js',
  '/settings/pages/sync-contacts.js',
  '/settings/pages/sync-reminders.js',
  '/settings/pages/notifications.js',
  '/settings/pages/documents-storage.js',
  '/settings/pages/documents-dms.js',
  '/settings/pages/admin-family.js',
  '/settings/pages/admin-api.js',
  '/settings/pages/admin-backup.js',
  '/settings/pages/admin-weather.js',
  '/settings/pages/admin-immich.js',
  '/settings/pages/admin-system.js',
];



const PAGE_MODULE_SET = new Set(PAGE_MODULES);

// --------------------------------------------------------
// Bypass-Flag: nach SW-Update einmalig alles frisch vom Netz laden.
// In-Memory-Variable (schnell) + Cache API (SW-Restart-sicher).
// --------------------------------------------------------
let bypassCacheUntil = 0;



let _bypassInitDone = false;
const _bypassInit = (async () => {
  try {
    const c = await caches.open(BYPASS_CACHE);
    const r = await c.match('/active');
    if (r) {
      const until = parseInt(r.headers.get('x-until') || '0');
      if (Date.now() < until) {
        bypassCacheUntil = until;
      } else {
        await c.delete('/active');
      }
    }
  } catch { /* Fehler ignorieren */ }
  _bypassInitDone = true;
})();

// --------------------------------------------------------
// Install: App-Shell + Seiten-Module vorab cachen
// cache: 'reload' umgeht den HTTP-Cache → immer frische Dateien
// --------------------------------------------------------
self.addEventListener('install', (event) => {
  const freshShell   = APP_SHELL.map((url)    => new Request(url, { cache: 'reload' }));
  const freshModules = PAGE_MODULES.map((url) => new Request(url, { cache: 'reload' }));
  const freshLocales = APP_LOCALES.map((url) => new Request(url, { cache: 'reload' }));
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((c) => c.addAll(freshShell)),
      caches.open(PAGES_CACHE).then((c) => c.addAll(freshModules)),
      caches.open(LOCALES_CACHE).then((c) => c.addAll(freshLocales)),
    ]).then(() => self.skipWaiting())
  );
});

// --------------------------------------------------------

// --------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          // Versions-Caches der laufenden Release behalten; alles andere entfernen —


          .filter((key) => !ALL_CACHES.includes(key) && key !== API_CACHE)
          .map((key) => caches.delete(key))
      )
    )
    // Assets-Cache leeren: lazily gecachte Bilder/Icons werden sonst nie erneuert.
    .then(() => caches.delete(ASSETS_CACHE))
    .then(async () => {




      const bypassUntil = Date.now() + 30000;
      bypassCacheUntil = bypassUntil;


      try {
        const c = await caches.open(BYPASS_CACHE);
        await c.put('/active', new Response('1', {
          headers: { 'x-until': String(bypassUntil) },
        }));
      } catch { /* Fehler ignorieren */ }

      self.clients.claim();
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'SW_UPDATED' }));
      });
    })
  );
});

// --------------------------------------------------------
// Fetch: Strategie je nach Request-Typ
// --------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (!url.protocol.startsWith('http')) return;

  // API-Requests: nur GET-Whitelist read-only offline-cachen. Alles andere
  // (Mutationen, /auth/*, Nicht-Whitelist) unangetastet ans Netz durchreichen.
  if (url.pathname.startsWith('/api/')) {
    if (request.method === 'GET' && isCacheableApiGet(url.pathname)) {
      event.respondWith(
        (_bypassInitDone ? Promise.resolve() : _bypassInit).then(() => {


          if (Date.now() < bypassCacheUntil) return fetch(request);
          return networkFirstApi(request);
        })
      );
    }
    return;
  }

  if (request.method !== 'GET') return;


  // damit bypassCacheUntil korrekt gesetzt ist bevor wir entscheiden.
  if (!_bypassInitDone) {
    event.respondWith(
      _bypassInit.then(() => dispatchFetch(request, url))
    );
    return;
  }

  event.respondWith(dispatchFetch(request, url));
});

function dispatchFetch(request, url) {
  // Nach SW-Update: direkt vom Netz, kein SW-Cache, kein HTTP-Cache.

  if (Date.now() < bypassCacheUntil) {
    return fetch(new Request(request, { cache: 'no-cache' })).catch(async () => {
      const cached = await caches.match(request)
        || await caches.match('/index.html')
        || await caches.match('/offline.html');
      return cached || new Response('Offline', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    });
  }


  if (bypassCacheUntil !== 0) {
    bypassCacheUntil = 0;
    caches.open(BYPASS_CACHE).then(c => c.delete('/active')).catch(() => {});
  }

  if (request.mode === 'navigate') {
    return networkFirst(request, SHELL_CACHE);
  }

  if (url.pathname.startsWith('/locales/')) {
    return networkFirst(request, LOCALES_CACHE);
  }



  // (Kategorie-Manager, Sortable-Wrapper samt Vendor-Bundle, libphonenumber) -





  if (
    url.pathname.startsWith('/pages/') ||
    url.pathname.startsWith('/settings/') ||
    PAGE_MODULE_SET.has(url.pathname)
  ) {
    return networkFirst(request, PAGES_CACHE);
  }

  if (url.origin === self.location.origin && isMutableAppResource(url.pathname)) {
    return networkFirst(request, SHELL_CACHE);
  }

  if (isAsset(url.pathname) && url.origin === self.location.origin) {
    return cacheFirst(request, ASSETS_CACHE);
  }

  return cacheFirst(request, SHELL_CACHE);
}

// --------------------------------------------------------

// --------------------------------------------------------
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    const shell = await cache.match('/index.html');
    if (shell) return shell;

    const offline = await caches.match('/offline.html');
    if (offline) return offline;

    return new Response('Keine Verbindung', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

// --------------------------------------------------------


// Netzfehler → Cache-Fallback, sonst 503-JSON {error:'offline'}.
// --------------------------------------------------------
async function networkFirstApi(request) {
  try {
    const response = await fetch(request);

    if (response.ok && response.type === 'basic') {
      const cache   = await caches.open(API_CACHE);
      const cloned  = response.clone();
      const headers = new Headers(cloned.headers);
      headers.set('x-cached-at', String(Date.now()));
      const body = await cloned.blob();
      await cache.put(request, new Response(body, {
        status: cloned.status,
        statusText: cloned.statusText,
        headers,
      }));
    }
    return response;
  } catch {
    const cache  = await caches.open(API_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

// --------------------------------------------------------

// --------------------------------------------------------
async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('', { status: 408 });
  }
}

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------
function isAsset(pathname) {
  return /\.(png|jpg|jpeg|ico|svg|webp|woff2?|gif)$/i.test(pathname);
}

function isMutableAppResource(pathname) {
  return pathname === '/'
    || pathname === '/index.html'
    || pathname === '/manifest.json'
    || /\.(css|js|json|html)$/i.test(pathname);
}



function isCacheableApiGet(pathname) {
  if (!pathname.startsWith('/api/v1')) return false;
  const rest = pathname.slice('/api/v1'.length);




  if (API_CACHE_EXCLUDE.includes(rest)) return false;
  return API_CACHE_WHITELIST.some((p) => rest === p || rest.startsWith(`${p}/`));
}

// --------------------------------------------------------
// Nachrichten vom Client: API-Cache leeren (Logout/Session-Ende)
// --------------------------------------------------------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_API_CACHE') {
    event.waitUntil(caches.delete(API_CACHE));
  }
});

// --------------------------------------------------------
// Web Push
// --------------------------------------------------------
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Aashiyana', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'Aashiyana';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag || 'aashiyana-push',





    data: { url: payload.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if ('focus' in client) {
        client.focus();
        if ('navigate' in client) {
          try { await client.navigate(targetUrl); } catch { /* cross-origin/navigation guard */ }
        }
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(targetUrl);
  })());
});
