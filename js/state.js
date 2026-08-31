import { clamp, mulberry32, loopLen, M_ENERGY, M_SPACE } from './model.js';

const $=id=>document.getElementById(id);
function toast(m,ms){const t=$('toast');t.textContent=m;t.classList.add('show');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('show'),ms||2200)}

const I={p:null,ctx:null,eng:null,fsm:'OFF',recOn:false,dirty:false,hist:[],redo:[],pending:null,selLib:null,padMode:'DRUM',selTrack:4,upAt:0,sched:{on:false,step:0,next:0,loop:16,recent:[]},rng:mulberry32(42),timer:null,renderDirty:true,
cop:null,barHooks:[],copilotSnapshot:null,copilotReload:null,copilotRender:null,copilotToast:null,copilotSyncGroove:null};
function pushHist(){I.hist.push(JSON.stringify(I.p));if(I.hist.length>60)I.hist.shift();I.redo.length=0;I.dirty=true}
function after(){if(I.eng)I.eng.syncMix(I.p);if(I.sched.on)I.sched.loop=loopLen(I.p);I.renderDirty=true}
function resolveMacros(target){const p=target||I.p,mv=p.macroVals,e=mv[M_ENERGY],sp=mv[M_SPACE];p.tracks.forEach((t,i)=>{if(!t.base)return;const b=t.base;if(t.kind==='synth'){t.sound.cutoff=clamp(b.sound.cutoff*(0.35+2.2*e),60,14000);t.mix.sendA=clamp(b.mix.sendA+0.45*sp,0,1);t.mix.sendB=clamp(b.mix.sendB+0.4*sp,0,1);if(i===4)t.mix.vol=clamp(b.mix.vol*(0.4+0.8*e),0,1)}else{if(i<4)t.mix.vol=clamp(b.mix.vol*(0.5+0.7*e),0,1)}});if(I.eng&&p===I.p)I.eng.syncMix(p)}
const PERF={toggleLayer(which){const p=I.p;pushHist();if(which==='drums')for(let t=0;t<4;t++)p.tracks[t].mix.mute=!p.tracks[t].mix.mute;else if(which==='bass')p.tracks[4].mix.mute=!p.tracks[4].mix.mute;else if(which==='music')for(let t=5;t<p.tracks.length;t++)p.tracks[t].mix.mute=!p.tracks[t].mix.mute;else if(which==='fx')for(let t=4;t<p.tracks.length;t++)p.tracks[t].mix.sendA=p.tracks[t].mix.sendA>0?0:.35;after()},macro(idx,val){I.p.macroVals[idx]=clamp(val,0,1);resolveMacros();I.dirty=true},launch(i,instant){const p=I.p,sc=p.scenes[i];if(!sc||sc.pattern==null)return{ok:false};if(instant||!I.sched.on){pushHist();p.activeScene=i;p.currentPattern=sc.pattern;I.pending=null;after()}else{I.pending=i;if(I.fsm==='PLAYING'||I.fsm==='RECORDING')I.fsm='TRANSITIONING';I.renderDirty=true}return{ok:true}},assign(i){pushHist();I.p.scenes[i].pattern=I.p.currentPattern;I.p.scenes[i].name='SCENE '+(i+1);after()},fill(){const p=I.p;if(!I.eng||!I.ctx)return;const sd=60/p.bpm/4;for(let k=0;k<8;k++)I.eng.trigger(p.tracks[3],I.ctx.currentTime+k*sd/2,{vel:.5+.05*k,note:48,lock:{}},sd)},variation(){const p=I.p;pushHist();const rng=mulberry32((Date.now()%100000)|0);const pat=p.patterns[p.currentPattern];[2,3].forEach(t=>{const d=pat.data[t];if(!d)return;for(let i=0;i<d.len;i++){const s=d.steps[i];if(s.on&&rng()<.15)s.on=0;else if(!s.on&&rng()<.12){s.on=1;s.vel=.45+rng()*.35}}});const d7=pat.data[7];if(d7)for(let i=0;i<d7.len;i++){const s=d7.steps[i];if(s.on)s.prob=rng()<.1?.6:1}after()}};

const K_MAIN='psy6.main.v1',K_TMP='psy6.tmp.v1';
function saveProject(){try{if(I.copilotSnapshot&&I.p)I.copilotSnapshot();const j=JSON.stringify(I.p);localStorage.setItem(K_TMP,j);localStorage.setItem(K_MAIN,j);localStorage.removeItem(K_TMP);I.dirty=false;return{ok:true}}catch(e){return{ok:false,err:String(e)}}}
function loadStored(){try{let j=localStorage.getItem(K_MAIN);if(!j)j=localStorage.getItem(K_TMP);if(!j)return null;const p=JSON.parse(j);if(!p||p.version!==3||!p.tracks)return null;return p}catch(e){return null}}
function loadProjectObj(p){if(p.seed==null)p.seed='PSY6';if(!p.groove)p.groove='straight';/* sidechain backfill (PSY6): projects saved before ducking existed get the neutral defaults — zero behavior change */if(p.tracks)for(const t of p.tracks){if(t.scAmount==null)t.scAmount=0;if(t.scAttackMs==null)t.scAttackMs=12;if(t.scHoldMs==null)t.scHoldMs=0;if(t.scReleaseMs==null)t.scReleaseMs=140}/* master volume backfill — 0.85 is the historical hard-coded engine value */if(p.masterVol==null)p.masterVol=.85;/* midi map backfill — projects saved before MIDI IN existed get an empty map */if(!p.midiMap||p.midiMap.version!==1||!p.midiMap.bindings||typeof p.midiMap.bindings!=='object')p.midiMap={version:1,bindings:{}};/* send-bus backfill: delay division + feedback (defaults 3/16, 35%) */if(!p.fx)p.fx={delayDiv:'3/16',delayFb:.35};if(p.fx.delayDiv!=='1/8'&&p.fx.delayDiv!=='3/16'&&p.fx.delayDiv!=='1/4')p.fx.delayDiv='3/16';if(p.fx.delayFb==null||!isFinite(p.fx.delayFb))p.fx.delayFb=.35;p.fx.delayFb=Math.max(0,Math.min(.8,p.fx.delayFb));I.p=p;I.hist=[];I.redo=[];I.dirty=false;I.pending=null;if(I.eng)I.eng.syncMix(p);I.renderDirty=true;if(I.copilotReload)I.copilotReload()}
/* MIDI param paths (v0.4.0): macro.<0-7> | master.vol | track.<i>.mix.vol |
   track.<i>.mix.pan | track.<i>.mix.sendA | track.<i>.mix.sendB |
   track.<i>.mix.mute | track.<i>.scAmount.
   resolveMidiParam is PURE w.r.t. the passed project (Bun-testable);
   applyMidiParam binds it to the live project + engine. mute toggles per
   received CC (CC 0 is ignored by the core, so button releases never fire). */
function resolveMidiParam(p,path,v01){
  if(!p)return false;
  const v=clamp(Number(v01)||0,0,1);
  const parts=String(path).split('.');
  if(parts[0]==='macro'){const idx=+parts[1];if(!(idx>=0&&idx<8&&p.macroVals))return false;p.macroVals[idx]=v;resolveMacros(p);return true}
  if(parts[0]==='master'&&parts[1]==='vol'){p.masterVol=clamp(v,0,1);return true}
  if(parts[0]==='track'){
    const t=p.tracks[+parts[1]];if(!t||!t.mix)return false;
    if(parts[2]==='scAmount'){t.scAmount=Math.round(v*100);return true}
    if(parts[2]==='mix'){
      if(parts[3]==='vol'){t.mix.vol=clamp(v,0,1);return true}
      if(parts[3]==='pan'){t.mix.pan=clamp(v*2-1,-1,1);return true}
      if(parts[3]==='sendA'){t.mix.sendA=clamp(v,0,1);return true}
      if(parts[3]==='sendB'){t.mix.sendB=clamp(v,0,1);return true}
      if(parts[3]==='mute'){t.mix.mute=!t.mix.mute;return true}
    }
  }
  return false;
}
function applyMidiParam(path,v01){if(!I.p)return false;const ok=resolveMidiParam(I.p,path,v01);if(ok){if(I.eng)I.eng.syncMix(I.p);if(I.eng&&I.eng.master&&I.p.masterVol!=null)I.eng.master.gain.value=I.p.masterVol;I.dirty=true;I.renderDirty=true}return ok}
function recHit(track,note,vel){if(!I.recOn||I.fsm!=='RECORDING')return;const grid=I.p.recQ||1,sc=I.sched;let best=null,bd=1e9;for(const r of sc.recent){const d=Math.abs(r.t-I.ctx.currentTime);if(d<bd){bd=d;best=r}}if(!best)return;const rem=best.s%grid,sAdj=rem>grid/2?best.s+(grid-rem):best.s-rem;const pat=I.p.patterns[I.p.currentPattern],d=pat.data[track];if(!d)return;const len=d.len,idx=((sAdj%len)+len)%len;pushHist();const st=d.steps[idx];st.on=1;st.vel=clamp(vel,.05,1);if(note!=null)st.note=note;I.dirty=true;I.renderDirty=true}

export { $, toast, I, pushHist, after, resolveMacros, PERF, K_MAIN, K_TMP, saveProject, loadStored, loadProjectObj, recHit, resolveMidiParam, applyMidiParam };
