/* SECTION ARRANGER — minimal [scene, bars] auto-advance (P3).
 * Reuses the EXISTING scene-launch code path (PERF.launch → quantized
 * pending transition applied by the scheduler at the next bar). No new
 * engine behavior. State lives in the project (p.arranger, v1) so it is
 * stored by save/export automatically.
 *
 *  - advance fires exactly when barsInSection >= section.bars (bar-quantized
 *    via the shared scheduler barHooks)
 *  - manual scene launch (user-facing PERF.launch) turns the arranger OFF
 *    (manual override stops auto-advance); the arranger's own internal
 *    advance calls the captured launch reference and does NOT self-stop
 *  - DOM-free: tests can drive hooks directly; UI is js/ui/arranger.js
 */
import { I } from './state.js';
import { PERF } from './state.js';
import { songSections, songDurationSec } from './bounce.js';

function arrState() {
  const p = I.p;
  if (!p) return null;
  if (!p.arranger || p.arranger.v !== 1) p.arranger = { v: 1, on: false, steps: [], idx: 0, barsIn: 0 };
  if (!Array.isArray(p.arranger.steps)) p.arranger.steps = [];
  if (typeof p.arranger.idx !== 'number') p.arranger.idx = 0;
  if (typeof p.arranger.barsIn !== 'number') p.arranger.barsIn = 0;
  return p.arranger;
}

let arrLaunchRef = null; /* captured at instrument time: copilot-wrapped launch (gesture recording) */

function launchStep(i) {
  const a = arrState();
  const st = a.steps[i];
  if (!st) return { ok: false };
  const fn = arrLaunchRef || PERF.launch;
  return fn.call(PERF, st.scene) || { ok: true };
}

function arrToggle(on) {
  const a = arrState();
  a.on = !!on;
  if (a.on) {
    if (!a.steps.length) { a.on = false; }
    else { a.idx = 0; a.barsIn = 0; launchStep(0); }
  }
  render();
  return a.on;
}
function arrAddStep(scene, bars) {
  const a = arrState();
  /* v0.5.0 scene bank: a scene's own bars override pre-fills the section
     length when it is added to the arranger (explicit bars still win) */
  const p = I.p;
  const def = (p && p.scenes[scene] && p.scenes[scene].bars) || 4;
  a.steps.push({ scene: scene | 0, bars: Math.min(64, Math.max(1, (bars | 0) || def)) });
  render();
}
function arrRemoveStep(i) {
  const a = arrState();
  a.steps.splice(i, 1);
  if (a.idx >= a.steps.length) a.idx = 0;
  if (!a.steps.length) a.on = false;
  render();
}
function arrSetStep(i, patch) {
  const a = arrState();
  const st = a.steps[i];
  if (!st) return;
  if (patch.scene != null) st.scene = patch.scene | 0;
  if (patch.bars != null) st.bars = Math.min(64, Math.max(1, patch.bars | 0));
  render();
}

/* arrMoveStep — reorder via left/right (no drag-drop, consistent with the
   scene bank). Swaps steps i and i+dir; the playing idx follows its step. */
function arrMoveStep(i,dir){
const a=arrState();
const j=i+(dir<0?-1:1);
if(i<0||j<0||j>=a.steps.length)return{ok:false};
const t=a.steps[i];a.steps[i]=a.steps[j];a.steps[j]=t;
if(a.idx===i)a.idx=j;else if(a.idx===j)a.idx=i;
render();
return{ok:true};
}
/* arrInsertStep — insert-from-scene before index i (append when i>=len).
   Bars default to the scene's own bars override, then 4 (same as ADD). */
function arrInsertStep(i,scene,bars){
const a=arrState();
const p=I.p;
const def=(p&&p.scenes[scene]&&p.scenes[scene].bars)||4;
a.steps.splice(Math.max(0,Math.min(a.steps.length,i|0)),0,{scene:scene|0,bars:Math.min(64,Math.max(1,(bars|0)||def))});
render();
}
/* arrSongInfo — total bars / musical sections / durations for the readout.
   Reuses the song-render section grouping (single source of truth). */
function arrSongInfo(){
const a=arrState();
const p=I.p;
if(!p)return{bars:0,sections:0,music:0,withTail:0,bpm:120};
const d=songDurationSec(p);
return{bars:d.music>0?a.steps.reduce((x,s)=>x+s.bars,0):0,sections:songSections(p).length,music:d.music,withTail:d.withTail,bpm:p.bpm};
}

/* per-bar hook (registered on I.barHooks by the UI wiring) */
function arrBarHook() {
  const a = arrState();
  if (!a || !a.on || !I.sched.on) return;
  const cur = a.steps[a.idx];
  if (!cur) { a.on = false; render(); return; }
  a.barsIn++;
  if (a.barsIn >= cur.bars) {
    a.barsIn = 0;
    a.idx = (a.idx + 1) % a.steps.length;
    launchStep(a.idx);
  }
  render();
}

/* instrument: capture launch for internal advance + wrap user-facing launch
 * so a MANUAL scene launch stops the arranger (manual override) */
function arrInstrument() {
  if (!arrLaunchRef) arrLaunchRef = PERF.launch;
  const userLaunch = PERF.launch;
  PERF.launch = function (i, instant) {
    const r = userLaunch.call(this, i, instant);
    const a = arrState();
    if (a && a.on) { a.on = false; render(); }
    return r;
  };
}

function render() { if (I.arrangerRender) I.arrangerRender(); }

function arrView() {
  const a = arrState();
  if (!a) return { on: false, steps: [], idx: 0, barsIn: 0, nextIn: 0, playing: false };
  return {
    on: a.on, steps: a.steps, idx: a.idx, barsIn: a.barsIn,
    nextIn: a.on && a.steps[a.idx] ? Math.max(0, a.steps[a.idx].bars - a.barsIn) : 0,
    playing: !!I.sched.on,
  };
}

export { arrState, arrToggle, arrAddStep, arrRemoveStep, arrSetStep, arrMoveStep, arrInsertStep, arrSongInfo, arrBarHook, arrInstrument, arrView };
