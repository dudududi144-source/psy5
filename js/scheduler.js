import { I, pushHist, PERF, resolveMacros } from './state.js';
import { stepEvents, loopLen } from './model.js';
import { evolvedLiveEvents } from './evolution.js';
import { chainNext, resolveFollow, followBars, applySceneMix } from './scenes.js';
import { applyLanes } from './autorec.js';
import { planTransLive, xfadeTc, findTransTrack } from './transition.js';

/* ============ worker-based scheduler timer (jitter-resistant) ============ */
const WORKER_TIMER_SRC = "let iv=null;self.onmessage=function(e){const d=e.data;if(d.cmd==='start'){if(iv)clearInterval(iv);iv=setInterval(()=>self.postMessage('tick'),d.ms)}else if(d.cmd==='stop'){if(iv)clearInterval(iv);iv=null}};";
function makeTimerWorker(ms,onTick){
try{
const blob=new Blob([WORKER_TIMER_SRC],{type:'application/javascript'});
const w=new Worker(URL.createObjectURL(blob));
w.onmessage=onTick;
w.postMessage({cmd:'start',ms});
return {stop:()=>{w.postMessage({cmd:'stop'});w.terminate()},worker:true};
}catch(e){
const iv=setInterval(onTick,ms);
return {stop:()=>clearInterval(iv),worker:false};
}
}

const LOOKAHEAD=0.12;
/* ── v0.16.0 TRANSITIONS — live glue ──
   transFire: one armed element through the SAME eng.trigger path every note
   uses (no parallel engine). armTrans: schedule the elements INTO the NEXT
   section when the scheduler can know it —
     arranger  : section bars known at the current section's launch → the
                 full vocabulary (boundary = current apply + bars bars; the
                 legacy one-bar pending latency is included in the grid math)
     chain     : plain chain advances at the pattern-loop wrap → boundary =
                 wrap + 1 bar (the documented pending latency)
     follow    : resolveFollow with counter+1 is PURE — the same seeded roll
                 the boundary will make (G27 sequence unchanged) → boundary =
                 apply + (followBars+1) bars
   Manual quantized launches with no lookahead source get impact-only (fired
   at the pending-apply branch, guarded by I.transArmedFor against a double
   with an armed impact). */
function transFire(p,e,sd){const tr=p.tracks[e.track];if(!tr||!I.eng)return;I.eng.trigger(tr,Math.max(e.at,I.ctx.currentTime+.001),{track:e.track,off:0,vel:e.vel,note:48,lock:{}},sd)}
function armTrans(p,activeScn,boundaryNow,sd,sc){
const a=p.arranger;let nextScn=null,boundaryTime=0,look=0,armedFor=null;
if(a&&a.on&&Array.isArray(a.steps)&&a.idx>=0&&a.idx<a.steps.length&&p.scenes[a.steps[a.idx].scene]===activeScn){
const st=a.steps[a.idx],ns=a.steps[a.idx+1];
if(ns&&ns.scene!=null){const scn2=p.scenes[ns.scene];if(scn2&&scn2.pattern!=null){nextScn=scn2;armedFor=ns.scene;boundaryTime=boundaryNow+(st.bars|0)*16*sd;look=2}}
}else if(p.chain){
const scnC=p.scenes[p.activeScene];const fwC=scnC&&scnC.follow&&scnC.follow.mode!=='none'?scnC.follow:null;
let nxt=null;
if(fwC){const fb=followBars(fwC,scnC,sc.loop);nxt=resolveFollow(p,p.activeScene,(sc.followCount||0)+1);if(nxt!=null)boundaryTime=boundaryNow+(fb+1)*16*sd}
else{nxt=chainNext(p);if(nxt!=null)boundaryTime=boundaryNow+(((sc.loop/16)|0)+1)*16*sd}
if(nxt!=null){const scn2=p.scenes[nxt];if(scn2&&scn2.pattern!=null){nextScn=scn2;armedFor=nxt;look=2}}
}
if(!nextScn||!nextScn.trans)return;
const plan=planTransLive(nextScn.trans,boundaryTime,sd,look,t=>findTransTrack(p,t));
I.transQ=plan.events;I.transCut=plan.cut;I.transArmedFor=armedFor;
}
function schedTick(){const sc=I.sched;if(!sc.on||!I.ctx)return;const horizon=I.ctx.currentTime+LOOKAHEAD;const p=I.p,sd=60/p.bpm/4;let guard=0;while(sc.next<horizon&&guard++<512){if(sc.step%16===0){const bh=I.barHooks;for(let bi=0;bi<bh.length;bi++)bh[bi](sc.step)}/* v0.16.0: armed transition elements due within the horizon fire here — BEFORE the pending branch (the impact armed for THIS boundary must land before a new arm clears the queue); exact e.at positioning via the same trigger path */if(I.transQ&&I.transQ.length){for(let qi=I.transQ.length-1;qi>=0;qi--){const e=I.transQ[qi];if(e.at<=sc.next+LOOKAHEAD){transFire(p,e,sd);if(e.kind==='impact')I.transImpFired=true;I.transQ.splice(qi,1)}}}if(I.transCut&&sc.next>=I.transCut[1])I.transCut=null;if(I.pending!=null&&sc.step%16===0){const scn=p.scenes[I.pending];if(scn&&scn.pattern!=null){pushHist();p.activeScene=I.pending;p.currentPattern=scn.pattern;sc.loop=loopLen(p);sc.step=sc.step%sc.loop;/* v0.8.0 mix snapshot: the quantized launch applies it exactly here — ONE application primitive shared with the instant path and the offline render — gliding from THIS bar boundary; v0.16.0: the glide rides the scene's own xfade span when it carries one (legacy 20 ms otherwise) */if(applySceneMix(p,I.pending)){const tcX=xfadeTc(scn.trans,sd);I.eng.syncMix(p,sc.next,tcX);/* v0.16.1 PRECISION: keep the glide alive — lane automation inside the span reuses THIS τ (3τ ≈ 95 % settled) instead of re-anchoring at the legacy 20 ms */I.xfadeTc=tcX>0.0201?tcX:0;I.xfadeUntil=sc.next+3*I.xfadeTc}else{I.xfadeTc=0;I.xfadeUntil=0}/* v0.16.1 FIX: capture the arm state BEFORE clearing — the guard must know whether the armed queue already fired THIS boundary's impact (the queue impact fires in the loop above; a manual duplicate here would double-hit) */const wasImpFired=!!I.transImpFired;I.transQ=[];I.transCut=null;I.transArmedFor=null;I.transImpFired=false;/* v0.16.0 TRANSITIONS: manual quantized launch (no lookahead source) still lands ON an impact when the incoming scene carries one — an armed impact for THIS boundary already fired above (wasImpFired), so the manual path only fills the un-armed gap */if(scn.trans&&scn.trans.impact&&!wasImpFired){const ti=findTransTrack(p,'impact');if(ti>=0)I.eng.trigger(p.tracks[ti],Math.max(sc.next,I.ctx.currentTime+.001),{track:ti,off:0,vel:.9,note:48,lock:{}},sd)}armTrans(p,scn,sc.next,sd,sc);/* per-scene auto-FILL (v0.5.0): fire the FILL op when the launched scene becomes active */if(scn.fill)PERF.fill()}I.pending=null;if(I.fsm==='TRANSITIONING')I.fsm='PLAYING';I.renderDirty=true}const evs=evolvedLiveEvents(p,sc.step); /* v0.9.0: evolution-aware (OFF / non-song-mode → stepEvents unchanged) */for(let k=0;k<evs.length;k++){const ev=evs[k];if(I.transCut&&ev.track===4&&sc.next>=I.transCut[0]&&sc.next<I.transCut[1])continue;/* v0.16.0: bass-cut window — the 2-step vacuum before a transitioned boundary */const tr=p.tracks[ev.track];I.eng.trigger(tr,Math.max(sc.next+ev.off,I.ctx.currentTime+.001),ev,sd)}/* per-step automation player (v0.5.0): 'state' lanes write through the param registry — knob-equivalent; mix/sc need a syncMix, macro lanes re-resolve targets */const auto=applyLanes(p,sc.step);if(auto.mixed)I.eng.syncMix(p,null,(I.xfadeTc>0&&I.ctx.currentTime<I.xfadeUntil)?I.xfadeTc:null);if(auto.macroed)resolveMacros(p);sc.recent.push({s:sc.step,t:sc.next});if(sc.recent.length>64)sc.recent.shift();sc.step=(sc.step+1)%sc.loop;sc.next+=sd;/* v0.16.1 PERF (the load fix): the old unconditional per-tick I.renderDirty=true rebuilt the ENTIRE app DOM 16 renderers × up to 60 fps while merely playing — the reported overload/crash. Now the full render runs at the pending/launch boundaries (event-driven) plus ONE bar-aligned refresh when automation or per-bar evolution actually moved visible state (≤ ~0.5 Hz at 128 BPM — 80× reduction). Audio timing is untouched (this flag never touched the audio path). */if((auto.mixed||auto.macroed||(p.evolution&&p.evolution.on))&&sc.step%16===0)I.renderDirty=true;if(sc.step%16===0&&p.chain){/* v0.7.0 FOLLOW ACTIONS (chain mode ONLY — PLAY SONG never consults follows): bar-counted resolution at bar-boundary ends through the SAME quantized I.pending path. Seeded via resolveFollow (fnv(projectSeed+':'+transitionCounter)) — replayable. */const scnC=p.scenes[p.activeScene];const fwC=scnC&&scnC.follow&&scnC.follow.mode!=='none'?scnC.follow:null;if(fwC){sc.followBarsIn=(sc.followBarsIn||0)+1;if(sc.followBarsIn>=followBars(fwC,scnC,sc.loop)){sc.followBarsIn=0;sc.followCount=(sc.followCount||0)+1;const nxtC=resolveFollow(p,p.activeScene,sc.followCount);if(nxtC!=null)I.pending=nxtC}}else{if(sc.step===0){const nxt=chainNext(p);if(nxt!=null)I.pending=nxt}sc.followBarsIn=0}}}}
function startSched(){const sc=I.sched;sc.on=true;sc.step=0;sc.loop=loopLen(I.p);sc.next=I.ctx.currentTime+.06;sc.recent=[];sc.followBarsIn=0;sc.followCount=0;I.transQ=[];I.transCut=null;I.transArmedFor=null;I.transImpFired=false;I.xfadeTc=0;I.xfadeUntil=0;I.eng.syncMix(I.p);I.renderDirty=true;if(!I.timer)I.timer=makeTimerWorker(25,schedTick)}
function stopSched(){I.sched.on=false;if(I.timer){I.timer.stop();I.timer=null}if(I.eng)I.eng.killAll();I.transQ=[];I.transCut=null;I.transArmedFor=null;I.transImpFired=false;I.xfadeTc=0;I.xfadeUntil=0;I.renderDirty=true}

export { startSched, stopSched };
