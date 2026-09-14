// --------------------------------------------------------
// Sichtbarkeit pro Aufgabe/Termin (#474): all | assignees | private.
//



//


// entsprechende WHERE-Fragment an. Der Kalender-Export (ICS-Feed) bleibt bewusst

// --------------------------------------------------------

export const VISIBILITY_VALUES = ['all', 'assignees', 'private'];

export function normalizeVisibility(value, fallback = 'all') {
  return VISIBILITY_VALUES.includes(value) ? value : fallback;
}

export function visibilityWhere(alias, assignTable, assignCol, bind = '?') {
  return `(
    ${alias}.visibility = 'all'
    OR ${alias}.created_by = ${bind}
    OR (${alias}.visibility = 'assignees' AND EXISTS (
          SELECT 1 FROM ${assignTable} vx
          WHERE vx.${assignCol} = ${alias}.id AND vx.user_id = ${bind}))
  )`;
}
