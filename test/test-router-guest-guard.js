import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  setPermissions,
  clearPermissions,
  canAccessNavModule,
} from '../public/permissions.js';

const routerSrc = readFileSync(new URL('../public/router.js', import.meta.url), 'utf8');

test('jede split_guest→/budget-Weiche prüft canAccessNavModule("budget")', () => {


  const guardRe = /access_scope === 'split_guest'[\s\S]{0,200}?navigate\('\/budget'\)/g;
  const matches = routerSrc.match(guardRe) ?? [];
  assert.ok(matches.length >= 2, `erwartet ≥2 split_guest→/budget-Weichen, gefunden ${matches.length}`);
  for (const block of matches) {
    assert.match(
      block,
      /canAccessNavModule\('budget'\)/,
      'split_guest→/budget-Weiche ohne Budget-Rechteprüfung → Schleifengefahr (#480)',
    );
  }
});

test('Budget-gesperrter Gast: Weiche feuert nicht (canAccessNavModule false)', () => {

  setPermissions({ admin: false, modules: { budget: 'none' }, widgets: {} });
  assert.equal(canAccessNavModule('budget'), false);
  clearPermissions();
});

test('regulärer Gast ohne Einschränkung: Weiche feuert weiterhin', () => {
  // Reiner split_guest ohne Rechte-Overrides → Vollzugriff (fail-open).
  setPermissions({ admin: false, modules: {}, widgets: {} });
  assert.equal(canAccessNavModule('budget'), true);
  clearPermissions();
});
