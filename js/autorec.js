/* ============ AUTOMATION CORE (v0.5.0) — DOM-free, Bun-testable ============
   Two jobs:
   1. applyLanes(p, step) — the per-step automation player. Every 'state'
      lane is evaluated (laneEval, linear interpolation) and written through
      the param registry to the track/project state — knob-equivalent. The
      scheduler calls this once per step; mix/sc/master touches need an
      engine syncMix afterwards (the caller handles audio-side effects).
   2. recordPoint(lane, step, value) — the recorder's point writer: replace
      at an identical step, else insert sorted; capped at 512 points.
   Recording glue (which lanes are armed, the current transport step) lives
   in state.js — this module stays pure. */
import { laneEval } from './model.js';
import { paramApply, paramById } from './params.js';

function applyLanes(p, step) {
  let mixed = false, macroed = false;
  if (!p || !p.lanes) return { mixed, macroed };
  for (const ln of p.lanes) {
    if (ln.mode !== 'state') continue;
    const pd = paramById(ln.param);
    if (!pd) continue;
    const target = pd.target === 'project' ? p : p.tracks[ln.track];
    if (!target) continue;
    paramApply(target, ln.param, laneEval(ln, step));
    if (pd.id.startsWith('macro.')) macroed = true;
    else mixed = true;
  }
  return { mixed, macroed };
}

/* quantized record step: quant=true snaps to whole steps (1/16 grid), off
   records the exact fractional position. Wraps into the pattern loop. */
function quantStep(step, loop, quant) {
  const s = quant ? Math.round(step) : step;
  return ((s % loop) + loop) % loop;
}

function recordPoint(lane, step, value) {
  if (!lane || !Array.isArray(lane.pts)) return lane;
  const s = Math.round(step * 10000) / 10000;
  const v = Math.round(value * 100000) / 100000;
  const i = lane.pts.findIndex(pt => pt[0] === s);
  if (i >= 0) lane.pts[i] = [s, v];
  else { lane.pts.push([s, v]); lane.pts.sort((a, b) => a[0] - b[0]); }
  if (lane.pts.length > 512) lane.pts.shift();
  return lane;
}

export { applyLanes, quantStep, recordPoint };
