/* Run 19 P2 — DERIVED SAMPLES (non-destructive editing): pure math + store
 * round-trips (audio proofs live in the in-page gate G37). */
import { describe, expect, test } from 'bun:test';
import {
  canonicalDeriveParams, deriveId, deriveSample, pcmFade, pcmGain,
  peakOf, makeRecord, memoryBackend, createSampleStore, DERIVE_MS_MAX,
} from '../js/samplestore.js';

/* deterministic fixture: constant-1 mono record (fade math is exact on it) */
function constRec(len = 1000, v = 1) {
  const pcm = [new Float32Array(len).map(() => v)];
  return {
    id: 'SBASE0000001', name: 'base', sampleRate: 1000, channels: 1, len: undefined as any,
    length: len, durationSec: len / 1000, peak: v, pcm, pcmReversed: pcm.map(c => c.slice().reverse()), addedAt: 0,
  };
}
const tone = (n: number, f = 0.0) => { const c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = f > 0 ? Math.sin(2 * Math.PI * f * i / 44100) * 0.5 : 0.5; return c };

describe('canonicalDeriveParams — the id and the math see the SAME numbers', () => {
  test('fade ms clamps to 0..2000 and rounds to integer', () => {
    expect(canonicalDeriveParams('fadein', { ms: 3000 })).toEqual({ ms: DERIVE_MS_MAX });
    expect(canonicalDeriveParams('fadeout', { ms: -5 })).toEqual({ ms: 0 });
    expect(canonicalDeriveParams('fadein', { ms: 250.6 })).toEqual({ ms: 251 });
    expect(canonicalDeriveParams('fadein', {})).toEqual({ ms: 0 });
  });
  test('gain clamps 0..2 and rounds to 0.001', () => {
    expect(canonicalDeriveParams('gain', { factor: 1.23456 })).toEqual({ factor: 1.235 });
    expect(canonicalDeriveParams('gain', { factor: 5 })).toEqual({ factor: 2 });
    expect(canonicalDeriveParams('gain', {})).toEqual({ factor: 1 });
  });
  test('normalize/reverse take no params; unknown op throws', () => {
    expect(canonicalDeriveParams('normalize', { ignored: 1 })).toEqual({});
    expect(canonicalDeriveParams('reverse', {})).toEqual({});
    expect(() => canonicalDeriveParams('warp', {})).toThrow(/unknown derive op/);
  });
});

describe('deriveId — deterministic, idempotent, chain-safe', () => {
  test('same base+op+params → same id; different params/op/base → different', () => {
    const a = deriveId('SX', 'fadein', { ms: 250 });
    const b = deriveId('SX', 'fadein', { ms: 250 });
    expect(a).toBe(b);
    expect(a).toMatch(/^S/);
    expect(deriveId('SX', 'fadein', { ms: 251 })).not.toBe(a);
    expect(deriveId('SX', 'fadeout', { ms: 250 })).not.toBe(a);
    expect(deriveId('SY', 'fadein', { ms: 250 })).not.toBe(a);
  });
});

describe('pcmFade — exact linear ramps, pure', () => {
  test('fade-in: o[0]=0, o[n/2]=0.5, o[n-1]<1, o[n]=1 (n=100 @1000 Hz, 100 ms)', () => {
    const rec = constRec(1000, 1);
    const out = pcmFade(rec.pcm, 100, 1000, false);
    const o = out[0];
    expect(o[0]).toBe(0);
    expect(o[50]).toBeCloseTo(0.5, 6); /* f32 storage: ~1e-7 epsilon */
    expect(o[99]).toBeCloseTo(0.99, 6);
    expect(o[100]).toBe(1);
    expect(o[999]).toBe(1);
  });
  test('fade-out: o[len-1]=0, midpoint of the ramp = 0.5, start untouched', () => {
    const rec = constRec(1000, 1);
    const o = pcmFade(rec.pcm, 100, 1000, true)[0];
    expect(o[999]).toBe(0);
    expect(o[999 - 50]).toBeCloseTo(0.5, 6);
    expect(o[900]).toBeCloseTo(0.99, 6);
    expect(o[899]).toBe(1);
    expect(o[0]).toBe(1);
  });
  test('ms=0 → exact copies; ms beyond length clamps to the full length', () => {
    const rec = constRec(1000, 0.7);
    const same = pcmFade(rec.pcm, 0, 1000, false)[0];
    expect(same[0]).toBeCloseTo(0.7, 6); expect(same[999]).toBeCloseTo(0.7, 6);
    const full = pcmFade(rec.pcm, 5000, 1000, false)[0];
    expect(full[0]).toBe(0); expect(full[999]).toBeCloseTo(0.7 * 0.999, 6);
  });
  test('input never mutated', () => {
    const rec = constRec(100, 1);
    const before = rec.pcm[0].slice();
    pcmFade(rec.pcm, 50, 1000, false); pcmGain(rec.pcm, 0.5);
    expect(rec.pcm[0]).toEqual(before);
  });
});

describe('pcmGain — pure multiply', () => {
  test('scales every sample; factor 0 → silence', () => {
    const rec = constRec(4, 0.5);
    expect(pcmGain(rec.pcm, 0.5)[0]).toEqual(new Float32Array([0.25, 0.25, 0.25, 0.25]));
    expect(peakOf(pcmGain(rec.pcm, 0)[0] ? [pcmGain(rec.pcm, 0)[0]] : [])).toBe(0);
  });
});

describe('deriveSample — new record, base untouched, deterministic', () => {
  test('id + PCM identical across two derivations of base+op+params', () => {
    const rec = constRec(500, 0.8);
    const d1 = deriveSample(rec, 'fadein', { ms: 100 });
    const d2 = deriveSample(rec, 'fadein', { ms: 100 });
    expect(d1.id).toBe(d2.id);
    for (let i = 0; i < d1.pcm[0].length; i++) expect(d1.pcm[0][i]).toBe(d2.pcm[0][i]);
  });
  test('lineage fields: derivedFrom/Op/Params set; name carries the op tag ≤32', () => {
    const rec = constRec(500, 0.8);
    const d = deriveSample(rec, 'fadeout', { ms: 250 });
    expect(d.derivedFrom).toBe(rec.id);
    expect(d.derivedOp).toBe('fadeout');
    expect(d.derivedParams).toEqual({ ms: 250 });
    expect(d.name).toContain('fout250');
    expect(d.name.length).toBeLessThanOrEqual(32);
    expect(d.length).toBe(rec.length);
    expect(d.durationSec).toBe(rec.durationSec);
    expect(d.sampleRate).toBe(rec.sampleRate);
  });
  test('BASE IMMUTABILITY: every op leaves rec.pcm byte-identical', () => {
    const rec = constRec(300, 0.9);
    const before = rec.pcm[0].slice();
    deriveSample(rec, 'fadein', { ms: 50 });
    deriveSample(rec, 'fadeout', { ms: 50 });
    deriveSample(rec, 'gain', { factor: 1.5 });
    deriveSample(rec, 'normalize', {});
    deriveSample(rec, 'reverse', {});
    expect(rec.pcm[0]).toEqual(before);
    expect(rec.peak).toBe(0.9);
  });
  test('reverse: derived pcmReversed == original ramp (double reversal)', () => {
    const rec = constRec(200, 1);
    const d = deriveSample(rec, 'reverse', {});
    expect(d.pcm[0][0]).toBe(rec.pcm[0][199]);
    expect(d.pcmReversed[0][0]).toBe(rec.pcm[0][0]);
  });
  test('normalize on real tone: peak → 0.95 (±1e-6), silent base untouched', () => {
    const rec = makeRecord('tone', 44100, [tone(4410, 440)], { normalize: false, addedAt: 0 });
    const d = deriveSample(rec, 'normalize', {});
    expect(Math.abs(d.peak - 0.95)).toBeLessThan(1e-6);
    const silent = makeRecord('sil', 44100, [new Float32Array(100)], { normalize: false, addedAt: 0 });
    const ds = deriveSample(silent, 'normalize', {});
    expect(ds.peak).toBe(0);
    expect(ds.pcm[0]).toEqual(silent.pcm[0]);
  });
});

describe('derived records — store round-trips + chain independence', () => {
  test('2-step chain resolves through the store; delete of the middle keeps the child', async () => {
    const store = createSampleStore(memoryBackend());
    const base = makeRecord('base', 44100, [tone(4410, 440)], { normalize: false, addedAt: 0 });
    const d1 = deriveSample(base, 'gain', { factor: 0.5 });
    const d2 = deriveSample(d1, 'reverse', {});
    expect(d2.derivedFrom).toBe(d1.id);
    await store.put(base); await store.put(d1); await store.put(d2);
    const got2 = await store.get(d2.id);
    expect(got2).toBeTruthy();
    for (let i = 0; i < d2.pcm[0].length; i++) expect(got2!.pcm[0][i]).toBe(d2.pcm[0][i]);
    await store.delete(d1.id);
    const got2b = await store.get(d2.id);
    expect(got2b).toBeTruthy(); /* child carries its OWN PCM copy */
    expect(await store.get(d1.id)).toBeFalsy();
  });
  test('re-derivation is idempotent in the store (same id → replace, count stable)', async () => {
    const store = createSampleStore(memoryBackend());
    const base = makeRecord('base', 44100, [tone(2205, 220)], { normalize: false, addedAt: 0 });
    await store.put(base);
    await store.put(deriveSample(base, 'fadein', { ms: 100 }));
    const rows1 = await store.list();
    await store.put(deriveSample(base, 'fadein', { ms: 100 }));
    const rows2 = await store.list();
    expect(rows2.length).toBe(rows1.length);
  });
});
