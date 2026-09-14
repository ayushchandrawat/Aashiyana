// --------------------------------------------------------
// Zahlen aus fremden Ziffernsystemen lesbar machen.
//





// dieselbe Zutat zweimal untereinander stand statt einmal zusammengezaehlt.
//



//





//

// Ziffernzeichen aus 77 Ziffernsystemen (gemessen 09.09.2026) haette niemand

// auseinander.
// --------------------------------------------------------

const SEPARATORS = new Map([
  ['٫', '.'], // ARABIC DECIMAL SEPARATOR
  ['٬', ','], // ARABIC THOUSANDS SEPARATOR
]);

/** Ziffernzeichen -> ASCII-Ziffer. Einmal gebaut, danach nur gelesen. */
let digitMap = null;

function buildDigitMap() {
  const map = new Map();





  //




  // gelesen, alles andere laeuft.
  //

  // settings/pages/personal-appearance.js.
  let systems = [];
  try {
    systems = Intl.supportedValuesOf('numberingSystem');
  } catch {
    return map;
  }
  for (const system of systems) {
    let digits;
    try {
      const format = new Intl.NumberFormat('en', { numberingSystem: system, useGrouping: false });
      digits = Array.from({ length: 10 }, (_, i) => format.format(i));
    } catch {
      continue;
    }





    //


    // `.length === 2`. Ein `d.length === 1` warf sie stillschweigend weg, obwohl

    const positional = digits.every((d) => [...d].length === 1 && /^\p{Nd}$/u.test(d))
      && new Set(digits).size === 10;
    if (!positional) continue;
    digits.forEach((digit, value) => map.set(digit, String(value)));
  }
  return map;
}

export function toAsciiDigits(value) {
  const text = String(value ?? '');
  if (!text) return '';
  if (!digitMap) digitMap = buildDigitMap();

  let out = '';
  for (const char of text) {
    out += digitMap.get(char) ?? SEPARATORS.get(char) ?? char;
  }
  return out;
}

export function asciiDigit(char) {
  if (!digitMap) digitMap = buildDigitMap();
  return digitMap.get(char) ?? null;
}

export function asciiSeparator(char) {
  return SEPARATORS.get(char) ?? null;
}

export function digitMapSize() {
  if (!digitMap) digitMap = buildDigitMap();
  return digitMap.size;
}
