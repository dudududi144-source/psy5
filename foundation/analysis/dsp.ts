/**
 * Pure TypeScript DSP primitives: windowing, FFT, magnitude spectrum.
 *
 * All functions operate on plain number arrays (or Float32Array-like) so they
 * can be unit-tested without depending on a particular audio backend.
 */

/** Hann window of length `n`. Returns a Float32Array of multipliers in [0,1]. */
export function hannWindow(buf: Float32Array | number[]): Float32Array {
  const n = buf.length
  const out = new Float32Array(n)
  if (n === 1) {
    out[0] = 1
    return out
  }
  for (let i = 0; i < n; i++) {
    // Standard periodic Hann: 0.5 - 0.5*cos(2*pi*i/(n-1)) is the symmetric form,
    // but for DFT analysis the periodic form 0.5 - 0.5*cos(2*pi*i/n) is preferred.
    out[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
  }
  return out
}

/** Magnitude spectrum |real + j*imag| for paired arrays. */
export function magnitudeSpectrum(real: ArrayLike<number>, imag: ArrayLike<number>): Float32Array {
  const n = real.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const r = real[i] as number
    const im = imag[i] as number
    out[i] = Math.sqrt(r * r + im * im)
  }
  return out
}

/**
 * In-place radix-2 Cooley-Tukey FFT.
 * `real` and `imag` must have equal length that is a power of two.
 * Throws RangeError if the length is not a power of two.
 */
export function fft(real: number[] | Float32Array, imag: number[] | Float32Array): void {
  const n = real.length
  if (imag.length !== n) {
    throw new RangeError(`fft: real and imag length mismatch (${n} vs ${imag.length})`)
  }
  if (n <= 1) {
    if (n === 0) throw new RangeError('fft: empty input')
    if ((n & (n - 1)) !== 0) throw new RangeError('fft: length must be a power of two')
    return
  }
  if ((n & (n - 1)) !== 0) {
    throw new RangeError(`fft: length ${n} is not a power of two`)
  }

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    while (j & bit) {
      j ^= bit
      bit >>= 1
    }
    j ^= bit
    if (i < j) {
      const tr = real[i] as number
      ;(real as number[])[i] = real[j] as number
      ;(real as number[])[j] = tr
      const ti = imag[i] as number
      ;(imag as number[])[i] = imag[j] as number
      ;(imag as number[])[j] = ti
    }
  }

  // Butterfly stages: size 2, 4, 8, ..., n.
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const theta = (-2 * Math.PI) / size
    const wr = Math.cos(theta)
    const wi = Math.sin(theta)
    for (let start = 0; start < n; start += size) {
      let curW = 1
      let curWi = 0
      for (let k = 0; k < half; k++) {
        const aIdx = start + k
        const bIdx = start + k + half
        const ar = real[aIdx] as number
        const ai = imag[aIdx] as number
        const br = real[bIdx] as number
        const bi = imag[bIdx] as number
        const tr = br * curW - bi * curWi
        const ti = br * curWi + bi * curW
        ;(real as number[])[aIdx] = ar + tr
        ;(imag as number[])[aIdx] = ai + ti
        ;(real as number[])[bIdx] = ar - tr
        ;(imag as number[])[bIdx] = ai - ti
        const nextW = curW * wr - curWi * wi
        curWi = curW * wi + curWi * wr
        curW = nextW
      }
    }
  }
}

/**
 * Compute the magnitude spectrum of a time-domain frame.
 * The frame is multiplied by a Hann window, then transformed via FFT.
 * Returns the one-sided (N/2+1)-point magnitude spectrum — for real input the
 * upper half is a mirror of the lower half and is omitted.
 */
export function spectrum(frame: Float32Array | number[]): Float32Array {
  const n = frame.length
  if (n === 0) return new Float32Array(0)
  if ((n & (n - 1)) !== 0) {
    throw new RangeError(`spectrum: frame length ${n} must be a power of two`)
  }
  const win = hannWindow(frame)
  const real = new Float32Array(n)
  const imag = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    real[i] = (frame[i] as number) * (win[i] as number)
  }
  fft(real, imag)
  const half = (n >> 1) + 1
  const out = new Float32Array(half)
  for (let i = 0; i < half; i++) {
    const r = real[i] as number
    const im = imag[i] as number
    out[i] = Math.sqrt(r * r + im * im)
  }
  return out
}
