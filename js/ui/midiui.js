import { $, I, toast, applyMidiParam } from '../state.js';
import { createMidiCore, emptyMidiMap } from '../midi.js';

/* Mappable parameter paths — the learn dropdown covers every path the
   dispatcher understands (macros, mixer incl. scAmount/sendA/sendB, master). */
const MIDI_TARGETS = (() => {
  const t = [];
  for (let i = 0; i < 8; i++) t.push('macro.' + i);
  t.push('master.vol');
  for (let i = 0; i < 8; i++) for (const p of ['mix.vol', 'mix.pan', 'mix.sendA', 'mix.sendB', 'mix.mute', 'scAmount']) t.push('track.' + i + '.' + p);
  return t;
})();

/* The one live MIDI core. Notes trigger the selected track (velocity =
   note-on velocity, MIDI note = pitch); note-off releases synth voices
   (drum one-shots are never cut); CC 123 = PANIC; CC 0 ignored. */
const core = createMidiCore({
  selectedTrack: () => I.selTrack,
  noteOn: (t, vel, note) => {
    if (!I.eng || !I.ctx || !I.p) return;
    const tr = I.p.tracks[t]; if (!tr) return;
    I.eng.trigger(tr, I.ctx.currentTime, { vel, note, lock: {} }, 60 / I.p.bpm / 4);
  },
  noteOff: (t) => {
    if (!I.eng || !I.p) return;
    const tr = I.p.tracks[t]; if (!tr || tr.kind === 'drum') return;
    if (I.eng.killTrack) I.eng.killTrack(t);
  },
  panic: () => { if (I.eng) I.eng.killAll(); },
  dispatch: (path, v) => applyMidiParam(path, v),
  onBind: (cc, path) => {
    if (!I.p) return;
    I.p.midiMap.bindings[cc] = path;
    I.dirty = true;
    renderBindings();
    toast('MIDI LEARN ✓ CC' + cc + ' → ' + path);
  },
});

function renderBindings() {
  const w = $('midiBinds'); if (!w) return;
  if (I.p) core.map = (I.p.midiMap && I.p.midiMap.bindings) ? I.p.midiMap : (I.p.midiMap = emptyMidiMap());
  const b = core.map.bindings || {};
  const keys = Object.keys(b).sort((a, c) => +a - +c);
  w.innerHTML = keys.length ? '' : '<span class="mono" style="font-size:9px;color:var(--dim)">no bindings — pick a target, press LEARN, move a control</span>';
  keys.forEach((cc) => {
    const row = document.createElement('div');
    row.className = 'mono'; row.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:9px;line-height:14px';
    row.innerHTML = '<span style="width:38px">CC' + cc + '</span><span style="flex:1;color:var(--dim)">' + b[cc] + '</span>';
    const x = document.createElement('button'); x.textContent = '×'; x.title = 'clear binding';
    x.onclick = () => { core.clearBinding(+cc); if (I.p) I.dirty = true; renderBindings(); };
    row.appendChild(x); w.appendChild(row);
  });
}

function setLearnIndicator() {
  const el = $('midiLearn'); if (!el) return;
  el.textContent = core.learn ? 'LEARNING → ' + core.learn : 'idle';
}

function wireMidi() {
  const sel = $('midiTarget');
  if (sel && !sel.options.length) MIDI_TARGETS.forEach((p) => { const o = document.createElement('option'); o.value = p; o.textContent = p; sel.appendChild(o); });
  if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
    const st = $('midiState');
    if (st) st.textContent = 'Web MIDI unsupported here (Chromium needed) — device keeps working';
    const b = $('midiConnect'); if (b) b.disabled = true;
    return;
  }
  core.setProvider(() => navigator.requestMIDIAccess({ sysex: false }));
  $('midiConnect').onclick = async () => {
    const r = await core.connect();
    if (!r.ok) { $('midiState').textContent = r.reason === 'denied' ? 'MIDI access denied' : 'MIDI unavailable'; return; }
    const dev = $('midiDev'); dev.innerHTML = '';
    (r.inputs || []).forEach((d) => { const o = document.createElement('option'); o.value = d.id; o.textContent = d.name; dev.appendChild(o); });
    dev.onchange = () => core.attachInput(dev.value);
    $('midiState').textContent = r.connected ? 'connected' : 'no MIDI inputs found';
    toast(r.connected ? 'MIDI connected' : 'MIDI: no inputs found');
  };
  $('midiLearnBtn').onclick = () => {
    if (core.learn) { core.cancelLearn(); setLearnIndicator(); return; }
    core.beginLearn($('midiTarget').value);
    setLearnIndicator();
    toast('MIDI LEARN: move a control (CC)…');
  };
}

function renderMidi() { renderBindings(); setLearnIndicator(); }

export { wireMidi, renderMidi, core as midiCore };
