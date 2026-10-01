import * as store from '../store.js';
import { ORDER_DAYS } from '../config.js';
import { icons } from '../icons.js';
import { esc, money, formDialog, toast, byName, sameName, matches, splitList } from '../ui.js';

const state = { q: '' };
let root;

export function render(el) {
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
  el.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => openForm(null)));
  el.querySelector('[data-list]').addEventListener('click', e => {
    const hit = e.target.closest('.card-hit');
    if (hit) openForm(store.byId('SUPPLIERS', hit.dataset.id));
  });
  renderList();
}

function renderList() {
  const all = store.rows('SUPPLIERS');
  const ingCount = {};
  for (const i of store.rows('INGREDIENTS')) {
    if (i.ACTIVE && i.SUPPLIER_ID) ingCount[i.SUPPLIER_ID] = (ingCount[i.SUPPLIER_ID] || 0) + 1;
  }
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
    const days = splitList(s.ORDER_DAYS).map(d => d.slice(0, 3).toLowerCase());
    const count = ingCount[s.SUPPLIER_ID] || 0;
    const lead = s.LEAD_TIME === '' ? '' : `${s.LEAD_TIME} day${s.LEAD_TIME === 1 ? '' : 's'}`;
    return `
    <article class="card">
      <button class="card-hit" data-id="${esc(s.SUPPLIER_ID)}" aria-label="Edit ${esc(s.NAME)}"></button>
      <div class="card-top">
        <div>
          <div class="card-name">${esc(s.NAME)}</div>
          <div class="card-sub">${esc(s.CONTACT) || 'No contact name'}</div>
        </div>
        <div class="card-figure"><strong>${count}</strong><span>ingredient${count === 1 ? '' : 's'}</span></div>
      </div>
      <div class="days" aria-label="Order days: ${esc(splitList(s.ORDER_DAYS).join(', ') || 'none set')}">${
        ORDER_DAYS.map(d => `<span class="day${days.includes(d.toLowerCase()) ? ' on' : ''}" aria-hidden="true">${d}</span>`).join('')}</div>
      ${lead || s.MIN_ORDER !== '' ? `<div class="card-meta">
        ${lead ? `<span>${icons.clock}Lead time <b>${esc(lead)}</b></span>` : ''}
        ${s.MIN_ORDER !== '' ? `<span>Min order <b>${money(s.MIN_ORDER)}</b></span>` : ''}
      </div>` : ''}
      ${s.PHONE || s.EMAIL ? `<div class="card-actions">
        ${s.PHONE ? `<a class="btn" href="tel:${esc(String(s.PHONE).replace(/\s/g, ''))}">${icons.phone} Call</a>` : ''}
        ${s.EMAIL ? `<a class="btn" href="mailto:${esc(s.EMAIL)}">${icons.mail} Email</a>` : ''}
      </div>` : ''}
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
      if (root?.isConnected) renderList();
      onSaved?.(id);
    },
  });
}
