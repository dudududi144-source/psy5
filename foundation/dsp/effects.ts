/**
 * Time-based effects — delay and reverb.
 *
 * Delay uses a circular buffer with feedback. Reverb uses a Schroeder
 * allpass-feedback network (lightweight, no impulse response needed).
 */

/**
 * Delay line with feedback and optional low-pass in the feedback path.
 */
export class Delay {
  private readonly buffer: Float32Array
  private writePos = 0
  private feedback: number
  private wet: number
  private readonly sr: number
  private readonly lp: { z: number; a: number }

  constructor(opts: {
    sampleRate: number
    maxDelaySec: number
    delaySec: number
    feedback: number
    wet?: number
    lpCutoffHz?: number
  }) {
    this.sr = opts.sampleRate
    const size = Math.ceil(opts.maxDelaySec * opts.sampleRate)
    this.buffer = new Float32Array(size)
    this.feedback = opts.feedback
    this.wet = opts.wet ?? 0.5
    this.lp = {
      z: 0,
      a: (opts.lpCutoffHz ?? 2000) / ((opts.lpCutoffHz ?? 2000) + this.sr / (2 * Math.PI)),
    }
    this.setDelay(opts.delaySec)
  }

  private delaySamples = 0
  setDelay(sec: number): void {
    this.delaySamples = Math.max(1, Math.min(this.buffer.length - 1, Math.floor(sec * this.sr)))
  }
  setFeedback(fb: number): void {
    this.feedback = Math.max(0, Math.min(0.999, fb))
  }
  setWet(w: number): void {
    this.wet = w
  }

  process(x: number): number {
    const readPos = (this.writePos - this.delaySamples + this.buffer.length) % this.buffer.length
    const delayed = this.buffer[readPos] ?? 0
    // Low-pass the feedback for a natural decay (prevents high-freq ringing).
    this.lp.z = this.lp.a * delayed + (1 - this.lp.a) * this.lp.z
    const fbSignal = this.lp.z * this.feedback
    this.buffer[this.writePos] = x + fbSignal
    this.writePos = (this.writePos + 1) % this.buffer.length
    return x * (1 - this.wet) + delayed * this.wet
  }

  reset(): void {
    this.buffer.fill(0)
    this.writePos = 0
    this.lp.z = 0
  }
}

/**
 * Ping-pong delay — stereo delay that bounces L→R→L.
 */
export class PingPongDelay {
  private readonly leftDelay: Delay
  private readonly rightDelay: Delay

  constructor(opts: { sampleRate: number; delaySec: number; feedback: number; wet?: number }) {
    this.leftDelay = new Delay({ ...opts, maxDelaySec: opts.delaySec * 2 })
    this.rightDelay = new Delay({ ...opts, maxDelaySec: opts.delaySec * 2 })
  }

  process(left: number, _right: number): [number, number] {
    // Cross-feed: left output feeds right delay and vice versa.
    const l = this.leftDelay.process(
      left + (this.rightDelay.process.bind(this.rightDelay) as unknown as number)
    )
    return [l, l]
  }

  reset(): void {
    this.leftDelay.reset()
    this.rightDelay.reset()
  }
}

/**
 * Schroeder reverb — 4 parallel comb filters + 2 series allpass.
 * Lightweight, no impulse response needed. Good for psytrance space.
 */
export class SchroederReverb {
  private readonly combs: CombFilter[]
  private readonly allpasses: AllpassFilter[]
  private wet: number

  constructor(opts: { sampleRate: number; wet?: number }) {
    this.wet = opts.wet ?? 0.3
    const sr = opts.sampleRate
    // Schroeder's classic values (scaled to ms → samples).
    const combTimes = [0.0297, 0.0371, 0.0411, 0.0437]
    const combFeedback = [0.8, 0.75, 0.71, 0.68]
    const allpassTimes = [0.005, 0.0017]
    const allpassFeedback = 0.7

    this.combs = combTimes.map((t, i) => new CombFilter(sr, t, combFeedback[i] ?? 0.7))
    this.allpasses = allpassTimes.map((t) => new AllpassFilter(sr, t, allpassFeedback))
  }

  setWet(w: number): void {
    this.wet = w
  }

  process(x: number): number {
    let wet = 0
    for (const comb of this.combs) wet += comb.process(x)
    wet /= this.combs.length
    for (const ap of this.allpasses) wet = ap.process(wet)
    return x * (1 - this.wet) + wet * this.wet
  }

  reset(): void {
    for (const c of this.combs) c.reset()
    for (const a of this.allpasses) a.reset()
  }
}

/** Comb filter (feedback delay) — the building block of Schroeder reverb. */
class CombFilter {
  private readonly buffer: Float32Array
  private pos = 0
  private readonly feedback: number
  private filterState = 0

  constructor(sampleRate: number, delaySec: number, feedback: number) {
    const size = Math.max(1, Math.floor(delaySec * sampleRate))
    this.buffer = new Float32Array(size)
    this.feedback = feedback
  }

  process(x: number): number {
    const out = this.buffer[this.pos] ?? 0
    // Low-pass in the feedback for natural decay.
    this.filterState = out * 0.5 + this.filterState * 0.5
    this.buffer[this.pos] = x + this.filterState * this.feedback
    this.pos = (this.pos + 1) % this.buffer.length
    return out
  }

  reset(): void {
    this.buffer.fill(0)
    this.pos = 0
    this.filterState = 0
  }
}

/** Allpass filter — phase-shifting delay used in Schroeder reverb. */
class AllpassFilter {
  private readonly buffer: Float32Array
  private pos = 0
  private readonly feedback: number

  constructor(sampleRate: number, delaySec: number, feedback: number) {
    const size = Math.max(1, Math.floor(delaySec * sampleRate))
    this.buffer = new Float32Array(size)
    this.feedback = feedback
  }

  process(x: number): number {
    const delayed = this.buffer[this.pos] ?? 0
    const output = -x + delayed
    this.buffer[this.pos] = x + delayed * this.feedback
    this.pos = (this.pos + 1) % this.buffer.length
    return output
  }

  reset(): void {
    this.buffer.fill(0)
    this.pos = 0
  }
}
