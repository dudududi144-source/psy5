import { $, I, pushHist, after } from '../state.js';

/* Mixer strips — volume / mute / solo + sidechain (SC) ducking controls.
   SC: amount 0-100 on the strip; attack/hold/release ms in an expandable
   drawer (defaults 12/0/140). All values live on the track (t.scAmount…),
   persisted with the project; amount=0 → engine schedules zero automation
   (zero behavior change). */
function scDrawer(t){
return '<div class="scRow" style="display:none;grid-column:1/-1;border-top:1px solid var(--line);margin-top:6px;padding-top:6px;display:none;grid-template-columns:1fr 1fr 1fr;gap:6px">'
+'<label style="font-size:8px;color:var(--dim);font-family:var(--mono)">ATK ms<input class="scAtk" type="number" min="1" max="200" value="'+(t.scAttackMs!=null?t.scAttackMs:12)+'" style="width:100%"></label>'
+'<label style="font-size:8px;color:var(--dim);font-family:var(--mono)">HOLD ms<input class="scHold" type="number" min="0" max="400" value="'+(t.scHoldMs!=null?t.scHoldMs:0)+'" style="width:100%"></label>'
+'<label style="font-size:8px;color:var(--dim);font-family:var(--mono)">REL ms<input class="scRel" type="number" min="5" max="1000" value="'+(t.scReleaseMs!=null?t.scReleaseMs:140)+'" style="width:100%"></label>'
+'</div>'}

function renderMixer(){const w=$('strips');w.innerHTML='';I.p.tracks.forEach((t,i)=>{const d=document.createElement('div');d.style.cssText='background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px';
d.innerHTML='<div class="nm" style="font-size:10px">'+t.name.split(' ')[0]+'</div>'
+'<input class="vol" type="range" min="0" max="100" value="'+Math.round(Math.sqrt(t.mix.vol)*100)+'" style="width:100%;margin:6px 0">'
+'<div class="scLine" style="display:flex;align-items:center;gap:4px"><span class="mono" style="font-size:8px;color:var(--dim)">SC</span><input class="sc" type="range" min="0" max="100" value="'+(t.scAmount||0)+'" style="flex:1" title="Sidechain depth — kick ducks this bus">'
+'<span class="scV mono" style="font-size:8px;width:22px;text-align:right">'+(t.scAmount||0)+'</span>'
+'<button class="scGear" title="attack / hold / release" style="padding:0 4px;font-size:9px">⋯</button></div>'
+'<div style="display:flex;gap:4px;margin-top:4px"><button class="mute'+(t.mix.mute?' on':'')+'">M</button><button class="solo'+(t.mix.solo?' on':'')+'">S</button></div>'
+scDrawer(t);
d.querySelector('.vol').oninput=e=>{t.mix.vol=Math.pow(+e.target.value/100,2);if(I.eng)I.eng.syncMix(I.p);I.dirty=true};
d.querySelector('.mute').onclick=()=>{pushHist();t.mix.mute=!t.mix.mute;after()};
d.querySelector('.solo').onclick=()=>{pushHist();t.mix.solo=!t.mix.solo;after()};
const scIn=d.querySelector('.sc'),scV=d.querySelector('.scV');
scIn.oninput=e=>{t.scAmount=+e.target.value;scV.textContent=e.target.value;if(I.eng)I.eng.syncMix(I.p);I.dirty=true};
scIn.onchange=()=>pushHist();
d.querySelector('.scGear').onclick=()=>{const r=d.querySelector('.scRow');r.style.display=r.style.display==='none'?'grid':'none'};
d.querySelector('.scAtk').onchange=e=>{pushHist();t.scAttackMs=Math.max(1,Math.min(200,+e.target.value||12));if(I.eng)I.eng.syncMix(I.p)};
d.querySelector('.scHold').onchange=e=>{pushHist();t.scHoldMs=Math.max(0,Math.min(400,+e.target.value||0));if(I.eng)I.eng.syncMix(I.p)};
d.querySelector('.scRel').onchange=e=>{pushHist();t.scReleaseMs=Math.max(5,Math.min(1000,+e.target.value||140));if(I.eng)I.eng.syncMix(I.p)};
w.appendChild(d)})}

export { renderMixer };
