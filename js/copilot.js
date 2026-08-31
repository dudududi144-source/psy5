/* CO-PILOT — consent-driven contextual bandit wired onto existing device paths.
 * Brain: foundation/learning/bandit.mjs (single source of truth — no logic
 * duplicated here). This module is DOM-free so Bun tests can import it; the
 * panel/chip live in js/ui/copilot.js.
 *
 * Rules honored:
 *  - decisions every 4 bars while playing, quantized to the bar (barHooks)
 *  - exploration seeded from projectSeed + decision counter (deterministic)
 *  - suggestions NEVER auto-apply: APPLY / DISMISS / 👍👎 in the UI
 *  - rewards: explicit +1/−1, implicit +0.5 (user fill/var/scene within 2 bars
 *    of APPLY), −0.5 (PANIC/UNDO or dismiss within 2 bars), 0 (nothing)
 *  - learner state serialized into project save/export (p.copilot, v:1);
 *    absent field on import → fresh learner
 */
import { I } from './state.js';
import { pushHist, after, PERF } from './state.js';
import { mulberry32, fnv1a, subSeed } from '../foundation/foundation.mjs';
import { BanditLearner } from '../foundation/learning/bandit.mjs';
import { M_ENERGY, M_DRIVE, M_SPACE, M_MOVE } from './model.js';

const q4 = (x) => Math.round(x * 4) / 4;
const bucket = (n) => (n <= 3 ? n : 4);
const LAYERS = ['drums', 'bass', 'music', 'fx'];

function ensureCop() {
  if (!I.cop) I.cop = { learn: true, learner: null, bar: 0, sug: null, applies: 0, lastVarBar: 0, gestures: [] };
  return I.cop;
}

/* ---------------- persistence ---------------- */
function copilotSnapshot() {
  const c = ensureCop();
  const s = { v: 1, learner: c.learner ? c.learner.toJSON() : null, applies: c.applies, lastVarBar: c.lastVarBar };
  if (I.p) I.p.copilot = s; /* live field: save/export/undo see the same state (G5 byte-exact round-trip) */
  return s;
}
function copilotReload() {
  const c = ensureCop();
  const raw = I.p && I.p.copilot;
  let l = null;
  if (raw && raw.v === 1 && raw.learner) { try { l = BanditLearner.fromJSON(raw.learner); } catch (e) { l = null; } }
  c.learner = l || new BanditLearner({ epsilon: 0.15, minTrials: 2, abstainThreshold: 0.1, confidenceGrowth: 0.15 });
  c.applies = raw && typeof raw.applies === 'number' ? raw.applies : 0;
  c.lastVarBar = raw && typeof raw.lastVarBar === 'number' ? raw.lastVarBar : 0;
  c.sug = null; c.bar = 0; c.gestures = [];
}
function copilotInit() {
  copilotReload();
  I.copilotSnapshot = copilotSnapshot;
  I.copilotReload = copilotReload;
}

/* ---------------- context (quantized for generalization) ---------------- */
function buildContext() {
  const p = I.p, c = ensureCop();
  const activeLayers = LAYERS.filter((k) => {
    if (k === 'drums') return !p.tracks.slice(0, 4).every((t) => t.mix.mute);
    if (k === 'bass') return !p.tracks[4].mix.mute;
    if (k === 'music') return !p.tracks.slice(5).every((t) => t.mix.mute);
    return p.tracks[4].mix.sendA > 0;
  }).length;
  let on = 0, total = 0;
  const pat = p.patterns[p.currentPattern];
  if (pat) for (let t = 0; t < 8; t++) { const d = pat.data[t]; if (!d) continue; for (let s = 0; s < d.len; s++) { total++; if (d.steps[s].on) on++; } }
  const g = { fill: 0, variation: 0, panic: 0, undo: 0, scene: 0 };
  for (let i = 0; i < c.gestures.length; i++) g[c.gestures[i].kind] = (g[c.gestures[i].kind] || 0) + 1;
  return {
    energy: q4(p.macroVals[M_ENERGY]),
    scene: p.activeScene,
    layers: activeLayers,
    density: total ? q4(on / total) : 0,
    barsSinceVar: bucket(Math.max(0, c.bar - c.lastVarBar)),
    macros: [q4(p.macroVals[M_ENERGY]), q4(p.macroVals[M_DRIVE]), q4(p.macroVals[M_SPACE]), q4(p.macroVals[M_MOVE])],
    gestures: { fill: bucket(g.fill), variation: bucket(g.variation), panic: bucket(g.panic), undo: bucket(g.undo) },
  };
}

/* ---------------- candidates mapped onto EXISTING paths ---------------- */
function candidateActions(p) {
  const out = [{ type: 'fill' }, { type: 'variation' }];
  out.push({ type: 'groove-toggle', to: p.groove === 'psy-push' ? 'straight' : 'psy-push' });
  for (const k of ['music', 'bass']) {
    const muted = k === 'bass' ? p.tracks[4].mix.mute : p.tracks.slice(5).every((t) => t.mix.mute);
    if (!muted) out.push({ type: 'layer-toggle', layer: k });
  }
  if (p.scenes.length > 1) out.push({ type: 'scene-nudge', to: (p.activeScene + 1) % p.scenes.length });
  return out;
}

/* ---------------- decisions ---------------- */
function seededRng() {
  const p = I.p;
  return mulberry32(subSeed(parseInt(fnv1a(String(p.seed == null ? 'PSY6' : p.seed)).slice(0, 8), 16) >>> 0, 'copilot#' + ensureCop().learner.decisionCount));
}
function render() { if (I.copilotRender) I.copilotRender(); }

function copilotDecide() {
  const c = ensureCop();
  if (!c.learn || !I.p || !c.learner) return;
  const ctx = buildContext();
  const d = c.learner.decide(ctx, 'copilot', candidateActions(I.p), { rng: seededRng() });
  if (d.action.type === 'do-nothing') { c.sug = null; render(); return; } /* abstention stays silent */
  c.sug = { decision: d, ctx, applied: false, applyBar: 0, resolved: true, voted: false };
  render();
  if (I.copilotToast) I.copilotToast('CO-PILOT: ' + actionLabel(d.action));
}

/* ---------------- reward windows ---------------- */
function resolveWindow(reward) {
  const c = ensureCop();
  const s = c.sug;
  if (!s || !s.applied || s.resolved) return;
  s.resolved = true;
  c.learner.recordOutcome(s.ctx, 'copilot', s.decision.action, reward, c.bar);
}
function copilotGesture(kind) {
  const c = ensureCop();
  c.gestures.push({ bar: c.bar, kind });
  if (c.gestures.length > 96) c.gestures.shift();
  if (kind === 'variation') c.lastVarBar = c.bar;
  const s = c.sug;
  if (s && s.applied && !s.resolved && c.bar - s.applyBar <= 2) {
    if (kind === 'fill' || kind === 'variation' || kind === 'scene') resolveWindow(0.5);
    else if (kind === 'panic' || kind === 'undo') resolveWindow(-0.5);
  }
  render();
}

/* ---------------- user consent actions ---------------- */
const ACTION_LABELS = { fill: 'FILL', variation: 'VARIATION', 'groove-toggle': 'GROOVE', 'layer-toggle': 'LAYER', 'scene-nudge': 'NEXT SCENE' };
function actionLabel(a) { return ACTION_LABELS[a.type] || a.type; }

function copilotApply() {
  const c = ensureCop();
  const s = c.sug;
  if (!s || s.applied) return;
  const a = s.decision.action, p = I.p;
  if (a.type === 'fill') (orig.fill || PERF.fill)();
  else if (a.type === 'variation') (orig.variation || PERF.variation)();
  else if (a.type === 'groove-toggle') { pushHist(); p.groove = a.to; after(); if (I.copilotSyncGroove) I.copilotSyncGroove(); }
  else if (a.type === 'layer-toggle') PERF.toggleLayer(a.layer);
  else if (a.type === 'scene-nudge') (orig.launch || PERF.launch)(a.to);
  s.applied = true; s.applyBar = c.bar; s.resolved = false;
  c.applies++;
  render();
}
function copilotDismiss() {
  const c = ensureCop();
  const s = c.sug;
  if (!s) return;
  if (s.applied) { if (!s.resolved && c.bar - s.applyBar <= 2) resolveWindow(-0.5); }
  else c.learner.recordOutcome(s.ctx, 'copilot', s.decision.action, 0, c.bar); /* unapplied dismissal is neutral */
  c.sug = null;
  render();
}
function copilotVote(v) {
  const c = ensureCop();
  const s = c.sug;
  if (!s || s.voted) return;
  s.voted = true;
  c.learner.recordOutcome(s.ctx, 'copilot', s.decision.action, v, c.bar);
  render();
}
function copilotToggleLearn() {
  const c = ensureCop();
  c.learn = !c.learn;
  if (!c.learn) c.sug = null;
  render();
  return c.learn;
}

/* ---------------- bar hook (registered by ui/copilot.js) ---------------- */
function copilotBarHook() {
  const c = ensureCop();
  if (!I.p || !c.learner) return;
  c.bar++;
  const s = c.sug;
  if (s && s.applied && !s.resolved && c.bar - s.applyBar > 2) resolveWindow(0); /* window closed: nothing happened */
  if (c.bar % 4 === 0) copilotDecide();
}

/* ---------------- instrumented originals (APPLY bypasses gesture recording) ---------------- */
const orig = { fill: null, variation: null, launch: null };
function copilotInstrument() {
  if (!orig.fill) {
    orig.fill = PERF.fill;
    PERF.fill = function () { copilotGesture('fill'); return orig.fill.apply(this, arguments); };
    orig.variation = PERF.variation;
    PERF.variation = function () { copilotGesture('variation'); return orig.variation.apply(this, arguments); };
    orig.launch = PERF.launch;
    PERF.launch = function (i, instant) { copilotGesture('scene'); return orig.launch.call(this, i, instant); };
  }
}

function copilotStats() {
  const c = ensureCop();
  if (!c.learner) return { decisions: 0, applies: 0, doNothingRate: 0, top: '—', sug: null, learn: c.learn };
  const st = c.learner.stats();
  return { decisions: st.decisions, applies: c.applies, doNothingRate: st.doNothingRate, top: st.topAction ? st.topAction.actionKey.split('|')[0] : '—', sug: c.sug, learn: c.learn };
}

export { ensureCop, copilotInit, copilotReload, copilotSnapshot, buildContext, candidateActions, copilotDecide, copilotBarHook, copilotGesture, copilotApply, copilotDismiss, copilotVote, copilotToggleLearn, copilotInstrument, copilotStats, actionLabel, resolveWindow, orig };
