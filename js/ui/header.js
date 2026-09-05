import { $, toast, I, pushHist, after, saveProject, loadProjectObj, PERF } from '../state.js';
import { startSched, stopSched } from '../scheduler.js';
import { clamp, GROOVES, SCALES, loopLen } from '../model.js';
import { renderBounce, stemTracks, wavEncode, pcmFromBuffer, renderSong, songDurationSec, songFrames, songRenderController, songMidi, SONG_MAX_SEC, SONG_HARD_MAX_SEC, songStemTracks, songStemsGuard } from '../bounce.js';
import { writeMidi } from '../midifile.js';
import { encodeShare } from '../share.js';
import { exportBundle, importBundle, createSampleStore, referencedSampleIds } from '../samplestore.js';
import { hydrateProjectSamples } from './samples.js';
import { padHit, djFire } from './perform.js';
import { helpRows } from '../shortcuts.js';
const padTrigger=i=>{try{padHit(i);const el=document.querySelectorAll('#pads .pad')[i];if(el){el.classList.add('hit');setTimeout(()=>el.classList.remove('hit'),110)}}catch(e){/* engine not booted yet */}};
function toggleHelp(){const o=$('helpOverlay');if(!o)return;o.style.display=o.style.display==='flex'?'none':'flex'}
function closeHelp(){const o=$('helpOverlay');if(o)o.style.display='none'}

function renderHeader(){if($('grooveSel').options.length===0)$('grooveSel').innerHTML=Object.keys(GROOVES).map(k=>'<option value="'+k+'">'+GROOVES[k].label+'</option>').join('');$('grooveSel').value=I.p.groove||'straight';/* v0.20.0 SCALE picker — derived from the library (every scale appears; a future scale can never silently vanish, the grooveSel discipline) */if($('scaleSel').options.length===0)$('scaleSel').innerHTML=Object.keys(SCALES).map(k=>'<option value="'+k+'">'+k.replace(/([A-Z])/g,' $1').toUpperCase()+'</option>').join('');$('scaleSel').value=I.p.scale||'minor';if(document.activeElement!==$('seedIn'))$('seedIn').value=I.p.seed||'PSY6';$('fsm').textContent=I.fsm;$('bpm').value=I.p.bpm;$('swing').value=I.p.swing;$('swV').textContent=I.p.swing+'%';$('bPlay').classList.toggle('on',['PLAYING','RECORDING','TRANSITIONING'].includes(I.fsm));$('bRec').classList.toggle('on',I.recOn);$('bChain').classList.toggle('on',I.p.chain);$('bChain').textContent='CHAIN '+(I.p.chain?'ON':'OFF')}

function wireHeader(){document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.remove('on'));b.classList.add('on');document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));$('tab-'+b.dataset.t).classList.add('on');/* v0.16.1 PERF: hidden tabs skip renderAll — switching flags dirty; the rAF loop renders the arriving tab within one frame (no circular import) */I.renderDirty=true});$('bPlay').onclick=()=>{if(I.fsm==='OFF')return;if(['PLAYING','RECORDING','TRANSITIONING'].includes(I.fsm))return;I.fsm=I.recOn?'RECORDING':'PLAYING';startSched();renderHeader()};$('bStop').onclick=()=>{if(['PLAYING','RECORDING','TRANSITIONING'].includes(I.fsm)){stopSched();I.fsm='READY';I.pending=null;renderHeader()}};$('bRec').onclick=()=>{I.recOn=!I.recOn;if(I.recOn&&I.fsm==='READY'){I.fsm='RECORDING';startSched()}else if(I.fsm==='PLAYING'||I.fsm==='RECORDING')I.fsm=I.recOn?'RECORDING':'PLAYING';renderHeader()};$('bPanic').onclick=()=>{if(I.eng)I.eng.killAll();toast('PANIC — all voices killed')};$('bpm').onchange=e=>{pushHist();I.p.bpm=clamp(+e.target.value,40,300);after()};$('swing').oninput=e=>{$('swV').textContent=e.target.value+'%'};$('swing').onchange=e=>{pushHist();I.p.swing=clamp(+e.target.value,0,66);after()};$('grooveSel').innerHTML=Object.keys(GROOVES).map(k=>'<option value="'+k+'">'+GROOVES[k].label+'</option>').join('');$('grooveSel').onchange=e=>{pushHist();I.p.groove=e.target.value;I.renderDirty=true};/* v0.20.0 SCALE picker — live pads (CHORD/NOTE), evolution and melodic lanes read p.scale; pushHist keeps the undo story honest */$('scaleSel').innerHTML=Object.keys(SCALES).map(k=>'<option value="'+k+'">'+k.replace(/([A-Z])/g,' $1').toUpperCase()+'</option>').join('');$('scaleSel').onchange=e=>{pushHist();I.p.scale=e.target.value;I.renderDirty=true};$('seedIn').onchange=e=>{pushHist();I.p.seed=e.target.value.trim()||'PSY6';I.renderDirty=true};$('bUndo').onclick=()=>{if(I.hist.length){I.redo.push(JSON.stringify(I.p));I.p=JSON.parse(I.hist.pop());I.dirty=true;I.renderDirty=true}};$('bRedo').onclick=()=>{if(I.redo.length){I.hist.push(JSON.stringify(I.p));I.p=JSON.parse(I.redo.pop());I.dirty=true;I.renderDirty=true}};$('bSave').onclick=()=>{const r=saveProject();toast(r.ok?'SAVED ✓':'SAVE FAILED')};$('bShare').onclick=async()=>{if(!I.p)return;if(I.copilotSnapshot)I.copilotSnapshot();const r=await encodeShare(I.p);
if(!r.ok&&r.reason==='no-compression'){toast('SHARE: this browser lacks CompressionStream — use EXPORT instead (no quality loss)');return}
if(!r.ok){toast('SHARE FAILED — link too large ('+((r.tokenBytes||0)/1024|0)+' KB) — use EXPORT');return}
location.hash='p='+r.token;const url=location.origin+location.pathname+'#p='+r.token;
try{await navigator.clipboard.writeText(url);toast('SHARE LINK copied ✓ '+(r.tokenBytes/1024|0)+' KB'+(r.warn?' — large, may exceed some URL limits':''))}catch(e){toast('SHARE LINK in the address bar ('+(r.tokenBytes/1024|0)+' KB) — copy it there')}};$('bExport').onclick=async()=>{if(I.copilotSnapshot)I.copilotSnapshot();let extra=null;const refs=referencedSampleIds(I.p);if(refs.length&&confirm('EXPORT — bundle sample audio (base64) into the file?\n\nOK = bundle ('+refs.length+' referenced sample(s) — hard guard 30 MB)\nCancel = metadata-only export (projects always stay playable via synth fallback)')){const b=await exportBundle(I.p,I.sampleStore||(I.sampleStore=createSampleStore()));if(b.overCap){toast('EXPORT: sample bundle exceeds the 30 MB guard ('+(b.b64Bytes/1048576).toFixed(1)+' MB) — exporting metadata-only')}else{extra=b;if(b.missing.length)toast('EXPORT: '+b.missing.length+' referenced sample(s) missing from the store — exported metadata-only for them')}}const doc=extra?Object.assign({},I.p,{samples:extra.records}):I.p;const blob=new Blob([JSON.stringify(doc)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='psy6-project.json';a.click()};$('bImport').onclick=()=>$('impF').click();$('impF').onchange=e=>{const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=async()=>{try{const p=JSON.parse(rd.result);if(p&&p.version===3&&p.tracks){if(Array.isArray(p.samples)&&p.samples.length){if(!I.sampleStore)I.sampleStore=createSampleStore();const n=await importBundle(p.samples,I.sampleStore);if(n)toast('rehydrated '+n+' sample(s) into IndexedDB')}loadProjectObj(p);hydrateProjectSamples();toast('imported')}else toast('invalid file')}catch(err){toast('IMPORT FAILED')}};rd.readAsText(f)};$('bChain').onclick=()=>{I.p.chain=!I.p.chain;renderHeader()};
/* ── BOUNCE — offline WAV render (never touches the live AudioContext) ── */
let songCtl=null; /* active song-render controller — CANCEL aborts it cleanly */
$('bBounce').onclick=()=>{if(!I.p)return;$('bounceModal').style.display='flex';const opt=document.querySelector('#bounceMode option[value=song]');if(opt){const has=songSteps(I.p).length>0;opt.disabled=!has;opt.textContent=has?'SONG':'SONG (arranger empty)'}const wrap=$('songStemsWrap');if(wrap)wrap.style.display=(($('bounceMode')?$('bounceMode').value:'mix')==='song')?'inline-flex':'none';if($('bMidi')){const has=songSteps(I.p).length>0;$('bMidi').disabled=!has;$('bMidi').title=has?'Export the WHOLE arranger as a standard MIDI file (format 1): same song expansion as the SONG render':'EXPORT MIDI: the arranger is empty — build [scene,bars] sections first'}if($('songProg')){$('songProg').style.display='none';$('songProgBar').style.width='0%'}bounceInfo()};
const dlWav=(ab,name)=>{const blob=new Blob([ab],{type:'audio/wav'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000)};
const songSteps=p=>(p.arranger&&Array.isArray(p.arranger.steps))?p.arranger.steps:[];
const bounceInfo=()=>{const loops=+$('bounceLoops').value;const L=loopLen(I.p);const dur=.05+L*loops*60/I.p.bpm/4;const mode=$('bounceMode')?$('bounceMode').value:'mix';if(mode==='song'){const steps=songSteps(I.p);if(!steps.length){$('bounceInfo').textContent='SONG: arranger is empty — build [scene,bars] sections first';return}const d=songDurationSec(I.p);const secs=songSteps(I.p).reduce((a,s,i)=>{if(!i||s.scene!==songSteps(I.p)[i-1].scene)a++;return a},0);$('bounceInfo').textContent=I.p.bpm+' BPM · SONG '+secs+' sections · '+steps.reduce((a,s)=>a+s.bars,0)+' bars · music '+d.music.toFixed(1)+'s · with tail '+d.withTail.toFixed(1)+'s · '+songFrames(I.p)+' samples'}else if(mode==='stems'){const n=stemTracks(I.p,loops).tracks.length;$('bounceInfo').textContent=I.p.bpm+' BPM · loop '+L+' steps · '+n+' non-empty track'+(n===1?'':'s')}else{$('bounceInfo').textContent=I.p.bpm+' BPM · loop '+L+' steps · '+dur.toFixed(2)+'s · '+Math.ceil(dur*44100)+' samples'}};
$('bounceLoops').onchange=bounceInfo;if($('bounceMode'))$('bounceMode').onchange=()=>{bounceInfo();const wrap=$('songStemsWrap');if(wrap)wrap.style.display=$('bounceMode').value==='song'?'inline-flex':'none'};
/* EXPORT MIDI — standard interchange: the SAME song expansion the offline
   WAV renderer walks (songSteps + stepEvents), serialized by the pure
   format-1 writer. Zero new render logic; the .mid == WAV schedule. */
if($('bMidi'))$('bMidi').onclick=()=>{if(!I.p)return;const sm=songMidi(I.p);if(!sm){toast('MIDI: the arranger is empty — build [scene,bars] sections first');return}const ab=writeMidi(sm);const blob=new Blob([ab],{type:'audio/midi'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='psy6-song-'+I.p.bpm+'bpm.mid';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);toast('MIDI ✓ format 1 · '+sm.tracks.length+' tracks · '+sm.tracks.reduce((x,t)=>x+t.notes.length,0)+' notes · '+sm.totalTicks+' ticks · '+(ab.length/1024|0)+' KB')};
$('bounceCancel').onclick=()=>{if(songCtl){songCtl.cancel();return}$('bounceModal').style.display='none';$('bounceGo').disabled=false;$('bounceGo').textContent='RENDER WAV';if($('songProg'))$('songProg').style.display='none'};
$('bounceGo').onclick=async()=>{const b=$('bounceGo');b.disabled=true;b.textContent='RENDERING…';try{const loops=+$('bounceLoops').value;const mode=$('bounceMode')?$('bounceMode').value:'mix';
if(mode==='stems'){const {tracks}=stemTracks(I.p,loops);if(!tracks.length){toast('STEMS: no notes in this pattern');b.disabled=false;b.textContent='RENDER WAV';return}
let done=0;for(const ti of tracks){const {buf,N}=await renderBounce(I.p,loops,{trackIdx:ti,samples:I.eng?I.eng.sampleCache:null});const pcm=pcmFromBuffer(buf);const ab=wavEncode(pcm.channels,pcm.sampleRate);const nm=(I.p.tracks[ti].name||('track-'+ti)).replace(/\s+/g,'-').toLowerCase();dlWav(ab,'psy6-stem-'+nm+'.wav');done++;await new Promise(r=>setTimeout(r,350))/* sequential downloads — browsers throttle rapid clicks */}
toast('STEMS ✓ '+done+' file'+(done===1?'':'s')+' · '+N+' samples each');$('bounceModal').style.display='none'}
else if(mode==='song'){const steps=songSteps(I.p);
if(!steps.length){toast('SONG: arranger is empty — build [scene,bars] sections first');b.disabled=false;b.textContent='RENDER WAV';return}
const d=songDurationSec(I.p);
if(d.withTail>SONG_HARD_MAX_SEC){toast('SONG: '+(d.withTail/60).toFixed(1)+' min exceeds the 30-minute hard render cap — shorten the arranger');b.disabled=false;b.textContent='RENDER WAV';return}
if(d.withTail>SONG_MAX_SEC&&!confirm('LONG-FORM RENDER — '+((d.withTail/60)|0)+' min of audio\n\nRenders the FULL arrangement offline (a 40 MB+ buffer). This needs a capable machine; the progress modal can CANCEL mid-render.\nStems and SECTION bounce stay capped at 10 min and will refuse.\nContinue?'))return;
/* v0.9.0 P4 documented storage limit: long-form projects exceed the ~5 MB
   localStorage quota (12-min \u2248 3.8 MB, 20-min \u2248 6.4 MB JSON) \u2014 SAVE will
   show SAVE FAILED by design; EXPORT (file) and SHARE are unaffected. */
/* v0.8.0 SONG STEMS — the STEMS checkbox in the song bounce path: one WAV
   per non-empty track via the SAME renderSong (trackFilter — no fork),
   sequential downloads with progress; memory caps from songStemsGuard */
if($('songStems')&&$('songStems').checked){
const {tracks}=songStemTracks(I.p);
if(!tracks.length){toast('STEMS: no notes in the song');b.disabled=false;b.textContent='RENDER WAV';return}
const g=songStemsGuard(I.p,tracks.length);
if(!g.ok){toast('STEMS REFUSED — '+g.reason);b.disabled=false;b.textContent='RENDER WAV';return}
let done=0;
for(const ti of tracks){
if(songCtl)songCtl.cancel();
const ctl=songRenderController();songCtl=ctl;
b.textContent='STEM '+(done+1)+'/'+tracks.length+'…';
const nm=((I.p.tracks[ti]&&I.p.tracks[ti].name)||('track-'+ti)).replace(/\s+/g,'-').toLowerCase();
$('songProg').style.display='';$('songProgLabel').textContent='RENDERING STEM '+(done+1)+'/'+tracks.length+' — '+nm;
const r=await renderSong(I.p,{ctrl:ctl,trackFilter:ti,samples:I.eng?I.eng.sampleCache:null});
songCtl=null;
if(!r||r.cancelled){break}
const pcm=pcmFromBuffer(r.buf,r.startFrame||0,r.N);
const ab=wavEncode(pcm.channels,pcm.sampleRate);
dlWav(ab,'psy6-song-stem-'+nm+'.wav');
done++;
toast('STEM ✓ '+nm+' · '+r.N+' samples ('+done+'/'+tracks.length+')');
await new Promise(r2=>setTimeout(r2,400))/* sequential downloads — browsers throttle rapid clicks */
}
$('songProg').style.display='none';$('bounceModal').style.display='none';
toast('SONG STEMS ✓ '+done+' file'+(done===1?'':'s')+' · '+tracks.length+' non-empty tracks')}
else{
const ctl=songRenderController();songCtl=ctl;
ctl.onProgress=(i,n,sceneIdx)=>{const pr=$('songProg');if(!pr)return;pr.style.display='';$('songProgBar').style.width=Math.round(100*i/n)+'%';const nm=(I.p.scenes[sceneIdx]&&I.p.scenes[sceneIdx].name)||('SCENE '+(sceneIdx+1));$('songProgLabel').textContent='RENDERING SONG — section '+(i+1)+'/'+n+' · '+nm+' · '+Math.round(100*i/n)+'%'};
ctl._onCancelled=()=>{songCtl=null;b.disabled=false;b.textContent='RENDER WAV';if($('songProg'))$('songProg').style.display='none';toast('SONG render cancelled — clean abort, live engine untouched')};
$('songProg').style.display='';$('songProgLabel').textContent='RENDERING SONG…';
const r=await renderSong(I.p,{ctrl:ctl,samples:I.eng?I.eng.sampleCache:null});
songCtl=null;
if(r.cancelled){return}
const pcm=pcmFromBuffer(r.buf);const ab=wavEncode(pcm.channels,pcm.sampleRate);
dlWav(ab,'psy6-song-'+I.p.bpm+'bpm.wav');
$('songProg').style.display='none';$('bounceModal').style.display='none';
toast('SONG ✓ music '+r.musicSec.toFixed(1)+'s · with tail '+r.totalSec.toFixed(1)+'s · '+r.N+' samples · '+(ab.byteLength/1024|0)+' KB')}}
else{const {buf,N}=await renderBounce(I.p,loops,{samples:I.eng?I.eng.sampleCache:null});const pcm=pcmFromBuffer(buf);const ab=wavEncode(pcm.channels,pcm.sampleRate);dlWav(ab,'psy6-bounce-'+I.p.bpm+'bpm.wav');toast('BOUNCED ✓ '+N+' samples · '+(ab.byteLength/1024|0)+' KB');$('bounceModal').style.display='none'}}catch(err){toast('BOUNCE FAILED — '+err.message)}songCtl=null;b.disabled=false;b.textContent='RENDER WAV'};
/* keyboard dispatcher — bindings come from js/shortcuts.js (single source of
   truth, collision-tested; ? renders the help overlay from the same table) */
window.addEventListener('keydown',e=>{
if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT')return;
if(e.code==='Space'){e.preventDefault();if(['PLAYING','RECORDING','TRANSITIONING'].includes(I.fsm))$('bStop').click();else $('bPlay').click()}
else if(e.code.startsWith('Digit')){const n=+e.code.slice(5);if(n>=1&&n<=8){if(e.altKey){/* v0.17.0 — Alt+N instant-launches scene N (the live performance jump) */if(I.p&&I.p.scenes[n-1])PERF.launch(n-1,true)}else if(e.shiftKey){I.selTrack=n-1;I.renderDirty=true}else padTrigger(n-1)}}
else if(!e.altKey&&!e.shiftKey&&'yuiopjkl'.includes(e.key)&&e.key.length===1){/* v0.22.0 PADS v3 — the second pad row: keys y u i o p / j k l trigger pads 9-16 (registry-validated, no collisions) */const idx='yuiopjkl'.indexOf(e.key);if(idx>=0)padTrigger(8+idx)}
else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();if(!I.p)return;let i=I.p.activeScene;const dir=e.key==='ArrowRight'?1:-1;for(let k=0;k<I.p.scenes.length;k++){i=(i+dir+I.p.scenes.length)%I.p.scenes.length;if(PERF.launch(i).ok)break}}
else if(e.key==='f')PERF.fill();
else if(e.key==='v')PERF.variation();
else if(e.key==='q'||e.key==='w'||e.key==='e'){/* v0.18.0 DJ tools — honest refusal toast via the shared performer helper */djFire(e.key==='q'?'riser':e.key==='w'?'texture':'impact')}
else if(e.key==='d')djFire('downlifter');/* v0.19.0 DJ OUT — the riser's mirror */
else if(e.key==='g'||e.key==='h'){PERF.throwFx(e.key==='g'?'echo':'muffle')}/* v0.21.0 THROW tools — arm/release with auto-release barHooks */
else if(e.key==='t')PERF.tap();/* v0.17.0 tap tempo */
else if(e.key==='['||e.key===']'){if(!I.p)return;pushHist();I.p.bpm=clamp(I.p.bpm+(e.key===']'?1:-1),40,300);after()}/* v0.17.0 live tempo ride */
else if(e.key==='x')$('bPanic').click();/* v0.17.0 panic */
else if(e.key==='c'){$('bChain').click()}/* v0.17.0 chain toggle */
else if(e.key==='s'){$('bSave').click()}/* v0.17.0 save */
else if(e.key==='b')$('bBounce').click();
else if(e.key==='r')$('bRec').click();
else if(e.key==='z'){if(e.shiftKey)$('bRedo').click();else $('bUndo').click()}
else if(e.key==='?'){toggleHelp()}
else if(e.key==='Escape')closeHelp();
});
function toggleHelp(){const o=$('helpOverlay');if(!o)return;o.style.display=o.style.display==='flex'?'none':'flex'}
function closeHelp(){const o=$('helpOverlay');if(o)o.style.display='none'}
window.__psy6ToggleHelp=toggleHelp;
}

export { renderHeader, wireHeader };
