/* Live capture UI state machine (v0.4.0) — the ONLY place the CAPTURE button
   logic lives. Reuses the bounce WAV encoder (no duplicate encoding code).
   States: idle → armed-start → (bar boundary) capturing → armed-stop →
   (bar boundary) idle + result. Panic-safe by construction: nothing here
   touches the transport (I.fsm / I.sched) — stopping capture can never stop
   playback. If the transport is stopped mid-capture, the next STOP press
   finishes immediately (documented fallback, no hung capture). */
import { $, I, toast } from '../state.js';
import { wavEncode } from '../bounce.js';
import { CaptureTap, stepsToBarBoundary } from '../capture.js';

let tap = null;
let hook = null;
let state = 'idle'; /* idle | armed-start | capturing | armed-stop */
let result = null;

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
  b.title = state === 'idle'
    ? 'Record the live master output losslessly (WAV). Starts on the next bar, stops on the next bar after that.'
    : 'armed-start: recording begins next bar · capturing: press again to arm the bar-boundary stop';
}

function dropHook() { if (!hook) return; const i = I.barHooks.indexOf(hook); if (i >= 0) I.barHooks.splice(i, 1); hook = null; }

function finishCapture() {
  tap.stop();
  state = 'idle';
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
  a.download = 'psy6-capture-' + I.p.bpm + 'bpm.wav';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('CAPTURED ✓ ' + frames + ' samples · ' + (ab.byteLength / 1024 | 0) + ' KB');
  paint();
}

function onBar() {
  if (state === 'armed-start') { tap.start(); state = 'capturing'; paint(); }
  else if (state === 'armed-stop') finishCapture();
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

function captureStop() {
  if (state === 'armed-start') { /* never started: cancel cleanly */
    state = 'idle';
    dropHook();
    paint(); toast('CAPTURE cancelled'); return { ok: true };
  }
  if (state !== 'capturing') { toast('CAPTURE: nothing to stop'); return { ok: false }; }
  if (!I.sched.on) { finishCapture(); return { ok: true }; } /* transport stopped mid-capture → finish now (fallback) */
  state = 'armed-stop';
  paint();
  toast('CAPTURE — stops next bar');
  return { ok: true };
}

function captureState() { return { state, frames: tap ? tap.frames : 0 }; }
function captureResult() { return result; }

function wireCapture() {
  const b = $('bCap');
  if (!b) return;
  b.onclick = () => { if (state === 'idle') armCapture(); else captureStop(); };
  paint();
}

export { wireCapture, armCapture, captureStop, captureState, captureResult };
