// Photos (currently for wines). There is no file storage behind the app, so a photo is shrunk to a
// small JPEG and kept as text in the PHOTOS tab, one row per item. A sheet cell holds 50,000
// characters, which is enough for a clear thumbnail but not for a full-size picture.

import * as store from './store.js';

const MAX_CHARS = 48000;
const MAX_SIDE = 420;

let index = null;
let indexVersion = -1;

function photoRow(ingId) {
  if (indexVersion !== store.dataVersion()) {
    index = new Map(store.rows('PHOTOS').map(p => [String(p.ING_ID), p]));
    indexVersion = store.dataVersion();
  }
  return index.get(String(ingId)) || null;
}

/** The item's photo as a data URL, or '' if it has none (or the cell holds something else). */
export function photoFor(ingId) {
  const src = String(photoRow(ingId)?.IMAGE ?? '');
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src) ? src : '';
}

/** Save, replace or (with a blank `dataUrl`) remove an item's photo. */
export async function savePhoto(ingId, dataUrl) {
  await store.refresh('PHOTOS');
  const row = photoRow(ingId);
  if (!dataUrl) {
    if (row) await store.remove({ PHOTOS: [row.PHOTO_ID] });
  } else if (row) {
    await store.update('PHOTOS', row.PHOTO_ID, { IMAGE: dataUrl, UPDATED: store.today() });
  } else {
    await store.create('PHOTOS', { ING_ID: ingId, IMAGE: dataUrl, UPDATED: store.today() });
  }
}

/** Save many photos at once: `entries` is [{ ingId, dataUrl }]. Existing photos are replaced. */
export async function savePhotos(entries) {
  await store.refresh('PHOTOS');
  const now = store.today();
  const updates = entries.filter(e => photoRow(e.ingId))
    .map(e => ({ id: photoRow(e.ingId).PHOTO_ID, record: { IMAGE: e.dataUrl, UPDATED: now } }));
  const adds = entries.filter(e => !photoRow(e.ingId)).map(e => ({ ING_ID: e.ingId, IMAGE: e.dataUrl, UPDATED: now }));
  // A few at a time: each photo is tens of kilobytes and the Sheets API caps the size of a request.
  for (let i = 0; i < updates.length; i += 10) await store.updateMany('PHOTOS', updates.slice(i, i + 10));
  for (let i = 0; i < adds.length; i += 10) await store.createMany('PHOTOS', adds.slice(i, i + 10));
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn’t a picture this browser can read.')); };
    img.src = url;
  });
}

/**
 * The part of the picture worth keeping: shop photos often sit a small bottle in a big plain
 * (usually white) square. The background is the colour the four corners share; everything
 * clearly different from it is the subject, and a thin margin is kept around that. A picture
 * whose corners don't agree (a phone photo in the cellar) is kept whole.
 */
function subjectBox(img) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const k = Math.min(1, 240 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const px = (x, y) => { const i = (y * c.width + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  const far = (a, b, t) => Math.abs(a[0] - b[0]) > t || Math.abs(a[1] - b[1]) > t || Math.abs(a[2] - b[2]) > t;
  const corners = [px(1, 1), px(c.width - 2, 1), px(1, c.height - 2), px(c.width - 2, c.height - 2)];
  const bg = corners[0];
  const whole = { x: 0, y: 0, w, h };
  if (corners.some(p => far(p, bg, 12)) || Math.min(...bg) < 200) return whole;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (!far(px(x, y), bg, 24)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return whole;
  const pad = Math.round(0.03 * Math.max(x1 - x0, y1 - y0));
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
  return { x: x0 / k, y: y0 / k, w: (x1 - x0 + 1) / k, h: (y1 - y0 + 1) / k };
}

/**
 * Shrink a picked or camera image to a JPEG data URL small enough for one sheet cell, first
 * trimming any plain background around the bottle so it fills its frame.
 */
export async function fileToPhoto(file) {
  const img = await loadImage(file);
  const box = subjectBox(img);
  for (let side = MAX_SIDE; side >= 120; side = Math.round(side * 0.8)) {
    const scale = Math.min(1, side / Math.max(box.w, box.h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(box.w * scale));
    canvas.height = Math.max(1, Math.round(box.h * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // transparent PNGs would otherwise turn black as JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.65, 0.5]) {
      const url = canvas.toDataURL('image/jpeg', quality);
      if (url.length <= MAX_CHARS) return url;
    }
  }
  throw new Error('That picture couldn’t be made small enough to save.');
}
