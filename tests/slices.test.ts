/* Run 19 P3 — SLICES: deterministic transient detection + slice playback
 * math (audio/lock proofs live in the in-page gate G38). */
import { describe, expect, test } from 'bun:test';
import {
  detectTransients, deriveSample, deriveId, samplePlayback, makeRecord,
  memoryBackend, createSampleStore, SLICE_MAX, SLICE_HOP,
} from '../js/samplestore.js';

/* deterministic synthetic break: exp-decay sine bursts at known frames */
function breakPcm(len: number, truths: number[], sampleRate = 44100) {
  const d = new Float32Array(len);
  for (const t0 of truths) {
    for (let i = t0; i < Math.min(len, t0 + Math.round(0.12 * sampleRate)); i++) {
      const t = (i - t0) / sampleRate;
      d[i] += Math.sin(2 * Math.PI * 220 * t) * Math.exp(-t * 30) * 0.9;
    }
  }
  return d;
}

const SR = 44100;
const LEN = SR * 2; /* 2 s */
const TRUTHS = [0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75].map(s => Math.round(s * SR));
const pcm = [breakPcm(LEN, TRUTHS, SR)];

describe('detectTransients — deterministic energy-flux onsets', () => {
  test('same PCM → IDENTICAL boundaries, twice', () => {
    const a = detectTransients(pcm, SR);
    const b = detectTransients(pcm, SR);
    expect(a.pcts).toEqual(b.pcts);
    expect(a.frames).toEqual(b.frames);
  });
  test('monotonic ascending, 0 first, 100 last, ≤ SLICE_MAX inner boundaries', () => {
    const { pcts } = detectTransients(pcm, SR);
    expect(pcts[0]).toBe(0);
    expect(pcts[pcts.length - 1]).toBe(100);
    for (let i = 1; i < pcts.length; i++) expect(pcts[i]).toBeGreaterThan(pcts[i - 1]);
    expect(pcts.length - 2).toBeLessThanOrEqual(SLICE_MAX);
  });
  test('accuracy: ≥90% of the 8 truth transients detected within ±2 hops', () => {
    const { frames } = detectTransients(pcm, SR);
    const inner = frames.slice(1, -1); /* 0/len are implicit edges */
    let hits = 0;
    for (const t of TRUTHS.slice(1)) { /* truth[0] == frame 0 == implicit edge */
      if (inner.some(f => Math.abs(f - t) <= 2 * SLICE_HOP)) hits++;
    }
    expect(hits / (TRUTHS.length - 1)).toBeGreaterThanOrEqual(0.9);
    expect(hits).toBeGreaterThan(0); /* non-vacuous: the detector actually fired */
  });
  test('tiny/quiet PCM → degenerate [0,100] boundaries (guards, no NaN)', () => {
    const tiny = detectTransients([new Float32Array(3 * SLICE_HOP)], SR);
    expect(tiny.pcts).toEqual([0, 100]);
    const silent = detectTransients([new Float32Array(SLICE_HOP * 10)], SR);
    expect(silent.pcts).toEqual([0, 100]);
  });
});

describe('samplePlayback — sliceIdx windows against record pcts', () => {
  const pcts = [0, 25, 50, 100];
  const dur = 4; /* seconds */
  test('sliceIdx 0 → full start/end window (unchanged path)', () => {
    const r = samplePlayback({ sliceIdx: 0, startPct: 0, endPct: 100 }, dur, pcts);
    expect(r.offsetSec).toBe(0);
    expect(r.durSec).toBeCloseTo(dur, 12);
    expect(r.slice).toBe(0);
  });
  test('sliceIdx 1..N → the k-th [pcts[k-1],pcts[k]) window replaces start/end', () => {
    const r1 = samplePlayback({ sliceIdx: 1 }, dur, pcts);
    expect(r1.offsetSec).toBeCloseTo(0, 12);
    expect(r1.durSec).toBeCloseTo(1, 12); /* 25% of 4 s */
    const r3 = samplePlayback({ sliceIdx: 3 }, dur, pcts);
    expect(r3.offsetSec).toBeCloseTo(2, 12);
    expect(r3.durSec).toBeCloseTo(2, 12); /* slice 3 spans [50,100] = 50% of 4 s */
  });
  test('out-of-range sliceIdx clamps to the LAST slice', () => {
    const r = samplePlayback({ sliceIdx: 9 }, dur, pcts);
    expect(r.slice).toBe(3);
    expect(r.offsetSec).toBeCloseTo(2, 12);
  });
  test('tune still applies inside a slice (rate scales the wall duration)', () => {
    const r = samplePlayback({ sliceIdx: 1, tune: 12 }, dur, pcts);
    expect(r.rate).toBe(2);
    expect(r.durSec).toBeCloseTo(0.5, 12); /* 1 s buffer window at rate 2 */
  });
  test('no pcts → sliceIdx ignored (plain samples never slice)', () => {
    const r = samplePlayback({ sliceIdx: 3, startPct: 10, endPct: 60 }, dur, undefined as any);
    expect(r.slice).toBe(0);
    expect(r.offsetSec).toBeCloseTo(0.4, 12);
  });
});

describe('slice derivation — kind sliced, boundaries metadata, NO PCM duplication', () => {
  test('deriveSample slice: kind/params/pcm identity + deterministic id', () => {
    const base = makeRecord('break', SR, pcm, { normalize: false, addedAt: 0 });
    const s1 = deriveSample(base, 'slice', {});
    const s2 = deriveSample(base, 'slice', {});
    expect(s1.kind).toBe('sliced');
    expect(s1.derivedOp).toBe('slice');
    expect(s1.derivedParams.pcts).toEqual(detectTransients(pcm, SR).pcts);
    expect(s1.id).toBe(s2.id); /* re-detection idempotent */
    expect(s1.id).toBe(deriveId(base.id, 'slice', s1.derivedParams));
    expect(s1.pcm).toBe(base.pcm); /* SAME array reference — no duplication */
    expect(s1.length).toBe(base.length);
    expect(s1.pcmReversed).toBe(base.pcmReversed); /* reused, not copied */
  });
  test('sliced record round-trips through the store with boundaries intact', async () => {
    const store = createSampleStore(memoryBackend());
    const base = makeRecord('break', SR, pcm, { normalize: false, addedAt: 0 });
    const s = deriveSample(base, 'slice', {});
    await store.put(base); await store.put(s);
    const got = await store.get(s.id);
    expect(got).toBeTruthy();
    expect(got!.derivedParams.pcts).toEqual(s.derivedParams.pcts);
    expect(got!.kind).toBe('sliced');
    for (let i = 0; i < LEN; i += 997) expect(got!.pcm[0][i]).toBe(s.pcm[0][i]);
  });
});
