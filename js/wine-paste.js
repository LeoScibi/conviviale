// Wine-list parser for the "Add many" screen on the Wines page. Reads rows pasted from a
// spreadsheet or typed out, e.g. "Marcel Lapierre - Morgon 2024<tab>Red<tab>£20.95":
// producer before the dash, then the wine, with an optional vintage, bottle size, style and price.

import { WINE_STYLES } from './config.js';
import { normalisePack } from './costing.js';
import { normName } from './recipe-paste.js';

const STYLE_WORDS = [
  [/^(red|rosso|rouge|tinto)$/, 'Red'], [/^(white|bianco|blanc|blanco)$/, 'White'], [/^(rose|rosato|rosado)$/, 'Rosé'],
  [/^(orange|skin contact)$/, 'Orange'], [/^(sparkling|fizz|champagne|spumante)$/, 'Sparkling'],
  [/^(sweet|dessert)$/, 'Sweet'], [/^(fortified)$/, 'Fortified'],
];

/** "Rose", "ROSÉ", "rosso" → the style as the app spells it, or '' if it isn't one. */
export function canonStyle(s) {
  const n = normName(s);
  return WINE_STYLES.find(x => normName(x) === n) ?? STYLE_WORDS.find(([re]) => re.test(n))?.[1] ?? '';
}

// With no style column, a colour word in the name is a fair first guess ("BIB Bianco").
const guessStyle = name => normName(name).split(' ').map(canonStyle).find(Boolean) ?? '';

const PRICE = /^£?\s*(\d+(?:[.,]\d{1,2})?)$/;
const SIZE = /(?:^|\s)(\d+(?:\.\d+)?)\s*(ml|cl|l|lt|ltr|litres?)$/i;
const YEAR = /\b(?:19|20)\d{2}\b/g;

const tidy = s => s.replace(/\s+/g, ' ').replace(/^[\s,;:-]+|[\s,;:-]+$/g, '');

/** Wines are one wine if name, vintage and producer all agree. */
export const wineKey = w => [w.NAME, w.VINTAGE, w.PRODUCER].map(normName).join('|');

/**
 * Returns one entry per line: { raw, producer, name, vintage, style, size (ml), price | null }.
 * Lines with no wine name are dropped.
 */
export function parseWineList(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let cells = raw.split(/\t| {3,}/).map(c => c.trim()).filter(Boolean);
    if (cells.length === 1) {
      // Typed rather than pasted from a sheet: peel a price, then a style, off the end.
      const m = /^(.*?)\s+(£\s*\d+(?:[.,]\d{1,2})?)$/.exec(cells[0]);
      if (m) cells = [m[1], m[2]];
      const words = cells[0].split(/\s+/);
      if (words.length > 1 && /\s[-–—]\s/.test(cells[0]) && canonStyle(words[words.length - 1])) {
        cells.splice(0, 1, words.slice(0, -1).join(' '), words[words.length - 1]);
      }
    }
    let [desc, ...rest] = cells;
    let price = null;
    let style = '';
    for (const c of rest) {
      const p = PRICE.exec(c);
      if (p && price == null) price = Number(p[1].replace(',', '.'));
      else if (!style) style = canonStyle(c);
    }
    if (/^(wine|name|producer)$/i.test(desc) && price == null) continue; // a header row

    const parts = desc.split(/\s+[-–—]\s+/).map(tidy).filter(Boolean);
    let size = 750;
    const takeSize = s => {
      const m = SIZE.exec(s);
      if (!m) return s;
      size = normalisePack(m[1], /^l/i.test(m[2]) ? 'l' : m[2]).size;
      return tidy(s.slice(0, m.index));
    };
    if (parts.length) parts[parts.length - 1] = takeSize(parts[parts.length - 1]);
    if (parts.length > 1 && !parts[parts.length - 1]) parts.pop();

    let producer = parts.length > 1 ? parts.shift() : '';
    let name = parts.join(' - ');
    let vintage = '';
    const years = name.match(YEAR);
    if (years) {
      vintage = years[years.length - 1];
      name = tidy(name.replace(YEAR, ' '));
    } else if (/\bNV\b/i.test(name)) {
      vintage = 'NV';
      name = tidy(name.replace(/\bNV\b/gi, ' '));
    }
    // "2025 Valdibella - BIB Bianco": the year sits in front of the producer.
    const lead = /^((?:19|20)\d{2})\s+(.+)$/.exec(producer);
    if (lead) {
      producer = lead[2];
      vintage ||= lead[1];
    }
    if (!name) continue;
    out.push({ raw: raw.trim(), producer, name, vintage, style: style || guessStyle(name), size, price });
  }
  return out;
}
