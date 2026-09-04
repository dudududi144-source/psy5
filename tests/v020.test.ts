/**
 * PSY6 v0.20.0 — GROOVES 4→12 + SCALES 5→13 + FILLS 5→8 + the SCALE picker
 *
 * The owner's standing directive: "חסרים הרבה אופציות" (options were
 * lonely) — this run fattens the three choice axes that were thinnest:
 *   1. GROOVES  4→12 — the feel vocabulary (8 new templates, same pure
 *      (t,step,rng,sd,tick) contract, deterministic through the caller's
 *      seeded rng, applied before the probability gate).
 *   2. SCALES   5→13 — three foundation scales existed UNWIRED
 *      (phrygianDominant / doubleHarmonic / minorPentatonic) + five new
 *      foundation voices (lydian / mixolydian / hungarianMinor /
 *      melodicMinor / majorPentatonic). Additive-only: the legacy five keys
 *      stay byte-identical, composer styles untouched (pin discipline).
 *   3. FILLS    5→8 — STUTTER / HOVER / SPIRAL appended; the legacy five
 *      layouts stay byte-identical; the modulo generalizes over
 *      FILL_NAMES.length (the last hardcode dies).
 *   4. The SCALE picker (header) — p.scale was NEVER user-editable; the
 *      picker derives from the library itself (the grooveSel discipline).
 * Determinism is sacred: every layout is bun-owned, zero DOM.
 */
import { describe, expect, test } from 'bun:test'
import { GROOVES, SCALES, FILL_NAMES, fillEvents, stepEvents, mulberry32, mkProject } from '../js/model.js'
import { buildStyle } from '../js/presets.js'
import { SCALES as FOUNDATION_SCALES } from '../foundation/music/context.mjs'
import { readFileSync } from 'node:fs'

const idxRoot = new URL('.', import.meta.url).pathname

/* ── 1. GROOVES 4→13 ──────────────────────────────────────────────────── */
describe('groove vocabulary (v0.20.0)', () => {
  const LEGACY = ['straight', 'mpc54', 'psy-push', 'humanize']
  const NEW = ['mpc58', 'shuffle62', 'psy-glide', 'lazy-bass', 'hhlift', 'perc-drag', 'push16', 'laid-back', 'drunk']

  test('13 grooves: the legacy four keep their byte-identical labels, nine arrive', () => {
    expect(Object.keys(GROOVES).length).toBe(13)
    for (const k of LEGACY) expect(GROOVES[k]).toBeDefined()
    for (const k of NEW) expect(GROOVES[k]).toBeDefined()
    expect(GROOVES.straight.label).toBe('Straight')
    expect(GROOVES.mpc54.label).toBe('MPC 54%')
    expect(GROOVES['psy-push'].label).toBe('Psy Push')
    expect(GROOVES.humanize.label).toBe('Humanize')
  })

  test('every groove is deterministic — same rng seed → identical offsets', () => {
    for (const k of Object.keys(GROOVES)) {
      const g = GROOVES[k]
      const sd = 60 / 145 / 4, tick = sd / 64
      const run = () => {
        const rng = mulberry32(777)
        let acc = 0
        for (let t = 0; t < 8; t++) for (let s = 0; s < 16; s++) acc += g.off(t, s, rng, sd, tick)
        return acc
      }
      expect(run()).toBe(run())
    }
  })

  test('every groove stays inside the step: |off| < sd for all tracks/steps', () => {
    for (const k of Object.keys(GROOVES)) {
      const g = GROOVES[k]
      const sd = 60 / 145 / 4, tick = sd / 64
      for (let trial = 0; trial < 8; trial++) {
        const rng = mulberry32(1000 + trial)
        for (let t = 0; t < 8; t++) for (let s = 0; s < 16; s++) {
          const off = g.off(t, s, rng, sd, tick)
          expect(Number.isFinite(off)).toBe(true)
          expect(Math.abs(off)).toBeLessThan(sd)
        }
      }
    }
  })

  test('straight is exactly zero — the reference engine never drifts', () => {
    const rng = mulberry32(1)
    for (let t = 0; t < 8; t++) for (let s = 0; s < 16; s++)
      expect(GROOVES.straight.off(t, s, rng, 0.1, 0.1 / 64)).toBe(0)
  })

  test('swing-structured grooves only touch odd 16ths (mpc58/shuffle62/push16)', () => {
    const sd = 60 / 140 / 4, tick = sd / 64
    for (const k of ['mpc58', 'shuffle62']) {
      const rng = mulberry32(9)
      for (let s = 0; s < 16; s += 2) expect(GROOVES[k].off(1, s, rng, sd, tick)).toBe(0)
    }
    { /* push16: the KICK (t=0) stays locked — the sacred zone */
      const rng = mulberry32(9)
      expect(GROOVES['push16'].off(0, 1, rng, sd, tick)).toBe(0)
      expect(GROOVES['push16'].off(0, 3, rng, sd, tick)).toBe(0)
      expect(GROOVES['push16'].off(1, 1, mulberry32(9), sd, tick)).toBeGreaterThan(0)
    }
  })

  test('track-scoped grooves only touch their lane (psy-glide/lazy-bass=bass, hhlift=hats, perc-drag=perc)', () => {
    const sd = 0.1, tick = sd / 64
    expect(GROOVES['psy-glide'].off(1, 1, mulberry32(3), sd, tick)).toBe(0)
    expect(GROOVES['psy-glide'].off(4, 0, mulberry32(3), sd, tick)).toBeLessThan(0) /* bass AHEAD of the grid */
    expect(GROOVES['lazy-bass'].off(4, 0, mulberry32(3), sd, tick)).toBeGreaterThan(0) /* bass BEHIND the grid */
    expect(GROOVES['lazy-bass'].off(0, 0, mulberry32(3), sd, tick)).toBe(0)
    expect(GROOVES.hhlift.off(2, 0, mulberry32(3), sd, tick)).toBeGreaterThan(0)
    expect(GROOVES.hhlift.off(2, 1, mulberry32(3), sd, tick)).toBe(0) /* odd 16ths untouched */
    expect(GROOVES.hhlift.off(3, 0, mulberry32(3), sd, tick)).toBe(0)
    expect(GROOVES['perc-drag'].off(3, 0, mulberry32(3), sd, tick)).toBeGreaterThan(0)
    expect(GROOVES['perc-drag'].off(2, 0, mulberry32(3), sd, tick)).toBe(0)
  })

  test('stepEvents honors the new grooves through the real path (lazy-bass shifts the bass event)', () => {
    const p = buildStyle('TECHNO', 42)
    p.bpm = 140; p.swing = 0; p.groove = 'straight'
    const pat = p.patterns[p.currentPattern]
    /* silence every lane, then arm ONE bass step so the lane has an event to time */
    for (let t = 0; t < p.tracks.length; t++) if (pat.data[t]) for (const s of pat.data[t].steps) s.on = 0
    pat.data[4].steps[0].on = 1
    const straight = stepEvents(p, 0).filter(e => e.track === 4)
    expect(straight.length).toBe(1)
    p.groove = 'lazy-bass'
    const lazy = stepEvents(p, 0).filter(e => e.track === 4)
    expect(lazy.length).toBe(1)
    expect(lazy[0].off).toBeGreaterThan(straight[0].off)
  })

  test('the groove picker derives from the vocabulary (header.js renders Object.keys)', () => {
    const hd = readFileSync(idxRoot + '../js/ui/header.js', 'utf8')
    expect(hd).toContain("Object.keys(GROOVES).map(k=>'<option")
  })
})

/* ── 2. SCALES 5→13 ───────────────────────────────────────────────────── */
describe('scale vocabulary (v0.20.0)', () => {
  const LEGACY = ['minor', 'major', 'dorian', 'phrygian', 'harmonicMinor']
  const UNWIRED = ['phrygianDominant', 'doubleHarmonic', 'minorPentatonic']
  const NEW = ['lydian', 'mixolydian', 'hungarianMinor', 'melodicMinor', 'majorPentatonic']

  test('13 scales: legacy five byte-identical, three unwired foundation voices arrive, five new', () => {
    expect(Object.keys(SCALES).length).toBe(13)
    for (const k of [...LEGACY, ...UNWIRED, ...NEW]) expect(SCALES[k]).toBeDefined()
    /* legacy byte-identity — additive-only discipline */
    expect(SCALES.minor).toEqual([0, 2, 3, 5, 7, 8, 10])
    expect(SCALES.major).toEqual([0, 2, 4, 5, 7, 9, 11])
    expect(SCALES.dorian).toEqual([0, 2, 3, 5, 7, 9, 10])
    expect(SCALES.phrygian).toEqual([0, 1, 3, 5, 7, 8, 10])
    expect(SCALES.harmonicMinor).toEqual([0, 2, 3, 5, 7, 8, 11])
  })

  test('every scale is the FOUNDATION single-source-of-truth table (never re-implemented)', () => {
    for (const k of Object.keys(SCALES)) {
      const foundationKey = { minor: 'naturalMinor' }[k] || k
      expect(FOUNDATION_SCALES[foundationKey]).toBeDefined()
      expect(SCALES[k]).toEqual(FOUNDATION_SCALES[foundationKey])
    }
  })

  test('every scale is musically valid: ascending, in-range, ends below 12', () => {
    for (const k of Object.keys(SCALES)) {
      const iv = SCALES[k]
      expect(iv.length).toBeGreaterThanOrEqual(5)
      for (let i = 0; i < iv.length; i++) {
        expect(iv[i]).toBeGreaterThanOrEqual(0)
        expect(iv[i]).toBeLessThan(12)
        if (i) expect(iv[i]).toBeGreaterThan(iv[i - 1])
      }
    }
  })

  test('the exotic arrivals carry their signature intervals', () => {
    expect(SCALES.phrygianDominant).toEqual([0, 1, 4, 5, 7, 8, 10]) /* the classic psy dominant */
    expect(SCALES.doubleHarmonic).toEqual([0, 1, 4, 5, 7, 8, 11])
    expect(SCALES.minorPentatonic).toEqual([0, 3, 5, 7, 10])
    expect(SCALES.lydian).toEqual([0, 2, 4, 6, 7, 9, 11]) /* the #4 dream */
    expect(SCALES.hungarianMinor).toEqual([0, 2, 3, 6, 7, 8, 11])
    expect(SCALES.majorPentatonic).toEqual([0, 2, 4, 7, 9])
  })

  test('the scale picker derives from the vocabulary (header.js renders Object.keys(SCALES))', () => {
    const hd = readFileSync(idxRoot + '../js/ui/header.js', 'utf8')
    expect(hd).toContain("Object.keys(SCALES).map(k=>'<option")
    expect(hd).toContain('I.p.scale=e.target.value')
  })

  test('index.html carries the picker with a proper for= label', () => {
    const idx = readFileSync(idxRoot + '../index.html', 'utf8')
    expect(idx).toContain('id="scaleSel"')
    expect(idx).toContain('for="scaleSel"')
  })
})

/* ── 3. FILLS 5→8 ─────────────────────────────────────────────────────── */
describe('fill vocabulary (v0.20.0 additions)', () => {
  test('FILL_NAMES 5→8: the three arrivals append after the legacy five', () => {
    expect(FILL_NAMES).toEqual(['CLASSIC', 'ROLL', 'TOMLINE', 'SNARE16', 'CLIMB', 'STUTTER', 'HOVER', 'SPIRAL'])
  })

  test('STUTTER (5): last-beat tuned 8th stutter — 8 perc hits from step 12, tune wobble', () => {
    const ev = fillEvents(5)
    expect(ev.length).toBe(8)
    expect(ev.every(e => e.track === 3)).toBe(true)
    expect(ev[0].off).toBe(12)
    expect(ev[7].off).toBe(15.5)
    expect(ev.every(e => e.lock.tune >= 0.9 && e.lock.tune <= 1.03)).toBe(true)
  })

  test('HOVER (6): the anti-fill — one hit then dissolve into the vacuum', () => {
    const ev = fillEvents(6)
    expect(ev.length).toBe(3)
    expect(ev[0]).toMatchObject({ track: 3, off: 0, vel: 0.85 })
    expect(ev[1]).toMatchObject({ track: 1, off: 12, vel: 0.5 })
    expect(ev[2].lock.tune).toBe(0.75) /* the falling away */
  })

  test('SPIRAL (7): perc/snare alternating accel — quarters then 8ths, rising', () => {
    const ev = fillEvents(7)
    expect(ev.length).toBe(16)
    expect(ev[0].off).toBe(0); expect(ev[7].off).toBe(7)        /* quarters round */
    expect(ev[8].off).toBe(8); expect(ev[15].off).toBe(11.5)    /* 8ths round */
    expect(ev.filter(e => e.track === 3).length).toBe(8)
    expect(ev.filter(e => e.track === 1).length).toBe(8)
    expect(ev[15].vel).toBeGreaterThan(ev[8].vel)
  })

  test('all eight layouts: deterministic, engine-safe velocities, in-bar offsets', () => {
    for (let t = 0; t < 8; t++) {
      const a = fillEvents(t), b = fillEvents(t)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
      for (const e of a) {
        expect(e.vel).toBeGreaterThan(0)
        expect(e.vel).toBeLessThanOrEqual(1)
        expect(e.off).toBeGreaterThanOrEqual(0)
        expect(e.off).toBeLessThanOrEqual(16)
      }
    }
  })
})
