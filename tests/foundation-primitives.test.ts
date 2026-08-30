/**
 * psy-foundation primitive tests — the single source of truth consumed by
 * the PSY6 device (js/model.js imports mulberry32, fnv1a and the scale
 * table from foundation/).
 *
 * The fnv1a and mulberry32 vectors below are PINNED to the values produced
 * by the implementations that shipped inside the PSY6 device before the
 * foundation consolidation — proving the consolidation is behavior-neutral.
 *
 * Run: bun test tests/foundation-primitives.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { mulberry32, fnv1a, subSeed, rngFor, SCALES } from '../foundation/foundation.mjs'
import { SCALES as MUSIC_SCALES } from '../foundation/music/context.mjs'
import { SCALES as DEVICE_SCALES } from '../js/model.js'

describe('foundation PRNG (mulberry32)', () => {
  test('pinned sequence — identical to the pre-consolidation device PRNG', () => {
    const rng = mulberry32(42)
    expect(rng()).toBeCloseTo(0.6011037519201636, 15)
    expect(rng()).toBeCloseTo(0.44829055899754167, 15)
    expect(rng()).toBeCloseTo(0.8524657934904099, 15)
  })

  test('deterministic: same seed → same sequence', () => {
    const a = mulberry32(7)
    const b = mulberry32(7)
    for (let i = 0; i < 100; i++) expect(a()).toBe(b())
  })

  test('different seeds → different sequences', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    let differ = false
    for (let i = 0; i < 10; i++) if (a() !== b()) { differ = true; break }
    expect(differ).toBe(true)
  })

  test('rejects non-integer seeds (contract)', () => {
    expect(() => mulberry32(1.5 as unknown as number)).toThrow()
    expect(() => mulberry32('x' as unknown as number)).toThrow()
  })
})

describe('foundation string hash (fnv1a)', () => {
  test('pinned vectors — identical to the pre-consolidation device fnv', () => {
    expect(fnv1a('PSY6:0')).toBe('35c6db48f19f8aa1')
    expect(fnv1a('PSY6:1')).toBe('35c6da48f19f88ee')
    expect(fnv1a('')).toBe('cbf29ce484222325')   // FNV offset basis
    expect(fnv1a('PSY6')).toBe('927978199505ea53')
  })

  test('deterministic and seed-sensitive', () => {
    expect(fnv1a('PSY6:0')).toBe(fnv1a('PSY6:0'))
    expect(fnv1a('PSY6:0')).not.toBe(fnv1a('PSY6:1'))
    expect(fnv1a('A')).not.toBe(fnv1a('B'))
  })

  test('output is 64-bit hex', () => {
    const h = fnv1a('anything')
    expect(/^[0-9a-f]{1,16}$/.test(h)).toBe(true)
  })

  test('rejects non-string input (contract)', () => {
    expect(() => fnv1a(123 as unknown as string)).toThrow()
  })
})

describe('foundation derived seeds', () => {
  test('subSeed is deterministic per (seed, label) and label-sensitive', () => {
    expect(subSeed(1000, 'kick')).toBe(subSeed(1000, 'kick'))
    expect(subSeed(1000, 'kick')).not.toBe(subSeed(1000, 'snare'))
    expect(subSeed(1000, 'kick')).not.toBe(subSeed(1001, 'kick'))
  })

  test('rngFor composes subSeed + mulberry32 deterministically', () => {
    const a = rngFor(1000, 'lead')
    const b = rngFor(1000, 'lead')
    for (let i = 0; i < 50; i++) expect(a()).toBe(b())
  })
})

describe('foundation scale tables (device single source of truth)', () => {
  test('music SCALES is a superset containing every device alias target', () => {
    for (const key of ['naturalMinor', 'major', 'dorian', 'phrygian']) {
      expect(Array.isArray(MUSIC_SCALES[key])).toBe(true)
      expect(MUSIC_SCALES[key].length).toBe(7)
    }
  })

  test('device scale aliases resolve to the foundation intervals (no duplication)', () => {
    expect(DEVICE_SCALES.minor).toEqual(MUSIC_SCALES.naturalMinor)
    expect(DEVICE_SCALES.major).toEqual(MUSIC_SCALES.major)
    expect(DEVICE_SCALES.dorian).toEqual(MUSIC_SCALES.dorian)
    expect(DEVICE_SCALES.phrygian).toEqual(MUSIC_SCALES.phrygian)
    // and they are the same array references, not copies
    expect(DEVICE_SCALES.minor).toBe(MUSIC_SCALES.naturalMinor)
    expect(DEVICE_SCALES.phrygian).toBe(MUSIC_SCALES.phrygian)
  })

  test('foundation base SCALES stay consistent for their internal consumers', () => {
    expect(SCALES.naturalMinor).toEqual([0, 2, 3, 5, 7, 8, 10])
    expect(SCALES.phrygian).toEqual([0, 1, 3, 5, 7, 8, 10])
  })
})
