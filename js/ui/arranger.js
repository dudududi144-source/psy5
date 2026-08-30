/* SECTION ARRANGER UI — Perform-tab panel: [scene,bars] list, ON/OFF toggle,
 * upcoming-section indicator. Logic lives in js/arranger.js. */
import { $, I } from '../state.js';
import { arrState, arrToggle, arrAddStep, arrRemoveStep, arrSetStep, arrBarHook, arrInstrument, arrView } from '../arranger.js';

function sceneLabel(i) {
  const p = I.p;
  const sc = p && p.scenes[i];
  if (!sc) return '—';
  const pn = sc.pattern != null && p.patterns[sc.pattern] ? p.patterns[sc.pattern].name : 'empty';
  return (sc.name || ('SCENE ' + (i + 1))) + '·' + pn;
}

function renderArranger() {
  const body = $('arrBody');
  if (!body || !I.p) return;
  const v = arrView();
  const tb = $('bArr');
  if (tb) { tb.textContent = v.on ? 'ARRANGER ON' : 'ARRANGER OFF'; tb.classList.toggle('on', v.on); }
  let html = '';
  if (!v.steps.length) html += '<div class="note">No sections yet — ADD builds the [scene, bars] chain.</div>';
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
  if (add) add.onclick = function () { arrAddStep(I.p.activeScene, 4); };
}

function wireArranger() {
  arrInstrument();
  I.barHooks.push(arrBarHook);
  I.arrangerRender = renderArranger;
  const tb = $('bArr');
  if (tb) tb.onclick = function () { arrToggle(!arrState().on); };
  renderArranger();
}

export { wireArranger, renderArranger };
