// Recipes: list, recipe builder (lines, sub-recipes, scaling, GP vs target, allergen
// roll-up) and the paste-a-recipe importer. Modelled on Carisma Ops' recipe modal, but every
// cost is computed live from raw inputs, so nothing ever needs "refreshing".

import * as store from '../store.js';
import '../item-search.js';
import { RECIPE_TYPES, RECIPE_DEFAULTS } from '../config.js';
import { icons, allergenIcon } from '../icons.js';
import { sortable } from '../sortable.js';
import { parseSteps, joinSteps } from '../method.js';
import { esc, money, formDialog, toast, reportError, byName, sameName, matches, parkToasts } from '../ui.js';
import {
  formatUnitCost, usableUnitCost, chosenPrice, displayName, packsFor, packValue, packOptionLabel, lineUnitFields, linePack, packNamed,
  packLabel, plural, isPackValue, PACK_WORDS,
} from '../costing.js';
import { createCoster, ingredientFamily, isSub } from '../recipe-cost.js';
import { BASE, unitsFor, unitLabel, fmtQty, normUnit, familyOf, toBase } from '../units.js';
import { parseRecipeText, normName } from '../recipe-paste.js';
import * as ingredientsView from './ingredients.js';

const TYPE_LABEL = Object.fromEntries(RECIPE_TYPES);
const typeOf = rec => String(rec?.TYPE || 'dish').toLowerCase();
const ALL_UNITS = ['g', 'kg', 'ml', 'cl', 'L', 'tsp', 'tbsp', 'each'];

const state = { q: '', type: '', belowTarget: false };
let root;

// ============================================================ list

export function render(el, param) {
  root = el;
  el.innerHTML = `
    <div class="page-head">
      <div>
        <p class="overline" data-count></p>
        <h1 class="title">Recipes</h1>
      </div>
      <button class="btn primary add-desktop" data-add>${icons.plus} New recipe</button>
    </div>
    <div class="toolbar">
      <label class="search-wrap">${icons.search}
        <input type="search" class="search" data-q value="${esc(state.q)}" placeholder="Search recipes" aria-label="Search recipes">
      </label>
      <div class="filters" role="radiogroup" aria-label="Recipe type">
        ${[['', 'All'], ['dish', 'Dishes'], ['drink', 'Drinks'], ['sub', 'Sub-recipes']].map(([v, label]) => `
          <label class="toggle-chip"><input type="radio" name="rtype" value="${v}"${state.type === v ? ' checked' : ''}> ${label}</label>`).join('')}
        <label class="toggle-chip"><input type="checkbox" data-below${state.belowTarget ? ' checked' : ''}> Below GP target</label>
      </div>
    </div>
    <div data-list></div>
    <button class="fab" data-add aria-label="New recipe">${icons.plus}</button>`;

  el.querySelector('[data-q]').addEventListener('input', e => { state.q = e.target.value; renderList(); });
  el.querySelectorAll('input[name=rtype]').forEach(r => r.addEventListener('change', e => { state.type = e.target.value; renderList(); }));
  el.querySelector('[data-below]').addEventListener('change', e => { state.belowTarget = e.target.checked; renderList(); });
  el.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => openRecipeForm(null)));
  el.querySelector('[data-list]').addEventListener('click', e => {
    const hit = e.target.closest('.card-hit');
    if (hit) location.hash = `#/recipes/${encodeURIComponent(hit.dataset.id)}`;
  });
  renderList();

  if (param) openDetail(param);
  else closeDetail();
}

function describeYield(rec) {
  const parts = [];
  if (rec.YIELD_QTY !== '' && rec.YIELD_UNIT) parts.push(`makes ${fmtQty(rec.YIELD_QTY)} ${normUnit(rec.YIELD_UNIT)}`);
  if (Number(rec.PORTIONS) > 0) parts.push(`${fmtQty(rec.PORTIONS)} portion${Number(rec.PORTIONS) === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function gpChip(c) {
  if (c.gpPct == null) return '';
  return `<span class="gp-chip ${c.onTarget ? 'ok' : 'low'}">GP ${c.gpPct.toFixed(0)}%<small> / ${fmtQty(c.target)}%</small></span>`;
}

/** Headline figure: cost per kg/L for a sub-recipe with a yield, otherwise per portion. */
function headline(c) {
  if (isSub(c.rec) && c.perBase != null) return [formatUnitCost(c.perBase, BASE[c.family]), 'cost'];
  return [money(c.perPortion), 'per portion'];
}

function renderList() {
  if (!root?.isConnected) return;
  const coster = createCoster();
  const all = store.rows('RECIPES');
  const list = all
    .filter(r => !state.type || typeOf(r) === state.type)
    .filter(r => matches(state.q, r.NAME, TYPE_LABEL[typeOf(r)] ?? '', r.RECIPE_ID))
    .map(r => ({ r, c: coster.cost(r.RECIPE_ID) }))
    .filter(x => !state.belowTarget || x.c.onTarget === false)
    .sort((a, b) => byName(a.r, b.r));

  root.querySelector('[data-count]').textContent =
    list.length === all.length ? `${all.length} on file` : `${list.length} of ${all.length}`;

  const listEl = root.querySelector('[data-list]');
  if (!list.length) {
    listEl.innerHTML = `<div class="empty">${all.length ? 'No recipes match these filters.' : 'No recipes yet. Create your first one to get started.'}</div>`;
    return;
  }

  listEl.innerHTML = `<div class="cards">${list.map(({ r, c }) => {
    const [fig, figLabel] = headline(c);
    const sub = isSub(r);
    const lineCount = c.lines.length;
    return `
    <article class="card">
      <button class="card-hit" data-id="${esc(r.RECIPE_ID)}" aria-label="Open ${esc(r.NAME)}"></button>
      <div class="card-top">
        <div>
          <div class="card-name">${esc(r.NAME)}</div>
          <div class="card-sub">${esc([TYPE_LABEL[typeOf(r)] ?? r.TYPE, describeYield(r)].filter(Boolean).join(' · '))}</div>
        </div>
        <div class="card-figure"><strong>${fig}</strong><span>${figLabel}</span></div>
      </div>
      <div class="card-meta">
        ${sub ? `<span>Batch <b>${money(c.total)}</b></span>`
          : c.sell != null ? `<span>Sells <b>${money(c.sell)}</b></span>${gpChip(c)}` : '<span>No sell price yet</span>'}
        <span>${lineCount ? `${lineCount} line${lineCount === 1 ? '' : 's'}` : 'No ingredients yet'}</span>
        ${c.unpriced ? `<span class="warn">${c.unpriced} not costed</span>` : ''}
      </div>
      ${c.allergens.length ? `<div class="tags">${c.allergens.map(a => `<span class="tag allergen">${esc(a)}</span>`).join('')}</div>` : ''}
    </article>`;
  }).join('')}</div>`;
}

// ============================================================ recipe form

function recipeFields() {
  return [
    { name: 'NAME', label: 'Recipe name', required: true, wide: true },
    { name: 'TYPE', label: 'Type', type: 'select', options: RECIPE_TYPES, half: true },
    { name: 'PORTIONS', label: 'Portions', type: 'number', min: 0.01, step: 'any', inputmode: 'decimal', half: true,
      hint: 'How many it serves' },
    { name: 'YIELD_QTY', label: 'Batch yield', type: 'number', min: 0, step: 'any', inputmode: 'decimal', half: true,
      hint: 'Lets it be used by weight or volume' },
    { name: 'YIELD_UNIT', label: 'Yield unit', type: 'select', options: [['', '—'], 'g', 'kg', 'ml', 'cl', 'L', 'each'], half: true },
    { name: 'SELL_PRICE', label: 'Sell price £', type: 'number', min: 0, step: 0.01, inputmode: 'decimal', half: true,
      hint: 'Per portion, inc VAT' },
    { name: 'VAT_RATE', label: 'VAT %', type: 'number', min: 0, max: 100, step: 'any', inputmode: 'decimal', half: true,
      hint: `Blank = ${RECIPE_DEFAULTS.VAT_RATE}%` },
    { name: 'TARGET_GP%', label: 'Target GP %', type: 'number', min: 0, max: 99, step: 'any', inputmode: 'decimal', half: true,
      hint: `Blank = ${RECIPE_DEFAULTS.TARGET_GP}%` },
    { name: 'METHOD', label: 'Method', type: 'textarea', rows: 6, wide: true, hint: 'One step per line. Steps can also be added and reordered on the recipe.' },
  ];
}

function openRecipeForm(rec) {
  const isNew = !rec;
  formDialog({
    title: isNew ? 'New recipe' : `Edit ${rec.NAME}`,
    fields: isNew ? [...recipeFields(), {
      name: 'INGREDIENT_LIST', label: 'Ingredients (optional)', type: 'textarea', rows: 6, wide: true,
      placeholder: '200 g celery\n300 g white onion\n1 l chicken stock',
      hint: 'Paste one per line. You\u2019ll check the matches before anything is added.',
    }] : recipeFields(),
    values: rec || { TYPE: state.type || 'dish', PORTIONS: 1 },
    submitLabel: isNew ? 'Create recipe' : 'Save changes',
    onSubmit: async d => {
      const clash = store.rows('RECIPES').find(r => sameName(r.NAME, d.NAME) && r.RECIPE_ID !== rec?.RECIPE_ID);
      if (clash) throw new Error(`A recipe called “${clash.NAME}” already exists (${clash.RECIPE_ID}).`);
      if ((d.YIELD_QTY === '') !== (d.YIELD_UNIT === '')) throw new Error('Enter both the batch yield and its unit, or leave both blank.');
      if (d.YIELD_QTY !== '' && !(d.YIELD_QTY > 0)) throw new Error('Batch yield must be greater than zero.');
      if (d.PORTIONS !== '' && !(d.PORTIONS > 0)) throw new Error('Portions must be greater than zero.');
      if (d.TYPE === 'sub' && d.YIELD_QTY === '' && d.PORTIONS === '') {
        throw new Error('A sub-recipe needs a batch yield or a number of portions, so other recipes can use it.');
      }
      if (isNew) {
        const { INGREDIENT_LIST: list, ...recipe } = d;
        const id = await store.create('RECIPES', recipe);
        toast(`Created ${d.NAME}`);
        pendingPaste = list?.trim() ? list : null;
        location.hash = `#/recipes/${encodeURIComponent(id)}`;
      } else {
        await store.update('RECIPES', rec.RECIPE_ID, d);
        toast(`Saved ${d.NAME}`);
        renderList();
        if (ds.id === rec.RECIPE_ID) renderDetail();
      }
    },
  });
}

// ============================================================ recipe detail
//
// One compact sheet: the figures across the top, allergens under them, then ingredients and
// method side by side on wide screens. Ingredients are added on one line ("2 bag spinach")
// with the cost shown before anything is saved; lines and method steps reorder by dragging.

const ds = {
  id: null, open: null, swap: null, swapQ: '', add: emptyAdd(), scaleTo: '', busy: false,
  savedAt: 0, step: null, stepDraft: '',
};
let pendingPaste = null; // ingredient list typed into the New recipe form, read once it opens
let dlg = null;

function emptyAdd() { return { q: '', pick: null, qty: '', unit: '' }; }

function ensureDialog() {
  if (dlg) return;
  dlg = document.createElement('dialog');
  dlg.className = 'modal recipe-sheet';
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
        <button type="button" class="btn" data-act="paste">Paste list</button>
        <button type="button" class="btn" data-act="edit">Edit details</button>
        <button type="button" class="btn danger" data-act="delete">Delete</button>
      </footer>
    </div>`;
  document.body.append(dlg);
  dlg.addEventListener('close', () => {
    // A close event can arrive after the sheet has already been reopened for another record;
    // acting on it then would shut the new one.
    if (dlg.open) return;
    parkToasts();
    ds.id = null;
    if (/^#\/recipes\/./.test(location.hash)) location.hash = '#/recipes';
  });
  dlg.addEventListener('click', onDetailClick);
  dlg.addEventListener('input', onDetailInput);
  dlg.addEventListener('change', onDetailChange);
  dlg.addEventListener('keydown', onDetailKeydown);
}

export function openDetail(id) {
  if (!store.byId('RECIPES', id)) {
    toast('That recipe no longer exists.', 'error');
    location.hash = '#/recipes';
    return;
  }
  ensureDialog();
  if (ds.id !== id) Object.assign(ds, { id, open: null, swap: null, swapQ: '', add: emptyAdd(), scaleTo: '', step: null, stepDraft: '' });
  if (!dlg.open) dlg.showModal();
  parkToasts();
  renderDetail();
  dlg.querySelector('.modal-body').scrollTop = 0;
  if (pendingPaste) {
    const text = pendingPaste;
    pendingPaste = null;
    openPaste(text);
  }
}

function closeDetail() {
  if (dlg?.open) dlg.close();
}

function scaleBasis(rec) {
  if (Number(rec.PORTIONS) > 0) return { base: Number(rec.PORTIONS), label: 'portions' };
  if (Number(rec.YIELD_QTY) > 0) return { base: Number(rec.YIELD_QTY), label: normUnit(rec.YIELD_UNIT) };
  return { base: 1, label: 'portions' };
}

function scaleFactor(rec) {
  const { base } = scaleBasis(rec);
  const t = Number(ds.scaleTo);
  return ds.scaleTo !== '' && t > 0 && base > 0 ? t / base : 1;
}

// ---------- figures and allergens

const fig = (label, value, small, cls = '') =>
  `<div class="r-fig ${cls}"><span>${label}</span><b>${value}</b>${small ? `<small>${small}</small>` : ''}</div>`;

function summaryHtml(c) {
  const rec = c.rec;
  if (isSub(rec)) {
    return `
      <section class="r-summary">
        <div class="r-figs">
          ${fig('Batch cost', money(c.total), esc(describeYield(rec)) || 'No yield set', 'main')}
          ${c.perBase != null ? fig('Unit cost', formatUnitCost(c.perBase, BASE[c.family])) : ''}
          ${Number(rec.PORTIONS) > 0 ? fig('Per portion', money(c.perPortion)) : ''}
        </div>
      </section>`;
  }
  const portions = `${money(c.total)} · ${fmtQty(c.portions)} portion${c.portions === 1 ? '' : 's'}`;
  const sell = c.sell != null
    ? fig('Sells', money(c.sell), `${money(c.net)} ex VAT`)
    : `<div class="r-fig"><span>Sells</span><button type="button" class="link-btn" data-act="edit">Add sell price</button></div>`;
  const gp = c.gpPct != null
    ? fig('GP', `${c.gpPct.toFixed(1)}%`, `${money(c.gp)} · target ${fmtQty(c.target)}%`, `gp ${c.onTarget ? 'ok' : 'low'}`)
    : '';
  const meter = c.gpPct != null ? `
    <div class="gp-meter" role="img" aria-label="GP ${c.gpPct.toFixed(1)}% against a ${fmtQty(c.target)}% target">
      <div class="gp-fill ${c.onTarget ? 'ok' : 'low'}" style="width:${Math.max(0, Math.min(100, c.gpPct))}%"></div>
      <div class="gp-target" style="left:${Math.max(0, Math.min(100, c.target))}%"></div>
    </div>` : '';
  const suggest = c.suggested != null && c.total > 0 && !c.onTarget
    ? `<p class="suggest">${c.sell != null ? 'To hit' : 'For'} ${fmtQty(c.target)}% GP, sell at <b>${money(c.suggested)}</b> inc VAT.</p>`
    : '';
  return `
    <section class="r-summary">
      <div class="r-figs">${fig('Cost / portion', money(c.perPortion), portions, 'main')}${sell}${gp}</div>
      ${meter}${suggest}
    </section>`;
}

/** Allergen chips (icon + name) for the recipe, or icon-only marks for one line. */
function allergenChips(list) {
  return list.length
    ? `<div class="r-allergens" aria-label="Allergens">${list.map(a => `<span class="allergen-chip">${allergenIcon(a)}${esc(a)}</span>`).join('')}</div>`
    : '<p class="r-allergens none">No allergens recorded on its ingredients.</p>';
}
const allergenMarks = list => (list.length
  ? `<span class="allergen-marks">${list.map(a => `<span title="${esc(a)}" aria-label="${esc(a)}">${allergenIcon(a)}</span>`).join('')}</span>` : '');

function renderDetail() {
  if (!dlg || !ds.id) return;
  const coster = createCoster();
  const c = coster.cost(ds.id);
  const rec = c.rec;
  if (!rec) { closeDetail(); return; }

  dlg.querySelector('[data-d-overline]').textContent =
    [TYPE_LABEL[typeOf(rec)] ?? rec.TYPE, describeYield(rec)].filter(Boolean).join(' · ');
  dlg.querySelector('[data-d-title]').textContent = rec.NAME;

  const usedIn = store.rows('RECIPE_LINES')
    .filter(l => String(l.ITEM_TYPE).toUpperCase() === 'SUB' && String(l.ITEM_ID) === String(ds.id))
    .map(l => coster.recs.get(String(l.RECIPE_ID)))
    .filter((r, i, arr) => r && arr.indexOf(r) === i);

  const { label, base } = scaleBasis(rec);
  dlg.querySelector('[data-d-body]').innerHTML = `
    ${summaryHtml(c)}
    ${allergenChips(c.allergens)}
    ${c.unpriced ? `<p class="notice">${c.unpriced} line${c.unpriced === 1 ? ' isn’t' : 's aren’t'} fully costed, so the cost is understated. Tap a highlighted line to fix it.</p>` : ''}
    ${c.circular ? '<p class="notice">This recipe uses a sub-recipe that loops back into it. That line is not costed.</p>' : ''}
    <div class="r-cols">
      <section class="r-block r-ing">
        <div class="section-head">
          <h3 class="section-title">Ingredients</h3>
          <span class="r-total" data-lines-total aria-live="polite"></span>
        </div>
        <label class="scale-row">
          <span>Scale to</span>
          <input type="number" inputmode="decimal" min="0" step="any" data-scale value="${esc(ds.scaleTo)}" placeholder="${esc(fmtQty(base))}">
          <span>${esc(label)}</span>
          <b data-scale-factor></b>
        </label>
        <div data-lines></div>
      </section>
      <section class="r-block r-method" data-method>${methodHtml(rec)}</section>
    </div>
    ${usedIn.length ? `<p class="muted small used-in">Used in ${usedIn.map(r => `<a href="#/recipes/${encodeURIComponent(r.RECIPE_ID)}">${esc(r.NAME)}</a>`).join(', ')}</p>` : ''}`;
  renderLines(coster);
  bindSteps();
}

// ---------- ingredient lines

/**
 * Unit dropdown for a line. `current` is a unit ("g") or a pack value ("pack:SP-0003").
 * Ingredients also offer each of their supplier packs ("bag (250 g, £1.40)").
 */
function lineUnitOptions(lc, current) {
  let units;
  if (lc.type === 'SUB') {
    units = lc.family ? unitsFor(lc.family).filter(u => u !== 'tsp' && u !== 'tbsp') : [];
    units = [...units, 'portion'];
  } else {
    units = lc.family ? unitsFor(lc.family) : ALL_UNITS;
  }
  const packs = lc.type === 'SUB' || !lc.item ? [] : packsFor(lc.item);
  const isPack = packs.some(p => packValue(p) === current);
  const cur = isPack ? current : normUnit(current);
  if (cur && !isPack && !units.includes(cur)) units = [cur, ...units];
  const plain = units.map(u => `<option value="${esc(u)}"${u === cur ? ' selected' : ''}>${esc(u === 'portion' ? 'portion' : unitLabel(lc.family, u))}</option>`).join('');
  if (!packs.length) return plain;
  return `${plain}<optgroup label="Whole packs">${packs.map(p =>
    `<option value="${esc(packValue(p))}"${packValue(p) === cur ? ' selected' : ''}>${esc(packOptionLabel(p, lc.item))}</option>`).join('')}</optgroup>`;
}

/** The dropdown value for a stored line: its pack, or its plain unit. */
function lineUnitValue(line, ing) {
  const lp = ing ? linePack(line, ing) : null;
  return lp?.pack ? packValue(lp.pack) : normUnit(line.UNIT);
}

const PROBLEM = { unpriced: 'No price', missing: 'Missing', unit: 'Unit mismatch', circular: 'Loops back', pack: 'Pack gone' };

/** "2 bags", "500 g", "1 portion" for a costed line at `qty`. */
function qtyText(lc, qty) {
  const unit = lc.pack ? lc.packName : normUnit(lc.line.UNIT);
  return `${fmtQty(qty)} ${unit === 'portion' ? plural('portion', qty) : lc.pack ? plural(unit, qty) : unit}`;
}

function rateText(lc) {
  if (lc.rate == null) return '';
  if (lc.rateUnit === 'portion') return `${money(lc.rate)}/portion`;
  if (lc.rateUnit === 'pack') return `${money(lc.rate)}/${lc.packName}`;
  return formatUnitCost(lc.rate, lc.rateUnit);
}

function lineHtml(lc, factor, supplierNames) {
  const l = lc.line;
  const id = l.LINE_ID ? String(l.LINE_ID) : '';
  const open = id && ds.open === id;
  const name = lc.item ? lc.item.NAME : `${l.ITEM_ID} (deleted)`;
  const supplierId = lc.pack ? lc.pack.SUPPLIER_ID : chosenPrice(lc.item)?.price.SUPPLIER_ID;
  const kind = lc.type === 'SUB' ? 'Sub-recipe'
    : lc.item ? [supplierNames.get(String(supplierId)) || 'No supplier price',
      lc.pack ? `${packLabel(lc.pack.PACK_SIZE, lc.pack.PACK_UNIT)} ${lc.packName}` : '',
      lc.item.ACTIVE ? '' : 'inactive'].filter(Boolean).join(' · ') : 'Ingredient';
  const hardProblem = PROBLEM[lc.problem];
  const noId = 'This line was added in the sheet without a LINE_ID, so it can only be edited there.';
  return `
    <div class="line${lc.problem ? ' flag' : ''}${open ? ' open' : ''}" data-line="${esc(id)}">
      <div class="line-row">
        <button type="button" class="grip" data-grip ${id ? `aria-label="Move ${esc(name)} (drag, or use the arrow keys)"` : `disabled title="${noId}"`}>${icons.grip}</button>
        <button type="button" class="line-main" data-act="toggle" ${id ? '' : `disabled title="${noId}"`} aria-expanded="${open ? 'true' : 'false'}">
          <span class="line-qty">${esc(qtyText(lc, Number(l.QTY) * factor))}</span>
          <span class="line-text">
            <span class="line-name">${esc(name)}${allergenMarks(lc.allergens)}</span>
            <span class="line-sub">${esc(kind)}${lc.problem === 'partial' ? ' · part-costed' : ''}</span>
          </span>
          <span class="line-cost">${hardProblem ? `<span class="warn">${hardProblem}</span>` : money(lc.cost * factor)}<small>${rateText(lc)}</small></span>
        </button>
      </div>
      ${open ? lineEditorHtml(lc, factor) : ''}
    </div>`;
}

function lineEditorHtml(lc, factor) {
  const l = lc.line;
  const swapping = ds.swap === String(l.LINE_ID);
  return `
    <div class="line-edit">
      <div class="qty-row">
        <input type="number" inputmode="decimal" min="0" step="any" data-edit-qty value="${esc(l.QTY)}" aria-label="Quantity">
        <select data-edit-unit aria-label="Unit">${lineUnitOptions(lc, lineUnitValue(l, lc.item))}</select>
        <button type="button" class="btn primary sm" data-act="save-qty">Save</button>
      </div>
      <p class="proj" data-proj aria-live="polite"></p>
      ${factor !== 1 ? '<p class="hint">You’re editing the base recipe, not the scaled amounts.</p>' : ''}
      ${lc.problem === 'unpriced' ? '<p class="hint">This ingredient has no price yet. Tap Open to add one.</p>' : ''}
      ${lc.problem === 'unit' ? '<p class="hint">This unit doesn’t match how the item is measured. Pick another unit.</p>' : ''}
      ${lc.problem === 'pack' ? `<p class="hint">This line counts in “${esc(l.UNIT)}”, but ${esc(lc.item?.NAME)} has no supplier pack by that name any more. Pick another unit.</p>` : ''}
      <div class="line-actions">
        ${lc.item ? `<button type="button" class="btn sm" data-act="open-item">Open</button>` : ''}
        <button type="button" class="btn sm" data-act="swap">${swapping ? 'Cancel swap' : 'Swap'}</button>
        <button type="button" class="btn sm danger" data-act="remove">Remove</button>
      </div>
      ${swapping ? `
        <div class="picker" data-swap>
          <label class="search-wrap">${icons.search}
            <input type="search" class="search" data-swap-q value="${esc(ds.swapQ)}" placeholder="Replace with…" autocomplete="off">
          </label>
          <div class="results" data-results>${resultsHtml(ds.swapQ)}</div>
        </div>` : ''}
    </div>`;
}

/** "6 lines · £12.30", with a Saved mark for a moment after a change. */
function totalHtml(c, factor) {
  const saved = Date.now() - ds.savedAt < 2500 ? '<span class="badge saved">Saved</span>' : '';
  return `${c.lines.length} line${c.lines.length === 1 ? '' : 's'} · <b>${money(c.total * factor)}</b>${saved}`;
}

function renderLines(coster = createCoster()) {
  const host = dlg?.querySelector('[data-lines]');
  if (!host) return;
  const c = coster.cost(ds.id);
  const factor = scaleFactor(c.rec);
  const supplierNames = new Map(store.rows('SUPPLIERS').map(s => [String(s.SUPPLIER_ID), s.NAME]));

  dlg.querySelector('[data-lines-total]').innerHTML = totalHtml(c, factor);
  dlg.querySelector('[data-scale-factor]').textContent = factor !== 1 ? `×${fmtQty(factor)}` : '';

  host.innerHTML = `
    ${c.lines.length ? `<div class="lines" data-line-list>${c.lines.map(lc => lineHtml(lc, factor, supplierNames)).join('')}</div>`
      : '<p class="muted small lines-empty">No ingredients yet. Type one below, like “2 bag spinach”, or paste a list.</p>'}
    <div class="add-line" data-addline>${addLineHtml(coster)}</div>`;
  const list = host.querySelector('[data-line-list]');
  if (list) sortable(list, { item: '.line', handle: '[data-grip]', id: el => el.dataset.line, onDrop: reorderLines });
}

/**
 * What the recipe would cost with one line changed (or added), before anything is saved:
 * { line, total } in the recipe's own (unscaled) amounts, or null if the line can't be costed.
 */
function projection(lineRecord, replaceId = null) {
  const coster = createCoster();
  const c = coster.cost(ds.id);
  const lc = coster.line({ SORT: '', _row: 0, ...lineRecord });
  if (lc.problem && lc.problem !== 'partial') return { lc, line: null, total: null };
  const old = replaceId ? c.lines.find(x => String(x.line.LINE_ID) === String(replaceId)) : null;
  return { lc, line: lc.cost, total: c.total - (old ? old.cost : 0) + lc.cost, before: c.total };
}

/** Live preview while a line's quantity or unit is being edited. */
function updateEditProjection(row) {
  const lineId = row.dataset.line;
  const line = store.byId('RECIPE_LINES', lineId);
  const out = row.querySelector('[data-proj]');
  if (!line || !out) return;
  const qty = row.querySelector('[data-edit-qty]').value;
  const unit = row.querySelector('[data-edit-unit]').value;
  const ing = String(line.ITEM_TYPE).toUpperCase() === 'SUB' ? null : store.byId('INGREDIENTS', line.ITEM_ID);
  const same = Number(qty) === Number(line.QTY) && unit === lineUnitValue(line, ing);
  const totalEl = dlg.querySelector('[data-lines-total]');
  if (same || !(Number(qty) > 0)) {
    out.innerHTML = '';
    totalEl.innerHTML = totalHtml(createCoster().cost(ds.id), scaleFactor(store.byId('RECIPES', ds.id)));
    return;
  }
  const p = projection({ ...line, QTY: qty, ...lineUnitFields(unit, ing) }, lineId);
  if (p.total == null) { out.innerHTML = '<span class="warn">That unit doesn’t fit this item.</span>'; return; }
  const f = scaleFactor(store.byId('RECIPES', ds.id));
  out.innerHTML = `Line <b>${money(p.line * f)}</b> · recipe <b>${money(p.total * f)}</b> <span class="badge proj">Projected, not saved yet</span>`;
  totalEl.innerHTML = `${createCoster().linesOf(ds.id).length} lines · <b class="projected">${money(p.total * f)}</b><span class="badge proj">Projected</span>`;
}

// ---------- search and one-line add

function searchItems(q) {
  if (!q.trim()) return [];
  const coster = createCoster();
  const ings = store.rows('INGREDIENTS').filter(i => i.ACTIVE)
    .map(i => ({ type: 'ING', id: String(i.ING_ID), name: displayName(i), unpriced: usableUnitCost(i) == null && !packsFor(i).length }));
  const recs = store.rows('RECIPES')
    .filter(r => !coster.wouldLoop(ds.id, r.RECIPE_ID))
    .map(r => ({ type: 'SUB', id: String(r.RECIPE_ID), name: r.NAME, unpriced: false }));
  const nq = normName(q);
  return [...ings, ...recs]
    .filter(x => matches(q, x.name))
    .sort((a, b) => (normName(b.name).startsWith(nq) - normName(a.name).startsWith(nq)) || a.name.localeCompare(b.name))
    .slice(0, 8);
}

function resultsHtml(q, { quick = null } = {}) {
  if (!q.trim() && !quick) return '';
  const items = searchItems(q).filter(x => !(quick && x.type === 'ING' && x.id === String(quick.ingId)));
  return (quick ? quickHtml(quick) : '')
    + items.map(x => `
      <button type="button" class="result" data-pick-type="${x.type}" data-pick-id="${esc(x.id)}">
        <span>${esc(x.name)}</span>
        <span class="tag${x.unpriced ? ' allergen' : ''}">${x.type === 'SUB' ? 'Sub-recipe' : x.unpriced ? 'Needs price' : 'Ingredient'}</span>
      </button>`).join('')
    + (q.trim() ? `<button type="button" class="result create" data-act="create-ing">${icons.plus} New ingredient “${esc(q.trim())}”</button>` : '');
}

/**
 * Read the add box as a whole line ("2 bag spinach", "200g ricotta"): the ingredient, quantity
 * and unit, plus the name left to search with. null when it doesn't start with a number.
 */
function quickParse(text) {
  if (!/^\s*(\d|[½¼¾⅓⅔⅛])/.test(text)) return null;
  const [p] = parseText(text);
  if (!p) return null;
  let name = p.name;
  // "bag spinach" → "spinach" once "bag" has been read as the pack.
  if (isPackValue(p.unit) && p.word && normName(name).split(' ')[0] === normName(p.word)) name = name.trim().split(/\s+/).slice(1).join(' ');
  return { ...p, name, ready: !!p.ingId && Number(p.qty) > 0 };
}

function quickHtml(p) {
  if (!p.ready) return '';
  const ing = store.byId('INGREDIENTS', p.ingId);
  const proj = projection({ ITEM_TYPE: 'ING', ITEM_ID: p.ingId, QTY: p.qty, ...lineUnitFields(p.unit, ing) });
  const label = isPackValue(p.unit) ? plural(lineUnitFields(p.unit, ing).UNIT, p.qty) : p.unit;
  const cost = proj.total == null
    ? `<small class="warn">${proj.lc.problem === 'unpriced' ? 'No price yet' : 'Unit doesn’t fit'}</small>`
    : `<small>+${money(proj.line)} → <b>${money(proj.total)}</b> projected</small>`;
  return `
    <button type="button" class="result quick" data-act="quick-add">
      <span><span class="quick-key">Enter</span> Add <b>${esc(fmtQty(p.qty))} ${esc(label)}</b> ${esc(ing.NAME)}</span>
      ${cost}
    </button>
    ${p.note ? `<p class="hint warn">${esc(p.note)}</p>` : ''}`;
}

function defaultUnit(type, id) {
  if (type === 'SUB') {
    const rec = store.byId('RECIPES', id);
    const fam = familyOf(rec?.YIELD_UNIT);
    return Number(rec?.PORTIONS) > 0 || !fam ? 'portion' : BASE[fam];
  }
  const fam = ingredientFamily(store.byId('INGREDIENTS', id));
  return fam ? BASE[fam] : 'g';
}

function addResultsHtml() {
  const quick = quickParse(ds.add.q);
  return resultsHtml(quick ? quick.name : ds.add.q, { quick });
}

function addLineHtml(coster) {
  const a = ds.add;
  if (!a.pick) {
    return `
      <label class="search-wrap">${icons.plus}
        <input type="search" class="search" data-add-q value="${esc(a.q)}" placeholder="Add: “2 bag spinach” or search" autocomplete="off" aria-label="Add an ingredient or sub-recipe, with its quantity">
      </label>
      <div class="results" data-results>${addResultsHtml()}</div>
      <button type="button" class="link-btn paste-inline" data-act="paste">Paste a list of ingredients</button>`;
  }
  const item = a.pick.type === 'SUB' ? store.byId('RECIPES', a.pick.id) : store.byId('INGREDIENTS', a.pick.id);
  const lc = {
    type: a.pick.type,
    item,
    family: a.pick.type === 'SUB' ? coster.cost(a.pick.id).family : ingredientFamily(item),
  };
  return `
    <div class="picked">
      <div class="picked-head">
        <span><b>${esc(item?.NAME)}</b><small>${a.pick.type === 'SUB' ? 'Sub-recipe' : 'Ingredient'}</small></span>
        <button type="button" class="icon-btn sm" data-act="add-clear" aria-label="Choose something else">&times;</button>
      </div>
      <div class="qty-row">
        <input type="number" inputmode="decimal" min="0" step="any" data-add-qty value="${esc(a.qty)}" placeholder="Qty" aria-label="Quantity">
        <select data-add-unit aria-label="Unit">${lineUnitOptions(lc, a.unit)}</select>
        <button type="button" class="btn primary sm" data-act="add-commit">Add</button>
      </div>
      <p class="picked-cost" data-add-preview>${previewText()}</p>
    </div>`;
}

/** Cost preview for the line being added: its own cost and the recipe's projected total. */
function previewText() {
  const a = ds.add;
  if (!a.pick || !(Number(a.qty) > 0)) return 'Enter a quantity to see the cost.';
  const ing = a.pick.type === 'SUB' ? null : store.byId('INGREDIENTS', a.pick.id);
  const p = projection({ ITEM_TYPE: a.pick.type, ITEM_ID: a.pick.id, QTY: a.qty, ...lineUnitFields(a.unit, ing) });
  if (p.lc.problem === 'unpriced') return 'This ingredient has no price yet, so it will cost as £0 until you add one.';
  if (p.total == null) return 'That unit doesn’t fit this item.';
  return `Line <b>${money(p.line)}</b> · recipe ${money(p.before)} → <b>${money(p.total)}</b> <span class="badge proj">Projected</span>`;
}

// ---------- method steps

const stepsOf = rec => parseSteps(rec?.METHOD);

function methodHtml(rec) {
  const steps = stepsOf(rec);
  const item = (s, i) => (ds.step === i ? `
    <li class="step editing" data-step="${i}">
      <span class="step-n">${i + 1}</span>
      <div class="step-edit">
        <textarea data-step-text rows="3" aria-label="Step ${i + 1}">${esc(s)}</textarea>
        <div class="line-actions">
          <button type="button" class="btn primary sm" data-act="step-save">Save</button>
          <button type="button" class="btn sm" data-act="step-cancel">Cancel</button>
          <button type="button" class="btn sm danger" data-act="step-remove">Remove</button>
        </div>
      </div>
    </li>` : `
    <li class="step" data-step="${i}">
      <button type="button" class="grip" data-grip aria-label="Move step ${i + 1} (drag, or use the arrow keys)">${icons.grip}</button>
      <span class="step-n">${i + 1}</span>
      <button type="button" class="step-text" data-act="step-edit" aria-label="Edit step ${i + 1}">${esc(s)}</button>
    </li>`);
  return `
    <div class="section-head">
      <h3 class="section-title">Method</h3>
      <span class="muted small">${steps.length ? `${steps.length} step${steps.length === 1 ? '' : 's'}` : ''}</span>
    </div>
    ${steps.length ? `<ol class="steps" data-steps>${steps.map(item).join('')}</ol>` : '<p class="muted small">No method yet. Add the first step below.</p>'}
    <div class="step-add">
      <span class="step-n add">${steps.length + 1}</span>
      <textarea data-step-new rows="1" placeholder="Add a step" aria-label="Add a step">${esc(ds.stepDraft)}</textarea>
      <button type="button" class="btn sm" data-act="step-add">Add</button>
    </div>`;
}

function renderMethod() {
  const host = dlg?.querySelector('[data-method]');
  if (!host) return;
  host.innerHTML = methodHtml(store.byId('RECIPES', ds.id));
  bindSteps();
}

function bindSteps() {
  const list = dlg?.querySelector('[data-steps]');
  if (!list) return;
  sortable(list, {
    item: '.step', handle: '[data-grip]', id: el => el.dataset.step,
    onDrop: order => {
      const steps = stepsOf(store.byId('RECIPES', ds.id));
      saveSteps(order.map(i => steps[Number(i)]), 'Steps reordered');
    },
  });
  list.querySelector('[data-step-text]')?.focus();
}

function saveSteps(steps, message) {
  return run(async () => {
    await store.update('RECIPES', ds.id, { METHOD: joinSteps(steps) });
    ds.step = null;
  }, message);
}

function addSteps() {
  // Pasting several lines adds several steps.
  const fresh = parseSteps(ds.stepDraft);
  if (!fresh.length) return;
  const steps = stepsOf(store.byId('RECIPES', ds.id));
  ds.stepDraft = '';
  saveSteps([...steps, ...fresh], fresh.length === 1 ? 'Step added' : `${fresh.length} steps added`)
    .then(() => dlg.querySelector('[data-step-new]')?.focus({ preventScroll: true }));
}

function saveStep(i, text) {
  const steps = stepsOf(store.byId('RECIPES', ds.id));
  const parts = parseSteps(text);
  steps.splice(i, 1, ...parts);
  saveSteps(steps, parts.length ? 'Step saved' : 'Step removed');
}

// ---------- actions

async function run(fn, success) {
  if (ds.busy) return;
  ds.busy = true;
  dlg.classList.add('busy');
  try {
    await fn();
    ds.savedAt = Date.now();
    if (success) toast(success);
  } catch (err) {
    reportError(err);
  } finally {
    ds.busy = false;
    dlg.classList.remove('busy');
    if (ds.id) renderDetail();
    renderList();
  }
}

const recipeLines = () => createCoster().linesOf(ds.id);
const nextSort = () => recipeLines().reduce((m, l) => Math.max(m, Number(l.SORT) || 0), 0) + 1;

function pickForAdd(type, id) {
  // Keep a quantity already typed ("2 bag spin…") when the item is picked from the list.
  const quick = quickParse(ds.add.q);
  let qty = '';
  let unit = defaultUnit(type, id);
  if (quick && Number(quick.count) > 0) {
    const ing = type === 'ING' ? store.byId('INGREDIENTS', id) : null;
    const pack = ing ? packNamed(ing, quick.word) : null;
    const fam = type === 'SUB' ? familyOf(store.byId('RECIPES', id)?.YIELD_UNIT) : ingredientFamily(ing);
    if (pack) { qty = quick.count; unit = packValue(pack); } else if (quick.ingId === id) { qty = quick.qty; unit = quick.unit; } else if (fam && toBase(fam, 1, quick.unit) != null) {
      qty = quick.qty;
      unit = quick.unit;
    } else qty = quick.count;
  }
  ds.add = { q: '', pick: { type, id }, qty: qty === '' ? '' : String(qty), unit };
  renderLines();
  const input = dlg.querySelector('[data-add-qty]');
  input?.focus();
  if (qty !== '') input?.select();
}

function commitAdd() {
  const a = ds.add;
  const qty = Number(a.qty);
  if (!a.pick || !(qty > 0) || !a.unit) { toast('Enter a quantity greater than zero.', 'error'); return; }
  const sort = nextSort();
  const name = (a.pick.type === 'SUB' ? store.byId('RECIPES', a.pick.id) : store.byId('INGREDIENTS', a.pick.id))?.NAME;
  return run(async () => {
    const ing = a.pick.type === 'SUB' ? null : store.byId('INGREDIENTS', a.pick.id);
    await store.create('RECIPE_LINES', {
      RECIPE_ID: ds.id, ITEM_TYPE: a.pick.type, ITEM_ID: a.pick.id, QTY: qty, ...lineUnitFields(a.unit, ing), SORT: sort,
    });
    ds.add = emptyAdd();
  }, `Added ${name}`).then(() => dlg.querySelector('[data-add-q]')?.focus({ preventScroll: true }));
}

/** Add the line typed in the add box ("2 bag spinach") as it stands. */
function commitQuick() {
  const p = quickParse(ds.add.q);
  if (!p?.ready) return false;
  const ing = store.byId('INGREDIENTS', p.ingId);
  const fields = lineUnitFields(p.unit, ing);
  const sort = nextSort();
  run(async () => {
    await store.create('RECIPE_LINES', { RECIPE_ID: ds.id, ITEM_TYPE: 'ING', ITEM_ID: p.ingId, QTY: Number(p.qty), ...fields, SORT: sort });
    ds.add = emptyAdd();
  }, `Added ${fmtQty(p.qty)} ${isPackValue(p.unit) ? plural(fields.UNIT, p.qty) : p.unit} ${ing.NAME}`)
    .then(() => dlg.querySelector('[data-add-q]')?.focus({ preventScroll: true }));
  return true;
}

function saveQty(lineId) {
  const row = dlg.querySelector(`.line[data-line="${CSS.escape(lineId)}"]`);
  const qty = Number(row.querySelector('[data-edit-qty]').value);
  const unit = row.querySelector('[data-edit-unit]').value;
  if (!(qty > 0)) { toast('Enter a quantity greater than zero.', 'error'); return; }
  const line = store.byId('RECIPE_LINES', lineId);
  const ing = String(line.ITEM_TYPE).toUpperCase() === 'SUB' ? null : store.byId('INGREDIENTS', line.ITEM_ID);
  run(async () => {
    await store.update('RECIPE_LINES', lineId, { QTY: qty, ...lineUnitFields(unit, ing) });
    ds.open = null;
  }).then(() => dlg.querySelector(`.line[data-line="${CSS.escape(lineId)}"] [data-act=toggle]`)?.focus({ preventScroll: true }));
}

function commitSwap(lineId, type, id) {
  const line = store.byId('RECIPE_LINES', lineId);
  const fam = type === 'SUB' ? familyOf(store.byId('RECIPES', id)?.YIELD_UNIT) : ingredientFamily(store.byId('INGREDIENTS', id));
  const cur = normUnit(line.UNIT);
  const keep = (fam && toBase(fam, 1, cur) != null) || (type === 'SUB' && cur === 'portion');
  // A line in packs ("1 bag") keeps counting in packs if the new item has one by that name,
  // and otherwise becomes the pack's weight or volume ("250 g").
  const oldPack = String(line.ITEM_TYPE).toUpperCase() === 'ING' ? linePack(line, store.byId('INGREDIENTS', line.ITEM_ID))?.pack : null;
  const pack = type === 'ING' && !keep ? packNamed(store.byId('INGREDIENTS', id), cur) : null;
  const asMeasure = !pack && oldPack && fam && familyOf(oldPack.PACK_UNIT) === fam
    ? { QTY: Number(line.QTY) * Number(oldPack.PACK_SIZE), UNIT: oldPack.PACK_UNIT, PRICE_ID: '' } : null;
  const unit = pack ? { UNIT: cur, PRICE_ID: pack.PRICE_ID }
    : asMeasure || { UNIT: keep ? cur : defaultUnit(type, id), PRICE_ID: '' };
  run(async () => {
    await store.update('RECIPE_LINES', lineId, { ITEM_TYPE: type, ITEM_ID: id, ...unit });
    ds.swap = null;
    ds.swapQ = '';
  }, 'Swapped');
}

/** Save a new order of lines (from dragging), writing SORT only where it changed. */
function reorderLines(ids) {
  if (ids.some(x => !x)) return;
  const current = new Map(recipeLines().map(l => [String(l.LINE_ID), l.SORT]));
  const changes = ids.map((id, k) => ({ id, record: { SORT: k + 1 } })).filter(ch => current.get(ch.id) !== ch.record.SORT);
  if (changes.length) run(() => store.updateMany('RECIPE_LINES', changes));
}

function removeLine(lineId) {
  if (!confirm('Remove this line from the recipe?')) return;
  run(async () => {
    await store.remove({ RECIPE_LINES: [lineId] });
    ds.open = null;
  }, 'Line removed');
}

function openItem(lineId) {
  const line = store.byId('RECIPE_LINES', lineId);
  if (String(line.ITEM_TYPE).toUpperCase() === 'SUB') {
    location.hash = `#/recipes/${encodeURIComponent(line.ITEM_ID)}`;
  } else {
    ingredientsView.openForm(store.byId('INGREDIENTS', line.ITEM_ID), { onSaved: () => { renderDetail(); renderList(); } });
  }
}

function createIngredientFrom(q, onCreated) {
  ingredientsView.openForm(null, { prefill: { NAME: q.trim() }, onSaved: onCreated });
}

function deleteRecipe() {
  const rec = store.byId('RECIPES', ds.id);
  const usedBy = store.rows('RECIPE_LINES').filter(l => String(l.ITEM_TYPE).toUpperCase() === 'SUB' && String(l.ITEM_ID) === String(ds.id));
  if (usedBy.length) {
    const names = [...new Set(usedBy.map(l => store.byId('RECIPES', l.RECIPE_ID)?.NAME).filter(Boolean))];
    toast(`Can't delete: it's used in ${names.join(', ')}. Remove it from ${names.length === 1 ? 'that recipe' : 'those recipes'} first.`, 'error');
    return;
  }
  const lineIds = recipeLines().map(l => l.LINE_ID).filter(Boolean);
  const msg = lineIds.length
    ? `Delete “${rec.NAME}” and its ${lineIds.length} line${lineIds.length === 1 ? '' : 's'}? This can't be undone.`
    : `Delete “${rec.NAME}”? This can't be undone.`;
  if (!confirm(msg)) return;
  const name = rec.NAME;
  run(async () => {
    await store.remove({ RECIPE_LINES: lineIds, RECIPES: [ds.id] });
    closeDetail();
    location.hash = '#/recipes';
  }, `Deleted ${name}`);
}

// ---------- events

function onDetailClick(e) {
  const t = e.target;
  const act = t.closest('[data-act]')?.dataset.act;
  const lineEl = t.closest('.line[data-line]');
  const lineId = lineEl?.dataset.line;
  const stepEl = t.closest('.step[data-step]');
  const pick = t.closest('[data-pick-id]');

  if (pick) {
    if (t.closest('[data-swap]')) commitSwap(lineId, pick.dataset.pickType, pick.dataset.pickId);
    else pickForAdd(pick.dataset.pickType, pick.dataset.pickId);
    return;
  }
  if (ds.busy && act && act !== 'close') return;

  switch (act) {
    case 'close': closeDetail(); break;
    case 'toggle':
      ds.open = ds.open === lineId ? null : lineId;
      ds.swap = null;
      ds.swapQ = '';
      renderLines();
      dlg.querySelector('.line.open [data-edit-qty]')?.focus();
      break;
    case 'save-qty': saveQty(lineId); break;
    case 'open-item': openItem(lineId); break;
    case 'swap':
      ds.swap = ds.swap === lineId ? null : lineId;
      ds.swapQ = '';
      renderLines();
      dlg.querySelector('[data-swap-q]')?.focus();
      break;
    case 'remove': removeLine(lineId); break;
    case 'add-clear': ds.add = emptyAdd(); renderLines(); dlg.querySelector('[data-add-q]')?.focus(); break;
    case 'add-commit': commitAdd(); break;
    case 'quick-add': commitQuick(); break;
    case 'create-ing': {
      const swapping = !!t.closest('[data-swap]');
      const q = swapping ? ds.swapQ : (quickParse(ds.add.q)?.name ?? ds.add.q);
      const targetLine = lineId;
      createIngredientFrom(q, id => (swapping ? commitSwap(targetLine, 'ING', id) : pickForAdd('ING', id)));
      break;
    }
    case 'step-edit': ds.step = Number(stepEl.dataset.step); renderMethod(); break;
    case 'step-cancel': ds.step = null; renderMethod(); break;
    case 'step-save': saveStep(Number(stepEl.dataset.step), stepEl.querySelector('[data-step-text]').value); break;
    case 'step-remove': saveStep(Number(stepEl.dataset.step), ''); break;
    case 'step-add': addSteps(); break;
    case 'paste': openPaste(); break;
    case 'edit': openRecipeForm(store.byId('RECIPES', ds.id)); break;
    case 'delete': deleteRecipe(); break;
    default: break;
  }
}

function onDetailInput(e) {
  const t = e.target;
  if (t.matches('[data-add-q]')) {
    ds.add.q = t.value;
    t.closest('[data-addline]').querySelector('[data-results]').innerHTML = addResultsHtml();
  } else if (t.matches('[data-swap-q]')) {
    ds.swapQ = t.value;
    t.closest('[data-swap]').querySelector('[data-results]').innerHTML = resultsHtml(ds.swapQ);
  } else if (t.matches('[data-add-qty]')) {
    ds.add.qty = t.value;
    dlg.querySelector('[data-add-preview]').innerHTML = previewText();
  } else if (t.matches('[data-edit-qty]')) {
    updateEditProjection(t.closest('.line'));
  } else if (t.matches('[data-step-new]')) {
    ds.stepDraft = t.value;
  } else if (t.matches('[data-scale]')) {
    ds.scaleTo = t.value;
    renderLines();
  }
}

function onDetailChange(e) {
  if (e.target.matches('[data-add-unit]')) {
    ds.add.unit = e.target.value;
    dlg.querySelector('[data-add-preview]').innerHTML = previewText();
  } else if (e.target.matches('[data-edit-unit]')) {
    updateEditProjection(e.target.closest('.line'));
  }
}

function onDetailKeydown(e) {
  const t = e.target;
  if (e.key === 'Escape' && t.matches('[data-step-text]')) { e.preventDefault(); ds.step = null; renderMethod(); return; }
  if (e.key !== 'Enter' || e.isComposing) return;
  if (t.matches('[data-add-qty]')) { e.preventDefault(); commitAdd(); } else if (t.matches('[data-edit-qty]')) {
    e.preventDefault();
    saveQty(t.closest('.line').dataset.line);
  } else if (t.matches('[data-add-q]')) {
    e.preventDefault();
    if (!commitQuick()) t.closest('[data-addline]').querySelector('[data-pick-id]')?.click();
  } else if (t.matches('[data-swap-q]')) {
    e.preventDefault();
    t.closest('[data-swap]').querySelector('[data-pick-id]')?.click();
  } else if (t.matches('[data-step-new]') && !e.shiftKey) {
    e.preventDefault();
    addSteps();
  } else if (t.matches('[data-step-text]') && !e.shiftKey) {
    e.preventDefault();
    saveStep(Number(t.closest('.step').dataset.step), t.value);
  }
}

// ============================================================ paste importer

let pasteDlg = null;
let parsed = [];

function ensurePasteDialog() {
  if (pasteDlg) return;
  pasteDlg = document.createElement('dialog');
  pasteDlg.className = 'modal paste-sheet';
  pasteDlg.innerHTML = `
    <div class="modal-form">
      <header class="modal-head">
        <h2>Paste a recipe</h2>
        <button type="button" class="icon-btn" data-act="close" aria-label="Close">&times;</button>
      </header>
      <div class="modal-body">
        <p class="muted small">One ingredient per line. Each line is matched to your ingredients; cooking units like cups and ounces are converted to metric. Anything not found is created as a new ingredient for you to price later.</p>
        <textarea data-paste-text rows="7" placeholder="${esc('200g burrata\n2 cloves garlic\n1 tbsp olive oil\n175ml house red')}"></textarea>
        <button type="button" class="btn block" data-act="parse">Read the list</button>
        <p class="small muted paste-summary" data-paste-summary></p>
        <div class="paste-rows" data-paste-rows></div>
      </div>
      <footer class="modal-foot">
        <button type="button" class="btn" data-act="close">Cancel</button>
        <button type="button" class="btn primary" data-act="paste-add" disabled>Add lines</button>
      </footer>
    </div>`;
  document.body.append(pasteDlg);
  pasteDlg.addEventListener('close', parkToasts);
  pasteDlg.addEventListener('cancel', e => { if (!confirmDiscardPaste()) e.preventDefault(); });
  pasteDlg.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') { if (confirmDiscardPaste()) pasteDlg.close(); } else if (act === 'parse') {
      const text = pasteDlg.querySelector('[data-paste-text]').value;
      if (!text.trim()) { toast('Paste an ingredient list first.', 'error'); return; }
      parsed = parseText(text);
      renderPasteRows();
    } else if (act === 'paste-add') addParsed();
  });
  pasteDlg.addEventListener('input', onPasteEdit);
  pasteDlg.addEventListener('change', onPasteEdit);
}

function confirmDiscardPaste() {
  const dirty = parsed.length || pasteDlg.querySelector('[data-paste-text]').value.trim();
  return !dirty || confirm('Discard this pasted list?');
}

/** Open the importer; with `text`, it's read straight away (from the New recipe form). */
function openPaste(text = '') {
  ensurePasteDialog();
  parsed = [];
  pasteDlg.querySelector('[data-paste-text]').value = text;
  if (text) parsed = parseText(text);
  renderPasteRows();
  pasteDlg.showModal();
  parkToasts();
  if (!text) pasteDlg.querySelector('[data-paste-text]').focus();
}

function parseText(text) {
  return parseRecipeText(text, store.rows('INGREDIENTS').filter(i => i.ACTIVE)).map(p => (usePackIfNamed(p), p));
}

/** "2 bag spinach": if the ingredient has a pack called "bag", count the line in that pack. */
function usePackIfNamed(p) {
  const ing = p.ingId ? store.byId('INGREDIENTS', p.ingId) : null;
  const pack = ing && Number(p.count) > 0 ? packNamed(ing, p.word) : null;
  if (!pack) {
    const word = String(p.word).replace(/(es|s)$/, '');
    if (ing && PACK_WORDS.includes(word)) {
      p.note = `${ing.NAME} has no supplier pack called “${word}”. Name one on its price list, or set the quantity here.`;
    }
    return false;
  }
  Object.assign(p, { unit: packValue(pack), qty: Number(p.count), note: '' });
  return true;
}

function pasteRowCost(p) {
  if (!p.ingId || !(Number(p.qty) > 0)) return '';
  const ing = store.byId('INGREDIENTS', p.ingId);
  const lc = createCoster().line({ ITEM_TYPE: 'ING', ITEM_ID: p.ingId, QTY: p.qty, ...lineUnitFields(p.unit, ing), SORT: '', _row: 0 });
  if (lc.problem === 'unpriced') return 'No price';
  return lc.problem ? 'Unit?' : money(lc.cost);
}

function pasteRowHtml(p, i) {
  const ing = p.ingId ? store.byId('INGREDIENTS', p.ingId) : null;
  return `
    <div class="paste-row${p.include ? '' : ' off'}" data-i="${i}">
      <label class="paste-include"><input type="checkbox" data-p="include"${p.include ? ' checked' : ''}><span>${esc(p.raw)}</span></label>
      ${p.note ? `<p class="hint warn">${esc(p.note)}</p>` : ''}
      <item-search allow-new data-p="name" value="${esc(ing ? ing.NAME : p.name)}" aria-label="Ingredient"></item-search>
      <small class="${ing ? 'match-ok' : 'match-new'}">${ing ? '✓ Matches an ingredient' : '+ New ingredient (needs a price)'}</small>
      <div class="qty-row">
        <input type="number" inputmode="decimal" min="0" step="any" data-p="qty" value="${p.qty ?? ''}" placeholder="Qty" aria-label="Quantity">
        <select data-p="unit" aria-label="Unit">${ing ? lineUnitOptions({ type: 'ING', item: ing, family: p.family }, p.unit)
          : ALL_UNITS.map(u => `<option value="${u}"${u === p.unit ? ' selected' : ''}>${esc(unitLabel(p.family, u))}</option>`).join('')}</select>
        <span class="paste-cost" data-p-cost>${pasteRowCost(p)}</span>
      </div>
    </div>`;
}

function renderPasteRows() {
  pasteDlg.querySelector('[data-paste-rows]').innerHTML = parsed.map(pasteRowHtml).join('');
  const names = store.rows('INGREDIENTS').filter(i => i.ACTIVE).map(i => ({ value: i.NAME, label: i.NAME }));
  pasteDlg.querySelectorAll('item-search[data-p=name]').forEach(el => { el.items = names; });
  const n = parsed.filter(p => p.include).length;
  const fresh = new Set(parsed.filter(p => p.include && !p.ingId).map(p => normName(p.name))).size;
  pasteDlg.querySelector('[data-paste-summary]').textContent = parsed.length
    ? `${parsed.length} line${parsed.length === 1 ? '' : 's'} read · ${n} selected${fresh ? ` · ${fresh} new ingredient${fresh === 1 ? '' : 's'} will be created` : ''}`
    : '';
  const btn = pasteDlg.querySelector('[data-act="paste-add"]');
  btn.disabled = !n;
  btn.textContent = n ? `Add ${n} line${n === 1 ? '' : 's'}` : 'Add lines';
}

function onPasteEdit(e) {
  const row = e.target.closest('.paste-row');
  if (!row) return;
  const p = parsed[Number(row.dataset.i)];
  const field = e.target.dataset.p;
  if (field === 'qty') {
    p.qty = e.target.value === '' ? null : Number(e.target.value);
    row.querySelector('[data-p-cost]').textContent = pasteRowCost(p);
    return;
  }
  if (e.type !== 'change') return;
  if (field === 'include') p.include = e.target.checked;
  if (field === 'unit') {
    p.unit = e.target.value;
    if (!p.ingId) p.family = familyOf(p.unit) || (p.family === 'each' ? 'volume' : p.family);
  }
  if (field === 'name') {
    const typed = e.target.value.trim();
    const exact = store.rows('INGREDIENTS').find(i => i.ACTIVE && normName(i.NAME) === normName(typed));
    if (exact) {
      p.ingId = exact.ING_ID;
      p.name = exact.NAME;
      p.family = ingredientFamily(exact) || p.family;
      if (toBase(p.family, 1, p.unit) == null && !usePackIfNamed(p)) p.unit = BASE[p.family];
    } else {
      p.ingId = null;
      p.name = typed || p.name;
      if (isPackValue(p.unit)) p.unit = BASE[p.family] || 'g';
    }
  }
  renderPasteRows();
}

async function addParsed() {
  const rows = parsed.filter(p => p.include);
  const bad = rows.filter(p => !(Number(p.qty) > 0) || !p.unit || !p.name.trim());
  if (bad.length) { toast(`Set a quantity for every selected line (${bad.length} missing).`, 'error'); return; }
  const btn = pasteDlg.querySelector('[data-act="paste-add"]');
  btn.disabled = true;
  btn.textContent = 'Adding…';
  try {
    // Create each missing ingredient once, even if it appears on several lines.
    const fresh = new Map();
    for (const p of rows.filter(r => !r.ingId)) {
      const key = normName(p.name);
      const nm = p.name.trim();
      if (!fresh.has(key)) fresh.set(key, { NAME: nm.charAt(0).toUpperCase() + nm.slice(1), UNIT: BASE[p.family] || 'g', 'YIELD_%': 100, ACTIVE: true });
    }
    if (fresh.size) {
      const ids = await store.createMany('INGREDIENTS', [...fresh.values()]);
      [...fresh.keys()].forEach((key, i) => { fresh.get(key).id = ids[i]; });
    }
    let sort = recipeLines().reduce((m, l) => Math.max(m, Number(l.SORT) || 0), 0);
    await store.createMany('RECIPE_LINES', rows.map(p => ({
      RECIPE_ID: ds.id, ITEM_TYPE: 'ING', ITEM_ID: p.ingId || fresh.get(normName(p.name)).id,
      QTY: Number(p.qty), ...lineUnitFields(p.unit, p.ingId ? store.byId('INGREDIENTS', p.ingId) : null), SORT: ++sort,
    })));
    parsed = [];
    pasteDlg.close();
    toast(`Added ${rows.length} line${rows.length === 1 ? '' : 's'}${fresh.size ? `. ${fresh.size} new ingredient${fresh.size === 1 ? ' needs' : 's need'} a price` : ''}`);
    renderDetail();
    renderList();
  } catch (err) {
    reportError(err);
    btn.disabled = false;
    renderPasteRows();
  }
}
