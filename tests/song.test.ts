/**
 * PSY6 song-render tests (Run 9 — full-song offline bounce).
 *
 * The song renderer walks the arranger through the EXACT live scheduler
 * bookkeeping (songSteps generator) and triggers events with the SAME
 * per-bar event function (stepEvents) as schedTick. These tests verify the
 * pure parts without Web Audio:
 *
 *   - phase rules: songSteps phases == a live-scheduler simulation that
 *     mirrors schedTick line-by-line (sc.step=sc.step%sc.loop on launch,
 *     %loop advance, empty scenes never launch, phase-0 fresh start)
 *   - frame-count formula: songFrames == spec formula, exact number @145
 *   - sections: consecutive same-scene grouping, bars sum
 *   - schedule determinism: same project → identical evHash
 *   - per-scene auto-FILL: 8 half-step kick hits at the section boundary
 *   - empty scenes: previous pattern keeps playing (phase mod OLD loop)
 *   - duration guard math (>10 min refusal) + cancel controller contract
 */
import { describe, expect, test } from 'bun:test'
import { songSteps, songSchedule, songSections, songFrames, songDurationSec, songRenderController, evHash, SONG_LEAD, SONG_TAIL_STEPS } from '../js/bounce.js'
import { loopLen } from '../js/model.js'
import { compose } from '../js/composer.js'
import { buildStyle } from '../js/presets.js'

/* live-sim oracle — mirrors schedTick's step bookkeeping exactly:
   startSched: sc.step=0, sc.loop=loopLen; pending apply at bar boundary:
   currentPattern=scn.pattern, sc.loop=loopLen, sc.step=sc.step%sc.loop;
   step advance: sc.step=(sc.step+1)%sc.loop. Empty scene → no launch. */
function liveSimPhases(p) {
  const a = p.arranger.steps
  let step = 0, loop = loopLen(p)
  const seq = []
  for (let s = 0; s < a.length; s++) {
    if (s > 0) {
      const scn = p.scenes[a[s].scene]
      if (scn && scn.pattern != null) {
        p.currentPattern = scn.pattern
        loop = loopLen(p)
        step = step % loop
      }
    }
    for (let q = 0; q < a[s].bars * 16; q++) { seq.push(step); step = (step + 1) % loop }
  }
  return seq
}

describe('song render: phase rules (live-scheduler equality)', () => {
  test('composed FULL-ON 3min: songSteps phases == live-sim phases per step', () => {
    const p = compose('FULL-ON', 3, 424242).project
    const sim = liveSimPhases(p)
    const walk = []
    for (const y of songSteps(p)) walk.push(y.phase)
    expect(sim.length).toBe(walk.length)
    let mismatches = 0
    for (let i = 0; i < sim.length; i++) if (sim[i] !== walk[i]) mismatches++
    expect(mismatches).toBe(0)
  })
  test('phase transition rule exercised: 32-step loop, section bars=3', () => {
    const p = buildStyle('PSYTRANCE', 42)
    /* stretch pattern A to a 32-step loop (pad steps with nulls — stepEvents
       skips null steps; the phase math is what this test verifies) */
    for (const t of Object.keys(p.patterns.A.data)) {
      p.patterns.A.data[t].len = 32
      while (p.patterns.A.data[t].steps.length < 32) p.patterns.A.data[t].steps.push(null)
    }
    p.currentPattern = 'A'
    const L0 = loopLen(p)
    expect(L0).toBe(32)
    p.scenes = [
      { name: 'A', pattern: 'A', color: null, bars: null, fill: false },
      { name: 'B', pattern: 'B', color: null, bars: null, fill: false }, /* B stays 16-step */
      { name: 'A2', pattern: 'A', color: null, bars: null, fill: false },
    ]
    p.arranger = { v: 1, on: true, idx: 0, barsIn: 0, steps: [{ scene: 0, bars: 3 }, { scene: 1, bars: 5 }, { scene: 2, bars: 2 }] }
    const sim = liveSimPhases(p)
    const walk = []
    for (const y of songSteps(p)) walk.push(y.phase)
    expect(sim.length).toBe(walk.length)
    expect(sim.every((v, i) => v === walk[i])).toBe(true)
    /* the rule bites: section 0 ends at phase 48%32=16; section 1 (16-step
       B loop) starts at 16%16=0; section 2 (32-step A loop) starts at
       (0+80)%16=0 → 0%32=0... exercised via section 0→1 boundary instead */
    expect(sim[48]).toBe(48 % 16)      /* B loop is 16 → phase 0 */
    expect(sim[48 * 0 + 3 * 16]).toBe((3 * 16) % L0 % 16) /* first boundary: 48%32=16 then %16=0 */
    /* direct oracle cross-check: songSteps phase at section 2 start */
    expect(sim[8 * 16]).toBe(0)
  })
  test('empty scene: previous pattern keeps playing, phase advances mod OLD loop', () => {
    const p = buildStyle('PSYTRANCE', 42)
    const keys = Object.keys(p.patterns)
    p.scenes = [
      { name: 'A', pattern: keys[0], color: null, bars: null, fill: false },
      { name: 'EMPTY', pattern: null, color: null, bars: null, fill: false },
    ]
    p.arranger = { v: 1, on: true, idx: 0, barsIn: 0, steps: [{ scene: 0, bars: 2 }, { scene: 1, bars: 1 }, { scene: 0, bars: 1 }] }
    const sim = liveSimPhases(p)
    const walk = []
    for (const y of songSteps(p)) walk.push(y.phase)
    expect(sim.every((v, i) => v === walk[i])).toBe(true)
    /* events exist in the middle (empty) section — pattern A kept playing */
    const sch = songSchedule(p, SONG_LEAD)
    const mid = sch.evs.filter(e => e.s >= 32 && e.s < 48)
    expect(mid.length).toBeGreaterThan(0)
  })
})

describe('song render: frame-count formula', () => {
  /* The composer's FORM (108 bars, 178.76s) is its length-target metric;
     the ARRANGER it emits is the 8-bar-step performance expansion —
     17 steps, Σ=136 bars (12→16, 20→24, 28→32). The song render is exact
     to the ARRANGER: frames = ceil(44100·(0.05+(Σbars·16+32)·60/bpm/4)). */
  const c = compose('FULL-ON', 3, 424242)
  const p = c.project
  const SUM = p.arranger.steps.reduce((a, s) => a + s.bars, 0)
  test('demo arranger shape pinned: 17 steps, Σ=136 bars, form=108', () => {
    expect(p.arranger.steps.length).toBe(17)
    expect(SUM).toBe(136)
    expect(c.form.totalBars).toBe(108)
  })
  test('exact frames @145 BPM, 136 bars: ceil(44100·(0.05+(136·16+32)·60/145/4))', () => {
    const spec = Math.ceil(44100 * (0.05 + (136 * 16 + 32) * (60 / 145 / 4)))
    expect(spec).toBe(10075254) /* the spec number itself, computed independently */
    expect(songFrames(p)).toBe(spec)
  })
  test('music length == arranger length; with-tail adds exactly 2 bars', () => {
    const d = songDurationSec(p)
    const sd = 60 / p.bpm / 4
    expect(d.music).toBeCloseTo(SUM * 16 * sd, 9)
    expect(d.withTail).toBeCloseTo(d.music + 32 * sd, 9)
  })
  test('songSchedule total spans lead + music + tail exactly', () => {
    const sch = songSchedule(p, SONG_LEAD)
    expect(sch.totalSteps).toBe(136 * 16)
    expect(sch.total).toBeCloseTo(SONG_LEAD + (136 * 16 + SONG_TAIL_STEPS) * (60 / p.bpm / 4), 9)
    for (const e of sch.evs) {
      expect(e.t).toBeGreaterThanOrEqual(SONG_LEAD - 1e-9)
      expect(e.t).toBeLessThanOrEqual(sch.total + 1e-9)
    }
    expect(sch.evs.length).toBeGreaterThan(0)
  })
})

describe('song render: sections + fills + determinism', () => {
  test('composed arranger → 17 musical sections (no identical repeats) covering 136 bars', () => {
    /* v0.7.0: every arranger step is its OWN scene (base + " 2"/" 3"…
       variants) — 17 distinct sections, Σbars unchanged at 136 */
    const p = compose('FULL-ON', 3, 424242).project
    const secs = songSections(p)
    expect(secs.length).toBe(17)
    expect(new Set(secs.map(s => s.name)).size).toBe(17)
    expect(secs.map(s => s.name)).toEqual([
      'INTRO', 'INTRO 2', 'BUILD', 'BUILD 2', 'DROP', 'DROP 2', 'DROP 3',
      'BREAK', 'BREAK 2', 'RISER', 'RISER 2',
      'DROP2', 'DROP2 2', 'DROP2 3', 'DROP2 4', 'OUTRO', 'OUTRO 2',
    ])
    expect(secs.every(s => s.bars === 8)).toBe(true)
    expect(secs.reduce((a, s) => a + s.bars, 0)).toBe(136)
    expect(secs[0].startBar).toBe(0)
    expect(secs[secs.length - 1].endBar).toBe(136)
  })
  test('scene.fill → 8 half-step kick hits (track 3) at the section boundary', () => {
    /* v0.7.0: the drop FAMILY (DROP, DROP 2, DROP 3) occupies the same three
       8-bar steps the old repeated DROP scene did — filling all three scenes
       re-creates the old 3-launch expectation at the same step positions. */
    const p = compose('FULL-ON', 3, 424242).project
    const secs = songSections(p)
    const dropIdx = secs.findIndex(s => s.name === 'DROP')
    expect(dropIdx).toBe(4) /* INTRO, INTRO 2, BUILD, BUILD 2 → DROP @ bar 32 */
    const sc = p.scenes.findIndex(s => s.name === 'DROP')
    const sc2 = p.scenes.findIndex(s => s.name === 'DROP 2')
    const sc3 = p.scenes.findIndex(s => s.name === 'DROP 3')
    expect(sc).toBeGreaterThanOrEqual(0); expect(sc2).toBeGreaterThanOrEqual(0); expect(sc3).toBeGreaterThanOrEqual(0)
    p.scenes[sc].fill = true; p.scenes[sc2].fill = true; p.scenes[sc3].fill = true
    const sch = songSchedule(p, SONG_LEAD)
    const boundaryStep = secs[dropIdx].startBar * 16 /* DROP starts at bar 32 → step 512 */
    expect(boundaryStep).toBe(512)
    const fills = sch.evs.filter(e => e.fill)
    /* the drop FAMILY spans 3 arranger steps (24 bars from step 512) — each
       scene launches once with its own fill flag → 3×8 */
    expect(fills.length).toBe(24)
    const sd = 60 / p.bpm / 4
    /* group key = section-start time, reconstructed from the vel ramp */
    const groups = [...new Set(fills.map(e => {
      const k = Math.round((e.vel - .5) / .05)
      return Math.round((e.t - k * sd / 2) * 1e6)
    }))]
    expect(groups.length).toBe(3)
    const starts = [512, 640, 768]
    for (let g = 0; g < 3; g++) {
      const g8 = fills.slice(g * 8, g * 8 + 8)
      for (let k = 0; k < 8; k++) {
        expect(g8[k].track).toBe(3)
        expect(g8[k].vel).toBeCloseTo(.5 + .05 * k, 9)
        expect(g8[k].t).toBeCloseTo(SONG_LEAD + starts[g] * sd + k * sd / 2, 9)
      }
    }
  })
  test('same seed → byte-identical song schedule hash (determinism)', () => {
    const a = songSchedule(compose('FULL-ON', 3, 424242).project, SONG_LEAD)
    const b = songSchedule(compose('FULL-ON', 3, 424242).project, SONG_LEAD)
    expect(evHash(a.evs)).toBe(evHash(b.evs))
    expect(a.evs.length).toBe(b.evs.length)
    for (let i = 0; i < a.evs.length; i++) {
      expect(a.evs[i].t).toBeCloseTo(b.evs[i].t, 12)
      expect(a.evs[i].track).toBe(b.evs[i].track)
    }
  })
})

describe('song render: guards + controller', () => {
  test('duration guard: >10 min project reported for refusal', () => {
    const p = buildStyle('PSYTRANCE', 42)
    const steps = []
    for (let i = 0; i < 100; i++) steps.push({ scene: 0, bars: 64 })
    p.arranger = { v: 1, on: false, idx: 0, barsIn: 0, steps }
    const d = songDurationSec(p)
    expect(d.withTail).toBeGreaterThan(600)
    /* and the demo stays well under the cap */
    const demo = songDurationSec(compose('FULL-ON', 3, 424242).project)
    expect(demo.withTail).toBeLessThan(600)
  })
  test('cancel controller contract: cancel() flips the flag the render polls', () => {
    const ctrl = songRenderController()
    expect(ctrl.cancelled).toBe(false)
    ctrl.cancel()
    expect(ctrl.cancelled).toBe(true)
  })
})
