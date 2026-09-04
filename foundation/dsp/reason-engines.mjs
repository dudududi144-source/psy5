// foundation/dsp/reason-engines.mjs — REASON ENGINE PORT (RUN23-1a, PSY6 v0.24.0)
// Ported from psyreason devices/redrum engines, PSY6 v0.24.0.
//
// PROVENANCE: the REAL multi-engine drum DSP of the sibling project psyreason
// (devices/redrum kick/snare/hat/cymbal engines + filters + the ACB Chamberlin
// SVF + the voice-bank machinery), ported into PSY6 as one pure offline module.
// psyreason's superiority over the pooled DrumVoice synth is REAL DSP: a click
// generator, a punch oscillator, resonant biquads in the signal path, ring-mod
// metallic generators, DOUBLE tanh saturation and N× oversampling with
// decimation — none of which a ≤2-osc + noise per-hit voice can afford.
//
// COHESION LAW (why one module):
//   1. Same purity contract as perc-rom.mjs: no DOM, no AudioContext, no
//      wall-clock, no Math.random — same (type, patch, sampleRate, variant,
//      layer) ⇒ byte-identical Float32Array, forever.
//   2. js/engine.js may ONLY enter through renderReasonPcm(type, patch, sr,
//      variant, layer). The raw render fns + patch mappers are for tests and
//      future tools — never for the per-hit path.
//   3. Patches are plain data (shape documented on each patchTo* mapper);
//      mappers fill psyreason-grade defaults and never mutate the patch.
//   4. WINDOW LAW: REASON_DUR[type] ≤ drumDurEst(type,1)·1.15+0.02 for every
//      type (js/engine.js reuse boundary — a pooled steal can never cut an
//      audible tail). Same law perc-rom.mjs obeys.
//   5. BANK MACHINERY (ported from voice-bank.ts): variant salts the noise
//      seed by +variant·7919; velocity layers {0,1,2} carry gain
//      [0.4, 0.7, 1.0] AND drive += layer·1.5 dB (LAYER_DRIVE_DB — layers
//      differ in TIMBRE, not only loudness). Variant is a documented no-op
//      for the noise-free engines (cymbal/tom — the sources have no noise
//      generator to re-seed).
//
// Port fidelity notes:
//   · The xorshift noise (s^=s<<13; s^=s>>>17; s^=s<<5) is inlined EXACTLY as
//     in the sources. Like psyreason's acb.ts "audit M2" convention, the seed
//     argument is optional and defaults to the original hardcoded state, so a
//     seedless call reproduces the source engine byte-for-byte.
//   · The saturation is the double Math.tanh(sig·drive) → Math.tanh(sig)
//     stage from the engines; oversampled rendering + box-average decimation
//     is the sources' own anti-aliasing (kept, not "improved").
//   · Deviations (each documented inline): the clap is an OFFLINE composition
//     of psyreason's realtime 3-tap buildClap concept (voice-synth.ts: taps
//     0/12/24 ms, BP ~1150/1500/950 Hz, decays 55/70/90 ms, peak scales
//     .8/.6/.5) plus a palm tail; the tom is the snare-engine tone path minus
//     noise; cymbal decay defaults are adapted to the psy5 window law.

import { fnv1a } from '../foundation.mjs';

/* ─────────────────── FILTERS (ported from devices/redrum/filters.ts) ──────
   Real sample-by-sample resonant filters instead of WebAudio BiquadFilterNode.
   Ported verbatim (TS → JS): same coefficient math, same state updates. */

export class OnePoleHP {
  constructor(sampleRate, cutoffHz) {
    this.sr = sampleRate;
    this.z = 0;
    this.prevX = 0;
    this.setCutoff(cutoffHz);
  }
  setCutoff(hz) {
    this.a = hz / (hz + this.sr / (2 * Math.PI));
  }
  process(x) {
    this.z = this.a * (this.z + x - this.prevX);
    this.prevX = x;
    return this.z;
  }
  reset() { this.z = 0; this.prevX = 0; }
}

export const BiquadType = { LP: 'lowpass', HP: 'highpass', BP: 'bandpass' };

export class BiquadFilter {
  constructor(sampleRate, type, freqHz, Q = Math.SQRT1_2) {
    this.sr = sampleRate;
    this.z1 = 0; this.z2 = 0;
    this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
    this.setParams(type, freqHz, Q);
  }

  setParams(type, freqHz, Q = Math.SQRT1_2) {
    const w0 = (2 * Math.PI * freqHz) / this.sr;
    const cosw = Math.cos(w0);
    const sinw = Math.sin(w0);
    const alpha = sinw / (2 * Q);
    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
    if (type === 'lowpass') {
      b0 = (1 - cosw) / 2; b1 = 1 - cosw; b2 = (1 - cosw) / 2;
      a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha;
    } else if (type === 'highpass') {
      b0 = (1 + cosw) / 2; b1 = -(1 + cosw); b2 = (1 + cosw) / 2;
      a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha;
    } else { // bandpass
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
  }

  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  reset() { this.z1 = 0; this.z2 = 0; }
}

/* ─────────────── Chamberlin SVF (ported from devices/redrum/acb.ts) ───────
   Analog Circuit Behavior modeling: the two integrator state variables (low,
   band) model the energy-storage elements of the classic analog drum-machine
   resonant low-pass circuits. Ported verbatim (incl. the Nyquist guard and
   the resonance→damping mapping). Not used by the redrum render loops (they
   ride the BiquadFilter/OnePoleHP above, exactly like the sources) — it is
   the foundation for future ACB-modeled voices. */
export class SVF {
  constructor(sampleRate, cutoffHz, resonance) {
    this.low = 0;
    this.band = 0;
    this.setCutoff(sampleRate, cutoffHz);
    this.setResonance(resonance);
  }
  // Update the frequency coefficient. cutoffHz is the -3dB point.
  setCutoff(sampleRate, cutoffHz) {
    const fc = Math.min(cutoffHz, sampleRate * 0.45); // Nyquist guard
    this.f = 2 * Math.sin(Math.PI * fc / sampleRate);
  }
  // Map resonance (0..1) to damping factor q:
  //   0 → q ~ 2.0 (overdamped) ... 1 → q ~ 0.1 (near self-oscillation).
  setResonance(resonance) {
    const r = Math.max(0, Math.min(1, resonance));
    this.q = 0.1 + 1.9 * (1 - r);
  }
  // Process one sample; returns the four classic SVF outputs.
  process(input) {
    this.low += this.f * this.band;
    const high = input - this.low - this.q * this.band;
    this.band += this.f * high;
    const notch = high + this.low;
    return { low: this.low, high, band: this.band, notch };
  }
  reset() { this.low = 0; this.band = 0; }
}

/* ────────────────────────────── shared helpers ─────────────────────────── */

function sq(ph) { return ph < 0.5 ? 1 : -1; } // the engines' square()

/* decimate — the sources' oversampled box-average decimation. */
function decimate(out, os) {
  if (os > 1) {
    const outLen = Math.floor(out.length / os);
    const ds = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      let sum = 0;
      for (let j = 0; j < os; j++) sum += out[i * os + j];
      ds[i] = sum / os;
    }
    return ds;
  }
  return out;
}

/* ─────────────────── KICK (port of devices/redrum/kick-engine.ts) ─────────
   1. CLICK — noise burst through a real high-pass (the transient 'tick')
   2. BODY  — sine with exponential pitch drop (the 'boom')
   3. PUNCH — higher-frequency oscillator, fast decay (the 'knock')
   4. RESONANT biquad low-pass IN the signal path
   5. DOUBLE tanh saturation
   6. OVERSAMPLING (render at N·sr, box-average decimate)
   seed: optional noise seed (undefined → the source's 0x12345678 state). */
export function renderReasonKick(p, seed) {
  const os = Math.max(1, Math.floor(p.oversample));
  const sr = p.sampleRate * os;
  const n = Math.max(1, Math.floor(sr * p.durationSec));
  const out = new Float32Array(n);

  const clickHp = new OnePoleHP(sr, p.clickHpHz);
  const bodyLp = new BiquadFilter(sr, 'lowpass', p.filterCutoffHz, p.filterQ);

  let bodyPhase = 0;
  let punchPhase = 0;
  let noiseState = (seed === undefined ? 0x12345678 : seed) >>> 0;
  const clickLen = Math.max(1, Math.floor(sr * (p.clickMs / 1000)));
  const drive = Math.pow(10, Math.max(0, p.driveDb) / 20);
  const punchDecay = Math.max(0.001, p.punchDecayMs / 1000);
  const bodyPitchDecay = Math.max(0.001, p.bodyPitchDecayMs / 1000);
  const bodyDecay = Math.max(0.05, p.bodyDecayMs / 1000);

  for (let i = 0; i < n; i++) {
    const t = i / sr;

    // body: exponential pitch drop
    const k = Math.exp(-t / bodyPitchDecay);
    const bodyHz = p.bodyEndHz + (p.bodyStartHz - p.bodyEndHz) * k;

    bodyPhase += bodyHz / sr;
    if (bodyPhase >= 1) bodyPhase -= Math.floor(bodyPhase);
    const body = Math.sin(2 * Math.PI * bodyPhase);

    // punch: higher-freq oscillator, fast decay (FM-style reinforcement)
    const punchHz = bodyHz * p.punchRatio;
    const punchEnv = Math.exp(-t / punchDecay);
    punchPhase += punchHz / sr;
    if (punchPhase >= 1) punchPhase -= Math.floor(punchPhase);
    const punch = Math.sin(2 * Math.PI * punchPhase) * punchEnv * p.punchAmount;

    // click: high-passed noise burst, first clickMs only
    let click = 0;
    if (i < clickLen) {
      noiseState ^= noiseState << 13;
      noiseState ^= noiseState >>> 17;
      noiseState ^= noiseState << 5;
      const noise = ((noiseState >>> 0) / 4294967296) * 2 - 1;
      click = clickHp.process(noise) * p.clickAmount * (1 - i / clickLen);
    }

    let sig = body + punch + click;

    // resonant low-pass IN the path (real biquad)
    sig = bodyLp.process(sig);

    // envelope: fast attack, exponential decay
    const attack = Math.min(1, t / 0.0015);
    const bodyEnv = Math.exp(-t / Math.max(0.05, bodyDecay));
    sig *= attack * bodyEnv;

    // multi-stage saturation
    sig = Math.tanh(sig * drive);
    sig = Math.tanh(sig);

    out[i] = sig;
  }

  return decimate(out, os);
}

/* ─────────────────── SNARE (port of devices/redrum/snare-engine.ts) ───────
   1. TONE  — sine body with fast pitch drop (the shell 'crack') through a
              resonant biquad low-pass
   2. NOISE — band-passed seeded noise (the snare wires) through a real biquad
   3. DOUBLE tanh saturation + oversampling
   seed: optional noise seed (undefined → the source's 0x9e3779b9 state). */
export function renderReasonSnare(p, seed) {
  const os = Math.max(1, Math.floor(p.oversample));
  const sr = p.sampleRate * os;
  const n = Math.max(1, Math.floor(sr * p.durationSec));
  const out = new Float32Array(n);

  const noiseBp = new BiquadFilter(sr, 'bandpass', p.noiseBpHz, p.noiseQ);
  const toneLp = new BiquadFilter(sr, 'lowpass', Math.max(200, p.toneHz * 3), 0.9);

  let tonePhase = 0;
  let noiseState = (seed === undefined ? 0x9e3779b9 : seed) >>> 0;
  const drive = Math.pow(10, Math.max(0, p.driveDb) / 20);
  const tonePitchDecay = Math.max(0.001, p.tonePitchDecayMs / 1000);
  const toneDecay = Math.max(0.01, p.toneDecayMs / 1000);
  const noiseDecay = Math.max(0.01, p.noiseDecayMs / 1000);

  for (let i = 0; i < n; i++) {
    const t = i / sr;

    // tone body: fast pitch drop (the shell 'crack')
    const k = Math.exp(-t / tonePitchDecay);
    const toneHz = (p.toneHz - p.tonePitchDropHz) + p.tonePitchDropHz * k;
    tonePhase += toneHz / sr;
    if (tonePhase >= 1) tonePhase -= Math.floor(tonePhase);
    const toneEnv = Math.exp(-t / toneDecay);
    const tone = Math.sin(2 * Math.PI * tonePhase) * toneEnv * p.toneAmount;
    const toneFilt = toneLp.process(tone);

    // noise: band-passed seeded noise (the snare wires)
    noiseState ^= noiseState << 13;
    noiseState ^= noiseState >>> 17;
    noiseState ^= noiseState << 5;
    const noise = ((noiseState >>> 0) / 4294967296) * 2 - 1;
    const noiseEnv = Math.exp(-t / noiseDecay);
    const noiseFilt = noiseBp.process(noise) * noiseEnv * p.noiseAmount;

    // combine tone + noise
    let sig = toneFilt + noiseFilt;

    // attack envelope
    const attack = Math.min(1, t / 0.001);
    sig *= attack;

    // multi-stage saturation
    sig = Math.tanh(sig * drive);
    sig = Math.tanh(sig);

    out[i] = sig;
  }

  return decimate(out, os);
}

/* ─────────────────── HAT (port of devices/redrum/hat-engine.ts) ───────────
   Real hats are METALLIC: ring-modulation of two square oscillators
   (the classic 808-style metallic generator) through a real biquad high-pass,
   plus a little high-passed noise for splash texture. Closed = fast decay,
   open = long decay (decayMs; the open flag rides the params exactly like
   the source). seed: optional (undefined → the source's 0x243f6a88 state). */
export function renderReasonHat(p, seed) {
  const os = Math.max(1, Math.floor(p.oversample));
  const sr = p.sampleRate * os;
  const n = Math.max(1, Math.floor(sr * p.durationSec));
  const out = new Float32Array(n);

  const hp = new BiquadFilter(sr, 'highpass', p.hpHz, p.hpQ);
  const noiseHp = new BiquadFilter(sr, 'highpass', p.noiseHpHz, 0.8);

  let ph1 = 0;
  let ph2 = 0;
  let noiseState = (seed === undefined ? 0x243f6a88 : seed) >>> 0;
  const drive = Math.pow(10, Math.max(0, p.driveDb) / 20);
  const decay = Math.max(0.005, p.decayMs / 1000);
  const metalHz2 = p.metalHz * p.ringRatio;

  for (let i = 0; i < n; i++) {
    const t = i / sr;

    // metallic: ring-mod of two square oscillators (inharmonic), softened by
    // the noise blend so raw square harmonics don't dominate (chiptune guard)
    ph1 += p.metalHz / sr;
    if (ph1 >= 1) ph1 -= Math.floor(ph1);
    ph2 += metalHz2 / sr;
    if (ph2 >= 1) ph2 -= Math.floor(ph2);
    const metal = (sq(ph1) * sq(ph2)) * p.metalAmount * 0.6;

    // noise texture
    noiseState ^= noiseState << 13;
    noiseState ^= noiseState >>> 17;
    noiseState ^= noiseState << 5;
    const noise = ((noiseState >>> 0) / 4294967296) * 2 - 1;
    const noiseTex = noiseHp.process(noise) * p.noiseAmount;

    // combine + final high-pass
    let sig = hp.process(metal + noiseTex);

    // envelope: closed = fast decay, open = long decay
    const env = Math.exp(-t / decay);
    const attack = Math.min(1, t / 0.0008);
    sig *= env * attack;

    // saturation
    sig = Math.tanh(sig * drive);
    sig = Math.tanh(sig);

    out[i] = sig;
  }

  return decimate(out, os);
}

/* ─────────────── CYMBAL (port of devices/redrum/cymbal-engine.ts) ─────────
   Like the hat: ring-mod of two squares through a high-pass, but LOWER and
   LONGER. pingHz > 0 (and pingAmount > 0) adds the sine 'ping' → a ride;
   pingHz 0 → crash. NO noise source in the source engine → the seed is
   accepted for signature uniformity and is a documented no-op. */
export function renderReasonCymbal(p, seed) {
  void seed;
  const os = Math.max(1, Math.floor(p.oversample));
  const sr = p.sampleRate * os;
  const n = Math.max(1, Math.floor(sr * p.durationSec));
  const out = new Float32Array(n);

  const hp = new BiquadFilter(sr, 'highpass', p.hpHz, p.hpQ);

  let ph1 = 0;
  let ph2 = 0;
  let pingPhase = 0;
  const drive = Math.pow(10, Math.max(0, p.driveDb) / 20);
  const decay = Math.max(0.01, p.decayMs / 1000);
  const metalHz2 = p.metalHz * p.ringRatio;

  for (let i = 0; i < n; i++) {
    const t = i / sr;

    // metallic: ring-mod of two square oscillators
    ph1 += p.metalHz / sr;
    if (ph1 >= 1) ph1 -= Math.floor(ph1);
    ph2 += metalHz2 / sr;
    if (ph2 >= 1) ph2 -= Math.floor(ph2);
    let metal = sq(ph1) * sq(ph2) * p.metalAmount;

    // ping tone (ride)
    if (p.pingHz > 0 && p.pingAmount > 0) {
      pingPhase += p.pingHz / sr;
      if (pingPhase >= 1) pingPhase -= Math.floor(pingPhase);
      const ping = Math.sin(2 * Math.PI * pingPhase);
      metal += ping * p.pingAmount;
    }

    // high-pass + envelope
    let sig = hp.process(metal);
    const env = Math.exp(-t / decay);
    const attack = Math.min(1, t / 0.001);
    sig *= env * attack;

    // saturation
    sig = Math.tanh(sig * drive);
    sig = Math.tanh(sig);

    out[i] = sig;
  }

  return decimate(out, os);
}

/* ─────────────────────────────── CLAP (offline) ───────────────────────────
   psyreason renders the clap in realtime (voice-synth.ts buildClap: three
   noise bursts through band-passes — BP ~1150/1500/950 Hz at 0/12/24 ms,
   decays 55/70/90 ms, peak scales .8/.6/.5 — plus per-burst env gains). This
   is the OFFLINE composition of the same concept, engine-grade: each burst
   is its own seeded xorshift noise stream through its own bandpass biquad,
   written into the buffer at its tapMs offset with its own decay; one longer
   band-passed tail burst (the palm) rings under them; the summed bus then
   rides the same double-tanh drive stage the other engines carry. */
function clapBurst(out, n, sr, bpHz, startSamp, decaySec, gain, seed, q) {
  const start = Math.max(0, Math.min(n - 1, Math.floor(startSamp)));
  const len = n - start;
  if (len <= 0) return;
  const bp = new BiquadFilter(sr, 'bandpass', bpHz, q);
  let s = seed >>> 0;
  const k = Math.exp(-1 / (Math.max(0.005, decaySec) * sr));
  const atk = Math.max(1, Math.round(0.001 * sr));
  let dec = 1;
  for (let i = 0; i < len; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const noise = ((s >>> 0) / 4294967296) * 2 - 1;
    const y = bp.process(noise);
    if (i >= atk) dec *= k;
    const env = i < atk ? i / atk : dec;
    out[start + i] += y * env * gain;
  }
}

export function renderReasonClap(p, seed) {
  const os = Math.max(1, Math.floor(p.oversample));
  const sr = p.sampleRate * os;
  const n = Math.max(1, Math.floor(sr * p.durationSec));
  const out = new Float32Array(n);

  const drive = Math.pow(10, Math.max(0, p.driveDb) / 20);
  const bpQ = p.bpQ || 1.0;
  const tapGains = p.tapGains || [0.8, 0.6, 0.5];
  const base = (seed === undefined ? 0x51a91e5 : seed) >>> 0;
  for (let b = 0; b < 3; b++) {
    clapBurst(out, n, sr, p.taps[b], (p.tapMs[b] / 1000) * sr, p.bursts[b] / 1000, tapGains[b],
      (base ^ Math.imul(0x9E3779B9, b + 1)) >>> 0, bpQ);
  }
  // the palm: one longer burst landing just after the last finger tap
  clapBurst(out, n, sr, p.taps[0], (p.tailMs / 1000) * sr, p.tailDecayMs / 1000, p.tailAmount,
    (base ^ Math.imul(0x9E3779B9, 4)) >>> 0, bpQ);

  // the bus drive stage (same double tanh as the other engines)
  for (let i = 0; i < n; i++) {
    out[i] = Math.tanh(out[i] * drive);
    out[i] = Math.tanh(out[i]);
  }

  return decimate(out, os);
}

/* ─────────────────────────────── TOM (offline) ────────────────────────────
   The snare-engine's TONE path minus noise: a body sine with a fast pitch
   drop through a RESONANT biquad low-pass (the drumhead 'thud'), no punch,
   no click, no noise. seed is accepted for signature uniformity and is a
   documented no-op (the tom carries no noise source). */
export function renderReasonTom(p, seed) {
  void seed;
  const os = Math.max(1, Math.floor(p.oversample));
  const sr = p.sampleRate * os;
  const n = Math.max(1, Math.floor(sr * p.durationSec));
  const out = new Float32Array(n);

  const toneLp = new BiquadFilter(sr, 'lowpass', p.filterCutoffHz, p.filterQ);

  let tonePhase = 0;
  const drive = Math.pow(10, Math.max(0, p.driveDb) / 20);
  const tonePitchDecay = Math.max(0.001, p.tonePitchDecayMs / 1000);
  const toneDecay = Math.max(0.01, p.toneDecayMs / 1000);

  for (let i = 0; i < n; i++) {
    const t = i / sr;

    // tone body: fast pitch drop (the snare-engine formula, minus noise)
    const k = Math.exp(-t / tonePitchDecay);
    const toneHz = (p.toneHz - p.tonePitchDropHz) + p.tonePitchDropHz * k;
    tonePhase += toneHz / sr;
    if (tonePhase >= 1) tonePhase -= Math.floor(tonePhase);
    const toneEnv = Math.exp(-t / toneDecay);
    const tone = Math.sin(2 * Math.PI * tonePhase) * toneEnv * p.toneAmount;

    // resonant low-pass IN the path
    let sig = toneLp.process(tone);

    // attack envelope (the snare-engine attack)
    const attack = Math.min(1, t / 0.001);
    sig *= attack;

    // multi-stage saturation
    sig = Math.tanh(sig * drive);
    sig = Math.tanh(sig);

    out[i] = sig;
  }

  return decimate(out, os);
}

/* ──────────────────────────── PATCH MAPPERS ───────────────────────────────
   Like psyreason's kit-to-engine.ts kickParamsFromPatch family: map a plain
   patch object onto engine params, filling psyreason-grade defaults the patch
   doesn't carry. Mappers NEVER mutate the patch. d = {sampleRate, durationSec}. */

const num = (v, fb) => (typeof v === 'number' && isFinite(v)) ? v : fb;

/* psy5 kit language: filter.res ∈ 1..10 → biquad Q = 0.5 + 0.45·res
   (res 1 → 0.95 gentle, res 2 → 1.4 ≈ psyreason's 1.2 default, res 10 → 5.0
   near-self-oscillation). */
function resToQ(res, fb) {
  const r = Math.max(1, Math.min(10, num(res, fb)));
  return 0.5 + 0.45 * r;
}

/* kick patch: {body:{startHz,endHz,pitchDecayMs,bodyDecayMs},
                punch:{ratio,amount,decayMs}, click:{amount,ms,hpHz},
                filter:{cutoff,res}, driveDb} (defaults = kit-to-engine.ts) */
export function patchToKick(patch, d) {
  const p = patch || {};
  const body = p.body || {}, punch = p.punch || {}, click = p.click || {}, filter = p.filter || {};
  return {
    sampleRate: d.sampleRate,
    durationSec: d.durationSec,
    oversample: 4,
    bodyStartHz: num(body.startHz, 160),
    bodyEndHz: num(body.endHz, 48),
    bodyPitchDecayMs: num(body.pitchDecayMs, 45),
    bodyDecayMs: num(body.bodyDecayMs, 120),
    punchRatio: num(punch.ratio, 3),
    punchAmount: num(punch.amount, 0.5),
    punchDecayMs: num(punch.decayMs, 12),
    clickAmount: num(click.amount, 0.4),
    clickMs: num(click.ms, 2),
    clickHpHz: num(click.hpHz, 4000),
    filterCutoffHz: num(filter.cutoff, 300),
    filterQ: resToQ(filter.res, 2),
    driveDb: num(p.driveDb, 4),
  };
}

/* snare patch: {body:{startHz,endHz,pitchDecayMs}, tone:{amount,decayMs},
                 noise:{bpHz,q,amount,decayMs}, driveDb} (defaults =
                 kit-to-engine.ts snareParamsFromPatch: drop 40 Hz / 20 ms) */
export function patchToSnare(patch, d) {
  const p = patch || {};
  const body = p.body || {}, tone = p.tone || {}, noise = p.noise || {};
  const startHz = num(body.startHz, 195);
  const hasEnd = typeof body.endHz === 'number' && isFinite(body.endHz);
  return {
    sampleRate: d.sampleRate,
    durationSec: d.durationSec,
    oversample: 4,
    toneHz: startHz,
    tonePitchDropHz: hasEnd ? Math.max(0, startHz - body.endHz) : 40,
    tonePitchDecayMs: num(body.pitchDecayMs, 20),
    toneAmount: num(tone.amount, 0.5),
    toneDecayMs: num(tone.decayMs, 90),
    noiseBpHz: num(noise.bpHz, 1850),
    noiseQ: num(noise.q, 1.0),
    noiseAmount: num(noise.amount, 0.7),
    noiseDecayMs: num(noise.decayMs, 130),
    driveDb: num(p.driveDb, 2),
  };
}

/* hat patch: {metal:{hz,ratio,amount}, noise:{amount,hpHz}, hp:{hz,q},
               decayMs, driveDb} (defaults = kit-to-engine.ts
               hatParamsFromPatch; closed/open decay 45/330 ms) */
export function patchToHat(patch, d, open) {
  const p = patch || {};
  const metal = p.metal || {}, noise = p.noise || {}, hp = p.hp || {};
  return {
    sampleRate: d.sampleRate,
    durationSec: d.durationSec,
    oversample: 2,
    open: !!open,
    metalHz: num(metal.hz, 5500),
    ringRatio: num(metal.ratio, 1.34),
    metalAmount: num(metal.amount, 0.6),
    noiseAmount: num(noise.amount, 0.5),
    noiseHpHz: num(noise.hpHz, 7000),
    hpHz: num(hp.hz, 7500),
    hpQ: num(hp.q, 0.7),
    decayMs: num(p.decayMs, open ? 330 : 45),
    driveDb: num(p.driveDb, 1),
  };
}

/* cymbal patch: {metal:{hz,ratio,amount}, ping:{hz,amount}, hp:{hz,q},
                  decayMs, driveDb}. ride=true fills the ride defaults
                  (ping 5200 Hz), ride=false the crash defaults (no ping) —
                  mirrors kit-to-engine.ts cymbalParamsFromPatch(p, d, ride).
                  DEVIATIONS (documented): (1) psyreason's decay defaults are
                  700 ms (crash) / 520 ms (ride); psy5's window law gives a
                  crash a 3.4 s buffer, so the crash default is 1200 ms — and
                  the ride buffer is only 0.58 s (drumDurEst has NO 'ride'
                  case → the .5 s default → window .595), so the ride default
                  is 280 ms so the tail lands inside the reuse window (a
                  patch decayMs always wins). */
export function patchToCymbal(patch, d, ride) {
  const p = patch || {};
  const metal = p.metal || {}, ping = p.ping || {}, hp = p.hp || {};
  return {
    sampleRate: d.sampleRate,
    durationSec: d.durationSec,
    oversample: 2,
    metalHz: num(metal.hz, ride ? 4500 : 3800),
    ringRatio: num(metal.ratio, 1.41),
    metalAmount: num(metal.amount, 0.6),
    pingHz: num(ping.hz, ride ? 5200 : 0),
    pingAmount: num(ping.amount, ride ? 0.5 : 0),
    hpHz: num(hp.hz, ride ? 6000 : 5000),
    hpQ: num(hp.q, 0.7),
    decayMs: num(p.decayMs, ride ? 280 : 1200),
    driveDb: num(p.driveDb, 1),
  };
}

function num3(arr, fb) {
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) out[i] = num(arr && arr[i], fb[i]);
  return out;
}

/* clap patch: {taps:[bpHz×3], tapMs:[3 offsets ms], bursts:[decayMs×3],
                tail:{decayMs,amount}, driveDb} (defaults = voice-synth.ts
                buildClap: BP 1150/1500/950 at 0/12/24 ms, decays 55/70/90;
                tapGains are the ported peak scales .8/.6/.5; the palm tail
                lands 6 ms after the last tap on the first tap's band) */
export function patchToClap(patch, d) {
  const p = patch || {};
  const tail = p.tail || {};
  const taps = num3(p.taps, [1150, 1500, 950]);
  const tapMs = num3(p.tapMs, [0, 12, 24]);
  const bursts = num3(p.bursts, [55, 70, 90]);
  return {
    sampleRate: d.sampleRate,
    durationSec: d.durationSec,
    oversample: 2,
    taps,
    tapMs,
    bursts,
    tapGains: [0.8, 0.6, 0.5],
    bpQ: 1.0,
    tailMs: tapMs[2] + 6,
    tailDecayMs: num(tail.decayMs, 200),
    tailAmount: num(tail.amount, 0.5),
    driveDb: num(p.driveDb, 2),
  };
}

/* tom patch: {body:{startHz,endHz,pitchDecayMs}, tone:{amount,decayMs},
               filter:{cutoff,res}, driveDb} (tone defaults follow
               voice-synth.ts buildTom: 215 Hz, 230 ms decay; the pitch
               drops 40 % of startHz by default) */
export function patchToTom(patch, d) {
  const p = patch || {};
  const body = p.body || {}, tone = p.tone || {}, filter = p.filter || {};
  const startHz = num(body.startHz, 215);
  const endHz = num(body.endHz, startHz * 0.6);
  return {
    sampleRate: d.sampleRate,
    durationSec: d.durationSec,
    oversample: 4,
    toneHz: startHz,
    tonePitchDropHz: Math.max(0, startHz - endHz),
    tonePitchDecayMs: num(body.pitchDecayMs, 55),
    toneAmount: num(tone.amount, 1.0),
    toneDecayMs: num(tone.decayMs, 230),
    filterCutoffHz: num(filter.cutoff, Math.max(200, startHz * 3)),
    filterQ: resToQ(filter.res, 2),
    driveDb: num(p.driveDb, 0),
  };
}

/* ───────────────────────────── TYPE TABLES ────────────────────────────────
   psy5 type names. hatO/hatC map to the hat engine's open/closed. */

export const REASON_TYPES = new Set(['kick', 'snare', 'clap', 'hatO', 'hatC', 'tom', 'crash', 'ride']);

/* Buffer seconds per type. Each satisfies ≤ drumDurEst(type,1)·1.15+0.02
   (js/engine.js drumDurEst — the SAME reuse-window law perc-rom.mjs obeys):
     kick  .12+.50=.62 → ≤.733 | snare .10+.16=.26 → ≤.319
     clap  .25+.15=.40 → ≤.480 | hatO   .26+.50=.76 → ≤.894
     hatC  .03+.05=.08 → ≤.112 | tom    .22+.35=.57 → ≤.6755
     crash 1.2+1.8=3.0 → ≤3.47 | ride → NO drumDurEst case → the switch's
             .5 default → ≤.595 (CORRECTED from the brief's "treat like
             hatO ≤.894" — the formula is the law; a longer ride ring would
             be cut by a pooled steal at the .595 busyUntil window).        */
export const REASON_DUR = {
  kick: 0.72,
  snare: 0.31,
  clap: 0.47,
  hatO: 0.88,
  hatC: 0.11,
  tom: 0.66,
  crash: 3.40,
  ride: 0.58,
};

/* Bank machinery (ported from voice-bank.ts): BANK_VELOCITY_LAYERS
   [0.4, 0.7, 1.0] with layer 2 = UNITY (a full-velocity hit) and
   LAYER_DRIVE_DB = 1.5 dB of extra drive per layer (timbre layers). */
export const REASON_LAYER_GAIN = [0.4, 0.7, 1.0];
export const REASON_LAYER_DRIVE_DB = 1.5;

/* ─────────────────────────── THE ONE ENTRY ────────────────────────────────
   renderReasonPcm(type, patch, sampleRate, variant, layer) → Float32Array.
   THE entry js/engine.js calls. Byte-deterministic; throws on unknown type /
   bad sampleRate (same contract as perc-rom's renderRomPcm).

   POST (the psy5 laws, in order):
     1. 3 ms fade-in, 12 ms fade-out at the buffer end (click-free landings)
     2. RMS-normalize to patch.rms when patch.rms > 0 (the anti-"dynamics
        destroyer" family loudness law, measured over the whole buffer)
     3. velocity-layer gain [0.4, 0.7, 1.0][layer] (the banked loudness
        steps, ported from voice-bank.ts — layer 2 is the UNITY layer, so
        patch.rms is the FULL-LEVEL family target and lower layers ring
        quieter from it; the default layer=1 is a mid-velocity banked hit
        measuring 0.7·patch.rms BY DESIGN)
     4. peak clamp: if max|sample| > 0.97 scale the WHOLE buffer to 0.97.
   (Same (type, patch, sampleRate, variant, layer) → byte-identical; the
   loudness law is pinned at the unity layer in tests/reason-port.test.ts.) */
export function renderReasonPcm(type, patch, sampleRate, variant = 0, layer = 1) {
  const dur = REASON_DUR[type];
  if (dur === undefined) throw new Error('reason-engines: unknown type ' + type);
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new Error('reason-engines: bad sampleRate ' + sampleRate);
  }
  const p = patch || {};
  const d = { sampleRate, durationSec: dur };
  /* seed: fnv1a('reason:'+type) folded to 32 bits (the perc-rom seedOf
     derivation) + the voice-bank.ts variant step (variant·7919). */
  const seed = (parseInt(fnv1a('reason:' + type).slice(-8), 16) + (variant | 0) * 7919) >>> 0;
  const li = Math.max(0, Math.min(2, layer | 0));
  const layerDrive = li * REASON_LAYER_DRIVE_DB;

  let pcm;
  if (type === 'kick') {
    const q = patchToKick(p, d); q.driveDb += layerDrive; pcm = renderReasonKick(q, seed);
  } else if (type === 'snare') {
    const q = patchToSnare(p, d); q.driveDb += layerDrive; pcm = renderReasonSnare(q, seed);
  } else if (type === 'clap') {
    const q = patchToClap(p, d); q.driveDb += layerDrive; pcm = renderReasonClap(q, seed);
  } else if (type === 'hatO') {
    const q = patchToHat(p, d, true); q.driveDb += layerDrive; pcm = renderReasonHat(q, seed);
  } else if (type === 'hatC') {
    const q = patchToHat(p, d, false); q.driveDb += layerDrive; pcm = renderReasonHat(q, seed);
  } else if (type === 'tom') {
    const q = patchToTom(p, d); q.driveDb += layerDrive; pcm = renderReasonTom(q, seed);
  } else if (type === 'crash') {
    const q = patchToCymbal(p, d, false); q.driveDb += layerDrive; pcm = renderReasonCymbal(q, seed);
  } else { // ride
    const q = patchToCymbal(p, d, true); q.driveDb += layerDrive; pcm = renderReasonCymbal(q, seed);
  }

  // 1. fades
  const fi = Math.min(Math.round(0.003 * sampleRate), pcm.length);
  for (let i = 0; i < fi; i++) pcm[i] *= i / fi;
  const fo = Math.min(Math.round(0.012 * sampleRate), pcm.length);
  for (let i = 0; i < fo; i++) pcm[pcm.length - 1 - i] *= i / fo;

  // 2. RMS law (measured over the whole buffer, fades included)
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  const rms = Math.sqrt(sum / Math.max(1, pcm.length));
  const target = (typeof p.rms === 'number' && isFinite(p.rms) && p.rms > 0) ? p.rms : 0;
  if (target > 0 && rms > 0) {
    const g = target / rms;
    for (let i = 0; i < pcm.length; i++) pcm[i] *= g;
  }

  // 3. velocity-layer loudness (the banked steps; layer 2 is the unity
  //    reference the RMS law above targets — exactly voice-bank.ts)
  const lg = REASON_LAYER_GAIN[li];
  if (lg !== 1) {
    for (let i = 0; i < pcm.length; i++) pcm[i] *= lg;
  }

  // 4. peak law
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > peak) peak = a; }
  if (peak > 0.97) {
    const g = 0.97 / peak;
    for (let i = 0; i < pcm.length; i++) pcm[i] *= g;
  }

  return pcm;
}
