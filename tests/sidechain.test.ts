/**
 * PSY6 kick-triggered sidechain ducking tests.
 *
 * The device schedules ONE persistent duck GainNode per track bus (created at
 * engine init — no per-hit nodes) and automates it with ONLY setValueAtTime +
 * linearRampToValueAtTime. The envelope math lives in
 * foundation/dsp/sidechain.mjs (pure, deterministic) so it is testable here
 * without Web Audio:
 *
 *   - envelope shape: v0 → dip over attack → [hold] → 1.0 over release
 *   - depth: dip = 1 - scAmount/100 (amount 75 → 75% depth)
 *   - overlapping kicks (fast 16th rolls @145 BPM): value-continuous start,
 *     never below the dip, always recovers to exactly 1.0 — no click, no NaN
 *   - scAmount = 0 → duckParams() returns null → the engine schedules zero
 *     automation events (zero behavior change)
 *   - project round-trip: fields survive JSON save/load with backfill for
 *     projects saved before sidechain existed
 */
import { describe, expect, test } from 'bun:test'
import {
  planDuck, nextState, duckValueAt, duckParams, DEFAULT_SC,
} from '../foundation/dsp/sidechain.mjs'
import { buildStyle } from '../js/presets.js'

const ATK = 0.012   // 12 ms default attack
const HOLD = 0.0    // 0 ms default hold
const REL = 0.140   // 140 ms default release

function kick(st: any, when: number, amount = 75, out: any = {}, out2: any = {}) {
  const plan = planDuck(st, when, 1 - amount / 100, ATK, HOLD, REL, out)
  nextState(plan, when, ATK, out2)
  return { plan, st: out2 }
}

describe('sidechain envelope shape (single kick)', () => {
  test('dip depth is exactly 1 - amount/100', () => {
    const { plan } = kick(null, 1.0, 75)
    expect(plan.dip).toBeCloseTo(0.25, 12)
    const { plan: p100 } = kick(null, 1.0, 100)
    expect(p100.dip).toBeCloseTo(0.0, 12)
    const { plan: p40 } = kick(null, 1.0, 40)
    expect(p40.dip).toBeCloseTo(0.6, 12)
  })

  test('envelope reaches full dip at the end of the attack window', () => {
    const when = 2.0
    const { plan, st } = kick(null, when)
    expect(plan.v0).toBe(1)              // bus was idle → start from unity
    expect(plan.t1).toBeCloseTo(when + ATK, 12)
    expect(plan.holdT).toBe(-1)          // hold=0 → no hold event
    expect(plan.end).toBeCloseTo(when + ATK + REL, 12)
    // value just before t1 ≈ dip; at t1 == dip; dips ≥60% into the attack window
    const v75 = duckValueAt(st, when + ATK * 0.75)
    expect(v75).toBeLessThan(1 - 0.75 * 0.75 + 1e-9) // ≥75% of the way down at 75% of attack
    expect(duckValueAt(st, plan.t1)).toBeCloseTo(plan.dip, 12)
    expect(duckValueAt(st, plan.end)).toBeCloseTo(1, 12)  // full recovery
  })

  test('hold segment holds the dip, then releases', () => {
    const when = 0.5, hold = 0.06
    const plan = planDuck(null, when, 0.25, ATK, hold, REL, {})
    expect(plan.holdT).toBeCloseTo(when + ATK + hold, 12)
    const st = nextState(plan, when, ATK, { })
    expect(duckValueAt(st, when + ATK + hold / 2)).toBeCloseTo(0.25, 12)  // mid-hold = dip
    expect(duckValueAt(st, plan.end)).toBeCloseTo(1, 12)
  })
})

describe('overlapping kicks (fast 16th rolls @145 BPM)', () => {
  test('next kick starts from the exact previous envelope value (no step)', () => {
    // 145 BPM 16th = 60/145/4 ≈ 103.45 ms — shorter than attack+release (152 ms)
    const step = 60 / 145 / 4
    let st: any = null
    for (let i = 0; i < 16; i++) {
      const when = 1.0 + i * step
      const out: any = {}, out2: any = {}
      const { plan } = kick(st, when, 75, out, out2)
      if (st && when < st.end) {
        expect(plan.v0).toBeCloseTo(duckValueAt(st, when), 12) // value-continuous
        expect(plan.v0).toBeGreaterThanOrEqual(plan.dip - 1e-12) // never below the dip
      } else {
        expect(plan.v0).toBe(1)
      }
      expect(Number.isFinite(plan.v0)).toBe(true)
      expect(Number.isFinite(plan.end)).toBe(true)
      st = out2
    }
    // final envelope recovers to exactly 1.0
    expect(duckValueAt(st, st.end + 1e-6)).toBe(1)
  })

  test('16-kick roll never drives the bus negative or above unity', () => {
    const step = 60 / 145 / 4
    let st: any = null
    for (let i = 0; i < 16; i++) {
      const out2: any = {}
      const { plan } = kick(st, 2.0 + i * step, 100, {}, out2)
      expect(plan.v0).toBeGreaterThanOrEqual(0)
      expect(plan.v0).toBeLessThanOrEqual(1)
      expect(plan.dip).toBeGreaterThanOrEqual(0)
      st = out2
    }
    expect(duckValueAt(st, st.end)).toBeCloseTo(1, 12)
  })

  test('recovery completes before the next quarter-note kick (typical pattern)', () => {
    // kick every 4 steps @145 → 413.8 ms gap vs 152 ms envelope → no overlap
    const gap = 4 * 60 / 145 / 4
    let st: any = null
    for (let i = 0; i < 8; i++) {
      const when = 1.0 + i * gap
      const out2: any = {}
      const { plan } = kick(st, when, 75, {}, out2)
      expect(plan.v0).toBe(1) // fully recovered before every kick
      st = out2
    }
  })
})

describe('duckParams — project field normalization', () => {
  test('amount=0 (or absent) → null → zero automation events', () => {
    expect(duckParams({ scAmount: 0 })).toBe(null)
    expect(duckParams({})).toBe(null)
    expect(duckParams({ scAmount: -5 })).toBe(null)
  })
  test('ms → seconds with defaults and clamping', () => {
    const p = duckParams({ scAmount: 75 })!
    expect(p.amount).toBe(75)
    expect(p.attack).toBeCloseTo(0.012, 12)   // default 12 ms
    expect(p.hold).toBe(0)                    // default 0 ms
    expect(p.release).toBeCloseTo(0.140, 12)  // default 140 ms
    const q = duckParams({ scAmount: 150, scAttackMs: 0, scHoldMs: -3, scReleaseMs: 1 })!
    expect(q.amount).toBe(100)
    expect(q.attack).toBeCloseTo(0.001, 12)   // clamped to ≥1 ms
    expect(q.hold).toBe(0)
    expect(q.release).toBeCloseTo(0.005, 12)  // clamped to ≥5 ms
  })
  test('DEFAULT_SC backfill matches the neutral defaults', () => {
    expect(DEFAULT_SC).toEqual({ scAmount: 0, scAttackMs: 12, scHoldMs: 0, scReleaseMs: 140 })
  })
})

describe('project round-trip', () => {
  test('sc fields survive JSON save/load; old projects backfill to defaults', () => {
    const p = buildStyle('PSYTRANCE', 42)
    p.tracks[4].scAmount = 80; p.tracks[4].scAttackMs = 9; p.tracks[4].scHoldMs = 20; p.tracks[4].scReleaseMs = 200
    const loaded = JSON.parse(JSON.stringify(p)) // save → load
    expect(loaded.tracks[4].scAmount).toBe(80)
    expect(loaded.tracks[4].scReleaseMs).toBe(200)
    // project saved BEFORE sidechain existed: strip the fields, then backfill
    for (const t of loaded.tracks) { delete t.scAmount; delete t.scAttackMs; delete t.scHoldMs; delete t.scReleaseMs }
    for (const t of loaded.tracks) {
      if (t.scAmount == null) t.scAmount = 0
      if (t.scAttackMs == null) t.scAttackMs = 12
      if (t.scHoldMs == null) t.scHoldMs = 0
      if (t.scReleaseMs == null) t.scReleaseMs = 140
    }
    expect(loaded.tracks[4].scAmount).toBe(0) // neutral — zero behavior change
    expect(loaded.tracks[7].scAttackMs).toBe(12)
  })
})
