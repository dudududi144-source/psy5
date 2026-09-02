/* Live capture UI state machine (v0.4.0) — the ONLY place the CAPTURE button
   logic lives. Reuses the bounce WAV encoder (no duplicate encoding code).
   States: idle → armed-start → (bar boundary) capturing → armed-stop →
   (bar boundary) idle + result. Panic-safe by construction: nothing here
   touches the transport (I.fsm / I.sched) — stopping capture can never stop
   playback. If the transport is stopped mid-capture, the next STOP press
   finishes immediately (documented fallback, no hung capture).
   v0.11.0: RESAMPLE mode — the same tap machinery, armed for exactly N bars
   (auto-stop at the Nth bar boundary), finished into the SAMPLE STORE
   through a sink callback instead of a WAV download. */
import { $, I, toast } from '../state.js';
import { wavEncode } from '../bounce.js';
import { CaptureTap, stepsToBarBoundary, resampleFrames, resampleGuard } from '../capture.js';
import { arrToggle, arrState } from '../arranger.js';

let tap = null;
let hook = null;
let state = 'idle'; /* idle | armed-start | capturing | armed-stop | song-start | song-capturing */
let songMode = false;
let songBarsTotal = 0;
let songBarsDone = 0;
let result = null;
let resampleMode = false;
let rsBars = 0;
let rsLeft = 0;
let resampleSink = null;

function rmsOf(ch) {
  let s = 0, n = 0;
  for (const c of ch) for (let i = 0; i < c.length; i++) { s += c[i] * c[i]; n++; }
  return n ? Math.sqrt(s / n) : 0;
}

function ensureTap() {
  if (tap && tap.ctx === I.ctx) return tap;
  if (tap) tap.dispose();
  tap = new CaptureTap(I.ctx, I.eng.analyser); /* post-master-chain output = exactly what you hear */
  return tap;
}

function paint() {
  const b = $('bCap'); if (!b) return;
  b.classList.toggle('rec', state === 'capturing' || state === 'armed-start' || state === 'armed-stop');
  b.textContent = state === 'armed-start' ? 'CAPTURE ⏳' : state === 'capturing' ? 'CAPTURE ■' : state === 'armed-stop' ? 'CAPTURE ⏳' : 'CAPTURE';
  const sr = $('bSongRec');
  if (sr) {
    sr.classList.toggle('rec', state === 'song-start' || state === 'song-capturing');
    sr.textContent = state === 'song-start' ? 'REC SONG ⏳' : state === 'song-capturing' ? 'REC SONG ■ ' + songBarsDone + '/' + (songBarsTotal + 1) : 'RECORD SONG';
  }
  const rs = $('bResample');
  if (rs) {
    const rsActive = resampleMode && state !== 'idle';
    rs.classList.toggle('rec', rsActive);
    rs.textContent = resampleMode && state === 'armed-start' ? 'RESAMPLE ⏳'
      : resampleMode && state === 'capturing' ? 'RES ■ ' + (rsBars - rsLeft + 1) + '/' + rsBars
      : resampleMode && state === 'armed-stop' ? 'RESAMPLE ⏳' : 'RESAMPLE';
  }
  b.title = state === 'idle'
    ? 'Record the live master output losslessly (WAV). Starts on the next bar, stops on the next bar after that.'
    : 'armed-start: recording begins next bar · capturing: press again to arm the bar-boundary stop';
}

function dropHook() { if (!hook) return; const i = I.barHooks.indexOf(hook); if (i >= 0) I.barHooks.splice(i, 1); hook = null; }

function finishCapture() {
  tap.stop();
  state = 'idle';
  resampleMode = false;
  dropHook();
  const channels = tap.assemble();
  const frames = channels[0].length;
  const ab = wavEncode(channels, I.ctx.sampleRate); /* EXISTING encoder — reuse, no duplicate code */
  result = {
    frames, sampleRate: I.ctx.sampleRate, wav: ab, channels,
    bpm: I.p.bpm, rms: rmsOf(channels), quant: stepsToBarBoundary(I.sched.step),
  };
  const blob = new Blob([ab], { type: 'audio/wav' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (songMode ? 'psy6-song-live-' : 'psy6-capture-') + I.p.bpm + 'bpm.wav';
  songMode = false;
  /* belt-and-braces: a completed capture retires its tap — the next arm
     builds a fresh one (no residue across sessions of the same page) */
  try { tap.dispose(); } catch (e) { /* done */ }
  tap = null;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('CAPTURED ✓ ' + frames + ' samples · ' + (ab.byteLength / 1024 | 0) + ' KB');
  paint();
}

function onBar() {
  if (state === 'armed-start') { tap.start(); if (resampleMode) rsLeft = rsBars; state = 'capturing'; paint(); }
  else if (state === 'armed-stop') resampleMode ? finishResample() : finishCapture();
  else if (state === 'song-start') { tap.start(); songBarsDone = 0; state = 'song-capturing'; paint(); }
  else if (state === 'song-capturing') {
    songBarsDone++;
    paint();
    if (songBarsDone >= songBarsTotal + 1) finishCapture(); /* final section + 1 tail bar */
  }
  else if (state === 'capturing' && resampleMode) {
    rsLeft--;
    paint();
    if (rsLeft <= 0) finishResample(); /* exactly N bars from the quantized start */
  }
}

/* finishResample (v0.11.0) — stop the tap, trim the assembled stream to the
   exact N-bar window (resampleFrames math; the capture START was bar-
   quantized so [0, want) is the window — realtime scheduler skew of a few
   ms is documented, this is evidence-only realtime capture), then hand the
   raw channels to the sink (the SAMPLES drawer imports them into the store;
   no WAV download — the store IS the artifact). */
function finishResample() {
  tap.stop();
  state = 'idle';
  dropHook();
  const channels = tap.assemble();
  const want = resampleFrames(rsBars, I.p.bpm, I.ctx.sampleRate);
  const frames = Math.min(want, channels[0].length);
  const trimmed = channels.map(c => c.slice(0, frames));
  result = { frames, sampleRate: I.ctx.sampleRate, channels: trimmed, bpm: I.p.bpm, bars: rsBars, resampled: true, rms: rmsOf(trimmed), quant: stepsToBarBoundary(I.sched.step) };
  try { tap.dispose(); } catch (e) { /* done */ }
  tap = null;
  const sink = resampleSink, barsDone = rsBars;
  resampleMode = false; resampleSink = null; rsBars = 0; rsLeft = 0;
  paint();
  if (sink) sink(trimmed, { sampleRate: I.ctx.sampleRate, frames, bars: barsDone, bpm: I.p.bpm });
  toast('RESAMPLED ✓ ' + frames + ' samples (' + result.bars + ' bars @ ' + I.p.bpm + ' bpm) → sample store');
}

/* armSongRecord (Run 9): record the WHOLE live song playback through the
   EXISTING capture tap + WAV encoder. Requires a non-empty arranger. Starts
   bar-quantized together with PLAY SONG (arranger restarts at section 0),
   auto-stops at the end of the final section +1 bar. Panic-safe: the
   capture path never touches the transport — pressing STOP only stops the
   transport (the next STOP press finishes the capture, documented fallback). */
function armSongRecord() {
  if (!I.eng || !I.ctx) { toast('POWER ON first'); return { ok: false }; }
  if (state !== 'idle') { toast('CAPTURE already active'); return { ok: false }; }
  const steps = (I.p && I.p.arranger && Array.isArray(I.p.arranger.steps)) ? I.p.arranger.steps : [];
  if (!steps.length) { toast('RECORD SONG: arranger is empty — build [scene,bars] sections first'); return { ok: false }; }
  songBarsTotal = steps.reduce((a, s) => a + s.bars, 0);
  songBarsDone = 0;
  songMode = true;
  ensureTap();
  result = null;
  state = 'song-start';
  hook = onBar;
  I.barHooks.push(hook);
  /* PLAY SONG: restart the chain at section 0 + boot the transport when stopped */
  arrToggle(true);
  if (!['PLAYING', 'RECORDING', 'TRANSITIONING'].includes(I.fsm)) { const b = $('bPlay'); if (b) b.click(); }
  paint();
  toast('REC SONG ARMED — ' + songBarsTotal + ' bars, starts next bar');
  return { ok: true };
}

function armCapture() {
  if (!I.eng || !I.ctx) { toast('POWER ON first'); return { ok: false }; }
  if (!['PLAYING', 'RECORDING', 'TRANSITIONING'].includes(I.fsm)) { toast('CAPTURE: press PLAY first — start is bar-quantized'); return { ok: false }; }
  if (state !== 'idle') { toast('CAPTURE already active'); return { ok: false }; }
  ensureTap();
  result = null;
  state = 'armed-start';
  hook = onBar;
  I.barHooks.push(hook);
  paint();
  toast('CAPTURE ARMED — starts next bar');
  return { ok: true };
}

/* armResample (v0.11.0) — record the live master for exactly N bars and hand
   the PCM to the SAMPLES store. Quantized start on the next bar, auto-stop
   at the Nth bar boundary. Transport never touched (overlay recording). */
function armResample(bars, sink) {
  if (!I.eng || !I.ctx) { toast('POWER ON first'); return { ok: false }; }
  if (I.engine === 'worklet') { toast('RESAMPLE: unsupported on the WORKLET engine (reduced feature set)'); return { ok: false }; }
  if (!['PLAYING', 'RECORDING', 'TRANSITIONING'].includes(I.fsm)) { toast('RESAMPLE: press PLAY first — start is bar-quantized'); return { ok: false }; }
  if (state !== 'idle') { toast('CAPTURE already active'); return { ok: false }; }
  const g = resampleGuard(bars);
  if (!g.ok) { toast('RESAMPLE REFUSED — ' + g.reason); return { ok: false }; }
  if (typeof sink !== 'function') { toast('RESAMPLE: no sink'); return { ok: false }; }
  ensureTap();
  result = null;
  resampleMode = true; rsBars = bars; rsLeft = bars; resampleSink = sink;
  state = 'armed-start';
  hook = onBar;
  I.barHooks.push(hook);
  paint();
  toast('RESAMPLE ARMED — ' + bars + ' bar' + (bars > 1 ? 's' : '') + ' of the live master, starts next bar');
  return { ok: true };
}

function captureStop() {
  const wasResample = resampleMode;
  if (state === 'armed-start' || state === 'song-start') { /* never started: cancel cleanly */
    state = 'idle'; songMode = false; resampleMode = false; resampleSink = null; rsBars = 0; rsLeft = 0;
    dropHook();
    paint(); toast(state === 'song-start' ? 'REC SONG cancelled' : wasResample ? 'RESAMPLE cancelled' : 'CAPTURE cancelled'); return { ok: true };
  }
  if (state !== 'capturing' && state !== 'song-capturing') { toast('CAPTURE: nothing to stop'); return { ok: false }; }
  if (!I.sched.on) { resampleMode ? finishResample() : finishCapture(); return { ok: true } } /* transport stopped mid-capture → finish now (fallback) */
  state = 'armed-stop';
  paint();
  toast('CAPTURE — stops next bar');
  return { ok: true };
}

function captureState() { return { state, frames: tap ? tap.frames : 0 }; }
function captureResult() { return result; }

function wireCapture() {
  const b = $('bCap');
  if (b) b.onclick = () => { if (state === 'idle') armCapture(); else captureStop(); };
  const sr = $('bSongRec');
  if (sr) sr.onclick = () => { if (state === 'idle') armSongRecord(); else captureStop(); };
  paint();
}

/* resampleWasArmed (removed) — captureStop captures resampleMode before the
   reset instead (order-safe, no DOM state dependency). */

export { wireCapture, armCapture, captureStop, armSongRecord, armResample, captureState, captureResult };
