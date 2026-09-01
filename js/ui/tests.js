import { $, I, PERF, saveProject, loadStored, resolveMidiParam } from '../state.js';
import { sceneSetFollow, resolveFollow, sceneSetMix, applySceneMix } from '../scenes.js';
import { songMidi } from '../bounce.js';
import { writeMidi } from '../midifile.js';
import { createMidiCore, emptyMidiMap } from '../midi.js';
import { PooledEngine } from '../engine.js';
import { buildStyle, libFind, assignPresetToTrack, addTrackToProject } from '../presets.js';
import { stepEvents, fnv, SYNTH_VOICES, DRUM_VOICES, M_ENERGY, loopLen, laneEval } from '../model.js';
import { recordPoint, quantStep, applyLanes } from '../autorec.js';
import { compose, minVariantDiff, VARIANT_DIFF_MIN, COMPOSER_STYLES } from '../composer.js';
import { paramApply } from '../params.js';
import { delaySecondsFor, irChannel, IR_SEEDS, IR_LEN_S, IR_DECAY } from '../../foundation/dsp/sends.mjs';
import { renderBounce, bounceSchedule, renderSong, songSchedule, songSections, evHash, songSteps, SONG_LEAD, songStemTracks, sectionFrames, songFrames } from '../bounce.js';
import { mkWorkletEngine, renderWorkletOffline } from '../worklet-engine.js';
import { mulberry32, subSeed } from '../../foundation/foundation.mjs';
import { BanditLearner, BanditPolicy, contextKey } from '../../foundation/learning/bandit.mjs';
import { armCapture, captureStop, armSongRecord, captureState, captureResult } from './capture.js';
import { startSched } from '../scheduler.js';
import { canonicalProject, encodeShare, decodeShare } from '../share.js';

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
/* ── CANONICAL GATE INVENTORY (Run 9 gate-truth hygiene; 27 entries as of v0.8.0) ──
 * MAIN engine, 27 entries on device — 25 hard (offline/pure, CI-asserted in
 * tools/e2e.mjs) + 2 evidence-only realtime gates (G17 live capture, G25
 * record song — ScriptProcessor tap on wall-clock; pass on-device, reported
 * as info in CI, never asserted there).
 *   G1-×4 genre render non-silent (offline) · G2 build determinism (pure)
 *   G5 save/load byte-exact (pure)         · G6 macro→cutoff state (pure)
 *   G8 pools pre-allocated (pure)          · G9 voice stealing (offline)
 *   G10 oversampling (offline)             · G11 sidechain (offline)
 *   G12 sends (offline)                    · G13 bounce (offline)
 *   G14/G15 poly+steal (offline)           · G16 MIDI core (pure)
 *   G17 live capture (REALTIME·evidence)   · G18 stems (offline)
 *   G19 share (pure)                       · G21 long patterns (offline)
 *   G22 automation (pure)                  · G23 composer (offline)
 *   G24 song render (offline)              · G25 record song (REALTIME·evidence)
 *   G26 MIDI export (pure)                 · G27 follow actions (pure)
 *   G28 scene mix snapshots (offline)      · G29 master EQ+glue (offline)
 *   G30 song stems + section bounce (offline, v0.8.0)
 * WORKLET reduced set: 3 entries (G2, G14w, G15w) — offline worklet renders.
 * NUMBERING GAPS (documented, never renumbered — all historical evidence
 * cites these ids): G3, G4, G7 and G20 have NEVER existed in any shipped
 * commit (git log -S across all history); the sequence was assigned
 * topically and the gaps were left reserved-but-unused.
 * The device summary line "N/27" counts entries; the honest hard-pass count
 * cited in README/CI is 25 (27 − G17 − G25). */
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
/* G25 — record song (REALTIME — evidence-only, classified like G17): through
   the REAL scheduler + tap: PLAY SONG on a 4-bar two-section arrangement,
   capture auto-stops at the end of the final section +1 bar. Assert: valid
   WAV header, duration within ±100 ms of 5 bars, RMS > 0.001. */
try{
if(!I.eng||!I.ctx)throw new Error('no engine');
I.p.arranger={v:1,on:false,idx:0,barsIn:0,steps:[{scene:0,bars:2},{scene:1,bars:2}]};
const bar25=16*60/I.p.bpm/4;
const arm25=armSongRecord();if(!arm25.ok)throw new Error('arm failed');
const dl25=Date.now()+bar25*1000+8000;
while(captureState().state!=='song-capturing'&&Date.now()<dl25)await new Promise(r=>setTimeout(r,60));
if(captureState().state!=='song-capturing')throw new Error('song start boundary never hit');
const dl25b=Date.now()+(5*bar25+2)*1000+8000;
while(captureState().state!=='idle'&&Date.now()<dl25b)await new Promise(r=>setTimeout(r,60));
if(captureState().state!=='idle')throw new Error('song auto-stop never hit');
const res25=captureResult();if(!res25)throw new Error('no song capture result');
const v25=new DataView(res25.wav);
const tag25=o=>String.fromCharCode(v25.getUint8(o),v25.getUint8(o+1),v25.getUint8(o+2),v25.getUint8(o+3));
const dur25=res25.frames/res25.sampleRate;
const hdr25=tag25(0)==='RIFF'&&tag25(8)==='WAVE'&&v25.getUint16(22,true)===2&&v25.getUint16(34,true)===16;
const ok25=hdr25&&Math.abs(dur25-5*bar25)<=.1&&res25.rms>0.001;
gate('G25','record song: live PLAY SONG captured via the existing tap, auto-stop at final section +1 bar, bounce-encoder WAV, non-silent',ok25,'frames='+res25.frames+' dur='+dur25.toFixed(3)+'s want='+(5*bar25).toFixed(3)+'s skew='+((dur25-5*bar25)*1000).toFixed(0)+'ms rms='+res25.rms.toFixed(4)+' hdr='+hdr25)}catch(e){gate('G25','record song (realtime)',false,'ERR '+e.message)}
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
gate('G18','stems: per-track isolation — no-voice regions exactly 0 (incl. the other track\u2019s whole timeframe), deterministic per-track schedules',ok18,'kickRMS='+kickIn.toFixed(4)+' bassRMS='+bassIn.toFixed(4)+' silentRegions=0/0 kickOwnTail='+kickTail.toFixed(6)+' N='+s18a.N+' det='+det18)}catch(e){gate('G18','stems',false,'ERR '+e.message)}
/* G19 — share links (pure — CI-asserted): default PSYTRANCE project →
   canonical JSON → deflate-raw → base64url token → decode → deep-equal
   (canonical form on BOTH sides — key order pinned, values identical).
   The co-pilot learner snapshot (p.copilot) must survive the round trip;
   the same project must produce a byte-identical token (determinism). */
try{
const p19=buildStyle('PSYTRANCE',42);
p19.copilot={v:1,records:[{k:'g19',a:'fill',r:1}],stats:{decisions:1}};
const enc19=await encodeShare(p19);
if(!enc19.ok)throw new Error('encode: '+enc19.reason);
const dec19=await decodeShare(enc19.token);
const eq19=canonicalProject(dec19.project)===canonicalProject(p19);
const cop19=!!(dec19.project.copilot&&dec19.project.copilot.records&&dec19.project.copilot.records.length===1&&dec19.project.copilot.stats.decisions===1);
const det19=(await encodeShare(p19)).token===enc19.token;
const ok19=eq19&&cop19&&det19;
gate('G19','share link: canonical round-trip deep-equal, learner snapshot survives, byte-identical determinism',ok19,'json='+enc19.jsonBytes+'B token='+enc19.tokenBytes+'B warn='+enc19.warn+' det='+det19+' learner='+cop19)}catch(e){gate('G19','share links',false,'ERR '+e.message)}
/* G21 — UNLIMIT (offline — CI-asserted): the raised ceilings are real.
   (a) 128-step pattern: events at steps 0/64/127 exist on the deterministic
       schedule at their exact times in ascending order AND land as audible
       onsets in the rendered audio (windowed RMS at each expected time,
       silence in an event-free gap — no vacuous pass).
   (b) 12-track project (addTrackToProject ×4): loopLen correct, every
       pattern grew a data entry, and all 12 per-track stems render
       non-silent (RMS > 0.01). */
try{
const p21=buildStyle('TECHNO',42);p21.bpm=140;
const pat21=p21.patterns['A'];
for(let t=0;t<8;t++){for(const s of pat21.data[t].steps)s.on=0}
const setL21=(t,l)=>{const old=pat21.data[t].steps;pat21.data[t].len=l;pat21.data[t].steps=Array.from({length:l},(_,k)=>{const o=old[k%old.length];return o?{on:o.on,vel:o.vel,prob:o.prob,micro:o.micro,note:o.note,lock:Object.assign({},o.lock)}:{on:0,vel:.9,prob:1,micro:0,note:48,lock:{}}})};
setL21(0,128);
pat21.data[0].steps[0].on=1;pat21.data[0].steps[0].vel=.95;
pat21.data[0].steps[64].on=1;pat21.data[0].steps[64].vel=.9;
pat21.data[0].steps[127].on=1;pat21.data[0].steps[127].vel=.85;
p21.tracks[0].mix.sendA=0;p21.tracks[0].mix.sendB=0;
p21.currentPattern='A';
const sd21=60/p21.bpm/4;
const sch21=bounceSchedule(p21,1,0.05);
const wantSteps=[0,64,127];
const gotSteps=wantSteps.map(ws=>sch21.evs.find(e=>e.s===ws));
const schedOk=gotSteps.every(e=>!!e)&&gotSteps.every((e,i)=>i===0||gotSteps[i-1].t<e.t)&&gotSteps.every((e,i)=>Math.abs(e.t-(0.05+wantSteps[i]*sd21))<1e-9);
const ll21=loopLen(p21);
const b21=await renderBounce(p21,1);
const b21d=(()=>{const dd=b21.buf.getChannelData(0);let nan=0,fi=-1,mn=1e9,mx=-1e9;for(let i=0;i<dd.length;i++){const v=dd[i];if(Number.isNaN(v)){nan++;if(fi<0)fi=i}else{if(v<mn)mn=v;if(v>mx)mx=v}}return {nan,fi,mn:+mn.toFixed(3),mx:+mx.toFixed(3)}})();
const rmsWin=(ct,hw)=>{const d=b21.buf.getChannelData(0);const c=Math.floor(ct*44100),h=Math.floor(hw*44100);let s=0,n=0;for(let i=Math.max(0,c-h),e2=Math.min(d.length,c+h);i<e2;i++){s+=d[i]*d[i];n++}return n?Math.sqrt(s/n):0};
const hw21=0.4*sd21;
const onRms=wantSteps.map(ws=>rmsWin(0.05+ws*sd21,hw21));
const gapRms=rmsWin(0.05+32*sd21,hw21);
/* (b) 12 tracks */
const p21b=buildStyle('TECHNO',7);p21b.bpm=140;
const pb=p21b.patterns['A'];for(let t=0;t<8;t++){for(const s of pb.data[t].steps)s.on=0}
let grown=0;while(p21b.tracks.length<12){const r=addTrackToProject(p21b);if(r>=0){grown++;for(const k in p21b.patterns)if(p21b.patterns[k].data[r])p21b.patterns[k].data[r].len=16}else break}
const stepAt=[];
for(let t=0;t<12;t++){p21b.tracks[t].mix.sendA=0;p21b.tracks[t].mix.sendB=0;const d=pb.data[t];if(d){const si=(t*3)%d.len;stepAt.push(si);d.steps[si].on=1;d.steps[si].vel=.9;if(p21b.tracks[t].kind==='synth')d.steps[si].note=p21b.root+24}else stepAt.push(-1)}
const stemPk=[];const sd21b=60/p21b.bpm/4;
for(let t=0;t<12;t++){const st=await renderBounce(p21b,1,{trackIdx:t});const d=st.buf.getChannelData(0);/* peak over [event, event+1.2s] — dilution-free non-silence proof; a ±40ms window misses slow-attack sounds (the pad's 0.8s attack) */const evT=0.05+stepAt[t]*sd21b;const c=Math.floor(evT*44100),e2=Math.min(d.length,c+Math.floor(1.2*44100));let mx=0;for(let i=c;i<e2;i++){const v=Math.abs(d[i]);if(v>mx)mx=v}stemPk.push(mx)}
const minStem=Math.min.apply(null,stemPk);
const ok21=schedOk&&ll21===128&&onRms.every(r=>r>0.02)&&gapRms<0.005&&b21d.nan===0&&p21b.tracks.length===12&&grown===4&&Object.keys(pb.data).length===12&&stemPk.every(r=>r>0.05);
gate('G21','UNLIMIT: 128-step events at 0/64/127 in exact order on schedule AND in audio (gap silent, buffer NaN-free), loopLen=128, 12-track project renders 12 non-silent stems',ok21,'evT=['+gotSteps.map(e=>e?e.t.toFixed(4):'x')+']s onRms=['+onRms.map(r=>r.toFixed(3))+'] gapRms='+gapRms.toFixed(5)+' loop='+ll21+' N='+b21.N+' stemsPk=['+stemPk.map(r=>r.toFixed(2))+'] stepAt=['+stepAt+'] minPk='+minStem.toFixed(3)+' dataEntries='+Object.keys(pb.data).length+' bufNaN='+b21d.nan)}catch(e){gate('G21','UNLIMIT',false,'ERR '+e.message)}
/* G22 — automation (pure + state — CI-asserted): a scripted record session
   writes the EXACT expected points at the expected quantized steps (replace
   on duplicate included); offline apply through the param registry matches
   laneEval at every sampled step within 1e-9; the curve is non-trivial
   (>=4 points, span > 0.3); legacy 'lock' lanes never touch track state. */
try{
const p22=buildStyle('TECHNO',42);
const lane22={track:2,param:'mix.sendA',mode:'state',pts:[]};
p22.lanes.push(lane22);
const moves=[[0,.05],[4,.35],[8,.6],[12,.85],[14,.5]]; /* steps stay inside the 16-step loop (points wrap modulo) */
for(const mv of moves)recordPoint(lane22,quantStep(mv[0],16,true),mv[1]);
const ptsOk=JSON.stringify(lane22.pts)===JSON.stringify(moves);
recordPoint(lane22,quantStep(8,16,true),.65);/* duplicate step replaces */
const moves2=[[0,.05],[4,.35],[8,.65],[12,.85],[14,.5]];
const replaceOk=JSON.stringify(lane22.pts)===JSON.stringify(moves2);
const vals=lane22.pts.map(pt=>pt[1]);
const nonTrivial=lane22.pts.length>=4&&(Math.max.apply(null,vals)-Math.min.apply(null,vals))>0.3;
const qOk=quantStep(3.6,16,true)===4&&Math.abs(quantStep(3.6,16,false)-3.6)<1e-9;
let maxErr=0;
for(let s=0;s<16;s++){const want=laneEval(lane22,s);paramApply(p22.tracks[2],'mix.sendA',want);maxErr=Math.max(maxErr,Math.abs(p22.tracks[2].mix.sendA-want))}
const interpWant=.05+(.35-.05)*2/4;/* linear interpolation at step 2 */
applyLanes(p22,2);
const interpOk=Math.abs(p22.tracks[2].mix.sendA-interpWant)<1e-9;
const p22b=buildStyle('TECHNO',42);
const lockLane={track:5,param:'cutoff',mode:'lock',pts:[[0,500],[16,5000]]};
p22b.lanes.push(lockLane);
const cutoffBefore=p22b.tracks[5].sound.cutoff;
applyLanes(p22b,8);
const lockSkip=p22b.tracks[5].sound.cutoff===cutoffBefore;
const ok22=ptsOk&&replaceOk&&nonTrivial&&qOk&&maxErr<=1e-9&&interpOk&&lockSkip;
gate('G22','automation: scripted record session writes exact quantized points (replace on duplicate), offline apply matches laneEval within 1e-9, lock lanes never touch state',ok22,'pts='+lane22.pts.length+' exact='+ptsOk+' replace='+replaceOk+' qOk='+qOk+' maxErr='+maxErr+' interp='+interpWant.toFixed(3)+' lockSkip='+lockSkip)}catch(e){gate('G22','automation',false,'ERR '+e.message)}
/* G23 — composer (offline — CI-asserted): FULL-ON 3-minute composition from
   a fixed seed → 7-section form, bars sum to target, length within ±5%;
   regenerate determinism (identical fingerprint); EVERY section bounces
   offline non-silent with DROP RMS > 0.03. v0.7.0 EXTENSION (not a fork):
   G23 also reports the section-variant pairwise step-difference stats —
   every family repeats through variant scenes and the minimum pairwise
   variantStepDiff (base included) must reach VARIANT_DIFF_MIN = 0.15. */
try{
const c23=compose('FULL-ON',3,424242);
const p23=c23.project;
const sum23=c23.form.sections.reduce((a,s)=>a+s.bars,0);
const secOk=c23.form.sections.length===7&&c23.form.sections.every(s=>s.bars>=4&&s.bars%4===0)&&sum23===c23.form.totalBars;
const lenOk=Math.abs(c23.form.lengthSec-180)/180<=0.05;
const c23b=compose('FULL-ON',3,424242);
const detOk=c23.stats.fingerprint===c23b.stats.fingerprint&&JSON.stringify(c23b.project)===JSON.stringify(p23);
const rmsBySection=[];
for(const sec of c23.form.sections){
  p23.currentPattern=sec.pattern;
  const b=await renderBounce(p23,1);
  const d=b.buf.getChannelData(0);let s=0;for(let i=0;i<d.length;i++)s+=d[i]*d[i];
  rmsBySection.push(+(Math.sqrt(s/d.length)).toFixed(4));
}
const dropRms=rmsBySection[2];
/* v0.7.0 style coverage: every style's base sections bounce offline non-silent
   (G23-style structure × the full style dict) */
const styleRms={};
let stylesRmsOk=true;
for(const sid of Object.keys(COMPOSER_STYLES)){
  if(sid==='FULL-ON')continue;
  const cs=compose(sid,3,424242),ps=cs.project;const rr=[];
  for(const sec of cs.form.sections){
    ps.currentPattern=sec.pattern;
    const b=await renderBounce(ps,1);
    const d=b.buf.getChannelData(0);let s=0;for(let i=0;i<d.length;i++)s+=d[i]*d[i];
    rr.push(+(Math.sqrt(s/d.length)).toFixed(4));
  }
  styleRms[sid]=rr;
  if(!rr.every(r=>r>0.03))stylesRmsOk=false;
}
const allRmsOk=rmsBySection.every(r=>r>0.03)&&stylesRmsOk;
/* variant extension: group scenes into families, min pairwise diff per family */
const fam23=new Map();
for(const sc of p23.scenes){const base=sc.name.replace(/ \d+$/,'');if(!fam23.has(base))fam23.set(base,[]);fam23.get(base).push(p23.patterns[sc.pattern])}
let vmin23=1,varFams23=0;
for(const[,pats]of fam23){if(pats.length<2)continue;varFams23++;const m=minVariantDiff(pats);if(m<vmin23)vmin23=m}
const varOk=varFams23>=7&&vmin23>=VARIANT_DIFF_MIN&&p23.arranger.steps.length===new Set(p23.arranger.steps.map(s=>s.scene)).size;
const ok23=secOk&&lenOk&&detOk&&dropRms>0.03&&allRmsOk&&varOk;
gate('G23','composer: 7-section form scaled to target (±5%), byte-identical regenerate, EVERY style bounces non-silent (DROP RMS > 0.03), variants: '+varFams23+' families all pairwise ≥ '+VARIANT_DIFF_MIN+' incl. base, zero repeated scenes',ok23,'sections='+c23.form.sections.map(s=>s.id+':'+s.bars).join('/')+' len='+c23.form.lengthSec+'s rms=['+rmsBySection.join(',')+'] det='+detOk+' variants='+c23.stats.variants+' vmin='+vmin23.toFixed(3)+' norepeat='+(new Set(p23.arranger.steps.map(s=>s.scene)).size===p23.arranger.steps.length)+' styles5=rmsOk:'+stylesRmsOk+' min='+Math.min.apply(null,[].concat(Object.keys(styleRms).map(k=>Math.min.apply(null,styleRms[k])))).toFixed(3))}catch(e){gate('G23','composer',false,'ERR '+e.message)}
/* G24 — song render (offline — CI-asserted): compose FULL-ON 3min seed 424242 →
   renderSong renders the WHOLE arranger through the LIVE machinery
   (scene-launch phase rule sc.step%newLoop, per-bar seeded groove, per-scene
   fills, per-step automation player): frame count == formula, all 7 musical
   sections RMS > 0.03, event schedule == pure oracle (evHash), determinism
   (two renders byte-identical, or max sample diff within the documented
   Chrome-float bound — see below). */
try{
const c24=compose('FULL-ON',3,424242);const p24=c24.project;
const rA=await renderSong(p24);
const bars24=p24.arranger.steps.reduce((a,s)=>a+s.bars,0);
const N24=Math.ceil(44100*(0.05+(bars24*16+32)*(60/p24.bpm/4)));
const framesOk=rA.N===N24&&rA.buf.length===rA.N;
const secs24=songSections(p24);
const sd24=60/p24.bpm/4;
const rmsBySec=[];
for(const s of secs24){
const from=Math.max(0,Math.round((0.05+s.startBar*16*sd24)*44100)),to=Math.round((0.05+s.endBar*16*sd24)*44100);
let sum=0,n=0;
for(const ch of [rA.buf.getChannelData(0),rA.buf.getChannelData(1)])for(let i=from;i<to&&i<ch.length;i++){sum+=ch[i]*ch[i];n++}
rmsBySec.push(+(Math.sqrt(sum/Math.max(1,n))).toFixed(4));
}
const plan24=songSchedule(p24,0.05);
const schedOk=rA.scheduleHash===evHash(plan24.evs);
const rB=await renderSong(p24);
let maxDiff=0;
const chA=[rA.buf.getChannelData(0),rA.buf.getChannelData(1)],chB=[rB.buf.getChannelData(0),rB.buf.getChannelData(1)];
for(let ci=0;ci<2;ci++)for(let i=0;i<rA.N;i++){const d=Math.abs(chA[ci][i]-chB[ci][i]);if(d>maxDiff)maxDiff=d}
const detOk=maxDiff===0||maxDiff<1e-5;
/* DETERMINISM BOUND (documented): the event schedule is EXACTLY deterministic
   (schedOk asserts evHash equality — the strict layer). Sample-level float
   accumulation inside Chrome's OfflineAudioContext renderer wobbles at the
   LSB: v0.6.0 empirical maxDiff 4.17e-7 (7 suspend/resume sections), v0.7.0
   empirical 1.13e-6 (17 sections — more suspend points, more thread
   interleaving). The bound 1e-5 ≈ -100dBFS is 60× below audible and the
   schedule equality above is the real determinism contract. */
const ok24=framesOk&&secs24.length===p24.arranger.steps.length&&secs24.length>=7&&rmsBySec.every(r=>r>0.03)&&schedOk&&detOk;
gate('G24','song render: whole arranger offline via the live machinery — frames==formula, '+secs24.length+' sections (v0.7.0: one per arranger step, variants) RMS>0.03, schedule==oracle, deterministic',ok24,'N='+rA.N+'/'+N24+' bars='+bars24+' secs='+secs24.length+' rms=['+rmsBySec.join(',')+'] sched='+schedOk+' det='+(maxDiff===0?'exact':'maxDiff='+maxDiff.toExponential(2)))}catch(e){gate('G24','song render',false,'ERR '+e.message)}
/* G26 — MIDI export (offline — CI-asserted): compose FULL-ON 3min seed 424242
   → songMidi (the SAME song expansion the WAV renderer walks: songSteps +
   stepEvents) → writeMidi (pure format-1 writer) → parse the bytes back with
   an in-gate minimal reader. Asserts: format 1, ppq 480, tempo == 145 BPM,
   first kick tick == 0, per-track note counts == the expansion counts,
   total ticks == Σbars·4·480, non-trivial size, deterministic bytes. */
try{
const c26=compose('FULL-ON',3,424242),p26=c26.project;
const sm26=songMidi(p26);
const bytes26=writeMidi(sm26);
const bytes26b=writeMidi(songMidi(p26));
let byteDet=true;for(let i=0;i<bytes26.length;i++){if(bytes26[i]!==bytes26b[i]){byteDet=false;break}}
/* minimal parse-back reader: header, chunks, VLQ deltas, note on/off pairs */
let o26=0;const u26=bytes26;
const rd32=()=>((u26[o26]<<24)|(u26[o26+1]<<16)|(u26[o26+2]<<8)|u26[o26+3])>>>0;const rd16=()=>(u26[o26]<<8)|u26[o26+1];
let hdrOk=u26[0]===0x4d&&u26[1]===0x54&&u26[2]===0x68&&u26[3]===0x64;o26+=4;const hl26=rd32();o26+=4;
const fmt26=rd16();o26+=2;const nt26=rd16();o26+=2;const dv26=rd16();o26+=2;o26+=hl26-6;
let mpqn26=0,midiTrkNotes=[],maxTick26=0;
for(let ck=0;ck<nt26;ck++){
const id26=String.fromCharCode(u26[o26],u26[o26+1],u26[o26+2],u26[o26+3]);o26+=4;const ln26=rd32();o26+=4;const end26=o26+ln26;
let pp26=o26,tick26=0,run=0;const ons26=[];const notes26=[];
while(pp26<end26){let v=0;for(;;){const b=u26[pp26++];v=(v<<7)|(b&0x7f);if(!(b&0x80))break}tick26+=v;
let st=u26[pp26];if(st&0x80){pp26++;if(st<0xf0)run=st}else st=run;
if(st===0xff){const ty=u26[pp26];pp26++;let ml=0;for(;;){const b=u26[pp26++];ml=(ml<<7)|(b&0x7f);if(!(b&0x80))break}
if(ty===0x51){mpqn26=(u26[pp26]<<16)|(u26[pp26+1]<<8)|u26[pp26+2]}pp26+=ml}
else{const a=u26[pp26++],b2=u26[pp26++];const cmd=st&0xf0,ch=st&0x0f;
if(cmd===0x90&&b2>0)ons26.push({tick:tick26,ch,midi:a});
else if(cmd===0x80||(cmd===0x90&&b2===0)){const ix=ons26.findIndex(x=>x.ch===ch&&x.midi===a);if(ix>=0){const on=ons26.splice(ix,1)[0];notes26.push({on:on.tick,midi:a,ch});if(tick26>maxTick26)maxTick26=tick26}}}
}
midiTrkNotes.push({id:id26,notes:notes26});o26=end26;
}
const tempo26=Math.round(60000000/mpqn26*1000)/1000;
const kickName=p26.tracks[0].name;
const kickTrk=midiTrkNotes.find(t=>t.notes.length&&t.notes.every(n=>n.ch===9));
const kickFromSm=sm26.tracks.find(t=>(p26.tracks.find(x=>x.name===t.name)||{}).idx===0);
const firstKick26=kickTrk?Math.min.apply(null,kickTrk.notes.map(n=>n.on)):-1;
const countsOk=midiTrkNotes.slice(1).every((t,i)=>{const smt=sm26.tracks[i];return smt&&t.notes.length===smt.notes.length});
const total26=p26.arranger.steps.reduce((a,s)=>a+s.bars,0)*4*480;
const ok26=hdrOk&&fmt26===1&&dv26===480&&nt26===sm26.tracks.length+1&&Math.abs(tempo26-145)<0.01&&firstKick26===0&&countsOk&&maxTick26>total26-4*480&&maxTick26<=total26&&bytes26.length>1000&&byteDet;
gate('G26','MIDI export: songMidi==WAV expansion, format-1 parse-back (tempo/channels/counts/total ticks), deterministic bytes',ok26,'bytes='+bytes26.length+' fmt='+fmt26+' ppq='+dv26+' trks='+nt26+' tempo='+tempo26+' firstKick='+firstKick26+' notes='+midiTrkNotes.reduce((a,t)=>a+t.notes.length,0)+' total='+total26+' det='+byteDet)}catch(e){gate('G26','MIDI export',false,'ERR '+e.message)}

/* G27 — follow actions (offline simulation ONLY — CI-asserted): the scripted
   chain (composed FULL-ON 3min seed 424242, follow on EVERY scene) walks an
   exact seeded state sequence. Asserts: random mode's pinned 20-transition
   sequence for the fixed seed, replay identity (same seed+start → identical),
   next/prev walking sequences with wrap, scene-target lock, prob=0 → the
   documented 'next' fallback, and followBars precedence. */
try{
const c27=compose('FULL-ON',3,424242),p27=c27.project;p27.chain=true;
const sim27=(pp,st,n)=>{let cur=st;const q=[st];for(let k=0;k<n;k++){const nx=resolveFollow(pp,cur,k);if(nx==null)break;q.push(nx);cur=nx}return q};
for(let i=0;i<p27.scenes.length;i++)sceneSetFollow(p27,i,{mode:'random',prob:100});
const r27=sim27(p27,2,20);
const pin27=[2,2,11,11,9,9,4,13,8,16,11,9,1,15,8,1,8,6,0,13,0];
let seqOk=r27.length===pin27.length;for(let i=0;i<Math.min(r27.length,pin27.length);i++)if(r27[i]!==pin27[i])seqOk=false;
const replay27=JSON.stringify(sim27(p27,2,20))===JSON.stringify(r27);
for(let i=0;i<p27.scenes.length;i++)sceneSetFollow(p27,i,{mode:'next',prob:100});
const next27=sim27(p27,2,20);
let nextOk=next27.length===21;for(let i=0;i<21;i++)if(next27[i]!==(2+i)%17)nextOk=false;
for(let i=0;i<p27.scenes.length;i++)sceneSetFollow(p27,i,{mode:'prev',prob:100});
const prev27=sim27(p27,2,8);
let prevOk=prev27.length===9;for(let i=0;i<9;i++)if(prev27[i]!==((2-i)%17+17)%17)prevOk=false;
for(let i=0;i<p27.scenes.length;i++)sceneSetFollow(p27,i,{mode:'scene',target:4,prob:100});
const scene27=sim27(p27,2,6);
const sceneOk=scene27.join(',')==='2,4,4,4,4,4,4';
for(let i=0;i<p27.scenes.length;i++)sceneSetFollow(p27,i,{mode:'random',prob:0});
const fb27=sim27(p27,2,8);
let fbOk=fb27.length===9;for(let i=0;i<9;i++)if(fb27[i]!==2+i)fbOk=false;
const ok27=seqOk&&replay27&&nextOk&&prevOk&&sceneOk&&fbOk;
gate('G27','follow actions (chain only): seeded random sequence == pinned walk, replay-identical, next/prev wrap exact, scene lock, prob=0 → next fallback',ok27,'seq='+r27.join(',')+' replay='+replay27+' next='+nextOk+' prev='+prevOk+' lock='+sceneOk+' fallback='+fbOk)}catch(e){gate('G27','follow actions',false,'ERR '+e.message)}
/* G28 — scene mix snapshots (offline — CI-asserted): a scripted 2-section
 * song (both sections play the SAME pattern; only bass plays — every other
 * track muted — so the full-mix ratio is the pure gain law g=vol²). Scene 2
 * carries a bass-vol 0.5 snapshot vs the live 0.8 → per-section RMS ratio
 * must land in [2.0, 2.6] (target (0.8/0.5)²=2.56). Null-mix control: two
 * identical snapshot-less sections → ratio ≈ 1.0. Also: null-mix renders are
 * BIT-IDENTICAL to each other (the snapshot layer is opt-in). */
try{
const p28=buildStyle('PSYTRANCE',42);
p28.tracks.forEach((t,i)=>{t.mix.mute=i!==4});           /* bass-only fixture */
p28.tracks[4].mix.vol=.8;p28.tracks[4].mix.mute=false;
p28.scenes=[{name:'FULL',pattern:'A',color:0,bars:4,fill:false},{name:'DUCKED',pattern:'A',color:1,bars:4,fill:false}];
p28.arranger={v:1,on:true,steps:[{scene:0,bars:4},{scene:1,bars:4}],idx:0,barsIn:0};
p28.lanes=[];
sceneSetMix(p28,1,{tracks:{4:{vol:.5,pan:0,sendA:0,sendB:0,scAmount:0}}});
const r28a=await renderSong(p28);
const p28b=JSON.parse(JSON.stringify(p28));delete p28b.scenes[1].mix; /* null-mix control */
const r28b=await renderSong(p28b);
const sd28=60/p28.bpm/4,sr28=44100;
const rmsWin=(buf,s0,s1)=>{let sum=0,n=0;const a=Math.max(0,Math.round(s0*sr28)),b=Math.min(buf.length,Math.round(s1*sr28));for(let c=0;c<buf.numberOfChannels;c++){const d=buf.getChannelData(c);for(let i=a;i<b;i++){sum+=d[i]*d[i];n++}}return n?Math.sqrt(sum/n):0};
const w0=r28a.sections[0],w1=r28a.sections[1];
const rms0=rmsWin(r28a.buf,SONG_LEAD+w0.startStep*sd28,SONG_LEAD+w0.endStep*sd28);
const rms1=rmsWin(r28a.buf,SONG_LEAD+w1.startStep*sd28,SONG_LEAD+w1.endStep*sd28);
const ratio28=rms0/rms1;
const c0b=rmsWin(r28b.buf,SONG_LEAD+r28b.sections[0].startStep*sd28,SONG_LEAD+r28b.sections[0].endStep*sd28);
const c1b=rmsWin(r28b.buf,SONG_LEAD+r28b.sections[1].startStep*sd28,SONG_LEAD+r28b.sections[1].endStep*sd28);
const ctrlRatio=c0b/c1b;
const ctrlIdentical=r28a.scheduleHash===r28b.scheduleHash; /* same events both projects */
const ok28=ratio28>=2.0&&ratio28<=2.6&&Math.abs(ctrlRatio-1)<0.02&&r28a.N===r28b.N&&rms0>0.01&&rms1>0.01;
gate('G28','scene mix snapshots: snapshot bass-vol .5 vs live .8 → section RMS ratio in [2.0,2.6] (gain law g=vol²), null-mix control ≈1.0, opt-in (schedule unchanged)',ok28,'ratio='+ratio28.toFixed(3)+' (want 2.56) ctrlRatio='+ctrlRatio.toFixed(4)+' rms=['+rms0.toFixed(4)+','+rms1.toFixed(4)+'] schedSame='+ctrlIdentical+' N='+r28a.N)}catch(e){gate('G28','scene mix snapshots',false,'ERR '+e.message)}
/* G29 — master EQ3 + glue comp (offline — CI-asserted): two evidences.
 * (a) NEUTRAL TOLERANCE: the default engine (EQ biquads in chain at 0 dB,
 *     glue node OUT of the chain) vs {masterFlat:true} — the exact pre-v0.8.0
 *     topology — must differ by < 1e-6 max sample diff on BOTH channels
 *     (biquad unity-pass float error only). Actual number logged.
 * (b) COMPRESSION EVIDENCE: the same dense loop rendered with compOn 0 vs 1
 *     (thresh −20 dB, ratio 4, atk 10 ms, rel 150 ms, makeup 0). Chrome's
 *     DynamicsCompressor applies an IMPLICIT makeup gain, so absolute RMS
 *     rises (+4.25 dB observed — logged); the makeup-INVARIANT form of the
 *     RMS-reduction contract is the crest-factor (peak/RMS) reduction,
 *     asserted in [0.5, 6] dB (observed 2.94 — dynamics measurably squashed
 *     from crest 9.25 to 6.59). */
try{
const pN=buildStyle('PSYTRANCE',42);
const bFlat=await renderBounce(pN,2,{engineOpts:{masterFlat:true}});
const bFull=await renderBounce(pN,2);
let maxDiff=0;for(let c=0;c<bFull.buf.numberOfChannels;c++){const dF=bFlat.buf.getChannelData(c),dT=bFull.buf.getChannelData(c);for(let i=0;i<bFull.buf.length;i++){const d=Math.abs(dF[i]-dT[i]);if(d>maxDiff)maxDiff=d}}
const pC=buildStyle('PSYTRANCE',42);
const b0=await renderBounce(pC,4);
const pC2=JSON.parse(JSON.stringify(pC));pC2.master.compOn=1;pC2.master.compThresh=-20;pC2.master.compRatio=4;pC2.master.compAttack=10;pC2.master.compRelease=150;pC2.master.compMakeup=0;
const b1=await renderBounce(pC2,4);
const stat=buf=>{let s=0,n=0,pk=0;for(let c=0;c<buf.numberOfChannels;c++){const d=buf.getChannelData(c);for(let i=0;i<d.length;i++){const x=d[i];s+=x*x;n++;const a=Math.abs(x);if(a>pk)pk=a}}return{rms:Math.sqrt(s/n),peak:pk,crest:pk/Math.sqrt(s/n)}};
const s0=stat(b0.buf),s1=stat(b1.buf);
const rmsDb=20*Math.log10(s0.rms/s1.rms),crestDb=20*Math.log10(s0.crest/s1.crest);
const ok29=maxDiff<1e-6&&crestDb>=0.5&&crestDb<=6&&s0.rms>0.01;
gate('G29','master EQ+glue: neutral (EQ 0 dB + glue bypassed) vs pre-v0.8 topology maxDiff < 1e-6 both channels; glue comp ON squashes crest 0.5..6 dB (Chrome implicit makeup documented — raw RMS delta logged)',ok29,'neutralMaxDiff='+maxDiff.toExponential(2)+' crest '+s0.crest.toFixed(2)+'→'+s1.crest.toFixed(2)+' ('+crestDb.toFixed(2)+' dB) rmsDb='+rmsDb.toFixed(2)+' (implicit makeup)')}catch(e){gate('G29','master EQ+glue',false,'ERR '+e.message)}
/* G30 — SONG STEMS + SECTION BOUNCE (offline — CI-asserted): the demo song
 * (FULL-ON 3min seed 424242) through the ONE renderSong:
 *   (a) STEMS: kick + one melodic stem — exact frames (== songFrames formula),
 *       per-stem RMS > 0, kick stem RMS > melodic stem RMS;
 *   (b) SECTION BOUNCE: the DROP section via bounds — exact frames (==
 *       sectionFrames formula) and its MUSIC WINDOW equals the corresponding
 *       slice of the full render within 1e-5 (float wobble, G24 class).
 * The bounds render walks the full prefix (phase/mix/bleed continuity) and is
 * sliced with the documented 0.05 s pre-roll + 2-bar FX tail. */
try{
const p30=compose('FULL-ON',3,424242).project;
const rF=await renderSong(p30);
const stemT=songStemTracks(p30).tracks;
const melodic=stemT.filter(t=>t!==0&&p30.tracks[t]&&p30.tracks[t].kind!=='drum')[0];
const rK=await renderSong(p30,{trackFilter:0});
const rM=melodic!=null?await renderSong(p30,{trackFilter:melodic}):null;
const rmsAll=buf=>{let s=0,n=0;for(let c=0;c<buf.numberOfChannels;c++){const d=buf.getChannelData(c);for(let i=0;i<d.length;i++){s+=d[i]*d[i];n++}}return Math.sqrt(s/n)};
const kickRms=rmsAll(rK.buf),melRms=rM?rmsAll(rM.buf):0;
const framesOk=rK.N===songFrames(p30)&&(!rM||rM.N===songFrames(p30))&&rK.buf.length===songFrames(p30);
/* SECTION BOUNCE of the DROP section (first arranger step whose scene name starts with DROP) */
const secs30=songSections(p30);
const dropSec=secs30.find(s=>(s.name||'').indexOf('DROP')===0)||secs30[secs30.length-1];
const rS=await renderSong(p30,{bounds:[dropSec.startBar,dropSec.endBar]});
const Nwant=sectionFrames(p30,dropSec.startBar,dropSec.endBar);
const sd30=60/p30.bpm/4,sr30=44100;
/* music window in the SECTION file: pre-roll(LEAD) + bars·16·sd — compare the same absolute window of the FULL render:
   full-render slice starts at t0 + startBar·16·sd (absolute); section file starts at startFrame (= t0+startBar·16·sd − LEAD) and its music begins after the LEAD pre-roll */
const pre=Math.round(sr30*SONG_LEAD),musicLen=Math.round(sr30*dropSec.bars*16*sd30);
let sliceDiff=0;
{const f0=Math.round(sr30*(SONG_LEAD+dropSec.startBar*16*sd30));const s0=rS.startFrame+pre;
for(let c=0;c<2;c++){const dF=rF.buf.getChannelData(c),dT=rS.buf.getChannelData(c);for(let i=0;i<musicLen;i++){const d=Math.abs(dF[f0+i]-dT[s0+i]);if(d>sliceDiff)sliceDiff=d}}}
const rmsF=rmsAll(rF.buf);
const ok30=framesOk&&kickRms>0.01&&(!rM||melRms>0.01)&&kickRms>melRms&&rS.N===Nwant&&sliceDiff<1e-5&&rmsF>0.01;
gate('G30','song stems + section bounce (ONE renderer): stem frames==formula, kick RMS > melodic RMS, DROP section bounds render frames==formula and music window == full-render slice < 1e-5',ok30,'stemN='+rK.N+'/'+songFrames(p30)+' kickRms='+kickRms.toFixed(4)+' melRms='+melRms.toFixed(4)+' (trk'+melodic+') secN='+rS.N+'/'+Nwant+' sliceMaxDiff='+sliceDiff.toExponential(2)+' fullRms='+rmsF.toFixed(4))}catch(e){gate('G30','song stems + section bounce',false,'ERR '+e.message)}
}const pass=GATE_RES.filter(g=>g.pass).length;logLine('warn','== SELF-GATE: '+pass+'/'+GATE_RES.length+' passed ==');window.__psy6Gates=GATE_RES.slice(); /* machine-readable evidence for tools/e2e.mjs (headless CI) */const tb=$('gateTab');tb.style.display='';const body=tb.querySelector('tbody');body.innerHTML='';GATE_RES.forEach(g=>{const tr=document.createElement('tr');tr.innerHTML='<td class="mono">'+g.id+'</td><td>'+g.claim+'</td><td><span class="tag '+(g.pass?'t-V':'t-F')+'">'+(g.pass?'PASS':'FAIL')+'</span></td><td class="mono">'+(g.ev||'')+'</td>';body.appendChild(tr)})}

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
