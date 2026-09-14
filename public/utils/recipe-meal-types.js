const RECIPE_MEAL_TYPE_KEYS = Object.freeze(['breakfast', 'lunch', 'dinner', 'snack']);

function normalizeRecipeMealTypes(value) {
  if (value === null || value === undefined) return [...RECIPE_MEAL_TYPE_KEYS];
  const source = Array.isArray(value)
    ? value
    : String(value)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  return [...new Set(source.filter((type) => RECIPE_MEAL_TYPE_KEYS.includes(type)))];
}

function recipeSupportsMealType(recipe, mealType) {
  return normalizeRecipeMealTypes(recipe?.meal_types).includes(mealType);
}

function recipeAllowsMealType(recipe, mealType) {
  const types = normalizeRecipeMealTypes(recipe?.meal_types);
  return types.length === 0 || types.includes(mealType);
}

export {
  RECIPE_MEAL_TYPE_KEYS,
  normalizeRecipeMealTypes,
  recipeSupportsMealType,
  recipeAllowsMealType,
};
