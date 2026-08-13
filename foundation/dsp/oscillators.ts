/**
 * Band-limited oscillators using PolyBLEP (polynomial band-limited step).
 *
 * PolyBLEP corrects the aliasing caused by naive sawtooth/square waves by
 * adding a small correction around discontinuities. This is the standard
 * technique for quality software synthesis without oversampling.
 *
 * References: Välimäki & Huovilainen (2007), "Antialiasing Oscillators in
 * Subtractive Synthesis".
 *
 * All oscillators are sample-by-sample processors: call `process()` per sample.
 * They maintain their own phase state.
 */

export type Waveform = 'sine' | 'saw' | 'square' | 'triangle'

export interface OscillatorOptions {
  waveform: Waveform
  sampleRate: number
  /** Initial frequency in Hz. */
  frequency: number
}

/**
 * PolyBLEP oscillator. Processes one sample at a time.
 *
 * Usage:
 *   const osc = new PolyBlepOsc({ waveform: 'saw', sampleRate: 44100, frequency: 220 });
 *   for (let i = 0; i < N; i++) buffer[i] = osc.process();
 *   osc.setFrequency(440); // smooth retune
 */
export class PolyBlepOsc {
  private phase = 0
  private freq: number
  private readonly sr: number
  readonly waveform: Waveform

  constructor(opts: OscillatorOptions) {
    this.waveform = opts.waveform
    this.sr = opts.sampleRate
    this.freq = opts.frequency
  }

  setFrequency(hz: number): void {
    this.freq = hz
  }

  get frequency(): number {
    return this.freq
  }

  /** Advance one sample and return the output. */
  process(): number {
    const phaseInc = this.freq / this.sr
    let value: number

    switch (this.waveform) {
      case 'sine':
        value = Math.sin(2 * Math.PI * this.phase)
        break
      case 'saw':
        // Naive saw: 2*phase - 1
        value = 2 * this.phase - 1
        value -= polyblep(this.phase, phaseInc)
        break
      case 'square':
        // Naive square: sign(saw)
        value = this.phase < 0.5 ? 1 : -1
        value += polyblep(this.phase, phaseInc)
        value -= polyblep((this.phase + 0.5) % 1, phaseInc)
        break
      case 'triangle':
        // Triangle from integrated square: 2 * |2*(phase - floor(phase+0.5))| - 1
        value = 2 * Math.abs(2 * (this.phase - Math.floor(this.phase + 0.5))) - 1
        break
    }

    this.phase += phaseInc
    if (this.phase >= 1) this.phase -= 1
    return value
  }

  /** Reset phase to 0 (or a given 0..1 value). */
  reset(phase = 0): void {
    this.phase = phase
  }
}

/**
 * PolyBLEP correction: a small step added around discontinuities.
 * `t` is the phase position [0,1), `dt` is the phase increment per sample.
 */
function polyblep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt
    return x + x - x * x - 1
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt
    return x * x + x + x + 1
  }
  return 0
}

/**
 * FM oscillator — carrier modulated by a modulator.
 * Uses phase modulation (the Yamaha DX7 approach): phase += freq + mod * sin(modPhase).
 */
export class FmOscillator {
  private carrierPhase = 0
  private modPhase = 0
  private carrierFreq: number
  private modFreq: number
  private modIndex: number
  private readonly sr: number

  constructor(opts: {
    sampleRate: number
    carrierFreq: number
    modFreq?: number
    modIndex?: number
  }) {
    this.sr = opts.sampleRate
    this.carrierFreq = opts.carrierFreq
    this.modFreq = opts.modFreq ?? opts.carrierFreq
    this.modIndex = opts.modIndex ?? 0
  }

  setCarrier(hz: number): void {
    this.carrierFreq = hz
  }
  setModulator(hz: number): void {
    this.modFreq = hz
  }
  setModIndex(index: number): void {
    this.modIndex = index
  }

  process(): number {
    const mod = this.modIndex * Math.sin(2 * Math.PI * this.modPhase)
    const sample = Math.sin(2 * Math.PI * this.carrierPhase + mod)
    this.carrierPhase += this.carrierFreq / this.sr
    if (this.carrierPhase >= 1) this.carrierPhase -= 1
    this.modPhase += this.modFreq / this.sr
    if (this.modPhase >= 1) this.modPhase -= 1
    return sample
  }

  reset(): void {
    this.carrierPhase = 0
    this.modPhase = 0
  }
}

/**
 * Wavetable oscillator — linear interpolation between table entries.
 * The table is one cycle of a waveform, normalized to [0,1) phase.
 */
export class WavetableOsc {
  private phase = 0
  private freq: number
  private readonly sr: number
  private readonly table: Float32Array

  constructor(opts: { sampleRate: number; frequency: number; table: Float32Array }) {
    this.sr = opts.sampleRate
    this.freq = opts.frequency
    this.table = opts.table
  }

  setFrequency(hz: number): void {
    this.freq = hz
  }

  process(): number {
    const idx = this.phase * this.table.length
    const i0 = Math.floor(idx)
    const i1 = (i0 + 1) % this.table.length
    const frac = idx - i0
    const sample = (this.table[i0] ?? 0) * (1 - frac) + (this.table[i1] ?? 0) * frac
    this.phase += this.freq / this.sr
    if (this.phase >= 1) this.phase -= 1
    return sample
  }

  reset(): void {
    this.phase = 0
  }
}

/** Build a wavetable from a generator function (one cycle, N samples). */
export function buildWavetable(size: number, gen: (phase: number) => number): Float32Array {
  const table = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    table[i] = gen(i / size)
  }
  return table
}

/** Common wavetables. */
export const wavetables = {
  sine: (size = 2048) => buildWavetable(size, (p) => Math.sin(2 * Math.PI * p)),
  saw: (size = 2048) => buildWavetable(size, (p) => 2 * p - 1),
  square: (size = 2048) => buildWavetable(size, (p) => (p < 0.5 ? 1 : -1)),
  triangle: (size = 2048) =>
    buildWavetable(size, (p) => 2 * Math.abs(2 * (p - Math.floor(p + 0.5))) - 1),
}
