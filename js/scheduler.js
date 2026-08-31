import { I, pushHist, PERF } from './state.js';
import { stepEvents, loopLen } from './model.js';
import { chainNext } from './scenes.js';

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
function schedTick(){const sc=I.sched;if(!sc.on||!I.ctx)return;const horizon=I.ctx.currentTime+LOOKAHEAD;const p=I.p,sd=60/p.bpm/4;let guard=0;while(sc.next<horizon&&guard++<512){if(sc.step%16===0){const bh=I.barHooks;for(let bi=0;bi<bh.length;bi++)bh[bi](sc.step)}if(I.pending!=null&&sc.step%16===0){const scn=p.scenes[I.pending];if(scn&&scn.pattern!=null){pushHist();p.activeScene=I.pending;p.currentPattern=scn.pattern;sc.loop=loopLen(p);sc.step=sc.step%sc.loop;/* per-scene auto-FILL (v0.5.0): fire the FILL op when the launched scene becomes active */if(scn.fill)PERF.fill()}I.pending=null;if(I.fsm==='TRANSITIONING')I.fsm='PLAYING';I.renderDirty=true}const evs=stepEvents(p,sc.step);for(let k=0;k<evs.length;k++){const ev=evs[k];const tr=p.tracks[ev.track];I.eng.trigger(tr,Math.max(sc.next+ev.off,I.ctx.currentTime+.001),ev,sd)}sc.recent.push({s:sc.step,t:sc.next});if(sc.recent.length>64)sc.recent.shift();sc.step=(sc.step+1)%sc.loop;sc.next+=sd;if(sc.step===0&&p.chain){const nxt=chainNext(p);if(nxt!=null)I.pending=nxt}I.renderDirty=true}}
function startSched(){const sc=I.sched;sc.on=true;sc.step=0;sc.loop=loopLen(I.p);sc.next=I.ctx.currentTime+.06;sc.recent=[];I.eng.syncMix(I.p);if(!I.timer)I.timer=makeTimerWorker(25,schedTick)}
function stopSched(){I.sched.on=false;if(I.timer){I.timer.stop();I.timer=null}if(I.eng)I.eng.killAll()}

export { startSched, stopSched };
