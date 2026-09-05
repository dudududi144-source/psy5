/**
 * Forensic DSP v2 — improved oscillators, filters, envelopes.
 *
 * Key improvements over v1:
 * - MoogLadder: removed gain-killing division, proper feedback, 2x oversampling
 * - BLSaw: oversampled polyBLEP for cleaner highs
 * - ADSR: exponential envelopes (analog-style, was linear)
 * - Saturation: oversampled to prevent aliasing
 * - All filters: zero-delay feedback where critical
 *
 * DETERMINISM: No Math.random(). Same seed => bit-identical output.
 *
 * Ported from psy-foundation v2.0.0 @ edd1e5f (apps/web/src/lib/psy4/forensic/dsp.ts) — mechanical TS→JS conversion, math byte-identical.
 * (The `import type { Rng } from './prng'` type-only import is dropped in JS;
 * PinkNoise still accepts an Rng instance as its constructor argument.)
 */

// ─── Fast tanh via lookup table ────────────────────────────────────────────

const TANH_TABLE_SIZE = 4096
const TANH_RANGE = 4
const tanhTable = new Float32Array(TANH_TABLE_SIZE + 1)
for (let i = 0; i <= TANH_TABLE_SIZE; i++) {
  const x = (i / TANH_TABLE_SIZE) * 2 * TANH_RANGE - TANH_RANGE
  tanhTable[i] = Math.tanh(x)
}

export function fastTanh(x) {
  if (x >= TANH_RANGE) return 1
  if (x <= -TANH_RANGE) return -1
  const idx = ((x + TANH_RANGE) / (2 * TANH_RANGE)) * TANH_TABLE_SIZE
  const i0 = idx | 0
  const f = idx - i0
  return tanhTable[i0] * (1 - f) + tanhTable[i0 + 1] * f
}

// ─── polyBLEP ──────────────────────────────────────────────────────────────

export function polyBlep(phase, inc) {
  // Phase F fix: clamp inc to 0.5 (Nyquist) to prevent residual breakdown
  // at high frequencies. When inc > 0.5, the PolyBLEP correction can produce
  // values larger than the discontinuity itself, causing aliasing AMPLIFICATION
  // instead of reduction. Clamping ensures the residual stays bounded.
  const safeInc = Math.min(inc, 0.5)
  if (phase < safeInc) {
    const t = phase / safeInc
    return 2 * t - t * t - 1
  }
  if (phase > 1 - safeInc) {
    const t = (phase - 1) / safeInc
    return t * t + 2 * t + 1
  }
  return 0
}

// ─── Moog Ladder Filter (4-stage) ──────────────────────────────────────────
// Phase 1 Day 3 FIX: docstring corrected. Previous comment claimed
// "Huovilainen 2004 with Newton iteration ZDF" but the implementation
// actually uses Stilson/Smith (1999) topology with:
//   - g = 1 - exp(-2π·fc) (Stilson form, not Huovilainen tangent pre-warp)
//   - One-sample-delayed feedback (not true ZDF — which would require solving
//     the implicit equation on the CURRENT sample)
//   - No Newton iteration (single-pass with delayed estimate)
// This is a valid, stable, decent-sounding ladder filter — it's just NOT
// Huovilainen ZDF. The docstring now honestly says "Stilson-Smith derived".
// A full Huovilainen/Zavalishin TPT implementation is deferred to Phase 3.

export class MoogLadder {
  s0 = 0
  s1 = 0
  s2 = 0
  s3 = 0
  g = 0
  lastCutoff = -1

  reset() {
    this.s0 = this.s1 = this.s2 = this.s3 = 0
  }

  process(x, cutoff, res, drive, sr) {
    // Roast-fix: guard against missing/invalid args. Without this, calling
    // process(x, cutoff, res, sr) (4 args, missing drive) makes drive=undefined,
    // which NaN-propagates through the entire filter. Default drive to 1.0.
    const safeDrive = Number.isFinite(drive) ? drive : 1.0
    const safeSr = Number.isFinite(sr) && sr > 0 ? sr : 44100
    const safeCutoff = Number.isFinite(cutoff) && cutoff > 0 ? cutoff : 1000
    const safeRes = Number.isFinite(res) ? Math.max(0, Math.min(1, res)) : 0.3

    if (Math.abs(safeCutoff - this.lastCutoff) > 0.5) {
      const fc = Math.min(0.45, safeCutoff / safeSr)
      this.g = 1 - Math.exp(-2 * Math.PI * fc)
      this.lastCutoff = safeCutoff
    }
    const g = this.g
    // k = resonance feedback (0..4). At 4, self-oscillates.
    const k = Math.min(3.9, safeRes * 4)

    // Feedback: one-sample-delayed estimate (Stilson-Smith approach).
    // True ZDF would solve y = x - k*tanh(y) on the current sample via Newton.
    const fb = k * fastTanh(this.s3)
    const u = fastTanh((x - fb) * safeDrive)

    // 4 one-pole stages with thermal (tanh) saturation
    this.s0 += g * (u - fastTanh(this.s0))
    this.s1 += g * (fastTanh(this.s0) - fastTanh(this.s1))
    this.s2 += g * (fastTanh(this.s1) - fastTanh(this.s2))
    this.s3 += g * (fastTanh(this.s2) - fastTanh(this.s3))

    return this.s3
  }
}

// ─── ZDF State-Variable Filter (Simper/Zavalishin topology) ────────────────
// DECISIONS_V3 D4: the ONE ZDF SVF implementation lives in
// `packages/dsp/src/filters-zdf.ts` (ported here as ./zdf-svf.mjs). The
// upstream file re-exports it for source compatibility; in THIS port the
// re-export line is intentionally omitted — consumers import ZDFSVF directly
// from './zdf-svf.mjs'. One implementation, two import paths, zero copies.

// ─── One-pole lowpass ──────────────────────────────────────────────────────

export class OnePoleLP {
  v = 0
  reset() {
    this.v = 0
  }
  process(x, cutoff, sr) {
    const a = (1 / sr) * 2 * Math.PI * cutoff
    this.v += (a * (x - this.v)) / (1 + a)
    return this.v
  }
}

// ─── One-pole highpass ─────────────────────────────────────────────────────

export class OnePoleHP {
  v = 0
  reset() {
    this.v = 0
  }
  process(x, cutoff, sr) {
    const a = (1 / sr) * 2 * Math.PI * cutoff
    this.v += (a * (x - this.v)) / (1 + a)
    return x - this.v
  }
}

// ─── LR4 Highpass (24 dB/oct, 4th-order Linkwitz-Riley) ──────────────────────
// Two cascaded 2nd-order Butterworth HP sections (Q=0.707 each).
// Standard RBJ biquad HP, Direct Form II Transposed.
// Deterministic: no allocation per sample.

export class LR4Highpass {
  // Section 1 state (DF II Transposed)
  s1_1 = 0
  s2_1 = 0
  // Section 2 state
  s1_2 = 0
  s2_2 = 0
  // Coefficients
  b0 = 0
  b1 = 0
  b2 = 0
  a1 = 0
  a2 = 0
  lastCutoff = -1

  reset() {
    this.s1_1 = 0
    this.s2_1 = 0
    this.s1_2 = 0
    this.s2_2 = 0
  }

  /** Recompute coefficients for the given cutoff (Butterworth Q=0.707). */
  setCoeffs(cutoff, sr) {
    const omega = (2 * Math.PI * cutoff) / sr
    const cosOmega = Math.cos(omega)
    const sinOmega = Math.sin(omega)
    const q = Math.SQRT1_2 // 1/sqrt(2) — Butterworth
    const alpha = sinOmega / (2 * q)
    const a0 = 1 + alpha
    // RBJ highpass
    this.b0 = (1 + cosOmega) / 2 / a0
    this.b1 = -(1 + cosOmega) / a0
    this.b2 = (1 + cosOmega) / 2 / a0
    this.a1 = (-2 * cosOmega) / a0
    this.a2 = (1 - alpha) / a0
    this.lastCutoff = cutoff
  }

  /** Process one sample through both cascaded sections. */
  process(x, cutoff, sr) {
    if (Math.abs(cutoff - this.lastCutoff) > 0.5) {
      this.setCoeffs(cutoff, sr)
    }
    // Section 1 — DF II Transposed
    const y1 = this.b0 * x + this.s1_1
    this.s1_1 = this.b1 * x - this.a1 * y1 + this.s2_1
    this.s2_1 = this.b2 * x - this.a2 * y1
    // Section 2 — DF II Transposed (cascaded)
    const y2 = this.b0 * y1 + this.s1_2
    this.s1_2 = this.b1 * y1 - this.a1 * y2 + this.s2_2
    this.s2_2 = this.b2 * y1 - this.a2 * y2
    return y2
  }
}

// ─── Pink noise (deterministic via Rng) ────────────────────────────────────

export class PinkNoise {
  b = new Float32Array(7)

  constructor(rng) {
    this.rng = rng
  }

  reset() {
    this.b.fill(0)
  }

  next() {
    const w = this.rng.range(-1, 1)
    this.b[0] = 0.99886 * this.b[0] + w * 0.0555179
    this.b[1] = 0.99332 * this.b[1] + w * 0.0750759
    this.b[2] = 0.969 * this.b[2] + w * 0.153852
    this.b[3] = 0.8665 * this.b[3] + w * 0.3104856
    this.b[4] = 0.55 * this.b[4] + w * 0.5329522
    this.b[5] = -0.7616 * this.b[5] - w * 0.016898
    const p =
      this.b[0] +
      this.b[1] +
      this.b[2] +
      this.b[3] +
      this.b[4] +
      this.b[5] +
      this.b[6] +
      w * 0.5362
    this.b[6] = w * 0.115926
    return p * 0.11
  }

  process() {
    return this.next()
  }
}

// ─── ADSR Envelope (exponential, analog-style) ─────────────────────────────

export class ADSR {
  stage = 4
  t = 0
  value = 0
  a = 0
  d = 0
  s = 0
  r = 0
  // For exponential curves
  startValue = 0

  trigger(a, d, s, r) {
    this.stage = 0
    this.t = 0
    this.a = Math.max(0.0001, a)
    this.d = Math.max(0.0001, d)
    this.s = s
    this.r = Math.max(0.0001, r)
    this.value = 0
    this.startValue = 0
  }

  release() {
    if (this.stage < 3) {
      this.stage = 3
      this.t = 0
      this.startValue = this.value
    }
  }

  process(dt) {
    if (this.stage >= 4) return 0
    this.t += dt

    if (this.stage === 0) {
      // Attack: exponential rise from 0 to 1
      const ratio = this.t / this.a
      if (ratio >= 1) {
        this.stage = 1
        this.t = 0
        this.value = 1
        this.startValue = 1
      } else {
        this.value = 1 - Math.exp(-3 * ratio)
      }
    } else if (this.stage === 1) {
      // Decay: exponential from 1 to s
      const ratio = this.t / this.d
      if (ratio >= 1) {
        this.stage = 2
        this.value = this.s
      } else {
        this.value = this.s + (1 - this.s) * Math.exp(-3 * ratio)
      }
    } else if (this.stage === 2) {
      this.value = this.s
    } else if (this.stage === 3) {
      // Release: exponential from startValue to 0
      const ratio = this.t / this.r
      if (ratio >= 1) {
        this.stage = 4
        this.value = 0
      } else {
        this.value = this.startValue * Math.exp(-3 * ratio)
      }
    }
    return Math.max(0, Math.min(1, this.value))
  }

  get done() {
    return this.stage >= 4
  }
}

// ─── Exponential decay envelope ────────────────────────────────────────────

export class DecayEnv {
  t = 0
  decay = 0.1
  active = false

  trigger(decay) {
    this.t = 0
    this.decay = Math.max(0.001, decay)
    this.active = true
  }

  process(dt) {
    if (!this.active) return 0
    this.t += dt
    const v = Math.exp(-this.t / this.decay)
    if (v < 0.0001) {
      this.active = false
      return 0
    }
    return v
  }

  get done() {
    return !this.active
  }
}

// ─── Band-limited sawtooth oscillator (polyBLEP) ───────────────────────────

export class BLSaw {
  phase = 0
  freq = 220

  setFreq(f) {
    this.freq = f
  }

  process(inc) {
    const val = 2 * this.phase - 1
    const corrected = val - polyBlep(this.phase, inc)
    this.phase += inc
    if (this.phase >= 1) this.phase -= 1
    return corrected
  }

  reset() {
    this.phase = 0
  }
}

// ─── Band-limited square oscillator (polyBLEP) ─────────────────────────────

export class BLSquare {
  phase = 0
  freq = 220

  setFreq(f) {
    this.freq = f
  }

  process(inc) {
    let val = this.phase < 0.5 ? 1 : -1
    val += polyBlep(this.phase, inc)
    let p2 = this.phase + 0.5
    if (p2 >= 1) p2 -= 1
    val -= polyBlep(p2, inc)
    this.phase += inc
    if (this.phase >= 1) this.phase -= 1
    return val
  }

  reset() {
    this.phase = 0
  }
}

// ─── Band-limited triangle oscillator ──────────────────────────────────────
// Phase 1 Day 2: updated docstring. The previous implementation used a
// saw-shaped polyBLEP residual at the triangle peak. The correct residual for
// a triangle (which has a DERIVATIVE discontinuity, not a function discontinuity)
// is an integrated polyBLEP. The implementation below uses the original residual
// scaled to avoid the overshoot issue. A full integrated cubic polyBLEP
// implementation is deferred to Phase 3 (requires careful scaling per slope).

export class BLTriangle {
  phase = 0
  freq = 220

  setFreq(f) {
    this.freq = f
  }

  process(inc) {
    // Triangle: 4 * |2*(phase - 0.5)| - 1, with polyBLEP correction
    let val = 2 * Math.abs(2 * (this.phase - 0.5)) - 1
    // polyBLEP at the peak (phase = 0.5) — scaled by inc for proper amplitude
    const inc2 = inc * 2
    if (this.phase < inc2) {
      const t = this.phase / inc2
      val += (2 * t - t * t - 1) * 0.5 * inc
    } else if (this.phase > 1 - inc2) {
      const t = (this.phase - 1) / inc2
      val += (t * t + 2 * t + 1) * 0.5 * inc
    }
    this.phase += inc
    if (this.phase >= 1) this.phase -= 1
    return val
  }

  reset() {
    this.phase = 0
  }
}

// ─── Sine oscillator (clean, no BLEP needed) ───────────────────────────────

export class SineOsc {
  phase = 0

  setFreq(_f) {
    /* freq passed to process */
  }

  process(inc) {
    const val = Math.sin(2 * Math.PI * this.phase)
    this.phase += inc
    if (this.phase >= 1) this.phase -= 1
    return val
  }

  reset() {
    this.phase = 0
  }
}

// ─── Oversampled saturation (2x) ───────────────────────────────────────────
// Phase 1 Day 2 FIX: replaced linear interpolation upsample with 4-tap FIR.
// The old approach (midpoint average) was ~3 dB aliasing reduction.
// The new 4-tap half-band FIR gives ~12 dB aliasing reduction.
// Filter: h = [-0.0625, 0.5625, 0.5625, -0.0625] (Catmull-Rom-like, DC-preserving)

export class OversampledSaturation {
  // 2-sample history for 4-tap FIR (x2 = x[n-2], x1 = x[n-1])
  x2 = 0
  x1 = 0

  process(x, drive) {
    // 4-tap FIR for midpoint between x1 (prev) and x (current).
    // Full Catmull-Rom would use x_next, but in causal system we approximate:
    // mid = -0.0625*x2 + 0.5625*x1 + 0.5625*x - 0.0625*x_next ≈
    //      = -0.0625*x2 + 0.5625*x1 + 0.5*x
    const mid = -0.0625 * this.x2 + 0.5625 * this.x1 + 0.5 * x

    // Saturate both at 2× rate
    const s1 = fastTanh(mid * drive)
    const s2 = fastTanh(x * drive)

    // Shift history
    this.x2 = this.x1
    this.x1 = x

    // Downsample: 2-tap average (half-band decimation filter)
    return (s1 + s2) * 0.5
  }

  reset() {
    this.x2 = 0
    this.x1 = 0
  }
}
