import { $, I, pushHist, after } from '../state.js';

function renderMixer(){const w=$('strips');w.innerHTML='';I.p.tracks.forEach((t,i)=>{const d=document.createElement('div');d.style.cssText='background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px';d.innerHTML='<div class="nm" style="font-size:10px">'+t.name.split(' ')[0]+'</div><input type="range" min="0" max="100" value="'+Math.round(Math.sqrt(t.mix.vol)*100)+'" style="width:100%;margin:6px 0"><div style="display:flex;gap:4px"><button class="mute'+(t.mix.mute?' on':'')+'">M</button><button class="solo'+(t.mix.solo?' on':'')+'">S</button></div>';d.querySelector('input').oninput=e=>{t.mix.vol=Math.pow(+e.target.value/100,2);if(I.eng)I.eng.syncMix(I.p);I.dirty=true};d.querySelector('.mute').onclick=()=>{pushHist();t.mix.mute=!t.mix.mute;after()};d.querySelector('.solo').onclick=()=>{pushHist();t.mix.solo=!t.mix.solo;after()};w.appendChild(d)})}

export { renderMixer };
