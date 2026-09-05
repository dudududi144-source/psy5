/**
 * Channel FX Presets — per-voice psytrance channel strip settings.
 *
 * Each VoiceType maps to a tuned ChannelFXConfig designed for that voice's
 * role in a psytrance mix:
 *
 *   - Kick / Bass / SubBass: mono, minimal reverb, no delay. The low end must
 *     stay centered and dry so the sidechain and groove read clearly.
 *   - Lead / Counter: wide stereo, noticeable delay (375ms / 500ms — dotted
 *     8th / quarter @ 145 BPM), lush reverb. These are the melodic foreground.
 *   - Hats / OpenHat / Shaker / Perc: panned off-center, short delay for
 *     groove, bright EQ, minimal reverb so they stay punchy.
 *   - Snare / Clap: centered or panned, medium reverb for body.
 *   - Pad / Riser: maximum width and reverb — these are the atmospheric layer.
 *   - Impact: large reverb but no delay — one-shot cinematic hits.
 *
 * Delay times are tuned to 145 BPM subdivisions:
 *   125ms  = 1/32       187.5ms = 1/16 dotted (3/32)
 *   250ms  = 1/8        375ms   = 1/8 dotted (3/16)
 *   500ms  = 1/4
 *
 * Pan values are signed (-1 = full left, +1 = full right). Hats and perc are
 * panned to give the high-end groove width without smearing the center.
 *
 * Ported from psy-foundation v2.0.0 @ edd1e5f (apps/web/src/lib/psy4/channel-presets.ts) — mechanical TS→JS conversion, math byte-identical.
 * (DATA ONLY: the `import { ChannelFX } from './channel-fx'` import, the
 * VoiceType union type, and getChannelFX() are omitted per port spec —
 * the union survives as the VOICE_TYPES array. Values are exact.)
 */

export const VOICE_TYPES = [
  'kick',
  'bass',
  'subbass',
  'lead',
  'counter',
  'hat',
  'openhat',
  'snare',
  'shaker',
  'pad',
  'riser',
  'impact',
  'clap',
  'perc',
]

export const CHANNEL_PRESETS = {
  kick: {
    eq: { lowGainDb: 2, lowFreqHz: 60, highGainDb: -1, highFreqHz: 8000 },
    delay: { timeMs: 0, feedback: 0, mix: 0, stereoOffsetMs: 0 },
    reverb: { roomSize: 0.3, decaySec: 0.8, damping: 0.8, mix: 0.03 },
    pan: 0,
    width: 0,
  },
  bass: {
    eq: {
      lowGainDb: 3,
      lowFreqHz: 80,
      highGainDb: -2,
      highFreqHz: 5000,
      midGainDb: 2,
      midFreqHz: 150,
    },
    delay: { timeMs: 0, feedback: 0, mix: 0, stereoOffsetMs: 0 },
    reverb: { roomSize: 0.2, decaySec: 0.4, damping: 0.9, mix: 0.0 },
    pan: 0,
    width: 0,
  },
  subbass: {
    eq: { lowGainDb: 2, lowFreqHz: 40, highGainDb: -6, highFreqHz: 120 },
    delay: { timeMs: 0, feedback: 0, mix: 0, stereoOffsetMs: 0 },
    reverb: { roomSize: 0, decaySec: 0.3, damping: 1, mix: 0 },
    pan: 0,
    width: 0,
  },
  lead: {
    eq: {
      lowGainDb: -4,
      lowFreqHz: 300,
      highGainDb: 3,
      highFreqHz: 6000,
      midGainDb: -2,
      midFreqHz: 3000,
    },
    delay: { timeMs: 375, feedback: 0.35, mix: 0.22, stereoOffsetMs: 15 },
    reverb: { roomSize: 0.4, decaySec: 1.8, damping: 0.7, mix: 0.25 },
    pan: 0,
    width: 0.9,
  },
  counter: {
    eq: {
      lowGainDb: -5,
      lowFreqHz: 400,
      highGainDb: 3,
      highFreqHz: 8000,
      midGainDb: -3,
      midFreqHz: 3500,
    },
    delay: { timeMs: 500, feedback: 0.4, mix: 0.28, stereoOffsetMs: 22 },
    reverb: { roomSize: 0.5, decaySec: 2.2, damping: 0.6, mix: 0.32 },
    pan: 0,
    width: 1.0,
  },
  hat: {
    eq: { lowGainDb: -6, lowFreqHz: 500, highGainDb: 4, highFreqHz: 10000 },
    delay: { timeMs: 187.5, feedback: 0.15, mix: 0.08, stereoOffsetMs: 8 },
    reverb: { roomSize: 0.3, decaySec: 0.8, damping: 0.9, mix: 0.05 },
    pan: 0.3,
    width: 0.4,
  },
  openhat: {
    eq: { lowGainDb: -6, lowFreqHz: 500, highGainDb: 3, highFreqHz: 10000 },
    delay: { timeMs: 375, feedback: 0.2, mix: 0.1, stereoOffsetMs: 10 },
    reverb: { roomSize: 0.3, decaySec: 0.9, damping: 0.85, mix: 0.06 },
    pan: -0.3,
    width: 0.5,
  },
  snare: {
    eq: { lowGainDb: -4, lowFreqHz: 150, highGainDb: 1, highFreqHz: 2000 },
    delay: { timeMs: 250, feedback: 0.2, mix: 0.12, stereoOffsetMs: 10 },
    reverb: { roomSize: 0.5, decaySec: 2.0, damping: 0.6, mix: 0.18 },
    pan: 0,
    width: 0.5,
  },
  shaker: {
    eq: { lowGainDb: -8, lowFreqHz: 1000, highGainDb: 3, highFreqHz: 12000 },
    delay: { timeMs: 0, feedback: 0, mix: 0, stereoOffsetMs: 0 },
    reverb: { roomSize: 0.2, decaySec: 0.6, damping: 0.95, mix: 0.03 },
    pan: 0.4,
    width: 0.3,
  },
  pad: {
    eq: {
      lowGainDb: -6,
      lowFreqHz: 250,
      highGainDb: 2,
      highFreqHz: 5000,
      midGainDb: -1,
      midFreqHz: 400,
    },
    delay: { timeMs: 500, feedback: 0.4, mix: 0.25, stereoOffsetMs: 20 },
    reverb: { roomSize: 0.7, decaySec: 3.0, damping: 0.5, mix: 0.35 },
    pan: 0,
    width: 1.0,
  },
  riser: {
    eq: { lowGainDb: -3, lowFreqHz: 300, highGainDb: 2, highFreqHz: 10000 },
    delay: { timeMs: 375, feedback: 0.3, mix: 0.2, stereoOffsetMs: 15 },
    reverb: { roomSize: 0.8, decaySec: 4.0, damping: 0.4, mix: 0.4 },
    pan: 0,
    width: 1.0,
  },
  impact: {
    eq: { lowGainDb: 2, lowFreqHz: 60, highGainDb: 0, highFreqHz: 5000 },
    delay: { timeMs: 0, feedback: 0, mix: 0, stereoOffsetMs: 0 },
    reverb: { roomSize: 0.6, decaySec: 2.5, damping: 0.5, mix: 0.3 },
    pan: 0,
    width: 0.7,
  },
  clap: {
    eq: { lowGainDb: -3, lowFreqHz: 200, highGainDb: 2, highFreqHz: 6000 },
    delay: { timeMs: 125, feedback: 0.1, mix: 0.06, stereoOffsetMs: 6 },
    reverb: { roomSize: 0.4, decaySec: 1.2, damping: 0.7, mix: 0.12 },
    pan: 0,
    width: 0.6,
  },
  perc: {
    eq: { lowGainDb: -2, lowFreqHz: 300, highGainDb: 1, highFreqHz: 8000 },
    delay: { timeMs: 187.5, feedback: 0.15, mix: 0.07, stereoOffsetMs: 7 },
    reverb: { roomSize: 0.3, decaySec: 0.9, damping: 0.8, mix: 0.08 },
    pan: -0.25,
    width: 0.4,
  },
}
