/**
 * v0.15.0 P1/P2 — PERCUSSION v3 data layer + source pins
 *
 * Owner report (Run 20e): conga (the perc lane of EVERY composer kit) and
 * several perc voices still read low-grade. P1 rebuilt five voices
 * (conga/bongo/tom/cowbell/clave) INSIDE the same pooled DrumVoice nodes;
 * P2 added four NEW voices (crash/revcym/agogo/timbale) + 33 presets.
 * This file pins the data layer of that change; the acoustic evidence
 * lives in gates G48/G49 (offline renders, CI-asserted).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PooledEngine } from '../js/engine.js'
import { libFilter } from '../js/presets.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENGINE_SRC = readFileSync(join(ROOT, 'js/engine.js'), 'utf8')
const WORKLET_SRC = readFileSync(join(ROOT, 'js/worklet-engine.js'), 'utf8')
const TESTS_SRC = readFileSync(join(ROOT, 'js/ui/tests.js'), 'utf8')

const durEst = PooledEngine.prototype.drumDurEst

/** the v0.15.0 new-type windows — EXACT values (pool discipline) */
const V15: Record<string, number> = {
  crash: 3.0, revcym: 1.6, agogo: 0.34, timbale: 0.3,
}

describe('drumDurEst v0.15.0 additions', () => {
  test('four new types carry exact windows at decay=1', () => {
    for (const [type, expected] of Object.entries(V15)) {
      expect(durEst(type, 1)).toBeCloseTo(expected, 12)
    }
  })
  test('decay scaling: crash 1.5 = 1.2+2.7, revcym .5 = .8+.4', () => {
    expect(durEst('crash', 1.5)).toBeCloseTo(3.9, 12)
    expect(durEst('revcym', 0.5)).toBeCloseTo(1.2, 12)
  })
  test('the v0.14 legacy+new tables stay UNCHANGED (pool discipline)', () => {
    expect(durEst('conga', 1)).toBeCloseTo(0.4, 12)
    expect(durEst('bongo', 1)).toBeCloseTo(0.25, 12)
    expect(durEst('tom', 1)).toBeCloseTo(0.57, 12)
    expect(durEst('cowbell', 1)).toBeCloseTo(0.2, 12)
    expect(durEst('clave', 1)).toBeCloseTo(0.05, 12)
    expect(durEst('kick', 1)).toBeCloseTo(0.62, 12)
    expect(durEst('triangle', 1)).toBeCloseTo(2.5, 12)
  })
})

describe('percussion v3 source pins (engine / worklet / ui-tests)', () => {
  test('engine hit() carries the five v3 rebuilds + four new type branches', () => {
    for (const marker of [
      /* v3 rebuilds — the structural signatures of each new model */
      'cf*2.6*bd', 'cf*2.7*bd', 'tf*1.6,when', 'osc2.detune.setValueAtTime((tone-1)*30,when)',
      /* the four new voices */
      "type==='crash'", "type==='revcym'", "type==='agogo'", "type==='timbale'",
      /* crash two-stage shimmer + revcym hard cut */
      'mg.exponentialRampToValueAtTime(vel*.3,when+dur*.4)', 'mg.setValueAtTime(0,when+dur)',
    ]) expect(ENGINE_SRC.includes(marker)).toBe(true)
  })
  test('hit() zero-anchor resets detune (pooled cowbell cannot leak)', () => {
    expect(ENGINE_SRC.includes('this.osc.detune.setValueAtTime(0,when);this.osc2.detune.setValueAtTime(0,when)')).toBe(true)
  })
  test('worklet drumDur windows cover the four new types (honest reduced set)', () => {
    for (const marker of ["case 'crash':return 2.2", "case 'revcym':return 1.4", "case 'agogo':return .3", "case 'timbale':return .28"]) {
      expect(WORKLET_SRC.includes(marker)).toBe(true)
    }
  })
  test('ui/tests TYPES registry accepts the new types (preset validation)', () => {
    expect(TESTS_SRC.includes("'crash','revcym','agogo','timbale'")).toBe(true)
  })
})

describe('v0.15.0 preset data layer', () => {
  const drums = libFilter('drum', 'ALL') as any[]
  const byType = (t: string) => drums.filter(p => p.type === t)

  test('library carries every new type (>=5 crash, >=4 revcym/agogo/timbale)', () => {
    for (const t of ['crash', 'revcym', 'agogo', 'timbale']) {
      expect(byType(t).length).toBeGreaterThanOrEqual(t === 'crash' ? 5 : 4)
    }
  })
  test('all v0.15 presets sit inside the engine clamps', () => {
    const all = libFilter('all', 'ALL') as any[]
    for (const p of all) {
      if (p.tune !== undefined) { expect(p.tune).toBeGreaterThanOrEqual(.3); expect(p.tune).toBeLessThanOrEqual(2) }
      if (p.decay !== undefined) { expect(p.decay).toBeGreaterThanOrEqual(.1); expect(p.decay).toBeLessThanOrEqual(4) }
      if (p.tone !== undefined) { expect(p.tone).toBeGreaterThanOrEqual(.3); expect(p.tone).toBeLessThanOrEqual(2.5) }
      if (p.punch !== undefined) { expect(p.punch).toBeGreaterThanOrEqual(0); expect(p.punch).toBeLessThanOrEqual(1) }
    }
  })
  test('v15 ids unique and genres covered (8/8 across the new blocks)', () => {
    const v15 = drums.filter(p => /^(CR-|RV-|AG-|TB-)/.test(p.id) || /2-/.test(p.id) || /CONGA2|BONGO2|TOM2|COW2|CLAVE2/.test(p.id))
    const ids = new Set(v15.map(p => p.id))
    expect(ids.size).toBe(v15.length)
    const genres = new Set(v15.map(p => p.genre))
    for (const g of ['PSYTRANCE', 'DARK-PSY', 'GOA', 'FULL-ON', 'TECHNO', 'TRANCE', 'PROGRESSIVE', 'HI-TECH']) {
      expect(genres.has(g)).toBe(true)
    }
  })
})
