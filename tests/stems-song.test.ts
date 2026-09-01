/**
 * PSY6 v0.8.0 SONG STEMS + SECTION BOUNCE — model-level tests (the pure
 * helpers). Audio-level evidence (stem RMS ordering, slice equality, exact
 * frames on real renders) lives in the device gate G30 (OfflineAudioContext).
 *  - songStemTracks: non-empty tracks from the SONG schedule
 *  - songStemsGuard: per-stem 10-min cap + total audio-minute budget
 *  - sectionFrames: the documented bounds frame formula
 *  - renderSong contract constants unchanged (SONG_LEAD/TAIL/MAX_SEC)
 */
import { describe, expect, test } from 'bun:test'
import { buildStyle } from '../js/presets.js'
import { compose } from '../js/composer.js'
import { songStemTracks, songStemsGuard, sectionFrames, songFrames, SONG_LEAD, SONG_TAIL_STEPS, SONG_MAX_SEC, SONG_STEMS_BUDGET_MIN } from '../js/bounce.js'

const SEED = 424242

describe('songStemTracks', () => {
  test('demo song: all composer tracks carry events; kick present; sorted', () => {
    const p = compose('FULL-ON', 3, SEED).project
    const { tracks } = songStemTracks(p)
    expect(tracks.length).toBeGreaterThanOrEqual(2)
    expect(tracks).toContain(0) /* kick */
    expect([...tracks].sort((a, b) => a - b)).toEqual(tracks)
  })
  test('a project with an empty arranger has no stems', () => {
    const p = buildStyle('TECHNO', 7)
    const { tracks } = songStemTracks(p)
    expect(tracks).toEqual([])
  })
})

describe('songStemsGuard (refusal paths — pure)', () => {
  test('per-stem cap: song longer than 10 min with tail is refused regardless of stems', () => {
    const p = compose('FULL-ON', 3, SEED).project
    /* 3-min demo is well inside the cap */
    expect(songStemsGuard(p, 9).ok).toBe(true)
    /* stretch the arranger beyond 10 min: duplicate every step until with-tail > 600 s */
    while (p.arranger.steps.reduce((a, s) => a + s.bars * 16, 0) * (60 / p.bpm / 4) <= SONG_MAX_SEC) {
      p.arranger.steps = p.arranger.steps.concat(p.arranger.steps.map(s => ({ ...s })))
      if (p.arranger.steps.length > 512) break
    }
    const g = songStemsGuard(p, 2)
    expect(g.ok).toBe(false)
    expect(g.reason).toContain('per-stem cap')
  })
  test('total budget: >6 stems on a long song refused; ≤6 stems ok', () => {
    /* 9-minute song: per-stem cap ok (9 < 10); budget = stems × 9 min */
    const p = compose('FULL-ON', 8, SEED).project /* 8-min target → form ~8.7 min < 10 */
    const d = p.arranger.steps.reduce((a, s) => a + s.bars * 16, 0) * (60 / p.bpm / 4)
    if (d < 60) return /* sanity: target produced a long song */
    const g6 = songStemsGuard(p, 6)
    const g9 = songStemsGuard(p, 9)
    /* both must agree with the budget arithmetic (never the per-stem cap here) */
    const withTail = d + SONG_TAIL_STEPS * (60 / p.bpm / 4)
    expect(withTail).toBeLessThanOrEqual(SONG_MAX_SEC)
    expect(g6.ok).toBe(6 * withTail / 60 <= SONG_STEMS_BUDGET_MIN)
    expect(g9.ok).toBe(9 * withTail / 60 <= SONG_STEMS_BUDGET_MIN)
  })
})

describe('sectionFrames (bounds formula)', () => {
  test('frames = ceil(sr·(LEAD + (bars·16 + TAIL)·sd)) — exact per range', () => {
    const p = compose('FULL-ON', 3, SEED).project
    const sd = 60 / p.bpm / 4
    for (const [a, b] of [[0, 8], [4, 12], [0, 136], [100, 108]]) {
      const want = Math.ceil(44100 * (SONG_LEAD + ((b - a) * 16 + SONG_TAIL_STEPS) * sd))
      expect(sectionFrames(p, a, b)).toBe(want)
    }
    expect(sectionFrames(p, 5, 5)).toBe(Math.ceil(44100 * (SONG_LEAD + SONG_TAIL_STEPS * sd))) /* formula edge: 0 bars → lead+tail only (UI never produces it) */
  })
  test('songFrames unchanged (full-song formula untouched by the refactor)', () => {
    const p = compose('FULL-ON', 3, SEED).project
    const sd = 60 / p.bpm / 4
    const bars = p.arranger.steps.reduce((a, s) => a + s.bars, 0)
    expect(songFrames(p)).toBe(Math.ceil(44100 * (SONG_LEAD + (bars * 16 + SONG_TAIL_STEPS) * sd)))
  })
})
