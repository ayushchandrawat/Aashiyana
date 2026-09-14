
import { seriesStartFor } from './recurrence.js';
import { utcToWall } from '../utils/timezone.js';

function istEigen(event) {
  const quelle = event?.external_source;
  return !quelle || quelle === 'local';
}

function zonenUnsicher(event) {
  if (!event?.tzid) return false;
  const roh = String(event.start_datetime ?? '');
  const wandUhr = utcToWall(roh, event.tzid);
  return !(wandUhr && wandUhr.date === roh.slice(0, 10));
}

export function outboundStartDatetime(event) {
  const roh = event?.start_datetime;
  if (!roh || !event?.recurrence_rule) return roh;
  if (!istEigen(event)) return roh;
  return seriesStartFor(roh, event.recurrence_rule, { utcDiffersFromLocal: zonenUnsicher(event) });
}

/** Tage zwischen zwei YYYY-MM-DD-Werten (b - a). */
function tagesDifferenz(a, b) {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/** Denselben Datumsteil um `tage` verschieben, Uhrzeit und Format unberuehrt. */
function verschiebe(wert, tage) {
  const roh = String(wert);
  const tag = roh.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tag) || !tage) return wert;
  const d = new Date(`${tag}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  const p = (n) => String(n).padStart(2, '0');
  const neu = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  return roh.replace(tag, neu);
}

export function outboundDateRange(event) {
  const start = outboundStartDatetime(event);
  const ende = event?.end_datetime ?? null;
  if (!start || start === event?.start_datetime) return { start_datetime: event?.start_datetime, end_datetime: ende };
  const tage = tagesDifferenz(String(event.start_datetime).slice(0, 10), String(start).slice(0, 10));
  return { start_datetime: start, end_datetime: ende ? verschiebe(ende, tage) : ende };
}

export function outboundEvent(event) {
  if (!event) return event;
  return { ...event, ...outboundDateRange(event) };
}

