import { $, I, PERF, saveProject, loadStored, resolveMidiParam } from '../state.js';
import { createMidiCore, emptyMidiMap } from '../midi.js';
import { PooledEngine } from '../engine.js';
import { buildStyle, libFind, assignPresetToTrack } from '../presets.js';
import { stepEvents, fnv, SYNTH_VOICES, DRUM_VOICES, M_ENERGY } from '../model.js';
import { delaySecondsFor, irChannel, IR_SEEDS, IR_LEN_S, IR_DECAY } from '../../foundation/dsp/sends.mjs';
import { renderBounce, bounceSchedule } from '../bounce.js';
import { mkWorkletEngine, renderWorkletOffline } from '../worklet-engine.js';
import { mulberry32, subSeed } from '../../foundation/foundation.mjs';
import { BanditLearner, BanditPolicy, contextKey } from '../../foundation/learning/bandit.mjs';
import { armCapture, captureStop, captureState, captureResult } from './capture.js';
import { startSched } from '../scheduler.js';

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
/* G11 — kick-triggered sidechain ducking (offline render, real graph):
   bass audible, EVERYTHING else muted (mute silences the bus but the kick
   events still fire and still duck). Render A: all scAmount=0 (plain).
   Render B: bass scAmount=75. Window-RMS the bass envelope; the RATIO
   B/A isolates the duck from the synth's own note envelope.
   Claims: dip ≥60% within the attack window, full recovery (≥99%) before
   the next kick, and zero automation events when every scAmount=0. */
async function renderSidechain(scAmount){const sr=44100,oc=new OfflineAudioContext(2,sr*4,sr);const eng=new PooledEngine(oc);const p=buildStyle('PSYTRANCE',42);p.tracks.forEach((t,i)=>{t.mix.mute=i!==4;if(i===4){t.scAmount=scAmount;t.mix.vol=1}});eng.syncMix(p);const pat=p.patterns['A'];const sd=60/p.bpm/4;const kickT=[];let t=.05;for(let s=0;s<32;s++){if(s%4===0)kickT.push(t);for(const ev of stepEvents(p,s)){const tr=p.tracks[ev.track];eng.trigger(tr,t+ev.off,ev,sd)}t+=sd}const buf=await oc.startRendering();return {buf,kickT,sd,eng,duckEvents:eng.duckEvents}}
function winRMS(d,start,end){let s=0,n=0;const a=Math.max(0,start|0),b=Math.min(d.length,end|0);for(let i=a;i<b;i++){s+=d[i]*d[i];n++}return n?Math.sqrt(s/n):0}
async function runSelfGate(){$('log').innerHTML='';GATE_RES.length=0;if(I.engine==='worklet'){logLine('info','== PSY6 SELF-GATE — WORKLET engine (reduced but real: G2 + G14w + G15w) ==');await gateWorklet()}else{logLine('info','== PSY6 SELF-GATE — MAIN pooled engine (OfflineAudioContext) ==');for(const st of['TECHNO','PSYTRANCE','TRANCE','PROGRESSIVE']){try{const buf=await renderGenre(st);const pk=peakOf(buf);gate('G1-'+st,st+' renders non-silent audio',pk>0.05,'peak='+pk.toFixed(3))}catch(e){gate('G1-'+st,st+' renders non-silent audio',false,'ERR '+e.message)}}const h1=fnv(JSON.stringify(buildStyle('PSYTRANCE',42)));const h2=fnv(JSON.stringify(buildStyle('PSYTRANCE',42)));gate('G2','genre build deterministic (same seed = same hash)',h1===h2,'hash='+h1.slice(0,12));if(!I.p)I.p=buildStyle('TECHNO',1);const saved=saveProject();const loaded=loadStored();gate('G5','save/load byte-exact',saved.ok&&loaded&&JSON.stringify(loaded)===JSON.stringify(I.p),'round-trip');const c0=(I.p.tracks[5].sound.cutoff)||0;PERF.macro(M_ENERGY,1.0);const c1=I.p.tracks[5].sound.cutoff;PERF.macro(M_ENERGY,0.5);gate('G6','macro ENERGY resolves to real cutoff state',Math.abs(c1-c0)>1,'cutoff '+Math.round(c0)+'->'+Math.round(c1));gate('G8','voice pools pre-allocated',SYNTH_VOICES>0&&DRUM_VOICES>0,'synth='+SYNTH_VOICES+' drum='+DRUM_VOICES);try{const {buf,eng}=await renderSteal();const kicks=eng.trackCount[0],hats=eng.trackCount[2];const steals=eng.stealCount[1]+eng.stealCount[2]+eng.stealCount[3];const pk=peakOf(buf);const ok9=kicks===16&&hats===64&&eng.tier0StealAttempts===0&&steals>0&&pk>0.05;gate('G9','64 hats + kick every 4th step: kick never dropped, zero tier-0 voice starvation',ok9,'kicks='+kicks+'/16 hats='+hats+'/64 tier0Steals='+eng.tier0StealAttempts+' steals(h1/h2/h3)='+eng.stealCount[1]+'/'+eng.stealCount[2]+'/'+eng.stealCount[3]+' peak='+pk.toFixed(3))}catch(e){gate('G9','64 hats + kick every 4th step: kick never dropped, zero tier-0 voice starvation',false,'ERR '+e.message)}
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
gate('G10','co-pilot learns fill>variation preference and abstains under all-low rewards',ok10,'fillAvg='+(fR?fR.avgReward.toFixed(2):'?')+'(n='+(fR?fR.trials:0)+') varAvg='+(vR?vR.avgReward.toFixed(2):'?')+'(n='+(vR?vR.trials:0)+') probe='+probe.action.type+'/'+probe.reason+' abstain='+ab.reason+' dec='+st10.decisions)}catch(e){gate('G10','co-pilot learner preference + abstention',false,'ERR '+e.message)}
/* G11 — see renderSidechain above. */
try{
const plain=await renderSidechain(0),ducked=await renderSidechain(75);
const sr=plain.buf.sampleRate,dP=plain.buf.getChannelData(0),dD=ducked.buf.getChannelData(0);
const W=Math.floor(sr*.01);let dipMin=1,recoveryMin=1;const kicks=plain.kickT.slice(1,7);
for(const kt of kicks){const i0=Math.floor(kt*sr);
const pre=winRMS(dP,i0-W*3,i0)/Math.max(winRMS(dD,i0-W*3,i0),1e-9);if(pre<=0)continue;
let m=1;for(let w=0;w<8;w++){const r=winRMS(dD,i0+w*W/2,i0+w*W/2+W)/Math.max(winRMS(dP,i0+w*W/2,i0+w*W/2+W),1e-9);if(r<m)m=r}
dipMin=Math.min(dipMin,m);
const nk=kt+4*plain.sd;const rec=winRMS(dD,Math.floor((nk-.022)*sr),Math.floor(nk*sr))/Math.max(winRMS(dP,Math.floor((nk-.022)*sr),Math.floor(nk*sr)),1e-9);recoveryMin=Math.min(recoveryMin,rec)}
const dipPct=Math.round((1-dipMin)*100),recPct=Math.round(recoveryMin*100);
const amt0=plain.duckEvents,amt75=ducked.duckEvents;
const ok11=amt0===0&&amt75>0&&dipPct>=60&&recPct>=99;
gate('G11','sidechain: kick ducks scAmount>0 buses ≥60% in-window, full recovery, amount=0 → zero automation',ok11,'dipMin='+dipPct+'% recoveryMin='+recPct+'% amt0Events='+amt0+' amt75Events='+amt75)}catch(e){gate('G11','sidechain ducking',false,'ERR '+e.message)}
/* G12 — per-track delay/reverb sends: a single synth note @145 BPM on an
   otherwise silent mix; the tail window [0.7s,1.15s] contains ONLY send-bus
   output (direct sound has decayed). send=0 → tail silent; delay/reverb
   send>0 → tail has signal. Evidence includes the exact BPM-synced delay
   times for all three divisions and IR byte-identity vs the canonical PRNG. */
async function renderSend(sendA,sendB){const sr=44100,oc=new OfflineAudioContext(2,Math.round(sr*1.2),sr);const eng=new PooledEngine(oc);const p=buildStyle('TECHNO',7);p.bpm=145;p.tracks.forEach((t,i)=>{t.mix.mute=i!==5;t.mix.sendA=sendA;t.mix.sendB=sendB;if(i===5)t.mix.vol=1});eng.syncMix(p);const pat=p.patterns['A'];for(let t2=0;t2<8;t2++){const d=pat.data[t2];for(const s of d.steps)s.on=0}const stp=pat.data[5].steps[0];stp.on=1;stp.note=p.root+24;stp.vel=.9;p.currentPattern='A';const sd=60/p.bpm/4;eng.trigger(p.tracks[5],.1,{track:5,off:0,vel:.9,note:p.root+24,lock:{}},sd);const buf=await oc.startRendering();buf._eng=eng;return buf}
try{
const silence=await renderSend(0,0),dly=await renderSend(.9,0),rev=await renderSend(0,.9);
const sr=silence.sampleRate;
const rmsOf=(b,a,z)=>{const d=b.getChannelData(0);let s=0,n=0;for(let i=Math.floor(a*sr);i<Math.floor(z*sr);i++){s+=d[i]*d[i];n++}return n?Math.sqrt(s/n):0};
const r0=rmsOf(silence,.7,1.15),rd=rmsOf(dly,.7,1.15),rr=rmsOf(rev,.7,1.15);
const d8=(delaySecondsFor('1/8',145)*1000).toFixed(1),d316=(delaySecondsFor('3/16',145)*1000).toFixed(1),d4=(delaySecondsFor('1/4',145)*1000).toFixed(1);
const eng12=silence._eng;let irOK=false;try{const ref=irChannel(Math.round(sr*IR_LEN_S),IR_SEEDS[0],IR_DECAY);const got=eng12.conv.buffer.getChannelData(0);irOK=got.length===ref.length;for(let i=0;irOK&&i<ref.length;i++)if(got[i]!==ref[i])irOK=false}catch(e){irOK=false}
const ok12=r0<1e-4&&rd>0.001&&rr>0.001&&irOK;
gate('G12','sends: send>0 → signal in bus output, send=0 → silent tail; BPM-synced delay; byte-identical seeded IR',ok12,'sendRMS='+rd.toFixed(4)+' reverbRMS='+rr.toFixed(4)+' zeroRMS='+r0.toFixed(4)+' delay@145ms='+d8+'/'+d316+'/'+d4+' irIdentical='+irOK)}catch(e){gate('G12','sends',false,'ERR '+e.message)}
/* G13 — offline WAV bounce: default PSYTRANCE project, 2 loops through
   renderBounce() (fresh OfflineAudioContext — the live graph is untouched).
   Claims: the render spans the EXACT scheduled sample count, is non-silent,
   and the event schedule hash is identical across two renders (the same
   per-bar seeded event function the live scheduler uses). */
try{
const p13=buildStyle('PSYTRANCE',42);
const b13a=await renderBounce(p13,2),b13b=await renderBounce(p13,2);
const d13=b13a.buf.getChannelData(0);let s13=0;for(let i=0;i<d13.length;i++)s13+=d13[i]*d13[i];const rms13=Math.sqrt(s13/d13.length);
const schedId=b13a.scheduleHash===b13b.scheduleHash;
const ok13=b13a.buf.length===b13a.N&&b13b.buf.length===b13b.N&&b13a.N===b13b.N&&rms13>0.02&&schedId;
gate('G13','offline bounce: exact sample count, non-silent render, deterministic schedule',ok13,'samples='+b13a.N+'/'+b13b.N+' rms='+rms13.toFixed(3)+' schedIdentical='+schedId)}catch(e){gate('G13','offline bounce',false,'ERR '+e.message)}
/* G14 — the ACTIVE engine renders the default project (2 loops) non-silently
   with every scheduled event voiced (residual = scheduled − spawned = 0). */
try{
const sr=44100,p14=buildStyle('PSYTRANCE',42);
const sch14=bounceSchedule(p14,2,.05);
const oc=new OfflineAudioContext(2,Math.ceil(sch14.total*sr),sr);
const eng=new PooledEngine(oc);eng.syncMix(p14);
for(const e of sch14.evs)eng.trigger(p14.tracks[e.track],e.t,{track:e.track,off:0,vel:e.vel,note:e.note,lock:e.lock||{}},sch14.stepDur);
const buf=await oc.startRendering();
const residual=sch14.evs.length-eng.spawnCount;const pk=peakOf(buf);
gate('G14','engine renders the default project non-silently, every scheduled event voiced',pk>0.05&&residual===0,'peak='+pk.toFixed(3)+' residualEvents='+residual)}catch(e){gate('G14','engine render + drain',false,'ERR '+e.message)}
/* G15 — priority stealing at DEFAULT pools (24 drum voices): 64 open-hat
   16ths with decay=4 (~2.6 s busy each ≈ 25 concurrent) exhaust the drum
   pool; the kick (every 4th step) must never be dropped and tier-0 must
   never be a steal victim. */
try{
const sr=44100,oc=new OfflineAudioContext(2,sr*7,sr);
const eng=new PooledEngine(oc);
const p=buildStyle('PSYTRANCE',42);assignPresetToTrack(p,2,libFind('HAT-TE-O'));p.tracks[2].sound.decay=4;eng.syncMix(p);
const pat=p.patterns['A'];const put=(ti,i)=>{const d=pat.data[ti],L=d.len,s=d.steps[((i%L)+L)%L];s.on=1;s.vel=ti===0?.95:.6;s.prob=1};
for(let i=0;i<64;i++){put(2,i);if(i%4===0)put(0,i)}
p.currentPattern='A';const sd=60/p.bpm/4;let t=.05;
for(let s=0;s<64;s++){for(const ev of stepEvents(p,s)){const tr=p.tracks[ev.track];eng.trigger(tr,t+ev.off,ev,sd)}t+=sd}
const buf=await oc.startRendering();
const kicks=eng.trackCount[0],hatSteals=eng.stealCount[1],pk=peakOf(buf);
gate('G15','overload at DEFAULT pools: kick never dropped, tier-0 never stolen, hats starve among themselves',kicks===16&&eng.tier0StealAttempts===0&&hatSteals>0&&pk>0.05,'tier0Steals='+eng.tier0StealAttempts+' hatSteals='+hatSteals+' kicks='+kicks+'/16 peak='+pk.toFixed(3))}catch(e){gate('G15','overload at default pools',false,'ERR '+e.message)}
/* G16 — MIDI input core (js/midi.js): scripted session, exact assertions.
   note on → selected track (velocity/127 exact) · note off ×2 · CC learn
   binds the first received CC to the target path · that CC then moves
   scAmount to an exact value · CC 0 never consumed · CC 123 → panic ·
   midiMap round-trips through JSON byte-exact. */
try{
const p16=buildStyle('TECHNO',7);p16.midiMap=emptyMidiMap();
const notes16=[],offs16=[];let panics16=0,learnBind16=null;
const core16=createMidiCore({selectedTrack:()=>4,noteOn:(t,vel,note)=>notes16.push({t,vel,note}),noteOff:t=>offs16.push({t}),panic:()=>panics16++,dispatch:(path,v)=>resolveMidiParam(p16,path,v),onBind:(cc,path)=>{learnBind16={cc,path};p16.midiMap.bindings[cc]=path}});
core16.map=p16.midiMap;
const send16=a=>core16.onMessage({data:Uint8Array.from(a)});
send16([0x90,60,100]);send16([0x90,62,0]);send16([0x80,60,0]);
core16.beginLearn('track.2.scAmount');send16([0xB0,0,64]);/* CC0 must NOT be consumed */
const cc0kept=core16.learn==='track.2.scAmount'&&!p16.midiMap.bindings[0];
send16([0xB0,45,70]);/* first real CC → learn */
send16([0xB0,45,70]);/* now dispatches: scAmount=round(70/127*100)=55 */
send16([0xB0,123,0]);
const sc16=p16.tracks[2].scAmount;
const rt16=JSON.stringify(JSON.parse(JSON.stringify(p16.midiMap)))===JSON.stringify(p16.midiMap);
const n0=notes16[0]||{};
const ok16=notes16.length===1&&n0.t===4&&n0.note===60&&Math.abs(n0.vel-100/127)<1e-9&&offs16.length===2&&cc0kept&&!!learnBind16&&learnBind16.cc===45&&learnBind16.path==='track.2.scAmount'&&sc16===55&&panics16===1&&rt16;
gate('G16','midi: note→selected track w/ exact velocity, learn binds cc→param, cc moves scAmount to exact value, cc0 ignored, cc123 panics, map round-trips',ok16,'note=60/vel='+(n0.vel!=null?Math.round(n0.vel*127):'?')+'@t'+n0.t+' offs='+offs16.length+' learn='+(learnBind16?learnBind16.cc+'→'+learnBind16.path:'none')+' sc='+sc16+' cc0kept='+cc0kept+' panic='+panics16+' rt='+rt16)}catch(e){gate('G16','midi input core',false,'ERR '+e.message)}
/* G17 — live capture (REALTIME — local device only; CI asserts everything
   EXCEPT this gate). Through the REAL scheduler + ScriptProcessor tap on the
   master output: arm → recording starts on the next 16-step bar boundary →
   one full bar → stop arms on the following boundary → encoded by the
   EXISTING bounce WAV encoder. Assert: valid WAV header (RIFF/WAVE/PCM16/
   stereo, data=frames×4), duration within ±50 ms of one bar, RMS > 0.001. */
try{
if(!I.eng||!I.ctx)throw new Error('no engine');
if(!['PLAYING','RECORDING','TRANSITIONING'].includes(I.fsm)){I.fsm='PLAYING';startSched()}/* the gate needs the real transport — start it like power-on does */
const barSec=16*60/I.p.bpm/4;
const armR=armCapture();if(!armR.ok)throw new Error('arm failed');
const dl17=Date.now()+barSec*1000+6000;
while(captureState().state!=='capturing'&&Date.now()<dl17)await new Promise(r=>setTimeout(r,60));
if(captureState().state!=='capturing')throw new Error('start boundary never hit');
captureStop();
const dl17b=Date.now()+barSec*1000+6000;
while(captureState().state!=='idle'&&Date.now()<dl17b)await new Promise(r=>setTimeout(r,60));
if(captureState().state!=='idle')throw new Error('stop boundary never hit');
const res17=captureResult();if(!res17)throw new Error('no capture result');
const v17=new DataView(res17.wav);
const tag17=o=>String.fromCharCode(v17.getUint8(o),v17.getUint8(o+1),v17.getUint8(o+2),v17.getUint8(o+3));
const dur17=res17.frames/res17.sampleRate;
const hdr17=tag17(0)==='RIFF'&&tag17(8)==='WAVE'&&v17.getUint16(22,true)===2&&v17.getUint16(34,true)===16&&v17.getUint32(40,true)===res17.frames*4;
const ok17=hdr17&&Math.abs(dur17-barSec)<=.05&&res17.rms>0.001;
gate('G17','live capture: real tap, bar-quantized start/stop, bounce-encoder WAV, non-silent',ok17,'frames='+res17.frames+' dur='+dur17.toFixed(3)+'s bar='+barSec.toFixed(3)+'s skew='+((dur17-barSec)*1000).toFixed(0)+'ms rms='+res17.rms.toFixed(4)+' hdr='+hdr17)}catch(e){gate('G17','live capture (realtime)',false,'ERR '+e.message)}
/* G18 — per-track stems (offline — CI-asserted): a 2-track project with
   NON-OVERLAPPING events (kick @ step 4, bass @ step 12) renders each track
   through the SAME deterministic bounce graph with only that track's events.
   Isolation semantics, stated honestly: a stem contains ONLY its own track —
   regions where the track has NO voice at all are EXACTLY 0 (stem1's silence
   spans the kick's whole timeframe → the kick contributes exactly 0 to the
   bass stem); the residual after a track's own voice is its own exponential
   decay tail (bounded ≤ 1e-3), physics not bleed. Assert: no-voice regions
   exactly 0, own regions > 1e-3, identical span, deterministic schedules. */
try{
const p18=buildStyle('TECHNO',7);p18.bpm=128;
const pat18=p18.patterns['A'];
for(let t=0;t<8;t++){pat18.data[t].len=16;for(const s of pat18.data[t].steps)s.on=0}
pat18.data[0].steps[4].on=1;pat18.data[0].steps[4].vel=.95;pat18.data[0].steps[4].note=48;
pat18.data[4].steps[12].on=1;pat18.data[4].steps[12].vel=.9;pat18.data[4].steps[12].note=p18.root+24;
/* clean-room isolation: no FX sends (a track's own delay/reverb tail is its own stem output, but here we want pure silence before each event) */
p18.tracks[0].mix.sendA=0;p18.tracks[0].mix.sendB=0;
p18.tracks[4].mix.sendA=0;p18.tracks[4].mix.sendB=0;
p18.currentPattern='A';
const sd18=60/p18.bpm/4,kT=.05+4*sd18,bT=.05+12*sd18;
const s18a=await renderBounce(p18,1,{trackIdx:0});
const s18b=await renderBounce(p18,1,{trackIdx:4});
const dur18=s18a.N/44100-0.005;
const rmsW=(b,a,z)=>{const d=b.getChannelData(0);let s=0,n=0;const zz=Math.min(Math.floor(z*44100),d.length);for(let i=Math.floor(a*44100);i<zz;i++){s+=d[i]*d[i];n++}return n?Math.sqrt(s/n):0};
const kickIn=rmsW(s18a.buf,kT,kT+.6),kickSilent=rmsW(s18a.buf,.06,kT-.05);
const bassIn=rmsW(s18b.buf,bT,dur18),bassSilent=rmsW(s18b.buf,.06,bT-.05);/* spans the kick timeframe → kick contributes exactly 0 */
const kickTail=rmsW(s18a.buf,bT,dur18);/* after the kick: only its own decay tail may remain */
const s18a2=await renderBounce(p18,1,{trackIdx:0});
const det18=s18a.scheduleHash===s18a2.scheduleHash&&s18a.scheduleHash!==s18b.scheduleHash;
const ok18=s18a.N===s18b.N&&kickIn>0.001&&bassIn>0.001&&kickSilent===0&&bassSilent===0&&kickTail<=0.001&&det18;
gate('G18','stems: per-track isolation — no-voice regions exactly 0 (incl. the other track\u2019s whole timeframe), deterministic per-track schedules',ok18,'kickRMS='+kickIn.toFixed(4)+' bassRMS='+bassIn.toFixed(4)+' silentRegions=0/0 kickOwnTail='+kickTail.toFixed(6)+' N='+s18a.N+' det='+det18)}catch(e){gate('G18','stems',false,'ERR '+e.message)}}const pass=GATE_RES.filter(g=>g.pass).length;logLine('warn','== SELF-GATE: '+pass+'/'+GATE_RES.length+' passed ==');window.__psy6Gates=GATE_RES.slice(); /* machine-readable evidence for tools/e2e.mjs (headless CI) */const tb=$('gateTab');tb.style.display='';const body=tb.querySelector('tbody');body.innerHTML='';GATE_RES.forEach(g=>{const tr=document.createElement('tr');tr.innerHTML='<td class="mono">'+g.id+'</td><td>'+g.claim+'</td><td><span class="tag '+(g.pass?'t-V':'t-F')+'">'+(g.pass?'PASS':'FAIL')+'</span></td><td class="mono">'+(g.ev||'')+'</td>';body.appendChild(tr)})}

/* ── WORKLET reduced gate set (G2 + G14w + G15w) — real checks, real stats.
   G2: deterministic model build (engine-independent).
   G14w: boot + sample-accurate queue drain + every kick voiced + non-silent.
   G15w: priority stealing under overload via worklet stats (kicks all voiced,
         tier-0 never a victim, hats steal among themselves).
   Offline renders deliver commands via processorOptions.initialMessages —
   the offline render thread never drains its input message queue. */
async function gateWorklet(){
try{const h1=fnv(JSON.stringify(buildStyle('PSYTRANCE',42)));const h2=fnv(JSON.stringify(buildStyle('PSYTRANCE',42)));gate('G2','genre build deterministic (same seed = same hash)',h1===h2,'hash='+h1.slice(0,12))}catch(e){gate('G2','genre build deterministic',false,'ERR '+e.message)}
try{
const p14=buildStyle('PSYTRANCE',42);
const sd14=60/p14.bpm/4,kicks=8;
const evs=[];for(let i=0;i<kicks;i++)evs.push({tr:p14.tracks[0],when:.1+i*4*sd14,ev:{vel:.95,note:48,lock:{}},stepDur:sd14});
const {buf,we}=await renderWorkletOffline(p14,evs,4);
const pk=peakOf(buf);const st=we.stats;
const residual=st?st.eventCount:-1;
const trig=st&&st.voiceTriggers?st.voiceTriggers[0]:-1;
gate('G14w','worklet: boot + sample-accurate queue drain + all kicks voiced + non-silent',pk>0.05&&residual===0&&trig===kicks,'peak='+pk.toFixed(3)+' residualEvents='+residual+' kicksVoiced='+trig+'/'+kicks)}catch(e){gate('G14w','worklet boot+render',false,'ERR '+e.message)}
try{
const p15=buildStyle('PSYTRANCE',42);
assignPresetToTrack(p15,2,libFind('HAT-TE-O'));/* hatO → V_HAT_OPEN — 0.33 s busy each */
const sd=60/p15.bpm/4;
/* 3 open hats per step ×64 steps (~9.6 concurrent vs a 4-voice hat pool)
   genuinely exhausts the pool; kick every 4th step must still voice every
   time, tier-0 never a victim. Total events 208 ≤ MAX_EVENTS(256) — the
   bounded queue must NOT drop anything. */
const evs=[];for(let i=0;i<64;i++){for(let k=0;k<3;k++)evs.push({tr:p15.tracks[2],when:.1+i*sd+.0001*k,ev:{vel:.6,note:60,lock:{}},stepDur:sd});if(i%4===0)evs.push({tr:p15.tracks[0],when:.1+i*sd,ev:{vel:.95,note:48,lock:{}},stepDur:sd})}
const {buf,we}=await renderWorkletOffline(p15,evs,7);
const pk=peakOf(buf);const st=we.stats;
const sc=st?st.stealCount:[-1,-1,-1,-1];const vt=st&&st.voiceTriggers?st.voiceTriggers:[-1];
const kicks=16;
gate('G15w','worklet: priority stealing under overload — all kicks voiced, tier-0 never a victim',vt[0]===kicks&&sc[0]===0&&sc[1]>0&&pk>0.05,'tier0Victims='+sc[0]+' hatSteals='+sc[1]+' kicksVoiced='+vt[0]+'/'+kicks+' peak='+pk.toFixed(3))}catch(e){gate('G15w','worklet overload',false,'ERR '+e.message)}
}

function wireTests(){$('bGate').onclick=runSelfGate;}

export { runSelfGate, wireTests };
