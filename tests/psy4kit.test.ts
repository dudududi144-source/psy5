/**
 * PSY4KIT — the FOUNDATION RESET kit adapter (v0.30.0) — render laws.
 *
 * js/psy4kit.mjs is the ONE drum/FX sound source: renderPsy4Pcm over the
 * foundation/psy4 voice classes (psy-foundation v2.0.0 @ edd1e5f), 6 kits
 * × 10 types. THIS file pins the PCM-level laws the engine and the gates
 * rely on:
 *
 *   1. DETERMINISM — same (type, sr, kitId, variant, rootMul) →
 *      byte-identical Float32Array, forever (the mulberry32/FNV-1a law).
 *   2. LEVEL LAW — every render is peak-normalized to kitLevelTarget(type)
 *      (within 2% float tolerance) for ALL 10 types × 2 kits — the kit is
 *      level-coherent out of the box (kick owns the mix peak).
 *   3. ROOT LAW — rootMul:1 is byte-identical to absent; a pitched render
 *      (kick sub+body) MOVES with rootMul; an unpitched render (snare
 *      noise) is rootMul-INVARIANT.
 *   4. CLOSE — every buffer ends at true zero (the 12 ms tail fade), all
 *      samples finite, non-empty.
 *   5. VOCABULARY — an unknown/dead type renders null (the caller counts a
 *      fallback, never lies).
 *   6. MAPPINGS — styleKit (genre → kit), kitWarmTypes (boot order),
 *      kitMeta (6 blurbs), kitTiltBias (dark below, bright above).
 */
import { describe, expect, test } from 'bun:test'
import {
  renderPsy4Pcm, kitLevelTarget, kitRootHzOf, kitTiltBias,
  styleKit, kitWarmTypes, kitMeta, KIT_IDS, DEFAULT_KIT, PSY4_KIT_TYPES,
} from '../js/psy4kit.mjs'

const eqBytes = (a: Float32Array, b: Float32Array) =>
  a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength))
const peakOf = (pcm: Float32Array) => {
  let peak = 0, finite = true
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i]
    if (!Number.isFinite(v)) finite = false
    const ab = Math.abs(v)
    if (ab > peak) peak = ab
  }
  return { peak, finite }
}

const TYPES = [...PSY4_KIT_TYPES]
const KITS_FOR_LAW = ['psy-classic', 'dark-forest']

describe('renderPsy4Pcm — determinism (the seeded-render law)', () => {
  test('same args → byte-identical PCM (kick + texture, 48 kHz and 44.1 kHz)', () => {
    for (const type of ['kick', 'texture']) {
      for (const sr of [48000, 44100]) {
        const a = renderPsy4Pcm(type, sr, { kitId: 'psy-classic' })
        const b = renderPsy4Pcm(type, sr, { kitId: 'psy-classic' })
        expect(a.length).toBeGreaterThan(0)
        expect(eqBytes(a, b)).toBe(true)
      }
    }
  })
  test('the seed covers (kit, type, variant): different kit or variant → different PCM', () => {
    const base = renderPsy4Pcm('kick', 48000, { kitId: 'psy-classic', variant: 0 })
    const otherKit = renderPsy4Pcm('kick', 48000, { kitId: 'dark-forest', variant: 0 })
    const otherVar = renderPsy4Pcm('kick', 48000, { kitId: 'psy-classic', variant: 1 })
    expect(eqBytes(base, otherKit)).toBe(false)
    expect(eqBytes(base, otherVar)).toBe(false)
  })
  test('44.1 kHz renders obey the same laws (deterministic + level-normalized) — the engine keys caches per-sr', () => {
    for (const type of ['kick', 'snare', 'riser']) {
      const a = renderPsy4Pcm(type, 44100, { kitId: 'psy-classic' })
      const b = renderPsy4Pcm(type, 44100, { kitId: 'psy-classic' })
      expect(eqBytes(a, b)).toBe(true)
      const { peak, finite } = peakOf(a)
      expect(finite).toBe(true)
      expect(Math.abs(peak - kitLevelTarget(type)) / kitLevelTarget(type)).toBeLessThanOrEqual(0.02)
    }
    /* the foundation voices run their envelopes at DEFAULT_SR internally, so
       the PCM sample count is sr-independent — the SAMPLE RATE distinction
       lives in the engine cache key ('P4:…@<sr>', pinned in psy4-wiring) and
       in the AudioBuffer the engine creates at ctx.sampleRate. */
    expect(renderPsy4Pcm('kick', 48000, { kitId: 'psy-classic' })!.length)
      .toBe(renderPsy4Pcm('kick', 44100, { kitId: 'psy-classic' })!.length)
  })
})

describe('renderPsy4Pcm — the LEVEL LAW (kit coherence out of the box)', () => {
  test('peak == kitLevelTarget(type) within 2% for all 10 types × 2 kits, all samples finite', () => {
    expect(TYPES.length).toBe(10)
    for (const kit of KITS_FOR_LAW) {
      for (const type of TYPES) {
        const pcm = renderPsy4Pcm(type, 48000, { kitId: kit })!
        expect(pcm).toBeTruthy()
        const { peak, finite } = peakOf(pcm)
        expect(finite).toBe(true)
        const target = kitLevelTarget(type)
        expect(target).toBeGreaterThan(0)
        expect(Math.abs(peak - target) / target).toBeLessThanOrEqual(0.02)
      }
    }
  })
  test('the role hierarchy holds: kick owns the peak, hats/shaker sit clearly under', () => {
    expect(kitLevelTarget('kick')).toBe(1.0)
    expect(kitLevelTarget('hatC')).toBeLessThan(kitLevelTarget('snare'))
    expect(kitLevelTarget('shaker')).toBeLessThan(kitLevelTarget('hatC'))
    expect(kitLevelTarget('unknown-type')).toBe(0)
  })
})

describe('renderPsy4Pcm — the ROOT LAW (the project root transposes pitched layers)', () => {
  test('rootMul 1 ≡ absent (byte-identical)', () => {
    for (const type of ['kick', 'snare', 'texture']) {
      const a = renderPsy4Pcm(type, 48000, { kitId: 'psy-classic' })
      const b = renderPsy4Pcm(type, 48000, { kitId: 'psy-classic', rootMul: 1 })
      expect(eqBytes(a, b)).toBe(true)
    }
  })
  test('rootMul 1.5 MOVES the pitched kick render (clamped into the 40..56 Hz fund window)', () => {
    const base = renderPsy4Pcm('kick', 48000, { kitId: 'psy-classic' })
    const up = renderPsy4Pcm('kick', 48000, { kitId: 'psy-classic', rootMul: 1.5 })
    expect(eqBytes(base, up)).toBe(false)
  })
  test('rootMul does NOT move unpitched layers (snare noise, texture bed)', () => {
    for (const type of ['snare', 'texture', 'hatC']) {
      const a = renderPsy4Pcm(type, 48000, { kitId: 'psy-classic' })
      const b = renderPsy4Pcm(type, 48000, { kitId: 'psy-classic', rootMul: 1.5 })
      expect(eqBytes(a, b)).toBe(true)
    }
  })
  test('kitRootHzOf feeds the engine rootMul division (all 6 kits positive, unknown 0)', () => {
    for (const k of KIT_IDS) expect(kitRootHzOf(k)).toBeGreaterThan(20)
    expect(kitRootHzOf('nope')).toBe(0)
  })
})

describe('renderPsy4Pcm — the CLOSE (zero-ended, bounded buffers)', () => {
  test('every render ends at true zero (|last| < 1e-3) and stays inside the 2.5 s cap', () => {
    for (const kit of KITS_FOR_LAW) {
      for (const type of TYPES) {
        const pcm = renderPsy4Pcm(type, 48000, { kitId: kit })!
        expect(Math.abs(pcm[pcm.length - 1])).toBeLessThan(1e-3)
        expect(pcm.length).toBeLessThanOrEqual(Math.round(2.5 * 48000))
      }
    }
  })
})

describe('renderPsy4Pcm — the VOCABULARY (closed set, honest refusal)', () => {
  test('unknown / DEAD types render null (never a silent lie)', () => {
    expect(renderPsy4Pcm('unknown-type' as any, 48000)).toBe(null)
    /* the junk family the FOUNDATION RESET deleted */
    for (const dead of ['conga', 'bongo', 'cowbell', 'clave', 'rim', 'tom', 'zap', 'boom', 'glitch', 'darbuka', 'tambourine', 'triangle', 'crash', 'ride', 'revcym', 'agogo', 'timbale']) {
      expect(renderPsy4Pcm(dead as any, 48000, { kitId: 'psy-classic' })).toBe(null)
    }
  })
})

describe('kit mappings (styleKit / kitWarmTypes / kitMeta / kitTiltBias)', () => {
  test('styleKit: the genre → kit mapping (case/separator tolerant), unknown → DEFAULT_KIT', () => {
    expect(styleKit('DARK-PSY')).toBe('dark-forest')
    expect(styleKit('dark-psy')).toBe('dark-forest')
    expect(styleKit('darkpsy')).toBe('dark-forest')
    expect(styleKit('FULL-ON')).toBe('psy-classic')
    expect(styleKit('Full-On')).toBe('psy-classic')
    expect(styleKit('HI-TECH')).toBe('hi-tech')
    expect(styleKit('forest')).toBe('forest-organic')
    expect(styleKit('progressive')).toBe('progressive')
    expect(styleKit('TECHNO')).toBe('progressive')
    expect(styleKit('psytrance')).toBe('psy-classic')
    expect(styleKit('no-such-style')).toBe(DEFAULT_KIT)
    expect(styleKit(undefined)).toBe(DEFAULT_KIT)
  })
  test('kitWarmTypes: the 10-type boot order (core drums first, FX last), unknown kit → []', () => {
    for (const k of KIT_IDS) {
      expect(kitWarmTypes(k)).toEqual(['kick', 'snare', 'clap', 'hatC', 'hatO', 'shaker', 'riser', 'impact', 'texture', 'downlifter'])
    }
    expect(kitWarmTypes('nope')).toEqual([])
  })
  test('kitMeta: name + style + blurb exist for all 6 kits, null for unknown', () => {
    expect(KIT_IDS.length).toBe(6)
    for (const k of KIT_IDS) {
      const m = kitMeta(k)!
      expect(m).toBeTruthy()
      expect(m.id).toBe(k)
      expect(m.name.length).toBeGreaterThan(0)
      expect(m.style.length).toBeGreaterThan(0)
      expect(m.blurb.length).toBeGreaterThan(0)
    }
    expect(kitMeta('nope')).toBe(null)
  })
  test('kitTiltBias: dark kits sit below zero, bright kits above, unknown 0', () => {
    expect(kitTiltBias('dark-forest')).toBeLessThan(0)
    expect(kitTiltBias('hi-tech')).toBeGreaterThan(0)
    expect(kitTiltBias('psy-classic')).toBeGreaterThan(0)
    expect(kitTiltBias('nope')).toBe(0)
  })
})
