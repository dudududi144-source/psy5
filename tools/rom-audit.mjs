#!/usr/bin/env bun
/* tools/rom-audit.mjs — PERCUSSION ROM v3 (v0.23.0) loudness + window audit.
 *
 * THE ANTI-"DYNAMICS DESTROYER" EVIDENCE (the owner: sounds that ruin the
 * mix dynamics): renders every ROM type at 48 kHz, measures peak/RMS/crest,
 * and asserts the FAMILY LAW — every voice lands inside a ±1.5 dB RMS band
 * around its spec target, peaks stay ≤ 0.97, and no buffer outlives its
 * drumDurEst reuse window (pool discipline: a stolen voice can never cut an
 * audible tail).
 *
 * Run: bun tools/rom-audit.mjs   (exit 0 = all laws hold)
 */
import { renderRomPcm, ROM_TYPES, romSpec } from '../foundation/dsp/perc-rom.mjs';
import { PooledEngine } from '../js/engine.js';

const SR = 48000;
const dB = (x) => 20 * Math.log10(x);
let fails = 0;
const rows = [];

for (const t of ROM_TYPES) {
  const spec = romSpec(t);
  if (!spec) { console.log('FAIL', t, 'no spec'); fails++; continue; }
  const a = renderRomPcm(t, SR);
  const b = renderRomPcm(t, SR);
  let det = a.length === b.length;
  if (det) for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { det = false; break; }
  let peak = 0, sum = 0, finite = true;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (!Number.isFinite(v)) finite = false;
    const ab = Math.abs(v); if (ab > peak) peak = ab;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / a.length);
  const dur = a.length / SR;
  const win = PooledEngine.prototype.drumDurEst(t, 1) * 1.15 + 0.02;
  const rmsErr = Math.abs(dB(rms / spec.rms));
  const ok = det && finite && peak <= 0.9701 && dur <= win + 1e-6 && rmsErr <= 1.5;
  if (!ok) fails++;
  rows.push({ t, dur: dur.toFixed(2), peak: peak.toFixed(3), rms: rms.toFixed(3), rmsDb: (rmsErr === 0 ? '0.00' : rmsErr.toFixed(2)), win: win.toFixed(3), det, finite, ok });
}

console.log('PERCUSSION ROM v3 — loudness + window audit @ 48 kHz');
console.log('type        dur[s]  peak    rms    |rmsErr|dB  win[s]  det   finite  ok');
for (const r of rows) {
  console.log(
    r.t.padEnd(11), r.dur.padStart(6), r.peak.padStart(7), r.rms.padStart(7),
    r.rmsDb.padStart(10), r.win.padStart(8), String(r.det).padStart(6), String(r.finite).padStart(7), (r.ok ? 'PASS' : 'FAIL').padStart(5)
  );
}
console.log(fails === 0 ? '\nALL LAWS HOLD — ' + ROM_TYPES.size + ' types' : '\nFAILURES: ' + fails);
process.exit(fails === 0 ? 0 : 1);
