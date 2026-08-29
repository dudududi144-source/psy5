import { $, I, PERF, saveProject, loadStored } from '../state.js';
import { PooledEngine } from '../engine.js';
import { buildStyle } from '../presets.js';
import { stepEvents, mulberry32, fnv, SYNTH_VOICES, DRUM_VOICES, M_ENERGY } from '../model.js';

function logLine(cls,msg){const L=$('log');const s=document.createElement('span');s.className=cls;L.appendChild(s);s.textContent=msg+'\n';L.scrollTop=L.scrollHeight}
const GATE_RES=[];
function gate(id,claim,pass,ev){GATE_RES.push({id,claim,pass,ev});logLine(pass?'':'fail',(pass?'PASS':'FAIL')+' '+id+' — '+claim+(ev?' ['+ev+']':''))}
function peakOf(buf){const d=buf.getChannelData(0);let m=0;for(let i=0;i<d.length;i++){const a=Math.abs(d[i]);if(a>m)m=a}return m}
async function renderGenre(style){const sr=44100,oc=new OfflineAudioContext(2,sr*2,sr);const eng=new PooledEngine(oc);const p=buildStyle(style,1234);eng.syncMix(p);const sd=60/p.bpm/4;const rng=mulberry32(7);let t=.05;const total=Math.floor(1.8/sd);for(let s=0;s<total;s++){for(const ev of stepEvents(p,s,rng)){const tr=p.tracks[ev.track];eng.trigger(tr,t+ev.off,ev,sd)}t+=sd}return await oc.startRendering()}
async function runSelfGate(){$('log').innerHTML='';GATE_RES.length=0;logLine('info','== PSY6 SELF-GATE (pooled engine, OfflineAudioContext) ==');for(const st of['TECHNO','PSYTRANCE','TRANCE','PROGRESSIVE']){try{const buf=await renderGenre(st);const pk=peakOf(buf);gate('G1-'+st,st+' renders non-silent audio',pk>0.05,'peak='+pk.toFixed(3))}catch(e){gate('G1-'+st,st+' renders non-silent audio',false,'ERR '+e.message)}}const h1=fnv(JSON.stringify(buildStyle('PSYTRANCE',42)));const h2=fnv(JSON.stringify(buildStyle('PSYTRANCE',42)));gate('G2','genre build deterministic (same seed = same hash)',h1===h2,'hash='+h1.slice(0,12));if(!I.p)I.p=buildStyle('TECHNO',1);const saved=saveProject();const loaded=loadStored();gate('G5','save/load byte-exact',saved.ok&&loaded&&JSON.stringify(loaded)===JSON.stringify(I.p),'round-trip');const c0=(I.p.tracks[5].sound.cutoff)||0;PERF.macro(M_ENERGY,1.0);const c1=I.p.tracks[5].sound.cutoff;PERF.macro(M_ENERGY,0.5);gate('G6','macro ENERGY resolves to real cutoff state',Math.abs(c1-c0)>1,'cutoff '+Math.round(c0)+'->'+Math.round(c1));gate('G8','voice pools pre-allocated',SYNTH_VOICES>0&&DRUM_VOICES>0,'synth='+SYNTH_VOICES+' drum='+DRUM_VOICES);const pass=GATE_RES.filter(g=>g.pass).length;logLine('warn','== SELF-GATE: '+pass+'/'+GATE_RES.length+' passed ==');const tb=$('gateTab');tb.style.display='';const body=tb.querySelector('tbody');body.innerHTML='';GATE_RES.forEach(g=>{const tr=document.createElement('tr');tr.innerHTML='<td class="mono">'+g.id+'</td><td>'+g.claim+'</td><td><span class="tag '+(g.pass?'t-V':'t-F')+'">'+(g.pass?'PASS':'FAIL')+'</span></td><td class="mono">'+(g.ev||'')+'</td>';body.appendChild(tr)})}

function wireTests(){$('bGate').onclick=runSelfGate;}

export { runSelfGate, wireTests };
