/**
 * Adaptive spectral-flux onset detection.
 *
 * Pipeline per hop:
 *   1. extract `frameSize` samples centred at hop time
 *   2. windowed FFT -> magnitude spectrum
 *   3. spectral flux vs the previous frame's spectrum
 *   4. keep flux samples where flux > localMedian * threshold AND flux is a
 *      local maximum (strictly greater than both neighbours)
 *   5. suppress onsets closer than `minIntervalSec`
 *   6. normalise strengths to [0,1]
 */
import { spectrum } from './dsp.ts'
import { spectralFlux } from './features.ts'

export interface Onset {
  /** Time in seconds from the start of the signal. */
  at: number
  /** Normalised strength in [0,1] (1 = strongest onset in this signal). */
  strength: number
}

export interface OnsetOptions {
  sampleRate: number
  frameSize?: number
  hopSize?: number
  threshold?: number
  /** Number of neighbouring flux samples to use for the median (one-sided). */
  localWindow?: number
  /** Minimum gap between two onsets in seconds. */
  minIntervalSec?: number
}

const DEFAULTS = {
  frameSize: 1024,
  hopSize: 512,
  threshold: 1.5,
  localWindow: 20,
  minIntervalSec: 0.05,
} as const

/** Detect onsets in a time-domain signal. Returns onsets sorted by time. */
export function detectOnsets(signal: Float32Array | number[], opts: OnsetOptions): Onset[] {
  const sampleRate = opts.sampleRate
  const frameSize = opts.frameSize ?? DEFAULTS.frameSize
  const hopSize = opts.hopSize ?? DEFAULTS.hopSize
  const threshold = opts.threshold ?? DEFAULTS.threshold
  const localWindow = opts.localWindow ?? DEFAULTS.localWindow
  const minIntervalSec = opts.minIntervalSec ?? DEFAULTS.minIntervalSec

  const n = signal.length
  if (n < frameSize) return []

  const half = frameSize >> 1
  const hopCount = Math.max(0, Math.floor((n - frameSize) / hopSize) + 1)

  // Step 1+2+3: per-hop flux. The first hop's "previous" frame is treated as
  // silence so a kick landing at t=0 still produces a flux peak.
  const flux: number[] = new Array(hopCount).fill(0)
  const silentMag = new Float32Array(frameSize)
  let prevMag: Float32Array = silentMag
  for (let h = 0; h < hopCount; h++) {
    const start = h * hopSize
    const frame = new Float32Array(frameSize)
    for (let i = 0; i < frameSize; i++) {
      frame[i] = signal[start + i] as number
    }
    const mag = spectrum(frame)
    flux[h] = spectralFlux(prevMag, mag)
    prevMag = mag
  }

  // Step 4: peak picking with adaptive median threshold. Scan the full range
  // (including the boundary hops); at the boundaries, treat the missing
  // neighbour as -Infinity so a peak at hop 0 / hop N-1 can still be detected.
  // An absolute floor (5% of the global max flux) rejects microscopic flux
  // blips — e.g. the gradual fade-in of a sustained pad — that the median
  // threshold alone would let through when most of the signal is silent.
  let globalMaxFlux = 0
  for (let h = 0; h < hopCount; h++) {
    const v = flux[h] as number
    if (v > globalMaxFlux) globalMaxFlux = v
  }
  const absoluteFloor = globalMaxFlux * 0.05

  const rawPeaks: { at: number; strength: number }[] = []
  for (let h = 0; h < hopCount; h++) {
    const lo = Math.max(0, h - localWindow)
    const hi = Math.min(hopCount - 1, h + localWindow)
    const window: number[] = []
    for (let k = lo; k <= hi; k++) window.push(flux[k] as number)
    const median = medianOf(window)
    const f = flux[h] as number
    const prevF = h > 0 ? (flux[h - 1] as number) : Number.NEGATIVE_INFINITY
    const nextF = h < hopCount - 1 ? (flux[h + 1] as number) : Number.NEGATIVE_INFINITY
    if (f > median * threshold && f > absoluteFloor && f > prevF && f >= nextF && f > 0) {
      const atSec = (h * hopSize + half) / sampleRate
      rawPeaks.push({ at: atSec, strength: f })
    }
  }

  if (rawPeaks.length === 0) return []

  // Step 5: minimum-interval suppression (greedy, keep strongest-first ordering
  // by time but only drop a peak if a previously accepted peak is too close).
  const accepted: { at: number; strength: number }[] = []
  for (const p of rawPeaks) {
    let tooClose = false
    for (const a of accepted) {
      if (Math.abs(a.at - p.at) < minIntervalSec) {
        tooClose = true
        break
      }
    }
    if (!tooClose) accepted.push(p)
  }

  // Step 6: normalise strengths to [0,1].
  let max = 0
  for (const p of accepted) if (p.strength > max) max = p.strength
  if (max <= 0) max = 1
  const onsets: Onset[] = accepted.map((p) => ({
    at: p.at,
    strength: p.strength / max,
  }))
  onsets.sort((a, b) => a.at - b.at)
  return onsets
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  if (sorted.length % 2 === 1) return sorted[mid] as number
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}
