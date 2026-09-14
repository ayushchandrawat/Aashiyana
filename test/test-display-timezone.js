process.env.TZ = 'America/Toronto';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tz = await import('../public/utils/timezone.js');
const dateUtils = await import('../public/utils/date.js');

const {
  displayTimeZone, hasExplicitZone, isInstant, isValidTimeZone,
  setDisplayTimeZone, todayKey, zonedDateKey, zonedFields, zonedTimeKey, zonedWeekday,
} = tz;



const withZone = (zone, fn) => {
  setDisplayTimeZone(zone);
  try { return fn(); } finally { setDisplayTimeZone(null); }
};

// --------------------------------------------------------

// --------------------------------------------------------

test('hasExplicitZone trennt die zwei Speicherformen in start_datetime', () => {
  assert.equal(hasExplicitZone('2026-08-21T19:00:00Z'), true);
  assert.equal(hasExplicitZone('2026-08-21T19:00:00+02:00'), true);
  assert.equal(hasExplicitZone('2026-08-21T19:00:00+0200'), true);

  assert.equal(hasExplicitZone('2026-08-21T19:00'), false);
  assert.equal(hasExplicitZone('2026-08-21'), false);
});

test('isInstant: nur Date, Zahl und zonenbehafteter String sind Zeitpunkte', () => {
  assert.equal(isInstant(new Date()), true);
  assert.equal(isInstant(1_755_800_000_000), true);
  assert.equal(isInstant('2026-08-21T19:00:00Z'), true);
  assert.equal(isInstant('2026-08-21T19:00'), false);
  assert.equal(isInstant('2026-08-21'), false);
});

test('eine zonenlose Wanduhrzeit wird GELESEN, nicht gerechnet', () => {


  withZone('Asia/Tokyo', () => {
    assert.equal(zonedTimeKey('2026-08-21T19:00'), '19:00');
    assert.equal(zonedDateKey('2026-08-21T19:00'), '2026-08-21');
  });



  withZone('America/Los_Angeles', () => {
    assert.equal(zonedTimeKey('2026-08-21T19:00'), '19:00');
    assert.equal(zonedDateKey('2026-08-21T19:00'), '2026-08-21');
  });
});

test('ein reines Datum hat keine Uhrzeit und bleibt in jeder Zone derselbe Tag', () => {
  for (const zone of ['Asia/Tokyo', 'America/Los_Angeles', 'UTC', 'Pacific/Kiritimati']) {
    withZone(zone, () => {
      assert.equal(zonedDateKey('2026-08-21'), '2026-08-21', `Zone ${zone}`);
    });
  }
});

test('ein Instant wird in die Anzeigezone umgerechnet', () => {

  withZone('Asia/Tokyo', () => {
    assert.equal(zonedDateKey('2026-08-21T23:30:00Z'), '2026-08-22');
    assert.equal(zonedTimeKey('2026-08-21T23:30:00Z'), '08:30');
  });

  withZone('America/Los_Angeles', () => {
    assert.equal(zonedDateKey('2026-08-21T23:30:00Z'), '2026-08-21');
    assert.equal(zonedTimeKey('2026-08-21T23:30:00Z'), '16:30');
  });
});

test('derselbe Zeitpunkt aus beiden Speicherformen zeigt dieselbe Uhrzeit', () => {

  // Zeit, einmal lokal angelegt (Wanduhr) und einmal ueber Google


  withZone('Europe/Berlin', () => {
    assert.equal(zonedTimeKey('2026-08-21T19:00'), '19:00');
    assert.equal(zonedTimeKey('2026-08-21T17:00:00Z'), '19:00');   // Sommerzeit: UTC+2
  });
});

test('ueber die DST-Grenze folgt der Offset der Zone, nicht einem Fixwert', () => {
  withZone('Europe/Berlin', () => {
    assert.equal(zonedTimeKey('2026-01-15T17:00:00Z'), '18:00');   // Winter: UTC+1
    assert.equal(zonedTimeKey('2026-07-15T17:00:00Z'), '19:00');   // Sommer: UTC+2
  });
});

// --------------------------------------------------------

// --------------------------------------------------------

test('ohne Einstellung ist die Anzeigezone null - also die des Browsers', () => {
  setDisplayTimeZone(null);
  assert.equal(displayTimeZone(), null);

  assert.equal(zonedDateKey('2026-08-21T23:30:00Z'), '2026-08-21');
  assert.equal(zonedTimeKey('2026-08-21T23:30:00Z'), '19:30');
});

test('ohne Einstellung liefert zonedFields exakt die Browser-Getter', () => {
  setDisplayTimeZone(null);
  const d = new Date('2026-08-21T23:30:45Z');
  assert.deepEqual(zonedFields(d), {
    year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
    hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(),
  });
});

test('eine unbekannte oder unsinnige Zone faellt zurueck statt zu werfen', () => {
  setDisplayTimeZone('Mars/Olympus_Mons');
  assert.equal(displayTimeZone(), null);
  setDisplayTimeZone('');
  assert.equal(displayTimeZone(), null);
  setDisplayTimeZone(undefined);
  assert.equal(displayTimeZone(), null);
  assert.equal(isValidTimeZone('Europe/Berlin'), true);
  assert.equal(isValidTimeZone('nonsense'), false);
});

// --------------------------------------------------------

// --------------------------------------------------------

test('todayKey liefert den Tag der Haushaltszone, nicht den des Browsers', () => {

  // schon der 22. um 04:30.
  const now = new Date('2026-08-22T02:30:00Z');
  withZone('Europe/Berlin', () => {
    assert.equal(todayKey(now), '2026-08-22');
  });


  setDisplayTimeZone(null);
  assert.equal(todayKey(now), '2026-08-21');
});

test('date.js exportiert todayKey und reicht die Anzeigezone durch', () => {
  withZone('Asia/Tokyo', () => {
    const viaDateUtils = dateUtils.todayKey();
    assert.equal(viaDateUtils, todayKey());
    assert.match(viaDateUtils, /^\d{4}-\d{2}-\d{2}$/);
  });
});

// --------------------------------------------------------

// --------------------------------------------------------

test('der Round-Trip Key -> Date -> Key ueberlebt jede Anzeigezone', () => {




  const keys = ['2026-01-01', '2026-08-21', '2026-12-31', '2026-03-29'];
  for (const zone of ['Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati', null]) {
    withZone(zone, () => {
      for (const key of keys) {
        assert.equal(
          dateUtils.toLocalDateKey(dateUtils.parseLocalDateKey(key)), key,
          `Zone ${zone}, Key ${key}`
        );
      }
    });
  }
});

test('addLocalDays und monthPeriodKeys bleiben zonenfest', () => {
  withZone('Pacific/Kiritimati', () => {
    assert.equal(dateUtils.addLocalDays('2026-08-31', 1), '2026-09-01');
    assert.deepEqual(dateUtils.monthPeriodKeys('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  });
});

// --------------------------------------------------------

// --------------------------------------------------------

test('Mitternacht wird nicht als Stunde 24 durchgereicht', () => {



  withZone('Europe/Berlin', () => {
    assert.equal(zonedTimeKey('2026-08-23T22:00:00Z'), '00:00');
    assert.equal(zonedDateKey('2026-08-23T22:00:00Z'), '2026-08-24');
    const f = zonedFields('2026-08-23T22:00:00Z');
    assert.equal(f.day, 24, 'der 24. darf nicht mit der Stunden-Korrektur kollidieren');
  });
});

test('zonedWeekday zaehlt wie getDay (0=Sonntag) und folgt der Zone', () => {
  withZone('Asia/Tokyo', () => {

    assert.equal(zonedWeekday('2026-08-21T23:30:00Z'), 6);
  });
  withZone('America/Los_Angeles', () => {

    assert.equal(zonedWeekday('2026-08-21T23:30:00Z'), 5);
  });
});

test('unlesbare Werte geben leer zurueck statt zu werfen', () => {
  for (const bad of [null, undefined, '', 'kein datum', NaN, new Date('x')]) {
    assert.equal(zonedFields(bad), null, String(bad));
    assert.equal(zonedDateKey(bad), '');
    assert.equal(zonedTimeKey(bad), '');
  }
});

// --------------------------------------------------------

// --------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, '..', 'public');

function jsFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'vendor' || entry === 'locales') continue;
      jsFiles(full, out);
    } else if (entry.endsWith('.js') && !entry.endsWith('.min.js')) {
      out.push(full);
    }
  }
  return out;
}

function withoutComments(text) {
  return text.split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');
}

const SOURCES = jsFiles(PUBLIC).map((file) => {
  const text = readFileSync(file, 'utf8');
  return { file, rel: path.relative(PUBLIC, file), text, code: withoutComments(text) };
});

test('der Guard sieht ueberhaupt Dateien - sonst waere er gruen und blind', () => {
  assert.ok(SOURCES.length > 50, `nur ${SOURCES.length} Dateien gefunden`);
  assert.ok(SOURCES.some((s) => s.rel === 'i18n.js'));
  assert.ok(SOURCES.some((s) => s.rel === path.join('pages', 'calendar.js')));
});

test('formatDate/formatTime bekommen keinen Date-Umweg um einen Datums-Key', () => {


  // direkt hinein - formatDate() kennt die reine Datumsform.
  const pattern = /format(?:Date|DayMonth|Time)\(\s*new Date\(\s*`\$\{[^`]*\}T00:00:00`/;
  const offenders = SOURCES.filter((s) => pattern.test(s.code)).map((s) => s.rel);
  assert.deepEqual(offenders, [], 'Datums-Key direkt an formatDate() uebergeben');
});

test('ausser utils/timezone.js liest kein Modul eine Uhrzeit aus einem Instant', () => {




  const pattern = /new Date\(\s*(?:[A-Za-z_$][\w$.?[\]]*|`[^`]*`|'[^']*'|"[^"]*")\s*\)\s*\.\s*get(?:Hours|Minutes|Date|FullYear|Month|Day)\(/;
  const allowed = new Set([
    path.join('utils', 'timezone.js'),
    path.join('utils', 'date.js'),
  ]);
  const offenders = SOURCES
    .filter((s) => !allowed.has(s.rel) && pattern.test(s.code))
    .map((s) => s.rel);
  assert.deepEqual(offenders, [], 'Uhrzeit/Tag aus der Browser-Zone eines Instants abgeleitet');
});

test('kein Frontend-Modul baut sich sein eigenes "jetzt" aus der Browser-Uhr', () => {
  const allowed = new Set([
    path.join('utils', 'timezone.js'),
    'theme-init.js',
  ]);

  const offenders = [];
  for (const s of SOURCES) {
    if (allowed.has(s.rel)) continue;
    const lines = s.code.split('\n');
    lines.forEach((line, i) => {

      const bound = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new Date\(\s*\)/.exec(line);
      if (bound) {
        const window = lines.slice(i, i + 12).join('\n');
        const getter = new RegExp(`\\b${bound[1]}\\.get(?:Hours|Minutes|Date|Day|FullYear|Month)\\(`);
        if (getter.test(window)) offenders.push(`${s.rel}:${i + 1} (${bound[1]})`);
        return;
      }
      if (/new Date\(\s*\)\s*\.\s*get(?:Hours|Minutes|Date|Day|FullYear|Month)\(/.test(line)) {
        offenders.push(`${s.rel}:${i + 1}`);
      }
    });
  }

  assert.deepEqual(offenders, [],
    'ein "jetzt" aus der Browser-Uhr statt aus der Anzeigezone - `nowFields()` bzw. `todayKey()` fragen');
});

test('kein Frontend-Modul vergleicht Kalendertage ueber toDateString()', () => {
  const offenders = [];
  for (const s of SOURCES) {
    if (s.rel === path.join('utils', 'timezone.js')) continue;
    s.code.split('\n').forEach((line, i) => {
      if (/\.toDateString\(\s*\)/.test(line)) offenders.push(`${s.rel}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [],
    'Kalendertage ueber toDateString() verglichen - das ist die Browser-Zone, `zonedDateKey()`/`todayKey()` nehmen');
});

test('der Guard erkennt die Schreibweise, an der er vorbeigesehen hat', () => {


  const bound = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new Date\(\s*\)/;
  assert.ok(bound.test('const now = new Date();'));
  assert.ok(bound.test('  let today = new Date()'));

  assert.equal(bound.test('const d = new Date(iso);'), false);
  assert.equal(bound.test('const d = new Date(y, m, 1);'), false);
});

test('utils/timezone.js ist die einzige Stelle mit einem zonenbehafteten Formatter', () => {



  // Anzeigezone berechneten Felder, datepicker.js ein reines Kalenderraster).
  const offenders = [];
  for (const s of SOURCES) {
    if (s.rel === path.join('utils', 'timezone.js')) continue;
    for (const m of s.code.matchAll(/timeZone:\s*([^,\n}]+)/g)) {
      const value = m[1].trim();
      if (value !== "'UTC'" && value !== '"UTC"') offenders.push(`${s.rel}: ${value}`);
    }
  }
  assert.deepEqual(offenders, [], 'zweiter zonenbehafteter Formatter neben utils/timezone.js');
});

test('i18n.js formatiert ueber zonedFields, nicht ueber die Browser-Getter', () => {
  const src = SOURCES.find((s) => s.rel === 'i18n.js').text;
  assert.match(src, /import \{[^}]*zonedFields[^}]*\} from '\.\/utils\/timezone\.js'/);

  for (const fn of ['formatDateParts', 'formatDayMonth', 'formatTime']) {
    const body = src.slice(src.indexOf(`function ${fn}(`));
    const end = body.indexOf('\n}\n');
    assert.match(body.slice(0, end), /zonedFields\(/, `${fn} geht nicht ueber zonedFields`);
  }
});

test('meals.js leitet den Wochentag ueber zonedWeekday ab', () => {
  const src = SOURCES.find((s) => s.rel === path.join('pages', 'meals.js')).code;
  assert.match(src, /zonedWeekday\(/);
});

test('der Kalender liest Tag und Uhrzeit eines Termins ueber die Anzeigezone', () => {
  const src = SOURCES.find((s) => s.rel === path.join('pages', 'calendar.js')).text;
  assert.match(src, /import \{[^}]*zonedDateKey[^}]*\} from '\/utils\/timezone\.js'/);
  for (const fn of ['localDate', 'localTime']) {
    const body = src.slice(src.indexOf(`function ${fn}(`));
    assert.match(body.slice(0, body.indexOf('\n}\n')), /zoned(?:Date|Time)Key\(/, `${fn}`);
  }
});

test('die Haushaltszone wird beim Laden und beim Umstellen gespiegelt', () => {
  const router = SOURCES.find((s) => s.rel === 'router.js').text;
  assert.match(router, /setDisplayTimeZone\(res\?\.data\?\.timezone/,
    'router.js spiegelt die Zone nicht aus /preferences');


  // umstellen.
  assert.doesNotMatch(router, /setDisplayTimeZone\([^)]*timezone_effective/,
    'router.js spiegelt die Rueckfallkette statt der getroffenen Wahl');
  assert.match(router, /addEventListener\('timezone-changed'/,
    'router.js zeichnet nach einem Zonenwechsel nicht neu');

  const settings = SOURCES.find((s) => s.rel === path.join('settings', 'pages', 'personal-appearance.js')).text;
  assert.match(settings, /setDisplayTimeZone\(/, 'die Settings-Seite spiegelt die Zone nicht');
  assert.match(settings, /dispatchEvent\(new CustomEvent\('timezone-changed'/,
    'ein Zonenwechsel loest kein Neuzeichnen aus');


  assert.match(settings, /timezone:\s*loaded\.timezone/,
    'render() reicht die gewaehlte Zone nicht an das Formular durch');
  assert.match(settings, /timezone_effective:\s*loaded\.timezone_effective/,
    'render() reicht die geltende Zone nicht an das Automatik-Label durch');
});
