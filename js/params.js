/* ============ PARAM REGISTRY (v0.5.0 automation) ============
   Every automatable parameter in one table. Lanes reference params by id;
   apply() writes through to the live state (track or project object) with
   clamping — the SAME write path a knob uses, so automation and manual
   moves are indistinguishable to the engine.

   Lane model (v0.5.0): { track, param, pts:[[step,value],...], mode }
     track — track index, or -1 for project-level params (masterVol/macro.N)
     param — registry id
     mode  — 'lock'  = legacy per-voice lane: value rides ev.lock (voices
                       only, no state write — exactly v0.1.0–v0.4.0 behavior)
             'state' = live automation: the scheduler applies the lane value
                       through paramApply() every step (knob-equivalent)
     Legacy lanes backfill to 'lock' for sound params, 'state' otherwise
     (sound params had lock support; nothing else ever had a lane). */
const cl = (v, a, b) => v < a ? a : (v > b ? b : v);

function P(id, label, min, max, def, target, apply) {
  return { id, label, min, max, def, target, apply: (t, v) => apply(t, cl(v, min, max)) };
}

export const PARAMS = [
  /* ── synth sound (per track, kind 'synth') ── */
  P('cutoff',   'Cutoff',      60, 14000, 1500, 'track', (t, v) => { t.sound.cutoff = v }),
  P('res',      'Resonance',   0.2, 24,  3,    'track', (t, v) => { t.sound.res = v }),
  P('atk',      'Attack',      0.003, 1.5, 0.005, 'track', (t, v) => { t.sound.atk = v }),
  P('dec',      'Decay',       0.01, 2,   0.3,  'track', (t, v) => { t.sound.dec = v }),
  P('sus',      'Sustain',     0,   1,    0.6,  'track', (t, v) => { t.sound.sus = v }),
  P('rel',      'Release',     0.02, 2.5, 0.2,  'track', (t, v) => { t.sound.rel = v }),
  P('gate',     'Gate',        0.05, 3,   0.6,  'track', (t, v) => { t.sound.gate = v }),
  P('detune',   'Detune',      0,   48,   8,    'track', (t, v) => { t.sound.detune = v }),
  P('lfoRate',  'LFO Rate',    0,   16,   0,    'track', (t, v) => { t.sound.lfoRate = v }),
  P('lfoDepth', 'LFO Depth',   0,   1,    0,    'track', (t, v) => { t.sound.lfoDepth = v }),
  /* ── mixer (per track, any kind) ── */
  P('mix.vol',   'Volume',     0, 1, 0.8, 'track', (t, v) => { t.mix.vol = v }),
  P('mix.pan',   'Pan',       -1, 1, 0,   'track', (t, v) => { t.mix.pan = v }),
  P('mix.sendA', 'Delay send', 0, 1, 0,   'track', (t, v) => { t.mix.sendA = v }),
  P('mix.sendB', 'Reverb send', 0, 1, 0,  'track', (t, v) => { t.mix.sendB = v }),
  /* ── sidechain (per track, any kind) ── */
  P('scAmount',   'SC depth',  0, 100, 0,   'track', (t, v) => { t.scAmount = Math.round(v) }),
  P('scAttackMs', 'SC attack', 1, 200, 12,  'track', (t, v) => { t.scAttackMs = Math.round(v) }),
  P('scHoldMs',   'SC hold',   0, 400, 0,   'track', (t, v) => { t.scHoldMs = Math.round(v) }),
  P('scReleaseMs','SC release', 5, 1000, 140, 'track', (t, v) => { t.scReleaseMs = Math.round(v) }),
  /* ── project-level (lane.track = -1) ── */
  P('masterVol', 'Master',    0, 1, 0.85, 'project', (p, v) => { p.masterVol = v }),
  P('macro.0', 'Macro ENERGY',    0, 1, 0.5, 'project', (p, v) => { p.macroVals[0] = v }),
  P('macro.1', 'Macro DRIVE',     0, 1, 0.5, 'project', (p, v) => { p.macroVals[1] = v }),
  P('macro.2', 'Macro SPACE',     0, 1, 0.5, 'project', (p, v) => { p.macroVals[2] = v }),
  P('macro.3', 'Macro MOVEMENT',  0, 1, 0.5, 'project', (p, v) => { p.macroVals[3] = v }),
];

const BY_ID = new Map(PARAMS.map(p => [p.id, p]));
const SOUND_IDS = new Set(['cutoff', 'res', 'atk', 'dec', 'sus', 'rel', 'gate', 'detune', 'lfoRate', 'lfoDepth']);

function paramById(id) { return BY_ID.get(id) || null }
/* clamped write-through; returns the clamped value, or null for unknown ids */
function paramApply(target, id, v) {
  const pd = BY_ID.get(id);
  if (!pd || target == null) return null;
  const cv = cl(Number(v) || 0, pd.min, pd.max);
  pd.apply(target, cv);
  return cv;
}
function paramNorm(id, v) { const pd = BY_ID.get(id); if (!pd) return 0; return cl((v - pd.min) / (pd.max - pd.min), 0, 1) }
function paramDenorm(id, x) { const pd = BY_ID.get(id); if (!pd) return 0; return cl(pd.min + (pd.max - pd.min) * cl(x, 0, 1), pd.min, pd.max) }
/* which params a track may automate: sound params only for synths */
function paramsForTrack(kind) {
  return PARAMS.filter(p => p.target === 'project' ? false : (kind === 'synth' ? true : !SOUND_IDS.has(p.id))).map(p => p.id);
}
/* legacy lane mode backfill: sound params had lock support since v0.1.0 */
function laneModeBackfill(param, mode) {
  if (mode === 'lock' || mode === 'state') return mode;
  return SOUND_IDS.has(param) ? 'lock' : 'state';
}
export { paramById, paramApply, paramNorm, paramDenorm, paramsForTrack, laneModeBackfill, SOUND_IDS };
