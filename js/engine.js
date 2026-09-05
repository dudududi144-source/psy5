import { clamp, MAX_TRACKS, mulberry32 } from './model.js';
import { ensureVoice, samplePlayback } from './samplestore.js';
import { ensureIns } from './params.js';
import { driveCurve, crushCurve, driveTrim } from '../foundation/dsp/inserts.mjs';
import { planDuck, nextState, duckParams } from '../foundation/dsp/sidechain.mjs';
import { delaySecondsFor, delayFbClamp, delayDivClamp, irChannel, irChannelShaped, irVariantFor, IR_SEEDS, IR_LEN_S, IR_DECAY } from '../foundation/dsp/sends.mjs';
import { PSY4_KIT_TYPES, renderPsy4Pcm, DEFAULT_KIT, isPsy4KitId, kitRootHzOf } from './psy4kit.mjs';

/* ============ POOLED audio engine ============ */
/* Priority tiers for voice stealing (PSY6):
   0 = kick/bass (never stolen) · 1 = hats/snare/clap/perc
   2 = lead/arp/pluck           · 3 = pad/fx/texture (stolen first)
   Track index → tier for the 8 factory tracks; ad-hoc (audition) tracks are
   tiered by their preset category/type. */
const TRACK_TIERS=[0,1,1,1,0,2,3,2];
/* ROM_SHARED (v0.23.0): AudioBuffers are context-INDEPENDENT (plain PCM — the
   sample cache already relies on this: "the SAME buffers serve live + offline
   renders"). The render-once-per-session cache lives at MODULE level, so a
   second engine (every offline bounce/gate render builds a fresh
   PooledEngine) reuses the live context's buffers instead of re-rendering
   the crash bank per context. Keys type@sampleRate. */
const ROM_SHARED=new Map();
/* PSY4_SHARED (v0.30.0): the same context-independence law for the psy4 kit
   renders — keys 'P4:<type>:<kitId>:<variant>:<rootMul%>@<sampleRate>'.
   kit + root belong in the key because the SAME type renders differently
   per kit (that IS the cohesion). One shared cache, one render family. */
const PSY4_SHARED=new Map();
class PooledEngine{constructor(ctx,opts){opts=opts||{};this.poolSizes={synthVoices:opts.synthVoices!=null?opts.synthVoices:20,drumVoices:opts.drumVoices!=null?opts.drumVoices:24};this.ctx=ctx;this.master=ctx.createGain();this.master.gain.value=.85;const comp=this.comp=ctx.createDynamicsCompressor();comp.threshold.value=-8;comp.knee.value=12;comp.ratio.value=6;comp.attack.value=.003;comp.release.value=.2;const an=this.analyser=ctx.createAnalyser();an.fftSize=256;
/* ── MASTER SECTION (v0.8.0): EQ3 + glue compressor ──
   Inserted between the mix bus (this.master) and the EXISTING master
   compressor: master → EQ3 → [glueComp → makeup] → comp → analyser.
   NEUTRAL by default: EQ bands at 0 dB (unity biquads) and compOn 0 = the
   glue node is OUT of the chain (removed, not ducked under a threshold —
   guaranteed neutral). opts.masterFlat skips the section entirely (the
   exact pre-v0.8.0 topology — used by the G29 neutral-tolerance evidence
   and the offline A/B tests). */
this.masterFlat=!!opts.masterFlat;if(!this.masterFlat){const eqL=this.eqLow=ctx.createBiquadFilter();eqL.type='lowshelf';eqL.frequency.value=100;const eqM=this.eqMid=ctx.createBiquadFilter();eqM.type='peaking';eqM.frequency.value=1000;eqM.Q.value=.8;const eqH=this.eqHigh=ctx.createBiquadFilter();eqH.type='highshelf';eqH.frequency.value=8000;const gc=this.glue=ctx.createDynamicsCompressor();gc.threshold.value=-20;gc.knee.value=6;gc.ratio.value=2;gc.attack.value=.01;gc.release.value=.15;const gm=this.glueMake=ctx.createGain();gm.gain.value=1;this.glueOn=false;this.master.connect(eqL);eqL.connect(eqM);eqM.connect(eqH);eqH.connect(comp);/* compOn 0: glue OUT of the chain */gc.connect(gm);gm.connect(comp)}const dIn=this.dIn=ctx.createGain();const del=this.delay=ctx.createDelay(2);del.delayTime.value=.3;/* feedback loop with a lowpass inside — dark, analog-style repeats */const dLp=this.dLp=ctx.createBiquadFilter();dLp.type='lowpass';dLp.frequency.value=4500;const fb=this.fb=ctx.createGain();fb.gain.value=.35;const dOut=this.dOut=ctx.createGain();dOut.gain.value=.8;dIn.connect(del);del.connect(dLp);dLp.connect(fb);fb.connect(del);del.connect(dOut);dOut.connect(this.master);const rIn=this.rIn=ctx.createGain();const conv=this.conv=ctx.createConvolver();conv.buffer=this.mkIR();const rOut=this.rOut=ctx.createGain();rOut.gain.value=.8;rIn.connect(conv);conv.connect(rOut);rOut.connect(this.master);
/* ── v0.12.0 P3 master space: stereo width + ping-pong delay + IR variants ──
   WIDTH: mid/side network (lazy build) with a 300 Hz side highpass (bass
   mono protection, documented). widthMaster 1 = the network is OUT of the
   chain entirely (mode-switch rewiring like the glue comp) — the default
   topology is EXACTLY the pre-v0.12.0 graph, so legacy renders are
   unchanged (neutral contract, G41).
   PING-PONG: fx.pingPong 1 rewires the delay to two cross-fed taps with
   hard L/R outputs (lazy build, same feedback discipline: one lowpass per
   leg, feedback clamped by delayFbClamp). 0/undefined = the exact mono
   delay topology.
   IR VARIANTS: fx.irKind 'classic'|'short'|'long' swaps the convolver
   buffer (deterministic seeded IRs — sends.mjs IR_VARIANTS); classic is
   byte-identical to the v0.11.0 IR. Buffer swaps are mode changes
   (documented click risk, like crush curve swaps). */
this.widthNet=null;this.widthOn=false;this.pp=null;this.ppOn=false;this._irKind='classic';if(this.masterFlat){this.master.connect(comp)}comp.connect(an);an.connect(ctx.destination);this.noise=this.mkNoise();this.chains=[];this.scCache=[];this.duckState=[];this.duckEvents=0;this._plan={};for(let t=0;t<MAX_TRACKS;t++){const input=ctx.createGain();/* sidechain duck: ONE persistent GainNode per bus, created at init —
kick events automate it (no per-hit nodes). Idle gain = 1 → zero
effect until a track's scAmount > 0. */const duck=ctx.createGain();duck.gain.value=1;const pan=ctx.createStereoPanner?ctx.createStereoPanner():ctx.createGain();const sA=ctx.createGain(),sB=ctx.createGain();sA.gain.value=0;sB.gain.value=0;/* v0.10.0 INSERT chain: input → [drive: dTrim→dWS→dWet ‖ dDry] → cIn → cWS → [filt?] → duck → pan.
EXACT-BYPASS defaults: drive 0 = dry path only (dTrim 1, dWet 0, dDry 1 —
the wet branch contributes exact zeros), crush 16 = null-curve WaveShaper
passthrough, filter REMOVED from the chain. The drive transfer curve is
precomputed ONCE (foundation driveCurve, k=10); AMOUNT is an automatable
input-trim AudioParam — curve swaps are not time-anchorable, so offline
renders stay time-correct (foundation/dsp/inserts.mjs header). */const dTrim=ctx.createGain(),dWS=ctx.createWaveShaper(),dWet=ctx.createGain(),dDry=ctx.createGain(),cIn=ctx.createGain(),cWS=ctx.createWaveShaper();dWS.curve=this._driveC||(this._driveC=driveCurve());dWet.gain.value=0;dDry.gain.value=1;input.connect(dTrim);dTrim.connect(dWS);dWS.connect(dWet);dWet.connect(cIn);input.connect(dDry);dDry.connect(cIn);cIn.connect(cWS);cWS.connect(duck);duck.connect(pan);pan.connect(this.master);pan.connect(sA);sA.connect(dIn);pan.connect(sB);sB.connect(rIn);this.chains.push({input,pan,duck,sA,sB,dTrim,dWet,dDry,cWS,insFilt:null,insFSig:'off',cCurved:0});this.scCache.push(null);/* per-chain duck envelope state — preallocated, mutated in place */this.duckState.push({t0:-1,dip:1,attack:0,release:0,end:0})}this.synthPool=[];this.drumPool=[];for(let i=0;i<this.poolSizes.synthVoices;i++)this.synthPool.push(new SynthVoice(ctx,this));for(let i=0;i<this.poolSizes.drumVoices;i++)this.drumPool.push(new DrumVoice(ctx,this));this.spawnCount=0;this._voiceSeq=0;this.stealCount=new Uint32Array(4);this.tier0StealAttempts=0;this.moogSpawns=0;this.moogFallbacks=0;this.dedicated={};/* ── PSY4 KIT ROM (v0.30.0 FOUNDATION RESET) — foundation/psy4 psy4-voices rendered ONCE per (type, kit, variant, sampleRate) into AudioBuffers; every PSY4_KIT_TYPES hit plays through the RomVoice pool (per-hit BufferSource + pooled env gain + pooled tilt filter). opts.rom=false → the legacy DrumVoice synth path (tests/neutral A/B). Lazy first-hit render is the documented hot-path exception; the UI warms the kit at power-on via warmRom so the cost lands at boot, never mid-groove. */this.romOn=opts.rom!==false;this.romCache=new Map();this.romPool=[];for(let i=0;i<8;i++)this.romPool.push(new RomVoice(ctx,this));this.romSpawns=0;this.romRenders=0;this.romFallbacks=0;this.romSteals=0;this.trackCount=new Uint32Array(MAX_TRACKS);
/* ── PSY4 KIT GOVERNANCE (v0.30.0): every kit-coherent drum/FX hit renders
   through the psy4 kit (js/psy4kit.mjs — six kits over the foundation
   psy4-voices, level law, root law). kitId selects the kit; rootHz 0 = the
   kit's own key center (setRootHz overrides live, clamped to ±2 octaves in
   rootMul). Unknown kit ids are REFUSED (setKit returns false — never lie
   about what is playing). */
this.kitId=DEFAULT_KIT;this.rootHz=0;this._rrType=new Map();/* per-type 2-variant round-robin (anti-machine-gun) *//* ── SAMPLE VOICE state (v0.10.0 P2) ── pre-decoded AudioBuffer cache
(context-independent — the SAME buffers serve live + offline renders),
per-track active-voice registry (cap 8, oldest-stolen — pool discipline),
honest counters for gates/evidence. opts.samples seeds the cache (offline
renders get the live cache injected through bounce.js — zero render-fork). */this.sampleCache=new Map();this.sampleVoices=Array.from({length:MAX_TRACKS},()=>[]);this.sampleSteals=0;this.sampleFallbacks=0;this.sampleSpawns=0;this.SAMPLE_CAP_VOICES=8;if(opts.samples)for(const[id,v]of(opts.samples instanceof Map?opts.samples.entries():Object.entries(opts.samples)))this.sampleCache.set(id,v)}
mkIRv(v){/* deterministic variant IR (v0.12.0 P3) — seeds/decay/lp from sends.mjs IR_VARIANTS */const c=this.ctx,len=Math.round(c.sampleRate*v.len),b=c.createBuffer(2,len,c.sampleRate);b.getChannelData(0).set(irChannelShaped(len,v.seeds[0],v.decay,v.lp));b.getChannelData(1).set(irChannelShaped(len,v.seeds[1],v.decay,v.lp));return b}
buildWidthNet(){const c=this.ctx;const spl=c.createChannelSplitter(2),mer=c.createChannelMerger(2);const gL=c.createGain(),gR=c.createGain(),gLs=c.createGain(),gRi=c.createGain();gL.gain.value=.5;gR.gain.value=.5;gLs.gain.value=.5;gRi.gain.value=-.5;const mid=c.createGain();const sideHP=c.createBiquadFilter();sideHP.type='highpass';sideHP.frequency.value=300;const sideW=c.createGain();const sideL=c.createGain(),sideR=c.createGain();sideR.gain.value=-1;spl.connect(gL,0);spl.connect(gR,1);spl.connect(gLs,0);spl.connect(gRi,1);gL.connect(mid);gR.connect(mid);gLs.connect(sideHP);gRi.connect(sideHP);sideHP.connect(sideW);sideW.connect(sideL);sideW.connect(sideR);sideL.connect(mer,0,0);sideR.connect(mer,0,1);mid.connect(mer,0,0);mid.connect(mer,0,1);this.widthNet={spl,mer,sideW,sideHP}}
buildPingPong(){const c=this.ctx;const delB=c.createDelay(2);const dLpB=c.createBiquadFilter();dLpB.type='lowpass';dLpB.frequency.value=4500;const fbB=c.createGain();const dOutB=c.createGain();dOutB.gain.value=.8;const mer=c.createChannelMerger(2);this.pp={delB,dLpB,fbB,dOutB,mer}}
mkNoise(){const c=this.ctx,len=c.sampleRate,b=c.createBuffer(1,len,c.sampleRate),d=b.getChannelData(0),r=mulberry32(7);for(let i=0;i<len;i++)d[i]=r()*2-1;return b}
mkIR(){/* deterministic synthetic stereo IR (PSY6): seeded decorrelated noise
(canonical mulberry32, one seed per channel), exponential decay over ~1.8s.
Generated at init — no external files, no Math.random. Same seeds →
byte-identical IR on every machine. */const c=this.ctx,len=Math.round(c.sampleRate*IR_LEN_S),b=c.createBuffer(2,len,c.sampleRate);b.getChannelData(0).set(irChannel(len,IR_SEEDS[0],IR_DECAY));b.getChannelData(1).set(irChannel(len,IR_SEEDS[1],IR_DECAY));return b}
syncMix(p,when,tc){const at=(when==null)?this.ctx.currentTime:when;/* v0.16.0 TRANSITIONS: optional glide time-constant (xfade) — setTargetAtTime reaches ~95% at 3τ, so an N-beat xfade passes τ=N·sd/3. null/absent = the EXACT legacy 0.02 s (neutral contract; every pre-v0.16.0 caller is untouched). Master/insert/delay internals keep their own constants — xfade glides level/pan/sends, the audible majority. */const TC=(tc==null)?.02:Math.max(.005,Math.min(4,tc));this.applyMaster(p,at);const anySolo=p.tracks.some(t=>t.mix.solo);p.tracks.forEach((t,i)=>{const ch=this.chains[i];if(!ch)return;const m=t.mix,aud=!m.mute&&(!anySolo||m.solo);const g=aud?m.vol*m.vol:0;ch.input.gain.setTargetAtTime(g,at,TC);if(ch.pan.pan)ch.pan.pan.setTargetAtTime(clamp(m.pan,-1,1),at,TC);/* sendA/sendB are POST-FADER taps (taken after the strip fader+pan) —
the two shared send buses feed the master chain input */ch.sA.gain.setTargetAtTime(m.sendA,at,TC);ch.sB.gain.setTargetAtTime(m.sendB,at,TC);this.scCache[i]=duckParams(t);this.applyIns(i,t,at)});/* BPM-synced delay: division 1/8|3/16|1/4 (default 3/16) + feedback 0..80% */
const fx=p.fx||{};this.delay.delayTime.setTargetAtTime(delaySecondsFor(delayDivClamp(fx.delayDiv),p.bpm),at,.08);this.fb.gain.setTargetAtTime(delayFbClamp(fx.delayFb),at,.08);
/* ── v0.12.0 P3: ping-pong delay (fx.pingPong 1) + reverb IR variants
   (fx.irKind) — mode changes rewire/swap immediately (documented click
   risk); defaults leave the exact pre-v0.12.0 topology. ── */
const ppOn=fx&&fx.pingPong===1;
if(ppOn!==this.ppOn){this.ppOn=ppOn;
if(ppOn){if(!this.pp)this.buildPingPong();const P=this.pp;
try{this.dIn.disconnect()}catch(e){}try{this.delay.disconnect()}catch(e){}try{this.dLp.disconnect()}catch(e){}try{this.fb.disconnect()}catch(e){}try{this.dOut.disconnect()}catch(e){}
this.dIn.connect(this.delay);this.delay.connect(this.dLp);this.dLp.connect(this.fb);this.fb.connect(P.delB);P.delB.connect(P.dLpB);P.dLpB.connect(P.fbB);P.fbB.connect(this.delay);
this.delay.connect(this.dOut);this.dOut.connect(P.mer,0,0);P.delB.connect(P.dOutB);P.dOutB.connect(P.mer,0,1);P.mer.connect(this.master);
P.delB.delayTime.value=this.delay.delayTime.value;P.fbB.gain.value=this.fb.gain.value;P.dLpB.frequency.value=4500}
else{try{this.dIn.disconnect()}catch(e){}try{this.delay.disconnect()}catch(e){}try{this.dLp.disconnect()}catch(e){}try{this.fb.disconnect()}catch(e){}try{this.dOut.disconnect()}catch(e){}if(this.pp){try{this.pp.mer.disconnect()}catch(e){}try{this.pp.dOutB.disconnect()}catch(e){}}
this.dIn.connect(this.delay);this.delay.connect(this.dLp);this.dLp.connect(this.fb);this.fb.connect(this.delay);this.delay.connect(this.dOut);this.dOut.connect(this.master)}}
if(this.ppOn&&this.pp){this.pp.delB.delayTime.setTargetAtTime(delaySecondsFor(delayDivClamp(fx.delayDiv),p.bpm),at,.08);this.pp.fbB.gain.setTargetAtTime(delayFbClamp(fx.delayFb),at,.08)}
const iv=irVariantFor(fx&&fx.irKind);
if(iv.key!==this._irKind){this._irKind=iv.key;this.conv.buffer=this.mkIRv(iv)}}
/* ── per-track INSERT FX apply (v0.10.0 P3) ──
Called from syncMix with the SAME time anchor as the mix glides (live:
currentTime/launch anchor; offline render: the step's exact time — filter
freq/Q and drive trim/wet/dry are AudioParam automations, time-correct in
offline bounces). MODE changes (drive 0↔nonzero wet/dry swap, crush curve
null↔staircase, filter insert/remove + type) rebuild immediately —
documented click risk on mode changes only; the composer never lanes
crush/filtOn, so composed renders are mode-static per track. */
applyIns(i,t,at){const ch=this.chains[i];if(!ch)return;const ins=ensureIns(t).ins;const d=ins.drive>0,cOn=ins.crush<16,fOn=ins.filtOn>0;
/* drive: trim glides (setTargetAtTime); the wet/dry BYPASS gate uses
setValueAtTime — an exponential approach never exactly reaches its target,
and the neutral contract needs the dry path EXACTLY 1 / wet EXACTLY 0 after
a restore. The 0↔1 swap is a mode change (documented click risk). */
ch.dTrim.gain.setTargetAtTime(driveTrim(ins.drive),at,.03);ch.dWet.gain.setValueAtTime(d?1:0,at);ch.dDry.gain.setValueAtTime(d?0:1,at);
/* crush: null-curve passthrough ↔ staircase curve (immediate swap) */
if(!this._crushC)this._crushC={};
if(!cOn){if(ch.cWS.curve!==null)ch.cWS.curve=null}else if(ch.cCurved!==ins.crush){if(!this._crushC[ins.crush])this._crushC[ins.crush]=crushCurve(ins.crush);ch.cWS.curve=this._crushC[ins.crush];ch.cCurved=ins.crush}
/* filter: presence rebuild + anchored freq/Q */
const fSig=fOn?(ins.filtOn===1?'lp':ins.filtOn===2?'hp':ins.filtOn===4?'moog':'bp'):'off';/* v0.13.0: filtOn 4 = MOOG — the psy-dsp.js Moog ladder (4-stage tanh feedback) as a per-track AudioWorkletNode insert. BEST-EFFORT: the node only builds when the module is loaded into THIS context (prepInsertDSP — powerOn preloads it live; bounce/freeze/gates prep their offline ctx when the project uses MOOG). Unloadable → HONEST biquad lowpass fallback, counted in moogFallbacks. */
if(fSig!==ch.insFSig){ch.insFSig=fSig;if(ch.insFilt){try{ch.insFilt.disconnect()}catch(e){}ch.insFilt=null}if(fOn&&fSig==='moog'){let n=null;try{n=ch.insFilt=new AudioWorkletNode(this.ctx,'moog-filter',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});this.moogSpawns++}catch(e){n=null;this.moogFallbacks++}
if(n){n.parameters.get('cutoff').value=clamp(ins.filtFreq,20,18000);n.parameters.get('resonance').value=clamp(ins.filtQ/6,0,1);n.parameters.get('drive').value=1.2;ch.cWS.disconnect();ch.cWS.connect(n);n.connect(ch.duck)}else{/* fallback: biquad lowpass at the same cutoff — counted, signature flipped to 'lp' so retunes keep working */const f=this.ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=ins.filtFreq;f.Q.value=ins.filtQ;ch.insFilt=f;ch.insFSig='lp';ch.cWS.disconnect();ch.cWS.connect(f);f.connect(ch.duck)}}
else if(fOn){const f=ch.insFilt=this.ctx.createBiquadFilter();f.type=fSig==='lp'?'lowpass':fSig==='hp'?'highpass':'bandpass';f.frequency.value=ins.filtFreq;f.Q.value=ins.filtQ;ch.cWS.disconnect();ch.cWS.connect(f);f.connect(ch.duck)}else{ch.cWS.disconnect();ch.cWS.connect(ch.duck)}}
else if(fOn&&fSig==='moog'&&ch.insFilt&&ch.insFilt.parameters){ch.insFilt.parameters.get('cutoff').setTargetAtTime(clamp(ins.filtFreq,20,18000),at,.03);ch.insFilt.parameters.get('resonance').setTargetAtTime(clamp(ins.filtQ/6,0,1),at,.03)}
else if(fOn){ch.insFilt.frequency.setTargetAtTime(ins.filtFreq,at,.03);ch.insFilt.Q.setTargetAtTime(ins.filtQ,at,.03)}}
/* ── master section apply (v0.8.0) ──
applyMaster(p, when) — the ONE master-apply path (syncMix calls it with the
same time anchor as the mix glides; the offline render anchors it at step
times exactly like the live scheduler). compOn toggling REWIRES the chain
(bypass = node removed). masterFlat engines are permanently neutral. */
applyMaster(p,when){if(this.masterFlat)return;const m=(p&&p.master)||null;const at=(when==null)?this.ctx.currentTime:when;const on=!!(m&&(m.compOn===1||m.compOn===true));if(on!==this.glueOn){this.glueOn=on;try{this.eqHigh.disconnect()}catch(e){}if(on)this.eqHigh.connect(this.glue);else this.eqHigh.connect(this.comp)}
/* ── width network (v0.12.0 P3): widthMaster 1 = OUT (exact neutral);
   any other value = mid/side in-chain with the 300 Hz side highpass.
   Mode-switch rewiring mirrors the glue-comp toggle. ── */
const cl2w=(v,a,b)=>v<a?a:(v>b?b:v);
const wv=(m&&m.widthMaster!=null&&isFinite(+m.widthMaster))?cl2w(+m.widthMaster,0,2):1;const wantNet=Math.abs(wv-1)>1e-9;
if(wantNet!==this.widthOn){this.widthOn=wantNet;if(wantNet){if(!this.widthNet)this.buildWidthNet();try{this.master.disconnect()}catch(e){}this.master.connect(this.widthNet.spl);this.widthNet.mer.connect(this.eqLow)}else{try{this.master.disconnect()}catch(e){}if(this.widthNet){try{this.widthNet.mer.disconnect()}catch(e){}try{this.widthNet.spl.disconnect()}catch(e){}}this.master.connect(this.eqLow)}}
if(this.widthNet&&this.widthOn)this.widthNet.sideW.gain.setTargetAtTime(wv,at,.03);
if(!m)return;const cl2=(v,a,b)=>v<a?a:(v>b?b:v);const g=(x,d)=>(x==null||!isFinite(x))?d:x;
this.eqLow.gain.setTargetAtTime(cl2(g(m.eqLow,0),-12,12),at,.03);this.eqMid.gain.setTargetAtTime(cl2(g(m.eqMid,0),-12,12),at,.03);this.eqHigh.gain.setTargetAtTime(cl2(g(m.eqHigh,0),-12,12),at,.03);
if(on){this.glue.threshold.setTargetAtTime(cl2(g(m.compThresh,-20),-40,0),at,.03);this.glue.ratio.setTargetAtTime(cl2(g(m.compRatio,2),1,20),at,.03);this.glue.attack.setTargetAtTime(cl2(g(m.compAttack,10),1,100)/1000,at,.03);this.glue.release.setTargetAtTime(cl2(g(m.compRelease,150),20,1000)/1000,at,.03);this.glueMake.gain.setTargetAtTime(Math.pow(10,cl2(g(m.compMakeup,0),0,24)/20),at,.03)}}
/* ── kick-triggered sidechain (PSY6) ──
Every chain owns ONE duck GainNode (input→duck→pan). When a kick fires,
every bus whose track has scAmount>0 gets a piecewise-linear dip:
  v0 → linearRamp(dip) over attack → [hold] → linearRamp(1) over release.
Only setValueAtTime + linearRampToValueAtTime are used. Overlapping kicks
(fast 16th rolls @145 BPM) start from the exact value of the previous
envelope → value-continuous, click-free, always recovers to 1.0. */
sidechain(when,srcIdx){for(let i=0;i<MAX_TRACKS;i++){if(i===srcIdx)continue;const sc=this.scCache[i];if(!sc)continue;const st=this.duckState[i],g=this.chains[i].duck.gain;const plan=planDuck(st,when,1-sc.amount/100,sc.attack,sc.hold,sc.release,this._plan);g.setValueAtTime(plan.v0,when);g.linearRampToValueAtTime(plan.dip,plan.t1);if(plan.holdT>=0)g.setValueAtTime(plan.dip,plan.holdT);g.linearRampToValueAtTime(1,plan.end);nextState(plan,when,sc.attack,st);this.duckEvents++}}
tierOfTrack(tr){if(tr.idx!=null&&tr.idx>=0&&tr.idx<8&&(tr.kind==='drum'?tr.idx<4:tr.idx>=4)&&tr.sound&&tr.presetId!==undefined){if(tr.kind==='drum'&&tr.sound.type==='kick')return 0;return TRACK_TIERS[tr.idx]}const pr=tr.sound||{};if(tr.kind==='drum')return (pr.type||tr.type)==='kick'?0:1;if(pr.cat==='bass')return 0;if(pr.cat==='pad'||pr.cat==='fx')return 3;return 2}
drumDurEst(type,decay){const d=decay||1;switch(type){case 'kick':return .12+.5*d;case 'snare':return .1+.16*d;case 'clap':return .25+.15*d;case 'hatO':return .26+.5*d;case 'hatC':return .03+.05*d;case 'shaker':return .04+.07*d;case 'riser':return 1.65;case 'impact':return 1.1*d+.3;case 'texture':return 1.5;case 'downlifter':return .9+1.1*d;default:return .5}}
synthDurEst(p,stepDur){const gate=p.gate||.6;const rel=Math.max(p.rel||.15,.02);return stepDur*gate*2+rel}
nextVoice(tr,tier,when){const pool=tr.kind==='drum'?this.drumPool:this.synthPool;let i,v;for(i=0;i<pool.length;i++){v=pool[i];if(!v.tier0&&(!v.busyUntil||v.busyUntil<=when)){v.lastTrigger=++this._voiceSeq;return v}}if(tier===0){const key=tr.idx+'|'+tr.kind;v=this.dedicated[key];if(!v){for(i=0;i<pool.length;i++)if(!pool[i].tier0){v=pool[i];break}if(!v){v=this.stealOldest(pool,3,when)||this.stealOldest(pool,2,when)||this.stealOldest(pool,1,when)}if(!v)v=pool[0];v.tier0=true;this.dedicated[key]=v}v.lastTrigger=++this._voiceSeq;return v}v=this.stealOldest(pool,3,when)||this.stealOldest(pool,2,when)||this.stealOldest(pool,1,when);if(!v){v=pool[0];if(v.tier0&&tier!==0)this.tier0StealAttempts++}v.lastTrigger=++this._voiceSeq;return v}
stealOldest(pool,victimTier,when){let victim=null;for(let i=0;i<pool.length;i++){const v=pool[i];if(v.tier0||!v.busyUntil||v.busyUntil<=when||v.tier!==victimTier)continue;if(victim===null||v.lastTrigger<victim.lastTrigger)victim=v}if(victim)this.stealCount[victimTier]++;return victim}
trigger(tr,when,ev,stepDur){this.spawnCount++;if(tr.idx!=null&&tr.idx<MAX_TRACKS)this.trackCount[tr.idx]++;/* v0.10.0: voiceMode 'sample' + cached buffer → per-hit sample voice; missing buffer → HONEST synth fallback (counted, one-shot toast in the UI) */if(tr.voiceMode==='sample'&&tr.sampleId){const cached=this.sampleCache.get(tr.sampleId);if(cached){this.triggerSample(tr,when,ev,cached);if(tr.kind==='drum'&&((tr.sound&&tr.sound.type)||tr.type)==='kick')this.sidechain(when,tr.idx);return}this.sampleFallbacks++}/* v0.30.0 PSY4 KIT ROM — routed BEFORE any pooled voice is selected: a kit hit must neither consume nor steal a DrumVoice (kit types play through their own 8-voice pool). romOn=false → the legacy synth path. Render failure → counted legacy-synth fallback. */if(this.romOn&&tr.kind==='drum'){const sd0=tr.sound||{};const ty0=sd0.type||tr.type;if(PSY4_KIT_TYPES.has(ty0)&&this.triggerRom(tr,when,ev.vel,ev.lock||{},ty0,sd0)){if(ty0==='kick')this.sidechain(when,tr.idx);/* BUG GUARD (v0.24.0, kept): kick routes through the kit ROM path — the early-return must not skip the sidechain duck the DrumVoice path fires. */return}}const tier=this.tierOfTrack(tr);const v=this.nextVoice(tr,tier,when);v.tier=tier;v.track=tr.idx;/* v.track: ownership for MIDI note-off release (killTrack) — set on every spawn, never read elsewhere */if(tr.kind==='drum'){v.hit(tr,when,ev.vel,ev.lock);const sd=tr.sound||{};if((sd.type||tr.type)==='kick')this.sidechain(when,tr.idx);v.busyUntil=when+this.drumDurEst(sd.type||tr.type,sd.decay)*1.15+.02}else{const p=v.noteOn(tr,when,ev,stepDur);v.busyUntil=when+this.synthDurEst(p,stepDur)}}
/* v0.13.0 P3 — engine LOAD telemetry (pure reads, no allocation beyond the snapshot):
   the header LOAD chip + gate G44 read this; latencyMs = base+output (the
   owner's latency concern, displayed honestly). */
loadSnapshot(){const now=this.ctx.currentTime;let a=0,d=0;for(const v of this.synthPool)if(v.busyUntil>now)a++;for(const v of this.drumPool)if(v.busyUntil>now)d++;let rv=0;for(const v of this.romPool)if(v.busyUntil>now)rv++;let sv=0;for(const l of this.sampleVoices)for(const v of l)if(v.end>now)sv++;const steals=this.stealCount[1]+this.stealCount[2]+this.stealCount[3];return{active:a+d+rv+sv,synth:a,drum:d,rom:rv,samples:sv,steals,tier0StealAttempts:this.tier0StealAttempts,spawnCount:this.spawnCount,sampleFallbacks:this.sampleFallbacks,moogFallbacks:this.moogFallbacks,romSpawns:this.romSpawns,romRenders:this.romRenders,romFallbacks:this.romFallbacks,romSteals:this.romSteals,romOn:this.romOn,kitId:this.kitId,latencyMs:Math.round(((this.ctx.baseLatency||0)+(this.ctx.outputLatency||0))*1000),pools:{synth:this.poolSizes.synthVoices,drum:this.poolSizes.drumVoices,rom:this.romPool.length}}}
killAll(){for(const v of this.synthPool){v.panic();v.busyUntil=0}for(const v of this.drumPool){v.panic();v.busyUntil=0}for(const v of this.romPool){const t=this.ctx.currentTime;try{v.g.gain.cancelScheduledValues(t);v.g.gain.setValueAtTime(0,t)}catch(e){}v.busyUntil=0;v.lastType='';v.lastTrack=-1}this.panicSamples()}
killTrack(idx){/* MIDI note-off: hard-gate the synth voices spawned by track idx (drum one-shots are never released mid-hit) */for(const v of this.synthPool)if(v.track===idx){v.panic();v.busyUntil=0}this.panicSamples(idx)}
/* ── sample voice (v0.10.0 P2) ──
loadSampleBuffer — build AudioBuffers (normal + pre-reversed) from a store
record once; cached by id, re-load replaces (idempotent). AudioBuffers are
context-independent: the same cache serves the live ctx AND OfflineAudio
renders (bounce.js injects it — the ONE renderer picks samples up with no
render-path changes). */
loadSampleBuffer(rec){if(!rec||!rec.id||!Array.isArray(rec.pcm)||!rec.pcm.length)return false;const c=this.ctx;const mk=ch=>{const b=c.createBuffer(ch.length,ch[0].length,rec.sampleRate);for(let i=0;i<ch.length;i++)b.getChannelData(i).set(ch[i]);return b};/* v0.11.0: sliced records carry their boundary pcts into the cache — the trigger path resolves sliceIdx against them */const pcts=(rec.derivedOp==='slice'&&rec.derivedParams&&Array.isArray(rec.derivedParams.pcts))?rec.derivedParams.pcts:null;this.sampleCache.set(rec.id,{buf:mk(rec.pcm),revBuf:mk(rec.pcmReversed&&rec.pcmReversed.length?rec.pcmReversed:rec.pcm),dur:rec.durationSec,pcts});return true}
hasSampleBuffer(id){return this.sampleCache.has(id)}
/* triggerSample — per-hit AudioBufferSourceNode + per-hit env GainNode into
the track chain (insert FX/duck/pan apply as for any voice). playbackRate =
2^(tune/12); slice = [startPct,endPct)% of the buffer (pre-reversed PCM for
reverse — no per-hit reversal allocations); release extends past the slice
end (documented: a slice ending at the buffer end truncates its tail). */
triggerSample(tr,when,ev,cached){const ctx=this.ctx;/* v0.11.0: per-step slice locks — ev.lock.smpSlice (the registry param id) overrides sampleParams.sliceIdx for THIS hit; the slice window resolves against the record's detected boundaries (pcts) */const lk=ev.lock||{};const sp0=ensureVoice(tr).sampleParams;const sp=(lk.smpSlice!=null)?Object.assign({},sp0,{sliceIdx:lk.smpSlice}):sp0;const pb=samplePlayback(sp,cached.dur,cached.pcts);const useRev=sp.reverse>=0.5;const bd=cached.buf.duration;const s0=Math.min(pb.offsetSec,bd),s1=Math.min(pb.offsetSec+pb.durSec*pb.rate,bd);const off=useRev?Math.max(0,bd-s1):s0;const src=ctx.createBufferSource();src.buffer=useRev?cached.revBuf:cached.buf;src.playbackRate.value=pb.rate;const env=ctx.createGain();const amp=clamp(ev.vel,0,1)*clamp(sp.gain,0,2);const atk=Math.max(sp.attackMs/1000,0),rel=Math.max(sp.releaseMs/1000,.005);const g=env.gain;g.cancelScheduledValues(when);g.setValueAtTime(0,when);if(atk>0)g.linearRampToValueAtTime(amp,when+atk);else g.setValueAtTime(amp,when);const wallSec=Math.max((s1-s0)/pb.rate,0);const relAnchor=when+Math.max(wallSec,atk);g.setValueAtTime(amp,relAnchor);g.exponentialRampToValueAtTime(.0001,relAnchor+rel);src.connect(env);env.connect(this.chains[tr.idx]?this.chains[tr.idx].input:this.master);
/* per-track active-voice cap 8 — OLDEST stolen with a TIME-ANCHORED stop()
   (v0.11.0 — see the steal block below). Per-hit node creation is the
   WebAudio API reality — documented, not hidden behind a fake pool.
   TIME-AWARE: only voices ALREADY COMPETING at `when` count (started ≤ when,
   not yet ended); future-scheduled voices neither steal nor get counted;
   finished voices are reaped. */
const list=this.sampleVoices[tr.idx]||(this.sampleVoices[tr.idx]=[]);for(let i=list.length-1;i>=0;i--)if(list[i].end<=when)list.splice(i,1);let active=0;for(let i=0;i<list.length;i++)if(list[i].start<=when)active++;while(active>=this.SAMPLE_CAP_VOICES){let vi=-1;for(let i=0;i<list.length;i++){if(list[i].start>when)continue;if(vi<0||list[i].seq<list[vi].seq)vi=i}if(vi<0)break;const old=list.splice(vi,1)[0];/* v0.11.0: the stop is TIME-ANCHORED to the steal moment `when` — a no-arg stop() executed during the offline schedule walk runs at WALL-CLOCK (before the render) and ERASES the stolen future-scheduled hit entirely (frozen-loop replay exposed it: 16 kicks × 13 s sample → the whole first cap-window went silent). stop(when) keeps the live oldest-stolen semantics (plays [start→when], cut at the steal) and is time-correct offline. The env is NOT disconnected here — that is also instantaneous wall-clock — the onended handler reaps it. */const stopAt=when;try{old.src.stop(stopAt)}catch(e){}this.sampleSteals++;active--}const voice={src,env,seq:++this._voiceSeq,start:when,end:relAnchor+rel};list.push(voice);src.onended=()=>{const i=list.indexOf(voice);if(i>=0)list.splice(i,1);try{env.disconnect()}catch(e){}};this.sampleSpawns++;src.start(when,off,(s1-s0)+rel*pb.rate)}
panicSamples(idx){const stop=v=>{try{v.src.stop()}catch(e){}try{v.env.disconnect()}catch(e){}};if(idx==null){for(const l of this.sampleVoices){l.forEach(stop);l.length=0}}else{const l=this.sampleVoices[idx];if(l){l.forEach(stop);l.length=0}}}
/* ── PERCUSSION ROM v3 (v0.23.0) — the synth-quality ceiling breaker ──
The pooled DrumVoice renders percussion with ≤2 osc + noise; for the
membrane family that is a sine beep, for the metal family a hollow 6-square
ring (the owner's 4× "sounds below criticism"). These 13 types render ONCE
(foundation modal/noise DSP the per-hit path can't afford) and play through
the sampler path. EVERY legacy behavior is preserved for the non-ROM types;
ROM types keep their drumDurEst windows EXACTLY (pool discipline moved
zero — tests pin it) and their per-hit tune/tone/punch/decay semantics:
  tune → playbackRate (classic sampler pitch, clamped .25..4)
  tone → pooled highshelf tilt ±9 dB at 3.2 kHz
  punch → 30 ms attack overdrive on the env (1+.3·punch)
  decay<0.95 → env fade exactly at the drumDurEst window (formula unchanged)
A 15 ms safety fade is ALWAYS scheduled at the reuse boundary
min(bufferDur/rate, durEst·1.15+.02) → click-free pooling for any tune/
decay/rate combination, including pitch-down rings that outlive the window. */
nextRomVoice(when){let v=null;for(let i=0;i<this.romPool.length;i++){const c=this.romPool[i];if(!c.busyUntil||c.busyUntil<=when)return c}/* all busy → steal the SOONEST-to-finish (the drum pool steals by tier; ROM voices are one tier — oldest-lastTrigger loses, honest counter) */for(let i=0;i<this.romPool.length;i++){const c=this.romPool[i];if(v===null||c.busyUntil<v.busyUntil)v=c}if(v)this.romSteals++;return v}
/* ── v0.24.0 kit accessors — the live kit/root controls (Sound-tab KIT select,
   composer style hook, root transposes). setKit refuses unknown ids (the
   kit must exist — a silent default would LIE about what is playing). */
setKit(kitId){if(!isPsy4KitId(kitId))return false;this.kitId=kitId;return true}
setRootHz(hz){this.rootHz=hz>20&&hz<500?hz:0}
rootMul(){return this.rootHz>0?Math.min(2,Math.max(.5,this.rootHz/kitRootHzOf(this.kitId))):1}
/* v0.30.0 — the psy4 kit render. One render per (type, kit, variant, root,
   sampleRate); presets shape the PLAYBACK (tune/tone/punch/decay — the
   RomVoice path), not the PCM. Root law: the pitched layers follow the
   project root via rootMul (clamped ±2 oct); unpitched layers don't move. */
romBuffer(type){const sr=this.ctx.sampleRate,variant=this._rrType.get(type)||0;if(!PSY4_KIT_TYPES.has(type))return null;const rm=this.rootMul();const key='P4:'+type+':'+this.kitId+':'+variant+':'+Math.round(rm*100)+'@'+sr;let ab=this.romCache.get(key);if(ab)return ab;ab=PSY4_SHARED.get(key);if(ab){this.romCache.set(key,ab);return ab}let pcm=null;try{pcm=renderPsy4Pcm(type,sr,{kitId:this.kitId,variant,rootMul:rm})}catch(e){this.romFallbacks++;return null}if(!pcm){this.romFallbacks++;return null}try{ab=this.ctx.createBuffer(1,pcm.length,sr);ab.copyToChannel(pcm,0)}catch(e){this.romFallbacks++;return null}this.romCache.set(key,ab);PSY4_SHARED.set(key,ab);this.romRenders++;return ab}
triggerRom(tr,when,vel,lock,type,p){const ab=this.romBuffer(type);if(!ab)return false;const v=this.nextRomVoice(when);if(!v)return false;const cl=(x,a,b)=>x<a?a:(x>b?b:x);const tune=cl(p.tune||1,.25,4),tone=p.tone==null?1:p.tone,punch=cl(p.punch!=null?p.punch:.5,0,1),decay=p.decay==null?1:p.decay;v.connect(this.chains[tr.idx]||this.master);
/* per-hit BufferSource — the ONE unavoidable allocation (same law as the
   sample path); gain+filter are pooled and never allocated per hit */
const src=this.ctx.createBufferSource();src.buffer=ab;src.playbackRate.value=tune;src.connect(v.f);
/* tilt (tone) — pooled highshelf, zero-anchor first (pool reuse hygiene) */
v.f.gain.cancelScheduledValues(when);v.f.gain.setValueAtTime(cl((tone-1)*9,-9,9),when);
const g=v.g.gain;g.cancelScheduledValues(when);const amp=cl(vel,0,1);
g.setValueAtTime(0,when);g.setValueAtTime(amp*(1+.3*punch),when);g.exponentialRampToValueAtTime(Math.max(amp,.001),when+.03);
/* reuse-boundary safety fade: the voice is free again at durEst·1.15+.02
   (the EXACT DrumVoice law); fade the LAST 15 ms of whatever plays before
   that — click-free for slow-tuned long rings AND short decays alike */
const natSec=ab.duration/tune,winSec=this.drumDurEst(type,decay)*1.15+.02,endSec=Math.min(natSec,winSec);
const fadeAt=when+Math.max(.031,endSec-.015);g.setValueAtTime(Math.max(amp,.001),fadeAt);g.exponentialRampToValueAtTime(.0001,fadeAt+.015);
src.start(when);src.stop(when+endSec+.016);v.busyUntil=when+winSec;v.lastTrigger=++this._voiceSeq;
/* v0.24.0 KIT GOVERNANCE — voice registry for choke + honest counters.
   lastType/lastTrack mark what the voice carries; amp anchors the choke
   ramp (an offline schedule can never be read back at a future time). */
v.lastType=type;v.lastTrack=tr.idx;v.amp=Math.max(amp,.001);this._rrType.set(type,((this._rrType.get(type)||0)+1)%2);/* per-type 2-variant round-robin, SUCCESS only */
/* v0.24.0 KIT CHOKE — the kit's own rules, time-anchored like every
   envelope here (cancel ≥ `when`, re-anchor from the hit's stored sustain
   level, exponential ramp — value-continuous, click-free, offline-correct). */
/* v0.30.0 KIT CHOKE — the fixed psy4 kit law: hatC chokes hatO (the classic
   closed-hat chokes the ringing open one, 25 ms exponential). The crash/ride
   poly choke died with the cymbal types (vocabulary discipline). */
if(type==='hatC'){for(let i=0;i<this.romPool.length;i++){const o=this.romPool[i];if(o===v||o.lastType!=='hatO'||!(o.busyUntil>when))continue;const og=o.g.gain;og.cancelScheduledValues(when);og.setValueAtTime(o.amp,when);og.exponentialRampToValueAtTime(.0001,when+.025)}}
this.romSpawns++;return true}
warmRom(types){let n=0;for(let i=0;i<types.length;i++){const t=types[i];if(!PSY4_KIT_TYPES.has(t))continue;if(this.romBuffer(t))n++}return n}
}
class SynthVoice{constructor(ctx,eng){this.ctx=ctx;this.eng=eng;this.bus=null;this.osc1=ctx.createOscillator();this.osc2=ctx.createOscillator();this.g1=ctx.createGain();this.g2=ctx.createGain();this.filter=ctx.createBiquadFilter();this.filter.type='lowpass';this.vca=ctx.createGain();this.vca.gain.value=0;this.lfo=ctx.createOscillator();this.lfoGain=ctx.createGain();this.lfoGain.gain.value=0;this.osc1.connect(this.g1);this.osc2.connect(this.g2);this.g1.connect(this.filter);this.g2.connect(this.filter);this.filter.connect(this.vca);this.lfo.connect(this.lfoGain);this.osc1.start();this.osc2.start();this.lfo.start()}
/* v0.29.0 PAD SPREAD — optional per-VOICE StereoPanner (psyreason dc072ca
   alternating-stereo port). usePan=true lazily builds the voice's pan node
   (vca→pan→bus.input); false/absent keeps the EXACT legacy wiring
   (vca→bus.input, no node) — bit-neutral for every non-panned path. */
connect(bus,usePan){const w=!!usePan;if(this.bus!==bus||this.wiredPan!==w){this.vca.disconnect();if(w){if(!this.panN)this.panN=this.ctx.createStereoPanner();this.vca.connect(this.panN);this.panN.disconnect();this.panN.connect(bus.input)}else{this.vca.connect(bus.input)}this.lfoGain.disconnect();this.lfoGain.connect(this.filter.frequency);this.bus=bus;this.wiredPan=w}}
/* v0.13.0 SYNTH v2-lite — five OPTIONAL preset params, every one legacy-neutral
   (absent ⇒ the exact v0.12.0 scheduling):
     fenv — filter env amount multiplier (legacy default 3 = the old hardcoded ×3 start)
     fdec — filter env decay s (legacy default = the old atk+dec*0.7 formula)
     penv/pdec — pitch envelope: depth in semitones (0 = off, legacy) + decay s
     sub  — sine sub-osc level 0..1, one octave below (0/absent = node never built)
   noteOn returns the merged param object so trigger() can reuse it for
   synthDurEst without a second per-hit allocation. */
noteOn(tr,when,ev,stepDur){/* v0.13.0 P3: per-voice SCRATCH param object — cleared+refilled in place (allocation-light hot path; the object never escapes the call: trigger() consumes it synchronously for synthDurEst) */const p=this._p||(this._p={});for(const k in p)delete p[k];Object.assign(p,tr.sound,ev.lock||{});/* v0.29.0 PAD SPREAD: per-hit pan (−1..1) from the preset or the step lock — 0/absent = the exact legacy center wiring (bit-neutral) */const pan=clamp(p.pan||0,-1,1);this.connect(this.eng.chains[tr.idx],Math.abs(pan)>.001);if(this.panN)this.panN.pan.setValueAtTime(pan,when);const f=440*Math.pow(2,(clamp(ev.note,12,108)-69)/12);const gate=(p.gate||.6);const dur=stepDur*gate*2;const rel=Math.max(p.rel||.15,.02);const end=when+dur;this.osc1.type=p.wave1||'sawtooth';this.osc2.type=p.wave2||'sawtooth';this.osc1.frequency.cancelScheduledValues(when);this.osc2.frequency.cancelScheduledValues(when);const pv=clamp(p.penv||0,0,48);if(pv>0){const pd=Math.max(p.pdec||.08,.01);this.osc1.frequency.setValueAtTime(f*Math.pow(2,pv/12),when);this.osc1.frequency.exponentialRampToValueAtTime(f,when+pd);this.osc2.frequency.setValueAtTime(f*Math.pow(2,pv/12+(p.oct2||0)),when);this.osc2.frequency.exponentialRampToValueAtTime(f*Math.pow(2,p.oct2||0),when+pd)}else{this.osc1.frequency.setValueAtTime(f,when);this.osc2.frequency.setValueAtTime(f*Math.pow(2,p.oct2||0),when)}this.osc2.detune.setValueAtTime(p.detune||0,when);this.g1.gain.setValueAtTime(.6,when);this.g2.gain.setValueAtTime(.45,when);const sv=clamp(p.sub||0,0,1);if(sv>0){if(!this.subOsc){this.subOsc=this.ctx.createOscillator();this.subOsc.type='sine';this.subG=this.ctx.createGain();this.subG.gain.value=0;this.subOsc.connect(this.subG);this.subG.connect(this.filter);this.subOsc.start()}this.subOsc.frequency.setValueAtTime(f/2,when);this.subG.gain.setValueAtTime(.55*sv,when)}else if(this.subG)this.subG.gain.setValueAtTime(0,when);const cut=clamp(p.cutoff||1500,60,16000);const res=clamp(p.res||1,.2,24);this.filter.type=p.fType||'lowpass';this.filter.Q.setValueAtTime(res,when);this.filter.frequency.cancelScheduledValues(when);const fe=clamp(p.fenv!=null?p.fenv:3,0,16);const fd=p.fdec!=null?clamp(p.fdec,.01,2):Math.max((p.atk||.005)+(p.dec||.3)*.7,.01);this.filter.frequency.setValueAtTime(Math.min(cut*fe,16000),when);this.filter.frequency.exponentialRampToValueAtTime(cut,when+fd);if(p.lfoRate>0&&p.lfoDest==='cutoff'){this.lfo.frequency.setValueAtTime(p.lfoRate,when);this.lfoGain.gain.setValueAtTime((p.lfoDepth||0)*3000,when)}else this.lfoGain.gain.setValueAtTime(0,when);const vca=this.vca.gain;const vel=ev.vel;const atk=Math.max(p.atk||.005,.003);vca.cancelScheduledValues(when);vca.setValueAtTime(0,when);vca.linearRampToValueAtTime(vel*.5,when+atk);vca.setTargetAtTime(vel*.5*(p.sus!=null?p.sus:.6),when+atk,Math.max((p.dec||.3)/3,.01));vca.setTargetAtTime(.0001,end,Math.max(rel/3,.008));return p}
panic(){try{this.vca.gain.cancelScheduledValues(0);this.vca.gain.setValueAtTime(0,this.ctx.currentTime)}catch(e){}if(this.subG){try{this.subG.gain.cancelScheduledValues(0);this.subG.gain.setValueAtTime(0,this.ctx.currentTime)}catch(e){}}}
}
/* ── DrumVoice (v0.30.0 FOUNDATION RESET — the legacy SYNTH fallback) ──
   The pooled synth fallback for the six CORE drum types, used ONLY when
   opts.rom=false (neutral A/B tests) or when a psy4 kit render fails
   (counted in romFallbacks). The psy4 kit ROM is the sound of record —
   this path exists so the engine never lies silent.
   Same pooled node architecture and parameter surface as v2 (tune/decay/
   tone/punch): KICK (sub+body+click, saturated), SNARE (tone+noise),
   CLAP (multi-burst), HATS (six-square metallic stack, closed/open +
   choke), SHAKER (dual-envelope micro-structure). Every junk family
   (conga/bongo/cowbell/clave/rim/tom/zap/boom/glitch/darbuka/tambourine/
   triangle/downlifter/crash/revcym/agogo/timbale) is DELETED — the kit
   vocabulary is the psy4 kit's ten types, nothing else.
   Determinism: param automation over seeded buffers; duration formulas
   UNCHANGED (drumDurEst) → pool discipline and busyUntil windows moved
   zero. */
const HAT_RATIOS=[2.0,3.0,4.16,5.43,6.79,8.21];
/* v0.14.0 drum v2 params — burst-position/dynamics tables for the clap
   `bursts` param (2..6). Precomputed at module level: the hit path stays
   allocation-free. nb=4 is the v0.12.0 layout EXACTLY (same arrays). */
const CLAP_B={2:[0,.047],3:[0,.0235,.047],4:[0,.011,.023,.036],5:[0,.009,.019,.029,.043],6:[0,.008,.017,.025,.034,.047]};
const CLAP_D={2:[1,1.1],3:[1,.94,1.1],4:[1,1.07,.94,1.1],5:[1,.92,1.08,.96,1.1],6:[1,.93,1.09,.91,1.07,1.1]};
function mkSatCurve(){const n=1024,c=new Float32Array(n);for(let i=0;i<n;i++){const x=i/(n-1)*6-3;c[i]=Math.tanh(1.5*x)*.95}return c}
class DrumVoice{constructor(ctx,eng){this.ctx=ctx;this.eng=eng;this.bus=null;this.wiredWS=false;this.noise=ctx.createBufferSource();this.noise.buffer=eng.noise;this.noise.loop=true;this.noiseGain=ctx.createGain();this.noiseGain.gain.value=0;this.nFilter=ctx.createBiquadFilter();this.nFilter.type='bandpass';this.noise.connect(this.nFilter);this.nFilter.connect(this.noiseGain);this.osc=ctx.createOscillator();this.osc.type='sine';this.oscGain=ctx.createGain();this.oscGain.gain.value=0;this.osc.connect(this.oscGain);this.out=ctx.createGain();this.noiseGain.connect(this.out);this.oscGain.connect(this.out);
/* v2 layers: BODY osc (triangle — kick body / snare tone) + shared
   saturation shaper (kick only — routed out→outWS→bus; every other type
   routes out→bus directly, so non-kick voices are untouched) */
this.osc2=ctx.createOscillator();this.osc2.type='triangle';this.osc2Gain=ctx.createGain();this.osc2Gain.gain.value=0;this.osc2.connect(this.osc2Gain);this.osc2Gain.connect(this.out);this.outWS=ctx.createWaveShaper();this.outWS.curve=eng._satC||(eng._satC=mkSatCurve());this.osc2.start();this.noise.start();this.osc.start();this.metal=null}
ensureMetal(){if(this.metal)return;const c=this.ctx;const oscs=HAT_RATIOS.map(()=>{const o=c.createOscillator();o.type='square';o.frequency.value=80;o.start();return o});const bp=c.createBiquadFilter();bp.type='bandpass';bp.frequency.value=10000;bp.Q.value=.9;const hp=c.createBiquadFilter();hp.type='highpass';hp.frequency.value=7200;const g=c.createGain();g.gain.value=0;oscs.forEach(o=>o.connect(bp));bp.connect(hp);hp.connect(g);g.connect(this.out);this.metal={oscs,bp,hp,g}}
connect(bus,useWS){const w=!!useWS;const viaDrive=w&&!!this.wsDrive;if(this.bus!==bus||this.wiredWS!==w||this.wiredDrive!==viaDrive){this.out.disconnect();this.outWS.disconnect();if(w){if(viaDrive){this.out.connect(this.wsDrive);this.wsDrive.connect(this.outWS)}else this.out.connect(this.outWS);this.outWS.connect(bus.input)}else{this.out.connect(bus.input)}this.bus=bus;this.wiredWS=w;this.wiredDrive=viaDrive}}
hit(tr,when,vel,lock){const p=Object.assign({},tr.sound,lock||{});this.connect(this.eng.chains[tr.idx],(p.type||tr.type||'kick')==='kick');const tune=p.tune||1,decay=p.decay||1,tone=p.tone||1,punch=p.punch||0;const type=p.type||tr.type||'kick';const ng=this.noiseGain.gain,og=this.oscGain.gain,og2=this.osc2Gain.gain;
/* v0.12.0 P1: zero EVERY layer at the hit anchor first — a voice reused
   across types never carries a previous layer's tail into the new hit
   (the pool steal semantics stay exactly the v1 ones: reuse happens at
   busyUntil, so this cut lands after the estimated duration). */
ng.cancelScheduledValues(when);og.cancelScheduledValues(when);og2.cancelScheduledValues(when);ng.setValueAtTime(0,when);og.setValueAtTime(0,when);og2.setValueAtTime(0,when);/* v0.15.0: detune joins the zero-anchor — the cowbell's tone-mapped spread must never leak into a pooled reuse of the voice by another type (was always 0 before v0.15.0, so this is bit-neutral for every legacy path) */this.osc.detune.setValueAtTime(0,when);this.osc2.detune.setValueAtTime(0,when);if(this.metal){const mg=this.metal.g.gain;mg.cancelScheduledValues(when);mg.setValueAtTime(0,when)}
if(type==='kick'){
/* v0.14.0 drum v2: `dist` (0..1, default 0 = exact v0.13.1 path) — lazily
   builds a drive gain feeding the EXISTING kick saturation shaper
   (quadratic law, drive 1 → 6.5); `glide` (0..1, default 0) extends the
   SUB pitch-envelope start multiplier (2.6×f0 extra at 1). Absent/neutral
   values keep every scheduled value bit-identical. */
/* v0.29.0 DRUM-VOICE KICK DIMS (legacy/fallback path parity — psyreason
dceec3e): body/subk/sat join tune/decay/tone/punch as independent kick
dimensions. NEUTRAL-CENTERED: every factor is exactly 1.0 (and sat adds
zero drive) when the param is ABSENT — the pre-v0.29.0 scheduling is
bit-identical, pinned by kick-dims-v029.test.ts (absent ≡ explicit .5). */
const bN=p.body==null?.5:Math.min(Math.max(p.body,0),1);
const skN=p.subk==null?.5:Math.min(Math.max(p.subk,0),1);
const stN=p.sat==null?.5:Math.min(Math.max(p.sat,0),1);
const dv=Math.min(Math.max((p.dist||0)+0.35*Math.max(0,stN-.5),0),1);
if(dv>0){if(!this.wsDrive){this.wsDrive=this.ctx.createGain();this.wsDrive.gain.value=1;this.connect(this.eng.chains[tr.idx],true)}this.wsDrive.gain.cancelScheduledValues(when);this.wsDrive.gain.setValueAtTime(1+5.5*dv*dv,when)}else if(this.wsDrive){this.wsDrive.gain.cancelScheduledValues(when);this.wsDrive.gain.setValueAtTime(1,when)}
const gl=Math.min(Math.max(p.glide||0,0),1);
/* SUB — sine, exponential pitch envelope start→f0 (depth = punch, + glide;
   body deepens the center pitch, subk swells the level) */
const dur=.12+.5*decay;const f0=Math.max(24,45*tune*(1-.3*(bN-.5)));const start=f0*(2.2+2.2*Math.min(punch,1)+2.6*gl);
this.osc.type='sine';this.osc.frequency.setValueAtTime(start,when);this.osc.frequency.exponentialRampToValueAtTime(f0,when+.032);
og.setValueAtTime(vel*(.8-.15*Math.min(Math.max(tone,0),1.6))*(1+.3*(skN-.5)),when);og.exponentialRampToValueAtTime(.0001,when+dur);
/* BODY — triangle at f0, tone maps body/sub balance (bodyN widens level+decay) */
this.osc2.type='triangle';this.osc2.frequency.setValueAtTime(f0,when);og2.setValueAtTime(vel*(.28+.24*Math.min(Math.max(tone,0),1.6))*(1+.5*(bN-.5)),when);og2.exponentialRampToValueAtTime(.0001,when+dur*.45*(1+.4*(bN-.5)));
/* CLICK — highpassed noise transient, 2–6 ms (punch maps level + corner) */
this.nFilter.type='highpass';this.nFilter.frequency.setValueAtTime(3800+1400*Math.min(punch,1),when);this.nFilter.Q.value=.7;ng.setValueAtTime(vel*(.4+.5*Math.min(punch,1)),when);ng.exponentialRampToValueAtTime(.0001,when+.005);
}else if(type==='snare'){
/* TONE — triangle, ~0.4-semitone pitch drop, punch maps tone decay */
const dur=.1+.16*decay;const f0=195*tune;const td=Math.max(.05,(.10+.10*decay)*(1-.4*Math.min(punch,1)));
this.osc2.type='triangle';this.osc2.frequency.setValueAtTime(f0,when);this.osc2.frequency.exponentialRampToValueAtTime(f0*Math.pow(2,-.4/12),when+.06);og2.setValueAtTime(vel*(.5+.15*tone),when);og2.exponentialRampToValueAtTime(.0001,when+td);
/* NOISE — bandpass, tone maps the band (existing law) */
this.nFilter.type='bandpass';this.nFilter.frequency.setValueAtTime(1900*tone,when);this.nFilter.Q.value=.9;ng.setValueAtTime(vel*.85,when);ng.exponentialRampToValueAtTime(.0001,when+dur);
}else if(type==='clap'){
const dur=.25+.15*decay;this.nFilter.type='bandpass';this.nFilter.Q.value=1.1;
/* `bursts` (2..6, default 4 = the v0.12.0 layout EXACTLY — same tables).
   Exponential ~11 ms spacing + tail burst; per-burst bandpass
   offsets = deterministic spectral decorrelation (mono-voice reality:
   true L/R decorrelation is the worklet path — limitations list) */
const nb=Math.round(Math.min(Math.max(p.bursts||4,2),6));const B=CLAP_B[nb],DEC=CLAP_D[nb];B.forEach((t2,i)=>{ng.setValueAtTime(0,when+t2);ng.linearRampToValueAtTime(vel*(.8+.04*i),when+t2+.001);ng.exponentialRampToValueAtTime(.03,when+t2+.011);this.nFilter.frequency.setValueAtTime(1150*tone*DEC[i],when+t2)});
ng.setValueAtTime(vel*.5,when+.05);ng.exponentialRampToValueAtTime(.0001,when+dur);
}else if(type==='hatC'||type==='hatO'){
const open=type==='hatO';const dur=open?.26+.5*decay:.03+.05*decay;
/* metallic stack: 6 inharmonic squares → BP 10k → HP (tone = brightness).
   v0.14.0: `bright` (0.5..2, default 1 = exact v0.13.1) scales the BP
   corner — brighter hats sweep the stack resonance up, darker down */
this.ensureMetal();const base=40*tune;const br=Math.min(Math.max(p.bright||1,.5),2);const M=this.metal;M.oscs.forEach((o,i)=>o.frequency.setValueAtTime(HAT_RATIOS[i]*base,when));M.bp.frequency.setValueAtTime(10000*Math.sqrt(br),when);M.hp.frequency.setValueAtTime(7200*Math.sqrt(tone),when);const mg=M.g.gain;mg.setValueAtTime(vel*(open?.46:.42),when);mg.exponentialRampToValueAtTime(.0001,when+dur);
/* noise touch keeps a little of the old breath */
this.nFilter.type='highpass';this.nFilter.frequency.setValueAtTime(8000,when);ng.setValueAtTime(vel*.14,when);ng.exponentialRampToValueAtTime(.0001,when+dur);
}else if(type==='shaker'){
/* v0.12.0 P2: bandpass + dual-envelope micro-structure (fast attack,
   mid dip, secondary bump — the shaken-bead "shh-shh") */
const dur=.04+.07*decay;this.nFilter.type='bandpass';this.nFilter.frequency.setValueAtTime(5500*tone,when);this.nFilter.Q.value=1.4;ng.setValueAtTime(0,when);ng.linearRampToValueAtTime(vel*.5,when+.002);ng.exponentialRampToValueAtTime(vel*.18,when+.011);ng.linearRampToValueAtTime(vel*.34,when+.015);ng.exponentialRampToValueAtTime(.0001,when+dur)}}
panic(){try{this.noiseGain.gain.cancelScheduledValues(0);this.noiseGain.gain.setValueAtTime(0,this.ctx.currentTime);this.oscGain.gain.cancelScheduledValues(0);this.oscGain.gain.setValueAtTime(0,this.ctx.currentTime);this.osc2Gain.gain.cancelScheduledValues(0);this.osc2Gain.gain.setValueAtTime(0,this.ctx.currentTime);if(this.metal)this.metal.g.gain.cancelScheduledValues(0),this.metal.g.gain.setValueAtTime(0,this.ctx.currentTime);if(this.fmod)this.fmod.mg.gain.cancelScheduledValues(0),this.fmod.mg.gain.setValueAtTime(0,this.ctx.currentTime)}catch(e){}}
}

/* RomVoice — the pooled playback voice for PERCUSSION ROM buffers (v0.23.0).
   Pooled: env gain + tilt highshelf live for the engine's lifetime and are
   re-zeroed per hit (the zero-anchor discipline); the per-hit BufferSource
   is the one unavoidable allocation (GC-reaped, same law as the sample
   path). connect() mirrors DrumVoice's lazy wiring. */
class RomVoice{constructor(ctx,eng){this.ctx=ctx;this.eng=eng;this.bus=null;this.g=ctx.createGain();this.g.gain.value=0;this.f=ctx.createBiquadFilter();this.f.type='highshelf';this.f.frequency.value=3200;this.f.gain.value=0;this.f.connect(this.g);this.busyUntil=0;this.lastTrigger=0;this.lastType='';this.lastTrack=-1;this.amp=.001}
connect(bus){if(this.bus!==bus){this.g.disconnect();this.g.connect(bus.input);this.bus=bus}}}

export { PooledEngine };
/* v0.13.0 — MOOG insert support. prepInsertDSP loads the psy-dsp.js worklet
   module (MoogFilterProcessor) into a context ONCE (realtime at powerOn, or
   the offline ctx of a bounce/freeze/gate render before engines are built).
   projectUsesMoog(p) tells render paths whether the prep is needed. */
export async function prepInsertDSP(ctx){try{if(!ctx.__psy6DspLoaded){const url=new URL('../worklets/psy-dsp.js',import.meta.url);await ctx.audioWorklet.addModule(url);ctx.__psy6DspLoaded=true}return true}catch(e){return false}}
export function projectUsesMoog(p){if(!p||!Array.isArray(p.tracks))return false;return p.tracks.some(t=>t&&t.ins&&t.ins.filtOn===4)}
