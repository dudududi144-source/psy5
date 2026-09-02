/* ============ SAMPLE STORE (v0.10.0 P1) — user sample library ============
   PCM lives ONLY in IndexedDB, behind an injectable-backend interface (the
   MockMIDI pattern): Bun tests use a memory backend, the device uses
   IndexedDB ('psy6-samples' / store 'samples' / version 1).

   Record (canonical key order — load→save byte stability):
     { id, name, sampleRate, channels, length, durationSec, peak,
       pcm (Float32Array[] per channel), pcmReversed (pre-reversed,
       deterministic), addedAt (wall-clock — non-musical metadata ONLY) }

   Identity: id = 'S' + fnv1a(name + length + sampleRate + first-4096-samples
   hash) — re-importing the same file is IDEMPOTENT (same id, the stored PCM
   is refreshed; no duplicate rows). normalize is applied AFTER hashing so the
   id is independent of the normalize checkbox.

   Persistence split (the contract): project JSON references samples by id +
   metadata (name/durationSec/peak) — NEVER PCM in localStorage or share
   links. File EXPORT may bundle base64 PCM through the explicit guarded
   helper (≤30 MB base64 hard guard). The whole module is DOM-free. */
import { fnv } from './model.js';

export const SAMPLE_CAPS = {
  maxDurSec: 20,          /* longer files refuse at import (toast, documented) */
  maxFileBytes: 50 * 1024 * 1024,   /* 50 MB raw file cap */
  exportMaxBytes: 30 * 1024 * 1024, /* base64 bundle hard guard (EXPORT) */
  normalizePeak: 0.95,
  maxCount: 128,          /* store row cap — a palette, not a DAW library */
};

/* firstSamplesHash — IEEE-754 bits of the first ≤4096 samples of ch0 through
 * fnv1a. Byte-exact deterministic for identical decoded input. */
function firstSamplesHash(pcm) {
  const n = Math.min(4096, pcm.length);
  const f = new Float32Array(n); f.set(pcm.subarray(0, n));
  const u8 = new Uint8Array(f.buffer);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return fnv(s);
}

/* sampleId — deterministic, idempotent re-import (see header). */
export function sampleId(name, sampleRate, length, pcmCh0) {
  return 'S' + fnv(String(name) + ':' + String(length) + ':' + String(sampleRate) + ':' + firstSamplesHash(pcmCh0)).slice(0, 12);
}

/* peakOf — global absolute peak across channels (0 for silence). */
export function peakOf(channels) {
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > peak) peak = a }
  return peak;
}

/* normalizePcm — bake peak → target (0.95 default) at import. Silent PCM is
 * returned untouched (scaling by target/0 is undefined — never NaN). The
 * returned peak is the MEASURED peak of the stored f32 samples (0.95 is not
 * f32-representable — the metadata records what is actually on disk). */
export function normalizePcm(channels, target = SAMPLE_CAPS.normalizePeak) {
  const peak = peakOf(channels);
  if (!(peak > 0)) return { channels, peak: 0 };
  const g = target / peak;
  const out = channels.map(ch => { const o = new Float32Array(ch.length); for (let i = 0; i < ch.length; i++) o[i] = ch[i] * g; return o });
  return { channels: out, peak: peakOf(out) };
}

/* reversedCopy — pre-reversed channel copies (deterministic; the engine uses
 * them for reverse playback — no per-hit reversal allocations). */
export function reversedCopy(channels) {
  return channels.map(ch => { const o = new Float32Array(ch.length); for (let i = 0; i < ch.length; i++) o[i] = ch[ch.length - 1 - i]; return o });
}

/* ── v0.11.0 P2: DERIVED SAMPLES (non-destructive editing) ──
   Edits NEVER mutate the base record: every op bakes a NEW PCM copy into a
   NEW record whose id is DETERMINISTIC: fnv(baseId + ':' + op + ':' +
   canonicalParams). Same base + op + params → SAME id → the store put
   replaces (idempotent re-derivation). Derived-of-derived chains work
   naturally (the id chains from the parent record's id — the effective
   base). Base imports stay byte-immutable; deleting a derived record never
   touches the base, and derived records carry their OWN PCM copies, so they
   keep playing even if the base is later deleted (lineage display only). */
export const DERIVE_MS_MAX = 2000;

/* canonicalDeriveParams — clamp + round to the exact precision that feeds
 * BOTH the id and the math (so the id always describes the actual PCM).
 * fadein/fadeout: {ms} integer 0..2000 · gain: {factor} rounded to 0.001 in
 * 0..2 · normalize/reverse: {} · unknown op → throw (tested). */
export function canonicalDeriveParams(op, params) {
  const p = params || {};
  if (op === 'fadein' || op === 'fadeout') {
    const ms = Math.max(0, Math.min(DERIVE_MS_MAX, Math.round(Number(p.ms) || 0)));
    return { ms };
  }
  if (op === 'gain') {
    const factor = Math.max(0, Math.min(2, Math.round((p.factor == null ? 1 : Number(p.factor)) * 1000) / 1000));
    return { factor };
  }
  if (op === 'normalize' || op === 'reverse') return {};
  throw new Error('unknown derive op: ' + op);
}

/* deriveId — deterministic content-lineage id (NOT content-of-PCM: two
 * derivations of the same base+op+params land on one id; different bases
 * never collide because baseId is part of the hash). */
export function deriveId(baseId, op, params) {
  return 'S' + fnv(String(baseId) + ':' + String(op) + ':' + JSON.stringify(params)).slice(0, 12);
}

function deriveTag(op, p) {
  if (op === 'fadein') return 'fin' + p.ms;
  if (op === 'fadeout') return 'fout' + p.ms;
  if (op === 'gain') return 'g' + p.factor;
  if (op === 'normalize') return 'norm';
  return 'rev';
}

/* pcmFade — exact linear ramp: fade-in multiplies frame i (i < n) by i/n,
 * fade-out multiplies the LAST n frames by (1 - i/n) with i counted from the
 * ramp start. n = round(ms/1000·sampleRate) clamped to [0, len]; n = 0 or
 * silent-length guards → exact copies. Pure: new arrays, input untouched. */
export function pcmFade(channels, ms, sampleRate, fadeOut) {
  const len = channels[0] ? channels[0].length : 0;
  const n = Math.max(0, Math.min(len, Math.round((Math.max(0, ms) / 1000) * sampleRate)));
  return channels.map(ch => {
    const o = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      let g = 1;
      if (n > 0) {
        if (!fadeOut && i < n) g = i / n;
        else if (fadeOut && i >= ch.length - n) g = (ch.length - 1 - i) / n;
      }
      o[i] = ch[i] * g;
    }
    return o;
  });
}

/* pcmGain — pure multiply (no clamping: the peak metadata reports the real
 * value and NORMALIZE is the dedicated fix-up op). */
export function pcmGain(channels, factor) {
  return channels.map(ch => { const o = new Float32Array(ch.length); for (let i = 0; i < ch.length; i++) o[i] = ch[i] * factor; return o });
}

/* deriveSample — build the derived record (base untouched). addedAt is
 * wall-clock metadata (allowed: non-musical, never part of the id).
 * v0.11.0 op 'slice': runs detectTransients and stores the boundaries as
 * metadata (kind 'sliced') — the record SHARES the base PCM arrays (no PCM
 * duplication; records are treated immutable); the id hashes the DETECTED
 * pcts, so re-detection of the same base is idempotent. */
export function deriveSample(rec, op, params) {
  if (op === 'slice') {
    const det = detectTransients(rec.pcm, rec.sampleRate);
    const p = { pcts: det.pcts };
    return {
      id: deriveId(rec.id, 'slice', p),
      name: (String(rec.name || 'sample') + '·sliced' + (det.pcts.length - 2)).slice(0, 32),
      sampleRate: rec.sampleRate,
      channels: rec.channels,
      length: rec.length,
      durationSec: rec.durationSec,
      peak: rec.peak,
      pcm: rec.pcm,
      pcmReversed: rec.pcmReversed || reversedCopy(rec.pcm),
      addedAt: Date.now(),
      derivedFrom: rec.id,
      derivedOp: 'slice',
      derivedParams: p,
      kind: 'sliced',
    };
  }
  const p = canonicalDeriveParams(op, params);
  const id = deriveId(rec.id, op, p);
  let channels;
  if (op === 'fadein') channels = pcmFade(rec.pcm, p.ms, rec.sampleRate, false);
  else if (op === 'fadeout') channels = pcmFade(rec.pcm, p.ms, rec.sampleRate, true);
  else if (op === 'gain') channels = pcmGain(rec.pcm, p.factor);
  else if (op === 'normalize') channels = normalizePcm(rec.pcm, SAMPLE_CAPS.normalizePeak).channels;
  else channels = reversedCopy(rec.pcm); /* reverse */
  return {
    id,
    name: (String(rec.name || 'sample') + '·' + deriveTag(op, p)).slice(0, 32),
    sampleRate: rec.sampleRate,
    channels: rec.channels,
    length: rec.length,
    durationSec: rec.durationSec,
    peak: peakOf(channels),
    pcm: channels,
    pcmReversed: reversedCopy(channels),
    addedAt: Date.now(),
    derivedFrom: rec.id,
    derivedOp: op,
    derivedParams: p,
  };
}

/* guardImport — the documented import caps. Pure; the UI toasts the reason. */
export function guardImport(fileBytes, durationSec) {
  if (!(fileBytes >= 1)) return { ok: false, reason: 'empty file' };
  if (fileBytes > SAMPLE_CAPS.maxFileBytes) return { ok: false, reason: 'file exceeds the 50 MB cap' };
  if (!(durationSec > 0)) return { ok: false, reason: 'no audio decoded' };
  if (durationSec > SAMPLE_CAPS.maxDurSec) return { ok: false, reason: 'sample exceeds the 20 s cap (' + durationSec.toFixed(1) + 's)' };
  return { ok: true };
}

/* makeRecord — builds the canonical record (key order fixed). normalize is a
 * caller choice (baked here, after the id is computed from RAW samples). */
export function makeRecord(name, sampleRate, channels, opts) {
  opts = opts || {};
  const len = channels[0].length;
  const dur = len / sampleRate;
  const id = sampleId(name, sampleRate, len, channels[0]);
  let pcm = channels, peak = peakOf(channels);
  if (opts.normalize && peak > 0) { const n = normalizePcm(channels); pcm = n.channels; peak = n.peak }
  return {
    id,
    name: String(name == null || name === '' ? 'sample' : name).slice(0, 32),
    sampleRate: sampleRate | 0,
    channels: pcm.length,
    length: len,
    durationSec: dur,
    peak,
    pcm,
    pcmReversed: reversedCopy(pcm),
    addedAt: opts.addedAt == null ? null : opts.addedAt, /* wall-clock metadata only */
  };
}

/* ── backends ── */
export function memoryBackend() {
  const m = new Map();
  return {
    kind: 'memory',
    async put(r) { m.set(r.id, r); return r.id },
    async get(id) { return m.get(id) || null },
    async delete(id) { return m.delete(id) },
    async list() { return Array.from(m.values()).sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0) || (a.name < b.name ? -1 : 1)) },
    async estimate() { let usage = 0; for (const r of m.values()) usage += r.length * r.channels * 4 * 2; return { usage, quota: 0 } },
  };
}

export function idbBackend() {
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const rq = indexedDB.open('psy6-samples', 1);
      rq.onupgradeneeded = () => { const d = rq.result; if (!d.objectStoreNames.contains('samples')) d.createObjectStore('samples', { keyPath: 'id' }) };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error || new Error('idb open failed'));
    });
    return dbp;
  }
  const tx = async (mode, fn) => {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('samples', mode);
      const st = t.objectStore('samples');
      let out;
      try { out = fn(st) } catch (e) { rej(e); return }
      t.oncomplete = () => res(out && out._v !== undefined ? out._v : out);
      t.onerror = () => rej(t.error || new Error('idb tx failed'));
    });
  };
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) });
  return {
    kind: 'indexeddb',
    async put(r) { await tx('readwrite', st => st.put(r)); return r.id },
    async get(id) { return tx('readonly', st => req(st.get(id))) },
    async delete(id) { return tx('readwrite', st => req(st.delete(id))) },
    async list() { const rows = await tx('readonly', st => req(st.getAll())); return rows.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0) || (a.name < b.name ? -1 : 1)) },
    async estimate() { try { return await navigator.storage.estimate() } catch (e) { return { usage: 0, quota: 0 } } },
  };
}

/* createSampleStore — injectable backend (tests: memoryBackend(); device:
 * IndexedDB). The store is the ONLY PCM owner outside the engine cache. */
export function createSampleStore(backend) {
  const b = backend || (typeof indexedDB !== 'undefined' ? idbBackend() : memoryBackend());
  return {
    backend: b.kind,
    put: (r) => b.put(r),
    get: (id) => b.get(id),
    delete: (id) => b.delete(id),
    list: () => b.list(),
    estimate: () => b.estimate(),
  };
}

/* ── base64 PCM codec (file EXPORT bundling) — chunked, DOM-free ── */
export function pcmToB64(f32) {
  const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToPcm(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return new Float32Array(u8.buffer);
}

/* exportBundle — collect every sample referenced by the project's tracks and
 * emit base64 records + the total bundle size (for the ≤30 MB hard guard).
 * MISSING ids are reported honestly (the exported file stays metadata-only
 * for them — the importer falls back to synth). Pure w.r.t. the store. */
export async function exportBundle(p, store) {
  const ids = [];
  const seen = new Set();
  for (const t of (p && p.tracks) || []) if (t && t.sampleId && !seen.has(t.sampleId)) { seen.add(t.sampleId); ids.push(t.sampleId) }
  const records = []; const missing = []; let rawBytes = 0;
  for (const id of ids) {
    const r = await store.get(id);
    if (!r) { missing.push(id); continue }
    const b64 = r.pcm.map(pcmToB64);
    rawBytes += r.length * r.channels * 4;
    records.push({ id: r.id, name: r.name, sampleRate: r.sampleRate, channels: r.channels, length: r.length, durationSec: r.durationSec, peak: r.peak, pcmB64: b64, addedAt: r.addedAt });
  }
  const b64Bytes = Math.ceil(rawBytes * 4 / 3);
  return { ok: true, records, missing, rawBytes, b64Bytes, overCap: b64Bytes > SAMPLE_CAPS.exportMaxBytes };
}

/* importBundle — decode + put bundled records into the store (idempotent:
 * same ids). Returns the count stored. */
export async function importBundle(samples, store) {
  if (!Array.isArray(samples)) return 0;
  let n = 0;
  for (const s of samples) {
    try {
      if (!s || typeof s.id !== 'string' || !Array.isArray(s.pcmB64)) continue;
      const pcm = s.pcmB64.map(b64ToPcm);
      const rec = {
        id: s.id, name: String(s.name || 'sample').slice(0, 32), sampleRate: s.sampleRate | 0,
        channels: pcm.length, length: pcm[0].length, durationSec: pcm[0].length / (s.sampleRate | 0),
        peak: +s.peak || peakOf(pcm), pcm, pcmReversed: reversedCopy(pcm), addedAt: s.addedAt || null,
      };
      await store.put(rec); n++;
    } catch (e) { /* a corrupt record never blocks the project load */ }
  }
  return n;
}

/* referencedSampleIds — unique sample ids referenced by tracks, in track
 * order (hydrate + delete-warn + export all use this one walk). */
export function referencedSampleIds(p) {
  const out = []; const seen = new Set();
  for (const t of (p && p.tracks) || []) if (t && t.sampleId && !seen.has(t.sampleId)) { seen.add(t.sampleId); out.push(t.sampleId) }
  return out;
}

/* ── sample VOICE model (v0.10.0 P2) ──
   track.voiceMode 'synth' (default) | 'sample'; track.sampleId;
   track.sampleParams = { gain 0..2 (1), tune −24..+24 st (0),
     startPct 0..100 (0), endPct 0..100 (100), reverse 0/1 (0),
     attackMs 0..100 (0), releaseMs 0..500 (20) }.
   ensureVoice backfills + clamps IN PLACE (canonical key order on creation
   → load→save byte stability, the loadProjectObj pattern). */
export const SAMPLE_PARAM_DEFAULTS = { gain: 1, tune: 0, startPct: 0, endPct: 100, reverse: 0, attackMs: 0, releaseMs: 20, sliceIdx: 0 };
export const SAMPLE_PARAM_RANGES = { gain: [0, 2], tune: [-24, 24], startPct: [0, 100], endPct: [0, 100], reverse: [0, 1], attackMs: [0, 100], releaseMs: [0, 500], sliceIdx: [0, 16] };

export function ensureVoice(t) {
  if (!t || typeof t !== 'object') return t;
  if (t.voiceMode !== 'sample') t.voiceMode = 'synth';
  if (t.sampleId != null && typeof t.sampleId !== 'string') t.sampleId = null;
  if (t.sampleMeta != null && (typeof t.sampleMeta !== 'object' || Array.isArray(t.sampleMeta))) t.sampleMeta = null;
  if (!t.sampleParams || typeof t.sampleParams !== 'object' || Array.isArray(t.sampleParams)) t.sampleParams = {};
  const sp = t.sampleParams;
  for (const k of Object.keys(SAMPLE_PARAM_DEFAULTS)) {
    const [lo, hi] = SAMPLE_PARAM_RANGES[k];
    let v = sp[k];
    if (v == null || !isFinite(v)) v = SAMPLE_PARAM_DEFAULTS[k];
    v = Math.min(hi, Math.max(lo, v));
    if (k === 'reverse') v = v >= 0.5 ? 1 : 0;
    else if (k === 'attackMs' || k === 'releaseMs') v = Math.round(v);
    else v = Math.round(v * 1000) / 1000;
    sp[k] = v;
  }
  return t;
}

/* applySampleHints — resolve the composer's sample hints ({trackIdx →
 * name}) against the store: a hit applies the SAMPLE voice (voiceMode +
 * sampleId + sampleMeta) to that track; a miss is reported honestly (the
 * caller toasts; the synth voice keeps playing). NEVER throws; never
 * touches tracks without hints. Idempotent per (name→id) resolution. */
export async function applySampleHints(p, store) {
  const out = { applied: 0, appliedNames: [], missing: [] };
  const hints = p && p.sampleHints;
  if (!hints || typeof hints !== 'object' || Array.isArray(hints)) return out;
  let rows = null;
  for (const k of Object.keys(hints)) {
    const idx = +k;
    const name = String(hints[k] || '').trim();
    const t = p.tracks[idx];
    if (!t || !name) continue;
    if (!rows) rows = await store.list();
    const rec = rows.find(r => r.name === name);
    ensureVoice(t);
    if (rec) {
      t.voiceMode = 'sample';
      t.sampleId = rec.id;
      t.sampleMeta = { name: rec.name, durationSec: rec.durationSec, peak: rec.peak };
      out.applied++; out.appliedNames.push(name);
    } else {
      out.missing.push(name + ' (track ' + idx + ')');
    }
  }
  return out;
}

/* samplePlayback — PURE playback math: tune semitones → rate, pct slice →
 * buffer-time window. tune +12 → the wall-clock support HALVES (rate 2).
 * endPct ≤ startPct is clamped to a full slice (never a zero-length hit).
 * v0.11.0 P3: optional `pcts` (a SLICED record's boundaries, ascending,
 * first == 0, last == 100). sliceIdx ≥ 1 selects the k-th [pcts[k-1],
 * pcts[k]) window and REPLACES the start/end window (documented: the slice
 * IS the edit); out-of-range sliceIdx clamps to the last slice; sliceIdx 0
 * = the full start/end behavior (unchanged). */
export function samplePlayback(sp, durationSec, pcts) {
  const tune = Math.min(24, Math.max(-24, (sp && sp.tune) || 0));
  const rate = Math.pow(2, tune / 12);
  const si = Math.round((sp && sp.sliceIdx) || 0);
  if (pcts && pcts.length > 1 && si >= 1) {
    const k = Math.min(si, pcts.length - 1);
    const b0 = Math.min(100, Math.max(0, pcts[k - 1]));
    const b1 = Math.min(100, Math.max(b0, pcts[k]));
    return { rate, offsetSec: b0 / 100 * durationSec, durSec: (b1 - b0) / 100 * durationSec / rate, slice: k };
  }
  let s0 = Math.min(100, Math.max(0, (sp && sp.startPct) || 0));
  let s1 = Math.min(100, Math.max(0, (sp && sp.endPct) != null ? sp.endPct : 100));
  if (s1 <= s0) { s0 = 0; s1 = 100 }
  return { rate, offsetSec: s0 / 100 * durationSec, durSec: (s1 - s0) / 100 * durationSec / rate, slice: 0 };
}

/* ── v0.11.0 P3: SLICES — deterministic transient detection ──
   detectTransients — pure energy-flux onset detector (no rng, no time):
   fixed 512-frame hop RMS energy → positive flux → adaptive threshold
   (1.5 × mean flux) → strongest-first greedy pick with a 35 ms minimum
   spacing, capped at SLICE_MAX onsets. Stable tie-break by hop index — the
   same PCM ALWAYS yields the same boundaries (tested). Returns ascending
   pcts (0 and 100 implicit) + the frame positions. */
export const SLICE_MAX = 16;
export const SLICE_HOP = 512;

export function detectTransients(pcm, sampleRate) {
  const d = (Array.isArray(pcm) ? pcm[0] : pcm) || new Float32Array(0);
  const n = d.length;
  const nHops = Math.floor(n / SLICE_HOP);
  if (nHops < 4) return { pcts: [0, 100], frames: [0, n] };
  const en = new Float64Array(nHops);
  for (let h = 0; h < nHops; h++) { let s = 0; const s0 = h * SLICE_HOP; for (let i = s0; i < s0 + SLICE_HOP; i++) { const v = d[i]; s += v * v } en[h] = s / SLICE_HOP }
  const flux = new Float64Array(nHops);
  let mean = 0;
  for (let h = 1; h < nHops; h++) { const f = Math.max(0, en[h] - en[h - 1]); flux[h] = f; mean += f }
  mean /= (nHops - 1);
  const th = Math.max(mean * 1.5, 1e-12);
  const minGap = Math.max(1, Math.round(0.035 * sampleRate / SLICE_HOP));
  const cand = [];
  for (let h = 1; h < nHops; h++) if (flux[h] >= th) cand.push(h);
  cand.sort((a, b) => flux[b] - flux[a] || a - b);
  const picked = [];
  for (const h of cand) { if (picked.length >= SLICE_MAX) break; let ok = true; for (const p of picked) if (Math.abs(p - h) < minGap) { ok = false; break } if (ok) picked.push(h) }
  picked.sort((a, b) => a - b);
  const inner = picked.map(h => Math.round((h * SLICE_HOP / n) * 10000) / 100).filter(p => p > 0 && p < 100);
  const pcts = [0].concat(inner, [100]);
  return { pcts, frames: pcts.map(p => Math.round(p / 100 * n)) };
}
