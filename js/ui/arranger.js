/* SECTION ARRANGER UI — Perform-tab panel: [scene,bars] list, ON/OFF toggle,
 * upcoming-section indicator. Logic lives in js/arranger.js. */
import { $, I } from '../state.js';
import { arrState, arrToggle, arrAddStep, arrRemoveStep, arrSetStep, arrMoveStep, arrInsertStep, arrSongInfo, arrBarHook, arrInstrument, arrView } from '../arranger.js';
import { toast } from '../state.js';

function sceneLabel(i) {
  const p = I.p;
  const sc = p && p.scenes[i];
  if (!sc) return '—';
  const pn = sc.pattern != null && p.patterns[sc.pattern] ? p.patterns[sc.pattern].name : 'empty';
  return (sc.name || ('SCENE ' + (i + 1))) + '·' + pn;
}

const SCENE_COLORS = ['#e05656', '#e0a456', '#d4c95a', '#5ad46e', '#5ac8d4', '#5a8fd4', '#a05ad4', '#d45a9e']; /* same palette as the scene bank (ui/perform.js) */
let selStep = -1; /* selected timeline block */
const mmss = s => { const m = Math.floor(s / 60), ss = Math.round(s % 60); return m + ':' + (ss < 10 ? '0' : '') + ss; };

function renderArranger() {
  const body = $('arrBody');
  if (!body || !I.p) return;
  const v = arrView();
  const tb = $('bArr');
  if (tb) { tb.textContent = v.on ? 'ARRANGER ON' : 'ARRANGER OFF'; tb.classList.toggle('on', v.on); }
  let html = '';
  if (!v.steps.length) html += '<div class="note">No sections yet — ADD builds the [scene, bars] chain.</div>';
  /* ── SONG TIMELINE (Run 9): one block per [scene,bars], width ∝ bars ── */
  if (v.steps.length) {
    const info = arrSongInfo();
    html += '<div id="arrTimeline" style="display:flex;flex-wrap:wrap;gap:2px;margin:6px 0;align-items:flex-end">';
    v.steps.forEach((st, i) => {
      const sc = I.p.scenes[st.scene] || {};
      const col = sc.color != null ? SCENE_COLORS[sc.color % SCENE_COLORS.length] : '#5a5a6e';
      const now = v.on && v.idx === i;
      html += '<div class="tlBlock" data-i="' + i + '" title="' + sceneLabel(st.scene) + ' · ' + st.bars + ' bars' + (now ? ' · NOW' : '') + '"'
        + ' style="height:' + (14 + Math.min(22, st.bars * 2)) + 'px;width:' + Math.max(12, st.bars * 7) + 'px;background:' + col
        + ';opacity:' + (now ? '1' : '.72') + ';border:' + (i === selStep ? '2px solid var(--acc,#4fd6c0)' : '1px solid #0008')
        + ';border-radius:3px;cursor:pointer;position:relative;min-width:12px;min-height:14px">'
        + '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:8px;color:#000c;font-weight:700">' + st.bars + '</span></div>';
    });
    html += '</div>';
    html += '<div class="mono" style="font-size:9px;color:var(--dim);margin:2px 0 4px">SONG: ' + info.sections + ' sections · ' + info.bars + ' bars · ' + mmss(info.music) + ' music / ' + mmss(info.withTail) + ' with tail @ ' + info.bpm + ' BPM</div>';
    /* selected-block editor: bars ±, reorder ◀▶, insert-from-scene, delete */
    if (selStep >= 0 && selStep < v.steps.length) {
      const st = v.steps[selStep];
      html += '<div style="display:flex;gap:6px;align-items:center;margin:4px 0;flex-wrap:wrap">'
        + '<span class="mono" style="font-size:9px;color:var(--acc,#4fd6c0)">#' + (selStep + 1) + ' ' + sceneLabel(st.scene) + '</span>'
        + '<button class="tlBars" data-d="-1" title="one bar less">bars −</button><span class="mono" style="font-size:10px">' + st.bars + '</span><button class="tlBars" data-d="1" title="one bar more">bars +</button>'
        + '<button class="tlMove" data-d="-1" title="move earlier">◀</button><button class="tlMove" data-d="1" title="move later">▶</button>'
        + '<select class="tlIns" style="max-width:120px">' + I.p.scenes.map((sc, si) => '<option value="' + si + '">' + sceneLabel(si) + '</option>').join('') + '</select>'
        + '<button class="tlInsGo" title="insert the chosen scene after this block">+ INSERT</button>'
        + '<button class="tlDel" title="delete this section">DELETE</button></div>';
    }
  }
  v.steps.forEach((st, i) => {
    html += '<div style="display:flex;gap:4px;align-items:center;margin:3px 0">'
      + '<span class="mono" style="font-size:9px;width:18px;color:' + (v.on && v.idx === i ? 'var(--acc,#4fd6c0)' : 'var(--dim)') + '">' + (i + 1) + '</span>'
      + '<select data-i="' + i + '" class="arrScene" style="max-width:130px">'
      + I.p.scenes.map((sc, si) => '<option value="' + si + '"' + (si === st.scene ? ' selected' : '') + '>' + sceneLabel(si) + '</option>').join('')
      + '</select>'
      + '<input type="number" class="arrBars" data-i="' + i + '" min="1" max="64" value="' + st.bars + '" style="width:44px" title="bars">'
      + '<button class="arrDel" data-i="' + i + '" title="remove">✕</button>'
      + (v.on && v.idx === i ? '<span class="tag">now</span>' : (v.on && v.idx === (i - 1 + v.steps.length) % v.steps.length ? '<span class="tag">next in ' + v.nextIn + '</span>' : ''))
      + '</div>';
  });
  html += '<div style="display:flex;gap:6px;margin-top:5px;align-items:center"><button id="arrAdd">+ ADD SECTION</button>'
    + (v.on ? '<span class="mono" style="font-size:9px;color:var(--dim)">bar ' + v.barsIn + '/' + (v.steps[v.idx] ? v.steps[v.idx].bars : '—') + (v.playing ? '' : ' · paused') + '</span>' : '')
    + '</div>';
  body.innerHTML = html;
  body.querySelectorAll('.arrScene').forEach((sel) => { sel.onchange = function () { arrSetStep(+this.dataset.i, { scene: +this.value }); }; });
  body.querySelectorAll('.arrBars').forEach((inp) => { inp.onchange = function () { arrSetStep(+this.dataset.i, { bars: +this.value }); }; });
  body.querySelectorAll('.arrDel').forEach((b) => { b.onclick = function () { arrRemoveStep(+this.dataset.i); }; });
  const add = body.querySelector('#arrAdd');
  if (add) add.onclick = function () { arrAddStep(I.p.activeScene, 0); }; /* 0 = use the scene's bars override, else 4 */
  /* timeline wiring */
  body.querySelectorAll('.tlBlock').forEach(b => { b.onclick = function () { selStep = +this.dataset.i; renderArranger(); }; });
  body.querySelectorAll('.tlBars').forEach(b => { b.onclick = function () { const i = selStep; if (i < 0) return; arrSetStep(i, { bars: arrState().steps[i].bars + (+this.dataset.d) }); }; });
  body.querySelectorAll('.tlMove').forEach(b => { b.onclick = function () { const i = selStep, d = +this.dataset.d; const r = arrMoveStep(i, d); if (r && r.ok) selStep = Math.max(0, Math.min(arrState().steps.length - 1, i + d)); }; });
  const insGo = body.querySelector('.tlInsGo');
  if (insGo) insGo.onclick = function () { const sel = body.querySelector('.tlIns'); arrInsertStep(selStep + 1, sel ? +sel.value : 0, 0); selStep = selStep + 1; };
  const del = body.querySelector('.tlDel');
  if (del) del.onclick = function () { arrRemoveStep(selStep); selStep = -1; };
}

function wireArranger() {
  arrInstrument();
  I.barHooks.push(arrBarHook);
  I.arrangerRender = renderArranger;
  const tb = $('bArr');
  if (tb) tb.onclick = function () { arrToggle(!arrState().on); };
  /* PLAY SONG (Run 9): restart the chain at section 0, quantized start when
     already playing; boots the transport when stopped. Reuses arrToggle's
     launch path + the existing bPlay handler — zero new engine behavior. */
  const ps = $('bPlaySong');
  if (ps) ps.onclick = function () {
    if (!I.p) return;
    if (!arrState().steps.length) { toast('PLAY SONG: arranger is empty — ADD sections first'); return; }
    selStep = -1;
    arrToggle(true);
    if (!['PLAYING', 'RECORDING', 'TRANSITIONING'].includes(I.fsm)) { const b = $('bPlay'); if (b) b.click(); }
  };
  renderArranger();
}

export { wireArranger, renderArranger };
