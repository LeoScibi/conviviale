import * as store from '../store.js';
import { ORDER_DAYS } from '../config.js';
import { icons } from '../icons.js';
import { esc, money, formDialog, toast, reportError, byName, sameName, matches, splitList, parkToasts } from '../ui.js';
import { PACK_UNIT_OPTIONS, normalisePack, ingredientUnit, priceUnitCost, formatUnitCost } from '../costing.js';
import { matchIngredient, normName } from '../recipe-paste.js';
import { parsePriceList } from '../pricelist-paste.js';
import { openPriceForm, priceRowHtml } from './prices.js';

const state = { q: '' };
let root;

export function render(el, param) {
  root = el;
  el.innerHTML = `
    <div class="page-head">
      <div>
        <p class="overline" data-count></p>
        <h1 class="title">Suppliers</h1>
      </div>
      <button class="btn primary add-desktop" data-add>${icons.plus} Add supplier</button>
    </div>
    <div class="toolbar">
      <label class="search-wrap">${icons.search}
        <input type="search" class="search" data-q value="${esc(state.q)}"
          placeholder="Search suppliers" aria-label="Search suppliers">
      </label>
    </div>
    <div data-list></div>
    <button class="fab" data-add aria-label="Add supplier">${icons.plus}</button>`;

  el.querySelector('[data-q]').addEventListener('input', e => { state.q = e.target.value; renderList(); });
  el.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => openForm(null, {
    onSaved: id => { location.hash = `#/suppliers/${encodeURIComponent(id)}`; },
  })));
  el.querySelector('[data-list]').addEventListener('click', e => {
    if (e.target.closest('a')) return;
    const hit = e.target.closest('.card-hit');
    if (hit) location.hash = `#/suppliers/${encodeURIComponent(hit.dataset.id)}`;
  });
  renderList();

  if (param) openDetail(param);
  else closeDetail();
}

const itemCounts = () => {
  const counts = {};
  for (const p of store.rows('SUPPLIER_PRICES')) counts[p.SUPPLIER_ID] = (counts[p.SUPPLIER_ID] || 0) + 1;
  return counts;
};

function daysHtml(s) {
  const days = splitList(s.ORDER_DAYS).map(d => d.slice(0, 3).toLowerCase());
  return `<div class="days" aria-label="Order days: ${esc(splitList(s.ORDER_DAYS).join(', ') || 'none set')}">${
    ORDER_DAYS.map(d => `<span class="day${days.includes(d.toLowerCase()) ? ' on' : ''}" aria-hidden="true">${d}</span>`).join('')}</div>`;
}

function metaHtml(s) {
  const lead = s.LEAD_TIME === '' ? '' : `${s.LEAD_TIME} day${s.LEAD_TIME === 1 ? '' : 's'}`;
  return lead || s.MIN_ORDER !== '' ? `<div class="card-meta">
    ${lead ? `<span>${icons.clock}Lead time <b>${esc(lead)}</b></span>` : ''}
    ${s.MIN_ORDER !== '' ? `<span>Min order <b>${money(s.MIN_ORDER)}</b></span>` : ''}
  </div>` : '';
}

function contactHtml(s) {
  return s.PHONE || s.EMAIL ? `<div class="card-actions">
    ${s.PHONE ? `<a class="btn" href="tel:${esc(String(s.PHONE).replace(/\s/g, ''))}">${icons.phone} Call</a>` : ''}
    ${s.EMAIL ? `<a class="btn" href="mailto:${esc(s.EMAIL)}">${icons.mail} Email</a>` : ''}
  </div>` : '';
}

function renderList() {
  if (!root?.isConnected) return;
  const all = store.rows('SUPPLIERS');
  const counts = itemCounts();
  const list = all
    .filter(s => matches(state.q, s.NAME, s.CONTACT, s.EMAIL, s.PHONE, s.SUPPLIER_ID))
    .sort(byName);

  root.querySelector('[data-count]').textContent =
    list.length === all.length ? `${all.length} on file` : `${list.length} of ${all.length}`;

  if (!list.length) {
    root.querySelector('[data-list]').innerHTML = `<div class="empty">${
      all.length ? 'No suppliers match your search.' : 'No suppliers yet. Add your first one to get started.'}</div>`;
    return;
  }

  root.querySelector('[data-list]').innerHTML = `<div class="cards">${list.map(s => {
    const count = counts[s.SUPPLIER_ID] || 0;
    return `
    <article class="card">
      <button class="card-hit" data-id="${esc(s.SUPPLIER_ID)}" aria-label="Open ${esc(s.NAME)}"></button>
      <div class="card-top">
        <div>
          <div class="card-name">${esc(s.NAME)}</div>
          <div class="card-sub">${esc(s.CONTACT) || 'No contact name'}</div>
        </div>
        <div class="card-figure"><strong>${count}</strong><span>price${count === 1 ? '' : 's'} listed</span></div>
      </div>
      ${daysHtml(s)}
      ${metaHtml(s)}
      ${contactHtml(s)}
    </article>`;
  }).join('')}</div>`;
}

const FIELDS = [
  { name: 'NAME', label: 'Supplier name', required: true, wide: true },
  { name: 'CONTACT', label: 'Contact person' },
  { name: 'PHONE', label: 'Phone', type: 'tel', autocomplete: 'off' },
  { name: 'EMAIL', label: 'Email', type: 'email', wide: true, autocomplete: 'off' },
  { name: 'ORDER_DAYS', label: 'Order days', type: 'chips', options: ORDER_DAYS, wide: true },
  { name: 'LEAD_TIME', label: 'Lead time (days)', type: 'number', min: 0, step: 1, inputmode: 'numeric', half: true },
  { name: 'MIN_ORDER', label: 'Minimum order (£)', type: 'number', min: 0, step: 0.01, inputmode: 'decimal', half: true },
];

export function openForm(sup, { onSaved } = {}) {
  const isNew = !sup;
  formDialog({
    title: isNew ? 'Add supplier' : `Edit ${sup.NAME}`,
    fields: FIELDS,
    values: sup || {},
    submitLabel: isNew ? 'Add supplier' : 'Save changes',
    onSubmit: async data => {
      const clash = store.rows('SUPPLIERS').find(s => sameName(s.NAME, data.NAME) && s.SUPPLIER_ID !== sup?.SUPPLIER_ID);
      if (clash) throw new Error(`A supplier called “${clash.NAME}” already exists (${clash.SUPPLIER_ID}).`);
      let id;
      if (isNew) {
        id = await store.create('SUPPLIERS', data);
      } else {
        id = sup.SUPPLIER_ID;
        await store.update('SUPPLIERS', id, data);
      }
      toast(isNew ? `Added ${data.NAME}` : `Saved ${data.NAME}`);
      renderList();
      onSaved?.(id);
    },
  });
}

// ============================================================ supplier page (price list)

const ds = { id: null, q: '' };
let dlg = null;

function ensureDialog() {
  if (dlg) return;
  dlg = document.createElement('dialog');
  dlg.className = 'modal recipe-sheet supplier-sheet';
  dlg.innerHTML = `
    <div class="modal-form">
      <header class="modal-head">
        <div class="head-text">
          <p class="overline" data-d-overline></p>
          <h2 data-d-title></h2>
        </div>
        <button type="button" class="icon-btn" data-act="close" aria-label="Close">&times;</button>
      </header>
      <div class="modal-body" data-d-body></div>
      <footer class="modal-foot">
        <button type="button" class="btn" data-act="paste">Paste price list</button>
        <button type="button" class="btn" data-act="edit">Edit details</button>
        <button type="button" class="btn primary" data-act="add">${icons.plus} Add item</button>
      </footer>
    </div>`;
  document.body.append(dlg);
  dlg.addEventListener('close', () => {
    parkToasts();
    ds.id = null;
    if (/^#\/suppliers\/./.test(location.hash)) location.hash = '#/suppliers';
  });
  dlg.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const row = e.target.closest('[data-price-id]');
    if (row) {
      openPriceForm({ price: store.byId('SUPPLIER_PRICES', row.dataset.priceId), onSaved: refresh, onDeleted: refresh });
      return;
    }
    if (act === 'close') dlg.close();
    else if (act === 'edit') openForm(store.byId('SUPPLIERS', ds.id), { onSaved: refresh });
    else if (act === 'add') openPriceForm({ supplierId: ds.id, onSaved: refresh });
    else if (act === 'paste') openPaste(ds.id);
  });
  dlg.addEventListener('input', e => {
    if (e.target.matches('[data-pl-q]')) { ds.q = e.target.value; renderPriceRows(); }
  });
}

function refresh() {
  renderDetail();
  renderList();
}

function openDetail(id) {
  if (!store.byId('SUPPLIERS', id)) {
    toast('That supplier no longer exists.', 'error');
    location.hash = '#/suppliers';
    return;
  }
  ensureDialog();
  if (ds.id !== id) Object.assign(ds, { id, q: '' });
  if (!dlg.open) dlg.showModal();
  parkToasts();
  renderDetail();
}

function closeDetail() {
  if (dlg?.open) dlg.close();
}

const supplierPrices = id => store.rows('SUPPLIER_PRICES').filter(p => String(p.SUPPLIER_ID) === String(id));

function renderDetail() {
  if (!dlg || !ds.id) return;
  const s = store.byId('SUPPLIERS', ds.id);
  if (!s) { closeDetail(); return; }
  const n = supplierPrices(ds.id).length;
  dlg.querySelector('[data-d-overline]').textContent = `Supplier · ${n} price${n === 1 ? '' : 's'} listed`;
  dlg.querySelector('[data-d-title]').textContent = s.NAME;
  dlg.querySelector('[data-d-body]').innerHTML = `
    <section class="supplier-info">
      ${s.CONTACT ? `<p class="small muted">Contact: <b>${esc(s.CONTACT)}</b></p>` : ''}
      ${daysHtml(s)}
      ${metaHtml(s)}
      ${contactHtml(s)}
    </section>
    <section class="detail-block">
      <div class="section-head"><h3 class="section-title">Price list</h3><span class="muted small" data-pl-count></span></div>
      ${n > 5 ? `<label class="search-wrap pl-search">${icons.search}
        <input type="search" class="search" data-pl-q value="${esc(ds.q)}" placeholder="Search this price list" aria-label="Search this price list">
      </label>` : ''}
      <div class="price-rows" data-pl-rows></div>
    </section>`;
  renderPriceRows();
}

function renderPriceRows() {
  const host = dlg.querySelector('[data-pl-rows]');
  const ingName = p => store.byId('INGREDIENTS', p.ING_ID)?.NAME ?? `${p.ING_ID} (deleted)`;
  const all = supplierPrices(ds.id);
  const rows = all
    .filter(p => matches(ds.q, ingName(p), p.SUPPLIER_CODE, p.PRODUCT_NAME))
    .sort((a, b) => ingName(a).localeCompare(ingName(b)));
  dlg.querySelector('[data-pl-count]').textContent = rows.length === all.length ? '' : `${rows.length} of ${all.length}`;
  host.innerHTML = rows.length
    ? rows.map(p => priceRowHtml(p, ingName(p))).join('')
    : `<p class="muted small">${all.length ? 'Nothing matches.' : 'Nothing listed yet. Add items one by one, or paste their price list.'}</p>`;
}

// ============================================================ paste a price list

let pasteDlg = null;
let pasteSupplier = null;
let rows = [];

function ensurePasteDialog() {
  if (pasteDlg) return;
  pasteDlg = document.createElement('dialog');
  pasteDlg.className = 'modal paste-sheet';
  pasteDlg.innerHTML = `
    <div class="modal-form">
      <header class="modal-head">
        <h2 data-pp-title>Paste a price list</h2>
        <button type="button" class="icon-btn" data-act="close" aria-label="Close">&times;</button>
      </header>
      <div class="modal-body">
        <p class="muted small">Copy rows from their spreadsheet, email or PDF and paste them here, one product per line, e.g. <i>BUR125 Burrata 8 x 125g £18.00</i>. Items already on this list (same code or ingredient and pack) get their price updated; others are added, and anything not found becomes a new ingredient.</p>
        <textarea data-pp-text rows="7" placeholder="${esc('BUR125\tBurrata\t8 x 125g\t£18.00\nMON75 Montepulciano d’Abruzzo 75cl 8.40')}"></textarea>
        <input type="text" data-pp-ref placeholder="Invoice or price list ref (optional)" aria-label="Invoice or price list reference">
        <button type="button" class="btn block" data-act="parse">Read the list</button>
        <p class="small muted paste-summary" data-pp-summary></p>
        <div class="paste-rows" data-pp-rows></div>
        <datalist id="pp-ingredients"></datalist>
      </div>
      <footer class="modal-foot">
        <button type="button" class="btn" data-act="close">Cancel</button>
        <button type="button" class="btn primary" data-act="save" disabled>Save prices</button>
      </footer>
    </div>`;
  document.body.append(pasteDlg);
  pasteDlg.addEventListener('close', parkToasts);
  pasteDlg.addEventListener('cancel', e => { if (!confirmDiscard()) e.preventDefault(); });
  pasteDlg.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') { if (confirmDiscard()) pasteDlg.close(); } else if (act === 'parse') readList();
    else if (act === 'save') savePasted();
  });
  pasteDlg.addEventListener('input', onRowEdit);
  pasteDlg.addEventListener('change', onRowEdit);
}

function confirmDiscard() {
  const dirty = rows.length || pasteDlg.querySelector('[data-pp-text]').value.trim();
  return !dirty || confirm('Discard this pasted price list?');
}

function openPaste(supplierId) {
  ensurePasteDialog();
  pasteSupplier = supplierId;
  rows = [];
  pasteDlg.querySelector('[data-pp-title]').textContent = `Paste ${store.byId('SUPPLIERS', supplierId)?.NAME ?? ''} prices`;
  pasteDlg.querySelector('[data-pp-text]').value = '';
  pasteDlg.querySelector('[data-pp-ref]').value = '';
  pasteDlg.querySelector('#pp-ingredients').innerHTML =
    store.rows('INGREDIENTS').filter(i => i.ACTIVE).map(i => `<option value="${esc(i.NAME)}">`).join('');
  renderRows();
  pasteDlg.showModal();
  parkToasts();
  pasteDlg.querySelector('[data-pp-text]').focus();
}

/** Work out what saving a row would do: update an existing list entry, add one, or create the ingredient too. */
function resolve(r) {
  const own = supplierPrices(pasteSupplier);
  const ing = r.ingId ? store.byId('INGREDIENTS', r.ingId) : null;
  r.existing = (r.code && own.find(p => String(p.SUPPLIER_CODE).toLowerCase() === r.code.toLowerCase()))
    || (ing && own.find(p => String(p.ING_ID) === String(ing.ING_ID) && (r.size === '' || Number(p.PACK_SIZE) === Number(r.size))))
    || null;
  if (r.existing && !r.ingId) r.ingId = r.existing.ING_ID;
  if (r.existing && r.size === '') { r.size = r.existing.PACK_SIZE; r.unit = r.existing.PACK_UNIT; }
  const target = r.ingId ? store.byId('INGREDIENTS', r.ingId) : null;
  const measured = target ? ingredientUnit(target) : '';
  r.note = '';
  if (r.price == null) r.note = 'No price found on this line.';
  else if (!(Number(r.size) > 0)) r.note = 'No pack size found. Enter one.';
  else if (measured && measured !== r.unit) r.note = `${target.NAME} is measured in ${measured}; this pack is in ${r.unit}.`;
}

function readList() {
  const text = pasteDlg.querySelector('[data-pp-text]').value;
  if (!text.trim()) { toast('Paste a price list first.', 'error'); return; }
  const active = store.rows('INGREDIENTS').filter(i => i.ACTIVE);
  const own = supplierPrices(pasteSupplier);
  rows = parsePriceList(text).map(p => {
    // Their own description on an existing entry is the strongest match, then our ingredient names.
    const byDesc = own.find(x => x.PRODUCT_NAME && normName(x.PRODUCT_NAME) === normName(p.name));
    const match = byDesc ? store.byId('INGREDIENTS', byDesc.ING_ID) : matchIngredient(p.name, active);
    const r = {
      raw: p.raw, code: p.code, desc: p.name, name: match?.NAME ?? p.name, ingId: match?.ING_ID ?? null,
      size: p.pack?.size ?? '', unit: p.pack?.unit ?? (match ? ingredientUnit(match) || 'g' : 'g'),
      price: p.price, include: p.price != null,
    };
    resolve(r);
    // Lines that can't be saved as they stand (notes, delivery charges…) start unticked.
    if (r.note) r.include = false;
    return r;
  });
  if (!rows.length) toast('No products found. Each line needs a name and a price.', 'error');
  renderRows();
}

function rowStatus(r) {
  if (r.existing) {
    const was = Number(r.existing.PACK_PRICE);
    if (r.price != null && was !== r.price) return `<small class="match-ok">Updates ${money(was)} → ${money(r.price)}</small>`;
    return '<small class="match-ok">Already listed, price unchanged</small>';
  }
  if (r.ingId) return '<small class="match-ok">✓ Adds to this price list</small>';
  return '<small class="match-new">+ New ingredient</small>';
}

function rowHtml(r, i) {
  const c = priceUnitCost({ PACK_SIZE: r.size, PACK_UNIT: r.unit, PACK_PRICE: r.price ?? '' });
  return `
    <div class="paste-row${r.include ? '' : ' off'}" data-i="${i}">
      <label class="paste-include"><input type="checkbox" data-f="include"${r.include ? ' checked' : ''}><span>${esc(r.raw)}</span></label>
      ${r.note ? `<p class="hint warn">${esc(r.note)}</p>` : ''}
      <input type="text" data-f="name" list="pp-ingredients" value="${esc(r.name)}" aria-label="Ingredient">
      ${rowStatus(r)}${r.code ? ` <small class="muted">· code ${esc(r.code)}</small>` : ''}
      <div class="pack-row">
        <input type="number" inputmode="decimal" min="0" step="any" data-f="size" value="${esc(r.size)}" placeholder="Pack" aria-label="Pack size">
        <select data-f="unit" aria-label="Unit">${PACK_UNIT_OPTIONS.filter(([u]) => ['g', 'ml', 'each'].includes(u))
          .map(([u]) => `<option value="${u}"${u === r.unit ? ' selected' : ''}>${u}</option>`).join('')}</select>
        <input type="number" inputmode="decimal" min="0" step="0.01" data-f="price" value="${r.price ?? ''}" placeholder="£" aria-label="Pack price">
        <span class="paste-cost">${c == null ? '' : formatUnitCost(c, r.unit)}</span>
      </div>
    </div>`;
}

function renderRows() {
  pasteDlg.querySelector('[data-pp-rows]').innerHTML = rows.map(rowHtml).join('');
  const chosen = rows.filter(r => r.include);
  const updates = chosen.filter(r => r.existing).length;
  const fresh = new Set(chosen.filter(r => !r.ingId).map(r => normName(r.name))).size;
  pasteDlg.querySelector('[data-pp-summary]').textContent = rows.length
    ? `${rows.length} product${rows.length === 1 ? '' : 's'} read · ${chosen.length} selected · ${updates} update${updates === 1 ? '' : 's'}, ${chosen.length - updates} new${fresh ? ` (${fresh} new ingredient${fresh === 1 ? '' : 's'})` : ''}`
    : '';
  const btn = pasteDlg.querySelector('[data-act="save"]');
  btn.disabled = !chosen.length;
  btn.textContent = chosen.length ? `Save ${chosen.length} price${chosen.length === 1 ? '' : 's'}` : 'Save prices';
}

function onRowEdit(e) {
  const el = e.target.closest('[data-f]');
  const rowEl = e.target.closest('.paste-row');
  if (!el || !rowEl) return;
  const r = rows[Number(rowEl.dataset.i)];
  const f = el.dataset.f;
  // Let typing finish before re-rendering the row (which would move the caret).
  if (e.type === 'input' && f !== 'include') {
    if (f === 'size') r.size = el.value === '' ? '' : Number(el.value);
    if (f === 'price') r.price = el.value === '' ? null : Number(el.value);
    return;
  }
  if (f === 'include') r.include = el.checked;
  if (f === 'unit') r.unit = el.value;
  if (f === 'name') {
    const typed = el.value.trim();
    const exact = store.rows('INGREDIENTS').find(i => normName(i.NAME) === normName(typed));
    r.ingId = exact?.ING_ID ?? null;
    r.name = exact?.NAME ?? typed;
    if (exact && ingredientUnit(exact)) r.unit = ingredientUnit(exact);
  }
  r.existing = null;
  resolve(r);
  renderRows();
}

async function savePasted() {
  const chosen = rows.filter(r => r.include);
  rows.forEach(resolve);
  const bad = chosen.filter(r => r.note);
  if (bad.length) { toast(`Fix or untick ${bad.length} line${bad.length === 1 ? '' : 's'} first: ${bad[0].note}`, 'error'); renderRows(); return; }
  const ref = pasteDlg.querySelector('[data-pp-ref]').value.trim();
  const btn = pasteDlg.querySelector('[data-act="save"]');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    // 1. Ingredients that don't exist yet (once per name).
    const fresh = new Map();
    for (const r of chosen.filter(x => !x.ingId)) {
      const key = normName(r.name);
      if (!fresh.has(key)) fresh.set(key, { NAME: r.name.charAt(0).toUpperCase() + r.name.slice(1), UNIT: r.unit, 'YIELD_%': 100, ACTIVE: true });
    }
    if (fresh.size) {
      const ids = await store.createMany('INGREDIENTS', [...fresh.values()]);
      [...fresh.keys()].forEach((k, i) => { fresh.get(k).id = ids[i]; });
    }
    const ingOf = r => r.ingId || fresh.get(normName(r.name)).id;
    const now = store.today();

    // 2. Updates to entries already on the list.
    const updates = chosen.filter(r => r.existing);
    const changed = updates.filter(r => Number(r.existing.PACK_PRICE) !== r.price);
    if (updates.length) {
      await store.updateMany('SUPPLIER_PRICES', updates.map(r => ({
        id: r.existing.PRICE_ID,
        record: {
          ING_ID: ingOf(r), PACK_SIZE: r.size, PACK_UNIT: r.unit, PACK_PRICE: r.price,
          ...(r.code ? { SUPPLIER_CODE: r.code } : {}), ...(r.desc ? { PRODUCT_NAME: r.desc } : {}),
          ...(Number(r.existing.PACK_PRICE) !== r.price ? { UPDATED: now } : {}),
        },
      })));
    }

    // 3. New entries.
    const adds = chosen.filter(r => !r.existing);
    const newIds = adds.length ? await store.createMany('SUPPLIER_PRICES', adds.map(r => ({
      SUPPLIER_ID: pasteSupplier, ING_ID: ingOf(r), SUPPLIER_CODE: r.code, PRODUCT_NAME: r.desc,
      PACK_SIZE: r.size, PACK_UNIT: r.unit, PACK_PRICE: r.price, UPDATED: now,
    }))) : [];

    // 4. Price history for every new or changed price.
    await store.logPrices([
      ...changed.map(r => ({ ING_ID: ingOf(r), SUPPLIER_ID: pasteSupplier, PRICE_ID: r.existing.PRICE_ID, PACK_PRICE: r.price, INVOICE_REF: ref })),
      ...adds.map((r, i) => ({ ING_ID: ingOf(r), SUPPLIER_ID: pasteSupplier, PRICE_ID: newIds[i], PACK_PRICE: r.price, INVOICE_REF: ref })),
    ]);

    rows = [];
    pasteDlg.close();
    toast(`Saved: ${changed.length} price${changed.length === 1 ? '' : 's'} changed, ${adds.length} added${fresh.size ? `, ${fresh.size} new ingredient${fresh.size === 1 ? '' : 's'}` : ''}`);
    refresh();
  } catch (err) {
    reportError(err);
    renderRows();
  }
}
