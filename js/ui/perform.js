import { $, I, pushHist, after, PERF, recHit, toast } from '../state.js';
import { M_ENERGY, M_DRIVE, M_SPACE, M_MOVE, M_FILTER, M_TIGHT, M_HAUNT, M_FAZE, FILL_NAMES, LIMITS, PAD_GRID, padKit, padGlyph } from '../model.js';
import { addTrackToProject } from '../presets.js';
import { sceneAdd, sceneDuplicate, sceneClear, sceneMove, sceneRename, sceneSetColor, sceneSetBars, sceneToggleFill, sceneSetFollow, sceneSetTrans, sceneSetMix, captureSceneMix, FOLLOW_MODES } from '../scenes.js';

/* ── SCENE BANK (v0.5.0) — scrollable list up to 64 scenes ──
   Existing snapshot model extended with color/bars/fill (see js/scenes.js
   for the documented schema; fields backfilled on load).
   Row controls: color dot (click cycles palette) · name (click = inline
   rename) · pattern label · bars override (feeds the arranger ADD default)
   · FILL toggle (auto-FILL at launch) · MIX→SCENE (capture the current
   mixer state into the scene, v0.8.0) · ×MIX (clear the snapshot) · ↑ ↓
   reorder · ⧉ duplicate · ✕ clear. Scenes carrying a snapshot show a MIX
   badge. Launch semantics unchanged: row click = quantized launch, alt =
   instant, shift+click = assign. Current (.active) and queued (.pending)
   indicators are the original classes. */
const SCENE_COLORS = ['#e05656', '#e0a456', '#d4c95a', '#5ad46e', '#5ac8d4', '#5a8fd4', '#a05ad4', '#d45a9e'];
/* v0.16.1 PERF — signature-cached scene bank. Every renderAll used to wipe
   and rebuild ALL scene cards (innerHTML × ~45 nodes × up to 64 scenes) even
   when nothing here changed — pure GC/layout churn on top of the scheduler
   storm. Now a cheap content signature gates the rebuild; unchanged content
   only refreshes the .active/.pending classes. */
let sceneSig = '';
function renderScenes() {
  const w = $('scenes'); if (!I.p) { w.innerHTML = ''; sceneSig = ''; return; }
  const sig = I.p.scenes.map(sc => (sc.name + '~' + sc.pattern + '~' + sc.bars + '~' + (sc.fill ? 1 : 0) + '~' + sc.color + '~' + (sc.mix ? 1 : 0) + '~' + (sc.trans ? JSON.stringify(sc.trans) : 0) + '~' + (sc.follow ? JSON.stringify(sc.follow) : 0))).join('|')
    + '#' + I.p.scenes.length + '#' + Object.keys(I.p.patterns || {}).map(k => I.p.patterns[k].name).join(',') + '#' + w.children.length;
  if (sig === sceneSig) {
    [...w.children].forEach((b, i) => { b.classList.toggle('active', i === I.p.activeScene); b.classList.toggle('pending', I.pending === i); });
    return;
  }
  sceneSig = sig;
  w.innerHTML = '';
  I.p.scenes.forEach((sc, i) => {
    const b = document.createElement('div');
    b.className = 'scene' + (i === I.p.activeScene ? ' active' : '') + (I.pending === i ? ' pending' : '');
    const pn = sc.pattern != null ? (I.p.patterns[sc.pattern] ? I.p.patterns[sc.pattern].name : '?') : 'empty';
    const dotC = sc.color != null ? SCENE_COLORS[sc.color % SCENE_COLORS.length] : 'transparent';
    b.innerHTML = '<div class="scTop"><span class="dot" title="color tag (click cycles)"></span>'
      + '<span class="nm" title="click to rename">' + sc.name + '</span>'
      + (sc.mix ? '<span class="mixtag" title="carries a mix snapshot — applied at every launch">MIX</span>' : '')
      + (sc.trans ? '<span class="mixtag" title="carries a TRANSITION config — riser/revcym/impact/cut fire INTO the next section">T</span>' : '')
      + '<span class="pn mono">' + pn + '</span></div>'
      + '<div class="scOps">'
      + '<input class="bars" type="number" min="1" max="64" placeholder="—" value="' + (sc.bars != null ? sc.bars : '') + '" title="bars override — pre-fills the arranger section length">'
      + '<button class="sfill' + (sc.fill ? ' on' : '') + '" title="auto-FILL at launch">F</button>'
      + '<button class="smix" title="MIX→SCENE — write the CURRENT mixer state into this scene (snapshot applies at every launch)">M→S</button>'
      + '<button class="smixclr" title="clear the mix snapshot (scene plays the live mixer only)"' + (sc.mix ? '' : ' disabled') + '>×M</button>'
      + '<button class="sup" title="move up"' + (i === 0 ? ' disabled' : '') + '>↑</button>'
      + '<button class="sdn" title="move down"' + (i === I.p.scenes.length - 1 ? ' disabled' : '') + '>↓</button>'
      + '<button class="sdup" title="duplicate">⧉</button>'
      + '<button class="sclr" title="clear (empty slot)">✕</button>'
      + '</div>'
      + '<div class="scFollow" title="FOLLOW ACTION — chain mode only. PLAY SONG always follows the arranger and ignores this. prob < 100 misses fall back to next. Random picks are seeded (replayable). afterBars overrides the section length in bars.">'
      + '<select class="fmode" title="follow action (chain mode only)">' + FOLLOW_MODES.map(m => '<option value="' + m + '"' + (sc.follow && sc.follow.mode === m ? ' selected' : '') + '>' + (m === 'none' ? 'follow: —' : m) + '</option>').join('') + '</select>'
      + '<select class="ftarget" style="display:' + (sc.follow && sc.follow.mode === 'scene' ? 'inline-block' : 'none') + '">'
      + I.p.scenes.map((x, j) => '<option value="' + j + '"' + (sc.follow && sc.follow.target === j ? ' selected' : '') + '>→ ' + x.name + '</option>').join('')
      + '</select>'
      + '<input class="fprob" type="number" min="0" max="100" placeholder="prob" value="' + (sc.follow && sc.follow.prob != null ? sc.follow.prob : 100) + '" title="probability % — a miss falls back to next">'
      + '<input class="fbars" type="number" min="1" max="64" placeholder="bars" value="' + (sc.follow && sc.follow.afterBars != null ? sc.follow.afterBars : '') + '" title="afterBars — overrides the section length in bars">'
      + '</div>'
      /* v0.16.0 TRANSITIONS — elements INTO the NEXT section (arranger/chain/follow give the scheduler lookahead; manual quantized launches land impact-only) + xfade (THIS scene's own mix-snapshot glide at launch) */
      + '<div class="scTrans" title="TRANSITIONS — fire INTO the next section: R riser (cycles off/1bar/2bar), REV reverse-cymbal swell (last bar), IMP impact on the boundary, CUT bass vacuum (last 2 steps). xfade = glide span of THIS scene\u2019s mix snapshot at launch. Needs a lookahead source (arranger/chain/follow) for R/REV/CUT; IMP + xfade always work.">'
      + '<button class="tris' + (sc.trans && sc.trans.riser ? ' on' : '') + '" title="riser INTO the next section — click cycles off / 1 bar / 2 bars (stacked)">R' + (sc.trans && sc.trans.riser ? '\u00d7' + sc.trans.riser : '') + '</button>'
      + '<button class="trev' + (sc.trans && sc.trans.revcym ? ' on' : '') + '" title="reverse-cymbal swell across the last bar INTO the next section">REV</button>'
      + '<button class="timp' + (sc.trans && sc.trans.impact ? ' on' : '') + '" title="impact exactly on the boundary">IMP</button>'
      + '<button class="tcut' + (sc.trans && sc.trans.cut ? ' on' : '') + '" title="bass vacuum — the last 2 steps before the boundary are silent">CUT</button>'
      + '<select class="txf" title="xfade — glide span (beats) of THIS scene\u2019s mix snapshot when IT launches (needs a mix snapshot: M\u2192S)">'
      + [0, 1, 2, 4, 8].map(x => '<option value="' + x + '"' + ((sc.trans && sc.trans.xfade || 0) === x ? ' selected' : '') + '>' + (x ? 'xf' + x + 'b' : 'xf\u2014') + '</option>').join('')
      + '</select>'
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
    /* v0.8.0 mix snapshot row ops — capture/clear through the same validation the loader uses */
    b.querySelector('.smix').onclick = e => { e.stopPropagation(); pushHist(); sceneSetMix(I.p, i, captureSceneMix(I.p)); toast('MIX → ' + sc.name + ' captured (applies at launch)'); I.renderDirty = true };
    b.querySelector('.smixclr').onclick = e => { e.stopPropagation(); pushHist(); sceneSetMix(I.p, i, null); toast('MIX snapshot cleared — ' + sc.name); I.renderDirty = true };
    b.querySelector('.sup').onclick = e => { e.stopPropagation(); pushHist(); sceneMove(I.p, i, -1); I.renderDirty = true };
    b.querySelector('.sdn').onclick = e => { e.stopPropagation(); pushHist(); sceneMove(I.p, i, +1); I.renderDirty = true };
    b.querySelector('.sdup').onclick = e => { e.stopPropagation(); pushHist(); const r = sceneDuplicate(I.p, i); if (r < 0) toast('Scene bank full (' + LIMITS.MAX_SCENES + ')'); I.renderDirty = true };
    b.querySelector('.sclr').onclick = e => { e.stopPropagation(); pushHist(); sceneClear(I.p, i); I.renderDirty = true };
    /* follow-action row (v0.7.0) — chain mode only, seeded + replayable */
    const fwRead = () => ({
      mode: b.querySelector('.fmode').value,
      target: +b.querySelector('.ftarget').value,
      prob: b.querySelector('.fprob').value === '' ? 100 : +b.querySelector('.fprob').value,
      afterBars: b.querySelector('.fbars').value === '' ? null : +b.querySelector('.fbars').value,
    });
    const fwBox = b.querySelector('.scFollow');
    fwBox.querySelectorAll('select,input').forEach(el => { el.onpointerdown = e => e.stopPropagation(); el.onclick = e => e.stopPropagation() });
    b.querySelector('.fmode').onchange = function () { pushHist(); b.querySelector('.ftarget').style.display = this.value === 'scene' ? 'inline-block' : 'none'; sceneSetFollow(I.p, i, fwRead()); I.renderDirty = true };
    b.querySelector('.ftarget').onchange = function () { pushHist(); sceneSetFollow(I.p, i, fwRead()); I.renderDirty = true };
    b.querySelector('.fprob').onchange = function () { pushHist(); sceneSetFollow(I.p, i, fwRead()); I.renderDirty = true };
    b.querySelector('.fbars').onchange = function () { pushHist(); sceneSetFollow(I.p, i, fwRead()); I.renderDirty = true };
    /* v0.16.0 TRANS row — every control reads the CURRENT config and writes
       the whole normalized payload through sceneSetTrans (one primitive, the
       same validation the loader/scheduler/renderer see) */
    const tRead = () => sc.trans || {};
    const tWrite = t => { pushHist(); sceneSetTrans(I.p, i, t); I.renderDirty = true };
    const tBox = b.querySelector('.scTrans');
    tBox.querySelectorAll('button,select').forEach(el => { el.onpointerdown = e => e.stopPropagation(); el.onclick = e => e.stopPropagation(); el.onchange = function (e) { e.stopPropagation() } });
    b.querySelector('.tris').onclick = e => { e.stopPropagation(); const t = tRead(); t.riser = ((t.riser || 0) + 1) % 3; tWrite(t) };
    b.querySelector('.trev').onclick = e => { e.stopPropagation(); const t = tRead(); t.revcym = t.revcym ? 0 : 1; tWrite(t) };
    b.querySelector('.timp').onclick = e => { e.stopPropagation(); const t = tRead(); t.impact = t.impact ? 0 : 1; tWrite(t) };
    b.querySelector('.tcut').onclick = e => { e.stopPropagation(); const t = tRead(); t.cut = t.cut ? 0 : 1; tWrite(t) };
    b.querySelector('.txf').onchange = function (e) { e.stopPropagation(); const t = tRead(); t.xfade = +this.value; tWrite(t) };
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
/* v0.22.0 PADS v3 — the LIVE GRID. The old surface was below criticism
   (owner's screenshot): 16 pads ALL reading "Trance" (name.split(' ')[0] of
   the preset name) and half of them DEAD (i%tracks.length landed on synth
   tracks; padHit refused to fire). Everything now comes from the pure
   padKit (model.js): DRUM = one pad per real drum voice + musical VARIANT
   pads (+OCT/-OCT/TIGHT/LONG/PUNCH/DARK/BRITE/SUB parameter locks — the
   same mechanism step locks use) → every pad always plays, each with a
   distinct label and an envelope GLYPH (SVG silhouette of the sound).
   SCALE/CHORD = real note names. Signature-gated like the scene bank —
   the rAF loop may call this on every dirty frame for free. */
let padSig='';
function renderPads(){
  const pm=$('padModes');
  if(!pm.children.length)['DRUM','SCALE','CHORD'].forEach(m=>{const b=document.createElement('button');b.textContent=m;b.onclick=()=>{I.padMode=m;renderPads()};pm.appendChild(b)});
  [...pm.children].forEach(b=>b.classList.toggle('on',b.textContent===I.padMode));
  const g=$('pads');
  if(!g.children.length)for(let i=0;i<PAD_GRID;i++){const b=document.createElement('button');b.className='pad';b.addEventListener('pointerdown',e=>{e.preventDefault();padHit(i);b.classList.add('hit');setTimeout(()=>b.classList.remove('hit'),110)});g.appendChild(b)}
  const map=padKit(I.p,I.padMode);I.padMap=map;
  const sig=I.padMode+'#'+I.p.scale+'#'+I.p.root+'#'+map.map(m=>m.label+'~'+(m.track!=null?m.track:'x')+'~'+(m.lock?JSON.stringify(m.lock):'')).join('|')+'#'+g.children.length;
  if(sig===padSig)return;
  padSig=sig;
  [...g.children].forEach((b,i)=>{
    const m=map[i];if(!m)return;
    if(m.mode==='empty'){b.className='pad empty';b.title='No drum voice in this set — Sound tab → drum preset → ASSIGN';b.innerHTML='<span class="lb">—</span><span class="tg2">empty</span>';return}
    if(I.padMode==='DRUM'){
      const isVar=m.mode==='variant';
      b.className='pad'+(isVar?' var':'');
      b.title=(isVar?'VARIANT — ':'')+(m.label||'')+' ('+(m.sub||'')+')'+(isVar?' · parameter lock: '+JSON.stringify(m.lock):'')+' · trigger live, records while REC is armed';
      b.innerHTML='<span class="lb">'+m.label+'</span>'
        +'<svg class="gl" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true"><polyline points="'+padGlyph(m.glyph)+'"/></svg>'
        +'<span class="tg">'+m.sub+'</span>'
        +'<span class="tg2">'+(isVar?m.mod:m.track+1)+'</span>';
    }else{
      b.className='pad';
      b.title=(I.padMode==='CHORD'?'CHORD — diatonic triad ':'NOTE — key-locked ')+m.label+' · degree '+m.sub+' · plays through the selected synth track';
      b.innerHTML='<span class="lb big">'+m.label+'</span><span class="tg2">'+m.sub+'</span>';
    }
  });
}
function padHit(i){
  const vel=(+$('padVel').value)/100;
  if(!I.eng||!I.ctx){toast('ENGINE OFFLINE — power on first');return}
  const map=(I.padMap&&I.padMap.length===PAD_GRID)?I.padMap:padKit(I.p,I.padMode);
  const m=map[i];if(!m)return;
  if(I.padMode==='DRUM'){
    if(m.mode==='empty'||m.track==null){toast('NO DRUM VOICE in this set — assign one: Sound tab → drum preset → ASSIGN');return}
    const tr=I.p.tracks[m.track];
    if(!tr||tr.kind!=='drum'){toast('STALE PAD MAP — tap again');I.padMap=null;return}
    I.eng.trigger(tr,I.ctx.currentTime,{vel,note:48,lock:m.lock?Object.assign({},m.lock):{}},0);
    recHit(m.track,null,vel);
  }else{
    let ti=I.p.selTrack;
    if(!(I.p.tracks[ti]&&I.p.tracks[ti].kind==='synth'))ti=I.p.tracks.findIndex(t=>t&&t.kind==='synth');
    if(ti<0){toast('NO SYNTH VOICE in this set — add one: + TRACK');return}
    const tr=I.p.tracks[ti];
    if(m.mode==='chord'){m.notes.forEach((n,j)=>I.eng.trigger(tr,I.ctx.currentTime,{vel:j===0?vel:vel*.75,note:n,lock:{}},0));recHit(ti,m.notes[0],vel)}
    else{I.eng.trigger(tr,I.ctx.currentTime,{vel,note:m.note,lock:{}},0);recHit(ti,m.note,vel)}
  }
}
function renderTracks(){const w=$('tracks');w.innerHTML='';I.p.tracks.forEach((t,i)=>{const d=document.createElement('div');d.className='trk'+(i===I.selTrack?' sel':'');d.innerHTML='<span class="nm">'+t.name.split(' ')[0]+'</span><span class="ps">'+(t.presetId||'—')+'</span><div class="ms"><button class="mute'+(t.mix.mute?' on':'')+'">M</button><button class="solo'+(t.mix.solo?' on':'')+'">S</button></div><input type="range" min="0" max="100" value="'+Math.round(Math.sqrt(t.mix.vol)*100)+'" style="width:70px">';d.querySelector('.mute').onclick=e=>{e.stopPropagation();pushHist();t.mix.mute=!t.mix.mute;after()};d.querySelector('.solo').onclick=e=>{e.stopPropagation();pushHist();t.mix.solo=!t.mix.solo;after()};const rg=d.querySelector('input');rg.onclick=e=>e.stopPropagation();rg.oninput=e=>{t.mix.vol=Math.pow(+e.target.value/100,2);if(I.eng)I.eng.syncMix(I.p);I.dirty=true};d.onclick=()=>{I.selTrack=i;I.renderDirty=true};w.appendChild(d)});/* +TRACK (UNLIMIT v0.5.0): explicit growth action, capped at LIMITS.MAX_TRACKS */if(I.p.tracks.length<LIMITS.MAX_TRACKS){const add=document.createElement('button');add.className='trkAdd';add.textContent='+ TRACK';add.title='Add a track (up to '+LIMITS.MAX_TRACKS+') — starts with the neutral Init Synth';add.onclick=()=>{pushHist();const t=addTrackToProject(I.p);if(t<0){toast('Track limit reached ('+LIMITS.MAX_TRACKS+')');return}I.selTrack=t;after();toast('TRACK '+(t+1)+' added')};w.appendChild(add)}}
function renderLayers(){const w=$('layers');w.innerHTML='';[['drums','DRUMS'],['bass','BASS'],['music','MUSIC'],['fx','FX DELAY']].forEach(([k,lb])=>{const b=document.createElement('button');b.textContent=lb;b.style.padding='12px';const muted=k==='drums'?I.p.tracks.slice(0,4).every(t=>t.mix.mute):k==='bass'?I.p.tracks[4].mix.mute:k==='music'?I.p.tracks.slice(5).every(t=>t.mix.mute):I.p.tracks[4].mix.sendA===0;b.classList.toggle('on',muted);b.onclick=()=>PERF.toggleLayer(k);w.appendChild(b)})}
function renderMacros(){const w=$('macros');w.innerHTML='';/* v0.17.0 — all EIGHT macros, each resolving to real engine state (see resolveMacros v2).
   Value readout updates on input; double-click resets to the neutral 0.5. */[['ENERGY',M_ENERGY,'cutoff brightness + drum/bass levels — the main dynamics grip'],['DRIVE',M_DRIVE,'insert saturation on the music bus + gentle crush on drum bodies'],['SPACE',M_SPACE,'delay + reverb send levels'],['MOVEMENT',M_MOVE,'stereo spread (pad/arp/hats/perc) + LFO depth on music synths'],['FILTER',M_FILTER,'extra tone tilt over the music bus cutoff — dark ↔ bright'],['TIGHT',M_TIGHT,'drum envelope length — loose ↔ tight'],['HAUNT',M_HAUNT,'pitch destabilizer on lead/arp — the psy alien drift'],['FAZE',M_FAZE,'LFO speed on the music bus — slow wash ↔ fast wobble']].forEach(([nm,idx,tip])=>{const d=document.createElement('div');d.className='macro';d.title=tip;d.innerHTML='<span class="mn">'+nm+'</span><input type="range" min="0" max="100" value="'+Math.round(I.p.macroVals[idx]*100)+'" aria-label="macro '+nm+'"><span class="mv mono" style="font-size:9px;color:var(--dim);min-width:34px;text-align:right">'+Math.round(I.p.macroVals[idx]*100)+'%</span>';const rg=d.querySelector('input'),lb=d.querySelector('.mv');rg.oninput=e=>{PERF.macro(idx,+e.target.value/100);lb.textContent=e.target.value+'%'};d.ondblclick=()=>{PERF.macro(idx,.5);rg.value=50;lb.textContent='50%'};w.appendChild(d)})}

/* v0.18.0 DJ TOOLS — honest-refusal toast: the set lacks a voice of that TYPE → point at the Sound tab fix */
function djFire(kind){const r=PERF.dj(kind);if(!r.ok){if(r.reason==='offline')toast('ENGINE OFFLINE — boot first');else toast((kind==='revcym'?'SWELL':kind.toUpperCase())+' — no '+kind+' voice in this set. Assign one: Sound tab → drum type '+kind+' → ASSIGN')}return r.ok}

function wirePerform(){$('bFill').onclick=()=>{const t=PERF.fillCycle();$('bFill').textContent='⚡ FILL · '+FILL_NAMES[t];PERF.fill()};$('bVar').onclick=()=>PERF.variation();const dj=(id,kind)=>{const b=$(id);if(b)b.onclick=()=>djFire(kind)};dj('bRiser','riser');dj('bSwell','revcym');dj('bImpact','impact');dj('bDown','downlifter');/* v0.21.0 THROW tools — arm/release is fully handled inside PERF.throwFx (honest toasts included) */const thr=(id,kind)=>{const b=$(id);if(b)b.onclick=()=>PERF.throwFx(kind)};thr('bThrowE','echo');thr('bThrowM','muffle');}

export { renderScenes, renderPads, renderTracks, renderLayers, renderMacros, wirePerform, padHit, djFire };
