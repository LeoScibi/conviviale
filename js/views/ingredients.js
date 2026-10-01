import * as store from '../store.js';
import { ALLERGENS, CATEGORY_SUGGESTIONS, STORAGE_SUGGESTIONS } from '../config.js';
import { icons } from '../icons.js';
import { esc, money, formDialog, toast, byName, sameName, matches, option, splitList } from '../ui.js';
import { PACK_UNIT_OPTIONS, normalisePack, unitCost, usableUnitCost, formatUnitCost } from '../costing.js';

const state = { q: '', category: '', supplier: '', inactive: false };
let root;

const supplierMap = () => new Map(store.rows('SUPPLIERS').map(s => [String(s.SUPPLIER_ID), s]));

export function render(el) {
  root = el;
  const ings = store.rows('INGREDIENTS');
  const cats = [...new Set(ings.map(i => String(i.CATEGORY).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'en-GB'));
  if (state.category && !cats.includes(state.category)) state.category = '';
  const sups = store.rows('SUPPLIERS').slice().sort(byName);

  el.innerHTML = `
    <div class="page-head">
      <div>
        <p class="overline" data-count></p>
        <h1 class="title">Ingredients</h1>
      </div>
      <button class="btn primary add-desktop" data-add>${icons.plus} Add ingredient</button>
    </div>
    <div class="toolbar">
      <label class="search-wrap">${icons.search}
        <input type="search" class="search" data-q value="${esc(state.q)}"
          placeholder="Search ingredients" aria-label="Search ingredients">
      </label>
      <div class="filters">
        <select data-cat aria-label="Filter by category">
          <option value="">All categories</option>${cats.map(c => option(c, c, state.category)).join('')}
        </select>
        <select data-sup aria-label="Filter by supplier">
          <option value="">All suppliers</option>
          ${sups.map(s => option(s.SUPPLIER_ID, s.NAME, state.supplier)).join('')}
          ${option('__none', 'No supplier', state.supplier)}
        </select>
        <label class="toggle-chip"><input type="checkbox" data-inactive${state.inactive ? ' checked' : ''}> Show inactive</label>
      </div>
    </div>
    <div data-list></div>
    <button class="fab" data-add aria-label="Add ingredient">${icons.plus}</button>`;

  el.querySelector('[data-q]').addEventListener('input', e => { state.q = e.target.value; renderList(); });
  el.querySelector('[data-cat]').addEventListener('change', e => { state.category = e.target.value; renderList(); });
  el.querySelector('[data-sup]').addEventListener('change', e => { state.supplier = e.target.value; renderList(); });
  el.querySelector('[data-inactive]').addEventListener('change', e => { state.inactive = e.target.checked; renderList(); });
  el.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => openForm(null)));
  el.querySelector('[data-list]').addEventListener('click', e => {
    const hit = e.target.closest('.card-hit');
    if (hit) openForm(store.byId('INGREDIENTS', hit.dataset.id));
  });
  renderList();
}

function renderList() {
  const all = store.rows('INGREDIENTS');
  const sups = supplierMap();
  const list = all.filter(i => {
    if (!state.inactive && !i.ACTIVE) return false;
    if (state.category && String(i.CATEGORY).trim() !== state.category) return false;
    if (state.supplier === '__none' ? i.SUPPLIER_ID : state.supplier && String(i.SUPPLIER_ID) !== state.supplier) return false;
    return matches(state.q, i.NAME, i.CATEGORY, i.SUPPLIER_CODE, i.ALLERGENS, i.ING_ID,
      sups.get(String(i.SUPPLIER_ID))?.NAME ?? '');
  }).sort(byName);

  const shown = all.filter(i => state.inactive || i.ACTIVE).length;
  root.querySelector('[data-count]').textContent =
    list.length === shown ? (state.inactive ? `${shown} total` : `${shown} in use`) : `${list.length} of ${shown}`;

  if (!list.length) {
    root.querySelector('[data-list]').innerHTML = `<div class="empty">${
      all.length ? 'No ingredients match these filters.' : 'No ingredients yet. Add your first one to get started.'}</div>`;
    return;
  }

  root.querySelector('[data-list]').innerHTML = `<div class="cards">${list.map(i => {
    const sup = sups.get(String(i.SUPPLIER_ID));
    const supName = sup ? esc(sup.NAME) : i.SUPPLIER_ID ? `<span class="warn">${esc(i.SUPPLIER_ID)}?</span>` : '';
    const sub = [esc(i.CATEGORY), supName].filter(Boolean).join(' · ') || 'No category';
    const allergens = splitList(i.ALLERGENS);
    const yieldPct = i['YIELD_%'] === '' ? 100 : i['YIELD_%'];
    return `
    <article class="card${i.ACTIVE ? '' : ' inactive'}">
      <button class="card-hit" data-id="${esc(i.ING_ID)}" aria-label="Edit ${esc(i.NAME)}"></button>
      <div class="card-top">
        <div>
          <div class="card-name">${esc(i.NAME)}${i.ACTIVE ? '' : ' <span class="tag">Inactive</span>'}</div>
          <div class="card-sub">${sub}</div>
        </div>
        <div class="card-figure"><strong>${formatUnitCost(usableUnitCost(i), i.PACK_UNIT)}</strong><span>usable cost</span></div>
      </div>
      <div class="card-meta">
        <span>${i.PACK_SIZE === '' ? 'No pack size' : `<b>${esc(i.PACK_SIZE)} ${esc(i.PACK_UNIT)}</b>`} for <b>${money(i.PACK_PRICE)}</b></span>
        ${Number(yieldPct) !== 100 ? `<span>Yield <b>${esc(yieldPct)}%</b></span>` : ''}
        ${i.SUPPLIER_CODE ? `<span>Code <b>${esc(i.SUPPLIER_CODE)}</b></span>` : ''}
      </div>
      ${allergens.length ? `<div class="tags">${allergens.map(a => `<span class="tag allergen">${esc(a)}</span>`).join('')}</div>` : ''}
    </article>`;
  }).join('')}</div>`;
}

function historyHtml(ingId) {
  const rows = store.rows('PRICE_HISTORY')
    .filter(r => String(r.ING_ID) === String(ingId))
    .sort((a, b) => String(b.DATE).localeCompare(String(a.DATE)) || b._row - a._row)
    .slice(0, 8);
  if (!rows.length) return '';
  return `
    <section class="history">
      <h3>Price history</h3>
      <table><tbody>${rows.map(r => `
        <tr><td>${esc(r.DATE)}</td><td class="num">${money(r.PACK_PRICE)}</td><td class="muted">${esc(r.INVOICE_REF)}</td></tr>`).join('')}
      </tbody></table>
    </section>`;
}

export function openForm(ing) {
  const isNew = !ing;
  const sups = store.rows('SUPPLIERS').slice().sort(byName);
  const supOptions = [['', '— None —'], ...sups.map(s => [s.SUPPLIER_ID, s.NAME])];
  if (ing?.SUPPLIER_ID && !sups.some(s => String(s.SUPPLIER_ID) === String(ing.SUPPLIER_ID))) {
    supOptions.push([ing.SUPPLIER_ID, `${ing.SUPPLIER_ID} (not found)`]);
  }
  const categories = [...new Set([...CATEGORY_SUGGESTIONS, ...store.rows('INGREDIENTS').map(i => i.CATEGORY).filter(Boolean)])];

  const fields = [
    { name: 'NAME', label: 'Ingredient name', required: true, wide: true },
    { name: 'CATEGORY', label: 'Category', suggestions: categories, half: true },
    { name: 'STORAGE', label: 'Storage', suggestions: STORAGE_SUGGESTIONS, half: true },
    { name: 'SUPPLIER_ID', label: 'Supplier', type: 'select', options: supOptions },
    { name: 'SUPPLIER_CODE', label: 'Supplier product code' },
    { name: 'PACK_SIZE', label: 'Pack size', type: 'number', required: true, min: 0.001, step: 'any', inputmode: 'decimal', half: true },
    { name: 'PACK_UNIT', label: 'Unit', type: 'select', required: true, options: PACK_UNIT_OPTIONS, half: true },
    { name: 'PACK_PRICE', label: 'Pack price £', type: 'number', required: true, min: 0, step: 0.01, inputmode: 'decimal', half: true,
      hint: 'Ex VAT' },
    { name: 'YIELD_%', label: 'Yield %', type: 'number', min: 1, max: 100, step: 'any', inputmode: 'decimal', half: true,
      hint: 'Usable after trim' },
    { name: 'INVOICE_REF', label: 'Invoice ref', placeholder: 'Optional',
      hint: isNew ? 'Saved with the first price-history entry.' : 'Saved to price history if the price changes.' },
    { name: 'SHELF_LIFE', label: 'Shelf life', placeholder: 'e.g. 5 days, 3 days once opened' },
    { name: 'ACTIVE', label: 'Active (in use)', type: 'checkbox', wide: true },
    { name: 'ALLERGENS', label: 'Allergens', type: 'chips', options: ALLERGENS, wide: true },
  ];

  formDialog({
    title: isNew ? 'Add ingredient' : `Edit ${ing.NAME}`,
    fields,
    values: ing || { ACTIVE: true, 'YIELD_%': 100, PACK_UNIT: 'g' },
    submitLabel: isNew ? 'Add ingredient' : 'Save changes',
    extraHtml: `<p class="cost-preview" data-preview aria-live="polite"></p>${isNew ? '' : historyHtml(ing.ING_ID)}`,
    onChange: (d, dlg) => {
      const { size, unit } = normalisePack(d.PACK_SIZE, d.PACK_UNIT);
      const probe = { PACK_SIZE: size, PACK_PRICE: d.PACK_PRICE, 'YIELD_%': d['YIELD_%'] };
      const bought = unitCost(probe);
      const usable = usableUnitCost(probe);
      const el = dlg.querySelector('[data-preview]');
      if (bought == null) { el.textContent = 'Enter pack size and price to see unit cost.'; return; }
      el.innerHTML = usable != null && usable !== bought
        ? `<strong>${formatUnitCost(usable, unit)}</strong> usable · ${formatUnitCost(bought, unit)} as bought`
        : `<strong>${formatUnitCost(bought, unit)}</strong>`;
    },
    onSubmit: async d => {
      const clash = store.rows('INGREDIENTS').find(i => sameName(i.NAME, d.NAME) && i.ING_ID !== ing?.ING_ID);
      if (clash) throw new Error(`An ingredient called “${clash.NAME}” already exists (${clash.ING_ID}).`);

      const { size, unit } = normalisePack(d.PACK_SIZE, d.PACK_UNIT);
      if (!(size > 0)) throw new Error('Pack size must be greater than zero.');
      if (d.PACK_PRICE === '' || !(d.PACK_PRICE >= 0)) throw new Error('Enter the pack price.');
      const yieldPct = d['YIELD_%'] === '' ? 100 : d['YIELD_%'];
      if (!(yieldPct > 0 && yieldPct <= 100)) throw new Error('Yield must be between 1 and 100%.');

      const { INVOICE_REF: invoiceRef, ...rest } = d;
      const rec = { ...rest, PACK_SIZE: size, PACK_UNIT: unit, 'YIELD_%': yieldPct };

      let id;
      if (isNew) {
        id = await store.create('INGREDIENTS', rec);
      } else {
        id = ing.ING_ID;
        await store.update('INGREDIENTS', id, rec);
      }

      const priceChanged = isNew || ing.PACK_PRICE === '' || Number(ing.PACK_PRICE) !== rec.PACK_PRICE;
      if (priceChanged) {
        try {
          await store.logPrice(id, rec.PACK_PRICE, invoiceRef);
        } catch (err) {
          console.error(err);
          toast(`Saved ${rec.NAME}, but the price history entry failed: ${err.message}`, 'error');
        }
      }
      toast(isNew ? `Added ${rec.NAME}` : `Saved ${rec.NAME}`);
      if (root?.isConnected) renderList();
    },
  });
}
