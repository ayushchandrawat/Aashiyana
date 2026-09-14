
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const reLiteral = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, (ch) => `\\${ch}`);

const detailJs   = () => read('public/components/detail-view.js');
const detailCss  = () => read('public/styles/detail-view.css');
const modalJs    = () => read('public/components/modal.js');
const calendarJs = () => read('public/pages/calendar.js');
const tasksJs    = () => read('public/pages/tasks.js');
const taskDetailJs = () => read('public/components/task-detail.js');
const dashboardJs  = () => read('public/pages/dashboard.js');
const contactsJs = () => read('public/pages/contacts.js');
const rruleJs    = () => read('public/rrule-ui.js');




const NEW_KEYS = {
  calendar:  ['detailWhen', 'detailCalendar', 'openInMap'],
  reminders: ['sectionTitlePlural'],
  rrule:     ['summaryUntil', 'summaryCount', 'summaryCount_one'],
  tasks:     ['statusLabel', 'detailStart', 'detailFinish', 'detailReopen', 'subtasksLabel', 'swipeView'],
};


const REMOVED_KEYS = { calendar: ['popupEdit'], tasks: ['swipeEdit'] };

// --------------------------------------------------------
// Komponente
// --------------------------------------------------------

test('detail-view.js exportiert die öffentliche API', async () => {
  const src = await detailJs();
  assert.match(src, /export function openDetailView\(/, 'openDetailView muss exportiert sein');
  assert.match(src, /export function closeDetailView\(/, 'closeDetailView muss exportiert sein');
  assert.match(src, /export function detailRowEl\(/, 'der Zeilen-Renderer muss wiederverwendbar sein');
});

test('die Komponente baut DOM, statt Markup zu setzen', async () => {
  const src = await detailJs();
  assert.doesNotMatch(src, /\.innerHTML\s*=/, 'kein innerHTML');
  assert.doesNotMatch(src, /insertAdjacentHTML/, 'auch kein Markup-String über insertAdjacentHTML');
  assert.match(src, /createElement/, 'Elemente über createElement');
  assert.match(src, /textContent\s*=/, 'Werte als Text, nicht als Markup');
});

test('Präsentationsweiche verlangt Breakpoint UND Anker', async () => {
  const src = await detailJs();
  assert.match(src, /POPOVER_MIN_WIDTH\s*=\s*768/, 'Breakpoint bei 768px');
  assert.match(
    src,
    /window\.innerWidth\s*>=\s*POPOVER_MIN_WIDTH\s*&&\s*!!opts\.anchor/,
    'Popover nur, wenn beides zutrifft - sonst Sheet',
  );
});

test('der Wechsel ins Formular löst die drei Fallen in fester Reihenfolge', async () => {
  const src = await detailJs();
  const form = src.slice(src.indexOf('function switchToForm'), src.indexOf('function switchToDetail'));
  assert.ok(form.length > 0, 'switchToForm muss existieren');
  assert.match(form, /opts\.edit\.mount\(/, 'das Formular entsteht erst beim Wechsel (Lazy Mount)');
  assert.match(form, /mountFooter\(/, 'Falle 2: die Formular-Fußzeile muss ans Panel');
  assert.match(form, /refreshDirtySnapshot\(/, 'Falle 1: die Dirty-Basis muss nachgezogen werden');
  assert.match(form, /focusFirstField\(/, 'Falle 3: der Fokus muss bewusst gesetzt werden');
});

test('das nachgeladene Formular bekommt seine Lucide-Icons (#1141)', async () => {
  const src = await detailJs();
  const form = src.slice(src.indexOf('function switchToForm'), src.indexOf('function switchToDetail'));





  // Aufgaben-Notiz.
  const mountIdx = form.indexOf('opts.edit.mount(');
  const iconsIdx = form.indexOf('renderIcons(pane)');
  assert.ok(mountIdx > -1 && iconsIdx > -1, 'renderIcons(pane) muss nach dem Mount stehen');
  assert.ok(iconsIdx > mountIdx, 'die Icons muessen NACH dem Einfuegen des Formular-Markups erzeugt werden');
});

test('„Abbrechen" wirkt auch in einem nachträglich gebauten Formular (#738)', async () => {
  const src = await modalJs();
  const open = src.slice(src.indexOf('export function openModal'), src.indexOf('export async function closeModal'));


  // „Bearbeiten" (switchToForm → edit.mount, siehe Test oben). Wer die

  // Formular nie - sein „Abbrechen" tat sichtbar nichts.
  assert.doesNotMatch(
    open,
    /querySelectorAll\(\s*'\[data-action="close-modal"\]'\s*\)[\s\S]{0,120}addEventListener/,
    'einmaliges Verdrahten je Knoten erreicht kein später gebautes Formular'
  );
  assert.match(
    open,
    /addEventListener\('click',[\s\S]{0,200}closest\('\[data-action="close-modal"\]'\)/,
    'die Abbrechen-Knöpfe müssen delegiert am Overlay hängen'
  );
});

test('die Module mit Leseansicht nutzen genau diese Abbrechen-API (#738)', async () => {



  for (const [name, src] of [
    ['tasks.js', await tasksJs()],
    ['recipes.js', await read('public/pages/recipes.js')],
    ['shopping.js', await read('public/pages/shopping.js')],
  ]) {
    assert.match(src, /data-action="close-modal"/, `${name} baut sein Abbrechen über die geteilte API`);
  }
});

test('die Dirty-Basis wird nur beim ersten Mount gezogen', async () => {
  const src = await detailJs();
  const form = src.slice(src.indexOf('function switchToForm'), src.indexOf('function switchToDetail'));



  assert.match(form, /if \(firstMount\) refreshDirtySnapshot\(\)/, 'sonst friert der zweite Besuch die Eingaben als „unverändert" ein');
});

test('nachgereichte Zeilen landen nie in einer fremden Ansicht', async () => {
  const src = await detailJs();


  assert.match(src, /let activeViewToken = 0/, 'jede Ansicht bekommt eine Nummer');
  assert.match(src, /if \(activeViewToken !== token\) return false/, 'update verwirft sich für abgelöste Ansichten');


  assert.match(src, /onClose\(\)\s*\{[\s\S]*?activeViewToken === token[\s\S]*?activeViewToken = 0/, 'das Sheet invalidiert beim Schließen');







  const popoverHead = src.slice(
    src.indexOf('function openAsPopover'),
    src.indexOf('const popover = document.createElement'),
  );
  assert.doesNotMatch(popoverHead, /closeDetailView\(\)/, 'openAsPopover darf sich nicht selbst die Nummer löschen');

  const api = src.slice(src.indexOf('export function openDetailView'));
  const close = api.indexOf('closeDetailView(');
  const assign = api.indexOf('activeViewToken = token');
  assert.ok(close > -1 && assign > close, 'erst die alte Ansicht schließen, dann nummerieren');
});

test('der Wechsel ins Formular ist gegen Doppelklick gesperrt', async () => {
  const src = await detailJs();
  const form = src.slice(src.indexOf('async function switchToForm'), src.indexOf('function switchToDetail'));


  assert.match(form, /state\.mode !== 'detail'/, 'nur aus der Leseansicht heraus');
  assert.match(form, /state\.mode = 'switching'/, 'Zwischenzustand vor dem await');
});

test('der Kopf-Button im Formular verspricht kein Speichern', async () => {
  const src = await detailJs();
  const form = src.slice(src.indexOf('function switchToForm'), src.indexOf('function switchToDetail'));


  assert.match(form, /label: t\('common\.back'\)/, 'der Knopf wechselt die Ansicht, er übernimmt nichts');
  assert.doesNotMatch(form, /common\.done/, '„Fertig" verspricht ein Speichern, das nicht stattfindet');
});

test('beide Fußzeilen werden aufbewahrt statt verworfen', async () => {
  const src = await detailJs();
  assert.match(src, /function detachFooter\(/, 'Fußzeilen werden abgehängt, nicht entfernt');
  assert.match(src, /state\.detailFooter/, 'die Detail-Fußzeile überlebt den Wechsel');
  assert.match(src, /state\.formFooter/, 'die Formular-Fußzeile überlebt den Rückwechsel');
});

test('das Popover ist bedienbar ohne Maus und gibt den Fokus zurück', async () => {
  const src = await detailJs();
  const popover = src.slice(src.indexOf('function openAsPopover'));
  assert.match(popover, /role', 'dialog'|setAttribute\('role', 'dialog'\)/, 'als Dialog ausgezeichnet');
  assert.match(popover, /aria-labelledby/, 'mit dem Titel verknüpft');
  assert.match(popover, /'Escape'/, 'Escape schließt');
  assert.match(popover, /e\.key !== 'Tab'|'Tab'/, 'Tab bleibt im Popover');


  assert.match(popover, /merker: rememberFocus\(opts\.anchor\)/, 'der Auslöser wird beim Öffnen gemerkt');
  assert.match(popover, /restoreFocusAfterClose\(merker\)/, 'und beim Schließen zurückgegeben');
});

test('die Detailansicht öffnet ohne Autofokus', async () => {
  const src = await detailJs();
  assert.match(src, /initialFocus:\s*'none'/, 'kein Feldfokus - sonst fährt die Tastatur hoch');
});

// --------------------------------------------------------
// modal.js: das Fundament
// --------------------------------------------------------

test('modal.js exportiert die Bausteine des Pane-Wechsels', async () => {
  const src = await modalJs();
  assert.match(src, /export function refreshDirtySnapshot\(/);
  assert.match(src, /export function mountFooter\(/);
  assert.match(src, /export function focusFirstField\(/);
  assert.match(src, /export function updateHeaderAction\(/);
});

test('initialFocus ist rückwärtskompatibel voreingestellt', async () => {
  const src = await modalJs();
  assert.match(
    src,
    /initialFocus\s*=\s*'first-field'/,
    "Default bleibt 'first-field', damit bestehende Modals unverändert öffnen",
  );
  assert.match(src, /if \(initialFocus === 'none'\) return;/, "'none' unterdrückt den Autofokus");
});

test('nach dem Wechsel entscheidet die Zeigerfähigkeit über den Fokus', async () => {
  const src = await modalJs();
  const fn = src.slice(src.indexOf('export function focusFirstField'));
  assert.match(fn, /\(pointer: coarse\)/, 'auf Fingergeräten kein Feldfokus');
  assert.match(fn, /modal-panel__title/, 'stattdessen der Panel-Kopf');
});

test('mountFooter räumt eine bereits gehobene Fußzeile weg', async () => {
  const src = await modalJs();
  const fn = src.slice(src.indexOf('export function mountFooter'), src.indexOf('export function updateHeaderAction'));
  assert.match(fn, /modal-panel__footer/, 'sucht die Fußzeile im Body');
  assert.match(fn, /setAttribute\('form'/, 'verankert Submit-Buttons am Formular (#543)');
  assert.match(fn, /\.remove\(\)/, 'entfernt die Fußzeile der vorigen Ansicht');
});

// --------------------------------------------------------
// Kalender
// --------------------------------------------------------

test('das alte Termin-Popup ist rückstandslos entfernt', async () => {
  const js = await calendarJs();
  const css = await read('public/styles/calendar.css');
  assert.doesNotMatch(js, /showEventPopup/, 'showEventPopup ist weg');
  assert.doesNotMatch(js, /event-popup/, 'keine .event-popup-Klassen mehr im Modul');
  assert.doesNotMatch(css, /\.event-popup/, 'kein .event-popup-Block mehr im CSS');
});

test('jeder Weg zu einem Termin führt in die Detailansicht', async () => {
  const src = await calendarJs();
  assert.match(src, /async function openEventDetail\(ev, anchor = null\)/, 'ein einziger Einstieg');
  assert.match(src, /import \{ openDetailView.*\} from '\/components\/detail-view\.js'/);



  const editCalls = [...src.matchAll(/openEventModal\(\{[^}]*mode:\s*'edit'/g)];
  assert.equal(
    editCalls.length,
    1,
    "nur der Desktop-Popover-Rückfall darf noch direkt ins Bearbeiten-Formular führen",
  );
  assert.match(src, /standalone:\s*async\s*\(\)\s*=>\s*\{[\s\S]*?openEventModal\(/, 'und zwar als edit.standalone');
});

test('das Formular wartet auf die Erinnerungen, die Leseansicht nicht', async () => {
  const src = await calendarJs();
  const fn = src.slice(src.indexOf('async function openEventDetail'), src.indexOf('async function loadReminderForEvent'));



  const load = fn.indexOf('loadReminderForEvent(');
  const open = fn.indexOf('openDetailView(');
  assert.ok(load > -1 && open > -1, 'beide Aufrufe müssen existieren');
  assert.doesNotMatch(
    fn.slice(load, open),
    /await\s+loadReminderForEvent/,
    'kein await zwischen Laden und Öffnen - der Tap muss sofort etwas zeigen',
  );



  assert.match(fn, /ready:\s*remindersReady/, 'der Wechsel ins Formular wartet auf die Erinnerungen');
  assert.match(fn, /standalone:\s*async[\s\S]*?await remindersReady/, 'der Desktop-Weg ebenso');
  assert.match(fn, /view\.update\(/, 'die Erinnerungszeile wird nachgetragen');
});

test('ein neuer Termin startet weiterhin direkt im Formular', async () => {
  const src = await calendarJs();
  assert.match(src, /openEventModal\(\{ mode: 'create' \}\)/, 'der Anlege-Pfad bleibt unangetastet');
});

test('die Termin-Verdrahtung ist zweigeteilt', async () => {
  const src = await calendarJs();
  assert.match(src, /function wireEventForm\(panel, \{ mode, event = null, reminder = null \}\)/);
  assert.match(src, /onSave\(panel\) \{ wireEventForm\(panel/, 'openEventModal nutzt dieselbe Verdrahtung');
  assert.match(src, /mount: \(panel, pane\) =>/, 'die Detailansicht mountet das Formular später');


  // verschenkt.
  const wire = src.slice(src.indexOf('function wireEventForm'));
  assert.match(wire, /loadSyncTargets\(/, 'loadSyncTargets läuft im Formular-Mount');
});

test('die Termin-Detailansicht zeigt, was das alte Popup verschwieg', async () => {
  const src = await calendarJs();
  const fn = src.slice(src.indexOf('function renderEventDetail'), src.indexOf('async function openEventDetail'));
  assert.match(fn, /recurrenceRow\(ev\.recurrence_rule\)/, 'Wiederholung im Klartext');
  assert.match(fn, /reminderSummary\(/, 'Erinnerungen im Klartext');
  assert.match(fn, /visibilityRow\(ev\.visibility\)/, 'Sichtbarkeit');
  assert.match(fn, /assignedRow\(ev\.assigned_users/, 'Zugewiesene über die geteilte Zeile');
});

test('der Ort öffnet sich als ausdrückliche Aktion in einer Karte, nicht als Link auf dem Text (#1110)', async () => {
  const src = await calendarJs();
  const fn = src.slice(src.indexOf('async function openEventDetail'), src.indexOf('async function loadReminderForEvent'));



  assert.match(fn, /const mapUrl = eventMapUrl\(ev\.location\);\s*if \(mapUrl\) \{\s*actions\.push\(\{/,
    'nur mit Ort gibt es die Aktion');
  assert.match(fn, /id: 'detail-open-map'/);
  assert.match(fn, /label: t\('calendar\.openInMap'\)/);
  assert.match(fn, /window\.open\(mapUrl, '_blank', 'noopener'\)/,
    'neuer Tab ohne Zugriff zurück auf die App - wie der vCard-Export in Kontakte');


  const detail = src.slice(src.indexOf('function renderEventDetail'), src.indexOf('async function openEventDetail'));
  assert.match(detail, /\{ icon: 'map-pin', label: t\('calendar\.locationLabel'\), value: ev\.location \? fmtLocation\(ev\.location\) : '' \}/);
});

test('die Kartensuche räumt den Ortstext über das ECHTE fmtLocation auf (#1110)', async () => {



  const { fmtLocation } = await import('../public/utils/html.js');
  assert.equal(fmtLocation('Rathaus\\nMarktplatz 1\\, 12345 Musterstadt'), 'Rathaus, Marktplatz 1, 12345 Musterstadt',
    'eine ICS-escapte, mehrzeilige Adresse wird EINE Suchzeile');
  assert.equal(fmtLocation('\\n'), '', 'nur ein escapter Umbruch: nichts zu suchen, also keine Aktion');
  assert.equal(fmtLocation(' , ; '), '', 'nur Trenner: ebenso');


  const src = await calendarJs();
  const fn = src.slice(src.indexOf('function eventMapUrl'), src.indexOf('function renderEventDetail'));
  assert.match(fn, /const query = fmtLocation\(location \?\? ''\)\.trim\(\);/);
  assert.match(fn, /return query \? `https:\/\/www\.openstreetmap\.org\/search\?query=\$\{encodeURIComponent\(query\)\}` : '';/);
});

test('die Weiterleitung für Haushaltshilfe-Besuche greift vor der Detailansicht', async () => {
  const src = await calendarJs();
  const fn = src.slice(src.indexOf('async function openEventDetail'));
  const guard = fn.indexOf('housekeeping_visit_id');
  const open = fn.indexOf('openDetailView(');
  assert.ok(guard > -1 && guard < open, 'sonst führte der Weg über die Detailansicht ins Leere');
});

// --------------------------------------------------------
// Aufgaben
// --------------------------------------------------------

test('jeder Weg zu einer bestehenden Aufgabe führt in die Detailansicht', async () => {
  const src = await tasksJs();


  assert.match(await taskDetailJs(), /export function openTaskDetail\(\{/);



  // Einstieg soll diesen Test rot machen, damit jemand entscheidet, wohin er

  const detailCalls = [...src.matchAll(/^\s+openTaskView\(task, reminder, container\);$/gm)];
  assert.equal(detailCalls.length, 5, 'Listenzeile/Stift, Kanban, Wischen, Deep-Link und Verlauf');



  const modalCalls = [...src.matchAll(/^\s+openTaskModal\(\{.*\}, container\);$/gm)];
  assert.equal(modalCalls.length, 1, 'nur der Anlege-Pfad öffnet noch direkt das Formular');
  assert.match(src, /openTaskModal\(\{ users: state\.users \}, container\)/, 'und zwar ohne task');
});

test('die Wisch-Geste heißt Ansehen, nicht Bearbeiten', async () => {
  const src = await tasksJs();
  assert.match(src, /tasks\.swipeView/, 'neuer Schlüssel');
  assert.doesNotMatch(src, /tasks\.swipeEdit/, 'der alte ist ersetzt, nicht umgedeutet');
});

test('die Aufgaben-Verdrahtung ist zweigeteilt und behält die Tag-Reihenfolge', async () => {
  const src = await tasksJs();
  assert.match(src, /function wireTaskForm\(panel, \{ task = null, container = null, onChanged = \(\) => loadTasks\(container\) \}\)/);





  const mountStart = src.indexOf('mount: (panel, pane) =>');
  const mount = src.slice(mountStart, src.indexOf('wireTaskForm(panel, { task, container });', mountStart));
  assert.ok(mount.length > 0, 'der Mount-Block muss auffindbar sein');
  const tags = mount.indexOf('modalTags =');
  const render = mount.indexOf('renderModalContent(');
  assert.ok(tags > -1 && render > -1 && tags < render, 'modalTags wird vor dem Rendern gesetzt');
});


test('die Leseansicht ist nicht an ihr Modul genagelt (#918)', async () => {
  const detail = await taskDetailJs();



  assert.doesNotMatch(detail, /\bstate\.\w/, 'die Komponente liest keinen fremden Seiten-State');
  assert.doesNotMatch(detail, /loadTasks\(/, 'sie laedt keine fremde Liste nach');
  for (const field of ['users', 'currentUserId', 'isAdmin', 'categories', 'onChanged']) {
    assert.match(detail, new RegExp('\\b' + reLiteral(field) + '\\b'), field + ' kommt ueber den Aufruf');
  }


  // wegnavigierten, oeffnen jetzt genau diese.
  const dash = await dashboardJs();
  assert.match(dash, /openTaskById\(taskId, \{ user, container, onChanged: rerender \}\)/,
    'die Uebersicht oeffnet die geteilte Ansicht');
  assert.doesNotMatch(dash, /openTaskQuickAction/,
    'das Zwei-Knopf-Kaertchen ist ersetzt, nicht daneben stehen geblieben');





  assert.match(await taskDetailJs(), /currentUserId,\s*isAdmin,/,
    'die Komponente nimmt den Betrachter entgegen');

  const cal = await calendarJs();
  assert.match(cal, /user: state\.user,/, 'der Kalender reicht den Betrachter durch');
  assert.doesNotMatch(cal, /navigate\(`\/tasks\?open=/,
    'ein Aufgaben-Chip wirft den Nutzer nicht mehr aus dem Kalender');
  assert.match(cal, /openTaskFromCalendar\(taskChip\.dataset\.taskId\)/,
    'er oeffnet die Aufgabe an Ort und Stelle');
});

test('der Kontext erreicht JEDEN Knoten der Leseansicht (#918)', async () => {
  const detail = await taskDetailJs();
  // Ein einziger vergessener Durchgriff reicht: `commentRowNode` liest



  const calls = detail.match(/commentRowNode\(comment,\s*\{[^}]*\}/g) ?? [];
  assert.ok(calls.length >= 2, 'beide Aufrufer von commentRowNode muessen auffindbar sein');
  for (const call of calls) {
    assert.match(call, /\bctx\b/, `commentRowNode ohne Kontext: ${call}`);
  }
  for (const fn of ['commentTextNode', 'wireMentionSuggest', 'subtaskListNode', 'commentsNode']) {
    for (const call of detail.match(new RegExp(reLiteral(fn) + '\\([^)]*\\)', 'g')) ?? []) {
      if (call.startsWith(fn + '(function') || /^\w+\(\s*\w+\s*,\s*ctx\s*\)$/.test(call)) continue;
      assert.match(call, /\bctx\b/, `${fn} ohne Kontext: ${call}`);
    }
  }
});

test('der Rueckgaengig-Streifen blendet JEDE Darstellung der Aufgabe aus (#918)', async () => {
  const detail = await taskDetailJs();
  const fn = detail.slice(detail.indexOf('function taskRowsIn('),
                          detail.indexOf('export async function deleteTaskWithUndo('));
  assert.ok(fn.length > 0, 'taskRowsIn ist nicht mehr auffindbar');




  // Sekunden lang „geloescht", waehrend die Zeile klickbar stehen blieb.
  assert.match(fn, /data-task-id=/, 'die Listen-Schreibweise');
  assert.match(fn, /data-object-kind="task"/, 'die Uebersicht-Schreibweise');
  assert.match(fn, /querySelectorAll/,
    'dieselbe Aufgabe kann zugleich im Cockpit und im Dringend-Widget stehen');


  // Guard ueber eine leere Menge.
  const dash = await dashboardJs();
  assert.match(dash, /data-object-kind="\$\{esc\(row\.kind\)\}" data-object-id=/,
    'die Cockpit-Zeile benennt ihr Objekt');
  assert.match(dash, /class="task-item" data-task-id=/, 'die Widget-Zeile nennt ihre Aufgabe');
});

test('wer die Aufgabe von aussen oeffnet, bekommt ihr Blatt (#918)', async () => {





  const src = await tasksJs();
  assert.match(src, /function ensureTaskStyles\(\)/, 'der Einstieg von aussen stellt das Blatt sicher');
  const fn = src.slice(src.indexOf('function ensureTaskStyles()'),
                       src.indexOf('export async function openTaskById('));
  assert.match(fn, /link\.onload/, 'und WARTET darauf - sonst steht der Inhalt einmal roh da');
  assert.match(fn, /link\.onerror/, 'ein fehlendes Blatt darf die Aufgabe nicht verschlucken');
  assert.match(src, /ensureTaskStyles\(\),/,
    'der Aufruf haengt im selben await wie das Laden der Aufgabe');




  const { eachRule } = await import('./css-rules.js');
  const selektoren = [...eachRule(await read('public/styles/tasks.css'))]
    .map((r) => r.selector).join('\n');
  const detail = await taskDetailJs();
  const klassen = new Set();
  for (const m of detail.matchAll(/className = '([^']+)'/g)) {
    for (const c of m[1].split(/\s+/)) if (c) klassen.add(c);
  }
  assert.ok(klassen.size >= 15,
    `nur ${klassen.size} Klassen gefunden - das Muster passt nicht mehr auf die Komponente`);



  const ausTasksCss = [...klassen].filter((c) =>
    new RegExp('\\.' + reLiteral(c) + '(?![\\w-])').test(selektoren));
  assert.ok(ausTasksCss.length >= 5,
    'die Leseansicht bezieht kaum noch etwas aus tasks.css - dann sichert dieser Guard nichts: '
    + ausTasksCss.join(', '));
});
test('derselbe Loeschbefehl verhaelt sich auf beiden Wegen gleich (#918)', async () => {
  const src = await tasksJs();




  const block = src.slice(src.indexOf('export async function openTaskById('));
  assert.match(block, /wireTaskForm\(panel, \{ task, container, onChanged \}\)/,
    'das von aussen gemountete Formular bekommt seinen Container');
  assert.doesNotMatch(block, /container: null/,
    'ein genullter Container nimmt dem Loeschen sein optimistisches Ausblenden');
});

test('ohne Auswahl wird kein Bearbeiten angeboten (#918)', async () => {
  const src = await tasksJs();
  const block = src.slice(src.indexOf('export async function openTaskById('));



  assert.match(block, /const canOfferEdit = state\.categories\.length > 0/,
    'die Bedingung fuer ein brauchbares Formular ist benannt');
  assert.match(block, /edit: !canOfferEdit \? null :/,
    'ohne sie faellt der Bearbeiten-Knopf weg statt in einen Fehler zu fuehren');
});
test('der Status lässt sich aus der Detailansicht weiterschalten', async () => {
  const src = await taskDetailJs();
  assert.match(src, /const NEXT_STATUS = \{/, 'die Kette open → in_progress → done ist benannt');
  assert.match(src, /open:\s*\{ status: 'in_progress'/);
  assert.match(src, /in_progress:\s*\{ status: 'done'/);
  assert.match(src, /done:\s*\{ status: 'open'/);
  assert.doesNotMatch(src, /archived:\s*\{ status:/, 'archivierte Aufgaben werden nicht weitergeschaltet');

  const fn = src.slice(src.indexOf('async function advanceTaskStatus'));
  assert.match(fn, /api\.patch\(`\/tasks\/\$\{task\.id\}\/status`/, 'nutzt die bestehende Route');
  assert.match(fn, /task\.status = previous;/, 'rollt bei Fehler zurück');
  assert.match(fn, /showToast\(/, 'und meldet den Fehler');
});

test('die Aufgaben-Detailansicht führt die Leseinformationen der Karte', async () => {
  const src = await taskDetailJs();
  const fn = src.slice(src.indexOf('function renderTaskDetail'), src.indexOf('export function openTaskDetail'));
  for (const key of ['tasks.statusLabel', 'tasks.priorityLabel', 'tasks.dueDateLabel', 'tasks.startDateLabel',
    'tasks.categoryLabel', 'tasks.pointsLabel', 'tasks.tagsLabel',
    'tasks.subtasksLabel', 'tasks.documentsLabel', 'tasks.descriptionLabel']) {
    assert.match(fn, new RegExp(reLiteral(key)), `${key} fehlt in der Detailansicht`);
  }


  assert.match(fn, /recurrenceRow\(task\.recurrence_rule[),]/, 'Wiederholung über die geteilte Zeile');
  assert.match(fn, /visibilityRow\(task\.visibility\)/, 'Sichtbarkeit über die geteilte Zeile');
  assert.match(fn, /assignedRow\(task\.assigned_users/, 'Zugewiesene über die geteilte Zeile');
});




test('die geteilten Zeilen tragen Icon und Beschriftung', async () => {
  const rrule = await rruleJs();
  const repeat = rrule.slice(rrule.indexOf('export function recurrenceRow'));
  assert.match(repeat, /icon: 'repeat'/, 'Wiederholungs-Icon');
  assert.match(repeat, /rrule\.labelRepeat/, 'Beschriftung der Wiederholungszeile');
  assert.match(repeat, /describeRRule\(rule[),]/, 'Klartext aus describeRRule');

  const detail = await detailJs();
  const assigned = detail.slice(detail.indexOf('export function assignedRow'));

  assert.match(assigned, /names\.length > 1 \? 'users' : 'user'/, 'Icon folgt der Anzahl');
  assert.match(assigned, /fallbackName/, 'freier Name als Rückfall (Kalender)');
});

test('Fußzeilen-Aktionen schließen die Detailansicht mit force', async () => {


  const HANDLER = /onClick:\s*(async\s*)?\(\s*\{[^}]*\bclose\b[^}]*\}\s*\)\s*=>/;
  const CLOSE_CALL = /(?<![.\w])close\s*\(/;
  const WINDOW = 16;
  const violations = [];



  const pages = [
    ['calendar.js', await calendarJs()],
    ['tasks.js',    await tasksJs()],
    ['contacts.js', await contactsJs()],
  ];
  for (const [name, src] of pages) {
    const lines = src.split('\n');
    lines.forEach((line, index) => {
      if (!HANDLER.test(line)) return;
      const indent = line.search(/\S/);

      for (let offset = 0; offset <= WINDOW; offset += 1) {
        const candidate = lines[index + offset];
        if (candidate === undefined) break;


        if (offset > 0 && /^\s*\}/.test(candidate) && candidate.search(/\S/) <= indent) break;
        if (!CLOSE_CALL.test(candidate) || /force/.test(candidate)) continue;
        violations.push(`${name}:${index + offset + 1}: ${candidate.trim()}`);
      }
    });
  }

  assert.deepEqual(violations, [],
    'close() einer Fußzeilen-Aktion braucht { force: true } - siehe closeDetailView');
});

// --------------------------------------------------------
// Kontakte
// --------------------------------------------------------

test('beide Kontakt-Einstiege führen in die Leseansicht', async () => {
  const src = await contactsJs();



  assert.match(src, /if \(c\) openContactDetail\(c\)/, 'Antippen in der Liste');
  assert.match(src, /if \(contact\) openContactDetail\(contact\)/, 'Deep-Link ?open=<id>');


  assert.match(src, /openContactModal\(\{ mode: 'create'/, 'Neuanlage weiterhin direkt ins Formular');
});

test('der Wechsel ins Formular wartet auf die nachgeladenen Mehrfachwerte', async () => {
  const src = await contactsJs();





  const fn = src.slice(src.indexOf('function openContactDetail'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /const ready = fetchFullContact\(/, 'Einzelabruf als ready-Promise');
  assert.match(body, /\bready,/, 'ready wird an edit übergeben');
  assert.match(body, /mount: \(panel, pane\)/, 'Formular entsteht erst beim Wechsel');
  assert.match(body, /buildContactForm\(\{ mode: 'edit', contact: full \}\)/,
    'das Formular bekommt den nachgeladenen Kontakt, nicht den Listeneintrag');
});

test('die Leseansicht führt alle Nummern, Mails und Adressen', async () => {
  const src = await contactsJs();
  const fn = src.slice(src.indexOf('function renderContactDetail'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));



  for (const [group, legacy] of [['phones', 'phone'], ['emails', 'email'], ['addresses', 'address']]) {
    assert.ok(body.includes(`contact.${group}?.length`),
      `${group} muss als Mehrfachwert gelesen werden`);
    assert.ok(body.includes(`contact.${legacy}`),
      `${legacy} bleibt der Rückfall, solange der Einzelabruf noch läuft`);
  }


  for (const field of ['organization', 'job_title', 'website', 'nickname']) {
    assert.ok(body.includes(`contact.${field}`), `${field} gehört in die Leseansicht`);
  }
});

test('Kontaktdaten kommen als Text ins DOM, nie als Markup', async () => {
  const src = await contactsJs();
  const fn = src.slice(src.indexOf('function contactLinksNode'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));



  assert.match(body, /\.textContent = /, 'Werte über textContent setzen');
  assert.doesNotMatch(body, /insertAdjacentHTML|innerHTML/, 'kein Markup-Pfad für Kontaktdaten');
});

test('alle Locales tragen die neuen Kontakt-Schlüssel', async () => {
  const dir = new URL('../public/locales/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 23, `erwartet mindestens 23 Locales, gefunden ${files.length}`);

  for (const file of files) {
    const json = JSON.parse(await readFile(new URL(file, dir), 'utf8'));
    for (const key of ['organizationLabel', 'websiteLabel', 'nicknameLabel']) {
      assert.ok(json.contacts?.[key], `${file}: contacts.${key} fehlt oder ist leer`);



      assert.ok(!json.shopping?.[key], `${file}: contacts.${key} liegt im falschen Block (shopping)`);
    }
  }
});

// --------------------------------------------------------
// Wiederholung im Klartext
// --------------------------------------------------------

test('describeRRule beschreibt Rhythmus, Tage und Ende', async () => {
  const src = await rruleJs();
  assert.match(src, /export function describeRRule\(/);
  const fn = src.slice(src.indexOf('export function describeRRule'));
  assert.match(fn, /if \(!p\.freq\) return '';/, 'ohne Regel keine Zeile');
  assert.match(fn, /p\.freq === 'WEEKLY' && p\.byday\.length/, 'Wochentage nur bei WEEKLY');
  assert.match(fn, /rrule\.summaryCount/, 'COUNT wird benannt');
  assert.match(fn, /rrule\.summaryUntil/, 'UNTIL wird benannt');
  assert.match(fn, /·/, 'die Endebedingung bekommt einen Trenner');
});

// --------------------------------------------------------
// CSS
// --------------------------------------------------------

test('detail-view.css deckt beide Präsentationen und Bewegungsreduktion ab', async () => {
  const css = await detailCss();
  assert.match(css, /\.detail-view\s*\{/);
  assert.match(css, /\.detail-row\s*\{/);
  assert.match(css, /\.detail-view__accent\s*\{/);
  assert.match(css, /\.detail-popover\s*\{/, 'Popover-Variante');
  assert.match(css, /prefers-reduced-motion/, 'Bewegungsreduktion');
  assert.match(css, /\.modal-panel--resizing/, 'Höhenübergang des Sheets');
});

test('detail-view.css nutzt ausschließlich Tokens', async () => {
  const css = await detailCss();
  const body = css.replace(/\/\*[\s\S]*?\*\//g, ''); // Kommentare erklären Werte, sie setzen keine
  assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/, 'kein rohes Hex');
  assert.doesNotMatch(body, /:\s*-?\d+(\.\d+)?(px|rem|em)\b/, 'keine rohen Längen');
  assert.doesNotMatch(body, /rgba?\(/, 'keine rohen Farben');
});

test('die Detailansicht ist in der Shell eingebunden', async () => {
  const html = await read('public/index.html');
  assert.match(html, /styles\/detail-view\.css/, 'geteilte Komponenten-CSS gehört in die Shell');
});

test('Komponente und Stil liegen im Precache', async () => {
  const sw = await read('public/sw.js');
  assert.match(sw, /'\/components\/detail-view\.js'/, 'sonst fehlt sie offline');
  assert.match(sw, /'\/styles\/detail-view\.css'/);
});

// --------------------------------------------------------
// i18n
// --------------------------------------------------------

test('alle Locales tragen die neuen Schlüssel (nicht leer)', async () => {
  const dir = new URL('../public/locales/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 20, 'der volle Locale-Satz wird erwartet');

  for (const file of files) {
    const json = JSON.parse(await readFile(new URL(file, dir), 'utf8'));
    for (const [group, keys] of Object.entries(NEW_KEYS)) {
      for (const key of keys) {
        const value = json[group]?.[key];
        assert.equal(typeof value, 'string', `${file}: ${group}.${key} muss ein String sein`);
        assert.ok(value.trim().length > 0, `${file}: ${group}.${key} darf nicht leer sein`);
      }
    }
  }
});

test('die Zähl-Variante trägt in jeder Locale ihren Platzhalter', async () => {
  const dir = new URL('../public/locales/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const json = JSON.parse(await readFile(new URL(file, dir), 'utf8'));
    assert.match(json.rrule.summaryCount, /\{\{count\}\}/, `${file}: {{count}} fehlt`);
    assert.match(json.rrule.summaryCount_one, /\{\{count\}\}/, `${file}: _one braucht denselben Platzhalter`);
    assert.match(json.rrule.summaryUntil, /\{\{date\}\}/, `${file}: {{date}} fehlt`);
  }
});

test('die abgelösten Schlüssel sind überall entfernt', async () => {
  const dir = new URL('../public/locales/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const json = JSON.parse(await readFile(new URL(file, dir), 'utf8'));
    for (const [group, keys] of Object.entries(REMOVED_KEYS)) {
      for (const key of keys) {
        assert.equal(json[group]?.[key], undefined, `${file}: ${group}.${key} ist abgelöst und muss weg`);
      }
    }
  }
});
