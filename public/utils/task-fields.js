
import { t, formatDate, formatDayMonth, formatTime } from '/i18n.js';
import { parseLocalDateKey } from '/utils/date.js';
import { nowFields } from '/utils/timezone.js';
import { isPreviewable } from '/utils/document-preview.js';

// --------------------------------------------------------
// Prioritaet und Status
// --------------------------------------------------------

export const PRIORITIES = () => [
  { value: 'urgent', label: t('tasks.priorityUrgent'), color: 'var(--color-priority-urgent)' },
  { value: 'high',   label: t('tasks.priorityHigh'),   color: 'var(--color-priority-high)'   },
  { value: 'medium', label: t('tasks.priorityMedium'), color: 'var(--color-priority-medium)' },
  { value: 'low',    label: t('tasks.priorityLow'),    color: 'var(--color-priority-low)'    },
  { value: 'none',   label: t('tasks.priorityNone'),   color: 'var(--color-priority-none)'   },
];

export const PRIO_ORDER = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };




export const STATUSES = () => [
  { value: 'open',        label: t('tasks.statusOpen')       },
  { value: 'in_progress', label: t('tasks.statusInProgress') },
  { value: 'done',        label: t('tasks.statusDone')       },
];




export const FILTER_STATUSES = () => [...STATUSES(), { value: 'archived', label: t('tasks.statusArchived') }];

export const PRIORITY_LABELS = () => Object.fromEntries(PRIORITIES().map((p) => [p.value, p.label]));
export const STATUS_LABELS   = () => Object.fromEntries(FILTER_STATUSES().map((s) => [s.value, s.label]));

// --------------------------------------------------------
// Ablage und Sperre
// --------------------------------------------------------

export function isArchived(task) {
  return !!task?.archived_at;
}

export function canEditTaskDefinition(task, parent = null, viewer = {}) {
  const lock = task?.locked ? task : (parent?.locked ? parent : null);
  if (!lock) return true;
  if (viewer.isAdmin) return true;
  return Number(lock.created_by) === Number(viewer.currentUserId);
}

// --------------------------------------------------------
// Kategorien
// --------------------------------------------------------

// Fallback-Kategorie (kanonischer Key). Kategorien sind seit #494 benutzer-

export const FALLBACK_CATEGORY = 'misc';


// benutzerdefinierte tragen name. Unbekannte Keys (z. B. Due-Gruppen-Strings)

export function catLabel(key, categories = []) {
  const c = (categories ?? []).find((x) => x.key === key);
  if (!c) return key;
  return c.label_key ? t(c.label_key) : (c.name || c.key);
}


//


// Kategorie-Verwalter gezogene Reihenfolge (`sort_order`, seit #494 per
// PATCH /tasks/categories/reorder gespeichert) blieb wirkungslos, sortiert


// deutsche Sortierregeln.
//
// `state.categories` kommt vom Server bereits nach `sort_order` sortiert -


export function catSortIndex(key, categories = []) {
  const i = (categories ?? []).findIndex((c) => c.key === key);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

// --------------------------------------------------------
// Tags (#586)
// --------------------------------------------------------

export const MAX_TAGS = 32;
export const MAX_TAG_LEN = 64;

export function normalizeTagList(list) {
  const out = [];
  const seen = new Set();
  for (const item of list ?? []) {
    const tag = String(item ?? '').trim().slice(0, MAX_TAG_LEN).trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

// --------------------------------------------------------

// --------------------------------------------------------

export function docMime(doc) {
  return String(doc.mime_type || '').split(';')[0].trim().toLowerCase();
}



export function docHref(doc) {
  return isPreviewable(doc.mime_type)
    ? `/api/v1/documents/${doc.id}/preview`
    : `/api/v1/documents/${doc.id}/download`;
}

export function docIcon(doc) {
  const mime = docMime(doc);
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'file-text';
  return 'file';
}

// --------------------------------------------------------

// --------------------------------------------------------

export function formatDueDate(dateStr, timeStr, isDone = false) {
  if (!dateStr) return null;

  // Zonenlose WANDUHRZEIT, nicht Zeitpunkt. `new Date(`${dateStr}T${timeStr}`)`




  // folgt seit #829 laengst `todayKey()`: dieselbe Ansicht ging damit nach zwei

  const dayKey = String(dateStr).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
  const dueTime = timeStr ? String(timeStr).slice(0, 5) : null;
  if (timeStr && !/^\d{2}:\d{2}$/.test(dueTime)) return null;
  const dueStamp = `${dayKey}T${dueTime ?? '23:59'}`;

  const now = nowFields();
  if (!now) return null;
  const p2 = (n) => String(n).padStart(2, '0');
  const todayDay = `${now.year}-${p2(now.month)}-${p2(now.day)}`;
  const nowStamp = `${todayDay}T${p2(now.hour)}:${p2(now.minute)}`;



  const calDayDiff = Math.round(
    (parseLocalDateKey(dayKey) - parseLocalDateKey(todayDay)) / (1000 * 60 * 60 * 24),
  );

  const timeLabel = dueTime ? ` – ${formatTime(dueStamp)}` : '';

  const dateLabel = dayKey.slice(0, 4) === todayDay.slice(0, 4)
    ? formatDayMonth(dayKey)
    : formatDate(dayKey);
  const fullLabel = dueTime ? `${dateLabel}, ${formatTime(dueStamp)}` : dateLabel;


  if (isDone) {
    return { label: fullLabel, cls: '' };
  }


  if (dueStamp < nowStamp) {
    return { label: `${t('tasks.overdue')} – ${fullLabel}`, cls: 'due-date--overdue' };
  }
  if (calDayDiff === 0) {
    return { label: `${t('tasks.dueToday')}${timeLabel}`, cls: 'due-date--today' };
  }
  if (calDayDiff === 1) {
    return { label: `${t('tasks.dueTomorrow')}${timeLabel}`, cls: '' };
  }
  return { label: fullLabel, cls: '' };
}
