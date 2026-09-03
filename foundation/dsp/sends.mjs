// foundation/dsp/sends.mjs — per-track delay/reverb send math (PSY6)
// Pure, deterministic, zero dependencies. No DOM, no AudioContext, no wall-clock.
//
// The device builds TWO global send buses ONCE at engine init:
//   DELAY  — BPM-synced (division 1/8 | 3/16 | 1/4, default 3/16), feedback
//            0..80% (default 35%) through a lowpass inside the feedback loop.
//   REVERB — ConvolverNode with a deterministic synthetic stereo IR: seeded
//            decorrelated noise (canonical mulberry32, one seed per channel),
//            exponential decay over ~1.8 s. Generated at init — no external
//            files, no Math.random.
// Per-track sends (mix.sendA = delay, mix.sendB = reverb, 0..1, default 0)
// are POST-FADER taps taken after the strip fader/pan; both send buses feed
// the master chain input. send = 0 → the bus receives no signal at all.

import { mulberry32 } from '../foundation.mjs';

/* Delay divisions in 16th-note steps (16ths per beat/4 = step duration).
   v0.13.1 extends the table ADDITIVELY: '1/16' (1 step), '3/8' (6) and
   '1/2' (8) join the original three. Unknown divisions still fall back to
   the default 3/16, so legacy projects are untouched (deterministic). */
const DIV_STEPS = { '1/16': 1, '1/8': 2, '3/16': 3, '1/4': 4, '3/8': 6, '1/2': 8 };

/* delaySecondsFor — exact delay time in seconds for a division at a BPM.
 *   '3/16' @ 145 BPM → 3 · (60/145/4) = 0.310344… s (310.3 ms)
 *   '1/8'  @ 145 BPM → 206.9 ms   '1/4' → 413.8 ms
 * Unknown division falls back to the default 3/16. */
export function delaySecondsFor(div, bpm) {
  const steps = DIV_STEPS[div] || DIV_STEPS['3/16'];
  return (60 / bpm / 4) * steps;
}

/* delayFbClamp — normalize the project feedback value (0..0.8, default 0.35). */
export function delayFbClamp(v) {
  if (v == null || !Number.isFinite(v)) return 0.35;
  return v < 0 ? 0 : (v > 0.8 ? 0.8 : v);
}

/* delayDivClamp — normalize the project division value. */
export function delayDivClamp(div) {
  return DIV_STEPS[div] ? div : '3/16';
}

/* IR_LEN_S / IR_DECAY — reverb IR geometry: ~1.8 s exponential decay. */
export const IR_LEN_S = 1.8;
export const IR_DECAY = 3.0;

/* irChannel — one decorrelated IR channel: seeded white noise (canonical
 * mulberry32 — same seed ⇒ byte-identical output, every run, every machine)
 * with an exponential decay envelope exp(-decay·t), t∈[0,1]. */
export function irChannel(len, seed, decay) {
  const out = new Float32Array(len);
  const r = mulberry32(seed);
  for (let i = 0; i < len; i++) {
    out[i] = (r() * 2 - 1) * Math.exp(-decay * (i / len));
  }
  return out;
}

/* ── v0.12.0 P3: reverb variants ──
   Three deterministic IRs selectable per project (fx.irKind; undefined →
   classic = the exact v0.11.0 IR, so legacy renders are unchanged):
     short  ~1.2 s bright  (faster decay envelope, no damping)
     classic ~1.8 s        (the original — byte-identical when selected)
     long   ~3.2 s dark    (slower decay + a deterministic one-pole lowpass
                            at 2600 Hz over the noise — the "dark" tilt)
   irChannelShaped(len, seed, decay, lp) == irChannel(len, seed, decay) when
   lp is 0 — the classic variant never changes shape. */
export const IR_VARIANTS = {
  classic: { key: 'classic', len: 1.8, decay: 3.0, seeds: [99, 133], lp: 0 },
  short: { key: 'short', len: 1.2, decay: 3.4, seeds: [211, 229], lp: 0 },
  long: { key: 'long', len: 3.2, decay: 2.2, seeds: [313, 347], lp: 2600 },
};

export function irVariantFor(kind) {
  return IR_VARIANTS[kind] || IR_VARIANTS.classic;
}

export function irChannelShaped(len, seed, decay, lpHz) {
  const out = irChannel(len, seed, decay);
  if (!lpHz) return out;
  /* deterministic one-pole lowpass (bilinear-free — the plain exponential
     smoother from the worklet OnePoleLP family), applied in place */
  const a = (1 / 44100) * 2 * Math.PI * lpHz;
  let v = 0;
  for (let i = 0; i < out.length; i++) {
    v += a * (out[i] - v) / (1 + a);
    out[i] = v;
  }
  return out;
}

/* IR_SEEDS — the two per-channel seeds (stereo decorrelation by seed). */
export const IR_SEEDS = [99, 133];

/* DEFAULT_FX — canonical project.fx backfill. */
export const DEFAULT_FX = { delayDiv: '3/16', delayFb: 0.35 };
