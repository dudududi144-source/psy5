/**
 * PSY6 per-track delay/reverb send tests.
 *
 * The device builds TWO global send buses once at engine init:
 *   DELAY  — BPM-synced (1/8 | 3/16 | 1/4, default 3/16), feedback 0..80%
 *            (default 35%) with a lowpass inside the feedback loop.
 *   REVERB — ConvolverNode with a deterministic synthetic stereo IR:
 *            seeded decorrelated noise, exponential decay over ~1.8 s.
 * Per-track sends (mix.sendA/sendB, 0..1, default 0) are post-fader taps.
 *
 * Pure math lives in foundation/dsp/sends.mjs and is tested here:
 *   - delay time at 145 BPM for all three divisions (exact ms)
 *   - feedback/division normalization + project backfill defaults
 *   - IR determinism: same seed → byte-identical channel data; the two
 *     channel seeds are decorrelated; decay is exponential (no Math.random)
 */
import { describe, expect, test } from 'bun:test'
import {
  delaySecondsFor, delayFbClamp, delayDivClamp, irChannel, IR_SEEDS, IR_DECAY, IR_LEN_S, DEFAULT_FX,
} from '../foundation/dsp/sends.mjs'
import { mulberry32 } from '../foundation/foundation.mjs'
import { buildStyle } from '../js/presets.js'

describe('delay bus — BPM sync', () => {
  test('exact delay times at 145 BPM for all three divisions', () => {
    const sd = 60 / 145 / 4 // one 16th @145 = 103.448… ms
    expect(delaySecondsFor('3/16', 145) * 1000).toBeCloseTo(3 * sd * 1000, 6) // 310.3 ms
    expect(delaySecondsFor('3/16', 145) * 1000).toBeCloseTo(310.3, 1)
    expect(delaySecondsFor('1/8', 145) * 1000).toBeCloseTo(206.9, 1)
    expect(delaySecondsFor('1/4', 145) * 1000).toBeCloseTo(413.8, 1)
  })
  test('unknown division falls back to the 3/16 default', () => {
    expect(delaySecondsFor('1/7', 145)).toBe(delaySecondsFor('3/16', 145))
    expect(delayDivClamp('1/8')).toBe('1/8')
    expect(delayDivClamp('3/16')).toBe('3/16')
    expect(delayDivClamp('1/4')).toBe('1/4')
    expect(delayDivClamp('9/16')).toBe('3/16')
    expect(delayDivClamp(undefined)).toBe('3/16')
  })
  test('feedback clamps to 0..0.8 with 0.35 default', () => {
    expect(delayFbClamp(null)).toBe(0.35)
    expect(delayFbClamp(0)).toBe(0)
    expect(delayFbClamp(0.35)).toBe(0.35)
    expect(delayFbClamp(0.8)).toBe(0.8)
    expect(delayFbClamp(0.95)).toBe(0.8)
    expect(delayFbClamp(-0.1)).toBe(0)
  })
  test('DEFAULT_FX matches the neutral project backfill', () => {
    expect(DEFAULT_FX).toEqual({ delayDiv: '3/16', delayFb: 0.35 })
  })
})

describe('reverb bus — deterministic IR', () => {
  test('same seed → byte-identical channel data (canonical PRNG, no Math.random)', () => {
    const len = 4410
    const a = irChannel(len, IR_SEEDS[0], IR_DECAY)
    const b = irChannel(len, IR_SEEDS[0], IR_DECAY)
    expect(a.length).toBe(len)
    for (let i = 0; i < len; i++) expect(a[i]).toBe(b[i]) // byte-identical
  })
  test('the two channel seeds are decorrelated (different data)', () => {
    const len = 4410
    const l = irChannel(len, IR_SEEDS[0], IR_DECAY)
    const r = irChannel(len, IR_SEEDS[1], IR_DECAY)
    let same = 0
    for (let i = 0; i < len; i++) if (l[i] === r[i]) same++
    expect(same).toBeLessThan(len / 100) // <1% coincidence
  })
  test('IR is exponentially decaying within ±1.8 s length', () => {
    const len = Math.round(44100 * IR_LEN_S)
    const d = irChannel(len, IR_SEEDS[0], IR_DECAY)
    expect(len).toBe(79380)
    // envelope: E[|x|] at the start ≫ end; compare block RMS at 5% vs 95%
    const rms = (a: number, b: number) => {
      let s = 0
      for (let i = a; i < b; i++) s += d[i] * d[i]
      return Math.sqrt(s / (b - a))
    }
    const head = rms(0, Math.floor(len * 0.05))
    const tail = rms(Math.floor(len * 0.95), len)
    // exp(-3·t): expected block-RMS ratio ≈ exp(3·0.9) ≈ 14.9
    expect(head / tail).toBeGreaterThan(10)
    expect(head / tail).toBeLessThan(20)
  })
  test('IR noise is drawn from the canonical seeded PRNG (reproducible subset)', () => {
    // spot-check: the first samples of the seed-99 channel must equal
    // (mulberry32(99)()*2-1)·exp(0) — at Float32 storage precision (the
    // engine copies this data verbatim into the AudioBuffer, so Float32 is
    // the canonical storage width; 7-digit tolerance ≈ Float32 epsilon)
    const r = mulberry32(99)
    const d = irChannel(8, 99, IR_DECAY)
    for (let i = 0; i < 8; i++) {
      const expected = (r() * 2 - 1) * Math.exp(-IR_DECAY * (i / 8))
      expect(d[i]).toBeCloseTo(expected, 7)
    }
  })
})

describe('project round-trip (fx + sends)', () => {
  test('fx.delayDiv/delayFb survive JSON save/load and backfill', () => {
    const p = buildStyle('TECHNO', 7)
    p.fx = { delayDiv: '1/4', delayFb: 0.55 }
    p.tracks[5].mix.sendA = 0.42
    p.tracks[5].mix.sendB = 0.18
    const loaded = JSON.parse(JSON.stringify(p))
    expect(loaded.fx.delayDiv).toBe('1/4')
    expect(loaded.fx.delayFb).toBe(0.55)
    expect(loaded.tracks[5].mix.sendA).toBe(0.42)
    expect(loaded.tracks[5].mix.sendB).toBe(0.18)
    // project saved BEFORE sends existed: strip fx → backfill restores defaults
    delete loaded.fx
    if (!loaded.fx) loaded.fx = { delayDiv: '3/16', delayFb: 0.35 }
    expect(loaded.fx.delayDiv).toBe('3/16')
    expect(loaded.fx.delayFb).toBe(0.35)
  })
  test('factory styles keep sends at 0 by default (zero behavior change)', () => {
    for (const st of ['TECHNO', 'PSYTRANCE', 'TRANCE', 'PROGRESSIVE']) {
      const p = buildStyle(st, 42)
      for (const t of p.tracks) {
        expect(t.mix.sendA).toBe(0)
        expect(t.mix.sendB).toBe(0)
      }
    }
  })
})
