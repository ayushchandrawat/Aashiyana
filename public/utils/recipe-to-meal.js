
import { DEFAULT_CATEGORY_NAME } from '/utils/shopping-categories.js';

export function mealPayloadFromRecipe(recipe, date, mealType) {
  return {
    date,
    meal_type: mealType,
    title: recipe.title,
    notes: recipe.notes || null,
    recipe_url: recipe.recipe_url || null,
    recipe_id: recipe.id,
    ingredients: (recipe.ingredients || []).map((ingredient) => ({
      name: ingredient.name,
      quantity: ingredient.quantity || null,
      category: ingredient.category || DEFAULT_CATEGORY_NAME,
    })),
  };
}
