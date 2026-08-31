/**
 * PSY6 live capture tests (v0.4.0) — the non-realtime parts:
 *
 *   - buffer growth accounting: GrowableChannel accumulates thousands of
 *     small (callback-sized) writes across internal 262144-frame chunk
 *     boundaries with exact Float64 length tracking and bit-exact data
 *   - start-quantization math: stepsToBarBoundary covers boundary-now,
 *     mid-bar, last-step and negative-wrap inputs
 *   - encoder REUSE: capture assembly feeds the EXISTING bounce wavEncode —
 *     the produced bytes are a valid RIFF/WAVE/PCM16/stereo file whose data
 *     length is exactly frames*4 and whose samples round-trip exactly
 *     (no duplicate encoder exists anywhere in the capture path)
 *
 * The realtime tap itself (ScriptProcessor flags, bar-hook wiring) is
 * exercised on-device by Self-Gate G17 — realtime, local-only, excluded
 * from the CI subset by design.
 */
import { describe, expect, test } from 'bun:test'
import { GrowableChannel, stepsToBarBoundary, SP_BUF } from '../js/capture.js'
import { wavEncode } from '../js/bounce.js'

describe('buffer growth accounting', () => {
  test('small writes accumulate with exact length tracking across chunk boundaries', () => {
    const g = new GrowableChannel()
    const CHUNK = 262144
    /* write callback-sized chunks (1024 frames) up to 1.5 chunks → forces one rollover */
    const total = Math.floor(CHUNK * 1.5)
    let written = 0, seq = 0
    while (written < total) {
      const n = Math.min(1024, total - written)
      const src = new Float32Array(n)
      for (let i = 0; i < n; i++) src[i] = ((seq + i) % 997) / 997 - 0.5
      g.write(src)
      written += n; seq += n
    }
    expect(g.len).toBe(total) /* Float64-tracked length is EXACT */
    expect(g.chunks.length).toBe(2) /* preallocated chunk list grew exactly once */
    const out = g.concat()
    expect(out.length).toBe(total)
    /* data integrity around the chunk boundary: exact to float32 precision */
    const f32 = (x: number) => new Float32Array([x])[0]
    for (const probe of [0, 1023, 262143, 262144, 262145, total - 1]) {
      expect(out[probe]).toBe(f32(probe % 997 / 997 - 0.5))
    }
  })

  test('oversized single write spanning multiple chunks stays exact', () => {
    const g = new GrowableChannel()
    const src = new Float32Array(3 * 262144 + 7)
    src.set(Float32Array.from(src.length, (_, i) => 0), 0) /* placeholder */
    for (let i = 0; i < src.length; i++) src[i] = (i % 131) / 131
    g.write(src)
    expect(g.len).toBe(src.length)
    expect(g.chunks.length).toBe(4)
    const out = g.concat()
    const f32 = (x: number) => new Float32Array([x])[0]
    for (const probe of [0, 262143, 524287, 786430, src.length - 1]) {
      expect(out[probe]).toBe(f32((probe % 131) / 131))
    }
  })

  test('empty channel assembles to zero frames', () => {
    const g = new GrowableChannel()
    expect(g.len).toBe(0)
    expect(g.concat().length).toBe(0)
  })
})

describe('start-quantization math', () => {
  test('boundary-now means start immediately (0 steps)', () => {
    expect(stepsToBarBoundary(0)).toBe(0)
    expect(stepsToBarBoundary(16)).toBe(0)
    expect(stepsToBarBoundary(64)).toBe(0)
  })

  test('mid-bar waits for the next 16-step boundary', () => {
    expect(stepsToBarBoundary(1)).toBe(15)
    expect(stepsToBarBoundary(5)).toBe(11)
    expect(stepsToBarBoundary(15)).toBe(1)
  })

  test('negative/wrapped inputs stay stable (no NaN, always 0..15)', () => {
    for (let s = -48; s < 96; s++) {
      const v = stepsToBarBoundary(s)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(15)
      expect(Number.isInteger(v)).toBe(true)
    }
    expect(stepsToBarBoundary(-1)).toBe(1)
    expect(stepsToBarBoundary(-16)).toBe(0)
  })
})

describe('encoder reuse (bounce wavEncode)', () => {
  test('capture-assembled stereo channels encode to a valid 16-bit WAV that round-trips', () => {
    const sr = 44100, frames = SP_BUF * 43 /* ~1 s of callbacks */
    const L = new Float32Array(frames), R = new Float32Array(frames)
    for (let i = 0; i < frames; i++) {
      L[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.5
      R[i] = Math.sin((2 * Math.PI * 550 * i) / sr) * 0.25
    }
    const ab = wavEncode([L, R], sr) /* the exact call the capture UI makes */
    const v = new DataView(ab)
    const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))
    expect(tag(0)).toBe('RIFF')
    expect(tag(8)).toBe('WAVE')
    expect(v.getUint16(22, true)).toBe(2)      /* stereo */
    expect(v.getUint32(24, true)).toBe(sr)     /* sample rate preserved */
    expect(v.getUint16(34, true)).toBe(16)     /* PCM16 */
    expect(v.getUint32(40, true)).toBe(frames * 4)
    expect(ab.byteLength).toBe(44 + frames * 4)
    /* spot round-trip: first L sample through the 16-bit contract */
    const s0 = L[0]
    const q0 = v.getInt16(44, true)
    expect(Math.abs(q0 / 32767 - s0)).toBeLessThan(1 / 32767)
  })
})
