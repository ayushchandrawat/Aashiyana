// --------------------------------------------------------

//
// Lean-Modell (#476/#505). Anders als services/visibility.js (assignment-basiert,





//
// Zwei Achsen:
//   visibility ('private' | 'shared' | 'shared_amount')  – wer darf was SEHEN
//   Ansichts-Scope ('mine' | 'household') – reiner Anzeige-Filter im Personal-Modus
//


//
// DREI STUFEN, ZWEI FRAGEN (#659). 'private' und 'shared' beantworteten bisher




// beiden Fragen:
//




//



// --------------------------------------------------------

export const BUDGET_VISIBILITY_VALUES = ['private', 'shared', 'shared_amount'];

export const BUDGET_OBJECT_VISIBILITY_VALUES = ['private', 'shared'];

export const BUDGET_MASKED_CATEGORY = '__private__';

export function resolveBudgetMode(database) {
  const row = database.prepare("SELECT value FROM sync_config WHERE key = 'budget_mode'").get();
  return row && row.value === 'personal' ? 'personal' : 'shared';
}

export function normalizeBudgetVisibility(value, fallback = 'shared') {
  return BUDGET_VISIBILITY_VALUES.includes(value) ? value : fallback;
}

export function normalizeObjectVisibility(value, fallback = 'shared') {
  if (value === 'shared_amount') return 'private';
  return BUDGET_OBJECT_VISIBILITY_VALUES.includes(value) ? value : fallback;
}

export function budgetVisibilityWhere(alias, meBind, { mode } = {}) {
  if (mode !== 'personal') return '1=1'; // 'shared'/undefined: Altverhalten, alle sehen alles
  return `(${alias}.visibility <> 'private' OR ${alias}.owner_id = ${meBind})`;
}

export function budgetDetailsVisibleWhere(alias, meBind, { mode } = {}) {
  if (mode !== 'personal') return '1=1';
  return `(${alias}.visibility = 'shared' OR ${alias}.owner_id = ${meBind})`;
}

export function budgetDetailsHiddenWhere(alias, meBind, { mode } = {}) {
  if (mode !== 'personal') return '0=1'; // shared-Modus maskiert nie
  return `(${alias}.visibility = 'shared_amount' AND ${alias}.owner_id <> ${meBind})`;
}

export function budgetScopeWhere(scope, alias, meBind) {
  if (scope === 'mine') return `${alias}.owner_id = ${meBind}`;
  return `${alias}.visibility <> 'private'`;
}

export function hidesBudgetDetails(row, viewerId, mode) {
  if (mode !== 'personal' || !row) return false;
  return row.visibility === 'shared_amount' && row.owner_id !== viewerId;
}

export function maskBudgetEntry(row, viewerId, mode) {
  if (!hidesBudgetDetails(row, viewerId, mode)) return row;
  const masked = {
    ...row,
    title: '',
    category: BUDGET_MASKED_CATEGORY,
    subcategory: '',
    details_hidden: true,
  };



  delete masked.attachments;
  delete masked.documents;
  delete masked.inventory_items;
  delete masked.recurrence_rule;
  return masked;
}

export function canEditEntry(entry, user) {
  if (!entry || !user) return false;
  return entry.owner_id === user.id || entry.created_by === user.id;
}
