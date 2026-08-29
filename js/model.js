/* ============ core constants + model ============ */
const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
const deep=o=>JSON.parse(JSON.stringify(o));
function mulberry32(s){let a=s>>>0;return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function fnv(str){let h=0xcbf29ce484222325n;for(let i=0;i<str.length;i++){h^=BigInt(str.charCodeAt(i));h=(h*0x100000001b3n)&0xFFFFFFFFFFFFFFFFn}return h.toString(16)}
const $=id=>document.getElementById(id);
function toast(m,ms){const t=$('toast');t.textContent=m;t.classList.add('show');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('show'),ms||2200)}
const MAX_TRACKS=8,MAX_STEPS=32,MAX_SCENES=8;
/* GLOBAL VOICE CAPS — pre-allocated pools. The memory/latency budget knobs. */
const SYNTH_VOICES=20,DRUM_VOICES=24;
const SCALES={minor:[0,2,3,5,7,8,10],major:[0,2,4,5,7,9,11],dorian:[0,2,3,5,7,9,10],phrygian:[0,1,3,5,7,8,10]};
const M_ENERGY=0,M_DRIVE=1,M_SPACE=2,M_MOVE=3;
function gcd(a,b){while(b){const t=a%b;a=b;b=t}return a}
function mkStep(on){return {on:on?1:0,vel:0.9,prob:1,micro:0,note:48,lock:{}}}
function mkPattern(name,nt){const d={};for(let t=0;t<nt;t++)d[t]={len:16,steps:Array.from({length:16},()=>mkStep(false))};return {name,data:d}}
function mkProject(){return {version:3,bpm:125,swing:0,root:33,scale:'minor',recQ:1,chain:false,
activeScene:0,currentPattern:'A',selTrack:4,macroVals:[0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5],
tracks:[],patterns:{},scenes:[],lanes:[]}}
function loopLen(p){const pat=p.patterns[p.currentPattern];let L=1;if(!pat)return 16;
for(let t=0;t<MAX_TRACKS;t++){const l=(pat.data[t]&&pat.data[t].len)||16;L=L/gcd(L,l)*l}return Math.min(L,96)}
function laneEval(ln,step){const pts=ln.pts;if(!pts.length)return 0;
if(step<=pts[0][0])return pts[0][1];
for(let i=0;i<pts.length-1;i++){const s0=pts[i][0],v0=pts[i][1],s1=pts[i+1][0],v1=pts[i+1][1];
if(step>=s0&&step<=s1){const f=s1>s0?(step-s0)/(s1-s0):0;return v0+(v1-v0)*f}}
return pts[pts.length-1][1]}
function stepEvents(p,s,rng){
const pat=p.patterns[p.currentPattern],evs=[],sd=60/p.bpm/4;
const sw=(s%2===1)?(p.swing/100)*sd*0.75:0;
for(let t=0;t<MAX_TRACKS;t++){
const d=pat.data[t];if(!d)continue;
const len=d.len,idx=s%len,st=d.steps[idx];
if(!st||!st.on)continue;
if(st.prob<1&&rng()>st.prob)continue;
const lock=Object.assign({},st.lock);
for(let li=0;li<p.lanes.length;li++){const ln=p.lanes[li];
if(ln.track===t&&lock[ln.param]===undefined)lock[ln.param]=laneEval(ln,s)}
evs.push({track:t,off:sw+(st.micro/100)*sd*0.45,vel:clamp(st.vel,0.05,1),note:st.note,lock});
}
return evs;
}

export { clamp, deep, mulberry32, fnv, MAX_TRACKS, MAX_STEPS, MAX_SCENES, SYNTH_VOICES, DRUM_VOICES, SCALES, M_ENERGY, M_DRIVE, M_SPACE, M_MOVE, gcd, mkStep, mkPattern, mkProject, loopLen, laneEval, stepEvents };
