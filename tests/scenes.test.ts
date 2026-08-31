/**
 * PSY6 v0.5.0 scene bank tests.
 *
 * Scene model (documented in js/scenes.js): {name, pattern, color, bars, fill}.
 *  - add/duplicate/clear/move/rename/color/bars/fill operations + ceilings
 *  - duplicate/clear/reorder persistence across save/load round-trips
 *  - chain mode over 32+ scenes (pure chainNext)
 *  - launch quantization unchanged; per-scene auto-FILL wired
 *  - scene colors persist; legacy scenes backfilled with neutral fields
 */
import { describe, expect, test } from 'bun:test'
import { buildStyle } from '../js/presets.js'
import {
  sceneAdd, sceneDuplicate, sceneClear, sceneMove, sceneRename,
  sceneSetColor, sceneSetBars, sceneToggleFill, chainNext,
} from '../js/scenes.js'
import { LIMITS } from '../js/limits.js'
import { loadProjectObj, I, PERF } from '../js/state.js'
import { arrState, arrAddStep } from '../js/arranger.js'

function fresh() {
  const p = buildStyle('TECHNO', 7)
  I.p = p
  I.sched.on = false
  I.pending = null
  return p
}

describe('scene operations', () => {
  test('add grows the bank with an empty slot, capped at 64', () => {
    const p = fresh()
    const n0 = p.scenes.length
    const i = sceneAdd(p)
    expect(i).toBe(n0)
    expect(p.scenes[i].pattern).toBeNull()
    expect(p.scenes[i].color).toBeNull()
    expect(p.scenes[i].bars).toBeNull()
    expect(p.scenes[i].fill).toBe(false)
    p.scenes.length = LIMITS.MAX_SCENES
    expect(sceneAdd(p)).toBe(-1)
  })
  test('duplicate copies pattern+color+bars+fill, inserts after, capped', () => {
    const p = fresh()
    sceneRename(p, 0, 'DROP')
    sceneSetColor(p, 0, 3)
    sceneSetBars(p, 0, 8)
    sceneToggleFill(p, 0)
    const j = sceneDuplicate(p, 0)
    expect(j).toBe(1)
    const c = p.scenes[1]
    expect(c.name).toBe('DROP*')
    expect(c.pattern).toBe(p.scenes[0].pattern)
    expect(c.color).toBe(3)
    expect(c.bars).toBe(8)
    expect(c.fill).toBe(true)
    expect(c).not.toBe(p.scenes[0])  /* deep copy, not a reference */
    c.bars = 2
    expect(p.scenes[0].bars).toBe(8) /* editing the copy leaves the original */
    p.scenes.length = LIMITS.MAX_SCENES
    expect(sceneDuplicate(p, 0)).toBe(-1)
  })
  test('clear empties the slot (pattern null, fill off) and launch refuses', () => {
    const p = fresh()
    expect(p.scenes[0].pattern).toBe('A')
    sceneClear(p, 0)
    expect(p.scenes[0].pattern).toBeNull()
    expect(p.scenes[0].fill).toBe(false)
    expect(PERF.launch(0, true).ok).toBe(false)
  })
  test('reorder moves scenes up/down without losing fields', () => {
    const p = fresh()
    sceneRename(p, 0, 'FIRST'); sceneSetColor(p, 0, 1)
    sceneRename(p, 1, 'SECOND'); sceneSetColor(p, 1, 2)
    expect(sceneMove(p, 1, -1)).toBe(true)
    expect(p.scenes[0].name).toBe('SECOND'); expect(p.scenes[0].color).toBe(2)
    expect(p.scenes[1].name).toBe('FIRST'); expect(p.scenes[1].color).toBe(1)
    expect(sceneMove(p, 0, -1)).toBe(false)  /* top edge */
    expect(sceneMove(p, p.scenes.length - 1, +1)).toBe(false)  /* bottom edge */
  })
  test('rename trims, clamps to 24 chars, falls back to SCENE n', () => {
    const p = fresh()
    sceneRename(p, 2, '  MY DROP SECTION  ')
    expect(p.scenes[2].name).toBe('MY DROP SECTION')
    sceneRename(p, 2, 'x'.repeat(40))
    expect(p.scenes[2].name.length).toBe(24)
    sceneRename(p, 2, '   ')
    expect(p.scenes[2].name).toBe('SCENE 3')
  })
})

describe('chain mode over 32+ scenes', () => {
  test('chainNext cycles all 32 scenes and wraps', () => {
    const p = fresh()
    p.scenes = Array.from({ length: 32 }, (_, i) => ({ name: 'S' + i, pattern: i % 2 ? 'B' : 'A', color: null, bars: null, fill: false }))
    p.activeScene = 0
    const visited = []
    for (let k = 0; k < 32; k++) {
      const nxt = chainNext(p)
      expect(nxt).not.toBeNull()
      visited.push(nxt)
      p.activeScene = nxt
    }
    expect(visited).toEqual([...Array(32).keys()].map(i => (i + 1) % 32))
    expect(chainNext(p)).toBe(1)  /* wrapped back to 1 after scene 0 */
  })
  test('chainNext does not multi-skip empty scenes (historical semantics)', () => {
    const p = fresh()
    p.scenes[1].pattern = null
    p.activeScene = 0
    /* immediately-next scene is empty → chain does not advance (v0.1.0 behavior) */
    expect(chainNext(p)).toBeNull()
    p.scenes[1].pattern = 'B'
    expect(chainNext(p)).toBe(1)
    const q = buildStyle('TECHNO', 7)
    for (const sc of q.scenes) sc.pattern = null
    q.activeScene = 0
    expect(chainNext(q)).toBeNull()
  })
})

describe('launch semantics', () => {
  test('quantized launch queues (pending) and does NOT switch pattern', () => {
    const p = fresh()
    I.sched.on = true
    I.fsm = 'PLAYING'
    const before = p.currentPattern
    const r = PERF.launch(1)
    expect(r.ok).toBe(true)
    expect(I.pending).toBe(1)
    expect(I.fsm).toBe('TRANSITIONING')
    expect(p.currentPattern).toBe(before)  /* unchanged until the bar boundary */
    I.sched.on = false
  })
  test('instant launch switches immediately (alt+click path)', () => {
    const p = fresh()
    const r = PERF.launch(1, true)
    expect(r.ok).toBe(true)
    expect(I.pending).toBeNull()
    expect(p.activeScene).toBe(1)
    expect(p.currentPattern).toBe(p.scenes[1].pattern)
  })
  test('instant launch with fill=true fires the FILL op without a crash', () => {
    const p = fresh()
    sceneToggleFill(p, 1)
    /* I.eng/I.ctx are null in bun — the fill guard must make this a no-op */
    expect(() => PERF.launch(1, true)).not.toThrow()
    expect(p.currentPattern).toBe(p.scenes[1].pattern)
  })
  test('assign keeps the scene name (rename survives an assign)', () => {
    const p = fresh()
    sceneRename(p, 3, 'MY BREAK')
    PERF.assign(3)
    expect(p.scenes[3].name).toBe('MY BREAK')
    expect(p.scenes[3].pattern).toBe(p.currentPattern)
  })
})

describe('arranger integration', () => {
  test('scene bars override pre-fills the arranger section length', () => {
    const p = fresh()
    sceneSetBars(p, 2, 16)
    arrAddStep(2)
    const a = arrState()
    expect(a.steps[a.steps.length - 1]).toEqual({ scene: 2, bars: 16 })
    arrAddStep(1, 8)  /* explicit bars still win */
    expect(a.steps[a.steps.length - 1]).toEqual({ scene: 1, bars: 8 })
    arrAddStep(3)     /* no override → historical default 4 */
    expect(a.steps[a.steps.length - 1]).toEqual({ scene: 3, bars: 4 })
  })
})

describe('persistence', () => {
  test('duplicate/clear/reorder/color/bars/fill survive save→load round-trips', () => {
    /* normalize once like a real v0.4.0-era project saved after a load */
    loadProjectObj(buildStyle('TECHNO', 7))
    const p = I.p
    I.sched.on = false; I.pending = null
    sceneRename(p, 0, 'INTRO-X')
    sceneSetColor(p, 0, 5)
    sceneSetBars(p, 0, 12)
    sceneToggleFill(p, 0)
    sceneDuplicate(p, 0)   /* → index 1 */
    sceneClear(p, 3)
    sceneMove(p, 4, -1)    /* swap 4 ↔ 3 */
    const before = JSON.stringify(p)
    loadProjectObj(JSON.parse(before))
    expect(JSON.stringify(I.p)).toBe(before)
    expect(I.p.scenes[0].name).toBe('INTRO-X')
    expect(I.p.scenes[1].name).toBe('INTRO-X*')
    expect(I.p.scenes[0].color).toBe(5)
    expect(I.p.scenes[0].bars).toBe(12)
    expect(I.p.scenes[0].fill).toBe(true)
  })
  test('legacy v0.4.0 scenes backfill with neutral color/bars/fill', () => {
    const p = fresh()
    /* strip the new fields, simulating a v0.4.0 save */
    const legacy = JSON.parse(JSON.stringify(p))
    for (const sc of legacy.scenes) { delete sc.color; delete sc.bars; delete sc.fill }
    const before = JSON.stringify(legacy)
    loadProjectObj(legacy)
    expect(I.p.scenes.every(sc => sc.color === null && sc.bars === null && sc.fill === false)).toBe(true)
    /* names/patterns untouched */
    expect(I.p.scenes[0].pattern).toBe('A')
  })
})
