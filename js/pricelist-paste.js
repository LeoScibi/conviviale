// Parses a pasted supplier price list into { code, name, size, unit, price } rows.
// Handles tab-separated rows copied from a spreadsheet ("BUR125⇥Burrata 125g⇥8 x 125g⇥£18.00")
// and free text from an email or PDF ("BUR125 Burrata 8x125g £18.00").

import { normalisePack } from './costing.js';

const UNIT_WORDS = {
  g: 'g', gr: 'g', grams: 'g', gram: 'g', kg: 'kg', kilo: 'kg', kilos: 'kg',
  ml: 'ml', cl: 'cl', l: 'L', lt: 'L', ltr: 'L', litre: 'L', litres: 'L', liter: 'L', liters: 'L',
};
const UNIT_RE = 'kg|kilos?|grams?|gr|g|ml|cl|ltr|lt|litres?|liters?|l';
const COUNT_RE = 'x|pcs?|pieces?|each|ea|btls?|bottles?|cans?|tins?|pk|pack|units?';

const PACK_MULTI = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_RE})\\b`, 'i');
const PACK_SINGLE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_RE})\\b`, 'i');
const PACK_COUNT = new RegExp(`(\\d+)\\s*(?:${COUNT_RE})\\b`, 'i');
const PRICE_MARKED = /£\s*(\d+(?:[.,]\d{1,2})?)/g;
const PRICE_DECIMAL = /(?:^|\s)(\d+\.\d{2})(?=\s|$)/g;
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
  m = s.match(PACK_COUNT);
  if (m) return { size: Number(m[1]), unit: 'each', text: m[0] };
  return null;
}

/** The price is the last £ amount, or failing that the last plain number with two decimals. */
function findPrice(s) {
  const marked = [...s.matchAll(PRICE_MARKED)];
  const m = marked.length ? marked.at(-1) : [...s.matchAll(PRICE_DECIMAL)].at(-1);
  if (!m) return null;
  return { price: Number(m[1].replace(',', '.')), text: m[0].trim() };
}

function cleanName(s) {
  return s.replace(/\s+[-|–—,]\s+/g, ' ').replace(/^[\s\-|–—,:]+|[\s\-|–—,:]+$/g, '').replace(/\s+/g, ' ').trim();
}

function parseLine(raw) {
  let rest = raw.trim();
  let code = '';
  let pack = null;
  let price = null;

  if (rest.includes('\t')) {
    const cols = rest.split('\t').map(c => c.trim()).filter(Boolean);
    const priceCol = cols.findLastIndex(c => /^£?\s*\d+(?:[.,]\d{1,2})?$/.test(c));
    if (priceCol >= 0) price = { price: Number(cols[priceCol].replace(/[£\s]/g, '').replace(',', '.')) };
    const packCol = cols.findIndex((c, i) => i !== priceCol && findPack(c));
    if (packCol >= 0) pack = findPack(cols[packCol]);
    const codeCol = cols.findIndex((c, i) => i !== priceCol && i !== packCol && isCode(c));
    if (codeCol >= 0) code = cols[codeCol];
    const textCols = cols.filter((c, i) => ![priceCol, packCol, codeCol].includes(i));
    // The name is the longest remaining column; a pack inside it ("Burrata 125g") still counts.
    const name = textCols.sort((a, b) => b.length - a.length)[0] ?? '';
    if (!pack) pack = findPack(name);
    return { code, name: cleanName(pack ? name.replace(pack.text, ' ') : name), pack, price: price?.price ?? null };
  }

  price = findPrice(rest);
  if (price) rest = rest.replace(price.text, ' ');
  pack = findPack(rest);
  if (pack) rest = rest.replace(pack.text, ' ');
  const words = rest.trim().split(/\s+/);
  const first = words[0] ?? '';
  if (words.length > 1 && isCode(first)) {
    code = first;
    rest = rest.trim().slice(first.length);
  }
  return { code, name: cleanName(rest), pack, price: price?.price ?? null };
}

/** One row per line that has a name; lines with no digits at all (headers, notes) are dropped. */
export function parsePriceList(text) {
  return text.split(/\r?\n/)
    .map(l => l.replace(/ /g, ' '))
    .filter(l => l.trim() && /\d/.test(l))
    .map(raw => ({ raw: raw.trim(), ...parseLine(raw) }))
    .filter(r => r.name);
}
