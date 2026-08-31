/* MIDI IN core — DOM-free (Bun-testable). Host injects everything DOM/audio:
   selectedTrack(), noteOn(track,vel01,note), noteOff(track), panic(),
   dispatch(paramPath, value01), optional onBind(cc,path).
   Scope (v0.4.0): Note On/Off → currently-selected track, CC learn →
   project.midiMap bindings, CC → param dispatch, CC 0 ignored (bank select),
   CC 123 → panic. MIDI CLOCK SYNC IS OUT OF SCOPE — documented, not planned.
   Web MIDI access is injected via a settable provider so tests (and the UI)
   can supply a real or mock MIDIAccess without touching this module. */
const MIDI_MAP_VERSION = 1;
function emptyMidiMap(){ return { version: MIDI_MAP_VERSION, bindings: {} }; }

function createMidiCore(host){
  const core = {
    provider: null,      /* settable: () => Promise<MIDIAccess-like> */
    access: null,
    input: null,
    map: emptyMidiMap(), /* replaceable reference — UI points this at I.p.midiMap */
    learn: null,         /* paramPath string while a learn is pending */
    last: null,          /* last parsed message (evidence/debug) */
  };
  core.setProvider = (p) => { core.provider = p; };

  core.beginLearn  = (paramPath) => { core.learn = String(paramPath); };
  core.cancelLearn = () => { core.learn = null; };
  core.clearBinding = (cc) => { delete core.map.bindings[cc]; };

  core.inputGet = (id) => {
    if (!core.access) return null;
    const inp = core.access.inputs;
    return typeof inp.get === 'function' ? inp.get(id) : inp[id];
  };
  core.inputIds = () => {
    if (!core.access) return [];
    const inp = core.access.inputs;
    return typeof inp.keys === 'function' ? Array.from(inp.keys()) : Object.keys(inp);
  };
  core.attachInput = (id) => {
    const inp = core.inputGet(id);
    if (!inp) return { ok: false, reason: 'no-such-input' };
    if (core.input) core.input.onmidimessage = null;
    core.input = inp;
    inp.onmidimessage = core.onMessage;
    return { ok: true };
  };
  core.connect = async (provider) => {
    const prov = provider || core.provider;
    if (!prov) return { ok: false, reason: 'unsupported' };
    let acc;
    try { acc = await prov(); }
    catch (e) { return { ok: false, reason: 'denied' }; }
    core.access = acc;
    const inputs = core.inputIds().map((id) => {
      const i = core.inputGet(id);
      return { id, name: (i && i.name) || id };
    });
    /* auto-attach the first device if present */
    if (inputs.length) core.attachInput(inputs[0].id);
    return { ok: true, connected: inputs.length > 0, inputs };
  };
  core.disconnect = () => {
    if (core.input) core.input.onmidimessage = null;
    core.input = null; core.access = null;
  };

  /* Message parser — the ONLY place bytes are interpreted.
     0x90 vel>0 → note on | 0x90 vel==0 / 0x80 → note off | 0xB0 → CC. */
  core.onMessage = (e) => {
    const d = e && e.data;
    if (!d || d.length < 2) return;
    const type = d[0] & 0xf0, d1 = d[1], d2 = d.length > 2 ? d[2] : 0;
    if (type === 0x90 && d2 > 0) core.noteOn(d1, d2);
    else if (type === 0x80 || (type === 0x90 && d2 === 0)) core.noteOff(d1);
    else if (type === 0xB0) core.cc(d1, d2);
  };

  core.noteOn = (note, vel) => {
    const t = host.selectedTrack();
    const v = vel / 127;
    host.noteOn(t, v, note);
    core.last = { kind: 'noteon', track: t, vel: v, note };
    return core.last;
  };
  core.noteOff = (note) => {
    const t = host.selectedTrack();
    host.noteOff(t);
    core.last = { kind: 'noteoff', track: t, note };
    return core.last;
  };
  core.cc = (cc, val) => {
    if (cc === 0) return; /* bank select — ignored by design (mission rule) */
    if (core.learn) {
      const path = core.learn;
      core.learn = null;
      core.map.bindings[cc] = path;      /* rebind wins if cc already bound */
      if (host.onBind) host.onBind(cc, path);
      core.last = { kind: 'learn', cc, path };
      return core.last;
    }
    if (cc === 123) { host.panic(); core.last = { kind: 'panic', cc }; return core.last; }
    const path = core.map.bindings[cc];
    if (path) {
      const v = val / 127;
      host.dispatch(path, v);
      core.last = { kind: 'cc', cc, path, val: v };
    } else core.last = { kind: 'unbound', cc };
    return core.last;
  };
  return core;
}

export { createMidiCore, emptyMidiMap, MIDI_MAP_VERSION };
