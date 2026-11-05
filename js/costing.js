// Cost calculations. The sheet stores raw inputs only; everything here is derived.
//
// Prices come from supplier price lists (SUPPLIER_PRICES). An ingredient's cost uses its
// preferred supplier's price if it has one, otherwise the cheapest price on any list.

import * as store from './store.js';
import { money } from './ui.js';
import { familyOf, toBase, normUnit } from './units.js';
import { WINE_KIND } from './config.js';

/** Wines are ingredients marked KIND = wine; they have their own page. */
export const isWine = ing => String(ing?.KIND ?? '').trim().toLowerCase() === WINE_KIND;

/** An item's name as shown in lists: wines carry their vintage ("Barolo 2019"). */
export const displayName = ing => (isWine(ing) && String(ing.VINTAGE).trim() ? `${ing.NAME} ${String(ing.VINTAGE).trim()}` : String(ing?.NAME ?? ''));

// Friendly units accepted in forms, converted to the stored base units (g / ml / each).
const CONVERT = { g: ['g', 1], kg: ['g', 1000], ml: ['ml', 1], cl: ['ml', 10], l: ['ml', 1000], each: ['each', 1] };

export const PACK_UNIT_OPTIONS = [['g', 'g'], ['kg', 'kg → g'], ['ml', 'ml'], ['cl', 'cl → ml'], ['L', 'L → ml'], ['each', 'each']];

export const MEASURE_OPTIONS = [['g', 'Weight (g, kg)'], ['ml', 'Volume (ml, cl, L)'], ['each', 'Each (pieces, bottles)']];

export function normalisePack(size, unit) {
  const [base, factor] = CONVERT[String(unit).toLowerCase()] || [unit, 1];
  const n = Number(size);
  return { size: size === '' || isNaN(n) ? '' : Math.round(n * factor * 1e6) / 1e6, unit: base };
}

const UNIT_FAMILY = { g: 'weight', ml: 'volume', each: 'each' };

/** How an ingredient is measured: 'g', 'ml' or 'each' (falls back to the pre-price-list PACK_UNIT). */
export function ingredientUnit(ing) {
  const u = normUnit(ing?.UNIT || ing?.PACK_UNIT);
  return UNIT_FAMILY[u] ? u : '';
}

export const ingredientFamily = ing => UNIT_FAMILY[ingredientUnit(ing)] ?? null;

/** Cost per g / ml / each of one price-list row as bought, or null if incomplete. */
export function priceUnitCost(p) {
  const fam = familyOf(p?.PACK_UNIT);
  const base = fam ? toBase(fam, p.PACK_SIZE, p.PACK_UNIT) : null;
  const price = Number(p?.PACK_PRICE);
  if (p?.PACK_PRICE === '' || p?.PACK_PRICE == null || !(base > 0) || !(price >= 0)) return null;
  return price / base;
}

let index = null;
let indexVersion = -1;

/** All price-list rows for an ingredient. */
export function pricesFor(ingId) {
  if (indexVersion !== store.dataVersion()) {
    index = new Map();
    for (const p of store.rows('SUPPLIER_PRICES')) {
      const k = String(p.ING_ID);
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(p);
    }
    indexVersion = store.dataVersion();
  }
  return index.get(String(ingId)) || [];
}

/** Rows that can actually cost the ingredient: complete, and in the same measure as the ingredient. */
export function usablePrices(ing) {
  const fam = ingredientFamily(ing);
  return pricesFor(ing?.ING_ID).filter(p => priceUnitCost(p) != null && (!fam || familyOf(p.PACK_UNIT) === fam));
}

const cheapestOf = rows => rows.reduce((a, b) => (priceUnitCost(b) < priceUnitCost(a) ? b : a));

/**
 * The price recipes use: { price, why: 'preferred' | 'cheapest', cheapest } or null.
 * With several packs from the preferred supplier, the cheapest of those wins.
 */
export function chosenPrice(ing) {
  const rows = usablePrices(ing);
  if (!rows.length) return null;
  const cheapest = cheapestOf(rows);
  const pref = ing.SUPPLIER_ID ? rows.filter(p => String(p.SUPPLIER_ID) === String(ing.SUPPLIER_ID)) : [];
  return pref.length ? { price: cheapestOf(pref), why: 'preferred', cheapest } : { price: cheapest, why: 'cheapest', cheapest };
}

/** Cost per g / ml / each as purchased, from the chosen price. */
export function unitCost(ing) {
  const c = chosenPrice(ing);
  return c ? priceUnitCost(c.price) : null;
}

export function yieldFraction(ing) {
  const y = ing?.['YIELD_%'] === '' || ing?.['YIELD_%'] == null ? 100 : Number(ing['YIELD_%']);
  return y > 0 ? y / 100 : null;
}

/** Cost per usable g / ml / each after trim and waste (yield). */
export function usableUnitCost(ing) {
  const c = unitCost(ing);
  const y = yieldFraction(ing);
  return c == null || y == null ? null : c / y;
}

const DISPLAY = { g: [1000, '/kg'], ml: [1000, '/L'], each: [1, ' each'] };

export function formatUnitCost(cost, unit) {
  if (cost == null) return '—';
  const [factor, suffix] = DISPLAY[unit] || [1, `/${unit}`];
  return money(cost * factor) + suffix;
}

/** "750 ml", "5 kg" style pack label from a stored size in g / ml / each. */
export function packLabel(size, unit) {
  const n = Number(size);
  if (size === '' || !isFinite(n)) return '';
  if (unit === 'g' && n >= 1000) return `${+(n / 1000).toFixed(3)} kg`;
  if (unit === 'ml' && n >= 1000) return `${+(n / 1000).toFixed(3)} L`;
  return `${+n.toFixed(3)} ${unit}`;
}

// ---------- packs as recipe units ("1 bag spinach", "1 bottle prosecco")
//
// A recipe line can count in whole packs from a price list instead of g / ml / each. The line
// keeps the pack's name in UNIT (readable in the sheet) and its price row in PRICE_ID. It costs
// at that pack's own price, as bought: a whole bag is used, so yield doesn't apply.

const PACK_PREFIX = 'pack:';

/** Common pack names, offered when naming a pack and recognised in pasted recipes. */
export const PACK_WORDS = ['bag', 'bottle', 'box', 'bunch', 'case', 'jar', 'keg', 'packet', 'punnet', 'tin', 'tray', 'tub'];

/** What a pack is called: its PACK_NAME, else "bottle" for a wine, else "pack". */
export function packName(p, ing) {
  const n = String(p?.PACK_NAME ?? '').trim().toLowerCase();
  if (n) return n;
  return isWine(ing) && p?.PACK_UNIT === 'ml' ? 'bottle' : 'pack';
}

/** "bag" → "bags", "box" → "boxes" for more than one; ½ or 1 stays singular. */
export function plural(word, n) {
  if (!(Number(n) > 1) || !/[a-z]$/i.test(word) || /s$/i.test(word)) return word;
  return /(x|ch|sh)$/i.test(word) ? `${word}es` : `${word}s`;
}

const sameWord = (a, b) => {
  const f = w => String(w ?? '').trim().toLowerCase().replace(/(es|s)$/, '');
  return f(a) !== '' && f(a) === f(b);
};

/** Price rows an ingredient can be counted in: a size in the same measure as the ingredient. */
export function packsFor(ing) {
  const fam = ingredientFamily(ing);
  return pricesFor(ing?.ING_ID)
    .filter(p => Number(p.PACK_SIZE) > 0 && familyOf(p.PACK_UNIT) && (!fam || familyOf(p.PACK_UNIT) === fam))
    .sort((a, b) => Number(a.PACK_SIZE) - Number(b.PACK_SIZE));
}

/** The pack whose name is `word` ("bag", "bags"), preferring the price recipes already use. */
export function packNamed(ing, word) {
  const hits = packsFor(ing).filter(p => sameWord(packName(p, ing), word));
  if (!hits.length) return null;
  const chosen = chosenPrice(ing)?.price;
  return hits.find(p => p === chosen) || hits[0];
}

/**
 * The pack a recipe line counts in, or null if it's in g / ml / each.
 * Returns { pack } when found, or { pack: null } when the line names a pack that's gone.
 */
export function linePack(line, ing) {
  const id = String(line?.PRICE_ID ?? '').trim();
  const unit = normUnit(line?.UNIT);
  if (!id && (familyOf(unit) || unit === 'tsp' || unit === 'tbsp' || unit === 'portion' || !unit)) return null;
  const packs = packsFor(ing);
  const byId = id ? packs.find(p => String(p.PRICE_ID) === id) : null;
  // A line typed into the sheet as "1 | bag" (no PRICE_ID) finds its pack by name.
  return { pack: byId || (unit && !familyOf(unit) ? packNamed(ing, unit) : null) };
}

/** Value used by unit dropdowns for a pack, and back again. */
export const packValue = p => PACK_PREFIX + p.PRICE_ID;
export const isPackValue = v => String(v ?? '').startsWith(PACK_PREFIX);

/** Turn a unit dropdown value into the UNIT and PRICE_ID to store on a recipe line. */
export function lineUnitFields(value, ing) {
  if (!isPackValue(value)) return { UNIT: value, PRICE_ID: '' };
  const id = String(value).slice(PACK_PREFIX.length);
  const p = packsFor(ing).find(x => String(x.PRICE_ID) === id);
  return { UNIT: p ? packName(p, ing) : 'pack', PRICE_ID: id };
}

/** "bag (250 g, £1.40)" for a dropdown option. */
export function packOptionLabel(p, ing) {
  const price = p.PACK_PRICE === '' || p.PACK_PRICE == null ? 'no price' : money(p.PACK_PRICE);
  return `${packName(p, ing)} (${packLabel(p.PACK_SIZE, p.PACK_UNIT)}, ${price})`;
}
