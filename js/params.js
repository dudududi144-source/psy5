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
  /* ── master section (v0.8.0): EQ3 + glue comp — NEUTRAL defaults (EQ 0 dB,
     compOn 0 = node OUT of the chain) so legacy renders are unchanged within
     a documented tolerance. Automatable/recordable/snapshot-able like every
     registry param. compOn apply rounds (0/1 bypass flag). ── */
  P('eqLow',       'EQ low',      -12, 12,   0,  'project', (p, v) => { ensureMaster(p).eqLow = v }),
  P('eqMid',       'EQ mid',      -12, 12,   0,  'project', (p, v) => { ensureMaster(p).eqMid = v }),
  P('eqHigh',      'EQ high',     -12, 12,   0,  'project', (p, v) => { ensureMaster(p).eqHigh = v }),
  P('compOn',      'Glue comp',    0,  1,    0,  'project', (p, v) => { ensureMaster(p).compOn = v >= 0.5 ? 1 : 0 }),
  P('compThresh',  'Comp thresh', -40, 0,  -20,  'project', (p, v) => { ensureMaster(p).compThresh = v }),
  P('compRatio',   'Comp ratio',    1, 20,   2,  'project', (p, v) => { ensureMaster(p).compRatio = v }),
  P('compAttack',  'Comp attack',   1, 100, 10,  'project', (p, v) => { ensureMaster(p).compAttack = v }),
  P('compRelease', 'Comp release', 20, 1000, 150,'project', (p, v) => { ensureMaster(p).compRelease = v }),
  P('compMakeup',  'Comp makeup',   0, 24,   0,  'project', (p, v) => { ensureMaster(p).compMakeup = v }),
  P('macro.0', 'Macro ENERGY',    0, 1, 0.5, 'project', (p, v) => { p.macroVals[0] = v }),
  P('macro.1', 'Macro DRIVE',     0, 1, 0.5, 'project', (p, v) => { p.macroVals[1] = v }),
  P('macro.2', 'Macro SPACE',     0, 1, 0.5, 'project', (p, v) => { p.macroVals[2] = v }),
  P('macro.3', 'Macro MOVEMENT',  0, 1, 0.5, 'project', (p, v) => { p.macroVals[3] = v }),
];

const BY_ID = new Map(PARAMS.map(p => [p.id, p]));
const SOUND_IDS = new Set(['cutoff', 'res', 'atk', 'dec', 'sus', 'rel', 'gate', 'detune', 'lfoRate', 'lfoDepth']);
const MASTER_IDS = new Set(['eqLow', 'eqMid', 'eqHigh', 'compOn', 'compThresh', 'compRatio', 'compAttack', 'compRelease', 'compMakeup']);
/* canonical master defaults + clamps (single source for ensureMaster/engine/UI) */
const MASTER_DEFAULTS = { eqLow: 0, eqMid: 0, eqHigh: 0, compOn: 0, compThresh: -20, compRatio: 2, compAttack: 10, compRelease: 150, compMakeup: 0 };
const MASTER_RANGES = { eqLow: [-12, 12], eqMid: [-12, 12], eqHigh: [-12, 12], compOn: [0, 1], compThresh: [-40, 0], compRatio: [1, 20], compAttack: [1, 100], compRelease: [20, 1000], compMakeup: [0, 24] };

/* ensureMaster — backfill + clamp the project master section (v0.8.0).
   Legacy projects (pre-master) get the NEUTRAL defaults; existing values
   are clamped into their registry ranges. Used by the param apply fns,
   the loader backfill and the mixer UI. */
function ensureMaster(p) {
  if (!p.master || typeof p.master !== 'object') p.master = {};
  const m = p.master;
  for (const k of Object.keys(MASTER_DEFAULTS)) {
    const v = m[k];
    if (v == null || !isFinite(v)) { m[k] = MASTER_DEFAULTS[k]; continue }
    const [lo, hi] = MASTER_RANGES[k];
    m[k] = k === 'compOn' ? (v >= 0.5 ? 1 : 0) : cl(v, lo, hi);
  }
  return m;
}

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
export { paramById, paramApply, paramNorm, paramDenorm, paramsForTrack, laneModeBackfill, SOUND_IDS, ensureMaster, MASTER_IDS, MASTER_DEFAULTS, MASTER_RANGES };
