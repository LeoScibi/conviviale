// Wines: ingredients marked KIND = wine, shown on their own page with wine details. They share
// suppliers and price lists with ingredients, so a bottle can go straight into a by-the-glass recipe.

import * as store from '../store.js';
import { ALLERGENS, WINE_KIND, WINE_CATEGORY, WINE_STYLES } from '../config.js';
import { icons } from '../icons.js';
import { esc, money, formDialog, toast, reportError, byName, sameName, matches, option } from '../ui.js';
import {
  normalisePack, priceUnitCost, pricesFor, chosenPrice, ingredientUnit, usableUnitCost, formatUnitCost, packLabel,
  isWine, displayName,
} from '../costing.js';
import { openPriceForm, pricesSectionHtml, historyHtml, supplierName } from './prices.js';

const BOTTLE_UNIT_OPTIONS = [['cl', 'cl'], ['ml', 'ml'], ['L', 'L']];
const GLASS_ML = 125;

const state = { q: '', style: '', supplier: '', inactive: false };
let root;

const wines = () => store.rows('INGREDIENTS').filter(isWine);

// Wines added as plain ingredients before this page existed.
const strays = () => store.rows('INGREDIENTS').filter(i => !isWine(i) && sameName(i.CATEGORY, WINE_CATEGORY));

export function render(el) {
  root = el;
  const styles = [...new Set([...WINE_STYLES, ...wines().map(w => String(w.STYLE).trim()).filter(Boolean)])];
  if (state.style && !styles.includes(state.style)) state.style = '';
  const sups = store.rows('SUPPLIERS').slice().sort(byName);
  const stray = strays();

  el.innerHTML = `
    <div class="page-head">
      <div>
        <p class="overline" data-count></p>
        <h1 class="title">Wines</h1>
      </div>
      <button class="btn primary add-desktop" data-add>${icons.plus} Add wine</button>
    </div>
    <div class="toolbar">
      <label class="search-wrap">${icons.search}
        <input type="search" class="search" data-q value="${esc(state.q)}"
          placeholder="Search wines" aria-label="Search wines">
      </label>
      <div class="filters">
        <select data-style aria-label="Filter by style">
          <option value="">All styles</option>${styles.map(s => option(s, s, state.style)).join('')}
        </select>
        <select data-sup aria-label="Filter by supplier">
          <option value="">All suppliers</option>
          ${sups.map(s => option(s.SUPPLIER_ID, s.NAME, state.supplier)).join('')}
          ${option('__none', 'No supplier', state.supplier)}
        </select>
        <label class="toggle-chip"><input type="checkbox" data-inactive${state.inactive ? ' checked' : ''}> Show inactive</label>
      </div>
    </div>
    ${stray.length ? `<p class="notice wine-strays">${stray.length} ingredient${stray.length === 1 ? ' is' : 's are'} in the Wine category.
      <button class="btn sm" data-move>Move ${stray.length === 1 ? 'it' : 'them'} here</button></p>` : ''}
    <div data-list></div>
    <button class="fab" data-add aria-label="Add wine">${icons.plus}</button>`;

  el.querySelector('[data-q]').addEventListener('input', e => { state.q = e.target.value; renderList(); });
  el.querySelector('[data-style]').addEventListener('change', e => { state.style = e.target.value; renderList(); });
  el.querySelector('[data-sup]').addEventListener('change', e => { state.supplier = e.target.value; renderList(); });
  el.querySelector('[data-inactive]').addEventListener('change', e => { state.inactive = e.target.checked; renderList(); });
  el.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => openForm(null)));
  el.querySelector('[data-move]')?.addEventListener('click', moveStrays);
  el.querySelector('[data-list]').addEventListener('click', e => {
    const hit = e.target.closest('.card-hit');
    if (hit) openForm(store.byId('INGREDIENTS', hit.dataset.id));
  });
  renderList();
}

async function moveStrays() {
  const list = strays();
  if (!list.length || !confirm(`Move these from Ingredients to Wines?\n\n${list.map(i => i.NAME).join('\n')}\n\nTheir prices and recipes are kept.`)) return;
  try {
    await store.updateMany('INGREDIENTS', list.map(i => ({ id: i.ING_ID, record: { KIND: WINE_KIND } })));
    toast(`Moved ${list.length} wine${list.length === 1 ? '' : 's'}`);
    if (root?.isConnected) render(root);
  } catch (err) {
    reportError(err);
  }
}

function renderList() {
  const all = wines();
  const list = all.filter(w => {
    if (!state.inactive && !w.ACTIVE) return false;
    if (state.style && String(w.STYLE).trim() !== state.style) return false;
    const prices = pricesFor(w.ING_ID);
    if (state.supplier === '__none' && prices.length) return false;
    if (state.supplier && state.supplier !== '__none' && !prices.some(p => String(p.SUPPLIER_ID) === state.supplier)) return false;
    return matches(state.q, w.NAME, w.PRODUCER, w.VINTAGE, w.REGION, w.GRAPE, w.STYLE, w.ING_ID,
      ...prices.map(p => `${p.SUPPLIER_CODE} ${p.PRODUCT_NAME} ${supplierName(p.SUPPLIER_ID)}`));
  }).sort((a, b) => byName(a, b) || String(a.VINTAGE).localeCompare(String(b.VINTAGE)));

  const shown = all.filter(w => state.inactive || w.ACTIVE).length;
  root.querySelector('[data-count]').textContent =
    list.length === shown ? (state.inactive ? `${shown} total` : `${shown} on the list`) : `${list.length} of ${shown}`;

  if (!list.length) {
    root.querySelector('[data-list]').innerHTML = `<div class="empty">${
      all.length ? 'No wines match these filters.' : 'No wines yet. Add your first one to get started.'}</div>`;
    return;
  }

  root.querySelector('[data-list]').innerHTML = `<div class="cards">${list.map(w => {
    const p = chosenPrice(w)?.price;
    const supplierCount = new Set(pricesFor(w.ING_ID).map(x => String(x.SUPPLIER_ID))).size;
    const sup = p ? esc(supplierName(p.SUPPLIER_ID)) : '';
    const sub = [esc(w.PRODUCER), esc(w.REGION)].filter(Boolean).join(' · ') || 'No producer';
    const glass = ingredientUnit(w) === 'ml' ? usableUnitCost(w) : null;
    return `
    <article class="card${w.ACTIVE ? '' : ' inactive'}">
      <button class="card-hit" data-id="${esc(w.ING_ID)}" aria-label="Edit ${esc(displayName(w))}"></button>
      <div class="card-top">
        <div>
          <div class="card-name">${esc(displayName(w))}${w.ACTIVE ? '' : ' <span class="tag">Inactive</span>'}${
            p ? '' : ' <span class="tag allergen">Needs price</span>'}</div>
          <div class="card-sub">${sub}</div>
        </div>
        <div class="card-figure"><strong>${p ? money(p.PACK_PRICE) : '—'}</strong><span>${
          p ? `per ${esc(packLabel(p.PACK_SIZE, p.PACK_UNIT))}` : 'bottle cost'}</span></div>
      </div>
      <div class="card-meta">
        ${sup ? `<span>${supplierCount > 1 ? `${sup} +${supplierCount - 1}` : sup}</span>` : '<span>No supplier price yet</span>'}
        ${glass != null ? `<span>${GLASS_ML} ml glass <b>${money(glass * GLASS_ML)}</b></span>` : ''}
        ${w.GRAPE ? `<span>${esc(w.GRAPE)}</span>` : ''}
      </div>
      ${w.STYLE ? `<div class="tags"><span class="tag">${esc(w.STYLE)}</span></div>` : ''}
    </article>`;
  }).join('')}</div>`;
}

/**
 * Add or edit a wine. A new wine can take its first bottle price in the same form; an existing
 * one shows every supplier's price. `onSaved(id)` runs after a successful save.
 */
export function openForm(wine, { onSaved } = {}) {
  const isNew = !wine;
  const supOptions = store.rows('SUPPLIERS').slice().sort(byName).map(s => [s.SUPPLIER_ID, s.NAME]);
  const all = wines();
  const suggest = f => [...new Set(all.map(w => String(w[f]).trim()).filter(Boolean))].sort();
  const styles = [...new Set([...WINE_STYLES, ...suggest('STYLE')])];

  const fields = [
    { name: 'NAME', label: 'Wine', required: true, wide: true, placeholder: 'e.g. Montepulciano d’Abruzzo' },
    { name: 'PRODUCER', label: 'Producer', suggestions: suggest('PRODUCER'), wide: true },
    { name: 'VINTAGE', label: 'Vintage', placeholder: 'e.g. 2022 or NV', inputmode: 'numeric', half: true },
    { name: 'STYLE', label: 'Style', type: 'select', options: [['', 'Choose…'], ...styles], half: true },
    { name: 'REGION', label: 'Region', suggestions: suggest('REGION'), placeholder: 'e.g. Abruzzo, Italy' },
    { name: 'GRAPE', label: 'Grape', suggestions: suggest('GRAPE') },
  ];
  if (isNew) {
    fields.push(
      { name: 'P_SUPPLIER', label: 'Supplier', type: 'select', options: [['', 'Add a price later'], ...supOptions], wide: true,
        hint: 'First price (optional). Add more suppliers after saving.' },
      { name: 'P_SIZE', label: 'Bottle size', type: 'number', min: 0.001, step: 'any', inputmode: 'decimal', half: true },
      { name: 'P_UNIT', label: 'Unit', type: 'select', options: BOTTLE_UNIT_OPTIONS, half: true },
      { name: 'P_PRICE', label: 'Bottle price £', type: 'number', min: 0, step: 0.01, inputmode: 'decimal', half: true, hint: 'Ex VAT' },
      { name: 'P_CODE', label: 'Product code', half: true, autocomplete: 'off' },
      { name: 'P_REF', label: 'Invoice ref', wide: true, placeholder: 'Optional' },
    );
  } else {
    fields.push({ name: 'SUPPLIER_ID', label: 'Preferred supplier', type: 'select', wide: true,
      options: [['', 'Cheapest price (automatic)'], ...supOptions],
      hint: 'Recipes use this supplier’s price. If it has none, the cheapest is used.' });
  }
  fields.push(
    { name: 'ACTIVE', label: 'Active (on the list)', type: 'checkbox', wide: true },
    { name: 'ALLERGENS', label: 'Allergens', type: 'chips', options: ALLERGENS, wide: true },
  );

  const refreshPrices = dlg => {
    const host = dlg.querySelector('[data-prices]');
    if (host) host.innerHTML = pricesSectionHtml(store.byId('INGREDIENTS', wine.ING_ID));
    dlg.querySelector('form').dispatchEvent(new Event('input'));
    if (root?.isConnected) renderList();
    onSaved?.(wine.ING_ID);
  };

  const glassHtml = (perMl, from = '') => `<strong>${money(perMl * GLASS_ML)}</strong> per ${GLASS_ML} ml glass · ${formatUnitCost(perMl, 'ml')}${from}`;

  formDialog({
    title: isNew ? 'Add wine' : `Edit ${displayName(wine)}`,
    fields,
    values: wine || { ACTIVE: true, ALLERGENS: 'Sulphites', P_SIZE: 75, P_UNIT: 'cl' },
    submitLabel: isNew ? 'Add wine' : 'Save changes',
    extraHtml: `<p class="cost-preview" data-preview aria-live="polite"></p>${
      isNew ? '' : `<section class="prices" data-prices>${pricesSectionHtml(wine)}</section>${historyHtml(wine.ING_ID)}`}`,
    onOpen: dlg => {
      dlg.querySelector('[data-prices]')?.addEventListener('click', e => {
        if (e.target.closest('[data-add-price]')) {
          openPriceForm({ ingId: wine.ING_ID, onSaved: () => refreshPrices(dlg) });
          return;
        }
        const row = e.target.closest('[data-price-id]');
        if (row) {
          const price = store.byId('SUPPLIER_PRICES', row.dataset.priceId);
          openPriceForm({ price, onSaved: () => refreshPrices(dlg), onDeleted: () => refreshPrices(dlg) });
        }
      });
    },
    onChange: (d, dlg) => {
      const el = dlg.querySelector('[data-preview]');
      if (isNew) {
        const { size, unit } = normalisePack(d.P_SIZE, d.P_UNIT);
        const perMl = priceUnitCost({ PACK_SIZE: size, PACK_UNIT: unit, PACK_PRICE: d.P_PRICE });
        if (perMl == null) el.textContent = 'Add a bottle price to see the cost per glass.';
        else el.innerHTML = glassHtml(perMl);
        return;
      }
      const live = { ...store.byId('INGREDIENTS', wine.ING_ID), SUPPLIER_ID: d.SUPPLIER_ID };
      const chosen = chosenPrice(live);
      if (!chosen) { el.textContent = 'No usable price yet, so recipes cost this as £0.'; return; }
      const from = ` · from ${esc(supplierName(chosen.price.SUPPLIER_ID))}${
        d.SUPPLIER_ID && chosen.why === 'cheapest' ? ' (your preferred supplier has no price, so the cheapest is used)' : ''}`;
      const cost = usableUnitCost(live);
      el.innerHTML = ingredientUnit(live) === 'ml' ? glassHtml(cost, from) : `<strong>${formatUnitCost(cost, ingredientUnit(live))}</strong>${from}`;
    },
    onSubmit: async d => {
      // The same wine can be listed in several vintages; anything else must have its own name.
      const clash = store.rows('INGREDIENTS').find(i => i.ING_ID !== wine?.ING_ID && sameName(i.NAME, d.NAME)
        && (!isWine(i) || sameName(i.VINTAGE, d.VINTAGE)));
      if (clash) {
        throw new Error(isWine(clash)
          ? `${displayName(clash)} is already on the list (${clash.ING_ID}). Give this one a different vintage.`
          : `An ingredient called “${clash.NAME}” already exists (${clash.ING_ID}).`);
      }

      const base = {
        NAME: d.NAME, PRODUCER: d.PRODUCER, VINTAGE: d.VINTAGE, STYLE: d.STYLE, REGION: d.REGION, GRAPE: d.GRAPE,
        ACTIVE: d.ACTIVE, ALLERGENS: d.ALLERGENS,
      };

      if (!isNew) {
        await store.update('INGREDIENTS', wine.ING_ID, { ...base, SUPPLIER_ID: d.SUPPLIER_ID });
        toast(`Saved ${d.NAME}`);
        if (root?.isConnected) renderList();
        onSaved?.(wine.ING_ID);
        return;
      }

      // A blank price, or just the default bottle size, means "add a price later".
      const wantsPrice = d.P_SUPPLIER || d.P_PRICE !== '';
      let pack = null;
      if (wantsPrice) {
        if (!d.P_SUPPLIER) throw new Error('Choose the supplier for the first price, or clear the bottle price.');
        pack = normalisePack(d.P_SIZE, d.P_UNIT);
        if (!(pack.size > 0)) throw new Error('Bottle size must be greater than zero.');
        if (d.P_PRICE === '' || !(d.P_PRICE >= 0)) throw new Error('Enter the bottle price.');
      }
      const id = await store.create('INGREDIENTS', {
        ...base, KIND: WINE_KIND, CATEGORY: WINE_CATEGORY, UNIT: 'ml', 'YIELD_%': 100, STORAGE: 'Cellar',
      });
      if (pack) {
        try {
          const priceId = await store.create('SUPPLIER_PRICES', {
            SUPPLIER_ID: d.P_SUPPLIER, ING_ID: id, SUPPLIER_CODE: d.P_CODE, PACK_SIZE: pack.size, PACK_UNIT: pack.unit,
            PACK_PRICE: d.P_PRICE, UPDATED: store.today(),
          });
          await store.logPrices([{ ING_ID: id, SUPPLIER_ID: d.P_SUPPLIER, PRICE_ID: priceId, PACK_PRICE: d.P_PRICE, INVOICE_REF: d.P_REF }]);
        } catch (err) {
          console.error(err);
          toast(`Added ${d.NAME}, but its price wasn't saved: ${err.message}`, 'error');
        }
      }
      toast(`Added ${d.NAME}`);
      if (root?.isConnected) render(root);
      onSaved?.(id);
    },
  });
}
