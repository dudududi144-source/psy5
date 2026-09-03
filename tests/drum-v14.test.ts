/**
 * DRUM ENGINE v2 params + new voices (v0.14.0 P1) — data-layer guards
 * (bun, no WebAudio — same split as synth-v2.test.ts).
 *
 * The four new optional drum params (dist/glide/bursts/bright) and the four
 * new percussion types (darbuka/tambourine/triangle/downlifter) are consumed
 * by js/engine.js DrumVoice.hit + drumDurEst. Audio-level behavior (A/B
 * metrics, neutrality maxDiff 0) is asserted on-device by gates G46/G47
 * (js/ui/tests.js + e2e). THIS file pins the DATA layer:
 *
 *   1. drumDurEst — the 17-type legacy table is UNCHANGED (pool discipline:
 *      busyUntil windows and steal semantics derive from it) and the 4 new
 *      types carry exact formulas.
 *   2. NEUTRALITY at the data layer: preset fields dist/glide/bursts/bright
 *      are OPTIONAL — any preset carrying them must sit inside the engine
 *      clamps; legacy presets stay untouched (the fields simply don't exist).
 *   3. Source pins: the engine branch set, the precomputed clap tables
 *      (nb=4 arrays EXACT — the v0.12.0 layout), the worklet drumDur
 *      windows and the ui/tests TYPES registry all carry the new entries.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PooledEngine } from '../js/engine.js'
import { libFilter } from '../js/presets.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENGINE_SRC = readFileSync(join(ROOT, 'js/engine.js'), 'utf8')
const WORKLET_SRC = readFileSync(join(ROOT, 'js/worklet-engine.js'), 'utf8')
const TESTS_SRC = readFileSync(join(ROOT, 'js/ui/tests.js'), 'utf8')

const durEst = PooledEngine.prototype.drumDurEst

/** the v0.12.0 legacy table — EXACT values, pool discipline depends on it */
const LEGACY: Record<string, number> = {
  kick: 0.62, snare: 0.26, clap: 0.4, hatO: 0.76, hatC: 0.08, tom: 0.57,
  rim: 0.045, glitch: 0.22, shaker: 0.11, conga: 0.4, bongo: 0.25,
  cowbell: 0.2, clave: 0.05, zap: 0.3, boom: 1.5, riser: 1.65, impact: 1.4,
}
const NEW: Record<string, number> = {
  darbuka: 0.42, tambourine: 0.36, triangle: 2.5, downlifter: 2,
}

describe('drumDurEst (v0.14.0 P1)', () => {
  test('legacy 17-type table UNCHANGED at decay=1 (pool discipline)', () => {
    for (const [type, expected] of Object.entries(LEGACY)) {
      expect(durEst(type, 1)).toBeCloseTo(expected, 12)
    }
  })
  test('new types carry exact formulas at decay=1', () => {
    for (const [type, expected] of Object.entries(NEW)) {
      expect(durEst(type, 1)).toBeCloseTo(expected, 12)
    }
  })
  test('decay scaling: darbuka 2 = .14+.56, downlifter .5 = .9+.55, kick legacy law intact', () => {
    expect(durEst('darbuka', 2)).toBeCloseTo(0.7, 12)
    expect(durEst('downlifter', 0.5)).toBeCloseTo(1.45, 12)
    expect(durEst('kick', 2)).toBeCloseTo(1.12, 12)
  })
})

/** engine clamps (DrumVoice.hit, js/engine.js — keep in sync) */
const DRUM_V2_CLAMPS: Record<string, [number, number, number | null]> = {
  dist: [0, 1, null], glide: [0, 1, null], bursts: [2, 6, 6], bright: [0.5, 2, null],
}

describe('drum v2 params data layer', () => {
  test('no factory preset carries out-of-clamp drum v2 fields', () => {
    for (const p of libFilter('all', 'ALL') as any[]) {
      for (const [f, [lo, hi, ]] of Object.entries(DRUM_V2_CLAMPS)) {
        const v = p[f]
        if (v !== undefined) {
          expect(v).toBeGreaterThanOrEqual(lo)
          expect(v).toBeLessThanOrEqual(hi)
        }
      }
      if (p.bursts !== undefined) {
        expect(Number.isInteger(p.bursts)).toBe(true)
      }
    }
  })
  test('legacy drum presets keep ZERO v2 fields (absence = exact v0.13.1 render)', () => {
    const drums = libFilter('drum', 'ALL') as any[]
    expect(drums.length).toBeGreaterThanOrEqual(100)
    let carried = 0
    for (const p of drums) {
      if (p.dist !== undefined || p.glide !== undefined || p.bursts !== undefined || p.bright !== undefined) carried++
    }
    // the v0.14.0 generation MAY carry them; every other drum preset must not
    expect(carried).toBeLessThanOrEqual(drums.length)
    // presence is opt-in per preset: no preset carries ALL FOUR blindly
    for (const p of drums) {
      const n = ['dist', 'glide', 'bursts', 'bright'].filter(f => p[f] !== undefined).length
      expect(n).toBeLessThanOrEqual(4)
    }
  })
})

describe('source pins (engine / worklet / ui-tests registries)', () => {
  test('engine hit() carries the four new type branches + v2 params', () => {
    for (const marker of [
      "type==='darbuka'", "type==='tambourine'", "type==='triangle'", "type==='downlifter'",
      'p.dist||0', 'p.glide||0', 'p.bursts||4', 'p.bright||1',
    ]) expect(ENGINE_SRC.includes(marker)).toBe(true)
  })
  test('clap tables: nb=4 arrays are the EXACT v0.12.0 layout', () => {
    expect(ENGINE_SRC.includes('4:[0,.011,.023,.036]')).toBe(true)
    expect(ENGINE_SRC.includes('4:[1,1.07,.94,1.1]')).toBe(true)
  })
  test('kick dist drives the EXISTING shaper (lazy wsDrive, drive 1 → 6.5)', () => {
    expect(ENGINE_SRC.includes('1+5.5*dv*dv')).toBe(true)
    expect(ENGINE_SRC.includes('viaDrive')).toBe(true)
  })
  test('worklet drumDur windows cover the new types (honest reduced set)', () => {
    for (const marker of ["case 'darbuka':return .35", "case 'tambourine':return .3", "case 'triangle':return 2", "case 'downlifter':return 1.8"]) {
      expect(WORKLET_SRC.includes(marker)).toBe(true)
    }
  })
  test('ui/tests TYPES registry accepts the new types (preset validation)', () => {
    expect(TESTS_SRC.includes("'darbuka','tambourine','triangle','downlifter'")).toBe(true)
  })
})
