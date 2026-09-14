
import { auth } from '/api.js';
import { getLocale } from '/i18n.js';
import {
  SETTINGS_STORAGE_KEY,
  filterSettingsDomains,
  findSettingsLeaf,
  readStoredSettingsDestination,
} from '/settings/registry.js';
import { renderSettingsShell } from '/settings/shell.js';

const SETTINGS_ROOT = '/settings';
const ACCOUNT_LEAF = '/settings/personal/account';
const SYNC_CALENDAR_LEAF = '/settings/sync/calendar';
const OVERVIEW_VIEWS = new Set(['domains', 'domain']);


let mountedContainer = null;

let renderedLocale = null;

async function refreshUser(user) {
  if (user) return user;

  try {
    const me = await auth.me();
    if (me?.user) return me.user;
  } catch {
    // Non-critical: the router owns the auth redirect if no user is available.
  }
  return user;
}


// seiner navigate()-Schleife steckt (isNavigating === true). Ein direkter



function redirectTo(target) {
  history.replaceState({ path: target }, '', target);
  setTimeout(() => {
    window.aashiyana?.navigate(target, false);
  }, 0);
}

export async function render(container, { user } = {}) {
  try {
    mountedContainer = container;
    renderedLocale = getLocale();
    const currentUser = await refreshUser(user);

    const path = window.location.pathname;
    const query = new URLSearchParams(window.location.search);
    const view = query.get('view');



    const hasOAuthResult = query.has('sync_ok') || query.has('sync_error');

    if (path === SETTINGS_ROOT) {
      if (hasOAuthResult) {
        const target = `${SYNC_CALENDAR_LEAF}?${query.toString()}`;
        if (findSettingsLeaf(SYNC_CALENDAR_LEAF, currentUser)) {
          await redirectTo(target);
          return;
        }
      }

      // Zuletzt besuchtes Blatt wiederherstellen; ohne gespeichertes Ziel bleibt

      // landen zu lassen (Critique 2026-07-27).
      const destination = OVERVIEW_VIEWS.has(view)
        ? null
        : readStoredSettingsDestination(currentUser);
      if (destination) { await redirectTo(destination); return; }

      const domainId = view === 'domain' ? query.get('domain') : null;
      const known = filterSettingsDomains(currentUser).some((d) => d.id === domainId);
      await renderSettingsShell(container, {
        user: currentUser,
        view: known ? 'domain' : 'domains',
        domainId: known ? domainId : null,
        query,
      });
      return;
    }

    // Direkter Aufruf eines Blatts: Rollen-Guard + Persistenz.
    const leaf = findSettingsLeaf(path, currentUser);
    if (!leaf) {
      sessionStorage.setItem('aashiyana:settings:notice', 'accessRedirected');
      await redirectTo(ACCOUNT_LEAF);
      return;
    }


    if (leaf.path !== path) { await redirectTo(leaf.path); return; }

    try {
      sessionStorage.setItem(SETTINGS_STORAGE_KEY, leaf.path);
    } catch {

    }

    await renderSettingsShell(container, { user: currentUser, leaf, query });
  } catch (error) {
    container.replaceChildren();
    throw error;
  }
}

// Soft-Navigation innerhalb der Einstellungen (vom Router aufgerufen): tauscht



export async function update({ user, path, query } = {}) {
  if (!mountedContainer?.isConnected) return false;



  const currentLocale = getLocale();
  const localeChanged = renderedLocale !== currentLocale;
  renderedLocale = currentLocale;

  const search = query ?? new URLSearchParams();
  const view = search.get('view');
  const hasOAuthResult = search.has('sync_ok') || search.has('sync_error');

  if (path === SETTINGS_ROOT) {
    if (hasOAuthResult || !OVERVIEW_VIEWS.has(view)) return false;
    const domainId = view === 'domain' ? search.get('domain') : null;
    const domains = filterSettingsDomains(user);
    const resolvedView = view === 'domain' && domains.some((domain) => domain.id === domainId)
      ? 'domain'
      : 'domains';
    await renderSettingsShell(mountedContainer, {
      user,
      view: resolvedView,
      domainId: resolvedView === 'domain' ? domainId : null,
      query: search,
      incremental: !localeChanged,
    });
    return true;
  }

  const leaf = findSettingsLeaf(path, user);

  if (!leaf || leaf.path !== path) return false;

  try {
    sessionStorage.setItem(SETTINGS_STORAGE_KEY, leaf.path);
  } catch {

  }

  await renderSettingsShell(mountedContainer, { user, leaf, query: search, incremental: !localeChanged });
  return true;
}
