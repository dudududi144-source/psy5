/**
 * PSY6 TRANSITIONS v1 tests (v0.16.0 — smooth section hand-offs).
 *
 * The owner's field report: transitions between built sections "don't go
 * smoothly from one to the next". js/transition.js adds the optional
 * scene.trans vocabulary (riser bars / revcym / impact / bass-cut / xfade
 * beats). v0.30.0 (FOUNDATION RESET): the revcym TYPE is deleted from the
 * psy4 kit — the CONFIG KEY survives (saved projects) but the swell role
 * now fires a 'riser' hit one bar before the boundary. These tests verify
 * the PURE layer without Web Audio:
 *
 *   - normalizeTrans: clamping, canonical stability, empty → null (legacy)
 *   - sceneSetTrans round-trip through the real scene primitive
 *   - xfadeTc: legacy-neutral default (0.02), N-beat span = N·sd/3
 *   - cutSpan: the last-2-steps window, clamped at 0
 *   - transEvents: step math (impact at S, the swell (revcym config →
 *     riser type since v0.30.0) at S-16, riser sweep ends ON the boundary,
 *     2-bar stack), missing voice type → element skipped, clamped at song
 *     start
 *   - planTransLive: lookahead gates (0 → impact only), cut window in
 *     seconds, sorted output
 *   - songSchedule integration: trans events appear on the schedule at the
 *     right absolute steps, bass events vanish in the cut window, the LAST
 *     section gets no hand-off, and a trans-free project keeps a
 *     BYTE-IDENTICAL schedule (the legacy contract)
 *   - determinism: same fixture → identical schedule hash, twice
 */
import { describe, expect, test } from 'bun:test'
import { normalizeTrans, xfadeTc, findTransTrack, cutSpan, transEvents, planTransLive } from '../js/transition.js'
import { sceneSetTrans } from '../js/scenes.js'
import { songSchedule, evHash } from '../js/bounce.js'
import { compose } from '../js/composer.js'

describe('transition normalize', () => {
  test('clamps fields into canonical order', () => {
    const n = normalizeTrans({ riser: 9, revcym: 5, impact: 'yes', cut: 1, xfade: 99 })
    expect(n).toEqual({ riser: 2, revcym: 1, impact: 1, cut: 1, xfade: 8 })
  })
  test('garbage / empty / all-zero → null (legacy shape, no trans field)', () => {
    expect(normalizeTrans(null)).toBe(null)
    expect(normalizeTrans('x')).toBe(null)
    expect(normalizeTrans({})).toBe(null)
    expect(normalizeTrans({ riser: 0, revcym: 0, impact: 0, cut: 0, xfade: 0 })).toBe(null)
  })
  test('deterministic: same input → same canonical object', () => {
    const a = normalizeTrans({ riser: 1, xfade: 2.005 })
    const b = normalizeTrans({ riser: 1, xfade: 2.005 })
    expect(a).toEqual(b)
    expect(a.xfade).toBe(2.01) /* 2-decimal canonical rounding */
  })
  test('sceneSetTrans round-trip (real primitive, canonical write, null clears)', () => {
    const p: any = { scenes: [{ name: 'A', pattern: 0 }], tracks: [] }
    expect(sceneSetTrans(p, 0, { riser: 3, revcym: 1 })).toBe(true)
    expect(p.scenes[0].trans).toEqual({ riser: 2, revcym: 1, impact: 0, cut: 0, xfade: 0 })
    expect(sceneSetTrans(p, 0, null)).toBe(true)
    expect(p.scenes[0].trans).toBeUndefined()
  })
})

describe('xfade + cut primitives', () => {
  const sd = 60 / 140 / 4
  test('xfadeTc: absent/0 → the EXACT legacy 0.02 s', () => {
    expect(xfadeTc(undefined, sd)).toBe(0.02)
    expect(xfadeTc(null, sd)).toBe(0.02)
    expect(xfadeTc({ xfade: 0 }, sd)).toBe(0.02)
  })
  test('xfadeTc: N beats → τ = 4N·sd/3 (~95% at 3τ; a beat is 4 steps)', () => {
    expect(xfadeTc({ xfade: 2 }, sd)).toBeCloseTo(8 * sd / 3, 12)
    expect(xfadeTc({ xfade: 8 }, sd)).toBeCloseTo(32 * sd / 3, 12)
  })
  test('cutSpan: last 2 steps, clamped at 0', () => {
    expect(cutSpan(64)).toEqual([62, 64])
    expect(cutSpan(1)).toEqual([0, 1])
  })
})

describe('transEvents (offline full-knowledge path)', () => {
  const sd = 60 / 140 / 4
  const find = (type: string) => ({ riser: 9, impact: 11 } as any)[type] ?? -1
  test('impact at S, the swell (revcym config → riser since v0.30.0) one bar before, main sweep ENDS on the boundary', () => {
    const evs = transEvents({ riser: 1, revcym: 1, impact: 1, cut: 0, xfade: 0 }, 64, sd, find)
    const byKind: Record<string, any[]> = {}
    for (const e of evs) (byKind[e.kind] = byKind[e.kind] || []).push(e)
    expect(byKind.impact[0].absStep).toBe(64)
    expect(byKind.impact[0].track).toBe(11)
    /* the revcym CONFIG KEY survives (saved projects); the element fires the
       RISER type one bar before the boundary — v0.30.0 vocabulary law */
    const swell = byKind.riser.find((e: any) => e.absStep === 48)
    expect(swell).toBeTruthy()
    expect(swell.track).toBe(9) /* resolved by TYPE 'riser' — a revcym track no longer exists */
    expect(swell.vel).toBeCloseTo(.85, 12)
    /* main sweep lands ON the boundary (the under-swell sits one bar earlier) */
    const sweep = Math.round(1.6 / sd)
    const main = byKind.riser.find((e: any) => e.absStep === 64 - sweep)
    expect(main).toBeTruthy()
    expect(main.absStep + sweep).toBe(64)
    expect(main.vel).toBeLessThan(swell.vel) /* the stacked under-swell is LOUDER — the main sweep carries the release */
  })
  test('riser:2 stacks an earlier under-sweep (no silent gap on the main sweep)', () => {
    const evs = transEvents({ riser: 2, revcym: 0, impact: 0, cut: 0, xfade: 0 }, 64, sd, find)
    const risers = evs.filter(e => e.kind === 'riser')
    expect(risers.length).toBe(2)
    expect(risers[0].absStep).toBe(32)
    expect(risers[0].vel).toBeLessThan(risers[1].vel) /* the under-sweep is quieter */
  })
  test('missing voice type → that element is honestly skipped', () => {
    const evs = transEvents({ riser: 1, revcym: 1, impact: 1, cut: 0, xfade: 0 }, 64, sd, () => -1)
    expect(evs.length).toBe(0)
  })
  test('song-start boundary (S=0) clamps to step 0, never negative', () => {
    const evs = transEvents({ riser: 1, revcym: 1, impact: 1, cut: 0, xfade: 0 }, 0, sd, find)
    for (const e of evs) expect(e.absStep).toBe(0)
    expect(evs.length).toBe(3)
  })
  test('null trans → no events', () => {
    expect(transEvents(null, 64, sd, find).length).toBe(0)
  })
})

describe('planTransLive (scheduler arm path)', () => {
  const sd = 60 / 140 / 4
  const find = (type: string) => ({ riser: 9, impact: 11 } as any)[type] ?? -1
  test('lookahead 0 (manual quantized launch) → impact only', () => {
    const plan = planTransLive({ riser: 1, revcym: 1, impact: 1, cut: 1, xfade: 0 }, 10, sd, 0, find)
    expect(plan.events.length).toBe(1)
    expect(plan.events[0].kind).toBe('impact')
    expect(plan.cut).toBe(null)
  })
  test('lookahead 1 → the swell (revcym config → riser) spans the bar, cut window = [bT-2sd, bT)', () => {
    const bT = 10
    const plan = planTransLive({ riser: 1, revcym: 1, impact: 1, cut: 1, xfade: 0 }, bT, sd, 1, find)
    const risers = plan.events.filter(e => e.kind === 'riser')
    expect(risers.length).toBe(2)
    expect(risers[0].at).toBeCloseTo(bT - 16 * sd, 12) /* the one-bar swell */
    expect(risers[0].vel).toBeCloseTo(.85, 12)
    expect(risers[1].at).toBeGreaterThanOrEqual(bT - 1.6) /* main sweep ends on the boundary */
    expect(risers[1].vel).toBeCloseTo(.8, 12)
    expect(plan.cut).toEqual([bT - 2 * sd, bT])
    /* sorted by time */
    for (let i = 1; i < plan.events.length; i++) expect(plan.events[i].at).toBeGreaterThanOrEqual(plan.events[i - 1].at)
  })
  test('null trans → empty plan', () => {
    const plan = planTransLive(null, 10, sd, 2, find)
    expect(plan.events.length).toBe(0)
    expect(plan.cut).toBe(null)
  })
})

describe('songSchedule integration (the oracle reflects what renders)', () => {
  /* silent FX carrier tracks (no pattern data → stepEvents skips them; they
     exist so findTransTrack can map the transition elements). v0.30.0: the
     revcym carrier is gone with the type — the swell rides the RISER track. */
  function addFxCarriers(p: any) {
    const mk = (name: string, type: string) => ({
      idx: p.tracks.length, name, kind: 'drum', presetId: 'fx-' + type,
      base: null, sound: { type, tune: 1, decay: 1, tone: 1, punch: 1 }, type,
      mix: { vol: 1, pan: 0, mute: false, solo: false, sendA: 0, sendB: 0 },
      scAmount: 0, voiceMode: 'synth',
    })
    p.tracks.push(mk('FX RISER', 'riser'), mk('FX IMPACT', 'impact'))
  }
  test('trans events land at the right absolute steps + bass vanishes in the cut window', () => {
    const p: any = compose('PSYTRANCE', 1, 42).project
    expect(p.arranger.steps.length).toBeGreaterThanOrEqual(2)
    addFxCarriers(p)
    const scn1 = p.arranger.steps[1].scene /* the scene that LANDS at the first boundary */
    sceneSetTrans(p, scn1, { riser: 1, revcym: 1, impact: 1, cut: 1 })
    const S1 = (p.arranger.steps[0].bars | 0) * 16 /* absolute start of section 1 */
    const sd = 60 / p.bpm / 4
    const sch = songSchedule(p)
    const transEvs = sch.evs.filter((e: any) => e.trans)
    expect(transEvs.length).toBeGreaterThanOrEqual(3)
    /* impact exactly on the boundary; the swell (revcym config) and the main
       sweep both ride the riser carrier — resolved by TYPE (composed projects
       may already carry a riser-type track; findTransTrack picks the lowest) */
    const imp = transEvs.find((e: any) => e.track === findTransTrack(p, 'impact'))
    const risTrack = findTransTrack(p, 'riser')
    const risers = transEvs.filter((e: any) => e.track === risTrack)
    expect(imp.s).toBe(S1)
    expect(imp.t).toBeCloseTo(0.05 + S1 * sd, 6)
    expect(risers.find((e: any) => e.s === S1 - 16)).toBeTruthy() /* the one-bar swell */
    /* main riser sweep ends ON the boundary */
    const sweep = Math.round(1.6 / sd)
    const ris = risers.find((e: any) => e.s + sweep === S1)
    expect(ris).toBeTruthy()
    /* bass (track 4) silent in the cut window */
    const bassInWindow = sch.evs.filter((e: any) => e.track === 4 && e.s >= S1 - 2 && e.s < S1)
    expect(bassInWindow.length).toBe(0)
    /* control: the same project WITHOUT trans carries bass there — force bass
       notes into the window on the section-0 pattern (phase of section 0
       starts at 0, so pattern index = abs % loopLen) so the comparison is
       deterministic instead of pattern-dependent */
    const p2: any = compose('PSYTRANCE', 1, 42).project
    for (const sc of p2.scenes) delete sc.trans /* v0.19.0: composed projects SHIP with trans — strip it to build the trans-free control */
    addFxCarriers(p2)
    const pat0 = p2.patterns[p2.scenes[p2.arranger.steps[0].scene].pattern]
    const L0 = pat0.data[4].len
    for (const s of [S1 - 2, S1 - 1]) { const st = pat0.data[4].steps[((s % L0) + L0) % L0]; st.on = 1; st.vel = .9 }
    const sch2 = songSchedule(p2)
    expect(sch2.evs.filter((e: any) => e.trans).length).toBe(0)
    expect(sch2.evs.filter((e: any) => e.track === 4 && e.s >= S1 - 2 && e.s < S1).length).toBe(2)
  })
  test('trans-free schedule is BYTE-IDENTICAL to the legacy contract (evHash equality)', () => {
    const p: any = compose('FULL-ON', 1, 424242).project
    const h1 = evHash(songSchedule(p).evs)
    expect(h1).not.toBe('cbf29ce484222325') /* the schedule is non-empty */
    const h2 = evHash(songSchedule(p).evs)
    expect(h1).toBe(h2)
    /* and adding trans to a scene CHANGES the schedule (the events are real) */
    addFxCarriers(p)
    sceneSetTrans(p, 1, { impact: 1 })
    const h3 = evHash(songSchedule(p).evs)
    expect(h3).not.toBe(h1)
  })
  test('LAST section gets no hand-off (nothing follows the song end)', () => {
    const p: any = compose('PSYTRANCE', 1, 42).project
    addFxCarriers(p)
    const last = p.arranger.steps.length - 1
    sceneSetTrans(p, p.arranger.steps[last].scene, { impact: 1 })
    const sch = songSchedule(p)
    const totalSteps = sch.totalSteps
    expect(sch.evs.filter((e: any) => e.trans && e.s === totalSteps).length).toBe(0)
  })
})
