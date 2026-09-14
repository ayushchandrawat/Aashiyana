import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import healthRouter from '../server/routes/health.js';

import vitalsRouter from '../server/routes/health/vitals.js';
import medicationsRouter from '../server/routes/health/medications.js';
import labsRouter from '../server/routes/health/labs.js';
import activitiesRouter from '../server/routes/health/activities.js';
import exportRouter from '../server/routes/health/export.js';
import cycleRouter from '../server/routes/health/cycle.js';
import cycleFeedRouter from '../server/routes/health/cycle-feed.js';
import caregiversRouter from '../server/routes/health/caregivers.js';
import visibilityDefaultsRouter from '../server/routes/health/visibility-defaults.js';

function collectRoutes(router) {
  const out = [];
  const walk = (stack) => {
    for (const layer of stack) {
      if (layer.route) {
        const p = layer.route.path;
        const methods = layer.route.methods || (layer.route.route && layer.route.route.methods) || {};
        for (const m of Object.keys(methods)) {
          if (m === '_all') continue;
          out.push(`${m.toUpperCase()} ${p}`);
        }
      } else if (layer.handle && Array.isArray(layer.handle.stack)) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(router.stack);
  return out;
}

const EXPECTED = [
  // vitals
  'GET /vitals',
  'POST /vitals',
  'PATCH /vitals/:id',
  'DELETE /vitals/:id',
  // medications + schedules + logs
  'GET /medications',
  'POST /medications',
  'PATCH /medications/:id',
  'DELETE /medications/:id',
  'GET /medications/:id/schedules',
  'POST /medications/:id/schedules',
  'PATCH /schedules/:id',
  'DELETE /schedules/:id',
  'GET /medications/:id/logs',
  'POST /medications/:id/logs',


  'PATCH /logs/:id',
  'DELETE /logs/:id',
  'POST /logs/:id/take',
  'POST /logs/:id/skip',
  // labs + results
  'GET /labs',
  'GET /labs/:id',
  'POST /labs',
  'PATCH /labs/:id',
  'DELETE /labs/:id',
  'POST /labs/:id/results',
  'DELETE /results/:id',
  // activities
  'GET /activities',
  'POST /activities',
  'PATCH /activities/:id',
  'DELETE /activities/:id',

  'GET /export/vitals',
  'GET /export/activities',
  'GET /export/labs',
  'GET /export/meds-logs',
  // cycle
  'GET /cycle/periods',
  'POST /cycle/periods',
  'PATCH /cycle/periods/:id',
  'DELETE /cycle/periods/:id',
  'GET /cycle/logs',
  'POST /cycle/logs',
  'DELETE /cycle/logs/:id',
  'GET /cycle/settings',
  'PUT /cycle/settings',
  'PATCH /cycle/visibility',
  'GET /export/cycle',
  // Zyklus-ICS-Feed-Token (Migration 180)
  'GET /cycle/feed',
  'POST /cycle/feed/regenerate',
  'DELETE /cycle/feed',
  // Betreuung (#584): wer darf fuer wen eintragen
  'GET /caregivers/me',
  'GET /caregivers',
  'PUT /caregivers/:subjectId',
  // Persoenliche Standard-Sichtbarkeit je Bereich (#958)
  'GET /visibility-defaults',
  'PUT /visibility-defaults',
  'PATCH /visibility-defaults/apply',
];

test('Orchestrator ergibt exakt die erwartete Routentabelle (53 Routen)', () => {
  const actual = collectRoutes(healthRouter).sort();
  assert.deepEqual(actual, [...EXPECTED].sort());
  assert.equal(actual.length, 53);
});

test('die Cluster-Router zusammen ergeben genau die Orchestrator-Routen (keine verlorene/doppelte Route)', () => {
  const perModule = [
    vitalsRouter, medicationsRouter, labsRouter, activitiesRouter, exportRouter, cycleRouter,
    cycleFeedRouter, caregiversRouter, visibilityDefaultsRouter,
  ].flatMap(collectRoutes);

  const seen = new Set();
  for (const r of perModule) {
    assert.ok(!seen.has(r), `Route ${r} kommt in mehreren Cluster-Routern vor`);
    seen.add(r);
  }
  assert.deepEqual(perModule.sort(), collectRoutes(healthRouter).sort());
});

test('Default-Export ist ein montierbarer Router', () => {
  assert.equal(typeof healthRouter, 'function', 'default export ist kein Router');
});

// --------------------------------------------------------
// Scope-Guard (#884)
// --------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROUTE_DIR = path.join(HERE, '..', 'server', 'routes', 'health');



// anderen benutzen sollen.
const SCOPE_OWNER = 'helpers.js';




const RAW_PARENT_SCOPE = /\b[a-z][a-z0-9_]*\.user_id\s*=\s*\?/;

test('kein handgeschriebenes <alias>.user_id = ? ausserhalb von helpers.js (#884)', () => {
  const offenders = [];
  for (const file of fs.readdirSync(ROUTE_DIR).filter((f) => f.endsWith('.js') && f !== SCOPE_OWNER)) {
    const lines = fs.readFileSync(path.join(ROUTE_DIR, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (RAW_PARENT_SCOPE.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [],
    'Scoping ueber einen Eltern-Alias gehoert in writableChild()/writableClause(), sonst faellt die Betreuung (#584) still weg');
});



test('der Scope-Guard erkennt das Muster, das er verbietet', () => {
  assert.ok(RAW_PARENT_SCOPE.test('WHERE s.id = ? AND m.user_id = ?'), 'Verstoss wird nicht erkannt');
  assert.ok(!RAW_PARENT_SCOPE.test("SELECT * FROM cycle_settings WHERE user_id = ?"), 'eigene Spalte faelschlich beanstandet');
});
