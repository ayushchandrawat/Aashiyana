
import { clearApiCache } from '/sw-register.js';
import { setPermissions, clearPermissions } from '/permissions.js';
import { setHouseholdSize, clearHouseholdSize } from '/utils/household.js';
import { forgetLayoutHint } from '/utils/dashboard-layout-hint.js';

const API_BASE = '/api/v1';

let _csrfToken = '';

function getCsrfToken() {
  if (_csrfToken) return _csrfToken;
  return document.cookie.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('csrf-token='))
    ?.slice('csrf-token='.length) ?? '';
}

async function apiFetch(path, options = {}, _retried = false) {
  const url = `${API_BASE}${path}`;

  const method = options.method ?? 'GET';
  const stateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);


  const { headers: optionHeaders = {}, withSource = false, ...fetchOptions } = options;

  let response;
  try {
    response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...fetchOptions,
      headers: {
        'Content-Type': 'application/json',
        ...(stateChanging ? { 'X-CSRF-Token': getCsrfToken() } : {}),
        ...optionHeaders,
      },
    });
  } catch (err) {
    // Offline/Netzfehler bei state-changing Requests (POST/PUT/PATCH/DELETE):


    if (stateChanging) throw new ApiError('offline', 0);
    throw err;
  }

  if (response.status === 401) {





    if (path !== '/auth/login' && path !== '/auth/2fa/verify') {
      window.dispatchEvent(new CustomEvent('auth:expired'));
      throw new Error('Sitzung abgelaufen.');
    }

  }

  // CSRF-Token-Desync (haeufig nach iOS-PWA-Resume): einmal GET /auth/me

  if (response.status === 403 && stateChanging && !_retried) {


    const errorCsrf = response.headers.get('X-CSRF-Token');
    if (errorCsrf) {
      _csrfToken = errorCsrf;
      return apiFetch(path, options, true);
    }
    // Fallback: /auth/me aufrufen um Token zu erneuern
    const meRes = await fetch(`${API_BASE}/auth/me`, { credentials: 'same-origin', cache: 'no-store' });
    if (meRes.status === 401) {
      window.dispatchEvent(new CustomEvent('auth:expired'));
      throw new Error('Sitzung abgelaufen.');
    }
    const meData = await meRes.json().catch(() => null);
    if (meData?.csrfToken) _csrfToken = meData.csrfToken;
    return apiFetch(path, options, true);
  }


  const csrfHeader = response.headers.get('X-CSRF-Token');
  if (csrfHeader) _csrfToken = csrfHeader;

  const data = await response.json().catch(() => null);


  if (data?.csrfToken) _csrfToken = data.csrfToken;

  if (!response.ok) {
    const message = data?.error || `HTTP ${response.status}`;
    throw new ApiError(message, response.status, data, response.headers.get('Retry-After'));
  }

  if (stateChanging) notifyCountedMutation(path);


  // Offline-Cache des Service Workers?
  //





  //



  if (withSource) return { data, fromCache: response.headers.has('x-cached-at') };

  return data;
}

const COUNTED_PATHS = ['/tasks', '/shopping', '/rewards', '/health', '/birthdays', '/inventory'];

function notifyCountedMutation(path) {
  const base = path.split('?')[0];
  if (!COUNTED_PATHS.some((prefix) => base === prefix || base.startsWith(`${prefix}/`))) return;

  // fehlender Zaehler darf keinen Schreibvorgang scheitern lassen.
  try { window.aashiyana?.invalidateModuleCounts?.(); } catch { /* siehe oben */ }
}

/**
 * Strukturierter API-Fehler mit HTTP-Status-Code.
 */
class ApiError extends Error {
  constructor(message, status, data = null, retryAfter = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.retryAfter = retryAfter;
  }
}

// --------------------------------------------------------
// Convenience-Methoden
// --------------------------------------------------------

const api = {
  get: (path) => apiFetch(path, { method: 'GET' }),

  getWithSource: (path) => apiFetch(path, { method: 'GET', withSource: true }),

  post: (path, body, opts = {}) => apiFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
    ...opts,
  }),

  rawPost: (path, body, headers = {}) => apiFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      ...headers,
    },
    body,
  }),

  // opts (z. B. { keepalive: true }) siehe delete unten — auch Serien-Scope-

  put: (path, body, opts = {}) => apiFetch(path, {
    method: 'PUT',
    body: JSON.stringify(body),
    ...opts,
  }),



  // Vorrats-Steppers, dessen PATCH 450ms gedebounced ist.
  patch: (path, body, opts = {}) => apiFetch(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
    ...opts,
  }),

  // opts erlaubt fetch-Optionen wie { keepalive: true } — genutzt vom


  delete: (path, opts = {}) => apiFetch(path, { method: 'DELETE', ...opts }),
};

// --------------------------------------------------------
// Auth-spezifische Methoden
// --------------------------------------------------------

const auth = {
  login: async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    setPermissions(res?.permissions);
    setHouseholdSize(res?.householdSize);
    return res;
  },


  verifyTwoFactor: async (code) => {
    const res = await api.post('/auth/2fa/verify', { code });
    setPermissions(res?.permissions);
    setHouseholdSize(res?.householdSize);
    return res;
  },
  // Verwaltung des eigenen zweiten Faktors.
  getTwoFactor: () => api.get('/auth/2fa'),
  setupTwoFactor: () => api.post('/auth/2fa/setup', {}),
  enableTwoFactor: (code) => api.post('/auth/2fa/enable', { code }),
  disableTwoFactor: (code) => api.post('/auth/2fa/disable', { code }),
  regenerateRecoveryCodes: (code) => api.post('/auth/2fa/recovery-codes', { code }),
  logout: async () => {
    try {
      return await api.post('/auth/logout');
    } finally {
      clearPermissions();
      clearHouseholdSize();




      clearApiCache();



      forgetLayoutHint();
    }
  },
  me: async () => {
    const res = await api.get('/auth/me');
    setPermissions(res?.permissions);

    // niemand einzeln holen soll: die Haushaltsgroesse (utils/household.js).
    setHouseholdSize(res?.householdSize);
    return res;
  },
  setup: (username, display_name, password) => api.post('/auth/setup', { username, display_name, password }),
  signup: (username, display_name, password) =>
  api.post('/auth/signup', { username, display_name, password }),
  getUsers: () => api.get('/auth/users'),






  createUser: async (data) => {
    const res = await api.post('/auth/users', data);
    await auth.me().catch(() => {});
    return res;
  },
  updateUser: (id, data) => api.patch(`/auth/users/${id}`, data),
  updateProfile: (data) => api.patch('/auth/me/profile', data),
  markOnboardingSeen: () => api.post('/auth/onboarding-seen', {}),
  deleteUser: async (id) => {
    const res = await api.delete(`/auth/users/${id}`);
    await auth.me().catch(() => {});
    return res;
  },
  forgotPassword: (identifier) => api.post('/auth/forgot-password', { identifier }),
  resetPassword: (token, password) => api.post('/auth/reset-password', { token, password }),
  passwordResetAvailable: async () => {
    try {
      return (await api.get('/version'))?.password_reset_enabled !== false;
    } catch {
      return true;
    }
  },
  passwordLoginEnabled: async () => {
    try {
      return (await api.get('/auth/oidc/config'))?.password_login_enabled !== false;
    } catch {
      return true;
    }
  },


  createInvite: (data) => api.post('/auth/invites', data),
  getInvites: () => api.get('/auth/invites'),
  revokeInvite: (id) => api.delete(`/auth/invites/${id}`),
  previewInvite: (token) => api.get(`/auth/invites/preview?token=${encodeURIComponent(token)}`),
  acceptInvite: (data) => api.post('/auth/invites/accept', data),
};

// --------------------------------------------------------
// E-Mail (SMTP) – Admin-Konfiguration
// --------------------------------------------------------

const email = {
  getConfig: () => api.get('/email/config'),
  saveConfig: (cfg) => api.put('/email/config', cfg),
  test: (to) => api.post('/email/test', to ? { to } : {}),
};

const notifications = {
  providers: () => api.get('/notifications/providers'),
  listChannels: () => api.get('/notifications/channels'),
  createChannel: (body) => api.post('/notifications/channels', body),
  updateChannel: (id, body) => api.put(`/notifications/channels/${id}`, body),
  deleteChannel: (id) => api.delete(`/notifications/channels/${id}`),
  testChannel: (id) => api.post(`/notifications/channels/${id}/test`, {}),
};

// --------------------------------------------------------
// Recipe Providers – Rezept-Mirror-Sync (Mealie, Tandoor, ...)
// --------------------------------------------------------

const recipeProviders = {
  listAccounts: () => api.get('/recipe-providers/accounts'),
  createAccount: (body) => api.post('/recipe-providers/accounts', body),
  updateAccount: (id, body) => api.patch(`/recipe-providers/accounts/${id}`, body),
  deleteAccount: (id) => api.delete(`/recipe-providers/accounts/${id}`),
  testAccount: (id) => api.post(`/recipe-providers/accounts/${id}/test`, {}),
  syncAccount: (id) => api.post(`/recipe-providers/accounts/${id}/sync`, {}),
  getStatus: () => api.get('/recipe-providers/status'),
};

export { api, auth, email, notifications, recipeProviders, ApiError };
