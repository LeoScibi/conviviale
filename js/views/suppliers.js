import * as store from '../store.js';
import { ORDER_DAYS } from '../config.js';
import { esc, money, formDialog, toast, byName, sameName, matches, splitList } from '../ui.js';

const state = { q: '' };
let root;

export function render(el) {
  root = el;
  el.innerHTML = `
    <div class="page-head">
      <h1>Suppliers</h1>
      <button class="btn primary" data-add>+ Add supplier</button>
    </div>
    <div class="toolbar">
      <input type="search" class="search" data-q value="${esc(state.q)}"
        placeholder="Search name, contact, email, phone…" aria-label="Search suppliers">
    </div>
    <p class="count" data-count></p>
    <div data-list></div>`;

  el.querySelector('[data-q]').addEventListener('input', e => { state.q = e.target.value; renderList(); });
  el.querySelector('[data-add]').addEventListener('click', () => openForm(null));
  el.querySelector('[data-list]').addEventListener('click', e => {
    if (e.target.closest('a')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) openForm(store.byId('SUPPLIERS', tr.dataset.id));
  });
  el.querySelector('[data-list]').addEventListener('keydown', e => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && e.key === 'Enter') openForm(store.byId('SUPPLIERS', tr.dataset.id));
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
    list.length === all.length ? `${all.length} suppliers` : `${list.length} of ${all.length} suppliers`;

  if (!list.length) {
    root.querySelector('[data-list]').innerHTML = `<div class="empty">${
      all.length ? 'No suppliers match your search.' : 'No suppliers yet. Add your first one to get started.'}</div>`;
    return;
  }

  root.querySelector('[data-list]').innerHTML = `
    <table class="data">
      <thead><tr>
        <th>Name</th><th>Contact</th><th>Phone</th><th>Email</th>
        <th>Order days</th><th class="num">Lead time</th><th class="num">Min order</th><th class="num">Ingredients</th>
      </tr></thead>
      <tbody>${list.map(s => `
        <tr data-id="${esc(s.SUPPLIER_ID)}" tabindex="0">
          <td data-label="Name"><strong>${esc(s.NAME)}</strong></td>
          <td data-label="Contact">${esc(s.CONTACT) || '—'}</td>
          <td data-label="Phone">${s.PHONE ? `<a href="tel:${esc(String(s.PHONE).replace(/\s/g, ''))}">${esc(s.PHONE)}</a>` : '—'}</td>
          <td data-label="Email">${s.EMAIL ? `<a href="mailto:${esc(s.EMAIL)}">${esc(s.EMAIL)}</a>` : '—'}</td>
          <td data-label="Order days">${esc(splitList(s.ORDER_DAYS).join(' · ')) || '—'}</td>
          <td data-label="Lead time" class="num">${s.LEAD_TIME === '' ? '—' : `${esc(s.LEAD_TIME)} d`}</td>
          <td data-label="Min order" class="num">${money(s.MIN_ORDER)}</td>
          <td data-label="Ingredients" class="num">${ingCount[s.SUPPLIER_ID] || 0}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

const FIELDS = [
  { name: 'NAME', label: 'Supplier name', required: true, wide: true },
  { name: 'CONTACT', label: 'Contact person' },
  { name: 'PHONE', label: 'Phone', type: 'tel', autocomplete: 'off' },
  { name: 'EMAIL', label: 'Email', type: 'email', wide: true, autocomplete: 'off' },
  { name: 'ORDER_DAYS', label: 'Order days', type: 'chips', options: ORDER_DAYS, wide: true },
  { name: 'LEAD_TIME', label: 'Lead time (days)', type: 'number', min: 0, step: 1, inputmode: 'numeric' },
  { name: 'MIN_ORDER', label: 'Minimum order (£)', type: 'number', min: 0, step: 0.01, inputmode: 'decimal' },
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
