import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf-8'));

/** `puppeteer@25.9.0` -> { name: 'puppeteer', version: '25.9.0' }, auch fuer @scope/name. */
function splitPin(pin) {
  const at = pin.lastIndexOf('@');
  return { name: pin.slice(0, at), version: pin.slice(at + 1) };
}

test('jeder allowScripts-Pin nennt die Version, die auch installiert wird', () => {
  const pins = Object.keys(pkg.allowScripts || {});
  assert.ok(pins.length > 0, 'ohne Pins hat dieser Test nichts zu pruefen');

  const drift = [];
  for (const pin of pins) {
    const { name, version } = splitPin(pin);
    const installed = lock.packages?.[`node_modules/${name}`]?.version;
    if (installed !== version) drift.push(`${name}: Pin ${version}, Lock ${installed ?? 'fehlt'}`);
  }

  assert.deepEqual(drift, [],
    'diese allowScripts-Pins zeigen auf eine Version, die nicht installiert wird. '
    + 'Nach einem Dependabot-Bump ist das der Normalfall - das Feld wird nicht mitgezogen. '
    + `Pin in package.json nachziehen: ${drift.join(' | ')}`);
});

test('jedes gepinnte Paket steht ueberhaupt in den Abhaengigkeiten', () => {


  // Auskunft darueber, was hier Skripte ausfuehren darf.
  const alle = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const verwaist = Object.keys(pkg.allowScripts || {})
    .map((pin) => splitPin(pin).name)
    .filter((name) => !(name in alle));

  assert.deepEqual(verwaist, [], `allowScripts nennt Pakete, die nicht mehr abhaengig sind: ${verwaist.join(', ')}`);
});
