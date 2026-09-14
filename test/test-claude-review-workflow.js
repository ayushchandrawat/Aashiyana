import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../.github/workflows/claude-code-review.yml', import.meta.url),
  'utf8'
);

test('der Prompt traegt
  // Die Plugin-Anleitung: "If `--comment` argument was NOT provided, stop here.


  assert.match(workflow, /\/code-review:code-review[^\n]*--comment/);
});

test('die Subagenten laufen synchron', () => {
  // #865, 2026-08-25: viermal hintereinander nichts hinterlassen. Das Plugin




  assert.match(workflow, /run_in_background:\s*false/,
    'die Anweisung, Subagenten synchron zu fahren, fehlt im Prompt');
});

test('der Prompt traegt keine Werkzeug-Anweisungen, nur den Verweis auf CONTRIBUTING.md', () => {





  const prompt = workflow.match(/prompt: \|\n((?:[ ]{12}.*\n|\n)+)/)?.[1] ?? '';
  assert.ok(prompt.includes('/code-review:code-review'), 'der Prompt liess sich nicht lesen');
  assert.doesNotMatch(prompt, /gh api|--allowed-tools|gesperrt|WERKZEUGE/i,
    'Werkzeug-Anweisungen gehoeren in claude_args, nicht in den Prompt');
  assert.match(prompt, /CONTRIBUTING\.md/, 'der Verweis auf die nachlesbare Regel fehlt');


  assert.match(prompt, /github\.event\.repository\.default_branch/,
    'der Prompt muss die Fassung auf dem Default-Branch fuer massgeblich erklaeren');
});

test('Skill und Task stehen in den erlaubten Werkzeugen', () => {



  const tools = workflow.match(/--allowed-tools\s*\n?\s*"([^"]+)"/)?.[1] ?? '';
  assert.ok(tools.includes('Skill'), '`Skill` fehlt - das Plugin-Kommando ist dann gesperrt');
  assert.ok(tools.includes('Task'), '`Task` fehlt - die Subagenten sind dann gesperrt');
  assert.ok(tools.includes('Bash(gh pr comment:*)'), 'ohne diesen Weg kann sie ihr Ergebnis nicht abliefern');
});

function claudeArgs() {
  const block = workflow.match(/claude_args:\s*>-\n((?:[ ]{12}\S.*\n)+)/)?.[1] ?? '';
  const values = {};
  let flag = null;
  for (const [token] of block.matchAll(/"[^"]*"|'[^']*'|\S+/g)) {
    if (token.startsWith('--')) {
      flag = token.slice(2);
      values[flag] ??= [];
      continue;
    }
    if (!flag) continue;
    const inhalt = /^["']/.test(token) ? token.slice(1, -1) : token;
    values[flag].push(...inhalt.split(',').map((s) => s.trim()).filter(Boolean));
  }
  return values;
}

test('gh api ist nur lesend frei: Allow auf den Repo-Pfad, Deny auf jede Schreibform', () => {



  const { 'allowed-tools': allow = [], 'disallowed-tools': deny = [] } = claudeArgs();
  const ghApi = allow.filter((t) => t.startsWith('Bash(gh api')).sort();
  assert.deepEqual(ghApi, [
    'Bash(gh api "repos/${{ github.repository }}/*)',
    'Bash(gh api repos/${{ github.repository }}/*)',
  ], 'gh api darf nur unter dem eigenen Repo-Pfad frei sein, nie als blosses Praefix');
  // `-i` schliesst die gebuendelten Kurzflags (`-if`, `-iX POST`), `--hostname`

  for (const flag of ['-X', '--method', '-f', '-F', '--field', '--raw-field', '--input', '-i', '--hostname']) {
    assert.ok(deny.includes(`Bash(gh api * ${flag}*)`),
      `${flag} fehlt fuer gh api in --disallowed-tools`);
  }

  assert.ok(deny.includes('Bash(git fetch * --upl*)'),
    '`git fetch origin` darf das Programm der Gegenseite nicht waehlen, auch nicht abgekuerzt');
});

test('kein erlaubter git-Befehl schreibt per --output eine Datei', () => {



  // muessen fuer jeden BEIDE Stellungen gesperrt sein.
  const { 'allowed-tools': allow = [], 'disallowed-tools': deny = [] } = claudeArgs();
  for (const befehl of ['show', 'log', 'diff', 'rev-list']) {
    assert.ok(allow.includes(`Bash(git ${befehl}:*)`), `git ${befehl} ist nicht mehr erlaubt - Test anpassen`);
    assert.ok(deny.includes(`Bash(git ${befehl} --output*)`),
      `git ${befehl}
    assert.ok(deny.includes(`Bash(git ${befehl} * --output*)`),
      `git ${befehl} ...
  }
});

test('Code aus dem Checkout laeuft in der Review nicht', () => {



  const { 'allowed-tools': allow = [] } = claudeArgs();
  assert.ok(allow.length > 0, 'die Liste liess sich nicht lesen - der Test wuerde sonst nichts messen');
  const zuBreit = allow.filter((t) =>
    /^(Write|Edit|MultiEdit|NotebookEdit|WebFetch)\b/.test(t)
    || /^Bash\((node|npm|npx|bash|sh|python3?|make|curl|wget)\b/.test(t)
    || /^Bash(\(\*?\))?$/.test(t));
  assert.deepEqual(zuBreit, [], `ausfuehrende oder schreibende Werkzeuge in der Liste: ${zuBreit.join(', ')}`);
});

test('der Job darf schreiben, sonst kommt die Review nicht zu Wort', () => {
  assert.match(workflow, /pull-requests:\s*write/);
});

test('der Nachweis-Schritt prueft die Wirkung, nicht den Ablauf', () => {


  assert.match(workflow, /Die Review muss gesprochen haben/);
  assert.match(workflow, /node \.github\/scripts\/review-verdict\.mjs/);
});

test('das Urteil liegt ausserhalb des Workflows und ist damit gegenprobierbar', () => {



  assert.ok(
    existsSync(new URL('../.github/scripts/review-verdict.mjs', import.meta.url)),
    'der Nachweis ruft ein Skript auf, das es nicht gibt'
  );
  assert.match(workflow, /--seit "\$SEIT"/);
  assert.match(workflow, /--ergebnis "\$EXECUTION_FILE"/);
});

test('der Nachweis zaehlt nicht mehr ueber die Lebensdauer des PR', () => {



  // Kommentar danach jeden Abbruch gruen. Drei Pushes gingen so durch.
  assert.doesNotMatch(workflow, /issue \+ review \+ inline/);
  assert.doesNotMatch(workflow, /-eq 0/);
});

test('gemessen wird gegen den Laufbeginn, nicht gegen die Commit-Zeit', () => {




  // waere derselbe blinde Fleck in neuer Form.
  assert.match(workflow, /^\s+id: stand$/m);
  assert.match(workflow, /seit=\$\(date -u \+%Y-%m-%dT%H:%M:%SZ\)/);
  assert.doesNotMatch(workflow, /committer\.date/);
  assert.match(workflow, /SEIT: \$\{\{ steps\.stand\.outputs\.seit \}\}/);
});

test('der Prompt hebt die Abbruchbedingung auf, sonst prueft nur der erste Push', () => {



  // blinder Fleck.
  assert.match(workflow, /ABBRUCHBEDINGUNG[^\n]*GILT\s*\n\s*HIER NICHT/);
  assert.match(workflow, /github\.event\.pull_request\.head\.sha/);
});

test('ein Lauf je PR, und zwar der zum neuesten Stand', () => {
  // Seit jeder Push wirklich geprueft wird, stehen sonst mehrere echte Laeufe


  assert.match(workflow, /^concurrency:$/m);
  assert.match(workflow, /cancel-in-progress: true/);
});

test('der Selbst-Uebersprung wird an Zeichengleichheit erkannt', () => {







  // jemand etwas falsch gemacht hat.
  assert.match(workflow, /contents\/\$DATEI\?ref=\$HEAD_SHA/);
  assert.match(workflow, /contents\/\$DATEI\?ref=\$BASIS/);
  assert.match(workflow, /\[ "\$kopf" = "\$basis" \]/);
});

test('die Selbst-Uebersprung-Ausnahme schliesst zu', () => {

  // herum: zwei ungleiche Platzhalter haetten `self=true` gesetzt, den Nachweis


  // nicht ausgenommen.
  assert.doesNotMatch(workflow, /kopf="fehlt-im-pr"/);
  assert.doesNotMatch(workflow, /basis="fehlt-in-basis"/);
  assert.match(workflow, /if \[ -z "\$kopf" \] \|\| \[ -z "\$basis" \]; then\n\s*echo "self=false"/);
});

test('kein Rerun-Kurzschluss: die Review laeuft bei jedem Anlass', () => {






  assert.doesNotMatch(workflow, /steps\.stand\.outputs\.geprueft/);
  assert.doesNotMatch(workflow, /geprueft=true/);
});

test('der Nachweis bindet Aeusserungen an die Commit-SHA', () => {





  assert.match(workflow, /--kopf "\$HEAD_SHA"/);
  assert.match(workflow, /commit: \.commit_id/);
  assert.match(workflow, /commit: \(\.original_commit_id \/\/ \.commit_id\)/);
  assert.match(workflow, /commit: null/);
});

test('jede Kommentarliste traegt die Adresse ihrer Aeusserungen', () => {





  const holer = [...workflow.matchAll(/--jq '\.\[\] \| \{login: \.user\.login,[^']*\}'/g)].map((m) => m[0]);
  assert.equal(holer.length, 3, 'drei Listen: Zusammenfassungen, Reviews, Inline-Anmerkungen');
  for (const jq of holer) {
    assert.match(jq, /anker: \(\.html_url \/\/ "" \| split\("#"\) \| \.\[1\] \/\/ null\)/, jq);
  }
});

test('das Urteil laeuft aus einer vertrauenswuerdigen Fassung', () => {










  assert.doesNotMatch(workflow, /^\s*node \.github\/scripts\/review-verdict\.mjs/m);
  assert.match(workflow, /contents\/\$URTEIL\?ref=\$BASIS/);
  assert.match(workflow, /node "\$BASIS_URTEIL"/);

  assert.match(workflow, /\[ ! -s "\$BASIS_URTEIL" \]; then\n\s*echo "::error/);
});

test('show_full_output ist tragend, nicht bequem', () => {



  // schwaecheren, an die Commit-SHA gebundenen Beleg zurueck.


  // Einstellung selbst schon auf false stand.
  assert.match(workflow, /^\s*show_full_output:\s*true\s*$/m);
});

test('die Basis ist eine SHA und wird VOR dem Lauf abgelesen', () => {






  //


  const schritte = [...workflow.matchAll(/^      - name: (.+)$/gm)].map((m) => m[1]);
  assert.ok(
    schritte.indexOf('Prueft die Review-Datei sich selbst?') <
      schritte.indexOf('Run Claude Code Review'),
    'der Selbst-Uebersprung wird erst nach dem Lauf geprueft'
  );
  for (const zeile of workflow.split('\n')) {
    if (/^\s*BASIS:\s/.test(zeile)) {
      assert.match(zeile, /base\.sha/, `BASIS traegt einen beweglichen Namen: ${zeile.trim()}`);
    }
  }
});

test('Entwurf und Bot-PR sind vom Nachweis ausgenommen', () => {



  assert.match(workflow, /github\.event\.pull_request\.draft != true/);
  assert.match(workflow, /github\.event\.pull_request\.user\.type != 'Bot'/);
});
