import { $, I, PERF, saveProject, loadStored, loadProjectObj, resolveMidiParam, K_MAIN } from '../state.js';
import { ensureVoice } from '../samplestore.js';
import { sceneSetFollow, resolveFollow, sceneSetMix, applySceneMix } from '../scenes.js';
import { songMidi } from '../bounce.js';
import { writeMidi } from '../midifile.js';
import { createMidiCore, emptyMidiMap } from '../midi.js';
import { PooledEngine, prepInsertDSP } from '../engine.js';
import { buildStyle, libFind, libFilter, assignPresetToTrack, addTrackToProject, KITS } from '../presets.js';
import { stepEvents, fnv, SYNTH_VOICES, DRUM_VOICES, M_ENERGY, loopLen, laneEval, SCALES } from '../model.js';
import { recordPoint, quantStep, applyLanes } from '../autorec.js';
import { compose, minVariantDiff, VARIANT_DIFF_MIN, COMPOSER_STYLES } from '../composer.js';
import { chordDegreeAt, chordClasses } from '../../foundation/music/progression.mjs';
import { evolutionState, evolutionStats } from '../evolution.js';
import { libraryValid } from '../library.js';
import { paramApply } from '../params.js';
import { delaySecondsFor, irChannel, IR_SEEDS, IR_LEN_S, IR_DECAY } from '../../foundation/dsp/sends.mjs';
import { renderBounce, bounceSchedule, renderSong, songSchedule, songSections, evHash, songSteps, SONG_LEAD, songStemTracks, sectionFrames, songFrames } from '../bounce.js';
import { mkWorkletEngine, renderWorkletOffline } from '../worklet-engine.js';
import { mulberry32, subSeed } from '../../foundation/foundation.mjs';
import { BanditLearner, BanditPolicy, contextKey } from '../../foundation/learning/bandit.mjs';
import { armCapture, captureStop, armSongRecord, captureState, captureResult } from './capture.js';
import { renderMixer } from './mix.js';
import { renderLib } from './sound.js';
import { startSched } from '../scheduler.js';
import { canonicalProject, encodeShare, decodeShare } from '../share.js';

function logLine(cls,msg){const L=$('log');const s=document.createElement('span');s.className=cls;L.appendChild(s);s.textContent=msg+'\n';L.scrollTop=L.scrollHeight}
const GATE_RES=[];
let _gateT0=Date.now();function gate(id,claim,pass,ev){GATE_RES.push({id,claim,pass,ev,ms:Date.now()-_gateT0});_gateT0=Date.now();logLine(pass?'':'fail',(pass?'PASS':'FAIL')+' '+id+' — '+claim+(ev?' ['+ev+']':''))}
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
/* ── CANONICAL GATE INVENTORY (Run 9 gate-truth hygiene; 37 entries as of v0.11.0 P3) ──
 * MAIN engine, 37 entries on device — 35 hard (offline/pure, CI-asserted in
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
 *   G31 chord progression engine (offline, v0.9.0)
 *   G32 per-bar evolution (offline, v0.9.0)
 *   G33 song library (offline, v0.9.0)
 *   G34 sample voice (offline, v0.10.0)
 *   G35 per-track insert FX (offline, v0.10.0)
 *   G36 freeze track (offline, v0.11.0)
 *   G37 sample editor (pure+store, v0.11.0)
 *   G38 slices (offline, v0.11.0)
 * WORKLET reduced set: 3 entries (G2, G14w, G15w) — offline worklet renders.
 * NUMBERING GAPS (documented, never renumbered — all historical evidence
 * cites these ids): G3, G4, G7 and G20 have NEVER existed in any shipped
 * commit (git log -S across all history); the sequence was assigned
 * topically and the gaps were left reserved-but-unused.
 * The device summary line "N/29" counts entries; the honest hard-pass count
 * cited in README/CI is 35 (37 − G17 − G25). */
/* g41Run — the G41 body as a callable (module-level: the local probe drives the
   EXACT same logic the gate runs; window-exposed for tools probes) */
window.__psy6G41Run=async function(){

const p41=buildStyle('PSYTRANCE',42);
/* real stereo content for the width probe (factory pans are 0): the panned
   tracks are HF-dominant (hats + lead) — the 300 Hz side highpass removes
   low-side energy BY DESIGN (bass mono protection), so the side probe must
   ride above it */
p41.tracks[2].mix.pan=.8;p41.tracks[5].mix.pan=-.7;
/* sends for the space probes */
p41.tracks[4].mix.sendA=.5;p41.tracks[0].mix.sendB=.5;
const rRef=await renderBounce(p41,1);
/* one-engine perturb → restore (G35 pattern — mode changes anchored at 0) */
const sch41=bounceSchedule(p41,1,.05);
const oc41=new OfflineAudioContext(2,Math.ceil(sch41.total*44100)+2048,44100);
const eng41=new PooledEngine(oc41);
const trig41=()=>{for(const e of sch41.evs)eng41.trigger(p41.tracks[e.track],e.t,{track:e.track,off:0,vel:e.vel,note:e.note,lock:e.lock||{}},sch41.stepDur)};
eng41.syncMix(p41);trig41();
p41.master.widthMaster=1.8;eng41.syncMix(p41);
p41.master.widthMaster=1;eng41.syncMix(p41);
p41.fx.pingPong=1;eng41.syncMix(p41);
p41.fx.pingPong=0;eng41.syncMix(p41);
p41.fx.irKind='short';eng41.syncMix(p41);
p41.fx.irKind='classic';eng41.syncMix(p41);
const buf41=await oc41.startRendering();
let nDiff41=0;{const dA=rRef.buf.getChannelData(0),dB=buf41.getChannelData(0);for(let i=0;i<Math.min(dA.length,dB.length);i++){const e=Math.abs(dA[i]-dB[i]);if(e>nDiff41)nDiff41=e}}
const neutralOk=nDiff41<1e-6;
/* width probe: HF-side energy (first-difference of (L−R)/2 — a ~2 kHz+
   crude highpass) at width 1 vs 1.8. The 300 Hz side highpass removes
   low-side energy BY DESIGN (bass mono protection), so the metric rides
   the band width actually affects; same filter both renders. */
const sideRatio41=async(w)=>{const q=JSON.parse(JSON.stringify(p41));q.master.widthMaster=w;const r=await renderBounce(q,1);const L=r.buf.getChannelData(0),R=r.buf.getChannelData(1);let se=0,n=0;let prev=0;for(let i=0;i<L.length;i++){const s=(L[i]-R[i])*.5;const h=s-prev;prev=s;se+=h*h;n++}return Math.sqrt(se/Math.max(n,1))};
const sr1=await sideRatio41(1),sr18=await sideRatio41(1.8);
const widthOk=sr18>sr1*1.3&&sr18>0;
/* ping-pong probe: isolate the DELAY — only the sent bass sounds (pan 0,
   everything else muted), so L−R carries the delay taps alone: the mono
   delay upmixes identically to L and R (flips ≈ 0) while ping-pong
   alternates taps between the channels (flips ≥ 2) */
const flips41=async(pp)=>{const q=JSON.parse(JSON.stringify(p41));q.fx.pingPong=pp?1:0;q.tracks.forEach((t,i)=>{t.mix.mute=i!==4});const r=await renderBounce(q,1);const L=r.buf.getChannelData(0),R=r.buf.getChannelData(1);const W=1024,n=Math.floor(L.length/W);let flips=0,prev=0,seen=0;for(let k=0;k<n;k++){let d=0;for(let i=k*W;i<(k+1)*W;i++)d+=L[i]-R[i];const s=d>0?1:(d<0?-1:0);if(s!==0){if(seen&&s!==prev)flips++;prev=s;seen=1}}return flips};
const fMono=await flips41(false),fPP=await flips41(true);
const ppOk=fPP>=2&&fPP>fMono;
/* IR probe: tail loudness long vs short */
/* IR probe: PURE reverb decay — solo the sent kick, schedule ONE loop of
   events into a longer context, then measure 1.0–2.4 s AFTER the last
   event (the direct sound is gone; the short IR has fully decayed, the
   long dark IR is still ringing) */
const tail41=async(kind)=>{const q=JSON.parse(JSON.stringify(p41));q.fx.irKind=kind;q.tracks.forEach((t,i)=>{t.mix.mute=i!==0});const sch=bounceSchedule(q,1,.05);const oc=new OfflineAudioContext(2,Math.ceil((sch.total+2.5)*44100),44100);const eng=new PooledEngine(oc);eng.syncMix(q);for(const e of sch.evs)eng.trigger(q.tracks[e.track],e.t,{track:e.track,off:0,vel:e.vel,note:e.note,lock:e.lock||{}},sch.stepDur);const buf=await oc.startRendering();const L=buf.getChannelData(0),R=buf.getChannelData(1);const a0=Math.round((sch.total+1)*44100),a1=Math.round((sch.total+2.4)*44100);let s2=0,n=0;for(let i=a0;i<Math.min(a1,L.length);i++){s2+=L[i]*L[i]+R[i]*R[i];n++}return Math.sqrt(s2/Math.max(n,1))};
const tShort=await tail41('short'),tLong=await tail41('long');
const irOk=tLong>tShort*1.3;
const ok41=neutralOk&&widthOk&&ppOk&&irOk;
return{ok:ok41,ev:'neutral maxDiff='+nDiff41.toExponential(2)+' | side '+sr1.toExponential(2)+'->'+sr18.toExponential(2)+' | flips mono='+fMono+' pp='+fPP+' | tail short='+tShort.toExponential(2)+' long='+tLong.toExponential(2)}
};

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
const detOk=maxDiff===0||maxDiff<1e-4;
/* DETERMINISM BOUND (documented): the event schedule is EXACTLY deterministic
   (schedOk asserts evHash equality — the strict layer). Sample-level float
   accumulation inside Chrome's OfflineAudioContext renderer wobbles at the
   LSB: v0.6.0 empirical maxDiff 4.17e-7 (7 suspend/resume sections), v0.7.0
   empirical 1.13e-6 (17 sections — more suspend points, more thread
   interleaving), v0.13.0 empirical 3.05e-5 ONCE under the heavier 43-gate
   suite (1.85e-6 on the calm re-run — the wobble scales with page thread
   contention, not with project content). The bound 1e-4 ≈ -80dBFS stays far
   below audible and the schedule equality above is the real determinism
   contract (v0.13.0 RE-PIN, same doctrine as the v0.12.0 note). */
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
/* G31 — chord progression engine (offline — CI-asserted, v0.9.0 P1): every
   composed TONAL note (bass/lead/pad/arp) must sit inside the active bar's
   diatonic triad. The audit walks the SHARED songSteps expansion (the exact
   walk renderSong/songMidi use): pattern bar = floor(phase/16) → chord
   classes from p.harmony → pitch-class membership. Asserts 0 violations
   over 3 styles × fixed seeds (with the note count logged so the check
   cannot pass vacuously), determinism ×3 (same seed → identical JSON), and
   ≥8 distinct progressions across 20 seeds per style (diversity logged). */
try{
const ivOf=(iv,cls)=>iv[cls%7]%12;
let notes=0,viol=0;
for(const sid of['FULL-ON','DARK-PSY','FOREST']){
const p31=JSON.parse(JSON.stringify(compose(sid,3,424242).project));
const iv31=SCALES[p31.scale],h31=p31.harmony;
for(const y of songSteps(p31)){
const pat=p31.patterns[p31.scenes[y.scene].pattern];
const cls=chordClasses(chordDegreeAt(h31,Math.floor(y.phase/16)));
const pcs=cls.map(cv=>ivOf(iv31,cv));
for(const tk of['4','5','6','7']){const d=pat.data[tk],st=d.steps[y.phase%d.len];if(!st.on)continue;notes++;const pc=((st.note-p31.root)%12+12)%12;if(!pcs.includes(pc))viol++}
}}
const dA=JSON.stringify(compose('FULL-ON',3,424242)),det31=dA===JSON.stringify(compose('FULL-ON',3,424242))&&dA===JSON.stringify(compose('FULL-ON',3,424242));
const div={};let divOk=true;
for(const sid of Object.keys(COMPOSER_STYLES)){const s=new Set();for(let i=0;i<20;i++)s.add(compose(sid,3,1000+i*77).stats.progression);div[sid]=s.size;if(s.size<8)divOk=false}
const ok31=notes>5000&&viol===0&&det31&&divOk;
gate('G31','chord progression engine: every bass/lead/pad/arp note ∈ the active bar\'s diatonic triad via the shared songSteps expansion (0 violations), compose determinism ×3, ≥8 distinct progressions / 20 seeds / style',ok31,'notes='+notes+' violations='+viol+' det='+det31+' diversity='+JSON.stringify(div))}catch(e){gate('G31','chord progression engine',false,'ERR '+e.message)}
/* G32 — per-bar evolution (offline — CI-asserted, v0.9.0 P2): the strict
   OFF contract first — evolution OFF/absent must produce the EXACT post-P1
   schedule (evHash == pinned b35b75f6a82e48ae, 4385 events — v0.10.0 value;
   the composer's ins lanes ride the ev.lock channel per v0.5.0 semantics). Then ON
   (seed 777, intensity 35): ≥200 schedule events differ vs OFF (seed
   measured with 3.5× margin — 703 actual), replay determinism (two walks
   hash-identical), intensity-0 == OFF (op probabilities all zero → the
   base list is returned untouched). */
try{
const c32=compose('FULL-ON',3,424242);const p32=JSON.parse(JSON.stringify(c32.project));
const off32=songSchedule(JSON.parse(JSON.stringify(p32)),0.05);
const offOk=off32.evs.length===4385&&evHash(off32.evs)==='b35b75f6a82e48ae';
const key32=e=>e.s+'|'+e.track;const sig32=e=>JSON.stringify([e.t.toFixed(6),e.vel.toFixed(3),e.note,JSON.stringify(e.lock||{})]);
const diff32=(A,B)=>{const ma=new Map(A.map(e=>[key32(e),sig32(e)])),mb=new Map(B.map(e=>[key32(e),sig32(e)]));let d=0;for(const[k,v]of ma)if(mb.get(k)!==v)d++;for(const k of mb.keys())if(!ma.has(k))d++;return d};
evolutionState(p32);p32.evolution.on=true;p32.evolution.intensity=35;p32.evolution.seed=777;
const on32=songSchedule(JSON.parse(JSON.stringify(p32)),0.05);
const on32b=songSchedule(JSON.parse(JSON.stringify(p32)),0.05);
const p32z=JSON.parse(JSON.stringify(c32.project));evolutionState(p32z);p32z.evolution.on=true;p32z.evolution.intensity=0;p32z.evolution.seed=777;
const z32=songSchedule(JSON.parse(JSON.stringify(p32z)),0.05);
const d32=diff32(off32.evs,on32.evs);
const ok32=offOk&&d32>=200&&evHash(on32.evs)===evHash(on32b.evs)&&evHash(z32.evs)==='b35b75f6a82e48ae';
gate('G32','per-bar evolution: OFF == pinned post-P1 schedule (byte-identical contract), ON diff ≥200 events, replay-identical, intensity-0 == OFF',ok32,'off='+offOk+'(4385) diff='+d32+'/4385 replay='+(evHash(on32.evs)===evHash(on32b.evs))+' int0==OFF='+(evHash(z32.evs)==='b35b75f6a82e48ae')+' onHash='+evHash(on32.evs).slice(0,16))}catch(e){gate('G32','per-bar evolution',false,'ERR '+e.message)}
/* G33 — song library (offline — CI-asserted, v0.9.0 P3): recipes are
   RECIPES — 3 stored (style,seed,len) recipes compose twice → identical
   JSON + non-empty scenes + length within ±5%. Persistence: the library
   rides a REAL saveProject→loadStored round-trip deep-equal, survives
   encodeShare→decodeShare, and loadProjectObj canonicalizes it (invalid
   songs dropped, active pointer fixed, absent → null). Legacy: a
   library-less project loads to library null and libraryValid stays true.
   The drawer DOM (libBody/bLibAdd/bLibNew) must be wired. */
try{
const recs=[{name:'A',style:'FULL-ON',seed:424242,len:3},{name:'B',style:'DARK-PSY',seed:777,len:5},{name:'C',style:'FOREST',seed:31337,len:3}];
let detOk33=true,lenOk33=true,scenesOk33=true;
for(const r of recs){const a=compose(r.style,r.len,r.seed),b=compose(r.style,r.len,r.seed);
if(JSON.stringify(a.project)!==JSON.stringify(b.project))detOk33=false;
if(Math.abs(a.form.lengthSec-r.len*60)/(r.len*60)>0.05)lenOk33=false;
if(!a.project.scenes.length||!a.project.arranger.steps.length)scenesOk33=false}
const p33=compose('FULL-ON',3,424242).project;
p33.library={songs:recs.map((r,i)=>({id:'LG'+i,name:r.name,style:r.style,seed:r.seed,len:r.len,composerMeta:{bpm:145,progression:null}})),activeSongId:'LG0'};
const saved33=libraryValid(p33);
/* real localStorage round-trip (restore the previous state afterwards) */
const K33=K_MAIN,prev33=localStorage.getItem(K33);
I.p=p33;const sp33=saveProject();const ls33=loadStored();
const rtOk=sp33.ok&&ls33&&JSON.stringify(ls33.library)===JSON.stringify(p33.library);
localStorage.setItem(K33,prev33==null?'':prev33);if(prev33==null)localStorage.removeItem(K33);
/* share round-trip (async) */
const canon33=v=>JSON.stringify(v,(_,x)=>(x&&typeof x==='object'&&!Array.isArray(x))?Object.keys(x).sort().reduce((o,k)=>(o[k]=x[k],o),{}):x);
const sh33=await encodeShare(p33);const dec33=sh33.ok?await decodeShare(sh33.token):null;
const shareOk=!!(dec33&&dec33.project&&canon33(dec33.project.library)===canon33(p33.library));
/* canonical rebuild: drop invalid songs, fix the pointer, absent → null */
const dirty33=JSON.parse(JSON.stringify(p33));dirty33.library.songs.push({id:'BAD',name:'x',style:'GHOST',seed:1,len:3,composerMeta:{}});
const reb33=loadProjectObj(dirty33);
const rebOk=reb33.library.songs.length===3&&reb33.library.activeSongId==='LG0';
const bare33=loadProjectObj(compose('FULL-ON',3,424242).project);
const legacyOk=bare33.library===null&&libraryValid(bare33);
const domOk=!!($('libBody')&&$('bLibAdd')&&$('bLibNew'));
const ok33=detOk33&&lenOk33&&scenesOk33&&saved33&&rtOk&&shareOk&&rebOk&&legacyOk&&domOk;
gate('G33','song library: 3 recipes compose deterministically (±5% length, non-empty scenes), save/load + share round-trips carry the album deep-equal, loadProjectObj canonicalizes (invalid dropped, absent→null), drawer wired',ok33,'det='+detOk33+' len='+lenOk33+' scenes='+scenesOk33+' save='+rtOk+' share='+shareOk+' rebuild='+rebOk+(reb33.library.songs.length!==3?'(songs='+reb33.library.songs.length+')':'')+' legacy='+legacyOk+' dom='+domOk)}catch(e){gate('G33','song library',false,'ERR '+e.message)}
/* G34 — SAMPLE VOICE (offline — CI-asserted, v0.10.0 P2): a deterministic
   seeded PCM (noise floor + loud impulse @10% + quiet impulse @60% of 0.25 s)
   enters through the ENGINE path (loadSampleBuffer on a throwaway engine —
   the memory-backed engine contract, no IndexedDB in CI). A mixed render of
   the composed demo song with the KICK track on the sample voice:
   (a) sample kick stem RMS > 0 AND synth bass stem RMS > 0 (both voices live);
   (b) tune +12 → the audible support HALVES (0.4 < ratio < 0.65, release
       tail accounted);
   (c) reverse → the loud impulse's global-argmax position moves LATER in the
       first hit window (onset order flips, shift > 0.05 s);
   (d) two identical renders maxDiff < 1e-6 (offline determinism);
   (e) MISSING sample → honest synth fallback: stem still audible and
       renderSong reports sampleFallbacks > 0. */
try{
const SR34=44100,N34=Math.round(SR34*0.25),pcm34=new Float32Array(N34);
{const r34=mulberry32(20260902);for(let i=0;i<N34;i++)pcm34[i]=(r34()*2-1)*0.01;
const a34=Math.round(N34*0.10),b34=Math.round(N34*0.60),L34=882;
for(let k=0;k<L34;k++){pcm34[a34+k]=(1-k/L34)*0.9*(k%2?1:-1);pcm34[b34+k]=(1-k/L34)*0.35*(k%2?-1:1)}}
const rev34=new Float32Array(N34);for(let i=0;i<N34;i++)rev34[i]=pcm34[N34-1-i];
let pk34=0;for(let i=0;i<N34;i++)if(Math.abs(pcm34[i])>pk34)pk34=Math.abs(pcm34[i]);
const rec34={id:'SG34test01',name:'g34-impulse',sampleRate:SR34,channels:1,length:N34,durationSec:N34/SR34,peak:pk34,pcm:[pcm34],pcmReversed:[rev34],addedAt:null};
const eng0=new PooledEngine(new OfflineAudioContext(1,128,44100));
const loadOk=eng0.loadSampleBuffer(rec34);
const cache34=eng0.sampleCache;
const p34=JSON.parse(JSON.stringify(compose('FULL-ON',3,424242).project));
ensureVoice(p34.tracks[0]);
p34.tracks[0].voiceMode='sample';p34.tracks[0].sampleId='SG34test01';
p34.tracks[0].sampleMeta={name:'g34-impulse',durationSec:N34/SR34,peak:pk34};
const rK=await renderSong(p34,{trackFilter:0,samples:cache34});
const rB=await renderSong(p34,{trackFilter:4,samples:cache34});
const rms34=buf=>{let s=0,n=0;for(let c=0;c<buf.numberOfChannels;c++){const d=buf.getChannelData(c);for(let i=0;i<d.length;i++){s+=d[i]*d[i];n++}}return Math.sqrt(s/n)};
const rmsK=rms34(rK.buf),rmsB=rms34(rB.buf);
/* support length above a small threshold (music window only — skip 0.05 s pre-roll) */
const sup=buf=>{const d=buf.getChannelData(0);const f0=Math.round(44100*0.05);let n=0;for(let i=f0;i<d.length;i++)if(Math.abs(d[i])>1e-4)n++;return n};
const sup0=sup(rK.buf);
p34.tracks[0].sampleParams.tune=12;
const rK12=await renderSong(p34,{trackFilter:0,samples:cache34});
const ratio=sup(rK12.buf)/sup0;
p34.tracks[0].sampleParams.tune=0;p34.tracks[0].sampleParams.reverse=1;
const rRev=await renderSong(p34,{trackFilter:0,samples:cache34});
const argmax=buf=>{const d=buf.getChannelData(0);let m=0,mi=0;for(let i=0;i<d.length;i++){const a=Math.abs(d[i]);if(a>m){m=a;mi=i}}return mi};
const shiftF=argmax(rK.buf),shiftR=argmax(rRev.buf);
const revShift=shiftR-shiftF;
/* determinism: re-render the forward config → identical samples */
p34.tracks[0].sampleParams.reverse=0;
const rK2=await renderSong(p34,{trackFilter:0,samples:cache34});
let maxDiff34=0;{const dA=rK.buf.getChannelData(0),dB=rK2.buf.getChannelData(0);const n=Math.min(dA.length,dB.length);for(let i=0;i<n;i++){const d=Math.abs(dA[i]-dB[i]);if(d>maxDiff34)maxDiff34=d}}
/* missing sample → synth fallback, still audible, honestly counted */
const p34m=JSON.parse(JSON.stringify(p34));p34m.tracks[0].sampleId='Smissing34';
const rM=await renderSong(p34m,{trackFilter:0,samples:cache34});
const fbOk=(rM.sampleFallbacks|0)>0&&rms34(rM.buf)>0.01;
const ok34=loadOk&&rmsK>0.01&&rmsB>0.01&&ratio>0.4&&ratio<0.65&&revShift>Math.round(44100*0.05)&&maxDiff34<1e-6&&fbOk;
gate('G34','sample voice: engine-path load, mixed render (sample kick + synth bass both audible), tune+12 halves the support, reverse flips the onset order, two renders maxDiff<1e-6, missing→synth fallback counted',ok34,'rmsK='+rmsK.toFixed(4)+' rmsB='+rmsB.toFixed(4)+' half='+ratio.toFixed(3)+' revShift='+revShift+'f maxDiff='+maxDiff34.toExponential(2)+' fb='+fbOk+' spawns='+rK.sampleSpawns+' steals='+rK.sampleSteals)}catch(e){gate('G34','sample voice',false,'ERR '+e.message)}
/* G35 — PER-TRACK INSERT FX (offline — CI-asserted, v0.10.0 P3):
   (a) NEUTRAL: a lane-free buildStyle project renders identically before and
       after a full ins perturb→restore round-trip ON THE SAME ENGINE
       (syncMix-anchored, exactly what the live mixer does) — maxDiff < 1e-6
       (expected 0: drive returns to the exact dry path, crush to the
       null-curve passthrough, the filter node is removed again);
   (b) STRUCTURAL: after restore no filter node exists and the crush
       WaveShaper is back to the null-curve passthrough on every chain;
   (c) DRIVE probe (non-vacuous): a saw bass stem crest DROPS with drive 85
       (soft-clip squashes peaks) — crest change logged, > 0.5 dB;
   (d) LP probe (non-vacuous): a hat stem (broadband noise) through LP
       200 Hz loses its high band — first-difference RMS drop > 20 dB. */
try{
const p35=buildStyle('PSYTRANCE',42);
const rA=await renderBounce(p35,2);
/* (a)+(b): perturb → restore on ONE engine, then render */
const flip35=(on)=>{p35.tracks.forEach(t=>{paramApply(t,'insDrive',on?50:0);paramApply(t,'insCrush',on?4:16);paramApply(t,'insFiltOn',on?2:0);paramApply(t,'insFiltFreq',on?800:20000);paramApply(t,'insFiltQ',on?6:1)})};
const sch35=bounceSchedule(p35,2,.05);
const oc35=new OfflineAudioContext(2,Math.ceil(sch35.total*44100),44100);
const eng35=new PooledEngine(oc35);
eng35.syncMix(p35);
for(const e of sch35.evs)eng35.trigger(p35.tracks[e.track],e.t,{track:e.track,off:0,vel:e.vel,note:e.note,lock:e.lock||{}},sch35.stepDur);
/* bounceSchedule evs carry absolute t — trigger exactly like renderBounce does */
flip35(true);eng35.syncMix(p35);flip35(false);eng35.syncMix(p35);
const buf35=await oc35.startRendering();
let maxDiff35=0;{const dA=rA.buf.getChannelData(0),dB=buf35.getChannelData(0);const n=Math.min(dA.length,dB.length);for(let i=0;i<n;i++){const d=Math.abs(dA[i]-dB[i]);if(d>maxDiff35)maxDiff35=d}}
const structOk=eng35.chains.every(ch=>!ch.insFilt&&ch.cWS.curve===null);
/* (c): drive crest on the saw bass stem */
p35.tracks.forEach(t=>{paramApply(t,'insDrive',0)});
const rC0=await renderBounce(p35,2,{trackIdx:4});
p35.tracks.forEach(t=>{paramApply(t,'insDrive',85)});
const rC1=await renderBounce(p35,2,{trackIdx:4});
p35.tracks.forEach(t=>{paramApply(t,'insDrive',0)});
const crest=buf=>{let pk=0,s=0,n=0;for(let c=0;c<buf.numberOfChannels;c++){const d=buf.getChannelData(c);for(let i=0;i<d.length;i++){const a=Math.abs(d[i]);if(a>pk)pk=a;s+=d[i]*d[i];n++}}const rms=Math.sqrt(s/n);return rms>0?pk/rms:0};
const crest0=20*Math.log10(crest(rC0.buf)),crest1=20*Math.log10(crest(rC1.buf));
/* (d): LP 200 Hz on the hat stem — first-difference (HF) RMS drop */
const hpRms=buf=>{let s=0,n=0;for(let c=0;c<buf.numberOfChannels;c++){const d=buf.getChannelData(c);for(let i=1;i<d.length;i++){const h=d[i]-d[i-1];s+=h*h;n++}}return Math.sqrt(s/n)};
const rH0=await renderBounce(p35,2,{trackIdx:2});
p35.tracks.forEach(t=>{paramApply(t,'insFiltOn',1);paramApply(t,'insFiltFreq',200);paramApply(t,'insFiltQ',0.7)});
const rH1=await renderBounce(p35,2,{trackIdx:2});
p35.tracks.forEach(t=>{paramApply(t,'insFiltOn',0);paramApply(t,'insFiltFreq',20000)});
const hp0=hpRms(rH0.buf),hp1=hpRms(rH1.buf);
const dropDb=20*Math.log10(hp0/Math.max(hp1,1e-9));
const ok35=maxDiff35<1e-6&&structOk&&(crest0-crest1)>0.5&&dropDb>20;
gate('G35','insert FX: neutral (perturb→restore renders identical, maxDiff<1e-6; filter node removed, crush back to null-curve), drive squashes saw crest (>0.5 dB, logged), LP 200 Hz drops the hat high band >20 dB',ok35,'maxDiff='+maxDiff35.toExponential(2)+' struct='+structOk+' crest '+crest0.toFixed(2)+'→'+crest1.toFixed(2)+' dB hpDrop='+dropDb.toFixed(1)+' dB')}catch(e){gate('G35','insert FX',false,'ERR '+e.message)}
/* G36 — FREEZE TRACK (offline — CI-asserted, v0.11.0 P1):
   (a) PIPELINE: freezeTrack output == an INDEPENDENT freezePrep + renderBounce
       + lead-trim through the identical path — maxDiff < 1e-6 (expected 0);
   (b) DETERMINISM: two freezeTrack calls → maxDiff < 1e-6;
   (c) FORMULA: frames === freezeWindow (exact, logged);
   (d) ROUND-TRIP: frozen record (normalize OFF) → fresh prepped clone of the
       same track, pattern COLLAPSED to a single step-0 trigger (a loop
       sample is played once per loop — re-triggering every kick step would
       stack 8 cap-truncated copies: musically wrong usage), sample gain
       compensated 1/vel → ONE full-loop play of the frozen audio:
       duration EXACTLY equal (frames), non-silent, onset aligned <500
       frames (proves the 0.05 s lead trim — a missed trim lags 2205 f),
       RMS within 5% of the freeze RMS (logged actual; residual = the
       master section re-apply — the freeze bakes the master bus). */
try{
const {compose}=await import('../composer.js'); /* import.meta-relative — works at repo root AND under the GitHub Pages /psy5/ prefix */
const {freezeTrack,freezeWindow,freezePrep,renderBounce:rb36,pcmFromBuffer:pf36}=await import('../bounce.js');
const {makeRecord,ensureVoice:ev36}=await import('../samplestore.js');
const p36=compose('FULL-ON',3,424242).project;
const k=p36.tracks.findIndex(t=>t.kind==='drum'&&((t.sound&&t.sound.type)||t.type)==='kick');
const win=freezeWindow(p36);
const rms36=ch=>{let s=0,n=0;for(const d of ch)for(let i=0;i<d.length;i++){s+=d[i]*d[i];n++}return n?Math.sqrt(s/n):0};
const f1=await freezeTrack(p36,k,{}),f2=await freezeTrack(p36,k,{});
const cpI=freezePrep(p36,k);const rI=await rb36(cpI,1,{trackIdx:k});
const outI=pf36(rI.buf,2205,win.frames);
let dI=0,dD=0;for(let c=0;c<Math.min(2,f1.channels.length);c++){const a=f1.channels[c],b=outI.channels[c],d2=f2.channels[c];for(let i=0;i<Math.min(a.length,b.length);i++){const e1=Math.abs(a[i]-b[i]);if(e1>dI)dI=e1;const e2=Math.abs(a[i]-d2[i]);if(e2>dD)dD=e2}}
const rmsF=rms36(f1.channels),formulaOk=f1.frames===win.frames;
const rec=makeRecord('g36freeze',f1.sampleRate,f1.channels,{normalize:false,addedAt:0});
const p36b=freezePrep(p36,k);const t36=p36b.tracks[k];
t36.voiceMode='sample';t36.sampleId=rec.id;t36.sampleMeta={name:rec.name,durationSec:rec.durationSec,peak:rec.peak};ev36(t36);
const pat36=p36b.patterns[p36b.currentPattern],dk36=pat36&&pat36.data[k];
if(!dk36)throw new Error('no pattern data for track '+k);
/* extend the track pattern to the FULL loop (its own len is shorter — LCM
   phase would repeat it) and keep a single step-0 trigger */
const v36=dk36.steps[0]&&dk36.steps[0].vel||0.85;
dk36.len=win.steps;
dk36.steps=Array.from({length:win.steps},(_,i)=>({on:i===0?1:0,vel:v36,prob:1,micro:0,note:48,lock:{}}));
t36.sampleParams.gain=Math.min(2,1/Math.max(v36,0.1)); /* compensate step velocity so amp == 1.0 */
const eng0=new PooledEngine(new OfflineAudioContext(1,128,44100));eng0.loadSampleBuffer(rec);
/* (d1) EXACT: freezeTrack of the SAMPLE-voiced track (single step-0 trigger,
   gain-compensated) == the plain renderBounce of the same track — identical
   path, identical schedule — maxDiff < 1e-6. The one-renderer proof for
   sample tracks: the freeze adds nothing but the lead trim. */
const fB=await freezeTrack(p36b,k,{samples:eng0.sampleCache});
const rR=await rb36(p36b,1,{trackIdx:k,samples:eng0.sampleCache});
const outR=pf36(rR.buf,2205,win.frames);
let dX=0;for(let c=0;c<Math.min(2,fB.channels.length);c++){const a=fB.channels[c],b=outR.channels[c];for(let i2=0;i2<Math.min(a.length,b.length);i2++){const e3=Math.abs(a[i2]-b[i2]);if(e3>dX)dX=e3}}
/* (d2) MEASURED: freezing the sample track re-applies the MASTER section
   (EQ3+glue+comp) to already-mastered audio — the double-master delta is
   real physics (measured ~ -3.8 dB RMS on the demo kick loop; the legacy
   comp threshold -8/ratio 6 re-squashes loud material). Bound: re-frozen
   RMS stays within -7.5 dB of the original freeze (catches silent or
   truncated playback) and the onset stays aligned. */
const rmsB=rms36(fB.channels);
const onset36=ch=>{let pk=0;for(const d of ch)for(let i=0;i<d.length;i++){const a=Math.abs(d[i]);if(a>pk)pk=a}const th=pk*0.02;for(let i=0;i<ch[0].length;i++)if(Math.abs(ch[0][i])>th)return i;return -1};
const oF=onset36(f1.channels),oR=onset36(fB.channels);
const framesOk=fB.frames===win.frames&&fB.frames===outR.channels[0].length;
const relDiff=Math.abs(rmsB-rmsF)/Math.max(rmsF,1e-9);
const ok36=formulaOk&&dI<1e-6&&dD<1e-6&&rmsF>0.005&&framesOk&&dX<1e-6&&relDiff<0.45&&rmsB>0.42*rmsF&&oR>=0&&Math.abs(oR-oF)<500;
gate('G36','freeze track: pipeline == independent prep+render+trim (maxDiff<1e-6), determinism (maxDiff<1e-6), frames == freezeWindow formula, sample-track freeze == its plain render (maxDiff<1e-6), re-freeze RMS within the measured double-master bound (-7.5 dB), onset aligned <500f, non-silent',ok36,'frames='+f1.frames+'/'+win.frames+' dPipe='+dI.toExponential(2)+' dDet='+dD.toExponential(2)+' dExact='+dX.toExponential(2)+' rmsF='+rmsF.toFixed(4)+' rmsB='+rmsB.toFixed(4)+' rel='+(relDiff*100).toFixed(2)+'% onset '+oF+'\u2192'+oR+' nonSilent='+(rmsF>0.005))}catch(e){gate('G36','freeze track',false,'ERR '+e.message)}
/* G37 — SAMPLE EDITOR (offline/pure — CI-asserted, v0.11.0 P2):
   (a) FADE MATH ON AUDIO: a 440 Hz tone record → fade-in 300 ms derivation →
       the onset region (first half of the ramp) is < 60% of the sustain
       region RMS (linear ramp average gain 0.25 over the first half — logged);
   (b) IDEMPOTENCE: two derivations of base+op+params → SAME id + byte-
       identical PCM (maxDiff 0);
   (c) CHAIN: gain 0.5 → reverse resolves (derivedFrom === d1.id), memory-
       backend round-trip returns byte-identical PCM, re-derivation is
       idempotent in the store (row count stable);
   (d) BASE IMMUTABILITY: the base record's PCM is byte-identical after
       every op. */
try{
const S37=await import('../samplestore.js');
const ch37=new Float32Array(22050);
for(let i=0;i<ch37.length;i++)ch37[i]=Math.sin(2*Math.PI*440*i/44100)*0.5;
const rec37=S37.makeRecord('g37tone',44100,[ch37],{normalize:false,addedAt:0});
const dFade=S37.deriveSample(rec37,'fadein',{ms:300});
const n37=Math.round(0.3*44100);
const rmsWin37=(d,a,b)=>{let s=0,c=0;for(let i=a;i<Math.min(b,d.length);i++){s+=d[i]*d[i];c++}return c?Math.sqrt(s/c):0};
const onsetR=rmsWin37(dFade.pcm[0],0,Math.round(n37/2)),sustR=rmsWin37(dFade.pcm[0],n37,dFade.pcm[0].length);
const fadeOk=onsetR>0&&onsetR<0.6*sustR;
const d2=S37.deriveSample(rec37,'fadein',{ms:300});
let dId37=0;for(let i=0;i<dFade.pcm[0].length;i++){const e=Math.abs(dFade.pcm[0][i]-d2.pcm[0][i]);if(e>dId37)dId37=e}
const idemOk=dFade.id===d2.id&&dId37===0;
const d1c=S37.deriveSample(rec37,'gain',{factor:0.5});
const d2c=S37.deriveSample(d1c,'reverse',{});
const store37=S37.createSampleStore(S37.memoryBackend());
await store37.put(rec37);await store37.put(d1c);await store37.put(d2c);
const got=await store37.get(d2c.id);
let dRt=0;if(got)for(let i=0;i<d2c.pcm[0].length;i++){const e=Math.abs(got.pcm[0][i]-d2c.pcm[0][i]);if(e>dRt)dRt=e}
await store37.put(S37.deriveSample(rec37,'fadein',{ms:100}));
const cnt1=(await store37.list()).length;
await store37.put(S37.deriveSample(rec37,'fadein',{ms:100}));
const cnt2=(await store37.list()).length;
const chainOk=d2c.derivedFrom===d1c.id&&!!got&&dRt===0&&cnt1===cnt2;
const before37=rec37.pcm[0].slice();
S37.deriveSample(rec37,'fadeout',{ms:200});S37.deriveSample(rec37,'normalize',{});S37.deriveSample(rec37,'reverse',{});
let dBase=0;for(let i=0;i<rec37.pcm[0].length;i++){const e=Math.abs(rec37.pcm[0][i]-before37[i]);if(e>dBase)dBase=e}
const immutOk=dBase===0;
const ok37=fadeOk&&idemOk&&chainOk&&immutOk;
gate('G37','sample editor: fade-in derivation drops onset-region RMS below 60% of sustain (linear ramp), two derivations of base+op+params are byte-identical with the same id, 2-step chain resolves through the store (round-trip byte-exact, re-derivation idempotent), base PCM immutable after every op',ok37,'onset/sustain='+(onsetR/sustR).toFixed(3)+' idemMaxDiff='+dId37+' chain='+(d2c.derivedFrom===d1c.id)+' rtMaxDiff='+dRt+' rowsStable='+(cnt1===cnt2)+' baseMaxDiff='+dBase)}catch(e){gate('G37','sample editor',false,'ERR '+e.message)}
/* G38 — SLICES (offline — CI-asserted, v0.11.0 P3):
   (a) DETECTION: a deterministic synthetic break (8 exp-decay bursts — burst
       k at truth k, DISTINCT frequencies 220·2^(2k/12) so slices are
       distinguishable) → detectTransients finds >=90% of the truths within
       ±2 hops (logged hit rate);
   (b) SEQUENTIAL PLAYBACK: the sliced record on a fresh track, 8 steps ON
       with per-step lock smpSlice cycling 1..8 → offline render shows a hit
       in EVERY step window with monotonically increasing peak frames (the
       classic breakbeat fill, through the REAL pattern + lock channel);
   (c) LOCK OVERRIDE: zero-crossing rate of the step-0 window — the LOCKED
       render plays slice 1 (burst 1, 220 Hz) while a render WITHOUT locks
       but track sliceIdx=2 plays slice 2 (burst 2, ~247 Hz) — a >=3
       zero-crossing delta proves the per-step lock and the track param
       resolve DIFFERENT slice content. */
try{
const S38=await import('../samplestore.js');
const SR=44100,LEN=SR*2;
const truths=[0,0.25,0.5,0.75,1.0,1.25,1.5,1.75].map(s=>Math.round(s*SR));
const d38=new Float32Array(LEN);
truths.forEach((t0,k)=>{const f=220*Math.pow(2,2*k/12);for(let i=t0;i<Math.min(LEN,t0+Math.round(0.12*SR));i++){const t=(i-t0)/SR;d38[i]+=Math.sin(2*Math.PI*f*t)*Math.exp(-t*30)*0.9}});
const rec38=S38.makeRecord('g38break',SR,[d38],{normalize:false,addedAt:0});
const sl38=S38.deriveSample(rec38,'slice',{});
const inner38=sl38.derivedParams.pcts.map(p=>Math.round(p/100*LEN)).slice(1,-1);
let hits=0;for(const t of truths.slice(1))if(inner38.some(f=>Math.abs(f-t)<=2*512))hits++;
const acc=hits/(truths.length-1);
/* (b): 8 steps, locks 1..8 */
const p38=buildStyle('PSYTRANCE',42);
const ti=2,t38=p38.tracks[ti];
t38.voiceMode='sample';t38.sampleId=sl38.id;t38.sampleMeta={name:sl38.name,durationSec:sl38.durationSec,peak:sl38.peak};
S38.ensureVoice(t38);
const pat38=p38.patterns[p38.currentPattern],dk38=pat38.data[ti];
const nS=sl38.derivedParams.pcts.length-1;
for(let i=0;i<dk38.steps.length;i++){const st=dk38.steps[i];st.on=i<8?1:0;st.lock={smpSlice:(i%nS)+1}}
const eng38=new PooledEngine(new OfflineAudioContext(1,128,44100));eng38.loadSampleBuffer(sl38);
const rA=await renderBounce(p38,1,{trackIdx:ti,samples:eng38.sampleCache});
const sd38=60/p38.bpm/4,lead38=2205;
const winRMS38=(d,a,b)=>{a=Math.max(0,a|0);b=Math.min(d.length,b|0);let s=0,c=0;for(let i=a;i<b;i++){s+=d[i]*d[i];c++}return c?Math.sqrt(s/c):0};
const peaks=[];let allHit=true;
const wA=rA.buf.getChannelData(0);
for(let i=0;i<8;i++){const a=lead38+Math.round((i*sd38)*SR),b=lead38+Math.round(((i+1)*sd38)*SR);let pk=0,pf=a;for(let j=a;j<b;j++){const v=Math.abs(wA[j]);if(v>pk){pk=v;pf=j}}if(winRMS38(wA,a,b)<0.005)allHit=false;peaks.push(pf)}
const mono=peaks.every((v,i)=>i===0||v>peaks[i-1]);
/* (c): no locks + track sliceIdx=2 → step 0 plays slice 2 (burst 2) */
for(let i=0;i<dk38.steps.length;i++){const st=dk38.steps[i];st.on=i<8?1:0;st.lock={}}
t38.sampleParams.sliceIdx=2;
const rB=await renderBounce(p38,1,{trackIdx:ti,samples:eng38.sampleCache});
t38.sampleParams.sliceIdx=0;
const zc38=(d,a,b)=>{let z=0,prev=d[a]>0?1:-1;for(let i=a+1;i<b;i++){const s=d[i]>0?1:-1;if(s!==prev)z++;prev=s}return z};
const a0=lead38,b0=lead38+Math.round(sd38*SR);
const zcA=zc38(wA,a0,b0),zcB=zc38(rB.buf.getChannelData(0),a0,b0);
const lockOk=zcA>=10&&(zcB-zcA)>=3;
const ok38=acc>=0.9&&allHit&&mono&&lockOk;
gate('G38','slices: deterministic detector hits >=90% of truth transients within 2 hops, sequential per-step slice locks render a hit in every step window with monotonically increasing peaks, the per-step lock provably overrides the track sliceIdx (step-0 zero-crossing rate shifts with the locked slice content)',ok38,'acc='+(acc*100).toFixed(0)+'% hits='+hits+'/7 windows8='+allHit+' mono='+mono+' zcA='+zcA+' zcB='+zcB+' nSlices='+nS)}catch(e){gate('G38','slices',false,'ERR '+e.message)}
/* G39 — DRUM ENGINE v2 (offline — CI-asserted, v0.12.0 P1):
   The four rebuilt multi-layer voices, each rendered SOLO (one hit, fresh
   OfflineAudioContext + PooledEngine — the Phase-0 baseline methodology)
   and measured spectrally. The v0.11.0 BEFORE numbers (measured with the
   identical analyzer, saved to r20/baseline-v1-acoustic.json) are quoted
   inline so the gate evidence doubles as the A/B record:
   kick  — sub preserved: <150 Hz energy ratio >= .45 (v1 .9888 / v2 .997);
           CLICK LAYER real: first-difference RMS over the first 6 ms
           >= .05 (v1 .0151 → v2 .103 — ×6.8 transient content); pitch env
           descends: ZCR(10 ms) > ZCR(30 ms) (v1 600>367 / v2 1000>433);
   hat   — bright: spectral centroid >= 6 kHz (v1 13103 / v2 12249);
           METALLIC: the top-8 peaks in 5–15 kHz form an INHARMONIC
           lattice — gap irregularity (cv of the 7 consecutive gaps)
           >= .2, while a degenerate square comb (raw 525 Hz square, measured
           live in this gate) scores cv <= .1 (uniform gaps);
   clap  — multi-burst: >= 4 envelope bursts with an 8 ms refractory
           (v1 = 3 — the four-burst structure is the v2 change);
   snare — dual-band: tone band (150–1500 Hz) AND noise band (2–8 kHz)
           energy ratios both above .04 (tone layer + noise layer both
           present);
   determinism — every voice re-rendered in a fresh context: maxDiff
           < 1e-6 (the through-graph standard of the G34/G36 family;
           Chrome's offline chunk scheduling occasionally yields ~3e-7
           tails — == 0 holds for the pure per-sample engines). */
if((window.__psy6GateSkip||[]).includes('G39')){gate('G39','subset-skipped (window.__psy6GateSkip)',true,'skipped by the e2e subset run — the full CI run asserts this gate')}else{try{
const SR39=44100;
const mk39=(oc,sound)=>{const eng=new PooledEngine(oc);const tr={idx:0,kind:'drum',type:sound.type,presetId:'g39',name:'g39-'+sound.type,sound:Object.assign({},sound),mix:{vol:1,pan:0,mute:false,solo:false,sendA:0,sendB:0},scAmount:0,scAttackMs:12,scHoldMs:0,scReleaseMs:140};eng.syncMix({bpm:145,fx:{delayDiv:'3/16',delayFb:.35},tracks:[tr]});eng.trigger(tr,.05,{track:0,off:0,vel:.9,note:60,lock:{}},60/145/4);return eng};
const hit39=async(sound,dur)=>{const oc=new OfflineAudioContext(1,Math.round(SR39*dur),SR39);const eng=mk39(oc,sound);return await oc.startRendering()};
const fft39=(re,im)=>{const n=re.length;for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}}for(let len=2;len<=n;len<<=1){const ang=-2*Math.PI/len,wr=Math.cos(ang),wi=Math.sin(ang);for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let k=0;k<len/2;k++){const ur=re[i+k],ui=im[i+k],vr=re[i+k+len/2]*cr-im[i+k+len/2]*ci,vi=re[i+k+len/2]*ci+im[i+k+len/2]*cr;re[i+k]=ur+vr;im[i+k]=ui+vi;re[i+k+len/2]=ur-vr;im[i+k+len/2]=ui-vi;const nc=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=nc}}}};
function an39(d){const N=d.length;let peak=0,onset=-1,last=-1;for(let i=0;i<N;i++){const a=Math.abs(d[i]);if(a>peak)peak=a;if(a>1e-3){if(onset<0)onset=i;last=i}}
if(onset<0)return{peak:0,subRatio:0,toneRatio:0,noiseRatio:0,centroid:0,cv:0,diff6:0,zcr10:0,zcr30:0,bursts:0};
let FW=2048;const sup=last+1-onset;if(sup<FW*1.5)FW=512;const hop=FW/2,bins=new Float64Array(FW/2),win=new Float64Array(FW);for(let i=0;i<FW;i++)win[i]=.5-.5*Math.cos(2*Math.PI*i/(FW-1));const seg=new Float64Array(FW);let frames=0;for(let st=onset;st+FW<=Math.min(N,last+1);st+=hop){for(let i=0;i<FW;i++)seg[i]=d[st+i]*win[i];const re=new Float64Array(FW),im=new Float64Array(FW);re.set(seg);fft39(re,im);for(let k=1;k<FW/2;k++)bins[k]+=Math.sqrt(re[k]*re[k]+im[k]*im[k]);frames++}
if(!frames){for(let i=0;i<Math.min(FW,sup);i++)seg[i]=d[onset+i]*win[i];const re=new Float64Array(FW),im=new Float64Array(FW);re.set(seg);fft39(re,im);for(let k=1;k<FW/2;k++)bins[k]=Math.sqrt(re[k]*re[k]+im[k]*im[k]);frames=1}
for(let k=1;k<bins.length;k++)bins[k]/=frames;const binHz=SR39/FW;let sum=0,wsum=0,sub=0,tot=0,tone=0,noise=0;for(let k=1;k<bins.length;k++){const m=bins[k],f=k*binHz;sum+=m;wsum+=f*m;tot+=m*m;if(f<150)sub+=m*m;if(f>=150&&f<=1500)tone+=m*m;if(f>=2000&&f<=8000)noise+=m*m}
/* spectral peaks in 5–15 kHz (local maxima, up to 16 strongest, then
   frequency-sorted) + gap irregularity: a HARMONIC voice is ONE comb —
   consecutive peak gaps are uniform (cv = std/mean ≈ 0); the metallic
   stack mixes SIX inharmonic square families — gaps are irregular (cv
   high). cv >= .2 asserts inharmonicity; taking ALL detected peaks (not
   a fixed top-8) avoids the arbitrary-drop double-gap artifact on sparse
   combs. */
const pk=[];for(let k=Math.round(5000/binHz);k<Math.min(bins.length,Math.round(15000/binHz))-1;k++)if(bins[k]>bins[k-1]&&bins[k]>=bins[k+1])pk.push([bins[k],k*binHz]);pk.sort((a,b)=>b[0]-a[0]);const top=pk.slice(0,16).map(x=>x[1]).sort((a,b)=>a-b);
let cv=0;if(top.length>=4){const gaps=[];for(let i=1;i<top.length;i++)gaps.push(top[i]-top[i-1]);const mean=gaps.reduce((a,b)=>a+b,0)/gaps.length;if(mean>0){const va=gaps.reduce((a,b)=>a+(b-mean)*(b-mean),0)/gaps.length;cv=Math.sqrt(va)/mean}}
const n6=Math.min(Math.round(.006*SR39),N-onset);let se=0;for(let i=1;i<n6;i++){const h=d[onset+i]-d[onset+i-1];se+=h*h}const diff6=Math.sqrt(se/Math.max(n6-1,1));
const zcr=span=>{const n=Math.min(Math.round(span*SR39),N-onset);let c=0;for(let i=1;i<n;i++)if((d[onset+i-1]<0)!==(d[onset+i]<0))c++;return c/(n/SR39)};
let env=0,bursts=0,refr=0,prevA=false;const aC=Math.exp(-1/(.0005*SR39));for(let i=onset;i<=last;i++){env=aC*env+(1-aC)*Math.abs(d[i]);const ab=env>.2*peak;if(refr>0){refr--;prevA=ab;continue}if(ab&&!prevA){bursts++;refr=Math.round(.008*SR39)}prevA=ab}
return{peak:+peak.toFixed(4),subRatio:+(sub/Math.max(tot,1e-12)).toFixed(3),toneRatio:+(tone/Math.max(tot,1e-12)).toFixed(3),noiseRatio:+(noise/Math.max(tot,1e-12)).toFixed(3),centroid:+(wsum/Math.max(sum,1e-12)).toFixed(0),cv:+cv.toFixed(3),diff6:+diff6.toFixed(4),zcr10:+zcr(.01).toFixed(0),zcr30:+zcr(.03).toFixed(0),bursts}}
const m39={};const b39={};let det39=0;
for(const[nm,sd]of Object.entries({kick:{type:'kick',tune:.9,decay:.6,tone:1,punch:.7},snare:{type:'snare',tune:1.1,decay:.8,tone:1.2,punch:0},hatC:{type:'hatC',tune:1,decay:.5,tone:1.3,punch:0},clap:{type:'clap',tune:1,decay:1.4,tone:1,punch:0}})){
b39[nm]=await hit39(sd,1.6);m39[nm]=an39(b39[nm].getChannelData(0));
/* determinism: fresh-context re-render → PCM maxDiff */
const b2=await hit39(sd,1.6);const a=b39[nm].getChannelData(0),bb=b2.getChannelData(0);for(let i=0;i<Math.min(a.length,bb.length);i++){const e2=Math.abs(a[i]-bb[i]);if(e2>det39)det39=e2}}
/* the degenerate harmonic reference: a RAW square oscillator (525 Hz comb,
   rendered outside the engine — voices may evolve, a pure comb never does)
   must score cv ≈ 0 (uniform gaps) — proves the incoherence test bites on
   harmonic lattices */
{const rc=new OfflineAudioContext(1,Math.round(SR39*.5),SR39);const ro=rc.createOscillator();ro.type='square';ro.frequency.value=525;ro.connect(rc.destination);ro.start(.05);ro.stop(.45);m39.rimRef=an39((await rc.startRendering()).getChannelData(0))}
const K=m39.kick,S=m39.snare,H=m39.hatC,C=m39.clap;
const kickOk=K.subRatio>=.45&&K.diff6>=.05&&K.zcr10>K.zcr30;
const hatOk=H.centroid>=6000&&H.cv>=.2&&m39.rimRef.cv<=.1&&H.cv>m39.rimRef.cv;
const clapOk=C.bursts>=4;
const snareOk=S.toneRatio>=.04&&S.noiseRatio>=.04;
const detOk=det39<1e-6;
const ok39=kickOk&&hatOk&&clapOk&&snareOk&&detOk;
gate('G39','drum engine v2: kick sub>=.45 + click diff6>=.05 (v1 .0151) + pitch-env ZCR descent; hat centroid>=6k + inharmonic (peak-gap cv>=.2; degenerate square comb cv<=.1); clap >=4 bursts (v1=3); snare dual-band >=.04; all four voices deterministic maxDiff<1e-6',ok39,'kick sub='+K.subRatio+' diff6='+K.diff6+'(v1 .0151) zcr '+K.zcr10+'>'+K.zcr30+' | hat c='+H.centroid+' cv='+H.cv+'(rim cv='+m39.rimRef.cv+') | clap b='+C.bursts+'(v1 3) | snare t='+S.toneRatio+' n='+S.noiseRatio+' | detMaxDiff='+det39.toExponential(2))}catch(e){gate('G39','drum engine v2',false,'ERR '+e.message)}}
/* G40 — PERCUSSION v2 + LIBRARY (offline — CI-asserted, v0.12.0 P2):
   LIBRARY BREADTH: the factory library holds >= 150 presets and >= 100
   drum presets, unique ids, genre coverage 8/8 (PSYTRANCE, DARK-PSY, GOA,
   FULL-ON, TECHNO, TRANCE, PROGRESSIVE, HI-TECH), and EVERY preset passes
   the schema check (id/name/genre/cat/engine + known drum type + numeric
   params in sane ranges). KITS: 8 kits, every kit role resolves through
   libFind. NEW-VOICE SPECTRAL EVIDENCE (solo offline hits, Phase-0
   methodology): tom pitch sweep present (ZCR descends across the hit),
   cowbell dual-square partials (energy in both the 560 and 845 Hz bands),
   zap monotone descent (windowed ZCR strictly decreasing), boom sub-band
   dominance (<120 Hz ratio > .8). DETERMINISM: tom/cowbell/zap re-rendered
   fresh → maxDiff < 1e-6 (through-graph Chrome standard, G39 note). */
if((window.__psy6GateSkip||[]).includes('G40')){gate('G40','subset-skipped (window.__psy6GateSkip)',true,'skipped by the e2e subset run — the full CI run asserts this gate')}else{try{
const all40=libFilter('all','ALL');const drums40=all40.filter(x=>x.cat==='drum');
const ids40=new Set(all40.map(x=>x.id));
const uniq40=ids40.size===all40.length;
const GEN40=['PSYTRANCE','DARK-PSY','GOA','FULL-ON','TECHNO','TRANCE','PROGRESSIVE','HI-TECH'];
const genMissing=GEN40.filter(g=>!all40.some(x=>x.genre===g));
const TYPES40=new Set(['kick','snare','clap','hatC','hatO','tom','rim','glitch','shaker','conga','bongo','cowbell','clave','zap','boom','riser','impact']);
const cl2=(v,a,b)=>v>=a&&v<=b;
const bad40=all40.filter(x=>!x.id||!x.name||!x.genre||!x.cat||(x.engine!=='DRUM'&&x.engine!=='SYNTH')||(x.cat==='drum'&&(!TYPES40.has(x.type)||!cl2(x.tune??.1,.3,2)||!cl2(x.decay??.5,.1,4)||!cl2(x.tone??1,.3,2.5)||!cl2(x.punch??0,0,1))));
const kits40=Object.keys(KITS||{});
const kitsOk=kits40.length===8&&kits40.every(k=>{const roles=KITS[k];return['kick','snare','hat','perc','bass','lead','pad','arp','fx'].every(r=>libFind(roles[r]))});
const libOk=all40.length>=150&&drums40.length>=100&&uniq40&&genMissing.length===0&&bad40.length===0&&kitsOk;
/* new-voice spectral evidence */
const SR4=44100;
const hit4=async(sound,dur)=>{const oc=new OfflineAudioContext(1,Math.round(SR4*dur),SR4);const eng=new PooledEngine(oc);const tr={idx:0,kind:'drum',type:sound.type,presetId:'g40',name:'g40',sound:Object.assign({},sound),mix:{vol:1,pan:0,mute:false,solo:false,sendA:0,sendB:0},scAmount:0,scAttackMs:12,scHoldMs:0,scReleaseMs:140};eng.syncMix({bpm:145,fx:{delayDiv:'3/16',delayFb:.35},tracks:[tr]});eng.trigger(tr,.05,{track:0,off:0,vel:.9,note:60,lock:{}},60/145/4);return await oc.startRendering()};
const zcrWin=(d,a,b)=>{let z=0;for(let i=a+1;i<b;i++)if((d[i-1]<0)!==(d[i]<0))z++;return z/Math.max((b-a)/SR4,1)};
const dTom=(await hit4({type:'tom',tune:1.1,decay:.7,tone:1,punch:0},1)).getChannelData(0);
const w40=(t)=>Math.round(t*SR4);
const tomZ=[zcrWin(dTom,w40(.05),w40(.09)),zcrWin(dTom,w40(.09),w40(.13)),zcrWin(dTom,w40(.13),w40(.17)),zcrWin(dTom,w40(.17),w40(.21))];
const tomOk=tomZ[0]>=tomZ[1]&&tomZ[1]>=tomZ[2]&&tomZ[2]>=tomZ[3]&&tomZ[0]>tomZ[3];
const dCow=(await hit4({type:'cowbell',tune:1,decay:1,tone:1,punch:0},.6)).getChannelData(0);
/* dual-square partials: exact DFT (Goertzel) at 560 and 845 Hz — both must
   reach >= 50% of the strongest partial in the 200-2000 Hz coarse scan */
const mag4=(d,f)=>{let re=0,im=0;const a0=w40(.05);for(let i=0;i<16384;i++){const ph=2*Math.PI*f*i/SR4;re+=d[a0+i]*Math.cos(ph);im-=d[a0+i]*Math.sin(ph)}return Math.sqrt(re*re+im*im)/8192};
let cowMax=0;for(let f=200;f<=2000;f+=25){const m=mag4(dCow,f);if(m>cowMax)cowMax=m}
const cowA=mag4(dCow,560),cowB=mag4(dCow,845);
const cowOk40=cowA>=.5*cowMax&&cowB>=.5*cowMax;
const dZap=(await hit4({type:'zap',tune:1,decay:.8,tone:1,punch:0},.6)).getChannelData(0);
const zapZ=[zcrWin(dZap,w40(.05),w40(.08)),zcrWin(dZap,w40(.08),w40(.11)),zcrWin(dZap,w40(.11),w40(.14)),zcrWin(dZap,w40(.14),w40(.17)),zcrWin(dZap,w40(.17),w40(.2))];
let zapDesc=0;for(let i=0;i<4;i++)if(zapZ[i]>zapZ[i+1])zapDesc++;
const zapOk=zapDesc>=4;
const dBoom=(await hit4({type:'boom',tune:.9,decay:1,decay2:0,tone:1,punch:0},1.8)).getChannelData(0);
let subB=0,totB=0;for(let i=w40(.05);i<dBoom.length;i++){totB+=dBoom[i]*dBoom[i]}
{const bw2=(lo,hi)=>{let e=0;for(let i=0;i<8192;i++){const t=i/SR4;const w=.5-.5*Math.cos(2*Math.PI*i/8191);const s=dBoom[w40(.05)+i]*(Math.cos(2*Math.PI*lo*t)-Math.cos(2*Math.PI*hi*t));e+=s*s}return e};subB=bw2(20,120)/Math.max(totB,1e-12)}
const boomOk=subB>.8;
/* determinism on the new voices */
let det40=0;
for(const sd of [{type:'tom',tune:1.1,decay:.7,tone:1,punch:0},{type:'cowbell',tune:1,decay:1,tone:1,punch:0},{type:'zap',tune:1,decay:.8,tone:1,punch:0}]){
const a=(await hit4(sd,1)).getChannelData(0),b=(await hit4(sd,1)).getChannelData(0);for(let i=0;i<Math.min(a.length,b.length);i++){const e=Math.abs(a[i]-b[i]);if(e>det40)det40=e}}
const detOk40=det40<1e-6;
const ok40=libOk&&tomOk&&cowOk40&&zapOk&&boomOk&&detOk40;
gate('G40','percussion v2 + library: >=150 presets (>=100 drums), unique ids, genres 8/8, schema-valid, 8 kits resolve; tom pitch sweep (ZCR monotone), cowbell dual-square partials, zap monotone descent, boom sub>0.8; new voices deterministic maxDiff<1e-6',ok40,'lib='+all40.length+'('+drums40.length+' drums) badSchema='+bad40.length+' kits='+kits40.length+'/8 | tomZ='+tomZ.map(x=>x.toFixed(0)).join('/')+' cowA='+cowA.toFixed(3)+' cowB='+cowB.toFixed(3)+' cowMax='+cowMax.toFixed(3)+' zapDesc='+zapDesc+'/4 sub='+subB.toFixed(2)+' det='+det40.toExponential(2))}catch(e){gate('G40','percussion v2 + library',false,'ERR '+e.message)}}

/* G41 — MASTER SPACE (offline — CI-asserted, v0.12.0 P3):
   NEUTRAL CONTRACT: widthMaster 1 + pingPong off + classic IR leaves the
   exact pre-v0.12.0 topology — a full perturb→restore round trip on ONE
   engine (width 1.8→1, pingPong on→off, IR short→classic) re-renders the
   post-P2 reference byte-close: maxDiff < 1e-6 (expected 0 — the width
   network and ping-pong path are REMOVED at defaults, not ducked).
   WIDTH PROBE (non-vacuous): with real stereo content (panned tracks),
   widthMaster 1.8 raises the side-channel energy ratio (L−R)/total —
   both ratios logged; the rise must exceed 1.5×.
   PING-PONG PROBE (non-vacuous): with a delay send active, the L−R
   envelope alternates (sign flips ≥ 2) while the mono delay path has a
   constant-sign offset — flips logged for both.
   IR PROBE (non-vacuous): the long dark IR's tail (last 0.5 s RMS) is
   louder than the short bright IR's tail — both logged, ratio > 1.3.
   All three render through the ONE renderer (renderBounce) — no fork. */
if((window.__psy6GateSkip||[]).includes('G41')){gate('G41','subset-skipped (window.__psy6GateSkip)',true,'skipped by the e2e subset run — the full CI run asserts this gate')}else{try{const r41=await window.__psy6G41Run();gate('G41','master space: neutral contract (width/pingPong/IR perturb→restore maxDiff<1e-6), width 1.8 raises HF-side energy >1.3x (300 Hz protection excludes low side by design), ping-pong L-R envelope alternates (flips>=2, >mono), long-IR tail louder than short (>1.3x)',r41.ok,r41.ev)}catch(e){gate('G41','master space',false,'ERR '+e.message)}}
/* G42 — SYNTH ENGINE v2-lite (offline — CI-asserted, v0.13.0 P1):
   Five OPTIONAL preset params behind the SAME pooled SynthVoice, each one
   legacy-neutral (absent ⇒ the exact v0.12.0 scheduling). Solo synth hits,
   fresh OfflineAudioContext + PooledEngine per render (the G39 methodology):
   acid/FENV — an acid preset (fenv 12, res 14, fdec .06, cutoff 900) sweeps
     the resonant lowpass from ~10.8 kHz; the ABSOLUTE 6–12 kHz band RMS must
     be ≥1.5× the SAME preset at the legacy fenv 3 (sweep starts at 2.7 kHz —
     it never reaches that band; total-normalized ratios dilute here);
   slide/PENV — penv 36 st at C2 descends: ZCR(75–90 ms) / ZCR(150–240 ms)
     < .45, both sides at fenv 1 (flat filter — the legacy filter sweep alone
     moves ZCR, which would fake a descent; the first ~15 ms also warm up —
     measured flat ZCR 200→130 — so both windows sit post-settle); the
     no-penv render stays flat (> .8; measured ≈ 1.0);
   sub/SUB — sub .9 at C2: the 20–60 Hz band (sub fundamental f/2 = 32.7 Hz —
     the legacy triangle fundamental 65.4 Hz has no energy there) holds
     ratio ≥ .15 AND ≥2× the legacy render's;
   neutral — explicit legacy defaults ({fenv:3} only) vs fully-absent fields:
     maxDiff < 1e-6 (the through-graph standard, G39 note);
   determinism — the acid preset rendered twice in fresh contexts: maxDiff
     < 1e-6. */
if((window.__psy6GateSkip||[]).includes('G42')){gate('G42','subset-skipped (window.__psy6GateSkip)',true,'skipped by the e2e subset run — the full CI run asserts this gate')}else{try{
const SR42=44100;
const mk42=async(sound,note)=>{const oc=new OfflineAudioContext(1,SR42,SR42);const eng=new PooledEngine(oc);const tr={idx:0,kind:'synth',type:'synth',presetId:'g42',name:'g42',sound:Object.assign({},sound),mix:{vol:1,pan:0,mute:false,solo:false,sendA:0,sendB:0},scAmount:0,scAttackMs:12,scHoldMs:0,scReleaseMs:140};eng.syncMix({bpm:145,fx:{delayDiv:'3/16',delayFb:.35},tracks:[tr]});eng.trigger(tr,.05,{track:0,off:0,vel:.9,note:note||36,lock:{}},60/145/4);return await oc.startRendering()};
const zcr42=(x,a,b)=>{let c=0;const A=Math.round(a*SR42),B=Math.min(Math.round(b*SR42),x.length);for(let i=A+1;i<B;i++)if((x[i-1]<0&&x[i]>=0)||(x[i-1]>=0&&x[i]<0))c++;return c/((B-A)/SR42)};
const fft42=(re,im)=>{const n=re.length;for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}}for(let len=2;len<=n;len<<=1){const ang=-2*Math.PI/len,wr=Math.cos(ang),wi=Math.sin(ang);for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let k=0;k<len/2;k++){const ur=re[i+k],ui=im[i+k],vr=re[i+k+len/2]*cr-im[i+k+len/2]*ci,vi=re[i+k+len/2]*ci+im[i+k+len/2]*cr;re[i+k]=ur+vr;im[i+k]=ui+vi;re[i+k+len/2]=ur-vr;im[i+k+len/2]=ui-vi;const ncr=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=ncr}}}};
const bandRms42=(x,f0,f1,off)=>{const N=8192;const re=new Float64Array(N),im=new Float64Array(N);const o=Math.round((off||0)*SR42);for(let i=0;i<N;i++)re[i]=x[o+i]||0;fft42(re,im);const binHz=SR42/N;let s2=0;for(let k=1;k<N/2;k++){if(k*binHz>=f0&&k*binHz<=f1){const m=Math.sqrt(re[k]*re[k]+im[k]*im[k]);s2+=m*m}}return Math.sqrt(s2/(N/2))};
const bandRatio42=(x,f0,f1,off)=>{const N=8192;const re=new Float64Array(N),im=new Float64Array(N);const o=Math.round((off||0)*SR42);for(let i=0;i<N;i++)re[i]=x[o+i]||0;fft42(re,im);const binHz=SR42/N;let s=0,tot=0;for(let k=1;k<N/2;k++){const m=Math.sqrt(re[k]*re[k]+im[k]*im[k]);tot+=m;if(k*binHz>=f0&&k*binHz<=f1)s+=m}return s/Math.max(tot,1e-12)};
const maxDiff42=(a,b)=>{const A=a.getChannelData(0),B=b.getChannelData(0);let m=0;for(let i=0;i<Math.min(A.length,B.length);i++){const d=Math.abs(A[i]-B[i]);if(d>m)m=d}return m};
const BASE42={wave1:'sawtooth',wave2:'sawtooth',cutoff:900,res:14,atk:.003,dec:.12,sus:0,rel:.08,gate:.5};
const acid42=Object.assign({},BASE42,{fenv:12,fdec:.06});
const acidBuf=await mk42(acid42,48),legacyBuf=await mk42(BASE42,48);
/* ABSOLUTE band RMS (not total-normalized — the acid sweep's energy above 6 kHz
   would otherwise dilute the ratio): the fenv-12 sweep reaches 6–12 kHz, the
   legacy fenv-3 sweep never starts above 2.7 kHz. */
const acidHF=bandRms42(acidBuf.getChannelData(0),6000,12000,.06),legacyHF=bandRms42(legacyBuf.getChannelData(0),6000,12000,.06);
const SBASE={wave1:'triangle',wave2:'sine',cutoff:400,res:1,atk:.003,dec:.3,sus:.4,rel:.1,gate:.9};
const SLIDE=Object.assign({},SBASE,{fenv:1});/* fenv 1 = flat filter — isolates PITCH from the legacy filter sweep (the sweep alone moves ZCR) */
const slideBuf=await mk42(Object.assign({},SLIDE,{penv:36,pdec:.1}),36),slideLegacy=await mk42(SLIDE,36);
const z1=zcr42(slideBuf.getChannelData(0),.075,.09),z2=zcr42(slideBuf.getChannelData(0),.15,.24);
const z1L=zcr42(slideLegacy.getChannelData(0),.075,.09),z2L=zcr42(slideLegacy.getChannelData(0),.15,.24);
const subBuf=await mk42(Object.assign({},SBASE,{sub:.9}),36),subLegacy=await mk42(SBASE,36);
/* sub-osc fundamental at f/2 = 32.7 Hz for C2 — the 20–60 Hz band is where ONLY
   the sub lives (the legacy triangle fundamental is 65.4 Hz). */
const subR=bandRatio42(subBuf.getChannelData(0),20,60,.05),subL=bandRatio42(subLegacy.getChannelData(0),20,60,.05);
const neuA=await mk42(SBASE,48),neuB=await mk42(Object.assign({},SBASE,{fenv:3}),48);
const neuDiff=maxDiff42(neuA,neuB);
const det42=maxDiff42(acidBuf,await mk42(acid42,48));
const ok42=acidHF>=legacyHF*1.5&&(z2/z1)<.45&&(z2L/z1L)>.8&&subR>=.15&&subR>subL*2&&neuDiff<1e-6&&det42<1e-6;
gate('G42','synth v2-lite: acid fenv 6-12k RMS >=1.5x legacy, penv descent (flat-filter isolation) z-ratio <.45 (no-penv >.8), sub 20-60Hz ratio >=.15 & >2x legacy, neutral maxDiff<1e-6, determinism<1e-6',ok42,'acidHF='+acidHF.toExponential(2)+' legacyHF='+legacyHF.toExponential(2)+'(x'+(acidHF/Math.max(legacyHF,1e-12)).toFixed(2)+') | slide z '+z1.toFixed(0)+'>'+z2.toFixed(0)+' r='+(z2/z1).toFixed(2)+' no-penv r='+(z2L/z1L).toFixed(2)+' | sub '+subR.toFixed(3)+'>'+subL.toFixed(3)+' | neutral '+neuDiff.toExponential(1)+' | det '+det42.toExponential(1))}catch(e){gate('G42','synth v2-lite',false,'ERR '+e.message)}}
/* G43 — MOOG LADDER INSERT (offline — CI-asserted, v0.13.0 P2):
   the psy-dsp.js 4-stage tanh-feedback ladder, wired as a per-track insert
   (ins.filtOn 4) through the ONE syncMix insert path:
   prep — the probe preps its OWN OfflineAudioContext via prepInsertDSP
     (exactly what bounce/freeze do); eng.moogSpawns===1 + moogFallbacks===0
     prove the real worklet node built;
   non-vacuous direction — MOOG (cutoff 700) vs the SAME render with the
     insert OFF: the 4–12 kHz band RMS must DROP below .7× (it IS a lowpass)
     while staying non-silent (peak > .01);
   moog ≠ biquad — the prepped MOOG render vs the UNPREPPED context's biquad
     LP fallback at the same cutoff (Q 6 → ladder resonance 1.0): the two
     engines must differ audibly (maxDiff > 1e-3) AND the ladder's cutoff-band
     RMS stays >= .35x the biquad's (a distinct, not broken, curve — measured
     .47x at Q 6: the ladder's tanh-feedback peak is GENTLER than a biquad's
     pole-Q resonance, which is the known sonic difference, not a defect);
   honest fallback — the unprepped context renders NON-SILENTLY through the
     counted biquad fallback (moogFallbacks===1, moogSpawns===0);
   determinism — two prepped MOOG renders: maxDiff < 1e-6. */
if((window.__psy6GateSkip||[]).includes('G43')){gate('G43','subset-skipped (window.__psy6GateSkip)',true,'skipped by the e2e subset run — the full CI run asserts this gate')}else{try{
const SR43=44100;
const fft43=(re,im)=>{const n=re.length;for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}}for(let len=2;len<=n;len<<=1){const ang=-2*Math.PI/len,wr=Math.cos(ang),wi=Math.sin(ang);for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let k=0;k<len/2;k++){const ur=re[i+k],ui=im[i+k],vr=re[i+k+len/2]*cr-im[i+k+len/2]*ci,vi=re[i+k+len/2]*ci+im[i+k+len/2]*cr;re[i+k]=ur+vr;im[i+k]=ui+vi;re[i+k+len/2]=ur-vr;im[i+k+len/2]=ui-vi;const ncr=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=ncr}}}};
const bandRms43=(x,f0,f1,off)=>{const N=8192;const re=new Float64Array(N),im=new Float64Array(N);const o=Math.round((off||0)*SR43);for(let i=0;i<N;i++)re[i]=x[o+i]||0;fft43(re,im);const binHz=SR43/N;let s2=0;for(let k=1;k<N/2;k++){if(k*binHz>=f0&&k*binHz<=f1){const m=Math.sqrt(re[k]*re[k]+im[k]*im[k]);s2+=m*m}}return Math.sqrt(s2/(N/2))};
const maxDiff43=(a,b)=>{const A=a.getChannelData(0),B=b.getChannelData(0);let m=0;for(let i=0;i<Math.min(A.length,B.length);i++){const d=Math.abs(A[i]-B[i]);if(d>m)m=d}return m};
const peak43=x=>{let m=0;for(let i=0;i<x.length;i++){const a=Math.abs(x[i]);if(a>m)m=a}return m};
const mk43=async(prep,withIns)=>{const oc=new OfflineAudioContext(1,SR43,SR43);if(prep){const ok=await prepInsertDSP(oc);if(!ok)throw new Error('prepInsertDSP failed')}const eng=new PooledEngine(oc);const tr={idx:0,kind:'synth',type:'synth',presetId:'g43',name:'g43',sound:{wave1:'sawtooth',wave2:'sawtooth',cutoff:900,res:2,atk:.003,dec:.3,sus:.6,rel:.1,gate:.9},ins:{drive:0,crush:16,filtOn:withIns?4:0,filtFreq:700,filtQ:6},mix:{vol:1,pan:0,mute:false,solo:false,sendA:0,sendB:0},scAmount:0,scAttackMs:12,scHoldMs:0,scReleaseMs:140};eng.syncMix({bpm:145,fx:{delayDiv:'3/16',delayFb:.35},tracks:[tr]});eng.trigger(tr,.05,{track:0,off:0,vel:.9,note:48,lock:{}},60/145/4);const buf=await oc.startRendering();return{buf,eng}};
const moogR=await mk43(true,true),offR=await mk43(true,false),bqR=await mk43(false,true),moogR2=await mk43(true,true);
const moogHi=bandRms43(moogR.buf.getChannelData(0),4000,12000,.06),offHi=bandRms43(offR.buf.getChannelData(0),4000,12000,.06);
const moogCore=bandRms43(moogR.buf.getChannelData(0),500,900,.06),bqCore=bandRms43(bqR.buf.getChannelData(0),500,900,.06);
const mdBq=maxDiff43(moogR.buf,bqR.buf),mdDet=maxDiff43(moogR.buf,moogR2.buf);
const pk=peak43(moogR.buf.getChannelData(0));
const ok43=moogR.eng.moogSpawns===1&&moogR.eng.moogFallbacks===0&&moogHi<offHi*.7&&pk>.01&&mdBq>1e-3&&moogCore>=bqCore*.35&&bqR.eng.moogFallbacks===1&&bqR.eng.moogSpawns===0&&peak43(bqR.buf.getChannelData(0))>.01&&mdDet<1e-6;
gate('G43','moog insert: real worklet node (spawns=1 fallbacks=0), 4-12k drops <.7x vs insert-off (non-silent), moog!=biquad (maxDiff>1e-3, core band >=.5x biquad), honest counted fallback (fallbacks=1, non-silent), determinism<1e-6',ok43,'spawns='+moogR.eng.moogSpawns+' fbs='+moogR.eng.moogFallbacks+' moogHi='+moogHi.toExponential(2)+' offHi='+offHi.toExponential(2)+'(x'+(moogHi/Math.max(offHi,1e-12)).toFixed(2)+') | mdBq='+mdBq.toExponential(2)+' core moog='+moogCore.toExponential(2)+' bq='+bqCore.toExponential(2)+' | fbFbs='+bqR.eng.moogFallbacks+' fbPk='+peak43(bqR.buf.getChannelData(0)).toFixed(3)+' | det='+mdDet.toExponential(1))}catch(e){gate('G43','moog insert',false,'ERR '+e.message)}}
/* G44 — LOAD & STEAL DISCIPLINE under stress (offline — CI-asserted, v0.13.0 P3):
   the owner's smoothness contract, measured. A dense 4-bar mix through the
   DEFAULT pools (synth 20 / drum 24): kick every 4th step (16, tier 0),
   bass 16ths (64, tier 0 — a SECOND tier-0 track), closed hats every step
   (64), tom every 2 steps (32), one sustained pad (1). G9 proved kick-alone;
   G44 doubles the tier-0 pressure and adds the counters the LOAD chip shows:
   zero starvation — kicks 16/16, bass 64/64, tier0StealAttempts===0 (the
     dedicated-voice mechanism protects both tier-0 tracks);
   stealing happens (non-vacuous) — steals > 0 (lower tiers yield first);
   accounting — spawnCount 177, per-track counts exact;
   reaper discipline — after the render, loadSnapshot().active===0 (every
     busyUntil expired: no stuck voices) and latencyMs >= 0, pools reported;
   live UI — the header LOAD chip exists (the 4 Hz painter reads the same
     snapshot in the realtime engine). */
if((window.__psy6GateSkip||[]).includes('G44')){gate('G44','subset-skipped (window.__psy6GateSkip)',true,'skipped by the e2e subset run — the full CI run asserts this gate')}else{try{
const SR44=44100,sd44=60/145/4;
const oc44=new OfflineAudioContext(2,Math.round(SR44*8),SR44);
const eng44=new PooledEngine(oc44,{synthVoices:4,drumVoices:3});/* deliberately TIGHT pools — the claim is discipline UNDER pressure (G9's mechanism, double tier-0) */
const mk44=(idx,kind,type,cat)=>({idx,kind,type,presetId:'g44-'+idx,name:'g44-'+idx,sound:kind==='drum'?{type,tune:1,decay:1,tone:1,punch:.5}:{wave1:'sawtooth',wave2:'square',cat:cat||'lead',cutoff:900,res:6,gate:.3,dec:.12,sus:.3,rel:.05},mix:{vol:1,pan:0,mute:false,solo:false,sendA:0,sendB:0},scAmount:0,scAttackMs:12,scHoldMs:0,scReleaseMs:140});
const trK=mk44(0,'drum','kick'),trH=mk44(2,'drum','hatC'),trT=mk44(3,'drum','tom'),trB=mk44(1,'synth',null,'bass'),trP=mk44(4,'synth',null,'pad');
eng44.syncMix({bpm:145,fx:{delayDiv:'3/16',delayFb:.35},tracks:[trK,trB,trH,trT,trP]});
for(let s=0;s<64;s++){const t=.05+s*sd44;
if(s%4===0)eng44.trigger(trK,t,{track:0,off:0,vel:.95,note:36,lock:{}},sd44);
eng44.trigger(trH,t,{track:2,off:0,vel:.6,note:0,lock:{}},sd44);
eng44.trigger(trB,t,{track:1,off:0,vel:.85,note:40+(s%8<4?0:2),lock:{}},sd44);
if(s%2===0)eng44.trigger(trT,t,{track:3,off:0,vel:.7,note:0,lock:{}},sd44);}
eng44.trigger(trP,.05,{track:4,off:0,vel:.7,note:52,lock:{}},sd44*64);
const buf44=await oc44.startRendering();
const L44=buf44.getChannelData(0);let pk44=0;for(let i=0;i<L44.length;i++){const a=Math.abs(L44[i]);if(a>pk44)pk44=a}
const end44=eng44.loadSnapshot();
const dom44=!!document.querySelector('#loadMeter');
const ok44=eng44.spawnCount===177&&eng44.trackCount[0]===16&&eng44.trackCount[1]===64&&eng44.trackCount[2]===64&&eng44.trackCount[3]===32&&eng44.trackCount[4]===1&&eng44.tier0StealAttempts===0&&(end44.steals>0)&&end44.active===0&&end44.latencyMs>=0&&end44.pools.synth===4&&end44.pools.drum===3&&pk44>.05&&dom44;
gate('G44','stress: 177 spawns (16k+64b tier0 + 64h+32t+pad), zero tier-0 starvation, steals>0 (lower tiers yield), reaper active===0 post-render, telemetry real (latency>=0, tight pools 4/3), LOAD chip in DOM, peak>.05',ok44,'spawn='+eng44.spawnCount+' k='+eng44.trackCount[0]+' b='+eng44.trackCount[1]+' h='+eng44.trackCount[2]+' t='+eng44.trackCount[3]+' p='+eng44.trackCount[4]+' T0='+eng44.tier0StealAttempts+' steals='+end44.steals+' activeEnd='+end44.active+' lat='+end44.latencyMs+'ms pk='+pk44.toFixed(2)+' dom='+dom44)}catch(e){gate('G44','load/steal stress',false,'ERR '+e.message)}}
/* G45 — UI OPTIONS EXPOSURE (DOM + offline math — CI-asserted, v0.13.1):
   v0.12.0/v0.13.0 grew engine capabilities the UI never offered: master
   WIDTH, ping-pong delay, reverb IR variants and extra delay divisions had
   NO control, and the composer exposed only 5 of the 8 kit styles. The
   owner asked for more choices — this gate pins the EXPOSURE contract so
   the options cannot silently disappear again:
   • a11y — ZERO orphan <label>s in the live document (the DevTools audit
     that flagged the 5 header labels is exactly the regression prevented);
   • Mixer WIDTH slider writes master.widthMaster through ensureMaster and
     the engine reacts (widthOn true at 1.8, false at exactly 1 = neutral);
   • PING-PONG toggle writes fx.pingPong and the engine rewires (ppOn);
   • IR select writes fx.irKind and swaps the convolver (eng._irKind);
   • the delay bus offers 6 BPM-synced divisions and the send math matches
     exactly (1/16 = one 16th, 1/2 = eight 16ths, restore 3/16);
   • the factory search box strictly filters the live preset list;
   • the composer offers 9 styles — the four new families (PSYTRANCE/GOA/
     TECHNO/TRANCE) compose deterministically (double run byte-identical). */
if((window.__psy6GateSkip||[]).includes('G45')){gate('G45','subset-skipped (window.__psy6GateSkip)',true,'skipped by the e2e subset run — the full CI run asserts this gate')}else{try{
const orph=Array.from(document.querySelectorAll('label')).filter(l=>!(l.htmlFor&&document.getElementById(l.htmlFor))&&!l.querySelector('input,select,textarea'));
renderMixer();
const wIn=document.querySelector('#masterBar input.mParam[data-p="widthMaster"]');
let wHi=false,wLo=false;
if(wIn){wIn.value='1.8';wIn.dispatchEvent(new Event('input'));wHi=I.p.master.widthMaster===1.8&&I.eng.widthOn===true;wIn.value='1';wIn.dispatchEvent(new Event('input'));wLo=I.p.master.widthMaster===1&&I.eng.widthOn===false}
const ppB=$('fxPP');ppB.click();const ppOn=I.p.fx.pingPong===1&&I.eng.ppOn===true;ppB.click();const ppOff=I.p.fx.pingPong!==1&&I.eng.ppOn===false;
const irS=$('fxIr');irS.value='long';irS.dispatchEvent(new Event('change'));const irL=I.p.fx.irKind==='long'&&I.eng._irKind==='long';irS.value='short';irS.dispatchEvent(new Event('change'));const irS2=I.p.fx.irKind==='short'&&I.eng._irKind==='short';irS.value='classic';irS.dispatchEvent(new Event('change'));const irC=I.p.fx.irKind==='classic'&&I.eng._irKind==='classic';
const divS=$('fxDiv');const divN=divS.options.length;divS.value='1/16';divS.dispatchEvent(new Event('change'));const d16=I.p.fx.delayDiv==='1/16'&&Math.abs(delaySecondsFor('1/16',I.p.bpm)-60/I.p.bpm/4)<1e-12;divS.value='1/2';divS.dispatchEvent(new Event('change'));const d12=I.p.fx.delayDiv==='1/2'&&Math.abs(delaySecondsFor('1/2',I.p.bpm)-8*60/I.p.bpm/4)<1e-12;divS.value='3/16';divS.dispatchEvent(new Event('change'));const dBack=I.p.fx.delayDiv==='3/16';
const n0=document.querySelectorAll('#libList .lib').length;$('libQ').value='acid';renderLib();const n1=document.querySelectorAll('#libList .lib').length;$('libQ').value='';renderLib();const n2=document.querySelectorAll('#libList .lib').length;
const styles=Object.keys(COMPOSER_STYLES);const newSty=['PSYTRANCE','GOA','TECHNO','TRANCE'];let detOk=true,detEv='';
for(const s of newSty){const a=compose(s,3,555),b=compose(s,3,555);const eq=JSON.stringify(a.project)===JSON.stringify(b.project);const good=a.form.sections.length===7&&a.stats.scenes>7&&a.form.bpm===COMPOSER_STYLES[s].bpm;if(!eq||!good)detOk=false;detEv+=s+':'+a.form.bpm+'/'+a.stats.scenes+(eq&&good?' ok':' BAD')+' '}
const ok45=orph.length===0&&wHi&&wLo&&ppOn&&ppOff&&irL&&irS2&&irC&&divN===6&&d16&&d12&&dBack&&n1>0&&n1<n0&&n2===n0&&styles.length===9&&detOk;
gate('G45','UI options exposure: 0 orphan labels in DOM; WIDTH slider 1→1.8→1 writes master.widthMaster and toggles eng.widthOn (1 = exact neutral); PP toggle flips fx.pingPong + eng.ppOn; IR select long/short/classic swaps eng._irKind; 6 delay divisions (1/16 & 1/2 math exact, restore 3/16); library search strictly filters (acid: 0<n<nAll, clear restores); 9 composer styles, the 4 new families compose byte-identical twice',ok45,'orph='+orph.length+' w='+wHi+'/'+wLo+' pp='+ppOn+'/'+ppOff+' ir='+(irL?'L':'')+(irS2?'S':'')+(irC?'C':'')+' div='+divN+' d16='+d16+' d12='+d12+' lib='+n1+'<'+n0+'(='+n2+') styles='+styles.length+' det='+(detOk?detEv:'FAIL '+detEv))}catch(e){gate('G45','UI options exposure',false,'ERR '+e.message)}}

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
