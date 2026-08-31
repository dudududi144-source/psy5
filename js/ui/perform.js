import { $, I, pushHist, after, PERF, recHit, toast } from '../state.js';
import { SCALES, M_ENERGY, M_DRIVE, M_SPACE, M_MOVE, LIMITS } from '../model.js';
import { addTrackToProject } from '../presets.js';
import { sceneAdd, sceneDuplicate, sceneClear, sceneMove, sceneRename, sceneSetColor, sceneSetBars, sceneToggleFill } from '../scenes.js';

/* ── SCENE BANK (v0.5.0) — scrollable list up to 64 scenes ──
   Existing snapshot model extended with color/bars/fill (see js/scenes.js
   for the documented schema; fields backfilled on load).
   Row controls: color dot (click cycles palette) · name (click = inline
   rename) · pattern label · bars override (feeds the arranger ADD default)
   · FILL toggle (auto-FILL at launch) · ↑ ↓ reorder · ⧉ duplicate · ✕ clear.
   Launch semantics unchanged: row click = quantized launch, alt = instant,
   shift+click = assign. Current (.active) and queued (.pending) indicators
   are the original classes. */
const SCENE_COLORS = ['#e05656', '#e0a456', '#d4c95a', '#5ad46e', '#5ac8d4', '#5a8fd4', '#a05ad4', '#d45a9e'];
function renderScenes() {
  const w = $('scenes'); w.innerHTML = ''; if (!I.p) return;
  I.p.scenes.forEach((sc, i) => {
    const b = document.createElement('div');
    b.className = 'scene' + (i === I.p.activeScene ? ' active' : '') + (I.pending === i ? ' pending' : '');
    const pn = sc.pattern != null ? (I.p.patterns[sc.pattern] ? I.p.patterns[sc.pattern].name : '?') : 'empty';
    const dotC = sc.color != null ? SCENE_COLORS[sc.color % SCENE_COLORS.length] : 'transparent';
    b.innerHTML = '<div class="scTop"><span class="dot" title="color tag (click cycles)"></span>'
      + '<span class="nm" title="click to rename">' + sc.name + '</span>'
      + '<span class="pn mono">' + pn + '</span></div>'
      + '<div class="scOps">'
      + '<input class="bars" type="number" min="1" max="64" placeholder="—" value="' + (sc.bars != null ? sc.bars : '') + '" title="bars override — pre-fills the arranger section length">'
      + '<button class="sfill' + (sc.fill ? ' on' : '') + '" title="auto-FILL at launch">F</button>'
      + '<button class="sup" title="move up"' + (i === 0 ? ' disabled' : '') + '>↑</button>'
      + '<button class="sdn" title="move down"' + (i === I.p.scenes.length - 1 ? ' disabled' : '') + '>↓</button>'
      + '<button class="sdup" title="duplicate">⧉</button>'
      + '<button class="sclr" title="clear (empty slot)">✕</button>'
      + '</div>';
    const dot = b.querySelector('.dot');
    if (sc.color != null) dot.style.background = dotC;
    dot.onclick = e => { e.stopPropagation(); pushHist(); const next = sc.color == null ? 0 : (sc.color + 1 > 7 ? null : sc.color + 1); sceneSetColor(I.p, i, next); I.renderDirty = true; };
    const nm = b.querySelector('.nm');
    nm.onclick = e => {
      e.stopPropagation();
      const inp = document.createElement('input'); inp.className = 'rename'; inp.maxLength = 24; inp.value = sc.name;
      nm.replaceWith(inp); inp.focus(); inp.select();
      const commit = () => { pushHist(); sceneRename(I.p, i, inp.value); I.renderDirty = true };
      inp.onblur = commit;
      inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.value = sc.name; inp.blur() } };
      inp.onpointerdown = ev => ev.stopPropagation();
    };
    b.querySelector('.bars').onpointerdown = e => e.stopPropagation();
    b.querySelector('.bars').onchange = function () { pushHist(); sceneSetBars(I.p, i, this.value === '' ? null : +this.value); I.renderDirty = true };
    b.querySelector('.sfill').onclick = e => { e.stopPropagation(); pushHist(); sceneToggleFill(I.p, i); I.renderDirty = true };
    b.querySelector('.sup').onclick = e => { e.stopPropagation(); pushHist(); sceneMove(I.p, i, -1); I.renderDirty = true };
    b.querySelector('.sdn').onclick = e => { e.stopPropagation(); pushHist(); sceneMove(I.p, i, +1); I.renderDirty = true };
    b.querySelector('.sdup').onclick = e => { e.stopPropagation(); pushHist(); const r = sceneDuplicate(I.p, i); if (r < 0) toast('Scene bank full (' + LIMITS.MAX_SCENES + ')'); I.renderDirty = true };
    b.querySelector('.sclr').onclick = e => { e.stopPropagation(); pushHist(); sceneClear(I.p, i); I.renderDirty = true };
    b.onclick = e => { if (e.shiftKey) PERF.assign(i); else PERF.launch(i, e.altKey) };
    w.appendChild(b);
  });
  if (I.p.scenes.length < LIMITS.MAX_SCENES) {
    const add = document.createElement('button'); add.className = 'scene scAdd'; add.textContent = '+ SCENE';
    add.title = 'Add an empty scene (up to ' + LIMITS.MAX_SCENES + ')';
    add.onclick = () => { pushHist(); sceneAdd(I.p); I.renderDirty = true };
    w.appendChild(add);
  }
}
function renderPads(){const pm=$('padModes');if(!pm.children.length)['DRUM','SCALE','CHORD'].forEach(m=>{const b=document.createElement('button');b.textContent=m;b.onclick=()=>{I.padMode=m;renderPads()};pm.appendChild(b)});[...pm.children].forEach(b=>b.classList.toggle('on',b.textContent===I.padMode));const g=$('pads');if(!g.children.length)for(let i=0;i<16;i++){const b=document.createElement('button');b.className='pad';b.addEventListener('pointerdown',e=>{e.preventDefault();padHit(i);b.classList.add('hit');setTimeout(()=>b.classList.remove('hit'),110)});g.appendChild(b)}[...g.children].forEach((b,i)=>{if(I.padMode==='DRUM'){const t=I.p.tracks[i%I.p.tracks.length];b.innerHTML='<span class="lb">'+(t?t.name.split(' ')[0]:'—')+'</span><span class="tg2">'+(t?t.kind:'')+'</span>'}else{b.innerHTML='<span class="lb">'+['I','II','III','IV','V','VI','VII','VIII'][i%8]+'</span><span class="tg2">'+(I.padMode==='CHORD'?'chord':'note')+'</span>'}})}
function padHit(i){const vel=(+$('padVel').value)/100;if(I.padMode==='DRUM'){const t=i%I.p.tracks.length;const tr=I.p.tracks[t];if(tr&&tr.kind==='drum'&&I.eng){I.eng.trigger(tr,I.ctx.currentTime,{vel,note:48,lock:{}},0);recHit(t,null,vel)}}else{const sc=SCALES[I.p.scale]||SCALES.minor;const deg=i;const idx=deg%sc.length,oct=Math.floor(deg/sc.length);const note=I.p.root+24+sc[idx]+12*oct;let ti=I.p.selTrack;if(I.p.tracks[ti].kind==='drum')ti=4;const tr=I.p.tracks[ti];if(I.padMode==='CHORD'){[0,2,4].forEach((k,j)=>{const dd=(idx+k)%sc.length,oo=Math.floor((idx+k)/sc.length);const n=I.p.root+24+sc[dd]+12*(oct+oo);I.eng.trigger(tr,I.ctx.currentTime,{vel:j===0?vel:vel*.75,note:n,lock:{}},0)});recHit(ti,note,vel)}else{I.eng.trigger(tr,I.ctx.currentTime,{vel,note,lock:{}},0);recHit(ti,note,vel)}}}
function renderTracks(){const w=$('tracks');w.innerHTML='';I.p.tracks.forEach((t,i)=>{const d=document.createElement('div');d.className='trk'+(i===I.selTrack?' sel':'');d.innerHTML='<span class="nm">'+t.name.split(' ')[0]+'</span><span class="ps">'+(t.presetId||'—')+'</span><div class="ms"><button class="mute'+(t.mix.mute?' on':'')+'">M</button><button class="solo'+(t.mix.solo?' on':'')+'">S</button></div><input type="range" min="0" max="100" value="'+Math.round(Math.sqrt(t.mix.vol)*100)+'" style="width:70px">';d.querySelector('.mute').onclick=e=>{e.stopPropagation();pushHist();t.mix.mute=!t.mix.mute;after()};d.querySelector('.solo').onclick=e=>{e.stopPropagation();pushHist();t.mix.solo=!t.mix.solo;after()};const rg=d.querySelector('input');rg.onclick=e=>e.stopPropagation();rg.oninput=e=>{t.mix.vol=Math.pow(+e.target.value/100,2);if(I.eng)I.eng.syncMix(I.p);I.dirty=true};d.onclick=()=>{I.selTrack=i;I.renderDirty=true};w.appendChild(d)});/* +TRACK (UNLIMIT v0.5.0): explicit growth action, capped at LIMITS.MAX_TRACKS */if(I.p.tracks.length<LIMITS.MAX_TRACKS){const add=document.createElement('button');add.className='trkAdd';add.textContent='+ TRACK';add.title='Add a track (up to '+LIMITS.MAX_TRACKS+') — starts with the neutral Init Synth';add.onclick=()=>{pushHist();const t=addTrackToProject(I.p);if(t<0){toast('Track limit reached ('+LIMITS.MAX_TRACKS+')');return}I.selTrack=t;after();toast('TRACK '+(t+1)+' added')};w.appendChild(add)}}
function renderLayers(){const w=$('layers');w.innerHTML='';[['drums','DRUMS'],['bass','BASS'],['music','MUSIC'],['fx','FX DELAY']].forEach(([k,lb])=>{const b=document.createElement('button');b.textContent=lb;b.style.padding='12px';const muted=k==='drums'?I.p.tracks.slice(0,4).every(t=>t.mix.mute):k==='bass'?I.p.tracks[4].mix.mute:k==='music'?I.p.tracks.slice(5).every(t=>t.mix.mute):I.p.tracks[4].mix.sendA===0;b.classList.toggle('on',muted);b.onclick=()=>PERF.toggleLayer(k);w.appendChild(b)})}
function renderMacros(){const w=$('macros');w.innerHTML='';[['ENERGY',M_ENERGY],['DRIVE',M_DRIVE],['SPACE',M_SPACE],['MOVEMENT',M_MOVE]].forEach(([nm,idx])=>{const d=document.createElement('div');d.className='macro';d.innerHTML='<span class="mn">'+nm+'</span><input type="range" min="0" max="100" value="'+Math.round(I.p.macroVals[idx]*100)+'">';d.querySelector('input').oninput=e=>PERF.macro(idx,+e.target.value/100);w.appendChild(d)})}

function wirePerform(){$('bFill').onclick=()=>PERF.fill();$('bVar').onclick=()=>PERF.variation();}

export { renderScenes, renderPads, renderTracks, renderLayers, renderMacros, wirePerform };
