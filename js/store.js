// In-memory cache of the spreadsheet tabs, with typed records and ID generation.

import { SCHEMA, WINE_KIND, WINE_CATEGORY } from './config.js';
import * as sheets from './sheets.js';

const tables = {};
let version = 0;

// Wines are ingredients kept in their own WINES tab. Everywhere else in the app they are read
// and written as INGREDIENTS: rows('INGREDIENTS') lists both tabs, IDs are numbered across both,
// and a write goes to whichever tab holds the record. Each row carries its tab in `_tab`.
const WINE_TAB = 'WINES';
const PARTS = { INGREDIENTS: ['INGREDIENTS', WINE_TAB] };
const partsOf = tab => PARTS[tab] || [tab];
const isWineRecord = r => String(r?.KIND ?? '').trim().toLowerCase() === WINE_KIND;
/** The tab a new record of `tab` belongs in. */
const homeOf = (tab, rec) => (tab === 'INGREDIENTS' && isWineRecord(rec) ? WINE_TAB : tab);
let merged = null;

/** Bumped on every reload of any tab, so derived caches know when to rebuild. */
export const dataVersion = () => version;

function coerceIn(tab, rec) {
  const s = SCHEMA[tab];
  for (const f of s.numbers || []) {
    const v = rec[f];
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(v)) rec[f] = Number(v);
  }
  // Blank ACTIVE (e.g. a row typed straight into the sheet) counts as active.
  for (const f of s.booleans || []) {
    const v = rec[f];
    rec[f] = v === '' || v == null || v === true || String(v).toUpperCase() === 'TRUE';
  }
  return rec;
}

function coerceOut(tab, rec) {
  const s = SCHEMA[tab];
  const out = { ...rec };
  delete out._row;
  delete out._tab;
  for (const f of s.numbers || []) {
    if (!(f in out)) continue;
    const v = out[f];
    out[f] = v === '' || v == null || isNaN(v) ? '' : Number(v);
  }
  for (const f of s.booleans || []) if (f in out) out[f] = !!out[f];
  for (const [k, v] of Object.entries(out)) if (typeof v === 'string') out[k] = v.trim();
  return out;
}

function put(tab, table) {
  table.rows.forEach(r => {
    coerceIn(tab, r);
    r._tab = tab;
    // What the WINES tab implies, so the rest of the app sees an ordinary wine ingredient.
    if (tab === WINE_TAB) Object.assign(r, { KIND: WINE_KIND, CATEGORY: WINE_CATEGORY, 'YIELD_%': 100, UNIT: r.UNIT || 'ml' });
  });
  tables[tab] = table;
  merged = null;
  version++;
}

export async function loadAll() {
  await refresh(...Object.keys(SCHEMA));
}

export async function refresh(...tabs) {
  const all = [...new Set(tabs.flatMap(partsOf))];
  const res = await sheets.readTables(all);
  for (const tab of all) put(tab, res[tab]);
}

export function rows(tab) {
  if (tab !== 'INGREDIENTS') return tables[tab]?.rows ?? [];
  if (!merged) {
    // A wine left in both tabs by an interrupted move counts once, as the WINES copy.
    const wines = tables[WINE_TAB]?.rows ?? [];
    const ids = new Set(wines.map(r => String(r.ING_ID)));
    merged = [...(tables.INGREDIENTS?.rows ?? []).filter(r => !ids.has(String(r.ING_ID))), ...wines];
  }
  return merged;
}

/** The rows actually in one tab: for INGREDIENTS, without the wines that rows() merges in. */
export function tabRows(tab) {
  return tables[tab]?.rows ?? [];
}

export function byId(tab, id) {
  const f = SCHEMA[tab].idField;
  return rows(tab).find(r => String(r[f]) === String(id)) || null;
}

function nextId(tab) {
  const { idField, idPrefix } = SCHEMA[tab];
  const re = new RegExp(`^${idPrefix}-(\\d+)$`);
  const max = rows(tab).reduce((m, r) => {
    const match = re.exec(String(r[idField]));
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  return `${idPrefix}-${String(max + 1).padStart(4, '0')}`;
}

/** Append new records; returns their generated IDs in order. */
export async function createMany(tab, records) {
  // Re-read first so new IDs account for rows other users added since we loaded.
  await refresh(tab);
  const { idField, idPrefix } = SCHEMA[tab];
  const start = Number(nextId(tab).slice(idPrefix.length + 1));
  const ids = records.map((_, i) => `${idPrefix}-${String(start + i).padStart(4, '0')}`);
  for (const part of partsOf(tab)) {
    const mine = records.map((r, i) => ({ r, id: ids[i] })).filter(({ r }) => homeOf(tab, r) === part);
    if (!mine.length) continue;
    await sheets.appendRows(part, tables[part].headers, mine.map(({ r, id }) => ({ ...coerceOut(part, r), [idField]: id })), idField);
  }
  await refresh(tab);
  return ids;
}

/** Append a new record; returns its generated ID. */
export async function create(tab, record) {
  return (await createMany(tab, [record]))[0];
}

/** `changes` is [{ id, record }]; only the fields in each record are written. */
export async function updateMany(tab, changes) {
  const { idField } = SCHEMA[tab];
  // An ingredient marked as a wine moves to the WINES tab.
  const moving = changes.filter(({ id, record }) => homeOf(tab, record) === WINE_TAB && byId(tab, id)?._tab === 'INGREDIENTS');
  const staying = changes.filter(c => !moving.includes(c));
  for (const part of partsOf(tab)) {
    const mine = staying.filter(({ id }) => (byId(tab, id)?._tab ?? tab) === part);
    if (!mine.length) continue;
    await sheets.updateRowsById(part, idField, mine.map(({ id, record }) => ({
      id, patch: { ...coerceOut(part, record), [idField]: id },
    })));
  }
  if (moving.length) await moveToWines(moving);
  await refresh(tab);
}

/**
 * Move ingredients into the WINES tab, keeping their IDs so prices, recipes and menus still link.
 * `changes` is [{ id, record }], with anything to change on the way. The wine is added to WINES
 * before it is removed from INGREDIENTS, so an interruption leaves a duplicate (which reads as
 * the WINES copy, and the next move tidies up), never a lost wine.
 */
export async function moveToWines(changes) {
  await refresh('INGREDIENTS');
  const inWines = new Set(rows(WINE_TAB).map(r => String(r.ING_ID)));
  const add = [];
  for (const { id, record } of changes) {
    const row = tables.INGREDIENTS.rows.find(r => String(r.ING_ID) === String(id));
    if (row && !inWines.has(String(id))) add.push({ ...coerceOut(WINE_TAB, { ...row, ...record }), ING_ID: row.ING_ID });
  }
  if (add.length) await sheets.appendRows(WINE_TAB, tables[WINE_TAB].headers, add, 'ING_ID');
  await sheets.deleteRowsById([{ tab: 'INGREDIENTS', idField: 'ING_ID', ids: changes.map(c => c.id) }]);
  await refresh('INGREDIENTS');
}

export async function update(tab, id, record) {
  await updateMany(tab, [{ id, record }]);
}

/** Delete records from one or more tabs in one all-or-nothing request. `spec` is { TAB: [ids] }. */
export async function remove(spec) {
  const tabs = Object.keys(spec);
  const specs = tabs.flatMap(tab => partsOf(tab).map(part => ({
    tab: part, idField: SCHEMA[tab].idField,
    ids: spec[tab].filter(id => (byId(tab, id)?._tab ?? tab) === part),
  }))).filter(s => s.ids.length);
  await sheets.deleteRowsById(specs);
  await refresh(...tabs);
}

export const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

/** Append price-history rows: entries are { ING_ID, SUPPLIER_ID, PRICE_ID, PACK_PRICE, INVOICE_REF }. */
export async function logPrices(entries) {
  if (!entries.length) return;
  const tab = 'PRICE_HISTORY';
  const headers = tables[tab]?.headers?.length ? tables[tab].headers : SCHEMA[tab].headers;
  await sheets.appendRows(tab, headers, entries.map(e => coerceOut(tab, { DATE: today(), INVOICE_REF: '', ...e })), null);
  await refresh(tab);
}
