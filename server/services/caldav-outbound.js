// --------------------------------------------------------

//
// Geteilt vom generischen Multi-Account-Sync (caldav-sync.js) und vom
// Apple-Legacy-Sync (apple-calendar.js): beide sprechen dasselbe Protokoll und

//




// --------------------------------------------------------

import { createLogger } from '../logger.js';
import * as outbound from './calendar-outbound.js';
import { patchICSEvent } from '../utils/ics-patch.js';
import { eventDateTimeFields } from '../utils/ics-datetime.js';
import { householdTimeZone } from '../utils/timezone.js';
import * as db from '../db.js';
import { nearestIcalColorName } from '../utils/ical-color.js';
import { outboundEvent } from './outbound-dtstart.js';
import { upsertExternalCalendar } from './external-calendars.js';

const log = createLogger('CalDAVOutbound');

const label = (source) => (source === 'apple' ? 'Apple' : 'CalDAV');

function applyMove(eventId, source, calendarUrl, destCal, objectUrl) {
  const conn = db.get();
  const selected = conn.prepare(
    'SELECT calendar_name, calendar_color FROM caldav_calendar_selection WHERE calendar_url = ? LIMIT 1'
  ).get(calendarUrl);
  const known = selected ? null : conn.prepare(
    'SELECT name, color FROM external_calendars WHERE source = ? AND external_id = ?'
  ).get(source, calendarUrl);

  const calRefId = upsertExternalCalendar(
    source, calendarUrl,
    selected?.calendar_name || known?.name || destCal.displayName || calendarUrl,
    selected ? selected.calendar_color : (known?.color ?? null),
  );
  conn.prepare(
    'UPDATE calendar_events SET calendar_ref_id = ?, external_object_url = ? WHERE id = ?'
  ).run(calRefId, objectUrl, eventId);
}

function deletedByUser(source, uid, sourceObjectUrl, sourceCalendarUrl) {
  return !!db.get().prepare(`
    SELECT 1 FROM calendar_pending_deletions
    WHERE source = ? AND event_external_id = ?
      AND (object_url = ? OR (object_url IS NULL AND calendar_external_id = ?))
  `).get(source, uid, sourceObjectUrl, sourceCalendarUrl);
}

export function icsFieldsForEvent(event, householdZone = null) {

  // importiertes DTSTART bleibt unberuehrt (#756).
  const when = eventDateTimeFields(outboundEvent(event), householdZone);

  const fields = {
    SUMMARY:     event.title,
    DESCRIPTION: event.description || null,
    LOCATION:    event.location || null,
    RRULE:       event.recurrence_rule || null,
    DTSTART:     when.dtstart,
    DTEND:       when.dtend,
  };



  //

  // Punkt von #899:
  //






  //





  // setzt, also holte auch kein spaeterer Lauf sie zurueck.
  //




  const colorName = nearestIcalColorName(event.color);
  if (colorName) fields.COLOR = colorName;
  else if (!event.color && event.color_modified) fields.COLOR = null;

  return { fields, tzid: when.tzid };
}

export function filenameFromUrl(url, uid) {
  const last = String(url).split('/').filter(Boolean).pop();
  return last && last.includes('.') ? last : `${uid}.ics`;
}

export async function fetchObjectsByUrl(client, wanted) {
  const index = new Map();
  if (!wanted.length) return index;

  // Nach Kalender gruppieren: fetchCalendarObjects adressiert Objekte innerhalb
  // einer Collection.
  const byCalendar = new Map();
  for (const item of wanted) {
    if (!item.url || !item.calendarUrl) continue;
    if (!byCalendar.has(item.calendarUrl)) byCalendar.set(item.calendarUrl, []);
    byCalendar.get(item.calendarUrl).push(item);
  }

  for (const [calendarUrl, items] of byCalendar) {
    try {
      const objects = await client.fetchCalendarObjects({
        calendar:   { url: calendarUrl },
        objectUrls: items.map((i) => i.url),
      });


      for (const obj of objects || []) {
        const match = items.find((i) => i.url === obj.url) || (items.length === 1 ? items[0] : null);
        if (!match) continue;
        index.set(match.uid, {
          url: obj.url || match.url, etag: obj.etag, data: obj.data, calendarUrl,
        });
      }
    } catch (err) {

      log.warn(`Could not fetch calendar objects from ${calendarUrl} for the immediate attempt: ${err.message}`);
    }
  }
  return index;
}

export async function flushAccount(client, source, { deletions, updates, needsCalendars }) {
  const wanted = updates
    .filter((e) => e.external_object_url)
    .map((e) => ({
      uid: e.external_calendar_id,
      url: e.external_object_url,
      calendarUrl: e.__calendarUrl,
    }));

  const objectIndex = await fetchObjectsByUrl(client, wanted);

  let calendarsByUrl = new Map();
  if (needsCalendars) {
    try {
      const cals = await client.fetchCalendars();
      calendarsByUrl = new Map((cals || []).map((c) => [c.url, c]));
    } catch (err) {
      log.warn(`Could not list calendars for the immediate attempt: ${err.message}`);
    }
  }




  const deleted = deletions.length ? await processPendingDeletions(client, source, objectIndex) : 0;
  const updated = objectIndex.size ? await processPendingUpdates(client, source, objectIndex, calendarsByUrl) : 0;
  return { deleted, updated };
}

export async function processPendingDeletions(client, source, objectIndex, ownCalendarUrls = null) {
  const rows = outbound.pendingDeletions(source);
  if (rows.length === 0) return 0;

  let done = 0;
  for (const row of rows) {



    if (ownCalendarUrls && row.calendar_external_id && !ownCalendarUrls.has(row.calendar_external_id)) continue;

    const known = objectIndex.get(row.event_external_id);
    const url   = row.object_url || known?.url || null;

    if (!url) {


      if (ownCalendarUrls) {
        log.info(`[${label(source)}] Event ${row.event_external_id} is no longer on the server, dropping the pending deletion.`);
        outbound.dropDeletion(row.id);
        done++;
      }
      continue;
    }

    try {
      await client.deleteCalendarObject({ calendarObject: { url, etag: known?.etag } });
      outbound.dropDeletion(row.id);
      done++;
    } catch (err) {
      if (outbound.handleDeletionError(err, row, label(source))
          && outbound.classifyOutboundError(err) === 'settled') {
        done++;
      }
    }
  }
  return done;
}

export async function processPendingUpdates(client, source, objectIndex, calendarsByUrl = new Map()) {
  const events = outbound.pendingUpdates(source);
  if (events.length === 0) return 0;



  const zone = householdTimeZone(db.get());

  let done = 0;
  for (const event of events) {
    const known = objectIndex.get(event.external_calendar_id);
    const url   = event.external_object_url || known?.url || null;



    if (!url) continue;

    if (!known?.data) {

      // alles, was Aashiyana nicht kennt (Teilnehmer, Alarme, Kategorien).
      log.warn(`[${label(source)}] No source object for event ${event.id} in this run, deferring its update.`);
      continue;
    }


    // weitere Bearbeitung eingetroffen sein kann.
    const fresh = outbound.reloadEvent(event.id);
    if (!fresh) continue;

    const { fields, tzid } = icsFieldsForEvent(fresh, zone);
    const patched = patchICSEvent(known.data, event.external_calendar_id, fields, { tzid });
    if (!patched) {
      log.warn(`[${label(source)}] Event ${event.external_calendar_id} has no editable VEVENT in its calendar object, dropping its update.`);
      outbound.clearOutbound(event.id);
      continue;
    }


    const moveTo = event.outbound_move_to;
    if (moveTo && moveTo !== known.calendarUrl) {
      const destCal = calendarsByUrl.get(moveTo);
      if (!destCal) {
        log.warn(`[${label(source)}] Destination calendar ${moveTo} is not available, keeping event ${event.id} where it is.`);
        outbound.clearOutboundMove(event.id);
      } else {
        try {
          const filename = filenameFromUrl(url, event.external_calendar_id);



          const collectionUrl = String(destCal.url).replace(/\/?$/, '/');
          const objectUrl = new URL(filename, collectionUrl).href;
          await client.createCalendarObject({
            calendar:   { ...destCal, url: collectionUrl },
            filename,
            iCalString: patched,
          });


          try {
            await client.deleteCalendarObject({ calendarObject: { url, etag: known.etag } });
          } catch (err) {
            log.error(`[${label(source)}] Event ${event.id} was copied to ${moveTo} but could not be removed from its old calendar:`, err.message);
          }




          if (!outbound.reloadEvent(event.id)) {
            if (deletedByUser(source, event.external_calendar_id, url, known.calendarUrl)) {
              outbound.queueDeletion({
                source, calendarExternalId: moveTo, eventExternalId: event.external_calendar_id, objectUrl,
              });
              log.warn(`[${label(source)}] Event ${event.id} was deleted during its move, queued the deletion of its copy in ${moveTo}.`);
            }
            continue;
          }
          applyMove(event.id, source, moveTo, destCal, objectUrl);
          outbound.settleOutbound(fresh, moveTo);
          done++;
          continue;
        } catch (err) {
          outbound.handleUpdateError(err, event, 'move', label(source), outbound.clearOutboundMove);
          continue;
        }
      }
    } else if (moveTo) {
      outbound.clearOutboundMove(event.id);
    }

    if (!event.outbound_dirty) continue;

    try {
      await client.updateCalendarObject({
        calendarObject: { url, etag: known.etag, data: patched },
      });
      outbound.settleOutbound(fresh);
      done++;
    } catch (err) {
      outbound.handleUpdateError(err, event, 'update', label(source));
    }
  }
  return done;
}
