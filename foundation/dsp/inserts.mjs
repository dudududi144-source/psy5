/* ============ INSERT FX CURVES (v0.10.0 P3) — foundation/dsp ============
   Pure, deterministic transfer curves for the per-track insert chain. The
   engine caches these at init; the same bytes serve live + offline renders.

   DRIVE — soft-clip tanh at the max drive k=10, precomputed ONCE. The
   AMOUNT is not a curve swap (WaveShaper.curve is not time-anchorable — a
   per-amount curve grid would render wrongly in offline bounces); the
   engine drives amount through an automatable input-trim GainNode
   (1 + 9·amount/100) with an exact dry/wet crossfade: amount 0 = dry path
   only = bit-identity (x·1 + 0·tanh(x) = x, ±0 sign flips documented).
   The curve grid the spec asked for is therefore the SINGLE k=10 curve +
   the trim grid — same musical result, offline-correct by construction.

   CRUSH — quantization staircase per bit depth (2..16): y = round(x·(L−1))/(L−1),
   L = 2^(bits−1). 16 is identity-adjacent but NOT exact → the engine treats
   bits ≥ 16 as bypass (dry path), so neutrality is exact. */

export const CURVE_N = 4097; /* odd — exact 0 sample point */

/* driveCurve — the fixed k=10 soft-clip curve (peak-unity: tanh(±k)/tanh(k)). */
export function driveCurve() {
  const k = 10, norm = Math.tanh(k);
  const c = new Float32Array(CURVE_N);
  for (let i = 0; i < CURVE_N; i++) {
    const x = i / (CURVE_N - 1) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  return c;
}

/* driveTrim — amount (0..100) → input trim gain (1..10). Pure. */
export function driveTrim(amount) {
  const a = Math.min(100, Math.max(0, amount));
  return 1 + 9 * a / 100;
}

/* crushCurve — quantization staircase for a bit depth (2..16). */
export function crushCurve(bits) {
  const b = Math.min(16, Math.max(2, Math.round(bits)));
  const levels = Math.pow(2, b - 1);
  const c = new Float32Array(CURVE_N);
  for (let i = 0; i < CURVE_N; i++) {
    const x = i / (CURVE_N - 1) * 2 - 1;
    c[i] = Math.round(x * (levels - 1)) / (levels - 1);
  }
  return c;
}
