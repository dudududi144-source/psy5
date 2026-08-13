import { describe, expect, test } from 'bun:test'
import {
  Adsr,
  BiquadFilter,
  DcBlocker,
  Delay,
  FmOscillator,
  LufsMeter,
  MoogLadder,
  OnePoleLP,
  PeakMeter,
  PitchEnvelope,
  PolyBlepOsc,
  RmsMeter,
  SchroederReverb,
  VoicePool,
  WavetableOsc,
  applyWidth,
  buildWavetable,
  hardClip,
  softClip,
  tanhSaturation,
  wavetables,
} from '../src/index.ts'
import type { Voice } from '../src/index.ts'

const SR = 44100
const N = SR // 1 second

function fillBuffer(gen: () => number): Float32Array {
  const buf = new Float32Array(N)
  for (let i = 0; i < N; i++) buf[i] = gen()
  return buf
}

describe('PolyBlepOsc', () => {
  test('sine produces values in [-1, 1]', () => {
    const osc = new PolyBlepOsc({ waveform: 'sine', sampleRate: SR, frequency: 440 })
    const buf = fillBuffer(() => osc.process())
    for (const v of buf) {
      expect(v).toBeGreaterThanOrEqual(-1.001)
      expect(v).toBeLessThanOrEqual(1.001)
    }
  })

  test('saw produces values in [-1, 1]', () => {
    const osc = new PolyBlepOsc({ waveform: 'saw', sampleRate: SR, frequency: 220 })
    const buf = fillBuffer(() => osc.process())
    for (const v of buf) {
      expect(v).toBeGreaterThanOrEqual(-1.1)
      expect(v).toBeLessThanOrEqual(1.1)
    }
  })

  test('square produces values near ±1', () => {
    const osc = new PolyBlepOsc({ waveform: 'square', sampleRate: SR, frequency: 100 })
    const buf = fillBuffer(() => osc.process())
    const max = Math.max(...buf)
    const min = Math.min(...buf)
    expect(max).toBeGreaterThan(0.9)
    expect(min).toBeLessThan(-0.9)
  })

  test('triangle produces values in [-1, 1]', () => {
    const osc = new PolyBlepOsc({ waveform: 'triangle', sampleRate: SR, frequency: 110 })
    const buf = fillBuffer(() => osc.process())
    for (const v of buf) {
      expect(v).toBeGreaterThanOrEqual(-1.1)
      expect(v).toBeLessThanOrEqual(1.1)
    }
  })

  test('frequency change affects pitch (zero-crossing count)', () => {
    const low = new PolyBlepOsc({ waveform: 'sine', sampleRate: SR, frequency: 100 })
    const high = new PolyBlepOsc({ waveform: 'sine', sampleRate: SR, frequency: 200 })
    const lowBuf = fillBuffer(() => low.process())
    const highBuf = fillBuffer(() => high.process())
    const lowZc = zeroCrossings(lowBuf)
    const highZc = zeroCrossings(highBuf)
    expect(highZc).toBeGreaterThan(lowZc * 1.5)
  })
})

describe('FmOscillator', () => {
  test('produces values in range with no modulation', () => {
    const fm = new FmOscillator({ sampleRate: SR, carrierFreq: 440, modIndex: 0 })
    const buf = fillBuffer(() => fm.process())
    for (const v of buf) {
      expect(v).toBeGreaterThanOrEqual(-1.01)
      expect(v).toBeLessThanOrEqual(1.01)
    }
  })

  test('modulation produces a different waveform than no modulation', () => {
    const noMod = new FmOscillator({ sampleRate: SR, carrierFreq: 440, modIndex: 0 })
    const withMod = new FmOscillator({
      sampleRate: SR,
      carrierFreq: 440,
      modFreq: 110,
      modIndex: 5,
    })
    const bufNo = fillBuffer(() => noMod.process())
    const bufMod = fillBuffer(() => withMod.process())
    // The modulated signal should differ from the pure sine (FM adds sidebands).
    let maxDiff = 0
    for (let i = 100; i < N; i++) {
      const diff = Math.abs(bufMod[i] - bufNo[i])
      if (diff > maxDiff) maxDiff = diff
    }
    expect(maxDiff).toBeGreaterThan(0.01)
  })
})

describe('WavetableOsc', () => {
  test('wavetable sine matches pure sine', () => {
    const table = wavetables.sine(2048)
    const wt = new WavetableOsc({ sampleRate: SR, frequency: 440, table })
    const pure = new PolyBlepOsc({ waveform: 'sine', sampleRate: SR, frequency: 440 })
    const wtBuf = fillBuffer(() => wt.process())
    const pureBuf = fillBuffer(() => pure.process())
    // Should be very close (wavetable interpolation vs direct sine).
    let maxDiff = 0
    for (let i = 100; i < N; i++) {
      const diff = Math.abs(wtBuf[i] - pureBuf[i])
      if (diff > maxDiff) maxDiff = diff
    }
    expect(maxDiff).toBeLessThan(0.01)
  })

  test('buildWavetable creates correct length', () => {
    const t = buildWavetable(1024, (p) => Math.sin(2 * Math.PI * p))
    expect(t.length).toBe(1024)
  })
})

describe('OnePoleLP', () => {
  test('attenuates high frequencies', () => {
    const lp = new OnePoleLP(SR, 200)
    const osc = new PolyBlepOsc({ waveform: 'sine', sampleRate: SR, frequency: 5000 })
    const buf = fillBuffer(() => lp.process(osc.process()))
    const peak = Math.max(...buf.slice(SR / 10)) // skip startup
    expect(peak).toBeLessThan(0.5)
  })

  test('passes low frequencies', () => {
    const lp = new OnePoleLP(SR, 2000)
    const osc = new PolyBlepOsc({ waveform: 'sine', sampleRate: SR, frequency: 100 })
    const buf = fillBuffer(() => lp.process(osc.process()))
    const peak = Math.max(...buf.slice(SR / 10))
    expect(peak).toBeGreaterThan(0.7)
  })
})

describe('BiquadFilter', () => {
  test('lowpass attenuates highs', () => {
    const bq = new BiquadFilter(SR, 'lowpass', 500, Math.SQRT1_2)
    const osc = new PolyBlepOsc({ waveform: 'sine', sampleRate: SR, frequency: 5000 })
    const buf = fillBuffer(() => bq.process(osc.process()))
    const peak = Math.max(...buf.slice(SR / 10))
    expect(peak).toBeLessThan(0.3)
  })

  test('highpass attenuates lows', () => {
    const bq = new BiquadFilter(SR, 'highpass', 2000, Math.SQRT1_2)
    const osc = new PolyBlepOsc({ waveform: 'sine', sampleRate: SR, frequency: 100 })
    const buf = fillBuffer(() => bq.process(osc.process()))
    const peak = Math.max(...buf.slice(SR / 10))
    expect(peak).toBeLessThan(0.2)
  })
})

describe('MoogLadder', () => {
  test('produces output with resonance', () => {
    const moog = new MoogLadder(SR, 800, 0.7)
    const osc = new PolyBlepOsc({ waveform: 'saw', sampleRate: SR, frequency: 220 })
    const buf = fillBuffer(() => moog.process(osc.process()))
    const peak = Math.max(...buf.map(Math.abs))
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThan(5) // not blowing up
  })

  test('does not blow up at high resonance', () => {
    const moog = new MoogLadder(SR, 1000, 0.99)
    const osc = new PolyBlepOsc({ waveform: 'saw', sampleRate: SR, frequency: 220 })
    const buf = fillBuffer(() => moog.process(osc.process()))
    const peak = Math.max(...buf.map(Math.abs))
    expect(peak).toBeLessThan(20)
  })
})

describe('Adsr', () => {
  test('idle produces 0', () => {
    const env = new Adsr({ sampleRate: SR })
    expect(env.process()).toBe(0)
  })

  test('attack rises to 1', () => {
    const env = new Adsr({ sampleRate: SR, attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.1 })
    env.gateOn()
    const attackSamples = Math.floor(0.01 * SR)
    let last = 0
    for (let i = 0; i < attackSamples * 2; i++) last = env.process()
    expect(last).toBeGreaterThan(0.9)
  })

  test('release falls to 0', () => {
    const env = new Adsr({
      sampleRate: SR,
      attack: 0.001,
      decay: 0.001,
      sustain: 0.7,
      release: 0.01,
    })
    env.gateOn()
    for (let i = 0; i < SR * 0.1; i++) env.process()
    env.gateOff()
    const releaseSamples = Math.floor(0.01 * SR)
    let last = 0
    for (let i = 0; i < releaseSamples * 2; i++) last = env.process()
    expect(last).toBeLessThan(0.1)
  })
})

describe('PitchEnvelope', () => {
  test('glides from start to end', () => {
    const env = new PitchEnvelope({ sampleRate: SR, from: 100, to: 400, duration: 0.1 })
    env.trigger()
    const dur = Math.floor(0.1 * SR)
    let startVal = 0
    let endVal = 0
    for (let i = 0; i < dur * 2; i++) {
      const v = env.process()
      if (i === 0) startVal = v
      if (i === dur * 2 - 1) endVal = v
    }
    expect(startVal).toBeCloseTo(100, 0)
    expect(endVal).toBeCloseTo(400, 0)
  })
})

describe('DcBlocker', () => {
  test('removes DC offset', () => {
    const dc = new DcBlocker(SR)
    const buf = fillBuffer(() => dc.process(0.5)) // constant DC
    const end = buf[buf.length - 1] ?? 0
    expect(Math.abs(end)).toBeLessThan(0.1)
  })
})

describe('saturation', () => {
  test('tanhSaturation limits to [-1, 1]', () => {
    for (const x of [-10, -1, 0, 1, 10]) {
      const v = tanhSaturation(x, 1)
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  test('softClip limits output', () => {
    const v = softClip(100, 1)
    expect(Math.abs(v)).toBeLessThan(2)
  })

  test('hardClip clamps to threshold', () => {
    expect(hardClip(5, 1)).toBe(1)
    expect(hardClip(-5, 1)).toBe(-1)
    expect(hardClip(0.5, 1)).toBe(0.5)
  })
})

describe('applyWidth', () => {
  test('width=1 is identity', () => {
    const left = new Float32Array([1, 0.5, -0.3])
    const right = new Float32Array([0.8, -0.2, 0.1])
    const origL = [...left]
    const origR = [...right]
    applyWidth(left, right, 1)
    for (let i = 0; i < left.length; i++) {
      expect(left[i]).toBeCloseTo(origL[i], 5)
      expect(right[i]).toBeCloseTo(origR[i], 5)
    }
  })

  test('width=0 collapses to mono', () => {
    const left = new Float32Array([1, 0.5])
    const right = new Float32Array([0.3, -0.1])
    applyWidth(left, right, 0)
    expect(left[0]).toBeCloseTo(right[0], 5)
    expect(left[1]).toBeCloseTo(right[1], 5)
  })
})

describe('Delay', () => {
  test('delays the signal', () => {
    const delay = new Delay({
      sampleRate: SR,
      maxDelaySec: 0.5,
      delaySec: 0.01,
      feedback: 0,
      wet: 1,
    })
    const impulse = new Float32Array(SR)
    impulse[0] = 1
    const out = new Float32Array(SR)
    for (let i = 0; i < SR; i++) out[i] = delay.process(impulse[i] ?? 0)
    // The impulse should appear at ~0.01s = 441 samples.
    const delayedPeak = out.indexOf(1)
    expect(delayedPeak).toBeGreaterThan(400)
    expect(delayedPeak).toBeLessThan(480)
  })

  test('feedback creates repeats', () => {
    const delay = new Delay({
      sampleRate: SR,
      maxDelaySec: 0.5,
      delaySec: 0.01,
      feedback: 0.7,
      wet: 0.5,
    })
    const impulse = new Float32Array(SR)
    impulse[0] = 1
    let sumAbs = 0
    for (let i = 0; i < SR; i++) sumAbs += Math.abs(delay.process(impulse[i] ?? 0))
    // With feedback, total energy > a single impulse.
    expect(sumAbs).toBeGreaterThan(1)
  })
})

describe('SchroederReverb', () => {
  test('produces output after an impulse', () => {
    const reverb = new SchroederReverb({ sampleRate: SR, wet: 0.5 })
    reverb.process(1) // impulse
    let sumAbs = 0
    for (let i = 0; i < SR; i++) sumAbs += Math.abs(reverb.process(0))
    expect(sumAbs).toBeGreaterThan(0)
  })

  test('does not blow up', () => {
    const reverb = new SchroederReverb({ sampleRate: SR, wet: 1 })
    const osc = new PolyBlepOsc({ waveform: 'saw', sampleRate: SR, frequency: 220 })
    let maxVal = 0
    for (let i = 0; i < SR; i++) {
      const v = Math.abs(reverb.process(osc.process()))
      if (v > maxVal) maxVal = v
    }
    expect(maxVal).toBeLessThan(10)
  })
})

describe('Metering', () => {
  test('RmsMeter measures RMS of silence as ~0', () => {
    const meter = new RmsMeter(256)
    for (let i = 0; i < 256; i++) meter.process(0)
    expect(meter.process(0)).toBeLessThan(0.001)
  })

  test('RmsMeter measures RMS of full-scale sine as ~0.707', () => {
    const meter = new RmsMeter(SR)
    const osc = new PolyBlepOsc({ waveform: 'sine', sampleRate: SR, frequency: 440 })
    for (let i = 0; i < SR; i++) meter.process(osc.process())
    const rms = meter.process(osc.process())
    expect(rms).toBeGreaterThan(0.6)
    expect(rms).toBeLessThan(0.8)
  })

  test('PeakMeter tracks the maximum', () => {
    const meter = new PeakMeter({ sampleRate: SR })
    meter.process(0.5)
    meter.process(0.9)
    meter.process(0.3)
    expect(meter.current).toBeCloseTo(0.9, 1)
  })

  test('LufsMeter measures silence as very quiet', () => {
    const meter = new LufsMeter(SR)
    for (let i = 0; i < SR; i++) meter.process(0)
    expect(meter.process(0)).toBeLessThan(-60)
  })
})

describe('VoicePool', () => {
  class TestVoice implements Voice {
    active = false
    note = 0
    vel = 0
    noteOn(note: number, velocity: number): void {
      this.active = true
      this.note = note
      this.vel = velocity
    }
    noteOff(): void {
      this.active = false
    }
    panic(): void {
      this.active = false
      this.vel = 0
    }
  }

  test('allocates voices round-robin', () => {
    const pool = new VoicePool(() => new TestVoice(), 4)
    const v1 = pool.allocate()
    const v2 = pool.allocate()
    expect(v1).not.toBe(v2)
  })

  test('reuses inactive voices when all have been used', () => {
    const pool = new VoicePool(() => new TestVoice(), 2)
    // Fill all voices so none are "never used".
    const v0 = pool.noteOn(60, 0.9)
    const _v1 = pool.noteOn(62, 0.9)
    // Release v0; next allocation should reuse it (it's the only inactive one).
    v0.noteOff()
    const v2 = pool.noteOn(64, 0.8)
    expect(v2).toBe(v0) // reused the released voice
  })

  test('steals when all active', () => {
    const pool = new VoicePool(() => new TestVoice(), 2)
    pool.noteOn(60, 0.9)
    pool.noteOn(62, 0.9)
    const v3 = pool.noteOn(64, 0.9) // steal
    expect(v3.active).toBe(true)
  })

  test('allOff releases all', () => {
    const pool = new VoicePool(() => new TestVoice(), 4)
    pool.noteOn(60, 0.9)
    pool.noteOn(62, 0.9)
    pool.allOff()
    expect(pool.activeCount).toBe(0)
  })

  test('panic force-stops all', () => {
    const pool = new VoicePool(() => new TestVoice(), 4)
    pool.noteOn(60, 0.9)
    pool.panic()
    expect(pool.activeCount).toBe(0)
  })

  test('activeCount reports correctly', () => {
    const pool = new VoicePool(() => new TestVoice(), 4)
    pool.noteOn(60, 0.9)
    expect(pool.activeCount).toBe(1)
    pool.noteOn(62, 0.9)
    expect(pool.activeCount).toBe(2)
  })
})

// Helpers
function zeroCrossings(buf: Float32Array): number {
  let count = 0
  for (let i = 1; i < buf.length; i++) {
    if (buf[i - 1] < 0 !== buf[i] < 0) count += 1
  }
  return count
}
