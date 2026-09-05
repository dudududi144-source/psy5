/**
 * DRUM ENGINE v2 params (v0.14.0 P1) + the FOUNDATION RESET durEst table
 * (v0.30.0) — data-layer guards (bun, no WebAudio — same split as
 * synth-v2.test.ts).
 *
 * The four optional drum params (dist/glide/bursts/bright) are consumed by
 * js/engine.js DrumVoice.hit — the LEGACY SYNTH FALLBACK for the six CORE
 * types (kick snare clap hatC hatO shaker) used when opts.rom=false or a
 * psy4 kit render fails. Audio-level behavior (A/B metrics, neutrality
 * maxDiff 0) is asserted on-device by gates G46/G47; THIS file pins the
 * DATA layer:
 *
 *   1. drumDurEst — the v0.30.0 FOUNDATION RESET table: exactly the 10
 *      psy4 kit types (pool discipline: busyUntil windows and steal
 *      semantics derive from it). The v0.12/v0.14/v0.15 junk-type windows
 *      (tom/rim/conga/crash/revcym/darbuka/…) are DELETED — a dead type
 *      gets the neutral .5 default and must never smuggle a window back.
 *   2. NEUTRALITY at the data layer: preset fields dist/glide/bursts/bright
 *      are OPTIONAL — any preset carrying them must sit inside the engine
 *      clamps; legacy presets stay untouched (the fields simply don't exist).
 *   3. Source pins: the surviving DrumVoice branch set + v2 params, the
 *      precomputed clap tables (nb=4 arrays EXACT — the v0.12.0 layout),
 *      the worklet reduced-set windows for the six core types, and the
 *      ui/tests TYPES registry (now the psy4 kit vocabulary).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PooledEngine } from '../js/engine.js'
import { libFilter } from '../js/presets.js'
import { PSY4_KIT_TYPES } from '../js/psy4kit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENGINE_SRC = readFileSync(join(ROOT, 'js/engine.js'), 'utf8')
const WORKLET_SRC = readFileSync(join(ROOT, 'js/worklet-engine.js'), 'utf8')
const TESTS_SRC = readFileSync(join(ROOT, 'js/ui/tests.js'), 'utf8')

const durEst = PooledEngine.prototype.drumDurEst

/** the v0.30.0 FOUNDATION RESET table — EXACT values at decay=1 */
const TABLE: Record<string, number> = {
  kick: 0.62, snare: 0.26, clap: 0.4, hatO: 0.76, hatC: 0.08, shaker: 0.11,
  riser: 1.65, impact: 1.4, texture: 1.5, downlifter: 2,
}
/** the junk family the reset deleted — the durEst switch must not know them */
const DEAD = ['tom', 'rim', 'glitch', 'conga', 'bongo', 'cowbell', 'clave', 'zap', 'boom',
  'darbuka', 'tambourine', 'triangle', 'crash', 'ride', 'revcym', 'agogo', 'timbale']

describe('drumDurEst (v0.30.0 FOUNDATION RESET table)', () => {
  test('the 10 kit types carry exact windows at decay=1 (pool discipline)', () => {
    expect([...PSY4_KIT_TYPES].sort()).toEqual(Object.keys(TABLE).sort())
    for (const [type, expected] of Object.entries(TABLE)) {
      expect(durEst(type, 1)).toBeCloseTo(expected, 12)
    }
  })
  test('decay scaling: kick 2 = .12+1.0, downlifter .5 = .9+.55, impact .5 = .55+.3, riser ignores decay', () => {
    expect(durEst('kick', 2)).toBeCloseTo(1.12, 12)
    expect(durEst('downlifter', 0.5)).toBeCloseTo(1.45, 12)
    expect(durEst('impact', 0.5)).toBeCloseTo(0.85, 12)
    expect(durEst('riser', 3)).toBeCloseTo(1.65, 12)
    expect(durEst('texture', 3)).toBeCloseTo(1.5, 12)
  })
  test('DEAD types get the neutral default .5 — no junk window survives', () => {
    for (const t of DEAD) {
      expect(durEst(t, 1)).toBeCloseTo(0.5, 12)
      expect(durEst(t, 2)).toBeCloseTo(0.5, 12)
    }
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
    for (const p of drums) {
      const n = ['dist', 'glide', 'bursts', 'bright'].filter(f => p[f] !== undefined).length
      expect(n).toBeLessThanOrEqual(4)
    }
  })
})

describe('source pins (engine / worklet / ui-tests registries)', () => {
  test('DrumVoice.hit carries EXACTLY the six core branches + v2 params (the legacy fallback)', () => {
    for (const marker of [
      "type==='kick'", "type==='snare'", "type==='clap'", "type==='hatC'||type==='hatO'", "type==='shaker'",
      'p.dist||0', 'p.glide||0', 'p.bursts||4', 'p.bright||1',
    ]) expect(ENGINE_SRC.includes(marker)).toBe(true)
    /* the junk family lost its DrumVoice branches in the reset */
    for (const dead of ["type==='tom'", "type==='conga'", "type==='darbuka'", "type==='crash'", "type==='revcym'", "type==='agogo'"]) {
      expect(ENGINE_SRC.includes(dead)).toBe(false)
    }
  })
  test('clap tables: nb=4 arrays are the EXACT v0.12.0 layout', () => {
    expect(ENGINE_SRC.includes('4:[0,.011,.023,.036]')).toBe(true)
    expect(ENGINE_SRC.includes('4:[1,1.07,.94,1.1]')).toBe(true)
  })
  test('kick dist drives the EXISTING shaper (lazy wsDrive, drive 1 → 6.5)', () => {
    expect(ENGINE_SRC.includes('1+5.5*dv*dv')).toBe(true)
    expect(ENGINE_SRC.includes('viaDrive')).toBe(true)
  })
  test('worklet drumDur windows cover the six core types (honest reduced set)', () => {
    for (const marker of ["case 'kick':return .5", "case 'snare':return .25", "case 'clap':return .4", "case 'hatO':return .6", "case 'hatC':return .06", "case 'shaker':return .09"]) {
      expect(WORKLET_SRC.includes(marker)).toBe(true)
    }
  })
  test('ui/tests TYPES registry is the psy4 kit vocabulary (preset validation)', () => {
    expect(TESTS_SRC.includes("'kick','snare','clap','hatC','hatO','shaker','riser','impact','texture','downlifter'")).toBe(true)
  })
})
