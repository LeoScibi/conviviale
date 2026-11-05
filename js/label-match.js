// Recognising a wine from its label, on the phone. Each wine's photo (and every scan someone has
// confirmed) is turned into a few fingerprints by js/label-worker.js; a camera frame is
// fingerprinted the same way and the wines with the closest fingerprints are suggested.
//
// - Photo fingerprints are worked out on each phone and kept in IndexedDB, keyed by the photo
//   itself, so they are only redone when a photo changes.
// - Confirmed scans are kept in the LABEL_SCANS tab, so what one person teaches the app helps
//   everyone. The shop photos are whole bottles on white; real scans are labels in a cellar, so
//   these teach it the most. A few per wine are kept, newest first.

import * as store from './store.js';
import { photoFor } from './photos.js';

// Changing the model (or how fingerprints are made) makes every stored fingerprint useless:
// bump this and old ones are ignored.
export const MODEL_TAG = 'dinov2s-q8-v1';
const SIDE = 256;
const DIM = 768;
export const MAX_SCANS_PER_WINE = 6;

// ---------------------------------------------------------------- worker

let worker = null;
let seq = 0;
const pending = new Map();
const progressFns = new Set();

function call(type, payload = {}, transfer = []) {
  if (!worker) {
    // The worker URL carries the release version, like every other module.
    const url = new URL(`./label-worker.js${new URL(import.meta.url).search}`, import.meta.url);
    worker = new Worker(url, { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { progressFns.forEach(fn => fn(data.loaded, data.total)); return; }
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if (data.ok) p.resolve(data.result); else p.reject(new Error(data.error));
    };
    worker.onerror = e => {
      const err = new Error(e.message || 'The label reader stopped working. Reload the page and try again.');
      pending.forEach(p => p.reject(err));
      pending.clear();
      worker = null;
    };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, ...payload }, transfer);
  });
}

let ready = null;
/** Download (first time) and start the model. `onProgress(loaded, total)` reports the download. */
export function load(onProgress) {
  if (onProgress) progressFns.add(onProgress);
  ready ??= call('load').catch(err => { ready = null; throw err; });
  return ready.finally(() => onProgress && progressFns.delete(onProgress));
}

async function embed(canvases) {
  const images = canvases.map(c => {
    const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    return { data: data.buffer, width: c.width, height: c.height };
  });
  return call('embed', { images }, images.map(i => i.data));
}

// ---------------------------------------------------------------- pictures to square views

function square(fill = '#fff') {
  const c = document.createElement('canvas');
  c.width = c.height = SIDE;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, SIDE, SIDE);
  return c;
}

/** Draw part of a picture (sx, sy, sw, sh) into a square, whole and centred (letterboxed). */
function fit(src, sx, sy, sw, sh, fill) {
  const c = square(fill);
  const k = Math.min(SIDE / sw, SIDE / sh);
  const w = sw * k; const h = sh * k;
  c.getContext('2d').drawImage(src, sx, sy, sw, sh, (SIDE - w) / 2, (SIDE - h) / 2, w, h);
  return c;
}

/** The box around whatever isn't plain background (a shop photo's white or transparent edge). */
function subjectBox(img) {
  const w = img.naturalWidth || img.width; const h = img.naturalHeight || img.height;
  const k = Math.min(1, 160 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = c.width; let y0 = c.height; let x1 = -1; let y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (Math.min(data[i], data[i + 1], data[i + 2]) < 232) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w, h };
  return { x: x0 / k, y: y0 / k, w: (x1 - x0 + 1) / k, h: (y1 - y0 + 1) / k };
}

/**
 * The views a reference photo is fingerprinted from: the whole bottle, and the label, which on
 * a bottle shot sits in the lower half. A tall bottle gets two label views (lower and middle),
 * since labels sit at different heights.
 */
function photoViews(img) {
  const b = subjectBox(img);
  const views = [fit(img, b.x, b.y, b.w, b.h)];
  if (b.h > b.w * 1.6) {
    views.push(fit(img, b.x, b.y + b.h * 0.5, b.w, b.h * 0.45));
    views.push(fit(img, b.x, b.y + b.h * 0.35, b.w, b.h * 0.45));
  } else {
    // Already a label (or a close-up): also try its middle.
    views.push(fit(img, b.x + b.w * 0.1, b.y + b.h * 0.1, b.w * 0.8, b.h * 0.8));
  }
  return views;
}

/**
 * The views a camera frame is fingerprinted from: what's inside the on-screen guide, and the
 * guide's middle, so a label held a little too far or too close still matches.
 * `guide` is { x, y, w, h } in the frame's own pixels.
 */
export function frameViews(src, guide) {
  const g = guide;
  return [
    fit(src, g.x, g.y, g.w, g.h, '#000'),
    fit(src, g.x + g.w * 0.12, g.y + g.h * 0.12, g.w * 0.76, g.h * 0.76, '#000'),
  ];
}

const loadImage = src => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('A wine photo couldn’t be read.'));
  img.src = src;
});

// ---------------------------------------------------------------- fingerprint storage

/** A short fingerprint as text for a sheet cell: each number squeezed into one byte. */
export function packVector(v) {
  const bytes = new Uint8Array(v.length);
  for (let i = 0; i < v.length; i++) bytes[i] = Math.max(-127, Math.min(127, Math.round(v[i] * 4 * 127))) + 128;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function unpackVector(text) {
  try {
    const s = atob(String(text));
    if (s.length !== DIM) return null;
    const v = new Float32Array(DIM);
    for (let i = 0; i < DIM; i++) v[i] = (s.charCodeAt(i) - 128) / (4 * 127);
    return normalise(v);
  } catch {
    return null;
  }
}

function normalise(v) {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${text.length}-${(h >>> 0).toString(36)}`;
}

let dbp = null;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('conviviale-labels', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(() => null); // private browsing etc.: work without the cache
  return dbp;
}

async function cacheGet(key) {
  const d = await db();
  if (!d) return null;
  return new Promise(resolve => {
    const req = d.transaction('photos').objectStore('photos').get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function cachePut(key, value) {
  const d = await db();
  if (!d) return;
  await new Promise(resolve => {
    const tx = d.transaction('photos', 'readwrite');
    tx.objectStore('photos').put(value, key);
    tx.oncomplete = tx.onerror = () => resolve();
  });
}

// ---------------------------------------------------------------- the index of known wines

/** Wines' confirmed scans from LABEL_SCANS, newest first, as { ingId: [vector] }. */
function scanVectors() {
  const out = new Map();
  const list = store.rows('LABEL_SCANS').filter(r => String(r.MODEL) === MODEL_TAG)
    .sort((a, b) => String(b.ADDED).localeCompare(String(a.ADDED)));
  for (const r of list) {
    const id = String(r.ING_ID);
    const v = unpackVector(r.VECTOR);
    if (!v) continue;
    if (!out.has(id)) out.set(id, []);
    if (out.get(id).length < MAX_SCANS_PER_WINE) out.get(id).push(v);
  }
  return out;
}

/**
 * Fingerprints for every wine in `wines` that has a photo or a confirmed scan:
 * [{ ingId, vectors }]. New or changed photos are fingerprinted now (`onProgress(done, total)`).
 */
export async function buildIndex(wines, onProgress) {
  await load();
  const scans = scanVectors();
  const todo = [];
  const entries = [];
  for (const w of wines) {
    const id = String(w.ING_ID);
    const photo = photoFor(id);
    const e = { ingId: id, vectors: [...(scans.get(id) || [])] };
    entries.push(e);
    if (!photo) continue;
    const key = `${MODEL_TAG}|${id}|${hash(photo)}`;
    const cached = await cacheGet(key);
    if (cached) e.vectors.push(...cached);
    else todo.push({ e, key, photo });
  }
  let done = 0;
  onProgress?.(done, todo.length);
  for (const t of todo) {
    try {
      const vectors = await embed(photoViews(await loadImage(t.photo)));
      t.e.vectors.push(...vectors);
      await cachePut(t.key, vectors);
    } catch (err) {
      console.warn('Skipped a wine photo', t.e.ingId, err);
    }
    onProgress?.(++done, todo.length);
  }
  return entries.filter(e => e.vectors.length);
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Fingerprint a camera frame and rank the index against it. Returns { vectors, ranked }, where
 * ranked is [{ ingId, score }] best first (score: closest fingerprint, -1 to 1) and `vectors` are
 * the frame's own fingerprints, to save with learn() once the person confirms the wine.
 */
export async function match(index, views) {
  const vectors = await embed(views);
  const ranked = index.map(e => {
    let best = -1;
    for (const q of vectors) for (const r of e.vectors) { const s = dot(q, r); if (s > best) best = s; }
    return { ingId: e.ingId, score: best };
  }).sort((a, b) => b.score - a.score);
  return { vectors, ranked };
}

/**
 * How sure a ranking is: 'sure' when the best wine is clearly ahead, 'maybe' when it's close,
 * 'none' when nothing looks alike. Measured on the wine photos with simulated phone shots: a
 * label scores about 0.77-0.90 against its own wine, while a frame with no label in it (a wall,
 * a shelf) scores at most about 0.56 against anything. Every wine looks fairly alike to the model
 * (the runner-up is often 0.75), so the gap to the second wine is what makes a match sure.
 */
export function confidence(ranked) {
  const [a, b] = ranked;
  if (!a || a.score < 0.6) return 'none';
  const gap = a.score - (b?.score ?? 0);
  return a.score >= 0.68 && gap >= 0.06 ? 'sure' : 'maybe';
}

/** Remember a confirmed scan (its first view: the label inside the guide) for this wine. */
export async function learn(ingId, vectors, index) {
  const v = vectors?.[0];
  if (!v) return;
  const entry = index?.find(e => e.ingId === String(ingId));
  if (entry) entry.vectors.unshift(v);
  else index?.push({ ingId: String(ingId), vectors: [v] });
  await store.create('LABEL_SCANS', { ING_ID: ingId, MODEL: MODEL_TAG, VECTOR: packVector(v), ADDED: new Date().toISOString() });
  // Keep the newest few per wine; older ones only take up room.
  const old = store.rows('LABEL_SCANS').filter(r => String(r.ING_ID) === String(ingId) && String(r.MODEL) === MODEL_TAG)
    .sort((a, b) => String(b.ADDED).localeCompare(String(a.ADDED))).slice(MAX_SCANS_PER_WINE);
  if (old.length) await store.remove({ LABEL_SCANS: old.map(r => r.SCAN_ID) });
}
