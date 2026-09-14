
import { t } from '/i18n.js';
import { api } from '/api.js';

export const MEAL_TYPE_KEYS = ['breakfast', 'lunch', 'dinner', 'snack'];

const BUILT_IN = {
  breakfast: { labelKey: 'meals.typeBreakfast', icon: 'sunrise' },
  lunch:     { labelKey: 'meals.typeLunch',     icon: 'sun'     },
  dinner:    { labelKey: 'meals.typeDinner',    icon: 'moon'    },
  snack:     { labelKey: 'meals.typeSnack',     icon: 'cookie'  },
};

let householdNames = {};
let pending = null;

export function primeMealTypeNames(prefsData) {
  const names = prefsData?.meal_type_names;
  if (!names || typeof names !== 'object') return;
  const next = {};
  for (const key of MEAL_TYPE_KEYS) {
    const value = typeof names[key] === 'string' ? names[key].trim() : '';
    if (value) next[key] = value;
  }
  householdNames = next;
}

export async function ensureMealTypeNames() {
  if (pending) return pending;
  pending = api.get('/preferences')
    .then((res) => { primeMealTypeNames(res?.data); })
    .catch(() => {})
    .finally(() => { pending = null; });
  return pending;
}

export function mealTypeLabel(key) {
  return householdNames[key] || t(BUILT_IN[key]?.labelKey ?? '');
}

export function mealTypeList() {
  return MEAL_TYPE_KEYS.map((key) => ({
    key,
    label: mealTypeLabel(key),
    icon: BUILT_IN[key].icon,
  }));
}
