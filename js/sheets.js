// Thin wrapper over the Google Sheets API v4, called directly from the browser.
// Tables are read by header name, so column order in the sheet doesn't matter
// and extra columns added by hand are preserved on update.
// A tab can also be formatted as a Google Sheets table (Format > Convert to table): new rows go
// into the table, and the app only ever writes the cells of its own columns, so columns added by
// hand (including formulas) are left alone. Formula columns are copied down into new rows.

import { CONFIG } from './config.js';
import { getToken, markExpired, AuthError } from './auth.js';

const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}`;

export class SheetsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function request(path, { method = 'GET', query, body } = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query || {})) {
    for (const item of [].concat(v)) url.searchParams.append(k, item);
  }
  for (let attempt = 0; ; attempt++) {
    const t = getToken();
    if (!t) throw new AuthError('Your Google session has expired.');
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.json();
    if (res.status === 401) {
      markExpired();
      throw new AuthError('Your Google session has expired.');
    }
    // Back off on quota (60 req/min/user) and transient server errors.
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    let msg = res.statusText;
    try { msg = (await res.json()).error.message; } catch { /* keep statusText */ }
    if (res.status === 403) msg = `No permission for the Conviviale Ops spreadsheet. Ask for edit access. (${msg})`;
    if (res.status === 404) msg = 'Spreadsheet not found. Check SPREADSHEET_ID in js/config.js.';
    throw new SheetsError(res.status, msg);
  }
}

/** Quote a tab name for A1 notation. */
const q = tab => `'${tab.replace(/'/g, "''")}'`;

export function colLetter(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/**
 * { TAB: { sheetId, table } } where `table` is the tab's first Google Sheets table, if any.
 * Read fresh each time: tables can be added or resized in the sheet while the app is open.
 */
async function tabsInfo() {
  const meta = await request('', { query: { fields: 'sheets(properties(sheetId,title),tables(tableId,range))' } });
  return Object.fromEntries(meta.sheets.map(s => [s.properties.title, { sheetId: s.properties.sheetId, table: s.tables?.[0] ?? null }]));
}

async function infoOf(tab) {
  const info = (await tabsInfo())[tab];
  if (!info) throw new SheetsError(404, `The ${tab} tab is missing from the spreadsheet.`);
  return info;
}

/**
 * Create any missing tabs (as tables), and append any missing header columns to existing tabs,
 * widening a tab's table to take them. Never removes or reorders anything already in the sheet.
 */
export async function ensureSchema(schema) {
  const tabs = Object.keys(schema);
  const existing = new Set(Object.keys(await tabsInfo()));
  const missing = tabs.filter(t => !existing.has(t));

  if (missing.length) {
    await request(':batchUpdate', {
      method: 'POST',
      body: {
        requests: missing.map(title => ({
          addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } },
        })),
      },
    });
  }

  const got = await request('/values:batchGet', { query: { ranges: tabs.map(t => `${q(t)}!1:1`) } });
  const data = [];
  const widths = {};
  const addedColumns = {};
  got.valueRanges.forEach((vr, i) => {
    const tab = tabs[i];
    const current = (vr.values?.[0] || []).map(h => String(h).trim());
    const add = schema[tab].headers.filter(h => !current.includes(h));
    widths[tab] = current.length + add.length;
    if (!add.length) return;
    data.push({ range: `${q(tab)}!${colLetter(current.length + 1)}1`, values: [add] });
    if (existing.has(tab)) addedColumns[tab] = add;
  });
  if (data.length) {
    await request('/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'RAW', data } });
  }

  // New tabs become tables (header plus one empty row); tables on existing tabs widen to cover
  // any header columns just added after them.
  const info = await tabsInfo();
  const requests = [];
  for (const tab of missing) {
    requests.push({
      addTable: {
        table: {
          name: tab,
          range: { sheetId: info[tab].sheetId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: widths[tab] },
        },
      },
    });
  }
  for (const tab of Object.keys(addedColumns)) {
    const t = info[tab].table;
    if (!t || t.range.startRowIndex !== 0 || (t.range.startColumnIndex ?? 0) !== 0 || t.range.endColumnIndex >= widths[tab]) continue;
    requests.push({
      updateTable: { table: { tableId: t.tableId, range: { ...t.range, endColumnIndex: widths[tab] } }, fields: 'range' },
    });
  }
  if (requests.length) {
    await request(':batchUpdate', { method: 'POST', body: { requests } });
  }
  return { createdTabs: missing, addedColumns };
}

function parseTable(values = []) {
  const headers = (values[0] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const raw = values[i] || [];
    if (!raw.some(v => v !== '' && v != null)) continue;
    const obj = { _row: i + 1 };
    headers.forEach((h, j) => { if (h) obj[h] = raw[j] ?? ''; });
    rows.push(obj);
  }
  return { headers, rows };
}

/** Read several whole tabs in one request. Returns { TAB: { headers, rows } }. */
export async function readTables(tabs) {
  const res = await request('/values:batchGet', {
    query: {
      ranges: tabs.map(q),
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    },
  });
  const out = {};
  res.valueRanges.forEach((vr, i) => { out[tabs[i]] = parseTable(vr.values); });
  return out;
}

export async function readTable(tab) {
  return (await readTables([tab]))[tab];
}

/** A value as a cell, stored as typed (like RAW: text starting with = stays text). */
function cellOf(v) {
  if (v === '' || v == null) return {};
  if (typeof v === 'boolean') return { userEnteredValue: { boolValue: v } };
  if (typeof v === 'number') return { userEnteredValue: { numberValue: v } };
  return { userEnteredValue: { stringValue: String(v) } };
}

/** 0-based indexes of the columns in `headers` that some record has a value for. */
const ownedColumns = (headers, records) =>
  headers.map((h, i) => (h && records.some(r => h in r) ? i : -1)).filter(i => i >= 0);

/**
 * Append records as new rows, inside the tab's table if it has one. Columns the records don't
 * have are left blank, except formula columns, which are copied down from the first data row.
 * With `idField`, the new rows are found again by ID to receive those formulas.
 */
export async function appendRows(tab, headers, records, idField) {
  if (!records.length) return null;
  const { sheetId, table } = await infoOf(tab);
  const rows = records.map(r => ({ values: headers.map(h => (h && h in r ? cellOf(r[h]) : {})) }));
  // A table's rows need its tab's sheetId too, or the API looks for sheet 0.
  const where = table ? { sheetId, tableId: table.tableId } : { sheetId };
  const res = await request(':batchUpdate', {
    method: 'POST',
    body: { requests: [{ appendCells: { ...where, rows, fields: 'userEnteredValue' } }] },
  });
  if (idField) await copyFormulasDown(tab, sheetId, headers, records, idField);
  return res;
}

async function copyFormulasDown(tab, sheetId, headers, records, idField) {
  const owned = new Set(ownedColumns(headers, records));
  if (owned.size === headers.length) return;
  const got = await request(`/values/${encodeURIComponent(`${q(tab)}!2:2`)}`, { query: { valueRenderOption: 'FORMULA' } });
  const first = got.values?.[0] || [];
  const cols = headers.map((_, i) => i).filter(i => !owned.has(i) && String(first[i] ?? '').startsWith('='));
  if (!cols.length) return;
  const ids = new Set(records.map(r => String(r[idField])));
  const targets = (await readTable(tab)).rows.filter(r => ids.has(String(r[idField])) && r._row !== 2);
  const requests = targets.flatMap(r => cols.map(c => ({
    copyPaste: {
      source: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: c, endColumnIndex: c + 1 },
      destination: { sheetId, startRowIndex: r._row - 1, endRowIndex: r._row, startColumnIndex: c, endColumnIndex: c + 1 },
      pasteType: 'PASTE_FORMULA',
    },
  })));
  if (requests.length) await request(':batchUpdate', { method: 'POST', body: { requests } });
}

/**
 * Update rows by ID: `patches` is [{ id, patch }]. Re-reads the tab first so rows are located
 * by ID even if they were inserted or sorted in the sheet since we loaded it. Only the cells of
 * the patched columns are written, so other columns (and their formulas) are untouched.
 * One write request.
 */
export async function updateRowsById(tab, idField, patches) {
  const { headers, rows } = await readTable(tab);
  const data = patches.flatMap(({ id, patch }) => {
    const row = rows.find(r => String(r[idField]) === String(id));
    if (!row) throw new SheetsError(404, `${id} was not found in ${tab}. It may have been deleted in the sheet.`);
    // Runs of adjacent columns go in one range.
    const runs = [];
    for (const i of ownedColumns(headers, [patch])) {
      const last = runs[runs.length - 1];
      if (last && last.end === i) { last.end = i + 1; last.values.push(patch[headers[i]]); } else runs.push({ start: i, end: i + 1, values: [patch[headers[i]]] });
    }
    return runs.map(({ start, end, values }) => ({
      range: `${q(tab)}!${colLetter(start + 1)}${row._row}:${colLetter(end)}${row._row}`,
      values: [values.map(v => v ?? '')],
    }));
  });
  if (!data.length) return null;
  return request('/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'RAW', data } });
}

export async function updateRowById(tab, idField, id, patch) {
  return updateRowsById(tab, idField, [{ id, patch }]);
}

/**
 * Delete rows by ID across one or more tabs in a single, all-or-nothing request.
 * `specs` is [{ tab, idField, ids }].
 */
export async function deleteRowsById(specs) {
  const tables = await readTables(specs.map(s => s.tab));
  const requests = [];
  for (const { tab, idField, ids } of specs) {
    const want = new Set(ids.map(String));
    const { sheetId } = await infoOf(tab);
    // Bottom-up, so earlier deletions don't shift the rows still to delete.
    tables[tab].rows
      .filter(r => want.has(String(r[idField])))
      .map(r => r._row - 1)
      .sort((a, b) => b - a)
      .forEach(i => requests.push({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i + 1 } } }));
  }
  if (!requests.length) return null;
  return request(':batchUpdate', { method: 'POST', body: { requests } });
}
