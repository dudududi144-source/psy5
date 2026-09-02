import { I, pushHist, PERF, resolveMacros } from './state.js';
import { stepEvents, loopLen } from './model.js';
import { evolvedLiveEvents } from './evolution.js';
import { chainNext, resolveFollow, followBars, applySceneMix } from './scenes.js';
import { applyLanes } from './autorec.js';

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
function schedTick(){const sc=I.sched;if(!sc.on||!I.ctx)return;const horizon=I.ctx.currentTime+LOOKAHEAD;const p=I.p,sd=60/p.bpm/4;let guard=0;while(sc.next<horizon&&guard++<512){if(sc.step%16===0){const bh=I.barHooks;for(let bi=0;bi<bh.length;bi++)bh[bi](sc.step)}if(I.pending!=null&&sc.step%16===0){const scn=p.scenes[I.pending];if(scn&&scn.pattern!=null){pushHist();p.activeScene=I.pending;p.currentPattern=scn.pattern;sc.loop=loopLen(p);sc.step=sc.step%sc.loop;/* v0.8.0 mix snapshot: the quantized launch applies it exactly here — ONE application primitive shared with the instant path and the offline render — gliding from THIS bar boundary */if(applySceneMix(p,I.pending))I.eng.syncMix(p,sc.next);/* per-scene auto-FILL (v0.5.0): fire the FILL op when the launched scene becomes active */if(scn.fill)PERF.fill()}I.pending=null;if(I.fsm==='TRANSITIONING')I.fsm='PLAYING';I.renderDirty=true}const evs=evolvedLiveEvents(p,sc.step); /* v0.9.0: evolution-aware (OFF / non-song-mode → stepEvents unchanged) */for(let k=0;k<evs.length;k++){const ev=evs[k];const tr=p.tracks[ev.track];I.eng.trigger(tr,Math.max(sc.next+ev.off,I.ctx.currentTime+.001),ev,sd)}/* per-step automation player (v0.5.0): 'state' lanes write through the param registry — knob-equivalent; mix/sc need a syncMix, macro lanes re-resolve targets */const auto=applyLanes(p,sc.step);if(auto.mixed)I.eng.syncMix(p);if(auto.macroed)resolveMacros(p);sc.recent.push({s:sc.step,t:sc.next});if(sc.recent.length>64)sc.recent.shift();sc.step=(sc.step+1)%sc.loop;sc.next+=sd;if(sc.step%16===0&&p.chain){/* v0.7.0 FOLLOW ACTIONS (chain mode ONLY — PLAY SONG never consults follows): bar-counted resolution at bar-boundary ends through the SAME quantized I.pending path. Seeded via resolveFollow (fnv(projectSeed+':'+transitionCounter)) — replayable. */const scnC=p.scenes[p.activeScene];const fwC=scnC&&scnC.follow&&scnC.follow.mode!=='none'?scnC.follow:null;if(fwC){sc.followBarsIn=(sc.followBarsIn||0)+1;if(sc.followBarsIn>=followBars(fwC,scnC,sc.loop)){sc.followBarsIn=0;sc.followCount=(sc.followCount||0)+1;const nxtC=resolveFollow(p,p.activeScene,sc.followCount);if(nxtC!=null)I.pending=nxtC}}else{if(sc.step===0){const nxt=chainNext(p);if(nxt!=null)I.pending=nxt}sc.followBarsIn=0}}I.renderDirty=true}}
function startSched(){const sc=I.sched;sc.on=true;sc.step=0;sc.loop=loopLen(I.p);sc.next=I.ctx.currentTime+.06;sc.recent=[];sc.followBarsIn=0;sc.followCount=0;I.eng.syncMix(I.p);if(!I.timer)I.timer=makeTimerWorker(25,schedTick)}
function stopSched(){I.sched.on=false;if(I.timer){I.timer.stop();I.timer=null}if(I.eng)I.eng.killAll()}

export { startSched, stopSched };
