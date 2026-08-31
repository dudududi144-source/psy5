import { $, toast, I, K_MAIN, loadStored } from './state.js';
import { renderHeader, wireHeader } from './ui/header.js';
import { renderScenes, renderPads, renderTracks, renderLayers, renderMacros, wirePerform } from './ui/perform.js';
import { renderSeq, renderPos, wireSeq } from './ui/seq.js';
import { renderLib, renderSynthEd, wireSound } from './ui/sound.js';
import { renderMixer } from './ui/mix.js';
import { wireTests } from './ui/tests.js';
import { wireCopilot } from './ui/copilot.js';
import { wireMidi, renderMidi } from './ui/midiui.js';
import { wireCapture } from './ui/capture.js';
import { wireArranger } from './ui/arranger.js';
import { startSched } from './scheduler.js';
import { PooledEngine } from './engine.js';
import { mkWorkletEngine, WORKLET_LIMITATIONS } from './worklet-engine.js';
import { buildStyle } from './presets.js';
import { SYNTH_VOICES, DRUM_VOICES } from './model.js';

function renderAll(){if(!I.p)return;renderHeader();renderScenes();renderPads();renderTracks();renderLayers();renderMacros();renderSeq();renderLib();renderSynthEd();renderMixer();renderMidi();I.renderDirty=false}
window.__psy6=I; /* debug/verification handle (headless CI reads engine state) */

function renderLoop(){requestAnimationFrame(renderLoop);if(I.p&&I.sched.on)renderPos();if(I.renderDirty)renderAll()}

setInterval(()=>{if(!I.eng||!I.eng.analyser)return;const an=I.eng.analyser;if(!I._md)I._md=new Uint8Array(an.frequencyBinCount);an.getByteTimeDomainData(I._md);let pk=0;for(const v of I._md){const a=Math.abs(v-128)/128;if(a>pk)pk=a}const cv=$('meter'),g=cv.getContext('2d');g.fillStyle='#000';g.fillRect(0,0,cv.width,cv.height);g.fillStyle=pk>.9?'#ff5d5d':'#4fd6c0';g.fillRect(0,8,pk*cv.width,10)},150);

async function powerOn(style,resume){const AC=window.AudioContext||window.webkitAudioContext;const ctx=new AC({latencyHint:'interactive'});I.ctx=ctx;try{if(ctx.state==='suspended')ctx.resume()}catch(e){}
/* engine A/B (PSY6): MAIN pooled engine = default + reference · WORKLET = opt-in experimental */
if(I.engineSel==='worklet'){try{I.eng=await mkWorkletEngine(ctx);I.engine='worklet'}catch(e){I.engine='main';I.eng=new PooledEngine(ctx);toast('WORKLET BOOT FAILED → MAIN ENGINE')}}else{I.engine='main';I.eng=new PooledEngine(ctx)}
try{if(ctx.state==='suspended')ctx.resume()}catch(e){}
let p=null;if(resume)p=loadStored();if(!p)p=buildStyle(style||'TECHNO',Date.now()%100000);I.p=p;I.upAt=Date.now();I.eng.syncMix(p);$('power').style.display='none';$('app').style.display='block';wireHeader();wirePerform();wireSeq();wireSound();wireTests();wireCopilot();wireArranger();wireMidi();wireCapture();renderAll();requestAnimationFrame(renderLoop);I.fsm='PLAYING';startSched();toast('POWER ON → '+(style||'RESUME')+' · '+(I.engine==='worklet'?'WORKLET ENGINE (experimental — reduced self-gate)':'pooled '+SYNTH_VOICES+' synth + '+DRUM_VOICES+' drum voices'))}

(function boot(){const sp=$('stylePicker');['TECHNO','PSYTRANCE','TRANCE','PROGRESSIVE'].forEach(st=>{const b=document.createElement('button');b.textContent='⚡ '+st;b.onclick=()=>powerOn(st,false);sp.appendChild(b)});const empty=document.createElement('button');empty.textContent='∅ EMPTY';empty.onclick=()=>powerOn('EMPTY',false);sp.appendChild(empty);
/* engine selector — MAIN is the default (zero behavior change); WORKLET is opt-in */
const ep=$('enginePicker');I.engineSel='main';
const mkEng=(id,label,title)=>{const b=document.createElement('button');b.textContent=label;b.title=title;b.dataset.eng=id;b.onclick=()=>{I.engineSel=id;Array.from(ep.children).forEach(x=>x.classList.toggle('on',x.dataset.eng===id));$('engNote').textContent=id==='worklet'?'WORKLET — experimental. Honest limitations: '+WORKLET_LIMITATIONS.join(' · '):'MAIN — pooled voices + worker-timed scheduler. Default and reference engine; full Self-Gate (15 checks).'};ep.appendChild(b);return b};
mkEng('main','⬤ MAIN (default)','Pooled engine — default').classList.add('on');
mkEng('worklet','⚙ WORKLET (experimental)','AudioWorklet engine — reduced feature set, reduced self-gate');
$('engNote').textContent='MAIN — pooled voices + worker-timed scheduler. Default and reference engine; full Self-Gate (15 checks).';
try{if(localStorage.getItem(K_MAIN))$('resumeBtn').style.display=''}catch(e){}$('resumeBtn').onclick=()=>powerOn(null,true)})();
