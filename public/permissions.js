

// server/permissions.js (PERMISSION_MODULES.navIds) passen. Nicht gelistete



const NAV_TO_MODULE = Object.freeze({
  calendar: 'calendar',
  schedule: 'schedule',
  birthdays: 'calendar',
  tasks: 'tasks',
  notes: 'notes',
  contacts: 'contacts',
  meals: 'meals',
  recipes: 'meals',
  shopping: 'shopping',
  pantry: 'pantry',
  budget: 'budget',
  inventory: 'inventory',
  documents: 'documents',
  housekeeping: 'housekeeping',
  waste: 'waste',
  rewards: 'rewards',
  health: 'health',
});

/** third-party-{id} → ext:{id} */
let _extensionNavMap = Object.freeze({});

export function setExtensionNavMap(modules) {
  const map = {};
  for (const mod of Array.isArray(modules) ? modules : []) {
    if (mod?.capabilities?.permissionModuleKey) {
      map[`third-party-${mod.id}`] = mod.capabilities.permissionModuleKey;
    }
  }
  _extensionNavMap = Object.freeze(map);
}

function navPermissionKey(navModule) {
  return NAV_TO_MODULE[navModule] || _extensionNavMap[navModule] || null;
}

let _perms = { admin: false, modules: {}, widgets: {} };

export function setPermissions(payload) {
  if (payload && typeof payload === 'object') {
    _perms = {
      admin: payload.admin === true,
      modules: payload.modules && typeof payload.modules === 'object' ? payload.modules : {},
      widgets: payload.widgets && typeof payload.widgets === 'object' ? payload.widgets : {},
    };
  }
}

export function clearPermissions() {
  _perms = { admin: false, modules: {}, widgets: {} };
}

export function getPermissions() {
  return _perms;
}

export function isPermAdmin() {
  return _perms.admin === true;
}

export function moduleAccess(moduleKey) {
  if (_perms.admin) return 'write';
  return _perms.modules?.[moduleKey] ?? 'write';
}

export function canAccessNavModule(navModule) {
  if (_perms.admin) return true;
  const key = navPermissionKey(navModule);
  if (!key) return true;
  return (_perms.modules?.[key] ?? 'write') !== 'none';
}

export function navModuleAccess(navModule) {
  const key = navPermissionKey(navModule);
  if (!key) return 'write';
  return moduleAccess(key);
}

export function isNavModuleReadOnly(navModule) {
  return navModuleAccess(navModule) === 'read';
}

export function canSeeWidget(widgetId) {
  if (_perms.admin) return true;
  return (_perms.widgets?.[widgetId] ?? 'allow') !== 'none';
}
