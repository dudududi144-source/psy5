/* ============ core constants + model ============ */
/* psy-foundation is the SINGLE SOURCE OF TRUTH for shared musical primitives.
   The device imports scales, the canonical PRNG and string hashing from
   foundation/ — it does not re-implement them. Device-facing scale key names
   ('minor' etc.) are aliases onto the foundation table. */
import { mulberry32, fnv1a } from '../foundation/foundation.mjs';
import { SCALES as FOUNDATION_SCALES } from '../foundation/music/context.mjs';
import { LIMITS } from './limits.js';
const fnv = fnv1a;
const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
const deep=o=>JSON.parse(JSON.stringify(o));
/* Ceilings come from limits.js (v0.5.0 UNLIMIT) — no hard-coded numbers here.
   Defaults (8 tracks / 16 steps / 8 scenes) live in presets.initTracks/buildStyle. */
const MAX_TRACKS=LIMITS.MAX_TRACKS,MAX_STEPS=LIMITS.MAX_STEPS,MAX_SCENES=LIMITS.MAX_SCENES;
/* GLOBAL VOICE CAPS — pre-allocated pools. The memory/latency budget knobs. */
const SYNTH_VOICES=20,DRUM_VOICES=24;
const SCALES={
  minor: FOUNDATION_SCALES.naturalMinor,
  major: FOUNDATION_SCALES.major,
  dorian: FOUNDATION_SCALES.dorian,
  phrygian: FOUNDATION_SCALES.phrygian,
  harmonicMinor: FOUNDATION_SCALES.harmonicMinor, /* v0.7.0 FOREST — darker bias */
  /* ── v0.20.0 SCALE EXPANSION 5→13 — three foundation scales existed
     unwired (phrygianDominant / doubleHarmonic / minorPentatonic) plus five
     new foundation voices. Additive-only: the legacy five keys keep their
     byte-identical intervals, composer styles are untouched (pin
     discipline), the new keys are user-facing (scale picker, pads,
     evolution). */
  phrygianDominant: FOUNDATION_SCALES.phrygianDominant,
  doubleHarmonic: FOUNDATION_SCALES.doubleHarmonic,
  minorPentatonic: FOUNDATION_SCALES.minorPentatonic,
  lydian: FOUNDATION_SCALES.lydian,
  mixolydian: FOUNDATION_SCALES.mixolydian,
  hungarianMinor: FOUNDATION_SCALES.hungarianMinor,
  melodicMinor: FOUNDATION_SCALES.melodicMinor,
  majorPentatonic: FOUNDATION_SCALES.majorPentatonic,
};
/* v0.17.0 — ALL EIGHT macros are real. The first four shipped earlier;
   4..7 were dead UI until this run (the owner: "רק כמה פונקציות בודדות"
   — not just a few single functions). resolveMacros (state.js) is the
   single resolver; each macro reads its base snapshot deterministically. */
const M_ENERGY=0,M_DRIVE=1,M_SPACE=2,M_MOVE=3,M_FILTER=4,M_TIGHT=5,M_HAUNT=6,M_FAZE=7;
function gcd(a,b){while(b){const t=a%b;a=b;b=t}return a}
function mkStep(on){return {on:on?1:0,vel:0.9,prob:1,micro:0,note:48,lock:{}}}
function mkPattern(name,nt){const d={};for(let t=0;t<nt;t++)d[t]={len:16,steps:Array.from({length:16},()=>mkStep(false))};return {name,data:d}}
function mkProject(){return {version:3,bpm:125,swing:0,root:33,scale:'minor',recQ:1,chain:false,seed:'PSY6',groove:'straight',fx:{delayDiv:'3/16',delayFb:.35},masterVol:.85,
master:{eqLow:0,eqMid:0,eqHigh:0,compOn:0,compThresh:-20,compRatio:2,compAttack:10,compRelease:150,compMakeup:0,widthMaster:1},
activeScene:0,currentPattern:'A',selTrack:4,macroVals:[0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5],
tracks:[],patterns:{},scenes:[],lanes:[]}}
function loopLen(p){const pat=p.patterns[p.currentPattern];let L=1;if(!pat)return 16;
/* iterate over the tracks actually present in the pattern data — works for
   any track count; cap raised 96→LIMITS.LOOP_CAP (1024) in v0.5.0 */
for(const k of Object.keys(pat.data)){const l=(pat.data[k]&&pat.data[k].len)||16;L=L/gcd(L,l)*l}return Math.min(L,LIMITS.LOOP_CAP)}
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
humanize:{label:'Humanize',off:(t,s,rng,sd,tick)=>((rng()+rng()+rng()-1.5)/1.5)*0.03*sd},
/* ── v0.20.0 GROOVE EXPANSION 4→13 — the feel vocabulary the owner kept
   asking for ("חסרים הרבה אופציות"). Same contract as the legacy four:
   pure (t,step,rng,sd,tick) → seconds, deterministic through the caller's
   seeded rng, applied BEFORE the probability gate. Track map: 0 KICK,
   1 SNARE, 2 HATS, 3 PERC, 4 BASS, 5 LEAD, 6 PAD, 7 ARP. */
mpc58:{label:'MPC 58%',off:(t,s,rng,sd,tick)=>(s%2===1)?((0.58+0.04*rng())-0.5)*sd:0},
shuffle62:{label:'Shuffle 62%',off:(t,s,rng,sd,tick)=>(s%2===1)?((0.62+0.03*rng())-0.5)*sd:0},
'psy-glide':{label:'Psy Glide',off:(t,s,rng,sd,tick)=>(t===4)?(-4-2*rng())*tick:0},
'lazy-bass':{label:'Lazy Bass',off:(t,s,rng,sd,tick)=>(t===4)?(9+3*rng())*tick:0},
hhlift:{label:'HH Lift',off:(t,s,rng,sd,tick)=>(t===2&&s%2===0)?(3+2*rng())*tick:0},
'perc-drag':{label:'Perc Drag',off:(t,s,rng,sd,tick)=>(t===3)?(5+4*rng())*tick:0},
'push16':{label:'Push 16ths',off:(t,s,rng,sd,tick)=>(s%2===1&&t!==0)?(4+2*rng())*tick:0},
'laid-back':{label:'Laid Back',off:(t,s,rng,sd,tick)=>(-2-2*rng())*tick},
drunk:{label:'Drunk',off:(t,s,rng,sd,tick)=>((rng()+rng()-1))*5*tick}
};
/* ── tap tempo (v0.17.0) — PURE: keep the taps inside the window, average
   the deltas, clamp to the transport range. Returns {count,bpm} — bpm is
   null until two taps sit inside the window (the caller decides when to
   apply). DOM-free so the Bun suite owns the math. */
function tapTempo(taps,now,windowMs){const w=windowMs||2500;const t=(Array.isArray(taps)?taps:[]).filter(x=>now-x>=0&&now-x<w);t.push(now);if(t.length<2)return{count:t.length,bpm:null};const d=[];for(let i=1;i<t.length;i++)d.push(t[i]-t[i-1]);const avg=d.reduce((a,b)=>a+b,0)/d.length;if(!(avg>0))return{count:t.length,bpm:null};return{count:t.length,bpm:clamp(Math.round(60000/avg),40,300)}}

/* ── FILL VARIANTS (v0.18.0, five since v0.19.0, EIGHT since v0.20.0) —
   the FILL button/`f` key cycles the deterministic layouts. Offsets are in
   STEPS (×sd at trigger time), track indexes are the canonical drum lanes
   (3 = perc, 1 = snare).
   CLASSIC (perc 8ths crescendo) · ROLL (16-hit machine-gun) ·
   TOMLINE (tuned toms + snare) · SNARE16 (full-bar accelerating 16th snare
   roll + perc accents) · CLIMB (rising-tune perc sweep) ·
   STUTTER (v0.20.0 — last-beat tuned 8th stutter, the glitch breath) ·
   HOVER (v0.20.0 — the anti-fill: one hit then dissolve, a pre-drop vacuum)
   · SPIRAL (v0.20.0 — perc/snare alternating accel: quarters → 8ths).
   Pure — bun-owned; the trigger path (PERF.fill) only maps these onto
   eng.trigger. tune rides the parameter lock (the drum voice reads
   tune from the merged lock — the same mechanism step locks use). */
const FILL_NAMES=['CLASSIC','ROLL','TOMLINE','SNARE16','CLIMB','STUTTER','HOVER','SPIRAL'];
function fillEvents(type){const t=((type|0)%FILL_NAMES.length+FILL_NAMES.length)%FILL_NAMES.length;const out=[];
if(t===1){for(let k=0;k<16;k++)out.push({track:3,off:k*.5,vel:.35+.6*k/15,lock:{}})}
else if(t===2){for(let k=0;k<8;k++)out.push({track:3,off:k*.5,vel:.55+.04*k,lock:{tune:Math.round((0.8+0.6*k/7)*1000)/1000}});for(let k=0;k<4;k++)out.push({track:1,off:k,vel:.5,lock:{}})}
else if(t===3){for(let k=0;k<16;k++)out.push({track:1,off:k,vel:.3+.65*k/15,lock:{}});out.push({track:3,off:12,vel:.6,lock:{}});out.push({track:3,off:14,vel:.7,lock:{}})}
else if(t===4){for(let k=0;k<8;k++)out.push({track:3,off:k*1.5,vel:.4+.06*k,lock:{tune:Math.round((0.7+0.09*k)*1000)/1000}})}
else if(t===5){for(let k=0;k<8;k++)out.push({track:3,off:12+k*.5,vel:.7,lock:{tune:Math.round((0.9+0.04*(k%4))*1000)/1000}})}
else if(t===6){out.push({track:3,off:0,vel:.85,lock:{}});out.push({track:1,off:12,vel:.5,lock:{}});out.push({track:3,off:14,vel:.35,lock:{tune:.75}})}
else if(t===7){for(let k=0;k<8;k++)out.push({track:k%2?3:1,off:k,vel:.35+.06*k,lock:{}});for(let k=0;k<8;k++)out.push({track:k%2?1:3,off:8+k*.5,vel:.55+.05*k,lock:{}})}
else{for(let k=0;k<8;k++)out.push({track:3,off:k*.5,vel:.5+.05*k,lock:{}})}
return out}

/* ── PADS v3 (v0.22.0) — the LIVE GRID contract ──
   The old pad surface was below criticism (the owner, with a screenshot:
   16 pads all reading "Trance", half of them DEAD — the i%tracks.length map
   landed on synth tracks and padHit refused to fire). This module is the
   pure repair, bun-owned like fillEvents:

   DRUM mode  — one pad per REAL drum track (smart label: the preset name
   minus the leading genre word, "Trance Punch Kick" → "PUNCH KICK"), then
   VARIANT pads fill the grid to 16 with musical transforms of the kit
   (+OCT/−OCT/TIGHT/LONG/PUNCH/DARK/BRITE/SUB) riding the per-hit parameter
   lock — the exact mechanism step locks use. Every one of the 16 pads
   resolves to a playable drum voice. ZERO dead pads, ever.
   SCALE mode — 16 pads = two octaves of the project scale, real note names.
   CHORD mode — diatonic triads with correct quality symbols (m ° + maj).
   A set with NO drum voices answers honestly (mode 'empty' → the UI toasts
   the Sound-tab fix — the established dj() convention).

   PAD_GLYPHS: per-type envelope silhouettes (normalized 0..1 points, y up)
   rendered as SVG polylines — every pad shows the SHAPE of its sound.
   Pure data + pure functions; no DOM here. */
const PAD_GRID=16;
/* leading genre words stripped from preset names for pad labels — the first
   word of a preset name is (by factory convention) the genre tag */
const PAD_GENRE_WORDS=new Set(['psy','trance','techno','prog','progressive','goa','dark','full-on','hi-tech','forest','init','tranz','noise','fx']);
function padLabel(tr){
  const nm=String((tr&&tr.name)||'').trim();
  if(!nm)return '—';
  const words=nm.split(/\s+/);
  const base=(words.length>=2&&PAD_GENRE_WORDS.has(words[0].toLowerCase()))?words.slice(1).join(' '):nm;
  return base.toUpperCase().slice(0,18);
}
function padType(tr){const sd=(tr&&tr.sound)||{};return String(sd.type||tr.type||'kick')}
/* variant recipes — musical transforms over the kit's drum tracks to fill
   the grid. SIXTEEN recipes: with D drum tracks the grid needs 16−D ≤ 15
   variants, so every (recipe, track) pair is distinct for ANY kit size —
   no two pads ever share an identity. Values land in the SAME clamp ranges
   the engine and the preset validators use (tune 0.4..2.2, decay 0.15..3,
   punch 0..1, tone 0.4..1.9). */
const PAD_VARIANTS=[
  {tag:'+OCT', mod:s=>({tune:Math.min(2.2,Math.max(.4,(s.tune||1)*2))})},
  {tag:'-OCT', mod:s=>({tune:Math.min(2.2,Math.max(.4,(s.tune||1)*.5))})},
  {tag:'TIGHT',mod:s=>({decay:Math.max(.15,Math.min(3,(s.decay||1)*.4))})},
  {tag:'LONG', mod:s=>({decay:Math.max(.15,Math.min(3,(s.decay||1)*2.2))})},
  {tag:'PUNCH',mod:s=>({punch:1})},
  {tag:'DARK', mod:s=>({tone:Math.min(1.9,Math.max(.4,(s.tone||1)*.55))})},
  {tag:'BRITE',mod:s=>({tone:Math.min(1.9,Math.max(.4,(s.tone||1)*1.5))})},
  {tag:'SUB',  mod:s=>({tune:Math.min(2.2,Math.max(.4,(s.tune||1)*.72)),decay:Math.max(.15,Math.min(3,(s.decay||1)*1.5))})},
  {tag:'+5TH', mod:s=>({tune:Math.min(2.2,Math.max(.4,(s.tune||1)*1.498))})},
  {tag:'-5TH', mod:s=>({tune:Math.min(2.2,Math.max(.4,(s.tune||1)*.667))})},
  {tag:'GATE', mod:s=>({decay:Math.max(.15,Math.min(3,(s.decay||1)*.25))})},
  {tag:'WASH', mod:s=>({decay:Math.max(.15,Math.min(3,(s.decay||1)*2.8))})},
  {tag:'SNAP', mod:s=>({punch:.8,decay:Math.max(.15,Math.min(3,(s.decay||1)*.55))})},
  {tag:'DEEP', mod:s=>({tune:Math.min(2.2,Math.max(.4,(s.tune||1)*.81)),decay:Math.max(.15,Math.min(3,(s.decay||1)*1.35))})},
  {tag:'AIR',  mod:s=>({tone:Math.min(1.9,Math.max(.4,(s.tone||1)*1.35)),decay:Math.max(.15,Math.min(3,(s.decay||1)*.8))})},
  {tag:'HOLLOW',mod:s=>({tone:Math.min(1.9,Math.max(.4,(s.tone||1)*.7)),tune:Math.min(2.2,Math.max(.4,(s.tune||1)*.89))})},
];
const ROMAN=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI'];
const NOTE_NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const padNoteName=n=>NOTE_NAMES[((n%12)+12)%12]+(Math.floor(n/12)-1);
const padChordName=(n1,n2,n3)=>NOTE_NAMES[((n1%12)+12)%12]+padChordQuality(n1,n2,n3);
function padChordQuality(n1,n2,n3){const a=n2-n1,b=n3-n2;return (a===3&&b===3)?'°':(a===3&&b===4)?'m':(a===4&&b===3)?'':(a===4&&b===4)?'+':''}
/* padKit(p, mode) — the ONE pad-grid builder. Returns exactly 16 entries:
   DRUM   {mode:'voice'|'variant'|'empty', track, label, sub, lock, glyph}
   SCALE  {mode:'scale', note, label, sub}          sub = roman degree
   CHORD  {mode:'chord', notes:[n1,n2,n3], label, sub}  label = Cm/F/…  */
function padKit(p,mode){
  const out=[];
  if(mode==='SCALE'||mode==='CHORD'){
    const sc=SCALES[p.scale]||SCALES.minor,root=p.root|0,L=sc.length;
    for(let i=0;i<PAD_GRID;i++){
      const idx=i%L,oct=Math.floor(i/L);
      const n=root+24+sc[idx]+12*oct;
      if(mode==='SCALE')out.push({mode:'scale',note:n,label:padNoteName(n),sub:ROMAN[i]});
      else{
        const ns=[0,2,4].map(k=>root+24+sc[(idx+k)%L]+12*(oct+Math.floor((idx+k)/L)));
        out.push({mode:'chord',notes:ns,label:padChordName(ns[0],ns[1],ns[2]),sub:ROMAN[i]});
      }
    }
    return out;
  }
  /* DRUM */
  const drums=[];const n=Math.min(p.tracks.length,MAX_TRACKS);
  for(let t=0;t<n;t++)if(p.tracks[t]&&p.tracks[t].kind==='drum')drums.push(t);
  for(const ti of drums){if(out.length>=PAD_GRID)break;const tr=p.tracks[ti];
    out.push({mode:'voice',track:ti,label:padLabel(tr),sub:padType(tr),lock:null,glyph:padType(tr)})}
  let vi=0;
  while(out.length<PAD_GRID&&drums.length){
    const ti=drums[vi%drums.length],tr=p.tracks[ti],v=PAD_VARIANTS[vi%PAD_VARIANTS.length];
    const lock=v.mod(tr.sound||{});
    out.push({mode:'variant',track:ti,label:padLabel(tr),mod:v.tag,sub:padType(tr),lock,glyph:padType(tr)});
    vi++;
  }
  while(out.length<PAD_GRID)out.push({mode:'empty',track:null,label:'—',sub:'no drum voice',lock:null,glyph:null});
  return out;
}
/* PAD_GLYPHS — envelope silhouettes per drum type (12-point polylines,
   x 0..100, y 0..56, y=4 attack peak / y=56 silence). Drawn as SVG in the
   pad — the visual identity the empty gray cards never had. */
const PAD_GLYPHS={
  kick:'0,4 6,10 16,34 30,48 48,53 72,55 100,56',
  snare:'0,4 8,12 18,26 30,36 44,44 62,50 100,54',
  clap:'0,4 6,20 12,10 20,28 28,14 38,32 60,44 100,52',
  hatc:'0,4 8,26 18,46 32,54 100,56',
  hato:'0,4 8,24 20,36 38,46 60,52 100,55',
  tom:'0,4 10,16 24,32 42,44 64,51 100,55',
  rim:'0,4 10,30 20,48 34,54 100,56',
  glitch:'0,4 8,28 14,10 22,36 30,16 40,40 52,50 74,54 100,55',
  shaker:'0,22 12,8 24,26 36,12 48,32 62,44 100,54',
  conga:'0,4 12,14 28,30 46,42 68,50 100,54',
  bongo:'0,4 14,16 30,34 48,44 70,51 100,55',
  cowbell:'0,4 10,18 20,14 32,30 46,40 66,48 100,53',
  clave:'0,4 12,26 24,46 40,53 100,56',
  zap:'0,4 14,40 28,52 46,55 100,56',
  boom:'0,4 8,12 20,28 36,42 56,50 80,54 100,55',
  riser:'0,52 20,46 40,38 60,28 80,16 100,4',
  impact:'0,4 6,14 16,30 30,42 48,50 72,54 100,55',
  darbuka:'0,4 12,18 26,32 44,43 66,50 100,54',
  tambourine:'0,18 10,6 22,22 34,10 46,28 60,40 78,48 100,53',
  triangle:'0,4 12,14 26,22 42,30 60,38 80,46 100,50',
  downlifter:'0,4 20,14 40,26 60,38 80,48 100,54',
  crash:'0,4 6,16 14,28 26,38 42,46 64,51 100,54',
  revcym:'0,54 20,48 40,40 60,28 80,14 96,4 100,52',
  agogo:'0,4 14,20 30,36 50,45 72,51 100,55',
  timbale:'0,4 12,20 26,34 44,44 66,50 100,54',
};
const padGlyph=t=>PAD_GLYPHS[String(t||'').toLowerCase()]||PAD_GLYPHS.tom;

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

export { clamp, deep, mulberry32, fnv, barSeed, GROOVES, MAX_TRACKS, MAX_STEPS, MAX_SCENES, SYNTH_VOICES, DRUM_VOICES, SCALES, M_ENERGY, M_DRIVE, M_SPACE, M_MOVE, M_FILTER, M_TIGHT, M_HAUNT, M_FAZE, tapTempo, FILL_NAMES, fillEvents, gcd, mkStep, mkPattern, mkProject, loopLen, laneEval, stepEvents, LIMITS, PAD_GRID, padKit, padLabel, padType, padGlyph, PAD_GLYPHS, padNoteName, padChordQuality };
