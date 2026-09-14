
export function taskScopeWhere(alias, { includeFuture = false, includeSubtasks = false, bind = '?' } = {}) {
  const parts = [];



  if (!includeSubtasks) parts.push(`${alias}.parent_task_id IS NULL`);


  // Startdatum gilt als sofort begonnen.
  if (!includeFuture) parts.push(`(${alias}.start_date IS NULL OR ${alias}.start_date <= ${bind})`);




  return parts.length ? parts.join(' AND ') : '1=1';
}

export function taskScopeNeedsToday({ includeFuture = false } = {}) {
  return !includeFuture;
}

export function taskCategoryWhere(alias, categories, { named = null } = {}) {
  if (!Array.isArray(categories) || categories.length === 0) return null;
  const holes = categories.map((_, i) => (named ? `@${named}${i}` : '?'));
  return `${alias}.category IN (${holes.join(', ')})`;
}

export function categoryBindings(categories, named = 'cat') {
  return Object.fromEntries(categories.map((value, i) => [`${named}${i}`, value]));
}

export function normalizeCategoryFilter(raw, max = 50) {
  if (raw === undefined || raw === null) return [];
  const list = [raw].flat().filter((v) => typeof v === 'string' && v !== '');
  return [...new Set(list)].slice(0, max);
}
