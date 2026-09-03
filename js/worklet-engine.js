import { MAX_TRACKS } from './model.js';
import { delayFbClamp } from '../foundation/dsp/sends.mjs';

/* ============ WORKLET engine adapter (PSY6, experimental) ============
Maps the device model onto the AudioWorklet engine (worklets/psy-engine.js,
processor 'psy-engine'). The MAIN pooled engine remains the default and the
reference; WORKLET mode is opt-in from the power screen.

Mapping (model → worklet commands):
  track kind/type          → voice id (V_* table below)
  ev.note (MIDI)           → frequency in Hz (440·2^((n-69)/12))
  bpm / delay feedback     → 'bpm' / 'setFX' messages
  per-BUS delay/reverb sends → 'setFX' (bus send = MAX of its tracks' sends)
  kick events              → 'trigger' (the worklet applies its built-in
                             bass-bus sidechain duck internally)

Skipped (no clean mapping — documented, never faked):
  - per-track send values collapse to per-BUS sends (max)
  - delay division (1/8|3/16|1/4): the worklet delay length is fixed (0.5 s
    buffer) and exposes no time message
  - per-track sidechain (scAmount/attack/hold/release): the worklet has a
    single fixed-shape bass-bus duck (worldParams.duck)
  - synth engine params (wave/cutoff/res/envelopes): the worklet voices use
    world params + macros, not the per-track synth editor state
  - groove/swing/micro-timing: applied by the MAIN scheduler before 'trigger'
    (so the worklet receives final times; its own queue fires sample-exactly)

Transport channels:
  LIVE (realtime context) — node.port messages, buffered in an outbox until
  the first 'stats' proves the processor port is attached (Chrome builds the
  processor lazily; pre-attach posts are lost nondeterministically), with a
  200 ms timer flush as a backstop.
  OFFLINE (OfflineAudioContext) — messages REPLAYED at construction via
  processorOptions.initialMessages. The offline render thread never drains
  its input message queue (it finishes before the cross-thread hop), so the
  port is unusable there; construction-time replay is fully reliable. */

const V_KICK=0,V_BASS=1,V_LEAD=2,V_ACID=3,V_PAD=4,V_HAT=5,V_HAT_OPEN=6,V_CLAP=7,V_PERC=8,V_SHAKER=9,V_TEXTURE=10,V_RISER=11,V_IMPACT=12,V_ZAP=14,V_FM=17;

/* track → worklet voice id (null = skipped) */
function voiceOf(tr){
if(tr.kind==='drum'){const ty=(tr.sound&&tr.sound.type)||tr.type;
switch(ty){case 'kick':return V_KICK;case 'snare':return V_CLAP;case 'clap':return V_CLAP;
case 'hatC':return V_HAT;case 'hatO':return V_HAT_OPEN;case 'tom':return V_PERC;
case 'rim':return V_SHAKER;case 'shaker':return V_SHAKER;case 'glitch':return V_ZAP;
case 'riser':return V_RISER;case 'impact':return V_IMPACT;default:return V_PERC}}
const cat=(tr.sound&&tr.sound.cat)||(tr.type||'lead');
switch(cat){case 'bass':return V_BASS;case 'lead':return V_LEAD;case 'arp':return V_ACID;
case 'pluck':return V_FM;case 'pad':return V_PAD;case 'fx':return V_TEXTURE;default:return V_LEAD}}
function drumDur(type){switch(type){case 'kick':return .5;case 'snare':return .25;case 'clap':return .4;case 'hatO':return .6;case 'hatC':return .06;case 'tom':return .45;case 'rim':return .045;case 'glitch':return .2;case 'shaker':return .09;case 'riser':return 1.6;case 'impact':return 1.2;case 'darbuka':return .35;case 'tambourine':return .3;case 'triangle':return 2;case 'downlifter':return 1.8;case 'crash':return 2.2;case 'revcym':return 1.4;case 'agogo':return .3;case 'timbale':return .28;default:return .4}}
const midiToHz=n=>440*Math.pow(2,(n-69)/12);
/* BUSES: drum 0-3 · bass 4 · music 5,7 · atmos 6 · fx — matches the worklet's 5-bus mixer */
const BUS_OF=[0,0,0,0,1,2,3,2];

export const WORKLET_LIMITATIONS=[
'per-track delay/reverb sends collapse to per-BUS sends (max of member tracks)',
'delay division (1/8 | 3/16 | 1/4) not exposed by the worklet delay (fixed 0.5 s buffer)',
'per-track sidechain (scAmount/attack/hold/release) → single fixed bass-bus duck',
'synth editor params (wave/cutoff/res/ADSR) → worklet world params + macros only',
'master EQ3 + glue comp (v0.8.0) not mapped — the worklet master has its own saturation/limiter',
'reverb IR is the worklet’s internal noise IR (not the seeded 1.8 s exponential IR)',
'user SAMPLES unsupported (v0.10.0) — sample-voice tracks play the SYNTH voice in worklet mode',
'resample / freeze / sample editor / slices / key detection unsupported (v0.11.0) — MAIN engine only',
'step sequencer timing: MAIN thread schedules, worklet fires sample-accurately'];

/* msgForTrigger — pure model→worklet trigger mapping (shared by the live
 * adapter and the offline builder). Returns null for unmappable tracks. */
function msgForTrigger(tr,when,ev,stepDur){
const vid=voiceOf(tr);if(vid==null)return null;
const midi=ev.note!=null?ev.note:48;
const freq=midiToHz(midi);
const dur=tr.kind==='drum'?drumDur((tr.sound&&tr.sound.type)||tr.type):stepDur*2;
const param=vid===V_ACID?(ev.vel>=.5?1:0):0;
return {type:'trigger',time:when,voice:vid,note:freq,velocity:ev.vel,duration:dur,param};
}

/* msgsForMix — pure project→worklet mix messages (bpm + per-bus sends). */
function msgsForMix(p){
const dA=[0,0,0,0,0],rB=[0,0,0,0,0];
p.tracks.forEach((t,i)=>{const b=BUS_OF[i]||0;if(t.mix.sendA>dA[b])dA[b]=t.mix.sendA;if(t.mix.sendB>rB[b])rB[b]=t.mix.sendB});
return [{type:'bpm',bpm:p.bpm},{type:'setFX',delaySends:dA,reverbSends:rB,delayWet:.8,reverbWet:.8,delayFeedback:delayFbClamp(p.fx&&p.fx.delayFb)}];
}

class WorkletEngine{
constructor(ctx,node){
this.ctx=ctx;this.node=node;this.isWorklet=true;
this.analyser=ctx.createAnalyser();this.analyser.fftSize=256;
node.connect(this.analyser);this.analyser.connect(ctx.destination);
this.stats=null;this.statsLog=[];
/* ── port-attach handshake (LIVE path) ──
Chrome builds the processor lazily; messages posted before the audio
thread attaches the processor's port are lost nondeterministically.
Commands are buffered in an outbox, flushed when the FIRST 'stats'
message arrives (its arrival proves the processor is alive) or after a
200 ms timer backstop, whichever comes first. */
this.ready=false;this.outbox=[];
node.port.onmessage=e=>{if(e.data&&e.data.type==='stats'){this._markReady();this.stats=e.data;this.statsLog.push(e.data);if(this.statsLog.length>64)this.statsLog.shift()}};
this._p=null;
this._post({type:'play'});
setTimeout(()=>this._markReady(),200);
}
_markReady(){if(this.ready)return;this.ready=true;const ob=this.outbox.slice();this.outbox.length=0;for(const m of ob)this._rawPost(m)}
_post(msg){if(this.ready)this._rawPost(msg);else this.outbox.push(msg)}
_rawPost(msg){try{this.node.port.postMessage(msg)}catch(e){/* node disposed */}}
syncMix(p){this._p=p;for(const m of msgsForMix(p))this._post(m)}
trigger(tr,when,ev,stepDur){const m=msgForTrigger(tr,when,ev,stepDur);if(m)this._post(m)}
killAll(){this._post({type:'panic'})}
}

/* mkWorkletEngine — boot the psy-engine worklet on a LIVE context and return
 * the adapter (outbox handshake handles the attach race). */
export async function mkWorkletEngine(ctx,base){
const url=(base||'')+'worklets/psy-engine.js';
await ctx.audioWorklet.addModule(url);
const node=new AudioWorkletNode(ctx,'psy-engine',{outputChannelCount:[2],numberOfInputs:0,numberOfOutputs:1});
return new WorkletEngine(ctx,node);
}

/* renderWorkletOffline — OFFLINE worklet render. Messages are replayed at
 * processor construction (processorOptions.initialMessages) because the
 * offline render thread never drains its input message queue. Returns
 * {buf, we} — we.stats carries the final worklet stats (stealCount,
 * voiceTriggers, eventCount) for the reduced self-gate. */
export async function renderWorkletOffline(project,evSpecs,len,base){
const sr=44100;
const oc=new OfflineAudioContext(2,Math.round(sr*len),sr);
const url=(base||'')+'worklets/psy-engine.js';
await oc.audioWorklet.addModule(url);
const msgs=[{type:'play'},...msgsForMix(project)];
for(const s of evSpecs){const m=msgForTrigger(s.tr,s.when,s.ev,s.stepDur);if(m)msgs.push(m)}
const node=new AudioWorkletNode(oc,'psy-engine',{outputChannelCount:[2],numberOfInputs:0,numberOfOutputs:1,processorOptions:{initialMessages:msgs}});
const we=new WorkletEngine(oc,node);
const buf=await oc.startRendering();
return {buf,we};
}

export { WorkletEngine, voiceOf, BUS_OF, V_KICK, msgForTrigger, msgsForMix };
