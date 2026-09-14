import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAsciiDigits, digitMapSize } from '../public/utils/digits.js';

test('toAsciiDigits: ASCII bleibt, wie es ist', () => {
  assert.equal(toAsciiDigits('250 g'), '250 g');
  assert.equal(toAsciiDigits('1,5 kg'), '1,5 kg');
  assert.equal(toAsciiDigits('1.5 kg'), '1.5 kg');
  assert.equal(toAsciiDigits('eine Prise'), 'eine Prise');
  assert.equal(toAsciiDigits(''), '');
  assert.equal(toAsciiDigits(null), '');
  assert.equal(toAsciiDigits(undefined), '');
});

test('toAsciiDigits: die gaengigen Ziffernsysteme kommen an', () => {
  assert.equal(toAsciiDigits('۲۵۰'), '250', 'fa (extended arabic-indic)');
  assert.equal(toAsciiDigits('٢٥٠'), '250', 'ar (arabic-indic)');
  assert.equal(toAsciiDigits('२५०'), '250', 'hi (devanagari)');
  assert.equal(toAsciiDigits('๒๕๐'), '250', 'th (thai)');
  assert.equal(toAsciiDigits('২৫০'), '250', 'bn (bengali)');
  // Gemischt geschrieben - jedes Zeichen fuer sich.
  assert.equal(toAsciiDigits('۲5٠'), '250');
});

test('toAsciiDigits: die oestlichen Trennzeichen bekommen ihre ASCII-Entsprechung', () => {



  // Fehler ueberlebt hat.
  assert.equal(toAsciiDigits('۱٫۵'), '1.5', 'U+066B ist der Dezimaltrenner');
  assert.equal(toAsciiDigits('١٬٠٠٠'), '1,000', 'U+066C ist das Tausenderzeichen');
});

test('toAsciiDigits: alles, was keine Ziffer ist, bleibt unangetastet', () => {

  assert.equal(toAsciiDigits('۲۵۰ گرم'), '250 گرم');
  assert.equal(toAsciiDigits('۲ x ۵۰۰ g'), '2 x 500 g');
  assert.equal(toAsciiDigits('🍎 ۲ kg'), '🍎 2 kg');
});

test('toAsciiDigits: positionstreu in CODEPOINTS, nicht in UTF-16-Einheiten', () => {



  //

  // Systeme liegen ausserhalb der BMP, belegen also zwei UTF-16-Einheiten,



  const proben = [
    '۲ x ۵۰۰ g', '٢٬٠٠٠ g', '۱٫۵ kg', 'eine Prise', '🍎 ۲ kg',
    '250 g', '', '๒๕๐ ก.', '1 1/2 Tassen', '𞥒 kg', '𑜲𑜵𑜰 g',
  ];
  for (const probe of proben) {
    assert.equal([...toAsciiDigits(probe)].length, [...probe].length, `"${probe}"`);
  }


  // die Codepoint-Zaehlung.
  assert.notEqual(toAsciiDigits('𞥒 kg').length, '𞥒 kg'.length);
});

test('toAsciiDigits: die Zuordnung wird aus Intl abgeleitet, nicht gepflegt', () => {
  // Gemessen am 09.09.2026: 77 Ziffernsysteme, 770 Ziffernzeichen. Die Schranke




  assert.ok(digitMapSize() >= 500, `nur ${digitMapSize()} Ziffernzeichen abgeleitet`);

  for (let i = 0; i <= 9; i += 1) assert.equal(toAsciiDigits(String(i)), String(i));
});

test('toAsciiDigits: Schriftzeichen, die nur AUSSEHEN wie Ziffern, bleiben stehen', () => {






  assert.equal(toAsciiDigits('五'), '五');
  assert.equal(toAsciiDigits('一 kg'), '一 kg');
  assert.equal(toAsciiDigits('2x500 g'), '2x500 g', 'das x eines Multiplikators bleibt ein x');
});

test('toAsciiDigits: auch Ziffern ausserhalb der BMP kommen an', () => {


  // warf sie stillschweigend weg, obwohl die Schleife sie einzeln liest.
  assert.equal(toAsciiDigits('𞥒𞥕𞥐'), '250', 'adlm (Adlam)');
  assert.equal(toAsciiDigits('𑜲𑜵𑜰'), '250', 'ahom (Ahom)');
  assert.equal(toAsciiDigits('𞥐𞥑'), '01');
});

test('toAsciiDigits: ohne Intl.supportedValuesOf faellt die Faehigkeit aus, nicht die App', async () => {




  //


  const original = Intl.supportedValuesOf;
  let modul;
  try {
    delete Intl.supportedValuesOf;



    modul = await import('../public/utils/digits.js?ohne-intl=1');
    assert.equal(modul.digitMapSize(), 0, 'ohne die API bleibt die Zuordnung leer');

    assert.equal(modul.toAsciiDigits('۲۵۰ g'), '۲۵۰ g');
    assert.equal(modul.toAsciiDigits('250 g'), '250 g');
  } finally {
    Intl.supportedValuesOf = original;
  }
});
