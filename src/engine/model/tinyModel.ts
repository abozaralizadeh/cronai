/**
 * CronLex: pure-TypeScript inference for CronAI's tiny on-device model.
 *
 * No native modules, no WASM, no network: the int8 weights live in weights.ts
 * and are decoded once, lazily, on first use (~1-3 ms on a phone).
 *
 *   token -> hashed char n-grams -> EmbeddingBag(mean) -> Dense+ReLU -> Dense -> softmax
 */
import { MODEL } from './weights';

export interface Prediction {
  label: string;
  prob: number;
  /** Top-3 alternatives, useful for debugging/UI. */
  top: { label: string; prob: number }[];
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Minimal base64 -> Int8Array decoder (Hermes/JSC/V8 safe, no atob needed). */
function decodeInt8(b64: string, scale: number): Float32Array {
  const lookup = new Uint8Array(128);
  for (let i = 0; i < B64.length; i++) lookup[B64.charCodeAt(i)] = i;
  let len = b64.length;
  while (len > 0 && b64[len - 1] === '=') len--;
  const outLen = Math.floor((len * 3) / 4);
  const bytes = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const a = lookup[b64.charCodeAt(i)];
    const b = lookup[b64.charCodeAt(i + 1)];
    const c = i + 2 < len ? lookup[b64.charCodeAt(i + 2)] : 0;
    const d = i + 3 < len ? lookup[b64.charCodeAt(i + 3)] : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < outLen) bytes[o++] = (n >> 16) & 255;
    if (o < outLen) bytes[o++] = (n >> 8) & 255;
    if (o < outLen) bytes[o++] = n & 255;
  }
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const v = bytes[i] > 127 ? bytes[i] - 256 : bytes[i];
    out[i] = v * scale;
  }
  return out;
}

/** FNV-1a 32-bit — must match training/train_model.py */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function features(word: string, buckets: number = MODEL.buckets): number[] {
  const s = '<' + word + '>';
  const out = [fnv1a('W:' + word) % buckets];
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i + n <= s.length; i++) out.push(fnv1a(s.slice(i, i + n)) % buckets);
  }
  return out;
}

interface Loaded {
  E: Float32Array;
  W1: Float32Array;
  W2: Float32Array;
  b1: readonly number[];
  b2: readonly number[];
  C: number;
}

let loaded: Loaded | null = null;

function load(): Loaded {
  if (!loaded) {
    loaded = {
      E: decodeInt8(MODEL.E.data, MODEL.E.scale),
      W1: decodeInt8(MODEL.W1.data, MODEL.W1.scale),
      W2: decodeInt8(MODEL.W2.data, MODEL.W2.scale),
      b1: MODEL.b1,
      b2: MODEL.b2,
      C: MODEL.labels.length,
    };
  }
  return loaded;
}

const cache = new Map<string, Prediction>();

/** Predict the canonical schedule word for a single token. */
export function predictToken(word: string): Prediction {
  const hit = cache.get(word);
  if (hit) return hit;
  const { E, W1, W2, b1, b2, C } = load();
  const D = MODEL.emb;
  const H = MODEL.hid;
  const feats = features(word);

  const x = new Float32Array(D);
  for (const f of feats) {
    const off = f * D;
    for (let d = 0; d < D; d++) x[d] += E[off + d];
  }
  for (let d = 0; d < D; d++) x[d] /= feats.length;

  const h = new Float32Array(H);
  for (let j = 0; j < H; j++) {
    let s = b1[j];
    for (let d = 0; d < D; d++) s += x[d] * W1[d * H + j];
    h[j] = s > 0 ? s : 0;
  }

  const logits = new Float32Array(C);
  let max = -Infinity;
  for (let c = 0; c < C; c++) {
    let s = b2[c];
    for (let j = 0; j < H; j++) s += h[j] * W2[j * C + c];
    logits[c] = s;
    if (s > max) max = s;
  }
  let sum = 0;
  for (let c = 0; c < C; c++) {
    logits[c] = Math.exp(logits[c] - max);
    sum += logits[c];
  }
  const ranked: { label: string; prob: number }[] = [];
  for (let c = 0; c < C; c++) ranked.push({ label: MODEL.labels[c], prob: logits[c] / sum });
  ranked.sort((a, b) => b.prob - a.prob);
  const pred: Prediction = { label: ranked[0].label, prob: ranked[0].prob, top: ranked.slice(0, 3) };
  if (cache.size > 500) cache.clear();
  cache.set(word, pred);
  return pred;
}

export const MODEL_INFO = {
  name: MODEL.name,
  version: MODEL.version,
  params: MODEL.params,
  valAccuracy: MODEL.valAccuracy,
  sizeKb: Math.round((MODEL.E.data.length + MODEL.W1.data.length + MODEL.W2.data.length) * 0.75 / 1024),
  minLen: MODEL.minLen,
};
