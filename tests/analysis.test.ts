import { describe, expect, test } from 'bun:test'
import { corpus, getFixture } from '@psy-foundation/fixtures'
import {
  Analyzer,
  type TempoHypothesis,
  bandEnergy,
  binToFreq,
  chroma,
  detectOnsets,
  detectPitch,
  estimateTempo,
  fft,
  inferMusical,
  midiToName,
  pickMusicalWinner,
  refineTempoWithContext,
  rmsEnergy,
  spectralFlatness,
  spectralFlux,
  spectrum,
  transientDensity,
  zeroCrossingRate,
} from '../src/index.ts'

const SAMPLE_RATE = 44100

/** Generate `n` samples of a sine wave at `freq` Hz, amplitude 1. */
function sine(freq: number, n: number, sampleRate = SAMPLE_RATE): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate)
  }
  return out
}

/** Index of the maximum value in `arr` (restricted to [lo, hi)). */
function argmax(arr: ArrayLike<number>, lo = 0, hi = arr.length): number {
  let best = lo
  let bestV = arr[lo] as number
  for (let i = lo + 1; i < hi; i++) {
    const v = arr[i] as number
    if (v > bestV) {
      bestV = v
      best = i
    }
  }
  return best
}

describe('fft and spectrum', () => {
  test('pure 440Hz tone peaks at the bin closest to 440Hz', () => {
    const N = 1024
    const frame = sine(440, N)
    const real = Float32Array.from(frame)
    const imag = new Float32Array(N)
    fft(real, imag)
    const mag = new Float32Array(N)
    for (let i = 0; i < N; i++) mag[i] = Math.hypot(real[i] as number, imag[i] as number)
    // Peak should be in the first half (exclude DC + mirror).
    const peakBin = argmax(mag, 1, N / 2)
    const peakFreq = binToFreq(peakBin, SAMPLE_RATE, N)
    expect(peakFreq).toBeGreaterThan(400)
    expect(peakFreq).toBeLessThan(480)
  })

  test('fft rejects non-power-of-2 lengths', () => {
    const real = new Float32Array(3)
    const imag = new Float32Array(3)
    expect(() => fft(real, imag)).toThrow(RangeError)
  })

  test('spectrum returns a one-sided magnitude spectrum of length N/2+1', () => {
    const N = 1024
    const frame = sine(220, N)
    const mag = spectrum(frame)
    expect(mag.length).toBe(N / 2 + 1)
  })
})

describe('features', () => {
  test('rmsEnergy of silence is 0', () => {
    expect(rmsEnergy(new Float32Array(1024))).toBe(0)
  })

  test('rmsEnergy of a full-scale sine is ~1/sqrt(2)', () => {
    const frame = sine(220, 4096)
    const r = rmsEnergy(frame)
    expect(r).toBeGreaterThan(0.69)
    expect(r).toBeLessThan(0.72)
  })

  test('spectralFlatness of a pure tone is < 0.1', () => {
    const mag = spectrum(sine(440, 1024))
    const f = spectralFlatness(mag)
    expect(f).toBeLessThan(0.1)
  })

  test('zeroCrossingRate of silence is 0', () => {
    expect(zeroCrossingRate(new Float32Array(1024))).toBe(0)
  })

  test('spectralFlux of identical spectra is 0', () => {
    const mag = spectrum(sine(440, 1024))
    expect(spectralFlux(mag, mag)).toBe(0)
  })

  test('bandEnergy sums the bins inside the requested band', () => {
    // Construct a fake magnitude spectrum where bins 5..9 each carry value 2
    // and all others are 0. fftSize is implicitly 2*(N-1) = 18 here.
    const N = 10
    const mag = new Float32Array(N)
    for (let i = 5; i <= 9; i++) mag[i] = 2
    const fftSize = (N - 1) * 2
    // bin 5 -> 5 * 44100 / 18 = 12250 Hz ; bin 9 -> 22050 Hz.
    const loHz = binToFreq(5, SAMPLE_RATE, fftSize)
    const hiHz = binToFreq(9, SAMPLE_RATE, fftSize)
    expect(bandEnergy(mag, SAMPLE_RATE, loHz, hiHz)).toBe(10) // 5 bins * 2
  })

  test('transientDensity of an empty history is 0', () => {
    expect(transientDensity([], 1)).toBe(0)
  })
})

describe('onset detection', () => {
  test('detectOnsets finds many onsets in perfect-150, monotonically increasing', () => {
    const fx = getFixture('perfect-150')
    const onsets = detectOnsets(fx.signal, {
      sampleRate: fx.sampleRate,
      frameSize: 1024,
      hopSize: 512,
    })
    expect(onsets.length).toBeGreaterThan(40)
    for (let i = 1; i < onsets.length; i++) {
      expect(onsets[i].at).toBeGreaterThanOrEqual(onsets[i - 1].at)
    }
  })

  test('first onset is near the first beat and strengths are normalised to [0,1]', () => {
    const fx = getFixture('perfect-150')
    const onsets = detectOnsets(fx.signal, {
      sampleRate: fx.sampleRate,
      frameSize: 1024,
      hopSize: 512,
    })
    expect(onsets.length).toBeGreaterThan(0)
    // First beat is at t=0; first detected onset should be within ~50ms.
    expect(onsets[0].at).toBeLessThan(0.05)
    let maxStrength = 0
    for (const o of onsets) {
      expect(o.strength).toBeGreaterThanOrEqual(0)
      expect(o.strength).toBeLessThanOrEqual(1)
      if (o.strength > maxStrength) maxStrength = o.strength
    }
    // The strongest onset should reach ~1 after normalisation.
    expect(maxStrength).toBeGreaterThan(0.99)
  })
})

describe('tempo estimation', () => {
  test('estimateTempo on perfect-150 onsets lands in 140-160 BPM', () => {
    const fx = getFixture('perfect-150')
    const onsets = detectOnsets(fx.signal, {
      sampleRate: fx.sampleRate,
      frameSize: 1024,
      hopSize: 512,
    })
    const { best } = estimateTempo(onsets)
    expect(best).not.toBeNull()
    if (best) {
      expect(best.bpm).toBeGreaterThanOrEqual(140)
      expect(best.bpm).toBeLessThanOrEqual(160)
    }
  })

  test('THE SPARSE FIX: pickMusicalWinner on sparse onsets yields 130-170 BPM, not 75', () => {
    const fx = getFixture('sparse')
    const onsets = detectOnsets(fx.signal, {
      sampleRate: fx.sampleRate,
      frameSize: 1024,
      hopSize: 512,
    })
    const { top } = estimateTempo(onsets)
    const winner = pickMusicalWinner(top)
    expect(winner).not.toBeNull()
    if (winner) {
      expect(winner.bpm).toBeGreaterThanOrEqual(130)
      expect(winner.bpm).toBeLessThanOrEqual(170)
      expect(winner.bpm).not.toBe(75)
    }
  })

  test('refineTempoWithContext doubles a 75 BPM hypothesis into 150', () => {
    const hyp: TempoHypothesis = { bpm: 75, score: 0.5, octave: 1, phase: 0 }
    const refined = refineTempoWithContext(hyp)
    expect(refined.bpm).toBe(150)
  })

  test('estimateTempo on breakdown recovers ~140 BPM', () => {
    const fx = getFixture('breakdown')
    const onsets = detectOnsets(fx.signal, {
      sampleRate: fx.sampleRate,
      frameSize: 1024,
      hopSize: 512,
    })
    const { best } = estimateTempo(onsets)
    expect(best).not.toBeNull()
    if (best) {
      expect(best.bpm).toBeGreaterThanOrEqual(130)
      expect(best.bpm).toBeLessThanOrEqual(150)
    }
  })
})

describe('pitch', () => {
  test('detectPitch finds ~440Hz from a 440Hz sine', () => {
    const frame = sine(440, 2048)
    const { freq } = detectPitch(frame, SAMPLE_RATE)
    expect(freq).not.toBeNull()
    if (freq !== null) {
      expect(freq).toBeGreaterThanOrEqual(430)
      expect(freq).toBeLessThanOrEqual(450)
    }
  })

  test('midiToName(69) === "A4"', () => {
    expect(midiToName(69)).toBe('A4')
  })

  test('chroma of a 440Hz pure tone peaks at pitch class 9 (A)', () => {
    const mag = spectrum(sine(440, 4096))
    const vec = chroma(mag, SAMPLE_RATE)
    expect(vec.length).toBe(12)
    const pc = argmax(vec)
    expect(pc).toBe(9)
  })

  test('detectPitch returns null for silence', () => {
    const { freq } = detectPitch(new Float32Array(2048), SAMPLE_RATE)
    expect(freq).toBeNull()
  })
})

describe('musical inference', () => {
  test('inferMusical classifies a bass-heavy frame with bassRatio > 0.3', () => {
    // 55Hz sustained bass plus a 50Hz kick — both fall in the bass band.
    const N = 2048
    const frame = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      const t = i / SAMPLE_RATE
      frame[i] = 0.6 * Math.sin(2 * Math.PI * 55 * t) + 0.6 * Math.sin(2 * Math.PI * 50 * t)
    }
    const mag = spectrum(frame)
    const inf = inferMusical(mag, SAMPLE_RATE)
    expect(inf.bassRatio).toBeGreaterThan(0.3)
  })

  test('inferMusical classifies a silent frame as silent', () => {
    const mag = spectrum(new Float32Array(1024))
    const inf = inferMusical(mag, SAMPLE_RATE)
    expect(inf.energy).toBe('silent')
  })
})

describe('Analyzer', () => {
  test('ingest accumulates frames and exposes the latest frame', () => {
    const a = new Analyzer({ sampleRate: SAMPLE_RATE })
    const frame = sine(440, 1024)
    a.ingest(frame)
    expect(a.frameCount).toBe(1)
    expect(a.latestFrame).not.toBeNull()
    a.ingest(frame)
    expect(a.frameCount).toBe(2)
    expect(a.fluxHistory.length).toBe(2)
  })

  test('detectOnsetsIn + musicalTempo on perfect-150 yields 140-160 BPM', () => {
    const fx = getFixture('perfect-150')
    const a = new Analyzer({
      sampleRate: fx.sampleRate,
      frameSize: 1024,
      hopSize: 512,
      onsetHistorySize: 256,
    })
    a.detectOnsetsIn(fx.signal)
    const tempo = a.musicalTempo()
    expect(tempo).not.toBeNull()
    if (tempo) {
      expect(tempo.bpm).toBeGreaterThanOrEqual(140)
      expect(tempo.bpm).toBeLessThanOrEqual(160)
    }
  })

  test('reset clears all rolling state', () => {
    const a = new Analyzer({ sampleRate: SAMPLE_RATE })
    a.ingest(sine(440, 1024))
    a.pushOnset({ at: 0.1, strength: 0.5 })
    expect(a.frameCount).toBe(1)
    expect(a.onsets.length).toBe(1)
    a.reset()
    expect(a.frameCount).toBe(0)
    expect(a.onsets.length).toBe(0)
    expect(a.sections.length).toBe(0)
    expect(a.fluxHistory.length).toBe(0)
    expect(a.latestFrame).toBeNull()
  })

  test('corpus import works (fixtures workspace dependency resolves)', () => {
    expect(corpus.length).toBe(14)
    const fx = getFixture('perfect-150')
    expect(fx.id).toBe('perfect-150')
    expect(fx.sampleRate).toBe(SAMPLE_RATE)
  })
})
