/**
 * PSY6 v0.10.0 P2 — sample voice model tests (pure — no audio context).
 *
 *  - samplePlayback: tune math (rate/duration), pct slicing, degenerate guard
 *  - ensureVoice: canonical defaults + clamps + idempotency (loadProjectObj
 *    silent-drop pitfall covered by construction)
 *  - persistence: voice fields survive JSON round-trips byte-stably, remain
 *    metadata-only (no PCM), legacy projects default to voiceMode 'synth'
 *  - registry: smp* params write through paramApply clamped
 */
import { describe, expect, test } from 'bun:test'
import { samplePlayback, ensureVoice, SAMPLE_PARAM_DEFAULTS, SAMPLE_PARAM_RANGES } from '../js/samplestore.js'
import { paramApply } from '../js/params.js'
import { loadProjectObj } from '../js/state.js'
import { compose } from '../js/composer.js'

const clone = (x: any) => JSON.parse(JSON.stringify(x))

describe('samplePlayback (pure math)', () => {
  test('tune +12 → rate 2, wall support halves; −12 → doubles', () => {
    const dur = 0.25
    const a = samplePlayback({ tune: 0, startPct: 0, endPct: 100 }, dur)
    expect(a.rate).toBe(1)
    expect(a.durSec).toBeCloseTo(0.25, 9)
    const up = samplePlayback({ tune: 12, startPct: 0, endPct: 100 }, dur)
    expect(up.rate).toBeCloseTo(2, 9)
    expect(up.durSec).toBeCloseTo(0.125, 9)   /* the support HALVES */
    const dn = samplePlayback({ tune: -12, startPct: 0, endPct: 100 }, dur)
    expect(dn.durSec).toBeCloseTo(0.5, 9)
  })
  test('pct slice → offset + length; degenerate endPct≤startPct → full slice', () => {
    const s = samplePlayback({ tune: 0, startPct: 25, endPct: 75 }, 2)
    expect(s.offsetSec).toBeCloseTo(0.5, 9)
    expect(s.durSec).toBeCloseTo(1.0, 9)
    const d = samplePlayback({ tune: 0, startPct: 80, endPct: 80 }, 2)
    expect(d.offsetSec).toBeCloseTo(0, 9)
    expect(d.durSec).toBeCloseTo(2, 9)
  })
  test('clamped to the documented ranges', () => {
    expect(samplePlayback({ tune: 99 }, 1).rate).toBe(Math.pow(2, 2))
    expect(samplePlayback({ tune: -99 }, 1).rate).toBe(Math.pow(2, -2))
    expect(samplePlayback({ startPct: -5, endPct: 150 }, 1).offsetSec).toBe(0)
  })
})

describe('ensureVoice (canonical model)', () => {
  test('defaults backfilled in canonical key order; idempotent', () => {
    const t: any = {}
    ensureVoice(t)
    expect(t.voiceMode).toBe('synth')
    expect(Object.keys(t.sampleParams)).toEqual(Object.keys(SAMPLE_PARAM_DEFAULTS))
    expect(t.sampleParams).toEqual(SAMPLE_PARAM_DEFAULTS)
    const before = JSON.stringify(t)
    ensureVoice(t)
    expect(JSON.stringify(t)).toBe(before) /* idempotent */
  })
  test('clamps: gain 5→2, tune −99→−24, reverse 0.7→1, ms rounding', () => {
    const t: any = { sampleParams: { gain: 5, tune: -99, startPct: -3, endPct: 150, reverse: 0.7, attackMs: 55.6, releaseMs: 999 } }
    ensureVoice(t)
    expect(t.sampleParams.gain).toBe(2)
    expect(t.sampleParams.tune).toBe(-24)
    expect(t.sampleParams.startPct).toBe(0)
    expect(t.sampleParams.endPct).toBe(100)
    expect(t.sampleParams.reverse).toBe(1)
    expect(t.sampleParams.attackMs).toBe(56)
    expect(t.sampleParams.releaseMs).toBe(500)
  })
  test('garbage fields sanitized (silent-drop pitfall)', () => {
    const t: any = { voiceMode: 'WEIRD', sampleId: 42, sampleMeta: 'nope', sampleParams: 'nope' }
    ensureVoice(t)
    expect(t.voiceMode).toBe('synth')
    expect(t.sampleId).toBeNull()
    expect(t.sampleMeta).toBeNull()
    expect(t.sampleParams).toEqual(SAMPLE_PARAM_DEFAULTS)
  })
})

describe('persistence (canonical rebuild + metadata-only)', () => {
  test('voice fields survive loadProjectObj byte-stably; legacy defaults synth', () => {
    const p: any = compose('FULL-ON', 3, 424242).project
    p.tracks[0].voiceMode = 'sample'
    p.tracks[0].sampleId = 'Sxyz'
    p.tracks[0].sampleMeta = { name: 'kick.wav', durationSec: 0.42, peak: 0.95 }
    p.tracks[0].sampleParams = { gain: 1.5, tune: 3, startPct: 10, endPct: 90, reverse: 1, attackMs: 5, releaseMs: 120, sliceIdx: 0 }
    const loaded = loadProjectObj(clone(p))
    expect(loaded.tracks[0].voiceMode).toBe('sample')
    expect(loaded.tracks[0].sampleId).toBe('Sxyz')
    expect(loaded.tracks[0].sampleMeta.name).toBe('kick.wav')
    expect(loaded.tracks[0].sampleParams).toEqual({ gain: 1.5, tune: 3, startPct: 10, endPct: 90, reverse: 1, attackMs: 5, releaseMs: 120, sliceIdx: 0 })
    /* load→save byte stability: a second load of the loaded JSON is a fixpoint */
    const again = loadProjectObj(clone(loaded))
    expect(JSON.stringify(again)).toBe(JSON.stringify(loaded))
    /* legacy: untouched tracks default to synth voice with default params */
    expect(loaded.tracks[4].voiceMode).toBe('synth')
    expect(loaded.tracks[4].sampleParams).toEqual(SAMPLE_PARAM_DEFAULTS)
    /* no PCM anywhere in the project JSON */
    expect(JSON.stringify(loaded).toLowerCase().includes('"pcm"')).toBe(false)
  })
  test('out-of-range persisted values are clamped on load (canonical)', () => {
    const p: any = compose('FULL-ON', 3, 424242).project
    p.tracks[0].sampleParams = { gain: 42, tune: 999, startPct: 0, endPct: 100, reverse: 9, attackMs: -5, releaseMs: 1e9 }
    const loaded = loadProjectObj(clone(p))
    const sp = loaded.tracks[0].sampleParams
    expect(sp.gain).toBe(2)
    expect(sp.tune).toBe(24)
    expect(sp.reverse).toBe(1)
    expect(sp.attackMs).toBe(0)
    expect(sp.releaseMs).toBe(500)
  })
})

describe('registry integration (smp* params)', () => {
  test('paramApply writes through ensureVoice, clamped', () => {
    const t: any = {}
    expect(paramApply(t, 'smpGain', 5)).toBe(2)
    expect(t.sampleParams.gain).toBe(2)
    expect(paramApply(t, 'smpTune', -99)).toBe(-24)
    expect(t.sampleParams.tune).toBe(-24)
    expect(paramApply(t, 'smpRev', 0.9)).toBeCloseTo(0.9, 9)
    expect(t.sampleParams.reverse).toBe(1)
    expect(paramApply(t, 'smpAtk', 12.4)).toBeCloseTo(12.4, 9)
    expect(t.sampleParams.attackMs).toBe(12)
    expect(paramApply(t, 'smpNope', 1)).toBeNull()
  })
  test('smp* params are state-lane automatable for drum AND synth tracks', () => {
    /* paramsForTrack via the module: STATE params (non-SOUND_IDS) — verified
       indirectly: paramApply works for both kinds; lane-mode backfill sends
       unknown ids to 'state' (tested in the automation suite). */
    const d: any = { kind: 'drum' }, s: any = { kind: 'synth' }
    paramApply(d, 'smpTune', 7)
    paramApply(s, 'smpTune', 7)
    expect(d.sampleParams.tune).toBe(7)
    expect(s.sampleParams.tune).toBe(7)
    expect(SAMPLE_PARAM_RANGES.tune).toEqual([-24, 24])
  })
})
