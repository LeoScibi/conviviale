// One-off, idempotent data migrations, run after every load. Each only adds or fills in;
// nothing is deleted, and re-running does nothing once the data is up to date.

import * as store from './store.js';
import { normUnit } from './units.js';

const BASE_UNITS = ['g', 'ml', 'each'];

/**
 * Before supplier price lists, each ingredient carried one supplier, code, pack and price.
 * Copy that into SUPPLIER_PRICES (once per ingredient that has no price-list rows yet), and set
 * the ingredient's UNIT from its old PACK_UNIT. The old columns are left untouched.
 */
export async function migrateToPriceLists() {
  const have = new Set(store.rows('SUPPLIER_PRICES').map(p => String(p.ING_ID)));
  const prices = [];
  const units = [];
  for (const ing of store.rows('INGREDIENTS')) {
    // UNIT is set by this migration, so a filled-in UNIT means "already done". Without this, an
    // ingredient whose price-list rows were later deleted would get its old price copied back.
    if (!ing.ING_ID || ing.UNIT) continue;
    const legacyUnit = normUnit(ing.PACK_UNIT);
    if (!ing.UNIT && BASE_UNITS.includes(legacyUnit)) units.push({ id: ing.ING_ID, record: { UNIT: legacyUnit } });
    const hasLegacyPrice = ing.PACK_PRICE !== '' && ing.PACK_PRICE != null && Number(ing.PACK_SIZE) > 0;
    if (hasLegacyPrice && !have.has(String(ing.ING_ID)) && BASE_UNITS.includes(legacyUnit)) {
      prices.push({
        SUPPLIER_ID: ing.SUPPLIER_ID ?? '', ING_ID: ing.ING_ID, SUPPLIER_CODE: ing.SUPPLIER_CODE ?? '',
        PACK_SIZE: Number(ing.PACK_SIZE), PACK_UNIT: legacyUnit, PACK_PRICE: Number(ing.PACK_PRICE), UPDATED: store.today(),
      });
    }
  }
  // Prices first: if the second write fails, a re-run still fills in the units.
  if (prices.length) await store.createMany('SUPPLIER_PRICES', prices);
  if (units.length) await store.updateMany('INGREDIENTS', units);
  return { prices: prices.length };
}
