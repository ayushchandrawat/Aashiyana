import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const LOCALE_DIR = new URL('../public/locales/', import.meta.url);
const localeFile = (locale) => JSON.parse(readFileSync(new URL(`${locale}.json`, LOCALE_DIR), 'utf8'));

const flattenLocale = (obj, prefix = '', out = new Map()) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flattenLocale(v, key, out);
    else out.set(key, v);
  }
  return out;
};


const store = new Map();
global.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
global.document = { documentElement: { lang: '', dir: '' } };
global.window = { dispatchEvent: () => {}, matchMedia: () => ({ matches: false }) };
global.CustomEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
global.fetch = async (url) => {
  const locale = String(url).replace('/locales/', '').replace('.json', '');
  return { ok: true, json: async () => localeFile(locale) };
};
Object.defineProperty(global, 'navigator', {
  value: { languages: ['de-DE'], language: 'de-DE' },
  writable: true,
  configurable: true,
});

const { initI18n, setLocale, t } = await import('../public/i18n.js');
await initI18n();

test('Deutsch: Singular und Plural je nach count', async () => {
  await setLocale('de');
  assert.equal(t('settings.enabledReminderListCount', { count: 1 }), '1 Erinnerungsliste aktiviert');
  assert.equal(t('settings.enabledReminderListCount', { count: 2 }), '2 Erinnerungslisten aktiviert');
  assert.equal(t('settings.enabledReminderListCount', { count: 0 }), '0 Erinnerungslisten aktiviert');
});

test('Englisch: Singular und Plural je nach count', async () => {
  await setLocale('en');
  assert.equal(t('settings.enabledReminderListCount', { count: 1 }), '1 reminder list enabled');
  assert.equal(t('settings.enabledReminderListCount', { count: 3 }), '3 reminder lists enabled');
  assert.equal(t('settings.calendarImport.success', { count: 1 }), '1 event imported.');
  assert.equal(t('settings.calendarImport.success', { count: 4 }), '4 events imported.');
});

test('Kalender-Override-Bestätigung lokalisiert genau den bestätigten count', async () => {
  await setLocale('de');
  assert.equal(
    t('calendar.overrideOrphanConfirmTitle', { count: 1 }),
    '1 bearbeiteten Termin beibehalten?',
  );
  assert.equal(
    t('calendar.overrideOrphanConfirmTitle', { count: 3 }),
    '3 bearbeitete Termine beibehalten?',
  );
  await setLocale('en');
  assert.equal(
    t('calendar.overrideOrphanConfirmTitle', { count: 1 }),
    'Keep 1 edited occurrence?',
  );
  assert.equal(
    t('calendar.overrideOrphanConfirmTitle', { count: 3 }),
    'Keep 3 edited occurrences?',
  );
});

test('Sprachen ohne Zahlflexion liefern für jede Anzahl denselben Satz', async () => {
  await setLocale('ja');
  const one = t('settings.enabledReminderListCount', { count: 1 });
  const many = t('settings.enabledReminderListCount', { count: 5 });
  assert.equal(one.replace('1', 'N'), many.replace('5', 'N'));
});

test('Polnisch: fehlende few/many-Variante fällt auf den Basisschlüssel zurück', async () => {
  await setLocale('pl');
  // pl kennt one/few/many/other; hinterlegt sind Basis + _one. Kein Absturz,

  for (const count of [1, 2, 5, 22]) {
    assert.match(t('settings.enabledReminderListCount', { count }), /Włączone listy przypomnień: \d+/);
  }
});

test('„N von M"-Zähler nutzt bei einem Eintrag die Singularform', async () => {


  await setLocale('de');
  assert.equal(
    t('settings.addressbooksEnabledOfTotal', { enabled: 1, total: 1, count: 1 }),
    '1 von 1 Adressbuch aktiv',
  );
  assert.equal(
    t('settings.addressbooksEnabledOfTotal', { enabled: 1, total: 3, count: 3 }),
    '1 von 3 Adressbüchern aktiv',
  );
  await setLocale('en');
  assert.equal(
    t('settings.calendarsEnabledOfTotal', { enabled: 0, total: 1, count: 1 }),
    '0 of 1 calendar active',
  );
  assert.equal(
    t('settings.calendarsEnabledOfTotal', { enabled: 2, total: 4, count: 4 }),
    '2 of 4 calendars active',
  );
});

test('Standard-Punkte (#578): zählende Strings nutzen die Singularform', async () => {

  // formuliert („1 Aufgaben aktualisiert").
  await setLocale('de');
  assert.equal(t('tasks.pointsSummary', { count: 1 }), '1 Punkt');
  assert.equal(t('tasks.pointsSummary', { count: 10 }), '10 Punkte');
  assert.equal(t('settings.rewardsDefaultPointsRebased', { count: 1 }), '1 Aufgabe aktualisiert.');
  assert.equal(t('settings.rewardsDefaultPointsRebased', { count: 3 }), '3 Aufgaben aktualisiert.');
  assert.match(t('settings.rewardsDefaultPointsRebaseTitle', { count: 1, from: 10, to: 15 }), /^1 Aufgabe von 10 auf 15 /);

  await setLocale('en');
  assert.equal(t('tasks.pointsSummary', { count: 1 }), '1 point');
  assert.equal(t('tasks.pointsSummary', { count: 4 }), '4 points');
  assert.equal(t('settings.rewardsDefaultPointsRebased', { count: 1 }), '1 task updated.');
  assert.equal(t('settings.rewardsDefaultPointsRebased', { count: 2 }), '2 tasks updated.');
});

test('Garantie-Restlaufzeit (Inventar, Stufe 4): zählender String nutzt die Singularform', async () => {


  // dort "in 1 Tagen".
  await setLocale('de');
  assert.equal(t('inventory.warrantyStatusExpiringSoon', { count: 1 }), 'Garantie läuft in 1 Tag ab');
  assert.equal(t('inventory.warrantyStatusExpiringSoon', { count: 12 }), 'Garantie läuft in 12 Tagen ab');

  await setLocale('en');
  assert.equal(t('inventory.warrantyStatusExpiringSoon', { count: 1 }), 'Warranty ends in 1 day');
  assert.equal(t('inventory.warrantyStatusExpiringSoon', { count: 30 }), 'Warranty ends in 30 days');
});

test('Schlüssel ohne Pluralvarianten funktionieren unverändert', async () => {
  await setLocale('de');
  assert.equal(t('common.save'), localeFile('de').common.save);

  assert.equal(
    t('settings.enabledReminderListCount', { count: 7 }),
    '7 Erinnerungslisten aktiviert',
  );
});

test('unbekannter Schlüssel liefert den Schlüssel selbst zurück - auch mit count', async () => {
  await setLocale('de');
  assert.equal(t('gibt.es.nicht'), 'gibt.es.nicht');
  assert.equal(t('gibt.es.nicht', { count: 2 }), 'gibt.es.nicht');
});

test('jede Pluralvariante hat einen zählenden Basisschlüssel in allen Locales', () => {
  const files = readdirSync(LOCALE_DIR).filter((f) => f.endsWith('.json'));


  for (const file of files) {
    const entries = flattenLocale(JSON.parse(readFileSync(new URL(file, LOCALE_DIR), 'utf8')));
    for (const [key, value] of entries) {
      if (!/_(zero|one|two|few|many|other)$/.test(key)) continue;
      if (typeof value !== 'string' || !value.includes('{{count}}')) continue;
      const base = key.replace(/_(zero|one|two|few|many|other)$/, '');
      assert.ok(entries.has(base), `${file}: ${key} ohne Basisschlüssel ${base}`);
      assert.match(entries.get(base), /\{\{count\}\}/, `${file}: ${base} zählt nicht`);
    }
  }
});

// ---------------------------------------------------------------------------

//




// CI - „1 Dateien hochladen".
//



//




//


// Text andere Platzhalter interpoliert - `settings.addressbooksEnabledOfTotal` macht




//



// so durchgefallen sind).
// ---------------------------------------------------------------------------

const PLURAL_EXCEPTIONS = {

  'contacts.selectCount': 'NO_NOUN',
  'contacts.importSelectedStatus': 'NO_NOUN',
  'contacts.importDetailBirthday': 'NO_NOUN',
  'contacts.importDetailFailed': 'NO_NOUN',
  'documents.selectCount': 'NO_NOUN',
  'tasks.bulkSelectedCount': 'NO_NOUN',
  'dashboard.todayShoppingCount': 'NO_NOUN',
  'dashboard.rewardsPending': 'NO_NOUN',
  'dashboard.healthRefill': 'NO_NOUN',
  'health.labs.abnormalBadge': 'NO_NOUN',
  'subscriptions.activeCount': 'NO_NOUN',
  'budget.loansSummary': 'NO_NOUN',

  // --- Zahl in Klammern / hinter Doppelpunkt ------------------------------
  'category.errorInUse': 'PARENTHETICAL',
  'category.errorSubInUse': 'PARENTHETICAL',
  'shopping.clearChecked': 'PARENTHETICAL',
  'contacts.importSubmit': 'PARENTHETICAL',
  'health.cycle.settings.applyToAllDone': 'PARENTHETICAL',

  // --- numerusneutrale Abkuerzung ----------------------------------------
  'settings.calendarDurationMinutes': 'ABBREV',

  // --- handgebaute Paare, alte Schreibweise -------------------------------
  'search.resultCountOne': 'PAIR_LEGACY',
  'search.resultCountMany': 'PAIR_LEGACY',
  'contacts.countMany': 'PAIR_LEGACY',
  'contacts.importedCountToast': 'PAIR_LEGACY',
  'contacts.importedCountToastSingular': 'PAIR_LEGACY',
  'dashboard.eventsChip': 'PAIR_LEGACY',
  'dashboard.eventsChipPlural': 'PAIR_LEGACY',
  'dashboard.urgentTasksChip': 'PAIR_LEGACY',
  'dashboard.urgentTasksChipPlural': 'PAIR_LEGACY',
  'dashboard.overdueTasksChip': 'PAIR_LEGACY',
  'dashboard.overdueTasksChipPlural': 'PAIR_LEGACY',
  'reminders.pendingBadgeTitle': 'PAIR_LEGACY',
  'reminders.pendingBadgeTitlePlural': 'PAIR_LEGACY',

  // --- `count` ist kein Zaehler ------------------------------------------
  // fmtNum() (health.js:1256) liefert einen fertig formatierten String bzw. '–'.

  'health.meds.doseQty': 'NOT_A_COUNT',

  // --- n=1 am Aufrufer ausgeschlossen ------------------------------------
  // subscriptions.js:135 - `cycle_interval === 1 ? t(key) : t('everyCycle', …)`.
  'subscriptions.everyCycle': 'GUARDED',

  'settings.calendarDefaultRemindersMax': 'GUARDED',
  // subscriptions.js:150-154 - dueLabel() faengt d<0, d===0 und d===1 vorher ab,

  'subscriptions.dueInDays': 'GUARDED',

  // --- echte Luecken, eingefroren statt behoben ---------------------------

  'dashboard.housekeepingVisitsMonth': 'TODO_ONE',  // dashboard.js:2138, `visits` ungefiltert


  'documents.folderUpload.fileConflictsTitle': 'TODO_ONE',
  'documents.folderUpload.folderConflictsTitle': 'TODO_ONE',
  'documents.folderUpload.rejectedTitle': 'TODO_ONE',
  'dashboard.shoppingMore': 'TODO_ONE',             // dashboard.js:1485/2987/3530, Guard ist `> 0`
  'calendar.moreEvents': 'TODO_ONE',
  'calendar.searchCount': 'TODO_ONE',
  'contacts.bulkDeletedToast': 'TODO_ONE',
  'contacts.importSkippedNote': 'TODO_ONE',
  'birthdays.importSelected': 'TODO_ONE',
  'birthdays.importSubmit': 'TODO_ONE',
  'birthdays.importSuccess': 'TODO_ONE',
  'documents.bulkArchivedToast': 'TODO_ONE',
  'documents.bulkDeleteConfirm': 'TODO_ONE',
  'documents.bulkDeletedToast': 'TODO_ONE',
  'documents.bulkMovedToast': 'TODO_ONE',
  'documents.bulkRestoredToast': 'TODO_ONE',
  'documents.bulkUploadedToast': 'TODO_ONE',
  'documents.selectedFilesLabel': 'TODO_ONE',
  'budget.chartSummary': 'TODO_ONE',
  'budget.statsDonutSummary': 'TODO_ONE',
  'health.labs.analyteCount': 'TODO_ONE',
  'health.cycle.status.inDays': 'TODO_ONE',
  'health.cycle.status.overdue': 'TODO_ONE',
  'inventory.navLabelAttention': 'TODO_ONE',        // router-Badge, Guard ist `> 0`
  'tasks.navLabelOverdue': 'TODO_ONE',              // router.js:1151, Guard ist `> 0`
  'subscriptions.listCount': 'TODO_ONE',
  'subscriptions.overdueDays': 'TODO_ONE',
  'subscriptions.reminderMeta': 'TODO_ONE',
  'subscriptions.metaInUseWarning': 'TODO_ONE',
  'settings.recipeProviderDeleteAccountConfirm': 'TODO_ONE',



  // nicht dynamisch zusammengesetzt. Aufraeumen: eigener Vorgang.
  'housekeeping.monthTotal': 'DEAD_KEY',
  'housekeeping.moreWorkers': 'DEAD_KEY',
  'tasks.overdueDay': 'DEAD_KEY',
  'tasks.bulkDeleteConfirm': 'DEAD_KEY',
};

test('ein zaehlender Schluessel ohne Variante steht in der Ausnahmekarte (#1010)', () => {
  const entries = flattenLocale(localeFile('de'));
  const ohneVariante = [];
  for (const [key, value] of entries) {
    if (/_(zero|one|two|few|many|other)$/.test(key)) continue;
    if (typeof value !== 'string' || !value.includes('{{count}}')) continue;



    const variante = entries.get(`${key}_one`);
    if (typeof variante === 'string' && variante.trim() !== '') continue;
    ohneVariante.push(key);
  }

  const neu = ohneVariante.filter((k) => !(k in PLURAL_EXCEPTIONS));
  assert.deepEqual(neu, [],
    'Neue zaehlende Schluessel ohne `_one`-Variante. Entweder eine Variante anlegen '
    + '(public/locales/*.json, alle Sprachen) oder mit begruendeter Kategorie in '
    + `PLURAL_EXCEPTIONS eintragen: ${neu.join(', ')}`);





  const veraltet = Object.keys(PLURAL_EXCEPTIONS).filter((k) => !ohneVariante.includes(k));
  assert.deepEqual(veraltet, [],
    `Ausnahmekarte veraltet - diese Schluessel brauchen keine Ausnahme mehr: ${veraltet.join(', ')}`);
});







test('jede _one-Variante traegt in JEDER Locale einen brauchbaren Wert (#1010)', () => {
  const referenz = flattenLocale(localeFile('de'));
  const varianten = [...referenz.keys()].filter((k) => k.endsWith('_one'));
  assert.ok(varianten.length > 50,
    `nur ${varianten.length} _one-Varianten gefunden - misst der Filter noch?`);

  const kaputt = [];
  for (const file of readdirSync(LOCALE_DIR).filter((f) => f.endsWith('.json'))) {
    const entries = flattenLocale(JSON.parse(readFileSync(new URL(file, LOCALE_DIR), 'utf8')));
    for (const key of varianten) {
      const wert = entries.get(key);
      if (wert === undefined) { kaputt.push(`${file}: ${key} fehlt`); continue; }
      if (typeof wert !== 'string' || wert.trim() === '') {
        kaputt.push(`${file}: ${key} = ${JSON.stringify(wert)}`);
      }
    }
  }
  assert.deepEqual(kaputt, [],
    `unbrauchbare Singular-Varianten (leer, null oder keine Zeichenkette): ${kaputt.join(', ')}`);
});

// ---------------------------------------------------------------------------
// Platzhalter-Ersetzung
//


// weiterer Platzhalter.
// ---------------------------------------------------------------------------

test('Werte mit Ersetzungssyntax werden wörtlich eingesetzt', async () => {
  await setLocale('de');



  assert.equal(t('birthdays.calendarEventTitle', { name: 'A $& B' }), 'Geburtstag: A $& B');
  assert.equal(t('birthdays.calendarEventTitle', { name: 'X $` Y' }), 'Geburtstag: X $` Y');
  assert.equal(t('birthdays.calendarEventTitle', { name: "Z $' W" }), "Geburtstag: Z $' W");
  assert.equal(t('birthdays.calendarEventTitle', { name: 'P $$ Q' }), 'Geburtstag: P $$ Q');
});

test('ein Wert, der wie ein Platzhalter aussieht, wird nicht erneut ersetzt', async () => {
  await setLocale('de');


  assert.equal(
    t('birthdays.calendarEventDescription', { name: '{{date}}', date: '01.01.2000' }),
    'Geburtstagserinnerung für {{date}} (01.01.2000).',
  );
});

test('unbekannte Platzhalter bleiben sichtbar stehen', async () => {
  await setLocale('de');

  assert.equal(
    t('birthdays.calendarEventDescription', { name: 'Emma' }),
    'Geburtstagserinnerung für Emma ({{date}}).',
  );
});

test('Zahlen und Pluralformen ersetzen weiterhin normal', async () => {
  await setLocale('de');
  assert.equal(t('settings.enabledReminderListCount', { count: 1 }), '1 Erinnerungsliste aktiviert');
  assert.equal(t('settings.enabledReminderListCount', { count: 7 }), '7 Erinnerungslisten aktiviert');
});

// Deliberately kept at the existing end-of-file boundary: #1055 adds its own
// plural regression after the English baseline, so this placement avoids an
// otherwise content-free merge conflict between the independent changes.
test('Notiz-Kategorieueberlauf benennt eine und mehrere weitere Kategorien', async () => {
  await setLocale('en');
  assert.equal(t('noteCategories.moreAction', { count: 1 }), '1 more category');
  assert.equal(t('noteCategories.moreAction', { count: 2 }), '2 more categories');

  await setLocale('cs');
  assert.equal(t('noteCategories.moreAction', { count: 1 }), '1 další kategorie');
  assert.equal(t('noteCategories.moreAction', { count: 3 }), '3 další kategorie');
  assert.equal(t('noteCategories.moreAction', { count: 5 }), '5 dalších kategorií');
});
