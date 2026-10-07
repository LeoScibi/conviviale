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

/** Shrink a picked or camera image to a JPEG data URL small enough for one sheet cell. */
export async function fileToPhoto(file) {
  const img = await loadImage(file);
  for (let side = MAX_SIDE; side >= 120; side = Math.round(side * 0.8)) {
    const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // transparent PNGs would otherwise turn black as JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.65, 0.5]) {
      const url = canvas.toDataURL('image/jpeg', quality);
      if (url.length <= MAX_CHARS) return url;
    }
  }
  throw new Error('That picture couldn’t be made small enough to save.');
}
