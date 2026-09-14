process.env.DB_PATH = ':memory:';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const db = (await import('../server/db.js')).get();
const { recordSyncOutcome, readSyncOutcome, withSyncOutcome, MAX_SYNC_ERROR_LENGTH } =
  await import('../server/services/sync-outcome.js');
const googleCalendar = await import('../server/services/google-calendar.js');
const appleCalendar = await import('../server/services/apple-calendar.js');

function cfg(key) {
  return db.prepare('SELECT value FROM sync_config WHERE key = ?').get(key)?.value ?? null;
}

beforeEach(() => {
  db.prepare('DELETE FROM sync_config').run();
});

describe('Sync-Ergebnis festhalten (#820)', () => {
  it('hält einen Fehler mit Zeitstempel fest', () => {
    recordSyncOutcome(db, 'google', new Error('invalid_grant'));
    const { lastError, lastErrorAt } = readSyncOutcome(db, 'google');
    assert.equal(lastError, 'invalid_grant');
    assert.match(lastErrorAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('ein sauberer Lauf LÖSCHT den alten Stand', () => {



    recordSyncOutcome(db, 'google', new Error('invalid_grant'));
    recordSyncOutcome(db, 'google', null);
    assert.deepEqual(readSyncOutcome(db, 'google'), { lastError: null, lastErrorAt: null });
    assert.equal(cfg('google_last_error_at'), null, 'der Zeitstempel muss mitgehen');
  });

  it('trennt die Provider: Apples Fehler räumt Google nicht ab', () => {
    recordSyncOutcome(db, 'google', new Error('google kaputt'));
    recordSyncOutcome(db, 'apple', new Error('apple kaputt'));
    recordSyncOutcome(db, 'apple', null);
    assert.equal(readSyncOutcome(db, 'google').lastError, 'google kaputt');
    assert.equal(readSyncOutcome(db, 'apple').lastError, null);
  });

  it('deckelt eine ausufernde Meldung', () => {


    recordSyncOutcome(db, 'google', new Error('x'.repeat(5000)));
    assert.equal(readSyncOutcome(db, 'google').lastError.length, MAX_SYNC_ERROR_LENGTH);
  });

  it('nimmt auch einen nackten String, nicht nur ein Error-Objekt', () => {
    recordSyncOutcome(db, 'google', 'HTTP 503');
    assert.equal(readSyncOutcome(db, 'google').lastError, 'HTTP 503');
  });
});

describe('withSyncOutcome umschließt den Lauf, ohne ihn zu verändern (#820)', () => {
  it('gibt das Ergebnis durch und räumt den Fehlerstand ab', async () => {
    recordSyncOutcome(db, 'google', new Error('alt'));
    const result = await withSyncOutcome(db, 'google', async () => ({ imported: 3 }));
    assert.deepEqual(result, { imported: 3 });
    assert.equal(readSyncOutcome(db, 'google').lastError, null);
  });

  it('WIRFT den Fehler weiter, nachdem er festgehalten wurde', async () => {



    await assert.rejects(
      () => withSyncOutcome(db, 'google', async () => { throw new Error('boom'); }),
      /boom/,
    );
    assert.equal(readSyncOutcome(db, 'google').lastError, 'boom');
  });

  it('ein Schreibfehler beim Festhalten bringt den Lauf nicht zu Fall', async () => {

    const brokenDb = { prepare() { throw new Error('DB weg'); } };
    const result = await withSyncOutcome(brokenDb, 'google', async () => 'fertig');
    assert.equal(result, 'fertig');
  });
});

describe('Der Status trägt den Fehler nach außen (#820)', () => {
  it('Google: ein gescheiterter Lauf steht danach im Status', async () => {



    await assert.rejects(() => googleCalendar.sync());

    const status = googleCalendar.getStatus();
    assert.ok(status.lastError, 'der Status nennt keinen Fehler: ' + JSON.stringify(status));
    assert.match(status.lastErrorAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('Google: das Trennen nimmt den Fehlerstand mit', () => {
    recordSyncOutcome(db, 'google', new Error('invalid_grant'));
    googleCalendar.disconnect();


    assert.equal(googleCalendar.getStatus().lastError, null);
    assert.equal(cfg('google_last_error_at'), null);
  });

  it('Apple: ein gescheiterter Lauf steht danach im Status', async () => {
    await assert.rejects(() => appleCalendar.sync());
    assert.ok(appleCalendar.getStatus().lastError);
  });

  it('Apple: das Trennen nimmt den Fehlerstand mit', () => {
    recordSyncOutcome(db, 'apple', new Error('401 Unauthorized'));
    appleCalendar.clearCredentials();
    assert.equal(appleCalendar.getStatus().lastError, null);
  });

  it('ohne Fehler meldet der Status null, nicht undefined', () => {


    assert.equal(googleCalendar.getStatus().lastError, null);
    assert.equal(appleCalendar.getStatus().lastError, null);
  });
});
