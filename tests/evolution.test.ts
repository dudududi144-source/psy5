/**
 * PSY6 v0.9.0 P2 — per-bar evolution tests (pure — no audio context).
 *
 *  - OFF contract (strict): evolution OFF/absent → songSchedule evHash ==
 *    the pinned post-P1 OFF baseline (byte-identical output — the exact
 *    event list the pre-v0.9.0 engine produced)
 *  - ON: deterministic (replay equality), intensity-0 == OFF, event diff
 *    vs OFF ≥ 200 of 4385 (gate seed measured with margin)
 *  - op hygiene: added events respect clamps; bass roll notes stay on the
 *    progression's chord (harmony respected); lane-covered lock pairs are
 *    never overridden (precedence: snapshot → evolution → lanes)
 *  - live bar mapping: absBarOf walks the arranger position exactly
 */
import { describe, expect, test } from 'bun:test'
import { compose } from '../js/composer.js'
import { songSchedule, evHash, songSteps } from '../js/bounce.js'
import { SCALES, stepEvents } from '../js/model.js'
import { evolutionState, evolutionSeedOf, evolvedSongEvents, evolvedLiveEvents, absBarOf } from '../js/evolution.js'

const SEED = 424242
const OFF_PIN = 'c245905f6e918e8' /* post-v0.29.0 OFF baseline (pad bed spread-voicing third, psyreason dc072ca port → more pad events; v0.27.0 value b904778b234b387c / 4325 events recorded here) */
const GATE_SEED = 777
const GATE_MIN_DIFF = 200

const clone = (p: any) => JSON.parse(JSON.stringify(p))

function withEvolution(p: any, on: boolean, intensity: number, seed?: number) {
  evolutionState(p)
  p.evolution.on = on
  p.evolution.intensity = intensity
  if (seed != null) p.evolution.seed = seed
  return p
}

const evKey = (e: any) => e.s + '|' + e.track
const evSig = (e: any) => JSON.stringify([(e.t ?? 0).toFixed(6), e.vel.toFixed(3), e.note, JSON.stringify(e.lock || {})])

function scheduleDiff(a: any[], b: any[]) {
  const ma = new Map(a.map((e: any) => [evKey(e), evSig(e)]))
  const mb = new Map(b.map((e: any) => [evKey(e), evSig(e)]))
  let d = 0
  for (const [k, v] of ma) if (mb.get(k) !== v) d++
  for (const k of mb.keys()) if (!ma.has(k)) d++
  return d
}

describe('evolution OFF contract (strict determinism)', () => {
  test('OFF → songSchedule evHash == the post-P1 OFF pin (byte-identical schedule)', () => {
    const p = compose('FULL-ON', 3, SEED).project
    expect(p.evolution).toBeUndefined() /* untouched projects gain NO field */
    const sch = songSchedule(clone(p), 0.05)
    expect(sch.evs.length).toBe(4357)
    expect(evHash(sch.evs)).toBe(OFF_PIN)
  })
  test('evolution field present but OFF → identical hash; lazy state is canonical', () => {
    const p = withEvolution(clone(compose('FULL-ON', 3, SEED).project), false, 35)
    const sch = songSchedule(clone(p), 0.05)
    expect(evHash(sch.evs)).toBe(OFF_PIN)
    const st = evolutionState(p)
    expect(st.on).toBe(false)
    expect(st.intensity).toBe(35)
  })
  test('evolution seed defaults to the project seed', () => {
    const p = compose('FULL-ON', 3, SEED).project
    expect(evolutionSeedOf(p)).toBe(String(p.seed))
    const q = withEvolution(clone(p), true, 35, 999)
    expect(evolutionSeedOf(q)).toBe('999')
  })
})

describe('evolution ON (deterministic section morphing)', () => {
  const base = compose('FULL-ON', 3, SEED).project
  const off = songSchedule(clone(base), 0.05)

  test('ON (seed 777, intensity 35) → ≥200 schedule events differ vs OFF', () => {
    const p = withEvolution(clone(base), true, 35, GATE_SEED)
    const on = songSchedule(clone(p), 0.05)
    const d = scheduleDiff(off.evs, on.evs)
    expect(d).toBeGreaterThanOrEqual(GATE_MIN_DIFF)
    expect(on.evs.length).toBeGreaterThan(off.evs.length) /* rolls/ghosts ADD events */
  })
  test('replay determinism: two schedules of the same ON project are hash-identical', () => {
    const p = withEvolution(clone(base), true, 35, GATE_SEED)
    const a = songSchedule(clone(p), 0.05)
    const b = songSchedule(clone(p), 0.05)
    expect(evHash(a.evs)).toBe(evHash(b.evs))
  })
  test('intensity 0 behaves exactly like OFF (hash equality)', () => {
    const p = withEvolution(clone(base), true, 0, GATE_SEED)
    const z = songSchedule(clone(p), 0.05)
    expect(evHash(z.evs)).toBe(OFF_PIN)
  })
  test('different evolution seeds → different schedules (seed actually gates the ops)', () => {
    const a = songSchedule(clone(withEvolution(clone(base), true, 35, 777)), 0.05)
    const b = songSchedule(clone(withEvolution(clone(base), true, 35, 9001)), 0.05)
    expect(evHash(a.evs)).not.toBe(evHash(b.evs))
  })
  test('renderSong-level expansion: evolvedSongEvents is a pure function of (p, abs, phase)', () => {
    const p = withEvolution(clone(base), true, 35, GATE_SEED)
    const c1 = clone(p); const c2 = clone(p)
    const l1 = evolvedSongEvents(c1, 200, 200 % 16).map(evSig).join(';')
    const l2 = evolvedSongEvents(c2, 200, 200 % 16).map(evSig).join(';')
    expect(l1).toBe(l2)
    expect(l1.length).toBeGreaterThan(0)
  })
})

describe('evolution op hygiene', () => {
  const base = compose('FULL-ON', 3, SEED).project

  test('bass roll injections stay on the progression chord (harmony respected)', () => {
    const p = withEvolution(clone(base), true, 80, GATE_SEED) /* high intensity → rolls certain */
    const h = p.harmony
    const scaleIv = SCALES[p.scale]
    const bad: string[] = []
    /* walk the REAL expansion (no clones — evolution never mutates p): every
       evolved bass note must be the chord root of the AUDIBLY active pattern
       bar (floor(phase/16)) — the exact mapping the P1 bake used */
    for (const y of songSteps(p)) {
      const list = evolvedSongEvents(p, y.abs, y.phase)
      for (const e of list) {
        if (e.track !== 4) continue
        const patBar = Math.floor(y.phase / 16)
        const deg = h.degrees[patBar % h.degrees.length]
        const rootPc = scaleIv[deg % 7] % 12 /* chord-root pitch class, relative to p.root */
        if (((e.note - p.root) % 12 + 12) % 12 !== rootPc) bad.push(y.abs + ':' + e.note)
      }
    }
    expect(bad.length).toBe(0)
  })

  test('lane-covered lock pairs are never overridden by evolution creep', () => {
    /* BUILD lane (track 5 cutoff) covers track-5 cutoff locks at EVERY step
       of the BUILD pattern — the evolved schedule must keep those lock
       values exactly at the lane-evaluated levels (lane wins per-step) */
    const p = withEvolution(clone(base), true, 80, GATE_SEED)
    const off = songSchedule(clone(base), 0.05)
    const on = songSchedule(clone(p), 0.05)
    const offLane = off.evs.filter((e: any) => e.track === 5 && e.lock && e.lock.cutoff !== undefined)
    expect(offLane.length).toBeGreaterThan(0) /* the fixture really has lane-covered pairs */
    const onByKey = new Map(on.evs.map((e: any) => [evKey(e), e]))
    for (const e of offLane) {
      const ev2 = onByKey.get(evKey(e))
      if (!ev2) continue /* removed by a density op — fine */
      if (ev2.lock && ev2.lock.cutoff !== undefined) expect(ev2.lock.cutoff).toBe(e.lock.cutoff)
    }
  })

  test('added events respect the model clamps (vel 0.05..1, note 12..108)', () => {
    const p = withEvolution(clone(base), true, 100, GATE_SEED)
    const on = songSchedule(clone(p), 0.05)
    for (const e of on.evs) {
      expect(e.vel).toBeGreaterThanOrEqual(0.05)
      expect(e.vel).toBeLessThanOrEqual(1)
      expect(e.note).toBeGreaterThanOrEqual(12)
      expect(e.note).toBeLessThanOrEqual(108)
    }
  })

  test('evolved schedule is still a valid oracle: sections/totalSteps unchanged', () => {
    const p = withEvolution(clone(base), true, 35, GATE_SEED)
    const off = songSchedule(clone(base), 0.05)
    const on = songSchedule(clone(p), 0.05)
    expect(on.totalSteps).toBe(off.totalSteps)
    expect(on.sections.length).toBe(off.sections.length)
    expect(on.total).toBe(off.total) /* the timing grid never moves */
  })
})

describe('live bar mapping (absBarOf)', () => {
  test('arranger position → absolute bar (matches the offline walk)', () => {
    const p = compose('FULL-ON', 3, SEED).project
    p.arranger.on = true
    p.arranger.idx = 0; p.arranger.barsIn = 0
    expect(absBarOf(p)).toBe(0)
    p.arranger.barsIn = 1
    expect(absBarOf(p)).toBe(0)
    p.arranger.barsIn = 5
    expect(absBarOf(p)).toBe(4)
    /* second step of the arrangement: INTRO is 8 bars for FULL-ON/3min */
    const introBars = p.arranger.steps[0].bars
    p.arranger.idx = 1; p.arranger.barsIn = 0
    expect(absBarOf(p)).toBe(introBars)
    p.arranger.idx = 1; p.arranger.barsIn = 3
    expect(absBarOf(p)).toBe(introBars + 2)
  })
  test('arranger OFF → −1 (no song position → live evolution paused)', () => {
    const p = compose('FULL-ON', 3, SEED).project
    p.arranger.on = false
    expect(absBarOf(p)).toBe(-1)
  })
  test('live wrapper: arranger OFF → base stepEvents (no evolution outside song mode)', () => {
    const p = withEvolution(clone(compose('FULL-ON', 3, SEED).project), true, 80, GATE_SEED)
    p.arranger.on = false
    p.currentPattern = p.scenes[p.arranger.steps[0].scene].pattern
    /* with arranger off, the evolved wrapper returns the base list exactly */
    const a = evolvedLiveEvents(p, 0)
    const b = stepEvents(p, 0)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
