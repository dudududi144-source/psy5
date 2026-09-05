import { $, toast, I, K_MAIN, loadStored, loadProjectObj } from './state.js';
import { compose, COMPOSER_STYLES } from './composer.js';
import { readyAlbum, READY_SEEDS } from './library.js'; /* v0.26.0: ONE seed table (roast fix #2 — the local duplicate table is gone) */
import { MAIN_GATE_COUNT } from './gates-manifest.js'; /* v0.26.0: the boot copy can never drift from the suite again (roast fix #3) */
import { renderHeader, wireHeader } from './ui/header.js';
import { renderLibrary, wireLibrary } from './ui/library.js';
import { renderScenes, renderPads, renderTracks, renderLayers, renderMacros, wirePerform } from './ui/perform.js';
import { renderSeq, renderPos, wireSeq } from './ui/seq.js';
import { renderLanes, wireLanes, drawPlayhead, populateParamSelect } from './ui/lanes.js';
import { wireCompose } from './ui/compose.js';
import { helpRows } from './shortcuts.js';
import { arrToggle } from './arranger.js';
import { renderLib, renderSynthEd, wireSound, syncKitSel } from './ui/sound.js';
import { renderSamples, wireSamples, hydrateProjectSamples, applyComposerSampleHints } from './ui/samples.js';
import { renderMixer } from './ui/mix.js';
import { wireTests } from './ui/tests.js';
import { wireCopilot } from './ui/copilot.js';
import { wireMidi, renderMidi } from './ui/midiui.js';
import { wireCapture } from './ui/capture.js';
import { wireArranger } from './ui/arranger.js';
import { startSched } from './scheduler.js';
import { PooledEngine, prepInsertDSP } from './engine.js';
import { kitWarmTypes, DEFAULT_KIT, styleKit } from '../foundation/dsp/kit-reason.mjs';
import { mkWorkletEngine, WORKLET_LIMITATIONS } from './worklet-engine.js';
import { buildStyle } from './presets.js';
import { parseShareHash, decodeShare } from './share.js';
import { SYNTH_VOICES, DRUM_VOICES } from './model.js';

function renderAll(){if(!I.p)return;renderHeader();/* v0.16.1 PERF — per-tab rendering: hidden tabs used to rebuild on EVERY render (the 345-row preset list, the whole mixer, the seq grid — all display:none!). Hidden-tab content renders on switch (wireHeader forces a full render) and stays live while visible. */
const tabOn=t=>{const el=$('tab-'+t);return !!(el&&el.classList.contains('on'))};
renderScenes();renderPads();renderMacros();renderTracks();renderLayers();renderMidi();renderLibrary();syncKitSel();/* v0.24.0: the KIT select mirrors state.kit/kitPinned on every render */
if(tabOn('seq')){renderSeq();renderLanes();populateParamSelect()}
if(tabOn('sound')){renderLib();renderSynthEd()}
if(tabOn('mix'))renderMixer();
I.renderDirty=false}
window.__psy6=I; /* debug/verification handle (headless CI reads engine state) */

function renderLoop(){requestAnimationFrame(renderLoop);if(I.p&&I.sched.on){renderPos();drawPlayhead()}if(I.renderDirty)renderAll()}

/* v0.13.0 P3 — LOAD chip: engine telemetry + output latency, painted at 4 Hz
   (textContent only on change — no layout churn). Red on pool pressure or a
   growing tier-0 starvation counter. */
setInterval(()=>{const el=$('loadMeter');if(!el)return;if(!I.eng||I.engine!=='main'||!I.eng.loadSnapshot){el.textContent='LOAD —';return}const l=I.eng.loadSnapshot();const cap=l.pools.synth+l.pools.drum;const load=cap?l.active/cap:0;const txt='LOAD '+(load*100).toFixed(0)+'% · '+l.synth+'/'+l.drum+'/'+l.samples+' · ST'+l.steals+' · T0'+l.tier0StealAttempts+' · '+l.latencyMs+'ms · RK'+l.reasonSpawns+'/'+l.reasonFallbacks+' · '+l.kitId;if(el.textContent!==txt)el.textContent=txt;el.style.color=(load>=.75||l.tier0StealAttempts>0)?'#ff5d5d':(load>=.4?'#ffb84f':'')},250);
setInterval(()=>{if(!I.eng||!I.eng.analyser)return;const an=I.eng.analyser;if(!I._md)I._md=new Uint8Array(an.frequencyBinCount);an.getByteTimeDomainData(I._md);let pk=0;for(const v of I._md){const a=Math.abs(v-128)/128;if(a>pk)pk=a}const cv=$('meter'),g=cv.getContext('2d');g.fillStyle='#000';g.fillRect(0,0,cv.width,cv.height);g.fillStyle=pk>.9?'#ff5d5d':'#4fd6c0';g.fillRect(0,8,pk*cv.width,10)},150);

/* ── v0.26.0 ROAST FIX #8 — powerOn() split into named single-concern steps.
   The v0.25.0 function mixed six concerns in ~40 dense lines (context + engine
   A/B + project priority + kit warm + wiring + start). Behavior is unchanged —
   the same gates assert the same boot — the code is just human-shaped now. */

async function bootAudio(){const AC=window.AudioContext||window.webkitAudioContext;const ctx=new AC({latencyHint:'interactive'});I.ctx=ctx;try{if(ctx.state==='suspended')ctx.resume()}catch(e){}
/* engine A/B (PSY6): MAIN pooled engine = default + reference · WORKLET = opt-in experimental */
if(I.engineSel==='worklet'){try{I.eng=await mkWorkletEngine(ctx);I.engine='worklet'}catch(e){I.engine='main';I.eng=new PooledEngine(ctx);toast('WORKLET BOOT FAILED → MAIN ENGINE')}}else{I.engine='main';I.eng=new PooledEngine(ctx)}/* v0.13.0: preload the psy-dsp worklet module (MOOG insert) best-effort — live playback gets the real ladder; unloadable → honest per-track biquad fallback (counted) */
try{prepInsertDSP(ctx)}catch(e){}
try{if(ctx.state==='suspended')ctx.resume()}catch(e){}}

function bootProject(style,resume){let p=null;if(resume)p=loadStored();if(!p&&I.pendingCompose){p=I.pendingCompose;I.pendingCompose=null}if(!p&&I.pendingShare){p=I.pendingShare;I.pendingShare=null}if(!p)p=buildStyle(style||'TECHNO',Date.now()%100000);I.p=p;loadProjectObj(p);/* backfill (midiMap/masterVol/sc/fx) — idempotent, sets I.p to the same object */}

/* v0.24.0 REASON KIT warm — the kit list (20 types: 8 reason engines + 12 kit ROM roles) rendered at power-on, idle-sliced so the boot frame never blocks. It runs AFTER the project load so the PROJECT'S kit is the one warmed (the render cache keys on kitId — warming the default kit would miss a stored/pinned kit). The idle callback guards engine loss. */
function bootWarmKit(){if(!(I.eng&&I.eng.warmRom))return;const WARM=kitWarmTypes((I.p&&I.p.kit)||DEFAULT_KIT);/* v0.29.0: warm the ACTIVE KICK PRESET's dims variant too — the first hit of a dimmed kick preset must never pay the render latency */const kickP=()=>{const t=(I.p&&I.p.tracks||[]).find(x=>x&&x.kind==='drum'&&((x.sound&&x.sound.type)||x.type)==='kick');return (t&&t.sound)||null};let wi=0;const warmStep=()=>{if(!I.eng||!I.eng.warmRom)return;const dl=(window.requestIdleCallback||(cb=>setTimeout(cb,16)));dl(()=>{try{if(wi<WARM.length){const ty=WARM[wi++];I.eng.romBuffer(ty,ty==='kick'?kickP():null);warmStep()}}catch(e){}})};warmStep()}

function bootStart(style){I.upAt=Date.now();I.eng.syncMix(I.p);hydrateProjectSamples();if(I.pendingHints){I.pendingHints=false;applyComposerSampleHints({sampleHints:I.p.sampleHints})}/* v0.10.0: composed-boot sample hints *//* v0.10.0: pull referenced samples into the engine cache (missing → synth fallback + one-shot toast) */$('power').style.display='none';$('app').style.display='flex';wireHeader();wirePerform();wireSeq();wireSound();wireTests();wireCopilot();wireArranger();wireLibrary();wireMidi();wireCapture();wireLanes();wireCompose();wireSamples();renderAll();requestAnimationFrame(renderLoop);I.fsm='PLAYING';startSched();/* composed boot: land on Perform with the arranger running */if(I.composedLoad){try{arrToggle(true)}catch(e){};const f=I.composedLoad;I.composedLoad=null;toast('COMPOSED ✓ '+f.style+' · '+f.totalBars+' bars · '+f.lengthSec.toFixed(0)+'s · seed '+f.seed)}else toast('POWER ON → '+(style||'RESUME')+' · '+(I.engine==='worklet'?'WORKLET ENGINE (experimental — reduced self-gate)':'pooled '+SYNTH_VOICES+' synth + '+DRUM_VOICES+' drum voices'))}

async function powerOn(style,resume){await bootAudio();bootProject(style,resume);bootWarmKit();bootStart(style)}

/* ── READY SET boot (v0.17.0) — the owner: the user must receive the system
   ORGANIZED and READY TO PERFORM, never empty. Every genre button composes a
   full deterministic set (scenes + variants + arranger + lanes + transitions
   + a preseeded READY ALBUM) and lands on Perform with the arranger running.
   Pinned seeds → the same set every time per style (replayable, testable).
   ∅ BARE SKETCH keeps the old minimal buildStyle boot for sketching. */
async function composeBoot(style,minutes,seed){try{toast('COMPOSING '+style+' — '+minutes+' MIN…');
const r=compose(style,minutes,seed);
/* v0.24.0 KIT HOOK — a composed set follows its style's kit unless the user PINNED one in the Sound tab (the pin rides the live project and carries over). */
if(I.p&&I.p.kitPinned&&kitWarmTypes(I.p.kit).length){r.project.kit=I.p.kit;r.project.kitPinned=true}else{r.project.kit=styleKit(style);r.project.kitPinned=false}
try{readyAlbum(r.project,style,seed,minutes)}catch(e){/* album is enrichment — never blocks the boot */}
I.pendingCompose=r.project;I.composedLoad=r.form;await powerOn(style,false)}catch(e){toast('COMPOSE FAILED — '+e.message)}}

(function boot(){const sp=$('stylePicker');
/* HERO — the one-press entrance: a complete arranged set, playing now */
const hero=document.createElement('button');hero.className='heroBtn';hero.textContent='▶ ENTER · READY SET — FULL-ON · 3 MIN';hero.title='Boots a COMPLETE deterministic set: intro→build→drop→break→riser→drop2→outro, scenes + transitions + arranger + a preseeded song album. Press PLAY-grade ready — not empty.';hero.onclick=()=>composeBoot('FULL-ON',3,424242);sp.appendChild(hero);
/* v0.27.0 GENRE CARDS — the nine styles as a card grid with per-style color,
   BPM and character (ROAST_v0.27 §1.2: nine identical grey rectangles die).
   Colors reuse the strip-builder palette so the whole product stays coherent. */
const STYLE_CARD={ 'FULL-ON':'#4fd6c0', 'DARK-PSY':'#c58cff', 'PROGRESSIVE':'#6aa9ff', 'FOREST':'#5dd27a', 'HI-TECH':'#ff5d5d', 'PSYTRANCE':'#ffb454', 'GOA':'#ffd75e', 'TECHNO':'#93a0b8', 'TRANCE':'#5ac8d4' };
Object.keys(COMPOSER_STYLES).forEach(st=>{const meta=COMPOSER_STYLES[st];const b=document.createElement('button');b.className='genreCard';b.style.setProperty('--gc',STYLE_CARD[st]||'#4fd6c0');b.innerHTML='<span class="gName">'+st+'</span><span class="gMeta">'+meta.bpm+' BPM · READY SET · 3 MIN</span><i class="gBar"></i>';b.title='READY SET — a complete arranged '+meta.bpm+' BPM '+st+' set (3 min, deterministic seed '+READY_SEEDS[st]+') with scenes, transitions and the arranger pre-built. Not empty — ready to perform.';b.onclick=()=>composeBoot(st,3,READY_SEEDS[st]);sp.appendChild(b)});
const empty=document.createElement('button');empty.className='sketchBtn';empty.textContent='∅ BARE SKETCH';empty.title='The minimal skeleton (no scenes, no arranger) — for sketching from scratch.';empty.onclick=()=>powerOn('EMPTY',false);sp.appendChild(empty);
/* engine selector — MAIN is the default (zero behavior change); WORKLET is opt-in */
const ep=$('enginePicker');I.engineSel='main';
const MAIN_NOTE='MAIN — pooled voices + worker-timed scheduler. Default and reference engine; full Self-Gate — '+MAIN_GATE_COUNT+' CI-asserted checks (run them in the Self-Gate tab).';
const mkEng=(id,label,title)=>{const b=document.createElement('button');b.textContent=label;b.title=title;b.dataset.eng=id;b.onclick=()=>{I.engineSel=id;Array.from(ep.children).forEach(x=>x.classList.toggle('on',x.dataset.eng===id));$('engNote').textContent=id==='worklet'?'WORKLET — experimental. Honest limitations: '+WORKLET_LIMITATIONS.join(' · '):MAIN_NOTE};ep.appendChild(b);return b};
mkEng('main','⬤ MAIN (default)','Pooled engine — default').classList.add('on');
mkEng('worklet','⚙ WORKLET (experimental)','AudioWorklet engine — reduced feature set, reduced self-gate');
$('engNote').textContent=MAIN_NOTE;
try{if(localStorage.getItem(K_MAIN))$('resumeBtn').style.display=''}catch(e){}$('resumeBtn').onclick=()=>powerOn(null,true);
/* v0.26.0 SHOWCASE demos (roast fix #1): the boot button plays EXACTLY the song
   data/demos/<file> pins and tests/usability.test.ts certifies — one identity,
   the 8-minute full-form version, seeds from the READY_SEEDS table. */
$('bDemoFull').onclick=()=>composeBoot('FULL-ON',8,424242);
$('bDemoDark').onclick=()=>composeBoot('DARK-PSY',8,90210);
$('bDemoForest').onclick=()=>composeBoot('FOREST',8,1337);wireCompose();/* power-screen COMPOSE row must be live before boot */
/* help overlay — backdrop click + close button wired here (v0.26.0 roast fix #6:
   the two inline onclick= attributes are gone from index.html; the product
   carries zero inline JS) */
(function(){const ho=$('helpOverlay');if(ho)ho.onclick=e=>{if(e.target===ho)ho.style.display='none'};const bc=$('bHelpClose');if(bc)bc.onclick=()=>window.__psy6ToggleHelp&&window.__psy6ToggleHelp()})();
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
