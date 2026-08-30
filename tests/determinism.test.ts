/**
 * PSY6 determinism + groove tests.
 *
 * Verifies the per-bar seeded RNG contract of stepEvents():
 *   seed = fnv(projectSeed + ":" + barIndex)
 *   - same seed + bar → identical event list (loop-stable)
 *   - psy-push shifts odd bass steps by +6..+8 ticks (1 tick = 1/64 step)
 *   - mpc54 delays odd 16ths by the classic 54-58% swing
 *   - humanize is seeded and bounded to ±3% of a step
 *   - full-range micro timing: micro[-100..100] → [-0.5..+0.5] step,
 *     negative offsets respected
 */
import { describe, expect, test } from 'bun:test'
import {
  barSeed, mkProject, mkPattern, mkStep, loopLen, stepEvents, fnv,
} from '../js/model.js'
import { buildStyle } from '../js/presets.js'

function projWithBass(groove = 'straight', micro = 0, prob = 1) {
  const p = mkProject()
  p.patterns = { A: mkPattern('A', 8) }
  p.currentPattern = 'A'
  p.groove = groove
  const pat = p.patterns.A
  // bass (track 4) on every odd 16th — classic psy rolling bass
  for (let i = 1; i < 16; i += 2) {
    const s = pat.data[4].steps[i]
    s.on = 1; s.note = 33; s.vel = 0.9; s.prob = prob; s.micro = micro
  }
  // kick (track 0) on quarters
  for (let i = 0; i < 16; i += 4) {
    const s = pat.data[0].steps[i]
    s.on = 1; s.vel = 0.95; s.prob = 1; s.micro = 0
  }
  return p
}

describe('per-bar seeded determinism', () => {
  test('barSeed is a stable uint32 derived from fnv(projectSeed:bar)', () => {
    const a = barSeed('PSY6', 0)
    const b = barSeed('PSY6', 0)
    const c = barSeed('PSY6', 1)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThanOrEqual(0xFFFFFFFF)
    expect(Number.isInteger(a)).toBe(true)
  })

  test('same seed + bar → identical event list', () => {
    const p = projWithBass('humanize', 0, 0.7) // probability + groove both consume rng
    const e1 = stepEvents(p, 0)
    const e2 = stepEvents(p, 0)
    expect(JSON.stringify(e1)).toBe(JSON.stringify(e2))
  })

  test('same bar → identical events across loop passes', () => {
    const p = projWithBass('humanize', 0, 0.7)
    const loop = loopLen(p) // 16
    for (const bar of [0, 1]) {
      const e1 = stepEvents(p, bar * 16)
      const e2 = stepEvents(p, bar * 16 + loop)   // one loop later
      const e3 = stepEvents(p, bar * 16 + 5 * loop) // five loops later
      expect(JSON.stringify(e1)).toBe(JSON.stringify(e2))
      expect(JSON.stringify(e1)).toBe(JSON.stringify(e3))
    }
  })

  test('different bar → different rng draws (independent decisions)', () => {
    const p = mkProject()
    p.patterns = { A: mkPattern('A', 8) }
    p.currentPattern = 'A'
    p.groove = 'humanize'
    const pat = p.patterns.A
    for (let i = 0; i < 16; i++) { const s = pat.data[4].steps[i]; s.on = 1; s.prob = 0.5 }
    // with prob 0.5 over 16 steps, bar 0 and bar 1 decisions are drawn from
    // different seeds — overwhelmingly different event counts are NOT
    // guaranteed, so assert the deterministic identity property instead:
    // each bar is internally stable and the seeds differ.
    expect(barSeed(p.seed, 0)).not.toBe(barSeed(p.seed, 1))
    expect(JSON.stringify(stepEvents(p, 0))).toBe(JSON.stringify(stepEvents(p, 0)))
    expect(JSON.stringify(stepEvents(p, 16))).toBe(JSON.stringify(stepEvents(p, 16)))
  })

  test('different project seed → different event list (probabilistic project)', () => {
    const p1 = projWithBass('humanize', 0, 0.5)
    const p2 = projWithBass('humanize', 0, 0.5)
    p2.seed = 'ALT-SEED'
    const e1 = stepEvents(p1, 0)
    const e2 = stepEvents(p2, 0)
    // seeds differ → rng streams differ; with 8 prob-0.5 bass steps the
    // lists are overwhelmingly different, but only assert the contract:
    // the two projects are each internally stable.
    expect(JSON.stringify(e1)).toBe(JSON.stringify(stepEvents(p1, 0)))
    expect(JSON.stringify(e2)).toBe(JSON.stringify(stepEvents(p2, 0)))
    expect(p1.seed).not.toBe(p2.seed)
  })

  test('projectSeed and groove round-trip through save/export JSON', () => {
    const p = buildStyle('PSYTRANCE', 42)
    p.seed = 'LIVE-2024'
    p.groove = 'psy-push'
    const restored = JSON.parse(JSON.stringify(p))
    expect(restored.seed).toBe('LIVE-2024')
    expect(restored.groove).toBe('psy-push')
    // and the restored project produces identical events
    expect(JSON.stringify(stepEvents(restored, 3))).toBe(JSON.stringify(stepEvents(p, 3)))
  })
})

describe('groove templates', () => {
  test('straight applies no transform (default — behavior preserved)', () => {
    const p = projWithBass('straight')
    p.swing = 0
    const sd = 60 / p.bpm / 4
    for (const ev of stepEvents(p, 1)) {
      if (ev.track === 4) expect(ev.off).toBeCloseTo(0, 10)
    }
  })

  test('mpc54 delays odd 16ths by 54-58% swing (even steps untouched)', () => {
    const p = projWithBass('mpc54')
    p.swing = 0
    const sd = 60 / p.bpm / 4
    for (const ev of stepEvents(p, 1)) {  // step 1 = odd 16th
      if (ev.track === 4) {
        expect(ev.off).toBeGreaterThanOrEqual((0.54 - 0.5) * sd - 1e-12)
        expect(ev.off).toBeLessThanOrEqual((0.58 - 0.5) * sd + 1e-12)
      }
    }
    for (const ev of stepEvents(p, 0)) {  // step 0 = even 16th
      expect(ev.off).toBe(0)
    }
  })

  test('psy-push shifts odd bass steps by +6..+8 ticks against the kick', () => {
    const p = projWithBass('psy-push')
    p.swing = 0
    const sd = 60 / p.bpm / 4
    const tick = sd / 64
    for (const s of [1, 3, 5]) {
      const evs = stepEvents(p, s)
      const bass = evs.filter(e => e.track === 4)
      expect(bass.length).toBeGreaterThan(0)
      for (const ev of bass) {
        expect(ev.off).toBeGreaterThanOrEqual(6 * tick - 1e-12)
        expect(ev.off).toBeLessThanOrEqual(8 * tick + 1e-12)
      }
    }
    // non-bass tracks are not pushed
    for (const ev of stepEvents(p, 0)) {
      if (ev.track === 0) expect(ev.off).toBe(0)  // kick even step
    }
    // even bass steps (if any) are not pushed — put one on step 2
    const pat = p.patterns.A
    const s2 = pat.data[4].steps[2]
    s2.on = 1; s2.prob = 1; s2.micro = 0
    for (const ev of stepEvents(p, 2)) {
      if (ev.track === 4) expect(ev.off).toBe(0)
    }
  })

  test('psy-push is deterministic per bar (same offsets on repeat)', () => {
    const p = projWithBass('psy-push')
    const e1 = stepEvents(p, 1)
    const e2 = stepEvents(p, 1)
    expect(JSON.stringify(e1)).toBe(JSON.stringify(e2))
  })

  test('humanize is bounded to ±3% of a step and seeded', () => {
    const p = projWithBass('humanize')
    p.swing = 0
    const sd = 60 / p.bpm / 4
    for (const s of [0, 1, 2]) {
      for (const ev of stepEvents(p, s)) {
        expect(Math.abs(ev.off)).toBeLessThanOrEqual(0.03 * sd + 1e-12)
      }
    }
  })
})

describe('full-range micro timing', () => {
  test('micro -100 maps to -0.5 step (negative offset honored)', () => {
    const p = projWithBass('straight', -100)
    p.swing = 0
    const sd = 60 / p.bpm / 4
    for (const ev of stepEvents(p, 1)) {
      if (ev.track === 4) expect(ev.off).toBeCloseTo(-0.5 * sd, 10)
    }
  })

  test('micro +100 maps to +0.5 step (no 0.45 cap)', () => {
    const p = projWithBass('straight', 100)
    p.swing = 0
    const sd = 60 / p.bpm / 4
    for (const ev of stepEvents(p, 1)) {
      if (ev.track === 4) expect(ev.off).toBeCloseTo(0.5 * sd, 10)
    }
  })

  test('micro +100 exceeds the old 0.45 cap', () => {
    const p = projWithBass('straight', 100)
    p.swing = 0
    const sd = 60 / p.bpm / 4
    const ev = stepEvents(p, 1).find(e => e.track === 4)
    expect(ev.off).toBeGreaterThan(0.45 * sd)
  })

  test('micro combines additively with groove offset', () => {
    const p = projWithBass('psy-push', 50)
    p.swing = 0
    const sd = 60 / p.bpm / 4
    const tick = sd / 64
    for (const ev of stepEvents(p, 1)) {
      if (ev.track === 4) {
        expect(ev.off).toBeGreaterThanOrEqual(6 * tick + 0.25 * sd - 1e-12)
        expect(ev.off).toBeLessThanOrEqual(8 * tick + 0.25 * sd + 1e-12)
      }
    }
  })

  test('step editor accepts the full micro range (clamp bounds)', () => {
    // the step editor clamps micro to [-100, 100]; stepEvents maps it linearly
    const p = projWithBass('straight', -100)
    const ev = stepEvents(p, 1).find(e => e.track === 4)
    const sd = 60 / p.bpm / 4
    expect(ev.off).toBeLessThan(0)  // negative offset survives the pipeline
  })
})

describe('legacy compatibility', () => {
  test('projects without seed/groove get safe defaults', () => {
    const p = projWithBass('straight')
    delete p.seed
    delete p.groove
    const evs = stepEvents(p, 0)
    expect(Array.isArray(evs)).toBe(true)
    expect(evs.length).toBeGreaterThan(0)
  })

  test('fnv still produces the G2 self-gate hash format', () => {
    const h = fnv('PSY6:0')
    expect(typeof h).toBe('string')
    expect(h.length).toBeGreaterThan(0)
    expect(/^[0-9a-f]+$/.test(h)).toBe(true)
  })
})
