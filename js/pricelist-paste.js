// Parses a supplier price list into { code, name, pack, price } rows.
// Handles tab-separated rows (copied from a spreadsheet, or rebuilt from a PDF by pdf-text.js)
// and free text from an email ("BUR125 Burrata 8x125g £18.00").
//
// Wholesale lists often show two prices, e.g. "AUBERGINE 4.5KG 17.25 £ £3.85": the case price
// and the price per kg. We keep the case price, because the pack size is the case.

import { normalisePack } from './costing.js';
import { nameTokens } from './recipe-paste.js';

const UNIT_WORDS = {
  g: 'g', gr: 'g', grams: 'g', gram: 'g', kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg',
  ml: 'ml', cl: 'cl', l: 'L', lt: 'L', ltr: 'L', litre: 'L', litres: 'L', liter: 'L', liters: 'L',
};
const UNIT_RE = 'kgs?|kilos?|grams?|gr|g|ml|cl|ltr|lt|litres?|liters?|l';
const COUNT_RE = 'x|pcs?|pieces?|each|ea|btls?|bottles?|cans?|tins?|jars?|pk|packs?|units?|bunch(?:es)?|heads?|punnets?|pnt|trays?|bags?|boxes';

const PACK_MULTI = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_RE})\\b`, 'i');
// "16X6PNT", "12 x 6 bottles": a count of multipacks.
const PACK_COUNT_MULTI = new RegExp(`\\b(\\d+)\\s*[x×]\\s*(\\d+)\\s*(?:${COUNT_RE})?\\b`, 'i');
const PACK_SINGLE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_RE})\\b`, 'i');
const PACK_COUNT = new RegExp(`\\b(\\d+)\\s*(?:${COUNT_RE})\\b`, 'i');
// £12.50, 12.50 £, 12.50£, or a bare 12.50 standing on its own.
const MONEY = /£\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*£|(?:^|\s)(\d+\.\d{2})(?=\s|$)/g;
const PACKAGING_WORDS = /\b(bag|box|case|tray|punnet|sack|tub|jar|each)\b/gi;
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9\-_/.]*$/;

// A product code: one short token that has a digit ("BUR125", "10234") or is upper-case with a
// separator ("NT-ANC"). Plain words like "IPA" don't count, so they stay in the name.
const isCode = t => CODE_RE.test(t) && t.length <= 15 && (/\d/.test(t) || (/[-_/.]/.test(t) && t === t.toUpperCase()));

/** Find a pack in `s`; returns { size, unit (g/ml/each), text } or null. */
function findPack(s) {
  let m = s.match(PACK_MULTI);
  if (m) return { ...normalisePack(m[1] * m[2], UNIT_WORDS[m[3].toLowerCase()] || m[3]), text: m[0] };
  m = s.match(PACK_SINGLE);
  if (m) return { ...normalisePack(m[1], UNIT_WORDS[m[2].toLowerCase()] || m[2]), text: m[0] };
  m = s.match(PACK_COUNT_MULTI);
  if (m) return { size: m[1] * m[2], unit: 'each', text: m[0] };
  m = s.match(PACK_COUNT);
  if (m) return { size: Number(m[1]), unit: 'each', text: m[0] };
  return null;
}

/**
 * A size column with no number: "KG" or "PER KG" means priced per kilo, "EACH", "BOX",
 * "PUNNET"… mean priced per one of those.
 */
function bareUnit(col) {
  // Invoices often print the unit twice in neighbouring columns, which can run together
  // in the PDF text: "KG KG", "BUNCHBUNCH".
  const c = col.trim().toLowerCase().replace(/^(.+?)\s*\1$/, '$1');
  if (/^(?:per\s+)?(?:kg|kgs|kilo)$/.test(c)) return { size: 1000, unit: 'g', text: col };
  if (/^(?:per\s+)?(?:l|lt|ltr|litre|liter)$/.test(c)) return { size: 1000, unit: 'ml', text: col };
  if (/^(?:per\s+)?(?:each|ea|unit|pc|piece|punnet|box|bunch|string|tray|bag|head|jar|tin|bottle|pkt|packet)s?$/.test(c)) {
    return { size: 1, unit: 'each', text: col };
  }
  return null;
}

/** Every money amount in `s`, in order: [{ value, text }]. */
function findMoney(s) {
  return [...s.matchAll(MONEY)].map(m => ({
    value: Number((m[1] ?? m[2] ?? m[3]).replace(',', '.')),
    text: m[0].trim(),
  }));
}

/**
 * With one price, that's it. With several, prefer the one whose companion looks like a
 * per-kg / per-L / per-unit price for this pack (case ÷ quantity); otherwise take the first,
 * since lists put the case price before the unit price.
 */
function choosePrice(values, pack) {
  if (!values.length) return null;
  if (values.length === 1 || !pack) return values[0];
  const qty = pack.unit === 'each' ? pack.size : pack.size / 1000;
  if (qty > 0) {
    for (const a of values) {
      if (values.some(b => b !== a && b > 0 && Math.abs(a / qty - b) / b < 0.08)) return a;
    }
  }
  return values[0];
}

const close = (a, b) => Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 0.01);

/**
 * An invoice line reads "Qty Price Total": "0.77 7.70 5.93" is 0.77 kg at £7.70, not a
 * price of £0.77. When two amounts multiply to the last one, that's quantity × unit price;
 * return the unit price. A whole-number quantity ("6") isn't money-shaped, so `counts`
 * holds the line's plain integers to try too. `qtyFirst` comes from the header row.
 */
function invoicePrice(values, counts, qtyFirst) {
  if (values.length >= 3) {
    const total = values[values.length - 1];
    for (let i = 0; i < values.length - 2; i++) {
      for (let j = i + 1; j < values.length - 1; j++) {
        if (values[i] > 0 && values[j] > 0 && close(values[i] * values[j], total)) return qtyFirst ? values[j] : values[i];
      }
    }
  }
  if (values.length === 2 && values[0] > 0 && counts.some(n => n > 1 && close(n * values[0], values[1]))) return values[0];
  return null;
}

function cleanName(s, hadPack) {
  let n = s;
  if (hadPack) n = n.replace(PACKAGING_WORDS, ' ');
  return n.replace(/£/g, ' ').replace(/\s+[-|–—,]\s+/g, ' ').replace(/^[\s\-|–—,:]+|[\s\-|–—,:]+$/g, '')
    .replace(/\s+/g, ' ').trim();
}

/** A size column with nothing else in it ("1KG BAG", "8 x 125g"), as opposed to a name with a size ("BUTTER - 250G"). */
function purePack(col) {
  const p = findPack(col);
  return p && !/[a-z]{3,}/i.test(cleanName(col.replace(p.text, ' '), true)) ? p : null;
}

function parseLine(raw, qtyFirst = true) {
  if (raw.includes('\t')) {
    const cols = raw.split('\t').map(c => c.trim()).filter(c => c && c !== '£');
    // Any column with money in it is price information ("£42.60/ 12 units box"), never the name.
    const values = [];
    const priceCols = new Set();
    cols.forEach((c, i) => {
      const money = findMoney(c);
      if (!money.length) return;
      values.push(...money.map(m => m.value));
      priceCols.add(i);
    });
    const free = cols.map((c, i) => i).filter(i => !priceCols.has(i));
    const packCol = free.find(i => purePack(cols[i]));
    let pack = packCol != null ? purePack(cols[packCol]) : null;
    if (!pack) {
      // The size can share a column with the price: "1KG BAG 29.93£".
      for (const i of priceCols) {
        let rest = cols[i];
        for (const m of findMoney(rest)) rest = rest.replace(m.text, ' ');
        if ((pack = findPack(rest))) break;
      }
    }
    const codeCol = free.find(i => i !== packCol && isCode(cols[i]));
    const unitCol = free.find(i => bareUnit(cols[i]));
    // A unit cut short by the column next to it ("BOTT" beside "BOTTLE") is no name either.
    const clipped = i => cols[i + 1] && bareUnit(cols[i + 1]) && cols[i + 1].toUpperCase().startsWith(cols[i].toUpperCase());
    // The name is the longest remaining column with words in it; a size inside it ("Burrata 125g") still counts.
    let name = free.filter(i => i !== packCol && i !== codeCol && !bareUnit(cols[i]) && !clipped(i) && /[a-z]{2}/i.test(cols[i]))
      .map(i => cols[i]).reduce((best, c) => (c.length > best.length ? c : best), '');
    if (!pack && (pack = findPack(name))) name = name.replace(pack.text, ' ');
    // Only a bare "KG" / "EACH" column to go on: priced per kilo / per one.
    if (!pack && unitCol != null) pack = bareUnit(cols[unitCol]);
    const counts = free.filter(i => i !== codeCol && /^\d+$/.test(cols[i])).map(i => Number(cols[i]));
    return {
      code: codeCol != null ? cols[codeCol] : '', name: cleanName(name, !!pack), pack,
      price: invoicePrice(values, counts, qtyFirst) ?? choosePrice(values, pack),
    };
  }

  let rest = raw;
  const money = findMoney(rest);
  for (const m of money) rest = rest.replace(m.text, ' ');
  const pack = findPack(rest);
  if (pack) rest = rest.replace(pack.text, ' ');
  let code = '';
  const words = rest.trim().split(/\s+/);
  if (words.length > 1 && isCode(words[0])) {
    code = words[0];
    rest = rest.trim().slice(code.length);
  }
  const values = money.map(m => m.value);
  return { code, name: cleanName(rest, !!pack), pack, price: invoicePrice(values, [], qtyFirst) ?? choosePrice(values, pack) };
}

// Invoice footers ("GOODS TOTAL 80.42", "VAT TOTAL 0.00") aren't products.
const TOTAL_LINE = /^(?:(?:sub|goods|net|vat|grand|invoice)\s*-?\s*)?total\b|^(?:vat|balance|amount due|total due)\b/i;

const HEADER_WORDS = /^(case|price|size|kg\/unit|price in|case size|unit|code|description|product)\b/i;

/**
 * One row per line that has a name; lines with no digits at all are dropped. Headings
 * ("CHEESE", "FISH", "VEGETABLES  CASE SIZE  PRICE") are remembered as each row's `section`.
 */
export function parsePriceList(textOrLines) {
  const lines = Array.isArray(textOrLines) ? textOrLines : textOrLines.split(/\r?\n/);
  let section = '';
  let qtyFirst = true;
  const out = [];
  for (const line of lines.map(l => l.replace(/\u00a0/g, ' ').trim())) {
    if (!line) continue;
    // An invoice header ("Code Description Qty Price Total") says which comes first.
    const q = line.search(/\b(?:qty|quantity)\b/i), pr = line.search(/\bprice\b/i);
    if (q >= 0 && pr >= 0) qtyFirst = q < pr;
    if (!/\d/.test(line)) {
      const first = line.split('\t')[0].trim();
      if (first && !HEADER_WORDS.test(first) && first.split(/\s+/).length <= 5 && first === first.toUpperCase()) section = first;
      continue;
    }
    const row = { raw: line, section, ...parseLine(line, qtyFirst) };
    if (row.name && /[a-z]/i.test(row.name) && !TOTAL_LINE.test(row.name)) out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------- matching products to ingredients

const STOP = new Set(['di', 'de', 'del', 'della', 'dell', 'la', 'il', 'with', 'in', 'of', 'the', 'and', 'per', 'for', 'from',
  'month', 'year', 'kg', 'g', 'gr', 'ml', 'l', 'igp', 'dop', 'doc', 'bio', 'organic', 'x', 'pack', 'box', 'bag']);
// Numbers stay ("00 flour" is not "chestnut flour"); ages and units are dropped via STOP.
const significant = s => nameTokens(String(s).replace(/\(.*?\)/g, ' ')).filter(t => !STOP.has(t));

// Sections that clearly belong to one of our categories; others (specialities, misc…) don't constrain.
const SECTION_CATEGORY = [
  [/chees/i, 'Cheese'], [/fish|seafood/i, 'Fish'], [/fruit|citrus/i, 'Fruit'], [/vegetable|\bveg\b|mushroom/i, 'Veg'],
  [/herb/i, 'Herbs & spices'], [/charcut|salumi|cured meat/i, 'Charcuterie'],
];
const sectionCategory = section => SECTION_CATEGORY.find(([re]) => re.test(section))?.[1] ?? null;

/**
 * Stricter than recipe matching, because a wholesale list has hundreds of near-misses:
 *  - the product must contain the ingredient's main word (its last word: "Black peppercorns" →
 *    peppercorn), and all its words unless the product is a single word ("PARSLEY" → Flat-leaf parsley);
 *  - a product under a food heading (CHEESE, FISH…) only matches ingredients in that category.
 * Returns { ing, score } or null.
 */
export function matchProduct(name, section, ingredients) {
  const pt = significant(name);
  if (!pt.length) return null;
  const want = sectionCategory(section);
  let best = null;
  for (const ing of ingredients) {
    if (want && ing.CATEGORY && ing.CATEGORY !== want) continue;
    const it = significant(ing.NAME);
    if (!it.length || !pt.includes(it[it.length - 1])) continue;
    const overlap = it.filter(t => pt.includes(t)).length;
    const coverage = overlap / it.length;
    if (coverage < 1 && pt.length > 1) continue;
    const score = coverage + overlap / pt.length;
    if (score > (best?.score ?? 0)) best = { ing, score };
  }
  return best;
}
