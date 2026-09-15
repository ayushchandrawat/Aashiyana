
import { api, auth } from '/api.js';
import { createPageController } from '/utils/page-lifecycle.js';
import { canSeeWidget, moduleAccess } from '/permissions.js';
import { t, formatDate, formatTime, timeSuffix, getLocale, getNumberFormat } from '/i18n.js';
import { getReadableTextColor, AVATAR_FALLBACK_COLOR } from '/utils/color.js';
import { resolveEventColor } from '/utils/event-color.js';
import { esc, fmtLocation, renderMarkdownLight } from '/utils/html.js';


import { toLocalDateKey, parseLocalDateKey, addLocalDays, todayKey as householdToday } from '/utils/date.js';
import { nowFields, zonedUTCProxy, zonedDateKey, zonedTimeKey } from '/utils/timezone.js';
import { predictCycle, PHASE } from '/utils/health-cycle.js';
import { localizeBirthdayEvent } from '/utils/birthday-event.js';
import { countdownPhrase, countdownRank } from '/utils/countdown.js';
import { findPageFab } from '/utils/fab.js';
import { openModal, closeModal, confirmModal } from '/components/modal.js';
import { renderAvatarStack } from '/components/user-multi-select.js';
import { isSoloHousehold } from '/utils/household.js';
import {
  WIDGET_SIZE_PRESETS, WIDGET_SIZE_OPTIONS,
  COCKPIT_COVERED_WIDGETS,
  nearestPreset, isUserOrderedConfig, sameWidgetConfig,
  dashboardQuery,
} from '/utils/dashboard-widgets.js';
import {
  allWidgetIds,
  buildDefaultWidgetConfig,
  normalizeDashboardConfigWithExtensions,
  isExtensionWidget,
  getExtensionWidgetMeta,
} from '/utils/extension-widgets.js';
import { widgetDisplayLabel, optionFieldLabel } from '/utils/extension-i18n.js';
import { whoMark } from '/utils/seal-pair.js';
import { MODULE_ICON, moduleIconHTML } from '/nav-icons.js';
import { enterWallMode, exitWallMode, isWallActive, syncWallMode } from '/utils/wall-mode.js';
import { renderWallTimer, wireWallTimer } from '/components/wall-timer.js';
import { rememberLayoutHint, layoutHintSizes, layoutHintQuery } from '/utils/dashboard-layout-hint.js';
import { emptyHintHTML } from '/utils/empty-state.js';
import { quickLinkHost } from '/utils/quick-link-url.js';
import { hasIcon } from '/utils/lucide-icons.js';
import { prefersInkText } from '/utils/contrast.js';
import { openQuickLinksManager } from '/components/quick-links-manager.js';
import { attachOverlay } from '/utils/overlay-history.js';
import { mealTypeList, primeMealTypeNames } from '/utils/meal-types.js';
import { recipeThumbHtml, wireRecipeThumbs } from '/utils/recipe-thumb.js';
import { wireNoteCategoryOverflow } from '/utils/note-category-overflow.js';


let _fabController = null;

const noteCategoryName = (category) => String(category?.name || '');
const noteCategoryScope = (category) => t(
  category?.scope === 'personal' ? 'noteCategories.personal' : 'noteCategories.household',
);


// â”€â”€ Onboarding â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ONBOARDING_KEY = 'aashiyana-onboarded';


const ONBOARDING_TITLE_ID = 'onboarding-step-title';
const APP_NAME_STORAGE_KEY = 'aashiyana-app-name';
const CUSTOMIZE_HINT_KEY = 'aashiyana-dash-customize-hint';

function eventOccurrenceDateKey(event) {
  const value = String(event?.start_datetime || '');
  if (!value) return '';
  if (value.length <= 10) return value.slice(0, 10);

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : toLocalDateKey(date);
}

// All-day events store start_datetime as a date-only key ("2026-07-10"). Parsing
// that with `new Date()` yields UTC midnight, which shifts the calendar day back
// one day west of UTC. Parse date-only values as local calendar dates so all-day
// events land on the correct day in the dashboard widget (issue #466).
function eventStartDate(event) {
  const value = String(event?.start_datetime || '');
  if (!value) return null;
  if (value.length <= 10) return parseLocalDateKey(value);
  return new Date(value);
}

function calendarEventRoute(event) {
  if (!event?.id) return '/calendar';
  const params = new URLSearchParams({ open: String(event.id) });
  const occurrenceDate = eventOccurrenceDateKey(event);
  if (/^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate)) params.set('date', occurrenceDate);
  return `/calendar?${params.toString()}`;
}

function getAppName() {
  return localStorage.getItem(APP_NAME_STORAGE_KEY) || 'Aashiyana';
}

function getOnboardingSteps() {
  const appName = getAppName();
  // Plattform-bewusste Copy (Critique P5/Paket 3): der allererste Eindruck darf


  // der Sidebar-Umbruch (layout.css, min-width: 1024px).
  const desktop = window.matchMedia('(min-width: 1024px)').matches;
  return [
    { icon: 'home',         title: t('onboarding.step1Title', { name: appName }), body: t('onboarding.step1Body') },
    { icon: 'navigation',   title: t('onboarding.step2Title'), body: t(desktop ? 'onboarding.step2BodyDesktop' : 'onboarding.step2Body') },
    { icon: 'plus-circle',  title: t('onboarding.step3Title'), body: t(desktop ? 'onboarding.step3BodyDesktop' : 'onboarding.step3Body') },
  ];
}

function showOnboarding(appContainer, onDone) {
  const steps = getOnboardingSteps();
  let current = 0;


  const previouslyFocused = document.activeElement;

  const overlay = document.createElement('div');
  overlay.className = 'onboarding-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');



  // (WCAG 4.1.2). `aria-modal` versteckt alles dahinter - was bleibt, muss
  // sich also selbst benennen.
  overlay.setAttribute('aria-labelledby', ONBOARDING_TITLE_ID);

  const onKeydown = (event) => {
    if (event.key === 'Escape') { finish(); return; }
    if (event.key !== 'Tab') return;


    // Tab-Druck neu ermitteln, da renderStep() den Karteninhalt austauscht.
    const focusables = overlay.querySelectorAll(
      'button, [href], input, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKeydown);

  function renderStep() {
    const step = steps[current];
    const isLast = current === steps.length - 1;
    overlay.replaceChildren();

    const card = document.createElement('div');
    card.className = 'onboarding-card';

    const icon = document.createElement('i');
    icon.dataset.lucide = step.icon;
    icon.className = 'onboarding-icon';
    icon.setAttribute('aria-hidden', 'true');

    const title = document.createElement('h2');
    title.className = 'onboarding-title';
    title.id = ONBOARDING_TITLE_ID;
    title.textContent = step.title;

    const body = document.createElement('p');
    body.className = 'onboarding-body';
    body.textContent = step.body;




    // (Critique 2026-08-27, Persona Sam).
    const dots = document.createElement('div');
    dots.className = 'onboarding-dots';
    dots.setAttribute('aria-hidden', 'true');
    steps.forEach((_, i) => {
      const dot = document.createElement('span');
      dot.className = `onboarding-dot${i === current ? ' onboarding-dot--active' : ''}`;
      dots.appendChild(dot);
    });
    const progress = document.createElement('p');
    progress.className = 'sr-only';
    progress.textContent = t('onboarding.stepProgress', { current: current + 1, total: steps.length });

    const actions = document.createElement('div');
    actions.className = 'onboarding-actions';

    const skipBtn = document.createElement('button');
    skipBtn.className = 'btn btn--ghost';
    skipBtn.textContent = t('onboarding.skip');
    skipBtn.addEventListener('click', finish);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn--primary';
    nextBtn.textContent = isLast ? t('onboarding.done') : t('onboarding.next');
    nextBtn.addEventListener('click', () => {
      if (isLast) { finish(); return; }
      current++;
      renderStep();
      if (window.lucide) window.lucide.createIcons({ el: overlay });
      nextBtn.focus();
    });

    if (!isLast) actions.appendChild(skipBtn);
    actions.appendChild(nextBtn);
    card.appendChild(icon);
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(dots);
    card.appendChild(progress);
    card.appendChild(actions);
    overlay.appendChild(card);

    if (window.lucide) window.lucide.createIcons({ el: overlay });
    setTimeout(() => nextBtn.focus(), 50);
  }

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    document.removeEventListener('keydown', onKeydown);
    localStorage.setItem(ONBOARDING_KEY, '1');




    // den aktuellen Browser ohnehin ab.
    auth.markOnboardingSeen().catch(() => {});


    const restoreTarget = (previouslyFocused && document.contains(previouslyFocused))
      ? previouslyFocused
      : document.body;
    overlay.classList.add('onboarding-overlay--out');
    overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
    // Fallback falls animationend nicht feuert (prefers-reduced-motion):
    setTimeout(() => overlay.remove(), 300);
    restoreTarget?.focus?.();
    onDone?.();
  }

  renderStep();
  appContainer.appendChild(overlay);


  attachOverlay(overlay, finish);
}



// Erststart sichtbar, wo sie sich wieder einblenden lassen. Danach nie wieder.
function maybeHintCustomize(container) {
  if (localStorage.getItem(CUSTOMIZE_HINT_KEY)) return;
  const btn = container.querySelector('#dashboard-customize-btn');
  if (!btn) return;
  const clear = () => {
    btn.classList.remove('dashboard-icon-btn--hint');
    localStorage.setItem(CUSTOMIZE_HINT_KEY, '1');
  };
  btn.classList.add('dashboard-icon-btn--hint');
  btn.addEventListener('click', clear, { once: true });
  setTimeout(clear, 6000);
}

// --------------------------------------------------------
// Widget-Definitionen (Reihenfolge = Standard-Layout)
// --------------------------------------------------------








// Wieder-Einblenden-Leiste dieselbe Sichtbarkeitsregel teilen.
const MODULE_FOR_WIDGET = { tasks: 'tasks', calendar: 'calendar', shopping: 'shopping', meals: 'meals', notes: 'notes', birthdays: 'birthdays', budget: 'budget', rewards: 'rewards', health: 'health', cycle: 'health', housekeeping: 'housekeeping', schedule: 'schedule', waste: 'waste' };

const WIDGETS_WITH_OPTIONS = new Set(['calendar', 'tasks', 'notes', 'waste']);

const _extensionWidgetModules = new Map();

function widgetHasOptions(id) {
  if (WIDGETS_WITH_OPTIONS.has(id)) return true;
  const meta = getExtensionWidgetMeta(id);
  return Boolean(meta?.optionsSchema && Object.keys(meta.optionsSchema).length);
}

async function mountExtensionWidgets(shell, cfg, user) {
  const mounts = shell.querySelectorAll('[data-extension-widget-mount]');
  await Promise.all([...mounts].map(async (mount) => {
    const wrapper = mount.closest('[data-widget-id]');
    const id = wrapper?.dataset?.widgetId;
    if (!id) return;
    const w = cfg.find((item) => item.id === id);
    const meta = getExtensionWidgetMeta(id);
    if (!meta?.entry) return;
    try {
      let mod = _extensionWidgetModules.get(meta.entry);
      if (!mod) {
        mod = await import(/* webpackIgnore: true */ meta.entry);
        _extensionWidgetModules.set(meta.entry, mod);
      }
      mount.replaceChildren();
      if (typeof mod.renderWidget !== 'function') {
        throw new Error('renderWidget export missing');
      }
      await mod.renderWidget(mount, {
        size: w?.size,
        options: w?.options ?? {},
        user,
      });
      if (window.lucide) window.lucide.createIcons({ el: mount });
    } catch (err) {
      console.error(`[dashboard] Extension widget "${id}" konnte nicht gerendert werden`, err);
      mount.replaceChildren();
      mount.insertAdjacentHTML('afterbegin', renderWidgetError(id));
      if (window.lucide) window.lucide.createIcons({ el: mount });
    }
  }));
}

let countdownAvailable = false;

function setCountdownAvailability(items) {
  countdownAvailable = Array.isArray(items) && visibleCountdowns(items).length > 0;
}





//







function visibleCountdowns(items) {
  return (Array.isArray(items) ? items : []).filter((c) => {
    const mod = c.source === 'task' ? 'tasks' : 'calendar';
    return !window.aashiyana?.isModuleDisabled(mod);
  });
}

function isWidgetModuleEnabled(id) {
  if (isExtensionWidget(id)) {
    const meta = getExtensionWidgetMeta(id);
    if (!meta) return false;
    if (meta.permissionModuleKey && moduleAccess(meta.permissionModuleKey) === 'none') return false;
    if (!canSeeWidget(id)) return false;
    return true;
  }
  const mod = MODULE_FOR_WIDGET[id];
  if (mod && window.aashiyana?.isModuleDisabled(mod)) return false;
  // Rollen-/Mitglied-Rechte (#467): serverseitig gesperrtes Widget (bzw. Widget


  if (!canSeeWidget(id)) return false;






  if (id === 'family' && isSoloHousehold()) return false;
  if (id === 'countdown' && !countdownAvailable) return false;
  return true;
}

function setHtml(element, html) {
  element.replaceChildren();
  element.insertAdjacentHTML('afterbegin', html);
}

function widgetLabel(id) {
  const ext = getExtensionWidgetMeta(id);
  if (ext) return widgetDisplayLabel(ext);
  const map = {
    tasks:    () => t('nav.tasks'),
    calendar: () => t('nav.calendar'),
    shopping: () => t('nav.shopping'),
    meals:    () => t('nav.meals'),
    notes:    () => t('nav.notes'),
    weather:  () => t('dashboard.weather'),
    birthdays: () => t('nav.birthdays'),
    budget:   () => t('nav.budget'),
    rewards:  () => t('nav.rewards'),
    health:   () => t('nav.health'),
    cycle:    () => t('health.cycle.title'),
    housekeeping: () => t('nav.housekeeping'),
    schedule: () => t('nav.schedule'),
    waste:    () => t('nav.waste'),
    family:   () => t('dashboard.familyMembers'),
    clock:    () => t('dashboard.clock'),
    metrics:  () => t('dashboard.metrics'),
    countdown: () => t('dashboard.countdownTitle'),
    quicklinks: () => t('dashboard.quickLinksTitle'),
  };
  return (map[id] ?? (() => id))();
}

function widgetIcon(id) {
  const ext = getExtensionWidgetMeta(id);
  if (ext?.icon) return ext.icon;
  return MODULE_ICON[id] ?? MODULE_ICON.dashboard;
}

const BUDGET_CATEGORY_LABEL_KEYS = {
  housing: 'catHousing',
  food: 'catFood',
  transport: 'catTransport',
  personal_health: 'catPersonalHealth',
  leisure: 'catLeisure',
  shopping_clothing: 'catShoppingClothing',
  education: 'catEducation',
  financial_other: 'catFinancialOther',
  subscriptions: 'catSubscriptions',
  'Erwerbseinkommen': 'catEarnedIncome',
  'KapitalertrÃ¤ge': 'catInvestmentIncome',
  'Geschenke & Transfers': 'catTransferGiftIncome',
  'Sozialleistungen': 'catGovernmentBenefits',
  'Sonstiges Einkommen': 'catOtherIncome',
};

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

function firstName(displayName) {
  return String(displayName ?? '').trim().split(/\s+/)[0] || String(displayName ?? '');
}

function greeting(displayName) {
  const h = nowFields().hour;
  const name = esc(firstName(displayName));
  if (h >= 5 && h < 12) return t('dashboard.greetingMorning', { name });
  if (h >= 12 && h < 18) return t('dashboard.greetingDay',    { name });
  return t('dashboard.greetingEvening', { name });
}



function greetingPeriod() {
  const h = nowFields().hour;
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'day';
  return 'evening';
}

// Masthead-Datum nach Apple-Kanon (â€žMittwoch, 6. August"): Wochentag + Tag +

// (.dashboard-overview__date, text-transform). Bewusst lokales new Date()
// (reines Anzeige-Datum, keine ISO-Konvertierung - Zeitzonen-Falle).
function mastheadDateLabel(now = new Date()) {
  return new Intl.DateTimeFormat(getLocale(), {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  }).format(zonedUTCProxy(now));
}

// Relatives Datumslabel: â€žHeute"/â€žMorgen", sonst das locale-formatierte Datum.

// zusammengesetztes â€žDatum, Zeit" per Komma zu zerschneiden (locale-fragil:
// manche Locales setzen selbst ein Komma ins Datum).
function relativeDateLabel(value) {
  if (value === null || value === undefined || value === '') return '';
  const day = zonedDateKey(value);
  if (!day) return formatDate(value);
  const today = householdToday();
  if (day === today) return t('common.today');
  if (day === addLocalDays(today, 1)) return t('common.tomorrow');
  return formatDate(value);
}

function formatDateTime(isoString) {
  if (!isoString) return '';



  // Browser-Zone verwandelt; beide Formatierer unterscheiden sie selbst.
  const dateStr = relativeDateLabel(isoString);
  const timeStr = formatTime(isoString);
  const suffix = timeSuffix();
  return `${dateStr}, ${timeStr}${suffix ? ' ' + suffix : ''}`.trim();
}

/** 'YYYY-MM-DDTHH:mm' als Millisekunden - reine Feldarithmetik, kein Zeitpunkt. */
function wallStampMs(stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(stamp);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

function formatDueDate(dateStr, timeStr) {
  if (!dateStr) return null;

  const dayKey = String(dateStr).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;

  const dueTime = timeStr ? String(timeStr).slice(0, 5) : null;
  if (timeStr && !/^\d{2}:\d{2}$/.test(dueTime)) return null;


  const dueStamp = `${dayKey}T${dueTime ?? '23:59'}`;

  const now = nowFields();
  if (!now) return null;
  const p2 = (n) => String(n).padStart(2, '0');
  const todayKey = `${now.year}-${p2(now.month)}-${p2(now.day)}`;
  const nowStamp = `${todayKey}T${p2(now.hour)}:${p2(now.minute)}`;


  const overdue = dueStamp < nowStamp;
  const diffH = (wallStampMs(dueStamp) - wallStampMs(nowStamp)) / (1000 * 60 * 60);


  // aufeinanderfolgende Tage nicht 24h auseinander, ihre Keys aber immer genau
  // einen.
  const dayMs = (key) => wallStampMs(`${key}T00:00`);
  const calDayDiff = Math.round((dayMs(dayKey) - dayMs(todayKey)) / (1000 * 60 * 60 * 24));



  const fullLabel = dueTime
    ? `${formatDate(dueStamp)}, ${formatTime(dueStamp)}` // beide aus i18n.js
    : formatDate(dayKey);

  if (overdue) {
    return { text: `${t('dashboard.overdue')} â€“ ${fullLabel}`, overdue: true };
  }

  if (calDayDiff === 1 && Number(dueTime?.slice(0, 2)) >= 22 && diffH < 24) {
    return { text: `${t('dashboard.dueSoon')} â€“ ${fullLabel}`, overdue: false, soon: true };
  }

  if (calDayDiff === 0) {
    return { text: dueTime ? `${t('dashboard.dueToday')} â€“ ${formatTime(dueStamp)}` : t('dashboard.dueToday'), overdue: false, soon: true };
  }

  if (calDayDiff === 1) {



    return { text: dueTime ? `${t('dashboard.dueTomorrow')} â€“ ${formatTime(dueStamp)}` : t('dashboard.dueTomorrow'), overdue: false };
  }

  return { text: fullLabel, overdue: false };
}

const PRIORITY_LABELS = () => ({
  urgent: t('tasks.priorityUrgent'),
  high:   t('tasks.priorityHigh'),
  medium: t('tasks.priorityMedium'),
  low:    t('tasks.priorityLow'),
});

const MEAL_ORDER = Object.freeze(['breakfast', 'lunch', 'dinner', 'snack']);

function normalizeVisibleMealTypes(visibleMealTypes) {
  if (!Array.isArray(visibleMealTypes)) return MEAL_ORDER;
  const filtered = MEAL_ORDER.filter((type) => visibleMealTypes.includes(type));
  return filtered.length ? filtered : MEAL_ORDER;
}



// Planer daneben.
const MEAL_LABELS = () => Object.fromEntries(
  mealTypeList().map(({ key, label }) => [key, label]),
);

const MEAL_ICONS = {
  breakfast: 'sunrise',
  lunch:     'sun',
  dinner:    'moon',
  snack:     'apple',
};

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function budgetCategoryLabel(category) {
  const key = BUDGET_CATEGORY_LABEL_KEYS[category];
  return key ? t(`budget.${key}`) : (category || '-');
}

function formatCurrency(amount, currency = 'INR') {
  return getNumberFormat({
    style: 'currency',
    currency,
    maximumFractionDigits: Math.abs(amount) >= 1000 ? 0 : 2,
  }).format(amount || 0);
}

function formatPoints(value) {
  return getNumberFormat().format(Number(value) || 0);
}

function widgetHeader(widgetId, title, count, linkHref, linkLabel, sealSlug = null) {
  const icon = widgetIcon(widgetId);


  const customLabel = linkLabel != null;
  linkLabel = linkLabel ?? t('dashboard.allLink');







  const numericCount = Number(count);
  const badge = count != null && Number.isFinite(numericCount) && numericCount > 0
    ? `<span class="widget__badge">${count}</span>`
    : '';





  // Antwort auf dieselbe Frage gewesen.
  const link = linkHref
    ? `<a href="${linkHref}" data-route="${linkHref}" class="widget__link"
         aria-label="${esc(customLabel ? `${linkLabel}: ${title}` : t('dashboard.allLinkFor', { module: title }))}">
        ${linkLabel}
      </a>`
    : '';







  // Modultoene (Critique P2).
  //




  const slug = sealSlug ?? ((linkHref || '').split('/')[1] || '');
  const seal = slug ? ` style="--seal-accent: var(--module-${slug}, var(--color-accent))"` : '';




  return `
    <div class="widget__header">
      <h3 class="widget__title">
        <span class="module-seal module-seal--sm"${seal} aria-hidden="true">
          ${moduleIconHTML(icon)}
        </span>
        <span class="widget__title-text">${title}</span>
        ${badge}
      </h3>
      ${link}
    </div>
  `;
}




function emptyStateCta(route, label) {
  return `<button type="button" class="widget__empty-cta" data-route="${route}">
    <i data-lucide="plus" aria-hidden="true"></i>
    <span>${label}</span>
  </button>`;
}

function buildTodayHighlights(data) {
  const tasks = Array.isArray(data?.tasks)
    ? data.tasks
    : Array.isArray(data?.urgentTasks)
      ? data.urgentTasks
      : [];
  const events = Array.isArray(data?.events)
    ? data.events
    : Array.isArray(data?.upcomingEvents)
      ? data.upcomingEvents
      : [];
  const shoppingItems = Array.isArray(data?.shopping?.items) ? data.shopping.items : [];
  const shoppingLists = Array.isArray(data?.shoppingLists) ? data.shoppingLists : [];
  const meals = data?.meals ?? data?.todayMeals ?? null;

  const urgentTask = tasks.find((task) => task.priority === 'urgent') ?? tasks[0] ?? null;

  const today = householdToday();
  const todayEvents = events.filter((e) => {
    if (!e.start_datetime) return true;
    const dayKey = eventOccurrenceDateKey(e);
    return dayKey ? dayKey === today : true;
  });
  const nextEvent = todayEvents[0] ?? null;

  const openShoppingCount = shoppingItems.length
    ? shoppingItems.filter((item) => !item.is_checked).length
    : shoppingLists.reduce((sum, list) => {
        if (Number.isFinite(Number(list.open_count))) return sum + Number(list.open_count);
        if (Number.isFinite(Number(list.openCount))) return sum + Number(list.openCount);
        const items = Array.isArray(list.items) ? list.items : [];
        return sum + items.filter((item) => !item.is_checked).length;
      }, 0);
  const { meal, mealType } = selectTodayMeal(meals);

  return {
    urgentTask,
    nextEvent,
    openShoppingCount,
    meal,
    mealType,
    taskCount: tasks.length,
    eventCount: todayEvents.length,
  };
}

// Pick the meal relevant to the current time of day (matches greeting thresholds:
// morning â†’ breakfast, afternoon â†’ lunch, evening â†’ dinner). If the target meal
// is not planned, fall back to the next planned meal later today.
function selectTodayMeal(meals) {
  const order = ['breakfast', 'lunch', 'dinner'];
  const list = Array.isArray(meals)
    ? meals
    : meals && typeof meals === 'object'
      ? order.map((type) => (meals[type] ? { ...meals[type], meal_type: type } : null)).filter(Boolean)
      : [];

  const h = nowFields().hour;
  const targetType = h < 12 ? 'breakfast' : h < 18 ? 'lunch' : 'dinner';

  for (let i = order.indexOf(targetType); i < order.length; i++) {
    const found = list.find((m) => m.meal_type === order[i]);
    if (found) return { meal: found, mealType: order[i] };
  }
  return { meal: null, mealType: targetType };
}

// Nominale Slot-Zeiten der Mahlzeiten: Mahlzeiten tragen keine Uhrzeit, brauchen

// sie behaupten keine Essenszeit - deshalb erscheinen sie nie als Label.
const MEAL_SORT_TIME = { breakfast: '08:00', lunch: '12:30', snack: '15:30', dinner: '18:30' };

function buildTodayProgram(data, { includeTasks = true, includeCalendar = true, includeMeals = true } = {}) {
  const highlights = buildTodayHighlights(data);
  const todayKey = householdToday();
  const events = Array.isArray(data?.upcomingEvents) ? data.upcomingEvents : [];
  const rows = [];

  if (includeCalendar) {
    for (const event of events) {
      if (eventOccurrenceDateKey(event) !== todayKey) continue;
      const start = eventStartDate(event);
      const timed = !event.all_day && start && String(event.start_datetime).length > 10;
      rows.push({
        kind: 'event',
        objectId: event.id,
        sortKey: timed ? `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}` : '00:01',
        timeLabel: timed ? formatTime(start) : t('dashboard.allDay'),
        title: event.title,
        sub: t('dashboard.todayEvent'),
        icon: 'calendar',
        tone: 'event',
        route: calendarEventRoute(event),
        who: event.assigned_users?.[0] ?? null,
      });
    }
  }

  if (includeTasks) {
    const tasks = Array.isArray(data?.urgentTasks) ? data.urgentTasks : Array.isArray(data?.tasks) ? data.tasks : [];
    for (const task of tasks) {
      if (!task.due_date || task.due_date > todayKey) continue;
      const overdue = task.due_date < todayKey;
      const due = !overdue && task.due_time ? new Date(`${task.due_date}T${task.due_time}`) : null;
      const dueValid = due && !Number.isNaN(due.getTime());
      rows.push({
        kind: 'task',
        objectId: task.id,
        sortKey: overdue ? '00:00' : dueValid ? `${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}` : '00:02',
        timeLabel: overdue ? t('dashboard.overdue') : dueValid ? t('dashboard.todayUntil', { time: formatTime(due) }) : '',
        overdue,
        title: task.title,
        sub: t('dashboard.todayTask'),
        icon: 'check-square',
        tone: 'task',
        route: '/tasks',
        who: task.assigned_users?.[0] ?? null,
      });
    }
  }

  if (includeMeals && highlights.meal) {
    rows.push({
      kind: 'meal',
      objectId: highlights.meal.id ?? null,
      sortKey: MEAL_SORT_TIME[highlights.mealType] ?? MEAL_SORT_TIME.dinner,
      timeLabel: '',
      title: highlights.meal.title,
      sub: MEAL_LABELS()[highlights.mealType] ?? t('dashboard.todayDinner'),
      icon: MEAL_ICONS[highlights.mealType] ?? 'utensils',
      tone: 'dinner',
      route: '/meals',
      who: null,
    });
  }

  rows.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));




  const nextUpcoming = events.find((event) => eventOccurrenceDateKey(event) > todayKey) ?? null;






  const allTasks = Array.isArray(data?.urgentTasks) ? data.urgentTasks : Array.isArray(data?.tasks) ? data.tasks : [];
  const nextDueTask = allTasks.find((task) => task.due_date && task.due_date > todayKey) ?? null;

  return {
    rows,
    nextUpcoming,
    nextDueTask,
    openShoppingCount: highlights.openShoppingCount,
    tasksDoneToday: Number(data?.tasksDoneToday) || 0,
  };
}

// --------------------------------------------------------
// Skeleton
// --------------------------------------------------------

function skeletonWidget(lines = 3) {
  const lineHtml = Array.from({ length: lines }, (_, i) => `
    <div class="skeleton skeleton-line ${i % 2 === 0 ? 'skeleton-line--full' : 'skeleton-line--medium'}"></div>
  `).join('');
  return `
    <div class="widget-skeleton">
      <div class="skeleton skeleton-line skeleton-line--short"></div>
      ${lineHtml}
    </div>
  `;
}

// --------------------------------------------------------
// Widget-Renderer
// --------------------------------------------------------

function renderUrgentTasks(tasks) {
  if (!tasks.length) {
    return `<div class="widget widget--tasks">
      ${widgetHeader('tasks', t('nav.tasks'), 0, '/tasks')}
      <div class="widget__empty">
        <i data-lucide="check-circle" class="empty-state__icon" style="color:var(--color-success)" aria-hidden="true"></i>
        <div>${t('dashboard.allDone')}</div>
      </div>
    </div>`;
  }

  const items = tasks.map((t) => {
    const due = formatDueDate(t.due_date, t.due_time);
    return `
      <div class="task-item" data-task-id="${t.id}" data-task-title="${esc(t.title)}" role="button" tabindex="0">
        ${t.priority !== 'none' ? `<div class="task-item__priority task-item__priority--${t.priority}" title="${esc(PRIORITY_LABELS()[t.priority] ?? t.priority)}" aria-hidden="true"></div>` : ''}
        <span class="sr-only">${PRIORITY_LABELS()[t.priority] ?? t.priority}</span>
        <div class="task-item__content">
          <div class="task-item__title">${esc(t.title)}</div>
          ${due ? `<div class="task-item__meta ${due.overdue ? 'task-item__meta--overdue' : ''} ${due.soon ? 'task-item__meta--soon' : ''}">${due.text}</div>` : ''}
        </div>
        ${renderAvatarStack(t.assigned_users ?? [], { size: 28 })}
      </div>
    `;
  }).join('');

  return `<div class="widget widget--tasks">
    ${widgetHeader('tasks', t('nav.tasks'), tasks.length, '/tasks')}
    <div class="widget__body">${items}</div>
  </div>`;
}

function renderUpcomingEvents(events) {
  if (!events.length) {
    return `<div class="widget widget--calendar">
      ${widgetHeader('calendar', t('nav.calendar'), 0, '/calendar')}
      <div class="widget__empty">
        <i data-lucide="calendar-check" class="empty-state__icon" aria-hidden="true"></i>
        <div>${t('dashboard.noEvents')}</div>
      </div>
    </div>`;
  }



  const today = householdToday();
  const items = events.map((e) => {
    const d = eventStartDate(e) ?? new Date(e.start_datetime);
    const dayKey = eventOccurrenceDateKey(e);
    const isToday = dayKey === today;
    const _suffix = timeSuffix();
    const timeStr = e.all_day ? t('dashboard.allDay') : `${formatTime(d)}${_suffix ? ' ' + _suffix : ''}`.trim();
    return `
      <div class="event-item" data-route="${esc(calendarEventRoute(e))}" role="button" tabindex="0">
        <!-- Dieselbe Regel wie im Kalender, aus derselben Datei. Hier stand
             e.color || e.cal_color - dieselbe Frage ohne den Zweig fuer die
             zugewiesene Person, was seit #891 zwei verschiedene Antworten
             gegeben haette. -->
        <div class="event-item__bar" style="background-color:${esc(resolveEventColor(e))}"></div>
        <div class="event-item__content">
          <div class="event-item__title">${esc(e.title)}</div>
          <div class="event-item__time">
            <span class="event-time-badge ${isToday ? 'event-time-badge--today' : ''}">${isToday ? t('common.today') : relativeDateLabel(dayKey)}</span>
            ${timeStr}
            ${e.location ? ` Â· ${esc(fmtLocation(e.location))}` : ''}
            ${e.cal_name ? `<span class="event-item__cal">${esc(e.cal_name)}</span>` : ''}
          </div>
        </div>
        ${renderAvatarStack(e.assigned_users ?? [], { size: 28 })}
      </div>
    `;
  }).join('');

  return `<div class="widget widget--calendar">
    ${widgetHeader('calendar', t('nav.calendar'), events.length, '/calendar')}
    <div class="widget__body">${items}</div>
  </div>`;
}

const LIST_ROWS_SHORT = 3;
const LIST_ROWS_TALL = 5;

function listRowCap(size) {
  return Number(String(size ?? '1x1').split('x')[1]) >= 2 ? LIST_ROWS_TALL : LIST_ROWS_SHORT;
}

export function renderUpcomingBirthdays(allBirthdays, size) {




  const birthdays = allBirthdays.slice(0, listRowCap(size));
  if (!birthdays.length) {
    return `<div class="widget widget--birthdays">
      ${widgetHeader('birthdays', t('nav.birthdays'), 0, '/birthdays')}
      <div class="widget__empty">
        <i data-lucide="cake" class="empty-state__icon" aria-hidden="true"></i>
        <div>${t('dashboard.noBirthdays')}</div>
      </div>
    </div>`;
  }

  const items = birthdays.map((b) => {
    const daysLabel = b.days_until === 0
      ? t('common.today')
      : b.days_until === 1
        ? t('common.tomorrow')
        : t('dashboard.daysLeft', { count: b.days_until });






    const avatarStyle = b.family_user_color
      ? ` style="background-color:${esc(b.family_user_color)};color:${getReadableTextColor(b.family_user_color)}"`
      : '';
    const occasionLabel = b.kind === 'name_day'
      ? t('birthdays.nameDay')
      : b.next_age != null
        ? t('birthdays.turnsAge', { age: b.next_age })
        : '';
    return `
      <div class="birthday-widget-item" data-route="/birthdays" role="button" tabindex="0">
        <div class="birthday-widget-item__avatar"${avatarStyle}>
          ${b.photo_data ? `<img src="${esc(b.photo_data)}" alt="" loading="lazy">` : `<span>${esc(initials(b.name))}</span>`}
        </div>
        <div class="birthday-widget-item__body">
          <div class="birthday-widget-item__name">${esc(b.name)}</div>
          <div class="birthday-widget-item__meta">${formatDate(b.next_date ?? b.next_birthday)} Â· ${daysLabel}</div>
        </div>
        ${occasionLabel ? `<div class="birthday-widget-item__age">${esc(occasionLabel)}</div>` : ''}
      </div>
    `;
  }).join('');

  return `<div class="widget widget--birthdays">
    ${widgetHeader('birthdays', t('nav.birthdays'), birthdays.length, '/birthdays')}
    <div class="widget__body">${items}</div>
  </div>`;
}

function renderCountdowns(allItems, size, total = null) {
  const shown = visibleCountdowns(allItems);
  const items = shown.slice(0, listRowCap(size));



  if (!items.length) return '';

  const rows = items.map((c) => {
    const phrase = countdownPhrase(c.days_until);
    const label = phrase.count === undefined ? t(phrase.key) : t(phrase.key, { count: phrase.count });


    // den Modulton.
    const accent = c.color
      ? ` style="--countdown-accent:${esc(c.color)}"`
      : ` style="--countdown-accent:var(--module-${c.source === 'task' ? 'tasks' : 'calendar'}, var(--color-accent))"`;
    const anchor = c.source === 'task'
      ? ` data-task-id="${esc(String(c.id))}" data-task-title="${esc(c.title)}"`
      : ` data-route="/calendar?open=${encodeURIComponent(String(c.id))}&date=${encodeURIComponent(c.date)}"`;
    return `
      <div class="countdown-item" role="button" tabindex="0"${anchor}${accent}>
        <span class="countdown-item__icon" aria-hidden="true">
          <i data-lucide="${esc(c.icon || 'calendar')}"></i>
        </span>
        <div class="countdown-item__body">
          <div class="countdown-item__title">${esc(c.title)}</div>
          <div class="countdown-item__meta">${formatDate(c.date)}</div>
        </div>
        <div class="countdown-item__days countdown-item__days--${countdownRank(c.days_until)}">${esc(label)}</div>
      </div>
    `;
  }).join('');

  const gesamt = Number.isFinite(Number(total)) ? Number(total) : shown.length;
  const rest = Math.max(0, gesamt - items.length);
  const more = rest > 0
    ? `<p class="countdown-more">${esc(t('dashboard.countdownMore', { count: rest }))}</p>`
    : '';

  return `<div class="widget widget--countdown">
    ${widgetHeader('countdown', t('dashboard.countdownTitle'), gesamt, null, null, 'dashboard')}
    <div class="widget__body">${rows}${more}</div>
  </div>`;
}

function renderTodayMeals(meals, visibleMealTypes = MEAL_ORDER) {
  const mealLabels = MEAL_LABELS();
  const safeMeals = Array.isArray(meals) ? meals : [];
  const slots = normalizeVisibleMealTypes(visibleMealTypes).map((type) => {
    const meal = safeMeals.find((m) => m.meal_type === type);
    return `
      <div class="meal-slot ${meal ? 'meal-slot--filled' : ''}" data-type="${type}" data-route="/meals" role="button" tabindex="0">
        <div class="meal-slot__header">
          <span class="meal-slot__type">${mealLabels[type]}</span>
          <i data-lucide="${MEAL_ICONS[type]}" class="meal-slot__icon" aria-hidden="true"></i>
        </div>
        <div class="meal-slot__title${meal ? '' : ' meal-slot__title--empty'}">${meal


          // gleich aussehendes Platzhalter-Symbol daneben waere Unruhe ohne


          ? `${(meal.recipe_has_own_image || meal.recipe_has_image) ? recipeThumbHtml({
              recipeId: meal.recipe_id,
              hasImage: meal.recipe_has_image,
              hasOwnImage: meal.recipe_has_own_image,
              className: 'meal-slot__thumb',
            }) : ''}<span class="meal-slot__title-text">${esc(meal.title)}</span>`
          : 'â€”'}</div>
      </div>
    `;
  }).join('');

  return `<div class="widget widget--meals">
    ${widgetHeader('meals', t('dashboard.todayMeals'), null, '/meals', t('dashboard.weekLink'))}
    <div class="meals-widget">
      <div class="meal-slots">${slots}</div>
    </div>
  </div>`;
}

function renderPinnedNotes(allNotes, size) {
  const notes = allNotes.slice(0, listRowCap(size));
  if (!notes.length) {
    return `<div class="widget widget--notes">
      ${widgetHeader('notes', t('nav.notes'), 0, '/notes')}
      <div class="widget__empty">
        <i data-lucide="sticky-note" class="empty-state__icon" aria-hidden="true"></i>
        <div>${t('dashboard.noPinnedNotes')}</div>
      </div>
    </div>`;
  }



  // (Critique P5). 200 Zeichen decken die zwei sichtbaren Zeilen reichlich;


  const excerpt = (text) => {
    const s = String(text ?? '');
    if (s.length <= 200) return s;
    const cut = s.slice(0, 200);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 120))}â€¦`;
  };

  // stand unbedingt da, also trugen farblose Notizen `--note-color:;` - ein




  const items = notes.map((n) => `
    <div class="note-item" data-route="/notes"
         ${n.color ? `style="--note-color:${esc(n.color)};"` : ''}>
      <div class="note-item__body" role="link" tabindex="0">
      ${n.title ? `<div class="note-item__title">${esc(n.title)}</div>` : ''}
      <div class="note-item__content">${renderMarkdownLight(excerpt(n.content))}</div>
      </div>
      ${(n.categories || []).length ? `<div class="note-item__categories" role="group" aria-label="${esc(t('noteCategories.categories'))}">
        ${n.categories.map((category) => `<span class="note-item__category u-badge">${esc(noteCategoryName(category))}<span class="sr-only"> (${esc(noteCategoryScope(category))})</span></span>`).join('')}
        <button type="button" class="note-item__categories-more u-badge" aria-label="${esc(t('noteCategories.categories'))}" hidden></button>
      </div>` : ''}
    </div>
  `).join('');




  return `<div class="widget widget--notes">
    ${widgetHeader('notes', t('nav.notes'), notes.length, '/notes')}
    <div class="notes-grid-widget">${items}</div>
  </div>`;
}

function quickLinkMonogram(name) {


  const match = String(name ?? '').match(/\p{L}|\p{N}/u);
  return (match ? match[0] : '?').toUpperCase();
}

function renderQuickLinkTile(s) {
  const name = String(s.name ?? '');
  const host = quickLinkHost(s.url);


  //




  let face;
  if (s.icon_data) {
    face = `<img src="${esc(s.icon_data)}" alt="" loading="lazy">`;
  } else if (s.icon_name && hasIcon(s.icon_name)) {
    face = `<i data-lucide="${esc(s.icon_name)}" aria-hidden="true"></i>`;
  } else {
    face = `<span class="quick-link-tile__monogram" aria-hidden="true">${esc(quickLinkMonogram(name))}</span>`;
  }



  const ink = prefersInkText(s.color) ? ' quick-link-tile__face--ink' : '';


  // Notizen, siehe renderPinnedNotes).
  const tint = s.color ? ` style="--quick-link-color:${esc(s.color)};"` : '';






  // Auskunft darueber sein, wohin die Kachel fuehrt.
  return `<a class="quick-link-tile" href="${esc(s.url)}" target="_blank"
             title="${esc(`${name} - ${s.url}`)}"
             rel="noopener noreferrer" referrerpolicy="no-referrer"${tint}>
    <span class="quick-link-tile__face${ink}">${face}</span>
    <span class="quick-link-tile__name">${esc(name)}</span>
    ${host ? `<span class="quick-link-tile__host">${esc(host)}</span>` : ''}
    ${s.visibility === 'private'
      ? `<i data-lucide="lock" class="quick-link-tile__private" aria-label="${esc(t('quickLinks.privateBadge'))}"></i>`
      : ''}
  </a>`;
}

function renderQuickLinks(items) {
  const list = Array.isArray(items) ? items : [];
  const header = widgetHeader('quicklinks', t('dashboard.quickLinksTitle'), list.length, null, null, 'dashboard');

  if (!list.length) {




    return `<div class="widget widget--quicklinks">
      ${header}
      <div class="widget__empty">
        <i data-lucide="compass" class="empty-state__icon" aria-hidden="true"></i>
        <div>${t('quickLinks.emptyTitle')}</div>
        <button type="button" class="widget__empty-cta" data-quick-links-manage>
          <i data-lucide="plus" aria-hidden="true"></i>
          <span>${esc(t('quickLinks.addFirst'))}</span>
        </button>
      </div>
    </div>`;
  }

  return `<div class="widget widget--quicklinks">
    ${header}
    <div class="quick-link-row">
      ${list.map(renderQuickLinkTile).join('')}
      <button type="button" class="quick-link-tile quick-link-tile--add" data-quick-links-manage>
        <span class="quick-link-tile__face"><i data-lucide="pencil" aria-hidden="true"></i></span>
        <span class="quick-link-tile__name">${esc(t('quickLinks.manage'))}</span>
      </button>
    </div>
  </div>`;
}

function renderFamilyWidget(users, data) {




  // dass sie allein ist (Critique 2026-08-10, Persona Miriam).
  //

  // Mitglieder HEUTE angeht - naechster eigener Termin plus offene Tageslast -



  const openByUser = new Map(
    (Array.isArray(data?.memberTodayTasks) ? data.memberTodayTasks : [])
      .map((r) => [r.user_id, Number(r.open_count) || 0])
  );
  const events = Array.isArray(data?.upcomingEvents) ? data.upcomingEvents : [];
  const todayKey = householdToday();
  // S-18 (UX-Audit): dieselbe Schichtplan-Kachel, direkt daneben, widersprach




  // Zeile unveraendert wie zuvor.
  const scheduleEntriesToday = Array.isArray(data?.schedule?.entries) ? data.schedule.entries : [];

  const rows = users.slice(0, 6).map((u) => {
    const assignedTo = (e) => (Array.isArray(e.assigned_users) ? e.assigned_users : []).some((a) => a.id === u.id);
    const nextEvent = events.find((e) => eventOccurrenceDateKey(e) === todayKey && assignedTo(e));
    const parts = [];
    if (nextEvent) {
      const start = eventStartDate(nextEvent);
      const timed = !nextEvent.all_day && start && String(nextEvent.start_datetime).length > 10;
      parts.push(timed ? `${esc(formatTime(start))} ${esc(nextEvent.title)}` : esc(nextEvent.title));
    }
    const myShift = scheduleEntriesToday.find((entry) => Number(entry.user_id) === Number(u.id) && entry.shift_type);
    if (myShift) {
      const type = myShift.shift_type;
      parts.push(esc(type.short_code ? `${type.short_code} Â· ${type.name}` : type.name));
    }
    const open = openByUser.get(u.id) ?? 0;
    if (open > 0) parts.push(esc(t('dashboard.memberOpenTasks', { count: open })));





    let status;
    let free = false;
    if (parts.length) {
      status = parts.join(' Â· ');
    } else {
      const upcoming = events.find((e) => eventOccurrenceDateKey(e) > todayKey && assignedTo(e));
      if (upcoming) {
        status = `${esc(relativeDateLabel(eventOccurrenceDateKey(upcoming)))} Â· ${esc(upcoming.title)}`;
      } else {
        status = esc(t('dashboard.todayFree'));
        free = true;
      }
    }
    return `
      <div class="family-member">
        <span class="family-widget-avatar" style="background:${esc(u.avatar_color || AVATAR_FALLBACK_COLOR)};color:${getReadableTextColor(u.avatar_color || AVATAR_FALLBACK_COLOR)}">
          ${u.avatar_data ? `<img src="${esc(u.avatar_data)}" alt="" loading="lazy">` : esc(initials(u.display_name))}
        </span>
        <span class="family-member__body">
          <span class="family-member__name">${esc(u.display_name)}</span>
          <span class="family-member__status${free ? ' family-member__status--free' : ''}">${status}</span>
        </span>
      </div>`;
  }).join('');
  const moreCount = users.length - Math.min(users.length, 6);


  //





  // einzelne Zeile sagen kann.
  //






  const openToday = [...openByUser.values()].reduce((sum, n) => sum + n, 0);
  const doneToday = Number(data?.tasksDoneToday) || 0;
  const footer = openToday + doneToday > 0
    ? esc(t('dashboard.familyDayTally', { open: openToday, done: doneToday }))
    : esc(t('dashboard.familyDayCalm'));

  return `<div class="widget widget--family">
    ${widgetHeader('family', t('dashboard.familyMembers'), null, '/settings', t('dashboard.manage'), 'contacts')}
    <div class="family-widget">
      <div class="family-widget__list">
        ${rows}
        ${moreCount > 0 ? `<div class="family-member family-member--more">${esc(t('dashboard.shoppingMore', { count: moreCount }))}</div>` : ''}
      </div>
      <p class="family-widget__footer">${footer}</p>
    </div>
  </div>`;
}



function renderBudgetSavings(budget, balance, income, savingsRate) {
  const goal = budget?.savingsGoal;
  if (goal && goal > 0) {
    const pct = Math.max(0, Math.min(100, Math.round((balance / goal) * 100)));
    const met = balance >= goal;
    const tone = met ? 'positive' : (balance < 0 ? 'negative' : 'neutral');
    return `
      <div class="budget-widget__goal">
        <div class="budget-widget__goal-head">
          <span>${t('dashboard.savingsGoal')}</span>
          <strong class="budget-widget__goal-pct budget-widget__goal-pct--${tone}">${Math.round((balance / goal) * 100)}%</strong>
        </div>
        <div class="budget-widget__goal-track">
          <div class="budget-widget__goal-fill budget-widget__goal-fill--${tone}" style="--goal-scale:${pct / 100}"></div>
        </div>
      </div>`;
  }

  //





  // endlich Substanz statt Luft.
  //




  //




  const savedShare = income > 0 ? Math.max(0, Math.min(1, balance / income)) : 0;
  return `
    <div class="budget-widget__savings">
      <span>${t('dashboard.savingsRate')}</span>
      <strong>${income > 0 ? `${savingsRate}%` : 'â€“'}</strong>
    </div>
    ${income > 0 ? `
    <div class="budget-widget__share" aria-hidden="true">
      <span class="budget-widget__share-saved" style="--share-scale:${savedShare.toFixed(3)}"></span>
    </div>` : ''}`;
}

function renderBudgetWidget(budget, currency) {
  const income = budget?.income || 0;
  const expenses = budget?.expenses || 0;
  const balance = budget?.balance || 0;
  const savingsRate = income > 0 ? Math.round((balance / income) * 100) : 0;
  const balanceTone = balance >= 0 ? 'positive' : 'negative';
  const hasData = (budget?.entryCount || 0) > 0;

  if (!hasData) {
    return `<div class="widget widget--budget">
      ${widgetHeader('budget', t('dashboard.budgetOverview'), null, '/budget')}
      <div class="widget__empty">
        <i data-lucide="wallet" class="empty-state__icon" aria-hidden="true"></i>
        <div>${t('dashboard.noBudgetData')}</div>
        ${emptyStateCta('/budget', t('budget.addEntryLabel'))}
      </div>
    </div>`;
  }

  return `<div class="widget widget--budget">
    ${widgetHeader('budget', t('dashboard.budgetOverview'), null, '/budget')}
    <div class="budget-widget">
      <div class="budget-widget__headline">
        <span>${t('dashboard.monthlyBalance')}</span>
        <strong class="budget-widget__balance budget-widget__balance--${balanceTone}">${formatCurrency(balance, currency)}</strong>
      </div>
      ${renderBudgetSavings(budget, balance, income, savingsRate)}
      <div class="budget-widget__flow">
        <span class="budget-widget__flow-item budget-widget__flow-item--income">
          <span>${t('dashboard.monthlyIncome')}</span>
          <strong>${formatCurrency(income, currency)}</strong>
        </span>
        <span class="budget-widget__flow-item budget-widget__flow-item--expense">
          <span>${t('dashboard.monthlyExpenses')}</span>
          <strong>${formatCurrency(expenses, currency)}</strong>
        </span>
      </div>
      ${budget?.topExpenseCategory
        ? `<div class="budget-widget__footer">${t('dashboard.topExpense')}: <strong>${esc(budgetCategoryLabel(budget.topExpenseCategory))}</strong> Â· ${formatCurrency(budget.topExpenseAmount, currency)}</div>`
        : ''}
    </div>
  </div>`;
}

// --------------------------------------------------------

// --------------------------------------------------------


const METRIC_TILE_ORDER = ['tasks', 'shopping', 'budget', 'birthdays', 'meals', 'notes', 'rewards', 'health', 'housekeeping'];
const METRIC_TILE_COUNT = 4;

function metricTileFor(id, data, currency) {
  const route = { tasks: '/tasks', shopping: '/shopping', budget: '/budget', birthdays: '/birthdays', meals: '/meals', notes: '/notes', rewards: '/rewards', health: '/health', housekeeping: '/housekeeping' }[id];
  switch (id) {
    case 'tasks': {
      const open = data.openTaskCount;
      if (open == null) return null;
      const overdue = data.overdueTaskCount ?? 0;
      return {
        id, route, icon: widgetIcon('tasks'), label: t('nav.tasks'),
        value: t('dashboard.metricOpen', { count: open }),
        note: overdue > 0 ? t('dashboard.metricOverdue', { count: overdue }) : t('dashboard.metricNothingOverdue'),
        noteTone: overdue > 0 ? 'danger' : null,
      };
    }
    case 'shopping': {
      const items = data.shoppingOpenCount;
      if (items == null) return null;
      const lists = data.shoppingOpenLists ?? 0;
      return {
        id, route, icon: widgetIcon('shopping'), label: t('nav.shopping'),
        value: t('dashboard.metricItems', { count: items }),
        note: items === 0 ? t('dashboard.metricAllBought') : t('dashboard.metricOnLists', { count: lists }),
      };
    }
    case 'budget': {
      const budget = data.budget ?? {};
      if (!(budget.entryCount > 0)) return null;
      const balance = budget.balance || 0;





      // bekommt Label-Farbe statt Rot.
      const neutral = (budget.income || 0) === 0 && balance < 0;
      return {
        id, route, icon: widgetIcon('budget'), label: t('nav.budget'),
        value: formatCurrency(balance, currency),
        note: t('dashboard.monthlyBalance'),
        tone: neutral ? 'balance-neutral' : balance >= 0 ? 'balance-positive' : 'balance-negative',
      };
    }
    case 'birthdays': {
      const next = (data.birthdays ?? [])[0];
      if (!next) return null;
      const days = next.days_until;
      return {
        id, route, icon: widgetIcon('birthdays'), label: t('nav.birthdays'),
        value: days === 0 ? t('common.today') : days === 1 ? t('common.tomorrow') : t('dashboard.daysLeft', { count: days }),
        note: next.kind === 'name_day' ? `${next.name} Â· ${t('birthdays.nameDay')}` : next.name,
      };
    }
    case 'meals': {
      const meals = data.todayMeals ?? [];
      if (!meals.length) return null;
      return {
        id, route, icon: widgetIcon('meals'), label: t('nav.meals'),
        value: t('dashboard.metricMeals', { count: meals.length }),
        note: meals[0]?.title || t('dashboard.todayMeals'),
      };
    }
    case 'notes': {
      const notes = data.pinnedNotes ?? [];
      if (!notes.length) return null;
      const pinned = data.pinnedNotesCount ?? notes.filter((n) => n.pinned).length;
      if (!pinned) return null;
      return {
        id, route, icon: widgetIcon('notes'), label: t('nav.notes'),
        value: t('dashboard.metricPinned', { count: pinned }),
        note: notes[0]?.title || t('notes.titlePlaceholder'),
      };
    }
    case 'rewards': {
      const leader = (data.rewards?.standings ?? [])[0];
      if (!leader) return null;
      return {
        id, route, icon: widgetIcon('rewards'), label: t('nav.rewards'),
        value: t('dashboard.metricPoints', { count: leader.balance ?? 0 }),
        note: leader.display_name,
      };
    }
    case 'health': {
      const h = data.health ?? {};




      if (!h.hasMeds || !(h.dosesTotal > 0)) return null;
      const offen = h.dosesTotal - (h.dosesTaken ?? 0) - (h.dosesSkipped ?? 0);
      return {
        id, route, icon: widgetIcon('health'), label: t('nav.health'),
        value: t('dashboard.metricDoses', { count: Math.max(0, offen) }),



        note: h.lowStockCount > 0
          ? t('dashboard.healthRefill', { count: h.lowStockCount })
          : offen <= 0 ? t('dashboard.healthAllTaken') : (h.nextDose?.name || t('dashboard.healthAllTaken')),
        noteTone: h.lowStockCount > 0 ? 'danger' : null,
      };
    }
    case 'housekeeping': {
      const hk = data.housekeeping ?? {};
      if (!hk.configured) return null;
      return {
        id, route, icon: widgetIcon('housekeeping'), label: t('nav.housekeeping'),
        value: t('dashboard.metricVisits', { count: hk.visitsThisMonth ?? 0 }),

        // zaehlt offenes Geld; sonst der letzte Besuch.
        note: hk.present
          ? t('dashboard.housekeepingPresent')
          : hk.unpaidAmount > 0
            ? t('dashboard.housekeepingUnpaid', { amount: formatCurrency(hk.unpaidAmount, currency) })
            : hk.lastVisit
              ? t('dashboard.housekeepingLastVisit', { date: formatDate(hk.lastVisit) })
              : t('dashboard.housekeepingNoVisits'),
      };
    }
    default:
      return null;
  }
}

function renderMetricTile(tile) {
  const noteClass = tile.noteTone === 'danger' ? ' metric-card__note--danger' : '';
  const toneClass = tile.tone ? ` metric-card--${tile.tone}` : '';
  return `
    <a class="metric-card metric-card--tile${toneClass}" href="${tile.route}" data-route="${tile.route}">
      <span class="metric-card__tile-head">
        <!-- Der Ton gehoert AUF das Siegel, nicht auf die Karte darum: .module-seal
             deklariert
             am Element schlaegt jeden geerbten Wert. Von der Karte aus gesetzt
             trugen alle vier Kacheln denselben violetten App-Akzent.
             Zwei Siegel-Gesichter auf einem Board waeren zwei Wahrheiten -
             der Satz galt erst fuer dieses Board und seit 2026-08-17 fuer die
             ganze App: es gibt nur noch das Vollton-Gesicht, also braucht es
             auch keine Klasse mehr, die es auswaehlt. -->
        <span class="module-seal module-seal--sm" aria-hidden="true"
              style="--seal-accent: var(--module-${tile.id}, var(--color-accent))">${moduleIconHTML(tile.icon)}</span>
        <span class="metric-card__label">${esc(tile.label)}</span>
      </span>
      <span class="metric-card__value">${esc(tile.value)}</span>
      <span class="metric-card__note${noteClass}">${esc(tile.note)}</span>
    </a>
  `;
}

function selectMetricTiles(data, currency, shown = new Set()) {
  const tiles = METRIC_TILE_ORDER
    .filter((id) => isWidgetModuleEnabled(id))
    .filter((id) => !COCKPIT_COVERED_WIDGETS.has(id))
    .filter((id) => !shown.has(id))
    .map((id) => metricTileFor(id, data, currency))
    .filter(Boolean)
    .slice(0, METRIC_TILE_COUNT);



  return tiles.length < 2 ? [] : tiles;
}

function renderMetricTiles(data, currency, shown = new Set()) {
  const tiles = selectMetricTiles(data, currency, shown);
  if (!tiles.length) return '';
  return `<div class="metric-tiles">${tiles.map(renderMetricTile).join('')}</div>`;
}

// --------------------------------------------------------
// Belohnungen-Widget (Familien-Punktestand)
// --------------------------------------------------------

function renderRewardsWidget(rewards) {
  const standings = Array.isArray(rewards?.standings) ? rewards.standings : [];
  if (!standings.length) {
    return `<div class="widget widget--rewards">
      ${widgetHeader('rewards', t('nav.rewards'), 0, '/rewards')}
      <div class="widget__empty">
        <i data-lucide="award" class="empty-state__icon" aria-hidden="true"></i>
        <div>${t('dashboard.noRewards')}</div>
        ${emptyStateCta('/rewards', t('rewards.addReward'))}
      </div>
    </div>`;
  }

  const rows = standings.map((m, i) => {
    const color = m.avatar_color || AVATAR_FALLBACK_COLOR;
    const avatarInner = m.avatar_data
      ? `<img src="${esc(m.avatar_data)}" alt="" loading="lazy">`
      : esc(initials(m.display_name));
    return `
      <div class="rewards-widget-row${i === 0 ? ' rewards-widget-row--leader' : ''}" data-route="/rewards" role="button" tabindex="0">
        <span class="rewards-widget-row__rank" aria-hidden="true">${i + 1}</span>
        <span class="rewards-widget-row__avatar" style="background:${esc(color)};color:${getReadableTextColor(color)}">${avatarInner}</span>
        <span class="rewards-widget-row__name">${esc(m.display_name)}</span>
        <span class="rewards-widget-row__points"><strong>${esc(formatPoints(m.balance))}</strong> ${esc(t('rewards.pointsUnit'))}</span>
      </div>
    `;
  }).join('');

  const pending = Number(rewards?.pending) || 0;
  const footer = pending > 0
    ? `<div class="rewards-widget__footer" data-route="/rewards" role="button" tabindex="0">
        <i data-lucide="clock" aria-hidden="true"></i>
        <span>${t('dashboard.rewardsPending', { count: pending })}</span>
      </div>`
    : '';

  const badge = Number(rewards?.participantCount) || standings.length;
  return `<div class="widget widget--rewards">
    ${widgetHeader('rewards', t('nav.rewards'), badge, '/rewards')}
    <div class="widget__body">
      <div class="rewards-widget">${rows}</div>
      ${footer}
    </div>
  </div>`;
}

// --------------------------------------------------------
// Gesundheit-Widget (heutige Medikamenten-Dosen)
// --------------------------------------------------------

function renderHealthWidget(health) {
  if (!health?.hasMeds) {
    return `<div class="widget widget--health">
      ${widgetHeader('health', t('nav.health'), null, '/health')}
      <div class="widget__empty">
        <i data-lucide="heart-pulse" class="empty-state__icon" aria-hidden="true"></i>
        <div>${t('dashboard.healthNoMeds')}</div>
        ${emptyStateCta('/health', t('health.meds.add'))}
      </div>
    </div>`;
  }

  const total = Number(health?.dosesTotal) || 0;
  const taken = Number(health?.dosesTaken) || 0;
  const lowStock = Number(health?.lowStockCount) || 0;
  const pct = total > 0 ? Math.max(0, Math.min(1, taken / total)) : 0;
  const allTaken = total > 0 && taken >= total;

  const lowChip = lowStock > 0
    ? `<div class="health-widget__refill"><i data-lucide="package" aria-hidden="true"></i><span>${t('dashboard.healthRefill', { count: lowStock })}</span></div>`
    : '';

  let main;
  if (total === 0) {
    main = `<div class="health-widget__none">
      <i data-lucide="coffee" class="health-widget__none-icon" aria-hidden="true"></i>
      <span>${t('dashboard.healthNoDosesToday')}</span>
    </div>`;
  } else {
    const status = allTaken
      ? `<div class="health-widget__status health-widget__status--done"><i data-lucide="check" aria-hidden="true"></i>${t('dashboard.healthAllTaken')}</div>`
      : health?.nextDose
        ? `<div class="health-widget__next">
            <span class="health-widget__next-time">${esc(health.nextDose.time)}</span>
            <span class="health-widget__next-name">${esc(health.nextDose.name)}</span>
          </div>`
        : '';
    main = `
      <div class="health-widget__progress">
        <div class="health-widget__bar" role="img" aria-label="${t('dashboard.healthDosesProgress', { taken, total })}">
          <div class="health-widget__bar-fill${allTaken ? ' health-widget__bar-fill--done' : ''}" style="--dose-scale:${pct}"></div>
        </div>
        <div class="health-widget__count"><strong>${taken}</strong>/${total}</div>
      </div>
      ${status}
    `;
  }

  return `<div class="widget widget--health">
    ${widgetHeader('health', t('nav.health'), null, '/health')}
    <div class="widget__body">
      <div class="health-widget">${main}${lowChip}</div>
    </div>
  </div>`;
}

// --------------------------------------------------------
// Zyklus-Widget (owner-only, opt-in)
// --------------------------------------------------------





const CYCLE_WIDGET_PHASE_KEYS = {
  [PHASE.MENSTRUATION]: 'health.cycle.phase.menstruation',
  [PHASE.FOLLICULAR]:   'health.cycle.phase.follicular',
  [PHASE.FERTILE]:      'health.cycle.phase.fertile',
  [PHASE.OVULATION]:    'health.cycle.phase.ovulation',
  [PHASE.LUTEAL]:       'health.cycle.phase.luteal',
};


const CYCLE_WIDGET_PHASE_COLOR = {
  [PHASE.MENSTRUATION]: 'var(--cycle-period)',
  [PHASE.FERTILE]:      'var(--cycle-fertile)',
  [PHASE.OVULATION]:    'var(--cycle-ovulation)',
};

function cycleWidgetCountdown(prediction) {
  const d = prediction.daysUntilNext;
  if (d === 0) return t('health.cycle.status.today');
  if (d < 0) return t('health.cycle.status.overdue', { count: Math.abs(d) });
  return t('health.cycle.status.inDays', { count: d });
}

function renderCycleWidget(cycle) {
  // cycle: { periods, settings } (owner-only) | null (Ladefehler) | undefined (Kachel versteckt)
  const prediction = cycle
    ? predictCycle(cycle.periods || [], cycle.settings || {})
    : { hasData: false };


  if (!prediction.hasData) {
    return `<div class="widget widget--cycle">
      ${widgetHeader('cycle', t('health.cycle.title'), null, '/health/cycle')}
      <div class="widget__empty">
        <i data-lucide="calendar-heart" class="empty-state__icon" aria-hidden="true"></i>
        <div>${t('health.cycle.emptyTitle')}</div>
        ${emptyStateCta('/health/cycle', t('health.cycle.add'))}
      </div>
    </div>`;
  }

  const phaseLabel = t(CYCLE_WIDGET_PHASE_KEYS[prediction.phase] || CYCLE_WIDGET_PHASE_KEYS[PHASE.FOLLICULAR]);
  const dayText = t('health.cycle.ring.cycleDay', { day: prediction.cycleDay });
  const countdown = cycleWidgetCountdown(prediction);
  const phaseColor = CYCLE_WIDGET_PHASE_COLOR[prediction.phase] || 'var(--module-health)';


  const R = 26;
  const C = 2 * Math.PI * R;
  const frac = Math.min(1, Math.max(0, prediction.cycleDay / Math.max(1, prediction.avgCycle)));
  const lit = (frac * C).toFixed(2);
  const gap = (C - frac * C).toFixed(2);

  const ring = `
    <svg class="cycle-widget__ring" viewBox="0 0 64 64" role="img" aria-label="${esc(`${phaseLabel} Â· ${dayText}`)}">
      <circle class="cycle-widget__ring-track" cx="32" cy="32" r="${R}" fill="none" stroke-width="6" />
      <circle class="cycle-widget__ring-arc" cx="32" cy="32" r="${R}" fill="none" stroke="${phaseColor}"
        stroke-width="6" stroke-linecap="round" stroke-dasharray="${lit} ${gap}" transform="rotate(-90 32 32)" />
      <text class="cycle-widget__ring-num" x="32" y="32" text-anchor="middle" dominant-baseline="central">${esc(prediction.cycleDay)}</text>
    </svg>`;

  return `<div class="widget widget--cycle">
    ${widgetHeader('cycle', t('health.cycle.title'), null, '/health/cycle')}
    <div class="widget__body">
      <div class="cycle-widget" data-phase="${esc(prediction.phase)}">
        ${ring}
        <div class="cycle-widget__info">
          <span class="cycle-widget__phase">${esc(phaseLabel)}</span>
          <span class="cycle-widget__next">
            <span class="cycle-widget__next-label">${esc(t('health.cycle.status.nextPeriod'))}</span>
            <span class="cycle-widget__countdown">${esc(countdown)}</span>
          </span>
          <span class="cycle-widget__date">${esc(formatDate(prediction.nextStart))}</span>
        </div>
      </div>
    </div>
  </div>`;
}

// --------------------------------------------------------

// --------------------------------------------------------

function renderScheduleWidget(schedule, users, size) {






  // ihrem Retry rendern.
  if (schedule === null) throw new Error('schedule widget slice failed to load');
  const entries = schedule?.entries ?? [];
  const hasTypes = Boolean(schedule?.hasTypes);

  if (!hasTypes) {
    return `<div class="widget widget--schedule">
      ${widgetHeader('schedule', t('nav.schedule'), null, '/schedule')}
      <div class="widget__empty">
        <i data-lucide="calendar-clock" class="empty-state__icon" aria-hidden="true"></i>
        <div>${t('dashboard.scheduleEmpty')}</div>
        ${emptyStateCta('/schedule', t('schedule.createShiftType'))}
      </div>
    </div>`;
  }

  if (!entries.length) {
    return `<div class="widget widget--schedule">
      ${widgetHeader('schedule', t('nav.schedule'), null, '/schedule/patterns')}
      <div class="widget__body"><p class="u-meta schedule-widget-empty">${esc(t('schedule.empty'))}</p></div>
    </div>`;
  }







  //




  const onShift = new Set(entries.filter((entry) => entry.shift_type).map((entry) => Number(entry.user_id))).size;


  // waehrend die abgeschnittenen Zeilen zufaellig beide "Freier Tag" zeigen


  const sorted = [...entries].sort((a, b) => (a.shift_type ? 0 : 1) - (b.shift_type ? 0 : 1));
  const rows = sorted.slice(0, listRowCap(size)).map((entry) => {
    const user = users.find((item) => Number(item.id) === Number(entry.user_id));
    const type = entry.shift_type;
    const accent = user?.avatar_color || AVATAR_FALLBACK_COLOR;
    const avatarInner = user?.avatar_data
      ? `<img src="${esc(user.avatar_data)}" alt="" loading="lazy">`
      : esc(initials(user?.display_name ?? ''));
    const shiftLabel = type
      ? esc(type.short_code ? `${type.short_code} Â· ${type.name}` : type.name)
      : esc(t('schedule.freeDay'));
    const swatchColor = type ? type.color : 'var(--color-border)';
    // Eigene Punkt-Klasse statt `.schedule-swatch` (schedule.css): router.js


    // unsichtbare Abhaengigkeit zwischen zwei Stylesheets, die nie gemeinsam
    // laufen wuerden.
    const icon = type?.icon ? `<i data-lucide="${esc(type.icon)}" class="schedule-widget-row__icon" aria-hidden="true"></i>` : '';
    const badge = entry.source === 'extra' ? `<i data-lucide="layers" class="schedule-widget-row__extra-badge" aria-label="${esc(t('schedule.extraBadgeLabel'))}"></i>` : '';
    return `
      <div class="schedule-widget-row" data-route="/schedule/patterns" role="button" tabindex="0">
        <span class="schedule-widget-row__avatar" style="background:${esc(accent)};color:${getReadableTextColor(accent)}">${avatarInner}</span>
        <span class="schedule-widget-row__name">${esc(user?.display_name ?? '')}</span>
        <span class="schedule-widget-row__shift">${icon}<span class="schedule-widget-row__dot" style="--schedule-color:${esc(swatchColor)}"></span>${shiftLabel}${badge}</span>
      </div>`;
  }).join('');

  return `<div class="widget widget--schedule">
    ${widgetHeader('schedule', t('nav.schedule'), onShift, '/schedule/patterns')}
    <div class="widget__body">
      <div class="schedule-widget">${rows}</div>
    </div>
  </div>`;
}

// --------------------------------------------------------
// Waste-Widget (naechste Abholung je aktivem Typ)
// --------------------------------------------------------

function renderWasteWidget(waste, size) {
  if (waste === null) throw new Error('waste widget slice failed to load');
  const items = waste?.items ?? [];

  if (!items.length) {
    return `<div class="widget widget--waste">
      ${widgetHeader('waste', t('nav.waste'), null, '/waste')}
      <div class="widget__empty">
        <i data-lucide="trash-2" class="empty-state__icon" aria-hidden="true"></i>
        <div>${t('waste.emptyTypesTitle')}</div>
        ${emptyStateCta('/waste', t('waste.addType'))}
      </div>
    </div>`;
  }


  // API-Grundsortierung (Typ-Reihenfolge), die fuer andere Aufrufer (Token/MCP)
  // die richtige Vorgabe bleibt.
  const sorted = [...items].sort((a, b) => {
    const ad = a.next?.date_key ?? null;
    const bd = b.next?.date_key ?? null;
    if (ad && bd && ad !== bd) return ad < bd ? -1 : 1;
    if (ad && !bd) return -1;
    if (!ad && bd) return 1;
    return (a.type.sort_order - b.type.sort_order) || (a.type.id - b.type.id);
  });
  const earliestDate = sorted.find((e) => e.next)?.next.date_key ?? null;
  const upcomingCount = items.filter((e) => e.next).length;

  const capped = sorted.slice(0, listRowCap(size));
  const rows = capped.map((entry) => {
    const type = entry.type;
    const next = entry.next;
    const accent = type.color || 'var(--color-border)';
    const icon = type.icon ? `<i data-lucide="${esc(type.icon)}" class="waste-widget-row__icon" aria-hidden="true"></i>` : '';

    if (!next) {
      return `
        <div class="waste-widget-row" data-route="/waste" role="button" tabindex="0">
          <span class="waste-widget-row__dot" style="--waste-color:${esc(accent)}"></span>
          <span class="waste-widget-row__name">${icon}${esc(type.name)}</span>
          <span class="waste-widget-row__date waste-widget-row__date--none">${esc(t('waste.noUpcomingPickup'))}</span>
        </div>`;
    }




    const movedOriginal = next.moved
      ? next.origins.find((o) => o.kind === 'schedule' && o.original_date)?.original_date
      : null;
    const moved = next.moved
      ? `<i data-lucide="move" class="waste-widget-row__flag" aria-label="${esc(t('waste.movedFromBadge', { date: movedOriginal ? formatDate(movedOriginal) : '' }))}"></i>`
      : '';
    const coalesced = next.coalesced
      ? `<i data-lucide="layers" class="waste-widget-row__flag" aria-label="${esc(t('waste.coalescedHint'))}"></i>`
      : '';
    const emphasize = next.date_key === earliestDate ? ' waste-widget-row__date--next' : '';

    return `
      <div class="waste-widget-row" data-route="${esc(`/waste${next.deep_link}`)}" role="button" tabindex="0">
        <span class="waste-widget-row__dot" style="--waste-color:${esc(accent)}"></span>
        <span class="waste-widget-row__name">${icon}${esc(type.name)}${moved}${coalesced}</span>
        <span class="waste-widget-row__date${emphasize}">${esc(relativeDateLabel(next.date_key))}</span>
      </div>`;
  }).join('');

  const rest = Math.max(0, sorted.length - capped.length);
  const more = rest > 0
    ? `<p class="waste-widget-more">${esc(t('dashboard.wasteMore', { count: rest }))}</p>`
    : '';



  const refreshWarning = waste?.needsRefresh
    ? `<div class="waste-widget__refresh-warning">
        <i data-lucide="alert-triangle" aria-hidden="true"></i>
        <span>${esc(t('waste.sourceNeedsRefreshBadge'))}</span>
      </div>`
    : '';

  return `<div class="widget widget--waste">
    ${widgetHeader('waste', t('nav.waste'), upcomingCount, '/waste')}
    <div class="widget__body">
      <div class="waste-widget">${rows}${more}</div>
      ${refreshWarning}
    </div>
  </div>`;
}

// --------------------------------------------------------
// Haushaltshilfe-Widget (Anwesenheit + offene Zahlung)
// --------------------------------------------------------

function renderHousekeepingWidget(hk, currency) {
  if (!hk?.configured) {
    return `<div class="widget widget--housekeeping">
      ${widgetHeader('housekeeping', t('nav.housekeeping'), null, '/housekeeping')}
      <div class="widget__empty">
        <i data-lucide="paintbrush" class="empty-state__icon" aria-hidden="true"></i>
        <div>${t('dashboard.housekeepingNone')}</div>
        ${emptyStateCta('/housekeeping', t('housekeeping.addTask'))}
      </div>
    </div>`;
  }

  const unpaid = Number(hk.unpaidAmount) || 0;
  const visits = Number(hk.visitsThisMonth) || 0;
  const present = Boolean(hk.present);

  const statusBlock = present
    ? `<div class="housekeeping-widget__status housekeeping-widget__status--present">
        <span class="housekeeping-widget__dot" aria-hidden="true"></span>
        <div class="housekeeping-widget__lines">
          <div class="housekeeping-widget__state">${t('dashboard.housekeepingPresent')}</div>
          <div class="housekeeping-widget__sub">${hk.workerName ? `${esc(hk.workerName)} Â· ` : ''}${hk.presentSince ? t('dashboard.housekeepingSince', { time: formatTime(new Date(hk.presentSince)) }) : ''}</div>
        </div>
      </div>`
    : `<div class="housekeeping-widget__status">
        <span class="housekeeping-widget__dot housekeeping-widget__dot--idle" aria-hidden="true"></span>
        <div class="housekeeping-widget__lines">
          <div class="housekeeping-widget__state">${hk.lastVisit ? t('dashboard.housekeepingLastVisit', { date: formatDate(hk.lastVisit) }) : t('dashboard.housekeepingNoVisits')}</div>
          <div class="housekeeping-widget__sub">${t('dashboard.housekeepingVisitsMonth', { count: visits })}</div>
        </div>
      </div>`;

  const unpaidChip = unpaid > 0
    ? `<div class="housekeeping-widget__unpaid"><i data-lucide="banknote" aria-hidden="true"></i><span>${t('dashboard.housekeepingUnpaid', { amount: formatCurrency(unpaid, currency) })}</span></div>`
    : '';

  return `<div class="widget widget--housekeeping">
    ${widgetHeader('housekeeping', t('nav.housekeeping'), null, '/housekeeping')}
    <div class="widget__body">
      <div class="housekeeping-widget">${statusBlock}${unpaidChip}</div>
    </div>
  </div>`;
}

function renderTodayRow(row) {
  const mark = whoMark(row.who);



  const time = row.timeLabel
    ? `<span class="today-cockpit-card__time${row.overdue ? ' today-cockpit-card__time--overdue' : ''}">${esc(row.timeLabel)}</span>`
    : '';


  const objectAttrs = row.objectId != null
    ? ` data-object-kind="${esc(row.kind)}" data-object-id="${esc(String(row.objectId))}"`
    : '';







  //



  // Modal.
  const opensModal = row.kind === 'task' && row.objectId != null;
  // Inset-Grouped-Zeile (Apple-Systemapp-Muster): das Markensiegel traegt


  // (nie versal, nie ueber dem Titel).
  const inner = `
      <span class="${mark ? 'seal-pair' : ''}"><span class="module-seal today-cockpit-card__icon">${moduleIconHTML(row.icon)}</span>${mark}</span>
      <span class="today-cockpit-card__body">
        <strong class="today-cockpit-card__value">${esc(row.title)}</strong>
        <span class="today-cockpit-card__sub">${esc(row.sub)}</span>
      </span>
      ${time}
  `;
  const attrs = `class="today-cockpit-card today-cockpit-card--${row.tone}" data-route="${esc(row.route)}"${objectAttrs}`;
  return opensModal
    ? `<button type="button" ${attrs}>${inner}</button>`
    : `<a href="${esc(row.route)}" ${attrs}>${inner}</a>`;
}




function renderTodayStateRow({ title, sub, icon, route }) {
  const inner = `
      <span class="module-seal today-cockpit-card__icon">${moduleIconHTML(icon)}</span>
      <span class="today-cockpit-card__body">
        <strong class="today-cockpit-card__value">${esc(title)}</strong>
        ${sub ? `<span class="today-cockpit-card__sub">${esc(sub)}</span>` : ''}
      </span>
  `;
  if (route) {
    return `<a href="${esc(route)}" class="today-cockpit-card today-cockpit-card--state" data-route="${esc(route)}">${inner}</a>`;
  }
  return `<div class="today-cockpit-card today-cockpit-card--state">${inner}</div>`;
}



const PROGRAM_ROW_CAP = 6;

function buildTodayCockpitModel(data, cfg = [], { cap = PROGRAM_ROW_CAP } = {}) {


  // Widget), statt dieselbe Aufgabe/Termin doppelt zu zeigen.
  const widgetShown = (id) => Array.isArray(cfg) && cfg.some((w) => w.id === id && w.visible);
  const domainInCockpit = (module) => !window.aashiyana?.isModuleDisabled(module) && !widgetShown(module);

  const includeTasks = domainInCockpit('tasks');
  const includeCalendar = domainInCockpit('calendar');
  const includeMeals = domainInCockpit('meals');
  const includeShopping = domainInCockpit('shopping');

  const program = buildTodayProgram(data, { includeTasks, includeCalendar, includeMeals });
  const visibleRows = program.rows.slice(0, cap);
  const overflow = program.rows.length - visibleRows.length;





  // Cockpit spricht.
  const outlookEvent = includeCalendar ? program.nextUpcoming : null;
  const outlookTask = includeTasks ? program.nextDueTask : null;
  let outlook = null;
  if (outlookEvent || outlookTask) {
    const eventStart = outlookEvent ? eventStartDate(outlookEvent) : null;
    const eventTimed = outlookEvent && !outlookEvent.all_day && eventStart && String(outlookEvent.start_datetime).length > 10;



    // `taskKey` um den Zonenoffset (#851).
    const eventKey = outlookEvent
      ? `${eventOccurrenceDateKey(outlookEvent)}T${eventTimed ? zonedTimeKey(outlookEvent.start_datetime) : '00:00'}`
      : null;
    const taskKey = outlookTask
      ? `${outlookTask.due_date}T${outlookTask.due_time ? String(outlookTask.due_time).slice(0, 5) : '23:59'}`
      : null;
    if (eventKey && (!taskKey || eventKey <= taskKey)) {
      const when = eventTimed
        ? formatDateTime(outlookEvent.start_datetime)
        : relativeDateLabel(eventOccurrenceDateKey(outlookEvent));
      outlook = {
        sub: t('dashboard.todayNextUp', { event: `${when} Â· ${outlookEvent.title}` }),
        route: calendarEventRoute(outlookEvent),
      };
    } else {

      const dueDay = String(outlookTask.due_date).slice(0, 10);
      const dueTime = outlookTask.due_time ? String(outlookTask.due_time).slice(0, 5) : null;
      const when = dueTime
        ? `${relativeDateLabel(dueDay)}, ${formatTime(`${dueDay}T${dueTime}`)}`
        : relativeDateLabel(dueDay);
      outlook = {
        sub: t('dashboard.todayNextUp', { event: `${when} Â· ${outlookTask.title}` }),
        route: '/tasks',
      };
    }
  }






  //
  // S-18 (UX-Audit): dieselbe Regel gilt fuer eine sichtbare Schichtplan-
  // Kachel. "Heute frei"/"Fuer heute alles erledigt" pruefte bisher nur



  // sobald die Kachel selbst fuer Schichtplan spricht - kein neuer Programm-

  // je Domaene" oben.


  // stehengebliebenen Layout weiterhin `visible: true` tragen, obwohl sie

  // heute alles erledigt" faelschlich unterdrueckt, obwohl gar keine
  // Schichtplan-Kachel mehr etwas behauptet.
  const scheduleWidgetVisible = !window.aashiyana?.isModuleDisabled('schedule') && widgetShown('schedule');
  let state = null;
  if (!program.rows.length && !scheduleWidgetVisible) {
    const sayAllDone = includeTasks && program.tasksDoneToday > 0;
    if (sayAllDone || includeCalendar) {
      state = {
        title: sayAllDone ? t('dashboard.todayAllDone') : t('dashboard.todayFree'),
        sub: outlook?.sub ?? '',
        icon: sayAllDone ? 'check-circle' : 'sparkles',
        route: outlook?.route ?? null,
      };
    }
  }


  const shopping = includeShopping && program.openShoppingCount > 0
    ? {
        kind: 'shopping',
        objectId: null,
        timeLabel: '',
        title: t('dashboard.todayShoppingCount', { count: program.openShoppingCount }),
        sub: t('dashboard.todayShopping'),
        icon: 'shopping-cart',
        tone: 'shopping',
        route: '/shopping',
        who: null,
      }
    : null;







  let coda = null;
  if (program.rows.length > 0 && overflow === 0) {
    const tomorrowKey = addLocalDays(householdToday(), 1);
    const tomorrowTask = includeTasks && program.nextDueTask?.due_date === tomorrowKey ? program.nextDueTask : null;
    coda = tomorrowTask
      ? t('dashboard.todayNothingElseTomorrow', { title: tomorrowTask.title })
      : t('dashboard.todayNothingElse');
  }




  // Zeilen hinter dem Deckel liegen.
  return { rows: visibleRows, allRows: program.rows, overflow, state, shopping, coda };
}

function renderTodayCockpit(data, cfg = [], editing = false) {
  const model = buildTodayCockpitModel(data, cfg);

  const parts = [];
  if (model.state) parts.push(renderTodayStateRow(model.state));
  parts.push(...model.rows.map(renderTodayRow));
  if (model.overflow > 0) {
    parts.push(`<div class="today-cockpit__more">${esc(t('dashboard.todayMore', { count: model.overflow }))}</div>`);
  }
  if (model.shopping) parts.push(renderTodayRow(model.shopping));
  if (model.coda) parts.push(`<div class="today-cockpit__coda">${esc(model.coda)}</div>`);





  // hat (#740).
  if (!parts.length && !editing) return '';


  // Bearbeiten-Modus keine Sonderbedienung braucht.
  const hideBtn = editing ? `
    <button type="button" class="widget-edit-controls__hide" data-glance-hide
            aria-label="${t('dashboard.customizeHide', { widget: t('dashboard.todayTitle') })}">
      <i data-lucide="eye-off" aria-hidden="true"></i>
    </button>` : '';

  return `
    <section class="today-cockpit" aria-labelledby="today-cockpit-title">
      <div class="today-cockpit__header">
        <h2 id="today-cockpit-title">${esc(t('dashboard.todayTitle'))}</h2>
        ${hideBtn}
      </div>
      <div class="today-cockpit__grid">
        ${parts.join('')}
      </div>
    </section>
  `;
}


function renderDashboardOverview(user, editing = false, weather = null, updatedAt = null, scope = {}) {

  // setzen darf, ist Admin (#827).
  const { followsDefault = true, canPublish = false } = scope;
  const dateLabel = mastheadDateLabel();
  const updated = !editing && updatedAt
    ? `<p class="dashboard-overview__updated">${esc(t('dashboard.updatedAt', { time: formatTime(updatedAt) }))}</p>`
    : '';

  return `
    <section class="dashboard-overview">
      <div class="dashboard-overview__header${editing ? ' dashboard-overview__header--editing' : ''}">
        <div class="dashboard-overview__heading">
          <span class="dashboard-overview__date">${dateLabel}</span>
          <h2 class="dashboard-overview__title dashboard-overview__title--${greetingPeriod()}">${greeting(user.display_name)}</h2>
          ${mastheadWeatherHtml(weather)}
        </div>
        <div class="dashboard-overview__tools">
          ${editing ? `
          <!-- Die Beruhigung stand nur im Toast NACH dem Speichern, die
               Unsicherheit sitzt aber DAVOR: wÃ¤hrend man eine Kachel wegzieht
               und nicht weiÃŸ, ob man sie gerade den Kindern wegnimmt (Critique
               2026-08-16). Ein Satz im Anpassen-Modus beantwortet sie im
               richtigen Moment. -->
          <div class="dashboard-customize-scope">
            <p>${t('dashboard.customizeScopeHint')}</p>
            ${followsDefault ? `<p class="dashboard-customize-scope__state">${t('dashboard.customizeFollowsDefault')}</p>` : ''}
          </div>
          <div class="dashboard-customize-toolbar" role="toolbar" aria-label="${t('dashboard.customizeTitle')}">
            ${canPublish ? `
            <button class="btn btn--ghost" id="dashboard-customize-publish">
              <i data-lucide="users" class="icon-sm" aria-hidden="true"></i>
              ${t('dashboard.customizeSetDefault')}
            </button>` : ''}
            ${followsDefault ? '' : `
            <button class="btn btn--ghost" id="dashboard-customize-reset">
              <i data-lucide="rotate-ccw" class="icon-sm" aria-hidden="true"></i>
              ${t('dashboard.customizeReset')}
            </button>`}
            <button class="btn btn--secondary" id="dashboard-customize-cancel">${t('common.cancel')}</button>
            <button class="btn btn--primary" id="dashboard-customize-save">${t('common.save')}</button>
          </div>` : ''}
          <!-- DER EINSTIEG SITZT DA, WO DER AUSSTIEG SITZT (#915). Der Wandmodus
               liess sich nur unter Einstellungen -> Persoenlich -> Darstellung
               einschalten, verlassen aber hier auf der Uebersicht - man ging
               dort hinaus, wo man nicht hineinkam.

               Kein eigener Schalter dafuer, ob dieser Knopf erscheint: er
               laege in denselben Einstellungen, in denen der Modus selbst
               schon steht, und waere ein zweiter Schalter fuer eine Sache.
               Auch keine Regel nach Geraeteform - ein falsch versteckter
               Einstieg ist wieder unauffindbar und verschoebe das Problem nur.
               Er ist ein Icon-Knopf wie der daneben und traegt sich so leise
               wie der.

               Im Anpassen-Modus faellt er weg: dort geht es um die Anordnung
               der Kacheln, und ein Moduswechsel mittendrin wuerfe eine
               ungespeicherte Bearbeitung weg. -->
          ${editing ? '' : `
          <button class="dashboard-icon-btn" id="dashboard-wall-enter"
                  aria-label="${t('dashboard.wallEnter')}"
                  title="${t('dashboard.wallEnter')}">
            <i data-lucide="maximize-2" aria-hidden="true"></i>
          </button>`}
          <button class="dashboard-icon-btn" id="dashboard-customize-btn"
                  aria-label="${editing ? t('dashboard.customizeExit') : t('dashboard.customize')}"
                  title="${editing ? t('dashboard.customizeExit') : t('dashboard.customize')}"
                  aria-pressed="${editing ? 'true' : 'false'}">
            <i data-lucide="${editing ? 'x' : 'settings-2'}" aria-hidden="true"></i>
          </button>
          ${updated}
        </div>
      </div>
    </section>
  `;
}

function widgetSizeClass(size) {
  return WIDGET_SIZE_OPTIONS.includes(size) ? `widget-size--${size}` : 'widget-size--1x1';
}

function renderSizeMiniGrid(size) {
  return `<span class="widget-size-mini" aria-hidden="true">${renderSizeMiniGridCells(size)}</span>`;
}

function renderSizeMiniGridCells(size) {


  // die Buttons wirkten identisch (Audit A1-17).
  const [cols, rows] = size.split('x').map(Number);
  return Array.from({ length: 4 }, (_, i) => {
    const col = (i % 2) + 1;
    const row = Math.floor(i / 2) + 1;
    return `<span class="${col <= Math.min(cols, 2) && row <= Math.min(rows, 2) ? 'is-active' : ''}"></span>`;
  }).join('');
}


function taskCategoryLabel(category) {
  if (!category) return '';
  return category.label_key ? t(category.label_key) : (category.name || category.key);
}

let taskCategoriesCache = null;
async function loadTaskCategories() {
  if (taskCategoriesCache) return taskCategoriesCache;
  try {
    const res = await api.get('/tasks/categories');
    taskCategoriesCache = Array.isArray(res?.data) ? res.data : [];
  } catch {
    taskCategoriesCache = [];
  }
  return taskCategoriesCache;
}

let wasteTypesCache = null;
async function loadWasteTypes() {
  if (wasteTypesCache) return wasteTypesCache;
  try {
    const res = await api.get('/waste/types');
    wasteTypesCache = Array.isArray(res?.data) ? res.data : [];
  } catch {
    wasteTypesCache = [];
  }
  return wasteTypesCache;
}

async function loadNoteCategories(getCategories = (path) => api.get(path)) {
  try {
    const res = await getCategories('/notes/categories');
    return Array.isArray(res?.data) ? res.data : null;
  } catch {
    return null;
  }
}

/** Generic options dialog for extension widgets (optionsSchema from module.json). */
async function openExtensionWidgetOptions(id, meta, current = {}) {
  const schema = meta.optionsSchema || {};
  const moduleId = meta.moduleId || String(id).split(':')[0];
  const fields = Object.entries(schema).map(([key, field]) => {
    const val = current[key] ?? field.default ?? '';
    const title = esc(optionFieldLabel(moduleId, field, key));
    if (field.type === 'boolean') {
      return `<label class="widget-options__choice">
        <input type="checkbox" name="opt-${esc(key)}" ${val ? 'checked' : ''}>
        <span>${title}</span>
      </label>`;
    }
    if (field.type === 'number') {
      return `<label class="form-group"><span class="form-label">${title}</span>
        <input class="form-input" type="number" name="opt-${esc(key)}" value="${esc(String(val))}"></label>`;
    }
    if (Array.isArray(field.enum) && field.enum.length) {
      return `<label class="form-group"><span class="form-label">${title}</span>
        <select class="form-input" name="opt-${esc(key)}">
          ${field.enum.map((opt) => `<option value="${esc(opt)}" ${String(val) === opt ? 'selected' : ''}>${esc(opt)}</option>`).join('')}
        </select></label>`;
    }
    return `<label class="form-group"><span class="form-label">${title}</span>
      <input class="form-input" type="text" name="opt-${esc(key)}" value="${esc(String(val ?? ''))}"></label>`;
  }).join('');

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    openModal({
      title: t('dashboard.optionsFor', { widget: widgetLabel(id) }),
      size: 'sm',
      content: `
        <form id="widget-options-form" class="widget-options">
          ${fields || `<p class="widget-options__hint">${t('dashboard.optionExtensionEmpty')}</p>`}
          <div class="modal-actions">
            <button type="button" class="btn btn--secondary" data-action="cancel">${t('common.cancel')}</button>
            <button type="submit" class="btn btn--primary">${t('common.save')}</button>
          </div>
        </form>`,
      onClose: () => finish(null),
      onSave(panel) {
        panel.querySelector('[data-action="cancel"]')?.addEventListener('click', () => closeModal({ force: true }));
        panel.querySelector('#widget-options-form')?.addEventListener('submit', (event) => {
          event.preventDefault();
          const next = {};
          for (const [key, field] of Object.entries(schema)) {
            const el = panel.querySelector(`[name="opt-${CSS.escape(key)}"]`);
            if (!el) continue;
            if (field.type === 'boolean') {
              if (el.checked) next[key] = true;
            } else if (field.type === 'number') {
              const num = Number(el.value);
              if (Number.isFinite(num)) next[key] = num;
            } else {
              const text = el.value.trim();
              if (text) next[key] = text;
            }
          }
          finish(Object.keys(next).length ? next : {});
          closeModal({ force: true });
        });
      },
    });
  });
}

async function openWidgetOptions(id, current = {}, { loadNotes = loadNoteCategories } = {}) {
  const extMeta = getExtensionWidgetMeta(id);
  if (extMeta?.optionsSchema) return openExtensionWidgetOptions(id, extMeta, current);

  const options = { ...current };
  const categories = id === 'tasks'
    ? await loadTaskCategories()
    : id === 'notes' ? await loadNotes() : [];
  const wasteTypes = id === 'waste' ? await loadWasteTypes() : [];
  // A missing catalog is different from a valid empty catalog. Closing with
  // null makes the caller preserve current options instead of saving `{}` and
  // silently erasing an existing category filter after a transient failure.
  if (id === 'notes' && categories === null) {
    window.aashiyana?.showToast(t('dashboard.loadError'), 'danger');
    return null;
  }

  const body = id === 'calendar'
    ? `
      <fieldset class="form-group widget-options__group">
        <legend class="form-label">${t('dashboard.optionCalendarScope')}</legend>
        <label class="widget-options__choice">
          <input type="radio" name="cal-scope" value="all" ${options.scope === 'mine' ? '' : 'checked'}>
          <span>${t('dashboard.optionCalendarAll')}</span>
        </label>
        <label class="widget-options__choice">
          <input type="radio" name="cal-scope" value="mine" ${options.scope === 'mine' ? 'checked' : ''}>
          <span>${t('calendar.assignedToMe')}</span>
        </label>
      </fieldset>
      <fieldset class="form-group widget-options__group">
        <legend class="form-label">${t('calendar.filtersLayers')}</legend>
        <p class="widget-options__hint">${t('dashboard.optionCalendarBirthdaysHint')}</p>
        <label class="widget-options__choice">
          <input type="checkbox" name="cal-birthdays" ${options.birthdays === 'hide' ? '' : 'checked'}>
          <span>${t('calendar.toggleBirthdays')}</span>
        </label>
      </fieldset>`
    : id === 'waste'
    ? `
      <fieldset class="form-group widget-options__group">
        <legend class="form-label">${t('dashboard.optionWasteTypes')}</legend>
        <p class="widget-options__hint">${t('dashboard.optionWasteTypesHint')}</p>
        ${wasteTypes.length ? wasteTypes.map((wt) => `
        <label class="widget-options__choice">
          <input type="checkbox" name="waste-type" value="${wt.id}"
                 ${(options.types ?? []).includes(wt.id) ? 'checked' : ''}>
          <span>${esc(wt.name)}</span>
        </label>`).join('') : `<p class="widget-options__hint">${t('dashboard.optionWasteTypesEmpty')}</p>`}
      </fieldset>`
    : id === 'tasks' ? `
      <fieldset class="form-group widget-options__group">
        <legend class="form-label">${t('dashboard.optionTaskCategories')}</legend>
        <p class="widget-options__hint">${t('dashboard.optionTaskCategoriesHint')}</p>
        ${categories.length ? categories.map((c) => `
        <label class="widget-options__choice">
          <input type="checkbox" name="task-category" value="${esc(c.key)}"
                 ${(options.categories ?? []).includes(c.key) ? 'checked' : ''}>
          <span>${esc(taskCategoryLabel(c))}</span>
        </label>`).join('') : `<p class="widget-options__hint">${t('dashboard.optionTaskCategoriesEmpty')}</p>`}
      </fieldset>`
    : `
      <fieldset class="form-group widget-options__group">
        <legend class="form-label">${t('noteCategories.categories')}</legend>
        <p class="widget-options__hint">${t('noteCategories.widgetHint')}</p>
        ${categories.length ? categories.map((category) => `
        <label class="widget-options__choice">
          <input type="checkbox" name="note-category" value="${category.id}"
                 ${(options.categories ?? []).map(Number).includes(Number(category.id)) ? 'checked' : ''}>
          <span><i data-lucide="${category.scope === 'personal' ? 'user' : 'home'}" aria-hidden="true"></i>${esc(noteCategoryName(category))}<span class="sr-only"> (${esc(noteCategoryScope(category))})</span></span>
        </label>`).join('') : `<p class="widget-options__hint">${t('noteCategories.empty')}</p>`}
      </fieldset>`;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    openModal({
      title: t('dashboard.optionsFor', { widget: widgetLabel(id) }),
      size: 'sm',
      content: `
        <form id="widget-options-form" class="widget-options">
          ${body}
          <div class="modal-actions">
            <button type="button" class="btn btn--secondary" data-action="cancel">${t('common.cancel')}</button>
            <button type="submit" class="btn btn--primary">${t('common.save')}</button>
          </div>
        </form>`,
      onClose: () => finish(null),
      onSave(panel) {
        panel.querySelector('[data-action="cancel"]').addEventListener('click', () => closeModal({ force: true }));
        panel.querySelector('#widget-options-form').addEventListener('submit', (event) => {
          event.preventDefault();
          const next = {};
          if (id === 'calendar') {
            const scope = panel.querySelector('input[name="cal-scope"]:checked')?.value;


            // den Auslieferungszustand wiederholt.
            if (scope === 'mine') next.scope = 'mine';


            if (!panel.querySelector('input[name="cal-birthdays"]')?.checked) next.birthdays = 'hide';
          } else if (id === 'waste') {
            const picked = [...panel.querySelectorAll('input[name="waste-type"]:checked')].map((el) => Number(el.value));



            if (picked.length) next.types = picked;
          } else if (id === 'tasks') {
            const picked = [...panel.querySelectorAll('input[name="task-category"]:checked')].map((el) => el.value);


            if (picked.length) next.categories = picked;
          } else {
            const picked = [...panel.querySelectorAll('input[name="note-category"]:checked')]
              .map((el) => el.value);
            if (picked.length) next.categories = picked;
          }
          finish(next);
          closeModal({ force: true });
        });
      },
    });
  });
}

function renderWidgetCustomizeControls(w, index = 0, total = 1) {
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const activeSize = nearestPreset(w.size);



  // <select> (Critique P1: doppelte Kontrolle + Overflow auf 1Ã—1-Kacheln). Jeder

  const sizeButtons = WIDGET_SIZE_PRESETS.map((p) => {
    const active = p.value === activeSize;
    return `<button type="button" class="widget-size-btn${active ? ' widget-size-btn--active' : ''}"
              data-widget-size-preset="${p.value}" data-widget-id="${esc(w.id)}"
              aria-pressed="${active ? 'true' : 'false'}" aria-label="${esc(t(p.labelKey))}" title="${esc(t(p.labelKey))}">
        ${renderSizeMiniGrid(p.value)}
      </button>`;
  }).join('');

  return `
    <div class="widget-edit-controls" data-widget-controls>
      <button type="button" class="widget-edit-controls__handle" data-widget-drag-handle
              aria-label="${t('dashboard.customizeReorderHandle')}" aria-keyshortcuts="ArrowUp ArrowDown">
        <i data-lucide="grip-vertical" aria-hidden="true"></i>
      </button>
      <div class="widget-edit-controls__move">
        <button type="button" class="widget-edit-controls__move-btn" data-widget-move="up" data-widget-id="${esc(w.id)}"
                ${isFirst ? 'disabled' : ''} aria-label="${t('dashboard.customizeMoveUp')}">
          <i data-lucide="chevron-up" aria-hidden="true"></i>
        </button>
        <button type="button" class="widget-edit-controls__move-btn" data-widget-move="down" data-widget-id="${esc(w.id)}"
                ${isLast ? 'disabled' : ''} aria-label="${t('dashboard.customizeMoveDown')}">
          <i data-lucide="chevron-down" aria-hidden="true"></i>
        </button>
      </div>
      <div class="widget-edit-controls__size" role="group" aria-label="${t('dashboard.customizeSizeFor', { widget: widgetLabel(w.id) })}">
        ${sizeButtons}
      </div>
      ${widgetHasOptions(w.id) ? `
      <button type="button" class="widget-edit-controls__options" data-widget-options="${esc(w.id)}"
              aria-label="${esc(t('dashboard.optionsFor', { widget: widgetLabel(w.id) }))}"
              title="${esc(t('dashboard.optionsFor', { widget: widgetLabel(w.id) }))}">
        <i data-lucide="sliders-horizontal" aria-hidden="true"></i>
      </button>` : ''}
      <button type="button" class="widget-edit-controls__hide" data-widget-hide="${esc(w.id)}" aria-label="${t('dashboard.customizeHide', { widget: widgetLabel(w.id) })}">
        <i data-lucide="eye-off" aria-hidden="true"></i>
      </button>
    </div>
  `;
}





function renderHiddenWidgetsTray(cfg, glanceHidden = false) {
  const hidden = cfg.filter((w) => !w.visible && allWidgetIds().includes(w.id) && isWidgetModuleEnabled(w.id));
  if (!hidden.length && !glanceHidden) return '';


  const glanceChip = glanceHidden ? `
    <button type="button" class="widget-restore-chip" data-glance-show
            aria-label="${t('dashboard.customizeShow', { widget: t('dashboard.todayTitle') })}">
      <i data-lucide="sun" class="widget-restore-chip__icon" aria-hidden="true"></i>
      <span class="widget-restore-chip__label">${t('dashboard.todayTitle')}</span>
      <i data-lucide="plus" class="widget-restore-chip__add" aria-hidden="true"></i>
    </button>` : '';
  const chips = glanceChip + hidden.map((w) => `
    <div class="widget-restore-chip-group">
      <button type="button" class="widget-restore-chip" data-widget-show="${esc(w.id)}"
              aria-label="${t('dashboard.customizeShow', { widget: widgetLabel(w.id) })}">
        <i data-lucide="${widgetIcon(w.id)}" class="widget-restore-chip__icon" aria-hidden="true"></i>
        <span class="widget-restore-chip__label">${widgetLabel(w.id)}</span>
        <i data-lucide="plus" class="widget-restore-chip__add" aria-hidden="true"></i>
      </button>
      ${widgetHasOptions(w.id) ? `
      <button type="button" class="widget-restore-chip__options" data-widget-options="${esc(w.id)}"
              aria-label="${esc(t('dashboard.optionsFor', { widget: widgetLabel(w.id) }))}"
              title="${esc(t('dashboard.optionsFor', { widget: widgetLabel(w.id) }))}">
        <i data-lucide="sliders-horizontal" aria-hidden="true"></i>
      </button>` : ''}
    </div>`).join('');
  return `
    <section class="widget-restore" aria-label="${t('dashboard.customizeHiddenTitle')}">
      <h3 class="widget-restore__title">${t('dashboard.customizeHiddenTitle')}</h3>
      <div class="widget-restore__chips">${chips}</div>
    </section>
  `;
}

function renderDashboardLayout(cfg, data, weather, currency, { editing = false, visibleMealTypes = MEAL_ORDER, glanceHidden = false } = {}) {
  const widgetById = {
    tasks: () => renderUrgentTasks(data.urgentTasks ?? []),
    calendar: () => renderUpcomingEvents(data.upcomingEvents ?? []),
    birthdays: (size) => renderUpcomingBirthdays(data.birthdays ?? [], size),
    countdown: (size) => renderCountdowns(data.countdowns ?? [], size, data.countdownTotal),
    budget: () => renderBudgetWidget(data.budget ?? {}, currency),
    rewards: () => renderRewardsWidget(data.rewards ?? {}),
    health: () => renderHealthWidget(data.health ?? {}),
    cycle: () => renderCycleWidget(data.cycle),
    housekeeping: () => renderHousekeepingWidget(data.housekeeping ?? {}, currency),
    schedule: (size) => renderScheduleWidget(data.schedule, data.users ?? [], size),
    waste: (size) => renderWasteWidget(data.waste, size),
    family: () => renderFamilyWidget(data.users ?? [], data),
    meals: () => renderTodayMeals(data.todayMeals ?? [], visibleMealTypes),
    notes: (size) => renderPinnedNotes(data.pinnedNotes ?? [], size),
    shopping: () => renderShoppingLists(data.shoppingLists ?? []),
    weather: () => (weather ? renderWeatherWidget(weather) : ''),
    clock: () => renderClockWidget(),
    quicklinks: () => renderQuickLinks(data.quicklinks ?? []),




    // waere sonst sein eigener Grund zu schweigen.
    metrics: () => renderMetricTiles(data, currency, new Set(
      cfg.filter((w) => w.visible && w.id !== 'metrics' && isWidgetModuleEnabled(w.id)).map((w) => w.id),
    )),
  };

  const tiles = cfg
    .filter((w) => w.visible && isWidgetModuleEnabled(w.id) && (widgetById[w.id] || isExtensionWidget(w.id)))
    .map((w, index, arr) => {
      let html;
      try {
        if (isExtensionWidget(w.id)) {
          html = `<div class="widget extension-widget-mount" data-extension-widget-mount="1">
            <div class="widget__empty">${esc(t('common.loading'))}</div>
          </div>`;
        } else {
          html = widgetById[w.id](w.size);
        }
      } catch (err) {
        console.error(`[dashboard] Widget "${w.id}" konnte nicht gerendert werden`, err);
        html = renderWidgetError(w.id);
      }
      if (!html) return '';
      return `<div class="widget-wrapper ${widgetSizeClass(w.size)} ${editing ? 'widget-wrapper--editing' : ''}"
                   data-widget-id="${esc(w.id)}" ${editing ? 'draggable="true"' : ''}>
        ${editing ? renderWidgetCustomizeControls(w, index, arr.length) : ''}
        ${html}
      </div>`;
    })
    .join('');



  const gridInner = tiles
    || emptyHintHTML(t('dashboard.allWidgetsHidden'), { icon: 'layout-dashboard' });

  // (kein dense-Umpacken); der Autor-Default darf dicht packen.
  const preserveOrder = (editing || isUserOrderedConfig(cfg)) ? ' dashboard__grid--preserve-order' : '';
  const grid = `<div class="dashboard__grid ${editing ? 'dashboard__grid--editing' : ''}${preserveOrder}" id="dashboard-widget-grid">${gridInner}</div>`;


  return editing ? `${grid}${renderHiddenWidgetsTray(cfg, glanceHidden)}` : grid;
}


function renderDashboardSkeleton() {
  const tiles = layoutHintSizes(buildDefaultWidgetConfig().filter((w) => w.visible).map((w) => w.size))
    .map((size) => `<div class="widget-wrapper ${widgetSizeClass(size)}">${skeletonWidget(3)}</div>`)
    .join('');
  return `
    <section class="dashboard-overview">
      <div class="dashboard-overview__header">
        <div class="dashboard-overview__heading">
          <div class="skeleton skeleton-line skeleton-line--short"></div>
          <div class="skeleton skeleton-line skeleton-line--medium"></div>
        </div>
      </div>
    </section>
    <div class="dashboard__grid">${tiles}</div>
  `;
}





function renderDashboardError(status = null) {
  const messageKey = status === 401 || status === 403
    ? 'dashboard.loadErrorSession'
    : (typeof status === 'number' && status >= 500)
      ? 'dashboard.loadErrorServer'
      : 'dashboard.loadError';
  return `
    <div class="dashboard-error" role="alert">
      <i data-lucide="cloud-off" class="dashboard-error__icon" aria-hidden="true"></i>
      <p class="dashboard-error__text">${t(messageKey)}</p>
      <button type="button" class="btn btn--secondary" id="dashboard-retry">
        <i data-lucide="refresh-cw" aria-hidden="true"></i>
        ${t('common.retry')}
      </button>
    </div>
  `;
}


// renderDashboardLayout). Nutzt die vorhandene .widget/.widget__empty-Grammatik,

function renderWidgetError(id) {
  return `<div class="widget widget--error" role="alert">
    <div class="widget__header">
      <span class="widget__title">
        <i data-lucide="${widgetIcon(id)}" class="widget__title-icon" aria-hidden="true"></i>
        ${widgetLabel(id)}
      </span>
    </div>
    <div class="widget__empty">
      <i data-lucide="cloud-off" class="empty-state__icon" aria-hidden="true"></i>
      <div>${t('dashboard.widgetError')}</div>
      <button type="button" class="btn btn--secondary widget__retry" data-widget-retry="${esc(id)}">
        <i data-lucide="refresh-cw" aria-hidden="true"></i>
        ${t('common.retry')}
      </button>
    </div>
  </div>`;
}

// --------------------------------------------------------
// Shopping-Widget
// --------------------------------------------------------

function renderShoppingLists(lists) {
  if (!lists.length) {
    return `<div class="widget widget--shopping">
      ${widgetHeader('shopping', t('nav.shopping'), 0, '/shopping')}
      <div class="widget__empty">
        <i data-lucide="shopping-cart" class="empty-state__icon" aria-hidden="true"></i>
        <div>${t('dashboard.noShoppingLists')}</div>
        ${emptyStateCta('/shopping', t('shopping.newListButton'))}
      </div>
    </div>`;
  }

  const totalOpen = lists.reduce((sum, l) => sum + l.open_count, 0);

  const listsHtml = lists.map((list) => {
    const progress = list.total_count > 0
      ? Math.round(((list.total_count - list.open_count) / list.total_count) * 100)
      : 0;

    const itemsHtml = list.items.map((item) => `
      <div class="shopping-widget-item">
        <span class="shopping-widget-item__dot"></span>
        <span class="shopping-widget-item__name">${esc(item.name)}</span>
        ${item.quantity ? `<span class="shopping-widget-item__qty">${esc(item.quantity)}</span>` : ''}
      </div>
    `).join('');

    const moreCount = list.open_count - list.items.length;

    return `
      <div class="shopping-widget-list" data-route="/shopping" role="button" tabindex="0">
        <div class="shopping-widget-list__header">
          <span class="shopping-widget-list__name">${esc(list.name)}</span>
          <span class="shopping-widget-list__count">${list.total_count - list.open_count}/${list.total_count}</span>
        </div>
        <div class="shopping-widget-list__progress">
          <div class="shopping-widget-list__bar" style="--progress-scale:${progress / 100}"></div>
        </div>
        <div class="shopping-widget-list__items">
          ${itemsHtml}
          ${moreCount > 0 ? `<div class="shopping-widget-item shopping-widget-item--more">${t('dashboard.shoppingMore', { count: moreCount })}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  return `<div class="widget widget--shopping">
    ${widgetHeader('shopping', t('nav.shopping'), totalOpen, '/shopping')}
    <div class="widget__body">${listsHtml}</div>
  </div>`;
}

// --------------------------------------------------------
// Wetter-Widget
// --------------------------------------------------------

const WEATHER_ICON_BASE = '/api/v1/weather/icon/';


// Lucide-Icon-Namen + wmo.*-i18n-Keys; OWM (Legacy) liefert OWM-Icon-Codes
// (via /icon-Proxy) + bereits lokalisierten Beschreibungstext. OWM-Legacy kann
// zudem 'standard' (Kelvin) liefern; Open-Meteo nur metric/imperial.
function weatherUnitSymbol(units) {
  return units === 'imperial' ? 'Â°F' : units === 'standard' ? 'K' : 'Â°C';
}

function weatherDescText(weather, desc) {
  return weather?.provider === 'open-meteo' ? t(desc) : desc;
}

function weatherIconHtml(weather, icon, cls, size, desc) {
  if (weather?.provider === 'open-meteo') {
    return `<i data-lucide="${esc(icon)}" class="${cls}" aria-hidden="true"></i>`;
  }
  return `<img class="${cls}" src="${WEATHER_ICON_BASE}${esc(icon)}"
           alt="${esc(desc)}" width="${size}" height="${size}" loading="lazy">`;
}

function weatherToneKey(icon) {
  const key = String(icon || '');
  if (/^\d{2}[dn]$/.test(key)) {
    const code = key.slice(0, 2);
    const night = key.endsWith('n');
    if (code === '01') return night ? 'night' : 'clear';
    if (code === '02') return night ? 'night' : 'clear';
    if (code === '09' || code === '10') return 'rain';
    if (code === '11') return 'storm';
    if (code === '13') return 'snow';
    return 'cloud';                      // 03, 04, 50 (Nebel/Dunst)
  }
  if (key === 'sun') return 'clear';
  if (key === 'cloud-sun') return 'clear';
  if (key === 'moon' || key === 'cloud-moon') return 'night';
  if (key === 'cloud-lightning') return 'storm';
  if (key === 'cloud-snow') return 'snow';
  if (key === 'cloud-rain' || key === 'cloud-drizzle') return 'rain';
  if (key === 'cloud') return 'cloud';
  return null;
}

function weatherToneAttr(icon) {
  const tone = weatherToneKey(icon);
  return tone ? ` data-weather-tone="${tone}"` : '';
}

function weatherMotionAttr(icon) {
  const key = String(icon || '');
  const owm = /^(\d{2})([dn])$/.exec(key);
  const code = owm?.[1];



  // Lucide-Namen kommt es nie.
  if (key === 'sun') return ' data-weather-motion="rays"';
  if (key === 'moon') return '';
  if (code === '01') return owm[2] === 'n' ? '' : ' data-weather-motion="rays"';
  if (key === 'cloud-rain' || key === 'cloud-drizzle' || key === 'cloud-snow'
      || code === '09' || code === '10' || code === '13') {
    return ' data-weather-motion="fall"';
  }
  if (key === 'cloud-lightning' || code === '11') return ' data-weather-motion="flash"';
  if (key === 'cloud' || key === 'cloud-sun' || key === 'cloud-moon'
      || code === '02' || code === '03' || code === '04' || code === '50') {
    return ' data-weather-motion="drift"';
  }
  return '';
}

const WEATHER_BANDS = ['icy', 'cold', 'mild', 'warm', 'hot'];
const WEATHER_BAND_EDGES = {
  metric:   [0, 10, 20, 28],
  imperial: [32, 50, 68, 82],
  standard: [273, 283, 293, 301],
};

function weatherNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function weatherTempBand(temp, units) {
  const value = weatherNumber(temp);
  if (value === null) return null;
  const edges = WEATHER_BAND_EDGES[units] || WEATHER_BAND_EDGES.metric;
  let i = 0;
  while (i < edges.length && value >= edges[i]) i += 1;
  return WEATHER_BANDS[i];
}





function mastheadWeatherHtml(weather) {
  if (!weather?.current) return '';
  const desc = weatherDescText(weather, weather.current.desc);
  return `
    <p class="dashboard-overview__weather"${weatherToneAttr(weather.current.icon)}>
      ${weatherIconHtml(weather, weather.current.icon, 'dashboard-overview__weather-icon', 18, desc)}
      <span>${esc(String(weather.current.temp))}${weatherUnitSymbol(weather.units)} Â· ${esc(desc)}</span>
    </p>`;
}

function weatherIsToday(weather, dateKey) {
  const ref = weather?.today?.date;
  return Boolean(ref) && dateKey === ref;
}

function weatherDayLabel(weather, dateKey) {
  if (weatherIsToday(weather, dateKey)) return t('common.today');
  return new Intl.DateTimeFormat(getLocale(), { weekday: 'short' })
    .format(new Date(`${dateKey}T12:00:00`));
}

function weatherTodayRange(weather, cls) {
  const hi = weatherNumber(weather?.today?.temp_max);
  const lo = weatherNumber(weather?.today?.temp_min);
  if (hi === null || lo === null) return '';
  // Zwei nackte Zahlen nebeneinander sagen vorgelesen nichts - die Auszeichnung

  const aria = esc(t('dashboard.weatherHighLow', { max: hi, min: lo }));




  return `<span class="${cls}" role="img" aria-label="${aria}">
      <span class="${cls}-high" aria-hidden="true">${esc(String(hi))}Â°</span>
      <span class="${cls}-low" aria-hidden="true">${esc(String(lo))}Â°</span>
    </span>`;
}

const WEATHER_SPAN_MIN = 0.14;

function weatherSpanModel(forecast) {
  const days = Array.isArray(forecast) ? forecast : [];
  const values = days.flatMap((d) => [weatherNumber(d.temp_min), weatherNumber(d.temp_max)])
    .filter((v) => v !== null);
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  return (d) => {
    const min = weatherNumber(d.temp_min);
    const max = weatherNumber(d.temp_max);
    if (min === null || max === null) return null;
    let from = span > 0 ? (min - lo) / span : 0;
    let to   = span > 0 ? (max - lo) / span : 1;
    if (to - from < WEATHER_SPAN_MIN) {
      const mid = (from + to) / 2;
      from = Math.max(0, Math.min(1 - WEATHER_SPAN_MIN, mid - WEATHER_SPAN_MIN / 2));
      to = from + WEATHER_SPAN_MIN;
    }
    return { from, to };
  };
}

function renderWeatherWidget(weather) {
  if (!weather) return '';

  const { city, current, forecast, units } = weather;

  const unitSymbol = weatherUnitSymbol(units);
  const windUnit   = units === 'imperial' ? 'mph' : 'km/h';

  const descText = (desc) => weatherDescText(weather, desc);
  const iconHtml = (icon, cls, size, desc) => weatherIconHtml(weather, icon, cls, size, desc);

  const spanOf = weatherSpanModel(forecast);

  const forecastHtml = forecast.map((d, i) => {
    const label = weatherDayLabel(weather, d.date);
    const extraCls = i >= 3 ? ' weather-forecast__day--extended' : '';


    const band = weatherTempBand(d.temp_max, units);
    const span = spanOf?.(d);
    const spanHtml = span
      ? `<div class="weather-forecast__span"${band ? ` data-weather-band="${band}"` : ''}
              style="--span-from:${span.from.toFixed(4)};--span-to:${span.to.toFixed(4)}" aria-hidden="true"></div>`
      : '';
    return `
      <div class="weather-forecast__day${extraCls}">
        <div class="weather-forecast__label${weatherIsToday(weather, d.date) ? ' weather-forecast__label--today' : ''}">${esc(label)}</div>
        ${iconHtml(d.icon, 'weather-forecast__icon', 32, descText(d.desc))}
        <div class="weather-forecast__temps">
          <span class="weather-forecast__high">${d.temp_max}Â°</span>
          <span class="weather-forecast__low">${d.temp_min}Â°</span>
        </div>
        ${spanHtml}
      </div>`;
  }).join('');

  return `
    <div class="widget widget--weather weather-widget" id="weather-widget"${weatherToneAttr(current.icon)}${weatherMotionAttr(current.icon)}>
      ${widgetHeader('weather', t('dashboard.weather'), null, null, null, 'dashboard')}
      <button class="weather-widget__refresh" id="weather-refresh-btn" aria-label="${t('dashboard.weatherRefresh')}" title="${t('dashboard.weatherRefreshTitle')}">
        <i data-lucide="refresh-cw" class="icon-md" aria-hidden="true"></i>
      </button>
      <div class="weather-widget__inner">
        <div class="weather-widget__main">
          <div class="weather-widget__left">
            <div class="weather-widget__temp">${esc(current.temp)}${unitSymbol}</div>
            ${weatherTodayRange(weather, 'weather-widget__range')}
            <div class="weather-widget__desc">${esc(descText(current.desc))}</div>
            <div class="weather-widget__city">${esc(city)}</div>
            <div class="weather-widget__meta">
              ${t('dashboard.weatherFeelsLike', { temp: current.feels_like, humidity: current.humidity, wind: current.wind_speed, windUnit })}
            </div>
          </div>
          <span class="weather-widget__glyph">${iconHtml(current.icon, 'weather-widget__icon', 80, descText(current.desc))}</span>
        </div>
        ${forecast.length ? `<div class="weather-forecast">${forecastHtml}</div>` : ''}
      </div>
    </div>`;
}

// --------------------------------------------------------
// Uhr-Widget (#651)
// --------------------------------------------------------

function clockWidgetParts(now = new Date()) {



  // haette dieselbe Kachel zwei Tage gezeigt.
  const f = nowFields(now);
  const weekday = new Intl.DateTimeFormat(getLocale(), {
    weekday: 'long', timeZone: 'UTC',
  }).format(zonedUTCProxy(now));
  return {
    time: formatTime(now),
    date: `${weekday}, ${formatDate(now)}`,
    machineTime: `${String(f.hour).padStart(2, '0')}:${String(f.minute).padStart(2, '0')}`,
  };
}

function renderClockWidget({ wall = false } = {}) {
  const { time, date, machineTime } = clockWidgetParts();
  const cls = wall ? 'clock-widget clock-widget--wall' : 'widget widget--clock clock-widget';
  const body = `
    <time class="clock-widget__time" id="clock-widget-time" datetime="${esc(machineTime)}">${esc(time)}</time>
    <p class="clock-widget__date" id="clock-widget-date">${esc(date)}</p>`;
  // Kachel-Form bekommt seit dem Polish-Batch (PLAN.md #7) denselben




  if (wall) {
    return `<div class="${cls}" id="clock-widget">${body}</div>`;
  }
  return `
    <div class="${cls}" id="clock-widget">
      ${widgetHeader('clock', t('dashboard.clock'), null, null, null, 'dashboard')}
      <div class="widget__body clock-widget__body">${body}</div>
    </div>`;
}

function updateClockWidget(container) {
  const timeEl = container.querySelector('#clock-widget-time');
  if (!timeEl) return;
  const { time, date, machineTime } = clockWidgetParts();
  timeEl.textContent = time;
  timeEl.setAttribute('datetime', machineTime);
  const dateEl = container.querySelector('#clock-widget-date');
  if (dateEl) dateEl.textContent = date;
}

function startClockTicker(container, signal, onTick = null) {
  let timerId = null;

  const tick = () => {
    updateClockWidget(container);
    onTick?.();
    schedule();
  };

  const schedule = () => {
    const now = new Date();
    const msToNextMinute = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
    timerId = setTimeout(tick, msToNextMinute);
  };

  schedule();
  signal.addEventListener('abort', () => clearTimeout(timerId));
}

// --------------------------------------------------------
// Wand-Modus (Block D)
// --------------------------------------------------------


const WALL_HEAL_MS = 60_000;
const WALL_AWAKE_MS = 6000;
const WALL_WHO_CAP = 6;

const WALL_ROW_CAP = 4;

function renderWallRow(row) {
  const time = row.timeLabel
    ? `<span class="wall-row__time${row.overdue ? ' wall-row__time--overdue' : ''}">${esc(row.timeLabel)}</span>`
    : '';
  return `
    <li class="wall-row wall-row--${esc(row.tone)}">
      <span class="module-seal wall-row__seal">${moduleIconHTML(row.icon)}</span>
      <span class="wall-row__body">
        <span class="wall-row__title">${esc(row.title)}</span>
        <span class="wall-row__sub">${esc(row.sub)}</span>
      </span>
      ${time}
    </li>`;
}

function renderWallProgram(model) {
  const parts = [];
  if (model.state) {


    parts.push(`
      <li class="wall-row wall-row--state">
        <span class="module-seal wall-row__seal">${moduleIconHTML(model.state.icon)}</span>
        <span class="wall-row__body">
          <span class="wall-row__title">${esc(model.state.title)}</span>
          ${model.state.sub ? `<span class="wall-row__sub">${esc(model.state.sub)}</span>` : ''}
        </span>
      </li>`);
  }
  parts.push(...model.rows.map(renderWallRow));
  if (model.shopping) parts.push(renderWallRow(model.shopping));

  const foot = model.overflow > 0
    ? t('dashboard.todayMore', { count: model.overflow })
    : model.coda;

  return `
    <section class="wall__program" aria-labelledby="wall-program-title">
      <h2 class="wall__section-title" id="wall-program-title">${esc(t('dashboard.todayTitle'))}</h2>
      <ol class="wall-program__list">${parts.join('')}</ol>
      ${foot ? `<p class="wall-program__foot">${esc(foot)}</p>` : ''}
    </section>`;
}

function renderWallWho(data, model) {
  if (isSoloHousehold()) return '';
  const users = Array.isArray(data?.users) ? data.users : [];
  if (!users.length) return '';

  const counts = new Map();
  for (const row of model.allRows) {
    const id = row.who?.id;
    if (id == null) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const onDuty = users
    .filter((u) => counts.has(u.id))
    .sort((a, b) => (counts.get(b.id) - counts.get(a.id)) || String(a.display_name).localeCompare(String(b.display_name)));

  const shown = onDuty.slice(0, WALL_WHO_CAP);
  const body = shown.length
    ? `<ul class="wall-who__list">${shown.map((u) => {
        const color = u.avatar_color || AVATAR_FALLBACK_COLOR;
        const count = counts.get(u.id);
        return `
          <li class="wall-who__member">
            <span class="wall-who__mark">
              <span class="wall-who__avatar" style="background:${esc(color)};color:${getReadableTextColor(color)}">
                ${u.avatar_data ? `<img src="${esc(u.avatar_data)}" alt="" loading="lazy">` : esc(initials(u.display_name))}
              </span>
              <span class="wall-who__count">
                <span aria-hidden="true">${esc(String(count))}</span>
                <span class="sr-only">${esc(t('dashboard.wallWhoCount', { count }))}</span>
              </span>
            </span>
            <span class="wall-who__name">${esc(firstName(u.display_name))}</span>
          </li>`;
      }).join('')}</ul>${onDuty.length > shown.length
        ? `<p class="wall-who__more">${esc(t('dashboard.shoppingMore', { count: onDuty.length - shown.length }))}</p>`
        : ''}`
    : `<p class="wall-who__none">${esc(t('dashboard.wallWhoNone'))}</p>`;

  return `
    <section class="wall__who" aria-labelledby="wall-who-title">
      <h2 class="wall__section-title" id="wall-who-title">${esc(t('dashboard.wallWho'))}</h2>
      ${body}
    </section>`;
}

function renderWallWeather(weather) {
  if (!weather?.current) return '';
  const { city, current, forecast, units } = weather;
  const desc = weatherDescText(weather, current.desc);
  const days = (Array.isArray(forecast) ? forecast : []).slice(0, 4).map((d) => {
    const label = weatherDayLabel(weather, d.date);
    return `
      <li class="wall-weather__day"${weatherToneAttr(d.icon)}>
        <span class="wall-weather__day-label">${esc(label)}</span>
        ${weatherIconHtml(weather, d.icon, 'wall-weather__day-icon', 32, weatherDescText(weather, d.desc))}
        <span class="wall-weather__day-temps">
          <span class="wall-weather__day-high">${esc(String(d.temp_max))}Â°</span>
          <span class="wall-weather__day-low">${esc(String(d.temp_min))}Â°</span>
        </span>
      </li>`;
  }).join('');

  return `
    <section class="wall__weather" aria-labelledby="wall-weather-title"${weatherToneAttr(current.icon)}${weatherMotionAttr(current.icon)}>
      <h2 class="wall__section-title" id="wall-weather-title">${esc(t('dashboard.weather'))}</h2>
      <div class="wall-weather__now">
        ${weatherIconHtml(weather, current.icon, 'wall-weather__icon', 64, desc)}
        <span class="wall-weather__body">
          <span class="wall-weather__temp">${esc(String(current.temp))}${weatherUnitSymbol(units)}</span>
          ${weatherTodayRange(weather, 'wall-weather__range')}
          <span class="wall-weather__desc">${esc(desc)}${city ? ` Â· ${esc(city)}` : ''}</span>
        </span>
      </div>
      ${days ? `<ol class="wall-weather__forecast">${days}</ol>` : ''}
    </section>`;
}

function renderWallError() {
  return `
    <section class="wall__error" role="status">
      <i data-lucide="cloud-off" class="wall__error-icon" aria-hidden="true"></i>
      <p class="wall__error-title">${esc(t('dashboard.wallOffline'))}</p>
      <p class="wall__error-sub">${esc(t('dashboard.wallOfflineHint'))}</p>
    </section>`;
}

function renderWallSurface(data, weather, { failed = false, loading = false, updatedAt = null } = {}) {
  const model = failed || loading ? null : buildTodayCockpitModel(data, [], { cap: WALL_ROW_CAP });

  let main;
  if (failed) {
    main = renderWallError();
  } else if (loading) {
    main = '<div class="wall__loading" aria-hidden="true"></div>';
  } else {
    const aside = `${renderWallWho(data, model)}${renderWallWeather(weather)}`;
    main = `
      ${renderWallProgram(model)}
      ${aside ? `<div class="wall__aside">${aside}</div>` : ''}`;
  }

  const stamp = updatedAt
    ? `<p class="wall__updated">${esc(t('dashboard.updatedAt', { time: formatTime(updatedAt) }))}</p>`
    : '<p class="wall__updated"></p>';




  const timer = renderWallTimer();

  return `
    <div class="wall">
      ${renderClockWidget({ wall: true })}
      <div class="wall__stage${failed || loading ? ' wall__stage--single' : ''}">${main}</div>
      ${timer.display}
      <div class="wall__foot">
        ${stamp}
        ${timer.controls}
        <button type="button" class="wall__foot-btn" id="wall-exit" aria-label="${esc(t('dashboard.wallExit'))}">
          <i data-lucide="minimize-2" aria-hidden="true"></i>
          <span class="wall__foot-btn-label" aria-hidden="true">${esc(t('dashboard.wallExit'))}</span>
        </button>
      </div>
    </div>`;
}

function wireWallSurface(container, rerender, signal) {
  const wall = container.querySelector('.wall');
  if (!wall) return;

  let awakeTimer = null;
  const wake = () => {
    wall.setAttribute('data-wall-awake', '');
    clearTimeout(awakeTimer);
    awakeTimer = setTimeout(() => wall.removeAttribute('data-wall-awake'), WALL_AWAKE_MS);
  };
  for (const type of ['pointerdown', 'pointermove', 'keydown']) {
    window.addEventListener(type, wake, { passive: true, signal });
  }
  signal.addEventListener('abort', () => clearTimeout(awakeTimer));

  wireWallTimer(wall, rerender, signal);
}

function wireWallExit(container, rerender, signal) {
  const leave = () => {
    exitWallMode();



    // umbenannt wird.
    //




    // schlechtere Auskunft als gar keiner.
    window.aashiyana?.showToast(t('dashboard.wallExited', {
      action: t('dashboard.wallEnter'),
    }), 'success', 6000);
    rerender();
  };

  container.addEventListener('click', (event) => {
    if (event.target.closest('#wall-exit')) leave();
  }, { signal });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') leave();
  }, { signal });
}

// --------------------------------------------------------
// FAB Speed-Dial
// --------------------------------------------------------

const FAB_ACTIONS = () => [
  { route: '/tasks',    label: t('dashboard.fabTask'),     icon: 'check-square'   },
  { route: '/calendar', label: t('dashboard.fabCalendar'), icon: 'calendar-plus'  },
  { route: '/shopping', label: t('dashboard.fabShopping'), icon: 'shopping-cart'  },
  { route: '/notes',    label: t('dashboard.fabNote'),     icon: 'sticky-note'    },
];

function renderFab() {
  const actionsHtml = FAB_ACTIONS().map((a) => `
    <button type="button" class="fab-action" data-route="${a.route}" tabindex="-1"
            aria-label="${a.label}">
      <span class="fab-action__label">${a.label}</span>
      <span class="fab-action__btn" aria-hidden="true">
        <i data-lucide="${a.icon}" aria-hidden="true"></i>
      </span>
    </button>
  `).join('');






  return `
    <div class="page-fab-group" id="fab-group">
      <div class="fab-backdrop" id="fab-backdrop"></div>
      <button type="button" class="page-fab" id="fab-main" aria-label="${t('nav.quickActions')}" title="${t('nav.quickActions')} (n)" aria-keyshortcuts="n" aria-expanded="false">
        <i data-lucide="plus" aria-hidden="true"></i>
      </button>
      <div class="fab-actions" id="fab-actions" aria-hidden="true">
        ${actionsHtml}
      </div>
    </div>
  `;
}

function initFab(signal) {
  const fabMain     = findPageFab('fab-main');
  const fabGroup    = fabMain?.closest('.page-fab-group');
  const fabActions  = fabGroup?.querySelector('#fab-actions');
  const fabBackdrop = fabGroup?.querySelector('#fab-backdrop');
  if (!fabMain || !fabActions) return;


  const FAB_NEW_BTN = {
    '/tasks':    '#btn-new-task',
    '/calendar': '#fab-new-event',
    '/shopping': '#fab-new-item',
    '/notes':    '#fab-new-note',
  };

  let open = false;

  function toggleFab(force) {
    open = force !== undefined ? force : !open;


    fabMain.setAttribute('aria-expanded', String(open));
    fabActions.classList.toggle('fab-actions--visible', open);
    fabActions.setAttribute('aria-hidden', String(!open));
    fabBackdrop?.classList.toggle('fab-backdrop--visible', open);
    fabActions.querySelectorAll('.fab-action').forEach((el) => {
      el.tabIndex = open ? 0 : -1;
    });
    if (window.lucide) window.lucide.createIcons({ el: fabGroup });
  }

  fabMain.addEventListener('click', (e) => { e.stopPropagation(); toggleFab(); });

  fabActions.querySelectorAll('[data-route]').forEach((el) => {
    const go = async () => {
      toggleFab(false);
      await window.aashiyana.navigate(el.dataset.route);
      const btnSelector = FAB_NEW_BTN[el.dataset.route];
      if (btnSelector) document.querySelector(btnSelector)?.click();
    };
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });

  document.addEventListener('click', () => { if (open) toggleFab(false); }, { signal });







  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !open) return;
    toggleFab(false);
    fabMain.focus();
  }, { signal });
}

// --------------------------------------------------------

// --------------------------------------------------------

async function openTaskFromOverview(taskId, container, rerender, user) {
  try {
    const { openTaskById } = await import('/pages/tasks.js');
    await openTaskById(taskId, { user, container, onChanged: rerender });
  } catch (err) {
    console.error('[Dashboard] Aufgabe konnte nicht geÃ¶ffnet werden:', err);
    window.aashiyana?.showToast(err.message ?? t('tasks.loadError'), 'danger');
  }
}

// --------------------------------------------------------
// Navigations-Links verdrahten
// --------------------------------------------------------

function wireLinks(container, rerender, { editing = false, user = null } = {}) {
  container.querySelectorAll('[data-route]').forEach((el) => {
    if (el.id === 'fab-main' || el.closest('#fab-actions')) return;
    if (editing && el.closest('.widget-wrapper--editing')) return;



    // Aufgabenliste erneut suchen zu lassen (Critique P3).


    if (!editing && el.dataset.objectKind === 'task' && el.dataset.objectId) {
      const show = () => openTaskFromOverview(el.dataset.objectId, container, rerender, user);
      el.addEventListener('click', show);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); }
      });
      return;
    }
    const go = () => window.aashiyana.navigate(el.dataset.route);
    if (el.tagName === 'A') {
      el.addEventListener('click', (e) => {





        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        go();
      });
    } else {
      el.addEventListener('click', go);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    }
  });



  // dort zieht man Kacheln, man bearbeitet ihren Inhalt nicht.
  if (!editing) {
    container.querySelectorAll('[data-quick-links-manage]').forEach((el) => {
      el.addEventListener('click', () => openQuickLinksManager({ onChange: rerender }));
    });
  }


  if (editing) return;



  container.querySelectorAll('.task-item[data-task-id], .countdown-item[data-task-id]').forEach((el) => {
    const show = () => openTaskFromOverview(el.dataset.taskId, container, rerender, user);
    el.addEventListener('click', show);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); }
    });
  });
}

function reorderWidgetConfig(config, fromId, toId, placement = 'before') {
  const fromIdx = config.findIndex((w) => w.id === fromId);
  let toIdx = config.findIndex((w) => w.id === toId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return config;
  const next = config.map((w) => ({ ...w }));
  const [moved] = next.splice(fromIdx, 1);
  if (fromIdx < toIdx) toIdx -= 1;
  if (placement === 'after') toIdx += 1;
  next.splice(toIdx, 0, moved);
  return next.map((w, i) => ({ ...w, order: i }));
}

function closestWidgetDrop(grid, event, draggedId) {
  const candidates = [...grid.querySelectorAll('.widget-wrapper[data-widget-id]')]
    .filter((item) => item.dataset.widgetId !== draggedId);
  if (!candidates.length) return null;

  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const item of candidates) {
    const rect = item.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = event.clientX - centerX;
    const dy = event.clientY - centerY;
    const distance = (dy * dy * 1.7) + (dx * dx);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = { item, rect };
    }
  }
  if (!nearest) return null;

  const sameRow = event.clientY >= nearest.rect.top && event.clientY <= nearest.rect.bottom;
  const placement = sameRow
    ? (event.clientX > nearest.rect.left + nearest.rect.width / 2 ? 'after' : 'before')
    : (event.clientY > nearest.rect.top + nearest.rect.height / 2 ? 'after' : 'before');

  return { id: nearest.item.dataset.widgetId, placement, item: nearest.item };
}

function updateWidgetConfig(config, id, patch) {
  return config.map((w) => w.id === id ? { ...w, ...patch } : w)
    .map((w, i) => ({ ...w, order: i }));
}

// --------------------------------------------------------
// Haupt-Render
// --------------------------------------------------------


export async function maybeUpdateAutoLocation({ autoLocateEnabled, geolocation, putPreferences }) {
  if (!autoLocateEnabled || !geolocation) return false;
  try {
    const position = await new Promise((resolve, reject) => {
      geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 8000 });
    });
    await putPreferences({
      weather_user: {
        lat: position.coords.latitude.toFixed(4),
        lon: position.coords.longitude.toFixed(4),


        city: null,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function render(container, { user, signal: routeSignal = null } = {}) {
  _fabController?.abort();



  // Modul-Feld, sonst registrierte ein ueberholter Aufbau seine Timer am

  // zeichnet gar nichts mehr.
  if (routeSignal?.aborted) return;
  const controller = createPageController(routeSignal);
  _fabController = controller;
  const { signal } = controller;




  // Router bereits an der Wurzel vermerkt (utils/wall-mode.js).
  const wallMode = isWallActive();

  setHtml(container, `
    <div class="dashboard app-page app-page--dashboard${wallMode ? ' dashboard--wall' : ''}" data-composition="dashboard">
      <h1 class="sr-only">${t('dashboard.title')}</h1>
      <div class="dashboard-shell" id="dashboard-shell">
        ${wallMode ? renderWallSurface(null, null, { loading: true }) : renderDashboardSkeleton()}
      </div>
    </div>
    ${wallMode ? '' : renderFab()}
  `);

  const rerender = () => render(container, { user, signal: routeSignal });







  //


  // seinen vorigen Takt selbst ab.
  if (wallMode) {
    wireWallTimer(container.querySelector('.wall'), rerender, signal);


    // Rendern und braucht keinen zweiten Aufruf.
    wireWallExit(container, rerender, signal);
  }

  let data         = { upcomingEvents: [], urgentTasks: [], todayMeals: [], pinnedNotes: [], shoppingLists: [], birthdays: [], countdowns: [], users: [], budget: {}, rewards: {}, health: {}, housekeeping: {} };

  // wieder wahr (siehe die Notiz an `countdownAvailable`).
  setCountdownAvailability([]);
  let weather      = null;
  let weatherAutoLocate = false;
  let widgetConfig = buildDefaultWidgetConfig();
  let savedWidgetConfig = buildDefaultWidgetConfig();







  let glanceVisible = true;
  let savedGlanceVisible = true;


  let followsDefault = true;
  const canPublish = user?.role === 'admin';
  let isCustomizing = false;
  let currency     = 'INR';
  let visibleMealTypes = MEAL_ORDER;
  let loadFailed   = false;
  let loadErrorStatus = null;


  // dahinter waere die falscheste aller Angaben.
  let lastLoadedAt = null;
  try {
    const [dashRes, weatherRes, prefsRes] = await Promise.all([
      api.get(layoutHintQuery('/dashboard')),
      api.get(`/weather?lang=${encodeURIComponent(getLocale())}`).catch(() => ({ data: null })),
      api.get('/preferences').catch(() => ({ data: {} })),
    ]);


    if (signal.aborted) return;
    primeMealTypeNames(prefsRes?.data);
    data         = dashRes;
    window.aashiyana?.primeModuleCountsFrom?.(dashRes, {
      filtered: layoutHintQuery('/dashboard') !== '/dashboard',
    });
    // Geburtstags-Termine tragen serverseitig einen sprachneutralen Titel


    if (Array.isArray(data?.upcomingEvents)) {
      data.upcomingEvents = data.upcomingEvents.map(localizeBirthdayEvent);
    }
    setCountdownAvailability(data?.countdowns);
    weather      = weatherRes.data ?? null;
    weatherAutoLocate = Boolean(prefsRes.data?.weather_user?.auto_locate ?? prefsRes.data?.weather_auto_locate);
    widgetConfig = normalizeDashboardConfigWithExtensions(prefsRes.data?.dashboard_widgets ?? buildDefaultWidgetConfig());
    savedWidgetConfig = widgetConfig.map((w) => ({ ...w }));
    if (dashboardQuery(widgetConfig) !== layoutHintQuery('/dashboard')) {
      try {
        const filtered = await api.get(dashboardQuery(widgetConfig));
        if (signal.aborted) return;
        if (Array.isArray(filtered?.upcomingEvents)) {
          filtered.upcomingEvents = filtered.upcomingEvents.map(localizeBirthdayEvent);
        }
        data = filtered;
        setCountdownAvailability(data?.countdowns);
      } catch { /* die ungefilterte Antwort steht bereits - lieber mehr als nichts */ }
    }
    glanceVisible = prefsRes.data?.dashboard_today_glance !== false;
    savedGlanceVisible = glanceVisible;
    followsDefault = prefsRes.data?.dashboard_follows_default !== false;

    rememberLayoutHint(widgetConfig, dashboardQuery(widgetConfig));
    currency     = prefsRes.data?.currency ?? 'INR';
    visibleMealTypes = normalizeVisibleMealTypes(prefsRes.data?.visible_meal_types);
    lastLoadedAt = new Date();
  } catch (err) {
    console.error('[Dashboard] Ladefehler:', err.message, 'Status:', err.status ?? 'network');
    loadFailed = true;
    loadErrorStatus = Number.isFinite(err?.status) ? err.status : null;
  }





  async function ensureCycleSlice() {
    if (data.cycle !== undefined) return;
    if (window.aashiyana?.isModuleDisabled('health')) return;
    try {
      const [periodsRes, settingsRes] = await Promise.all([
        api.get('/health/cycle/periods'),
        api.get('/health/cycle/settings').catch(() => ({ data: {} })),
      ]);
      data.cycle = { periods: periodsRes.data || [], settings: settingsRes.data || {} };
    } catch (err) {
      console.error('[Dashboard] Zyklus-Slice Ladefehler:', err?.message);
      data.cycle = null;
    }
  }




  // Schedule-Seite fuer ihre eigene â€žHeute"-Karte nutzt); die Typenliste daneben

  async function ensureScheduleSlice() {
    if (data.schedule !== undefined) return;
    if (window.aashiyana?.isModuleDisabled('schedule')) return;
    try {
      const day = householdToday();
      const [entriesRes, typesRes] = await Promise.all([
        api.get(`/schedule/entries?from=${day}&to=${day}`),
        api.get('/schedule/shift-types'),
      ]);
      data.schedule = { entries: entriesRes.data?.entries ?? [], hasTypes: (typesRes.data ?? []).length > 0 };
    } catch (err) {
      console.error('[Dashboard] Schedule-Slice Ladefehler:', err?.message);
      data.schedule = null;
    }
  }





  // selbst (siehe Kommentar an renderWasteWidget).
  async function ensureWasteSlice() {
    if (data.waste !== undefined) return;
    if (window.aashiyana?.isModuleDisabled('waste')) return;
    try {
      const [nextRes, sourcesRes] = await Promise.all([
        api.get('/waste/occurrences/next'),
        api.get('/waste/sources'),
      ]);
      // Per-type widget option (#1063 Phase 10), same shape as tasks' own
      // category filter: no selection (or every type selected) means "all" -
      // an empty picked list would otherwise be an empty widget for anyone
      // who only ever opened the options dialog.
      const selectedTypes = widgetConfig.find((w) => w.id === 'waste')?.options?.types;
      const items = nextRes.data ?? [];
      data.waste = {
        items: (selectedTypes?.length ? items.filter((i) => selectedTypes.includes(i.type.id)) : items),
        needsRefresh: (sourcesRes.data ?? []).some((s) => s.needs_refresh),
      };
    } catch (err) {
      console.error('[Dashboard] Waste-Slice Ladefehler:', err?.message);
      data.waste = null;
    }
  }



  if (!loadFailed && widgetConfig.some((w) => w.id === 'cycle' && w.visible)) {
    await ensureCycleSlice();
  }
  if (!loadFailed && widgetConfig.some((w) => w.id === 'schedule' && w.visible)) {
    await ensureScheduleSlice();
  }
  if (!loadFailed && widgetConfig.some((w) => w.id === 'waste' && w.visible)) {
    await ensureWasteSlice();
  }

  // ueberholt worden sein (#977).
  if (signal.aborted) return;





  async function reloadIfQueryChanged(previousQuery) {
    if (dashboardQuery(widgetConfig) === previousQuery) return;
    try {
      const fresh = await api.get(dashboardQuery(widgetConfig));
      if (Array.isArray(fresh?.upcomingEvents)) {
        fresh.upcomingEvents = fresh.upcomingEvents.map(localizeBirthdayEvent);
      }
      fresh.cycle = data.cycle;
      fresh.schedule = data.schedule;
      fresh.waste = data.waste;
      data = fresh;
      setCountdownAvailability(data?.countdowns);
      lastLoadedAt = new Date();
    } catch { /* der alte Stand bleibt stehen, statt die Seite zu leeren */ }
  }

  async function persistWidgetConfig(nextConfig) {
    const previousConfig = savedWidgetConfig.map((w) => ({ ...w }));
    const previousQuery = dashboardQuery(savedWidgetConfig);
    widgetConfig = nextConfig.map((w) => ({ ...w }));
    const previousGlance = savedGlanceVisible;
    await api.put('/preferences', { dashboard_widgets: widgetConfig, dashboard_today_glance: glanceVisible });
    savedWidgetConfig = widgetConfig.map((w) => ({ ...w }));
    savedGlanceVisible = glanceVisible;

    // mich erst wieder, wenn ich ihn loesche.
    followsDefault = false;
    rememberLayoutHint(widgetConfig, dashboardQuery(widgetConfig));
    isCustomizing = false;


    if (widgetConfig.some((w) => w.id === 'cycle' && w.visible)) await ensureCycleSlice();
    if (widgetConfig.some((w) => w.id === 'schedule' && w.visible)) await ensureScheduleSlice();


    // reloadIfQueryChanged() wuerde den alten, ungefilterten Stand also
    // stillschweigend behalten. Ein geaenderter Typ-Filter verwirft ihn


    const wasteOptionsChanged = JSON.stringify(previousConfig.find((w) => w.id === 'waste')?.options ?? null)
      !== JSON.stringify(widgetConfig.find((w) => w.id === 'waste')?.options ?? null);
    if (wasteOptionsChanged) data.waste = undefined;
    if (widgetConfig.some((w) => w.id === 'waste' && w.visible)) await ensureWasteSlice();
    await reloadIfQueryChanged(previousQuery);
    rebuildDashboard(widgetConfig);

    const changed = !sameWidgetConfig(previousConfig, widgetConfig) || previousGlance !== glanceVisible;
    const onUndo = changed
      ? async () => {
          const queryBeforeUndo = dashboardQuery(widgetConfig);
          const wasteOptionsBeforeUndo = JSON.stringify(widgetConfig.find((w) => w.id === 'waste')?.options ?? null);
          try {
            widgetConfig = previousConfig.map((w) => ({ ...w }));
            glanceVisible = previousGlance;
            await api.put('/preferences', { dashboard_widgets: widgetConfig, dashboard_today_glance: glanceVisible });
            savedWidgetConfig = widgetConfig.map((w) => ({ ...w }));
            savedGlanceVisible = glanceVisible;
            rememberLayoutHint(widgetConfig, dashboardQuery(widgetConfig));
            if (wasteOptionsBeforeUndo !== JSON.stringify(widgetConfig.find((w) => w.id === 'waste')?.options ?? null)) data.waste = undefined;
            if (widgetConfig.some((w) => w.id === 'waste' && w.visible)) await ensureWasteSlice();
            await reloadIfQueryChanged(queryBeforeUndo);
          } catch {
            window.aashiyana?.showToast(t('common.errorGeneric'), 'danger');
          }
          isCustomizing = false;
          rebuildDashboard(widgetConfig);
        }
      : null;
    window.aashiyana?.showToast(t('dashboard.customizeSaved'), 'success', onUndo ? 6000 : 1500, onUndo);
  }

  async function saveDashboardConfig() {
    try {
      await persistWidgetConfig(widgetConfig);
    } catch {
      window.aashiyana?.showToast(t('common.errorGeneric'), 'danger');
    }
  }

  function cancelDashboardConfig() {
    widgetConfig = savedWidgetConfig.map((w) => ({ ...w }));
    glanceVisible = savedGlanceVisible;
    isCustomizing = false;
    rebuildDashboard(widgetConfig);
  }

  async function resetDashboardConfig() {
    const confirmed = await confirmModal(t('dashboard.customizeResetConfirm'), {
      confirmLabel: t('dashboard.customizeReset'),
      detail: t('dashboard.customizeResetDetail'),
    });
    if (!confirmed) return;
    const previousConfig = savedWidgetConfig.map((w) => ({ ...w }));
    const previousGlance = savedGlanceVisible;
    const previousQuery = dashboardQuery(savedWidgetConfig);
    try {
      const res = await api.put('/preferences', { dashboard_widgets: null, dashboard_today_glance: null });
      widgetConfig = normalizeDashboardConfigWithExtensions(res.data?.dashboard_widgets ?? buildDefaultWidgetConfig());
      glanceVisible = res.data?.dashboard_today_glance !== false;
    } catch {
      window.aashiyana?.showToast(t('common.errorGeneric'), 'danger');
      return;
    }
    savedWidgetConfig = widgetConfig.map((w) => ({ ...w }));
    savedGlanceVisible = glanceVisible;
    followsDefault = true;
    rememberLayoutHint(widgetConfig, dashboardQuery(widgetConfig));
    isCustomizing = false;
    if (widgetConfig.some((w) => w.id === 'cycle' && w.visible)) await ensureCycleSlice();
    if (widgetConfig.some((w) => w.id === 'schedule' && w.visible)) await ensureScheduleSlice();



    const wasteOptionsChanged = JSON.stringify(previousConfig.find((w) => w.id === 'waste')?.options ?? null)
      !== JSON.stringify(widgetConfig.find((w) => w.id === 'waste')?.options ?? null);
    if (wasteOptionsChanged) data.waste = undefined;
    if (widgetConfig.some((w) => w.id === 'waste' && w.visible)) await ensureWasteSlice();

    await reloadIfQueryChanged(previousQuery);
    rebuildDashboard(widgetConfig);


    window.aashiyana?.showToast(t('dashboard.customizeResetDone'), 'success', 6000, async () => {

      const queryBeforeUndo = dashboardQuery(widgetConfig);
      const wasteOptionsBeforeUndo = JSON.stringify(widgetConfig.find((w) => w.id === 'waste')?.options ?? null);
      try {
        widgetConfig = previousConfig.map((w) => ({ ...w }));
        glanceVisible = previousGlance;
        await api.put('/preferences', { dashboard_widgets: widgetConfig, dashboard_today_glance: glanceVisible });
        savedWidgetConfig = widgetConfig.map((w) => ({ ...w }));
        savedGlanceVisible = glanceVisible;
        followsDefault = false;
        rememberLayoutHint(widgetConfig, dashboardQuery(widgetConfig));
        if (wasteOptionsBeforeUndo !== JSON.stringify(widgetConfig.find((w) => w.id === 'waste')?.options ?? null)) data.waste = undefined;
        if (widgetConfig.some((w) => w.id === 'waste' && w.visible)) await ensureWasteSlice();
        await reloadIfQueryChanged(queryBeforeUndo);
      } catch {
        window.aashiyana?.showToast(t('common.errorGeneric'), 'danger');
      }
      isCustomizing = false;
      rebuildDashboard(widgetConfig);
    });
  }

  async function publishHouseholdDefault() {
    const confirmed = await confirmModal(t('dashboard.customizeSetDefaultConfirm'), {
      confirmLabel: t('dashboard.customizeSetDefault'),
      detail: t('dashboard.customizeSetDefaultDetail'),
    });
    if (!confirmed) return;
    const payload = {
      dashboard_widgets_default: widgetConfig,
      dashboard_today_glance_default: glanceVisible,
    };
    if (!followsDefault) {
      payload.dashboard_widgets = widgetConfig;
      payload.dashboard_today_glance = glanceVisible;
    }
    try {
      await api.put('/preferences', payload);
    } catch {
      window.aashiyana?.showToast(t('common.errorGeneric'), 'danger');
      return;
    }
    savedWidgetConfig = widgetConfig.map((w) => ({ ...w }));
    savedGlanceVisible = glanceVisible;
    rememberLayoutHint(widgetConfig, dashboardQuery(widgetConfig));
    isCustomizing = false;
    rebuildDashboard(widgetConfig);
    window.aashiyana?.showToast(t('dashboard.customizeSetDefaultDone'), 'success');
  }

  function wireDashboardEditMode() {
    if (!isCustomizing) return;
    const grid = container.querySelector('#dashboard-widget-grid');
    if (!grid) return;
    let draggedId = '';
    let currentDrop = null;

    const clearDropHint = () => {
      grid.querySelectorAll('.widget-wrapper--drop-before, .widget-wrapper--drop-after').forEach((el) => {
        el.classList.remove('widget-wrapper--drop-before', 'widget-wrapper--drop-after');
      });
    };

    const updateDropHint = (event) => {
      if (!draggedId) return null;
      clearDropHint();
      currentDrop = closestWidgetDrop(grid, event, draggedId);
      if (currentDrop) {
        currentDrop.item.classList.add(currentDrop.placement === 'after' ? 'widget-wrapper--drop-after' : 'widget-wrapper--drop-before');
      }
      return currentDrop;
    };

    grid.querySelectorAll('.widget-wrapper[data-widget-id]').forEach((wrapper) => {
      wrapper.addEventListener('dragstart', (event) => {
        draggedId = wrapper.dataset.widgetId;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', draggedId);
        wrapper.classList.add('widget-wrapper--dragging');
      });
      wrapper.addEventListener('dragend', () => {
        draggedId = '';
        wrapper.classList.remove('widget-wrapper--dragging');
        currentDrop = null;
        clearDropHint();
      });
    });

    grid.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      updateDropHint(event);
    });

    grid.addEventListener('dragleave', (event) => {
      if (!grid.contains(event.relatedTarget)) {
        currentDrop = null;
        clearDropHint();
      }
    });

    grid.addEventListener('drop', (event) => {
      event.preventDefault();
      const fromId = event.dataTransfer.getData('text/plain') || draggedId;
      const drop = currentDrop || updateDropHint(event);
      if (fromId && drop) {
        widgetConfig = reorderWidgetConfig(widgetConfig, fromId, drop.id, drop.placement);
        rebuildDashboard(widgetConfig);
      }
    });

    grid.querySelectorAll('[data-widget-size-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const size = btn.dataset.widgetSizePreset;
        if (!WIDGET_SIZE_OPTIONS.includes(size)) return;
        widgetConfig = updateWidgetConfig(widgetConfig, btn.dataset.widgetId, { size });
        rebuildDashboard(widgetConfig);
      });
    });

    container.querySelectorAll('[data-widget-options]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.widgetOptions;
        const current = widgetConfig.find((w) => w.id === id)?.options ?? {};
        const next = await openWidgetOptions(id, current);
        if (next === null) return;


        // nie gesehen hat.
        widgetConfig = updateWidgetConfig(widgetConfig, id,
          Object.keys(next).length ? { options: next } : { options: undefined });
        rebuildDashboard(widgetConfig);
      });
    });

    grid.querySelectorAll('[data-widget-hide]').forEach((btn) => {
      btn.addEventListener('click', () => {
        widgetConfig = updateWidgetConfig(widgetConfig, btn.dataset.widgetHide, { visible: false });
        rebuildDashboard(widgetConfig);
      });
    });



    container.querySelectorAll('[data-widget-show]').forEach((btn) => {
      btn.addEventListener('click', () => {
        widgetConfig = updateWidgetConfig(widgetConfig, btn.dataset.widgetShow, { visible: true });
        rebuildDashboard(widgetConfig);
      });
    });



    container.querySelector('[data-glance-hide]')?.addEventListener('click', () => {
      glanceVisible = false;
      rebuildDashboard(widgetConfig);
    });
    container.querySelector('[data-glance-show]')?.addEventListener('click', () => {
      glanceVisible = true;
      rebuildDashboard(widgetConfig);
    });





    const moveWidget = (id, dir) => {
      const wrapper = grid.querySelector(`.widget-wrapper[data-widget-id="${CSS.escape(id)}"]`);
      const sibling = dir === 'up' ? wrapper?.previousElementSibling : wrapper?.nextElementSibling;
      const siblingId = sibling?.dataset?.widgetId;
      if (!id || !siblingId) return false;
      widgetConfig = reorderWidgetConfig(widgetConfig, id, siblingId, dir === 'up' ? 'before' : 'after');
      rebuildDashboard(widgetConfig);
      return true;
    };

    grid.querySelectorAll('[data-widget-move]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.widgetId;
        const dir = btn.dataset.widgetMove;
        if (!moveWidget(id, dir)) return;


        const movedWrapper = container.querySelector(`.widget-wrapper[data-widget-id="${CSS.escape(id)}"]`);
        const sameDir = movedWrapper?.querySelector(`[data-widget-move="${dir}"]:not([disabled])`);
        const anyMove = movedWrapper?.querySelector('[data-widget-move]:not([disabled])');
        (sameDir ?? anyMove)?.focus();
      });
    });




    grid.querySelectorAll('[data-widget-drag-handle]').forEach((handle) => {
      handle.addEventListener('keydown', (event) => {
        const dir = event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowDown' ? 'down' : null;
        if (!dir) return;
        event.preventDefault();
        const id = handle.closest('.widget-wrapper[data-widget-id]')?.dataset.widgetId;
        if (moveWidget(id, dir)) {
          container.querySelector(`.widget-wrapper[data-widget-id="${CSS.escape(id)}"] [data-widget-drag-handle]`)?.focus();
        }
      });
    });
  }

  let disposeNoteCategories = () => {};
  signal.addEventListener('abort', () => disposeNoteCategories(), { once: true });
  function rebuildDashboard(cfg) {



    // aeltere Stand den neueren.
    if (signal.aborted) return;
    disposeNoteCategories();
    const shell = container.querySelector('#dashboard-shell');
    if (!shell) return;
    if (wallMode) {
      setHtml(shell, renderWallSurface(data, weather, { failed: loadFailed, updatedAt: lastLoadedAt }));
      if (window.lucide) window.lucide.createIcons({ el: shell });
      wireWallSurface(container, rerender, signal);
      return;
    }
    if (loadFailed) {
      setHtml(shell, `
        ${renderDashboardOverview(user, false)}
        ${renderDashboardError(loadErrorStatus)}
      `);
      if (window.lucide) window.lucide.createIcons({ el: shell });
      container.querySelector('#dashboard-retry')?.addEventListener('click', rerender, { signal: signal });
      return;
    }






    const cockpitHtml = (glanceVisible || isCustomizing) ? renderTodayCockpit(data, cfg, isCustomizing) : '';
    const mastheadSlim = cockpitHtml ? '' : ' dashboard-masthead--slim';


    const weatherCardShown = cfg.some((w) => w.id === 'weather' && w.visible);
    setHtml(shell, `
      <section class="dashboard-masthead dashboard-masthead--${greetingPeriod()}${mastheadSlim}">
        ${renderDashboardOverview(user, isCustomizing, weatherCardShown ? null : weather, lastLoadedAt, { followsDefault, canPublish })}
        ${cockpitHtml}
      </section>
      ${renderDashboardLayout(cfg, data, weather, currency, { editing: isCustomizing, visibleMealTypes, glanceHidden: !glanceVisible })}
    `);
    wireLinks(container, rerender, { editing: isCustomizing, user });


    container.querySelectorAll('[data-widget-retry]').forEach((btn) =>
      btn.addEventListener('click', rerender, { signal: signal }));
    if (window.lucide) window.lucide.createIcons({ el: shell });


    wireRecipeThumbs(shell);
    disposeNoteCategories = wireNoteCategoryOverflow(
      shell,
      (count) => getNumberFormat().format(count),
      (count) => t('noteCategories.moreAction', { count }),
    );
    wireWeatherRefresh(container, (updatedWeather) => {
      weather = updatedWeather;
      rebuildDashboard(cfg);
    }, signal);
    container.querySelector('#dashboard-wall-enter')?.addEventListener('click', () => {
      enterWallMode();
      rerender();
    }, { signal: signal });
    container.querySelector('#dashboard-customize-btn')?.addEventListener('click', () => {
      isCustomizing = !isCustomizing;
      if (!isCustomizing) {
        cancelDashboardConfig();
        return;
      }
      rebuildDashboard(widgetConfig);
    }, { signal: signal });
    container.querySelector('#dashboard-customize-save')?.addEventListener('click', saveDashboardConfig, { signal: signal });
    container.querySelector('#dashboard-customize-cancel')?.addEventListener('click', cancelDashboardConfig, { signal: signal });
    container.querySelector('#dashboard-customize-reset')?.addEventListener('click', resetDashboardConfig, { signal: signal });
    container.querySelector('#dashboard-customize-publish')?.addEventListener('click', publishHouseholdDefault, { signal: signal });
    wireDashboardEditMode();
    void mountExtensionWidgets(shell, cfg, user);
  }

  rebuildDashboard(widgetConfig);

  if (wallMode || loadFailed) {






    //






    // test-frontend-audit.js).
    findPageFab('fab-main')?.closest('.page-fab-group')?.remove();
  } else {
    initFab(signal);
  }

  // SELBSTHEILUNG STATT RETRY-KNOPF. Am Wandtablet drueckt niemand auf



  if (wallMode && loadFailed) {
    const healTimerId = setTimeout(rerender, WALL_HEAL_MS);
    signal.addEventListener('abort', () => clearTimeout(healTimerId));
  }

  // Stiller Daten-Refresh (Paket 2, Critique P4): Inhaltsdaten veralteten sonst






  let refreshInFlight = false;
  async function refreshDashboardData() {
    if (isCustomizing || loadFailed || refreshInFlight) return;
    refreshInFlight = true;
    try {
      const fresh = await api.get(dashboardQuery(widgetConfig));
      if (signal.aborted) return;
      if (Array.isArray(fresh?.upcomingEvents)) {
        fresh.upcomingEvents = fresh.upcomingEvents.map(localizeBirthdayEvent);
      }



      fresh.cycle = data.cycle;

      // Stand einfach mitzuschleppen (M-6a): "wer heute Dienst hat" blieb






      if (widgetConfig.some((w) => w.id === 'schedule' && w.visible)) {
        data.schedule = undefined;
        await ensureScheduleSlice();
        if (signal.aborted) return;
      }
      fresh.schedule = data.schedule;
      fresh.waste = data.waste;
      data = fresh;
      lastLoadedAt = new Date();
      rebuildDashboard(widgetConfig);
    } catch { /* Hintergrund-Refresh: bewusst still */ }
    finally { refreshInFlight = false; }
  }
  const refreshTimerId = setInterval(() => {
    if (!document.hidden) refreshDashboardData();
  }, 15 * 60 * 1000);
  signal.addEventListener('abort', () => clearInterval(refreshTimerId));

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const titleEl = container.querySelector('.dashboard-overview__title');
    if (titleEl) {
      titleEl.replaceChildren();
      titleEl.insertAdjacentHTML('afterbegin', greeting(user.display_name));


      titleEl.classList.remove(
        'dashboard-overview__title--morning',
        'dashboard-overview__title--day',
        'dashboard-overview__title--evening',
      );
      titleEl.classList.add(`dashboard-overview__title--${greetingPeriod()}`);
    }
    const dateEl  = container.querySelector('.dashboard-overview__date');
    if (dateEl)  dateEl.textContent = mastheadDateLabel();


    updateClockWidget(container);

    refreshDashboardData();
  }, { signal: signal });




  // dieselbe Minute.
  startClockTicker(container, signal, wallMode ? () => syncWallMode(location.pathname) : null);





  if (weather) {
    const doAutoRefresh = async () => {
      try {
        await maybeUpdateAutoLocation({
          autoLocateEnabled: weatherAutoLocate,
          geolocation: navigator.geolocation,
          putPreferences: (body) => api.put('/preferences', body),
        });
        const res = await api.get(`/weather?lang=${encodeURIComponent(getLocale())}`).catch(() => ({ data: null }));
        if (signal.aborted) return;
        weather = res.data ?? null;
        rebuildDashboard(widgetConfig);
      } catch { /* Hintergrund-Timer: bewusst still â€” der Nutzer hat nichts
                   angestoÃŸen, ein Toast alle 30 Min wÃ¤re reiner LÃ¤rm. */ }
    };
    const timerId = setInterval(doAutoRefresh, 30 * 60 * 1000);
    signal.addEventListener('abort', () => clearInterval(timerId));
    if (weatherAutoLocate) doAutoRefresh();
  }



  // bleibt bewusst ungesetzt - wer die Wand wieder verlaesst, bekommt seine
  // Einfuehrung dann, wenn sie ihm etwas nuetzt.
  if (wallMode) return;







  if (user?.onboarding_pending && !localStorage.getItem(ONBOARDING_KEY)) {
    setTimeout(() => showOnboarding(container, () => maybeHintCustomize(container)), 400);
  } else {
    maybeHintCustomize(container);
  }
}

export const __test = { buildTodayHighlights, buildTodayProgram, buildTodayCockpitModel, renderTodayCockpit, renderPinnedNotes, renderScheduleWidget, renderWasteWidget, renderFamilyWidget, formatDueDate, normalizeVisibleMealTypes, renderTodayMeals, calendarEventRoute, eventOccurrenceDateKey, eventStartDate, renderWallSurface, renderWallWho, renderDashboardOverview, selectMetricTiles, METRIC_TILE_ORDER, PROGRAM_ROW_CAP, WALL_ROW_CAP, weatherToneKey, weatherMotionAttr, weatherTempBand, weatherSpanModel, weatherDayLabel, weatherTodayRange, renderWeatherWidget, renderWallWeather, relativeDateLabel, listRowCap, openWidgetOptions };






function wireWeatherRefresh(container, onUpdated = null, signal) {
  const refreshBtn = container.querySelector('#weather-refresh-btn');
  if (!refreshBtn) return;
  const doWeatherRefresh = async () => {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('weather-widget__refresh--spinning');
    try {
      const res = await api.get(`/weather?lang=${encodeURIComponent(getLocale())}`).catch(() => ({ data: null }));
      if (signal.aborted) return;


      if (!res.data) {
        window.aashiyana?.showToast(t('common.errorGeneric'), 'danger');
        return;
      }
      const wWidget = container.querySelector('#weather-widget');
      if (wWidget) {
        const wrapper = wWidget.closest('.widget-wrapper');
        if (wrapper) {
          wrapper.querySelector('.widget')?.remove();
          wrapper.insertAdjacentHTML('beforeend', renderWeatherWidget(res.data));
        }
        const newWidget = container.querySelector('#weather-widget');
        if (newWidget && window.lucide) window.lucide.createIcons({ el: newWidget });
        onUpdated?.(res.data);
        window.aashiyana?.showToast(t('dashboard.weatherUpdated'), 'success', 1500);
      }
    } catch {
      window.aashiyana?.showToast(t('common.errorGeneric'), 'danger');
    } finally {


      refreshBtn.disabled = false;
      refreshBtn.classList.remove('weather-widget__refresh--spinning');
    }
  };
  refreshBtn.addEventListener('click', doWeatherRefresh, { signal: signal });
}







//





//




