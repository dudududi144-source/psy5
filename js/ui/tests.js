import { $, I, PERF, saveProject, loadStored } from '../state.js';
import { PooledEngine } from '../engine.js';
import { buildStyle, libFind, assignPresetToTrack } from '../presets.js';
import { stepEvents, fnv, SYNTH_VOICES, DRUM_VOICES, M_ENERGY } from '../model.js';
import { mulberry32, subSeed } from '../../foundation/foundation.mjs';
import { BanditLearner, BanditPolicy, contextKey } from '../../foundation/learning/bandit.mjs';

function logLine(cls,msg){const L=$('log');const s=document.createElement('span');s.className=cls;L.appendChild(s);s.textContent=msg+'\n';L.scrollTop=L.scrollHeight}
const GATE_RES=[];
function gate(id,claim,pass,ev){GATE_RES.push({id,claim,pass,ev});logLine(pass?'':'fail',(pass?'PASS':'FAIL')+' '+id+' — '+claim+(ev?' ['+ev+']':''))}
function peakOf(buf){const d=buf.getChannelData(0);let m=0;for(let i=0;i<d.length;i++){const a=Math.abs(d[i]);if(a>m)m=a}return m}
async function renderGenre(style){const sr=44100,oc=new OfflineAudioContext(2,sr*2,sr);const eng=new PooledEngine(oc);const p=buildStyle(style,1234);eng.syncMix(p);const sd=60/p.bpm/4;let t=.05;const total=Math.floor(1.8/sd);for(let s=0;s<total;s++){for(const ev of stepEvents(p,s)){const tr=p.tracks[ev.track];eng.trigger(tr,t+ev.off,ev,sd)}t+=sd}return await oc.startRendering()}
/* G9 — priority voice stealing under deliberate overload:
   64 consecutive open-hat 16ths (long decay → drum pool exhausted every hit)
   + kick on every 4th step, rendered with a 3-voice drum pool. Claim: the
   kick is never dropped (dedicated tier-0 voice retriggers), tier-0 is never
   stolen, and the hats starve among themselves (steal evidence > 0). */
async function renderSteal(){const sr=44100,oc=new OfflineAudioContext(2,sr*7,sr);const eng=new PooledEngine(oc,{drumVoices:3,synthVoices:4});const p=buildStyle('PSYTRANCE',42);assignPresetToTrack(p,2,libFind('HAT-TE-O'));eng.syncMix(p);const pat=p.patterns['A'];const put=(ti,i)=>{const d=pat.data[ti],L=d.len,s=d.steps[((i%L)+L)%L];s.on=1;s.vel=ti===0?.95:.6;s.prob=1};for(let i=0;i<64;i++){put(2,i);if(i%4===0)put(0,i)}p.currentPattern='A';const sd=60/p.bpm/4;let t=.05;for(let s=0;s<64;s++){for(const ev of stepEvents(p,s)){const tr=p.tracks[ev.track];eng.trigger(tr,t+ev.off,ev,sd)}t+=sd}const buf=await oc.startRendering();return {buf,eng}}
async function runSelfGate(){$('log').innerHTML='';GATE_RES.length=0;logLine('info','== PSY6 SELF-GATE (pooled engine, OfflineAudioContext) ==');for(const st of['TECHNO','PSYTRANCE','TRANCE','PROGRESSIVE']){try{const buf=await renderGenre(st);const pk=peakOf(buf);gate('G1-'+st,st+' renders non-silent audio',pk>0.05,'peak='+pk.toFixed(3))}catch(e){gate('G1-'+st,st+' renders non-silent audio',false,'ERR '+e.message)}}const h1=fnv(JSON.stringify(buildStyle('PSYTRANCE',42)));const h2=fnv(JSON.stringify(buildStyle('PSYTRANCE',42)));gate('G2','genre build deterministic (same seed = same hash)',h1===h2,'hash='+h1.slice(0,12));if(!I.p)I.p=buildStyle('TECHNO',1);const saved=saveProject();const loaded=loadStored();gate('G5','save/load byte-exact',saved.ok&&loaded&&JSON.stringify(loaded)===JSON.stringify(I.p),'round-trip');const c0=(I.p.tracks[5].sound.cutoff)||0;PERF.macro(M_ENERGY,1.0);const c1=I.p.tracks[5].sound.cutoff;PERF.macro(M_ENERGY,0.5);gate('G6','macro ENERGY resolves to real cutoff state',Math.abs(c1-c0)>1,'cutoff '+Math.round(c0)+'->'+Math.round(c1));gate('G8','voice pools pre-allocated',SYNTH_VOICES>0&&DRUM_VOICES>0,'synth='+SYNTH_VOICES+' drum='+DRUM_VOICES);try{const {buf,eng}=await renderSteal();const kicks=eng.trackCount[0],hats=eng.trackCount[2];const steals=eng.stealCount[1]+eng.stealCount[2]+eng.stealCount[3];const pk=peakOf(buf);const ok9=kicks===16&&hats===64&&eng.tier0StealAttempts===0&&steals>0&&pk>0.05;gate('G9','64 hats + kick every 4th step: kick never dropped, zero tier-0 voice starvation',ok9,'kicks='+kicks+'/16 hats='+hats+'/64 tier0Steals='+eng.tier0StealAttempts+' steals(h1/h2/h3)='+eng.stealCount[1]+'/'+eng.stealCount[2]+'/'+eng.stealCount[3]+' peak='+pk.toFixed(3))}catch(e){gate('G9','64 hats + kick every 4th step: kick never dropped, zero tier-0 voice starvation',false,'ERR '+e.message)}
/* G10 — co-pilot learner (foundation/learning/bandit.mjs): scripted 50-decision
   session where FILL always rewards 1 and VARIATION always 0 → the learner
   must rank FILL>VARIATION and exploit FILL; with ALL rewards below the
   abstain threshold the policy must fire DO_NOTHING (reason 'abstain'). */
try{
const g10seed='G10';const g10int=parseInt(fnv(g10seed).slice(0,8),16)>>>0;const mkL=()=>new BanditLearner({epsilon:0.1,minTrials:1,abstainThreshold:0.2,confidenceGrowth:0.1});
const L10=mkL();const g10ctx={gate:'g10'};
for(let i=0;i<50;i++){const d=L10.decide(g10ctx,'copilot',[{type:'fill'},{type:'variation'}],{rng:mulberry32(subSeed(g10int,'g10#'+i)),at:i});L10.recordOutcome(g10ctx,'copilot',d.action,d.action.type==='fill'?1:0,i)}
const recs10=L10.store.allRecords();const fR=recs10.find(r=>r.action.type==='fill');const vR=recs10.find(r=>r.action.type==='variation');
const probe=new BanditPolicy({epsilon:0,minTrials:1,abstainThreshold:0.2,confidenceGrowth:0.1}).decide(contextKey(g10ctx),'copilot',[{type:'fill'},{type:'variation'}],L10.store,mulberry32(subSeed(g10int,'g10probe')));
const L2=mkL();const g2ctx={gate:'g10-abstain'};
for(let i=0;i<12;i++){const d=L2.decide(g2ctx,'copilot',[{type:'fill'},{type:'variation'}],{rng:mulberry32(subSeed(g10int,'g10b#'+i)),at:i});L2.recordOutcome(g2ctx,'copilot',d.action,0,i)}
const ab=new BanditPolicy({epsilon:0,minTrials:1,abstainThreshold:0.2,confidenceGrowth:0.1}).decide(contextKey(g2ctx),'copilot',[{type:'fill'},{type:'variation'}],L2.store,mulberry32(subSeed(g10int,'g10ab')));
const st10=L10.stats();
const ok10=!!(fR&&vR&&fR.avgReward>vR.avgReward&&fR.avgReward===1&&probe.action.type==='fill'&&probe.reason==='exploit'&&ab.action.type==='do-nothing'&&ab.reason==='abstain');
gate('G10','co-pilot learns fill>variation preference and abstains under all-low rewards',ok10,'fillAvg='+(fR?fR.avgReward.toFixed(2):'?')+'(n='+(fR?fR.trials:0)+') varAvg='+(vR?vR.avgReward.toFixed(2):'?')+'(n='+(vR?vR.trials:0)+') probe='+probe.action.type+'/'+probe.reason+' abstain='+ab.reason+' dec='+st10.decisions)}catch(e){gate('G10','co-pilot learner preference + abstention',false,'ERR '+e.message)}const pass=GATE_RES.filter(g=>g.pass).length;logLine('warn','== SELF-GATE: '+pass+'/'+GATE_RES.length+' passed ==');const tb=$('gateTab');tb.style.display='';const body=tb.querySelector('tbody');body.innerHTML='';GATE_RES.forEach(g=>{const tr=document.createElement('tr');tr.innerHTML='<td class="mono">'+g.id+'</td><td>'+g.claim+'</td><td><span class="tag '+(g.pass?'t-V':'t-F')+'">'+(g.pass?'PASS':'FAIL')+'</span></td><td class="mono">'+(g.ev||'')+'</td>';body.appendChild(tr)})}

function wireTests(){$('bGate').onclick=runSelfGate;}

export { runSelfGate, wireTests };
