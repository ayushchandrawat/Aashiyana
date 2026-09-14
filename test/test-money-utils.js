import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDecimalString, amountInputToCents, centsToAmountInput, breaksOffAtSeparator, toStoredNumber } from '../public/utils/money.js';
import { parseQuantity } from '../server/services/shopping-import.js';

function withFormatLocale(locale, fn) {
  const vorher = globalThis.__formatLocale;
  globalThis.__formatLocale = locale;
  try { fn(); } finally { globalThis.__formatLocale = vorher; }
}

function um(locale, eingabe, erwartet) {
  withFormatLocale(locale, () => {
    assert.equal(toDecimalString(eingabe), erwartet, `${locale}: "${eingabe}"`);
  });
}

test('toDecimalString: Ziffern und Trenner kommen aus der eingestellten Region', () => {
  um('de', '12,50', '12.50');
  um('en-US', '12.50', '12.50');
  um('de-CH', '12.50', '12.50');


  um('fa', '۱۲٫۵۰', '12.50');
  um('ar-EG', '١٢٫٥٠', '12.50');




  um('fa', '١٢٫٥٠', '12.50');
  um('de', '١٢٫٥٠', '12.50');
  um('en-US', '۴٫۵', '4.5');

  // Tippfehler soll als Tippfehler auffallen.
  um('de', '12,50 EUR', '12.50 EUR');
  um('de', '', '');
});

test('toDecimalString: das ASCII-Komma gilt nur, wo die Region es als Trenner fuehrt', () => {


  um('en-US', '1,5', '1,5');
  um('fa', '1,5', '1,5');
  um('de', '1,5', '1.5');
});

test('toDecimalString: eine gruppierte Zahl wird abgewiesen, auch in oestlichen Ziffern', () => {


  um('de', '1.000', '');
  um('en-US', '1,000', '');
  um('de-CH', "1'000", '');
  um('de', '12.50', '12.50');



  // Aufrufers scheitert am stehen gebliebenen Trenner), aber eine Mengenangabe

  um('ar-EG', '٢٬٠٠٠', '');
  um('fa', '۲٬۰۰۰', '');

  um('ar-EG', '٢٠٠٠', '2000');
  um('fa', '۲۰۰۰', '2000');
});

test('toDecimalString: bei Freitext zaehlt nur der fuehrende Zahlenbereich', () => {





  withFormatLocale('de', () => {
    assert.equal(toDecimalString('6 × 1.000 ml'), '', 'ohne freeText weist die Gruppierung im Rest ab');
    assert.equal(toDecimalString('6 × 1.000 ml', { freeText: true }), '6 × 1.000 ml');
  });
  withFormatLocale('en-US', () => {
    assert.equal(toDecimalString('6 × 1,000 ml', { freeText: true }), '6 × 1,000 ml');
    assert.equal(toDecimalString('2 cans à 1,000 ml', { freeText: true }), '2 cans à 1,000 ml');
  });

  // Freibrief statt einer Eingrenzung.
  um('de', '1.000 g', '');
  withFormatLocale('de', () => {
    assert.equal(toDecimalString('1.000 g', { freeText: true }), '', 'der fuehrende Token zaehlt weiter');
  });
  withFormatLocale('en-US', () => {
    assert.equal(toDecimalString('1,000 g', { freeText: true }), '');
  });
  withFormatLocale('ar-EG', () => {
    assert.equal(toDecimalString('٢٬٠٠٠ g', { freeText: true }), '', 'auch in oestlichen Ziffern');



    assert.equal(toDecimalString('٦ × ١٬٠٠٠ ml', { freeText: true }), '6 × 1,000 ml');
  });

  withFormatLocale('de', () => {
    assert.equal(toDecimalString('1,5 kg', { freeText: true }), '1.5 kg');
  });
});

test('toDecimalString: der Dezimaltrenner wird erst NACH der Gruppierungspruefung ersetzt', () => {



  // dann als vermeintlich gruppiert raus.
  um('de', '1,000', '1.000');
  um('en-US', '1.000', '1.000');
  um('fa', '۱٫۰۰۰', '1.000');
});

test('toDecimalString: positionstreu in CODEPOINTS, nicht in UTF-16-Einheiten', () => {



  // Zusicherung, verrutscht dort still der Schnitt.
  //




  const proben = [
    '۲ x ۵۰۰ g', '٢٬٥٠ g', '1,5 kg', 'eine Prise', '🍎 2 kg', '1 1/2 Tassen',
    '12,50 EUR', '𞥒 x 500 g', '𑜲𑜵𑜰 g',
  ];
  for (const locale of ['de', 'en-US', 'fa', 'ar-EG', 'de-CH']) {
    withFormatLocale(locale, () => {
      for (const probe of proben) {
        const ergebnis = toDecimalString(probe);

        if (ergebnis === '') continue;
        assert.equal([...ergebnis].length, [...probe.trim()].length,
          `${locale}: "${probe}" -> "${ergebnis}"`);
      }
    });
  }


  withFormatLocale('de', () => {
    assert.notEqual(toDecimalString('𞥒 kg').length, '𞥒 kg'.length);
  });
});

test('amountInputToCents: Rundreise durch die Region, gruppierte Eingabe abgelehnt', () => {
  withFormatLocale('de', () => {
    assert.equal(amountInputToCents('2,50', 'EUR'), 250);
    assert.equal(amountInputToCents('1,000', 'EUR'), 100, '"1,000" ist in de EIN Euro');
    assert.equal(amountInputToCents('1.000', 'EUR'), null, '"1.000" ist in de gruppiert');
    assert.equal(amountInputToCents('1300', 'JPY'), 1300, 'JPY hat keine Nachkommastellen');
    assert.equal(centsToAmountInput(250, 'EUR'), '2,50');
  });
  withFormatLocale('en-US', () => {
    assert.equal(amountInputToCents('2.50', 'EUR'), 250);
    assert.equal(amountInputToCents('1,000', 'EUR'), null, '"1,000" ist in en-US gruppiert');
    assert.equal(amountInputToCents('1.000', 'EUR'), 100);
    assert.equal(centsToAmountInput(250, 'EUR'), '2.50');
  });
  withFormatLocale('ar-EG', () => {
    assert.equal(amountInputToCents('١٢٫٥٠', 'EUR'), 1250, 'oestliche Ziffern muessen ankommen');
    assert.equal(amountInputToCents('٢٬٠٠٠', 'EUR'), null, 'gruppiert, auch in oestlichen Ziffern');
  });
});

test('centsToAmountInput: der ausgegebene Wert kommt wieder herein', () => {

  // toDecimalString beim naechsten Speichern ab.
  for (const locale of ['de', 'en-US', 'fa', 'ar-EG', 'de-CH']) {
    withFormatLocale(locale, () => {
      for (const cents of [0, 1, 250, 123456, 100000]) {
        const feld = centsToAmountInput(cents, 'EUR');
        assert.equal(amountInputToCents(feld, 'EUR'), cents,
          `${locale}: ${cents} -> "${feld}" -> ${amountInputToCents(feld, 'EUR')}`);
      }
    });
  }
});

test('breaksOffAtSeparator: nur echte Trennzeichen zaehlen, kein Multiplikator', () => {




  //


  for (const rest of [',5 kg', '.5 kg', "'000 g", '٫٥ kg', '٬٠٠٠ g']) {
    assert.equal(breaksOffAtSeparator(rest), true, `"${rest}" bricht im Trenner ab`);
  }
  for (const rest of ['x500 g', '×500 ml', '*500 g', ' x 500 g', 'er-Pack', ' kg', '', 'x', ',', ' 5 g', '× 1 l']) {
    assert.equal(breaksOffAtSeparator(rest), false, `"${rest}" ist kein Abbruch im Trenner`);
  }



  assert.equal(breaksOffAtSeparator('\u202F000 g'), false);
});

test('toStoredNumber: Ziffern UND Trenner der Region, von beiden Seiten lesbar', () => {





  //


  // unlesbar erklaert, obwohl der Server sie laengst liest.
  for (const locale of ['de', 'en-US', 'fa', 'ar-EG', 'fr', 'de-CH', 'bn']) {
    withFormatLocale(locale, () => {
      for (const wert of [2000, 4.5, 0.25, 1]) {
        const text = toStoredNumber(wert);
        assert.equal(parseQuantity(`${text} kg`)?.amount, wert,
          `${locale}: "${text}" ist fuer den Server unlesbar`);
        assert.equal(Number(toDecimalString(text)), wert, `${locale}: Rundreise im Client fuer ${wert}`);
      }
    });
  }




  let unterFa;
  withFormatLocale('fa', () => { unterFa = toStoredNumber(4.5); });
  for (const locale of ['de', 'en-US', 'ar-EG']) {
    withFormatLocale(locale, () => {
      assert.equal(Number(toDecimalString(unterFa)), 4.5, `${locale} liest den fa-Wert "${unterFa}" nicht`);
    });
  }

  // fuer fa/ar-EG/ar-SA (dort stand `0.5` statt `0٫5`, weil ihr `٫` fuer den

  withFormatLocale('de', () => { assert.equal(toStoredNumber(4.5), '4,5'); });
  withFormatLocale('fr', () => { assert.equal(toStoredNumber(4.5), '4,5'); });
  withFormatLocale('en-US', () => { assert.equal(toStoredNumber(4.5), '4.5'); });
  withFormatLocale('fa', () => { assert.equal(toStoredNumber(0.5), '۰٫۵'); });
  withFormatLocale('ar-EG', () => { assert.equal(toStoredNumber(0.5), '٠٫٥'); });
  withFormatLocale('fa', () => { assert.equal(toStoredNumber(2000), '۲۰۰۰'); });

  withFormatLocale('de', () => { assert.equal(toStoredNumber(2000), '2000'); });
});
