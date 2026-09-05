/**
 * ZDF State-Variable Filter (Simper/Zavalishin topology).
 *
 * Moved from `apps/web/src/lib/psy4/forensic/dsp.ts` into
 * `@psy-foundation/dsp` (DECISIONS_V3 D4) — ONE implementation, two import
 * paths, zero copies. `apps/web/src/lib/psy4/forensic/dsp.ts` re-exports this
 * class for source compatibility.
 *
 * Ported from PsySynthPro. This is the standard filter in professional
 * softsynths (Serum, Massive, Vital). Zero-delay feedback eliminates
 * the aliasing and instability of naive feedback topologies.
 *
 * Supports lowpass, bandpass, and highpass outputs simultaneously.
 *
 * Ported from psy-foundation v2.0.0 @ edd1e5f (packages/dsp/src/filters-zdf.ts) — mechanical TS→JS conversion, math byte-identical.
 */

export class ZDFSVF {
  ic1eq = 0
  ic2eq = 0
  smoothFc = 0
  lastCutoff = -1

  reset() {
    this.ic1eq = 0
    this.ic2eq = 0
    this.smoothFc = 0
    this.lastCutoff = -1
  }

  /**
   * Process one sample through the ZDF SVF.
   * @param x Input sample
   * @param cutoff Cutoff frequency in Hz
   * @param res Resonance (0..1, where 1 = self-oscillation)
   * @param sr Sample rate
   * @param type 0=lowpass, 1=bandpass, 2=highpass
   * @returns Filtered sample
   */
  process(x, cutoff, res, sr, type = 0) {
    // Phase F fix: proper one-pole smoothing with 10ms time constant.
    // Old code used coefficient 0.0015 (τ ≈ 0.67s) which caused
    // the filter to take 3 seconds to reach target cutoff → silenced
    // low frequencies during the transient.
    // New: coefficient = 1 - exp(-1 / (0.01 * sr)) ≈ 0.00227 at 44.1kHz
    // This converges to 95% in ~30ms (audible but not silencing).
    const smoothCoef = 1 - Math.exp(-1 / (0.01 * sr))
    if (this.smoothFc === 0) {
      this.smoothFc = cutoff // first call — initialize directly
    } else {
      this.smoothFc += (cutoff - this.smoothFc) * smoothCoef
    }
    this.lastCutoff = cutoff

    const fc = Math.min(0.49, this.smoothFc / sr)
    const g = Math.tan(Math.PI * fc)
    // k = resonance damping. res 0..1 maps to k 2..0.02
    // PsySynthPro uses res 0..10, we normalize to 0..1
    const resNorm = Math.min(1, Math.max(0, res))
    const k = Math.max(0.02, 2 - resNorm * 2)

    const a1 = 1 / (1 + g * (g + k))
    const a2 = g * a1
    const a3 = g * a2

    const v3 = x - this.ic2eq
    const v1 = a1 * this.ic1eq + a2 * v3
    const v2 = this.ic2eq + a2 * this.ic1eq + a3 * v3

    this.ic1eq = 2 * v1 - this.ic1eq
    this.ic2eq = 2 * v2 - this.ic2eq

    // Output selection
    if (type === 0) return v2 // lowpass
    if (type === 1) return v1 // bandpass
    return x - k * v1 - v2 // highpass
  }

  /** Get all 3 outputs simultaneously (LP, BP, HP) */
  processAll(x, cutoff, res, sr) {
    const fc = Math.min(0.49, cutoff / sr)
    const g = Math.tan(Math.PI * fc)
    const k = Math.max(0.02, 2 - res * 2)

    const a1 = 1 / (1 + g * (g + k))
    const a2 = g * a1
    const a3 = g * a2

    const v3 = x - this.ic2eq
    const v1 = a1 * this.ic1eq + a2 * v3
    const v2 = this.ic2eq + a2 * this.ic1eq + a3 * v3

    this.ic1eq = 2 * v1 - this.ic1eq
    this.ic2eq = 2 * v2 - this.ic2eq

    return [v2, v1, x - k * v1 - v2] // [LP, BP, HP]
  }
}
