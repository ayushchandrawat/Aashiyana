

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.DB_PATH = ':memory:';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { default: calendarRouter, __test } = await import('../server/routes/calendar.js');

const { default: readRouter } = await import('../server/routes/calendar/read.js');
const { default: googleRouter } = await import('../server/routes/calendar/google.js');
const { default: appleRouter } = await import('../server/routes/calendar/apple.js');
const { default: subscriptionsRouter } = await import('../server/routes/calendar/subscriptions.js');
const { default: feedRouter } = await import('../server/routes/calendar/feed.js');
const { default: crudRouter } = await import('../server/routes/calendar/crud.js');
const { default: caldavRouter } = await import('../server/routes/calendar/caldav.js');
const { default: syncTargetsRouter } = await import('../server/routes/calendar/sync-targets.js');
const { default: outlookRouter } = await import('../server/routes/calendar/outlook.js');

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
  // read
  'GET /',
  'GET /upcoming',
  'GET /search',
  // google + external-calendars
  'GET /google/auth',
  'GET /google/callback',
  'POST /google/sync',
  'GET /google/status',
  'GET /google/calendars',
  'PATCH /google/calendars',
  'PATCH /external-calendars',
  'GET /external-calendars/default-assignee-backfill',
  'POST /external-calendars/default-assignee-backfill',
  'DELETE /google/disconnect',
  'DELETE /google/mirrored-events',
  'DELETE /apple/mirrored-events',
  'PUT /google/readonly',
  // apple
  'GET /apple/status',
  'POST /apple/sync',
  'POST /apple/connect',
  'DELETE /apple/disconnect',
  // subscriptions + import
  'GET /subscriptions',
  'POST /subscriptions',
  'PATCH /subscriptions/:id',
  'DELETE /subscriptions/:id',
  'POST /subscriptions/:id/sync',
  'POST /import',
  // feed + holidays
  'GET /feed',
  'PUT /feed',
  'POST /feed/regenerate',
  'DELETE /feed',
  'GET /holidays',
  // sync-targets (Auswahlliste des Event-Modals, #618)
  'GET /sync-targets',
  // crud (/:id-Familie)
  'GET /:id',
  'POST /',
  'PUT /:id',
  'PUT /:seriesId/occurrences/:recurrenceId',
  'PUT /:seriesId/occurrences/:recurrenceId/following',
  'POST /:id/reset',
  'POST /:id/exceptions',
  'DELETE /:id',
  'DELETE /:seriesId/occurrences/:recurrenceId',
  'DELETE /:seriesId/occurrences/:recurrenceId/following',
  // caldav (events + reminders)
  'POST /caldav/accounts',
  'GET /caldav/accounts',
  'PUT /caldav/accounts/:id',
  'DELETE /caldav/accounts/:id',
  'GET /caldav/accounts/:id/calendars',
  'PATCH /caldav/accounts/:id/calendars',
  'POST /caldav/sync',
  'GET /caldav/status',
  'GET /caldav/accounts/:id/reminder-lists',
  'PATCH /caldav/accounts/:id/reminder-lists',
  'POST /caldav/reminders/sync',
  'GET /caldav/reminders/status',
  // outlook (Microsoft Graph, one-way push)
  'GET /outlook/auth',
  'GET /outlook/callback',
  'GET /outlook/accounts',
  'PUT /outlook/accounts/:id',
  'DELETE /outlook/accounts/:id',
  'GET /outlook/accounts/:id/calendars',
  'PATCH /outlook/accounts/:id/calendars',
  'POST /outlook/sync',
  'GET /outlook/status',
];

test('Orchestrator ergibt exakt die erwartete Routentabelle (63 Routen)', () => {
  const actual = collectRoutes(calendarRouter).sort();
  assert.deepEqual(actual, [...EXPECTED].sort());
  assert.equal(actual.length, 63);
});

test('die Cluster-Router zusammen ergeben genau die Orchestrator-Routen (keine verlorene/doppelte Route)', () => {
  const perModule = [
    readRouter, googleRouter, appleRouter, subscriptionsRouter, feedRouter, crudRouter, caldavRouter,
    syncTargetsRouter, outlookRouter,
  ].flatMap(collectRoutes);

  const seen = new Set();
  for (const r of perModule) {
    assert.ok(!seen.has(r), `Route ${r} kommt in mehreren Cluster-Routern vor`);
    seen.add(r);
  }
  assert.deepEqual(perModule.sort(), collectRoutes(calendarRouter).sort());
});

test('GET /:id wird nach allen kollisionsgefährdeten GET-Pfaden gemountet', () => {
  const ordered = collectRoutes(calendarRouter);
  const idxCatchAll = ordered.indexOf('GET /:id');
  assert.ok(idxCatchAll >= 0, 'GET /:id fehlt');


  const collisionProne = ['GET /upcoming', 'GET /search', 'GET /holidays', 'GET /sync-targets'];
  for (const route of collisionProne) {
    const idx = ordered.indexOf(route);
    assert.ok(idx >= 0, `${route} fehlt`);
    assert.ok(idx < idxCatchAll, `${route} muss vor GET /:id gemountet sein (Reihenfolge-Vertrag)`);
  }
});

test('Default-Export ist ein montierbarer Router', () => {
  assert.equal(typeof calendarRouter, 'function', 'default export ist kein Router');
});

test('Re-Export-Fläche __test.googleTarget bleibt erhalten (test:google-multi)', () => {
  assert.equal(typeof __test?.googleTarget, 'function', '__test.googleTarget fehlt oder ist keine Funktion');
});
