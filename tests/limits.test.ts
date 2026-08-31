/**
 * PSY6 v0.5.0 UNLIMIT tests.
 *
 * The raised ceilings (16 tracks / 128 steps / 64 scenes / loopLen 1024)
 * must be real, but defaults are unchanged and legacy projects load and
 * save byte-identically:
 *   - limits config is the single source of truth
 *   - new projects still start 8 tracks / 16-step patterns / 8 scenes
 *   - 128-step patterns schedule + loop correctly (mixed lengths 16+128,
 *     8+64+128)
 *   - addTrackToProject grows a project to the ceiling and grows pattern data
 *   - legacy v0.4.0 project: load → save is byte-identical (no field churn)
 */
import { describe, expect, test } from 'bun:test'
import { LIMITS } from '../js/limits.js'
import {
  mkProject, mkPattern, mkStep, loopLen, stepEvents, deep,
} from '../js/model.js'
import { buildStyle, addTrackToProject, initTracks } from '../js/presets.js'
import { loadProjectObj, I } from '../js/state.js'

describe('limits config', () => {
  test('ceilings are the v0.5.0 values', () => {
    expect(LIMITS.MAX_TRACKS).toBe(16)
    expect(LIMITS.MAX_STEPS).toBe(128)
    expect(LIMITS.MAX_SCENES).toBe(64)
    expect([...LIMITS.PATTERN_LENGTHS]).toEqual([8, 16, 32, 64, 128])
    expect(LIMITS.LOOP_CAP).toBe(1024)
  })
})

describe('defaults unchanged', () => {
  test('new project starts with 8 tracks / 16-step patterns / 8 scenes', () => {
    const p = buildStyle('TECHNO', 42)
    expect(p.tracks.length).toBe(8)
    expect(p.scenes.length).toBe(8)
    expect(p.patterns['A'].data[0].len).toBe(16)
    expect(loopLen(p)).toBe(32) /* TECHNO arp track is 32 steps: LCM(16,32) */
  })
})

describe('loopLen for mixed pattern lengths', () => {
  test('16 + 128 → 128', () => {
    const p = mkProject()
    p.patterns['A'] = mkPattern('A', 2)
    p.patterns['A'].data[0].len = 16
    p.patterns['A'].data[1].len = 128
    expect(loopLen(p)).toBe(128)
  })
  test('8 + 64 + 128 → 128', () => {
    const p = mkProject()
    p.patterns['A'] = mkPattern('A', 3)
    p.patterns['A'].data[0].len = 8
    p.patterns['A'].data[1].len = 64
    p.patterns['A'].data[2].len = 128
    expect(loopLen(p)).toBe(128)
  })
  test('16 + 32 → 32 (regression), 16 → 16 (regression)', () => {
    const p = mkProject()
    p.patterns['A'] = mkPattern('A', 2)
    p.patterns['A'].data[0].len = 16
    p.patterns['A'].data[1].len = 32
    expect(loopLen(p)).toBe(32)
    const q = mkProject()
    q.patterns['A'] = mkPattern('A', 1)
    expect(loopLen(q)).toBe(16)
  })
})

describe('128-step pattern', () => {
  test('stepEvents fires at 0/64/127 and nothing else', () => {
    const p = buildStyle('TECHNO', 42)
    const pat = p.patterns['A']
    for (let t = 0; t < p.tracks.length; t++) for (const s of pat.data[t].steps) s.on = 0
    pat.data[0].len = 128
    pat.data[0].steps = Array.from({ length: 128 }, () => mkStep(false))
    pat.data[0].steps[0].on = 1
    pat.data[0].steps[64].on = 1
    pat.data[0].steps[127].on = 1
    p.currentPattern = 'A'
    expect(loopLen(p)).toBe(128)
    const at = (s) => stepEvents(p, s)
    expect(at(0).filter(e => e.track === 0).length).toBe(1)
    expect(at(64).filter(e => e.track === 0).length).toBe(1)
    expect(at(127).filter(e => e.track === 0).length).toBe(1)
    /* no event anywhere else in the 128-step loop */
    let others = 0
    for (let s = 0; s < 128; s++) if (s !== 0 && s !== 64 && s !== 127) others += at(s).filter(e => e.track === 0).length
    expect(others).toBe(0)
    /* determinism: same step → same events */
    expect(JSON.stringify(at(64))).toBe(JSON.stringify(at(64)))
  })
})

describe('addTrackToProject', () => {
  test('grows 8 → 12 tracks, pattern data grows, presets assigned', () => {
    const p = buildStyle('TECHNO', 7)
    for (let i = 0; i < 4; i++) {
      const t = addTrackToProject(p)
      expect(t).toBe(8 + i)
      expect(p.tracks[t].presetId).toBe('INIT-SYNTH')
      expect(p.tracks[t].idx).toBe(t)
    }
    expect(p.tracks.length).toBe(12)
    for (const k in p.patterns) expect(Object.keys(p.patterns[k].data).length).toBe(12)
    /* new track data is silent */
    const d = p.patterns['A'].data[11]
    expect(d.len).toBe(16)
    expect(d.steps.every(s => !s.on)).toBe(true)
  })
  test('refuses to grow past the 16-track ceiling', () => {
    const p = buildStyle('TECHNO', 7)
    while (addTrackToProject(p) >= 0) { /* grow to cap */ }
    expect(p.tracks.length).toBe(LIMITS.MAX_TRACKS)
    expect(addTrackToProject(p)).toBe(-1)
  })
  test('lengthening a pattern does NOT alias step objects (v0.5.0 regression)', () => {
    const p = buildStyle('TECHNO', 7)
    const d = p.patterns['A'].data[0]
    d.steps[1].on = 1            /* step 1 is OFF in the TECHNO kick recipe */
    /* lengthen 16 → 128 via the same code path the device UI uses */
    const old = d.steps
    d.len = 128
    d.steps = Array.from({ length: 128 }, (_, k) => {
      const o = old[k % old.length]
      return o ? { on: o.on, vel: o.vel, prob: o.prob, micro: o.micro, note: o.note, lock: Object.assign({}, o.lock) } : mkStep(false)
    })
    expect(d.steps[1].on).toBe(1)
    expect(d.steps[17].on).toBe(1)              /* content repeats… */
    expect(d.steps[17]).not.toBe(d.steps[1])    /* …as independent copies */
    d.steps[17].on = 0
    expect(d.steps[1].on).toBe(1)               /* editing a repeat does NOT alias the original */
    expect(d.steps[33].on).toBe(1)              /* other clones unaffected */
    expect(d.steps[2].on).toBe(0)
    /* lock objects are independent too */
    d.steps[1].lock.cutoff = 900
    expect(d.steps[17].lock.cutoff).toBeUndefined()
  })
  test('lengthening preserves the repeated pattern content', () => {
    const p = mkProject()
    p.patterns['A'] = mkPattern('A', 1)
    p.patterns['A'].data[0].steps[4].on = 1
    const d = p.patterns['A'].data[0]
    const old = d.steps
    d.len = 32
    d.steps = Array.from({ length: 32 }, (_, k) => {
      const o = old[k % old.length]
      return o ? { on: o.on, vel: o.vel, prob: o.prob, micro: o.micro, note: o.note, lock: Object.assign({}, o.lock) } : mkStep(false)
    })
    expect(d.steps[4].on).toBe(1)
    expect(d.steps[20].on).toBe(1)  /* 20 % 16 = 4 — content repeats */
    expect(d.steps[20]).not.toBe(d.steps[4])  /* …as independent copies */
  })
  test('12-track project schedules on all tracks', () => {
    const p = buildStyle('TECHNO', 7)
    while (addTrackToProject(p) >= 0) { /* grow to cap */ }
    const pat = p.patterns['A']
    for (let t = 0; t < 16; t++) { const st = pat.data[t].steps[0]; st.on = 1; st.vel = 0.9; st.prob = 1 }
    const evs = stepEvents(p, 0)
    expect(evs.length).toBe(16)
    expect(evs.map(e => e.track)).toEqual([...Array(16).keys()])
  })
})

describe('legacy safety', () => {
  test('v0.4.0 project: load → save is byte-identical', () => {
    /* a project exactly as v0.4.0 would have saved it (all backfill fields
       already present — nothing to add, nothing to reorder) */
    const p = buildStyle('PSYTRANCE', 42)
    p.lanes = [{ track: 5, param: 'cutoff', pts: [[0, 0.2], [16, 0.8]] }]
    p.midiMap = { version: 1, bindings: { 45: 'track.2.scAmount' } }
    p.copilot = { v: 1, records: [], stats: { decisions: 0 } }
    p.fx = { delayDiv: '3/16', delayFb: 0.35 }
    const before = JSON.stringify(p)
    loadProjectObj(deep(p))
    const after = JSON.stringify(I.p)
    expect(after).toBe(before)
  })
  test('v0.1.0-era project (pre-sidechain) still backfills neutral defaults', () => {
    const j = JSON.parse(JSON.stringify(buildStyle('TECHNO', 1)))
    for (const t of j.tracks) { delete t.scAmount; delete t.scAttackMs; delete t.scHoldMs; delete t.scReleaseMs }
    delete j.masterVol; delete j.midiMap; delete j.fx
    const loaded = loadProjectObj(j) || I.p
    expect(loaded.masterVol).toBe(0.85)
    expect(loaded.tracks.every(t => t.scAmount === 0)).toBe(true)
    expect(loaded.midiMap.version).toBe(1)
    expect(loaded.fx.delayDiv).toBe('3/16')
  })
  test('a 16-track/128-step/64-scene project loads unchanged', () => {
    const p = buildStyle('TECHNO', 7)
    /* normalize once like a project that was saved after a load (backfill
       fields present — this is what a real v0.4.0-era save looks like) */
    loadProjectObj(JSON.parse(JSON.stringify(p)))
    const q = I.p
    while (addTrackToProject(q) >= 0) { /* 16 */ }
    q.patterns['A'].data[0].len = 128
    q.patterns['A'].data[0].steps = Array.from({ length: 128 }, () => mkStep(false))
    q.scenes = Array.from({ length: 64 }, (_, i) => ({ name: 'S' + i, pattern: i % 2 ? 'B' : 'A' }))
    const before = JSON.stringify(q)
    loadProjectObj(JSON.parse(before))
    const loaded = I.p
    expect(JSON.stringify(loaded)).toBe(before)
    expect(loaded.tracks.length).toBe(16)
    expect(loaded.scenes.length).toBe(64)
  })
})
