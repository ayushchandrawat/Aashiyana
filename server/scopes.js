
// Kanonische, scopebare Module. `key` = Scope-Modul, `prefixes` = die ersten

// ein Modul teilen, z. B. calendar + reminders + birthdays).
const SCOPE_MODULES = [
  { key: 'tasks',        prefixes: ['tasks'] },
  { key: 'shopping',     prefixes: ['shopping'] },
  { key: 'meals',        prefixes: ['meals', 'recipes', 'recipe-providers'] },
  { key: 'pantry',       prefixes: ['pantry'] },
  { key: 'inventory',    prefixes: ['inventory'] },
  { key: 'calendar',     prefixes: ['calendar', 'reminders', 'birthdays'] },
  { key: 'notes',        prefixes: ['notes'] },
  { key: 'contacts',     prefixes: ['contacts'] },
  { key: 'schedule',     prefixes: ['schedule'] },
  { key: 'budget',       prefixes: ['budget', 'split-expenses'] },
  { key: 'documents',    prefixes: ['documents'] },
  { key: 'health',       prefixes: ['health'] },
  { key: 'rewards',      prefixes: ['rewards'] },
  { key: 'housekeeping', prefixes: ['housekeeping'] },
  { key: 'waste',        prefixes: ['waste'] },
  { key: 'weather',      prefixes: ['weather'] },
  { key: 'family',       prefixes: ['family'] },


  // eine waere sie fuer JEDES gescopte Token gesperrt (tokenAllows verweigert

  { key: 'dashboard',    prefixes: ['dashboard', 'quick-links'] },
  { key: 'search',       prefixes: ['search'] },
];

const MODULE_KEYS = SCOPE_MODULES.map((m) => m.key);

/** Extension scope modules registered at runtime from third-party manifests. */
let _extensionScopeModules = [];

export function setExtensionScopeModules(modules) {
  _extensionScopeModules = Array.isArray(modules)
    ? modules.filter((m) => m && typeof m.key === 'string' && Array.isArray(m.prefixes))
    : [];
  rebuildScopeMaps();
}

function allScopeModules() {
  return [...SCOPE_MODULES, ..._extensionScopeModules];
}

let MODULE_KEY_SET = new Set(MODULE_KEYS);
let PREFIX_TO_MODULE = new Map();
let ALL_SCOPES = MODULE_KEYS.flatMap((key) => [`${key}:read`, `${key}:write`]);
let ALL_SCOPE_SET = new Set(ALL_SCOPES);

function rebuildScopeMaps() {
  const keys = allScopeModules().map((m) => m.key);
  MODULE_KEY_SET = new Set(keys);
  PREFIX_TO_MODULE = new Map();
  for (const mod of allScopeModules()) {
    for (const prefix of mod.prefixes) PREFIX_TO_MODULE.set(prefix, mod.key);
  }
  ALL_SCOPES = keys.flatMap((key) => [`${key}:read`, `${key}:write`]);
  ALL_SCOPE_SET = new Set(ALL_SCOPES);
}

rebuildScopeMaps();

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseScopes(raw) {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) return normalizeScopes(raw);
  const text = String(raw).trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    return normalizeScopes(parsed);
  } catch {
    return null;
  }
}

function normalizeScopes(list) {
  const out = new Set();
  for (const entry of Array.isArray(list) ? list : []) {
    const scope = String(entry || '').trim().toLowerCase();
    if (ALL_SCOPE_SET.has(scope)) out.add(scope);
  }
  return [...out].sort();
}

function serializeScopes(scopes) {
  if (scopes === null || scopes === undefined) return null;
  return JSON.stringify(normalizeScopes(scopes));
}

function requiredAccess(method) {
  return READ_METHODS.has(String(method || '').toUpperCase()) ? 'read' : 'write';
}

function moduleForPath(path) {
  const cleaned = String(path || '').replace(/^\/+/, '').toLowerCase();
  const parts = cleaned.split('/').filter(Boolean);
  if (parts[0] === 'extensions' && parts[1]) {
    const extKey = PREFIX_TO_MODULE.get(`extensions/${parts[1]}`);
    if (extKey) return extKey;
  }
  if (parts.length >= 2) {
    const compound = `${parts[0]}/${parts[1]}`;
    const compoundKey = PREFIX_TO_MODULE.get(compound);
    if (compoundKey) return compoundKey;
  }
  return PREFIX_TO_MODULE.get(parts[0]) || null;
}

function sessionModuleAccessRequirement(path, method) {
  const moduleKey = moduleForPath(path);
  const access = path === '/schedule/preferences' ? 'read' : requiredAccess(method);
  return { moduleKey, access };
}

/** All scope module keys including runtime extension modules. */
function getModuleKeys() {
  return allScopeModules().map((m) => m.key);
}

/** All valid scope strings including extension modules. */
function getAllScopes() {
  return ALL_SCOPES;
}

function tokenAllows(scopes, moduleKey, access) {
  if (scopes === null || scopes === undefined) return true;
  if (!moduleKey || !MODULE_KEY_SET.has(moduleKey)) return false;
  if (scopes.includes(`${moduleKey}:write`)) return true;
  if (access === 'read') return scopes.includes(`${moduleKey}:read`);
  return false;
}

export {
  SCOPE_MODULES,
  MODULE_KEYS,
  ALL_SCOPES,
  parseScopes,
  normalizeScopes,
  serializeScopes,
  requiredAccess,
  moduleForPath,
  sessionModuleAccessRequirement,
  tokenAllows,
  getModuleKeys,
  getAllScopes,
};
