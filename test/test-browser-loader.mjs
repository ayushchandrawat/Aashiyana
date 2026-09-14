
const STUBS = {
  '/sw-register.js': `
    export function clearApiCache() {}
  `,
  '/api.js': `








    // ihn mitten im Text.
    const viaStub = (name, args, fallback) => (
      typeof globalThis.__apiStub?.[name] === 'function'
        ? globalThis.__apiStub[name](...args)
        : fallback
    );
    export const api = {
      get: async (...a) => viaStub('get', a, { data: null }),


      // nicht pruefen, nichts davon wissen muessen.
      getWithSource: async (...a) => (
        typeof globalThis.__apiStub?.getWithSource === 'function'
          ? globalThis.__apiStub.getWithSource(...a)
          : { data: await viaStub('get', a, { data: null }), fromCache: false }
      ),
      post: async (...a) => viaStub('post', a, { data: null }),
      put: async (...a) => viaStub('put', a, { data: null }),
      patch: async (...a) => viaStub('patch', a, { data: null }),
      delete: async (...a) => viaStub('delete', a, { data: null }),
    };
    export const auth = {
      me: async () => ({ user: null }),
      getUsers: async () => ({ data: [] }),
      logout: async () => ({ ok: true }),
      updateProfile: async () => ({ user: null }),
    };
    export const notifications = {
      providers: async () => ({ data: [] }),
      listChannels: async () => ({ data: [] }),
      createChannel: async () => ({ data: null }),
      updateChannel: async () => ({ data: null }),
      deleteChannel: async () => ({ data: null }),
      testChannel: async () => ({ data: null }),
    };
    export const recipeProviders = {
      listAccounts: async () => ({ data: [] }),
      createAccount: async () => ({ data: null }),
      updateAccount: async () => ({ data: null }),
      deleteAccount: async () => ({ data: null }),
      testAccount: async () => ({ data: null }),
      syncAccount: async () => ({ data: null }),
      getStatus: async () => ({ data: [] }),
    };
  `,
  '/i18n.js': `
    export const t = (key, values = {}) => {
      if (!values || Object.keys(values).length === 0) return key;
      return key + JSON.stringify(values);
    };
    export const initI18n = async () => {};
    export const setLocale = async () => {};


    export const getLocale = () => globalThis.__locale ?? 'de';




    export const getFormatLocale = () => globalThis.__formatLocale ?? 'de';
    export const getNumberFormat = (options = {}) =>
      new Intl.NumberFormat(globalThis.__formatLocale ?? 'de', options);
    export const getSupportedLocales = () => ['de', 'en'];
    export const formatDate = (d) => String(d);
    export const formatDayMonth = (d) => String(d);
    export const formatTime = (d) => String(d);
    export const getTimeFormat = () => '24h';
    export const timeSuffix = () => '';
    export const dateInputPlaceholder = () => 'YYYY-MM-DD';
    export const formatDateInput = (d) => String(d ?? '');
    export const parseDateInput = (d) => String(d ?? '');
    export const isDateInputValid = () => true;
    export const formatTimeInput = (d) => String(d ?? '');
    export const parseTimeInput = (d) => String(d ?? '');
    export const timeInputPlaceholder = () => 'HH:MM';
  `,
  '/rrule-ui.js': `
    export const renderRRuleFields = () => '';
    export const bindRRuleEvents = () => {};
    export const getRRuleValues = () => ({});
    export const describeRRule = () => '';
    export const recurrenceRow = () => ({ icon: 'repeat', label: '', value: '' });
  `,
  '/components/modal.js': `
    export const openModal = (...args) => globalThis.__openModal?.(...args);
    export const closeModal = () => {};
    export const confirmModal = async () => true;
    export const confirmOverModal = async (...args) => globalThis.__confirmOverModal?.(...args) ?? true;
    export const selectModal = async () => null;
    export const advancedSection = (inner = '') => String(inner);
    export const wireBlurValidation = () => {};
    export const reportFieldError = () => false;
    export const mountFooter = () => null;
    export const refreshDirtySnapshot = () => {};
    export const captureModalContext = () => globalThis.__modalContextId?.() ?? 'test-modal-context';
    export const isModalContextCurrent = (context) => (
      globalThis.__modalContextId?.() === undefined
        ? true
        : globalThis.__modalContextId() === context
    );
    export const focusFirstField = () => null;
    export const updateHeaderAction = () => null;
    export const validateAll = () => true;
    export const promptModal = async (...args) => globalThis.__promptModal?.(...args) ?? null;
    export const btnLoading = () => {};
    export const btnSuccess = () => {};
    export const btnError = () => {};
    export const refocusAfterRender = () => {};
    export const forgetRestore = () => {};
  `,
  '/components/detail-view.js': `
    export const openDetailView = () => ({ update: () => true, isOpen: () => true });
    export const closeDetailView = () => {};
    export const detailRowEl = () => null;
    export const visibilityRow = () => ({ icon: 'users', label: '', value: '' });
    export const assignedRow = () => ({ icon: 'user', label: '', value: '' });
  `,
  '/utils/ux.js': `
    export const stagger = () => {};
    export const vibrate = () => {};
    export const wireScrollFade = () => ({ update: () => {}, destroy: () => {} });

    // setzen globalThis.__undoStub = (opts) => {} und bekommen commit/restore

    export const scheduleUndoableDelete = (opts) => { globalThis.__undoStub?.(opts); };


    export const animationSettled = () => Promise.resolve();
  `,
  '/utils/html.js': `
    export const esc = (value) => String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
    export const fmtLocation = (value) => String(value ?? '');
    export const renderMarkdownLight = (value) => String(value ?? '');
  `,
  '/reminders.js': `
    export const refresh = async () => {};
  `,
  '/components/user-multi-select.js': `
    export const renderUserMultiSelect = () => '';
    export const getSelectedUserIds = () => [];
    export const bindUserMultiSelect = () => {};
    export const renderAvatarStack = () => '';
  `,
  '/utils/shopping-categories.js': `
    export const DEFAULT_CATEGORY_NAME = 'Sonstiges';
    export const categoryLabel = (category) => category?.name ?? String(category ?? '');
  `,
  '/utils/kitchen-tabs.js': `
    export const renderKitchenTabsBar = () => {};
    export const refreshKitchenBadges = () => {};
  `,
  '/utils/pwa-install.js': `
    export const getPwaInstallState = () => ({
      installed: false,
      ios: false,
      canPrompt: false,
      supported: false,
    });
    export const onPwaInstallStateChanged = () => () => {};
    export const promptPwaInstall = async () => ({ outcome: 'unavailable' });
  `,








};

export async function resolve(specifier, context, nextResolve) {
  if (STUBS[specifier]) {
    return {
      shortCircuit: true,
      url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}`,
    };
  }
  // Browser-absolute paths (/foo.js, /utils/bar.js) → public/foo.js, public/utils/bar.js

  if (specifier.startsWith('/') && !specifier.startsWith('//')) {
    const resolved = new URL('../public' + specifier, import.meta.url).href;
    return nextResolve(resolved, context);
  }
  return nextResolve(specifier, context);
}
