import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  adressenImStrom, beurteile, bejaht, bejahtIrgendwo, zaehleBelege, zaehleSeit
} from '../.github/scripts/review-verdict.mjs';

const fixture = JSON.parse(
  readFileSync(new URL('./review-proof-fixture.json', import.meta.url), 'utf8')
);

const alleAeusserungen = [
  ...fixture.aeusserungen.zusammenfassungen,
  ...fixture.aeusserungen.reviews,
  ...fixture.aeusserungen.inline
];

const wieGesehen = (lauf) =>
  alleAeusserungen.filter((a) => a.zeit !== '' && a.zeit <= fixture.laeufe[lauf].ende);

const ECHTE_REVIEW = '34315259346';
const ABBRUCH_LAUF = '34320151190';
const SAUBER = '34316389826';
const seit = (lauf) => fixture.laeufe[lauf].beginn;
const kopf = (lauf) => fixture.laeufe[lauf].head;
const ABBRUCH = fixture.ergebnisse['abbruch-schon-kommentiert'];
const NICHTS = { adressen: 0, erfolge: 0 };

const geliefert = () => zaehleBelege(fixture.strom.gepostet, wieGesehen(SAUBER), seit(SAUBER));

test('DER FALL AUS #1066: alter Kommentar plus neuer Push wird rot', () => {

  // 05:57:53Z, 06:04:45Z), danach kam Push 8a87a5cd. Der Lauf dazu dauerte

  const urteil = beurteile({
    seit: seit(ABBRUCH_LAUF),
    ergebnis: ABBRUCH,
    aeusserungen: wieGesehen(ABBRUCH_LAUF)
  });
  assert.equal(urteil.ausgang, 'stumm', 'dieser Stand ist ungeprueft und muss rot sein');
  assert.equal(urteil.grund, 'schon-kommentiert');
  assert.match(urteil.meldung, /UNGEPRUEFT/);
});

test('und genau diese Lage haette der alte Nachweis gruen genannt', () => {


  // claude-Kommentar") erfuellt - dreifach sogar.
  const gesehen = wieGesehen(ABBRUCH_LAUF);
  const ueberDieGanzeLebensdauer = gesehen.filter((a) =>
    a.login.toLowerCase().includes('claude')
  ).length;



  assert.equal(
    ueberDieGanzeLebensdauer,
    5,
    'ohne alte claude-Zeilen stellt diese Probe den Fehlerfall gar nicht nach'
  );
  assert.equal(zaehleSeit(gesehen, seit(ABBRUCH_LAUF), kopf(ABBRUCH_LAUF)).gesamt, 0);
});

test('derselbe PR, der Lauf, der wirklich geprueft hat: gruen', () => {



  const urteil = beurteile({
    seit: seit(ECHTE_REVIEW),
    kopf: kopf(ECHTE_REVIEW),
    ergebnis: fixture.ergebnisse['echte-review'],
    aeusserungen: wieGesehen(ECHTE_REVIEW)
  });
  assert.equal(urteil.ausgang, 'geprueft');
  assert.equal(urteil.grund, 'gebunden', 'Review und Inline nennen genau diesen Commit');




  assert.equal(urteil.neu, 2, 'Review und Inline-Anmerkung von 05:41:30Z');
});

test('fremde Stimmen zaehlen nicht, auch wenn sie fleissig sind', () => {


  // ganze Zeit gruen gewesen.
  const waehrendDesLaufs = alleAeusserungen.filter(
    (a) => a.zeit > seit(ABBRUCH_LAUF) && a.zeit <= '2026-09-09T06:55:00Z'
  );
  assert.ok(waehrendDesLaufs.length > 0, 'nach diesem Push wurde sehr wohl geredet');
  assert.ok(
    waehrendDesLaufs.some((a) => a.login.includes('codex')),
    'und zwar unter anderem von codex'
  );
  assert.equal(zaehleSeit(waehrendDesLaufs, seit(ABBRUCH_LAUF), kopf(ABBRUCH_LAUF)).gesamt, 0);
});

test('der triviale Abbruch bleibt gruen, sagt aber, dass er nichts geprueft hat', () => {



  const urteil = beurteile({
    seit: seit(ABBRUCH_LAUF),
    ergebnis: fixture.ergebnisse['abbruch-trivial'],
    aeusserungen: wieGesehen(ABBRUCH_LAUF)
  });
  assert.equal(urteil.ausgang, 'ausgesetzt');
  assert.equal(urteil.grund, 'trivial');
  assert.match(urteil.meldung, /nicht "geprueft"/);
});

test('nennt ein Text beides, gilt die gefaehrlichere Lesart', () => {


  const urteil = beurteile({
    seit: seit(ABBRUCH_LAUF),
    ergebnis: {
      num_turns: 3,
      subtype: 'success',
      is_error: false,
      permission_denials: [],
      result:
        'Claude has already commented on this PR, and the new commit is a ' +
        'trivial change that is obviously correct, so this matches the step 1 ' +
        'stop condition. Stopping here.'
    },
    aeusserungen: wieGesehen(ABBRUCH_LAUF)
  });
  assert.equal(urteil.ausgang, 'stumm');
  assert.equal(urteil.grund, 'schon-kommentiert');
});

test('"has not previously commented" ist kein Abbruch aus diesem Grund', () => {


  assert.match(fixture.ergebnisse['abbruch-trivial'].result, /has not previously commented/);
  assert.equal(
    beurteile({
      seit: seit(ABBRUCH_LAUF),
      ergebnis: fixture.ergebnisse['abbruch-trivial'],
      aeusserungen: wieGesehen(ABBRUCH_LAUF)
    }).grund,
    'trivial'
  );
});

test('ohne Stand wird rot, nicht gruen', () => {

  // laesst JEDE Aeusserung als "neu" durchgehen.
  for (const kaputt of ['', undefined, '2026-09-09', '2026-09-09T06:40:30+00:00']) {
    const urteil = beurteile({ seit: kaputt, ergebnis: ABBRUCH, aeusserungen: wieGesehen(ABBRUCH_LAUF) });
    assert.equal(urteil.ausgang, 'stumm', `Stand ${JSON.stringify(kaputt)} muss rot werden`);
    assert.equal(urteil.grund, 'kein-stand');
  }
});

test('ein unlesbares result-Objekt wird rot und nennt seinen eigenen Grund', () => {
  const urteil = beurteile({ seit: seit(ABBRUCH_LAUF), ergebnis: null, aeusserungen: wieGesehen(ABBRUCH_LAUF) });
  assert.equal(urteil.ausgang, 'stumm');
  assert.equal(urteil.grund, 'kein-ergebnis');
});

test('unlesbare Kommentar-Zeilen werden nicht als Schweigen gelesen', () => {


  const urteil = beurteile({
    seit: seit(ABBRUCH_LAUF),
    ergebnis: ABBRUCH,
    aeusserungen: wieGesehen(ABBRUCH_LAUF),
    kaputt: 1
  });
  assert.equal(urteil.grund, 'daten-kaputt');
});

test('die bekannten Fehlschlaege behalten ihre eigene Diagnose', () => {
  const faelle = [
    [{ permission_denials: [{ tool_name: 'Bash' }], result: 'ready to post' }, 'werkzeugsperre'],
    [
      { permission_denials: [], result: "I'll wait for both background agents to complete." },
      'agenten'
    ],
    [{ permission_denials: [], result: 'Done.' }, 'unbekannt'],
    [{ permission_denials: [], is_error: true, result: 'boom' }, 'lauf-fehler'],
    [{ permission_denials: [], subtype: 'error_max_turns', result: 'boom' }, 'lauf-fehler']
  ];
  for (const [ergebnis, grund] of faelle) {
    const urteil = beurteile({ seit: seit(ABBRUCH_LAUF), ergebnis, aeusserungen: wieGesehen(ABBRUCH_LAUF) });
    assert.equal(urteil.ausgang, 'stumm');
    assert.equal(urteil.grund, grund);
  }
});

test('zaehleSeit vergleicht die Zeitstempel und nicht die Reihenfolge', () => {
  const liste = [
    { login: 'claude[bot]', zeit: '2026-09-09T06:40:29Z' },
    { login: 'claude[bot]', zeit: '2026-09-09T06:40:30Z' },
    { login: 'claude[bot]', zeit: '2026-09-09T06:40:31Z' },
    { login: 'Claude[BOT]', zeit: '2026-09-09T07:00:00Z' },
    { login: 'claude[bot]', zeit: '' }
  ];

  assert.equal(zaehleSeit(liste, '2026-09-09T06:40:30Z').gesamt, 2);
});

test('gebunden und ungebunden werden getrennt gezaehlt', () => {


  const liste = [
    { login: 'claude[bot]', zeit: '2026-09-09T06:00:00Z', commit: 'aaa' },
    { login: 'claude[bot]', zeit: '2026-09-09T06:00:00Z', commit: 'bbb' },
    { login: 'claude[bot]', zeit: '2026-09-09T06:00:00Z', commit: null }
  ];
  const zahl = zaehleSeit(liste, '2026-09-09T05:00:00Z', 'aaa');
  assert.deepEqual(zahl, { gebunden: 1, frei: 2, gesamt: 3 });
});

// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------

test('eine FREMDE claude-Aeusserung faerbt einen Abbruch nicht gruen', () => {





  // result-Objekt ueberhaupt gelesen wurde.
  const fremd = [
    ...wieGesehen(ABBRUCH_LAUF),
    { login: 'claude[bot]', zeit: '2026-09-09T06:41:00Z', commit: null }
  ];
  const urteil = beurteile({
    seit: seit(ABBRUCH_LAUF),
    kopf: kopf(ABBRUCH_LAUF),
    ergebnis: ABBRUCH,
    aeusserungen: fremd
  });
  assert.equal(urteil.ausgang, 'stumm', 'das Protokoll des Laufs schlaegt die Zaehlung');
  assert.equal(urteil.grund, 'schon-kommentiert');
});

test('eine VERNEINTE Tor-Bedingung ist keine Ausnahme', () => {
  // "the stop condition does not apply because this is not trivial" trug beide

  const urteil = beurteile({
    seit: seit(ABBRUCH_LAUF),
    kopf: kopf(ABBRUCH_LAUF),
    ergebnis: {
      num_turns: 6,
      subtype: 'success',
      is_error: false,
      permission_denials: [],
      result:
        'The step 1 stop condition does not apply because this is not a trivial ' +
        'change, so I continued.'
    },
    aeusserungen: wieGesehen(ABBRUCH_LAUF)
  });
  assert.equal(urteil.ausgang, 'stumm');
  assert.equal(urteil.grund, 'unbekannt');
});

test('eine Werkzeugsperre schlaegt die Tor-Ausnahme', () => {



  const urteil = beurteile({
    seit: seit(ABBRUCH_LAUF),
    kopf: kopf(ABBRUCH_LAUF),
    ergebnis: {
      num_turns: 12,
      subtype: 'success',
      is_error: false,
      permission_denials: [{ tool_name: 'Bash' }],
      result: 'This matches the step 1 stop condition (trivial change).'
    },
    aeusserungen: wieGesehen(ABBRUCH_LAUF)
  });
  assert.equal(urteil.ausgang, 'stumm');
  assert.equal(urteil.grund, 'werkzeugsperre');
});

test('der echte #1029-Wortlaut bleibt die Ausnahme', () => {


  assert.match(fixture.ergebnisse['abbruch-trivial'].result, /matches the step 1 stop condition/);
  assert.equal(
    beurteile({
      seit: seit(ABBRUCH_LAUF),
      kopf: kopf(ABBRUCH_LAUF),
      ergebnis: fixture.ergebnisse['abbruch-trivial'],
      aeusserungen: wieGesehen(ABBRUCH_LAUF)
    }).ausgang,
    'ausgesetzt'
  );
});

test('eine Zusammenfassung ohne SHA zaehlt ueber ihre Adresse im Strom', () => {





  const urteil = beurteile({
    seit: seit(SAUBER),
    kopf: kopf(SAUBER),
    ergebnis: fixture.ergebnisse['saubere-review'],
    aeusserungen: wieGesehen(SAUBER),
    gepostet: geliefert()
  });
  assert.equal(urteil.ausgang, 'geprueft');
  assert.equal(urteil.grund, 'adresse');
});

test('eine belegte Lieferung schlaegt die Abbruchbehauptung (#1082)', () => {
  const urteil = beurteile({
    seit: seit(SAUBER),
    kopf: kopf(SAUBER),
    ergebnis: ABBRUCH,                       // derselbe Text, der #1066 rot faerbt
    aeusserungen: wieGesehen(SAUBER),
    gepostet: geliefert()
  });
  assert.equal(urteil.ausgang, 'geprueft',
    'ein Lauf, der nachweislich geliefert hat, kann nicht im Tor abgebrochen sein');
  assert.equal(urteil.grund, 'adresse');
});

const stromMit = (befehl, inhalt, { fehler = false } = {}) => [
  { type: 'assistant', message: { content: [
    { type: 'tool_use', id: 'toolu_probe', name: 'Bash', input: { command: befehl } }
  ] } },
  { type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'toolu_probe', content: inhalt, is_error: fehler }
  ] } }
];

test('ein Postbefehl OHNE Adresse im Ergebnis ist kein Beleg (#1085)', () => {
  for (const [befehl, inhalt] of [
    ['gh pr comment --help', 'Add a comment to a pull request\n\nUSAGE\n  gh pr comment ...'],
    ['gh pr comment 1085 --repo AyushChandrawat/Aashiyana --delete-last --yes', 'Deleted comment.']
  ]) {
    const gepostet = zaehleBelege(stromMit(befehl, inhalt), wieGesehen(ABBRUCH_LAUF), seit(ABBRUCH_LAUF));
    assert.deepEqual(gepostet, NICHTS, `${befehl}: endet mit 0, legt aber nichts an`);

    const urteil = beurteile({
      seit: seit(ABBRUCH_LAUF),
      kopf: kopf(ABBRUCH_LAUF),
      ergebnis: ABBRUCH,
      aeusserungen: [],
      gepostet
    });
    assert.equal(urteil.ausgang, 'stumm', `${befehl} darf die Abbruchbehauptung nicht aushebeln`);
    assert.equal(urteil.grund, 'schon-kommentiert');
  }
});

test('eine FREMDE, ALTE Adresse im Ergebnis ist kein Beleg (#1085, zweite Runde)', () => {
  const ketten = [
    "gh pr comment --help; gh pr view 1085 --json comments --jq '.comments[-1].url'",
    "gh pr comment 1085 --body x --help; gh pr view 1085 --json comments --jq '.comments[-1].url'",
    "gh pr comment 1085 --body x --help && gh pr view 1085 --jq '.comments[-1].url'",
    "gh pr comment 1085 --body x --help || gh pr view 1085 --jq '.comments[-1].url'"
  ];
  const alt = 'https://github.com/AyushChandrawat/Aashiyana/pull/1066#issuecomment-5596556584';
  assert.ok(wieGesehen(ABBRUCH_LAUF).some((a) => a.anker === 'issuecomment-5596556584' && a.zeit < seit(ABBRUCH_LAUF)),
    'die Adresse gehoert zu einer Aeusserung, die VOR diesem Lauf entstand');
  for (const befehl of ketten) {
    const gepostet = zaehleBelege(stromMit(befehl, alt), wieGesehen(ABBRUCH_LAUF), seit(ABBRUCH_LAUF));
    assert.deepEqual(gepostet, { adressen: 1, erfolge: 0 }, befehl);

    const urteil = beurteile({
      seit: seit(ABBRUCH_LAUF), kopf: kopf(ABBRUCH_LAUF),
      ergebnis: ABBRUCH, aeusserungen: wieGesehen(ABBRUCH_LAUF), gepostet
    });
    assert.equal(urteil.ausgang, 'stumm', befehl);
    assert.equal(urteil.grund, 'schon-kommentiert', befehl);
  }
});

test('der echte Postbefehl mit Heredoc bleibt ein Beleg', () => {

  assert.deepEqual(geliefert(), { adressen: 1, erfolge: 1 });
});

test('eine SHA-gebundene Aeusserung wird einem gescheiterten Lauf nicht zugeschrieben', () => {
  const urteil = beurteile({
    seit: seit(ABBRUCH_LAUF),
    kopf: kopf(ABBRUCH_LAUF),
    ergebnis: { num_turns: 3, subtype: 'error_during_execution', is_error: true, permission_denials: [] },
    aeusserungen: [{ login: 'claude[bot]', zeit: '2026-09-09T06:41:00Z', commit: kopf(ABBRUCH_LAUF) }],
    gepostet: zaehleBelege(fixture.strom.nichts_gepostet, [], seit(ABBRUCH_LAUF))
  });
  assert.equal(urteil.ausgang, 'stumm');
  assert.equal(urteil.grund, 'lauf-fehler');
  assert.ok(!/zwar gepostet/.test(urteil.meldung),
    'ohne eigenen Beleg darf die Meldung diesem Lauf keinen Post zuschreiben');
  assert.match(urteil.meldung, /wer sie geschrieben hat, sagt der Strom DIESES Laufs aber nicht/);
});

test('die Adresse zaehlt auch aus einer JSON-Antwort', () => {


  const strom = stromMit(
    'gh api repos/AyushChandrawat/Aashiyana/pulls/1066/comments -f body=x',
    { html_url: 'https://github.com/AyushChandrawat/Aashiyana/pull/1066#discussion_r3965014733' }
  );
  assert.deepEqual(
    zaehleBelege(strom, wieGesehen(ECHTE_REVIEW), seit(ECHTE_REVIEW)),
    { adressen: 1, erfolge: 1 }
  );
});

test('ein Lauf, der gepostet hat und dann wartet, wird richtig benannt', () => {
  const urteil = beurteile({
    seit: seit(ABBRUCH_LAUF),
    kopf: kopf(ABBRUCH_LAUF),
    ergebnis: {
      num_turns: 9, subtype: 'success', is_error: false, permission_denials: [],
      result: "I'll wait for both background agents to complete before continuing."
    },
    aeusserungen: [{ login: 'claude[bot]', zeit: '2026-09-09T06:41:00Z', commit: kopf(ABBRUCH_LAUF) }],
    gepostet: geliefert()
  });
  assert.equal(urteil.ausgang, 'stumm');
  assert.equal(urteil.grund, 'agenten', 'der Grund bleibt die Unvollstaendigkeit');
  assert.match(urteil.meldung, /zwar gepostet/);
  assert.match(urteil.meldung, /ABGESCHLOSSENE Pruefung/);
  assert.ok(!/keine davon belegt DIESEN Lauf/.test(urteil.meldung),
    'das waere falsch: die Aeusserung traegt die SHA dieses Laufs');
});

test('eine SHA-gebundene Aeusserung macht den Fallback auch bei Abbruchprosa erreichbar', () => {
  const urteil = beurteile({
    seit: seit(ABBRUCH_LAUF),
    kopf: kopf(ABBRUCH_LAUF),
    ergebnis: ABBRUCH,
    aeusserungen: [{ login: 'claude[bot]', zeit: '2026-09-09T06:41:00Z', commit: kopf(ABBRUCH_LAUF) }],
    gepostet: zaehleBelege(fixture.strom.nichts_gepostet, [], seit(ABBRUCH_LAUF))
  });
  assert.equal(urteil.ausgang, 'geprueft');
  assert.equal(urteil.grund, 'gebunden');
});

test('OHNE gebundene Aeusserung bleibt die Abbruchbehauptung rot', () => {


  const urteil = beurteile({
    seit: seit(ABBRUCH_LAUF),
    kopf: kopf(ABBRUCH_LAUF),
    ergebnis: ABBRUCH,
    aeusserungen: [{ login: 'claude[bot]', zeit: '2026-09-09T06:41:00Z', commit: 'ein-anderer-stand' }],
    gepostet: zaehleBelege(fixture.strom.nichts_gepostet, [], seit(ABBRUCH_LAUF))
  });
  assert.equal(urteil.ausgang, 'stumm');
  assert.equal(urteil.grund, 'schon-kommentiert');
});

test('ein GESCHEITERTER Postbefehl rettet die Abbruchbehauptung nicht', () => {


  // Ergebnis die ECHTE neue Adresse traegt.
  const fehlschlaege = [
    fixture.strom.post_gescheitert,
    stromMit('gh pr comment 1066 --body x',
      'https://github.com/AyushChandrawat/Aashiyana/pull/1066#issuecomment-5596556584', { fehler: true })
  ];
  for (const strom of fehlschlaege) {
    const gepostet = zaehleBelege(strom, wieGesehen(SAUBER), seit(SAUBER));
    assert.deepEqual(gepostet, NICHTS);
    const urteil = beurteile({
      seit: seit(SAUBER), kopf: kopf(SAUBER),
      ergebnis: ABBRUCH, aeusserungen: [], gepostet
    });
    assert.equal(urteil.ausgang, 'stumm');
    assert.equal(urteil.grund, 'schon-kommentiert');
  }
});

test('die Meldung nennt die Zahl, die der Schritt darueber ausgegeben hat', () => {



  const urteil = beurteile({
    seit: seit(ABBRUCH_LAUF),
    ergebnis: fixture.ergebnisse['stumm-unbekannt'],
    aeusserungen: [{ login: 'claude[bot]', zeit: '2026-09-09T06:41:00Z' }],
    gepostet: zaehleBelege(fixture.strom.nichts_gepostet, [], seit(ABBRUCH_LAUF))
  });
  assert.equal(urteil.ausgang, 'stumm');
  assert.equal(urteil.neu, 1);
  assert.match(urteil.meldung, /1 Aeusserung\(en\) nach dem Laufbeginn/);
  assert.ok(!/in diesem Lauf nichts hinterlassen/.test(urteil.meldung),
    'die Meldung darf nicht behaupten, es sei gar nichts gesagt worden');
});

test('ZUORDNUNG AUS ABWESENHEIT TRAEGT NICHT: "Done." bleibt rot', () => {



  const urteil = beurteile({
    seit: seit(ABBRUCH_LAUF),
    kopf: kopf(ABBRUCH_LAUF),
    ergebnis: fixture.ergebnisse['stumm-unbekannt'],
    aeusserungen: [{ login: 'claude[bot]', zeit: '2026-09-09T06:41:00Z', commit: null }],
    gepostet: zaehleBelege(fixture.strom.nichts_gepostet, [], seit(ABBRUCH_LAUF))
  });
  assert.equal(urteil.ausgang, 'stumm');
  assert.equal(urteil.grund, 'nicht-zuzuordnen');
});

test('ohne jede Aeusserung bleibt der stille Lauf schlicht unbekannt', () => {


  // nichts da".
  assert.equal(
    beurteile({
      seit: seit(ABBRUCH_LAUF),
      kopf: kopf(ABBRUCH_LAUF),
      ergebnis: fixture.ergebnisse['stumm-unbekannt'],
      aeusserungen: []
    }).grund,
    'unbekannt'
  );
});


// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

test('die Adresse im Strom ist der Beleg, nicht der Satz darueber', () => {

  // Mention-Pfad und kein abgebrochener Vorgaenger kommt da hinein.
  assert.deepEqual(geliefert(), { adressen: 1, erfolge: 1 });
  assert.deepEqual(zaehleBelege(fixture.strom.nichts_gepostet, wieGesehen(SAUBER), seit(SAUBER)), NICHTS);



  assert.deepEqual(zaehleBelege(fixture.strom.post_gescheitert, wieGesehen(SAUBER), seit(SAUBER)), NICHTS);
});

test('ein Beleg fuer Unvollstaendigkeit schlaegt die Lieferung', () => {




  const urteil = beurteile({
    seit: seit(ABBRUCH_LAUF),
    kopf: kopf(ABBRUCH_LAUF),
    ergebnis: {
      num_turns: 9, subtype: 'success', is_error: false, permission_denials: [],
      result: "I'll wait for both background agents to complete before continuing."
    },
    aeusserungen: [{ login: 'claude[bot]', zeit: '2026-09-09T06:41:00Z', commit: kopf(ABBRUCH_LAUF) }],
    gepostet: geliefert()
  });
  assert.equal(urteil.ausgang, 'stumm');
  assert.equal(urteil.grund, 'agenten');
});

test('eine belegte Lieferung schlaegt eine harmlose Verweigerung', () => {




  const urteil = beurteile({
    seit: seit(SAUBER),
    kopf: kopf(SAUBER),
    ergebnis: { ...fixture.ergebnisse['saubere-review'], permission_denials: [{ tool_name: 'Bash' }] },
    aeusserungen: wieGesehen(SAUBER),
    gepostet: geliefert()
  });
  assert.equal(urteil.ausgang, 'geprueft');
  assert.equal(urteil.grund, 'adresse');
});

test('eine VERNEINTE Abbruchbehauptung faerbt eine gueltige Review nicht rot', () => {
  // Modellprosa verneint: "Claude has not already commented on this PR."

  const urteil = beurteile({
    seit: seit(SAUBER),
    kopf: kopf(SAUBER),
    ergebnis: {
      num_turns: 14, subtype: 'success', is_error: false, permission_denials: [],
      result: 'Claude has not already commented on this PR. Review posted.'
    },
    aeusserungen: wieGesehen(SAUBER),
    gepostet: geliefert()
  });
  assert.equal(urteil.ausgang, 'geprueft');
});

test('der echte Abbruchtext bleibt trotz Verneinungspruefung erkannt', () => {


  assert.equal(bejaht(ABBRUCH.result, /already\s+(?:left\s+a\s+comment|commented|posted|reviewed)/i), true);
  assert.equal(
    bejaht('Claude has not already commented on this PR.', /already\s+commented/i),
    false
  );
});

// ---------------------------------------------------------------------------

//






// gegen stilles Gruen war selbst still gruen.
// ---------------------------------------------------------------------------

const SKRIPT = fileURLToPath(new URL('../.github/scripts/review-verdict.mjs', import.meta.url));

function fahre(dateiname, { ergebnis, aeusserungen = [], seit = '2026-09-09T06:40:37Z', kopf = 'abc' }) {
  const ordner = mkdtempSync(join(tmpdir(), 'review-proof-'));
  const ziel = join(ordner, dateiname);
  copyFileSync(SKRIPT, ziel);
  const strom = join(ordner, 'exec.json');
  writeFileSync(strom, JSON.stringify(ergebnis));
  const liste = join(ordner, 'aeusserungen.jsonl');
  writeFileSync(liste, aeusserungen.map((a) => JSON.stringify(a)).join('\n'));
  return spawnSync(process.execPath, [
    ziel, '--seit', seit, '--kopf', kopf, '--ergebnis', strom, '--aeusserungen', liste
  ], { encoding: 'utf8' });
}

const ABBRUCH_STROM = [{ ...fixture.ergebnisse['abbruch-schon-kommentiert'], type: 'result' }];
const GELIEFERT_STROM = [
  ...fixture.strom.gepostet,
  { ...fixture.ergebnisse['saubere-review'], type: 'result' }
];
const NEUE_ZUSAMMENFASSUNG = {
  login: 'claude[bot]', zeit: '2026-09-09T06:41:00Z', commit: null, anker: 'issuecomment-5596556584'
};

test('DAS SKRIPT URTEILT AUCH UNTER FREMDEM DATEINAMEN', () => {



  const lauf = fahre('review-verdict-basis.mjs', { ergebnis: ABBRUCH_STROM });
  assert.equal(lauf.status, 1, `Exit 0 heisst hier: main() lief nicht.\n${lauf.stdout}`);
  assert.match(lauf.stdout, /UNGEPRUEFT/);
  assert.match(lauf.stdout, /::error::/);
});

test('und unter einem beliebigen anderen Namen genauso', () => {

  const lauf = fahre('irgendwas.mjs', { ergebnis: ABBRUCH_STROM });
  assert.equal(lauf.status, 1);
});

test('ein gelieferter Lauf endet als Programm mit 0', () => {

  const lauf = fahre('review-verdict-basis.mjs', {
    ergebnis: GELIEFERT_STROM,
    aeusserungen: [NEUE_ZUSAMMENFASSUNG]
  });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /Belegte Lieferungen dieses Laufs: 1 \(Adressen in seinem Strom: 1\)/);
});

test('ohne `anker` in den Listen wird derselbe Lauf als Programm nicht gruen', () => {



  const { anker, ...ohneAnker } = NEUE_ZUSAMMENFASSUNG;
  const lauf = fahre('review-verdict-basis.mjs', {
    ergebnis: GELIEFERT_STROM,
    aeusserungen: [ohneAnker]
  });
  assert.equal(lauf.status, 1, lauf.stdout);
  assert.match(lauf.stdout, /Belegte Lieferungen dieses Laufs: 0 \(Adressen in seinem Strom: 1\)/);
  assert.match(lauf.stdout, /`anker`/);
});


const LAUF_1094 = fixture.ergebnisse['gehorsam-erwaehnt-abbruch'];
const SEIT_1094 = fixture.quelle_1094.seit;
const KOPF_1094 = fixture.quelle_1094.kopf;
const GESEHEN_1094 = fixture.quelle_1094.aeusserungen;
const LIEFERUNG_1094 = 'issuecomment-5609521451';

test('der mehrzeilige Postbefehl aus



  const strom = fixture.strom.gepostet_mehrzeilig;
  const befehl = strom[0].message.content[0].input.command;
  assert.match(befehl, /^gh pr comment 1094 /, 'die Fixture traegt den echten Befehl');
  assert.ok(befehl.includes('\n'), 'und der ist wirklich mehrzeilig');
  assert.ok(GESEHEN_1094.some((a) => a.anker === LIEFERUNG_1094 && a.zeit > SEIT_1094),
    'die API kennt die Adresse als claude-Aeusserung nach dem Laufbeginn');

  assert.deepEqual(zaehleBelege(strom, GESEHEN_1094, SEIT_1094), { adressen: 1, erfolge: 1 },
    'der Beleg des Laufs darf nicht an seinen eigenen Absaetzen scheitern');
});

test('ein Lauf, der nur liest, bekommt nur Adressen zurueck, die es schon gab (#1094)', () => {




  assert.deepEqual(zaehleBelege(fixture.strom.nur_gelesen, GESEHEN_1094, SEIT_1094),
    { adressen: 1, erfolge: 0 }, 'die gelesene Adresse kennt die API nicht als neu');

  const alt = GESEHEN_1094
    .filter((a) => a.login.includes('claude') && a.zeit < SEIT_1094)
    .map((a) => ({ html_url: `https://github.com/AyushChandrawat/Aashiyana/pull/1094#${a.anker}` }));
  assert.equal(alt.length, 4, 'zwei Reviews und zwei Inline-Anmerkungen von claude lagen vor dem Lauf');
  const lesen = stromMit('gh api repos/AyushChandrawat/Aashiyana/pulls/1094/reviews -XGET -f per_page=100', JSON.stringify(alt));
  assert.deepEqual(zaehleBelege(lesen, GESEHEN_1094, SEIT_1094), { adressen: 4, erfolge: 0 });
});

test('EIN LAUF, DER NUR LIEST, WIRD NICHT GRUEN (#1094)', () => {


  const ohneLieferung = GESEHEN_1094.filter((a) => a.anker !== LIEFERUNG_1094);
  const urteil = beurteile({
    seit: SEIT_1094,
    kopf: KOPF_1094,
    ergebnis: { result: 'Ich habe die vorhandenen Kommentare gelesen.', subtype: 'success',
      is_error: false, num_turns: 3, permission_denials: [] },
    aeusserungen: ohneLieferung,
    gepostet: zaehleBelege(fixture.strom.nur_gelesen, ohneLieferung, SEIT_1094)
  });
  assert.equal(urteil.ausgang, 'stumm', 'Lesen ist kein Liefern');
});

test('die ERWAEHNUNG der Abbruchbedingung ist kein Abbruch (#1094)', () => {


  // berichtet: 'telling me to disregard the normal "already commented" stop
  // condition ... so proceeding was legitimate'. Je genauer die Anweisung

  const text = String(LAUF_1094.result);
  assert.match(text, /"already commented" stop condition/,
    'die Fixture traegt den echten Wortlaut - das ZITAT der Bedingung');
  assert.match(text, /Review complete/, 'und derselbe Text sagt, dass geprueft wurde');

  const urteil = beurteile({
    seit: SEIT_1094,
    kopf: KOPF_1094,
    ergebnis: LAUF_1094,
    aeusserungen: GESEHEN_1094,
    gepostet: zaehleBelege(fixture.strom.gepostet_mehrzeilig, GESEHEN_1094, SEIT_1094)
  });
  assert.equal(urteil.ausgang, 'geprueft', urteil.meldung);
  assert.equal(urteil.grund, 'adresse');
});

test('der ECHTE Abbruch aus #1066 bleibt davon unberuehrt', () => {


  const abbruch = fixture.ergebnisse['abbruch-schon-kommentiert'];
  assert.match(String(abbruch.result), /stop here/i, 'der echte Abbruch sagt, dass er aufhoert');

  const urteil = beurteile({
    seit: seit(ABBRUCH_LAUF),
    kopf: kopf(ABBRUCH_LAUF),
    ergebnis: abbruch,
    aeusserungen: alleAeusserungen,
    gepostet: NICHTS
  });
  assert.equal(urteil.ausgang, 'stumm');
  assert.equal(urteil.grund, 'schon-kommentiert');
});

test('erwaehnt und NICHT geliefert: die Diagnose muss die richtige sein (#1094)', () => {
  // Derselbe result-Text, aber nichts geliefert - der Lauf hatte 14





  const urteil = beurteile({
    seit: SEIT_1094,
    kopf: KOPF_1094,
    ergebnis: LAUF_1094,
    aeusserungen: [],
    gepostet: { adressen: 1, erfolge: 0 }
  });
  assert.equal(urteil.ausgang, 'stumm', 'ohne Lieferung bleibt es rot');
  assert.equal(urteil.grund, 'werkzeugsperre',
    'die 14 Verweigerungen sind der Grund - nicht ein Abbruch, den es nie gab');
  assert.doesNotMatch(urteil.meldung, /IM TOR ABGEBROCHEN/,
    'ein Lauf, der 29 Turns lang geprueft hat, hat nicht im Tor abgebrochen');
});

test('SCHON KOMMENTIERT SCHLAEGT TRIVIAL AUCH OHNE AUFHOER-SATZ (#1096)', () => {




  // geprueft.
  const urteil = beurteile({
    seit: seit(ABBRUCH_LAUF),
    kopf: kopf(ABBRUCH_LAUF),
    ergebnis: {
      num_turns: 3, subtype: 'success', is_error: false, permission_denials: [],
      result:
        'This matches the step 1 stop condition - Claude has already reviewed ' +
        'this PR, and the remaining diff is a trivial change that is obviously ' +
        'correct.'
    },
    aeusserungen: [],
    gepostet: NICHTS
  });
  assert.notEqual(urteil.ausgang, 'ausgesetzt',
    'die gefaehrlichere Lesart gewinnt, egal wie das Aufhoeren formuliert ist');
  assert.equal(urteil.ausgang, 'stumm');


  assert.equal(urteil.grund, 'unbekannt');
  assert.doesNotMatch(urteil.meldung, /IM TOR ABGEBROCHEN/,
    'was nicht belegt ist, wird nicht behauptet');
});


const PROBE_SEIT = '2026-09-10T08:00:00Z';
const PROBE_LISTE = [

  { login: 'claude[bot]', zeit: '2026-09-10T07:59:59Z', commit: null, anker: 'issuecomment-100' },

  { login: 'claude[bot]', zeit: '2026-09-10T08:05:00Z', commit: null, anker: 'issuecomment-200' },

  { login: 'chatgpt-codex-connector[bot]', zeit: '2026-09-10T08:05:00Z', commit: null, anker: 'issuecomment-300' }
];
const url = (n) => `https://github.com/AyushChandrawat/Aashiyana/pull/1096#issuecomment-${n}`;

const BEFEHLSFORMEN = [
  ['einfach quotierter Body mit Backticks (Codex P2, claude[bot])',
    "gh pr comment 1096 --body 'Please preserve `foo`.'"],
  ['quotierter Endpunkt mit Feld (Codex P2)',
    'gh api "repos/AyushChandrawat/Aashiyana/issues/1096/comments" -f body=hello'],
  ['angeklebtes -XGET mit Feld (Codex P1, claude[bot])',
    'gh api repos/AyushChandrawat/Aashiyana/issues/1096/comments -XGET -f per_page=5'],
  ['unquotiertes Heredoc mit Substitution (claude[bot])',
    'gh pr comment 1096 --body "$(cat <<EOF\n$(echo ADRESSE >&2; true)\nEOF\n)" --help'],
  ['Kette mit --help (#1085)',
    "gh pr comment --help; gh pr view 1096 --json comments --jq '.comments[-1].url'"],
  ['mehrzeiliger Body (#1094)',
    'gh pr comment 1096 --body "## Code review\n\nNo issues found."']
];

test('WIE DER BEFEHL GESCHRIEBEN IST, ENTSCHEIDET NICHTS MEHR (#1096, dritte Runde)', () => {
  for (const [form, befehl] of BEFEHLSFORMEN) {
    assert.deepEqual(zaehleBelege(stromMit(befehl, url(100)), PROBE_LISTE, PROBE_SEIT),
      { adressen: 1, erfolge: 0 }, `${form}: eine ALTE claude-Adresse belegt nichts`);
    assert.deepEqual(zaehleBelege(stromMit(befehl, url(300)), PROBE_LISTE, PROBE_SEIT),
      { adressen: 1, erfolge: 0 }, `${form}: eine FREMDE neue Adresse belegt nichts`);
    assert.deepEqual(zaehleBelege(stromMit(befehl, url(200)), PROBE_LISTE, PROBE_SEIT),
      { adressen: 1, erfolge: 1 }, `${form}: eine NEUE claude-Adresse belegt die Lieferung`);
  }
});

test('eine Adresse in der BEFEHLSZEILE ist kein Beleg', () => {


  const strom = stromMit(`gh pr comment 1096 --body "siehe ${url(200)}"`, 'gh: Not Found (HTTP 404)');
  assert.equal(adressenImStrom(strom).size, 0);
  assert.deepEqual(zaehleBelege(strom, PROBE_LISTE, PROBE_SEIT), NICHTS);
});

test('die API muss die Adresse kennen: eine erfundene zaehlt nicht, eine Liste ohne `anker` belegt nichts', () => {
  assert.deepEqual(zaehleBelege(stromMit('gh pr comment 1096 --body x', url(999)), PROBE_LISTE, PROBE_SEIT),
    { adressen: 1, erfolge: 0 }, 'eine Adresse, die es laut API nicht gibt');
  const ohneAnker = PROBE_LISTE.map(({ anker, ...rest }) => rest);
  assert.deepEqual(zaehleBelege(stromMit('gh pr comment 1096 --body x', url(200)), ohneAnker, PROBE_SEIT),
    { adressen: 1, erfolge: 0 }, 'ohne `anker` kein Abgleich - und damit kein Gruen aus dem Nichts');
});

test('jede Adresse zaehlt einmal, und eine alte neben einer neuen bleibt alt', () => {
  const strom = [
    ...stromMit('gh pr comment 1096 --body x', url(200)),
    { type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'toolu_zwei', is_error: false,
        content: [{ type: 'text', text: JSON.stringify([{ html_url: url(100) }, { html_url: url(200) }]) }] }
    ] } }
  ];
  assert.deepEqual(zaehleBelege(strom, PROBE_LISTE, PROBE_SEIT), { adressen: 2, erfolge: 1 });
});

test('eine Aeusserung GENAU zum Laufbeginn gilt nicht als neu', () => {
  const liste = [{ login: 'claude[bot]', zeit: PROBE_SEIT, commit: null, anker: 'issuecomment-400' }];
  assert.equal(zaehleBelege(stromMit('gh pr comment 1096 --body x', url(400)), liste, PROBE_SEIT).erfolge, 0);
});

test('ohne gueltigen Laufbeginn gibt es keinen Beleg', () => {
  for (const kaputt of ['', undefined, '2026-09-10', '2026-09-10T08:00:00+00:00']) {
    assert.equal(zaehleBelege(stromMit('gh pr comment 1096 --body x', url(200)), PROBE_LISTE, kaputt).erfolge, 0,
      `Laufbeginn ${JSON.stringify(kaputt)}`);
  }
});

test('ein VERNEINTES Aufhoeren ist kein Abbruch im Tor (#1096, Codex P2)', () => {




  const urteil = beurteile({
    seit: SEIT_1094,
    kopf: KOPF_1094,
    ergebnis: {
      num_turns: 22, subtype: 'success', is_error: false, permission_denials: [{ tool_name: 'Bash' }],
      result: 'Claude has already reviewed older commits, but not this HEAD. I did not stop here.'
    },
    aeusserungen: [],
    gepostet: NICHTS
  });
  assert.equal(urteil.ausgang, 'stumm');
  assert.equal(urteil.grund, 'werkzeugsperre',
    'die Sperre ist der Grund, nicht ein Abbruch, den der Text verneint');
  assert.doesNotMatch(urteil.meldung, /IM TOR ABGEBROCHEN/);
});

test('ein Aufhoeren, das SELBST verneint, bleibt ein Abbruch (#1096, Codex nach Runde 3)', () => {




  for (const result of [
    'Claude has already commented on this PR, so I will not proceed.',
    'Claude has already commented on this PR. No review is needed.',

    'Claude has already left a comment on this PR (a "No issues found" review). No review is needed.'
  ]) {
    const urteil = beurteile({
      seit: seit(ABBRUCH_LAUF),
      kopf: kopf(ABBRUCH_LAUF),
      ergebnis: { num_turns: 3, subtype: 'success', is_error: false, permission_denials: [], result },
      aeusserungen: [],
      gepostet: NICHTS
    });
    assert.equal(urteil.grund, 'schon-kommentiert', result);
  }


  // bleibt der Grund.
  const weiter = beurteile({
    seit: seit(ABBRUCH_LAUF),
    kopf: kopf(ABBRUCH_LAUF),
    ergebnis: {
      num_turns: 20, subtype: 'success', is_error: false, permission_denials: [{ tool_name: 'Bash' }],
      result: 'Claude has already reviewed older commits. I did not want to not proceed, so the review continued.'
    },
    aeusserungen: [],
    gepostet: NICHTS
  });
  assert.equal(weiter.grund, 'werkzeugsperre');
});

test('eine VERNEINTE erste Erwaehnung oeffnet die Gruen-Ausnahme nicht (#1096, Codex P1 nach 8dc12582)', () => {



  // stillen Gruen-Pfad gilt deshalb: jede Erwaehnung sperrt ihn.
  const urteil = beurteile({
    seit: seit(ABBRUCH_LAUF),
    kopf: kopf(ABBRUCH_LAUF),
    ergebnis: {
      num_turns: 3, subtype: 'success', is_error: false, permission_denials: [],
      result:
        'Claude has not already reviewed the new HEAD. Claude has already commented on this PR, ' +
        'and the remaining diff is a trivial change that is obviously correct, so this matches ' +
        'the step 1 stop condition.'
    },
    aeusserungen: [],
    gepostet: NICHTS
  });
  assert.notEqual(urteil.ausgang, 'ausgesetzt',
    'eine Erwaehnung von "schon kommentiert" oeffnet den stillen Gruen-Pfad nie');
  assert.equal(urteil.ausgang, 'stumm');
});

test('ein spaeteres bejahtes Aufhoeren zaehlt auch nach einem verneinten (#1096, Codex P2 nach 8dc12582)', () => {


  const urteil = beurteile({
    seit: seit(ABBRUCH_LAUF),
    kopf: kopf(ABBRUCH_LAUF),
    ergebnis: {
      num_turns: 4, subtype: 'success', is_error: false, permission_denials: [],
      result:
        'I did not stop here at the first check. Claude has already left a comment on this PR, ' +
        'so I should stop here.'
    },
    aeusserungen: [],
    gepostet: NICHTS
  });
  assert.equal(urteil.grund, 'schon-kommentiert');
});

test('eine spaetere bejahte Erwaehnung zaehlt auch nach einer verneinten (#1101)', () => {





  const urteil = beurteile({
    seit: seit(ABBRUCH_LAUF),
    kopf: kopf(ABBRUCH_LAUF),
    ergebnis: {
      num_turns: 4, subtype: 'success', is_error: false, permission_denials: [],
      result: 'Claude has not already reviewed this HEAD. Claude has already reviewed this PR, so I should stop here.'
    },
    aeusserungen: [],
    gepostet: NICHTS
  });
  assert.equal(urteil.grund, 'schon-kommentiert');
});

test('bejahtIrgendwo liest jede Erwaehnung, bejaht weiter nur die erste (#1101)', () => {
  const muster = /already\s+(?:left\s+a\s+comment|commented|posted|reviewed)/i;
  const gemischt = 'Claude has not already reviewed this HEAD. Claude has already reviewed this PR.';
  assert.equal(bejahtIrgendwo(gemischt, muster), true);


  assert.equal(bejaht(gemischt, muster), false);
  assert.equal(bejahtIrgendwo('Claude has not already commented. It has never already posted.', muster), false);
  assert.equal(bejahtIrgendwo('', muster), false);
  assert.equal(bejahtIrgendwo(undefined, muster), false);


  assert.equal(bejahtIrgendwo('Claude has not already reviewed. Has already reviewed, so I should stop here.', muster), true);
});

test('ein kurzer verneinter Satz verneint die naechste Erwaehnung nicht mit (#1121, Codex P2)', () => {
  const urteil = beurteile({
    seit: seit(ABBRUCH_LAUF),
    kopf: kopf(ABBRUCH_LAUF),
    ergebnis: {
      num_turns: 4, subtype: 'success', is_error: false, permission_denials: [],
      result: 'Claude has not already reviewed. Has already reviewed, so I should stop here.'
    },
    aeusserungen: [],
    gepostet: NICHTS
  });
  assert.equal(urteil.grund, 'schon-kommentiert');
});
