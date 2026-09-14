
import { createLogger } from '../../logger.js';
import * as db from '../../db.js';

export const log = createLogger('Health');

export const VISIBILITIES = ['private', 'family'];
export const LOG_STATUS   = ['taken', 'skipped', 'pending'];
export const FLOW_LEVELS  = ['spotting', 'light', 'medium', 'heavy'];
export const MAX_UNIT     = 30;

export function viewerId(req) {
  return req.authUserId || req.session.userId;
}




const CARED_FOR_SUBQUERY = 'SELECT subject_id FROM health_care_grants WHERE caregiver_id = ?';

export function visibilityClause(alias, viewer, personId) {
  if (personId) {
    if (personId === viewer) return { sql: `${alias}.user_id = ?`, params: [viewer] };
    return { sql: `${alias}.user_id = ? AND ${alias}.visibility = 'family'`, params: [personId] };
  }
  return { sql: `(${alias}.user_id = ? OR ${alias}.visibility = 'family')`, params: [viewer] };
}

export function careAwareClause(alias, viewer, personId) {
  if (personId) {
    if (personId === viewer) return { sql: `${alias}.user_id = ?`, params: [viewer] };


    return {
      sql: `${alias}.user_id = ? AND (${alias}.visibility = 'family' OR ? IN (${CARED_FOR_SUBQUERY}))`,
      params: [personId, personId, viewer],
    };
  }
  return {
    sql: `(${alias}.user_id = ? OR ${alias}.visibility = 'family' OR ${alias}.user_id IN (${CARED_FOR_SUBQUERY}))`,
    params: [viewer, viewer],
  };
}

// --------------------------------------------------------
// Betreuung (#584)
// --------------------------------------------------------

export function caredForIds(viewer) {
  if (!viewer) return [];
  return db.get().prepare(CARED_FOR_SUBQUERY).all(viewer).map((r) => r.subject_id);
}

export function canWriteFor(viewer, ownerId) {
  if (!viewer || !ownerId) return false;
  if (viewer === ownerId) return true;
  return !!db.get().prepare(
    'SELECT 1 FROM health_care_grants WHERE subject_id = ? AND caregiver_id = ?'
  ).get(ownerId, viewer);
}

export function writableClause(alias, viewer) {
  const col = `${alias ? `${alias}.` : ''}user_id`;
  return {
    sql: `(${col} = ? OR ${col} IN (${CARED_FOR_SUBQUERY}))`,
    params: [viewer, viewer],
  };
}

export function writableChild(sql, parentAlias, id, viewer) {
  const w = writableClause(parentAlias, viewer);
  return db.get().prepare(`${sql} AND ${w.sql}`).get(id, ...w.params) ?? null;
}

export function resolveOwner(req, viewer) {
  const raw = req.body?.user_id;
  if (raw === undefined || raw === null || raw === '') return { ownerId: viewer };

  const ownerId = parseInt(raw, 10);
  if (!ownerId) return { error: 'Ungültige Person.', status: 400 };
  if (!canWriteFor(viewer, ownerId)) {


    // Ursache unklar gemacht.
    return { error: 'Keine Berechtigung, für diese Person einzutragen.', status: 403 };
  }
  return { ownerId };
}

export function toBit(val) {
  if (val === undefined || val === null || val === '') return undefined;
  if (val === true  || val === 1 || val === '1' || val === 'true')  return 1;
  if (val === false || val === 0 || val === '0' || val === 'false') return 0;
  return undefined;
}

export function applyUpdate(table, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const setSql = keys.map((k) => `${k} = ?`).join(', ');
  db.get().prepare(`UPDATE ${table} SET ${setSql} WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), id);
}

export function deriveFlag(value, refLow, refHigh, provided) {
  if (provided) return provided;
  if (value === null || value === undefined) return null;
  if (refLow !== null && refLow !== undefined && value < refLow)  return 'low';
  if (refHigh !== null && refHigh !== undefined && value > refHigh) return 'high';
  if ((refLow !== null && refLow !== undefined) || (refHigh !== null && refHigh !== undefined)) return 'normal';
  return null;
}

export function badRequest(res, errors) {
  return res.status(400).json({ error: errors.join(' '), code: 400 });
}

export function attachResults(report) {
  if (!report) return report;
  report.results = db.get().prepare(
    'SELECT * FROM health_lab_results WHERE report_id = ? ORDER BY analyte COLLATE NOCASE ASC, id ASC'
  ).all(report.id);
  return report;
}

// --------------------------------------------------------
// CSV-Export-Bausteine (geteilt von export + cycle)
// --------------------------------------------------------

export function exportFilename(area, from, to) {
  const range = from && to ? `-${from}_${to}` : '';
  return `health-${area}${range}.csv`;
}

export function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`﻿${csv}`);
}

export function exportRange(req) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null;
  const to   = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '')   ? req.query.to   : null;
  return { from, to };
}
