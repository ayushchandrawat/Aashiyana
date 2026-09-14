import { toAsciiDigits } from '../../public/utils/digits.js';

const ARABIC_THOUSANDS = '\u066C'; // eindeutig Gruppierung
const ARABIC_DECIMAL = '\u066B';   // eindeutig Dezimaltrenner

function foreignAmount(zahlOriginal) {
  const zahl = toAsciiDigits(zahlOriginal);
  const vorzeichen = /^[+-]/.test(zahl) ? zahl[0] : '';
  const rumpf = vorzeichen ? zahl.slice(1) : zahl;

  if (/^\d+$/.test(rumpf)) return Number(zahl);

  const hatGruppe = zahlOriginal.includes(ARABIC_THOUSANDS);
  const hatDezimal = zahlOriginal.includes(ARABIC_DECIMAL);

  const unklar = /[.,]/.test(zahlOriginal);

  if (hatGruppe) {


    const muster = hatDezimal ? /^\d{1,3}(?:,\d{3})+\.\d+$/ : /^\d{1,3}(?:,\d{3})+$/;
    if (unklar || !muster.test(rumpf)) return null;
    return Number(vorzeichen + rumpf.replaceAll(',', ''));
  }

  if (hatDezimal && !unklar) {
    return /^\d+\.\d+$/.test(rumpf) ? Number(zahl) : null;
  }





  if (/[.,]\d{3}(?!\d)/.test(rumpf)) return null;
  return /^\d+(?:[.,]\d+)?$/.test(rumpf) ? Number(vorzeichen + rumpf.replace(',', '.')) : null;
}

function parseQuantity(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const zeichen = [...raw];
  const norm = toAsciiDigits(raw);



  // wirklich geht, sagt dann der Pfad selbst.
  const bereich = norm.match(/^[+-]?[\d.,]*\d/)?.[0] ?? '';
  const bereichOriginal = zeichen.slice(0, [...bereich].length).join('');
  const fremd = bereich !== bereichOriginal;

  const match = fremd
    ? [null, bereich, norm.slice(bereich.length).replace(/^\s+/, '')]
    : norm.match(/^([+-]?\d+(?:[.,]\d+)?)\s*(.*)$/);
  if (!match) return null;





  // Brueche wirklich rechnet. Gilt fuer „1/2 kg" genauso: dort stand derselbe
  // Fehler schon vorher, nur unbemerkt.
  if (match[2].startsWith('/')) return null;

  const amount = fremd
    ? foreignAmount(bereichOriginal)
    : Number(match[1].replace(',', '.'));
  if (amount === null || !Number.isFinite(amount)) return null;





  const rest = [...match[2]].length;
  const unit = zeichen.slice(zeichen.length - rest).join('').trim().replace(/\s+/g, ' ').toLowerCase();

  return { amount, unit };
}

function formatQuantity(amount, unit) {
  const rounded = Math.round(amount * 100) / 100;
  const number = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  return unit ? `${number} ${unit}` : number;
}

function aggregateMealIngredients(ingredients = []) {
  const groups = new Map();

  for (const ingredient of ingredients) {
    const name = String(ingredient?.name || '').trim();
    if (!name) continue;
    const category = String(ingredient?.category || 'Sonstiges').trim() || 'Sonstiges';
    const parsed = parseQuantity(ingredient?.quantity);
    const quantity = String(ingredient?.quantity || '').trim();



    const key = parsed
      ? `${name.toLowerCase()}\u0000${category}\u0000parsed\u0000${toAsciiDigits(parsed.unit)}`
      : `${name.toLowerCase()}\u0000${category}\u0000raw\u0000${quantity.toLowerCase()}`;

    if (!groups.has(key)) {
      groups.set(key, {
        name,
        category,
        quantity: quantity || null,
        amount: 0,
        unit: parsed?.unit ?? '',
        mealIds: new Set(),
        ingredientIds: [],
        count: 0,
      });
    }

    const group = groups.get(key);
    group.count += 1;
    if (parsed) {
      group.amount = (group.amount ?? 0) + parsed.amount;
      group.quantity = formatQuantity(group.amount, group.unit);
    } else if (!quantity) {
      group.quantity = null;
    } else if (group.count > 1) {
      group.quantity = `${group.count} x ${quantity}`;
    }

    if (ingredient.meal_id != null) group.mealIds.add(ingredient.meal_id);
    if (ingredient.id != null) group.ingredientIds.push(ingredient.id);
  }

  return [...groups.values()].map((group) => ({
    name: group.name,
    category: group.category,
    quantity: group.quantity,
    added_from_meal: group.mealIds.size === 1 ? [...group.mealIds][0] : null,
    ingredientIds: group.ingredientIds,
  }));
}

export { aggregateMealIngredients, parseQuantity };
