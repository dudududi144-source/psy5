/**
 * Filters — one-pole, biquad, and Moog-style ladder.
 *
 * All are sample-by-sample processors. The Moog ladder uses the classic
 * 4-stage implementation with resonance feedback.
 */

/**
 * One-pole low-pass filter. Simple, cheap, no resonance.
 * y[n] = a * x[n] + (1-a) * y[n-1], where a = cutoff / (cutoff + sr/(2*pi)).
 */
export class OnePoleLP {
  private z = 0
  private a = 0
  private readonly sr: number

  constructor(sampleRate: number, cutoffHz: number) {
    this.sr = sampleRate
    this.setCutoff(cutoffHz)
  }

  setCutoff(hz: number): void {
    this.a = hz / (hz + this.sr / (2 * Math.PI))
  }

  process(x: number): number {
    this.z = this.a * x + (1 - this.a) * this.z
    return this.z
  }

  reset(): void {
    this.z = 0
  }
}

/**
 * One-pole high-pass filter.
 * y[n] = a * (y[n-1] + x[n] - x[n-1])
 */
export class OnePoleHP {
  private z = 0
  private prevX = 0
  private a = 0
  private readonly sr: number

  constructor(sampleRate: number, cutoffHz: number) {
    this.sr = sampleRate
    this.setCutoff(cutoffHz)
  }

  setCutoff(hz: number): void {
    this.a = hz / (hz + this.sr / (2 * Math.PI))
  }

  process(x: number): number {
    this.z = this.a * (this.z + x - this.prevX)
    this.prevX = x
    return this.z
  }

  reset(): void {
    this.z = 0
    this.prevX = 0
  }
}

export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'allpass'

/**
 * Biquad filter with standard AudioBiquadFilter coefficients.
 * Uses the RBJ cookbook formulas.
 */
export class BiquadFilter {
  private z1 = 0
  private z2 = 0
  private b0 = 1
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  private readonly sr: number

  constructor(sampleRate: number, type: BiquadType, freqHz: number, Q = Math.SQRT1_2) {
    this.sr = sampleRate
    this.setParams(type, freqHz, Q)
  }

  setParams(type: BiquadType, freqHz: number, Q = Math.SQRT1_2): void {
    const w0 = (2 * Math.PI * freqHz) / this.sr
    const cosw = Math.cos(w0)
    const sinw = Math.sin(w0)
    const alpha = sinw / (2 * Q)

    switch (type) {
      case 'lowpass':
        this.b0 = (1 - cosw) / 2
        this.b1 = 1 - cosw
        this.b2 = (1 - cosw) / 2
        this.a1 = -2 * cosw
        this.a2 = 1 - alpha
        break
      case 'highpass':
        this.b0 = (1 + cosw) / 2
        this.b1 = -(1 + cosw)
        this.b2 = (1 + cosw) / 2
        this.a1 = -2 * cosw
        this.a2 = 1 - alpha
        break
      case 'bandpass':
        this.b0 = alpha
        this.b1 = 0
        this.b2 = -alpha
        this.a1 = -2 * cosw
        this.a2 = 1 - alpha
        break
      case 'notch':
        this.b0 = 1
        this.b1 = -2 * cosw
        this.b2 = 1
        this.a1 = -2 * cosw
        this.a2 = 1 - alpha
        break
      case 'allpass':
        this.b0 = 1 - alpha
        this.b1 = -2 * cosw
        this.b2 = 1 + alpha
        this.a1 = -2 * cosw
        this.a2 = 1 - alpha
        break
    }

    const a0 = 1 + alpha
    this.b0 /= a0
    this.b1 /= a0
    this.b2 /= a0
    this.a1 /= a0
    this.a2 /= a0
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }

  reset(): void {
    this.z1 = 0
    this.z2 = 0
  }
}

/**
 * Moog-style 4-pole ladder low-pass filter with resonance.
 * Based on the Stilson/Smith implementation. Warm, classic subtractive synth sound.
 */
export class MoogLadder {
  private readonly sr: number
  private cutoff = 1000
  private resonance = 0
  private p = 0
  private k = 0
  private readonly stage = [0, 0, 0, 0]
  private readonly delay = [0, 0, 0, 0]

  constructor(sampleRate: number, cutoffHz = 1000, resonance = 0) {
    this.sr = sampleRate
    this.setCutoff(cutoffHz)
    this.setResonance(resonance)
  }

  setCutoff(hz: number): void {
    this.cutoff = hz
    // Normalized cutoff (0..1 where 1 = Nyquist).
    const fc = (2 * hz) / this.sr
    // Compensation factor for resonance gain loss.
    this.p = (2 * Math.PI * fc) / (1 + this.resonance * 0.5)
  }

  setResonance(res: number): void {
    this.resonance = Math.max(0, Math.min(1, res))
    this.k = 4 * this.resonance
    this.setCutoff(this.cutoff)
  }

  process(x: number): number {
    // Saturation in the feedback path (tanh) for stability + warmth.
    const fb = this.k * (this.delay[3] ?? 0)
    const sat = x - Math.tanh(fb)

    for (let i = 0; i < 4; i++) {
      const stageIn = i === 0 ? sat : (this.delay[i - 1] ?? 0)
      this.stage[i] =
        this.stage[i] +
        this.p *
          (Math.tanh(stageIn - this.k * (this.stage[i] ?? 0)) - Math.tanh(this.stage[i] ?? 0))
      this.delay[i] = this.stage[i]
    }

    return this.delay[3] ?? 0
  }

  reset(): void {
    for (let i = 0; i < 4; i++) {
      this.stage[i] = 0
      this.delay[i] = 0
    }
  }
}
