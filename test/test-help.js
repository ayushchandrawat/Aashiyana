import { test } from 'node:test';
import assert from 'node:assert/strict';

const { buildHelpRows } = await import('../public/utils/help.js');


const t = (key) => key;
const shortcuts = [
  { key: '/', description: () => 'shortcuts.search' },
  { key: '?', description: () => 'shortcuts.help' },
];

test('Desktop (coarsePointer:false) liefert Tastenkürzel-Zeilen', () => {
  const rows = buildHelpRows({ coarsePointer: false, shortcuts, t });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { key: '/', desc: 'shortcuts.search' });
  assert.equal(rows[1].key, '?');
  assert.ok(rows.every((r) => 'key' in r && !('icon' in r)));
});

test('Touch (coarsePointer:true) liefert Klartext-Zeilen mit Icons', () => {
  const rows = buildHelpRows({ coarsePointer: true, shortcuts, t });
  assert.ok(rows.length >= 4);
  assert.ok(rows.every((r) => 'icon' in r && 'desc' in r && !('key' in r)));

  assert.deepEqual(
    rows.map((r) => r.desc),
    ['help.mobileNavigate', 'help.mobileCreate', 'help.mobileSearch', 'nav.moreCatalogHint', 'help.mobileSettings']
  );
});

test('Touch-Zeilen verwenden vorhandene Lucide-Iconnamen', () => {
  const rows = buildHelpRows({ coarsePointer: true, shortcuts, t });
  assert.deepEqual(
    rows.map((r) => r.icon),
    ['navigation', 'plus-circle', 'search', 'layout-grid', 'settings']
  );
});
