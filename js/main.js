import { $, toast, I, K_MAIN, loadStored, loadProjectObj } from './state.js';
import { renderHeader, wireHeader } from './ui/header.js';
import { renderLibrary, wireLibrary } from './ui/library.js';
import { renderScenes, renderPads, renderTracks, renderLayers, renderMacros, wirePerform } from './ui/perform.js';
import { renderSeq, renderPos, wireSeq } from './ui/seq.js';
import { renderLanes, wireLanes, drawPlayhead, populateParamSelect } from './ui/lanes.js';
import { wireCompose } from './ui/compose.js';
import { helpRows } from './shortcuts.js';
import { arrToggle } from './arranger.js';
import { renderLib, renderSynthEd, wireSound } from './ui/sound.js';
import { renderSamples, wireSamples, hydrateProjectSamples } from './ui/samples.js';
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
import { parseShareHash, decodeShare } from './share.js';
import { SYNTH_VOICES, DRUM_VOICES } from './model.js';

function renderAll(){if(!I.p)return;renderHeader();renderScenes();renderPads();renderTracks();renderLayers();renderMacros();renderSeq();renderLib();renderSynthEd();renderMixer();renderMidi();renderLanes();populateParamSelect();renderLibrary();I.renderDirty=false}
window.__psy6=I; /* debug/verification handle (headless CI reads engine state) */

function renderLoop(){requestAnimationFrame(renderLoop);if(I.p&&I.sched.on){renderPos();drawPlayhead()}if(I.renderDirty)renderAll()}

setInterval(()=>{if(!I.eng||!I.eng.analyser)return;const an=I.eng.analyser;if(!I._md)I._md=new Uint8Array(an.frequencyBinCount);an.getByteTimeDomainData(I._md);let pk=0;for(const v of I._md){const a=Math.abs(v-128)/128;if(a>pk)pk=a}const cv=$('meter'),g=cv.getContext('2d');g.fillStyle='#000';g.fillRect(0,0,cv.width,cv.height);g.fillStyle=pk>.9?'#ff5d5d':'#4fd6c0';g.fillRect(0,8,pk*cv.width,10)},150);

async function powerOn(style,resume){const AC=window.AudioContext||window.webkitAudioContext;const ctx=new AC({latencyHint:'interactive'});I.ctx=ctx;try{if(ctx.state==='suspended')ctx.resume()}catch(e){}
/* engine A/B (PSY6): MAIN pooled engine = default + reference · WORKLET = opt-in experimental */
if(I.engineSel==='worklet'){try{I.eng=await mkWorkletEngine(ctx);I.engine='worklet'}catch(e){I.engine='main';I.eng=new PooledEngine(ctx);toast('WORKLET BOOT FAILED → MAIN ENGINE')}}else{I.engine='main';I.eng=new PooledEngine(ctx)}
try{if(ctx.state==='suspended')ctx.resume()}catch(e){}
let p=null;if(resume)p=loadStored();if(!p&&I.pendingCompose){p=I.pendingCompose;I.pendingCompose=null}if(!p&&I.pendingShare){p=I.pendingShare;I.pendingShare=null}if(!p)p=buildStyle(style||'TECHNO',Date.now()%100000);I.p=p;loadProjectObj(p);/* backfill (midiMap/masterVol/sc/fx) — idempotent, sets I.p to the same object */I.upAt=Date.now();I.eng.syncMix(p);hydrateProjectSamples();/* v0.10.0: pull referenced samples into the engine cache (missing → synth fallback + one-shot toast) */$('power').style.display='none';$('app').style.display='block';wireHeader();wirePerform();wireSeq();wireSound();wireTests();wireCopilot();wireArranger();wireLibrary();wireMidi();wireCapture();wireLanes();wireCompose();wireSamples();renderAll();requestAnimationFrame(renderLoop);I.fsm='PLAYING';startSched();/* composed boot: land on Perform with the arranger running */if(I.composedLoad){try{arrToggle(true)}catch(e){};const f=I.composedLoad;I.composedLoad=null;toast('COMPOSED ✓ '+f.style+' · '+f.totalBars+' bars · '+f.lengthSec.toFixed(0)+'s · seed '+f.seed)}else toast('POWER ON → '+(style||'RESUME')+' · '+(I.engine==='worklet'?'WORKLET ENGINE (experimental — reduced self-gate)':'pooled '+SYNTH_VOICES+' synth + '+DRUM_VOICES+' drum voices'))}

(function boot(){const sp=$('stylePicker');['TECHNO','PSYTRANCE','TRANCE','PROGRESSIVE'].forEach(st=>{const b=document.createElement('button');b.textContent='⚡ '+st;b.onclick=()=>powerOn(st,false);sp.appendChild(b)});const empty=document.createElement('button');empty.textContent='∅ EMPTY';empty.onclick=()=>powerOn('EMPTY',false);sp.appendChild(empty);
/* engine selector — MAIN is the default (zero behavior change); WORKLET is opt-in */
const ep=$('enginePicker');I.engineSel='main';
const mkEng=(id,label,title)=>{const b=document.createElement('button');b.textContent=label;b.title=title;b.dataset.eng=id;b.onclick=()=>{I.engineSel=id;Array.from(ep.children).forEach(x=>x.classList.toggle('on',x.dataset.eng===id));$('engNote').textContent=id==='worklet'?'WORKLET — experimental. Honest limitations: '+WORKLET_LIMITATIONS.join(' · '):'MAIN — pooled voices + worker-timed scheduler. Default and reference engine; full Self-Gate (19 checks).'};ep.appendChild(b);return b};
mkEng('main','⬤ MAIN (default)','Pooled engine — default').classList.add('on');
mkEng('worklet','⚙ WORKLET (experimental)','AudioWorklet engine — reduced feature set, reduced self-gate');
$('engNote').textContent='MAIN — pooled voices + worker-timed scheduler. Default and reference engine; full Self-Gate (19 checks).';
try{if(localStorage.getItem(K_MAIN))$('resumeBtn').style.display=''}catch(e){}$('resumeBtn').onclick=()=>powerOn(null,true);
/* DEMOS: recipes recompose deterministically client-side; loads into memory only */
async function loadDemo(file){try{const doc=await (await fetch(file)).json();const {compose}=await import('./composer.js');const r=compose(doc.style,doc.minutes,doc.seed);I.pendingCompose=r.project;I.composedLoad=r.form;const sb=document.querySelector('#stylePicker button');if(sb)sb.click()}catch(e){toast('DEMO FAILED — '+e.message)}}
$('bDemoFull').onclick=()=>loadDemo('data/demos/demo-fullon.json');
$('bDemoDark').onclick=()=>loadDemo('data/demos/demo-darkpsy.json');
$('bDemoForest').onclick=()=>loadDemo('data/demos/demo-forest.json');wireCompose();/* power-screen COMPOSE row must be live before boot */
/* help overlay from the shortcut registry (single source of truth) */
(function(){const hb=$('helpBody');if(!hb)return;hb.innerHTML=helpRows().map(g=>'<div style="margin:6px 0"><div class="mono" style="font-size:9px;color:var(--acc2)">'+g.group.toUpperCase()+'</div>'+g.items.map(it=>'<div style="display:flex;gap:8px;font-size:11px;padding:1px 0"><span class="mono" style="min-width:70px;color:var(--acc)">'+it.key+'</span><span style="color:#fffa">'+it.label+'</span></div>').join('')+'</div>').join('');const b=$('bHelp');if(b)b.onclick=()=>window.__psy6ToggleHelp&&window.__psy6ToggleHelp()})();
/* share-link consent (v0.4.0): #p= present → banner with LOAD SHARE / DISMISS.
   NEVER auto-load — the shared project replaces the in-memory project only on
   an explicit user click. */
const shareTok=parseShareHash(location.hash);
if(shareTok){
const bar=document.createElement('div');
bar.style.cssText='margin-top:14px;padding:10px 14px;border:1px solid var(--acc2);border-radius:10px;max-width:560px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center';
bar.innerHTML='<span class="mono" style="font-size:10px">SHARED PROJECT DETECTED ('+shareTok.length+' chars) — load it? It replaces the current in-memory project.</span>';
const bLoad=document.createElement('button');bLoad.textContent='LOAD SHARE';bLoad.style.borderColor='var(--acc2)';bLoad.style.color='var(--acc2)';
const bDis=document.createElement('button');bDis.textContent='DISMISS';
bLoad.onclick=async()=>{try{const r=await decodeShare(shareTok);I.pendingShare=r.project;powerOn('SHARED',false)}catch(e){bar.querySelector('span').textContent='SHARE LINK INVALID — '+e.message}};
bDis.onclick=()=>{history.replaceState(null,'',location.pathname);bar.remove()};
bar.appendChild(bLoad);bar.appendChild(bDis);
$('power').appendChild(bar);
}})();
