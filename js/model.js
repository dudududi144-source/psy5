/* ============ core constants + model ============ */
/* psy-foundation is the SINGLE SOURCE OF TRUTH for shared musical primitives.
   The device imports scales, the canonical PRNG and string hashing from
   foundation/ — it does not re-implement them. Device-facing scale key names
   ('minor' etc.) are aliases onto the foundation table. */
import { mulberry32, fnv1a } from '../foundation/foundation.mjs';
import { SCALES as FOUNDATION_SCALES } from '../foundation/music/context.mjs';
const fnv = fnv1a;
const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
const deep=o=>JSON.parse(JSON.stringify(o));
const MAX_TRACKS=8,MAX_STEPS=32,MAX_SCENES=8;
/* GLOBAL VOICE CAPS — pre-allocated pools. The memory/latency budget knobs. */
const SYNTH_VOICES=20,DRUM_VOICES=24;
const SCALES={
  minor: FOUNDATION_SCALES.naturalMinor,
  major: FOUNDATION_SCALES.major,
  dorian: FOUNDATION_SCALES.dorian,
  phrygian: FOUNDATION_SCALES.phrygian,
};
const M_ENERGY=0,M_DRIVE=1,M_SPACE=2,M_MOVE=3;
function gcd(a,b){while(b){const t=a%b;a=b;b=t}return a}
function mkStep(on){return {on:on?1:0,vel:0.9,prob:1,micro:0,note:48,lock:{}}}
function mkPattern(name,nt){const d={};for(let t=0;t<nt;t++)d[t]={len:16,steps:Array.from({length:16},()=>mkStep(false))};return {name,data:d}}
function mkProject(){return {version:3,bpm:125,swing:0,root:33,scale:'minor',recQ:1,chain:false,seed:'PSY6',groove:'straight',fx:{delayDiv:'3/16',delayFb:.35},masterVol:.85,
activeScene:0,currentPattern:'A',selTrack:4,macroVals:[0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5],
tracks:[],patterns:{},scenes:[],lanes:[]}}
function loopLen(p){const pat=p.patterns[p.currentPattern];let L=1;if(!pat)return 16;
for(let t=0;t<MAX_TRACKS;t++){const l=(pat.data[t]&&pat.data[t].len)||16;L=L/gcd(L,l)*l}return Math.min(L,96)}
function laneEval(ln,step){const pts=ln.pts;if(!pts.length)return 0;
if(step<=pts[0][0])return pts[0][1];
for(let i=0;i<pts.length-1;i++){const s0=pts[i][0],v0=pts[i][1],s1=pts[i+1][0],v1=pts[i+1][1];
if(step>=s0&&step<=s1){const f=s1>s0?(step-s0)/(s1-s0):0;return v0+(v1-v0)*f}}
return pts[pts.length-1][1]}
/* ── Determinism + groove (PSY6) ──
   Every probabilistic decision (step probability, groove humanization) is
   drawn from a per-bar seeded RNG: seed = fnv(projectSeed + ":" + barIndex).
   The same project seed and the same bar therefore produce the identical
   event list on every loop pass — usable for live performance. */
function barSeed(projectSeed,barIndex){return parseInt(fnv(String(projectSeed==null?'PSY6':projectSeed)+':'+barIndex).slice(0,8),16)>>>0}
/* Groove templates — named per-step offset transforms, applied deterministically
   BEFORE the probability gate. 1 tick = 1/64 of a 16th-step, so psy-push's
   +6..+8 ticks ≈ +0.09..0.125 step (≈ 10-13 ms at 145 BPM). mpc54 delays odd
   16ths by the classic 54-58% swing ratio. humanize adds seeded gaussian
   micro timing of ±3% of a step. All offsets are in seconds. */
const GROOVES={
straight:{label:'Straight',off:(t,s,rng,sd,tick)=>0},
mpc54:{label:'MPC 54%',off:(t,s,rng,sd,tick)=>(s%2===1)?((0.54+0.04*rng())-0.5)*sd:0},
'psy-push':{label:'Psy Push',off:(t,s,rng,sd,tick)=>(t===4&&s%2===1)?(6+2*rng())*tick:0},
humanize:{label:'Humanize',off:(t,s,rng,sd,tick)=>((rng()+rng()+rng()-1.5)/1.5)*0.03*sd}
};
function stepEvents(p,s){
const pat=p.patterns[p.currentPattern];if(!pat)return [];
const evs=[],sd=60/p.bpm/4,tick=sd/64;
const bar=Math.floor((s%loopLen(p))/16);
const g=GROOVES[p.groove]||GROOVES.straight;
const rng=mulberry32(barSeed(p.seed,bar));
for(let t=0;t<MAX_TRACKS;t++){
const d=pat.data[t];if(!d)continue;
const len=d.len,idx=s%len,st=d.steps[idx];
if(!st||!st.on)continue;
/* full-range micro timing: micro[-100..100] → [-0.5..+0.5] of a step;
   negative offsets (ahead of the grid) are honored by the scheduler */
const sw=(idx%2===1)?(p.swing/100)*sd*0.75:0;
const off=sw+g.off(t,idx,rng,sd,tick)+(st.micro/100)*sd*0.5;
if(st.prob<1&&rng()>st.prob)continue;
const lock=Object.assign({},st.lock);
for(let li=0;li<p.lanes.length;li++){const ln=p.lanes[li];
if(ln.track===t&&lock[ln.param]===undefined)lock[ln.param]=laneEval(ln,s)}
evs.push({track:t,off,vel:clamp(st.vel,0.05,1),note:st.note,lock});
}
return evs;
}

export { clamp, deep, mulberry32, fnv, barSeed, GROOVES, MAX_TRACKS, MAX_STEPS, MAX_SCENES, SYNTH_VOICES, DRUM_VOICES, SCALES, M_ENERGY, M_DRIVE, M_SPACE, M_MOVE, gcd, mkStep, mkPattern, mkProject, loopLen, laneEval, stepEvents };
