#!/usr/bin/env bun
/* tools/rom-audit.mjs — PERCUSSION ROM v3 (v0.23.0) + KIT-GOVERNED REASON
 * SYSTEM (v0.24.0) loudness + window audit.
 *
 * THE ANTI-"DYNAMICS DESTROYER" EVIDENCE (the owner: sounds that ruin the
 * mix dynamics): renders every ROM type at 48 kHz, measures peak/RMS/crest,
 * and asserts the FAMILY LAW — every voice lands inside a ±1.5 dB RMS band
 * around its spec target, peaks stay ≤ 0.97, and no buffer outlives its
 * drumDurEst reuse window (pool discipline: a stolen voice can never cut an
 * audible tail).
 *
 * v0.24.0 adds the REASON kit×type table: every kit (all 6) × every reason
 * engine type (8) rendered through that kit's own patch — the exact call the
 * engine's romBuffer makes at unity layer — asserting the duration law
 * (buffer == REASON_DUR and ≤ the drumDurEst window), peak ≤ 0.97, and RMS
 * within ±15% of patch.rms. Buffers the peak law clamped (renderReasonPcm's
 * documented order: the peak clamp has the FINAL word) are reported with a
 * clamp flag and must still land ≥ 50% of the target (no silent collapse).
 *
 * Run: bun tools/rom-audit.mjs   (exit 0 = all laws hold)
 */
import { renderRomPcm, ROM_TYPES, romSpec } from '../foundation/dsp/perc-rom.mjs';
import { REASON_TYPES, REASON_DUR, renderReasonPcm } from '../foundation/dsp/reason-engines.mjs';
import { KIT_IDS, kitPatch } from '../foundation/dsp/kit-reason.mjs';
import { PooledEngine } from '../js/engine.js';

const SR = 48000;
const dB = (x) => 20 * Math.log10(x);
let fails = 0;
const rows = [];
const measure = (pcm) => {
  let peak = 0, sum = 0, finite = true;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i];
    if (!Number.isFinite(v)) finite = false;
    const ab = Math.abs(v); if (ab > peak) peak = ab;
    sum += v * v;
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, pcm.length)), finite };
};

/* ── table 1: the 12 ROM types (byte-determinism + family law) ─────────── */
for (const t of ROM_TYPES) {
  const spec = romSpec(t);
  if (!spec) { console.log('FAIL', t, 'no spec'); fails++; continue; }
  const a = renderRomPcm(t, SR);
  const b = renderRomPcm(t, SR);
  let det = a.length === b.length;
  if (det) for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { det = false; break; }
  const m = measure(a);
  const dur = a.length / SR;
  const win = PooledEngine.prototype.drumDurEst(t, 1) * 1.15 + 0.02;
  const rmsErr = Math.abs(dB(m.rms / spec.rms));
  const ok = det && m.finite && m.peak <= 0.9701 && dur <= win + 1e-6 && rmsErr <= 1.5;
  if (!ok) fails++;
  rows.push({ t, dur: dur.toFixed(2), peak: m.peak.toFixed(3), rms: m.rms.toFixed(3), rmsDb: (rmsErr === 0 ? '0.00' : rmsErr.toFixed(2)), win: win.toFixed(3), det, finite: m.finite, ok });
}

console.log('PERCUSSION ROM v3 — loudness + window audit @ 48 kHz');
console.log('type        dur[s]  peak    rms    |rmsErr|dB  win[s]  det   finite  ok');
for (const r of rows) {
  console.log(
    r.t.padEnd(11), r.dur.padStart(6), r.peak.padStart(7), r.rms.padStart(7),
    r.rmsDb.padStart(10), r.win.padStart(8), String(r.det).padStart(6), String(r.finite).padStart(7), (r.ok ? 'PASS' : 'FAIL').padStart(5)
  );
}

/* ── table 2 (v0.24.0): the REASON kit×type grid — kit governance reality ── */
console.log('\nREASON KIT SYSTEM — kit x type audit @ 48 kHz (unity layer, the exact engine call)');
console.log('kit            type    dur[s]  pk     rms     tgt     err%    win<=  clamp  ok');
let rFails = 0, rCount = 0;
const durEst = PooledEngine.prototype.drumDurEst;
for (const kit of KIT_IDS) {
  for (const t of REASON_TYPES) {
    rCount++;
    const patch = kitPatch(kit, t);
    if (!patch || !(patch.rms > 0)) { console.log('FAIL', kit, t, 'no kit patch / bad rms'); fails++; rFails++; continue; }
    let pcm = null;
    try { pcm = renderReasonPcm(t, patch, SR, 0, 2); } catch (e) { console.log('FAIL', kit, t, 'render threw: ' + e.message); fails++; rFails++; continue; }
    const m = measure(pcm);
    const dur = pcm.length / SR;
    const win = durEst(t, 1) * 1.15 + 0.02;
    /* duration law: the buffer IS the documented REASON_DUR window (±1 sample
       of rounding) and never outlives the engine's reuse window (pool
       discipline moved zero) */
    const durOk = Math.abs(pcm.length - Math.round(REASON_DUR[t] * SR)) <= 1 && dur <= win + 1e-6;
    const clamped = m.peak > 0.9699; /* the peak law clamped the whole buffer */
    const errPct = Math.abs(m.rms / patch.rms - 1) * 100;
    /* RMS law: ±15% of patch.rms. Buffers the peak law clamped (crest > the
       0.97 ceiling — renderReasonPcm's documented order: the clamp scales the
       WHOLE buffer and has the final word) may land below the target by the
       crest physics; they must still keep ≥ 50% of it (no silent collapse)
       and are flagged in the clamp column so the evidence stays honest. */
    const rmsOk = clamped ? m.rms >= 0.5 * patch.rms : errPct <= 15;
    const ok = durOk && m.finite && m.peak <= 0.9701 && rmsOk;
    if (!ok) { fails++; rFails++; }
    console.log(
      kit.padEnd(14), t.padEnd(7), dur.toFixed(2).padStart(6), m.peak.toFixed(3).padStart(6),
      m.rms.toFixed(4).padStart(7), String(patch.rms).padStart(7), errPct.toFixed(1).padStart(6),
      (durOk ? 'yes' : 'NO').padStart(6), (clamped ? 'yes' : '-').padStart(6), (ok ? 'PASS' : 'FAIL').padStart(5)
    );
  }
}
console.log(fails === 0
  ? '\nALL LAWS HOLD — ' + ROM_TYPES.size + ' ROM types + ' + rCount + ' kit x reason renders (' + KIT_IDS.length + ' kits x 8 types)'
  : '\nFAILURES: ' + fails + ' (reason grid: ' + rFails + '/' + rCount + ')');
process.exit(fails === 0 ? 0 : 1);
