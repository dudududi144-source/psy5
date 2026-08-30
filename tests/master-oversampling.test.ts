/**
 * PSY6 master-chain oversampling benchmark.
 *
 * Drives a sawtooth sweep (12 kHz → 16 kHz, 1.5 s @ 44.1 kHz) through the
 * real worklet MasterChain (worklets/psy-engine.js, loaded in a stubbed
 * AudioWorklet environment) and quantifies aliasing energy in the
 * 16.5-22.05 kHz band before vs after enabling the 2x oversampled
 * saturation.
 *
 * Why that band is alias-only: the fundamental sweep lives in 12-16 kHz,
 * so every spectral component found above 16.5 kHz at the native rate is
 * foldback — harmonics of the sweep (2f = 24-32 kHz, 3f = 36-48 kHz, …)
 * that exceeded the 22.05 kHz Nyquist and mirrored back down. With 2x
 * oversampled saturation those harmonics are rendered at 88.2 kHz and
 * removed by the anti-alias halfband before decimation.
 *
 * Run: bun test tests/master-oversampling.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'

const SRC = readFileSync(new URL('../worklets/psy-engine.js', import.meta.url), 'utf8')

function loadClasses() {
  const fn = new Function(
    'sampleRate', 'currentFrame', 'performance', 'registerProcessor', 'AudioWorkletProcessor',
    SRC + '\nreturn { PsyEngineProcessor, MasterChain };'
  )
  const Base = class {
    port = { onmessage: null as null | ((m: unknown) => void), postMessage() {} }
  }
  return fn(44100, 0, { now: () => 0 }, () => {}, Base)
}

/** radix-2 in-place FFT (real input, magnitude output) */
function fftMagnitudes(re: Float64Array): Float64Array {
  const n = re.length
  const im = new Float64Array(n)
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr; im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr
      }
    }
  }
  const mag = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i])
  return mag
}

/** band energy (dB, relative to full scale) for fLow..fHigh */
function bandDb(out: Float32Array, sr: number, fLow: number, fHigh: number): number {
  const N = 1 << 15 // 32768
  const re = new Float64Array(N)
  const start = Math.floor(out.length / 4) // skip attack/limiter settle
  for (let i = 0; i < N; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N) // Hann
    re[i] = out[start + i] * w
  }
  const mag = fftMagnitudes(re)
  let e = 0
  const binHz = sr / N
  for (let b = Math.ceil(fLow / binHz); b < Math.floor(fHigh / binHz) && b < mag.length; b++) {
    e += mag[b] * mag[b]
  }
  return 10 * Math.log10(Math.max(e, 1e-20))
}

function renderSweep(os: boolean): Float32Array {
  const { MasterChain } = loadClasses()
  const mc = new MasterChain()
  mc.osEnabled = os
  mc.satDrive = 4.0   // cranked drive → strong saturation harmonics
  mc.satMix = 1.0     // full wet so the tanh path dominates the measurement

  const sr = 44100
  const T = 1.5
  const N = Math.floor(sr * T)
  const out = new Float32Array(N)
  let phase = 0
  const f0 = 12000, f1 = 16000
  for (let i = 0; i < N; i++) {
    const t = i / sr
    const f = f0 + (f1 - f0) * (t / T)
    phase += 2 * Math.PI * f / sr
    const saw = 2 * (phase / (2 * Math.PI) - Math.floor(phase / (2 * Math.PI))) - 1
    out[i] = mc.process(saw * 0.5, sr)
  }
  return out
}

describe('2x oversampled master saturation', () => {
  // allow the filter to be present and the A/B to be wired
  test('MasterChain exposes osEnabled and a 33-tap halfband', () => {
    const { MasterChain } = loadClasses()
    const mc = new MasterChain()
    expect(mc.osEnabled).toBe(true)
    expect(mc.osH.length).toBe(33)
    expect(mc.osH[16]).toBeCloseTo(0.5, 12)
    // halfband property: even taps except center are zero
    for (let n = 0; n < 33; n += 2) {
      if (n !== 16) expect(mc.osH[n]).toBeCloseTo(0, 12)
    }
    expect(mc.osHOdd.length).toBe(16)
  })

  test('aliasing energy above 16.5 kHz drops with 2x oversampling', () => {
    const before = renderSweep(false)
    const after = renderSweep(true)
    const sr = 44100
    const beforeDb = bandDb(before, sr, 16500, 22050)
    const afterDb = bandDb(after, sr, 16500, 22050)
    const reduction = beforeDb - afterDb
    console.log(`[benchmark] alias band 16.5-22.05 kHz energy: before (native sat) = ${beforeDb.toFixed(1)} dB, after (2x oversampled sat) = ${afterDb.toFixed(1)} dB, reduction = ${reduction.toFixed(1)} dB`)
    expect(Number.isFinite(beforeDb)).toBe(true)
    expect(Number.isFinite(afterDb)).toBe(true)
    expect(afterDb).toBeLessThan(beforeDb)          // strictly better
    expect(reduction).toBeGreaterThan(10)           // meaningful, not noise
  })

  test('config message toggles masterOversample on the processor', () => {
    const fn = new Function(
      'sampleRate', 'currentFrame', 'performance', 'registerProcessor', 'AudioWorkletProcessor',
      SRC + '\nreturn PsyEngineProcessor;'
    )
    const Base = class { port = { onmessage: null as any, postMessage() {} } }
    const Cls = fn(44100, 0, { now: () => 0 }, () => {}, Base)
    const eng = new Cls({})
    eng.handleMessage({ type: 'config', masterOversample: false })
    expect(eng.masterL.osEnabled).toBe(false)
    expect(eng.masterR.osEnabled).toBe(false)
    eng.handleMessage({ type: 'config', masterOversample: true })
    expect(eng.masterL.osEnabled).toBe(true)
    const eng2 = new Cls({ processorOptions: { masterOversample: false } })
    expect(eng2.masterL.osEnabled).toBe(false)
  })
})
