// Wine menus: a named list of wines, each offered by the glass or by the bottle at a sell price.
// Unlike food menus there are no recipes or quantities; cost and GP come straight from the wine's
// current supplier price. The same wine can be listed twice, once per serve.

import * as store from '../store.js';
import { RECIPE_DEFAULTS } from '../config.js';
import { icons } from '../icons.js';
import { esc, money, formDialog, toast, reportError, byName, sameName, matches, option, parkToasts } from '../ui.js';
import { chosenPrice, ingredientUnit, usableUnitCost, packLabel, isWine, displayName } from '../costing.js';
import { photoFor } from '../photos.js';

const GLASS_SIZES = [125, 175, 250, 75, 375, 500];
// The order styles run in on a wine list; anything else comes after.
const LIST_ORDER = ['Sparkling', 'White', 'Orange', 'Rosé', 'Red', 'Sweet', 'Fortified'];
const SERVES = { glass: 'By the glass', bottle: 'By the bottle' };
const SORTS = [
  ['style', 'Style, then name'], ['name', 'Name'], ['producer', 'Producer'],
  ['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low'], ['gp-asc', 'GP: lowest first'],
];

const state = { q: '' };
let root;

/** The Food / Wine switch shown at the top of both menu pages. */
export function menuTabs(active) {
  const tab = (key, href, label) => `<a class="seg${active === key ? ' on' : ''}" href="${href}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="segs" aria-label="Menu type">${tab('food', '#/menus', 'Food')}${tab('wine', '#/winemenus', 'Wine')}</nav>`;
}

const serveIcon = serve => (serve === 'bottle' ? icons.bottle : icons.glass);
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
  const gps = lines.map(l => l.gp).filter(g => g != null);
  return {
    lines,
    glass: lines.filter(l => l.serve === 'glass').length,
    bottle: lines.filter(l => l.serve === 'bottle').length,
    avgGp: gps.length ? gps.reduce((a, b) => a + b, 0) / gps.length : null,
    unpriced: lines.filter(l => l.sell == null).length,
    uncosted: lines.filter(l => l.wine && l.cost == null).length,
  };
}

const countsText = b => [b.glass && `${b.glass} by the glass`, b.bottle && `${b.bottle} by the bottle`].filter(Boolean).join(' · ');

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
    const n = b.lines.length;
    return `
    <article class="card">
      <button class="card-hit" data-id="${esc(m.MENU_ID)}" aria-label="Open ${esc(m.NAME)}"></button>
      <div class="card-top">
        <div>
          <div class="card-name">${esc(m.NAME)}</div>
          <div class="card-sub">${n ? `${n} line${n === 1 ? '' : 's'}` : 'No wines yet'}</div>
        </div>
        <div class="card-figure"><strong>${b.avgGp == null ? '—' : `${b.avgGp.toFixed(0)}%`}</strong><span>average GP</span></div>
      </div>
      <div class="card-meta">
        ${b.glass ? `<span class="serve-count">${icons.glass}<b>${b.glass}</b> by the glass</span>` : ''}
        ${b.bottle ? `<span class="serve-count">${icons.bottle}<b>${b.bottle}</b> by the bottle</span>` : ''}
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
const ds = { id: null, wine: '', serve: 'glass', size: 125, price: '', sort: 'style', show: '', busy: false };

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
    if (t.matches('[data-add-wine]')) { ds.wine = t.value; renderDetail(); } else if (t.matches('[data-add-size]')) { ds.size = Number(t.value); renderDetail(); } else if (t.matches('[data-sort]')) { ds.sort = t.value; renderDetail(); }
  });
  dlg.addEventListener('input', e => { if (e.target.matches('[data-add-price]')) ds.price = e.target.value; });
  dlg.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('[data-add-price]')) { e.preventDefault(); addLine(); }
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
  if (ds.id !== id) Object.assign(ds, { id, wine: '', price: '', show: '' });
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
const nameOf = l => (l.wine ? displayName(l.wine) : `${l.line.ING_ID} (deleted)`);
const byWine = (a, b) => nameOf(a).localeCompare(nameOf(b), 'en-GB', { sensitivity: 'base' }) || (a.serve === b.serve ? 0 : a.serve === 'glass' ? -1 : 1);
// Lines with nothing to compare (no price, no GP) go last whichever way the sort runs.
const num = (v, dir) => (v == null ? Infinity : v * dir);

const COMPARE = {
  style: (a, b) => styleRank(a.wine) - styleRank(b.wine) || byWine(a, b),
  name: byWine,
  producer: (a, b) => String(a.wine?.PRODUCER ?? '').localeCompare(String(b.wine?.PRODUCER ?? ''), 'en-GB', { sensitivity: 'base' }) || byWine(a, b),
  'price-asc': (a, b) => num(a.sell, 1) - num(b.sell, 1) || byWine(a, b),
  'price-desc': (a, b) => num(a.sell, -1) - num(b.sell, -1) || byWine(a, b),
  'gp-asc': (a, b) => num(a.gp, 1) - num(b.gp, 1) || byWine(a, b),
};

function lineHtml(l) {
  const photo = l.wine ? photoFor(l.wine.ING_ID) : '';
  const size = l.serve === 'glass' ? `${Number(l.line.SIZE_ML) || '?'} ml` : (chosenPrice(l.wine)?.price ? packLabel(chosenPrice(l.wine).price.PACK_SIZE, chosenPrice(l.wine).price.PACK_UNIT) : 'bottle');
  const sub = [l.wine?.PRODUCER, size, l.cost == null ? null : `cost ${money(l.cost)}`].filter(Boolean).map(esc).join(' · ');
  return `
    <button type="button" class="line wm-line${l.wine && l.sell != null ? '' : ' flag'}" data-line="${esc(l.line.LINE_ID)}" aria-label="Edit ${esc(nameOf(l))}, ${SERVES[l.serve].toLowerCase()}">
      <span class="serve-badge ${l.serve}" title="${SERVES[l.serve]}">${serveIcon(l.serve)}<small>${l.serve === 'glass' ? 'Glass' : 'Bottle'}</small></span>
      ${photo ? `<span class="wine-thumb sm"><img src="${photo}" alt="" loading="lazy"></span>` : ''}
      <span class="line-text">
        <span class="line-name">${esc(nameOf(l))}</span>
        <span class="line-sub">${sub}${l.wine && l.cost == null ? ' <span class="warn">no cost</span>' : ''}</span>
      </span>
      <span class="line-cost">${l.sell == null ? '<span class="warn">No price</span>' : money(l.sell)}${
        l.gp == null ? '' : `<small class="${l.gp >= RECIPE_DEFAULTS.TARGET_GP ? '' : 'warn'}">GP ${l.gp.toFixed(0)}%</small>`}</span>
    </button>`;
}

function linesHtml(b) {
  const shown = b.lines.filter(l => !ds.show || l.serve === ds.show).sort(COMPARE[ds.sort] || COMPARE.style);
  if (!b.lines.length) return '<p class="muted small lines-empty">Nothing on this menu yet. Add a wine below.</p>';
  if (!shown.length) return `<p class="muted small lines-empty">Nothing ${SERVES[ds.show].toLowerCase()} on this menu.</p>`;
  if (ds.sort !== 'style') return shown.map(lineHtml).join('');
  // Sorted by style: break the list into Sparkling, White, Red… like a printed wine list.
  let style = null;
  return shown.map(l => {
    const s = String(l.wine?.STYLE ?? '').trim() || 'Other';
    const head = s === style ? '' : `<h4 class="wm-group">${esc(s)}</h4>`;
    style = s;
    return head + lineHtml(l);
  }).join('');
}

function serveToggle(current, attr) {
  return `<div class="serve-toggle" role="group" aria-label="Serve">${Object.keys(SERVES).map(s => `
    <button type="button" ${attr}="${s}" aria-pressed="${current === s}">${serveIcon(s)}<span>${s === 'glass' ? 'Glass' : 'Bottle'}</span></button>`).join('')}</div>`;
}

function addHtml() {
  const list = allWines().filter(w => w.ACTIVE)
    .sort((a, b) => byName(a, b) || String(a.VINTAGE).localeCompare(String(b.VINTAGE)));
  const wine = ds.wine ? store.byId('INGREDIENTS', ds.wine) : null;
  const cost = serveCost(wine, ds.serve, ds.size);
  const hint = !wine ? ''
    : cost == null ? `<span class="warn">${ds.serve === 'glass' && ingredientUnit(wine) !== 'ml' ? 'This wine isn’t measured in ml, so a glass can’t be costed.' : 'No supplier price yet, so there is no cost or GP.'}</span>`
      : `Costs ${money(cost)}. ${RECIPE_DEFAULTS.TARGET_GP}% GP at ${money(suggestedPrice(cost))} inc VAT.`;
  return `
    <div class="wm-add">
      <select data-add-wine aria-label="Wine">
        <option value="">Add a wine…</option>
        ${list.map(w => option(w.ING_ID, [displayName(w), w.PRODUCER].filter(Boolean).join(' · '), ds.wine)).join('')}
      </select>
      ${serveToggle(ds.serve, 'data-add-serve')}
      ${ds.serve === 'glass'
        ? `<select data-add-size aria-label="Glass size">${GLASS_SIZES.map(s => option(s, `${s} ml`, ds.size)).join('')}</select>`
        : '<span class="unit">whole bottle</span>'}
      <input type="number" min="0" step="0.01" inputmode="decimal" data-add-price value="${esc(ds.price)}" placeholder="Sell price £" aria-label="Sell price, including VAT">
      <button type="button" class="btn primary" data-act="add"${wine ? '' : ' disabled'}>${icons.plus} Add</button>
    </div>
    ${hint ? `<p class="hint">${hint}</p>` : ''}`;
}

function renderDetail() {
  if (!dlg || !ds.id) return;
  const menu = store.byId('WINE_MENUS', ds.id);
  if (!menu) { closeDetail(); return; }
  const b = build(ds.id);
  const n = b.lines.length;
  dlg.querySelector('[data-d-overline]').textContent = `Wine menu · ${n} line${n === 1 ? '' : 's'}`;
  dlg.querySelector('[data-d-title]').textContent = menu.NAME;
  const chip = (key, label, icon = '') => `<button type="button" class="toggle-chip wm-chip${ds.show === key ? ' on' : ''}" data-show="${key}" aria-pressed="${ds.show === key}">${icon}${label}</button>`;
  dlg.querySelector('[data-d-body]').innerHTML = `
    <section class="summary">
      <div class="summary-main">
        <div class="stat-big">
          <span class="overline">Average GP</span>
          <strong>${b.avgGp == null ? '—' : `${b.avgGp.toFixed(0)}%`}</strong>
          <small>${countsText(b) || 'No wines yet'}${b.unpriced ? ` · ${b.unpriced} without a sell price` : ''}${b.uncosted ? ` · ${b.uncosted} without a cost` : ''}</small>
        </div>
      </div>
      ${menu.NOTES ? `<p class="small muted method">${esc(menu.NOTES)}</p>` : ''}
    </section>
    <section class="detail-block">
      <h3 class="section-title">Wines on this menu</h3>
      ${n ? `<div class="wm-tools">
        <div class="wm-chips">${chip('', `All ${n}`)}${chip('glass', `Glass ${b.glass}`, icons.glass)}${chip('bottle', `Bottle ${b.bottle}`, icons.bottle)}</div>
        <label class="wm-sort"><span>Sort</span><select data-sort aria-label="Sort wines">${SORTS.map(([k, label]) => option(k, label, ds.sort)).join('')}</select></label>
      </div>` : ''}
      <div class="lines">${linesHtml(b)}</div>
      ${addHtml()}
    </section>`;
}

function addLine() {
  if (!ds.wine) return;
  const wine = store.byId('INGREDIENTS', ds.wine);
  const price = ds.price === '' ? '' : Number(ds.price);
  if (price !== '' && !(price >= 0)) { toast('Enter the sell price as a number.', 'error'); return; }
  const size = ds.serve === 'glass' ? ds.size : '';
  const dup = linesOf(ds.id).find(l => String(l.ING_ID) === String(ds.wine) && serveOf(l) === ds.serve && Number(l.SIZE_ML || 0) === Number(size || 0));
  if (dup) { toast(`${displayName(wine)} is already on this menu ${SERVES[ds.serve].toLowerCase()}. Tap it to change the price.`, 'error'); return; }
  const record = { MENU_ID: ds.id, ING_ID: ds.wine, SERVE: ds.serve, SIZE_ML: size, SELL_PRICE: price };
  run(async () => {
    await store.create('WINE_MENU_LINES', record);
    Object.assign(ds, { wine: '', price: '' });
  }, `Added ${displayName(wine)}`);
}

function openLineForm(lineId) {
  const line = store.byId('WINE_MENU_LINES', lineId);
  if (!line) return;
  const wine = store.byId('INGREDIENTS', line.ING_ID);
  const name = wine ? displayName(wine) : 'this wine';
  formDialog({
    title: name,
    fields: [
      { name: 'SERVE', label: 'Served', type: 'select', options: Object.entries(SERVES), half: true },
      { name: 'SIZE_ML', label: 'Glass size', type: 'select', options: GLASS_SIZES.map(s => [s, `${s} ml`]), half: true, hint: 'Ignored for a bottle' },
      { name: 'SELL_PRICE', label: 'Sell price £', type: 'number', min: 0, step: 0.01, inputmode: 'decimal', wide: true, hint: 'Including VAT' },
    ],
    values: { SERVE: serveOf(line), SIZE_ML: line.SIZE_ML || 125, SELL_PRICE: line.SELL_PRICE },
    submitLabel: 'Save',
    extraHtml: '<p class="cost-preview" data-preview aria-live="polite"></p>',
    onChange: (d, form) => {
      const cost = serveCost(wine, d.SERVE, d.SIZE_ML);
      const gp = gpPct(cost, d.SELL_PRICE);
      form.querySelector('[data-preview]').innerHTML = cost == null ? 'No cost for this serve yet.'
        : `Costs ${money(cost)}${gp == null ? '' : ` · <strong>GP ${gp.toFixed(0)}%</strong>`} · ${RECIPE_DEFAULTS.TARGET_GP}% GP at ${money(suggestedPrice(cost))}`;
    },
    deleteLabel: 'Remove',
    onDelete: async () => {
      await store.remove({ WINE_MENU_LINES: [lineId] });
      toast(`Removed ${name}`);
      refresh();
    },
    onSubmit: async d => {
      const size = d.SERVE === 'glass' ? Number(d.SIZE_ML) : '';
      const dup = linesOf(line.MENU_ID).find(l => l.LINE_ID !== lineId && String(l.ING_ID) === String(line.ING_ID)
        && serveOf(l) === d.SERVE && Number(l.SIZE_ML || 0) === Number(size || 0));
      if (dup) throw new Error(`${name} is already on this menu ${SERVES[d.SERVE].toLowerCase()}.`);
      await store.update('WINE_MENU_LINES', lineId, { SERVE: d.SERVE, SIZE_ML: size, SELL_PRICE: d.SELL_PRICE });
      toast(`Saved ${name}`);
      refresh();
    },
  });
}

/** The menu as plain text, grouped by style, with a wine's glass and bottle prices on one line. */
function menuText(menu, b) {
  const out = [menu.NAME, ''];
  const wines = new Map();
  for (const l of b.lines.filter(x => x.wine).sort(COMPARE.style)) {
    const id = String(l.wine.ING_ID);
    if (!wines.has(id)) wines.set(id, { wine: l.wine, serves: [] });
    const price = l.sell == null ? 'price tbc' : money(l.sell);
    wines.get(id).serves.push(l.serve === 'glass' ? `${Number(l.line.SIZE_ML) || ''}ml ${price}` : `bottle ${price}`);
  }
  let style = null;
  for (const { wine, serves } of wines.values()) {
    const s = String(wine.STYLE).trim() || 'Other';
    if (s !== style) { if (style !== null) out.push(''); out.push(s.toUpperCase()); style = s; }
    out.push(`${[wine.PRODUCER, displayName(wine)].filter(Boolean).join(', ')}  ${serves.join(' / ')}`);
  }
  return out.join('\n');
}

function onClick(e) {
  const lineBtn = e.target.closest('[data-line]');
  if (lineBtn) { openLineForm(lineBtn.dataset.line); return; }
  const serve = e.target.closest('[data-add-serve]');
  if (serve) { ds.serve = serve.dataset.addServe; renderDetail(); return; }
  const show = e.target.closest('[data-show]');
  if (show) { ds.show = show.dataset.show; renderDetail(); return; }

  const act = e.target.closest('[data-act]')?.dataset.act;
  const menu = store.byId('WINE_MENUS', ds.id);
  if (act === 'close') dlg.close();
  else if (act === 'add') addLine();
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
