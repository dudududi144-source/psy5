/**
 * Envelopes — ADSR and pitch envelopes.
 *
 * Sample-by-sample processors. Call `process()` to advance one sample.
 */

export type EnvelopeStage = 'attack' | 'decay' | 'sustain' | 'release' | 'idle'

/**
 * ADSR envelope. Linear ramp in attack/decay/release; sustain is a level.
 *
 * Usage:
 *   const env = new Adsr({ sampleRate: 44100, attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3 });
 *   env.gateOn();
 *   for (...) buffer[i] = env.process();
 *   env.gateOff();
 *   for (...) buffer[i] = env.process();
 */
export class Adsr {
  private readonly sr: number
  private attack: number
  private decay: number
  private sustain: number
  private release: number
  private stage: EnvelopeStage = 'idle'
  private value = 0
  private gated = false

  constructor(opts: {
    sampleRate: number
    attack?: number
    decay?: number
    sustain?: number
    release?: number
  }) {
    this.sr = opts.sampleRate
    this.attack = opts.attack ?? 0.01
    this.decay = opts.decay ?? 0.1
    this.sustain = opts.sustain ?? 0.7
    this.release = opts.release ?? 0.3
  }

  setAttack(sec: number): void {
    this.attack = sec
  }
  setDecay(sec: number): void {
    this.decay = sec
  }
  setSustain(level: number): void {
    this.sustain = level
  }
  setRelease(sec: number): void {
    this.release = sec
  }

  gateOn(): void {
    this.gated = true
    this.stage = 'attack'
  }

  gateOff(): void {
    this.gated = false
    this.stage = 'release'
  }

  get currentStage(): EnvelopeStage {
    return this.stage
  }

  get isActive(): boolean {
    return this.stage !== 'idle'
  }

  process(): number {
    const samplesPerSec = this.sr

    switch (this.stage) {
      case 'attack': {
        const inc = 1 / (this.attack * samplesPerSec)
        this.value += inc
        if (this.value >= 1) {
          this.value = 1
          this.stage = 'decay'
        }
        break
      }
      case 'decay': {
        const inc = (1 - this.sustain) / (this.decay * samplesPerSec)
        this.value -= inc
        if (this.value <= this.sustain) {
          this.value = this.sustain
          this.stage = 'sustain'
        }
        break
      }
      case 'sustain': {
        this.value = this.sustain
        break
      }
      case 'release': {
        const inc = this.value / (this.release * samplesPerSec)
        this.value -= inc
        if (this.value <= 0) {
          this.value = 0
          this.stage = 'idle'
        }
        break
      }
      case 'idle': {
        this.value = 0
        break
      }
    }

    return this.value
  }

  /** Reset to idle. */
  reset(): void {
    this.value = 0
    this.stage = 'idle'
    this.gated = false
  }
}

/**
 * Pitch envelope — a unipolar envelope for pitch glide (portamento / FX).
 * Glides from `from` to `to` over `duration` seconds, then holds at `to`.
 */
export class PitchEnvelope {
  private readonly sr: number
  private from: number
  private to: number
  private duration: number
  private elapsed = 0
  private active = false

  constructor(opts: { sampleRate: number; from: number; to: number; duration: number }) {
    this.sr = opts.sampleRate
    this.from = opts.from
    this.to = opts.to
    this.duration = opts.duration
  }

  trigger(): void {
    this.elapsed = 0
    this.active = true
  }

  get isActive(): boolean {
    return this.active
  }

  process(): number {
    if (!this.active) return this.to
    const total = this.duration * this.sr
    const t = Math.min(1, this.elapsed / total)
    // Exponential glide for natural pitch slides.
    const value = this.from * (this.to / this.from) ** t
    this.elapsed += 1
    if (t >= 1) this.active = false
    return value
  }

  reset(): void {
    this.elapsed = 0
    this.active = false
  }
}
