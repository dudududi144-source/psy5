/* ============ AUTOMATION EDITOR (v0.5.0) — lane list + curve canvas ============
   Lanes are (track, param) pairs over the pattern loop; 'state' lanes are
   applied per-step by the scheduler (js/autorec.js), 'lock' lanes keep the
   legacy per-voice behavior. Recording: ARM-AUTO enables capture; armed
   lanes (●) collect knob/CC moves via autoRecMove at the quantized
   playhead step (1/16 toggleable). Multiple lanes can be armed at once. */
import { $, I, pushHist, toast } from '../state.js';
import { loopLen, laneEval } from '../model.js';
import { PARAMS, paramById, paramNorm, paramsForTrack } from '../params.js';

function fmtVal(pd, v) { const dec = (pd.max - pd.min) > 20 ? 0 : 2; return Number(v).toFixed(dec) }

function syncButtons() {
  const b = $('bArmAuto'); if (!b) return;
  b.classList.toggle('on', I.autoOn);
  b.textContent = I.autoOn ? 'ARM-AUTO ●' : 'ARM-AUTO';
  const q = $('bAutoQ'); if (q) { q.classList.toggle('on', I.autoQuant); q.textContent = I.autoQuant ? 'Q 1/16' : 'Q OFF'; }
}

function renderLanes() {
  const list = $('laneList'); if (!list || !I.p) return;
  list.innerHTML = '';
  const L = Math.max(1, loopLen(I.p));
  I.p.lanes.forEach((ln, li) => {
    const pd = paramById(ln.param);
    const tn = ln.track >= 0 ? (I.p.tracks[ln.track] ? I.p.tracks[ln.track].name : 'T' + ln.track) : 'MASTER';
    const cur = laneEval(ln, I.sched.step % L);
    const row = document.createElement('div');
    row.className = 'laneRow' + (li === I.selLane ? ' sel' : '');
    row.innerHTML = '<button class="arm' + (I.autoArm.has(li) ? ' on' : '') + '" title="arm — record knob/CC moves into this lane">●</button>'
      + '<span class="lb">' + tn + ' · ' + (pd ? pd.label : ln.param) + (ln.mode === 'lock' ? ' <i>(lock)</i>' : '') + '</span>'
      + '<span class="val mono">' + (pd ? fmtVal(pd, cur) : cur.toFixed(3)) + '</span>'
      + '<button class="del" title="delete lane">✕</button>';
    row.querySelector('.arm').onclick = e => {
      e.stopPropagation();
      /* per-lane arm only selects TARGET lanes; the master enable is the
         ARM-AUTO button (autoOn). Mixing both here made the button toggle
         itself back off. */
      if (I.autoArm.has(li)) I.autoArm.delete(li); else I.autoArm.add(li);
      syncButtons(); renderLanes();
    };
    row.querySelector('.del').onclick = e => {
      e.stopPropagation(); pushHist();
      I.p.lanes.splice(li, 1);
      I.autoArm = new Set(); I.selLane = -1; I.autoOn = false;
      I.renderDirty = true;
    };
    row.onclick = () => { I.selLane = li; renderLanes(); };
    list.appendChild(row);
  });
  if (!I.p.lanes.length) list.innerHTML = '<div class="note">No lanes yet — pick a parameter, ADD LANE, arm it (●), press ARM-AUTO and move knobs or MIDI CCs during playback.</div>';
  syncButtons(); drawLane();
}

function drawLane() {
  const cv = $('laneCanvas'); if (!cv || !I.p) return;
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#11151d'; g.fillRect(0, 0, W, H);
  const L = Math.max(1, loopLen(I.p));
  g.strokeStyle = '#1d2430'; g.lineWidth = 1;
  for (let s = 0; s <= L; s += 4) { const x = Math.round(s / L * W) + .5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  const ln = I.p.lanes[I.selLane];
  if (!ln) { g.fillStyle = '#3d485c'; g.font = '10px monospace'; g.fillText('select a lane to draw its curve', 8, H / 2); return; }
  const pd = paramById(ln.param);
  g.strokeStyle = ln.mode === 'lock' ? '#5a8fd4' : '#4fd6c0';
  g.lineWidth = 2; g.beginPath();
  for (let s = 0; s <= L; s++) {
    const v = laneEval(ln, s === L ? L : s % L);
    const x = s / L * W, y = H - paramNorm(ln.param, v) * (H - 6) - 3;
    s === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
  /* point markers */
  g.fillStyle = '#fff';
  for (const pt of (ln.pts || [])) { const x = pt[0] / L * W, y = H - paramNorm(ln.param, pt[1]) * (H - 6) - 3; g.beginPath(); g.arc(x, y, 2.5, 0, 7); g.fill(); }
}

function drawPlayhead() {
  const cv = $('lanePlay'); if (!cv || !I.p) return;
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  if (!I.sched.on) return;
  const L = Math.max(1, loopLen(I.p));
  const x = (I.sched.step % L) / L * W;
  g.strokeStyle = '#e05656'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x + .5, 0); g.lineTo(x + .5, H); g.stroke();
}

/* v0.16.1 PERF — sig-gated: rebuild the option list only when the track/kind changed */
let lpSig = '';
function populateParamSelect() {
  const sel = $('laneParam'); if (!sel || !I.p) return;
  const tr = I.p.tracks[I.selTrack];
  const ids = paramsForTrack(tr ? tr.kind : 'synth');
  const proj = PARAMS.filter(p => p.target === 'project').map(p => p.id);
  const all = ids.concat(proj);
  const sig = (tr ? tr.kind : 'synth') + '#' + ids.length;
  if (sig === lpSig && sel.children.length === all.length) return;
  lpSig = sig;
  const cur = sel.value;
  sel.innerHTML = all.map(id => { const pd = paramById(id); return '<option value="' + id + '"' + (id === 'mix.vol' ? ' selected' : '') + '>' + (pd.target === 'project' ? 'MASTER · ' : '') + pd.label + '</option>' }).join('');
  if (all.includes(cur)) sel.value = cur;
}

function wireLanes() {
  const add = $('bLaneAdd'); if (!add) return;
  add.onclick = () => {
    const id = $('laneParam').value; const pd = paramById(id);
    if (!pd) return;
    if (pd.target === 'track' && I.selTrack >= I.p.tracks.length) { toast('select a track first'); return }
    pushHist();
    I.p.lanes.push({ track: pd.target === 'project' ? -1 : I.selTrack, param: id, mode: 'state', pts: [[0, pd.def]] });
    I.selLane = I.p.lanes.length - 1;
    I.renderDirty = true;
    toast('LANE ADDED — ' + pd.label + ' · arm (●) + ARM-AUTO, then move the knob');
  };
  $('bArmAuto').onclick = () => {
    if (!I.p.lanes.length) { toast('add a lane first'); return }
    I.autoOn = !I.autoOn;
    if (I.autoOn && !I.autoArm.size && I.selLane >= 0) I.autoArm.add(I.selLane); /* arm the selected lane for convenience */
    if (I.autoOn && !I.autoArm.size) toast('arm a lane (●) to capture moves');
    if (I.autoOn && !I.sched.on) toast('ARMED — press PLAY; moves record at the playhead');
    syncButtons();
  };
  $('bAutoQ').onclick = () => { I.autoQuant = !I.autoQuant; syncButtons(); };
  $('bLaneClear').onclick = () => {
    const ln = I.p.lanes[I.selLane]; if (!ln) { toast('select a lane'); return }
    pushHist(); ln.pts = []; I.renderDirty = true;
  };
  populateParamSelect();
  renderLanes();
}

export { renderLanes, drawLane, drawPlayhead, wireLanes, populateParamSelect };
