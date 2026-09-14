



export const WIDGET_IDS = ['tasks', 'calendar', 'meals', 'shopping', 'birthdays', 'countdown', 'budget', 'rewards', 'health', 'cycle', 'housekeeping', 'schedule', 'waste', 'family', 'notes', 'weather', 'clock', 'metrics', 'quicklinks'];






export const WIDGET_SIZE_PRESETS = [
  { value: '1x1', labelKey: 'dashboard.widgetSizeTiny'     },
  { value: '2x1', labelKey: 'dashboard.widgetSizeNarrow'   },
  { value: '1x2', labelKey: 'dashboard.widgetSizeTall'     },
  { value: '2x2', labelKey: 'dashboard.widgetSizeStandard' },
];


export const WIDGET_SIZE_OPTIONS = [...new Set([
  ...WIDGET_SIZE_PRESETS.map((p) => p.value),
  '1x2', '1x3', '1x4', '2x3', '2x4', '3x1', '3x3', '3x4', '4x1', '4x3', '4x4',
])];





export function nearestPreset(size) {
  const values = WIDGET_SIZE_PRESETS.map((p) => p.value);
  if (values.includes(size)) return size;
  const [cols, rows] = String(size).split('x').map(Number);
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return '1x1';
  return `${cols >= 2 ? 2 : 1}x${rows >= 2 ? 2 : 1}`;
}

export function defaultWidgetSize(id) {






  // Saldo + Sparen + Einnahme/Ausgabe + Top-Ausgabe → 1×2; family stapelt seit

  //


  // vier Widgets - Geburtstage (1x1), Budget (1x2), Familie (1x2), Notizen





  // die Zeile lueckenlos. Bestandslayouts bleiben unberuehrt - gespeichert





  // `schedule` joins `family` for the same reason: it too is a member list -
  // avatar, name, shift - and left at the 1x1 default it rendered 318px against
  // the 218px the size class promised, stretching whatever shared its grid row
  // (PR #930 review).
  if (['tasks', 'calendar', 'rewards', 'budget', 'family', 'notes', 'birthdays', 'countdown', 'schedule', 'waste'].includes(id)) return '1x2';





  if (['weather', 'shopping', 'health', 'cycle', 'meals', 'clock', 'quicklinks'].includes(id)) return '2x1';

  //





  //




  // dieser Default.
  if (id === 'metrics') return '2x1';
  return '1x1';
}




export const COCKPIT_COVERED_WIDGETS = new Set(['tasks', 'calendar', 'shopping', 'meals']);












// stattdessen die Masthead-Zeile (kein Echo).





export const DEFAULT_HIDDEN_WIDGETS = new Set([...COCKPIT_COVERED_WIDGETS, 'rewards', 'health', 'cycle', 'housekeeping', 'schedule', 'waste', 'clock', 'weather', 'quicklinks']);

export function defaultWidgetVisible(id) {
  return !DEFAULT_HIDDEN_WIDGETS.has(id);
}

export const DEFAULT_WIDGET_CONFIG = WIDGET_IDS.map((id, i) => ({ id, visible: defaultWidgetVisible(id), order: i, size: defaultWidgetSize(id) }));

function defaultInsertIndex(ordered, missingId) {
  for (let i = WIDGET_IDS.indexOf(missingId) - 1; i >= 0; i--) {
    const at = ordered.findIndex((w) => w.id === WIDGET_IDS[i]);
    if (at !== -1) return at + 1;
  }
  return 0;
}

export function normalizeDashboardConfig(input) {
  const valid = Array.isArray(input)
    ? input
      .filter((w) => w && typeof w === 'object' && WIDGET_IDS.includes(w.id))
      .map((w, i) => ({
        id: w.id,
        visible: w.visible !== false,
        order: Number.isFinite(Number(w.order)) ? Number(w.order) : i,


        size: WIDGET_SIZE_OPTIONS.includes(w.size) ? nearestPreset(w.size) : defaultWidgetSize(w.id),





        ...(w.options && typeof w.options === 'object' && !Array.isArray(w.options) && Object.keys(w.options).length
          ? { options: { ...w.options } }
          : {}),
      }))
    : [];



  const ordered = valid.sort((a, b) => a.order - b.order);
  const presentIds = new Set(ordered.map((w) => w.id));
  for (const id of WIDGET_IDS) {
    if (presentIds.has(id)) continue;



    ordered.splice(defaultInsertIndex(ordered, id), 0, { id, visible: defaultWidgetVisible(id), order: 0, size: defaultWidgetSize(id) });

    // vorhanden, deshalb bleiben sie in ihrer WIDGET_IDS-Reihenfolge stehen.
    presentIds.add(id);
  }
  return ordered.map((w, i) => ({ ...w, order: i }));
}






export function isUserOrderedConfig(cfg) {
  if (!Array.isArray(cfg)) return false;



  // Nutzer-Umsortierung. Der strikte Voll-Vergleich schaltete sonst dauerhaft

  // (Audit A1-03).
  //





  const defaultIds = DEFAULT_WIDGET_CONFIG.map((w) => w.id);
  const currentOrder = [...cfg]
    .filter((w) => w.visible !== false && defaultIds.includes(w.id))
    .sort((a, b) => a.order - b.order)
    .map((w) => w.id);
  const defaultOrder = defaultIds.filter((id) => currentOrder.includes(id));
  return currentOrder.join(',') !== defaultOrder.join(',');
}

export function sameWidgetConfig(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((w, i) => w.id === b[i].id && w.visible === b[i].visible
    && w.size === b[i].size && w.order === b[i].order





    && JSON.stringify(w.options ?? null) === JSON.stringify(b[i].options ?? null));
}

export function dashboardQuery(config) {
  const params = new URLSearchParams();
  const optionsOf = (id) => (Array.isArray(config) ? config.find((w) => w.id === id)?.options : null) ?? {};
  if (optionsOf('calendar').scope === 'mine') params.set('events_scope', 'mine');



  if (optionsOf('calendar').birthdays === 'hide') params.set('events_birthdays', 'hide');
  for (const key of optionsOf('tasks').categories ?? []) params.append('tasks_category', key);
  for (const id of optionsOf('notes').categories ?? []) params.append('notes_category', String(id));
  const query = params.toString();
  return query ? `/dashboard?${query}` : '/dashboard';
}
