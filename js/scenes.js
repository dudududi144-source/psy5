/* ============ SCENE BANK (v0.5.0) — DOM-free scene operations ============
   Scene snapshot model (as of v0.5.0 — fields backfilled on load):
     scene = { name, pattern, color, bars, fill }
       name    — display label (string, ≤24 chars)
       pattern — key into p.patterns, or null = empty slot
       color   — null | 0..7 palette index (visual tag only, no audio effect)
       bars    — null | 1..64 — default section length when this scene is
                 added to the arranger ([scene, bars] list pre-fills it)
       fill    — bool — fire the existing FILL op (drums) when the scene
                 launches (instant: immediately; quantized: at the bar
                 boundary where the scene becomes active)

   Launch semantics UNCHANGED since v0.1.0:
     click      = launch quantized (I.pending, applied by the scheduler at
                  the next bar boundary)
     alt+click  = instant launch
     shift+click= assign current pattern to the scene
   Chain mode (p.chain) advances to the next scene with a pattern, wrapping
   over ANY scene count (tested with 32+). */
import { LIMITS } from './limits.js';
import { deep } from './model.js';

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
export { sceneAdd, sceneDuplicate, sceneClear, sceneMove, sceneRename, sceneSetColor, sceneSetBars, sceneToggleFill, chainNext };
