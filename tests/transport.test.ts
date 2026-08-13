import { describe, expect, test } from 'bun:test'
import { TransportClock } from '../src/transport.ts'
import type { BeatObservation } from '../src/types.ts'

function perfectBeats(bpm: number, count: number, start = 1): BeatObservation[] {
  const interval = 60 / bpm
  return Array.from({ length: count }, (_, i) => ({
    observedAt: start + i * interval,
    strength: 1,
    source: 'test',
  }))
}

function jitter(beats: BeatObservation[], maxSec: number, seed = 1): BeatObservation[] {
  let s = seed
  const rng = () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
  return beats.map((b) => ({ ...b, observedAt: b.observedAt + (rng() - 0.5) * 2 * maxSec }))
}

describe('TransportClock — perfect beats', () => {
  test('converges to target bpm and locks', () => {
    const clock = new TransportClock({ initialBpm: 120 })
    const beats = perfectBeats(150, 16)
    for (const b of beats) clock.observe(b)
    const snap = clock.snapshot(beats[beats.length - 1].observedAt)
    expect(snap.bpm).toBeGreaterThan(148)
    expect(snap.bpm).toBeLessThan(152)
    expect(snap.locked).toBe(true)
    expect(snap.confidence).toBeGreaterThan(0.7)
    expect(snap.observationCount).toBe(16)
  })

  test('beat index advances monotonically', () => {
    const clock = new TransportClock()
    const beats = perfectBeats(120, 8)
    for (const b of beats) clock.observe(b)
    const snap = clock.snapshot(beats[7].observedAt)
    expect(snap.beat).toBeGreaterThanOrEqual(7)
    expect(snap.beat).toBeLessThanOrEqual(8)
  })

  test('phase is near 0 right at an observed beat', () => {
    const clock = new TransportClock()
    const beats = perfectBeats(140, 16)
    for (const b of beats) clock.observe(b)
    const snap = clock.snapshot(beats[15].observedAt)
    expect(snap.phase).toBeLessThan(0.05)
  })
})

describe('TransportClock — jitter', () => {
  test('lower confidence than perfect, still locks', () => {
    const perfect = perfectBeats(150, 32)
    const jittered = jitter(perfect, 0.012)
    const clock = new TransportClock()
    for (const b of jittered) clock.observe(b)
    const snap = clock.snapshot(jittered[31].observedAt)
    expect(snap.bpm).toBeGreaterThan(146)
    expect(snap.bpm).toBeLessThan(154)
    expect(snap.locked).toBe(true)
    const perfectClock = new TransportClock()
    for (const b of perfect) perfectClock.observe(b)
    const perfectSnap = perfectClock.snapshot(perfect[31].observedAt)
    expect(snap.confidence).toBeLessThanOrEqual(perfectSnap.confidence)
  })
})

describe('TransportClock — missing beat', () => {
  test('octave-fold keeps bpm stable when one beat is dropped', () => {
    const beats = perfectBeats(150, 16)
    const withMissing = [...beats.slice(0, 8), ...beats.slice(9)]
    const clock = new TransportClock()
    for (const b of withMissing) clock.observe(b)
    const snap = clock.snapshot(withMissing[withMissing.length - 1].observedAt)
    expect(snap.bpm).toBeGreaterThan(135)
    expect(snap.bpm).toBeLessThan(165)
  })
})

describe('TransportClock — false beat', () => {
  test('octave-fold rejects an extra midpoint beat', () => {
    const beats = perfectBeats(150, 12)
    const interval = 60 / 150
    const falseBeat: BeatObservation = {
      observedAt: beats[5].observedAt + interval / 2,
      strength: 0.6,
      source: 'false',
    }
    const withFalse = [...beats.slice(0, 6), falseBeat, ...beats.slice(6)]
    const clock = new TransportClock()
    for (const b of withFalse) clock.observe(b)
    const snap = clock.snapshot(withFalse[withFalse.length - 1].observedAt)
    expect(snap.bpm).toBeLessThan(190)
    expect(snap.bpm).toBeGreaterThan(130)
  })
})

describe('TransportClock — gap recovery', () => {
  test('marks unlocked after gapTimeout, relocks when beats resume', () => {
    const clock = new TransportClock({ gapTimeout: 1.0 })
    const beats = perfectBeats(140, 8)
    for (const b of beats) clock.observe(b)
    const beforeGap = clock.snapshot(beats[7].observedAt)
    expect(beforeGap.locked).toBe(true)
    const duringGap = clock.snapshot(beats[7].observedAt + 3)
    expect(duringGap.locked).toBe(false)
    expect(duringGap.confidence).toBeLessThan(beforeGap.confidence)
    const resume = perfectBeats(140, 8, beats[7].observedAt + 3.5)
    const revBefore = duringGap.revision
    for (const b of resume) clock.observe(b)
    const after = clock.snapshot(resume[7].observedAt)
    expect(after.locked).toBe(true)
    expect(after.revision).toBeGreaterThan(revBefore)
  })
})

describe('TransportClock — tempo change', () => {
  test('tracks a bpm step from 130 to 160', () => {
    const clock = new TransportClock({ tempoSmoothing: 0.5 })
    const slow = perfectBeats(130, 16)
    const fast = perfectBeats(160, 16, slow[15].observedAt + 60 / 130)
    for (const b of [...slow, ...fast]) clock.observe(b)
    const snap = clock.snapshot(fast[15].observedAt)
    expect(snap.bpm).toBeGreaterThan(150)
    expect(snap.bpm).toBeLessThan(170)
  })
})

describe('TransportClock — determinism', () => {
  test('same observations → same snapshot', () => {
    const beats = jitter(perfectBeats(145, 24), 0.01, 42)
    const a = new TransportClock()
    const b = new TransportClock()
    for (const beat of beats) {
      a.observe(beat)
      b.observe(beat)
    }
    const sa = a.snapshot(beats[23].observedAt)
    const sb = b.snapshot(beats[23].observedAt)
    expect(sa.bpm).toBe(sb.bpm)
    expect(sa.beat).toBe(sb.beat)
    expect(sa.revision).toBe(sb.revision)
    expect(sa.confidence).toBe(sb.confidence)
  })
})

describe('TransportClock — revision', () => {
  test('revision starts at 0 and bumps on first observation', () => {
    const clock = new TransportClock()
    expect(clock.snapshot(0).revision).toBe(0)
    clock.observe({ observedAt: 1, strength: 1 })
    expect(clock.snapshot(1).revision).toBeGreaterThanOrEqual(1)
  })

  test('revision bumps on relock after drift', () => {
    const clock = new TransportClock()
    const beats = perfectBeats(150, 12)
    for (const b of beats) clock.observe(b)
    const r1 = clock.snapshot(beats[11].observedAt).revision
    clock.observe({ observedAt: beats[11].observedAt + (60 / 150) * 1.5, strength: 1 })
    const r2 = clock.snapshot(beats[11].observedAt + 0.6).revision
    expect(r2).toBeGreaterThan(r1)
  })
})

describe('TransportClock — predict', () => {
  test('predicts future beat index linearly from origin', () => {
    const clock = new TransportClock()
    const beats = perfectBeats(120, 8)
    for (const b of beats) clock.observe(b)
    const at = beats[7].observedAt
    const nowBeat = clock.predict(at)
    const futureBeat = clock.predict(at + 1)
    expect(futureBeat - nowBeat).toBeCloseTo(2, 1)
  })
})
