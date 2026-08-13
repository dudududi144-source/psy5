/**
 * Pitch detection (autocorrelation with subharmonic avoidance) and chroma.
 */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export interface PitchResult {
  /** Detected fundamental frequency in Hz, or null if the frame is silent. */
  freq: number | null
  /** Peak correlation strength in [0,1] — 1 = perfectly periodic. */
  clarity: number
  /** MIDI note number (69 = A4 = 440 Hz), or null if freq is null. */
  midi: number | null
}

const A4_MIDI = 69
const A4_HZ = 440

/**
 * Detect the pitch of a time-domain frame via autocorrelation.
 *
 * Subharmonic avoidance: scan from short lags (high frequency) to long lags
 * (low frequency) and accept the FIRST lag whose normalised correlation is a
 * local maximum AND >= 0.8 * globalMax. This biases toward the shortest
 * period (the fundamental) instead of a multiple (subharmonic).
 *
 * Returns freq=null for silent input.
 */
export function detectPitch(
  frame: Float32Array | number[],
  sampleRate: number,
  minHz = 50,
  maxHz = 2000
): PitchResult {
  const n = frame.length
  if (n < 4) return { freq: null, clarity: 0, midi: null }

  // Remove DC offset.
  let mean = 0
  for (let i = 0; i < n; i++) mean += frame[i] as number
  mean /= n
  let energy = 0
  for (let i = 0; i < n; i++) {
    const v = (frame[i] as number) - mean
    energy += v * v
  }
  if (energy <= 1e-12) return { freq: null, clarity: 0, midi: null }

  const minLag = Math.max(1, Math.floor(sampleRate / maxHz))
  const maxLag = Math.min(n - 1, Math.floor(sampleRate / minHz))
  if (maxLag <= minLag) return { freq: null, clarity: 0, midi: null }

  // Autocorrelation for all candidate lags.
  const corr = new Float32Array(maxLag + 1)
  let globalMax = 0
  let globalMaxLag = minLag
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = 0; i + lag < n; i++) {
      sum += ((frame[i] as number) - mean) * ((frame[i + lag] as number) - mean)
    }
    const c = sum / energy
    corr[lag] = c
    if (c > globalMax) {
      globalMax = c
      globalMaxLag = lag
    }
  }

  // Subharmonic avoidance: shortest-lag local max above 0.8 * globalMax.
  const threshold = 0.8 * globalMax
  let chosenLag: number | null = null
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const c = corr[lag] as number
    if (c >= threshold && c > (corr[lag - 1] as number) && c >= (corr[lag + 1] as number)) {
      chosenLag = lag
      break
    }
  }
  if (chosenLag === null) chosenLag = globalMaxLag

  const freq = sampleRate / chosenLag
  const clarity = Math.max(0, Math.min(1, globalMax))
  const midi = Math.round(A4_MIDI + 12 * Math.log2(freq / A4_HZ))
  return { freq, clarity, midi }
}

/**
 * 12-bin pitch-class profile (chroma) from a magnitude spectrum.
 * Each bin is the sum of magnitudes whose frequency falls into that pitch class.
 * Normalised to [0,1] (max bin = 1).
 */
export function chroma(mag: ArrayLike<number>, sampleRate: number): number[] {
  const n = mag.length
  const out: number[] = new Array(12).fill(0)
  if (n === 0) return out
  const fftSize = (n - 1) * 2
  const binHz = sampleRate / fftSize
  for (let bin = 1; bin < n; bin++) {
    const freq = bin * binHz
    if (freq < 30) continue
    const midiFloat = 69 + 12 * Math.log2(freq / A4_HZ)
    const pc = ((Math.round(midiFloat) % 12) + 12) % 12
    out[pc] += mag[bin] as number
  }
  let max = 0
  for (const v of out) if (v > max) max = v
  if (max > 0) {
    for (let i = 0; i < 12; i++) out[i] /= max
  }
  return out
}

export interface DominantPitchClass {
  /** Note name, e.g. "A", "F#". */
  name: string
  /** Pitch class index 0..11 (0 = C). */
  pc: number
  /** Strength of the dominant bin in [0,1]. */
  strength: number
}

/** Find the loudest pitch class in a chroma vector. */
export function dominantPitchClass(chromaVec: ArrayLike<number>): DominantPitchClass {
  let best = 0
  let bestVal = Number.NEGATIVE_INFINITY
  for (let i = 0; i < 12; i++) {
    const v = chromaVec[i] as number
    if (v > bestVal) {
      bestVal = v
      best = i
    }
  }
  return {
    name: NOTE_NAMES[best] as string,
    pc: best,
    strength: bestVal < 0 ? 0 : bestVal,
  }
}

/** Convert a MIDI note number to a name like "A4" (69 -> "A4"). */
export function midiToName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  return `${NOTE_NAMES[pc] as string}${octave}`
}
