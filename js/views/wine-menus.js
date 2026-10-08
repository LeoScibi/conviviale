// Wine menus: a named list of wines, each offered by the glass, by the bottle, or both, at its own
// sell price. Unlike food menus there are no recipes or quantities; cost and GP come straight from
// the wine's current supplier price. Each serve is stored as its own line, and shown as one row
// per wine with a Glass and a Bottle column.

import * as store from '../store.js';
import { RECIPE_DEFAULTS } from '../config.js';
import { icons } from '../icons.js';
import { esc, money, formDialog, toast, reportError, byName, sameName, matches, option, parkToasts } from '../ui.js';
import { chosenPrice, ingredientUnit, usableUnitCost, packLabel, isWine, displayName } from '../costing.js';
import { photoFor } from '../photos.js';
import '../item-search.js';

const GLASS_SIZES = [125, 175, 250, 75, 375, 500];
// The order styles run in on a wine list; anything else comes after.
const LIST_ORDER = ['Sparkling', 'White', 'Orange', 'Rosé', 'Red', 'Sweet', 'Fortified'];
const SERVES = { glass: 'By the glass', bottle: 'By the bottle' };
const SORTS = [
  ['style', 'Style, then name'], ['name', 'Name'], ['producer', 'Producer'],
  ['bottle-asc', 'Bottle price: low to high'], ['bottle-desc', 'Bottle price: high to low'],
  ['glass-asc', 'Glass price: low to high'], ['gp-asc', 'GP: lowest first'],
];

const state = { q: '' };
let root;

/** The Food / Wine switch shown at the top of both menu pages. */
export function menuTabs(active) {
  const tab = (key, href, label) => `<a class="seg${active === key ? ' on' : ''}" href="${href}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="segs" aria-label="Menu type">${tab('food', '#/menus', 'Food')}${tab('wine', '#/winemenus', 'Wine')}</nav>`;
}

const serveOf = l => (String(l.SERVE).toLowerCase() === 'bottle' ? 'bottle' : 'glass');
const linesOf = menuId => store.rows('WINE_MENU_LINES').filter(l => String(l.MENU_ID) === String(menuId));
const allWines = () => store.rows('INGREDIENTS').filter(isWine);

/** What one serve of a wine costs: a glass by volume, a bottle as the pack the supplier sells. */
function serveCost(wine, serve, sizeMl) {
  if (!wine) return null;
  if (serve === 'bottle') {
    const p = chosenPrice(wine)?.price;
    return p ? Number(p.PACK_PRICE) : null;
  }
  const perMl = ingredientUnit(wine) === 'ml' ? usableUnitCost(wine) : null;
  return perMl == null || !(Number(sizeMl) > 0) ? null : perMl * Number(sizeMl);
}

/** GP% on the net price (sell prices include VAT), as on recipes. */
function gpPct(cost, sell) {
  if (cost == null || !(Number(sell) > 0)) return null;
  const net = Number(sell) / (1 + RECIPE_DEFAULTS.VAT_RATE / 100);
  return ((net - cost) / net) * 100;
}

const suggestedPrice = cost => (cost / (1 - RECIPE_DEFAULTS.TARGET_GP / 100)) * (1 + RECIPE_DEFAULTS.VAT_RATE / 100);

function build(menuId) {
  const lines = linesOf(menuId).map(line => {
    const wine = store.byId('INGREDIENTS', line.ING_ID);
    const serve = serveOf(line);
    const cost = serveCost(wine, serve, line.SIZE_ML);
    const sell = line.SELL_PRICE === '' ? null : Number(line.SELL_PRICE);
    return { line, wine, serve, cost, sell, gp: gpPct(cost, sell) };
  });
  // One row per wine, with its glass and bottle lines side by side.
  const byWine = new Map();
  for (const l of lines) {
    const id = String(l.line.ING_ID);
    if (!byWine.has(id)) byWine.set(id, { id, wine: l.wine, glass: [], bottle: [] });
    byWine.get(id)[l.serve].push(l);
  }
  const rows = [...byWine.values()];
  rows.forEach(r => r.glass.sort((x, y) => Number(x.line.SIZE_ML) - Number(y.line.SIZE_ML)));
  const gps = lines.map(l => l.gp).filter(g => g != null);
  return {
    lines, rows,
    withGlass: rows.filter(r => r.glass.length).length,
    bottleOnly: rows.filter(r => !r.glass.length).length,
    avgGp: gps.length ? gps.reduce((x, y) => x + y, 0) / gps.length : null,
    unpriced: lines.filter(l => l.sell == null).length,
    uncosted: lines.filter(l => l.wine && l.cost == null).length,
  };
}

const countsText = b => [`${b.rows.length} wine${b.rows.length === 1 ? '' : 's'}`, b.withGlass && `${b.withGlass} by the glass`,
  b.bottleOnly && `${b.bottleOnly} bottle only`].filter(Boolean).join(' · ');

export function render(el, param) {
  root = el;
  el.innerHTML = `
    <div class="page-head">
      <div>
        <p class="overline" data-count></p>
        <h1 class="title">Wine menus</h1>
      </div>
      <button class="btn primary add-desktop" data-add>${icons.plus} New wine menu</button>
    </div>
    ${menuTabs('wine')}
    <div class="toolbar">
      <label class="search-wrap">${icons.search}
        <input type="search" class="search" data-q value="${esc(state.q)}" placeholder="Search wine menus" aria-label="Search wine menus">
      </label>
    </div>
    <div data-list></div>
    <button class="fab" data-add aria-label="New wine menu">${icons.plus}</button>`;

  el.querySelector('[data-q]').addEventListener('input', e => { state.q = e.target.value; renderList(); });
  el.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => openMenuForm(null)));
  el.querySelector('[data-list]').addEventListener('click', e => {
    const hit = e.target.closest('.card-hit');
    if (hit) location.hash = `#/winemenus/${encodeURIComponent(hit.dataset.id)}`;
  });
  renderList();

  if (param) openDetail(param);
  else closeDetail();
}

function renderList() {
  if (!root?.isConnected) return;
  const all = store.rows('WINE_MENUS');
  const list = all.filter(m => matches(state.q, m.NAME, m.NOTES, m.MENU_ID)).sort(byName);
  root.querySelector('[data-count]').textContent =
    list.length === all.length ? `${all.length} saved` : `${list.length} of ${all.length}`;

  if (!list.length) {
    root.querySelector('[data-list]').innerHTML = `<div class="empty">${
      all.length ? 'No wine menus match your search.' : 'No wine menus yet. Create one, then add wines by the glass or by the bottle.'}</div>`;
    return;
  }

  root.querySelector('[data-list]').innerHTML = `<div class="cards">${list.map(m => {
    const b = build(m.MENU_ID);
    const n = b.rows.length;
    return `
    <article class="card">
      <button class="card-hit" data-id="${esc(m.MENU_ID)}" aria-label="Open ${esc(m.NAME)}"></button>
      <div class="card-top">
        <div>
          <div class="card-name">${esc(m.NAME)}</div>
          <div class="card-sub">${n ? `${n} wine${n === 1 ? '' : 's'}` : 'No wines yet'}</div>
        </div>
        <div class="card-figure"><strong>${b.avgGp == null ? '—' : `${b.avgGp.toFixed(0)}%`}</strong><span>average GP</span></div>
      </div>
      <div class="card-meta">
        ${b.withGlass ? `<span class="serve-count">${icons.glass}<b>${b.withGlass}</b> by the glass</span>` : ''}
        ${b.bottleOnly ? `<span class="serve-count">${icons.bottle}<b>${b.bottleOnly}</b> bottle only</span>` : ''}
        ${b.unpriced ? `<span class="warn">${b.unpriced} without a price</span>` : ''}
        ${m.NOTES ? `<span>${esc(m.NOTES)}</span>` : ''}
      </div>
    </article>`;
  }).join('')}</div>`;
}

// ============================================================ menu form

const FIELDS = [
  { name: 'NAME', label: 'Wine menu name', required: true, wide: true, placeholder: 'e.g. Autumn list, By the glass' },
  { name: 'NOTES', label: 'Notes', type: 'textarea', rows: 2, wide: true },
];

function openMenuForm(menu) {
  const isNew = !menu;
  formDialog({
    title: isNew ? 'New wine menu' : `Edit ${menu.NAME}`,
    fields: FIELDS,
    values: menu || {},
    submitLabel: isNew ? 'Create wine menu' : 'Save changes',
    onSubmit: async data => {
      const clash = store.rows('WINE_MENUS').find(m => sameName(m.NAME, data.NAME) && m.MENU_ID !== menu?.MENU_ID);
      if (clash) throw new Error(`A wine menu called “${clash.NAME}” already exists.`);
      if (isNew) {
        const id = await store.create('WINE_MENUS', data);
        toast(`Created ${data.NAME}`);
        location.hash = `#/winemenus/${encodeURIComponent(id)}`;
      } else {
        await store.update('WINE_MENUS', menu.MENU_ID, data);
        toast(`Saved ${data.NAME}`);
        refresh();
      }
    },
  });
}

// ============================================================ menu sheet

let dlg = null;
const ds = { id: null, wine: '', size: 125, glassPrice: '', bottlePrice: '', sort: 'style', show: '', busy: false };

function ensureDialog() {
  if (dlg) return;
  dlg = document.createElement('dialog');
  dlg.className = 'modal recipe-sheet menu-sheet wine-menu-sheet';
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
        <button type="button" class="btn danger foot-left" data-act="delete">Delete</button>
        <button type="button" class="btn" data-act="duplicate">Duplicate</button>
        <button type="button" class="btn" data-act="edit">Rename</button>
        <button type="button" class="btn primary" data-act="copy">Copy menu</button>
      </footer>
    </div>`;
  document.body.append(dlg);
  dlg.addEventListener('close', () => {
    // A close event can arrive after the sheet has already been reopened for another record;
    // acting on it then would shut the new one.
    if (dlg.open) return;
    parkToasts();
    ds.id = null;
    if (/^#\/winemenus\/./.test(location.hash)) location.hash = '#/winemenus';
  });
  dlg.addEventListener('click', onClick);
  dlg.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-add-wine]')) { ds.wine = t.value; renderDetail(); if (ds.wine) dlg.querySelector('[data-add-glass]').focus(); } else if (t.matches('[data-add-size]')) { ds.size = Number(t.value); renderDetail(); } else if (t.matches('[data-sort]')) { ds.sort = t.value; renderDetail(); }
  });
  dlg.addEventListener('input', e => {
    if (e.target.matches('[data-add-glass]')) ds.glassPrice = e.target.value;
    else if (e.target.matches('[data-add-bottle]')) ds.bottlePrice = e.target.value;
  });
  dlg.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('[data-add-glass], [data-add-bottle]')) { e.preventDefault(); addWine(); }
  });
}

function refresh() {
  renderDetail();
  renderList();
}

function openDetail(id) {
  if (!store.byId('WINE_MENUS', id)) {
    toast('That wine menu no longer exists.', 'error');
    location.hash = '#/winemenus';
    return;
  }
  ensureDialog();
  if (ds.id !== id) Object.assign(ds, { id, wine: '', glassPrice: '', bottlePrice: '', show: '' });
  if (!dlg.open) dlg.showModal();
  parkToasts();
  renderDetail();
}

function closeDetail() {
  if (dlg?.open) dlg.close();
}

/** Run a write, keeping the sheet open and dimmed while it saves. */
async function run(fn, done) {
  if (ds.busy) return;
  ds.busy = true;
  dlg.classList.add('busy');
  try {
    await fn();
    if (done) toast(done);
  } catch (err) {
    reportError(err);
  } finally {
    ds.busy = false;
    dlg.classList.remove('busy');
    refresh();
  }
}

const styleRank = w => {
  const i = LIST_ORDER.indexOf(String(w?.STYLE ?? '').trim());
  return i < 0 ? LIST_ORDER.length : i;
};
const nameOf = r => (r.wine ? displayName(r.wine) : `${r.id} (deleted)`);
const byWine = (a, b) => nameOf(a).localeCompare(nameOf(b), 'en-GB', { sensitivity: 'base' });
const lowest = (list, key) => list.map(l => l[key]).filter(v => v != null).reduce((m, v) => (m == null || v < m ? v : m), null);
// Rows with nothing to compare (no price, no GP) go last whichever way the sort runs.
const num = (v, dir) => (v == null ? Infinity : v * dir);

const COMPARE = {
  style: (a, b) => styleRank(a.wine) - styleRank(b.wine) || byWine(a, b),
  name: byWine,
  producer: (a, b) => String(a.wine?.PRODUCER ?? '').localeCompare(String(b.wine?.PRODUCER ?? ''), 'en-GB', { sensitivity: 'base' }) || byWine(a, b),
  'bottle-asc': (a, b) => num(lowest(a.bottle, 'sell'), 1) - num(lowest(b.bottle, 'sell'), 1) || byWine(a, b),
  'bottle-desc': (a, b) => num(lowest(a.bottle, 'sell'), -1) - num(lowest(b.bottle, 'sell'), -1) || byWine(a, b),
  'glass-asc': (a, b) => num(lowest(a.glass, 'sell'), 1) - num(lowest(b.glass, 'sell'), 1) || byWine(a, b),
  'gp-asc': (a, b) => num(lowest([...a.glass, ...a.bottle], 'gp'), 1) - num(lowest([...b.glass, ...b.bottle], 'gp'), 1) || byWine(a, b),
};

const SHOW = { '': () => true, glass: r => r.glass.length > 0, 'bottle-only': r => !r.glass.length };

/** One serve of a wine in its column: the price to tap and edit, or a "+" to add that serve. */
function cellHtml(r, serve) {
  const label = serve === 'glass' ? 'glass' : 'bottle';
  if (!r[serve].length) {
    return r.wine
      ? `<button type="button" class="wm-cell add" data-quick="${serve}" data-wine="${esc(r.id)}" aria-label="Add ${esc(nameOf(r))} by the ${label}">${icons.plus}</button>`
      : '<span class="wm-cell none">—</span>';
  }
  return r[serve].map(l => {
    const gp = l.gp == null ? '' : `<span class="${l.gp >= RECIPE_DEFAULTS.TARGET_GP ? '' : 'warn'}">GP ${l.gp.toFixed(0)}%</span>`;
    const size = serve === 'glass' ? `${Number(l.line.SIZE_ML) || '?'} ml` : '';
    return `
      <button type="button" class="wm-cell ${serve}" data-line="${esc(l.line.LINE_ID)}" aria-label="Edit ${esc(nameOf(r))} by the ${label}">
        <b>${l.sell == null ? 'No price' : money(l.sell)}</b>
        <small>${[size, gp].filter(Boolean).join(' · ') || (l.cost == null ? 'no cost' : '')}</small>
      </button>`;
  }).join('');
}

function rowHtml(r) {
  const photo = r.wine ? photoFor(r.wine.ING_ID) : '';
  return `
    <div class="line wm-row">
      <span class="wm-wine">
        ${photo ? `<span class="wine-thumb sm"><img src="${photo}" alt="" loading="lazy"></span>` : ''}
        <span class="line-text">
          <span class="line-name">${esc(nameOf(r))}</span>
          <span class="line-sub">${esc(r.wine?.PRODUCER ?? '')}</span>
        </span>
      </span>
      <span class="wm-cells">${cellHtml(r, 'glass')}</span>
      <span class="wm-cells">${cellHtml(r, 'bottle')}</span>
    </div>`;
}

function tableHtml(b) {
  if (!b.rows.length) return '<p class="muted small lines-empty">Nothing on this menu yet. Add a wine below.</p>';
  const shown = b.rows.filter(SHOW[ds.show] || SHOW['']).sort(COMPARE[ds.sort] || COMPARE.style);
  if (!shown.length) return '<p class="muted small lines-empty">No wines match this filter.</p>';
  const head = `<div class="wm-head"><span>Wine</span><span>${icons.glass}Glass</span><span>${icons.bottle}Bottle</span></div>`;
  if (ds.sort !== 'style') return head + shown.map(rowHtml).join('');
  // Sorted by style: break the list into Sparkling, White, Red… like a printed wine list.
  let style = null;
  return head + shown.map(r => {
    const s = String(r.wine?.STYLE ?? '').trim() || 'Other';
    const group = s === style ? '' : `<h4 class="wm-group">${esc(s)}</h4>`;
    style = s;
    return group + rowHtml(r);
  }).join('');
}

const costHint = (label, cost) => (cost == null ? `${label}: no cost yet`
  : `${label} costs ${money(cost)} (${RECIPE_DEFAULTS.TARGET_GP}% GP at ${money(suggestedPrice(cost))})`);

/** Wines that can still be added: active, and not on the menu already. */
function addable(b) {
  const onMenu = new Set(b.rows.map(r => r.id));
  return allWines().filter(w => w.ACTIVE && !onMenu.has(String(w.ING_ID)))
    .sort((x, y) => byName(x, y) || String(x.VINTAGE).localeCompare(String(y.VINTAGE)));
}

function addHtml(b) {
  const list = addable(b);
  const wine = ds.wine ? store.byId('INGREDIENTS', ds.wine) : null;
  return `
    <div class="wm-add">
      <item-search data-add-wine placeholder="Search wines to add…" aria-label="Wine to add" value="${esc(ds.wine)}"
        empty-text="${list.length ? '' : 'Every wine is already on this menu.'}"></item-search>
      <label class="wm-price glass">${icons.glass}
        <select data-add-size aria-label="Glass size">${GLASS_SIZES.map(s => option(s, `${s} ml`, ds.size)).join('')}</select>
        <input type="number" min="0" step="0.01" inputmode="decimal" data-add-glass value="${esc(ds.glassPrice)}" placeholder="Glass £" aria-label="Glass sell price, including VAT">
      </label>
      <label class="wm-price bottle">${icons.bottle}
        <input type="number" min="0" step="0.01" inputmode="decimal" data-add-bottle value="${esc(ds.bottlePrice)}" placeholder="Bottle £" aria-label="Bottle sell price, including VAT">
      </label>
      <button type="button" class="btn primary" data-act="add"${wine ? '' : ' disabled'}>${icons.plus} Add</button>
    </div>
    <p class="hint">${wine
      ? `${costHint(`${ds.size} ml glass`, serveCost(wine, 'glass', ds.size))} · ${costHint('Bottle', serveCost(wine, 'bottle'))}. Prices include VAT.`
      : 'Fill in the glass price, the bottle price, or both. Leave the glass blank for bottle only; you can add it later with the + in its column.'}</p>`;
}

function renderDetail() {
  if (!dlg || !ds.id) return;
  const menu = store.byId('WINE_MENUS', ds.id);
  if (!menu) { closeDetail(); return; }
  const b = build(ds.id);
  const n = b.rows.length;
  dlg.querySelector('[data-d-overline]').textContent = `Wine menu · ${n} wine${n === 1 ? '' : 's'}`;
  dlg.querySelector('[data-d-title]').textContent = menu.NAME;
  const chip = (key, label, icon = '') => `<button type="button" class="toggle-chip wm-chip${ds.show === key ? ' on' : ''}" data-show="${key}" aria-pressed="${ds.show === key}">${icon}${label}</button>`;
  dlg.querySelector('[data-d-body]').innerHTML = `
    <section class="summary">
      <div class="summary-main">
        <div class="stat-big">
          <span class="overline">Average GP</span>
          <strong>${b.avgGp == null ? '—' : `${b.avgGp.toFixed(0)}%`}</strong>
          <small>${n ? countsText(b) : 'No wines yet'}${b.unpriced ? ` · ${b.unpriced} without a sell price` : ''}${b.uncosted ? ` · ${b.uncosted} without a cost` : ''}</small>
        </div>
      </div>
      ${menu.NOTES ? `<p class="small muted method">${esc(menu.NOTES)}</p>` : ''}
    </section>
    <section class="detail-block">
      <h3 class="section-title">Wines on this menu</h3>
      ${n ? `<div class="wm-tools">
        <div class="wm-chips">${chip('', `All ${n}`)}${chip('glass', `Glass ${b.withGlass}`, icons.glass)}${chip('bottle-only', `Bottle only ${b.bottleOnly}`, icons.bottle)}</div>
        <label class="wm-sort"><span>Sort</span><select data-sort aria-label="Sort wines">${SORTS.map(([k, label]) => option(k, label, ds.sort)).join('')}</select></label>
      </div>` : ''}
      <div class="lines wm-table">${tableHtml(b)}</div>
      ${addHtml(b)}
    </section>`;
  dlg.querySelector('[data-add-wine]').items = addable(b).map(w => ({
    value: w.ING_ID, label: displayName(w), sub: [w.PRODUCER, w.STYLE].filter(Boolean).join(' · '),
  }));
}

function addWine() {
  if (!ds.wine) return;
  const wine = store.byId('INGREDIENTS', ds.wine);
  const prices = [ds.glassPrice, ds.bottlePrice].map(v => (String(v).trim() === '' ? '' : Number(v)));
  if (prices.some(v => v !== '' && !(v >= 0))) { toast('Enter the sell prices as numbers.', 'error'); return; }
  const [glass, bottle] = prices;
  const records = [];
  if (glass !== '') records.push({ MENU_ID: ds.id, ING_ID: ds.wine, SERVE: 'glass', SIZE_ML: ds.size, SELL_PRICE: glass });
  // With no prices at all the wine goes on as a bottle, to be priced later.
  if (bottle !== '' || glass === '') records.push({ MENU_ID: ds.id, ING_ID: ds.wine, SERVE: 'bottle', SIZE_ML: '', SELL_PRICE: bottle });
  run(async () => {
    await store.createMany('WINE_MENU_LINES', records);
    Object.assign(ds, { wine: '', glassPrice: '', bottlePrice: '' });
  }, `Added ${displayName(wine)}`);
}

/**
 * Add or edit one serve of a wine: pass `lineId` to edit an existing line, or `ingId` + `serve`
 * to add the missing glass or bottle to a wine already on the menu.
 */
function openLineForm({ lineId = null, ingId = null, serve = null }) {
  const line = lineId ? store.byId('WINE_MENU_LINES', lineId) : null;
  if (lineId && !line) return;
  const menuId = ds.id;
  const wineId = line ? line.ING_ID : ingId;
  const kind = line ? serveOf(line) : serve;
  const wine = store.byId('INGREDIENTS', wineId);
  const name = wine ? displayName(wine) : 'this wine';
  // Price first, so it has the cursor: the size is usually right already.
  const fields = [{ name: 'SELL_PRICE', label: `${kind === 'glass' ? 'Glass' : 'Bottle'} price £`, type: 'number', min: 0, step: 0.01,
    inputmode: 'decimal', half: kind === 'glass', wide: kind !== 'glass', hint: 'Including VAT' }];
  if (kind === 'glass') fields.push({ name: 'SIZE_ML', label: 'Glass size', type: 'select', options: GLASS_SIZES.map(s => [s, `${s} ml`]), half: true });

  formDialog({
    title: `${name} · ${SERVES[kind].toLowerCase()}`,
    fields,
    values: line ? { SIZE_ML: line.SIZE_ML || 125, SELL_PRICE: line.SELL_PRICE } : { SIZE_ML: 125 },
    submitLabel: line ? 'Save' : `Add ${kind}`,
    extraHtml: '<p class="cost-preview" data-preview aria-live="polite"></p>',
    onChange: (d, form) => {
      const cost = serveCost(wine, kind, d.SIZE_ML);
      const gp = gpPct(cost, d.SELL_PRICE);
      form.querySelector('[data-preview]').innerHTML = cost == null ? 'No cost for this serve yet.'
        : `Costs ${money(cost)}${gp == null ? '' : ` · <strong>GP ${gp.toFixed(0)}%</strong>`} · ${RECIPE_DEFAULTS.TARGET_GP}% GP at ${money(suggestedPrice(cost))}`;
    },
    deleteLabel: 'Remove',
    onDelete: line ? async () => {
      await store.remove({ WINE_MENU_LINES: [lineId] });
      toast(`Removed ${name} ${SERVES[kind].toLowerCase()}`);
      refresh();
    } : null,
    onSubmit: async d => {
      const size = kind === 'glass' ? Number(d.SIZE_ML) : '';
      const dup = linesOf(menuId).find(l => l.LINE_ID !== lineId && String(l.ING_ID) === String(wineId)
        && serveOf(l) === kind && Number(l.SIZE_ML || 0) === Number(size || 0));
      if (dup) throw new Error(`${name} is already on this menu ${SERVES[kind].toLowerCase()}${kind === 'glass' ? ` at ${size} ml` : ''}.`);
      if (line) await store.update('WINE_MENU_LINES', lineId, { SIZE_ML: size, SELL_PRICE: d.SELL_PRICE });
      else await store.create('WINE_MENU_LINES', { MENU_ID: menuId, ING_ID: wineId, SERVE: kind, SIZE_ML: size, SELL_PRICE: d.SELL_PRICE });
      toast(line ? `Saved ${name}` : `Added ${name} ${SERVES[kind].toLowerCase()}`);
      refresh();
    },
  });
}

/** The menu as plain text, grouped by style, with a wine's glass and bottle prices on one line. */
function menuText(menu, b) {
  const out = [menu.NAME, ''];
  const price = l => (l.sell == null ? 'price tbc' : money(l.sell));
  let style = null;
  for (const r of b.rows.filter(x => x.wine).sort(COMPARE.style)) {
    const s = String(r.wine.STYLE).trim() || 'Other';
    if (s !== style) { if (style !== null) out.push(''); out.push(s.toUpperCase()); style = s; }
    const serves = [...r.glass.map(l => `${Number(l.line.SIZE_ML) || ''}ml ${price(l)}`), ...r.bottle.map(l => `bottle ${price(l)}`)];
    out.push(`${[r.wine.PRODUCER, displayName(r.wine)].filter(Boolean).join(', ')}  ${serves.join(' / ')}`);
  }
  return out.join('\n');
}

function onClick(e) {
  const cell = e.target.closest('[data-line]');
  if (cell) { openLineForm({ lineId: cell.dataset.line }); return; }
  const quick = e.target.closest('[data-quick]');
  if (quick) { openLineForm({ ingId: quick.dataset.wine, serve: quick.dataset.quick }); return; }
  const show = e.target.closest('[data-show]');
  if (show) { ds.show = show.dataset.show; renderDetail(); return; }

  const act = e.target.closest('[data-act]')?.dataset.act;
  const menu = store.byId('WINE_MENUS', ds.id);
  if (act === 'close') dlg.close();
  else if (act === 'add') addWine();
  else if (act === 'edit') openMenuForm(menu);
  else if (act === 'copy') {
    navigator.clipboard.writeText(menuText(menu, build(ds.id)))
      .then(() => toast('Wine menu copied'), () => toast('Could not copy. Your browser blocked the clipboard.', 'error'));
  } else if (act === 'duplicate') {
    const names = new Set(store.rows('WINE_MENUS').map(m => String(m.NAME).toLowerCase()));
    let name = `${menu.NAME} (copy)`;
    for (let i = 2; names.has(name.toLowerCase()); i++) name = `${menu.NAME} (copy ${i})`;
    const lines = linesOf(ds.id);
    run(async () => {
      const id = await store.create('WINE_MENUS', { NAME: name, NOTES: menu.NOTES });
      if (lines.length) {
        await store.createMany('WINE_MENU_LINES', lines.map(l => ({
          MENU_ID: id, ING_ID: l.ING_ID, SERVE: l.SERVE, SIZE_ML: l.SIZE_ML, SELL_PRICE: l.SELL_PRICE,
        })));
      }
      location.hash = `#/winemenus/${encodeURIComponent(id)}`;
    }, `Created ${name}`);
  } else if (act === 'delete') {
    const lineIds = linesOf(ds.id).map(l => l.LINE_ID);
    if (!confirm(`Delete “${menu.NAME}”? This can't be undone.`)) return;
    const name = menu.NAME;
    run(async () => {
      await store.remove({ WINE_MENU_LINES: lineIds, WINE_MENUS: [ds.id] });
      closeDetail();
      location.hash = '#/winemenus';
    }, `Deleted ${name}`);
  }
}
