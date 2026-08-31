import { stepEvents, loopLen, fnv } from './model.js';
import { PooledEngine } from './engine.js';

/* ============ BOUNCE — offline WAV render (PSY6) ============
Rebuilds the ENTIRE engine graph inside a fresh OfflineAudioContext (the
live AudioContext is never touched) and schedules pattern-loop × N using
the SAME deterministic per-bar event function (stepEvents) as the live
scheduler — same project seed ⇒ byte-identical event list every time.

Documented difference vs live playback: the offline render has no
worker-timer lookahead jitter — events land at mathematically exact sample
positions. The live path schedules the same offsets through the AudioContext
clock (± worker-timer jitter). Musically identical; sample-exact offline.

WAV format: 44-byte RIFF header, 16-bit PCM, stereo, 44.1 kHz. */

/* bounceSchedule — the exact event list a bounce will render, as pure data
 * (bun-testable). t0 leaves headroom for the first attack transient. */
export function bounceSchedule(p,loops,t0){
const L=loopLen(p),sd=60/p.bpm/4,evs=[];
for(let s=0;s<L*loops;s++){
const list=stepEvents(p,s);
for(const e of list)evs.push({s,t:t0+s*sd+e.off,track:e.track,vel:e.vel,note:e.note,lock:e.lock});
}
return {evs,stepDur:sd,loopLen:L,total:t0+L*loops*sd};
}

/* evHash — stable hash of a schedule (schedIdentical evidence for G13). */
export function evHash(evs){
let s='';
for(const e of evs)s+=e.s+','+e.track+','+e.t.toFixed(6)+','+e.vel.toFixed(3)+','+e.note+','+JSON.stringify(e.lock||{})+';';
return fnv(s);
}

/* wavEncode — 16-bit PCM stereo WAV with a 44-byte RIFF header.
 * channels: array of Float32Array (all same length); sampleRate in Hz.
 * Clipping: hard-limit to [-1,1]; negative full scale = -32768, positive
 * full scale = 32767 (standard WAV practice). */
export function wavEncode(channels,sampleRate){
const n=channels[0].length,nc=channels.length,dataSize=n*nc*2;
const ab=new ArrayBuffer(44+dataSize),v=new DataView(ab);
const ws=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};
ws(0,'RIFF');v.setUint32(4,36+dataSize,true);ws(8,'WAVE');
ws(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,nc,true);
v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*nc*2,true);
v.setUint16(32,nc*2,true);v.setUint16(34,16,true);
ws(36,'data');v.setUint32(40,dataSize,true);
let o=44;
for(let i=0;i<n;i++)for(let c=0;c<nc;c++){
const x=Math.max(-1,Math.min(1,channels[c][i]));
v.setInt16(o,x<0?x*32768:x*32767,true);o+=2;
}
return ab;
}

/* pcmFromBuffer — AudioBuffer → {channels, sampleRate} for wavEncode. */
export function pcmFromBuffer(buf){
const ch=[];for(let c=0;c<buf.numberOfChannels;c++)ch.push(buf.getChannelData(c));
return {channels:ch,sampleRate:buf.sampleRate};
}

/* renderBounce — offline render of the current pattern × loops.
 * opts.trackIdx (optional): render a STEM — only that track's events are
 * triggered (the other tracks never spawn voices → their contribution is
 * exactly 0), through the SAME deterministic graph and schedule. No opts →
 * full-mix render, byte-identical behavior to v0.3.0 (same hash).
 * opts.engineOpts (optional): passed to the PooledEngine constructor —
 * evidence plumbing for the G29 neutral-tolerance A/B ({masterFlat:true}
 * = the exact pre-v0.8.0 master topology); the production render path
 * never sets it.
 * Returns {buf, N, scheduleHash} — N is the EXACT sample count the schedule
 * spans (buffer.length === N), scheduleHash identifies the event list. */
export async function renderBounce(p,loops,opts){
opts=opts||{};
const sr=44100,t0=.05;
let sch=bounceSchedule(p,loops,t0);
if(opts.trackIdx!=null)sch=Object.assign({},sch,{evs:sch.evs.filter(e=>e.track===opts.trackIdx)});
const N=Math.ceil(sch.total*sr);
const oc=new OfflineAudioContext(2,N,sr);
const eng=new PooledEngine(oc,opts.engineOpts||{});
eng.syncMix(p);
for(const e of sch.evs)eng.trigger(p.tracks[e.track],e.t,{track:e.track,off:0,vel:e.vel,note:e.note,lock:e.lock||{}},sch.stepDur);
const buf=await oc.startRendering();
return {buf,N,scheduleHash:evHash(sch.evs),schedule:sch};
}

/* stemTracks — which tracks have notes in the current bounce schedule
 * (current pattern × loops)? Only non-empty tracks get stem files. */
export function stemTracks(p,loops){
const sch=bounceSchedule(p,loops,.05);
const seen=new Set();for(const e of sch.evs)seen.add(e.track);
return {tracks:Array.from(seen).sort((a,b)=>a-b),schedule:sch};
}

/* ============ SONG RENDER (Run 9) — the whole arrangement to WAV ============
Renders p.arranger ([scene,bars] chain) through the EXISTING machinery —
stepEvents (per-bar seeded groove/probability), the LIVE scene-launch
transition rule (sc.step = sc.step % newLoop), per-scene auto-FILL, and the
per-step automation player (applyLanes → syncMix / resolveMacros). No
parallel renderer: the same event function and the same phase bookkeeping
as schedTick, walked once offline.

Documented differences vs live PLAY SONG (same class as the loop-bounce
note above): (1) events land at mathematically exact sample positions (no
worker-timer jitter); (2) state-lane glides anchor exactly at their step
time instead of up-to-LOOKAHEAD early. Musically identical; the event
schedule is provably equal (G24 asserts evHash equality against the pure
oracle built from the same generator).

Frame-count formula (documented, asserted in tests + G24):
  frames = ceil(sr · (SONG_LEAD + (Σbars·16 + SONG_TAIL_STEPS) · (60/bpm/4)))
  SONG_LEAD = 0.05 s attack headroom (same convention as loop bounce),
  SONG_TAIL_STEPS = 32 (2 bars) for delay/reverb release after the final
  section. Music length (no lead/tail) and with-tail length are reported
  separately in the UI toast and in gate evidence. */

import { applyLanes } from './autorec.js';
import { resolveMacros } from './state.js';
import { applySceneMix } from './scenes.js';

export const SONG_LEAD = .05;       /* s — attack headroom, matches loop bounce t0 */
export const SONG_TAIL_STEPS = 32;  /* 2 bars of 16 steps — FX release tail */
export const SONG_MAX_SEC = 600;    /* memory guard: refuse renders beyond 10 min */

/* songSteps — the single source of truth for the song timeline walk.
 * Yields one entry per STEP of the whole arrangement, applying the exact
 * live scheduler bookkeeping:
 *   - fresh start: phase 0 (startSched resets sc.step = 0)
 *   - on a successful scene launch: phase = phase % loopLen(newPattern)
 *     (schedTick: sc.step = sc.step % sc.loop) — the new pattern continues
 *     from the old phase, exactly like the quantized pending transition
 *   - an empty scene never launches (PERF.launch → {ok:false}): the
 *     previous pattern keeps playing, phase keeps advancing mod the OLD loop
 *   - scene.fill → launch flourish marker (PERF.fill: 8 half-step kick hits
 *     on track 3) fired at the section boundary
 * Mutates p.currentPattern while walking (pass a clone if that matters). */
export function* songSteps(p){
const steps=(p.arranger&&Array.isArray(p.arranger.steps))?p.arranger.steps:[];
let phase=0,abs=0;
for(let i=0;i<steps.length;i++){
const st=steps[i],scn=p.scenes[st.scene];
const start=abs;
if(scn&&scn.pattern!=null){
p.currentPattern=scn.pattern;
const L=loopLen(p);
phase=phase%L;
yield{abs,phase,scene:st.scene,sectionStart:true,fill:!!scn.fill};
phase=(phase+1)%L;abs++;
for(let k=1;k<st.bars*16;k++){yield{abs,phase,scene:st.scene,sectionStart:false,fill:false};phase=(phase+1)%L;abs++}
}else{
const L=loopLen(p);
for(let k=0;k<st.bars*16;k++){yield{abs,phase,scene:st.scene,sectionStart:abs===start,fill:false,empty:true};phase=(phase+1)%L;abs++}
}
}
}

/* songSchedule — the pure event list of the whole song (bun-testable oracle).
 * Same shape as bounceSchedule: {evs, stepDur, sections, totalSteps, total}. */
export function songSchedule(p,t0){
t0=t0==null?SONG_LEAD:t0;
const sd=60/p.bpm/4,evs=[],marks=[];
for(const y of songSteps(p)){
if(y.fill&&y.sectionStart){const scn=p.scenes[y.scene];
if(scn&&scn.pattern!=null)for(let k=0;k<8;k++)evs.push({s:y.abs,t:t0+y.abs*sd+k*sd/2,track:3,vel:.5+.05*k,note:48,lock:{},fill:true})}
const list=stepEvents(p,y.phase);
for(const e of list)evs.push({s:y.abs,t:t0+y.abs*sd+e.off,track:e.track,vel:e.vel,note:e.note,lock:e.lock});
if(y.sectionStart)marks.push({scene:y.scene,startStep:y.abs});
}
const totalSteps=(p.arranger&&Array.isArray(p.arranger.steps))?p.arranger.steps.reduce((a,s)=>a+(s.bars|0)*16,0):0;
for(let i=0;i<marks.length;i++){
marks[i].endStep=(i+1<marks.length)?marks[i+1].startStep:totalSteps;
marks[i].bars=(marks[i].endStep-marks[i].startStep)/16;
}
return{evs,stepDur:sd,sections:marks,totalSteps,total:t0+(totalSteps+SONG_TAIL_STEPS)*sd};
}

/* songSections — arranger steps grouped into MUSICAL sections (consecutive
 * steps of the same scene), with absolute BAR ranges for RMS slicing. */
export function songSections(p){
const steps=(p.arranger&&Array.isArray(p.arranger.steps))?p.arranger.steps:[];
const out=[];let bar=0;
for(const st of steps){
const last=out[out.length-1];
if(last&&last.scene===st.scene){last.bars+=st.bars;last.endBar+=st.bars}
else out.push({scene:st.scene,name:(p.scenes[st.scene]&&p.scenes[st.scene].name)||('SCENE '+(st.scene+1)),bars:st.bars,startBar:bar,endBar:bar+st.bars});
bar+=st.bars;
}
return out;
}

/* songFrames — the EXACT sample count a song render will produce (formula). */
export function songFrames(p){
const sd=60/p.bpm/4;
const bars=(p.arranger&&Array.isArray(p.arranger.steps))?p.arranger.steps.reduce((a,s)=>a+(s.bars|0),0):0;
return Math.ceil(44100*(SONG_LEAD+(bars*16+SONG_TAIL_STEPS)*sd));
}

/* songDurationSec — music length and with-tail length, for UI readouts. */
export function songDurationSec(p){
const sd=60/p.bpm/4;
const bars=(p.arranger&&Array.isArray(p.arranger.steps))?p.arranger.steps.reduce((a,s)=>a+(s.bars|0),0):0;
return{music:bars*16*sd,withTail:(bars*16+SONG_TAIL_STEPS)*sd};
}

/* ============ SONG → MIDI EXPORT (v0.7.0) — standard interchange ============
   songMidi(p) consumes the SAME song expansion as the offline WAV renderer:
   the walk is the songSteps generator (identical to renderSong's loop) and
   the events are stepEvents — the SAME deterministic per-step function the
   live scheduler and songSchedule use. No parallel logic exists; the bun
   tests assert note-for-note identity between songMidi's note list and the
   songSchedule event mapping (the .mid == WAV schedule contract).

   Tick mapping (documented): 1 step = ppq/4 ticks (120 @ ppq 480), one bar =
   4·480 = 1920 ticks, total = Σbars·4·480. Per-event groove/micro offsets
   convert from seconds to ticks at the same resolution (off/sd·ppq/4).
   Channels (device convention, documented): melodic (kind 'synth') tracks →
   channels 1–8 (index 0–7) in track order; every drum-kind track → channel
   10 (index 9) with its own preset note — the GM percussion convention.
   durTicks = 1 step (120): the export is a trigger map, the WAV is the
   authoritative sound. Refuses (null) when the arranger is empty or more
   than 8 melodic tracks exist (channel budget). */
export function songMidi(p) {
  const steps0 = (p.arranger && Array.isArray(p.arranger.steps)) ? p.arranger.steps : [];
  if (!steps0.length) return null;
  const cp = JSON.parse(JSON.stringify(p)); /* side-effect-free like renderSong */
  const steps = cp.arranger.steps;
  const melodic = [];
  for (let t = 0; t < cp.tracks.length; t++) {
    if (!cp.tracks[t]) continue;
    if (cp.tracks[t].kind === 'drum') continue;
    if (melodic.length >= 8) return null; /* channel budget: 1–8 */
    melodic.push(t);
  }
  const chOf = new Map();
  melodic.forEach((t, i) => chOf.set(t, i));      /* channels 0..7 = MIDI 1..8 */
  const ppq = 480, stepTicks = ppq / 4, sd = 60 / cp.bpm / 4;
  const buckets = new Map(); /* track → notes[] */
  for (const y of songSteps(cp)) {
    const list = stepEvents(cp, y.phase);
    for (const e of list) {
      if (!buckets.has(e.track)) buckets.set(e.track, []);
      buckets.get(e.track).push({
        tick: y.abs * stepTicks + Math.round((e.off / sd) * stepTicks),
        durTicks: stepTicks,
        midi: e.note,
        vel: e.vel,
      });
    }
  }
  const tracks = [];
  for (const [t, notes] of buckets) {
    if (!notes.length) continue;
    notes.sort((a, b) => a.tick - b.tick);
    tracks.push({
      name: (cp.tracks[t] && cp.tracks[t].name) || ('TRACK ' + (t + 1)),
      channel: chOf.has(t) ? chOf.get(t) : 9, /* drums → channel 10 (index 9) */
      drum: !chOf.has(t),
      notes,
    });
  }
  tracks.sort((a, b) => a.channel - b.channel);
  const totalBars = steps.reduce((a, s) => a + (s.bars | 0), 0);
  return { ppq, bpm: cp.bpm, name: 'PSY6 SONG ' + cp.bpm + 'BPM', tracks, totalTicks: totalBars * 4 * ppq };
}
/* songRenderController — cancel/progress contract for renderSong (unit-
 * testable without Web Audio; the UI drives it from the CANCEL button). */
export function songRenderController(){
return{cancelled:false,onProgress:null,cancel(){this.cancelled=true}};
}

/* renderSong — offline render of the WHOLE arrangement through the live
 * machinery. Walks songSteps once: per step it triggers this step's events
 * (stepEvents — identical to schedTick) AND applies the per-step automation
 * player (applyLanes → syncMix(cp,stepTime) / resolveMacros), so state lanes
 * (mix AND synth-param sweeps) land on voices exactly as in live playback.
 * v0.8.0: at every SECTION START the launched scene's mix snapshot is
 * applied through the SAME applySceneMix primitive the live quantized
 * launch uses (scheduler.js), glided from the exact section-start time —
 * the offline render reflects snapshots with no parallel implementation.
 * opts.ctrl: songRenderController (progress + cancel). opts.t0 override.
 * Deep-clones p: the live project is never touched (loop-bounce guarantee).
 * Returns {buf, N, evs, sections, scheduleHash, musicSec, totalSec} or
 * {cancelled:true}. Cancel semantics: the offline render simply never
 * resumes — its promise stays pending and the OfflineAudioContext becomes
 * unreachable (GC); the live AudioContext is untouched, no dangling UI. */
export async function renderSong(p,opts){
opts=opts||{};
const ctrl=opts.ctrl||{};
const t0=opts.t0==null?SONG_LEAD:opts.t0,sr=44100;
const cp=JSON.parse(JSON.stringify(p));
const plan=songSchedule(cp,t0);
const sd=plan.stepDur;
if(!plan.totalSteps)return null;
const N=Math.ceil(plan.total*sr);
const oc=new OfflineAudioContext(2,N,sr);
const eng=new PooledEngine(oc);
eng.syncMix(cp);
/* progress: suspend at section boundaries (thinned to ≤64 marks so very
   long chains stay cheap). Chrome quantizes suspend times to the render
   quantum — progress is informational, never load-bearing. */
const thin=plan.sections.length>64?Math.ceil(plan.sections.length/64):1;
for(let i=0;i<plan.sections.length;i+=thin){
const sec=plan.sections[i],when=t0+sec.startStep*sd;
try{oc.suspend(when).then(()=>{
if(ctrl.cancelled){if(ctrl._onCancelled)try{ctrl._onCancelled()}catch(e){/* noop */}return}
if(ctrl.onProgress)try{ctrl.onProgress(i,plan.sections.length,sec.scene,cp)}catch(e){/* progress never breaks render */}
if(!ctrl.cancelled)oc.resume().catch(()=>{/* gone */});
}).catch(()=>{/* suspend refused (time passed / limit) — skip point */})}catch(e){/* skip point */}
}
/* the walk — events + automation in the SAME per-step order as schedTick */
const evs=[];
for(const y of songSteps(cp)){
if(ctrl.cancelled){if(ctrl._onCancelled)try{ctrl._onCancelled()}catch(e){/* noop */}return{cancelled:true}}
if(y.sectionStart){const scn0=cp.scenes[y.scene];/* v0.8.0: scene mix snapshot at the section launch — same primitive as the live quantized launch */if(scn0&&scn0.pattern!=null&&applySceneMix(cp,y.scene))eng.syncMix(cp,t0+y.abs*sd)}
if(y.fill&&y.sectionStart){const scn=cp.scenes[y.scene];
if(scn&&scn.pattern!=null)for(let k=0;k<8;k++)eng.trigger(cp.tracks[3],t0+y.abs*sd+k*sd/2,{track:3,off:0,vel:.5+.05*k,note:48,lock:{}},sd)}
const list=stepEvents(cp,y.phase);
for(const e of list){eng.trigger(cp.tracks[e.track],t0+y.abs*sd+e.off,{track:e.track,off:0,vel:e.vel,note:e.note,lock:e.lock||{}},sd);evs.push({s:y.abs,t:t0+y.abs*sd+e.off,track:e.track,vel:e.vel,note:e.note,lock:e.lock})}
const auto=applyLanes(cp,y.phase);
if(auto.mixed||auto.macroed){
if(auto.macroed)resolveMacros(cp);
eng.syncMix(cp,t0+y.abs*sd);
}
}
const buf=await oc.startRendering();
return{buf,N,evs,sections:plan.sections,scheduleHash:evHash(evs),musicSec:plan.totalSteps*sd,totalSec:(plan.totalSteps+SONG_TAIL_STEPS)*sd};
}
