/**
 * Local-date helpers for YYYY-MM-DD values sent to the API.
 * These deliberately use local calendar fields instead of UTC ISO strings.
 */



// (vgl. './ux.js' in bulk-pill.js).
import { todayKey as zonedTodayKey } from './timezone.js';

export function todayKey() {
  return zonedTodayKey();
}

export function toLocalDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseLocalDateKey(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function addLocalDays(dateKey, days) {
  const date = parseLocalDateKey(dateKey);
  date.setDate(date.getDate() + days);
  return toLocalDateKey(date);
}

export function startOfLocalWeekKey(dateKey, weekStartsOn = 1) {
  const date = parseLocalDateKey(dateKey);
  const day = date.getDay();
  const diff = (day - weekStartsOn + 7) % 7;
  date.setDate(date.getDate() - diff);
  return toLocalDateKey(date);
}

export function monthPeriodKeys(dateKey) {
  const from = `${String(dateKey).slice(0, 7)}-01`;
  const date = parseLocalDateKey(from);
  date.setMonth(date.getMonth() + 1);
  date.setDate(0);
  return { from, to: toLocalDateKey(date) };
}

export function defaultDateInPeriod(from, to, today = todayKey()) {
  if (!from) return today;
  return (today >= from && today <= (to || from)) ? today : from;
}

export const WEEK_START_INDEX = { monday: 1, sunday: 0, saturday: 6 };

export function weekStartIndex(value) {
  return WEEK_START_INDEX[value] ?? 1;
}

export function isWeekendKey(dateKey) {
  const day = parseLocalDateKey(dateKey).getDay();
  return day === 0 || day === 6;
}

export function weekdayOrder(weekStart = 1) {
  const start = typeof weekStart === 'number' ? weekStart : weekStartIndex(weekStart);
  return Array.from({ length: 7 }, (_, i) => (start + i) % 7);
}

export function shiftEndDateKey(oldStartKey, newStartKey, endKey) {
  const from = parseLocalDateKey(oldStartKey);
  const to = parseLocalDateKey(newStartKey);
  const deltaDays = Math.round((to.getTime() - from.getTime()) / 86400000);
  return addLocalDays(endKey, deltaDays);
}

export function isEndBeforeStart(startDatetime, endDatetime) {
  if (!endDatetime) return false;
  const [startDay, startTime] = String(startDatetime).split('T');
  const [endDay, endTime] = String(endDatetime).split('T');
  if (endDay !== startDay) return endDay < startDay;
  if (startTime && endTime) return endTime < startTime;
  return false;
}
