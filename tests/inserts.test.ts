/**
 * PSY6 v0.10.0 P3 — insert FX tests (pure — no audio context).
 *
 *  - curve determinism + shape: driveCurve (fixed k=10 soft-clip), crushCurve
 *    quantization staircase; cached engine grids are pure functions
 *  - ensureIns: canonical defaults + clamps (the ensureMaster pattern)
 *  - snapshot backfill: MIX_TRACK_FIELDS ins fields normalize + clamp; old
 *    snapshots (absent fields) normalize unchanged
 *  - composer integration: BUILD/RISER insert lanes exist, are deterministic,
 *    the KICK (track 0) NEVER gets inserts (sacred), form-fp unchanged
 *    (steps-only fingerprint), chord/musical layer untouched
 */
import { describe, expect, test } from 'bun:test'
import { driveCurve, crushCurve, driveTrim, CURVE_N } from '../foundation/dsp/inserts.mjs'
import { ensureIns, INS_DEFAULTS, paramApply } from '../js/params.js'
import { compose, sectionsFingerprint } from '../js/composer.js'
import { loadProjectObj } from '../js/state.js'

const clone = (x: any) => JSON.parse(JSON.stringify(x))

describe('insert curves (foundation/dsp/inserts.mjs)', () => {
  test('driveCurve: deterministic, peak-unity, monotone through the origin', () => {
    const a = driveCurve(), b = driveCurve()
    expect(a.length).toBe(CURVE_N)
    for (let i = 0; i < a.length; i++) expect(a[i]).toBe(b[i])   /* bit-identical */
    expect(a[0]).toBeCloseTo(-1, 6)                              /* peak-unity */
    expect(a[CURVE_N - 1]).toBeCloseTo(1, 6)
    const mid = a[(CURVE_N - 1) / 2]
    expect(Math.abs(mid)).toBeLessThan(1e-6)                     /* exact 0 at origin */
    for (let i = 1; i < CURVE_N; i++) expect(a[i]).toBeGreaterThanOrEqual(a[i - 1]) /* monotone */
  })
  test('driveTrim: 0 → 1 (unity), 100 → 10, clamped', () => {
    expect(driveTrim(0)).toBe(1)
    expect(driveTrim(100)).toBeCloseTo(10, 9)
    expect(driveTrim(-5)).toBe(1)
    expect(driveTrim(999)).toBeCloseTo(10, 9)
  })
  test('crushCurve: staircase quantization; fewer bits = fewer levels', () => {
    const c4 = crushCurve(4), c4b = crushCurve(4)
    for (let i = 0; i < c4.length; i++) expect(c4[i]).toBe(c4b[i])
    /* bits=4 → levels=2^(4-1)=8 → round(x·7)/7 spans 15 distinct values */
    const distinct = new Set(Array.from(c4).map(v => v.toFixed(6)))
    expect(distinct.size).toBe(15)
    const c2 = crushCurve(2)
    const distinct2 = new Set(Array.from(c2).map(v => v.toFixed(6)))
    expect(distinct2.size).toBe(3) /* ±1 and 0 */
    const c16 = crushCurve(16)
    const distinct16 = new Set(Array.from(c16).map(v => v.toFixed(6)))
    expect(distinct16.size).toBeGreaterThan(1000) /* near-continuous */
  })
})

describe('ensureIns (canonical model)', () => {
  test('defaults exact-bypass in canonical key order; idempotent', () => {
    const t: any = {}
    ensureIns(t)
    expect(t.ins).toEqual(INS_DEFAULTS)
    expect(Object.keys(t.ins)).toEqual(Object.keys(INS_DEFAULTS))
    const before = JSON.stringify(t)
    ensureIns(t)
    expect(JSON.stringify(t)).toBe(before)
  })
  test('clamps: drive 200→100, crush 1→2, filtOn 9→4 (MOOG), freq 5→20, Q 99→18', () => {
    const t: any = { ins: { drive: 200, crush: 1, filtOn: 9, filtFreq: 5, filtQ: 99 } }
    ensureIns(t)
    expect(t.ins.drive).toBe(100)
    expect(t.ins.crush).toBe(2)
    expect(t.ins.filtOn).toBe(4) /* v0.13.0: 4 = MOOG added to the insert range (0..4) */
    expect(t.ins.filtFreq).toBe(20)
    expect(t.ins.filtQ).toBe(18)
  })
  test('registry write-through: paramApply ins* clamped', () => {
    const t: any = {}
    expect(paramApply(t, 'insDrive', 42)).toBe(42)
    expect(t.ins.drive).toBe(42)
    expect(paramApply(t, 'insCrush', 1)).toBe(2)
    expect(t.ins.crush).toBe(2)
    expect(paramApply(t, 'insFiltOn', 2)).toBe(2)
    expect(t.ins.filtOn).toBe(2)
    expect(paramApply(t, 'insFiltFreq', 5)).toBe(20)
    expect(t.ins.filtFreq).toBe(20)
    expect(paramApply(t, 'insFiltQ', 7)).toBeCloseTo(7, 9)
  })
})

describe('composer insert lanes (v0.10.0)', () => {
  test('BUILD lead/pad + RISER perc lanes exist; kick is SACRED (no ins anywhere)', () => {
    for (const [style, len, seed] of [['FULL-ON', 3, 424242], ['DARK-PSY', 5, 777], ['FOREST', 3, 31337], ['HI-TECH', 8, 999]] as const) {
      const p: any = compose(style, len, seed).project
      /* kick sacred: no ins base state on track 0, no ins lane on track 0 */
      expect(p.tracks[0].ins).toBeUndefined()
      for (const ln of p.lanes) {
        if (ln.param.startsWith('ins')) expect(ln.track).not.toBe(0)
      }
      /* the composer emits ins lanes for the tracked styles */
      const insLanes = p.lanes.filter((l: any) => l.param === 'insFiltFreq' || l.param === 'insDrive')
      expect(insLanes.length).toBeGreaterThanOrEqual(2)
      /* base states: filtOn 1 on the swept tracks (mode-static offline) */
      const t5: any = p.tracks[5], t6: any = p.tracks[6]
      if (t5.ins) { expect(t5.ins.filtOn).toBe(1); expect(t5.ins.drive).toBe(0) }
      if (t6.ins) { expect(t6.ins.filtOn).toBe(1) }
      /* all ins lane values within registry ranges */
      for (const ln of insLanes) for (const pt of ln.pts) {
        if (ln.param === 'insFiltFreq') { expect(pt[1]).toBeGreaterThanOrEqual(20); expect(pt[1]).toBeLessThanOrEqual(20000) }
        if (ln.param === 'insDrive') { expect(pt[1]).toBeGreaterThanOrEqual(0); expect(pt[1]).toBeLessThanOrEqual(100) }
      }
    }
  })
  test('form-fp UNCHANGED (fingerprint is steps-only — lanes are not form)', () => {
    /* v0.9.0 rebuild pin: the composer's structural fingerprint must not move
       when only lanes/ins states are added — the form IS the note data. */
    const p = compose('FULL-ON', 3, 424242).project
    const fp = sectionsFingerprint(p, compose('FULL-ON', 3, 424242).form.sections)
    expect(fp.length).toBeGreaterThan(500)
    /* lanes exist but are invisible to the fingerprint: strip them → same fp */
    const bare = clone(p); bare.lanes = []; delete bare.tracks[5].ins; delete bare.tracks[6].ins; delete bare.tracks[3].ins
    expect(sectionsFingerprint(bare, compose('FULL-ON', 3, 424242).form.sections)).toBe(fp)
  })
  test('compose determinism holds with ins lanes (same seed → identical JSON)', () => {
    const a = JSON.stringify(compose('FULL-ON', 3, 424242))
    const b = JSON.stringify(compose('FULL-ON', 3, 424242))
    expect(a).toBe(b)
  })
  test('loadProjectObj canonicalizes ins (clamped, byte-stable)', () => {
    const p: any = compose('FULL-ON', 3, 424242).project
    const loaded = loadProjectObj(clone(p))
    const t5: any = loaded.tracks[5]
    if (t5.ins) {
      expect(t5.ins.filtOn).toBe(1)
      const again = loadProjectObj(clone(loaded))
      expect(JSON.stringify(again)).toBe(JSON.stringify(loaded))
    }
  })
})
