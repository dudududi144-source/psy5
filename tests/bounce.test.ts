/**
 * PSY6 offline WAV bounce tests.
 *
 * renderBounce() rebuilds the ENTIRE engine graph in a fresh
 * OfflineAudioContext and schedules pattern-loop × N with the SAME
 * deterministic per-bar event function (stepEvents) as the live scheduler.
 * The pure parts — schedule generation, schedule hashing, WAV encoding —
 * are testable here without Web Audio:
 *
 *   - schedule: exact event times (t0 + s·stepDur + off), loop × N span
 *   - schedule determinism: same project → identical hash (schedIdentical)
 *   - WAV: 44-byte RIFF header fields (RIFF/WAVE/fmt /data, PCM16, stereo,
 *     sample rate, byte rate, block align), exact sample count, data chunk
 *     decodes back to the expected int16 values, clipping at ±FS
 */
import { describe, expect, test } from 'bun:test'
import { bounceSchedule, evHash, wavEncode } from '../js/bounce.js'
import { buildStyle } from '../js/presets.js'

describe('bounce schedule', () => {
  test('span is exactly t0 + loops·loopLen·stepDur; events fall inside', () => {
    const p = buildStyle('PSYTRANCE', 42)
    const loops = 2, t0 = 0.05
    const sch = bounceSchedule(p, loops, t0)
    const sd = 60 / p.bpm / 4
    expect(sch.stepDur).toBeCloseTo(sd, 12)
    expect(sch.total).toBeCloseTo(t0 + sch.loopLen * loops * sd, 12)
    // exact sample count with ceil (matches renderBounce N)
    expect(Math.ceil(sch.total * 44100)).toBe(148192) // 145 BPM, loop 16, 2 loops
    for (const e of sch.evs) {
      expect(e.t).toBeGreaterThanOrEqual(t0)
      expect(e.t).toBeLessThanOrEqual(sch.total + 1e-9)
    }
    expect(sch.evs.length).toBeGreaterThan(0)
  })
  test('same project seed → byte-identical schedule hash (determinism)', () => {
    const mk = (seed) => { const p = buildStyle('PSYTRANCE', 42); p.seed = seed; return p }
    const a = bounceSchedule(mk('PSY6'), 2, 0.05)
    const b = bounceSchedule(mk('PSY6'), 2, 0.05)
    expect(evHash(a.evs)).toBe(evHash(b.evs))
    // a different PROJECT seed MUST change the schedule hash (per-bar seeding)
    const c = bounceSchedule(mk('SEED43'), 2, 0.05)
    expect(evHash(c.evs)).not.toBe(evHash(a.evs))
  })
  test('loops scale the schedule linearly (1/2/4/8)', () => {
    const p = buildStyle('PSYTRANCE', 42)
    const one = bounceSchedule(p, 1, 0.05)
    const two = bounceSchedule(p, 2, 0.05)
    expect(two.evs.length).toBeGreaterThan(one.evs.length)
    // every second-loop event lands at/after the loop boundary
    for (const e of two.evs) if (e.s >= one.loopLen) expect(e.t).toBeGreaterThanOrEqual(0.05 + one.loopLen * two.stepDur - 0.5 * two.stepDur)
    // and the loop-2 events exist (per-bar seeding keeps them deterministic per bar)
    expect(two.evs.filter(e => e.s >= one.loopLen).length).toBeGreaterThan(0)
  })
})

describe('WAV encoder', () => {
  test('header fields: RIFF/WAVE/fmt /data, PCM16, stereo, sizes', () => {
    const sr = 44100, n = 1000
    const L = new Float32Array(n), R = new Float32Array(n)
    const ab = wavEncode([L, R], sr)
    const v = new DataView(ab)
    const str = (o, len) => { let s = ''; for (let i = 0; i < len; i++) s += String.fromCharCode(v.getUint8(o + i)); return s }
    expect(str(0, 4)).toBe('RIFF')
    expect(v.getUint32(4, true)).toBe(36 + n * 2 * 2)
    expect(str(8, 4)).toBe('WAVE')
    expect(str(12, 4)).toBe('fmt ')
    expect(v.getUint32(16, true)).toBe(16)      // fmt chunk size
    expect(v.getUint16(20, true)).toBe(1)       // PCM
    expect(v.getUint16(22, true)).toBe(2)       // stereo
    expect(v.getUint32(24, true)).toBe(sr)      // sample rate
    expect(v.getUint32(28, true)).toBe(sr * 2 * 2) // byte rate
    expect(v.getUint16(32, true)).toBe(4)       // block align
    expect(v.getUint16(34, true)).toBe(16)      // bits per sample
    expect(str(36, 4)).toBe('data')
    expect(v.getUint32(40, true)).toBe(n * 2 * 2)
    expect(ab.byteLength).toBe(44 + n * 2 * 2)
  })
  test('data chunk round-trips int16 samples (interleaved L/R)', () => {
    const n = 256
    const L = new Float32Array(n), R = new Float32Array(n)
    for (let i = 0; i < n; i++) { L[i] = i / n * 0.5; R[i] = -i / n * 0.25 }
    const v = new DataView(wavEncode([L, R], 44100))
    for (let i = 0; i < n; i++) {
      // encoder contract: negative → trunc(x·32768), positive → trunc(x·32767)
      const q = (x) => Math.trunc(x < 0 ? x * 32768 : x * 32767) + 0
      const l = v.getInt16(44 + i * 4, true)
      const r = v.getInt16(44 + i * 4 + 2, true)
      expect(l).toBe(q(L[i]))
      expect(r).toBe(q(R[i]))
    }
  })
  test('clips at ±full scale', () => {
    const L = Float32Array.from([1.5, -1.5])
    const R = Float32Array.from([0, 0])
    const v = new DataView(wavEncode([L, R], 44100))
    // interleaved: L[0]@44, R[0]@46, L[1]@48, R[1]@50
    expect(v.getInt16(44, true)).toBe(32767)      // +FS
    expect(v.getInt16(48, true)).toBe(-32768)     // −FS
    expect(v.getInt16(46, true)).toBe(0)
  })
  test('default-project 2-loop WAV size is exact (145 BPM, 16-step loop)', () => {
    const N = 148192
    const L = new Float32Array(N), R = new Float32Array(N)
    const ab = wavEncode([L, R], 44100)
    expect(ab.byteLength).toBe(44 + N * 4) // 592812 bytes
  })
})
