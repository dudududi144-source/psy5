/* ============ SCENE BANK (v0.5.0) — DOM-free scene operations ============
   Scene snapshot model (as of v0.7.0 — fields backfilled on load):
     scene = { name, pattern, color, bars, fill, follow? }
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

export { sceneAdd, sceneDuplicate, sceneClear, sceneMove, sceneRename, sceneSetColor, sceneSetBars, sceneToggleFill, sceneSetFollow, chainNext, resolveFollow, followBars, FOLLOW_MODES };
