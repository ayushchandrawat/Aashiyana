
import { api } from '/api.js';
import { t } from '/i18n.js';
import { isPushSubscribed } from '/push.js';
import { moduleIconEl } from '/nav-icons.js';
import { toastSurface } from '/utils/toast-surface.js';

// --------------------------------------------------------
// Konfiguration
// --------------------------------------------------------

const POLL_INTERVAL_MS = 60_000; // 1 Minute



const MAX_DEFERRED_RETRIES = 5;

// --------------------------------------------------------
// Zustand
// --------------------------------------------------------

let _pollTimer     = null;
let _shownIds      = new Set();
let _isInitialized = false;
let _deferredRetries = 0;

// --------------------------------------------------------
// Browser-Benachrichtigungen
// --------------------------------------------------------

function notificationStatus() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

/**
 * Browser-Benachrichtigung anfordern.
 * @returns {Promise<'granted'|'denied'|'default'>}
 */
async function requestPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}

function showBrowserNotification(title, body) {
  if (isPushSubscribed()) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, icon: '/icons/icon-192.png' });
    setTimeout(() => n.close(), 8000);
  } catch {

  }
}

// --------------------------------------------------------
// Bell-Badge (Sidebar / Bottom-Nav)
// --------------------------------------------------------

function updateBellBadge(count) {
  const navLabel = count > 0
    ? t(count === 1 ? 'reminders.pendingBadgeTitle' : 'reminders.pendingBadgeTitlePlural', { count })
    : t('nav.reminders');
  document.querySelectorAll('[data-route="/reminders"]').forEach((navItem) => {
    navItem.setAttribute('aria-label', navLabel);
  });
  document.querySelectorAll('.reminder-bell-badge').forEach((badge) => {
    if (count > 0) {
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = count > 9 ? '9+' : String(count);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  });
}

// --------------------------------------------------------
// SVG-Helfer (DOM-API, kein innerHTML)
// --------------------------------------------------------

function createBellSvg() {
  const NS  = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');

  const path1 = document.createElementNS(NS, 'path');
  path1.setAttribute('d', 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9');
  const path2 = document.createElementNS(NS, 'path');
  path2.setAttribute('d', 'M13.73 21a2 2 0 0 1-3.46 0');

  svg.appendChild(path1);
  svg.appendChild(path2);
  return svg;
}

// --------------------------------------------------------
// Herkunft einer Erinnerung (Markensiegel, Block 2)
// --------------------------------------------------------

const REMINDER_ORIGINS = {
  task:                   { accent: 'var(--module-tasks)',     icon: 'check-square', labelKey: 'nav.tasks' },
  event:                  { accent: 'var(--module-calendar)',  icon: 'calendar',     labelKey: 'nav.calendar' },
  subscription:           { accent: 'var(--module-budget)',    icon: 'wallet',       labelKey: 'subscriptions.tabLabel' },
  inventory_item:         { accent: 'var(--module-inventory)', icon: 'package',      labelKey: 'nav.inventory' },
  inventory_tracked_date: { accent: 'var(--module-inventory)', icon: 'package',      labelKey: 'nav.inventory' },
  pantry_item:            { accent: 'var(--module-pantry)',    icon: 'archive',      labelKey: 'nav.pantry' },
  cycle_period:           { accent: 'var(--module-health)',    icon: 'droplet',      labelKey: 'health.cycle.title' },
  cycle_log_nudge:        { accent: 'var(--module-health)',    icon: 'droplet',      labelKey: 'health.cycle.title' },
  schedule_entry:         { accent: 'var(--module-schedule)',  icon: 'calendar-clock', labelKey: 'nav.schedule' },
  schedule_extra_entry:   { accent: 'var(--module-schedule)',  icon: 'calendar-clock', labelKey: 'nav.schedule' },
  waste_pickup:           { accent: 'var(--module-waste)',     icon: 'trash-2',      labelKey: 'nav.waste' },
};

function createOriginSeal(entityType) {
  const origin = REMINDER_ORIGINS[entityType];
  const seal = document.createElement('span');



  seal.className = 'module-seal module-seal--sm';
  seal.setAttribute('aria-hidden', 'true');
  seal.style.setProperty('--seal-accent', origin?.accent ?? 'var(--module-reminders)');


  seal.appendChild(origin?.icon ? moduleIconEl(origin.icon) : createBellSvg());
  return seal;
}

// --------------------------------------------------------
// Erinnerungen anzeigen
// --------------------------------------------------------

function processReminders(reminders) {
  const newOnes = reminders.filter((r) => !_shownIds.has(r.id));
  if (!newOnes.length) return;

  let deferred = false;
  newOnes.forEach((reminder) => {

    //
    // Vorher wanderte jede Erinnerung in `_shownIds`, BEVOR feststand, ob sie





    if (!showReminderToast(reminder)) { deferred = true; return; }
    _shownIds.add(reminder.id);
    const labelKey = REMINDER_ORIGINS[reminder.entity_type]?.labelKey;
    showBrowserNotification(
      labelKey ? t(labelKey) : t('reminders.toastTitle'),
      reminder.entity_title || ''
    );
  });





  if (deferred && _deferredRetries < MAX_DEFERRED_RETRIES) {
    _deferredRetries += 1;
    setTimeout(poll, 500);
  } else if (!deferred) {
    _deferredRetries = 0;
  }
}

function cycleReminderBody(reminder) {
  if (reminder.entity_type === 'cycle_log_nudge') return t('health.cycle.settings.remindLogDaily');
  if (reminder.entity_type === 'cycle_period') return `${t('health.cycle.status.nextPeriod')} - ${reminder.entity_title}`;
  return null;
}

function showReminderToast(reminder) {



  const container = toastSurface('polite');
  if (!container) return false;

  const existing = container.querySelectorAll('.toast');
  if (existing.length >= 3) existing[0].remove();

  const toast = document.createElement('div');
  toast.className = 'toast toast--reminder';
  toast.setAttribute('role', 'alert');
  toast.dataset.reminderId = reminder.id;

  const seal = createOriginSeal(reminder.entity_type);

  const textSpan = document.createElement('span');
  textSpan.className = 'toast__reminder-text';

  const titleEl = document.createElement('strong');
  titleEl.textContent = t('reminders.toastTitle');

  const bodyEl = document.createElement('span');
  bodyEl.textContent = cycleReminderBody(reminder) ?? reminder.entity_title ?? '';







  textSpan.appendChild(titleEl);
  textSpan.appendChild(bodyEl);

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'toast__undo';
  dismissBtn.textContent = t('reminders.dismiss');
  dismissBtn.addEventListener('click', () => {
    dismissReminder(reminder.id);
    toast.remove();
  });

  toast.appendChild(seal);
  toast.appendChild(textSpan);
  toast.appendChild(dismissBtn);
  container.appendChild(toast);

  // Reminder-Toasts bleiben 30 Sekunden sichtbar
  const dismissTimer = setTimeout(() => {
    toast.classList.add('toast--out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, 30_000);

  toast.addEventListener('click', (e) => {
    if (e.target === dismissBtn) return;
    clearTimeout(dismissTimer);
    dismissReminder(reminder.id);
    toast.remove();
  });

  return true;
}

// --------------------------------------------------------
// API-Aktionen
// --------------------------------------------------------

/**
 * Verwirft eine Erinnerung serverseitig.
 * @param {number} id
 */
async function dismissReminder(id) {
  try {
    await api.patch(`/reminders/${id}/dismiss`, {});
    _shownIds.delete(id);
  } catch {
    // Netzwerkfehler ignorieren
  }
}

async function poll() {
  try {
    const data = await api.get('/reminders/pending');
    const reminders = data.data ?? [];
    updateBellBadge(reminders.length);
    processReminders(reminders);
  } catch {
    // Polling-Fehler ignorieren (kann Offline-Zustand sein)
  }
}

// --------------------------------------------------------

// --------------------------------------------------------

/**
 * Startet das Reminder-Polling. Idempotent.
 */
function init() {
  if (_isInitialized) return;
  _isInitialized = true;
  poll();
  _pollTimer = setInterval(poll, POLL_INTERVAL_MS);
}

function stop() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  _isInitialized = false;
  _shownIds.clear();
  _deferredRetries = 0;
  updateBellBadge(0);
}

function refresh() {
  poll();
}

export { init, stop, refresh, requestPermission, notificationStatus };
