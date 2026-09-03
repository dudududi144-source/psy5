/**
 * PSY6 v0.17.0 — MACROS 8/8 REAL + READY SET boot + tap tempo.
 *
 * Owner driver: "תמלא עוד דברים שיהיה מבחר עשיר ולא רק כמה פונקציות בודדות
 * לכל דבר" (rich variety, not a few single functions per thing) and "כבר
 * מוכנה לביצוע ולא ריקה" (ready to perform, not empty). Until this run:
 *  - DRIVE / MOVEMENT macros rendered in the UI but resolveMacros ignored
 *    them (dead controls); FILTER/TIGHT/HAUNT/FAZE did not exist.
 *  - First boot was a bare buildStyle skeleton (no scenes, no arranger).
 * This suite pins the new contracts:
 *  1. all EIGHT macros move distinct, clamped, deterministic engine state
 *  2. the ENERGY legacy contract (G6) is unchanged
 *  3. tapTempo pure math (window, average, clamp)
 *  4. readyAlbum preseeds a valid, style-complete, deterministic album
 *  5. every pinned READY SET seed composes (9 styles)
 */
import { describe, expect, test } from 'bun:test'
import { compose, COMPOSER_STYLES } from '../js/composer.js'
import { buildStyle } from '../js/presets.js'
import { resolveMacros, loadProjectObj, I } from '../js/state.js'
import { M_ENERGY, M_DRIVE, M_SPACE, M_MOVE, M_FILTER, M_TIGHT, M_HAUNT, M_FAZE, tapTempo } from '../js/model.js'
import { readyAlbum, READY_SEEDS, libraryOf, libraryValid } from '../js/library.js'

const clone = (x: any): any => JSON.parse(JSON.stringify(x))

function freshComposed() {
  const p = compose('FULL-ON', 3, 424242).project
  loadProjectObj(p) /* canonical backfill — the same path a real boot takes */
  return I.p
}
function snap(p: any) { return JSON.stringify(p.tracks) }
function setMacro(p: any, idx: number, v: number) { p.macroVals[idx] = v; resolveMacros(p) }

describe('macros v2 — all eight resolve to real engine state', () => {
  test('baseline: resolveMacros at all-neutral is idempotent (recompute-from-base, no accumulation)', () => {
    const p = freshComposed()
    setMacro(p, M_ENERGY, .5); setMacro(p, M_DRIVE, .5); setMacro(p, M_SPACE, .5); setMacro(p, M_MOVE, .5)
    setMacro(p, M_FILTER, .5); setMacro(p, M_TIGHT, .5); setMacro(p, M_HAUNT, .5); setMacro(p, M_FAZE, .5)
    const a = snap(p)
    setMacro(p, M_ENERGY, .5); setMacro(p, M_DRIVE, .5); setMacro(p, M_SPACE, .5); setMacro(p, M_MOVE, .5)
    setMacro(p, M_FILTER, .5); setMacro(p, M_TIGHT, .5); setMacro(p, M_HAUNT, .5); setMacro(p, M_FAZE, .5)
    expect(snap(p)).toBe(a)
  })

  test('DRIVE (1) moves ins.drive on music synths and crush on drum bodies — kick/bass untouched', () => {
    const p = freshComposed()
    const before = snap(p)
    setMacro(p, M_DRIVE, 1)
    expect(p.tracks[5].ins.drive).toBe(Math.min(100, (p.tracks[5].base.ins?.drive || 0) + 65))
    expect(p.tracks[1].ins.crush).toBeLessThan(16) /* drum body crushed */
    expect(p.tracks[1].ins.crush).toBeGreaterThanOrEqual(2)
    expect(p.tracks[0].ins && p.tracks[0].ins.drive ? p.tracks[0].ins.drive : 0).toBe(0) /* kick sacred */
    expect(p.tracks[4].ins && p.tracks[4].ins.drive ? p.tracks[4].ins.drive : 0).toBe(0) /* bass sacred */
    expect(snap(p)).not.toBe(before)
  })

  test('MOVEMENT (3) spreads pad/arp pans and lifts LFO depth on music synths', () => {
    const p = freshComposed()
    const panBefore6 = p.tracks[6].mix.pan, panBefore7 = p.tracks[7].mix.pan
    setMacro(p, M_MOVE, 1)
    expect(p.tracks[6].mix.pan).not.toBe(panBefore6)
    expect(p.tracks[7].mix.pan).not.toBe(panBefore7)
    expect(Math.abs(p.tracks[6].mix.pan)).toBeLessThanOrEqual(1)
    expect(p.tracks[5].sound.lfoDepth).toBeGreaterThan(0)
    setMacro(p, M_MOVE, 0)
    expect(Math.abs(p.tracks[6].mix.pan)).toBeLessThanOrEqual(1)
  })

  test('FILTER (4) tilts music cutoffs over ENERGY without touching kick/bass', () => {
    const p = freshComposed()
    setMacro(p, M_ENERGY, .5); setMacro(p, M_FILTER, 1)
    const bright = p.tracks[5].sound.cutoff
    setMacro(p, M_FILTER, 0)
    const dark = p.tracks[5].sound.cutoff
    expect(bright).toBeGreaterThan(dark)
    expect(bright).toBeLessThanOrEqual(14000)
    expect(dark).toBeGreaterThanOrEqual(60)
    /* kick (0) has no sound.cutoff to tilt — drums untouched by FILTER */
    expect(p.tracks[0].sound.cutoff).toBeUndefined()
  })

  test('TIGHT (5) shortens drum decays, never crosses the clamp', () => {
    const p = freshComposed()
    const d0 = p.tracks[1].sound.decay
    setMacro(p, M_TIGHT, 1)
    expect(p.tracks[1].sound.decay).toBeLessThan(d0)
    expect(p.tracks[1].sound.decay).toBeGreaterThanOrEqual(0.02)
    setMacro(p, M_TIGHT, 0)
    expect(p.tracks[1].sound.decay).toBeGreaterThan(d0)
  })

  test('HAUNT (6) destabilizes lead/arp detune; FAZE (7) speeds music LFOs', () => {
    const p = freshComposed()
    const det5 = p.tracks[5].sound.detune
    setMacro(p, M_HAUNT, 1)
    expect(p.tracks[5].sound.detune).toBeGreaterThan(det5 * 2)
    expect(p.tracks[5].sound.detune).toBeLessThanOrEqual(48)
    setMacro(p, M_HAUNT, 0)
    expect(p.tracks[5].sound.detune).toBeLessThan(det5)
    const lfo0 = p.tracks[5].sound.lfoRate
    setMacro(p, M_FAZE, 1)
    expect(p.tracks[5].sound.lfoRate).toBeGreaterThan(lfo0)
    expect(p.tracks[5].sound.lfoRate).toBeLessThanOrEqual(16)
  })

  test('SPACE (2) still lifts sends (legacy contract)', () => {
    const p = freshComposed()
    const a = p.tracks[5].mix.sendA, b = p.tracks[5].mix.sendB
    setMacro(p, M_SPACE, 1)
    expect(p.tracks[5].mix.sendA).toBeGreaterThan(a)
    expect(p.tracks[5].mix.sendB).toBeGreaterThan(b)
  })

  test('ENERGY legacy contract (G6): cutoff swings with energy, bass vol follows', () => {
    const p = freshComposed()
    setMacro(p, M_ENERGY, .5)
    const c0 = p.tracks[5].sound.cutoff, v0 = p.tracks[4].mix.vol
    setMacro(p, M_ENERGY, 1)
    const c1 = p.tracks[5].sound.cutoff, v1 = p.tracks[4].mix.vol
    expect(Math.abs(c1 - c0)).toBeGreaterThan(1)
    expect(v1).toBeGreaterThan(v0)
  })

  test('determinism: identical macro sequences on identical projects → identical state', () => {
    const run = () => {
      const p = compose('FULL-ON', 3, 424242).project
      loadProjectObj(p)
      const seq: [number, number][] = [[M_DRIVE, 1], [M_MOVE, .2], [M_FILTER, .8], [M_TIGHT, .1], [M_HAUNT, .9], [M_FAZE, .3], [M_SPACE, .7], [M_ENERGY, .6]]
      for (const [i, v] of seq) setMacro(I.p, i, v)
      return snap(I.p)
    }
    expect(run()).toBe(run())
  })

  test('bounds: extreme macro values stay inside every registry range', () => {
    const p = freshComposed()
    for (const idx of [M_ENERGY, M_DRIVE, M_SPACE, M_MOVE, M_FILTER, M_TIGHT, M_HAUNT, M_FAZE]) {
      setMacro(p, idx, 0); setMacro(p, idx, 1)
    }
    for (const t of p.tracks) {
      if (t.kind === 'synth') {
        expect(t.sound.cutoff).toBeGreaterThanOrEqual(60); expect(t.sound.cutoff).toBeLessThanOrEqual(14000)
        expect(t.sound.detune).toBeLessThanOrEqual(48)
        expect(t.sound.lfoRate).toBeLessThanOrEqual(16)
        expect(t.sound.lfoDepth).toBeLessThanOrEqual(1)
        expect(t.mix.pan).toBeGreaterThanOrEqual(-1); expect(t.mix.pan).toBeLessThanOrEqual(1)
        if (t.ins) expect(t.ins.drive).toBeLessThanOrEqual(100)
      } else if (t.ins) {
        expect(t.ins.crush).toBeGreaterThanOrEqual(2); expect(t.ins.crush).toBeLessThanOrEqual(16)
      }
    }
  })
})

describe('tap tempo (pure)', () => {
  test('needs two taps inside the window before a bpm exists', () => {
    const first = tapTempo([], 1000)
    expect(first.count).toBe(1)
    expect(first.bpm).toBeNull()
    const r = tapTempo([500], 1000) /* 500 ms apart → 120 BPM */
    expect(r.count).toBe(2)
    expect(r.bpm).toBe(120)
  })
  test('stale taps outside the window are dropped', () => {
    const r = tapTempo([2000], 4600) /* 4600−2000 = 2600 ≥ 2500 → dropped */
    expect(r.count).toBe(1)
    expect(r.bpm).toBeNull()
  })
  test('clamps to the transport range 40..300', () => {
    expect(tapTempo([0], 100).bpm).toBe(300)    /* 100 ms → 600 → clamped high */
    expect(tapTempo([100], 1600).bpm).toBe(40)  /* 1500 ms → 40 exactly */
  })
})

describe('READY SET boot — ready to perform, not empty', () => {
  test('readyAlbum preseeds the current song + one recipe per style, valid and active', () => {
    const r = compose('FULL-ON', 3, 424242)
    const lib = readyAlbum(r.project, 'FULL-ON', 424242, 3)!
    expect(lib).not.toBeNull()
    expect(lib!.songs.length).toBe(Object.keys(COMPOSER_STYLES).length)
    expect(libraryValid(r.project)).toBe(true)
    const active = lib!.songs.find(s => s.id === lib!.activeSongId)!
    expect(active.style).toBe('FULL-ON')
    expect(active.name).toBe('FULL-ON READY SET')
    /* one recipe per style — no duplicates */
    const styles = new Set(lib!.songs.map(s => s.style))
    expect(styles.size).toBe(Object.keys(COMPOSER_STYLES).length)
  })

  test('deterministic: same style/seed/len → byte-identical album', () => {
    const mk = () => {
      const p = compose('PSYTRANCE', 3, 5150).project
      readyAlbum(p, 'PSYTRANCE', 5150, 3)
      return JSON.stringify(p.library)
    }
    expect(mk()).toBe(mk())
  })

  test('every pinned READY SET seed composes a full arranged set (9 styles)', () => {
    for (const st of Object.keys(COMPOSER_STYLES)) {
      const seed = READY_SEEDS[st]
      const r = compose(st, 3, seed)
      expect(r.project.scenes.length).toBeGreaterThan(4)
      expect(r.project.arranger.on).toBe(true)
      expect(r.project.arranger.steps.length).toBeGreaterThan(4)
      expect(r.form.totalBars).toBeGreaterThan(28)
      expect(r.project.tracks.length).toBe(10)
    }
  })

  test('the bare-sketch escape hatch still builds (legacy boot path intact)', () => {
    const p = buildStyle('TECHNO', 7)
    expect(p.tracks.length).toBe(8)
    expect(p.scenes.length).toBeGreaterThan(0)
  })
})
