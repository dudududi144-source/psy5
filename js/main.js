import { $, toast, I, K_MAIN, loadStored } from './state.js';
import { renderHeader, wireHeader } from './ui/header.js';
import { renderScenes, renderPads, renderTracks, renderLayers, renderMacros, wirePerform } from './ui/perform.js';
import { renderSeq, renderPos, wireSeq } from './ui/seq.js';
import { renderLib, renderSynthEd, wireSound } from './ui/sound.js';
import { renderMixer } from './ui/mix.js';
import { wireTests } from './ui/tests.js';
import { wireCopilot } from './ui/copilot.js';
import { wireArranger } from './ui/arranger.js';
import { startSched } from './scheduler.js';
import { PooledEngine } from './engine.js';
import { buildStyle } from './presets.js';
import { SYNTH_VOICES, DRUM_VOICES } from './model.js';

function renderAll(){if(!I.p)return;renderHeader();renderScenes();renderPads();renderTracks();renderLayers();renderMacros();renderSeq();renderLib();renderSynthEd();renderMixer();I.renderDirty=false}

function renderLoop(){requestAnimationFrame(renderLoop);if(I.p&&I.sched.on)renderPos();if(I.renderDirty)renderAll()}

setInterval(()=>{if(!I.eng||!I.eng.analyser)return;const an=I.eng.analyser;if(!I._md)I._md=new Uint8Array(an.frequencyBinCount);an.getByteTimeDomainData(I._md);let pk=0;for(const v of I._md){const a=Math.abs(v-128)/128;if(a>pk)pk=a}const cv=$('meter'),g=cv.getContext('2d');g.fillStyle='#000';g.fillRect(0,0,cv.width,cv.height);g.fillStyle=pk>.9?'#ff5d5d':'#4fd6c0';g.fillRect(0,8,pk*cv.width,10)},150);

function powerOn(style,resume){const AC=window.AudioContext||window.webkitAudioContext;const ctx=new AC({latencyHint:'interactive'});I.ctx=ctx;I.eng=new PooledEngine(ctx);let p=null;if(resume)p=loadStored();if(!p)p=buildStyle(style||'TECHNO',Date.now()%100000);I.p=p;I.upAt=Date.now();I.eng.syncMix(p);$('power').style.display='none';$('app').style.display='block';wireHeader();wirePerform();wireSeq();wireSound();wireTests();wireCopilot();wireArranger();renderAll();requestAnimationFrame(renderLoop);I.fsm='PLAYING';startSched();toast('POWER ON → '+(style||'RESUME')+' · pooled '+SYNTH_VOICES+' synth + '+DRUM_VOICES+' drum voices')}

(function boot(){const sp=$('stylePicker');['TECHNO','PSYTRANCE','TRANCE','PROGRESSIVE'].forEach(st=>{const b=document.createElement('button');b.textContent='⚡ '+st;b.onclick=()=>powerOn(st,false);sp.appendChild(b)});const empty=document.createElement('button');empty.textContent='∅ EMPTY';empty.onclick=()=>powerOn('EMPTY',false);sp.appendChild(empty);try{if(localStorage.getItem(K_MAIN))$('resumeBtn').style.display=''}catch(e){}$('resumeBtn').onclick=()=>powerOn(null,true)})();
