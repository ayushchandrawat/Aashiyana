import { t } from '/i18n.js';


export const DEFAULT_LOCATION_I18N = {
  'Vorratsschrank': 'pantry.locPantry',
  'Kühlschrank':    'pantry.locFridge',
  'Gefrierschrank': 'pantry.locFreezer',
  'Keller':         'pantry.locCellar',
  'Sonstiges':      'pantry.locOther',
};

export function locationLabel(name) {
  const key = DEFAULT_LOCATION_I18N[name];
  return key ? t(key) : name;
}
