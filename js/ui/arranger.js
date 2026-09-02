/* SECTION ARRANGER UI — Perform-tab panel: [scene,bars] list, ON/OFF toggle,
 * upcoming-section indicator. Logic lives in js/arranger.js.
 * v0.8.0 SECTION BOUNCE: click a timeline block to select it, shift+click
 * to extend a CONTIGUOUS selection; BOUNCE SECTION renders exactly that
 * arranger range through the ONE renderSong ({bounds:[startBar,endBar)}) —
 * the section as it appears in the song (phase continuity + bleed real) —
 * and downloads psy6-section-<sceneName>-<idx>.wav. */
import { $, I, toast, pushHist } from '../state.js';
import { arrState, arrToggle, arrAddStep, arrRemoveStep, arrSetStep, arrMoveStep, arrInsertStep, arrSongInfo, arrBarHook, arrInstrument, arrView } from '../arranger.js';
import { renderSong, songRenderController, sectionFrames, pcmFromBuffer, wavEncode, songDurationSec, SONG_MAX_SEC } from '../bounce.js';
import { evolutionState, evolutionStats } from '../evolution.js';

function sceneLabel(i) {
  const p = I.p;
  const sc = p && p.scenes[i];
  if (!sc) return '—';
  const pn = sc.pattern != null && p.patterns[sc.pattern] ? p.patterns[sc.pattern].name : 'empty';
  return (sc.name || ('SCENE ' + (i + 1))) + '·' + pn;
}

const SCENE_COLORS = ['#e05656', '#e0a456', '#d4c95a', '#5ad46e', '#5ac8d4', '#5a8fd4', '#a05ad4', '#d45a9e']; /* same palette as the scene bank (ui/perform.js) */
let selStep = -1; /* selected timeline block (range start) */
let selEnd = -1;  /* v0.8.0 contiguous selection end (inclusive); selEnd===selStep → single */
let selArranging = false; /* a SECTION BOUNCE render is running */
const mmss = s => { const m = Math.floor(s / 60), ss = Math.round(s % 60); return m + ':' + (ss < 10 ? '0' : '') + ss; };

function renderArranger() {
  const body = $('arrBody');
  if (!body || !I.p) return;
  const v = arrView();
  const tb = $('bArr');
  if (tb) { tb.textContent = v.on ? 'ARRANGER ON' : 'ARRANGER OFF'; tb.classList.toggle('on', v.on); }
  let html = '';
  /* v0.9.0 PER-BAR EVOLUTION strip — toggle + intensity + bar-ops evidence.
     OFF (default) renders the song byte-identical to the pre-v0.9.0 engine
     (the G32 OFF-pin contract); ON applies seeded per-bar ops through the
     same event machinery (no second scheduler). Precedence: snapshot
     launch → evolution → lane automation (lane-covered pairs win). */
  const ev = evolutionState(I.p);
  html += '<div style="display:flex;gap:6px;align-items:center;margin:2px 0 6px;flex-wrap:wrap">'
    + '<button id="bEvo"' + (ev.on ? ' class="on"' : '') + ' title="PER-BAR EVOLUTION — deterministic section morphing while the song plays. Seeded by (evolution seed, song bar); replayable. OFF renders the song byte-identical to the pre-v0.9.0 engine.">EVOLUTION ' + (ev.on ? 'ON' : 'OFF') + '</button>'
    + '<input id="evoInt" type="range" min="0" max="100" value="' + ev.intensity + '" style="width:90px" title="evolution intensity 0–100 — scales op probability and deltas (0 behaves like OFF)">'
    + '<span class="mono" style="font-size:9px;color:var(--dim)">intensity ' + ev.intensity + ' · bar-ops ' + evolutionStats().ops + '</span>'
    + '</div>';
  if (!v.steps.length) html += '<div class="note">No sections yet — ADD builds the [scene, bars] chain.</div>';
  /* ── SONG TIMELINE (Run 9): one block per [scene,bars], width ∝ bars ── */
  if (v.steps.length) {
    const info = arrSongInfo();
    /* contiguous selection range (v0.8.0) — order-normalized [lo,hi] */
    const selLo = (selStep >= 0 && selEnd >= 0) ? Math.min(selStep, selEnd) : -1;
    const selHi = (selStep >= 0 && selEnd >= 0) ? Math.max(selStep, selEnd) : -1;
    const inSel = i => i >= selLo && i <= selHi;
    /* absolute bar offset of each step start (for the bounds render) */
    let barAcc = 0; const stepStartBar = v.steps.map(st => { const b = barAcc; barAcc += st.bars; return b });
    html += '<div id="arrTimeline" style="display:flex;flex-wrap:wrap;gap:2px;margin:6px 0;align-items:flex-end">';
    v.steps.forEach((st, i) => {
      const sc = I.p.scenes[st.scene] || {};
      const col = sc.color != null ? SCENE_COLORS[sc.color % SCENE_COLORS.length] : '#5a5a6e';
      const now = v.on && v.idx === i;
      const sel = inSel(i);
      html += '<div class="tlBlock" data-i="' + i + '" title="' + sceneLabel(st.scene) + ' · ' + st.bars + ' bars' + (now ? ' · NOW' : '') + (sel ? ' · SELECTED' : ' · click = select, shift+click = extend') + '"'
        + ' style="height:' + (14 + Math.min(22, st.bars * 2)) + 'px;width:' + Math.max(12, st.bars * 7) + 'px;background:' + col
        + ';opacity:' + (now ? '1' : '.72') + ';border:' + (sel ? '2px solid var(--acc,#4fd6c0)' : (i === selStep && selEnd < 0 ? '2px solid var(--acc,#4fd6c0)' : '1px solid #0008'))
        + ';border-radius:3px;cursor:pointer;position:relative;min-width:12px;min-height:14px">'
        + '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:8px;color:#000c;font-weight:700">' + st.bars + '</span></div>';
    });
    html += '</div>';
    html += '<div class="mono" style="font-size:9px;color:var(--dim);margin:2px 0 4px">SONG: ' + info.sections + ' sections · ' + info.bars + ' bars · ' + mmss(info.music) + ' music / ' + mmss(info.withTail) + ' with tail @ ' + info.bpm + ' BPM</div>';
    /* v0.8.0 SECTION BOUNCE — enabled on a contiguous selection */
    if (selLo >= 0) {
      const startBar = stepStartBar[selLo];
      const endBar = stepStartBar[selHi] + v.steps[selHi].bars;
      const nm = (I.p.scenes[v.steps[selLo].scene] && I.p.scenes[v.steps[selLo].scene].name) || ('SCENE ' + (selLo + 1));
      html += '<div style="display:flex;gap:6px;align-items:center;margin:4px 0">'
        + '<span class="mono" style="font-size:9px;color:var(--acc,#4fd6c0)">SEL #' + (selLo + 1) + (selHi !== selLo ? '–#' + (selHi + 1) : '') + ' · ' + (endBar - startBar) + ' bars</span>'
        + '<button id="arrBounceSel" title="Render the selected arranger range through the ONE song renderer (bounds) — the section as it appears in the song (with 0.05 s pre-roll + 2-bar FX tail)' + (selArranging ? ' — RENDERING…' : '') + '"' + (selArranging ? ' disabled' : '') + '>' + (selArranging ? 'BOUNCING…' : 'BOUNCE SECTION') + '</button>'
        + '<button id="arrSelClear" title="clear the selection">CLEAR SEL</button></div>';
    }
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
  /* v0.9.0 evolution strip wiring */
  const bEvo = body.querySelector('#bEvo');
  if (bEvo) bEvo.onclick = function () { pushHist(); const e = evolutionState(I.p); e.on = !e.on; I.renderDirty = true; renderArranger(); };
  const evoInt = body.querySelector('#evoInt');
  if (evoInt) evoInt.onchange = function () { const e = evolutionState(I.p); e.intensity = Math.max(0, Math.min(100, Math.round(+this.value || 0))); I.renderDirty = true; renderArranger(); };
  body.querySelectorAll('.arrScene').forEach((sel) => { sel.onchange = function () { arrSetStep(+this.dataset.i, { scene: +this.value }); }; });
  body.querySelectorAll('.arrBars').forEach((inp) => { inp.onchange = function () { arrSetStep(+this.dataset.i, { bars: +this.value }); }; });
  body.querySelectorAll('.arrDel').forEach((b) => { b.onclick = function () { arrRemoveStep(+this.dataset.i); }; });
  const add = body.querySelector('#arrAdd');
  if (add) add.onclick = function () { arrAddStep(I.p.activeScene, 0); }; /* 0 = use the scene's bars override, else 4 */
  /* timeline wiring — click selects, shift+click extends the contiguous range */
  body.querySelectorAll('.tlBlock').forEach(b => { b.onclick = function (e) { const i = +this.dataset.i; if (e.shiftKey && selStep >= 0) { selEnd = i; } else { selStep = i; selEnd = i; } renderArranger(); }; });
  /* v0.8.0 SECTION BOUNCE — ONE renderer, bounds = contiguous selection */
  const bSel = body.querySelector('#arrBounceSel');
  if (bSel) bSel.onclick = async function () {
    const a = arrState();
    if (!I.p || !a || selStep < 0 || selEnd < 0 || selArranging) return;
    const steps = a.steps;
    if (selStep >= steps.length || selEnd >= steps.length) return;
    /* memory guard: a section bounce renders the full arrangement (single
       renderer) and slices — the SONG_MAX_SEC cap applies */
    const dInfo = songDurationSec(I.p);
    if (dInfo.withTail > SONG_MAX_SEC) { toast('SECTION BOUNCE REFUSED — song is ' + (dInfo.withTail / 60).toFixed(1) + ' min (cap ' + Math.round(SONG_MAX_SEC / 60) + ' min)'); return; }
    const lo = Math.min(selStep, selEnd), hi = Math.max(selStep, selEnd);
    let barAcc = 0, startBar = 0, endBar = 0;
    for (let i = 0; i < steps.length; i++) { if (i === lo) startBar = barAcc; barAcc += steps[i].bars; if (i === hi) endBar = barAcc; }
    const nm = ((I.p.scenes[steps[lo].scene] || {}).name || ('SCENE ' + (lo + 1))).replace(/\s+/g, '-').toLowerCase();
    const fname = 'psy6-section-' + nm + '-' + (lo + 1) + (hi !== lo ? '-' + (hi + 1) : '') + '.wav';
    selArranging = true; renderArranger();
    toast('SECTION BOUNCE — bars ' + startBar + '–' + endBar + ' (' + (endBar - startBar) + ' bars) rendering…');
    try {
      const ctl = songRenderController();
      const r = await renderSong(I.p, { ctrl: ctl, bounds: [startBar, endBar] });
      if (!r) { toast('SECTION BOUNCE: arranger is empty'); }
      else {
        const pcm = pcmFromBuffer(r.buf, r.startFrame || 0, r.N);
        const ab = wavEncode(pcm.channels, pcm.sampleRate);
        const blob = new Blob([ab], { type: 'audio/wav' });
        const a2 = document.createElement('a'); a2.href = URL.createObjectURL(blob); a2.download = fname; a2.click();
        setTimeout(() => URL.revokeObjectURL(a2.href), 5000);
        toast('SECTION ✓ ' + fname + ' · ' + r.N + ' samples (formula ' + sectionFrames(I.p, startBar, endBar) + ') · ' + (ab.byteLength / 1024 | 0) + ' KB');
      }
    } catch (err) { toast('SECTION BOUNCE FAILED — ' + err.message); }
    selArranging = false; renderArranger();
  };
  const bSelClr = body.querySelector('#arrSelClear');
  if (bSelClr) bSelClr.onclick = function () { selStep = -1; selEnd = -1; renderArranger(); };
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
