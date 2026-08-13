/**
 * Spectral and time-domain features derived from magnitude spectra / frames.
 *
 * All functions are pure: they never mutate their inputs and have no side effects.
 */

/** Convert a frequency bin index to its centre frequency in Hz. */
export function binToFreq(bin: number, sampleRate: number, fftSize: number): number {
  return (bin * sampleRate) / fftSize
}

/** Convert a frequency in Hz to its nearest bin index. */
export function freqToBin(freq: number, sampleRate: number, fftSize: number): number {
  return Math.round((freq * fftSize) / sampleRate)
}

/**
 * Spectral centroid — the magnitude-weighted average bin frequency, in Hz.
 * Higher means brighter. Returns 0 for silent input.
 */
export function spectralCentroid(mag: ArrayLike<number>, sampleRate: number): number {
  const n = mag.length
  if (n === 0) return 0
  const fftSize = (n - 1) * 2 // assuming real-signal half-spectrum of length N/2+1
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    const m = mag[i] as number
    const f = binToFreq(i, sampleRate, fftSize)
    num += f * m
    den += m
  }
  if (den <= 0) return 0
  return num / den
}

/**
 * Spectral flatness — geometric mean / arithmetic mean, in [0,1].
 * 1 = white noise (flat spectrum), ~0 = pure tone (concentrated energy).
 * Returns 0 for silent input.
 */
export function spectralFlatness(mag: ArrayLike<number>): number {
  const n = mag.length
  if (n === 0) return 0
  let sum = 0
  let logSum = 0
  let active = 0
  for (let i = 0; i < n; i++) {
    const m = mag[i] as number
    if (m <= 0) continue
    sum += m
    logSum += Math.log(m)
    active++
  }
  if (active === 0 || sum <= 0) return 0
  const geo = Math.exp(logSum / active)
  const arith = sum / active
  if (arith <= 0) return 0
  return geo / arith
}

/**
 * Spectral flux — sum of positive magnitude differences between two
 * consecutive magnitude spectra. Identical spectra yield 0.
 */
export function spectralFlux(prev: ArrayLike<number>, curr: ArrayLike<number>): number {
  const n = Math.min(prev.length, curr.length)
  let flux = 0
  for (let i = 0; i < n; i++) {
    const diff = (curr[i] as number) - (prev[i] as number)
    if (diff > 0) flux += diff
  }
  return flux
}

/** RMS energy of a time-domain frame. Returns 0 for empty/silent input. */
export function rmsEnergy(frame: ArrayLike<number>): number {
  const n = frame.length
  if (n === 0) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const v = frame[i] as number
    sum += v * v
  }
  return Math.sqrt(sum / n)
}

/** Zero-crossing rate per sample. Returns 0 for empty input. */
export function zeroCrossingRate(frame: ArrayLike<number>): number {
  const n = frame.length
  if (n < 2) return 0
  let zc = 0
  for (let i = 1; i < n; i++) {
    const a = frame[i - 1] as number
    const b = frame[i] as number
    if ((a >= 0 && b < 0) || (a < 0 && b >= 0)) zc++
  }
  return zc / n
}

/** Sum of magnitudes in the [loHz, hiHz] frequency band. */
export function bandEnergy(
  mag: ArrayLike<number>,
  sampleRate: number,
  loHz: number,
  hiHz: number
): number {
  const n = mag.length
  if (n === 0) return 0
  const fftSize = (n - 1) * 2
  const loBin = Math.max(1, freqToBin(loHz, sampleRate, fftSize))
  const hiBin = Math.min(n - 1, freqToBin(hiHz, sampleRate, fftSize))
  let sum = 0
  for (let i = loBin; i <= hiBin; i++) {
    sum += mag[i] as number
  }
  return sum
}

/** Low-frequency (kick/sub) energy: 20-120 Hz. */
export function bassActivity(mag: ArrayLike<number>, sampleRate: number): number {
  return bandEnergy(mag, sampleRate, 20, 120)
}

/** Low-mid (bass instrument body) energy: 120-500 Hz. */
export function lowMidEnergy(mag: ArrayLike<number>, sampleRate: number): number {
  return bandEnergy(mag, sampleRate, 120, 500)
}

/** High (presence/air) energy: 2000-8000 Hz. */
export function highEnergy(mag: ArrayLike<number>, sampleRate: number): number {
  return bandEnergy(mag, sampleRate, 2000, 8000)
}

/**
 * Transient density — fraction of flux-history samples above `threshold`.
 * Returns 0 for empty history.
 */
export function transientDensity(fluxHistory: ArrayLike<number>, threshold: number): number {
  const n = fluxHistory.length
  if (n === 0) return 0
  let above = 0
  for (let i = 0; i < n; i++) {
    if ((fluxHistory[i] as number) > threshold) above++
  }
  return above / n
}
