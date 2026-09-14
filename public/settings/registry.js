export const SETTINGS_STORAGE_KEY = 'aashiyana:settings:path';
export const LEGACY_SETTINGS_STORAGE_KEY = 'aashiyana:settings:tab';

const freezeEntries = (entries) => Object.freeze(entries.map((entry) => Object.freeze(entry)));

export const SETTINGS_DOMAINS = freezeEntries([
  { id: 'personal', labelKey: 'settings.domainPersonal', icon: 'user', adminOnly: false },
  { id: 'modules', labelKey: 'settings.domainModules', icon: 'layout-grid', adminOnly: true },
  { id: 'sync', labelKey: 'settings.domainSync', icon: 'refresh-cw', adminOnly: true },
  { id: 'admin', labelKey: 'settings.domainAdministration', icon: 'shield', adminOnly: true },
]);

export const SETTINGS_LEAVES = freezeEntries([
  {
    id: 'personal-account',
    domainId: 'personal',
    path: '/settings/personal/account',
    labelKey: 'settings.pageAccount',
    descriptionKey: 'settings.pageAccountDescription',
    icon: 'circle-user',
    adminOnly: false,
    loader: () => import('/settings/pages/personal-account.js'),
  },
  {
    id: 'personal-appearance',
    domainId: 'personal',
    path: '/settings/personal/appearance',
    labelKey: 'settings.pageAppearance',
    descriptionKey: 'settings.pageAppearanceDescription',
    icon: 'palette',
    adminOnly: false,
    loader: () => import('/settings/pages/personal-appearance.js'),
  },
  {
    id: 'personal-device',
    domainId: 'personal',
    path: '/settings/personal/device',
    labelKey: 'settings.pageDevice',
    descriptionKey: 'settings.pageDeviceDescription',
    icon: 'smartphone',
    adminOnly: false,
    loader: () => import('/settings/pages/personal-device.js'),
  },
  {
    id: 'personal-notifications',
    domainId: 'personal',
    path: '/settings/personal/notifications',
    labelKey: 'settings.pageNotifications',
    descriptionKey: 'settings.pageNotificationsDescription',
    icon: 'bell',
    adminOnly: false,
    loader: () => import('/settings/pages/notifications.js'),
  },
  {
    // `calendar_default_reminders` und `calendar_default_assign_me` schreiben
    // per `cfgUserSet` pro Nutzer, lagen aber im adminOnly-`modules-calendar`
    // (Critique 2026-07-27). Wochenstart, Standarddauer und Feiertage bleiben
    // dort: die gelten haushaltweit.
    id: 'personal-calendar',
    domainId: 'personal',
    path: '/settings/personal/calendar',
    labelKey: 'settings.pageCalendarDefaults',
    descriptionKey: 'settings.pageCalendarDefaultsDescription',
    icon: 'calendar-clock',
    module: 'calendar',
    adminOnly: false,
    loader: () => import('/settings/pages/personal-calendar.js'),
  },
  {
    // `tasks_default_target` schreibt per `cfgUserSet` pro Nutzer. Welche

    // `sync-reminders`; in welche davon MEINE neuen Aufgaben laufen, entscheide

    id: 'personal-tasks',
    domainId: 'personal',
    path: '/settings/personal/tasks',
    labelKey: 'settings.pageTaskDefaults',
    descriptionKey: 'settings.pageTaskDefaultsDescription',
    icon: 'list-checks',
    module: 'tasks',
    adminOnly: false,
    loader: () => import('/settings/pages/personal-tasks.js'),
  },
  {




    id: 'personal-health',
    domainId: 'personal',
    path: '/settings/personal/health',
    labelKey: 'settings.pageHealthPersonal',
    descriptionKey: 'settings.pageHealthPersonalDescription',
    icon: 'heart-pulse',
    module: 'health',
    adminOnly: false,
    loader: () => import('/settings/pages/personal-health.js'),
  },
  {
    id: 'personal-weather',
    domainId: 'personal',
    path: '/settings/personal/weather',
    labelKey: 'settings.pageWeather',
    descriptionKey: 'settings.pageWeatherDescription',
    icon: 'cloud-sun',
    adminOnly: false,
    loader: () => import('/settings/pages/personal-weather.js'),
  },
  {

    // server/routes/preferences.js). Das Blatt lag trotzdem hinter adminOnly, also


    id: 'modules-navigation',
    domainId: 'personal',
    path: '/settings/personal/navigation',
    labelKey: 'settings.pageNavigation',
    descriptionKey: 'settings.pageNavigationDescription',
    icon: 'panel-left',
    adminOnly: false,
    loader: () => import('/settings/pages/modules-navigation.js'),
  },
  {
    // Beide Feed-Tokens haengen an der eigenen users-Zeile (calendar_feed_token,
    // Migration 61; inventory_deadlines_feed_token, Migration 144), und beide
    // Routen tragen serverseitig bewusst keinen Admin-Check. Die Abschnitte



    id: 'personal-feeds',
    domainId: 'personal',
    path: '/settings/personal/feeds',
    labelKey: 'settings.pageFeeds',
    descriptionKey: 'settings.pageFeedsDescription',
    icon: 'rss',
    adminOnly: false,
    loader: () => import('/settings/pages/personal-feeds.js'),
  },
  {



    // liefert `shared = 1 OR created_by = ich`, und PATCH/DELETE/sync

    // Jedes Mitglied durfte sein eigenes Abo also laengst verwalten und kam


    // Haushalts und ihre Routen tragen `requireAdmin`.
    id: 'personal-calendar-subscriptions',
    domainId: 'personal',
    path: '/settings/personal/calendar-subscriptions',
    labelKey: 'settings.pageCalendarSubscriptions',
    descriptionKey: 'settings.pageCalendarSubscriptionsDescription',
    icon: 'calendar-plus',
    module: 'calendar',
    adminOnly: false,
    loader: () => import('/settings/pages/personal-calendar-subscriptions.js'),
  },
  {

    // (Critique 2026-08-16). Dort stand er inline hinter `isAdmin` neben dem
    // persoenlichen Ausblenden-Knopf aus #673: zwei unbeschriftete


    id: 'modules-active',
    domainId: 'modules',
    path: '/settings/modules/active',
    labelKey: 'settings.pageActiveModules',
    descriptionKey: 'settings.pageActiveModulesDescription',
    icon: 'toggle-right',
    adminOnly: true,
    loader: () => import('/settings/pages/modules-active.js'),
  },
  {
    id: 'modules-kitchen',
    domainId: 'modules',
    path: '/settings/modules/kitchen',
    labelKey: 'settings.pageKitchen',
    descriptionKey: 'settings.pageKitchenDescription',
    icon: 'utensils',
    module: 'kitchen',
    adminOnly: true,
    loader: () => import('/settings/pages/modules-kitchen.js'),
  },
  {
    id: 'modules-calendar',
    domainId: 'modules',
    path: '/settings/modules/calendar',
    labelKey: 'settings.pageCalendarModule',
    descriptionKey: 'settings.pageCalendarModuleDescription',
    icon: 'calendar-days',
    module: 'calendar',
    adminOnly: true,
    loader: () => import('/settings/pages/modules-calendar.js'),
  },
  {


    // (Critique 2026-07-27).
    id: 'modules-options',
    domainId: 'modules',
    path: '/settings/modules/options',
    labelKey: 'settings.pageModuleOptions',
    descriptionKey: 'settings.pageModuleOptionsDescription',
    icon: 'sliders-horizontal',
    adminOnly: true,
    loader: () => import('/settings/pages/modules-options.js'),
  },
  {
    id: 'modules-rewards',
    domainId: 'modules',
    path: '/settings/modules/rewards',
    labelKey: 'settings.pageRewardsModule',
    descriptionKey: 'settings.pageRewardsModuleDescription',
    icon: 'award',
    module: 'rewards',
    adminOnly: true,
    loader: () => import('/settings/pages/modules-rewards.js'),
  },
  {


    id: 'modules-countdowns',
    domainId: 'modules',
    path: '/settings/modules/countdowns',
    labelKey: 'settings.pageCountdownsModule',
    descriptionKey: 'settings.pageCountdownsModuleDescription',
    icon: 'hourglass',
    adminOnly: true,
    loader: () => import('/settings/pages/modules-countdowns.js'),
  },
  {
    id: 'sync-calendar',
    domainId: 'sync',
    path: '/settings/sync/calendar',
    labelKey: 'settings.pageSyncCalendar',
    descriptionKey: 'settings.pageSyncCalendarDescription',
    icon: 'calendar-sync',
    module: 'calendar',
    adminOnly: true,
    loader: () => import('/settings/pages/sync-calendar.js'),
  },
  {
    id: 'sync-contacts',
    domainId: 'sync',
    path: '/settings/sync/contacts',
    labelKey: 'settings.pageSyncContacts',
    descriptionKey: 'settings.pageSyncContactsDescription',
    icon: 'contact-round',
    module: 'contacts',
    adminOnly: true,
    loader: () => import('/settings/pages/sync-contacts.js'),
  },
  {
    id: 'sync-reminders',
    domainId: 'sync',
    path: '/settings/sync/reminders',
    labelKey: 'settings.pageSyncReminders',
    descriptionKey: 'settings.pageSyncRemindersDescription',
    icon: 'list-checks',
    module: 'tasks',
    adminOnly: true,
    loader: () => import('/settings/pages/sync-reminders.js'),
  },
  {



    id: 'documents-storage',
    domainId: 'sync',
    path: '/settings/sync/storage',
    labelKey: 'settings.pageDocumentStorage',
    descriptionKey: 'settings.pageDocumentStorageDescription',
    icon: 'hard-drive',
    module: 'documents',
    adminOnly: true,
    loader: () => import('/settings/pages/documents-storage.js'),
  },
  {
    id: 'documents-dms',
    domainId: 'sync',
    path: '/settings/sync/dms',
    labelKey: 'settings.pageDocumentDms',
    descriptionKey: 'settings.pageDocumentDmsDescription',
    icon: 'archive',
    module: 'documents',
    adminOnly: true,
    loader: () => import('/settings/pages/documents-dms.js'),
  },
  {
    id: 'admin-family',
    domainId: 'admin',
    path: '/settings/admin/family',
    labelKey: 'settings.pageFamilyRoles',
    descriptionKey: 'settings.pageFamilyRolesDescription',
    icon: 'users',
    adminOnly: true,
    loader: () => import('/settings/pages/admin-family.js'),
  },
  {
    id: 'admin-permissions',
    domainId: 'admin',
    path: '/settings/admin/permissions',
    labelKey: 'settings.pagePermissions',
    descriptionKey: 'settings.pagePermissionsDescription',
    icon: 'shield-check',
    adminOnly: true,
    loader: () => import('/settings/pages/admin-permissions.js'),
  },
  {



    // ist `personal-weather`.
    id: 'admin-weather',
    domainId: 'admin',
    path: '/settings/admin/weather',
    labelKey: 'settings.pageHouseholdWeather',
    descriptionKey: 'settings.pageHouseholdWeatherDescription',
    icon: 'cloud-sun',
    adminOnly: true,
    loader: () => import('/settings/pages/admin-weather.js'),
  },
  {
    id: 'admin-api',
    domainId: 'admin',
    path: '/settings/admin/api',
    labelKey: 'settings.pageApiAccess',
    descriptionKey: 'settings.pageApiAccessDescription',
    icon: 'key-round',
    adminOnly: true,
    loader: () => import('/settings/pages/admin-api.js'),
  },
  {
    id: 'admin-backup',
    domainId: 'admin',
    path: '/settings/admin/backup',
    labelKey: 'settings.pageBackupRestore',
    descriptionKey: 'settings.pageBackupRestoreDescription',
    icon: 'database-backup',
    adminOnly: true,
    loader: () => import('/settings/pages/admin-backup.js'),
  },
  {
    id: 'admin-email',
    domainId: 'admin',
    path: '/settings/admin/email',
    labelKey: 'settings.pageEmail',
    descriptionKey: 'settings.pageEmailDescription',
    icon: 'mail',
    adminOnly: true,
    loader: () => import('/settings/pages/admin-email.js'),
  },
  {
    id: 'admin-immich',
    domainId: 'admin',
    path: '/settings/admin/immich',
    labelKey: 'settings.pageImmich',
    descriptionKey: 'settings.pageImmichDescription',
    icon: 'images',
    adminOnly: true,
    loader: () => import('/settings/pages/admin-immich.js'),
  },
  {
    id: 'admin-system',
    domainId: 'admin',
    path: '/settings/admin/system',
    labelKey: 'settings.pageSystem',
    descriptionKey: 'settings.pageSystemDescription',
    icon: 'info',
    adminOnly: true,
    loader: () => import('/settings/pages/admin-system.js'),
  },
]);

const LEGACY_SETTINGS_PATHS = Object.freeze({
  general: '/settings/personal/appearance',
  meals: '/settings/modules/kitchen',
  budget: '/settings/modules/budget',
  // Kategorienpflege lebt bewusst im Modul, neben ihren Daten.
  shopping: '/shopping?manage=categories',
  calendar: '/settings/modules/calendar',
  sync: '/settings/sync/calendar',
  account: '/settings/personal/account',
  family: '/settings/admin/family',
  'api-tokens': '/settings/admin/api',
  backup: '/settings/admin/backup',
});

const RENAMED_SETTINGS_PATHS = Object.freeze({


  '/settings/documents/storage': '/settings/sync/storage',
  '/settings/documents/dms': '/settings/sync/dms',

  '/settings/modules/navigation': '/settings/personal/navigation',


  '/settings/modules/dashboard': '/settings/admin/weather',

  '/settings/modules/budget': '/settings/modules/options',
  '/settings/modules/health': '/settings/modules/options',
  '/settings/modules/housekeeping': '/settings/modules/options',
});

export function filterSettingsDomains(user) {
  const isAdmin = user?.role === 'admin';
  return SETTINGS_DOMAINS.filter((domain) => isAdmin || !domain.adminOnly);
}

export const RENAMED_SETTINGS_SOURCE_PATHS = Object.freeze(Object.keys(RENAMED_SETTINGS_PATHS));

export function currentSettingsPath(path) {
  return RENAMED_SETTINGS_PATHS[path] ?? path;
}

export function findSettingsLeaf(path, user) {
  const target = currentSettingsPath(path);
  const leaf = SETTINGS_LEAVES.find((entry) => entry.path === target);
  if (!leaf || (leaf.adminOnly && user?.role !== 'admin')) return null;
  return leaf;
}

export function settingsOverviewUrl(domainId = null) {
  return domainId
    ? `/settings?view=domain&domain=${encodeURIComponent(domainId)}`
    : '/settings?view=domains';
}

export function resolveSettingsDestination(path, user, storedPath) {
  if (path !== '/settings') return findSettingsLeaf(path, user)?.path ?? '/settings/personal/account';
  return findSettingsLeaf(storedPath, user)?.path ?? '/settings/personal/account';
}

export function migrateLegacySettingsTab(value) {
  const legacy = LEGACY_SETTINGS_PATHS[value];



  return legacy ? currentSettingsPath(legacy) : null;
}

export function readStoredSettingsDestination(user, storage = sessionStorage) {
  const current = storage.getItem(SETTINGS_STORAGE_KEY);


  const leaf = findSettingsLeaf(current, user);
  if (leaf) return leaf.path;
  const legacy = storage.getItem(LEGACY_SETTINGS_STORAGE_KEY);
  const migrated = migrateLegacySettingsTab(legacy);
  if (migrated) {
    storage.removeItem(LEGACY_SETTINGS_STORAGE_KEY);
    if (migrated.startsWith('/settings/') && findSettingsLeaf(migrated, user)) {
      storage.setItem(SETTINGS_STORAGE_KEY, migrated);
    }
    return migrated;
  }




  return null;
}
