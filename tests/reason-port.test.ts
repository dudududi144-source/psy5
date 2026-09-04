/**
 * REASON ENGINE PORT (RUN23-1a, PSY6 v0.24.0) — pins for
 * foundation/dsp/reason-engines.mjs.
 *
 * The owner ordered ALL weak synth sounds replaced with psyreason's REAL
 * multi-engine drum DSP. This file pins the port:
 *   1. RENDER LAW — all 8 reason types render finite, peak-safe PCM;
 *      byte-deterministic (same type+patch+sr+variant+layer → identical
 *      Float32Array, no Math.random anywhere).
 *   2. WINDOW LAW — REASON_DUR[type] and every buffer obey
 *      drumDurEst(type,1)·1.15+0.02 (the js/engine.js pool reuse window —
 *      recomputed here from the REAL formula, which has NO 'ride' case →
 *      ride rides the .5 default → .595, not the .894 the brief guessed).
 *   3. LOUDNESS LAW — at the unity velocity layer (2, gain 1.0) the measured
 *      RMS equals patch.rms (±10 %, the anti-"dynamics destroyer" family
 *      band) and every peak ≤ 0.97; banked layers measure exactly
 *      [0.4, 0.7, 1.0] of it (voice-bank.ts composition).
 *   4. SPECTRAL SANITY — crash energy lives above 5 kHz, the kick is
 *      dominated below ~200 Hz (sign-change rate), hatC decays far shorter
 *      than hatO (time above 10 % of peak).
 *   5. FILTERS — the ported SVF (Chamberlin) and BiquadFilter are finite,
 *      bounded, and actually filter (HP ≥ 12 dB stopband evidence).
 *   6. PERC-ROM OPTS — the backward-compatible {rootMul, rmsMul, variant}
 *      extension: defaults byte-identical, variant re-seeds, rootMul shifts
 *      pitch (ZC evidence), rmsMul halves the RMS with the peak law intact.
 *   7. PROVENANCE — the ported xorshift noise states, the double-tanh drive,
 *      the kit-to-engine.ts mapper defaults, and the voice-bank layer law
 *      are pinned in source and behavior.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  renderReasonPcm, REASON_TYPES, REASON_DUR, REASON_LAYER_GAIN, REASON_LAYER_DRIVE_DB,
  patchToKick, patchToSnare, patchToHat, patchToCymbal, patchToClap, patchToTom,
  SVF, BiquadFilter,
} from '../foundation/dsp/reason-engines.mjs'
import { renderRomPcm, ROM_TYPES } from '../foundation/dsp/perc-rom.mjs'
import { PooledEngine } from '../js/engine.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENGINE_SRC = readFileSync(join(ROOT, 'js/engine.js'), 'utf8')
const MOD_SRC = readFileSync(join(ROOT, 'foundation/dsp/reason-engines.mjs'), 'utf8')
const ROM_SRC = readFileSync(join(ROOT, 'foundation/dsp/perc-rom.mjs'), 'utf8')

const durEst = PooledEngine.prototype.drumDurEst
const SR = 48000

/* Representative kit patches (valid per the mapper shapes documented on the
   patchTo* functions) with the family RMS targets from the brief. */
const PATCHES = {
  kick: { body: { startHz: 165, endHz: 44, pitchDecayMs: 42, bodyDecayMs: 180 }, punch: { ratio: 3, amount: 0.5, decayMs: 12 }, click: { amount: 0.4, ms: 2, hpHz: 4000 }, filter: { cutoff: 300, res: 2 }, driveDb: 4, rms: 0.21 },
  snare: { body: { startHz: 195, endHz: 155, pitchDecayMs: 20 }, tone: { amount: 0.5, decayMs: 90 }, noise: { bpHz: 1850, q: 1, amount: 0.7, decayMs: 130 }, driveDb: 2, rms: 0.16 },
  clap: { taps: [1150, 1500, 950], tapMs: [0, 12, 24], bursts: [55, 70, 90], tail: { decayMs: 200, amount: 0.5 }, driveDb: 2, rms: 0.14 },
  hatC: { metal: { hz: 5500, ratio: 1.34, amount: 0.6 }, noise: { amount: 0.5, hpHz: 7000 }, hp: { hz: 7500, q: 0.7 }, decayMs: 45, driveDb: 1, rms: 0.06 },
  hatO: { metal: { hz: 5500, ratio: 1.34, amount: 0.6 }, noise: { amount: 0.5, hpHz: 7000 }, hp: { hz: 7500, q: 0.7 }, decayMs: 330, driveDb: 1, rms: 0.07 },
  tom: { body: { startHz: 215, endHz: 130, pitchDecayMs: 55 }, filter: { cutoff: 700, res: 2 }, rms: 0.12 },
  crash: { metal: { hz: 3800, ratio: 1.41, amount: 0.6 }, hp: { hz: 5000, q: 0.7 }, decayMs: 1200, driveDb: 1, rms: 0.10 },
  ride: { metal: { hz: 4500, ratio: 1.41, amount: 0.6 }, ping: { hz: 5200, amount: 0.5 }, hp: { hz: 6000, q: 0.7 }, decayMs: 280, driveDb: 1, rms: 0.08 },
}

const TYPES = [...REASON_TYPES]

function stats(buf) {
  let peak = 0, sum = 0, finite = true, zc = 0
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i]
    if (!Number.isFinite(v)) finite = false
    const a = Math.abs(v); if (a > peak) peak = a
    sum += v * v
    if (i > 0 && ((buf[i - 1] < 0 && v >= 0) || (buf[i - 1] >= 0 && v < 0))) zc++
  }
  return { peak, rms: Math.sqrt(sum / buf.length), finite, zc, zcps: zc / (buf.length / SR) }
}

/* one-pole high-pass energy share above hz (cheap spectral evidence) */
function hpShare(buf, hz, sr) {
  const a = hz / (hz + sr / (2 * Math.PI))
  let py = 0, px = buf[0], eh = 0, et = 0
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]
    const y = a * (py + x - px)
    py = y; px = x
    eh += y * y; et += x * x
  }
  return et > 0 ? eh / et : 0
}

/* last time (s) the signal exceeds 10 % of its peak — the decay ruler */
function tAbove10(buf, sr) {
  let peak = 0
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a }
  const th = 0.1 * peak
  let last = 0
  for (let i = 0; i < buf.length; i++) if (Math.abs(buf[i]) > th) last = i
  return last / sr
}

function byteEqual(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

describe('REASON PORT — render law', () => {
  test('all 8 types render finite, peak-safe PCM (every engine path exercised)', () => {
    expect(REASON_TYPES.size).toBe(8)
    expect(typeof REASON_TYPES.has).toBe('function') // Set — engine routes with .has()
    for (const t of TYPES) {
      const buf = renderReasonPcm(t, PATCHES[t], SR, 0, 2) // unity layer
      const s = stats(buf)
      expect(s.finite).toBe(true)
      expect(s.peak).toBeLessThanOrEqual(0.9701)
      expect(s.peak).toBeGreaterThan(0.05) // not accidentally silent
    }
  })

  test('byte-deterministic: same args twice → identical bytes; no Math.random in code', () => {
    /* strip comments first — the purity contract is DOCUMENTED in prose */
    const code = MOD_SRC.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toContain('Math.random')
    for (const t of TYPES) {
      const a = renderReasonPcm(t, PATCHES[t], SR, 0, 2)
      const b = renderReasonPcm(t, PATCHES[t], SR, 0, 2)
      expect(byteEqual(a, b)).toBe(true)
    }
  })

  test('variant re-seeds the noise engines (0 vs 1 differ); no-op where the source has no noise', () => {
    for (const t of ['kick', 'snare', 'clap', 'hatO', 'hatC']) {
      const v0 = renderReasonPcm(t, PATCHES[t], SR, 0, 2)
      const v1 = renderReasonPcm(t, PATCHES[t], SR, 1, 2)
      expect(byteEqual(v0, v1)).toBe(false)
    }
    /* cymbal/tom carry NO noise generator in the ported sources — variant is
       a documented no-op there (byte-identical), the honest port limit */
    for (const t of ['crash', 'ride', 'tom']) {
      const v0 = renderReasonPcm(t, PATCHES[t], SR, 0, 2)
      const v1 = renderReasonPcm(t, PATCHES[t], SR, 1, 2)
      expect(byteEqual(v0, v1)).toBe(true)
    }
  })

  test('velocity layers: loudness steps exactly [0.4, 0.7, 1.0], drive differs (timbre)', () => {
    expect(REASON_LAYER_GAIN).toEqual([0.4, 0.7, 1.0])
    expect(REASON_LAYER_DRIVE_DB).toBe(1.5)
    for (const t of ['kick', 'clap']) {
      const l0 = stats(renderReasonPcm(t, PATCHES[t], SR, 0, 0))
      const l1 = stats(renderReasonPcm(t, PATCHES[t], SR, 0, 1))
      const l2 = stats(renderReasonPcm(t, PATCHES[t], SR, 0, 2))
      expect(l0.rms / l2.rms).toBeCloseTo(0.4, 2)
      expect(l1.rms / l2.rms).toBeCloseTo(0.7, 2)
      /* LAYER_DRIVE_DB: louder layers render MORE DRIVEN — different bytes */
      expect(byteEqual(renderReasonPcm(t, PATCHES[t], SR, 0, 1), renderReasonPcm(t, PATCHES[t], SR, 0, 2))).toBe(false)
    }
  })

  test('mappers never mutate the patch; unknown type / bad sampleRate throw', () => {
    const p = { body: { startHz: 165 }, filter: { cutoff: 300, res: 2 }, rms: 0.21 }
    const snapshot = JSON.stringify(p)
    renderReasonPcm('kick', p, SR)
    expect(JSON.stringify(p)).toBe(snapshot)
    expect(() => renderReasonPcm('conga', {}, SR)).toThrow() // ROM type, not a reason type
    expect(() => renderReasonPcm('kick', {}, 0)).toThrow()
  })

  test('44.1 kHz renders obey the same laws (per-sr render)', () => {
    for (const t of ['kick', 'crash', 'hatC']) {
      const buf = renderReasonPcm(t, PATCHES[t], 44100, 0, 2)
      let peak = 0, finite = true
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i]
        if (!Number.isFinite(v)) finite = false
        const a = Math.abs(v); if (a > peak) peak = a
      }
      expect(finite).toBe(true)
      expect(peak).toBeLessThanOrEqual(0.9701)
      expect(buf.length / 44100).toBeLessThanOrEqual(durEst(t, 1) * 1.15 + 0.02 + 1e-6)
    }
  })
})

describe('REASON PORT — window law (drumDurEst·1.15+.02, recomputed from the engine)', () => {
  /* derived bounds (d = 1): kick .12+.50=.62→≤.733 | snare .10+.16=.26→≤.319
     clap .25+.15=.40→≤.480 | hatO .26+.50=.76→≤.894 | hatC .03+.05=.08→≤.112
     tom .22+.35=.57→≤.6755 | crash 1.2+1.8=3.0→≤3.47
     ride: NO drumDurEst case → the switch default .5 → ≤.595 (the brief's
     "≤.894" guess corrected against the real formula — the formula is the
     law, the pool frees the voice at exactly this window). */
  test('REASON_DUR table ≤ window for every type', () => {
    for (const t of TYPES) {
      const win = durEst(t, 1) * 1.15 + 0.02
      expect(REASON_DUR[t]).toBeLessThanOrEqual(win + 1e-9)
    }
    expect(REASON_DUR.ride).toBeLessThanOrEqual(0.595) // the .5-default window
  })

  test('no buffer outlives its reuse window', () => {
    for (const t of TYPES) {
      const buf = renderReasonPcm(t, PATCHES[t], SR, 0, 2)
      const win = durEst(t, 1) * 1.15 + 0.02
      expect(buf.length / SR).toBeLessThanOrEqual(win + 1e-6)
      expect(buf.length / SR).toBeLessThanOrEqual(REASON_DUR[t] + 1e-6)
    }
  })
})

describe('REASON PORT — loudness law (unity layer = full-velocity reference)', () => {
  test('measured RMS ≈ patch.rms (±10%) and peak ≤ 0.97 for every type', () => {
    for (const t of TYPES) {
      const s = stats(renderReasonPcm(t, PATCHES[t], SR, 0, 2))
      expect(Math.abs(s.rms - PATCHES[t].rms) / PATCHES[t].rms).toBeLessThanOrEqual(0.10)
      expect(s.peak).toBeLessThanOrEqual(0.9701)
    }
  })

  test('patch.rms > 0 is the normalization switch (no rms → raw render, still peak-safe)', () => {
    const raw = { ...PATCHES.kick }
    delete raw.rms
    const s = stats(renderReasonPcm('kick', raw, SR, 0, 2))
    expect(s.finite).toBe(true)
    expect(s.peak).toBeLessThanOrEqual(0.9701)
  })
})

describe('REASON PORT — spectral sanity (cheap, honest thresholds)', () => {
  test('crash has real energy above 5 kHz; kick has none', () => {
    const crash = renderReasonPcm('crash', PATCHES.crash, SR, 0, 2)
    const kick = renderReasonPcm('kick', PATCHES.kick, SR, 0, 2)
    expect(hpShare(crash, 5000, SR)).toBeGreaterThan(0.15) // measured 0.243
    expect(hpShare(kick, 5000, SR)).toBeLessThan(0.01)     // measured 0.000
  })

  test('kick is dominated below ~200 Hz (low sign-change rate)', () => {
    const s = stats(renderReasonPcm('kick', PATCHES.kick, SR, 0, 2))
    expect(s.zcps).toBeLessThan(300) // measured 103/s (a 165→44 Hz body, punch decays in 12 ms)
  })

  test('hatC decays far shorter than hatO (time above 10 % of peak)', () => {
    const tC = tAbove10(renderReasonPcm('hatC', PATCHES.hatC, SR, 0, 2), SR)
    const tO = tAbove10(renderReasonPcm('hatO', PATCHES.hatO, SR, 0, 2), SR)
    expect(tC).toBeLessThan(tO)
    expect(tC).toBeLessThan(0.3)  // measured 0.103 s (45 ms decay)
    expect(tO).toBeGreaterThan(0.6) // measured 0.870 s (330 ms decay)
  })
})

describe('REASON PORT — ported filters (SVF + biquad smoke)', () => {
  test('SVF low+band outputs finite and bounded on an impulse', () => {
    const svf = new SVF(SR, 800, 0.5)
    let maxLow = 0, maxBand = 0, finite = true
    for (let i = 0; i < 512; i++) {
      const o = svf.process(i === 0 ? 1 : 0)
      if (!Number.isFinite(o.low) || !Number.isFinite(o.band)) finite = false
      if (Math.abs(o.low) > maxLow) maxLow = Math.abs(o.low)
      if (Math.abs(o.band) > maxBand) maxBand = Math.abs(o.band)
    }
    expect(finite).toBe(true)
    expect(maxLow).toBeGreaterThan(0)    // the impulse actually entered
    expect(maxLow).toBeLessThan(100)     // bounded (no blow-up)
    expect(maxBand).toBeLessThan(100)
  })

  test('BiquadFilter highpass attenuates a 40 Hz sine ≥ 12 dB relative to 6 kHz', () => {
    const hp = new BiquadFilter(SR, 'highpass', 1000, Math.SQRT1_2)
    const rmsAt = (hz) => {
      let sum = 0
      for (let i = 0; i < SR * 0.25; i++) {
        const y = hp.process(Math.sin(2 * Math.PI * hz * i / SR))
        if (i > 1000) sum += y * y // skip the filter's transient
      }
      return Math.sqrt(sum / (SR * 0.25 - 1000))
    }
    const db = 20 * Math.log10(rmsAt(40) / rmsAt(6000))
    expect(db).toBeLessThanOrEqual(-12)
  })
})

describe('REASON PORT — perc-rom backward-compatible opts (RUN23-1a)', () => {
  test('default opts (none / undefined / {}) are BYTE-IDENTICAL to the legacy 2-arg call', () => {
    expect(ROM_TYPES.size).toBe(13) // ROM_TYPES untouched
    for (const t of ['conga', 'crash', 'clave', 'cowbell']) {
      const base = renderRomPcm(t, SR)
      expect(byteEqual(base, renderRomPcm(t, SR, undefined))).toBe(true)
      expect(byteEqual(base, renderRomPcm(t, SR, {}))).toBe(true)
      expect(byteEqual(base, renderRomPcm(t, SR, { variant: 0, rootMul: 1, rmsMul: 1 }))).toBe(true)
    }
  })

  test('variant re-seeds (bytes change) on the noise-carrying recipes; cowbell (no noise) is a documented no-op', () => {
    for (const t of ['conga', 'crash', 'clave']) {
      expect(byteEqual(renderRomPcm(t, SR), renderRomPcm(t, SR, { variant: 1 }))).toBe(false)
    }
    /* the cowbell recipe is fully deterministic (two squares, no noise) —
       its per-type seed is unused, so variant cannot change it (honest) */
    expect(byteEqual(renderRomPcm('cowbell', SR), renderRomPcm('cowbell', SR, { variant: 1 }))).toBe(true)
  })

  test('rootMul 2.0 shifts the dominant low frequency upward (conga ZC count ~2×)', () => {
    const zc = (buf) => stats(buf).zc
    const base = zc(renderRomPcm('conga', SR))
    const up = zc(renderRomPcm('conga', SR, { rootMul: 2.0 }))
    expect(up).toBeGreaterThan(base * 1.3) // measured ratio 1.99
  })

  test('rmsMul .5 halves the RMS (±2 %) with the peak law intact; rmsMul 4 still peak-safe', () => {
    const base = stats(renderRomPcm('conga', SR))
    const half = stats(renderRomPcm('conga', SR, { rmsMul: 0.5 }))
    expect(half.rms / base.rms).toBeCloseTo(0.5, 2)
    expect(half.peak).toBeLessThanOrEqual(0.9701)
    const loud = stats(renderRomPcm('clave', SR, { rmsMul: 4 }))
    expect(loud.peak).toBeLessThanOrEqual(0.9701)
  })

  test('rootMul is clamped into the sane window (nothing sub-audible, nothing aliased)', () => {
    const s = stats(renderRomPcm('conga', SR, { rootMul: 100 }))
    expect(s.finite).toBe(true)
    expect(s.peak).toBeLessThanOrEqual(0.9701)
  })
})

describe('REASON PORT — provenance pins (the port is the psyreason DSP)', () => {
  test('the source carries the psyreason engines verbatim (xorshift states, double tanh, oversample decimation)', () => {
    expect(MOD_SRC).toContain('Ported from psyreason devices/redrum engines, PSY6 v0.24.0') // provenance header
    expect(MOD_SRC).toContain('0x12345678')            // kick-engine.ts noise state
    expect(MOD_SRC).toContain('0x9e3779b9')            // snare-engine.ts noise state
    expect(MOD_SRC).toContain('0x243f6a88')            // hat-engine.ts noise state
    expect(MOD_SRC).toContain("noiseState ^= noiseState << 13")
    expect(MOD_SRC).toContain('Math.tanh(sig * drive)') // the drive stage…
    expect(MOD_SRC).toContain('Math.tanh(sig)')         // …twice (double tanh)
    expect(MOD_SRC).toContain("new BiquadFilter(sr, 'lowpass', p.filterCutoffHz, p.filterQ)")
    expect(MOD_SRC).toContain("sq(ph1) * sq(ph2)")       // the ring-mod metallic generator
  })

  test('mapper defaults are the kit-to-engine.ts psyreason-grade defaults', () => {
    const d = { sampleRate: SR, durationSec: 0.72 }
    const k = patchToKick({}, d)
    expect(k.bodyStartHz).toBe(160); expect(k.bodyEndHz).toBe(48)
    expect(k.bodyPitchDecayMs).toBe(45); expect(k.bodyDecayMs).toBe(120)
    expect(k.punchRatio).toBe(3); expect(k.punchAmount).toBe(0.5); expect(k.punchDecayMs).toBe(12)
    expect(k.clickAmount).toBe(0.4); expect(k.clickMs).toBe(2); expect(k.clickHpHz).toBe(4000)
    expect(k.filterCutoffHz).toBe(300); expect(k.driveDb).toBe(4); expect(k.oversample).toBe(4)
    const s = patchToSnare({}, d)
    expect(s.toneHz).toBe(195); expect(s.tonePitchDropHz).toBe(40); expect(s.noiseBpHz).toBe(1850)
    expect(s.noiseAmount).toBe(0.7); expect(s.noiseDecayMs).toBe(130); expect(s.driveDb).toBe(2)
    const h = patchToHat({}, d, true)
    expect(h.metalHz).toBe(5500); expect(h.ringRatio).toBe(1.34); expect(h.decayMs).toBe(330)
    expect(patchToHat({}, d, false).decayMs).toBe(45)
    const c = patchToCymbal({}, d, true)
    expect(c.pingHz).toBe(5200); expect(c.metalHz).toBe(4500); expect(c.hpHz).toBe(6000)
    expect(patchToCymbal({}, d, false).pingHz).toBe(0)
    const cl = patchToClap({}, d)
    expect(cl.taps).toEqual([1150, 1500, 950]); expect(cl.tapMs).toEqual([0, 12, 24])
    expect(cl.bursts).toEqual([55, 70, 90]); expect(cl.tailMs).toBe(30)
    const tom = patchToTom({}, d)
    expect(tom.toneHz).toBe(215); expect(tom.toneDecayMs).toBe(230)
  })

  test('psy5 kit language: filter.res 1..10 → biquad Q (0.5 + 0.45·res), clamped', () => {
    expect(patchToKick({ filter: { res: 10 } }, { sampleRate: SR, durationSec: 0.72 }).filterQ).toBeCloseTo(5.0, 5)
    expect(patchToKick({ filter: { res: 1 } }, { sampleRate: SR, durationSec: 0.72 }).filterQ).toBeCloseTo(0.95, 5)
    expect(patchToKick({ filter: { res: 99 } }, { sampleRate: SR, durationSec: 0.72 }).filterQ).toBeCloseTo(5.0, 5) // clamped
  })

  test('engine.js IS reason-wired (Phase 2 v0.24.0 — the kit system routes REASON_TYPES; the 2023-1a pin said the orchestrator wires later — this is that wiring)', () => {
    expect(ENGINE_SRC).toContain('reason-engines')
    expect(ENGINE_SRC).toContain('renderReasonPcm')
  })
})
