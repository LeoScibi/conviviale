// Names typed into link columns. Records link by ID, but nobody adding rows in the sheet should
// have to look IDs up: a name typed into SUPPLIER_ID, ING_ID, RECIPE_ID… is swapped on load for
// the ID of the record with that name. Matching ignores case, accents and punctuation. A name
// that matches nothing, or several records equally, is left as typed and reported.

import { SCHEMA } from './config.js';
import * as store from './store.js';
import { isWine, displayName } from './costing.js';
import { normName } from './recipe-paste.js';

// Per tab, the link columns and the tab each one points to. INGREDIENTS covers wines too, since
// store.rows('INGREDIENTS') includes them. WINES as a target means wines only.
const LINKS = {
  INGREDIENTS: [['SUPPLIER_ID', 'SUPPLIERS']],
  SUPPLIER_PRICES: [['SUPPLIER_ID', 'SUPPLIERS'], ['ING_ID', 'INGREDIENTS']],
  RECIPE_LINES: [['RECIPE_ID', 'RECIPES'], ['ITEM_ID', null]],
  MENU_LINES: [['MENU_ID', 'MENUS'], ['RECIPE_ID', 'RECIPES']],
  WINE_MENU_LINES: [['MENU_ID', 'WINE_MENUS'], ['ING_ID', 'WINES']],
};

const LOOKS_LIKE_ID = /^[A-Z]+-\d+$/;

/** The names a record can be typed as. A wine also answers to its vintage and producer. */
function namesOf(rec) {
  if (!isWine(rec)) return [rec.NAME];
  const v = String(rec.VINTAGE ?? '').trim();
  const p = String(rec.PRODUCER ?? '').trim();
  return [rec.NAME, displayName(rec), p && `${p} ${rec.NAME}`, p && v && `${p} ${rec.NAME} ${v}`];
}

function buildIndex(target) {
  const recs = target === 'WINES' ? store.rows('INGREDIENTS').filter(isWine) : store.rows(target);
  const ids = new Set(recs.map(r => String(r[SCHEMA[target].idField])));
  const byName = new Map();
  for (const r of recs) {
    for (const n of new Set(namesOf(r).filter(Boolean).map(normName))) {
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(r);
    }
  }
  return { ids, byName };
}

/** The one record a name means: the only match, or else the only active match. */
function pick(hits = []) {
  if (hits.length === 1) return hits[0];
  const active = hits.filter(r => r.ACTIVE !== false);
  return active.length === 1 ? active[0] : null;
}

/**
 * Swap names in link columns for IDs. Returns { fixed, unmatched: [{ tab, column, value, why }] }.
 * Run after store.fillMissingIds(), so rows (and records typed in the same go) have IDs.
 */
export async function linkNames() {
  const indexes = {};
  const index = target => (indexes[target] ??= buildIndex(target));
  const unmatched = [];
  let fixed = 0;

  for (const [tab, links] of Object.entries(LINKS)) {
    const { idField } = SCHEMA[tab];
    const changes = [];
    for (const row of store.rows(tab)) {
      if (!String(row[idField] ?? '').trim()) continue;
      const record = {};
      for (const [column, fixedTarget] of links) {
        const value = String(row[column] ?? '').trim();
        if (!value || LOOKS_LIKE_ID.test(value)) continue;
        // A recipe line's item is an ingredient or a sub-recipe, as ITEM_TYPE says; if it's
        // blank, whichever the name matches, and ITEM_TYPE is filled in to suit.
        const type = String(row.ITEM_TYPE ?? '').trim().toUpperCase();
        const targets = fixedTarget ? [fixedTarget] : type === 'SUB' ? ['RECIPES'] : type === 'ING' ? ['INGREDIENTS'] : ['INGREDIENTS', 'RECIPES'];
        if (targets.some(t => index(t).ids.has(value))) continue;
        const found = targets.map(t => ({ t, hits: index(t).byName.get(normName(value)) ?? [] }));
        const matched = found.map(f => ({ ...f, rec: pick(f.hits) })).filter(f => f.rec);
        if (matched.length === 1) {
          record[column] = matched[0].rec[SCHEMA[matched[0].t].idField];
          if (!fixedTarget && !type) record.ITEM_TYPE = matched[0].t === 'RECIPES' ? 'SUB' : 'ING';
        } else {
          unmatched.push({ tab, column, value, why: found.some(f => f.hits.length) ? 'more than one match' : 'no match' });
        }
      }
      if (Object.keys(record).length) changes.push({ id: row[idField], record });
    }
    if (changes.length) {
      await store.updateMany(tab, changes);
      fixed += changes.reduce((n, c) => n + Object.keys(c.record).filter(k => k !== 'ITEM_TYPE').length, 0);
    }
  }
  return { fixed, unmatched };
}
