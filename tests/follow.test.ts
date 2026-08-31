/**
 * PSY6 v0.7.0 follow-action tests — seeded performance evolution.
 *
 *  - pure model: sceneSetFollow validation, followBars precedence
 *    (afterBars > scene.bars > pattern loop)
 *  - offline simulation: each mode's 20-transition run reaches the exact
 *    expected state sequence (all scenes configured — the scripted chain)
 *  - prob=0 → documented 'next' fallback; prob=100 never misses
 *  - seeded replayability: same seed + start → identical sequence
 *  - persistence round-trip (JSON serialize/parse) + share-link round-trip
 *  - zero legacy impact: scenes without follow keep the chainNext cadence
 */
import { describe, expect, test } from 'bun:test'
import { compose } from '../js/composer.js'
import { sceneSetFollow, resolveFollow, followBars, chainNext } from '../js/scenes.js'
import { encodeShare, decodeShare } from '../js/share.js'

const SEED = 424242

function scriptedProject() {
  /* the composed demo: 17 scenes, ALL with patterns — the scripted chain */
  const p = compose('FULL-ON', 3, SEED).project
  p.chain = true
  return p
}
function sim(p, start, n) {
  let cur = start; const seq = [start]
  for (let k = 0; k < n; k++) {
    const nx = resolveFollow(p, cur, k)
    if (nx == null) break
    seq.push(nx); cur = nx
  }
  return seq
}

describe('follow model', () => {
  test('sceneSetFollow validates and clears', () => {
    const p = scriptedProject()
    expect(sceneSetFollow(p, 2, { mode: 'random', prob: 100 })).toBe(true)
    expect(p.scenes[2].follow).toEqual({ mode: 'random', target: null, prob: 100, afterBars: null })
    expect(sceneSetFollow(p, 2, { mode: 'bogus' }).valueOf()).toBe(true) /* unknown → 'none' → cleared */
    expect(p.scenes[2].follow).toBeUndefined()
    expect(sceneSetFollow(p, 2, { mode: 'scene', target: 5, prob: 50, afterBars: 4 })).toBe(true)
    expect(p.scenes[2].follow).toEqual({ mode: 'scene', target: 5, prob: 50, afterBars: 4 })
    expect(sceneSetFollow(p, 2, { mode: 'scene', target: 999, prob: 100 })).toBe(true)
    expect(p.scenes[2].follow.target).toBe(p.scenes.length - 1) /* clamped */
    expect(sceneSetFollow(p, 2, null)).toBe(true)
    expect(p.scenes[2].follow).toBeUndefined()
    expect(sceneSetFollow(p, 99, { mode: 'next' })).toBe(false)
  })
  test('followBars precedence: afterBars > scene.bars > pattern loop', () => {
    const p = scriptedProject()
    const fw = { mode: 'next', afterBars: 4 }
    expect(followBars(fw, p.scenes[2], 128)).toBe(4)      /* afterBars wins */
    expect(followBars({ mode: 'next' }, p.scenes[2], 128)).toBe(8) /* scene.bars=8 */
    expect(followBars({ mode: 'next' }, { bars: null }, 128)).toBe(8) /* pattern loop */
    expect(followBars({ mode: 'next', afterBars: 2 }, { bars: 16 }, 32)).toBe(2)
  })
  test('legacy scenes untouched: no follow → resolveFollow null → chainNext governs', () => {
    const p = scriptedProject()
    for (const sc of p.scenes) expect(sc.follow).toBeUndefined()
    expect(resolveFollow(p, 2, 0)).toBeNull()
    p.activeScene = 2
    expect(chainNext(p)).toBe(3) /* the legacy pure advance still exact */
  })
})

describe('follow offline simulations (20 transitions, scripted chain)', () => {
  test("mode 'next': exact walking sequence with wrap", () => {
    const p = scriptedProject()
    for (const sc of p.scenes) sceneSetFollow(p, p.scenes.indexOf(sc), { mode: 'next', prob: 100 })
    const seq = sim(p, 2, 20)
    expect(seq).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 0, 1, 2, 3, 4, 5])
  })
  test("mode 'prev': exact descending sequence with wrap", () => {
    const p = scriptedProject()
    for (let i = 0; i < p.scenes.length; i++) sceneSetFollow(p, i, { mode: 'prev', prob: 100 })
    const seq = sim(p, 2, 12)
    expect(seq).toEqual([2, 1, 0, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7])
  })
  test("mode 'scene': locks to the target (relaunch)", () => {
    const p = scriptedProject()
    for (let i = 0; i < p.scenes.length; i++) sceneSetFollow(p, i, { mode: 'scene', target: 4, prob: 100 })
    expect(sim(p, 2, 6)).toEqual([2, 4, 4, 4, 4, 4, 4])
  })
  test("mode 'scene' with an EMPTY target never launches (legacy no-multi-skip)", () => {
    const p = scriptedProject()
    p.scenes[4].pattern = null
    for (let i = 0; i < p.scenes.length; i++) sceneSetFollow(p, i, { mode: 'scene', target: 4, prob: 100 })
    const seq = sim(p, 2, 3)
    expect(seq).toEqual([2]) /* null → keep playing */
  })
  test("mode 'random' seed 424242: exact PINNED sequence + replay identical", () => {
    const p = scriptedProject()
    for (let i = 0; i < p.scenes.length; i++) sceneSetFollow(p, i, { mode: 'random', prob: 100 })
    const seq = sim(p, 2, 20)
    /* pinned literal (documented evidence): the exact seeded walk */
    expect(seq).toEqual([2, 2, 11, 11, 9, 9, 4, 13, 8, 16, 11, 9, 1, 15, 8, 1, 8, 6, 0, 13, 0])
    const replay = sim(p, 2, 20)
    expect(replay).toEqual(seq) /* same seed + start → identical */
    for (const s of seq) expect(s).toBeGreaterThanOrEqual(0), expect(s).toBeLessThan(p.scenes.length)
  })
  test('prob=0 → every decision falls back to next (documented)', () => {
    const p = scriptedProject()
    for (let i = 0; i < p.scenes.length; i++) sceneSetFollow(p, i, { mode: 'random', prob: 0 })
    expect(sim(p, 2, 8)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10])
    for (let i = 0; i < p.scenes.length; i++) sceneSetFollow(p, i, { mode: 'scene', target: 0, prob: 0 })
    expect(sim(p, 2, 5)).toEqual([2, 3, 4, 5, 6, 7]) /* even 'scene' falls back on a miss */
  })
  test('prob clamps: 150 → 100, -5 → 0', () => {
    const p = scriptedProject()
    sceneSetFollow(p, 2, { mode: 'random', prob: 150 })
    expect(p.scenes[2].follow.prob).toBe(100)
    sceneSetFollow(p, 2, { mode: 'random', prob: -5 })
    expect(p.scenes[2].follow.prob).toBe(0)
  })
  test('different project seeds → different random sequences (seeding is real)', () => {
    const a = scriptedProject()
    const b = compose('FULL-ON', 3, 999999).project; b.chain = true
    for (const pp of [a, b]) for (let i = 0; i < pp.scenes.length; i++) sceneSetFollow(pp, i, { mode: 'random', prob: 100 })
    expect(sim(a, 2, 12)).not.toEqual(sim(b, 2, 12))
  })
})

describe('follow persistence', () => {
  test('JSON round-trip preserves follow configs byte-exactly', () => {
    const p = scriptedProject()
    sceneSetFollow(p, 2, { mode: 'random', prob: 80, afterBars: 4 })
    sceneSetFollow(p, 5, { mode: 'scene', target: 1, prob: 50 })
    const q = JSON.parse(JSON.stringify(p))
    expect(q.scenes[2].follow).toEqual(p.scenes[2].follow)
    expect(q.scenes[5].follow).toEqual(p.scenes[5].follow)
    /* and the resolution is identical on the restored project */
    let a = 2, b = 2
    for (let k = 0; k < 8; k++) { a = resolveFollow(p, a, k); b = resolveFollow(q, b, k); expect(a).toBe(b) }
  })
  test('share-link round-trip preserves follow configs', async () => {
    const p = scriptedProject()
    sceneSetFollow(p, 2, { mode: 'random', prob: 90, afterBars: 2 })
    sceneSetFollow(p, 9, { mode: 'prev', prob: 100 })
    const r = await encodeShare(p)
    const d = await decodeShare(r.token!)
    const q: any = d.project
    expect(q.scenes[2].follow).toEqual(p.scenes[2].follow)
    expect(q.scenes[9].follow).toEqual(p.scenes[9].follow)
  })
})
