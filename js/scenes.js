/* ============ SCENE BANK (v0.5.0) — DOM-free scene operations ============
   Scene snapshot model (as of v0.8.0 — fields backfilled on load):
     scene = { name, pattern, color, bars, fill, follow?, mix? }
       name    — display label (string, ≤24 chars)
       pattern — key into p.patterns, or null = empty slot
       color   — null | 0..7 palette index (visual tag only, no audio effect)
       bars    — null | 1..64 — default section length when this scene is
                 added to the arranger ([scene, bars] list pre-fills it)
       fill    — bool — fire the existing FILL op (drums) when the scene
                 launches (instant: immediately; quantized: at the bar
                 boundary where the scene becomes active)
       follow  — v0.7.0 follow actions (OPTIONAL; chain mode ONLY):
                 { mode:'none'|'next'|'prev'|'random'|'scene',
                   target?: scene index (mode 'scene'),
                   prob: 0–100 (default 100), afterBars?: 1–64 }
       mix     — v0.8.0 MIX SNAPSHOT (OPTIONAL; see SCENE MIX SNAPSHOTS
                 below): null/absent = legacy scene, zero behavior change;
                 applied on every launch path with a syncMix glide anchored
                 at the launch point.

   Launch semantics UNCHANGED since v0.1.0:
     click      = launch quantized (I.pending, applied by the scheduler at
                  the next bar boundary)
     alt+click  = instant launch
     shift+click= assign current pattern to the scene
   Chain mode (p.chain) advances to the next scene with a pattern, wrapping
   over ANY scene count (tested with 32+).

   FOLLOW-ACTION PRECEDENCE (v0.7.0, documented in UI hint + README):
     PLAY SONG strictly follows the arranger (p.arranger) and NEVER
     consults follow actions. Follow actions apply ONLY in chain mode
     (p.chain), at the chain boundary, through the same quantized
     I.pending launch path — zero new engine behavior. prob < 100 → on a
     miss the action falls back to 'next' (the documented chain default).
     The random pick is seeded: rng = mulberry32(fnv(projectSeed + ':' +
     transitionCounter)) — deterministic and replayable per transport
     session (G27 pins the exact sequence for a fixed seed). */
import { LIMITS } from './limits.js';
import { deep, fnv, mulberry32 } from './model.js';
import { paramApply, ensureIns } from './params.js';

function sceneAdd(p) {
  if (!p || p.scenes.length >= LIMITS.MAX_SCENES) return -1;
  p.scenes.push({ name: 'SCENE ' + (p.scenes.length + 1), pattern: null, color: null, bars: null, fill: false });
  return p.scenes.length - 1;
}
function sceneDuplicate(p, i) {
  if (!p || i < 0 || i >= p.scenes.length || p.scenes.length >= LIMITS.MAX_SCENES) return -1;
  const c = deep(p.scenes[i]);
  c.name = ((p.scenes[i].name || ('SCENE ' + (i + 1))) + '*').slice(0, 24);
  p.scenes.splice(i + 1, 0, c);
  return i + 1;
}
function sceneClear(p, i) {
  if (!p || !p.scenes[i]) return false;
  p.scenes[i].pattern = null;
  p.scenes[i].fill = false;
  return true;
}
function sceneMove(p, i, dir) { /* dir: -1 = up, +1 = down */
  const j = i + dir;
  if (!p || i < 0 || i >= p.scenes.length || j < 0 || j >= p.scenes.length) return false;
  const tmp = p.scenes[i]; p.scenes[i] = p.scenes[j]; p.scenes[j] = tmp;
  return true;
}
function sceneRename(p, i, name) {
  if (!p || !p.scenes[i]) return false;
  p.scenes[i].name = String(name == null ? '' : name).trim().slice(0, 24) || ('SCENE ' + (i + 1));
  return true;
}
function sceneSetColor(p, i, c) {
  if (!p || !p.scenes[i]) return false;
  p.scenes[i].color = (c == null) ? null : Math.max(0, Math.min(7, c | 0));
  return true;
}
function sceneSetBars(p, i, b) {
  if (!p || !p.scenes[i]) return false;
  p.scenes[i].bars = (b == null || b === '') ? null : Math.max(1, Math.min(64, b | 0));
  return true;
}
function sceneToggleFill(p, i) {
  if (!p || !p.scenes[i]) return false;
  p.scenes[i].fill = !p.scenes[i].fill;
  return true;
}
/* pure chain-advance used by the scheduler at step 0 when p.chain is on.
   Historical semantics (unchanged): advance to the IMMEDIATELY-next scene,
   wrapping over the whole bank; if that next scene is empty, chain does not
   advance (no multi-skip) — returns null. */
function chainNext(p) {
  if (!p || !p.scenes.length) return null;
  const nxt = (p.activeScene + 1) % p.scenes.length;
  return (p.scenes[nxt] && p.scenes[nxt].pattern != null) ? nxt : null;
}

/* ── SCENE MIX SNAPSHOTS (v0.8.0) — arrangements that breathe ──
   scene.mix = null (legacy/absent — zero behavior change) | {
     tracks: { [trackIdx]: { vol 0–1, pan −1..1, sendA 0–1, sendB 0–1,
                             scAmount 0–100 } },   ≥1 entry
     master?: { eqLow/eqMid/eqHigh −12..12 dB, compOn 0/1,
                compThresh −40..0, compRatio 1..20, compAttack 1..100 ms,
                compRelease 20..1000 ms, compMakeup 0..24 dB },
     note?:   string ≤ 120 chars,
   }
   APPLICATION — one primitive, three launch paths: applySceneMix() writes
   the payload into the mix state through the SAME param-registry write path
   a knob/automation lane uses; the caller then glides the engine with its
   own time anchor (eng.syncMix(p, when)). Paths: PERF.launch (instant),
   the scheduler pending-launch branch (quantized bar boundary — PLAY SONG,
   chain, follow actions and manual quantized launches all land here) and
   renderSong (offline section launch). Snapshot at launch, THEN per-step
   automation lanes on top (documented precedence). */
const MIX_TRACK_FIELDS = [
  ['vol', 0, 1], ['pan', -1, 1], ['sendA', 0, 1], ['sendB', 0, 1], ['scAmount', 0, 100],
  /* v0.10.0: optional INSERT-FX snapshot fields — old snapshots load
     unchanged (absent fields are skipped); new snapshots carry them in
     canonical field order. */
  ['insDrive', 0, 100], ['insFiltFreq', 20, 20000],
];
/* master payload — validated + persisted from v0.8.0; applied via paramApply
   (unregistered ids are skipped, so pre-master-engine loads stay inert) */
const MIX_MASTER_FIELDS = [
  ['eqLow', -12, 12], ['eqMid', -12, 12], ['eqHigh', -12, 12],
  ['compOn', 0, 1], ['compThresh', -40, 0], ['compRatio', 1, 20],
  ['compAttack', 1, 100], ['compRelease', 20, 1000], ['compMakeup', 0, 24],
];

/* normalizeSceneMix — validate + clamp a payload into CANONICAL key order
   (tracks: ascending numeric index, fields in registry order; master; note).
   Anything invalid/empty → null (the legacy shape). Deterministic: the same
   input always produces the same canonical object (load→save byte-stability). */
function normalizeSceneMix(mix, trackCount) {
  if (!mix || typeof mix !== 'object') return null;
  const tracksIn = (mix.tracks && typeof mix.tracks === 'object' && !Array.isArray(mix.tracks)) ? mix.tracks : null;
  const tracks = {};
  if (tracksIn) {
    const idxs = Object.keys(tracksIn).map(k => +k).filter(ti => Number.isInteger(ti) && ti >= 0 && ti < trackCount).sort((a, b) => a - b);
    for (const ti of idxs) {
      const src = tracksIn[ti];
      if (!src || typeof src !== 'object') continue;
      const e = {};
      for (const [f, lo, hi] of MIX_TRACK_FIELDS) {
        const v = src[f];
        if (v == null || !isFinite(v)) continue;
        e[f] = Math.round(Math.min(hi, Math.max(lo, v)) * 1000) / 1000;
      }
      if (Object.keys(e).length) tracks[ti] = e;
    }
  }
  let master = null;
  if (mix.master && typeof mix.master === 'object') {
    master = {};
    for (const [f, lo, hi] of MIX_MASTER_FIELDS) {
      const v = mix.master[f];
      if (v == null || !isFinite(v)) continue;
      master[f] = Math.round(Math.min(hi, Math.max(lo, v)) * 1000) / 1000;
    }
    if (!Object.keys(master).length) master = null;
  }
  const note = (typeof mix.note === 'string' && mix.note.trim()) ? mix.note.trim().slice(0, 120) : null;
  if (!Object.keys(tracks).length && !master) return null;
  const out = { tracks };
  if (master) out.master = master;
  if (note) out.note = note;
  return out;
}

/* sceneSetMix — write a snapshot (canonical form) into scene i; null clears. */
function sceneSetMix(p, i, mix) {
  if (!p || !p.scenes[i]) return false;
  const n = normalizeSceneMix(mix, p.tracks.length);
  if (!n) delete p.scenes[i].mix;
  else p.scenes[i].mix = n;
  return true;
}

/* captureSceneMix — the CURRENT mixer state as a snapshot payload (the
   MIX→SCENE button). mute/solo are deliberately NOT captured (transport
   state, not mix identity — documented). Master included when the project
   carries one (v0.8.0 master section). */
function captureSceneMix(p) {
  const tracks = {};
  (p.tracks || []).forEach((t, ti) => {
    const ins = ensureIns(t).ins;
    tracks[ti] = {
      vol: t.mix.vol, pan: t.mix.pan,
      sendA: t.mix.sendA, sendB: t.mix.sendB,
      scAmount: t.scAmount == null ? 0 : t.scAmount,
      insDrive: ins.drive, insFiltFreq: ins.filtFreq,
    };
  });
  const out = { tracks };
  if (p.master && typeof p.master === 'object') out.master = deep(p.master);
  return out;
}

/* snapshot field → registry id (v0.10.0: includes the INSERT-FX params) */
const SNAP_PARAM = { vol: 'mix.vol', pan: 'mix.pan', sendA: 'mix.sendA', sendB: 'mix.sendB', scAmount: 'scAmount', insDrive: 'insDrive', insFiltFreq: 'insFiltFreq' };

/* applySceneMix — THE snapshot application primitive (see the block comment
   above). Writes through paramApply (knob-equivalent, clamped); master ids
   the registry does not know are skipped. Returns true when applied. */
function applySceneMix(p, i) {
  const sc = p && p.scenes[i];
  if (!sc || !sc.mix) return false;
  const snap = sc.mix;
  for (const k of Object.keys(snap.tracks)) {
    const t = p.tracks[+k];
    if (!t) continue;
    const e = snap.tracks[k];
    for (const [f] of MIX_TRACK_FIELDS) {
      if (e[f] == null) continue;
      paramApply(t, SNAP_PARAM[f] || f, e[f]);
    }
  }
  if (snap.master) {
    for (const [f] of MIX_MASTER_FIELDS) {
      if (snap.master[f] == null) continue;
      paramApply(p, f, snap.master[f]); /* unregistered (pre-master) → skipped */
    }
  }
  return true;
}

/* ── FOLLOW ACTIONS (v0.7.0) — seeded performance evolution ── */
const FOLLOW_MODES = ['none', 'next', 'prev', 'random', 'scene'];

/* sceneSetFollow — validate + write the follow config (null clears). */
function sceneSetFollow(p, i, follow) {
  if (!p || !p.scenes[i]) return false;
  if (follow == null) { delete p.scenes[i].follow; return true }
  const f = {
    mode: FOLLOW_MODES.indexOf(follow.mode) >= 0 ? follow.mode : 'none',
    target: (follow.target == null || follow.target === '') ? null : Math.max(0, Math.min(p.scenes.length - 1, follow.target | 0)),
    prob: Math.max(0, Math.min(100, (typeof follow.prob === 'number' && isFinite(follow.prob)) ? Math.round(follow.prob) : 100)),
    afterBars: (follow.afterBars == null || follow.afterBars === '') ? null : Math.max(1, Math.min(64, follow.afterBars | 0)),
  };
  if (f.mode === 'none' && f.target == null && f.prob === 100 && f.afterBars == null) { delete p.scenes[i].follow; return true }
  p.scenes[i].follow = f;
  return true;
}

/* followBars — the effective chain section length in bars for a scene with
   an active follow: afterBars overrides the scene's bars override overrides
   the current pattern loop (bars = loopSteps/16 — the legacy cadence). */
function followBars(fw, scn, loopSteps) {
  return (fw && fw.afterBars) || (scn && scn.bars) || Math.max(1, ((loopSteps / 16) | 0));
}

/* resolveFollow — the pure follow decision (CHAIN MODE ONLY; the scheduler
   gates on p.chain and follow.mode !== 'none' before calling).
   Returns the next scene index, or null = keep playing (empty targets never
   multi-skip — the legacy chain rule). Seeded: the roll (prob) and the
   random pick draw from mulberry32(fnv(projectSeed + ':' + counter)) —
   same project seed + same start + same counter order ⇒ identical sequence. */
function resolveFollow(p, from, transitionCounter) {
  if (!p || !p.scenes.length) return null;
  const scn = p.scenes[from];
  const fw = (scn && scn.follow) || null;
  if (!fw || fw.mode === 'none') return null;
  const prob = (typeof fw.prob === 'number') ? Math.max(0, Math.min(100, fw.prob)) : 100;
  const rng = mulberry32(parseInt(fnv(String(p.seed == null ? 'PSY6' : p.seed) + ':' + (transitionCounter | 0)).slice(0, 8), 16) >>> 0);
  let mode = fw.mode;
  if (rng() * 100 >= prob) mode = 'next'; /* documented miss → 'next' fallback */
  const hasPat = i => !!(p.scenes[i] && p.scenes[i].pattern != null);
  if (mode === 'random') {
    const pool = [];
    for (let i = 0; i < p.scenes.length; i++) if (hasPat(i)) pool.push(i);
    if (!pool.length) return null;
    return pool[Math.floor(rng() * pool.length)];
  }
  if (mode === 'scene') {
    const t = fw.target == null ? null : Math.max(0, Math.min(p.scenes.length - 1, fw.target | 0));
    return (t != null && hasPat(t)) ? t : null;
  }
  if (mode === 'prev') { const t = (from - 1 + p.scenes.length) % p.scenes.length; return hasPat(t) ? t : null }
  if (mode === 'next') { const t = (from + 1) % p.scenes.length; return hasPat(t) ? t : null }
  return null;
}

export { sceneAdd, sceneDuplicate, sceneClear, sceneMove, sceneRename, sceneSetColor, sceneSetBars, sceneToggleFill, sceneSetFollow, chainNext, resolveFollow, followBars, FOLLOW_MODES, normalizeSceneMix, sceneSetMix, captureSceneMix, applySceneMix, MIX_TRACK_FIELDS, MIX_MASTER_FIELDS };

/* scene mix model (v0.8.0) appended to the scene schema comment above:
   mix — null | { tracks, master?, note? } — see SCENE MIX SNAPSHOTS. */
