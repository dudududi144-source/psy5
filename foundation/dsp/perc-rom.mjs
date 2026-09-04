// foundation/dsp/perc-rom.mjs — PERCUSSION ROM v3 (v0.23.0) — the synth-quality
// ceiling breaker (PSY6).
//
// THE PROBLEM (owner, 4× across runs 18–22): the pooled DrumVoice renders
// percussion with ≤2 oscillators + noise. For the membrane family (conga,
// bongo, darbuka) that is a pure-sine "beep"; for the metal family (crash,
// triangle, cowbell) it is a hollow 6-square ring — and the triangle was
// literally bandpass noise. These are the "sounds below criticism" that
// destroy the mix dynamics.
//
// THE FIX: render each of the weak types ONCE per sample-rate into PCM
// (AudioBuffer at the device), with DSP the per-hit path can't afford:
//   · true modal synthesis — every membrane carries the measured circular-
//     membrane mode ladder (1.0, 1.02 beat partner, 1.475, 2.09, 2.33, 2.63,
//     3.01, 3.36, 3.76 ×f0), each mode with its OWN decay (highs die first)
//   · metal stacks as dense inharmonic oscillator banks (10+ squares for the
//     cymbals, the 808 two-square recipe actually band-passed for the cowbell,
//     a near-harmonic stretched ring for the triangle) + seeded noise shimmer
//   · shaped strike transients (slap/wash/crack) through per-sample biquads
//   · per-type RMS normalization (the anti-"dynamics destroyer" law) — no
//     sound lands far from the family loudness band, peaks stay crestful
//
// Contract (same as the rest of foundation/dsp): pure, deterministic, zero
// dependencies on DOM/AudioContext/wall-clock. Float32Array in, Float32Array
// out. Same (type, sampleRate) → byte-identical PCM (mulberry32 seeded from
// fnv1a(type), never Math.random).
//
// Device integration (js/engine.js): PooledEngine.trigger routes ROM_TYPES
// hits to a pooled RomVoice (per-hit BufferSourceNode + pooled env gain +
// pooled tilt filter); the buffer cache is lazily filled per type at first
// hit (~1–10 ms, the documented first-hit exception) or pre-warmed via
// warmRom(). Per-hit params: tune → playbackRate (classic sampler pitch),
// decay<1 → env fade at the drumDurEst window (the window formula itself is
// UNCHANGED — pool discipline moves zero), tone/punch → pooled tilt/attack
// shaping. The offline bounce (js/bounce.js) builds the same PooledEngine, so
// WAV renders get the same ROM. The worklet engine keeps its documented
// reduced set (V_PERC synth) — honest limitation, unchanged.

import { mulberry32, fnv1a } from '../foundation.mjs';

/* The types rendered by this module. Everything else (kick/snare/clap/hat×2,
   tom, glitch, zap, boom, riser, impact, downlifter) keeps the existing
   DrumVoice synthesis — those are the classic rebuilds with their own
   multi-layer recipes and their own pinned tests. */
export const ROM_TYPES = [
  'conga', 'bongo', 'darbuka',          // membrane family
  'crash', 'revcym', 'triangle',        // metal ring family
  'tambourine', 'shaker',               // jingle / seed family
  'agogo', 'timbale', 'cowbell',        // metal shell family
  'clave', 'rim',                       // wood family
];

/* ── Per-type spec: base f0, buffer seconds (≤ drumDurEst·1.15 so a pooled
   reuse can never cut an audible tail), and loudness target.
   romRMS = the post-normalization RMS the engine mixes at — this is the
   family gain law: measured so no ROM voice "destroys the dynamics".
   Crest factor (peak/RMS) is preserved from the physics, only the RMS is
   leveled. */
const SPEC = {
  conga:      { f0: 310,  sec: 0.42,  rms: 0.105 },
  bongo:      { f0: 440,  sec: 0.27,  rms: 0.098 },
  darbuka:    { f0: 196,  sec: 0.44,  rms: 0.105 },
  crash:      { f0: 330,  sec: 3.00,  rms: 0.075 },
  revcym:     { f0: 300,  sec: 1.60,  rms: 0.080 },
  triangle:   { f0: 2960, sec: 2.50,  rms: 0.062 },
  tambourine: { f0: 190,  sec: 0.38,  rms: 0.088 },
  shaker:     { f0: 0,    sec: 0.12,  rms: 0.082 },
  agogo:      { f0: 1245, sec: 0.36,  rms: 0.092 },
  timbale:    { f0: 840,  sec: 0.32,  rms: 0.096 },
  cowbell:    { f0: 560,  sec: 0.22,  rms: 0.086 },
  clave:      { f0: 2500, sec: 0.06,  rms: 0.100 },
  rim:        { f0: 1100, sec: 0.05,  rms: 0.098 },
};

/* specOf — the engine + audit tool read the window law from here. */
export function romSpec(type) { return SPEC[type] ? Object.assign({}, SPEC[type]) : null; }

/* seedOf — fnv1a returns a 64-bit hex STRING; mulberry32 needs an integer.
   Fold the low 32 bits (>>>0 keeps it in the unsigned range). */
function seedOf(label) {
  return parseInt(fnv1a(label).slice(-8), 16) >>> 0;
}

/* ────────────────────────── DSP PRIMITIVES ──────────────────────────
   Small, allocation-free-per-sample helpers. All filters are Transposed
   Direct-Form II biquads (RBJ cookbook) updated per sample over Float32Array
   — the same math WebAudio's BiquadFilter uses, run offline here. */

function biquadCoeffs(kind, sr, f0, q, gainDb) {
  const w = 2 * Math.PI * Math.min(f0, sr * 0.49) / sr;
  const cw = Math.cos(w), sw = Math.sin(w);
  const A = Math.pow(10, (gainDb || 0) / 40);
  let b0, b1, b2, a0, a1, a2;
  if (kind === 'lowpass') { const al = sw / (2 * q); b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (kind === 'highpass') { const al = sw / (2 * q); b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (kind === 'bandpass') { const al = sw / (2 * q); b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (kind === 'notch') { const al = sw / (2 * q); b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (kind === 'peaking') { const al = sw / (2 * q); b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
  else if (kind === 'highshelf') { const sa = 2 * Math.sqrt(A) * sw; b0 = A * ((A + 1) + (A - 1) * cw + sa); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - sa); a0 = (A + 1) - (A - 1) * cw + sa; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - sa; }
  else { const sa = 2 * Math.sqrt(A) * sw; b0 = A * ((A + 1) - (A - 1) * cw + sa); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - sa); a0 = (A + 1) + (A - 1) * cw + sa; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - sa; }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

function applyBiquad(buf, coeffs) {
  const [b0, b1, b2, a1, a2] = coeffs;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x0 = buf[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    buf[i] = y0;
  }
}

/* seedNoise — white noise, mulberry32 seeded (byte-deterministic). */
function seedNoise(n, seed) {
  const rng = mulberry32(seed >>> 0);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = rng() * 2 - 1;
  return buf;
}

/* SINE_LUT — 4096-entry sine table; deterministic and ~6× faster than
   Math.sin in the oscillator inner loops (the crash renders 2.9 M periods —
   this is what keeps the first-hit lazy render inside its ms budget). */
const LUT_N = 4096, LUT_MASK = LUT_N - 1;
const SINE_LUT = new Float32Array(LUT_N);
for (let i = 0; i < LUT_N; i++) SINE_LUT[i] = Math.sin(2 * Math.PI * i / LUT_N);
function lutSin(ph) {
  ph -= 2 * Math.PI * (ph / (2 * Math.PI) | 0); /* wrap into [0, 2π) */
  return SINE_LUT[(ph * (LUT_N / (2 * Math.PI))) & LUT_MASK];
}

/* envExp — exponential decay envelope over n samples reaching e-fold τ.
   Multiplicative accumulator — no per-sample pow (render budget). */
function envExp(n, sr, tauSec, attackSec) {
  const e = new Float32Array(n);
  const atk = Math.max(1, Math.round((attackSec || 0) * sr));
  const k = Math.exp(-1 / (tauSec * sr));
  let v = 1;
  for (let i = 0; i < n; i++) {
    if (i >= atk) v *= k;
    e[i] = i < atk ? v * (i / atk) : v;
  }
  return e;
}

/* modalHit — additive modal stack: each mode [ratio, amp, tauSec]. Renders
   sines (a struck membrane/bell's normal modes are near-sinusoidal) with a
   shared strike-bend on the fundamental and per-mode decay. Iterative decay
   accumulator + LUT sine — render budget discipline (crash: 20 partials ×
   144 k samples must stay single-digit ms). */
function modalHit(n, sr, f0, modes, bendRatio, bendSec, atkSec) {
  const out = new Float32Array(n);
  const bendK = Math.exp(-1 / Math.max(1e-4, bendSec) / sr);
  for (const [ratio, amp, tau] of modes) {
    const f = f0 * ratio;
    if (f >= sr * 0.49) continue;
    const k = Math.exp(-1 / (tau * sr));
    const w = 2 * Math.PI * f / sr;
    let ph = 0, bend = bendRatio, dec = 1;
    for (let i = 0; i < n; i++) {
      if (bend > 1) { ph += w * bend; bend += (1 - bend) * (1 - bendK); }
      else ph += w;
      out[i] += amp * lutSin(ph) * dec;
      dec *= k;
    }
  }
  if (atkSec > 0) {
    const atk = Math.round(atkSec * sr);
    for (let i = 0; i < atk && i < n; i++) out[i] *= i / atk;
  }
  return out;
}

/* ────────────────────── TYPE RENDERERS ──────────────────────
   Each returns a Float32Array of SPEC[type].sec × sr samples, peak-safe
   (normalize + levelRms applied by the common pipeline below). */

/* MEASURED circular-membrane mode ladder (conga/bongo/darbuka/timbale shell
   share it with different f0/taus): [ratio, amp, tauSec]. The 1.02 partner
   is the near-degenerate (0,1) pair — the acoustic beating that makes a real
   drum head sound ALIVE instead of a sine beep. */
const MEMBRANE = [
  [1.0, 1.0, 0.30], [1.02, 0.45, 0.26], [1.475, 0.62, 0.20], [2.09, 0.34, 0.15],
  [2.33, 0.18, 0.12], [2.63, 0.22, 0.11], [3.01, 0.13, 0.09], [3.36, 0.10, 0.08],
  [3.76, 0.07, 0.07],
];

function rConga(sr) {
  const n = Math.round(SPEC.conga.sec * sr);
  const seed = seedOf('perc-rom:conga');
  const body = modalHit(n, sr, SPEC.conga.f0, MEMBRANE, 1.045, 0.012, 0.001);
  /* slap — the hand transient: bandpassed noise 1.9 kHz Q 1.1, 14 ms + a
     brighter 3.4 kHz touch (skin slap), both through the per-sample biquad */
  const slap = seedNoise(n, seed ^ 0xC0A1);
  applyBiquad(slap, biquadCoeffs('bandpass', sr, 1900, 1.1));
  const slapEnv = envExp(n, sr, 0.006, 0.0004);
  for (let i = 0; i < n; i++) body[i] += slap[i] * slapEnv[i] * 0.85;
  const snap = seedNoise(n, seed ^ 0x5A7);
  applyBiquad(snap, biquadCoeffs('bandpass', sr, 3400, 1.6));
  const snapEnv = envExp(n, sr, 0.003, 0.0002);
  for (let i = 0; i < n; i++) body[i] += snap[i] * snapEnv[i] * 0.30;
  /* shell resonance — the wooden body at ~1.9×f0, very short */
  const shell = modalHit(n, sr, SPEC.conga.f0 * 1.9, [[1, 0.12, 0.035]], 1, 0.001, 0.0005);
  for (let i = 0; i < n; i++) body[i] += shell[i];
  return body;
}

function rBongo(sr) {
  const n = Math.round(SPEC.bongo.sec * sr);
  const seed = seedOf('perc-rom:bongo');
  const taus = MEMBRANE.map(([r, a, t]) => [r, a, t * 0.72]);
  const body = modalHit(n, sr, SPEC.bongo.f0, taus, 1.06, 0.010, 0.0008);
  /* bongos are SLAPPIER: louder, brighter slap */
  const slap = seedNoise(n, seed ^ 0xB0);
  applyBiquad(slap, biquadCoeffs('bandpass', sr, 2600, 1.0));
  const slapEnv = envExp(n, sr, 0.005, 0.0003);
  for (let i = 0; i < n; i++) body[i] += slap[i] * slapEnv[i] * 1.15;
  return body;
}

function rDarbuka(sr) {
  const n = Math.round(SPEC.darbuka.sec * sr);
  const seed = seedOf('perc-rom:darbuka');
  /* dum — the deep center hit (lower f0, longer fundamental) */
  const dumModes = [[1.0, 1.0, 0.22], [1.02, 0.4, 0.19], [1.475, 0.5, 0.15], [2.09, 0.26, 0.11], [2.63, 0.15, 0.09]];
  const dum = modalHit(n, sr, SPEC.darbuka.f0, dumModes, 1.05, 0.014, 0.001);
  applyBiquad(dum, biquadCoeffs('lowpass', sr, 2600, 0.8));
  /* tek — the fish-skin rim stroke riding on top (metallic band 3.2 kHz) */
  const tek = seedNoise(n, seed ^ 0x7E1);
  applyBiquad(tek, biquadCoeffs('bandpass', sr, 3200, 1.4));
  const tekEnv = envExp(n, sr, 0.004, 0.0002);
  for (let i = 0; i < n; i++) tek[i] = tek[i] * tekEnv[i] * 0.55;
  for (let i = 0; i < n; i++) dum[i] += tek[i];
  return dum;
}

/* CYMBAL stack — dense inharmonic square bank. The 808 cymbal circuit used
   6 squares; a ride/crash reads "real" when the bank is DENSER and each
   partial beats against a detuned partner (real cymbals shimmer because
   hundreds of near-identical modes interfere). We render 10 primary ratios ×
   2 partners (×1.0068, amp .55) = 20 squares, bandpassed + highpassed like
   the circuit, then a noise wash + splash transient. */
const CYM_RATIOS = [1, 1.36, 1.79, 2.26, 2.81, 3.42, 4.09, 4.83, 5.64, 6.51];

function cymbalBank(n, sr, f0, tau, seed) {
  const rng = mulberry32(seed >>> 0);
  const out = new Float32Array(n);
  for (let ri = 0; ri < CYM_RATIOS.length; ri++) {
    for (let p = 0; p < 2; p++) {
      const det = p === 0 ? 1 : 1 + 0.0068 + rng() * 0.004;
      const f = f0 * CYM_RATIOS[ri] * det;
      if (f >= sr * 0.49) continue;
      const amp = (p === 0 ? 1 : 0.55) * (1 / (1 + CYM_RATIOS[ri] * 0.35));
      /* random start phase — seeded, per partial (deterministic) */
      let ph = rng() * (2 * Math.PI);
      const step = 2 * Math.PI * f / sr;
      let dec = 1;
      const kk = Math.exp(-1 / (tau * (1.2 - ri * 0.07) * sr));
      /* squares: sign of the phase directly (no LUT lookup needed) —
         the crash bank is the heaviest render, every multiply counts */
      const PI2 = 2 * Math.PI;
      for (let i = 0; i < n; i++) {
        ph += step; if (ph >= PI2) ph -= PI2;
        out[i] += amp * (ph < Math.PI ? 1 : -1) * dec;
        dec *= kk;
      }
    }
  }
  return out;
}

function rCrash(sr) {
  const n = Math.round(SPEC.crash.sec * sr);
  const seed = seedOf('perc-rom:crash');
  const bank = cymbalBank(n, sr, SPEC.crash.f0, 1.55, seed);
  /* the circuit: BP 8.6 kHz → HP 4.6 kHz (crash corners — v0.15 pinned the
     audible corners; the ROM renders the SAME character but DENSE) */
  applyBiquad(bank, biquadCoeffs('bandpass', sr, 8600, 0.72));
  applyBiquad(bank, biquadCoeffs('highpass', sr, 4600, 0.71));
  /* wash — slow shimmer noise BP 7.2 kHz, 1.6 s */
  const wash = seedNoise(n, seed ^ 0xA11CE);
  applyBiquad(wash, biquadCoeffs('bandpass', sr, 7200, 0.9));
  const washEnv = envExp(n, sr, 0.85, 0.02);
  for (let i = 0; i < n; i++) bank[i] += wash[i] * washEnv[i] * 0.9;
  /* splash — the stick attack, HP noise 12 ms */
  const splash = seedNoise(n, seed ^ 0xA7A5);
  applyBiquad(splash, biquadCoeffs('highpass', sr, 5200, 0.7));
  const splashEnv = envExp(n, sr, 0.006, 0.0002);
  for (let i = 0; i < n; i++) bank[i] += splash[i] * splashEnv[i] * 1.3;
  /* TWO-stage envelope: hold 0.88 for the first 12 %, then decay — the
     shimmer a one-point exp can't hold (the v0.15 recipe, now in PCM) */
  const hold = Math.round(n * 0.12);
  for (let i = hold; i < n; i++) {
    const t = (i - hold) / (n - hold);
    bank[i] *= Math.pow(Math.exp(-4.4), t * t);
  }
  return bank;
}

function rRevcym(sr) {
  const n = Math.round(SPEC.revcym.sec * sr);
  const seed = seedOf('perc-rom:revcym');
  const bank = cymbalBank(n, sr, SPEC.revcym.f0, 9.9, seed); /* near-flat τ: the envelope does the shape */
  applyBiquad(bank, biquadCoeffs('bandpass', sr, 9000, 0.75));
  applyBiquad(bank, biquadCoeffs('highpass', sr, 4200, 0.71));
  const wash = seedNoise(n, seed ^ 0x8E);
  applyBiquad(wash, biquadCoeffs('highpass', sr, 3800, 0.7));
  /* the swell: exponential rise to 0.95 over 92 %, HARD cut at 92 %, then a
     2 ms linear fall to zero (the vacuum the ear wants, click-free) */
  const cut = Math.round(n * 0.92);
  const fall = Math.min(Math.round(0.002 * sr), n - cut);
  for (let i = 0; i < n; i++) {
    let g;
    if (i < cut) g = Math.pow(i / cut, 2.6) * 0.95;
    else if (i < cut + fall) g = 0.95 * (1 - (i - cut) / fall);
    else g = 0;
    bank[i] = (bank[i] * 0.7 + wash[i] * 0.5) * g;
  }
  return bank;
}

function rTriangle(sr) {
  const n = Math.round(SPEC.triangle.sec * sr);
  const seed = seedOf('perc-rom:triangle');
  /* a struck triangle bends slightly SHARP then settles; partials near-
     harmonic with a stretch: n·f0·(1 + 0.0009·n²). Amps 1/n^1.15. The 5.5 kHz
     BEAT pair (2×f0 partner at ×1.012) is the characteristic "ting". */
  const modes = [];
  for (let m = 1; m <= 9; m++) {
    const r = m * (1 + 0.0009 * m * m);
    modes.push([r, 1 / Math.pow(m, 1.15), 1.9 / (0.75 + m * 0.28)]);
  }
  const ring = modalHit(n, sr, SPEC.triangle.f0, modes, 1.008, 0.004, 0.0006);
  const beat = modalHit(n, sr, SPEC.triangle.f0 * 2.012, [[1, 0.4, 1.2], [1.009, 0.35, 1.1]], 1, 0.001, 0.0006);
  for (let i = 0; i < n; i++) ring[i] += beat[i];
  const strike = seedNoise(n, seed ^ 0x31C7);
  applyBiquad(strike, biquadCoeffs('bandpass', sr, 8200, 1.2));
  const strikeEnv = envExp(n, sr, 0.002, 0.0002);
  for (let i = 0; i < n; i++) ring[i] += strike[i] * strikeEnv[i] * 0.5;
  return ring;
}

function rTambourine(sr) {
  const n = Math.round(SPEC.tambourine.sec * sr);
  const seed = seedOf('perc-rom:tambourine');
  /* jingles — two rows of double-rolled pairs: dense 6–11 kHz stack, fast
     beating (the double jingle rows of a real tambourine), then the head
     thump under them (f0 190, short) */
  const jing = new Float32Array(n);
  const rng = mulberry32(seed >>> 0);
  const JR = [1, 1.19, 1.43, 1.71, 2.03, 2.41, 2.87, 3.41, 4.05, 4.83];
  for (let ri = 0; ri < JR.length; ri++) {
    for (let p = 0; p < 2; p++) {
      const f = 6200 * JR[ri] * (p ? 1 + 0.009 + rng() * 0.006 : 1);
      if (f >= sr * 0.49) continue;
      const amp = (p ? 0.7 : 1) / (1 + ri * 0.3);
      let ph = rng() * 2 * Math.PI;
      const step = 2 * Math.PI * f / sr;
      const kk = Math.exp(-1 / (0.05 + ri * 0.012) / sr);
      for (let i = 0; i < n; i++) { jing[i] += amp * Math.sin(ph) * Math.pow(kk, i); ph += step; }
    }
  }
  applyBiquad(jing, biquadCoeffs('highpass', sr, 5600, 0.7));
  const head = modalHit(n, sr, SPEC.tambourine.f0, [[1, 1, 0.09], [1.475, 0.5, 0.06], [2.09, 0.3, 0.05]], 1.05, 0.008, 0.0008);
  applyBiquad(head, biquadCoeffs('lowpass', sr, 1400, 0.8));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = jing[i] * 0.9 + head[i] * 0.55;
  return out;
}

function rShaker(sr) {
  const n = Math.round(SPEC.shaker.sec * sr);
  const seed = seedOf('perc-rom:shaker');
  /* the seed rattle: BP noise with a swept center (6.4 → 4.8 kHz across the
     hit — the beads' mass loading) and a shaped attack (triangular ~9 ms,
     the "chh" of a real shaker is an ATTACK shape, not a click) */
  const s = seedNoise(n, seed);
  /* per-sample swept SVF-ish: two biquad passes with interpolated corners —
     approximate the sweep by crossfading two filtered copies */
  const lo = new Float32Array(s), hi = new Float32Array(s);
  applyBiquad(lo, biquadCoeffs('bandpass', sr, 4800, 0.85));
  applyBiquad(hi, biquadCoeffs('bandpass', sr, 6400, 0.85));
  const atk = Math.round(0.009 * sr);
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const env = i < atk ? i / atk : Math.exp(-(i - atk) / (0.028 * sr));
    const mix = Math.min(1, x * 6);
    s[i] = (hi[i] * (1 - mix) + lo[i] * mix) * env;
  }
  return s;
}

function rAgogo(sr) {
  const n = Math.round(SPEC.agogo.sec * sr);
  const seed = seedOf('perc-rom:agogo');
  /* the double-bell recipe (1 : 1.506) with the small inharmonic tail modes
     and the 6 % strike bend — the dry wooden-metal ring */
  const modes = [[1, 1.0, 0.16], [1.506, 0.72, 0.12], [2.44, 0.24, 0.08], [3.76, 0.10, 0.05]];
  const body = modalHit(n, sr, SPEC.agogo.f0, modes, 1.06, 0.012, 0.0006);
  const click = seedNoise(n, seed ^ 0xA6);
  applyBiquad(click, biquadCoeffs('highpass', sr, 3600, 0.7));
  const clickEnv = envExp(n, sr, 0.0015, 0.0001);
  for (let i = 0; i < n; i++) body[i] += click[i] * clickEnv[i] * 0.35;
  return body;
}

function rTimbale(sr) {
  const n = Math.round(SPEC.timbale.sec * sr);
  const seed = seedOf('perc-rom:timbale');
  /* metal-shell drum: near-membrane ladder at 840 + the shell modes, plus
     the rim-shot crack band 2.6 kHz */
  const modes = [[1, 1.0, 0.14], [1.68, 0.5, 0.09], [2.47, 0.24, 0.07], [3.51, 0.12, 0.05]];
  const body = modalHit(n, sr, SPEC.timbale.f0, modes, 1.18, 0.022, 0.0008);
  const crack = seedNoise(n, seed ^ 0x8CA);
  applyBiquad(crack, biquadCoeffs('bandpass', sr, 2600, 1.4));
  const crackEnv = envExp(n, sr, 0.003, 0.0002);
  for (let i = 0; i < n; i++) body[i] += crack[i] * crackEnv[i] * 0.9;
  return body;
}

function rCowbell(sr) {
  const n = Math.round(SPEC.cowbell.sec * sr);
  const seed = fnv1a('perc-rom:cowbell');
  /* THE 808 recipe, finally RENDERED properly: two squares 560:845 Hz (the
     classic non-integer pair), BAND-PASSED at 1.9 kHz Q 1.1 — the old synth
     path had NO filter (raw squares = the harshness the owner kept hitting),
     and a real two-stage env: 70 ms sustain-ish then ~150 ms fall */
  const f1 = SPEC.cowbell.f0, f2 = 845;
  const s1 = new Float32Array(n), s2 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    s1[i] = Math.sign(Math.sin(2 * Math.PI * f1 * t)) * 0.8;
    s2[i] = Math.sign(Math.sin(2 * Math.PI * f2 * t + 0.7)) * 0.8;
  }
  for (let i = 0; i < n; i++) s1[i] += s2[i];
  applyBiquad(s1, biquadCoeffs('bandpass', sr, 1900, 1.1));
  const hold = Math.round(0.045 * sr);
  for (let i = hold; i < n; i++) {
    const t = (i - hold) / (n - hold);
    s1[i] *= Math.pow(Math.exp(-5.2), t);
  }
  const atk = Math.round(0.0012 * sr);
  for (let i = 0; i < atk && i < n; i++) s1[i] *= i / atk;
  void seed;
  return s1;
}

function rClave(sr) {
  const n = Math.round(SPEC.clave.sec * sr);
  /* wooden claves: two modes 1 : 2.63 (the measured clave ratio), extremely
     fast decay + a tiny contact click */
  const modes = [[1, 1.0, 0.028], [2.63, 0.55, 0.016]];
  const body = modalHit(n, sr, SPEC.clave.f0, modes, 1.04, 0.002, 0.0003);
  const click = seedNoise(n, seedOf('perc-rom:clave') ^ 0xC1);
  applyBiquad(click, biquadCoeffs('bandpass', sr, 4200, 1.5));
  const clickEnv = envExp(n, sr, 0.0008, 0.0001);
  for (let i = 0; i < n; i++) body[i] += click[i] * clickEnv[i] * 0.4;
  return body;
}

function rRim(sr) {
  const n = Math.round(SPEC.rim.sec * sr);
  const seed = seedOf('perc-rom:rim');
  /* stick on the rim: wood modes + wire buzz, all inside 45 ms */
  const modes = [[1, 1.0, 0.022], [2.87, 0.6, 0.014], [4.13, 0.35, 0.009]];
  const body = modalHit(n, sr, SPEC.rim.f0, modes, 1.12, 0.003, 0.0002);
  const buzz = seedNoise(n, seed ^ 0xB2);
  applyBiquad(buzz, biquadCoeffs('highpass', sr, 3000, 0.7));
  const buzzEnv = envExp(n, sr, 0.0015, 0.0001);
  for (let i = 0; i < n; i++) body[i] += buzz[i] * buzzEnv[i] * 0.5;
  return body;
}

const RENDERERS = {
  conga: rConga, bongo: rBongo, darbuka: rDarbuka,
  crash: rCrash, revcym: rRevcym, triangle: rTriangle,
  tambourine: rTambourine, shaker: rShaker,
  agogo: rAgogo, timbale: rTimbale, cowbell: rCowbell,
  clave: rClave, rim: rRim,
};

/* ────────────────────────── COMMON PIPELINE ────────────────────────── */

function levelRms(buf, target) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / Math.max(1, buf.length));
  if (!(rms > 0)) return 0;
  const g = target / rms;
  let peak = 0;
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i] * g); if (a > peak) peak = a; }
  /* peak guard: crestful voices (crash) may exceed 0.97 after RMS leveling —
     scale down (keeps the headroom law; loudness drops a hair, honest) */
  const clipG = peak > 0.97 ? 0.97 / peak : 1;
  const G = g * clipG;
  for (let i = 0; i < buf.length; i++) buf[i] *= G;
  return rms;
}

/* renderRomPcm — THE export. (type, sampleRate) → Float32Array, byte-
   deterministic. Throws on unknown type (the engine never calls it for
   non-ROM types; the fallback path is the legacy synth). */
export function renderRomPcm(type, sampleRate) {
  const r = RENDERERS[type];
  if (!r) throw new Error('perc-rom: unknown type ' + type);
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new Error('perc-rom: bad sampleRate ' + sampleRate);
  }
  const buf = r(sampleRate);
  /* micro-fade the last 3 ms — buffer-source reuse may cut the tail at the
     busyUntil window; a click-free landing is part of the spec */
  const fade = Math.min(Math.round(0.003 * sampleRate), buf.length);
  for (let i = 0; i < fade; i++) buf[buf.length - 1 - i] *= i / fade;
  levelRms(buf, SPEC[type].rms);
  return buf;
}

/* romDuration — buffer seconds for the engine's cache/metadata. */
export function romDuration(type, sampleRate) { return SPEC[type].sec; }

/* warmList — the factory kit's ROM types, in mixer-order of appearance. */
export const WARM_ORDER = ['conga', 'shaker', 'crash', 'bongo', 'clave', 'rim', 'agogo', 'timbale', 'cowbell', 'triangle', 'tambourine', 'darbuka', 'revcym'];
