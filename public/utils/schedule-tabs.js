


// laeuft ueber dessen update()-Funktion (siehe router.js' Registrierung und

// gleichzeitig im DOM) authort Schedule seine Tab-Leiste weiterhin selbst

// gemeinsamen Leisten-Renderer.
export const SCHEDULE_ROUTES = Object.freeze([
  '/schedule',
  '/schedule/shifts',
  '/schedule/patterns',
  '/schedule/statistics',
  '/schedule/overview',
]);

const TAB_IDS = new Set(['shifts', 'patterns', 'statistics', 'overview']);

export function scheduleViewFromPath(path) {
  if (typeof path !== 'string') return null;
  const tab = path.slice('/schedule'.length).replace(/^\/+/, '');
  return TAB_IDS.has(tab) ? tab : null;
}

export function scheduleRouteForView(view) {
  return `/schedule/${view}`;
}
