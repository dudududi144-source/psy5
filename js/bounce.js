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
 * Returns {buf, N, scheduleHash} — N is the EXACT sample count the schedule
 * spans (buffer.length === N), scheduleHash identifies the event list. */
export async function renderBounce(p,loops,opts){
opts=opts||{};
const sr=44100,t0=.05;
let sch=bounceSchedule(p,loops,t0);
if(opts.trackIdx!=null)sch=Object.assign({},sch,{evs:sch.evs.filter(e=>e.track===opts.trackIdx)});
const N=Math.ceil(sch.total*sr);
const oc=new OfflineAudioContext(2,N,sr);
const eng=new PooledEngine(oc);
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
