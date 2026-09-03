import { $, I, pushHist, after, autoRecMove } from '../state.js';
import { ensureMaster } from '../params.js';
import { delayDivClamp } from '../../foundation/dsp/sends.mjs';

/* Mixer strips — volume / mute / solo, sidechain (SC) ducking controls and
   the two per-track FX sends. Sends: DLY (mix.sendA → BPM-synced delay bus)
   and REV (mix.sendB → reverb bus), 0-100, default 0 → zero behavior change.
   The #fxBar holds the GLOBAL delay/space controls: division (v0.13.1: six
   BPM-synced options 1/16 … 1/2), feedback (0-80%), the PING-PONG delay mode
   toggle (fx.pingPong — cross-fed L/R taps, default OFF = exact mono
   topology) and the reverb IR variant select (fx.irKind — classic/short/
   long; classic = the original IR). The #masterBar holds the v0.12.0 master
   space WIDTH control (master.widthMaster 0..2, 1.00 = neutral = network
   OUT; bass <300 Hz is protected mono). All values live on the project and
   are persisted. Knob movements call autoRecMove so armed automation lanes
   capture them. */
function scDrawer(t){
return '<div class="scRow" style="display:none;grid-column:1/-1;border-top:1px solid var(--line);margin-top:6px;padding-top:6px;grid-template-columns:1fr 1fr 1fr;gap:6px">'
+'<label style="font-size:8px;color:var(--dim);font-family:var(--mono)">ATK ms<input class="scAtk" type="number" min="1" max="200" value="'+(t.scAttackMs!=null?t.scAttackMs:12)+'" style="width:100%"></label>'
+'<label style="font-size:8px;color:var(--dim);font-family:var(--mono)">HOLD ms<input class="scHold" type="number" min="0" max="400" value="'+(t.scHoldMs!=null?t.scHoldMs:0)+'" style="width:100%"></label>'
+'<label style="font-size:8px;color:var(--dim);font-family:var(--mono)">REL ms<input class="scRel" type="number" min="5" max="1000" value="'+(t.scReleaseMs!=null?t.scReleaseMs:140)+'" style="width:100%"></label>'
+'</div>'}

function renderFxBar(){const bar=$('fxBar');if(!bar)return;const fx=I.p.fx||{delayDiv:'3/16',delayFb:.35};
const DIVS=['1/16','1/8','3/16','1/4','3/8','1/2'];const cur=delayDivClamp(fx.delayDiv);
bar.innerHTML='<span class="mono" style="font-size:9px;color:var(--acc2)">DELAY BUS</span>'
+'<label style="display:flex;align-items:center;gap:4px;font-size:9px;color:var(--dim)" title="delay time in 16th-note divisions — v0.13.1 adds 1/16, 3/8 and 1/2 (all BPM-synced)">DIV <select id="fxDiv">'+DIVS.map(d=>'<option value="'+d+'"'+(cur===d?' selected':'')+'>'+d+'</option>').join('')+'</select></label>'
+'<label style="display:flex;align-items:center;gap:4px;font-size:9px;color:var(--dim)">FB <input id="fbF" type="range" min="0" max="80" value="'+Math.round((fx.delayFb!=null?fx.delayFb:.35)*100)+'" style="width:90px"><span class="mono" id="fbV" style="font-size:9px;width:30px">'+Math.round((fx.delayFb!=null?fx.delayFb:.35)*100)+'%</span></label>'
+'<button id="fxPP" class="'+(fx.pingPong===1?'on':'')+'" title="PING-PONG delay — the feedback alternates hard L/R (cross-fed taps). Mode rewires immediately; OFF = the exact mono topology (default, legacy-neutral)" style="font-size:9px;padding:2px 6px">PP '+(fx.pingPong===1?'ON':'OFF')+'</button>'
+'<label style="display:flex;align-items:center;gap:4px;font-size:9px;color:var(--dim)" title="reverb IR variant — CLASSIC = the original ~1.8 s; SHORT = ~1.2 s bright; LONG = ~3.2 s dark (deterministic 2600 Hz tilt)">IR <select id="fxIr">'+['classic','short','long'].map(k=>'<option value="'+k+'"'+((fx.irKind||'classic')===k?' selected':'')+'>'+k.toUpperCase()+'</option>').join('')+'</select></label>'
+'<span class="note" style="margin-left:auto">DLY/REV are post-fader sends per strip</span>';
$('fxDiv').onchange=e=>{pushHist();if(!I.p.fx)I.p.fx={delayDiv:'3/16',delayFb:.35};I.p.fx.delayDiv=e.target.value;if(I.eng)I.eng.syncMix(I.p);I.dirty=true};
$('fbF').oninput=e=>{$('fbV').textContent=e.target.value+'%'};$('fbF').onchange=e=>{pushHist();if(!I.p.fx)I.p.fx={delayDiv:'3/16',delayFb:.35};I.p.fx.delayFb=(+e.target.value)/100;if(I.eng)I.eng.syncMix(I.p);I.dirty=true};
const ppB=$('fxPP');if(ppB)ppB.onclick=()=>{pushHist();if(!I.p.fx)I.p.fx={delayDiv:'3/16',delayFb:.35};I.p.fx.pingPong=I.p.fx.pingPong===1?0:1;ppB.classList.toggle('on',I.p.fx.pingPong===1);ppB.textContent='PP '+(I.p.fx.pingPong===1?'ON':'OFF');if(I.eng)I.eng.syncMix(I.p);I.dirty=true};
const irS=$('fxIr');if(irS)irS.onchange=e=>{pushHist();if(!I.p.fx)I.p.fx={delayDiv:'3/16',delayFb:.35};I.p.fx.irKind=e.target.value;if(I.eng)I.eng.syncMix(I.p);I.dirty=true}}

/* ── MASTER panel (v0.8.0): EQ3 + glue comp — the automation-ready master
   section. Every control writes through ensureMaster + autoRecMove(-1, id)
   (ARM-AUTO recordable, MIDI-learnable, lane-automatable, snapshot-able).
   GLUE toggle = compOn (bypass removes the node from the chain). ── */
function renderMasterBar(){const bar=$('masterBar');if(!bar||!I.p)return;const m=ensureMaster(I.p);
const rows=[['eqLow','LOW','−12..+12 dB low shelf @ 100 Hz',-12,12,.5],['eqMid','MID','−12..+12 dB peak @ 1 kHz (Q 0.8)',-12,12,.5],['eqHigh','HIGH','−12..+12 dB high shelf @ 8 kHz',-12,12,.5],
['compThresh','THRESH','glue comp threshold −40..0 dB (GLUE ON to hear it)',-40,0,1],['compRatio','RATIO','glue comp ratio 1..20:1',1,20,.5],['compAttack','ATK ms','glue comp attack 1..100 ms',1,100,1],['compRelease','REL ms','glue comp release 20..1000 ms',20,1000,5],['compMakeup','MAKEUP','glue comp makeup gain 0..24 dB',0,24,.5],
['widthMaster','WIDTH','master stereo width 0..200% — 1.00 = neutral (the width network is OUT of the chain, exact legacy path); bass <300 Hz is protected mono',0,2,.01]];
bar.innerHTML='<span class="mono" style="font-size:9px;color:var(--acc2)">MASTER</span>'
+'<button id="mCompOn" class="'+(m.compOn?'on':'')+'" title="glue compressor — bypass removes the node from the chain (guaranteed neutral)" style="font-size:9px;padding:2px 6px">GLUE '+(m.compOn?'ON':'OFF')+'</button>'
+rows.map(([id,lb,tt,mn,mx,st])=>'<label style="display:flex;align-items:center;gap:4px;font-size:9px;color:var(--dim)" title="'+tt+' ('+id+' — automatable)">'+lb+' <input class="mParam" data-p="'+id+'" type="range" min="'+mn+'" max="'+mx+'" step="'+st+'" value="'+m[id]+'" style="width:70px"><span class="mVal mono" data-v="'+id+'" style="font-size:8px;width:34px;text-align:right">'+m[id]+'</span></label>').join('')
+'<span class="note" style="margin-left:auto">EQ3 + glue feed the existing master bus — recordable via ARM-AUTO</span>';
bar.querySelectorAll('input.mParam').forEach(inp=>{
const pid=inp.dataset.p,val=bar.querySelector('.mVal[data-v="'+pid+'"]');
inp.oninput=()=>{const v=+inp.value;ensureMaster(I.p)[pid]=v;if(val)val.textContent=v;if(I.eng)I.eng.syncMix(I.p);I.dirty=true;autoRecMove(-1,pid,v)};
inp.onchange=()=>pushHist();
});
const cog=$('mCompOn');if(cog)cog.onclick=()=>{pushHist();const mm=ensureMaster(I.p);mm.compOn=mm.compOn?0:1;cog.classList.toggle('on',!!mm.compOn);cog.textContent='GLUE '+(mm.compOn?'ON':'OFF');if(I.eng)I.eng.syncMix(I.p);I.dirty=true;autoRecMove(-1,'compOn',mm.compOn)};
}

function renderMixer(){const w=$('strips');w.innerHTML='';renderMasterBar();renderFxBar();I.p.tracks.forEach((t,i)=>{const d=document.createElement('div');d.style.cssText='background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px';
d.innerHTML='<div class="nm" style="font-size:10px">'+t.name.split(' ')[0]+'</div>'
+'<input class="vol" type="range" min="0" max="100" value="'+Math.round(Math.sqrt(t.mix.vol)*100)+'" style="width:100%;margin:6px 0">'
+'<div class="sendLine" style="display:flex;align-items:center;gap:4px"><span class="mono" style="font-size:8px;color:var(--dim)">DLY</span><input class="sendA" type="range" min="0" max="100" value="'+Math.round((t.mix.sendA||0)*100)+'" style="flex:1" title="Delay send (post-fader)"><span class="sendAv mono" style="font-size:8px;width:20px;text-align:right">'+Math.round((t.mix.sendA||0)*100)+'</span></div>'
+'<div class="sendLine" style="display:flex;align-items:center;gap:4px"><span class="mono" style="font-size:8px;color:var(--dim)">REV</span><input class="sendB" type="range" min="0" max="100" value="'+Math.round((t.mix.sendB||0)*100)+'" style="flex:1" title="Reverb send (post-fader)"><span class="sendBv mono" style="font-size:8px;width:20px;text-align:right">'+Math.round((t.mix.sendB||0)*100)+'</span></div>'
+'<div class="scLine" style="display:flex;align-items:center;gap:4px;margin-top:2px"><span class="mono" style="font-size:8px;color:var(--dim)">SC</span><input class="sc" type="range" min="0" max="100" value="'+(t.scAmount||0)+'" style="flex:1" title="Sidechain depth — kick ducks this bus">'
+'<span class="scV mono" style="font-size:8px;width:20px;text-align:right">'+(t.scAmount||0)+'</span>'
+'<button class="scGear" title="attack / hold / release" style="padding:0 4px;font-size:9px">⋯</button></div>'
+'<div style="display:flex;gap:4px;margin-top:4px"><button class="mute'+(t.mix.mute?' on':'')+'">M</button><button class="solo'+(t.mix.solo?' on':'')+'">S</button></div>'
+scDrawer(t);
d.querySelector('.vol').oninput=e=>{t.mix.vol=Math.pow(+e.target.value/100,2);if(I.eng)I.eng.syncMix(I.p);I.dirty=true;autoRecMove(i,'mix.vol',t.mix.vol)};
d.querySelector('.mute').onclick=()=>{pushHist();t.mix.mute=!t.mix.mute;after()};
d.querySelector('.solo').onclick=()=>{pushHist();t.mix.solo=!t.mix.solo;after()};
const sA=d.querySelector('.sendA'),sAv=d.querySelector('.sendAv');
sA.oninput=e=>{t.mix.sendA=(+e.target.value)/100;sAv.textContent=e.target.value;if(I.eng)I.eng.syncMix(I.p);I.dirty=true;autoRecMove(i,'mix.sendA',t.mix.sendA)};
sA.onchange=()=>pushHist();
const sB=d.querySelector('.sendB'),sBv=d.querySelector('.sendBv');
sB.oninput=e=>{t.mix.sendB=(+e.target.value)/100;sBv.textContent=e.target.value;if(I.eng)I.eng.syncMix(I.p);I.dirty=true;autoRecMove(i,'mix.sendB',t.mix.sendB)};
sB.onchange=()=>pushHist();
const scIn=d.querySelector('.sc'),scV=d.querySelector('.scV');
scIn.oninput=e=>{t.scAmount=+e.target.value;scV.textContent=e.target.value;if(I.eng)I.eng.syncMix(I.p);I.dirty=true;autoRecMove(i,'scAmount',t.scAmount)};
scIn.onchange=()=>pushHist();
d.querySelector('.scGear').onclick=()=>{const r=d.querySelector('.scRow');r.style.display=r.style.display==='none'?'grid':'none'};
d.querySelector('.scAtk').onchange=e=>{pushHist();t.scAttackMs=Math.max(1,Math.min(200,+e.target.value||12));if(I.eng)I.eng.syncMix(I.p)};
d.querySelector('.scHold').onchange=e=>{pushHist();t.scHoldMs=Math.max(0,Math.min(400,+e.target.value||0));if(I.eng)I.eng.syncMix(I.p)};
d.querySelector('.scRel').onchange=e=>{pushHist();t.scReleaseMs=Math.max(5,Math.min(1000,+e.target.value||140));if(I.eng)I.eng.syncMix(I.p)};
w.appendChild(d)})}

export { renderMixer };
