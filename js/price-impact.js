// What a price change does downstream. Wrap any write to supplier prices in withImpact():
// it snapshots every recipe's cost and GP and every wine-menu serve before and after, and if
// anything moved, shows what did, worst first, flagging what has dropped below its GP target.

import * as store from './store.js';
import { esc, money, parkToasts } from './ui.js';
import { createCoster, isSub } from './recipe-cost.js';
import { displayName } from './costing.js';
import { serveCost, serveOf, gpPct, onTarget } from './views/wine-menus.js';
import { icons } from './icons.js';

const MOVED = 0.004;

function snapshot() {
  const coster = createCoster();
  const recipes = new Map();
  for (const r of store.rows('RECIPES')) {
    const c = coster.cost(r.RECIPE_ID);
    recipes.set(String(r.RECIPE_ID), {
      id: r.RECIPE_ID, name: r.NAME, sub: isSub(r), total: c.total, perPortion: c.perPortion,
      gpPct: c.gpPct, target: c.target, onTarget: c.onTarget,
    });
  }
  const menus = new Map(store.rows('WINE_MENUS').map(m => [String(m.MENU_ID), m.NAME]));
  const wines = new Map();
  for (const line of store.rows('WINE_MENU_LINES')) {
    const wine = store.byId('INGREDIENTS', line.ING_ID);
    const serve = serveOf(line);
    const cost = serveCost(wine, serve, line.SIZE_ML);
    const sell = line.SELL_PRICE === '' ? null : Number(line.SELL_PRICE);
    wines.set(String(line.LINE_ID), {
      menuId: line.MENU_ID, menu: menus.get(String(line.MENU_ID)) || 'Wine menu', wine: wine ? displayName(wine) : line.ING_ID,
      serve, size: line.SIZE_ML, cost, sell, gp: gpPct(cost, sell), onTarget: onTarget({ cost, sell, serve }),
    });
  }
  return { recipes, wines };
}

const moved = (a, b) => a != null && b != null && Math.abs(a - b) > MOVED;

function diff(before, after) {
  const recipes = [...after.recipes.values()].map(a => ({ a, b: before.recipes.get(String(a.id)) }))
    .filter(({ a, b }) => b && moved(a.total, b.total))
    .map(({ a, b }) => ({ ...a, before: b, newlyLow: b.onTarget !== false && a.onTarget === false }));
  const wines = [...after.wines.entries()].map(([id, a]) => ({ id, a, b: before.wines.get(id) }))
    .filter(({ a, b }) => b && moved(a.cost, b.cost))
    .map(({ id, a, b }) => ({ id, ...a, before: b, newlyLow: b.onTarget !== false && a.onTarget === false }));
  recipes.sort((x, y) => (y.newlyLow - x.newlyLow) || ((y.onTarget === false) - (x.onTarget === false))
    || Math.abs(y.perPortion - y.before.perPortion) - Math.abs(x.perPortion - x.before.perPortion));
  wines.sort((x, y) => (y.newlyLow - x.newlyLow) || ((y.onTarget === false) - (x.onTarget === false)) || (y.cost - y.before.cost) - (x.cost - x.before.cost));
  return { recipes, wines };
}

const pct = v => (v == null ? '—' : `${v.toFixed(0)}%`);
const signed = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${money(Math.abs(v))}`;

function recipeRow(r) {
  const up = r.total > r.before.total;
  const cost = r.sub ? [r.before.total, r.total, 'batch'] : [r.before.perPortion, r.perPortion, 'per portion'];
  const gp = r.gpPct == null ? '' : `
      <span class="imp-gp ${r.onTarget ? 'ok' : 'low'}">GP ${pct(r.before.gpPct)} ${icons.arrow} <b>${pct(r.gpPct)}</b></span>`;
  return `
    <a class="imp-row${r.newlyLow ? ' low' : ''}" href="#/recipes/${encodeURIComponent(r.id)}" data-close>
      <span class="imp-name">${esc(r.name)}${r.newlyLow ? `<em>Now below ${pct(r.target)} target</em>` : r.onTarget === false ? '<em class="soft">Still below target</em>' : ''}</span>
      <span class="imp-figs">
        <span class="imp-cost ${up ? 'up' : 'down'}">${money(cost[0])} ${icons.arrow} <b>${money(cost[1])}</b> <small>${signed(cost[1] - cost[0])} ${cost[2]}</small></span>
        ${gp}
      </span>
    </a>`;
}

function wineRow(w) {
  const up = w.cost > w.before.cost;
  const serve = w.serve === 'bottle' ? 'Bottle' : `${Number(w.size) || ''} ml glass`;
  return `
    <a class="imp-row${w.newlyLow ? ' low' : ''}" href="#/winemenus/${encodeURIComponent(w.menuId)}" data-close>
      <span class="imp-name">${esc(w.wine)}<small>${esc(serve)} · ${esc(w.menu)}</small>${w.newlyLow ? '<em>Now below the house price rule</em>' : ''}</span>
      <span class="imp-figs">
        <span class="imp-cost ${up ? 'up' : 'down'}">${money(w.before.cost)} ${icons.arrow} <b>${money(w.cost)}</b> <small>cost</small></span>
        ${w.gp == null ? '' : `<span class="imp-gp ${w.onTarget === false ? 'low' : 'ok'}">GP ${pct(w.before.gp)} ${icons.arrow} <b>${pct(w.gp)}</b></span>`}
      </span>
    </a>`;
}

let dlg = null;

function show({ recipes, wines }, heading) {
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.className = 'modal impact-sheet';
    document.body.append(dlg);
    dlg.addEventListener('close', parkToasts);
    dlg.addEventListener('click', e => { if (e.target.closest('[data-close]')) dlg.close(); });
  }
  const low = [...recipes, ...wines].filter(x => x.newlyLow).length;
  const up = recipes.filter(r => r.total > r.before.total).length;
  const summary = [
    recipes.length && `${recipes.length} recipe${recipes.length === 1 ? '' : 's'} ${up === recipes.length ? 'cost more' : up ? 'changed' : 'cost less'}`,
    wines.length && `${wines.length} wine serve${wines.length === 1 ? '' : 's'} changed`,
  ].filter(Boolean).join(' · ');
  dlg.innerHTML = `
    <div class="modal-form">
      <header class="modal-head">
        <div class="head-text"><p class="overline">Price change</p><h2>What it affects</h2></div>
        <button type="button" class="icon-btn" data-close aria-label="Close">&times;</button>
      </header>
      <div class="modal-body">
        <p class="imp-lead">${esc(heading)}</p>
        <p class="imp-summary">${esc(summary)}${low ? ` · <span class="warn">${low} now below target</span>` : ''}</p>
        ${recipes.length ? `<h3 class="section-title">Recipes</h3><div class="imp-list">${recipes.map(recipeRow).join('')}</div>` : ''}
        ${wines.length ? `<h3 class="section-title">Wine menus</h3><div class="imp-list">${wines.map(wineRow).join('')}</div>` : ''}
      </div>
      <footer class="modal-foot"><button type="button" class="btn primary" data-close>Done</button></footer>
    </div>`;
  if (!dlg.open) dlg.showModal();
  parkToasts();
}

/**
 * Run `write` (which changes supplier prices), then show what it changed downstream.
 * `heading` describes the change ("Ricotta, Greens Ltd: £6.20 → £6.80"), or is a function called
 * after the write that returns it. Returns write's result. Shows nothing if no cost moved.
 */
export async function withImpact(write, heading) {
  const before = snapshot();
  const result = await write();
  const changes = diff(before, snapshot());
  if (changes.recipes.length || changes.wines.length) show(changes, typeof heading === 'function' ? heading() : heading);
  return result;
}
