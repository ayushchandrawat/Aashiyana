
import { reminderDateBefore } from '../utils/reminder-schedule.js';

function dateKey(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function parseDateKey(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('Date must be in YYYY-MM-DD format.');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (dateKey(date) !== value) throw new Error('Date is invalid.');
  return date;
}

/** Kaufdatum + Garantiemonate -> YYYY-MM-DD. */
function warrantyEndDate(purchaseDate, warrantyMonths) {
  const date = parseDateKey(purchaseDate);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + Number(warrantyMonths));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return dateKey(date);
}

function reminderDateForWarranty(warrantyEnd, offsetDays = 30) {
  return reminderDateBefore(warrantyEnd, offsetDays);
}

export { warrantyEndDate, reminderDateForWarranty };
