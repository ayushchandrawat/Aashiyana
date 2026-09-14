
export const KITCHEN_MODULES = Object.freeze(['meals', 'recipes', 'shopping', 'pantry']);

const KITCHEN_GROUP_ID = 'kitchen';

export function moduleAccentToken(mod) {
  if (!mod) return '';
  return KITCHEN_MODULES.includes(mod) || mod === KITCHEN_GROUP_ID
    ? `--module-${KITCHEN_GROUP_ID}`
    : `--module-${mod}`;
}

export function moduleAccentVar(mod) {
  const token = moduleAccentToken(mod);
  return token ? `var(${token})` : '';
}
