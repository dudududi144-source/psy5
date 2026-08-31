import { describe, expect, test } from 'bun:test'
import { arrState, arrToggle, arrAddStep, arrRemoveStep, arrSetStep, arrBarHook, arrInstrument, arrView } from '../js/arranger.js'
import { I, PERF } from '../js/state.js'
import { buildStyle } from '../js/presets.js'

function freshDevice() {
  I.p = buildStyle('TECHNO', 42)
  I.sched.on = true /* force the quantized (pending) launch path */
  I.fsm = 'PLAYING'
  I.pending = null
}

describe('section arranger', () => {
  test('state: default created lazily, absent field -> fresh', () => {
    freshDevice()
    expect(I.p.arranger).toBeUndefined()
    const a = arrState()
    expect(a.v).toBe(1)
    expect(a.on).toBe(false)
    expect(a.steps).toEqual([])
    expect(a.idx).toBe(0)
    expect(a.barsIn).toBe(0)
  })

  test('persistence: steps + idx survive a JSON project round-trip', () => {
    freshDevice()
    arrAddStep(0, 4)
    arrAddStep(1, 8)
    const snap = JSON.parse(JSON.stringify(I.p))
    expect(snap.arranger).toBeDefined()
    expect(snap.arranger.steps).toEqual([{ scene: 0, bars: 4 }, { scene: 1, bars: 8 }])
    // simulate import: new project object without arranger -> fresh state
    const imported = JSON.parse(JSON.stringify(snap))
    delete imported.arranger
    I.p = imported
    expect(arrState().steps).toEqual([])
    // restore full snapshot -> steps preserved
    I.p = JSON.parse(JSON.stringify(snap))
    expect(arrState().steps.length).toBe(2)
    arrRemoveStep(0)
    expect(arrState().steps.length).toBe(1)
  })

  test('advance timing is bar-quantized: pending set exactly at section boundaries', () => {
    freshDevice()
    // scenes 0/1 carry patterns A/B in the TECHNO factory project
    arrAddStep(0, 4)
    arrAddStep(1, 2)
    // ON launches section 0 immediately via the quantized (pending) path
    expect(arrToggle(true)).toBe(true)
    expect(I.pending).toBe(0)
    expect(I.p.activeScene).toBe(0) // not applied yet — scheduler applies at bar start
    // bars 1..3: no advance
    arrBarHook(); arrBarHook(); arrBarHook()
    expect(I.pending).toBe(0)
    // bar 4: section 0 (4 bars) complete -> advance to section 1 (scene 1)
    arrBarHook()
    expect(I.pending).toBe(1)
    // section 1 is 2 bars: bar 5 no, bar 6 yes -> wraps to section 0
    arrBarHook()
    expect(I.pending).toBe(1)
    arrBarHook()
    expect(I.pending).toBe(0)
  })

  test('toggle ON with no sections stays OFF', () => {
    freshDevice()
    expect(arrToggle(true)).toBe(false)
    expect(arrView().on).toBe(false)
  })

  test('arrSetStep clamps bars, remove keeps idx valid', () => {
    freshDevice()
    arrAddStep(0, 4); arrAddStep(1, 4)
    arrSetStep(0, { bars: 999 })
    expect(arrState().steps[0].bars).toBe(64)
    arrSetStep(0, { bars: 0 })
    expect(arrState().steps[0].bars).toBe(1)
    arrRemoveStep(0)
    expect(arrState().steps.length).toBe(1)
    expect(arrState().idx).toBe(0)
    arrRemoveStep(0)
    expect(arrState().on).toBe(false) // empty list stops the arranger
  })

  test('manual override: user scene launch stops auto-advance', () => {
    freshDevice()
    arrInstrument()
    arrAddStep(0, 2)
    arrAddStep(1, 2)
    arrToggle(true)
    expect(I.pending).toBe(0)
    // user manually launches scene 3 -> arranger turns OFF
    PERF.launch(3)
    expect(arrView().on).toBe(false)
    const pendingBefore = I.pending
    for (let i = 0; i < 8; i++) arrBarHook()
    expect(I.pending).toBe(pendingBefore) // no further auto-advance
  })

  test('arranger does not advance while transport is stopped', () => {
    freshDevice()
    arrInstrument()
    arrAddStep(0, 1)
    arrAddStep(1, 1)
    arrToggle(true)
    I.sched.on = false
    arrBarHook()
    expect(arrView().barsIn).toBe(0) // paused: no counting
    expect(I.pending).toBe(0)
  })
})

/* ── Run 9 P2: timeline editor ops + PLAY SONG ─────────────────────────── */
import { arrMoveStep, arrInsertStep, arrSongInfo } from '../js/arranger.js'
import { encodeShare, decodeShare } from '../js/share.js'
import { compose } from '../js/composer.js'

describe('timeline editor ops (Run 9)', () => {
  test('arrMoveStep swaps neighbors; playing idx follows its step; bounds respected', () => {
    freshDevice()
    arrAddStep(0, 4); arrAddStep(1, 2); arrAddStep(2, 8)
    arrToggle(true) /* idx=0, pending=0 */
    for (let i = 0; i < 4; i++) arrBarHook() /* section 0 (4 bars) completes */
    expect(arrState().idx).toBe(1)
    const r = arrMoveStep(1, 1) /* swap 1↔2 */
    expect(r.ok).toBe(true)
    expect(arrState().steps[2].scene).toBe(1)
    expect(arrState().idx).toBe(2) /* the playing step moved with the swap */
    expect(arrMoveStep(0, -1).ok).toBe(false) /* out of bounds */
    expect(arrMoveStep(2, 1).ok).toBe(false)
  })
  test('arrInsertStep inserts with scene-bars default, clamps 1..64', () => {
    freshDevice()
    arrAddStep(0, 4)
    /* scenes[1] in TECHNO factory has no bars override → default 4 */
    arrInsertStep(1, 1, 0)
    expect(arrState().steps.length).toBe(2)
    expect(arrState().steps[1].scene).toBe(1)
    expect(arrState().steps[1].bars).toBeGreaterThanOrEqual(1)
    arrInsertStep(99, 2, 999) /* append + clamp */
    expect(arrState().steps.length).toBe(3)
    expect(arrState().steps[2].bars).toBe(64)
    arrInsertStep(1, 2, 0) /* middle insert */
    expect(arrState().steps[1].scene).toBe(2)
  })
  test('edits persist across a JSON project round-trip', () => {
    freshDevice()
    arrAddStep(0, 4); arrAddStep(1, 2)
    arrMoveStep(0, 1)
    arrSetStep(0, { bars: 6 })
    const snap = JSON.parse(JSON.stringify(I.p))
    I.p = JSON.parse(JSON.stringify(snap))
    expect(arrState().steps.map(s => s.scene)).toEqual([1, 0])
    expect(arrState().steps[0].bars).toBe(6) /* set hit the swapped step 0 */
  })
  test('arranger edits survive a share-link round-trip', async () => {
    freshDevice()
    arrAddStep(0, 4); arrAddStep(1, 2)
    arrMoveStep(1, -1) /* [1,0] */
    const p = I.p
    const r = await encodeShare(p)
    expect(r.token).toBeTruthy()
    const d = await decodeShare(r.token!)
    const q: any = d.project
    expect(q.arranger.steps.map((s: any) => [s.scene, s.bars])).toEqual([[1, 2], [0, 4]])
  })
  test('arrSongInfo: sections/bars/durations match the song-render view', () => {
    I.p = compose('FULL-ON', 3, 424242).project
    const info = arrSongInfo()
    expect(info.sections).toBe(17) /* v0.7.0: 17 distinct sections (variants) */
    expect(info.bars).toBe(136)
    expect(info.bpm).toBe(145)
    const sd = 60 / 145 / 4
    expect(info.music).toBeCloseTo(136 * 16 * sd, 9)
    expect(info.withTail).toBeCloseTo(info.music + 32 * sd, 9)
  })
  test('PLAY SONG offline-sim: reaches section 2 within expected wall bars', () => {
    freshDevice()
    arrAddStep(0, 4); arrAddStep(1, 2); arrAddStep(2, 4)
    /* PLAY SONG = arrToggle(true) + transport start; sim drives the hook */
    expect(arrToggle(true)).toBe(true)
    expect(arrState().idx).toBe(0)
    for (let i = 0; i < 4; i++) arrBarHook() /* section 0: 4 bars */
    expect(arrState().idx).toBe(1)
    for (let i = 0; i < 2; i++) arrBarHook() /* section 1: 2 bars */
    expect(arrState().idx).toBe(2) /* section 2 reached after exactly 6 bars */
    expect(arrState().barsIn).toBe(0)
    for (let i = 0; i < 3; i++) arrBarHook()
    expect(arrState().idx).toBe(2) /* still in section 2 (4 bars) */
    expect(arrState().barsIn).toBe(3)
  })
})
