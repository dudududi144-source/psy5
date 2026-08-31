import { $, I, pushHist, after } from '../state.js';

/* Mixer strips — volume / mute / solo, sidechain (SC) ducking controls and
   the two per-track FX sends. Sends: DLY (mix.sendA → BPM-synced delay bus)
   and REV (mix.sendB → reverb bus), 0-100, default 0 → zero behavior change.
   The #fxBar holds the GLOBAL delay controls: division (1/8 | 3/16 | 1/4)
   and feedback (0-80%). All values live on the project and are persisted. */
function scDrawer(t){
return '<div class="scRow" style="display:none;grid-column:1/-1;border-top:1px solid var(--line);margin-top:6px;padding-top:6px;grid-template-columns:1fr 1fr 1fr;gap:6px">'
+'<label style="font-size:8px;color:var(--dim);font-family:var(--mono)">ATK ms<input class="scAtk" type="number" min="1" max="200" value="'+(t.scAttackMs!=null?t.scAttackMs:12)+'" style="width:100%"></label>'
+'<label style="font-size:8px;color:var(--dim);font-family:var(--mono)">HOLD ms<input class="scHold" type="number" min="0" max="400" value="'+(t.scHoldMs!=null?t.scHoldMs:0)+'" style="width:100%"></label>'
+'<label style="font-size:8px;color:var(--dim);font-family:var(--mono)">REL ms<input class="scRel" type="number" min="5" max="1000" value="'+(t.scReleaseMs!=null?t.scReleaseMs:140)+'" style="width:100%"></label>'
+'</div>'}

function renderFxBar(){const bar=$('fxBar');if(!bar)return;const fx=I.p.fx||{delayDiv:'3/16',delayFb:.35};
bar.innerHTML='<span class="mono" style="font-size:9px;color:var(--acc2)">DELAY BUS</span>'
+'<label style="display:flex;align-items:center;gap:4px;font-size:9px;color:var(--dim)">DIV <select id="fxDiv"><option value="1/8"'+(fx.delayDiv==='1/8'?' selected':'')+'>1/8</option><option value="3/16"'+(fx.delayDiv!=='1/8'&&fx.delayDiv!=='1/4'?' selected':'')+'>3/16</option><option value="1/4"'+(fx.delayDiv==='1/4'?' selected':'')+'>1/4</option></select></label>'
+'<label style="display:flex;align-items:center;gap:4px;font-size:9px;color:var(--dim)">FB <input id="fbF" type="range" min="0" max="80" value="'+Math.round((fx.delayFb!=null?fx.delayFb:.35)*100)+'" style="width:90px"><span class="mono" id="fbV" style="font-size:9px;width:30px">'+Math.round((fx.delayFb!=null?fx.delayFb:.35)*100)+'%</span></label>'
+'<span class="note" style="margin-left:auto">DLY/REV are post-fader sends per strip</span>';
$('fxDiv').onchange=e=>{pushHist();if(!I.p.fx)I.p.fx={delayDiv:'3/16',delayFb:.35};I.p.fx.delayDiv=e.target.value;if(I.eng)I.eng.syncMix(I.p);I.dirty=true};
$('fbF').oninput=e=>{$('fbV').textContent=e.target.value+'%'};$('fbF').onchange=e=>{pushHist();if(!I.p.fx)I.p.fx={delayDiv:'3/16',delayFb:.35};I.p.fx.delayFb=(+e.target.value)/100;if(I.eng)I.eng.syncMix(I.p);I.dirty=true}}

function renderMixer(){const w=$('strips');w.innerHTML='';renderFxBar();I.p.tracks.forEach((t,i)=>{const d=document.createElement('div');d.style.cssText='background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px';
d.innerHTML='<div class="nm" style="font-size:10px">'+t.name.split(' ')[0]+'</div>'
+'<input class="vol" type="range" min="0" max="100" value="'+Math.round(Math.sqrt(t.mix.vol)*100)+'" style="width:100%;margin:6px 0">'
+'<div class="sendLine" style="display:flex;align-items:center;gap:4px"><span class="mono" style="font-size:8px;color:var(--dim)">DLY</span><input class="sendA" type="range" min="0" max="100" value="'+Math.round((t.mix.sendA||0)*100)+'" style="flex:1" title="Delay send (post-fader)"><span class="sendAv mono" style="font-size:8px;width:20px;text-align:right">'+Math.round((t.mix.sendA||0)*100)+'</span></div>'
+'<div class="sendLine" style="display:flex;align-items:center;gap:4px"><span class="mono" style="font-size:8px;color:var(--dim)">REV</span><input class="sendB" type="range" min="0" max="100" value="'+Math.round((t.mix.sendB||0)*100)+'" style="flex:1" title="Reverb send (post-fader)"><span class="sendBv mono" style="font-size:8px;width:20px;text-align:right">'+Math.round((t.mix.sendB||0)*100)+'</span></div>'
+'<div class="scLine" style="display:flex;align-items:center;gap:4px;margin-top:2px"><span class="mono" style="font-size:8px;color:var(--dim)">SC</span><input class="sc" type="range" min="0" max="100" value="'+(t.scAmount||0)+'" style="flex:1" title="Sidechain depth — kick ducks this bus">'
+'<span class="scV mono" style="font-size:8px;width:20px;text-align:right">'+(t.scAmount||0)+'</span>'
+'<button class="scGear" title="attack / hold / release" style="padding:0 4px;font-size:9px">⋯</button></div>'
+'<div style="display:flex;gap:4px;margin-top:4px"><button class="mute'+(t.mix.mute?' on':'')+'">M</button><button class="solo'+(t.mix.solo?' on':'')+'">S</button></div>'
+scDrawer(t);
d.querySelector('.vol').oninput=e=>{t.mix.vol=Math.pow(+e.target.value/100,2);if(I.eng)I.eng.syncMix(I.p);I.dirty=true};
d.querySelector('.mute').onclick=()=>{pushHist();t.mix.mute=!t.mix.mute;after()};
d.querySelector('.solo').onclick=()=>{pushHist();t.mix.solo=!t.mix.solo;after()};
const sA=d.querySelector('.sendA'),sAv=d.querySelector('.sendAv');
sA.oninput=e=>{t.mix.sendA=(+e.target.value)/100;sAv.textContent=e.target.value;if(I.eng)I.eng.syncMix(I.p);I.dirty=true};
sA.onchange=()=>pushHist();
const sB=d.querySelector('.sendB'),sBv=d.querySelector('.sendBv');
sB.oninput=e=>{t.mix.sendB=(+e.target.value)/100;sBv.textContent=e.target.value;if(I.eng)I.eng.syncMix(I.p);I.dirty=true};
sB.onchange=()=>pushHist();
const scIn=d.querySelector('.sc'),scV=d.querySelector('.scV');
scIn.oninput=e=>{t.scAmount=+e.target.value;scV.textContent=e.target.value;if(I.eng)I.eng.syncMix(I.p);I.dirty=true};
scIn.onchange=()=>pushHist();
d.querySelector('.scGear').onclick=()=>{const r=d.querySelector('.scRow');r.style.display=r.style.display==='none'?'grid':'none'};
d.querySelector('.scAtk').onchange=e=>{pushHist();t.scAttackMs=Math.max(1,Math.min(200,+e.target.value||12));if(I.eng)I.eng.syncMix(I.p)};
d.querySelector('.scHold').onchange=e=>{pushHist();t.scHoldMs=Math.max(0,Math.min(400,+e.target.value||0));if(I.eng)I.eng.syncMix(I.p)};
d.querySelector('.scRel').onchange=e=>{pushHist();t.scReleaseMs=Math.max(5,Math.min(1000,+e.target.value||140));if(I.eng)I.eng.syncMix(I.p)};
w.appendChild(d)})}

export { renderMixer };
