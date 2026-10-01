// Cost calculations. The sheet stores raw inputs only; everything here is derived.

import { money } from './ui.js';

// Friendly units accepted in forms, converted to the stored base units (g / ml / each).
const CONVERT = { g: ['g', 1], kg: ['g', 1000], ml: ['ml', 1], cl: ['ml', 10], l: ['ml', 1000], each: ['each', 1] };

export const PACK_UNIT_OPTIONS = [['g', 'g'], ['kg', 'kg → g'], ['ml', 'ml'], ['cl', 'cl → ml'], ['L', 'L → ml'], ['each', 'each']];

export function normalisePack(size, unit) {
  const [base, factor] = CONVERT[String(unit).toLowerCase()] || [unit, 1];
  const n = Number(size);
  return { size: size === '' || isNaN(n) ? '' : Math.round(n * factor * 1e6) / 1e6, unit: base };
}

/** Cost per g / ml / each as purchased, or null if inputs are incomplete. */
export function unitCost(ing) {
  const size = Number(ing.PACK_SIZE);
  const price = Number(ing.PACK_PRICE);
  if (ing.PACK_PRICE === '' || !(size > 0) || !(price >= 0)) return null;
  return price / size;
}

export function yieldFraction(ing) {
  const y = ing['YIELD_%'] === '' || ing['YIELD_%'] == null ? 100 : Number(ing['YIELD_%']);
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
