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
