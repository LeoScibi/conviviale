// Wine stock counts. A count is a list of how many bottles of each wine are on hand on a day.
// Built for a phone in the cellar: one wine at a time, found by scanning its label (see
// js/label-match.js), by search, or by going down the list grouped by style.
//
// Counts are saved on the phone first and sent to the sheet in the background, so a patchy
// signal in the cellar never loses a number: anything not yet sent is kept and retried.

import * as store from '../store.js';
import { icons } from '../icons.js';
import { esc, money, formDialog, toast, reportError, matches, parkToasts } from '../ui.js';
import { chosenPrice, isWine, displayName } from '../costing.js';
import { photoFor } from '../photos.js';
import * as labels from '../label-match.js';
import * as labelText from '../label-text.js';

// The order styles run in on the list; anything else comes after.
const STYLE_ORDER = ['Sparkling', 'White', 'Orange', 'Rosé', 'Red', 'Sweet', 'Fortified'];
const SHOWS = [['todo', 'To count'], ['done', 'Counted'], ['all', 'All']];

const state = { q: '', show: 'todo' };
let root;
let countId = null;

const allWines = () => store.rows('INGREDIENTS').filter(isWine);
const linesOf = id => store.rows('STOCK_COUNT_LINES').filter(l => String(l.COUNT_ID) === String(id));
const isOpen = c => String(c?.STATUS).toLowerCase() !== 'done';
const bottleCost = w => { const p = chosenPrice(w)?.price; return p ? Number(p.PACK_PRICE) : null; };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const me = () => document.querySelector('#user-email')?.textContent?.trim() || '';

/** The Wines / Stock switch at the top of both pages. */
export function wineTabs(active) {
  const tab = (key, href, label) => `<a class="seg${active === key ? ' on' : ''}" href="${href}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="segs" aria-label="Wine pages">${tab('list', '#/wines', 'List')}${tab('stock', '#/stock', 'Stock count')}</nav>`;
}

// ============================================================ saving, with a local queue

const QUEUE_KEY = 'conviviale.stockQueue';
let queue = readQueue();
let flushing = null;
let flushTimer = null;

function readQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || {}; } catch { return {}; }
}
function writeQueue() {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch { /* still in memory */ }
}
const qKey = (cid, ingId) => `${cid}|${ingId}`;

/** Bottles of a wine in a count: what's waiting to be sent, else what the sheet says, else null. */
function qtyOf(cid, ingId) {
  const q = queue[qKey(cid, ingId)];
  if (q) return q.QTY;
  const line = linesOf(cid).find(l => String(l.ING_ID) === String(ingId));
  return line && line.QTY !== '' ? Number(line.QTY) : null;
}

function setQty(cid, ingId, qty) {
  queue[qKey(cid, ingId)] = { COUNT_ID: cid, ING_ID: ingId, QTY: qty, UPDATED: new Date().toISOString(), COUNTED_BY: me() };
  writeQueue();
  scheduleFlush(800);
}

function scheduleFlush(ms) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flush().catch(() => {}), ms);
}

/** Send everything waiting to the sheet: new wines as new rows, recounts over their row. */
async function flush() {
  if (flushing) return flushing;
  const items = Object.entries(queue);
  if (!items.length) return;
  flushing = (async () => {
    try {
      await store.refresh('STOCK_COUNT_LINES');
      const lines = store.rows('STOCK_COUNT_LINES');
      const updates = []; const adds = [];
      for (const [, rec] of items) {
        const line = lines.find(l => String(l.COUNT_ID) === String(rec.COUNT_ID) && String(l.ING_ID) === String(rec.ING_ID));
        if (line) updates.push({ id: line.LINE_ID, record: rec });
        else adds.push(rec);
      }
      if (updates.length) await store.updateMany('STOCK_COUNT_LINES', updates);
      if (adds.length) await store.createMany('STOCK_COUNT_LINES', adds);
      // Only clear what was sent; anything counted meanwhile stays queued.
      for (const [k, rec] of items) if (queue[k]?.UPDATED === rec.UPDATED) delete queue[k];
      writeQueue();
    } finally {
      flushing = null;
      renderSync();
    }
    if (Object.keys(queue).length) scheduleFlush(500);
  })();
  return flushing;
}

addEventListener('online', () => scheduleFlush(300));

function renderSync() {
  const el = root?.querySelector('[data-sync]');
  if (!el) return;
  const n = Object.keys(queue).filter(k => k.startsWith(`${countId}|`)).length;
  el.hidden = !n;
  el.innerHTML = n ? `<span>${plural(n, 'wine')} not sent to the sheet yet${navigator.onLine ? '' : ' (no signal)'}</span>
    <button class="btn sm" data-retry>Send now</button>` : '';
}

// ============================================================ routing

export function render(el, param) {
  root = el;
  countId = param || null;
  if (countId) renderCount();
  else renderList();
}

// ============================================================ list of counts

function totals(cid) {
  const wines = new Map(allWines().map(w => [String(w.ING_ID), w]));
  const ids = new Set([...linesOf(cid).map(l => String(l.ING_ID)),
    ...Object.values(queue).filter(q => String(q.COUNT_ID) === String(cid)).map(q => String(q.ING_ID))]);
  let bottles = 0; let value = 0; let counted = 0; let unpriced = 0;
  for (const id of ids) {
    const qty = qtyOf(cid, id);
    if (qty == null) continue;
    counted++;
    bottles += qty;
    const cost = wines.has(id) ? bottleCost(wines.get(id)) : null;
    if (cost == null) { if (qty) unpriced++; } else value += cost * qty;
  }
  return { counted, bottles, value, unpriced };
}

function renderList() {
  const counts = store.rows('STOCK_COUNTS').slice()
    .sort((a, b) => String(b.DATE).localeCompare(String(a.DATE)) || String(b.COUNT_ID).localeCompare(String(a.COUNT_ID)));
  root.innerHTML = `
    <div class="page-head">
      <div>
        <p class="overline">${plural(counts.length, 'count')}</p>
        <h1 class="title">Wine stock</h1>
      </div>
      <button class="btn primary add-desktop" data-add>${icons.plus} New count</button>
    </div>
    ${wineTabs('stock')}
    <div data-list>${counts.length ? `<div class="cards">${counts.map(c => {
      const t = totals(c.COUNT_ID);
      return `
      <article class="card stock-card${isOpen(c) ? ' open' : ''}">
        <a class="card-hit" href="#/stock/${encodeURIComponent(c.COUNT_ID)}" aria-label="Open ${esc(c.NAME)}"></a>
        <div class="card-top">
          <div>
            <div class="card-name">${esc(c.NAME || 'Stock count')} ${isOpen(c) ? '<span class="tag allergen">In progress</span>' : ''}</div>
            <div class="card-sub">${esc(niceDate(c.DATE))}</div>
          </div>
          <div class="card-figure"><strong>${money(t.value)}</strong><span>at cost</span></div>
        </div>
        <div class="card-meta"><span>${plural(t.counted, 'wine')}</span><span>${plural(t.bottles, 'bottle')}</span></div>
      </article>`;
    }).join('')}</div>` : '<div class="empty">No stock counts yet. Start one to count the wine.</div>'}</div>
    <button class="fab" data-add aria-label="New count">${icons.plus}</button>`;
  root.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', newCount));
}

function niceDate(d) {
  const t = new Date(`${d}T12:00:00`);
  return isNaN(t) ? String(d || '') : t.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function newCount() {
  const today = store.today();
  formDialog({
    title: 'New stock count',
    submitLabel: 'Start counting',
    fields: [
      { name: 'NAME', label: 'Name', required: true, wide: true },
      { name: 'DATE', label: 'Date', type: 'date', required: true },
    ],
    values: { NAME: `Wine count ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`, DATE: today },
    onSubmit: async data => {
      const id = await store.create('STOCK_COUNTS', { ...data, STATUS: 'open', NOTES: '' });
      location.hash = `#/stock/${encodeURIComponent(id)}`;
    },
  });
}

// ============================================================ one count

/** The last finished count before this one, for "last time" hints. */
function previousCount(count) {
  return store.rows('STOCK_COUNTS')
    .filter(c => c.COUNT_ID !== count.COUNT_ID && !isOpen(c) && String(c.DATE) <= String(count.DATE))
    .sort((a, b) => String(b.DATE).localeCompare(String(a.DATE)))[0] || null;
}

function styleRank(w) {
  const i = STYLE_ORDER.indexOf(String(w.STYLE).trim());
  return i < 0 ? STYLE_ORDER.length : i;
}

/** Wines in this count: every active wine, plus any inactive one already counted. */
function countWines(cid) {
  const counted = new Set(linesOf(cid).map(l => String(l.ING_ID)));
  return allWines().filter(w => w.ACTIVE || counted.has(String(w.ING_ID)))
    .sort((a, b) => styleRank(a) - styleRank(b) || String(a.STYLE).localeCompare(String(b.STYLE))
      || displayName(a).localeCompare(displayName(b), 'en-GB', { sensitivity: 'base' })
      || String(a.PRODUCER).localeCompare(String(b.PRODUCER)));
}

function renderCount() {
  const count = store.byId('STOCK_COUNTS', countId);
  if (!count) {
    root.innerHTML = `<div class="empty">That count isn’t in the sheet any more. <a href="#/stock">Back to counts</a></div>`;
    return;
  }
  const open = isOpen(count);
  root.innerHTML = `
    <a class="back-link" href="#/stock">${icons.back} Stock counts</a>
    <div class="page-head">
      <div>
        <p class="overline">${esc(niceDate(count.DATE))}${open ? '' : ' · finished'}</p>
        <h1 class="title">${esc(count.NAME || 'Stock count')}</h1>
      </div>
    </div>
    <div class="stock-summary" data-summary></div>
    <p class="notice stock-sync" data-sync hidden></p>
    <div class="stock-tools">
      ${open ? `<button class="btn primary lg block scan-btn" data-scan>${icons.camera} Scan a label</button>` : ''}
      <label class="search-wrap">${icons.search}
        <input type="search" class="search" data-q value="${esc(state.q)}" placeholder="Search wines" aria-label="Search wines">
      </label>
      <nav class="segs stock-show" aria-label="Show">${SHOWS.map(([k, label]) =>
        `<button type="button" class="seg${state.show === k ? ' on' : ''}" data-show="${k}">${label}</button>`).join('')}</nav>
    </div>
    <div data-rows></div>
    <div class="stock-foot">
      ${open
        ? '<button class="btn primary" data-finish>Finish count</button>'
        : '<button class="btn" data-reopen>Reopen to change</button>'}
      <button class="btn danger" data-delete>Delete count</button>
    </div>`;

  root.querySelector('[data-q]').addEventListener('input', e => { state.q = e.target.value; renderRows(); });
  root.querySelectorAll('[data-show]').forEach(b => b.addEventListener('click', () => {
    state.show = b.dataset.show;
    root.querySelectorAll('[data-show]').forEach(x => x.classList.toggle('on', x === b));
    renderRows();
  }));
  root.querySelector('[data-scan]')?.addEventListener('click', () => openScanner(count));
  root.querySelector('[data-rows]').addEventListener('click', e => {
    const hit = e.target.closest('[data-wine]');
    if (!hit) return;
    if (!open) { toast('This count is finished. Reopen it to change a number.'); return; }
    openCountSheet(count, store.byId('INGREDIENTS', hit.dataset.wine));
  });
  root.querySelector('[data-sync]').addEventListener('click', e => {
    if (e.target.closest('[data-retry]')) flush().catch(reportError);
  });
  root.querySelector('[data-finish]')?.addEventListener('click', () => finish(count));
  root.querySelector('[data-reopen]')?.addEventListener('click', () => setStatus(count, 'open'));
  root.querySelector('[data-delete]').addEventListener('click', () => deleteCount(count));
  renderRows();
  renderSync();
  if (Object.keys(queue).length) scheduleFlush(300);
}

function renderSummary() {
  const el = root?.querySelector('[data-summary]');
  if (!el) return;
  const t = totals(countId);
  const of = countWines(countId).length;
  const pct = of ? Math.round((100 * t.counted) / of) : 0;
  el.innerHTML = `
    <div class="stock-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${of}" aria-valuenow="${t.counted}"
      aria-label="Wines counted"><span style="width:${pct}%"></span></div>
    <div class="stock-figures">
      <div><strong>${t.counted}<small> / ${of}</small></strong><span>wines counted</span></div>
      <div><strong>${t.bottles}</strong><span>bottles</span></div>
      <div><strong>${money(t.value)}</strong><span>at cost${t.unpriced ? ` · ${t.unpriced} unpriced` : ''}</span></div>
    </div>`;
}

function renderRows() {
  renderSummary();
  const el = root?.querySelector('[data-rows]');
  if (!el) return;
  const count = store.byId('STOCK_COUNTS', countId);
  const prev = previousCount(count);
  const list = countWines(countId).filter(w => {
    const qty = qtyOf(countId, w.ING_ID);
    if (state.show === 'todo' && qty != null) return false;
    if (state.show === 'done' && qty == null) return false;
    return matches(state.q, w.NAME, w.PRODUCER, w.VINTAGE, w.REGION, w.GRAPE, w.STYLE);
  });
  if (!list.length) {
    el.innerHTML = `<div class="empty">${state.q ? 'No wines match.'
      : state.show === 'todo' ? 'Every wine is counted.' : state.show === 'done' ? 'Nothing counted yet.' : 'No wines yet.'}</div>`;
    return;
  }
  let group = null;
  el.innerHTML = list.map(w => {
    const style = String(w.STYLE).trim() || 'Other';
    const head = style !== group ? `<h2 class="wm-group">${esc(style)}</h2>` : '';
    group = style;
    const qty = qtyOf(countId, w.ING_ID);
    const last = prev ? qtyOf(prev.COUNT_ID, w.ING_ID) : null;
    const photo = photoFor(w.ING_ID);
    const queued = !!queue[qKey(countId, w.ING_ID)];
    return `${head}
    <button type="button" class="stock-row${qty == null ? '' : ' counted'}" data-wine="${esc(w.ING_ID)}">
      <span class="wine-thumb">${photo ? `<img src="${photo}" alt="" loading="lazy">` : icons.glass}</span>
      <span class="stock-name">
        <b>${esc(displayName(w))}</b>
        <span>${esc(w.PRODUCER || '')}</span>
      </span>
      <span class="stock-qty-col">
        <span class="stock-qty${queued ? ' queued' : ''}" title="${queued ? 'Not sent to the sheet yet' : ''}">${qty == null ? '–' : qty}</span>
        ${last != null ? `<small>last ${last}</small>` : ''}
      </span>
    </button>`;
  }).join('');
}

async function setStatus(count, status) {
  try {
    await store.update('STOCK_COUNTS', count.COUNT_ID, { STATUS: status });
    renderCount();
  } catch (err) {
    reportError(err);
  }
}

async function finish(count) {
  const left = countWines(count.COUNT_ID).filter(w => qtyOf(count.COUNT_ID, w.ING_ID) == null);
  if (left.length && !confirm(`${plural(left.length, 'wine')} ${left.length === 1 ? 'hasn’t' : 'haven’t'} been counted. Finish anyway?\n\nUncounted wines are left out of the count, not counted as 0.`)) return;
  try {
    await flush();
    if (Object.keys(queue).some(k => k.startsWith(`${count.COUNT_ID}|`))) {
      toast('Some numbers haven’t reached the sheet yet. Finish the count once you have signal.', 'error');
      return;
    }
    await setStatus(count, 'done');
    toast(`${count.NAME} finished`);
  } catch (err) {
    reportError(err);
  }
}

async function deleteCount(count) {
  const n = linesOf(count.COUNT_ID).length;
  if (!confirm(`Delete “${count.NAME}”${n ? ` and its ${plural(n, 'counted wine')}` : ''}? This can’t be undone.`)) return;
  try {
    for (const k of Object.keys(queue)) if (k.startsWith(`${count.COUNT_ID}|`)) delete queue[k];
    writeQueue();
    await store.remove({ STOCK_COUNTS: [count.COUNT_ID], STOCK_COUNT_LINES: linesOf(count.COUNT_ID).map(l => l.LINE_ID) });
    location.hash = '#/stock';
  } catch (err) {
    reportError(err);
  }
}

// ============================================================ counting one wine

/**
 * The sheet for one wine: its photo and details, and the number of bottles. `scan` (from the
 * scanner) carries the frame's fingerprints, saved on confirmation so the app learns the label,
 * and `onDone(saved)` returns to the scanner.
 */
function openCountSheet(count, wine, { scan, onDone } = {}) {
  if (!wine) return;
  const cid = count.COUNT_ID;
  const current = qtyOf(cid, wine.ING_ID);
  const prev = previousCount(count);
  const last = prev ? qtyOf(prev.COUNT_ID, wine.ING_ID) : null;
  const photo = photoFor(wine.ING_ID);
  const dlg = document.createElement('dialog');
  dlg.className = 'modal count-sheet';
  dlg.innerHTML = `
    <form class="modal-form" method="dialog">
      <header class="modal-head">
        <h2>${scan ? 'Is this the wine?' : 'Count bottles'}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close">&times;</button>
      </header>
      <div class="modal-body">
        <div class="count-wine">
          <span class="wine-thumb lg">${photo ? `<img src="${photo}" alt="">` : icons.glass}</span>
          <div>
            <p class="count-name">${esc(displayName(wine))}</p>
            <p class="muted">${esc([wine.PRODUCER, wine.REGION].filter(Boolean).join(' · '))}</p>
            <div class="tags">${wine.STYLE ? `<span class="tag">${esc(wine.STYLE)}</span>` : ''}${wine.GRAPE ? `<span class="tag used">${esc(wine.GRAPE)}</span>` : ''}</div>
            ${last != null ? `<p class="small muted">Last count: ${plural(last, 'bottle')}</p>` : ''}
          </div>
        </div>
        <div class="stepper">
          <button type="button" class="step" data-step="-1" aria-label="One fewer">−</button>
          <input type="number" inputmode="numeric" min="0" step="1" data-qty aria-label="Bottles" value="${current ?? ''}" placeholder="0">
          <button type="button" class="step" data-step="1" aria-label="One more">+</button>
        </div>
        <p class="stepper-unit">bottles</p>
        <div class="quick-adds">
          <button type="button" class="btn sm" data-step="6">+ 6 case</button>
          <button type="button" class="btn sm" data-step="12">+ 12 case</button>
          ${current != null ? '<button type="button" class="btn sm" data-clear>Clear</button>' : ''}
        </div>
      </div>
      <footer class="modal-foot">
        ${scan ? '<button type="button" class="btn foot-left" data-other>Not this wine</button>' : ''}
        <button type="submit" class="btn primary">Save</button>
      </footer>
    </form>`;
  document.body.append(dlg);
  const input = dlg.querySelector('[data-qty]');
  let result = null;

  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    input.value = Math.max(0, (Number(input.value) || 0) + Number(b.dataset.step));
    navigator.vibrate?.(8);
  });
  dlg.querySelector('[data-clear]')?.addEventListener('click', () => {
    delete queue[qKey(cid, wine.ING_ID)];
    writeQueue();
    const line = linesOf(cid).find(l => String(l.ING_ID) === String(wine.ING_ID));
    if (line) store.remove({ STOCK_COUNT_LINES: [line.LINE_ID] }).then(renderRows, reportError);
    result = 'cleared';
    dlg.close();
  });
  dlg.querySelector('[data-other]')?.addEventListener('click', () => { result = 'other'; dlg.close(); });
  dlg.querySelector('form').addEventListener('submit', e => {
    e.preventDefault();
    const raw = input.value.trim();
    const qty = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(qty) || qty < 0) { input.focus(); return; }
    setQty(cid, String(wine.ING_ID), Math.round(qty * 100) / 100);
    if (scan) labels.learn(wine.ING_ID, scan.vectors, scan.index).catch(err => console.warn('Label not learned', err));
    toast(`${displayName(wine)}: ${plural(qty, 'bottle')}`);
    result = 'saved';
    dlg.close();
  });
  dlg.addEventListener('close', () => {
    parkToasts();
    dlg.remove();
    renderRows();
    renderSync();
    onDone?.(result);
  });
  dlg.showModal();
  parkToasts();
  // On a phone, a number pad straight away for a new wine; a recount starts from the number.
  if (current == null) input.focus();
}

// ============================================================ scanner

let index = null;
let indexVersion = -1;

/** Fingerprints of every wine in the count, worked out once per data load. */
async function getIndex(wines, onProgress) {
  if (index && indexVersion === store.dataVersion()) return index;
  const built = await labels.buildIndex(wines, onProgress);
  index = built;
  indexVersion = store.dataVersion();
  return index;
}

async function openScanner(count) {
  const wines = countWines(count.COUNT_ID);
  const dlg = document.createElement('dialog');
  dlg.className = 'scanner';
  dlg.innerHTML = `
    <div class="scan-stage">
      <video playsinline muted autoplay></video>
      <div class="scan-guide" aria-hidden="true"><span></span></div>
      <button type="button" class="icon-btn scan-close" data-close aria-label="Close scanner">&times;</button>
      <p class="scan-status" role="status">Starting the camera…</p>
    </div>
    <div class="scan-tray">
      <div class="scan-picks" data-picks></div>
      <div class="scan-actions">
        <button type="button" class="btn sm" data-search>Search instead</button>
        <label class="toggle-chip"><input type="checkbox" data-auto checked> Open when sure</label>
      </div>
    </div>`;
  document.body.append(dlg);
  const video = dlg.querySelector('video');
  const status = dlg.querySelector('.scan-status');
  const picks = dlg.querySelector('[data-picks]');
  const auto = dlg.querySelector('[data-auto]');
  const say = t => { status.textContent = t; };

  let stream = null;
  let running = true;
  let paused = false;
  let idx = null;
  let last = null;           // the latest { vectors, ranked }
  let streak = { id: null, n: 0 };
  let skip = null;           // a wine just counted: don't jump straight back to it
  let avg = new Map();       // picture scores averaged over the last few frames, so one odd frame doesn't decide
  let seen = { scores: new Map(), at: 0 }; // what the latest words read off the label point to
  const textIndex = labelText.buildTextIndex(wines);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const forget = () => { avg = new Map(); seen = { scores: new Map(), at: 0 }; };

  const stop = () => {
    running = false;
    stream?.getTracks().forEach(t => t.stop());
  };
  dlg.addEventListener('close', () => { stop(); parkToasts(); dlg.remove(); });
  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-search]').addEventListener('click', () => {
    dlg.close();
    state.show = 'all';
    renderCount();
    root.querySelector('[data-q]')?.focus();
  });

  const choose = ingId => {
    const wine = store.byId('INGREDIENTS', ingId);
    if (!wine) return;
    paused = true;
    const scan = last ? { vectors: last.vectors, index: idx } : null;
    openCountSheet(count, wine, {
      scan,
      onDone: result => {
        if (result === 'saved' || result === 'cleared') skip = String(ingId);
        streak = { id: null, n: 0 };
        forget();
        picks.innerHTML = '';
        paused = false;
        if (result === 'other') say('Pick the right wine below, or search instead.');
        if (dlg.open) tick();
      },
    });
  };
  picks.addEventListener('click', e => {
    const b = e.target.closest('[data-pick]');
    if (b) choose(b.dataset.pick);
  });

  dlg.showModal();
  parkToasts();

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false,
    });
    if (!running) { stop(); return; }
    video.srcObject = stream;
    await video.play().catch(() => {});
  } catch (err) {
    say(err?.name === 'NotAllowedError'
      ? 'The camera is blocked. Allow camera access for this site in your browser settings, or use search.'
      : 'No camera could be opened on this device. Use search instead.');
    return;
  }

  // The text reader downloads alongside the picture model; without it, pictures alone are used.
  const textReady = labelText.load().then(() => true, err => { console.warn('Label text reader unavailable', err); return false; });

  try {
    say('Loading the label reader…');
    await labels.load((loaded, total) => say(`Downloading the label reader (first time only): ${Math.round((100 * loaded) / total)}%`));
    idx = await getIndex(wines, (done, total) => {
      if (total) say(`Learning your labels: ${done} of ${total} photos`);
    });
  } catch (err) {
    console.error(err);
    say(`The label reader couldn’t start: ${err.message}. Use search instead.`);
    return;
  }
  if (!idx.length) {
    say('No wine has a photo yet, so there is nothing to match. Add photos on the Wines page, or pick by search.');
    return;
  }
  say('Fill the frame with the label');

  /** Read the label's words over and over, as fast as the phone manages (about once a second). */
  async function readLoop() {
    if (!(await textReady)) return;
    while (running && dlg.open) {
      if (paused || video.readyState < 2 || !video.videoWidth) { await wait(300); continue; }
      try {
        const words = await labelText.readWords(video, guideBox(video, dlg.querySelector('.scan-guide')));
        if (!paused) seen = { scores: labelText.textScores(textIndex, words), at: Date.now() };
      } catch (err) {
        console.warn('Label text not read', err);
        await wait(1000);
      }
    }
  }

  async function tick() {
    if (!running || paused || !dlg.open) return;
    if (video.readyState < 2 || !video.videoWidth) { setTimeout(tick, 200); return; }
    try {
      const guide = guideBox(video, dlg.querySelector('.scan-guide'));
      last = await labels.match(idx, labels.frameViews(video, guide));
      if (!running || paused) return;
      for (const r of last.ranked) avg.set(r.ingId, avg.has(r.ingId) ? 0.5 * avg.get(r.ingId) + 0.5 * r.score : r.score);
      showPicks(labels.fuse(avg, Date.now() - seen.at < 4000 ? seen.scores : null));
    } catch (err) {
      console.error(err);
      say(`Couldn’t read the label: ${err.message}`);
    }
    setTimeout(tick, 250);
  }

  function showPicks(ranked) {
    const level = labels.confidence(ranked);
    const top = ranked.slice(0, 3);
    if (level === 'none') {
      picks.innerHTML = '';
      say('Fill the frame with the label');
      streak = { id: null, n: 0 };
      skip = null;
      return;
    }
    const best = top[0].ingId;
    // Once the camera moves to another wine, the one just counted can be suggested again.
    if (skip && best !== skip) skip = null;
    streak = streak.id === best ? { id: best, n: streak.n + 1 } : { id: best, n: 1 };
    say(level === 'sure' ? 'Got it. Tap to count.' : 'Is it one of these? Tap the right wine.');
    picks.innerHTML = top.map((r, i) => {
      const w = store.byId('INGREDIENTS', r.ingId);
      if (!w) return '';
      const photo = photoFor(w.ING_ID);
      const qty = qtyOf(count.COUNT_ID, w.ING_ID);
      return `
      <button type="button" class="scan-pick${i === 0 && level === 'sure' ? ' best' : ''}" data-pick="${esc(w.ING_ID)}">
        <span class="wine-thumb">${photo ? `<img src="${photo}" alt="">` : icons.glass}</span>
        <span class="stock-name"><b>${esc(displayName(w))}</b><span>${esc(w.PRODUCER || '')}</span></span>
        ${qty != null ? `<span class="tag used">${qty}</span>` : ''}
      </button>`;
    }).join('');
    // Sure of the same wine three frames running: open it without a tap.
    if (auto.checked && level === 'sure' && streak.n >= 3 && best !== skip) {
      navigator.vibrate?.(20);
      choose(best);
    }
  }

  tick();
  readLoop();
}

/** Where the on-screen guide falls on the video's own pixels (the video fills the stage, cropped). */
function guideBox(video, guideEl) {
  const v = video.getBoundingClientRect();
  const g = guideEl.getBoundingClientRect();
  const vw = video.videoWidth; const vh = video.videoHeight;
  const k = Math.max(v.width / vw, v.height / vh); // object-fit: cover
  const ox = (v.width - vw * k) / 2; const oy = (v.height - vh * k) / 2;
  const x = Math.max(0, (g.left - v.left - ox) / k);
  const y = Math.max(0, (g.top - v.top - oy) / k);
  return { x, y, w: Math.min(vw - x, g.width / k), h: Math.min(vh - y, g.height / k) };
}
