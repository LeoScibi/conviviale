// Label recognition worker: turns pictures of wine labels into "fingerprints" (vectors) with a small
// image model that runs on the phone itself, so scanning works without signal once the model is
// downloaded. The model (DINOv2 small, ~24 MB) and the runtime are fetched on first use and kept
// in the browser's cache. See js/label-match.js for how fingerprints are compared.
//
// Messages in:  { id, type: 'load' }
//               { id, type: 'embed', images: [{ data, width, height }] }   (RGBA pixels, square)
// Messages out: { id, ok: true, result } | { id, ok: false, error } | { type: 'progress', loaded, total }

import { AutoModel, AutoProcessor, RawImage, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

const MODEL_ID = 'onnx-community/dinov2-small';

env.allowLocalModels = false;
env.useBrowserCache = true;

let loading = null;

function load() {
  if (loading) return loading;
  const files = new Map();
  const progress_callback = p => {
    if (p.status !== 'progress' || !p.total) return;
    files.set(p.file, p);
    let loaded = 0; let total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    postMessage({ type: 'progress', loaded, total });
  };
  loading = (async () => {
    const processor = await AutoProcessor.from_pretrained(MODEL_ID, { progress_callback });
    const model = await AutoModel.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'wasm', progress_callback });
    return { processor, model };
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

function normalise(v) {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/**
 * One fingerprint per picture: the model's summary token (overall look) joined to the average of
 * its patch tokens (detail), each scaled to the same weight.
 */
async function embed(images) {
  const { processor, model } = await load();
  const out = [];
  for (const { data, width, height } of images) {
    const image = new RawImage(new Uint8ClampedArray(data), width, height, 4).rgb();
    const inputs = await processor(image);
    const { last_hidden_state: h } = await model(inputs);
    const [, tokens, dim] = h.dims;
    const x = h.data;
    const cls = normalise(Float32Array.from(x.subarray(0, dim)));
    const mean = new Float32Array(dim);
    for (let t = 1; t < tokens; t++) for (let d = 0; d < dim; d++) mean[d] += x[t * dim + d];
    normalise(mean);
    const v = new Float32Array(dim * 2);
    v.set(cls, 0);
    v.set(mean, dim);
    out.push(normalise(v));
  }
  return out;
}

onmessage = async ({ data: msg }) => {
  try {
    let result;
    if (msg.type === 'load') { await load(); result = true; }
    else if (msg.type === 'embed') result = await embed(msg.images);
    else throw new Error(`Unknown message ${msg.type}`);
    postMessage({ id: msg.id, ok: true, result }, result instanceof Array ? result.map(v => v.buffer) : []);
  } catch (err) {
    postMessage({ id: msg.id, ok: false, error: err?.message || String(err) });
  }
};
