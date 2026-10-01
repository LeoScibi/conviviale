// In-memory cache of the spreadsheet tabs, with typed records and ID generation.

import { SCHEMA } from './config.js';
import * as sheets from './sheets.js';

const tables = {};

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
  delete out._raw;
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
  table.rows.forEach(r => coerceIn(tab, r));
  tables[tab] = table;
}

export async function loadAll() {
  await refresh(...Object.keys(SCHEMA));
}

export async function refresh(...tabs) {
  const res = await sheets.readTables(tabs);
  for (const tab of tabs) put(tab, res[tab]);
}

export function rows(tab) {
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

/** Append a new record; returns its generated ID. */
export async function create(tab, record) {
  // Re-read first so the next ID accounts for rows other users added since we loaded.
  await refresh(tab);
  const { idField } = SCHEMA[tab];
  const id = nextId(tab);
  await sheets.appendRows(tab, tables[tab].headers, [{ ...coerceOut(tab, record), [idField]: id }]);
  await refresh(tab);
  return id;
}

export async function update(tab, id, record) {
  const { idField } = SCHEMA[tab];
  await sheets.updateRowById(tab, idField, id, { ...coerceOut(tab, record), [idField]: id });
  await refresh(tab);
}

export async function logPrice(ingId, packPrice, invoiceRef = '') {
  const tab = 'PRICE_HISTORY';
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
  const headers = tables[tab]?.headers?.length ? tables[tab].headers : SCHEMA[tab].headers;
  await sheets.appendRows(tab, headers, [
    coerceOut(tab, { DATE: today, ING_ID: ingId, PACK_PRICE: packPrice, INVOICE_REF: invoiceRef }),
  ]);
  await refresh(tab);
}
