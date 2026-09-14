import { api } from '/api.js';
import { t, formatDate, formatDayMonth, getNumberFormat } from '/i18n.js';
import { esc } from '/utils/html.js';
import { todayKey, addLocalDays, parseLocalDateKey, weekStartIndex, startOfLocalWeekKey } from '/utils/date.js';
import { openModal, closeModal, confirmModal, confirmOverModal, advancedSection, refocusAfterRender, reportFieldError, promptModal } from '/components/modal.js';
import { makeSortable } from '/utils/sortable.js';
import { createPageFab, setPageFabAction } from '/utils/fab.js';
import { emptyStateHTML } from '/utils/empty-state.js';
import { wireScrollFade } from '/utils/ux.js';
import { wireTablist } from '/utils/tablist.js';
import { toggleRowHtml } from '/settings/components.js';
import { renderUserMultiSelect, getSelectedUserIds, bindUserMultiSelect } from '/components/user-multi-select.js';
import { isNavModuleReadOnly } from '/permissions.js';
import { scheduleViewFromPath, scheduleRouteForView } from '/utils/schedule-tabs.js';

// ZWEISPALTIG: Schedule is a full-width responsive library and statistics view;
// constraining its row lists to the narrow reading measure would recreate the
// unused desktop column this module intentionally avoids.

let root;
let scheduleFab = null;
let scheduleTablist = null;
let currentUserId = null;
let canManageOthers = false;
let activeView = 'patterns';


// Datenlage (siehe dort), aber niemals danach: `activeView` ist ausdruecklich


// Person nicht wieder ueberschreiben.
let initialViewDecided = false;


// Formular tragen. renderPage() ersetzt `.schedule-body` komplett bei jedem



// Flags: mehrere Musterkarten koennen gleichzeitig geoeffnet und bearbeitet

// Restlichkeit falsch beeinflusst werden.
let dirtyPatternIds = new Set();
let state = { users: [], types: [], customFields: [], patterns: [], overrides: [], extras: [], entries: [], warnings: [], reminderOffsetMinutes: null, weeklyHours: null, overtimeEnabled: true, hiddenTemplates: [] };
let statistics = { userId: null, range: 'current', monthFrom: '', monthTo: '', from: '', to: '', entries: [], bounds: null, loading: false, error: false };
// Generationszaehler gegen ein Wettrennen zweier ueberlappender Ladevorgaenge



// Ergebnis uebernehmen - eine spaeter gestartete, aber frueher zurueckkommende


// lokaler Zaehler statt einer geteilten Abstraktion (kein weiteres Modul
// braucht das gleiche Muster).
let statisticsRequestId = 0;
let overviewRequestId = 0;
// "Uebersicht"-Tab: mehrere Haushaltsmitglieder nebeneinander vergleichen
// (#1018 - Stundenplaene mehrerer Kinder). people kommt vorgefiltert vom
// Server (GET /schedule/household-members, isHouseholdMember()); selectedIds

// tut das (siehe refreshOverview()).
const OVERVIEW_SELECTION_KEY = 'aashiyana:schedule:overview:people';
const OVERVIEW_VIEW_KEY = 'aashiyana:schedule:overview:mode';
let overview = { people: [], selectedIds: [], weekCursor: todayKey(), viewMode: loadSavedOverviewViewMode(), entries: [], holidays: [], loading: false, error: false };

function loadSavedOverviewViewMode() {
  try { return localStorage.getItem(OVERVIEW_VIEW_KEY) === 'day' ? 'day' : 'week'; } catch { return 'week'; }
}

function saveOverviewViewMode(mode) {
  try { localStorage.setItem(OVERVIEW_VIEW_KEY, mode); } catch {}
}

function normalizeOverviewSelection(rawIds, eligibleIds) {
  if (!Array.isArray(rawIds)) return [];
  const eligible = new Set(eligibleIds);
  return rawIds.filter((id) => eligible.has(id));
}

function loadSavedOverviewSelection() {
  try {
    const raw = localStorage.getItem(OVERVIEW_SELECTION_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(Number) : [];
  } catch { return []; }
}

function saveOverviewSelection(ids) {
  try { localStorage.setItem(OVERVIEW_SELECTION_KEY, JSON.stringify(ids)); } catch {}
}





// Critique 2026-08-27 + Detektor design-system-color). Jetzt Magenta fuer die

// `vacation`/`sick` tragen bewusst KEINE Uhrzeiten (start_time/end_time bleiben





// abbilden, nichts dazwischen. Eigene Farben ausserhalb der fuenf Arbeits-Presets:
// Blaugrau fuer Urlaub (Abwesenheit, keine Dringlichkeit), Rot fuer krank



// Vorlage angehaengt statt dreifach dupliziert.
const SHARED_PRESETS = Object.freeze([
  { key: 'vacation', shortCode: 'V', startTime: null, endTime: null, color: '#475569', icon: 'tree-palm' },
  { key: 'sick', shortCode: 'S', startTime: null, endTime: null, color: '#B91C1C', icon: 'thermometer' },
]);
// Drei Vorlagen statt einer einzigen festen Liste - derselbe Quickstart-Weg




const PRESET_TEMPLATES = Object.freeze({
  work: Object.freeze([
    { key: 'early', shortCode: 'E', startTime: '06:00', endTime: '14:00', color: '#0E7490', icon: 'sunrise' },
    { key: 'late', shortCode: 'L', startTime: '14:00', endTime: '22:00', color: '#A21CAF', icon: 'sunset' },
    { key: 'night', shortCode: 'N', startTime: '22:00', endTime: '06:00', color: '#4338CA', icon: 'moon' },
    { key: 'day', shortCode: 'D', startTime: '08:00', endTime: '16:00', color: '#15803D', icon: 'sun' },
    { key: 'fullDay', shortCode: '24', startTime: '10:00', endTime: '10:00', color: '#A16207', icon: 'clock' },
    ...SHARED_PRESETS,
  ]),
  school: Object.freeze([
    { key: 'period1', shortCode: 'P1', startTime: '08:00', endTime: '08:45', color: '#0369A1', icon: 'book-open' },
    { key: 'period2', shortCode: 'P2', startTime: '08:55', endTime: '09:40', color: '#0D9488', icon: 'book-open' },
    { key: 'period3', shortCode: 'P3', startTime: '09:55', endTime: '10:40', color: '#B45309', icon: 'book-open' },
    { key: 'period4', shortCode: 'P4', startTime: '10:50', endTime: '11:35', color: '#BE185D', icon: 'book-open' },
    { key: 'exam', shortCode: 'EX', startTime: '09:00', endTime: '11:00', color: '#7C2D12', icon: 'file-text' },
    ...SHARED_PRESETS,
  ]),
  university: Object.freeze([
    { key: 'lecture', shortCode: 'VL', startTime: '09:00', endTime: '10:30', color: '#1D4ED8', icon: 'presentation' },
    { key: 'seminar', shortCode: 'SE', startTime: '10:45', endTime: '12:15', color: '#0F766E', icon: 'users' },
    { key: 'lab', shortCode: 'LAB', startTime: '13:00', endTime: '15:00', color: '#166534', icon: 'flask-conical' },
    { key: 'exam', shortCode: 'EX', startTime: '09:00', endTime: '11:00', color: '#7C2D12', icon: 'file-text' },
    ...SHARED_PRESETS,
  ]),
});



// zuletzt per Quickstart lief. Ein Map-Umweg entdoppelt exam/vacation/sick,

const ALL_PRESETS = Object.freeze([...new Map(
  [...PRESET_TEMPLATES.work, ...PRESET_TEMPLATES.school, ...PRESET_TEMPLATES.university].map((preset) => [preset.key, preset]),
).values()]);
const SHIFT_COLOR_FALLBACK = PRESET_TEMPLATES.work[0].color;


// weit konfigurierbar (server/routes/preferences.js#schedule_hidden_templates,

// nicht dauerhaft Schule/Uni-Knoepfe sehen. `PRESET_TEMPLATES` selbst bleibt

// fehlen); bereits angelegte Schichtarten sind davon ohnehin unberuehrt.
const QUICKSTART_TEMPLATES = [['work', 'schedule.templateWork'], ['school', 'schedule.templateSchool'], ['university', 'schedule.templateUniversity']];
function visibleQuickstartTemplates() {
  const hidden = new Set(state.hiddenTemplates ?? []);
  return QUICKSTART_TEMPLATES.filter(([key]) => !hidden.has(key));
}

const option = (value, label, selected = false) => `<option value="${esc(String(value ?? ''))}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
const userName = (id) => state.users.find((user) => Number(user.id) === Number(id))?.display_name
  || state.users.find((user) => Number(user.id) === Number(id))?.username
  || String(id);
const selectedOwner = () => currentUserId ?? state.users[0]?.id ?? '';

function readOnly() {
  return isNavModuleReadOnly('schedule');
}

// canWrite/canEditType tragen jetzt BEIDE Achsen: die Eigentuemer-Pruefung


// Stelle statt eines Extra-`&& !readOnly()` an jeder Aufrufstelle - patternCard(),
// shiftTypeCard(), customFieldRow(), overrideRows() und extraRows() lesen
// beide Funktionen ohnehin schon fuer ihre "gehoert es mir"-Frage.
const canWrite = (userId) => !readOnly() && (canManageOthers || Number(userId) === Number(currentUserId));





// verlaesslich in 403.
const canEditType = (type) => !readOnly() && (canManageOthers
  || (type?.created_by != null && Number(type.created_by) === Number(currentUserId)));
const clockLabel = (shiftType) => {
  if (!shiftType?.start_time || !shiftType?.end_time) return t('schedule.allDay');
  const crossesDay = shiftType.end_time <= shiftType.start_time;
  const fullDay = shiftType.end_time === shiftType.start_time;
  return `${shiftType.start_time}–${shiftType.end_time}${crossesDay ? ' +1' : ''}${fullDay ? ' · 24 h' : ''}`;
};


// ("shift_type_id must be a positive number.", "cycle_length cannot exclude









// clientseitige Uebersetzung, kein Vertragswechsel.
const SCHEDULE_SERVER_ERROR_MESSAGES = {
  'shift_type_id must be a positive number.': () => t('schedule.shiftTypeRequiredError'),
  'cycle_length cannot exclude existing pattern days.': () => t('schedule.cycleLengthConflictGeneric'),
  'Shift type is in use.': () => t('schedule.typeInUse'),
};

function scheduleErrorMessage(error) {
  const raw = error?.data?.error ?? error?.message;
  return (raw && SCHEDULE_SERVER_ERROR_MESSAGES[raw]?.()) ?? raw ?? t('common.errorGeneric');
}

async function load() {
  const day = todayKey();
  const [users, types, customFields, patternResult, overrides, extras, entries, preferences, householdPrefs, householdMembers] = await Promise.all([
    api.get('/auth/users'),
    api.get('/schedule/shift-types'),
    api.get('/schedule/custom-fields'),
    api.get('/schedule/patterns'),
    api.get('/schedule/overrides'),
    api.get('/schedule/extras'),
    api.get(`/schedule/entries?from=${day}&to=${day}`),
    api.get('/schedule/preferences'),
    // Haushaltweit, admin-only (server/routes/preferences.js) - welche


    api.get('/preferences').catch(() => ({ data: {} })),
    // Vorgefiltert (isHouseholdMember()) fuer den Uebersicht-Tab - Haushaltshilfen

    api.get('/schedule/household-members').catch(() => ({ data: [] })),
  ]);
  const patterns = patternResult.data ?? [];
  const days = await Promise.all(patterns.map((pattern) => api.get(`/schedule/patterns/${pattern.id}/days`)));
  state = {
    users: users.data ?? [],
    types: types.data ?? [],
    customFields: customFields.data ?? [],
    patterns: patterns.map((pattern, index) => ({ ...pattern, days: days[index].data ?? [] })),
    overrides: overrides.data ?? [],
    extras: extras.data ?? [],
    entries: entries.data?.entries ?? [],
    warnings: entries.data?.warnings ?? [],
    reminderOffsetMinutes: preferences.data?.reminderOffsetMinutes ?? null,
    weeklyHours: preferences.data?.weeklyHours ?? null,
    overtimeEnabled: preferences.data?.overtimeEnabled !== false,
    hiddenTemplates: Array.isArray(householdPrefs.data?.schedule_hidden_templates) ? householdPrefs.data.schedule_hidden_templates : [],
    weekStartPref: householdPrefs.data?.week_start ?? null,
  };
  overview = {
    ...overview,
    people: householdMembers.data ?? [],
    selectedIds: normalizeOverviewSelection(loadSavedOverviewSelection(), (householdMembers.data ?? []).map((person) => person.id)),
  };
}

function monthKey(dateKey = todayKey()) { return dateKey.slice(0, 7); }

function monthBounds(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) return null;
  const [year, value] = month.split('-').map(Number);
  if (value < 1 || value > 12) return null;
  const lastDay = new Date(Date.UTC(year, value, 0)).getUTCDate();
  return { from: month + '-01', to: month + '-' + String(lastDay).padStart(2, '0') };
}

function statisticBounds() {
  const current = monthBounds(monthKey());
  if (statistics.range === 'current') return current;
  if (statistics.range === 'months') {
    const first = monthBounds(statistics.monthFrom);
    const last = monthBounds(statistics.monthTo);
    if (!first || !last || first.from > last.from) return null;
    return { from: first.from, to: last.to };
  }
  if (!statistics.from || !statistics.to || statistics.from > statistics.to) return null;
  return { from: statistics.from, to: statistics.to };
}

function shiftMinutes(shiftType) {
  if (!shiftType?.start_time || !shiftType?.end_time) return null;
  const toMinutes = (value) => {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  };
  const start = toMinutes(shiftType.start_time);
  let end = toMinutes(shiftType.end_time);
  if (end <= start) end += 24 * 60;
  return end - start;
}

function formatHours(minutes) {
  const hours = minutes / 60;

  // festen toFixed(1) - der geteilte Zahlenformatierer (i18n.js) traegt



  const value = getNumberFormat({ maximumFractionDigits: 1 }).format(hours);
  return t('schedule.hoursValue', { value });
}






const DEFAULT_WEEKLY_HOURS = 40;

// Ein ROLLIERENDES 7-Tage-Fenster statt fester Kalenderwochen (Mo-So o.ae.):

// zusammenhaengende fuenf Tage) - feste Wochen zerschneiden ihn dann in zwei






// dieselben Tage mehrfach, das wuerde denselben Ueberschuss vielfach zaehlen).

// schedule.js: "SELECT 1 FROM schedule_pattern_days WHERE pattern_id=? AND


// wuerde, kam bisher erst als Rohtext ("cycle_length cannot exclude existing
// pattern days.") vom Server zurueck. Reine Funktion (kein state-Zugriff),





// Kartenansicht Positionen selbst auch 1-indexiert beschriftet (`position + 1`).
function patternDaysExceedingCycleLength(days, cycleLength) {
  const excludedPositions = (days ?? [])
    .map((day) => Number(day.position))
    .filter((position) => position >= cycleLength);
  if (!excludedPositions.length) return null;
  return { from: Math.min(...excludedPositions) + 1, to: Math.max(...excludedPositions) + 1 };
}


// `fromKey` liegt) - beide sind reine YYYY-MM-DD-Schluessel, `parseLocalDateKey`
// baut daraus lokale Mitternachts-Zeitpunkte. Gerundet statt ganzzahlig geteilt:


// derselbe Rundungs-Kommentar wie overtimeInfo()'s sixDaysMs-Fenster oben.
function daysBetweenKeys(fromKey, toKey) {
  return Math.round((parseLocalDateKey(toKey).getTime() - parseLocalDateKey(fromKey).getTime()) / 86400000);
}

function cycleDayNextDate(anchor, cycleLength, position, todayKeyValue = todayKey()) {
  const length = Number(cycleLength);
  if (!anchor || !Number.isInteger(length) || length < 1) return anchor;
  const normalize = (value) => ((value % length) + length) % length;
  const target = normalize(position - 1);
  const diff = daysBetweenKeys(anchor, todayKeyValue);
  const delta = normalize(target - normalize(diff));
  return addLocalDays(anchor, diff + delta);
}

function cycleDayHeaderLabel(anchor, cycleLength, validFrom, validUntil, position, todayKeyValue = todayKey()) {
  if (!anchor || !cycleLength) return String(position);
  let date = cycleDayNextDate(anchor, cycleLength, position, todayKeyValue);
  if ((validFrom && date < validFrom) || (validUntil && date > validUntil)) {
    date = addLocalDays(anchor, position - 1);
  }
  const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][parseLocalDateKey(date).getDay()];
  return `${position} · ${t(`calendar.dayShort${weekday}`)} ${formatDayMonth(date)}`;
}

// S-05: Ueberlappungsfenster zweier Gueltigkeitsfenster (valid_from/valid_until,

// bereits durchsetzt (server/services/schedule.js#resolveEntries:

// Intervall-Vergleich statt Tag-fuer-Tag. String-Vergleich reicht wieder
// (YYYY-MM-DD sortiert lexikographisch identisch zur Kalenderordnung, siehe
// rangeDifference() oben).
function windowsOverlap(aFrom, aUntil, bFrom, bUntil) {
  const aStart = aFrom || '0000-01-01';
  const aEnd = aUntil || '9999-12-31';
  const bStart = bFrom || '0000-01-01';
  const bEnd = bUntil || '9999-12-31';
  return aStart <= bEnd && bStart <= aEnd;
}

// S-05: findet eine ANDERE aktive Musterkarte derselben Person, deren Fenster


// Reaktivieren-Rueckfrage (submitForm()' pattern-update-Zweig).
function findOverlappingActivePattern(patterns, userId, validFrom, validUntil, excludeId = null) {
  return patterns.find((pattern) => pattern.is_active
    && Number(pattern.user_id) === Number(userId)
    && (excludeId == null || Number(pattern.id) !== Number(excludeId))
    && windowsOverlap(pattern.valid_from, pattern.valid_until, validFrom, validUntil));
}


// scheduleData: "ORDER BY user_id, valid_from DESC, id DESC") - SQLite sortiert

// gesetzte Datum.
function comparePatternPriority(a, b) {
  const aFrom = a.valid_from ?? null;
  const bFrom = b.valid_from ?? null;
  if (aFrom !== bFrom) {
    if (aFrom == null) return 1;
    if (bFrom == null) return -1;
    return aFrom < bFrom ? 1 : -1;
  }
  return Number(b.id) - Number(a.id);
}

function resolveWinningPatternId(patterns, userId, dateKey) {
  const candidates = patterns.filter((pattern) => pattern.is_active
    && Number(pattern.user_id) === Number(userId)
    && (!pattern.valid_from || pattern.valid_from <= dateKey)
    && (!pattern.valid_until || pattern.valid_until >= dateKey));
  if (candidates.length < 2) return null;
  return [...candidates].sort(comparePatternPriority)[0].id;
}

function overtimeInfo(entries, weeklyHours = DEFAULT_WEEKLY_HOURS) {
  const days = entries
    .map((entry) => ({ day: parseLocalDateKey(entry.date_key).getTime(), minutes: entry.shift_type ? (shiftMinutes(entry.shift_type) ?? 0) : 0 }))
    .sort((a, b) => a.day - b.day);
  const sixDaysMs = 6 * 86400000;
  let windowStart = 0;
  let windowSum = 0;
  let worstWindowMinutes = 0;
  for (let end = 0; end < days.length; end += 1) {
    windowSum += days[end].minutes;
    while (days[windowStart].day < days[end].day - sixDaysMs) {
      windowSum -= days[windowStart].minutes;
      windowStart += 1;
    }
    worstWindowMinutes = Math.max(worstWindowMinutes, windowSum);
  }
  const excessMinutes = Math.max(0, worstWindowMinutes - weeklyHours * 60);
  return { over: excessMinutes > 0, excessMinutes };
}




const REMINDER_OFFSET_PRESETS = [0, 5, 10, 15, 30, 60, 120];


// frisches Formular), nicht "0 Minuten Vorlauf" - `Number(null) === 0` waere



// dem <select> zurueck, sein eigener `?? 15`-Rueckfall greift also nie (er


function reminderOffsetOptions(selectedMinutes) {
  const effective = selectedMinutes ?? 15;
  const presetsHtml = REMINDER_OFFSET_PRESETS.map((minutes) =>
    `<option value="${minutes}"${Number(effective) === minutes ? ' selected' : ''}>${esc(t(minutes === 0 ? 'schedule.reminderAtStart' : 'schedule.reminderMinutesBefore', { minutes }))}</option>`
  ).join('');
  // S-23 (UX-Audit): der Server erlaubt 0-1440 Minuten (MAX_OFFSET_MINUTES/




  const customValueHtml = Number.isInteger(effective) && !REMINDER_OFFSET_PRESETS.includes(effective)
    ? `<option value="${effective}" selected data-custom-value="1">${esc(effective === 0 ? t('schedule.reminderAtStart') : t('schedule.reminderMinutesBefore', { minutes: effective }))}</option>`
    : '';
  return presetsHtml + customValueHtml + `<option value="custom">${esc(t('schedule.reminderCustomOffset'))}</option>`;
}

async function pickCustomReminderOffset(select, onResolved) {
  const previous = select.dataset.previousValue ?? '15';
  const input = await promptModal(t('schedule.customReminderOffsetPrompt'), '');
  const minutes = input == null ? NaN : Math.round(Number(input));
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
    select.value = previous;
    return;
  }
  let customOption = select.querySelector('option[data-custom-value]');
  if (!customOption) {
    customOption = document.createElement('option');
    customOption.dataset.customValue = '1';
    select.querySelector('option[value="custom"]')?.insertAdjacentElement('beforebegin', customOption);
  }
  customOption.value = String(minutes);
  customOption.textContent = minutes === 0 ? t('schedule.reminderAtStart') : t('schedule.reminderMinutesBefore', { minutes });
  select.value = String(minutes);
  select.dataset.previousValue = String(minutes);
  onResolved(minutes);
}

// Ein eigener Vorlauf je Extra, unabhaengig vom haushaltweiten Feld unten -

// regulaere Schicht (server/services/schedule-reminders.js#syncExtraRemindersForUser).
// Gleiches Umschalter-plus-Auswahl-Muster wie renderReminderSettings() unten,

// Formular statt einer Karte lebt.
function reminderOffsetField(selectedMinutes) {
  const active = selectedMinutes != null;
  return '<div class="form-field schedule-active-field"><span class="label">' + esc(t('schedule.extraReminderOffset')) + '</span><label class="toggle"><input name="reminder_enabled" type="checkbox"' + (active ? ' checked' : '') + '><span class="toggle__track"></span></label></div>'
    + '<select class="input" name="reminder_offset_minutes"' + (active ? '' : ' disabled') + '>' + reminderOffsetOptions(selectedMinutes) + '</select>';
}

function renderReminderSettings() {
  const active = state.reminderOffsetMinutes != null;
  const options = reminderOffsetOptions(state.reminderOffsetMinutes);
  const weeklyHours = state.weeklyHours ?? DEFAULT_WEEKLY_HOURS;


  // Wochenstunden - haengt an der eigenen users-Zeile, unabhaengig davon, ob


  // wirkungsloses 403 statt einer gespeicherten Einstellung); server/index.js

  // dieses Formular darf ihr also folgen.
  return '<div class="card card--padded schedule-reminder-settings">'
    + '<h2 class="u-section-title">' + esc(t('schedule.mySettings')) + '</h2>'
    + '<div class="schedule-reminder-settings__row">'
    + toggleRowHtml({ label: t('schedule.reminderToggle'), checked: active, attrs: { id: 'schedule-reminder-toggle' } })
    + '<select class="input" id="schedule-reminder-offset" data-previous-value="' + esc(String(state.reminderOffsetMinutes ?? 15)) + '"' + (active ? '' : ' disabled') + '>' + options + '</select>'
    + '</div><p class="form-hint">' + esc(t('schedule.reminderHint')) + '</p>'

    // wiederverwendeten Sonderwerts (0 Wochenstunden bleibt eine gueltige,
    // ablehnbare Falscheingabe - siehe server/routes/schedule-preferences.js).

    // Statistik gleichermassen ab (renderStatistics()/overtimeInfo() lesen

    + '<div class="schedule-reminder-settings__row schedule-reminder-settings__row--overtime-toggle">'
    + toggleRowHtml({ label: t('schedule.overtimeTrackingToggle'), checked: state.overtimeEnabled, attrs: { id: 'schedule-overtime-toggle' } })
    + '</div><p class="form-hint">' + esc(t('schedule.overtimeTrackingHint')) + '</p>'
    + '<div class="schedule-reminder-settings__row schedule-reminder-settings__row--hours">'
    + '<label class="label" for="schedule-weekly-hours">' + esc(t('schedule.weeklyHoursLabel')) + '</label>'
    + '<input class="input" type="number" min="1" max="168" step="1" id="schedule-weekly-hours" value="' + esc(String(weeklyHours)) + '"' + (state.overtimeEnabled ? '' : ' disabled') + '>'
    + '</div><p class="form-hint">' + esc(t('schedule.weeklyHoursHint')) + '</p></div>';
}

async function savePreference(patch) {
  try {
    const result = await api.put('/schedule/preferences', patch);
    state.reminderOffsetMinutes = result.data?.reminderOffsetMinutes ?? null;
    state.weeklyHours = result.data?.weeklyHours ?? null;
    state.overtimeEnabled = result.data?.overtimeEnabled !== false;
  } catch (err) {
    window.aashiyana?.showToast(scheduleErrorMessage(err), 'danger');
  }
  renderPage();
}

function statisticsSummary() {
  const types = new Map();
  let freeDays = 0;
  for (const entry of statistics.entries) {
    if (!entry.shift_type) { freeDays += 1; continue; }
    const id = Number(entry.shift_type.id);
    const item = types.get(id) || { type: entry.shift_type, count: 0, minutes: 0, hasHours: false };
    const minutes = shiftMinutes(entry.shift_type);
    item.count += 1;
    if (minutes != null) { item.minutes += minutes; item.hasHours = true; }
    types.set(id, item);
  }
  const values = [...types.values()].sort((a, b) => b.count - a.count || a.type.name.localeCompare(b.type.name));
  return { values, freeDays, totalCount: values.reduce((total, item) => total + item.count, 0), totalMinutes: values.reduce((total, item) => total + item.minutes, 0) };
}

/**
 * `magnitudeOf` gives the raw number the bar length compares (count or
 * minutes); `valueFor` gives its display string ("9" vs "9 h"). The bar
 * scales relative to the largest item in THIS list, not a fixed axis - a
 * floor keeps the smallest bar visible instead of collapsing to a hairline.
 */
function statisticsRows(items, valueFor, magnitudeOf, emptyLabel) {
  if (!items.length) return '<p class="schedule-stat-empty">' + esc(emptyLabel) + '</p>';
  const max = Math.max(...items.map(magnitudeOf), 1);
  return '<div class="schedule-stat-list">' + items.map((item) => {
    const scale = Math.max(0.03, magnitudeOf(item) / max).toFixed(3);
    const color = esc(item.type.color);
    const name = esc(item.type.short_code ? item.type.short_code + ' · ' + item.type.name : item.type.name);
    return '<div class="schedule-stat-row">'
      + '<div class="schedule-stat-row__head">'
      + '<span class="schedule-swatch" style="--schedule-color:' + color + '"></span>'
      + '<span class="schedule-stat-row__name">' + name + '</span>'
      + '<strong>' + esc(valueFor(item)) + '</strong>'
      + '</div>'
      + '<div class="schedule-stat-row__track"><div class="schedule-stat-row__fill" style="--schedule-color:' + color + '; --bar-scale:' + scale + '"></div></div>'
      + '</div>';
  }).join('') + '</div>';
}









async function refreshStatistics() {
  const requestId = statisticsRequestId;
  const bounds = statisticBounds();


  // vorhandene "Waehle einen gueltigen Zeitraum"-Zustand (renderStatistics()'




  if (!bounds) {
    if (requestId !== statisticsRequestId) return; // ueberholt, siehe Kommentar unten
    statistics = { ...statistics, bounds: null, loading: false };
    return;
  }
  const userId = statistics.userId || currentUserId;
  const result = await api.get('/schedule/entries?from=' + encodeURIComponent(bounds.from) + '&to=' + encodeURIComponent(bounds.to) + '&user_id=' + encodeURIComponent(userId));
  if (requestId !== statisticsRequestId) return;
  statistics = { ...statistics, userId: Number(userId), entries: result.data?.entries ?? [], bounds, loading: false };
}

async function activateView(view) {
  activeView = view;
  if (view === 'overview') {
    const requestId = ++overviewRequestId;
    overview = { ...overview, entries: [], holidays: [], loading: true, error: false };
    renderPage();
    try { await refreshOverview(); }
    catch (error) {
      if (requestId !== overviewRequestId) return;
      overview = { ...overview, loading: false, error: true };
      window.aashiyana?.showToast(scheduleErrorMessage(error), 'danger');
    }
    if (requestId === overviewRequestId) renderPage();
    return;
  }
  if (view !== 'statistics') { renderPage(); return; }
  const requestId = ++statisticsRequestId;
  statistics = { ...statistics, entries: [], bounds: null, loading: true, error: false };
  renderPage();
  try { await refreshStatistics(); }
  catch (error) {
    if (requestId !== statisticsRequestId) return;
    statistics = { ...statistics, loading: false, error: true };
    window.aashiyana?.showToast(scheduleErrorMessage(error), 'danger');
  }
  if (requestId === statisticsRequestId) renderPage();
}

function overviewFetchRange(weekCursor, weekStartPref) {
  const weekStart = weekStartIndex(weekStartPref);
  const from = startOfLocalWeekKey(weekCursor, weekStart);
  return { entriesFrom: addLocalDays(from, -1), from, to: addLocalDays(from, 6) };
}

async function refreshOverview() {
  const requestId = overviewRequestId;
  const { entriesFrom, from, to } = overviewFetchRange(overview.weekCursor, state.weekStartPref);
  const [entriesRes, holidaysRes] = await Promise.all([
    api.get(`/schedule/entries?from=${entriesFrom}&to=${to}`),
    api.get(`/calendar/holidays?from=${from}&to=${to}`).catch(() => ({ data: [] })),
  ]);
  if (requestId !== overviewRequestId) return; // ueberholt - siehe refreshStatistics()
  overview = {
    ...overview,
    entries: entriesRes.data?.entries ?? [],
    holidays: holidaysRes.data ?? [],
    loading: false,
  };
}

function typeOptions(selected, includeFree = true) {
  const free = includeFree ? option('', t('schedule.freeDay'), selected == null || selected === '') : '';
  return `${free}${state.types.map((type) => option(type.id, type.short_code ? `${type.short_code} · ${type.name}` : type.name, Number(selected) === Number(type.id))).join('')}`;
}

function shiftPresetLabel(key) {
  const labels = {
    early: t('schedule.presets.early'),
    late: t('schedule.presets.late'),
    night: t('schedule.presets.night'),
    day: t('schedule.presets.day'),
    fullDay: t('schedule.presets.fullDay'),
    vacation: t('schedule.presets.vacation'),
    sick: t('schedule.presets.sick'),
    period1: t('schedule.presets.period1'),
    period2: t('schedule.presets.period2'),
    period3: t('schedule.presets.period3'),
    period4: t('schedule.presets.period4'),
    exam: t('schedule.presets.exam'),
    lecture: t('schedule.presets.lecture'),
    seminar: t('schedule.presets.seminar'),
    lab: t('schedule.presets.lab'),
  };
  return labels[key] ?? '';
}



// "Vorlesung" neben "Fruehschicht"). Optgroups je Vorlage - dieselben drei,

// die vorlagenuebergreifenden Presets (Urlaub/Krank/Klausur, ueberall


// sieht hier ebenso wenig Schule/Uni-Eintraege.
function shiftPresetOptgroups() {
  const shared = new Set(SHARED_PRESETS.map((preset) => preset.key));
  shared.add('exam');
  const visible = new Set(visibleQuickstartTemplates().map(([key]) => key));
  const groups = [];
  for (const [templateKey, labelKey] of QUICKSTART_TEMPLATES) {
    if (!visible.has(templateKey)) continue;
    const presets = PRESET_TEMPLATES[templateKey].filter((preset) => !shared.has(preset.key));
    if (presets.length) groups.push({ label: t(labelKey), presets });
  }
  const sharedPresets = ALL_PRESETS.filter((preset) => shared.has(preset.key));
  if (sharedPresets.length) groups.push({ label: t('schedule.presetShared'), presets: sharedPresets });
  return groups;
}

function shiftPresetOptions() {
  const groupsHtml = shiftPresetOptgroups().map((group) => '<optgroup label="' + esc(group.label) + '">'
    + group.presets.map((preset) => option(preset.key, shiftPresetLabel(preset.key))).join('')
    + '</optgroup>').join('');
  return option('', t('schedule.presetCustom'), true) + groupsHtml;
}

function setShiftIconButtonIcon(button, iconName) {
  button.querySelectorAll('i[data-lucide], svg.lucide').forEach((el) => el.remove());
  button.insertAdjacentHTML('afterbegin', '<i data-lucide="' + esc(iconName || 'image-off') + '" aria-hidden="true"></i>');
  window.lucide?.createIcons({ el: button });
}

function applyShiftPreset(form) {
  const selected = ALL_PRESETS.find((preset) => preset.key === form.elements.shift_preset?.value);
  if (!selected) return;
  form.elements.name.value = shiftPresetLabel(selected.key);
  form.elements.short_code.value = selected.shortCode;
  form.elements.start_time.value = selected.startTime;
  form.elements.end_time.value = selected.endTime;
  form.elements.color.value = selected.color;
  form.elements.icon.value = selected.icon ?? '';
  const iconButton = form.querySelector('[data-action="pick-shift-icon"]');
  if (iconButton) setShiftIconButtonIcon(iconButton, selected.icon);
}
function userOptions(selected) {
  return state.users.filter((user) => canManageOthers || Number(user.id) === Number(currentUserId)).map((user) => option(user.id, user.display_name || user.username, Number(selected) === Number(user.id))).join('');
}

function formField(label, control, className = '') {
  return '<div class="form-field ' + className + '"><label class="label">' + esc(label) + '</label>' + control + '</div>';
}

function shiftFields(type = {}) {
  return [
    formField(t('schedule.name'), '<input class="input" required name="name" maxlength="200" value="' + esc(type.name ?? '') + '">'),
    formField(t('schedule.shortCode'), '<input class="input" name="short_code" maxlength="12" value="' + esc(type.short_code ?? '') + '">'),
    formField(t('schedule.color'), '<input class="input form-input--color" required name="color" type="color" value="' + esc(type.color ?? SHIFT_COLOR_FALLBACK) + '">', 'schedule-color-field'),
    formField(t('schedule.icon'), '<button type="button" class="btn btn--secondary schedule-icon-picker" data-action="pick-shift-icon">'
      + (type.icon ? '<i data-lucide="' + esc(type.icon) + '" aria-hidden="true"></i>' : '<i data-lucide="image-off" aria-hidden="true"></i>')
      + '<span>' + esc(t('schedule.chooseIcon')) + '</span></button>'
      + '<input type="hidden" name="icon" value="' + esc(type.icon ?? '') + '">'),
    formField(t('schedule.startTime'), '<aashiyana-datepicker name="start_time" type="time" label="' + esc(t('schedule.startTime')) + '" value="' + esc(type.start_time ?? '') + '"></aashiyana-datepicker>'),
    formField(t('schedule.endTime'), '<aashiyana-datepicker name="end_time" type="time" label="' + esc(t('schedule.endTime')) + '" value="' + esc(type.end_time ?? '') + '"></aashiyana-datepicker>'),
  ].join('');
}

async function pickShiftIcon(button) {
  const form = button.closest('form');
  const hidden = form?.elements?.icon;
  if (!hidden) return;
  const { openIconPicker } = await import('/components/icon-picker.js');
  const chosen = await openIconPicker(hidden.value || null);
  if (chosen === undefined) return;
  hidden.value = chosen ?? '';
  setShiftIconButtonIcon(button, chosen);
}

function patternFields(pattern = {}) {
  const active = pattern.is_active === false || pattern.is_active === 0 ? '' : ' checked';
  return [
    formField(t('schedule.name'), '<input class="input" required name="name" maxlength="200" value="' + esc(pattern.name ?? '') + '">'),
    formField(t('schedule.anchorDate'), '<aashiyana-datepicker required name="anchor_date" type="date" label="' + esc(t('schedule.anchorDate')) + '" value="' + esc(pattern.anchor_date ?? todayKey()) + '"></aashiyana-datepicker>'),
    formField(t('schedule.cycleLength'), '<input class="input" required name="cycle_length" type="number" min="1" max="366" value="' + esc(String(pattern.cycle_length ?? 7)) + '">'),
    formField(t('schedule.validFrom'), '<aashiyana-datepicker name="valid_from" type="date" label="' + esc(t('schedule.validFrom')) + '" value="' + esc(pattern.valid_from ?? '') + '"></aashiyana-datepicker>'),
    formField(t('schedule.validUntil'), '<aashiyana-datepicker name="valid_until" type="date" label="' + esc(t('schedule.validUntil')) + '" value="' + esc(pattern.valid_until ?? '') + '"></aashiyana-datepicker>'),
    '<div class="form-field schedule-active-field"><span class="label">' + esc(t('schedule.active')) + '</span><label class="toggle"><input name="is_active" type="checkbox"' + active + '><span class="toggle__track"></span></label></div>',
  ].join('');
}

function shiftTypeCard(type) {
  const editable = canEditType(type);
  const body = editable
    ? `<form class="schedule-form" data-form="shift-update" data-id="${type.id}">${shiftFields(type)}<div class="schedule-actions"><button class="btn btn--secondary">${esc(t('schedule.save'))}</button><button type="button" class="btn btn--danger-outline" data-action="delete-shift" data-id="${type.id}">${esc(t('schedule.delete'))}</button></div></form>`
    : `<p class="schedule-readonly">${esc(type?.created_by == null
        ? t('schedule.typeOrphaned')
        : t('schedule.typeOwnedBy', { user: userName(type.created_by) }))}</p>`;
  const icon = type.icon ? `<i data-lucide="${esc(type.icon)}" class="schedule-type-icon" aria-hidden="true"></i>` : '';



  const fieldsEditor = editable && state.customFields.length ? shiftTypeFieldsEditor(type) : '';
  return `<details class="card schedule-details"><summary><span class="schedule-swatch" style="--schedule-color:${esc(type.color)}"></span>${icon}<span class="u-card-title u-compact">${esc(type.short_code ? `${type.short_code} · ${type.name}` : type.name)}</span> <small>${esc(clockLabel(type))}</small></summary>
    ${body}
    ${fieldsEditor}
  </details>`;
}

function shiftTypeFieldRow(field) {
  return '<div class="schedule-type-field-row" data-type-field-row data-custom-field-id="' + field.id + '">'
    + '<button type="button" class="schedule-type-field-row__handle" aria-hidden="true" tabindex="-1"><i data-lucide="grip-vertical" aria-hidden="true"></i></button>'
    + '<span class="schedule-type-field-row__name">' + esc(field.name) + '</span>'
    + '<label class="toggle schedule-type-field-row__overlay"><input type="checkbox" data-show-in-overlay' + (field.show_in_overlay ? ' checked' : '') + '><span class="toggle__track"></span>' + esc(t('schedule.showInOverlay')) + '</label>'
    + '<button type="button" class="btn btn--secondary btn--icon" data-action="move-type-field" data-direction="up" aria-label="' + esc(t('schedule.moveUp')) + '"><i data-lucide="chevron-up" aria-hidden="true"></i></button>'
    + '<button type="button" class="btn btn--secondary btn--icon" data-action="move-type-field" data-direction="down" aria-label="' + esc(t('schedule.moveDown')) + '"><i data-lucide="chevron-down" aria-hidden="true"></i></button>'
    + '<button type="button" class="btn btn--secondary btn--icon" data-action="remove-type-field" aria-label="' + esc(t('common.delete')) + '"><i data-lucide="x" aria-hidden="true"></i></button>'
    + '</div>';
}


// oben - derselbe Aufbau wie patternCard()'s Zyklustage-Editor + eigener
// save-days-Knopf: rein lokale Aenderungen (hinzufuegen/entfernen/umsortieren/

function shiftTypeFieldsEditor(type) {
  const attachedIds = new Set(type.fields.map((field) => field.id));
  const available = state.customFields.filter((field) => !attachedIds.has(field.id));
  const rows = type.fields.map(shiftTypeFieldRow).join('');
  const picker = available.length
    ? '<div class="schedule-type-field-add">'
      + '<select class="input" data-field-picker="' + type.id + '">' + available.map((field) => option(field.id, field.name)).join('') + '</select>'
      + '<button type="button" class="btn btn--secondary" data-action="add-type-field" data-id="' + type.id + '">' + esc(t('common.add')) + '</button>'
      + '</div>' : '';
  const body = '<div class="schedule-type-fields-rows" data-type-fields-rows="' + type.id + '">'
    + (rows || '<p class="u-meta">' + esc(t('schedule.noFieldsAttached')) + '</p>') + '</div>'
    + picker
    + '<div class="schedule-actions"><button type="button" class="btn btn--secondary" data-action="save-shift-fields" data-id="' + type.id + '">' + esc(t('schedule.save')) + '</button></div>';
  return advancedSection(body, { label: t('schedule.attachedFields') });
}


// beliebig viele Schichttypen anheftbar (Phase 2), damit "Raum" nicht pro


// Schichttypen (canEditType() liest ohnehin nur created_by/canManageOthers,

function customFieldRow(field) {
  const editable = canEditType(field);
  const actions = editable
    ? '<span class="schedule-override-actions"><button type="button" class="btn btn--secondary" data-action="edit-custom-field" data-id="' + field.id + '">' + esc(t('common.edit')) + '</button>'
      + '<button type="button" class="btn btn--danger-outline" data-action="delete-custom-field" data-id="' + field.id + '">' + esc(t('schedule.delete')) + '</button></span>'
    : '';
  return '<div class="list-row schedule-custom-field-row"><div class="list-row__main"><span class="list-row__name">' + esc(field.name) + '</span></div>' + actions + '</div>';
}

function emptyCustomFieldsState() {
  return emptyStateHTML({
    icon: 'list-plus',
    title: t('schedule.emptyCustomFieldsTitle'),
    description: t('schedule.emptyCustomFieldsDescription'),
    actions: readOnly() ? [] : [{ label: t('schedule.createCustomField'), icon: 'plus', attrs: { 'data-action': 'open-create-custom-field' } }],
  });
}

function customFieldsSection() {
  return '<section class="schedule-library schedule-library--custom-fields"><div class="schedule-library__head"><h2 class="u-section-title">' + esc(t('schedule.customFields')) + '</h2>'
    + (state.customFields.length && !readOnly() ? '<button type="button" class="btn btn--secondary" data-action="open-create-custom-field"><i data-lucide="plus" aria-hidden="true"></i>' + esc(t('schedule.createCustomField')) + '</button>' : '') + '</div>'
    + (state.customFields.length ? '<div class="list-rows">' + state.customFields.map(customFieldRow).join('') + '</div>' : emptyCustomFieldsState())
    + '</section>';
}



// selben Tag) traegt jede Position jetzt eine variable Anzahl Zeilen (0..N),

// etwas. save-days' Handler bleibt unveraendert: er sammelt ohnehin JEDES
// [data-day]-Element, unabhaengig davon, wie viele dieselbe Position tragen.



// renderShell() weiter unten), damit beide Wege garantiert dasselbe Markup
// erzeugen.





function dayRowFieldsHtml(shiftTypeId, fieldValues = {}, writable = true) {
  const type = state.types.find((t) => Number(t.id) === Number(shiftTypeId));
  if (!type?.fields.length) return '';
  const disabledAttr = writable ? '' : ' disabled';
  return '<div class="schedule-day-row-fields" data-day-row-fields>' + type.fields.map((field) =>
    formField(field.name, '<input class="input" data-field-value="' + field.id + '" maxlength="500" value="' + esc(fieldValues[field.id] ?? '') + '"' + disabledAttr + '>')
  ).join('') + '</div>';
}

function dayRowHtml(position, shiftTypeId, writable, fieldValues = {}) {
  const remove = writable ? '<button type="button" class="btn btn--secondary btn--icon" data-action="remove-pattern-day-row" aria-label="' + esc(t('common.delete')) + '"><i data-lucide="x" aria-hidden="true"></i></button>' : '';
  const disabledAttr = writable ? '' : ' disabled';
  return '<div class="schedule-day-row" data-day-row>'
    + '<div class="schedule-day-row__main"><select class="input" data-day="' + position + '"' + disabledAttr + '>' + typeOptions(shiftTypeId) + '</select>' + remove + '</div>'
    + dayRowFieldsHtml(shiftTypeId, fieldValues, writable)
    + '</div>';
}

function patternCard(pattern) {
  const writable = canWrite(pattern.user_id);
  const assigned = new Map();
  for (const day of pattern.days) {
    const position = Number(day.position);
    if (!assigned.has(position)) assigned.set(position, []);
    assigned.get(position).push({ shiftTypeId: day.shift_type_id, fieldValues: day.field_values ?? {} });
  }
  const days = Array.from({ length: pattern.cycle_length }, (_, position) => {
    const classes = assigned.get(position) ?? [{ shiftTypeId: null, fieldValues: {} }];
    const rows = classes.map((day) => dayRowHtml(position, day.shiftTypeId, writable, day.fieldValues)).join('');
    const add = writable ? '<button type="button" class="btn btn--secondary" data-action="add-pattern-day-row" data-position="' + position + '">' + esc(t('common.add')) + '</button>' : '';



    // 'input'/'change'-Delegierte) den Text austauscht, sobald Start-/

    const label = cycleDayHeaderLabel(pattern.anchor_date, pattern.cycle_length, pattern.valid_from, pattern.valid_until, position + 1);
    return '<div class="form-field schedule-day-group" data-day-group="' + position + '"><label class="label" data-day-group-label>' + esc(label) + '</label><div class="schedule-day-rows">' + rows + '</div>' + add + '</div>';
  }).join('');

  // aktive Karte derselben Person konkurriert (resolveWinningPatternId()
  // liefert sonst null) - eine einzelne aktive Karte traegt kein Abzeichen.
  const winningId = resolveWinningPatternId(state.patterns, pattern.user_id, todayKey());
  const winsBadge = winningId != null && Number(winningId) === Number(pattern.id)
    ? '<span class="schedule-wins-badge">' + esc(t('schedule.patternWinsBadge')) + '</span>'
    : '';
  return `<details class="card schedule-details" data-pattern="${pattern.id}"><summary><span class="u-card-title u-compact">${esc(pattern.name)}</span> <small>· ${esc(userName(pattern.user_id))}</small>${winsBadge}</summary>
    ${writable ? `<form class="schedule-form" data-form="pattern-update" data-id="${pattern.id}">${patternFields(pattern)}<button class="btn btn--secondary">${esc(t('schedule.save'))}</button></form>` : ''}
    <h3 class="u-card-title">${esc(t('schedule.cycleDays'))}</h3><p class="u-meta schedule-cycle-hint">${esc(t('schedule.cycleDaysHint', { count: pattern.cycle_length }))}</p><div class="schedule-days">${days}</div>
    ${writable ? `<div class="schedule-actions"><button type="button" class="btn btn--secondary" data-action="save-days" data-id="${pattern.id}">${esc(t('schedule.save'))}</button><button type="button" class="btn btn--danger-outline" data-action="delete-pattern" data-id="${pattern.id}">${esc(t('schedule.delete'))}</button></div>` : ''}
  </details>`;
}



// Objekt kein verlaessliches Merkmal, deshalb kein blosser JSON.stringify()-Vergleich.
function sameFieldValues(a = {}, b = {}) {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => a[key] === b[key]);
}

function overrideGroups(overrides = state.overrides) {
  const sorted = [...overrides].sort((a, b) =>
    Number(a.user_id) - Number(b.user_id) || a.date_key.localeCompare(b.date_key));
  const groups = [];
  for (const row of sorted) {
    const last = groups[groups.length - 1];
    const sameSeries = last
      && Number(last.user_id) === Number(row.user_id)
      && ((last.shift_type_id == null && row.shift_type_id == null) || Number(last.shift_type_id) === Number(row.shift_type_id));



    const consecutive = sameSeries && (last.note ?? '') === (row.note ?? '') && sameFieldValues(last.field_values, row.field_values) && addLocalDays(last.to, 1) === row.date_key;
    if (consecutive) {
      last.to = row.date_key;
      last.ids.push(row.id);
    } else {
      groups.push({ user_id: row.user_id, shift_type_id: row.shift_type_id, note: row.note, field_values: row.field_values ?? {}, from: row.date_key, to: row.date_key, ids: [row.id] });
    }
  }
  return groups;
}

function rangeDifference(oldFrom, oldTo, newFrom, newTo) {
  const spans = [];
  if (oldFrom < newFrom) {
    const end = addLocalDays(newFrom, -1) < oldTo ? addLocalDays(newFrom, -1) : oldTo;
    if (oldFrom <= end) spans.push({ from: oldFrom, to: end });
  }
  if (oldTo > newTo) {
    const start = addLocalDays(newTo, 1) > oldFrom ? addLocalDays(newTo, 1) : oldFrom;
    if (start <= oldTo) spans.push({ from: start, to: oldTo });
  }
  return spans;
}




function emptyOverrideState() {
  return emptyStateHTML({
    icon: 'calendar-clock',
    title: t('schedule.emptyOverridesTitle'),
    description: t('schedule.emptyOverridesDescription'),
    action: readOnly() ? null : { label: t('schedule.createOverride'), icon: 'plus', attrs: { 'data-action': 'open-create-override' } },
  });
}

function overrideRows() {
  const groups = overrideGroups();
  if (!groups.length) return emptyOverrideState();
  return '<div class="list-rows">' + groups.map((group) => {
    const type = state.types.find((item) => Number(item.id) === Number(group.shift_type_id));
    const swatchColor = type ? type.color : 'var(--color-border)';
    const typeLabel = type ? (type.short_code ? `${type.short_code} · ${type.name}` : type.name) : t('schedule.freeDay');
    const meta = [userName(group.user_id), typeLabel, group.note].filter(Boolean).join(' · ');
    const label = group.from === group.to ? formatDate(group.from) : `${formatDate(group.from)} – ${formatDate(group.to)}`;
    const actions = canWrite(group.user_id)
      ? '<span class="schedule-override-actions"><button type="button" class="btn btn--secondary" data-action="edit-override" data-from="' + esc(group.from) + '" data-user-id="' + group.user_id + '">' + esc(t('common.edit')) + '</button><button type="button" class="btn btn--danger-outline" data-action="delete-override-range" data-from="' + esc(group.from) + '" data-to="' + esc(group.to) + '" data-user-id="' + group.user_id + '">' + esc(t('schedule.delete')) + '</button></span>'
      : '';
    const icon = type?.icon ? '<i data-lucide="' + esc(type.icon) + '" class="schedule-type-icon" aria-hidden="true"></i>' : '';
    return '<div class="list-row schedule-override"><span class="schedule-swatch" style="--schedule-color:' + esc(swatchColor) + '"></span>' + icon + '<div class="list-row__main"><span class="list-row__name">' + esc(label) + '</span><span class="list-row__meta">' + esc(meta) + '</span></div>' + actions + '</div>';
  }).join('') + '</div>';
}






function extraBadge() {
  return '<i data-lucide="layers" class="schedule-extra-badge" aria-label="' + esc(t('schedule.extraBadgeLabel')) + '"></i>';
}

function emptyExtraShiftsState() {
  return emptyStateHTML({
    icon: 'calendar-clock',
    title: t('schedule.emptyExtraShiftsTitle'),
    description: t('schedule.emptyExtraShiftsDescription'),
    action: readOnly() ? null : { label: t('schedule.addExtraShift'), icon: 'plus', attrs: { 'data-action': 'open-create-extra' } },
  });
}



function extraGroups(extras = state.extras) {
  const sorted = [...extras].sort((a, b) =>
    Number(a.user_id) - Number(b.user_id) || a.date_key.localeCompare(b.date_key));
  const groups = [];
  for (const row of sorted) {
    const last = groups[groups.length - 1];
    const sameSeries = last
      && Number(last.user_id) === Number(row.user_id)
      && Number(last.shift_type_id) === Number(row.shift_type_id)
      && (last.note ?? '') === (row.note ?? '')
      && (last.reminder_offset_minutes ?? null) === (row.reminder_offset_minutes ?? null)
      && sameFieldValues(last.field_values, row.field_values);
    const consecutive = sameSeries && addLocalDays(last.to, 1) === row.date_key;
    if (consecutive) {
      last.to = row.date_key;
      last.ids.push(row.id);
    } else {
      groups.push({ user_id: row.user_id, shift_type_id: row.shift_type_id, note: row.note, reminder_offset_minutes: row.reminder_offset_minutes, field_values: row.field_values ?? {}, from: row.date_key, to: row.date_key, ids: [row.id] });
    }
  }
  return groups;
}

function extraRows() {
  const groups = extraGroups();
  if (!groups.length) return emptyExtraShiftsState();
  return '<div class="list-rows">' + groups.map((group) => {
    const type = state.types.find((item) => Number(item.id) === Number(group.shift_type_id));
    const swatchColor = type ? type.color : 'var(--color-border)';
    const typeLabel = type ? (type.short_code ? `${type.short_code} · ${type.name}` : type.name) : '';
    const meta = [userName(group.user_id), typeLabel, group.note].filter(Boolean).join(' · ');
    const label = group.from === group.to ? formatDate(group.from) : `${formatDate(group.from)} – ${formatDate(group.to)}`;
    const icon = type?.icon ? '<i data-lucide="' + esc(type.icon) + '" class="schedule-type-icon" aria-hidden="true"></i>' : '';
    const ids = esc(group.ids.join(','));
    const actions = canWrite(group.user_id)
      ? '<span class="schedule-override-actions"><button type="button" class="btn btn--secondary" data-action="edit-extra-range" data-ids="' + ids + '">' + esc(t('common.edit')) + '</button><button type="button" class="btn btn--danger-outline" data-action="delete-extra-range" data-ids="' + ids + '" data-user-id="' + group.user_id + '" data-from="' + esc(group.from) + '" data-to="' + esc(group.to) + '">' + esc(t('schedule.delete')) + '</button></span>'
      : '';
    return '<div class="list-row schedule-override"><span class="schedule-swatch" style="--schedule-color:' + esc(swatchColor) + '"></span>' + icon + extraBadge() + '<div class="list-row__main"><span class="list-row__name">' + esc(label) + '</span><span class="list-row__meta">' + esc(meta) + '</span></div>' + actions + '</div>';
  }).join('') + '</div>';
}

function renderStatistics() {
  const bounds = statistics.bounds || statisticBounds();
  const summary = statisticsSummary();
  const weeklyHours = state.weeklyHours ?? DEFAULT_WEEKLY_HOURS;

  // verstecktes Ergebnis. `overtime?.over` unten bleibt dieselbe Pruefung wie

  // auch schon tat.
  const overtime = state.overtimeEnabled ? overtimeInfo(statistics.entries, weeklyHours) : null;
  const selectedUser = statistics.userId || currentUserId;
  const range = statistics.range;
  const countItems = [...summary.values];
  if (summary.freeDays) countItems.push({ type: { name: t('schedule.freeDays'), short_code: '', color: 'var(--color-text-secondary)' }, count: summary.freeDays, minutes: 0, hasHours: false });
  const hourItems = summary.values.filter((item) => item.hasHours);
  const controls = range === 'months'
    ? formField(t('schedule.monthFrom'), '<input class="input" required type="month" name="month_from" value="' + esc(statistics.monthFrom || monthKey()) + '">')
      + formField(t('schedule.monthTo'), '<input class="input" required type="month" name="month_to" value="' + esc(statistics.monthTo || monthKey()) + '">')
    : range === 'custom'
      // S-06: "Valid from/until" ist Muster-Vokabular (patternFields() oben) -


      ? formField(t('schedule.rangeFrom'), '<aashiyana-datepicker required name="from" type="date" label="' + esc(t('schedule.rangeFrom')) + '" value="' + esc(statistics.from || bounds?.from || todayKey()) + '"></aashiyana-datepicker>')
        + formField(t('schedule.rangeTo'), '<aashiyana-datepicker required name="to" type="date" label="' + esc(t('schedule.rangeTo')) + '" value="' + esc(statistics.to || bounds?.to || todayKey()) + '"></aashiyana-datepicker>')
      : '';


  // catch-Zweig rendert genau hierher zurueck. Vorher stand da `bounds.from` -

  // vorigen Ergebnis stehen und sagte nichts.



  // Falschaussage. Eigener Zweig, denselben Fehlerzustand wie andere Module
  // (mountLoadError/emptyStateHTML variant:'error') statt erfundener Zahlen.
  const results = statistics.loading
    ? '<div class="card card--padded schedule-stat-loading" role="status" aria-live="polite">' + esc(t('common.loading')) + '</div>'
    : statistics.error
      ? emptyStateHTML({ variant: 'error', title: t('common.errorGeneric'), description: t('common.loadErrorDescription'), action: { label: t('common.retry'), icon: 'refresh-cw', attrs: { 'data-action': 'retry-statistics' } } })
      : !bounds
      ? '<p class="card card--padded schedule-stat-empty" role="status">' + esc(t('schedule.invalidRange')) + '</p>'
      : '<p class="schedule-stat-period u-meta">' + esc(t('schedule.statisticsFor', { user: userName(selectedUser), from: formatDate(bounds.from), to: formatDate(bounds.to) })) + '</p>'
      + '<div class="metric-grid schedule-stat-metrics' + (overtime?.over ? ' schedule-stat-metrics--with-overtime' : '') + '">'
      + '<article class="metric-card"><div class="metric-card__label">' + esc(t('schedule.shiftCounts')) + '</div><div class="metric-card__value">' + esc(String(summary.totalCount)) + '</div><div class="metric-card__note">' + esc(t('schedule.shifts')) + '</div></article>'
      + '<article class="metric-card"><div class="metric-card__label">' + esc(t('schedule.workedHours')) + '</div><div class="metric-card__value">' + esc(formatHours(summary.totalMinutes)) + '</div><div class="metric-card__note">' + esc(t('schedule.total')) + '</div></article>'
      + (overtime?.over ? '<article class="metric-card metric-card--warning"><div class="metric-card__label">' + esc(t('schedule.overtime')) + '</div><div class="metric-card__value">+' + esc(formatHours(overtime.excessMinutes)) + '</div><div class="metric-card__note">' + esc(t('schedule.overtimeNote', { hours: weeklyHours })) + '</div></article>' : '')
      + '</div>'
      + '<div class="schedule-stat-sections">'
      + '<section class="card card--padded schedule-stat-card"><div><h2 class="u-section-title">' + esc(t('schedule.shiftCounts')) + '</h2><p class="u-meta">' + esc(t('schedule.shiftCountsDescription')) + '</p></div>' + statisticsRows(countItems, (item) => String(item.count), (item) => item.count, t('schedule.noStatistics')) + '<div class="schedule-stat-total"><span>' + esc(t('schedule.total')) + '</span><strong>' + esc(String(summary.totalCount)) + '</strong></div></section>'
      + '<section class="card card--padded schedule-stat-card"><div><h2 class="u-section-title">' + esc(t('schedule.workedHours')) + '</h2><p class="u-meta">' + esc(t('schedule.workedHoursDescription')) + '</p></div>' + statisticsRows(hourItems, (item) => formatHours(item.minutes), (item) => item.minutes, t('schedule.noStatistics')) + '<div class="schedule-stat-total"><span>' + esc(t('schedule.total')) + '</span><strong>' + esc(formatHours(summary.totalMinutes)) + '</strong></div></section>'
      + '</div>';
  return '<section class="schedule-statistics">'
    + renderReminderSettings()
    + '<form class="card card--padded schedule-stat-filters" data-form="statistics">'
    // S-13 (UX-Audit, Entscheidung D-B): userOptions() statt der vollen


    // AGGREGAT-Ansicht: GET /schedule/entries selbst bleibt fuer jeden mit
    // Schichtplan-Lesezugriff fuer JEDEN user_id abrufbar (Today-Karte/
    // Uebersicht/Kalender/Dashboard-Kachel brauchen genau das, absichtlich

    // Zusammenfassung fuer fremde Konten, sie sperrt keine Rohdaten.
    + formField(t('schedule.owner'), '<select class="input" required name="user_id">' + userOptions(canManageOthers ? selectedUser : currentUserId) + '</select>')
    + '<div class="form-field schedule-stat-range"><span class="label">' + esc(t('schedule.statisticsRange')) + '</span><div class="segmented schedule-stat-range__choices" role="group" aria-label="' + esc(t('schedule.statisticsRange')) + '">'
    + [['current', 'schedule.currentMonth'], ['months', 'schedule.selectedMonths'], ['custom', 'schedule.customRange']].map(([value, label]) => '<button type="button" class="segmented__item' + (range === value ? ' is-active' : '') + '" data-action="statistics-range" data-range="' + value + '" aria-pressed="' + (range === value ? 'true' : 'false') + '">' + esc(t(label)) + '</button>').join('')
    + '</div></div>' + (controls ? '<div class="schedule-stat-dates">' + controls + '</div>' : '')
    + '<div class="schedule-stat-filter-actions"><button class="btn btn--primary">' + esc(t('schedule.applyStatistics')) + '</button>'
    + '<button type="button" class="btn btn--secondary" data-action="print-statistics"><i data-lucide="printer" aria-hidden="true"></i>' + esc(t('schedule.print')) + '</button></div></form>'
    + results + '</section>';
}




// Beschreibung angehaengt statt eines zweiten, aehnlich klingenden Schluessels.
function emptyPatternState() {
  const description = state.types.length
    ? t('schedule.emptyPatternsDescription')
    : `${t('schedule.emptyPatternsDescription')} ${t('schedule.noShiftTypesHint')}`;
  return emptyStateHTML({
    icon: 'calendar-clock',
    title: t('schedule.emptyPatternsTitle'),
    description,
    action: readOnly() ? null : { label: t('schedule.addPattern'), icon: 'plus', attrs: { 'data-action': 'open-create', 'data-view': 'patterns' } },
  });
}


// Anlegen-Formular durchzuklicken, obwohl der Waehler dort (shiftPresetOptions)


// Bequemlichkeit fuer Schule/Uni genauso gilt wie fuer Arbeit. „Manuell
// anlegen" bleibt letzte Wahl (Grammatik-Praezedenz), fuer wer lieber sofort
// einen eigenen Typ benennt.
function emptyShiftTypesState() {
  return emptyStateHTML({
    icon: 'calendar-clock',
    title: t('schedule.emptyShiftTypesTitle'),
    description: t('schedule.emptyShiftTypesDescription'),
    actions: readOnly() ? [] : [
      ...visibleQuickstartTemplates().map(([key, labelKey]) => ({ label: t(labelKey), icon: 'sparkles', attrs: { 'data-action': 'quick-start-shifts', 'data-template': key } })),
      { label: t('schedule.createShiftType'), icon: 'plus', attrs: { 'data-action': 'open-create', 'data-view': 'shifts' } },
    ],
  });
}







function overlayMeta(entry) {
  const overlayFields = (entry.shift_type?.fields ?? []).filter((field) => field.show_in_overlay && entry.field_values?.[field.id]);
  return [entry.note, ...overlayFields.map((field) => `${field.name}: ${entry.field_values[field.id]}`)].filter(Boolean).join(' · ');
}

// S-17: Eintraege selbst tragen keine einzelne durchgehende Id - welche Spalte
// zaehlt (pattern_day_id/override_id/extra_id), haengt von `source` ab (siehe
// server/services/schedule.js#scheduleData). Diese zusammengesetzte Kennung



// Data-Attribut zu serialisieren.
function scheduleEntryMatchKey(entry) {
  const sourceId = entry.source === 'pattern' ? (entry.pattern_day_id ?? `p${entry.pattern_id}`)
    : entry.source === 'override' ? entry.override_id : entry.extra_id;
  return [entry.date_key, entry.user_id, entry.source, sourceId].join(':');
}




// Suche selbst gleichgueltig.
function findScheduleEntry(key) {
  return [...state.entries, ...overview.entries].find((entry) => scheduleEntryMatchKey(entry) === key);
}

function scheduleEntryOriginLabel(entry) {
  if (entry.source === 'pattern') {
    const pattern = state.patterns.find((item) => Number(item.id) === Number(entry.pattern_id));
    return pattern ? `${t('schedule.pattern')} · ${pattern.name}` : t('schedule.pattern');
  }
  if (entry.source === 'override') return t('schedule.override');
  return t('schedule.extraBadgeLabel');
}

function renderScheduleEntryDetailContent(entry) {
  const type = entry.shift_type;
  const swatchColor = type ? type.color : 'var(--color-border)';
  const icon = type?.icon ? '<i data-lucide="' + esc(type.icon) + '" class="schedule-type-icon" aria-hidden="true"></i>' : '';
  const label = type ? esc(type.short_code ? `${type.short_code} · ${type.name}` : type.name) : esc(t('schedule.freeDay'));
  const time = type ? esc(clockLabel(type)) : '';
  const fieldRows = (type?.fields ?? [])
    .filter((field) => entry.field_values?.[field.id])
    .map((field) => '<div class="schedule-entry-detail__row"><dt>' + esc(field.name) + '</dt><dd>' + esc(entry.field_values[field.id]) + '</dd></div>')
    .join('');
  return '<div class="schedule-entry-detail">'
    + '<div class="schedule-entry-detail__head"><span class="schedule-swatch" style="--schedule-color:' + esc(swatchColor) + '"></span>' + icon + '<span class="u-card-title u-compact">' + label + '</span>' + (time ? '<small>' + time + '</small>' : '') + '</div>'
    + '<dl class="schedule-entry-detail__rows">'
    + '<div class="schedule-entry-detail__row"><dt>' + esc(t('schedule.owner')) + '</dt><dd>' + esc(userName(entry.user_id)) + '</dd></div>'
    + (entry.note ? '<div class="schedule-entry-detail__row"><dt>' + esc(t('schedule.note')) + '</dt><dd>' + esc(entry.note) + '</dd></div>' : '')
    + fieldRows
    + '<div class="schedule-entry-detail__row"><dt>' + esc(t('schedule.origin')) + '</dt><dd>' + esc(scheduleEntryOriginLabel(entry)) + '</dd></div>'
    + '</dl></div>';
}

function openScheduleEntryDetailModal(entry) {

  // zu verwerfen.
  openModal({ title: t('schedule.entryDetailTitle'), size: 'sm', content: renderScheduleEntryDetailContent(entry), dirtyGuard: false });
}

function renderToday() {
  if (!state.entries.length) return `<p>${esc(t('schedule.empty'))}</p>`;
  return `<div class="list-rows">${state.entries.map((entry) => {
    const type = entry.shift_type;
    const swatchColor = type ? type.color : 'var(--color-border)';
    const name = type ? esc(type.short_code ? `${type.short_code} · ${type.name}` : type.name) : esc(t('schedule.freeDay'));
    const base = type ? `${esc(userName(entry.user_id))} · ${esc(clockLabel(type))}` : esc(userName(entry.user_id));
    const overlay = overlayMeta(entry);
    const meta = overlay ? `${base} · ${esc(overlay)}` : base;
    const icon = type?.icon ? `<i data-lucide="${esc(type.icon)}" class="schedule-type-icon" aria-hidden="true"></i>` : '';
    const badge = entry.source === 'extra' ? extraBadge() : '';
    // S-17: Zeile ist read-only, aber klickbar/tastaturbedienbar (role=button,
    // dieselbe Enter/Space-Aktivierung wie calendar.js' Agenda-Zeilen) - jede

    // Aktion in READ_SAFE_ACTIONS.
    const key = esc(scheduleEntryMatchKey(entry));
    return `<div class="list-row schedule-entry-row" role="button" tabindex="0" data-action="view-schedule-entry" data-schedule-key="${key}" aria-label="${name}, ${meta}"><span class="schedule-swatch" style="--schedule-color:${esc(swatchColor)}"></span>${icon}${badge}<div class="list-row__main"><span class="list-row__name">${name}</span><span class="list-row__meta">${meta}</span></div></div>`;
  }).join('')}</div>`;
}

// Uebersicht-Tab: mehrere Personen nebeneinander vergleichen.
//





// war falsch: alphabetisch bleibt stabil ueber jede Auswahlaenderung hinweg,







// leerem entries-Array - eine ausgelassene Spur wuerde jede spaetere Spur an

// Ansicht existiert.
function isOvernightEntry(entry) {
  const type = entry.shift_type;
  return !!(type?.start_time && type?.end_time && type.end_time <= type.start_time);
}

function touchesVisibleDay(entry, visibleDateKeys) {
  return visibleDateKeys.has(entry.date_key)
    || (isOvernightEntry(entry) && visibleDateKeys.has(addLocalDays(entry.date_key, 1)));
}

function buildOverviewLanes(days, selectedUserIds, entries) {
  const byDayAndUser = new Map();
  for (const entry of entries) {
    const key = `${entry.date_key}:${entry.user_id}`;
    if (!byDayAndUser.has(key)) byDayAndUser.set(key, []);
    byDayAndUser.get(key).push(entry);
  }




  // ORIGINALEN Eintraegen erzeugt, nie aus bereits eingefuegten
  // Fortsetzungen - sonst kaeme jeden Tag eine weitere hinzu.
  for (const entry of entries) {
    if (!isOvernightEntry(entry)) continue;
    const nextKey = `${addLocalDays(entry.date_key, 1)}:${entry.user_id}`;





    const withoutFreeMarker = (byDayAndUser.get(nextKey) ?? []).filter((item) => item.shift_type);
    byDayAndUser.set(nextKey, [...withoutFreeMarker, { ...entry, __continuation: true }]);
  }


  // weil GET /entries keine Sortiergarantie ueber mehrere Bloecke desselben
  // Tages gibt (Migration 188, mehrere Bloecke je Zyklustag).
  const startMinutes = (entry) => {
    if (entry.__continuation) return -1;
    const start = entry.shift_type?.start_time;
    if (!start) return -1;
    const [h, m] = start.split(':').map(Number);
    return h * 60 + m;
  };
  for (const list of byDayAndUser.values()) list.sort((a, b) => startMinutes(a) - startMinutes(b));
  return days.map((dateKey) => ({
    dateKey,
    lanes: selectedUserIds.map((userId, laneIndex) => ({
      userId,
      laneIndex,
      entries: byDayAndUser.get(`${dateKey}:${userId}`) ?? [],
    })),
  }));
}

function overviewVisibleDays() {
  if (overview.viewMode === 'day') return [overview.weekCursor];
  const weekStart = weekStartIndex(state.weekStartPref);
  const from = startOfLocalWeekKey(overview.weekCursor, weekStart);
  return Array.from({ length: 7 }, (_, i) => addLocalDays(from, i));
}

/** Haushaltsweite Ferien-/Feiertagsbanner ueber dem Wochenraster - kein user_id, also keine eigene Spur. */
function overviewHolidaysOnDay(dateKey) {
  return overview.holidays.filter((holiday) => holiday.start_date <= dateKey && holiday.end_date >= dateKey);
}

function overviewLaneHeader(userId) {
  const person = overview.people.find((p) => Number(p.id) === Number(userId));
  const name = person?.display_name ?? userName(userId);
  const initials = (name ?? '').split(' ').map((w) => w[0] ?? '').join('').toUpperCase().slice(0, 2);
  const inner = person?.avatar_data ? `<img src="${esc(person.avatar_data)}" alt="${esc(name)}" loading="lazy">` : esc(initials);
  return `<div class="schedule-overview__lane-head"><span class="schedule-overview__lane-avatar" style="background-color:${esc(person?.avatar_color ?? 'var(--color-border)')}">${inner}</span><span class="schedule-overview__lane-name">${esc(name)}</span></div>`;
}

const OVERVIEW_HOUR_PX = 56;
const OVERVIEW_DEFAULT_HOURS = Array.from({ length: 14 }, (_, i) => i + 6); // 06:00-19:59 Rueckfall ohne bezeitete Eintraege

function overviewPad(n) { return String(n).padStart(2, '0'); }

function computeActiveHours(entries) {
  const active = new Set();
  for (const entry of entries) {
    const type = entry.shift_type;
    if (!type?.start_time || !type?.end_time) continue;
    const [startH] = type.start_time.split(':').map(Number);
    const [endH, endM] = type.end_time.split(':').map(Number);
    if (type.end_time <= type.start_time) {
      for (let h = startH; h < 24; h++) active.add(h);
      const endExclusive = endH + (endM > 0 ? 1 : 0);
      for (let h = 0; h < endExclusive; h++) active.add(h);
    } else {
      const endExclusive = endH + (endM > 0 ? 1 : 0);
      for (let h = startH; h < endExclusive; h++) active.add(h);
    }
  }
  if (!active.size) return OVERVIEW_DEFAULT_HOURS;
  return [...active].sort((a, b) => a - b);
}

function collapsedMinutes(minutesOfDay, activeHours) {
  let hour = Math.floor(minutesOfDay / 60);
  let minuteInHour = minutesOfDay % 60;
  if (hour >= 24) { hour = 23; minuteInHour = 60; }
  let idx = activeHours.indexOf(hour);
  if (idx === -1 && minuteInHour === 0) {
    idx = activeHours.indexOf(hour - 1);
    if (idx !== -1) minuteInHour = 60;
  }
  if (idx === -1) return null;
  return idx * 60 + minuteInHour;
}







// leeren Stunden dazwischen.
function overviewEntryBlock(entry, activeHours) {
  const type = entry.shift_type;
  const overlay = overlayMeta(entry);
  const label = type ? (type.short_code ? `${type.short_code} · ${type.name}` : type.name) : t('schedule.freeDay');

  // renderToday()'s Zeilen, derselbe zusammengesetzte Schluessel
  // (scheduleEntryMatchKey()) findet den Eintrag wieder unabhaengig davon, ob

  const detailAttrs = ` role="button" tabindex="0" data-action="view-schedule-entry" data-schedule-key="${esc(scheduleEntryMatchKey(entry))}" aria-label="${esc(scheduleOverviewEntryTitle(entry))}"`;
  if (!type?.start_time || !type?.end_time) {
    return `<div class="schedule-overview__block schedule-overview__block--allday" title="${esc(scheduleOverviewEntryTitle(entry))}"${detailAttrs}><span>${esc(overlay ? `${label} · ${overlay}` : label)}</span></div>`;
  }
  const [startH, startM] = type.start_time.split(':').map(Number);
  const [endH, endM] = type.end_time.split(':').map(Number);



  const startMin = entry.__continuation ? 0 : startH * 60 + startM;
  const endMin = entry.__continuation ? endH * 60 + endM : ((endH * 60 + endM) <= startMin ? 24 * 60 : endH * 60 + endM);
  const startCollapsed = collapsedMinutes(startMin, activeHours) ?? 0;
  const endCollapsed = collapsedMinutes(endMin, activeHours) ?? startCollapsed;
  const top = (startCollapsed / 60) * OVERVIEW_HOUR_PX;
  const height = Math.max(((endCollapsed - startCollapsed) / 60) * OVERVIEW_HOUR_PX, 18);




  const timeLine = entry.__continuation
    ? t('schedule.continuesUntil', { time: type.end_time })
    : overlay ? `${clockLabel(type)} · ${overlay}` : clockLabel(type);
  return `<div class="schedule-overview__block" style="top:${top}px;height:${height}px;--schedule-color:${esc(type.color)}" title="${esc(scheduleOverviewEntryTitle(entry))}"${detailAttrs}><span class="schedule-overview__block-title">${esc(label)}</span><small class="schedule-overview__block-time">${esc(timeLine)}</small></div>`;
}

function scheduleOverviewEntryTitle(entry) {
  const type = entry.shift_type;
  const base = type ? (type.short_code ? `${type.short_code} · ${type.name}` : type.name) : t('schedule.freeDay');
  const overlay = overlayMeta(entry);
  return overlay ? `${base} · ${overlay}` : base;
}

function renderOverview() {
  const picker = renderUserMultiSelect(overview.people, overview.selectedIds, 'overview-people', 'schedule.overviewPeopleLabel', 'schedule.overviewClearSelection');
  const weekDays = overviewVisibleDays();
  const weekLabel = overview.viewMode === 'day'
    ? formatDayMonth(weekDays[0])
    : `${formatDayMonth(weekDays[0])} – ${formatDayMonth(weekDays[weekDays.length - 1])}`;
  const viewToggle = `<div class="segmented" role="group" aria-label="${esc(t('calendar.viewWeek'))}/${esc(t('calendar.viewDay'))}">
    <button type="button" class="segmented__item${overview.viewMode === 'week' ? ' is-active' : ''}" data-action="overview-view-mode" data-mode="week" aria-pressed="${overview.viewMode === 'week' ? 'true' : 'false'}">${esc(t('calendar.viewWeek'))}</button>
    <button type="button" class="segmented__item${overview.viewMode === 'day' ? ' is-active' : ''}" data-action="overview-view-mode" data-mode="day" aria-pressed="${overview.viewMode === 'day' ? 'true' : 'false'}">${esc(t('calendar.viewDay'))}</button>
  </div>`;
  const header = `<div class="schedule-overview__toolbar">
    ${picker}
    <div class="schedule-overview__week-nav" role="group" aria-label="${esc(weekLabel)}">
      ${viewToggle}
      <button type="button" class="btn btn--icon" data-action="overview-week" data-direction="prev" aria-label="${esc(t('calendar.back'))}"><i data-lucide="chevron-left" aria-hidden="true"></i></button>
      <button type="button" class="btn btn--secondary" data-action="overview-week" data-direction="today">${esc(t('calendar.today'))}</button>
      <button type="button" class="btn btn--icon" data-action="overview-week" data-direction="next" aria-label="${esc(t('calendar.forward'))}"><i data-lucide="chevron-right" aria-hidden="true"></i></button>
      <span class="schedule-overview__week-label">${esc(weekLabel)}</span>
    </div>
  </div>`;





  if (overview.loading) {
    return `<section class="schedule-overview">${header}<div class="card card--padded schedule-stat-loading" role="status" aria-live="polite">${esc(t('common.loading'))}</div></section>`;
  }
  if (overview.error) {
    return `<section class="schedule-overview">${header}${emptyStateHTML({ variant: 'error', title: t('common.errorGeneric'), description: t('common.loadErrorDescription'), action: { label: t('common.retry'), icon: 'refresh-cw', attrs: { 'data-action': 'retry-overview' } } })}</section>`;
  }

  if (!overview.selectedIds.length) {
    return `<section class="schedule-overview">${header}${emptyStateHTML({ title: t('schedule.overviewEmptyTitle'), description: t('schedule.overviewEmptyDescription') })}</section>`;
  }

  const lanesByDay = buildOverviewLanes(weekDays, overview.selectedIds, overview.entries);
  const laneCount = overview.selectedIds.length;

  // verdichtete Skala bestimmen - overview.entries traegt immer die ganze


  // sichtbarer Tag (Tagesansicht) soll aber keine Stunde mehr "aktiv" halten,

  const visibleDateKeys = new Set(weekDays);
  const selectedEntries = overview.entries.filter((entry) => overview.selectedIds.includes(entry.user_id) && touchesVisibleDay(entry, visibleDateKeys));
  const activeHours = computeActiveHours(selectedEntries);
  const gridHeight = activeHours.length * OVERVIEW_HOUR_PX;
  const hourLines = activeHours.map((_, i) => `<div class="schedule-overview__hour-line" style="top:${i * OVERVIEW_HOUR_PX}px"></div>`).join('');





  const gutterHours = activeHours.map((h, i) => `<div class="schedule-overview__hour-label" style="top:${i * OVERVIEW_HOUR_PX}px">${overviewPad(h)}:00</div>`).join('');
  const gutter = `<div class="schedule-overview__day schedule-overview__gutter">
    <div class="schedule-overview__day-head">&nbsp;</div>
    <div class="schedule-overview__holidays"></div>
    <div class="schedule-overview__lanes" style="grid-template-columns:1fr">
      <div class="schedule-overview__lane">
        <div class="schedule-overview__lane-head">&nbsp;</div>
        <div class="schedule-overview__lane-body" style="height:${gridHeight}px">${gutterHours}</div>
      </div>
    </div>
  </div>`;

  const days = lanesByDay.map(({ dateKey, lanes }) => {
    const holidays = overviewHolidaysOnDay(dateKey);
    const holidayHtml = holidays.map((h) => `<div class="schedule-overview__holiday" style="--holi-color:${esc(h.color)}" title="${esc(h.name)}"><span>${esc(h.name)}</span></div>`).join('');
    const laneHtml = lanes.map((lane) => `<div class="schedule-overview__lane" data-user="${lane.userId}">
      ${overviewLaneHeader(lane.userId)}
      <div class="schedule-overview__lane-body" style="height:${gridHeight}px">${hourLines}${lane.entries.map((entry) => overviewEntryBlock(entry, activeHours)).join('')}</div>
    </div>`).join('');
    return `<div class="schedule-overview__day" data-date="${dateKey}">
      <div class="schedule-overview__day-head">${esc(t(`calendar.dayShort${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][parseLocalDateKey(dateKey).getDay()]}`))} ${esc(formatDayMonth(dateKey))}</div>
      <div class="schedule-overview__holidays">${holidayHtml}</div>
      <div class="schedule-overview__lanes" style="grid-template-columns:repeat(${laneCount},minmax(220px,1fr))">${laneHtml}</div>
    </div>`;
  }).join('');

  return `<section class="schedule-overview">${header}<div class="schedule-overview__scroll"><div class="schedule-overview__grid">${gutter}${days}</div></div></section>`;
}

function renderScheduleWarnings() {
  if (!state.warnings.length) return '';
  return '<div class="schedule-warnings" role="status">' + state.warnings.map((warning) => '<p>' + esc(t('schedule.overlapWarning', { date: formatDate(warning.date_key), user: userName(warning.user_id) })) + '</p>').join('') + '</div>';
}

// S-03: markiert die umschliessende Musterkarte (`[data-pattern]`, siehe


// `pattern-update`-Formular ab, beide leben im selben `<details
// data-pattern>`. Kein Effekt ausserhalb einer Musterkarte (z.B. Override-/
// Extra-Zeilen, "Meine Einstellungen") - deren Aenderungen schreiben ohnehin

// Dirty-Guard.
function markPatternDirty(target) {
  const details = target?.closest?.('[data-pattern]');
  if (details?.dataset?.pattern) dirtyPatternIds.add(details.dataset.pattern);
}






// `.schedule-body` bleibt unveraendert (kein renderPage() gelaufen), die
// Eingabe steht also unveraendert im DOM.
async function guardedActivateView(id) {
  if (activeView === 'patterns' && dirtyPatternIds.size) {
    const confirmed = await confirmModal(
      t('modal.unsavedChanges'),
      { danger: true, confirmLabel: t('modal.discardChanges'), detail: t('schedule.discardCycleDayEditsDetail') },
    );
    if (!confirmed) {
      scheduleTablist?.sync(activeView);
      return;
    }
    dirtyPatternIds.clear();
  }

  // Verlaufseintrag an. Da /schedule/<tab> bereits als eigene Route



  window.aashiyana?.navigate(scheduleRouteForView(id));
}

/**
 * Builds the toolbar and tab rail ONCE. `renderPage()` below only touches
 * `.schedule-body` on a tab switch, so a FAB the router docks into
 * `.page-toolbar__actions` survives every subsequent tab change instead of
 * being destroyed along with a full-page reset.
 */
function renderShell() {
  const tabs = [
    ['shifts', t('schedule.shiftTypes')],
    ['patterns', t('schedule.planning')],
    ['statistics', t('schedule.statistics')],
    ['overview', t('schedule.overview')],
  ];
  root.replaceChildren();
  root.insertAdjacentHTML('beforeend', `<div class="schedule-page app-page app-page--full" data-composition="full">
    <header class="page-toolbar schedule-toolbar">
      <h1 class="page-toolbar__title">${esc(t('schedule.title'))}</h1>
      <div class="page-toolbar__actions"></div>
      <div class="sub-tabs-bar schedule-tabs page-toolbar__bar" role="tablist" aria-label="${esc(t('schedule.title'))}">
        ${tabs.map(([id, label]) => `<button class="sub-tab${id === activeView ? ' sub-tab--active' : ''}" id="schedule-tab-${id}" type="button" role="tab" data-tab-id="${id}" aria-controls="schedule-body" aria-selected="${id === activeView ? 'true' : 'false'}" tabindex="${id === activeView ? '0' : '-1'}">${esc(label)}</button>`).join('')}
      </div>
    </header>
    <div class="schedule-body" id="schedule-body" role="tabpanel" tabindex="0"></div>
  </div>`);
  // Geteilte Tablist-Verhaltensschicht (Klick + Pfeiltasten/Home/End + Roving-

  // Tastatursteuerung - dieselbe Grammatik wie Budget/Kalender/Rewards/
  // Haushaltshilfe fuer ihre jeweilige Haupt-Tab-Leiste. wireTablist() malt den


  // hier waere seither doppelt verdrahtet.


  // ungespeicherten Zyklustage-Aenderungen die S-03-Nachfrage ausloesen -




  scheduleTablist = wireTablist(root.querySelector('.schedule-tabs'), {
    activeId: activeView,
    manualActivation: true,
    onChange: (id) => { guardedActivateView(id); },
  });
  root.addEventListener('submit', submitForm);
  root.addEventListener('click', (event) => {

    // Sicht (der Zyklustage-Editor darunter verschwindet) - derselbe Verlust




    // (nichts geht dabei verloren) bleibt unangetastet.
    const summary = event.target.closest('summary');
    const details = summary?.closest('[data-pattern]');
    if (details?.open && dirtyPatternIds.has(details.dataset.pattern)) {
      event.preventDefault();
      confirmModal(
        t('modal.unsavedChanges'),
        { danger: true, confirmLabel: t('modal.discardChanges'), detail: t('schedule.discardCycleDayEditsDetail') },
      ).then((confirmed) => {
        if (!confirmed) return;
        dirtyPatternIds.delete(details.dataset.pattern);
        details.open = false;
      });
      return;
    }
    const actionButton = event.target.closest('[data-action]');
    if (actionButton) action({ currentTarget: actionButton });
  });
  // S-03: jede Eingabe im Zyklustage-Editor/inline Pattern-Formular markiert
  // ihre Musterkarte als dirty - 'input' fuer Texteingaben (Name,

  // zusaetzlich fuer <select>/<input type=date> (Zyklustag-Auswahl,

  root.addEventListener('input', (event) => {
    if (activeView === 'patterns') markPatternDirty(event.target);
    if (activeView === 'patterns') updateCycleDayHeadersFor(event.target);
  });
  root.addEventListener('change', async (event) => {
    if (activeView === 'patterns') markPatternDirty(event.target);
    if (activeView === 'patterns') updateCycleDayHeadersFor(event.target);
    if (event.target.id === 'schedule-reminder-toggle') {
      const offsetSelect = root.querySelector('#schedule-reminder-offset');



      if (offsetSelect) offsetSelect.disabled = !event.target.checked;
      const offset = event.target.checked ? Number(offsetSelect?.value ?? 15) : null;
      savePreference({ reminderOffsetMinutes: offset });
    } else if (event.target.id === 'schedule-reminder-offset') {
      // S-23: "Custom..." selbst speichert nichts - erst promptModal() liefert

      // pickCustomReminderOffset().
      if (event.target.value === 'custom') {
        await pickCustomReminderOffset(event.target, (minutes) => savePreference({ reminderOffsetMinutes: minutes }));
      } else {
        event.target.dataset.previousValue = event.target.value;
        savePreference({ reminderOffsetMinutes: Number(event.target.value) });
      }
    } else if (event.target.id === 'schedule-weekly-hours') {
      const hours = Math.min(168, Math.max(1, Math.round(Number(event.target.value) || DEFAULT_WEEKLY_HOURS)));
      savePreference({ weeklyHours: hours });
    } else if (event.target.id === 'schedule-overtime-toggle') {



      const hoursInput = root.querySelector('#schedule-weekly-hours');
      if (hoursInput) hoursInput.disabled = !event.target.checked;
      savePreference({ overtimeEnabled: event.target.checked });
    } else if (event.target.closest('[data-ms-input="overview-people"]')) {

      // (siehe Kommentar an overview weiter oben).
      overview = { ...overview, selectedIds: getSelectedUserIds(root, 'overview-people') };
      saveOverviewSelection(overview.selectedIds);
      renderPage();
    } else if (event.target.matches('[data-day]')) {


      // getippten Werte anderer Zeilen anzufassen. Werte fuer Felder, die am


      const row = event.target.closest('[data-day-row]');
      const existing = row?.querySelector('[data-day-row-fields]');
      const html = dayRowFieldsHtml(event.target.value);
      if (existing) {
        existing.insertAdjacentHTML('afterend', html);
        existing.remove();
      } else if (html) row.insertAdjacentHTML('beforeend', html);
      window.lucide?.createIcons({ el: row });
    }
  });

  // Heute-Zeilen/Uebersicht-Bloecke (Enter/Space) - dasselbe Muster wie
  // calendar.js' Agenda-Ansicht fuer ihre eigenen role="button"-Zeilen.
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target.closest('[data-action="view-schedule-entry"]');
    if (!target) return;
    event.preventDefault();
    action({ currentTarget: target });
  });
}

function updateCycleDayHeadersFor(target) {
  const name = target?.name || target?.getAttribute?.('name');
  if (name !== 'anchor_date' && name !== 'cycle_length') return;
  const details = target.closest('[data-pattern]');
  const form = details?.querySelector('[data-form="pattern-update"]');
  if (!form) return;
  const anchor = formValue(form, 'anchor_date');
  const cycleLength = Number(formValue(form, 'cycle_length'));
  const validFrom = formValue(form, 'valid_from') || null;
  const validUntil = formValue(form, 'valid_until') || null;
  if (!anchor || !cycleLength) return;
  details.querySelectorAll('[data-day-group]').forEach((group) => {
    const position = Number(group.dataset.dayGroup) + 1;
    const label = group.querySelector('[data-day-group-label]');
    if (label) label.textContent = cycleDayHeaderLabel(anchor, cycleLength, validFrom, validUntil, position);
  });
}

function renderPage() {
  // Rebuilding .schedule-body below can destroy whatever currently holds
  // focus (e.g. the weekly-hours input right after the user typed into it) -
  // losing focus resets it to <body>, and the browser scrolls the page's
  // real scrollport (#main-content, see router.js) back to the top to show
  // it. Statistics is the one tab with persistent on-page form controls that
  // trigger a render while focused, so it's the one tab where this was
  // visible; restoring the scroll position afterward papers over it for
  // every tab uniformly rather than special-casing statistics.
  const scrollPort = document.getElementById('main-content');
  const scrollTop = scrollPort?.scrollTop ?? 0;
  // Repaint statt Neubau: wireTablist() haelt Klasse/aria-selected/tabindex der
  // schon bestehenden Knoepfe selbst nach (sync() loest dabei bewusst KEIN


  // Uebersicht-Tab).
  scheduleTablist?.sync(activeView);
  const locked = readOnly();
  const panel = activeView === 'shifts'



    ? '<section class="schedule-library schedule-library--shifts"><div class="schedule-library__head"><h2 class="u-section-title">' + esc(t('schedule.shiftTypes')) + '</h2>'
      + (locked ? '' : (state.types.length && visibleQuickstartTemplates().length ? '<div class="segmented" role="group" aria-label="' + esc(t('schedule.quickStartShiftTypes')) + '">'
        + visibleQuickstartTemplates().map(([template, key]) => '<button type="button" class="segmented__item" data-action="quick-start-shifts" data-template="' + template + '">' + esc(t(key)) + '</button>').join('')
        + '</div>' : '')) + '</div>'
      + (state.types.length ? state.types.map(shiftTypeCard).join('') : emptyShiftTypesState()) + '</section>'
      + customFieldsSection()
    : activeView === 'patterns'
      ? '<section class="schedule-library schedule-library--patterns"><h2 class="u-section-title">' + esc(t('schedule.patterns')) + '</h2>' + (state.patterns.length ? state.patterns.map(patternCard).join('') : emptyPatternState()) + '</section>'
        + '<section class="schedule-library schedule-library--overrides"><div class="schedule-library__head"><h2 class="u-section-title">' + esc(t('schedule.overrides')) + '</h2>' + (locked ? '' : '<button type="button" class="btn btn--secondary" data-action="open-create-override"><i data-lucide="plus" aria-hidden="true"></i>' + esc(t('schedule.createOverride')) + '</button>') + '</div>' + overrideRows() + '</section>'
        + '<section class="schedule-library schedule-library--extras"><div class="schedule-library__head"><h2 class="u-section-title">' + esc(t('schedule.extraShifts')) + '</h2>' + (locked ? '' : '<button type="button" class="btn btn--secondary" data-action="open-create-extra"><i data-lucide="plus" aria-hidden="true"></i>' + esc(t('schedule.addExtraShift')) + '</button>') + '</div>' + extraRows() + '</section>'
      : activeView === 'overview'
        ? renderOverview()
        : renderStatistics();
  const body = root.querySelector('.schedule-body');
  body.replaceChildren();

  // sah sonst ZWEI Leerzustaende uebereinander („Noch keine Schichteintraege."

  // Onboarding-Anleitung des Panels stand erst an zweiter Stelle
  // (Critique 2026-08-27, P2). Die Uebersicht zeigt bereits mehrere Personen
  // ueber eine ganze Woche - dieselbe "Heute"-Karte daneben waere redundant,

  const inUse = state.types.length || state.patterns.length
    || state.overrides.length || state.entries.length;
  body.insertAdjacentHTML('beforeend',
    (activeView === 'statistics' || activeView === 'overview' || !inUse ? '' : '<section class="card card--padded schedule-today"><h2 class="u-section-title">' + esc(t('schedule.today')) + '</h2>' + renderToday() + renderScheduleWarnings() + '</section>')
    + `<div class="schedule-content">${panel}</div>`);
  updateScheduleFab();
  window.lucide?.createIcons({ el: body });
  wireShiftTypeFieldSortables(body);
  if (activeView === 'overview') {
    bindUserMultiSelect(body, 'overview-people');
    wireScrollFade(body.querySelector('.schedule-overview__scroll'));
  }
  if (scrollPort) scrollPort.scrollTop = scrollTop;
}


// in shiftTypeFieldRow() bedienen dieselbe lokale Umsortierung tastaturbasiert.


// Speichern-Klick etwas - keine Instanz-Nachverfolgung noetig, `renderPage()`

function wireShiftTypeFieldSortables(body) {
  body.querySelectorAll('[data-type-fields-rows]').forEach((listEl) => {
    makeSortable(listEl, { handle: '.schedule-type-field-row__handle', onEnd: () => {} }).catch(() => {});
  });
}
function updateScheduleFab() {
  if (!scheduleFab) return;
  // Sichtbares Dock-Label = aria-label: beide nennen die AKTION ("Add entry",



  const labels = {
    shifts: t('schedule.createShiftType'),
    patterns: t('schedule.addEntry'),
  };
  setPageFabAction(scheduleFab, {
    label: labels[activeView],
    dockLabel: labels[activeView],


    // action()) - der Handler bleibt trotzdem gesperrt.
    hidden: readOnly() || activeView === 'statistics' || activeView === 'overview',
    onClick: () => openScheduleCreateModal(activeView),
  });
}

function openOverrideEditModal(group) {
  const type = state.types.find((item) => Number(item.id) === Number(group.shift_type_id));
  const content = '<form id="schedule-create-form" class="form-stack schedule-modal-form" data-form="override-edit">'
    + '<input type="hidden" name="user_id" value="' + esc(String(group.user_id)) + '">'
    + '<input type="hidden" name="original_from" value="' + esc(group.from) + '">'
    + '<input type="hidden" name="original_to" value="' + esc(group.to) + '">'
    + formField(t('schedule.owner'), '<input class="input" readonly value="' + esc(userName(group.user_id)) + '">')
    + formField(t('schedule.rangeFrom'), '<aashiyana-datepicker required name="from" type="date" label="' + esc(t('schedule.rangeFrom')) + '" value="' + esc(group.from) + '"></aashiyana-datepicker>')
    + formField(t('schedule.rangeTo'), '<aashiyana-datepicker required name="to" type="date" label="' + esc(t('schedule.rangeTo')) + '" value="' + esc(group.to) + '"></aashiyana-datepicker>')
    + formField(t('schedule.shiftType'), '<select class="input" name="shift_type_id">' + typeOptions(type?.id ?? null) + '</select>')
    + formField(t('schedule.note'), '<input class="input" name="note" maxlength="5000" value="' + esc(group.note ?? '') + '">')
    + dayRowFieldsHtml(type?.id ?? null, group.field_values)
    + '<div class="modal-actions"><button type="submit" class="btn btn--primary">' + esc(t('schedule.save')) + '</button></div></form>';
  openModal({
    title: t('schedule.editOverride'),
    size: 'md',
    content,
    onSave: (modal) => {
      const form = modal.querySelector('#schedule-create-form');
      wireOccurrenceFieldReactivity(form);
      form?.addEventListener('submit', saveCreatedSchedule);
    },
  });
}







// erste - das gemeinsame Anlege-Formular (openScheduleCreateModal) traegt
// zwei davon (Ersetzen/Hinzufuegen, je ein eigenes <fieldset>, per

// auf sein EIGENES Fieldset begrenzten Feld-Unterblock.
function wireOccurrenceFieldReactivity(scope) {
  scope?.querySelectorAll('[name="shift_type_id"]').forEach((select) => {
    select.addEventListener('change', () => {
      const container = select.closest('fieldset') ?? select.closest('form');
      const existing = container?.querySelector('[data-day-row-fields]');
      const html = dayRowFieldsHtml(select.value);
      if (existing) {
        existing.insertAdjacentHTML('afterend', html);
        existing.remove();
      } else if (html) select.closest('.form-field')?.insertAdjacentHTML('afterend', html);
      window.lucide?.createIcons({ el: container });
    });
  });
}

function openExtraGroupEditModal(group) {
  const content = '<form id="schedule-create-form" class="form-stack schedule-modal-form" data-form="extra-edit-range">'
    + '<input type="hidden" name="ids" value="' + esc(group.ids.join(',')) + '">'
    + '<input type="hidden" name="user_id" value="' + esc(String(group.user_id)) + '">'
    + formField(t('schedule.owner'), '<input class="input" readonly value="' + esc(userName(group.user_id)) + '">')
    + formField(t('schedule.rangeFrom'), '<aashiyana-datepicker required name="from" type="date" label="' + esc(t('schedule.rangeFrom')) + '" value="' + esc(group.from) + '"></aashiyana-datepicker>')
    + formField(t('schedule.rangeTo'), '<aashiyana-datepicker required name="to" type="date" label="' + esc(t('schedule.rangeTo')) + '" value="' + esc(group.to) + '"></aashiyana-datepicker>')
    + formField(t('schedule.shiftType'), '<select class="input" required name="shift_type_id">' + typeOptions(group.shift_type_id, false) + '</select>')
    + formField(t('schedule.note'), '<input class="input" name="note" maxlength="5000" value="' + esc(group.note ?? '') + '">')
    + reminderOffsetField(group.reminder_offset_minutes)
    + dayRowFieldsHtml(group.shift_type_id, group.field_values)
    + '<div class="modal-actions"><button type="submit" class="btn btn--primary">' + esc(t('schedule.save')) + '</button></div></form>';
  openModal({
    title: t('schedule.editExtraShift'),
    size: 'md',
    content,
    onSave: (modal) => {
      const form = modal.querySelector('#schedule-create-form');
      form?.querySelector('[name="reminder_enabled"]')?.addEventListener('change', (event) => {
        form.querySelector('[name="reminder_offset_minutes"]').disabled = !event.currentTarget.checked;
      });
      wireOccurrenceFieldReactivity(form);
      form?.addEventListener('submit', saveCreatedSchedule);
    },
  });
}

function openScheduleCreateModal(view, { mode = 'pattern' } = {}) {
  let title;
  let content;
  if (view === 'shifts') {
    title = t('schedule.createShiftType');
    content = '<form id="schedule-create-form" class="form-stack schedule-modal-form" data-form="shift-create">'
      + formField(t('schedule.preset'), '<select class="input" name="shift_preset">' + shiftPresetOptions() + '</select>')
      + shiftFields()
      + '<div class="modal-actions"><button type="submit" class="btn btn--primary">' + esc(t('common.create')) + '</button></div></form>';
  } else if (view === 'patterns') {





    // dreiteiliger Umschalter (.segmented, wie schedule-stat-range__choices)







    title = t('schedule.addEntry');
    const modes = [['pattern', 'schedule.pattern'], ['replace', 'schedule.override'], ['add', 'schedule.extraBadgeLabel']];
    content = '<form id="schedule-create-form" class="form-stack schedule-modal-form" data-form="pattern-create">'
      + formField(t('schedule.owner'), '<select class="input" required name="user_id">' + userOptions(selectedOwner()) + '</select>')
      // data-dirty-ignore (S-14): merely switching the segmented Pattern/
      // Override/Extra control rewrites this hidden value - without the
      // opt-out, modal.js's dirty guard read that as a real change and
      // prompted "Discard changes?" on Escape even though nothing was typed.
      + '<input type="hidden" name="mode" value="' + esc(mode) + '" data-dirty-ignore>'


      // Wiederholung. `aria-label` traegt den Kontext weiterhin fuer

      + '<div class="segmented schedule-create-mode" role="group" aria-label="' + esc(t('schedule.addEntry')) + '">'
      + modes.map(([value, key]) => '<button type="button" class="segmented__item' + (mode === value ? ' is-active' : '') + '" data-mode="' + value + '" aria-pressed="' + (mode === value ? 'true' : 'false') + '">' + esc(t(key)) + '</button>').join('')
      + '</div>'
      + '<fieldset data-field="mode-pattern"' + (mode === 'pattern' ? '' : ' hidden disabled') + '>' + patternFields() + '</fieldset>'



      // Redundanz. saveCreatedSchedule() entscheidet an einer Stelle


      // sich am Verhalten nichts.
      + '<fieldset data-field="one-time-shared"' + (mode === 'pattern' ? ' hidden disabled' : '') + '>'
      + formField(t('schedule.rangeFrom'), '<aashiyana-datepicker name="range_from" type="date" label="' + esc(t('schedule.rangeFrom')) + '" value="' + esc(todayKey()) + '"></aashiyana-datepicker>')
      + formField(t('schedule.rangeTo'), '<aashiyana-datepicker name="range_to" type="date" label="' + esc(t('schedule.rangeTo')) + '" value="' + esc(todayKey()) + '"></aashiyana-datepicker>')
      + formField(t('schedule.note'), '<input class="input" name="note" maxlength="5000">')
      + '</fieldset>'


      // (schedule_extra_shifts.shift_type_id ist NOT NULL) - deshalb traegt

      + '<fieldset data-field="mode-replace"' + (mode === 'replace' ? '' : ' hidden disabled') + '>' + formField(t('schedule.shiftType'), '<select class="input" name="shift_type_id">' + typeOptions(null) + '</select>') + '</fieldset>'
      // Anders als "Ersetzen" (dessen freier Tag defaultet, also nie eigene

      // explizit markierte Auswahl (typeOptions(null, false)) schon selbst den



      // wireOccurrenceFieldReactivity() ihn bisher nachzog). Dieselbe

      // Feld-Unterblock.






      // Speichern-Knopf bleibt fuer diesen Modus zusaetzlich gesperrt

      // Absenden ohne Typ.
      + '<fieldset data-field="mode-add"' + (mode === 'add' ? '' : ' hidden disabled') + '>' + (state.types.length
        ? formField(t('schedule.shiftType'), '<select class="input" required name="shift_type_id">' + typeOptions(null, false) + '</select>')
        : '<p class="form-hint schedule-no-types-hint">' + esc(t('schedule.noShiftTypesHint')) + '</p>')
      + reminderOffsetField(null) + dayRowFieldsHtml(state.types[0]?.id ?? null) + '</fieldset>'
      + '<div class="modal-actions"><button type="submit" class="btn btn--primary" data-role="save-entry">' + esc(t('schedule.save')) + '</button></div></form>';
  }
  openModal({
    title,
    size: 'md',
    content,
    onSave: (modal) => {
      const form = modal.querySelector('#schedule-create-form');
      form?.querySelector('[name="shift_preset"]')?.addEventListener('change', () => applyShiftPreset(form));



      form?.querySelector('[data-action="pick-shift-icon"]')?.addEventListener('click', (event) => pickShiftIcon(event.currentTarget));
      // Ein dreiteiliger Umschalter statt zweier verschachtelter Kippschalter:


      // siehe Kommentar oben an der Formularerzeugung.



      // zeigt. Jeder andere Modus/Zustand bleibt unberuehrt.
      const updateAddModeAvailability = () => {
        const saveButton = form.querySelector('[data-role="save-entry"]');
        if (!saveButton) return;
        const currentMode = form.querySelector('[name="mode"]')?.value;
        saveButton.disabled = currentMode === 'add' && !state.types.length;
      };
      form?.querySelectorAll('[data-mode]').forEach((button) => {
        button.addEventListener('click', () => {
          const mode = button.dataset.mode;
          form.querySelector('[name="mode"]').value = mode;
          form.querySelectorAll('[data-mode]').forEach((item) => {
            const active = item.dataset.mode === mode;
            item.classList.toggle('is-active', active);
            item.setAttribute('aria-pressed', String(active));
          });
          const setGroup = (field, enabled) => {
            const fieldset = form.querySelector('[data-field="' + field + '"]');
            fieldset.hidden = !enabled;
            fieldset.disabled = !enabled;
          };
          setGroup('mode-pattern', mode === 'pattern');
          setGroup('one-time-shared', mode !== 'pattern');
          setGroup('mode-replace', mode === 'replace');
          setGroup('mode-add', mode === 'add');
          updateAddModeAvailability();
        });
      });
      updateAddModeAvailability();
      form?.querySelector('[name="reminder_enabled"]')?.addEventListener('change', (event) => {
        form.querySelector('[name="reminder_offset_minutes"]').disabled = !event.currentTarget.checked;
      });
      wireOccurrenceFieldReactivity(form);
      form?.addEventListener('submit', saveCreatedSchedule);
    },
  });
}

// `[data-field-value]`-Eingaben tragen bewusst kein `name` - ihr Schluessel






function collectFieldValues(scope) {
  const values = {};
  scope?.querySelectorAll('[data-field-value]').forEach((input) => {
    if (input.value.trim()) values[input.dataset.fieldValue] = input.value.trim();
  });
  return values;
}

async function saveCreatedSchedule(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = formData(form);
  try {
    if (form.dataset.form === 'shift-create') await api.post('/schedule/shift-types', data);
    if (form.dataset.form === 'pattern-create') {
      if (data.mode === 'pattern') {
        data.user_id = Number(data.user_id);
        data.cycle_length = Number(data.cycle_length);
        data.is_active = form.elements.is_active.checked;


        // selbst (server-seitig gewinnt "valid_from DESC, id DESC" - siehe


        // nichts ueberschreiben, deshalb kein Check in diesem Zweig.
        if (data.is_active) {
          const overlap = findOverlappingActivePattern(state.patterns, data.user_id, data.valid_from || null, data.valid_until || null);
          if (overlap) {



            //






            // saveCreatedSchedule() schliesst stattdessen.
            const confirmed = await confirmOverModal(
              t('schedule.patternOverlapConfirmTitle', { user: userName(data.user_id) }),
              { confirmLabel: t('schedule.patternOverlapConfirmAction'), detail: t('schedule.patternOverlapConfirmDetail', { name: overlap.name }), closeOnConfirm: false },
            );
            if (!confirmed) return;
          }
        }
        await api.post('/schedule/patterns', data);
      } else if (data.mode === 'replace') {
        const userId = Number(data.user_id);
        const shiftTypeId = data.shift_type_id ? Number(data.shift_type_id) : null;
        const fieldValues = collectFieldValues(form.querySelector('[data-field="mode-replace"]'));



        // fuer den (haeufigeren) Einzeltag-Fall unveraendert.
        if (data.range_from === data.range_to) {
          await api.put('/schedule/overrides/' + encodeURIComponent(data.range_from), { user_id: userId, shift_type_id: shiftTypeId, note: data.note, field_values: fieldValues });
        } else {
          const type = state.types.find((item) => Number(item.id) === shiftTypeId);
          const typeLabel = type ? (type.short_code ? `${type.short_code} · ${type.name}` : type.name) : t('schedule.freeDay');
          // confirmOverModal statt confirmModal: dieser Aufruf laeuft WAEHREND



          // Grund ueberhaupt nachzufragen, vernichtete damit lautlos jedes


          //





          // Ende von saveCreatedSchedule() schliesst stattdessen.
          const confirmed = await confirmOverModal(
            t('schedule.fillRangeConfirmTitle'),
            { confirmLabel: t('schedule.fillRange'), detail: t('schedule.fillRangeConfirmDetail', { from: formatDate(data.range_from), to: formatDate(data.range_to), type: typeLabel }), closeOnConfirm: false },
          );
          if (!confirmed) return;
          await api.post('/schedule/overrides/fill', { user_id: userId, from: data.range_from, to: data.range_to, shift_type_id: shiftTypeId, note: data.note, field_values: fieldValues });
        }
      } else {
        const payload = {
          user_id: Number(data.user_id),
          shift_type_id: Number(data.shift_type_id),
          note: data.note,
          reminder_offset_minutes: form.elements.reminder_enabled.checked ? Number(data.reminder_offset_minutes) : null,
          field_values: collectFieldValues(form.querySelector('[data-field="mode-add"]')),
        };
        if (data.range_from === data.range_to) {
          await api.post('/schedule/extras', { ...payload, date_key: data.range_from });
        } else {
          await api.post('/schedule/extras/fill', { ...payload, from: data.range_from, to: data.range_to });
        }
      }
    }
    if (form.dataset.form === 'override-edit') {
      const userId = Number(data.user_id);
      const shiftTypeId = data.shift_type_id ? Number(data.shift_type_id) : null;
      const type = state.types.find((item) => Number(item.id) === shiftTypeId);
      const typeLabel = type ? (type.short_code ? `${type.short_code} · ${type.name}` : type.name) : t('schedule.freeDay');
      const fieldValues = collectFieldValues(form);






      const confirmed = await confirmOverModal(
        t('schedule.fillRangeConfirmTitle'),
        { confirmLabel: t('schedule.save'), detail: t('schedule.fillRangeConfirmDetail', { from: formatDate(data.from), to: formatDate(data.to), type: typeLabel }), closeOnConfirm: false },
      );
      if (!confirmed) return;
      await api.post('/schedule/overrides/fill', { user_id: userId, from: data.from, to: data.to, shift_type_id: shiftTypeId, note: data.note, field_values: fieldValues });



      const leftovers = rangeDifference(data.original_from, data.original_to, data.from, data.to);
      for (const span of leftovers) {
        await api.delete(`/schedule/overrides?user_id=${userId}&from=${span.from}&to=${span.to}`);
      }
    }
    if (form.dataset.form === 'extra-edit-range') {
      const payload = {
        user_id: Number(data.user_id),
        shift_type_id: Number(data.shift_type_id),
        note: data.note,
        reminder_offset_minutes: form.elements.reminder_enabled.checked ? Number(data.reminder_offset_minutes) : null,
        field_values: collectFieldValues(form),
      };

      // fuer den (moeglicherweise verschobenen/veraenderten) Zeitraum anlegen,


      // Datenverlust.
      if (data.from === data.to) {
        await api.post('/schedule/extras', { ...payload, date_key: data.from });
      } else {
        await api.post('/schedule/extras/fill', { ...payload, from: data.from, to: data.to });
      }
      for (const id of data.ids.split(',')) {
        await api.delete(`/schedule/extras/${id}`);
      }
    }
    await load();






    dirtyPatternIds.clear();
    renderPage();
    await closeModal({ force: true });
    window.aashiyana?.showToast(t('schedule.saved'), 'success');
  } catch (error) {
    window.aashiyana?.showToast(scheduleErrorMessage(error), 'danger');
  }
}




// schon grosse Funktion weiter aufgeblaeht.
function openCustomFieldModal(field = null) {
  const isEdit = Boolean(field);
  openModal({
    title: isEdit ? t('schedule.editCustomField') : t('schedule.createCustomField'),
    size: 'sm',
    content: '<form id="schedule-custom-field-form" class="form-stack schedule-modal-form">'
      + formField(t('schedule.fieldName'), '<input class="input" required name="name" maxlength="100" value="' + esc(field?.name ?? '') + '">')
      + '<div class="modal-actions"><button type="submit" class="btn btn--primary">' + esc(t('schedule.save')) + '</button></div></form>',
    onSave: (modal) => {
      modal.querySelector('#schedule-custom-field-form')?.addEventListener('submit', (event) => saveCustomField(event, field?.id ?? null));
    },
  });
}

async function saveCustomField(event, fieldId) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  try {
    if (fieldId) await api.put(`/schedule/custom-fields/${fieldId}`, data);
    else await api.post('/schedule/custom-fields', data);
    await load();






    dirtyPatternIds.clear();
    renderPage();
    await closeModal({ force: true });
    window.aashiyana?.showToast(t('schedule.saved'), 'success');
  } catch (error) {
    window.aashiyana?.showToast(scheduleErrorMessage(error), 'danger');
  }
}

function formData(form) {
  return Object.fromEntries(new FormData(form));
}

function formValue(form, name, fallback = '') {
  return form.elements?.namedItem(name)?.value || form.querySelector('[name="' + name + '"]')?.value || fallback;
}

async function submitForm(event) {
  event.preventDefault();
  const form = event.target;
  const data = formData(form);



  // unten denselben Wert lesen kann.
  let statisticsRequest = null;
  try {
    if (form.dataset.form === 'statistics') {
      statisticsRequest = ++statisticsRequestId;
      statistics = {
        ...statistics,
        userId: Number(formValue(form, 'user_id', data.user_id)),
        monthFrom: formValue(form, 'month_from', data.month_from || statistics.monthFrom).slice(0, 7),
        monthTo: formValue(form, 'month_to', data.month_to || statistics.monthTo).slice(0, 7),
        from: formValue(form, 'from', data.from || statistics.from),
        to: formValue(form, 'to', data.to || statistics.to),
        entries: [],
        bounds: null,
        loading: true,
        error: false,
      };
      renderPage();
      await refreshStatistics();


      // dieses.
      if (statisticsRequest === statisticsRequestId) renderPage();
      return;
    }
    // Keine Zweige fuer 'shift-create'/'pattern-create'/'override-create' hier:






    let gefragt = false;
    if (form.dataset.form === 'shift-update') await api.put(`/schedule/shift-types/${form.dataset.id}`, data);
    if (form.dataset.form === 'pattern-update') {
      data.cycle_length = Number(data.cycle_length);
      data.is_active = form.elements.is_active.checked;


      // der Server ohnehin durchsetzt (siehe patternDaysExceedingCycleLength()).



      const pattern = state.patterns.find((item) => Number(item.id) === Number(form.dataset.id));
      const conflict = patternDaysExceedingCycleLength(pattern?.days, data.cycle_length);
      if (conflict) {
        reportFieldError(form.querySelector('[name="cycle_length"]'), t('schedule.cycleLengthTooShort', conflict));
        return;
      }


      // derselbe Check, dasselbe confirmModal (kein Anlege-Formular offen,

      // noetig).
      if (data.is_active && !pattern?.is_active) {
        const overlap = findOverlappingActivePattern(state.patterns, pattern?.user_id, data.valid_from || null, data.valid_until || null, pattern?.id);
        if (overlap) {
          const confirmed = await confirmModal(
            t('schedule.patternOverlapConfirmTitle', { user: userName(pattern?.user_id) }),
            { confirmLabel: t('schedule.patternOverlapConfirmAction'), detail: t('schedule.patternOverlapConfirmDetail', { name: overlap.name }) },
          );
          if (!confirmed) return;
          gefragt = true;
        }
      }
      await api.put(`/schedule/patterns/${form.dataset.id}`, data);
      dirtyPatternIds.delete(String(form.dataset.id));
    }
    await load();







    dirtyPatternIds.clear();
    renderPage();


    if (gefragt) refocusAfterRender();
    window.aashiyana?.showToast(t('schedule.saved'), 'success');
  } catch (error) {
    if (form.dataset.form === 'statistics' && statisticsRequest === statisticsRequestId) {
      statistics = { ...statistics, loading: false, error: true };
      renderPage();
    }
    window.aashiyana?.showToast(scheduleErrorMessage(error), 'danger');
  }
}






// veralteter oder per Devtools wiederbelebter Knopf findet denselben Riegel).

const READ_SAFE_ACTIONS = new Set([
  'print-statistics', 'statistics-range', 'overview-week', 'overview-view-mode',
  'retry-statistics', 'retry-overview',


  'view-schedule-entry',
]);

async function action(event) {
  const button = event.currentTarget;
  if (readOnly() && !READ_SAFE_ACTIONS.has(button.dataset.action)) return;
  try {
    if (button.dataset.action === 'open-create') {
      openScheduleCreateModal(button.dataset.view || activeView);
      return;
    }
    if (button.dataset.action === 'view-schedule-entry') {
      const entry = findScheduleEntry(button.dataset.scheduleKey);
      if (entry) openScheduleEntryDetailModal(entry);
      return;
    }

    // alte Wachposten blockierte JEDE weitere Vorlage, sobald irgendein Typ




    // Klick auf dieselbe Vorlage legt so nichts doppelt an. `finally` statt


    // angelegten trotzdem sichtbar werden.
    if (button.dataset.action === 'quick-start-shifts') {
      button.disabled = true;
      const template = PRESET_TEMPLATES[button.dataset.template] ?? [];
      const existingCodes = new Set(state.types.map((type) => type.short_code));
      let createdCount = 0;
      try {
        for (const preset of template) {
          if (existingCodes.has(preset.shortCode)) continue;
          await api.post('/schedule/shift-types', {
            name: shiftPresetLabel(preset.key),
            short_code: preset.shortCode,
            start_time: preset.startTime,
            end_time: preset.endTime,
            color: preset.color,
            icon: preset.icon,
          });
          createdCount += 1;
        }
      } finally {
        await load();
        dirtyPatternIds.clear(); // S-03 (Review zu #1099): siehe Kommentar am naechsten load()+renderPage()-Paar unten
        renderPage();
      }
      // Zaehlend statt "Gespeichert." fuer beide Faelle (S-11): ein erneuter



      window.aashiyana?.showToast(
        createdCount > 0 ? t('schedule.quickStartCreated', { count: createdCount }) : t('schedule.quickStartNothingNew'),
        'success'
      );
      return;
    }
    if (button.dataset.action === 'pick-shift-icon') {
      await pickShiftIcon(button);
      return;
    }
    if (button.dataset.action === 'print-statistics') {
      window.print();
      return;
    }
    if (button.dataset.action === 'statistics-range') {



      // dem Range-Wechsel ihren statisticsRequest === statisticsRequestId-


      // Fehlerzustand vom vorigen Bereich den Wechsel.
      statistics = { ...statistics, range: button.dataset.range, entries: [], bounds: null, loading: false, error: false };
      ++statisticsRequestId;
      renderPage();
      return;
    }
    // Wiederholen-CTA des Fehlerzustands (renderStatistics()/renderOverview()) -



    if (button.dataset.action === 'retry-statistics') {
      await activateView('statistics');
      return;
    }
    if (button.dataset.action === 'retry-overview') {
      await activateView('overview');
      return;
    }
    if (button.dataset.action === 'overview-week') {
      const step = overview.viewMode === 'day' ? 1 : 7;
      const days = button.dataset.direction === 'prev' ? -step : button.dataset.direction === 'next' ? step : null;
      overview = { ...overview, weekCursor: days ? addLocalDays(overview.weekCursor, days) : todayKey() };
      await activateView('overview');
      return;
    }
    if (button.dataset.action === 'overview-view-mode') {
      overview = { ...overview, viewMode: button.dataset.mode };
      saveOverviewViewMode(overview.viewMode);
      renderPage();
      return;
    }
    if (button.dataset.action === 'edit-override') {
      const group = overrideGroups().find((item) => item.from === button.dataset.from && Number(item.user_id) === Number(button.dataset.userId));
      if (group) openOverrideEditModal(group);
      return;
    }



    let gefragt = false;



    // confirmModal-Aufbau wie 'delete-pattern' direkt unten.
    if (button.dataset.action === 'delete-shift') {
      const type = state.types.find((item) => Number(item.id) === Number(button.dataset.id));
      const confirmed = await confirmModal(
        t('schedule.deleteShiftTypeTitle'),
        { danger: true, confirmLabel: t('schedule.delete'), detail: t('schedule.deleteShiftTypeDetail', { name: type?.name ?? '' }) },
      );
      if (!confirmed) return;
      gefragt = true;
      await api.delete(`/schedule/shift-types/${button.dataset.id}`);
    }
    if (button.dataset.action === 'open-create-custom-field') {
      openCustomFieldModal();
      return;
    }
    if (button.dataset.action === 'edit-custom-field') {
      const field = state.customFields.find((item) => Number(item.id) === Number(button.dataset.id));
      if (field) openCustomFieldModal(field);
      return;
    }
    // Kaskadiert serverseitig ueber Zuordnung UND Werte (ON DELETE CASCADE,



    // Server-Schutzes.
    if (button.dataset.action === 'delete-custom-field') {
      const field = state.customFields.find((item) => Number(item.id) === Number(button.dataset.id));
      const affected = state.types.filter((type) => (type.fields ?? []).some((f) => Number(f.id) === Number(button.dataset.id))).length;
      const confirmed = await confirmModal(
        t('schedule.deleteCustomFieldTitle', { name: field?.name ?? '' }),
        { danger: true, confirmLabel: t('schedule.delete'), detail: t('schedule.deleteCustomFieldDetail', { count: affected }) },
      );
      if (!confirmed) return;
      gefragt = true;
      await api.delete(`/schedule/custom-fields/${button.dataset.id}`);
    }




    if (button.dataset.action === 'delete-pattern') {
      const pattern = state.patterns.find((item) => Number(item.id) === Number(button.dataset.id));
      const confirmed = await confirmModal(
        t('schedule.deletePatternTitle', { name: pattern?.name ?? '' }),
        {
          danger: true,
          confirmLabel: t('schedule.delete'),
          detail: t('schedule.deletePatternDetail', { count: pattern?.cycle_length ?? 0 }),
        },
      );
      if (!confirmed) return;
      gefragt = true;
      await api.delete(`/schedule/patterns/${button.dataset.id}`);
      dirtyPatternIds.delete(String(button.dataset.id));
    }




    if (button.dataset.action === 'delete-override-range') {
      const { from, to, userId } = button.dataset;
      const confirmed = await confirmModal(
        t('schedule.deleteOverrideRangeTitle'),
        { danger: true, confirmLabel: t('schedule.delete'), detail: t('schedule.deleteOverrideRangeDetail', { from: formatDate(from), to: formatDate(to), user: userName(userId) }) },
      );
      if (!confirmed) return;
      gefragt = true;
      await api.delete(`/schedule/overrides?user_id=${userId}&from=${from}&to=${to}`);
    }
    if (button.dataset.action === 'open-create-extra') {
      openScheduleCreateModal('patterns', { mode: 'add' });
      return;
    }
    if (button.dataset.action === 'open-create-override') {
      openScheduleCreateModal('patterns', { mode: 'replace' });
      return;
    }
    if (button.dataset.action === 'edit-extra-range') {
      const group = extraGroups().find((item) => item.ids.join(',') === button.dataset.ids);
      if (group) openExtraGroupEditModal(group);
      return;
    }



    if (button.dataset.action === 'delete-extra-range') {
      const { from, to, userId } = button.dataset;
      const confirmed = await confirmModal(
        t('schedule.deleteOverrideRangeTitle'),
        { danger: true, confirmLabel: t('schedule.delete'), detail: t('schedule.deleteOverrideRangeDetail', { from: formatDate(from), to: formatDate(to), user: userName(userId) }) },
      );
      if (!confirmed) return;
      gefragt = true;
      try {
        for (const id of button.dataset.ids.split(',')) {
          await api.delete(`/schedule/extras/${id}`);
        }
      } catch (error) {




        await load();
        dirtyPatternIds.clear(); // S-03 (Review zu #1099): siehe Kommentar am naechsten load()+renderPage()-Paar unten
        renderPage();
        refocusAfterRender();
        window.aashiyana?.showToast(scheduleErrorMessage(error), 'danger');
        return;
      }
    }
    // Rein lokale Aenderungen am Tageseditor, kein API-Aufruf - erst der
    // 'save-days'-Klick unten schreibt etwas. Deshalb ein fruehes `return`:


    // Server-Stand ueberschreiben, bevor sie je gespeichert wurde.
    if (button.dataset.action === 'add-pattern-day-row') {
      button.closest('[data-day-group]')?.querySelector('.schedule-day-rows')?.insertAdjacentHTML('beforeend', dayRowHtml(Number(button.dataset.position), null, true));
      window.lucide?.createIcons({ el: root });
      markPatternDirty(button); // S-03: eine hinzugefuegte, aber ungespeicherte Zeile
      return;
    }
    if (button.dataset.action === 'remove-pattern-day-row') {
      markPatternDirty(button); // S-03: siehe add-pattern-day-row
      button.closest('[data-day-row]')?.remove();
      return;
    }


    // unten den ganzen Satz an /schedule/shift-types/:id/fields schreibt.
    if (button.dataset.action === 'add-type-field') {
      const container = document.querySelector(`[data-type-fields-rows="${button.dataset.id}"]`);
      const picker = document.querySelector(`[data-field-picker="${button.dataset.id}"]`);
      if (!container || !picker?.value) return;
      const field = state.customFields.find((item) => Number(item.id) === Number(picker.value));
      if (!field) return;
      container.querySelector('.u-meta')?.remove();
      container.insertAdjacentHTML('beforeend', shiftTypeFieldRow({ ...field, show_in_overlay: false }));
      picker.querySelector(`option[value="${field.id}"]`)?.remove();
      window.lucide?.createIcons({ el: container.parentElement });
      return;
    }
    if (button.dataset.action === 'remove-type-field') {
      const row = button.closest('[data-type-field-row]');
      const container = row?.closest('[data-type-fields-rows]');
      row?.remove();
      if (container && !container.children.length) container.insertAdjacentHTML('beforeend', '<p class="u-meta">' + esc(t('schedule.noFieldsAttached')) + '</p>');
      return;
    }
    // Tastaturbedienbarer Reorder-Pfad neben dem Ziehen ueber makeSortable()
    // oben (utils/sortable.js verlangt genau das) - dieselbe Richtung ('up'/
    // 'down') treibt beide Knopf-Varianten, nur je Zeile lokal statt ueber
    // einen Server-Aufruf.
    if (button.dataset.action === 'move-type-field') {
      const row = button.closest('[data-type-field-row]');
      const sibling = button.dataset.direction === 'up' ? row?.previousElementSibling : row?.nextElementSibling;
      if (!row || !sibling) return;
      if (button.dataset.direction === 'up') row.parentElement.insertBefore(row, sibling);
      else row.parentElement.insertBefore(sibling, row);
      return;
    }
    if (button.dataset.action === 'save-shift-fields') {
      const container = document.querySelector(`[data-type-fields-rows="${button.dataset.id}"]`);
      const fields = [...(container?.querySelectorAll('[data-type-field-row]') ?? [])].map((row, index) => ({
        custom_field_id: Number(row.dataset.customFieldId),
        position: index,
        show_in_overlay: row.querySelector('[data-show-in-overlay]')?.checked ?? false,
      }));
      await api.put(`/schedule/shift-types/${button.dataset.id}/fields`, { fields });
    }
    if (button.dataset.action === 'save-days') {
      const details = button.closest('[data-pattern]');
      const days = [...details.querySelectorAll('[data-day-row]')].map((row) => {
        const select = row.querySelector('[data-day]');
        const field_values = {};
        row.querySelectorAll('[data-field-value]').forEach((input) => { if (input.value.trim()) field_values[input.dataset.fieldValue] = input.value.trim(); });
        return { position: Number(select.dataset.day), shift_type_id: select.value ? Number(select.value) : null, field_values };
      });
      await api.put(`/schedule/patterns/${button.dataset.id}/days`, { days });
      dirtyPatternIds.delete(String(button.dataset.id));
    }
    await load();

    // delete-override-range/delete-pattern/save-days und baut JEDE





    dirtyPatternIds.clear();
    renderPage();
    if (gefragt) refocusAfterRender();
    window.aashiyana?.showToast(button.dataset.action.startsWith('delete') ? t('schedule.deleted') : t('schedule.saved'), 'success');
  } catch (error) {
    window.aashiyana?.showToast(scheduleErrorMessage(error), 'danger');
  }
}

export async function render(container, { user } = {}) {
  root = container;
  currentUserId = user?.id ?? null;
  canManageOthers = user?.role === 'admin';
  await load();
  // S-10: ein ausdruecklicher Tab-Deep-Link (Dashboard-Kachel, Erinnerung,




  // Kommentar).
  const requestedView = scheduleViewFromPath(window.location.pathname);
  if (requestedView) {
    activeView = requestedView;
    initialViewDecided = true;
  } else if (!initialViewDecided) {





    // nicht ueberschreiben (siehe Kommentar an `activeView` oben).
    activeView = state.types.length ? 'patterns' : 'shifts';
    initialViewDecided = true;
  }

  // Client-Route ueberlebt (SPA, kein Reload zwischen zwei Seitenbesuchen) -

  // `bounds`/`holidays` blieben sonst vom LETZTEN Besuch stehen und erschienen




  // bis irgendjemand aktiv auf "Heute" klickte.
  statistics = { ...statistics, userId: currentUserId, monthFrom: monthKey(), monthTo: monthKey(), from: todayKey(), to: todayKey(), entries: [], bounds: null, error: false };
  overview = { ...overview, weekCursor: todayKey(), entries: [], holidays: [], error: false };


  // Geisterzustand ohne zugehoerige ungespeicherte DOM-Aenderung.
  dirtyPatternIds = new Set();
  renderShell();
  scheduleFab = createPageFab({ id: 'schedule-fab' });
  root.querySelector('.schedule-page')?.appendChild(scheduleFab);
  // activateView() statt eines blossen renderPage(): fuer 'statistics'/


  // entspricht sie unveraendert einem einzelnen renderPage().
  await activateView(activeView);

  // ueber die nackte Wurzel (Seitenleiste, alter Bookmark) zeigt danach genau


  const resolvedRoute = scheduleRouteForView(activeView);
  if (window.location.pathname !== resolvedRoute) {
    history.replaceState({ path: resolvedRoute }, '', resolvedRoute);
  }
  window.lucide?.createIcons({ el: root });
}

export async function update({ path } = {}) {
  if (!root?.isConnected) return false;
  const requestedView = scheduleViewFromPath(path || window.location.pathname);
  const nextView = requestedView ?? activeView;
  const resolvedRoute = scheduleRouteForView(nextView);
  if (window.location.pathname !== resolvedRoute) {
    history.replaceState({ path: resolvedRoute }, '', resolvedRoute);
  }
  if (nextView !== activeView) {
    // S-03 Restluecke (bewusst offen, siehe PLAN.md): ein Browser-Zurueck ruft



    // Bearbeitung stillschweigend verwerfen wuerden. Volle Abdeckung braeuchte

    // nicht gebaut.
    await activateView(nextView);
  }
  return true;
}

// Reines Verhalten statt Text-Muster (PR #930 review): beide Funktionen sind



export const __test = { overrideGroups, extraGroups, rangeDifference, setShiftIconButtonIcon, overtimeInfo, sameFieldValues, overlayMeta, buildOverviewLanes, normalizeOverviewSelection, computeActiveHours, collapsedMinutes, isOvernightEntry, touchesVisibleDay, overviewFetchRange, patternDaysExceedingCycleLength, scheduleErrorMessage, cycleDayNextDate, cycleDayHeaderLabel, windowsOverlap, findOverlappingActivePattern, resolveWinningPatternId, scheduleEntryMatchKey };
