// Reading the words on a wine label, on the phone, to back up the picture match in
// js/label-match.js. Pictures of labels all look fairly alike to the image model, but the
// producer's name printed on the label rarely lies: a word that belongs to only one wine on the
// list is strong evidence for that wine.
//
// The reader is Tesseract (open-source OCR) running in its own worker. It and its English data
// (about 7 MB) are fetched on first use and kept in the browser's cache, so it works without
// signal afterwards. If it can't load, the scanner carries on with pictures alone.

import { normName } from './recipe-paste.js';

const SCRIPT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const LANG_PATH = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int';

// Words on many labels, or in many wines' names, that say nothing about which wine it is.
const COMMON = new Set(`domaine domaines chateau clos mas maison cave caveau cantina bodega bodegas tenuta
  fils freres frere pere peres brothers sons figli hijos
  vin vins vino wine wines winery vineyard vineyards cellars cellar estate family famille
  de du des la le les et en sur sous di del della dei the of and von und
  rouge blanc rose red white bianco rosso tinto blanco orange sparkling
  cru premier grand villages cote cotes reserve riserva cuvee brut nature extra sec demi
  vieilles vignes old vine vines appellation controlee protegee origine denominazione
  produce product produit france italia italy spain espana england mis bouteille bottled
  contains sulphites sulfites alc vol bib`.split(/\s+/));

let ready = null;

function loadScript() {
  if (window.Tesseract) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('The text reader couldn’t be downloaded.'));
    document.head.append(s);
  });
}

/** Download (first time) and start the text reader. */
export function load() {
  ready ??= (async () => {
    await loadScript();
    const worker = await window.Tesseract.createWorker('eng', 1, { langPath: LANG_PATH });
    // Labels are scattered words in odd fonts, not a page of text.
    await worker.setParameters({ tessedit_pageseg_mode: '11' });
    return worker;
  })().catch(err => { ready = null; throw err; });
  return ready;
}

/**
 * The words in part of a video frame (`box` in the frame's own pixels): grey, contrast stretched
 * and enlarged a little, which helps on dim cellar shots. Returns normalised words of 3+ letters.
 */
export async function readWords(src, box) {
  const worker = await load();
  const k = Math.min(2, 900 / box.w);
  const c = document.createElement('canvas');
  c.width = Math.round(box.w * k);
  c.height = Math.round(box.h * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.filter = 'grayscale(1)';
  ctx.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let lo = 255; let hi = 0;
  for (let i = 0; i < d.length; i += 16) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) { const v = ((d[i] - lo) * 255) / span; d[i] = d[i + 1] = d[i + 2] = v; }
  ctx.putImageData(img, 0, 0);
  const { data } = await worker.recognize(c);
  return [...new Set(normName(data.text).split(' ').filter(w => w.length >= 3 && !/^\d+$/.test(w)))];
}

/**
 * What to look for on each wine's label: the telling words of its producer and name, each
 * weighted by how few wines share it (a word only one wine has counts most).
 * Returns [{ ingId, words: [{ w, weight }] }].
 */
export function buildTextIndex(wines) {
  const wordsOf = w => [...new Set(normName(`${w.PRODUCER || ''} ${w.NAME || ''}`).split(' ')
    .filter(t => t.length >= 3 && !COMMON.has(t) && !/^\d+$/.test(t)))];
  const lists = wines.map(w => ({ ingId: String(w.ING_ID), list: wordsOf(w) }));
  const df = new Map();
  for (const { list } of lists) for (const t of list) df.set(t, (df.get(t) || 0) + 1);
  const n = Math.max(1, wines.length);
  // 1 for a word only this wine has, about 0.7 for one two wines share, under 0.3 for one ten share.
  const weight = w => (Math.log(1 + n / df.get(w)) / Math.log(1 + n)) ** 2;
  return lists.map(({ ingId, list }) => ({ ingId, words: list.map(w => ({ w, weight: weight(w) })) }));
}

function close(a, b) {
  if (a === b) return true;
  if (b.length < 5) return false;
  const allowed = b.length >= 8 ? 2 : 1;
  if (Math.abs(a.length - b.length) > allowed) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > allowed) return false;
    prev = cur;
  }
  return prev[b.length] <= allowed;
}

/**
 * How well the words read off a label fit each wine: { ingId: score }, where a score of about 1
 * is one word that only this wine has (misread letters forgiven in longer words).
 */
export function textScores(textIndex, seen) {
  const out = new Map();
  if (!seen?.length) return out;
  for (const { ingId, words } of textIndex) {
    let s = 0;
    for (const { w, weight } of words) if (seen.some(x => close(x, w))) s += weight;
    if (s) out.set(ingId, s);
  }
  return out;
}
