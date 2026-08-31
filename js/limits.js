/* ============ device limits (v0.5.0 UNLIMIT) ============
   Single source of truth for the hard ceilings. These are CEILINGS only —
   defaults (what a new/legacy project starts with) are unchanged since
   v0.1.0: 8 tracks, 16-step patterns, 8 scenes. Larger sizes happen only
   through explicit user action (add track / longer pattern / scene bank),
   and every consumer must read these values instead of hard-coded numbers.
   Lifting a ceiling here must never grow the voice pools — polyphony is
   absorbed by the existing priority voice stealing (SYNTH_VOICES/DRUM_VOICES
   in model.js stay pre-allocated at init). */
export const LIMITS = Object.freeze({
  MAX_TRACKS: 16,
  MAX_STEPS: 128,
  MAX_SCENES: 64,
  PATTERN_LENGTHS: Object.freeze([8, 16, 32, 64, 128]),
  LOOP_CAP: 1024,
});
export const DEFAULTS = Object.freeze({
  TRACKS: 8,
  SCENES: 8,
  PATTERN_LEN: 16,
});
