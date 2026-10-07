// Wines: ingredients marked KIND = wine, shown on their own page with wine details. They share
// suppliers and price lists with ingredients, so a bottle can go straight into a by-the-glass recipe.

import * as store from '../store.js';
import { ALLERGENS, WINE_KIND, WINE_CATEGORY, WINE_STYLES } from '../config.js';
import { icons } from '../icons.js';
import { esc, money, formDialog, toast, reportError, parkToasts, byName, sameName, matches, option } from '../ui.js';
import {
  normalisePack, priceUnitCost, pricesFor, chosenPrice, ingredientUnit, usableUnitCost, formatUnitCost, packLabel,
  isWine, displayName,
} from '../costing.js';
import { openPriceForm, pricesSectionHtml, historyHtml, supplierName } from './prices.js';
import { parseWineList, wineKey } from '../wine-paste.js';
import { photoFor, savePhoto, fileToPhoto } from '../photos.js';

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
      <div class="head-actions">
        <button class="btn sm" data-bulk>Add many</button>
        <button class="btn primary add-desktop" data-add>${icons.plus} Add wine</button>
      </div>
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
  el.querySelector('[data-bulk]').addEventListener('click', openBulk);
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
    const photo = photoFor(w.ING_ID);
    return `
    <article class="card wine-card${w.ACTIVE ? '' : ' inactive'}">
      <button class="card-hit" data-id="${esc(w.ING_ID)}" aria-label="Edit ${esc(displayName(w))}"></button>
      <span class="wine-thumb">${photo ? `<img src="${photo}" alt="" loading="lazy">` : icons.glass}</span>
      <div class="wine-card-body">
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
      </div>
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

  // The photo is only written when the form is saved; `undefined` means it hasn't been touched.
  let newPhoto;
  const photoHtml = src => `
    <span class="wine-thumb lg">${src ? `<img src="${src}" alt="Photo of this wine">` : icons.glass}</span>
    <div class="photo-actions">
      <label class="btn sm"><input type="file" accept="image/*" data-photo-file hidden>${src ? 'Change photo' : 'Add photo'}</label>
      ${src ? '<button type="button" class="btn sm" data-photo-remove>Remove</button>' : ''}
      <small class="hint">Take one with the camera or pick one. It's saved as a small picture.</small>
    </div>`;
  const writePhoto = async (id, name) => {
    if (newPhoto === undefined) return;
    try {
      await savePhoto(id, newPhoto);
    } catch (err) {
      console.error(err);
      toast(`Saved ${name}, but its photo wasn't: ${err.message}`, 'error');
    }
  };

  const glassHtml = (perMl, from = '') => `<strong>${money(perMl * GLASS_ML)}</strong> per ${GLASS_ML} ml glass · ${formatUnitCost(perMl, 'ml')}${from}`;

  formDialog({
    title: isNew ? 'Add wine' : `Edit ${displayName(wine)}`,
    fields,
    values: wine || { ACTIVE: true, ALLERGENS: 'Sulphites', P_SIZE: 75, P_UNIT: 'cl' },
    submitLabel: isNew ? 'Add wine' : 'Save changes',
    extraHtml: `<section class="photo-field" data-photo>${photoHtml(isNew ? '' : photoFor(wine.ING_ID))}</section>
      <p class="cost-preview" data-preview aria-live="polite"></p>${
      isNew ? '' : `<section class="prices" data-prices>${pricesSectionHtml(wine)}</section>${historyHtml(wine.ING_ID)}`}`,
    onOpen: dlg => {
      const photoHost = dlg.querySelector('[data-photo]');
      photoHost.addEventListener('change', async e => {
        const file = e.target.matches('[data-photo-file]') && e.target.files[0];
        if (!file) return;
        try {
          newPhoto = await fileToPhoto(file);
          photoHost.innerHTML = photoHtml(newPhoto);
        } catch (err) {
          reportError(err);
        }
      });
      photoHost.addEventListener('click', e => {
        if (!e.target.closest('[data-photo-remove]')) return;
        newPhoto = '';
        photoHost.innerHTML = photoHtml('');
      });
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
      // The same wine can be listed in several vintages, and two producers can share a name
      // ("Morgon"); an ingredient of that name would be ambiguous in recipes.
      const clash = store.rows('INGREDIENTS').find(i => i.ING_ID !== wine?.ING_ID
        && (isWine(i) ? wineKey(i) === wineKey(d) : sameName(i.NAME, d.NAME)));
      if (clash) {
        throw new Error(isWine(clash)
          ? `${displayName(clash)} is already on the list (${clash.ING_ID}). Give this one a different vintage or producer.`
          : `An ingredient called “${clash.NAME}” already exists (${clash.ING_ID}).`);
      }

      const base = {
        NAME: d.NAME, PRODUCER: d.PRODUCER, VINTAGE: d.VINTAGE, STYLE: d.STYLE, REGION: d.REGION, GRAPE: d.GRAPE,
        ACTIVE: d.ACTIVE, ALLERGENS: d.ALLERGENS,
      };

      if (!isNew) {
        await store.update('INGREDIENTS', wine.ING_ID, { ...base, SUPPLIER_ID: d.SUPPLIER_ID });
        await writePhoto(wine.ING_ID, d.NAME);
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
      await writePhoto(id, d.NAME);
      toast(`Added ${d.NAME}`);
      if (root?.isConnected) render(root);
      onSaved?.(id);
    },
  });
}

// ============================================================ add many

let bulkDlg = null;
let bulk = []; // parsed lines plus { include, exists }

function ensureBulkDialog() {
  if (bulkDlg) return;
  bulkDlg = document.createElement('dialog');
  bulkDlg.className = 'modal paste-sheet bulk-sheet';
  bulkDlg.innerHTML = `
    <div class="modal-form">
      <header class="modal-head">
        <h2>Add many wines</h2>
        <button type="button" class="icon-btn" data-act="close" aria-label="Close">&times;</button>
      </header>
      <div class="modal-body">
        <p class="muted small">Paste your wine list from a spreadsheet, one wine per line: <i>Producer - Wine Vintage</i>, then optionally the style and the bottle price (ex VAT) in the next columns. Bottles are taken as 75 cl unless the line ends in a size (<i>3L</i>, <i>37.5cl</i>).</p>
        <textarea data-wb-text rows="7" placeholder="${esc('Marcel Lapierre - Morgon 2024\tRed\t£20.95\nBérèche & Fils - Réserve NV\tSparkling\t£37.45')}"></textarea>
        <label class="field"><span>Supplier for these prices</span>
          <select data-wb-sup></select>
          <small class="hint">Prices are saved on this supplier's price list. Without one, the wines are added with no price.</small>
        </label>
        <input type="text" data-pp-ref data-wb-ref placeholder="Invoice or price list ref (optional)" aria-label="Invoice or price list reference">
        <button type="button" class="btn block" data-act="parse">Read the list</button>
        <p class="small muted paste-summary" data-wb-summary></p>
        <div data-wb-rows></div>
      </div>
      <footer class="modal-foot">
        <button type="button" class="btn" data-act="close">Cancel</button>
        <button type="button" class="btn primary" data-act="save" disabled>Add wines</button>
      </footer>
    </div>`;
  document.body.append(bulkDlg);
  bulkDlg.addEventListener('close', parkToasts);
  bulkDlg.addEventListener('cancel', e => { if (!confirmBulkDiscard()) e.preventDefault(); });
  bulkDlg.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') { if (confirmBulkDiscard()) bulkDlg.close(); } else if (act === 'parse') readBulk();
    else if (act === 'save') saveBulk();
  });
  bulkDlg.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-wb-sup]')) { renderBulk(); return; }
    const row = t.closest('[data-b]');
    if (!row) return;
    const r = bulk[Number(row.dataset.b)];
    if (t.matches('[data-f=include]')) r.include = t.checked;
    if (t.matches('[data-f=style]')) r.style = t.value;
    renderBulk();
  });
}

function confirmBulkDiscard() {
  const dirty = bulk.some(r => r.include) || bulkDlg.querySelector('[data-wb-text]').value.trim();
  return !dirty || confirm('Discard this list without adding anything?');
}

function openBulk() {
  ensureBulkDialog();
  bulk = [];
  bulkDlg.querySelector('[data-wb-text]').value = '';
  bulkDlg.querySelector('[data-wb-ref]').value = '';
  bulkDlg.querySelector('[data-wb-sup]').innerHTML = `<option value="">No supplier (add prices later)</option>${
    store.rows('SUPPLIERS').slice().sort(byName).map(s => option(s.SUPPLIER_ID, s.NAME, '')).join('')}`;
  renderBulk();
  bulkDlg.showModal();
  parkToasts();
  bulkDlg.querySelector('[data-wb-text]').focus();
}

const bulkKey = r => wineKey({ NAME: r.name, VINTAGE: r.vintage, PRODUCER: r.producer });

/** Flag lines already on the wine list, repeated in the paste, or named like an ingredient. */
function markBulk() {
  const all = store.rows('INGREDIENTS');
  const taken = new Set(all.filter(isWine).map(wineKey));
  const ingredientNames = all.filter(i => !isWine(i)).map(i => i.NAME);
  const seen = new Set();
  for (const r of bulk) {
    const k = bulkKey(r);
    r.exists = taken.has(k) ? 'Already on your wine list'
      : seen.has(k) ? 'Repeated in this list'
        : ingredientNames.some(n => sameName(n, r.name)) ? 'An ingredient already has this name' : '';
    seen.add(k);
    if (r.exists) r.include = false;
  }
}

function readBulk() {
  const text = bulkDlg.querySelector('[data-wb-text]').value;
  if (!text.trim()) { toast('Paste a wine list first.', 'error'); return; }
  bulk = parseWineList(text).map(r => ({ ...r, include: true }));
  if (!bulk.length) toast('No wines found. Put one wine on each line.', 'error');
  markBulk();
  renderBulk();
}

function renderBulk() {
  const styles = [...new Set([...WINE_STYLES, ...bulk.map(r => r.style).filter(Boolean)])];
  bulkDlg.querySelector('[data-wb-rows]').innerHTML = bulk.map((r, i) => {
    const label = [r.name, r.vintage].filter(Boolean).join(' ');
    const sub = [r.producer, packLabel(r.size, 'ml'), r.price == null ? 'no price' : money(r.price)].filter(Boolean).map(esc).join(' · ');
    return `
      <div class="bulk-row wine-bulk-row${r.include ? '' : ' off'}" data-b="${i}">
        <input type="checkbox" data-f="include"${r.include ? ' checked' : ''}${r.exists ? ' disabled' : ''} aria-label="Add ${esc(label)}">
        <span class="bulk-name">
          <b>${esc(label)}</b>
          <small class="muted">${sub}</small>
          ${r.exists ? `<small class="warn">${esc(r.exists)}</small>` : ''}
        </span>
        <select data-f="style" aria-label="Style"><option value="">Style…</option>${styles.map(s => option(s, s, r.style)).join('')}</select>
      </div>`;
  }).join('');

  const chosen = bulk.filter(r => r.include);
  const priced = chosen.filter(r => r.price != null).length;
  const skipped = bulk.filter(r => r.exists).length;
  const hasSupplier = !!bulkDlg.querySelector('[data-wb-sup]').value;
  bulkDlg.querySelector('[data-wb-summary]').textContent = bulk.length
    ? `${bulk.length} wine${bulk.length === 1 ? '' : 's'} read · ${chosen.length} selected${skipped ? ` · ${skipped} skipped` : ''}${
      priced ? (hasSupplier ? ` · ${priced} with a price` : ` · choose a supplier to save the ${priced} price${priced === 1 ? '' : 's'}`) : ''}`
    : '';
  const btn = bulkDlg.querySelector('[data-act="save"]');
  btn.disabled = !chosen.length;
  btn.textContent = chosen.length ? `Add ${chosen.length} wine${chosen.length === 1 ? '' : 's'}` : 'Add wines';
}

async function saveBulk() {
  markBulk();
  const chosen = bulk.filter(r => r.include && !r.exists);
  if (!chosen.length) { renderBulk(); return; }
  const supplier = bulkDlg.querySelector('[data-wb-sup]').value;
  const priced = chosen.filter(r => r.price != null);
  if (priced.length && !supplier
    && !confirm(`No supplier chosen, so the ${priced.length} price${priced.length === 1 ? '' : 's'} in this list won't be saved. Add the wines without prices?`)) return;
  const ref = bulkDlg.querySelector('[data-wb-ref]').value.trim();
  const btn = bulkDlg.querySelector('[data-act="save"]');
  btn.disabled = true;
  btn.textContent = 'Adding…';
  try {
    const ids = await store.createMany('INGREDIENTS', chosen.map(r => ({
      NAME: r.name, PRODUCER: r.producer, VINTAGE: r.vintage, STYLE: r.style, KIND: WINE_KIND, CATEGORY: WINE_CATEGORY,
      UNIT: 'ml', 'YIELD_%': 100, STORAGE: 'Cellar', ALLERGENS: 'Sulphites', ACTIVE: true,
    })));
    // Saved wines mustn't be added again if the prices fail and Add is pressed a second time.
    chosen.forEach((r, i) => { r.id = ids[i]; r.include = false; });
    let saved = 0;
    if (supplier && priced.length) {
      const now = store.today();
      const priceIds = await store.createMany('SUPPLIER_PRICES', priced.map(r => ({
        SUPPLIER_ID: supplier, ING_ID: r.id, PRODUCT_NAME: r.raw.split('\t')[0].trim(), PACK_SIZE: r.size, PACK_UNIT: 'ml',
        PACK_PRICE: r.price, UPDATED: now,
      })));
      saved = priced.length;
      await store.logPrices(priced.map((r, i) => ({ ING_ID: r.id, SUPPLIER_ID: supplier, PRICE_ID: priceIds[i], PACK_PRICE: r.price, INVOICE_REF: ref })));
    }
    bulk = [];
    bulkDlg.querySelector('[data-wb-text]').value = '';
    bulkDlg.close();
    toast(`Added ${chosen.length} wine${chosen.length === 1 ? '' : 's'}${saved ? `, ${saved} with a price` : ''}`);
  } catch (err) {
    reportError(err);
    markBulk();
    renderBulk();
  } finally {
    if (root?.isConnected) render(root);
  }
}
