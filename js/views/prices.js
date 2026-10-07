// Price-list entries (SUPPLIER_PRICES): the form to add / edit / delete one, and the small
// row markup shared by the supplier page and the ingredient form.

import * as store from '../store.js';
import { esc, money, formDialog, toast, byName } from '../ui.js';
import { icons } from '../icons.js';
import {
  PACK_UNIT_OPTIONS, normalisePack, priceUnitCost, ingredientUnit, chosenPrice, pricesFor, formatUnitCost, packLabel,
  isWine, displayName,
} from '../costing.js';
import { normName } from '../recipe-paste.js';

const UNIT_WORD = { g: 'weight', ml: 'volume', each: 'each' };

export const supplierName = id => store.byId('SUPPLIERS', id)?.NAME || (id ? `${id}?` : 'No supplier');

/** Tags for a price row: is it the one recipes use, and is it the cheapest? */
export function priceTags(p) {
  const ing = store.byId('INGREDIENTS', p.ING_ID);
  const chosen = ing ? chosenPrice(ing) : null;
  const tags = [];
  // Only worth flagging when there is a choice between suppliers.
  if (new Set(pricesFor(p.ING_ID).map(x => String(x.SUPPLIER_ID))).size < 2) return '';
  if (chosen?.price === p) tags.push(`<span class="tag used">${chosen.why === 'preferred' ? 'Preferred' : 'Used'}</span>`);
  if (chosen && chosen.cheapest === p && chosen.price !== p) tags.push('<span class="tag">Cheapest</span>');
  return tags.join('');
}

/**
 * One tappable price row. `title` is what identifies the row in context: the supplier on an
 * ingredient's form, the ingredient on a supplier's list.
 */
export function priceRowHtml(p, title) {
  const unitCostNow = priceUnitCost(p);
  const sub = [p.SUPPLIER_CODE, packLabel(p.PACK_SIZE, p.PACK_UNIT), p.UPDATED ? `updated ${p.UPDATED}` : '']
    .filter(Boolean).map(esc).join(' · ');
  return `
    <button type="button" class="price-row" data-price-id="${esc(p.PRICE_ID)}">
      <span class="pr-main"><b>${esc(title)}</b>${priceTags(p)}<small>${sub}</small></span>
      <span class="pr-cost"><b>${money(p.PACK_PRICE)}</b><small>${formatUnitCost(unitCostNow, p.PACK_UNIT)}</small></span>
    </button>`;
}

/** The "Supplier prices" block on an ingredient's (or wine's) form, cheapest first. */
export function pricesSectionHtml(ing) {
  const rows = pricesFor(ing.ING_ID).slice().sort((a, b) => (priceUnitCost(a) ?? Infinity) - (priceUnitCost(b) ?? Infinity));
  return `
    <div class="section-head">
      <h3 class="section-title">Supplier prices</h3>
      <button type="button" class="btn sm" data-add-price>${icons.plus} Add price</button>
    </div>
    ${rows.length
      ? `<div class="price-rows">${rows.map(p => priceRowHtml(p, supplierName(p.SUPPLIER_ID))).join('')}</div>`
      : `<p class="muted small">No supplier prices yet. Add one so recipes can cost this ${isWine(ing) ? 'wine' : 'ingredient'}.</p>`}`;
}

export function historyHtml(ingId) {
  const rows = store.rows('PRICE_HISTORY')
    .filter(r => String(r.ING_ID) === String(ingId))
    .sort((a, b) => String(b.DATE).localeCompare(String(a.DATE)) || b._row - a._row)
    .slice(0, 8);
  if (!rows.length) return '';
  return `
    <section class="history">
      <h3>Price history</h3>
      <table><tbody>${rows.map(r => `
        <tr><td>${esc(r.DATE)}</td><td>${esc(r.SUPPLIER_ID ? supplierName(r.SUPPLIER_ID) : '')}</td><td class="num">${money(r.PACK_PRICE)}</td><td class="muted">${esc(r.INVOICE_REF)}</td></tr>`).join('')}
      </tbody></table>
    </section>`;
}

/**
 * Add or edit a price-list entry.
 *  - `price`: existing SUPPLIER_PRICES row to edit, or null to add.
 *  - `supplierId` / `ingId`: fix the supplier or ingredient when adding from their page.
 *  - `onSaved(priceId)` / `onDeleted()`: refresh callbacks for the opener.
 */
export function openPriceForm({ price = null, supplierId = null, ingId = null, onSaved, onDeleted } = {}) {
  const isNew = !price;
  const fixedSupplier = price?.SUPPLIER_ID ?? supplierId;
  const fixedIng = price?.ING_ID ?? ingId;
  const ing = fixedIng ? store.byId('INGREDIENTS', fixedIng) : null;
  const sups = store.rows('SUPPLIERS').slice().sort(byName);

  const fields = [];
  if (!fixedIng) {
    fields.push({
      name: 'ING_NAME', label: 'Ingredient or wine', required: true, wide: true, autocomplete: 'off',
      suggestions: store.rows('INGREDIENTS').filter(i => i.ACTIVE).map(displayName),
      hint: 'Pick one of your ingredients or wines, or type a new name to create an ingredient.',
    });
  }
  if (!fixedSupplier || !isNew) {
    fields.push({
      name: 'SUPPLIER_ID', label: 'Supplier', type: 'select', required: true, wide: true,
      options: [['', 'Choose…'], ...sups.map(s => [s.SUPPLIER_ID, s.NAME])],
    });
  }
  fields.push(
    { name: 'PACK_SIZE', label: 'Pack size', type: 'number', required: true, min: 0.001, step: 'any', inputmode: 'decimal', half: true },
    { name: 'PACK_UNIT', label: 'Unit', type: 'select', required: true, options: PACK_UNIT_OPTIONS, half: true },
    { name: 'PACK_PRICE', label: 'Pack price £', type: 'number', required: true, min: 0, step: 0.01, inputmode: 'decimal', half: true, hint: 'Ex VAT' },
    { name: 'SUPPLIER_CODE', label: 'Product code', half: true, autocomplete: 'off' },
    { name: 'PRODUCT_NAME', label: 'Supplier’s description', wide: true, placeholder: 'Optional, as it appears on their list' },
    { name: 'INVOICE_REF', label: 'Invoice ref', wide: true, placeholder: 'Optional',
      hint: isNew ? 'Saved with this price in the price history.' : 'Saved to the price history if the price changes.' },
  );

  const title = isNew
    ? (ing ? `Add a price for ${displayName(ing)}` : `Add to ${supplierName(fixedSupplier)}`)
    : `${displayName(ing) || 'Price'} · ${supplierName(price.SUPPLIER_ID)}`;

  formDialog({
    title,
    fields,
    values: price
      ? { ...price }
      : { PACK_UNIT: ing ? ingredientUnit(ing) || 'g' : 'g', SUPPLIER_ID: fixedSupplier ?? '' },
    submitLabel: isNew ? 'Add price' : 'Save price',
    extraHtml: '<p class="cost-preview" data-preview aria-live="polite"></p>',
    onChange: (d, dlg) => {
      const { size, unit } = normalisePack(d.PACK_SIZE, d.PACK_UNIT);
      const c = priceUnitCost({ PACK_SIZE: size, PACK_UNIT: unit, PACK_PRICE: d.PACK_PRICE });
      dlg.querySelector('[data-preview]').innerHTML = c == null
        ? 'Enter pack size and price to see the unit cost.'
        : `<strong>${formatUnitCost(c, unit)}</strong> as bought`;
    },
    onDelete: isNew ? null : async () => {
      if (!confirm('Remove this price from the supplier’s list?')) return false;
      await store.remove({ SUPPLIER_PRICES: [price.PRICE_ID] });
      toast('Price removed');
      onDeleted?.();
      return true;
    },
    deleteLabel: 'Remove',
    onSubmit: async d => {
      const supplier = fixedSupplier && isNew ? fixedSupplier : d.SUPPLIER_ID;
      if (!supplier) throw new Error('Choose a supplier.');
      const { size, unit } = normalisePack(d.PACK_SIZE, d.PACK_UNIT);
      if (!(size > 0)) throw new Error('Pack size must be greater than zero.');
      if (d.PACK_PRICE === '' || !(d.PACK_PRICE >= 0)) throw new Error('Enter the pack price.');

      // Resolve the ingredient, creating it if a new name was typed.
      let target = ing;
      let created = false;
      if (!target) {
        const name = d.ING_NAME.trim();
        const all = store.rows('INGREDIENTS');
        target = all.find(i => normName(displayName(i)) === normName(name)) || all.find(i => normName(i.NAME) === normName(name)) || null;
        if (!target) {
          const id = await store.create('INGREDIENTS', { NAME: name, UNIT: unit, 'YIELD_%': 100, ACTIVE: true });
          target = store.byId('INGREDIENTS', id);
          created = true;
        }
      }
      const measured = ingredientUnit(target);
      if (measured && measured !== unit) {
        throw new Error(`${target.NAME} is measured by ${UNIT_WORD[measured]}, so enter this pack in ${measured === 'g' ? 'g or kg' : measured === 'ml' ? 'ml, cl or L' : 'each'}.`);
      }
      const dup = store.rows('SUPPLIER_PRICES').find(p => p.PRICE_ID !== price?.PRICE_ID
        && String(p.SUPPLIER_ID) === String(supplier) && String(p.ING_ID) === String(target.ING_ID) && Number(p.PACK_SIZE) === size);
      if (dup) throw new Error(`${supplierName(supplier)} already lists ${target.NAME} in that pack size. Edit that entry instead.`);

      const priceChanged = isNew || Number(price.PACK_PRICE) !== d.PACK_PRICE || price.PACK_PRICE === '';
      const rec = {
        SUPPLIER_ID: supplier, ING_ID: target.ING_ID, SUPPLIER_CODE: d.SUPPLIER_CODE, PRODUCT_NAME: d.PRODUCT_NAME,
        PACK_SIZE: size, PACK_UNIT: unit, PACK_PRICE: d.PACK_PRICE,
        ...(priceChanged ? { UPDATED: store.today() } : {}),
      };
      let id;
      if (isNew) id = await store.create('SUPPLIER_PRICES', rec);
      else {
        id = price.PRICE_ID;
        await store.update('SUPPLIER_PRICES', id, rec);
      }
      if (priceChanged) {
        try {
          await store.logPrices([{ ING_ID: target.ING_ID, SUPPLIER_ID: supplier, PRICE_ID: id, PACK_PRICE: d.PACK_PRICE, INVOICE_REF: d.INVOICE_REF }]);
        } catch (err) {
          console.error(err);
          toast(`Saved, but the price history entry failed: ${err.message}`, 'error');
        }
      }
      toast(created ? `Created ${target.NAME} and added its price` : isNew ? 'Price added' : 'Price saved');
      onSaved?.(id);
    },
  });
}
