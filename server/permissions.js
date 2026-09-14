
import { MODULE_KEYS, getModuleKeys, tokenAllows } from './scopes.js';


// users.family_role-Spalte (Migration, db.js).
export const FAMILY_ROLES = Object.freeze([
  'dad', 'mom', 'parent', 'child', 'grandparent', 'relative', 'other',
]);




export const PERMISSION_MODULES = Object.freeze([
  { key: 'calendar',     labelKey: 'nav.calendar',     icon: 'calendar',      navIds: ['calendar', 'birthdays'] },
  { key: 'tasks',        labelKey: 'nav.tasks',        icon: 'check-square',  navIds: ['tasks'] },
  { key: 'notes',        labelKey: 'nav.notes',        icon: 'sticky-note',   navIds: ['notes'] },
  { key: 'contacts',     labelKey: 'nav.contacts',     icon: 'book-user',     navIds: ['contacts'] },
  { key: 'meals',        labelKey: 'nav.kitchen',      icon: 'utensils',      navIds: ['meals', 'recipes'] },
  { key: 'shopping',     labelKey: 'nav.shopping',     icon: 'shopping-cart', navIds: ['shopping'] },
  { key: 'pantry',       labelKey: 'nav.pantry',       icon: 'archive',       navIds: ['pantry'] },
  { key: 'inventory',    labelKey: 'nav.inventory',    icon: 'package',       navIds: ['inventory'] },
  { key: 'budget',       labelKey: 'nav.budget',       icon: 'wallet',        navIds: ['budget'] },
  { key: 'documents',    labelKey: 'nav.documents',    icon: 'folder-lock',   navIds: ['documents'] },
  { key: 'housekeeping', labelKey: 'nav.housekeeping', icon: 'paintbrush',    navIds: ['housekeeping'] },
  { key: 'waste',        labelKey: 'nav.waste',        icon: 'trash-2',       navIds: ['waste'] },
  { key: 'rewards',      labelKey: 'nav.rewards',      icon: 'award',         navIds: ['rewards'] },
  { key: 'health',       labelKey: 'nav.health',       icon: 'heart-pulse',   navIds: ['health'] },
  { key: 'schedule',     labelKey: 'nav.schedule',     icon: 'calendar-clock', navIds: ['schedule'] },
]);


// `module: null` → kein Modul-Gate (family/weather sind infrastrukturell).


// sperren (#467).
export const PERMISSION_WIDGETS = Object.freeze([
  { id: 'tasks',        module: 'tasks' },
  { id: 'calendar',     module: 'calendar' },
  { id: 'meals',        module: 'meals' },
  { id: 'shopping',     module: 'shopping' },
  { id: 'birthdays',    module: 'calendar' },
  { id: 'budget',       module: 'budget' },
  { id: 'rewards',      module: 'rewards' },
  { id: 'health',       module: 'health' },
  { id: 'cycle',        module: 'health' },
  { id: 'housekeeping', module: 'housekeeping' },
  { id: 'schedule',     module: 'schedule' },
  { id: 'waste',        module: 'waste' },
  { id: 'notes',        module: 'notes' },
  { id: 'family',       module: null },
  { id: 'weather',      module: null },
  { id: 'clock',        module: null },



  // gebraucht - jede EINZELNE Kachel prueft ihr Modul schon selbst
  // (`renderMetricTiles` filtert ueber `isWidgetModuleEnabled`), ein gesperrtes


  { id: 'metrics',      module: null },




  { id: 'countdown',    module: null },




  // Schalter.
  { id: 'quicklinks',    module: null },
]);

// Feinere Schreibrechte, die kein ganzes Modul sperren sollen. Persoenliche
// Notiz-Kategorien bleiben immer Sache ihres Besitzers; dieser Schalter
// betrifft ausschliesslich den gemeinsamen Haushaltskatalog.
export const PERMISSION_CAPABILITIES = Object.freeze([
  {
    key: 'notes_manage_household_categories',
    module: 'notes',
    labelKey: 'noteCategories.permissionLabel',
  },
]);

export const MODULE_ACCESS_LEVELS = Object.freeze(['none', 'read', 'write']);
export const WIDGET_ACCESS_LEVELS = Object.freeze(['none', 'allow']);
export const CAPABILITY_ACCESS_LEVELS = Object.freeze(['none', 'allow']);
const MODULE_DEFAULT = 'write';
const WIDGET_DEFAULT = 'allow';
const CAPABILITY_DEFAULT = 'none';




//
//   'restricted'  Module mit persoenlichen Daten starten gesperrt

//







// das Rollenprofil.
export const INVITE_PRESETS = Object.freeze(['restricted', 'role']);
export const INVITE_PRESET_DEFAULT = 'restricted';



// Haushalt - Gesundheitswerte, Finanzen und Ausweise/Vertraege. Kalender,




export const INVITE_RESTRICTED_MODULES = Object.freeze(['health', 'budget', 'documents']);

/** Extension catalog injected at runtime by the module registry — keeps this file off db.js. */
let _extensionPermissionModules = [];
let _extensionPermissionWidgets = [];

export function setExtensionPermissionCatalog(catalog) {
  _extensionPermissionModules = Array.isArray(catalog?.permissionModules)
    ? catalog.permissionModules.filter((m) => m && typeof m.key === 'string')
    : [];
  _extensionPermissionWidgets = Array.isArray(catalog?.permissionWidgets)
    ? catalog.permissionWidgets.filter((w) => w && typeof w.id === 'string')
    : [];
}

function extensionPermissionModules() {
  return _extensionPermissionModules;
}

function extensionPermissionWidgets() {
  return _extensionPermissionWidgets;
}

function allPermissionModules() {
  return [...PERMISSION_MODULES, ...extensionPermissionModules()];
}

function allPermissionWidgets() {
  return [...PERMISSION_WIDGETS, ...extensionPermissionWidgets()];
}

function moduleKeySet() {
  return new Set(allPermissionModules().map((m) => m.key));
}

function widgetIdSet() {
  return new Set(allPermissionWidgets().map((w) => w.id));
}

const CAPABILITY_KEY_SET = new Set(PERMISSION_CAPABILITIES.map((item) => item.key));
const MODULE_ACCESS_SET = new Set(MODULE_ACCESS_LEVELS);
const WIDGET_ACCESS_SET = new Set(WIDGET_ACCESS_LEVELS);
const CAPABILITY_ACCESS_SET = new Set(CAPABILITY_ACCESS_LEVELS);
const FAMILY_ROLE_SET = new Set(FAMILY_ROLES);


// sein, sonst greift die Backend-Durchsetzung ins Leere.
for (const m of PERMISSION_MODULES) {
  if (!MODULE_KEYS.includes(m.key)) {
    throw new Error(`[permissions] Unknown scope module: ${m.key}`);
  }
}

function loadSubjectRows(database, subjectType, subjectId) {
  return database
    .prepare('SELECT resource_type, resource_key, access FROM access_permissions WHERE subject_type = ? AND subject_id = ?')
    .all(subjectType, String(subjectId));
}

export function resolvePermissions(database, user) {
  const isAdmin = user?.role === 'admin';
  const modules = {};
  const widgets = {};
  const capabilities = {};
  for (const m of allPermissionModules()) modules[m.key] = isAdmin ? 'write' : MODULE_DEFAULT;
  for (const w of allPermissionWidgets()) widgets[w.id] = isAdmin ? 'allow' : WIDGET_DEFAULT;
  for (const item of PERMISSION_CAPABILITIES) capabilities[item.key] = isAdmin ? 'allow' : CAPABILITY_DEFAULT;
  if (isAdmin) return { admin: true, modules, widgets, capabilities };

  const MODULE_KEY_SET = moduleKeySet();
  const WIDGET_ID_SET = widgetIdSet();

  const apply = (rows) => {
    for (const r of rows) {
      if (r.resource_type === 'module' && MODULE_KEY_SET.has(r.resource_key) && MODULE_ACCESS_SET.has(r.access)) {
        modules[r.resource_key] = r.access;
      } else if (r.resource_type === 'widget' && WIDGET_ID_SET.has(r.resource_key) && WIDGET_ACCESS_SET.has(r.access)) {
        widgets[r.resource_key] = r.access;
      } else if (r.resource_type === 'capability' && CAPABILITY_KEY_SET.has(r.resource_key) && CAPABILITY_ACCESS_SET.has(r.access)) {
        capabilities[r.resource_key] = r.access;
      }
    }
  };

  // 1. Rollen-Profil, 2. Mitglied-Override (gewinnt).
  if (user?.family_role && FAMILY_ROLE_SET.has(user.family_role)) {
    apply(loadSubjectRows(database, 'role', user.family_role));
  }
  if (user?.id != null) {
    apply(loadSubjectRows(database, 'user', user.id));
  }

  // Widgets erben die Modulsperre.
  for (const w of allPermissionWidgets()) {
    if (w.module && modules[w.module] === 'none') widgets[w.id] = 'none';
  }
  return { admin: false, modules, widgets, capabilities };
}

export function buildSessionModuleAccess(resolved) {
  if (!resolved || resolved.admin) return null;
  const map = {};
  let restricted = false;
  for (const [key, access] of Object.entries(resolved.modules)) {
    if (access !== 'write') {
      map[key] = access;
      restricted = true;
    }
  }
  return restricted ? map : null;
}

export function deniedModules(sessionModuleAccess) {
  const out = new Set();
  for (const [key, level] of Object.entries(sessionModuleAccess || {})) {
    if (level === 'none') out.add(key);
  }
  return out;
}

export function hiddenModulesFor(req, moduleKeys) {
  const hidden = deniedModules(req.sessionModuleAccess);
  for (const key of moduleKeys) {
    if (!tokenAllows(req.authScopes, key, 'read')) hidden.add(key);
  }
  return hidden;
}


// gesperrt, 'read-only' = nur Lesen erlaubt, Schreibversuch abgewiesen.
export const MODULE_ACCESS_ALLOW = 'allow';
export const MODULE_ACCESS_DENIED = 'none';
export const MODULE_ACCESS_READ_ONLY = 'read-only';

export function moduleAccessVerdict(sessionModuleAccess, moduleKey, access) {
  if (!sessionModuleAccess) return MODULE_ACCESS_ALLOW;
  if (!moduleKey || !(moduleKey in sessionModuleAccess)) return MODULE_ACCESS_ALLOW;
  const level = sessionModuleAccess[moduleKey];
  if (level === 'none') return MODULE_ACCESS_DENIED;
  if (level === 'read' && access === 'write') return MODULE_ACCESS_READ_ONLY;
  return MODULE_ACCESS_ALLOW;
}

export function clientPermissions(database, user) {
  const { admin, modules, widgets, capabilities } = resolvePermissions(database, user);
  return { admin, modules, widgets, capabilities };
}

export function permissionCatalog() {
  return {
    modules: allPermissionModules().map((m) => ({
      key: m.key,
      labelKey: m.labelKey || null,
      label: m.label || null,
      icon: m.icon,
      extensionModuleId: m.extensionModuleId || null,
    })),
    widgets: allPermissionWidgets().map((w) => ({
      id: w.id,
      module: w.module,
      label: w.label || null,
      labelKey: w.labelKey || null,
    })),
    capabilities: PERMISSION_CAPABILITIES.map((item) => ({ ...item })),
    roles: [...FAMILY_ROLES],
    moduleAccessLevels: [...MODULE_ACCESS_LEVELS],
    widgetAccessLevels: [...WIDGET_ACCESS_LEVELS],
    capabilityAccessLevels: [...CAPABILITY_ACCESS_LEVELS],
    defaults: { module: MODULE_DEFAULT, widget: WIDGET_DEFAULT, capability: CAPABILITY_DEFAULT },



    invitePresets: {
      values: [...INVITE_PRESETS],
      default: INVITE_PRESET_DEFAULT,
      restrictedModules: [...INVITE_RESTRICTED_MODULES],
    },
    scopeModuleKeys: getModuleKeys(),
  };
}

export function getSubjectPermissions(database, subjectType, subjectId) {
  const rows = loadSubjectRows(database, subjectType, subjectId);
  const modules = {};
  const widgets = {};
  const capabilities = {};
  const MODULE_KEY_SET = moduleKeySet();
  const WIDGET_ID_SET = widgetIdSet();
  for (const r of rows) {
    if (r.resource_type === 'module' && MODULE_KEY_SET.has(r.resource_key)) modules[r.resource_key] = r.access;
    else if (r.resource_type === 'widget' && WIDGET_ID_SET.has(r.resource_key)) widgets[r.resource_key] = r.access;
    else if (r.resource_type === 'capability' && CAPABILITY_KEY_SET.has(r.resource_key)) capabilities[r.resource_key] = r.access;
  }
  return { modules, widgets, capabilities };
}

export function normalizePermissionInput(
  { modules = {}, widgets = {}, capabilities = {} } = {},
  { subjectType = 'role' } = {},
) {
  const rows = [];
  const MODULE_KEY_SET = moduleKeySet();
  const WIDGET_ID_SET = widgetIdSet();
  for (const [key, access] of Object.entries(modules || {})) {
    if (!MODULE_KEY_SET.has(key)) throw new Error(`Unknown module: ${key}`);
    if (!MODULE_ACCESS_SET.has(access)) throw new Error(`Invalid module access: ${access}`);
    if (access === MODULE_DEFAULT) continue; // Standard nicht speichern
    rows.push({ resource_type: 'module', resource_key: key, access });
  }
  for (const [id, access] of Object.entries(widgets || {})) {
    if (!WIDGET_ID_SET.has(id)) throw new Error(`Unknown widget: ${id}`);
    if (!WIDGET_ACCESS_SET.has(access)) throw new Error(`Invalid widget access: ${access}`);
    if (access === WIDGET_DEFAULT) continue;
    rows.push({ resource_type: 'widget', resource_key: id, access });
  }
  for (const [key, access] of Object.entries(capabilities || {})) {
    if (!CAPABILITY_KEY_SET.has(key)) throw new Error(`Unknown capability: ${key}`);
    if (!CAPABILITY_ACCESS_SET.has(access)) throw new Error(`Invalid capability access: ${access}`);


    // Rollenprofil geerbtes `allow` ausdruecklich aufzuheben.
    if (access === CAPABILITY_DEFAULT && subjectType !== 'user') continue;
    rows.push({ resource_type: 'capability', resource_key: key, access });
  }
  return rows;
}

export function replaceSubjectPermissions(database, subjectType, subjectId, input) {
  // Portable Transaktion (BEGIN/COMMIT/ROLLBACK): funktioniert sowohl mit


  database.exec('BEGIN');
  try {
    writeSubjectPermissions(database, subjectType, subjectId, input);
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
  return getSubjectPermissions(database, subjectType, subjectId);
}

export function writeSubjectPermissions(database, subjectType, subjectId, input) {
  const rows = normalizePermissionInput(input, { subjectType });
  const deleteModulesAndWidgets = database.prepare(`
    DELETE FROM access_permissions
    WHERE subject_type = ? AND subject_id = ?
      AND resource_type IN ('module', 'widget')
  `);
  const deleteCapabilities = database.prepare(`
    DELETE FROM access_permissions
    WHERE subject_type = ? AND subject_id = ? AND resource_type = 'capability'
  `);
  const ins = database.prepare(`
    INSERT INTO access_permissions (subject_type, subject_id, resource_type, resource_key, access)
    VALUES (?, ?, ?, ?, ?)
  `);
  deleteModulesAndWidgets.run(subjectType, String(subjectId));
  if (Object.prototype.hasOwnProperty.call(input || {}, 'capabilities')) {
    deleteCapabilities.run(subjectType, String(subjectId));
  }
  for (const r of rows) ins.run(subjectType, String(subjectId), r.resource_type, r.resource_key, r.access);
  return rows.length;
}

export function invitePresetPermissions(preset) {
  if (preset !== 'restricted') return null;
  const modules = {};
  for (const key of INVITE_RESTRICTED_MODULES) modules[key] = 'none';
  return { modules, widgets: {} };
}

export function isValidInvitePreset(preset) {
  return INVITE_PRESETS.includes(preset);
}

export function isValidFamilyRole(role) {
  return FAMILY_ROLE_SET.has(role);
}
