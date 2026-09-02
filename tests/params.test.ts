/**
 * PSY6 v0.5.0 automation tests.
 *
 *  - registry completeness: every param applies through its path and clamps
 *  - recordPoint math: insert/replace/sort/cap
 *  - quantStep: 1/16 quantize on/off + loop wrap
 *  - applyLanes: 'state' lanes write through the registry; 'lock' lanes skip
 *  - persistence: lanes round-trip; legacy lanes backfill correct modes
 *  - midiMap → lane recording integration (applyMidiParam path mapping)
 */
import { describe, expect, test } from 'bun:test'
import { PARAMS, paramById, paramApply, paramNorm, paramDenorm, paramsForTrack, laneModeBackfill } from '../js/params.js'
import { applyLanes, quantStep, recordPoint } from '../js/autorec.js'
import { buildStyle } from '../js/presets.js'
import { loadProjectObj, I, midiPathToParam } from '../js/state.js'
import { deep } from '../js/model.js'

function fakeTrack() {
  return { sound: { cutoff: 1500, res: 3, atk: 0.005, dec: 0.3, sus: 0.6, rel: 0.2, gate: 0.6, detune: 8, lfoRate: 0, lfoDepth: 0 }, mix: { vol: 0.8, pan: 0, sendA: 0, sendB: 0 }, scAmount: 0, scAttackMs: 12, scHoldMs: 0, scReleaseMs: 140 }
}
function fakeProject() {
  const p = buildStyle('TECHNO', 7)
  return p
}

describe('param registry', () => {
  test('every param applies through its path and clamps', () => {
    const t = fakeTrack()
    const p = fakeProject()
    for (const pd of PARAMS) {
      const target = pd.target === 'project' ? p : t
      /* above max → clamped to max */
      const hi = paramApply(target, pd.id, pd.max + 1000)
      expect(hi).toBe(pd.max)
      /* below min → clamped to min */
      const lo = paramApply(target, pd.id, pd.min - 1000)
      expect(lo).toBe(pd.min)
      /* the value actually landed in the state path */
      if (pd.target === 'project') {
        if (pd.id === 'masterVol') expect(p.masterVol).toBe(pd.min)
        else if ((p as any).master && pd.id in (p as any).master) expect((p as any).master[pd.id]).toBe(pd.min) /* v0.8.0 master section */
        else expect(p.macroVals[+pd.id.slice(6)]).toBe(pd.min)
      } else if (pd.id.startsWith('mix.')) {
        expect(t.mix[pd.id.slice(4)]).toBe(pd.min)
      } else if (pd.id.startsWith('sc')) {
        const key = pd.id === 'scAmount' ? 'scAmount' : pd.id === 'scAttackMs' ? 'scAttackMs' : pd.id === 'scHoldMs' ? 'scHoldMs' : 'scReleaseMs'
        expect(t[key]).toBe(pd.id === 'scAmount' || pd.id === 'scAttackMs' || pd.id === 'scHoldMs' ? Math.round(pd.min) : Math.max(pd.min, Math.round(pd.min)))
      } else if (pd.id.startsWith('smp')) {
        /* v0.10.0 sample-voice params → track.sampleParams (ensureVoice path) */
        const map: any = { smpGain: 'gain', smpTune: 'tune', smpStart: 'startPct', smpEnd: 'endPct', smpRev: 'reverse', smpAtk: 'attackMs', smpRel: 'releaseMs' }
        const want = pd.id === 'smpRev' ? (pd.min >= 0.5 ? 1 : 0) : (pd.id === 'smpAtk' || pd.id === 'smpRel') ? Math.round(pd.min) : pd.min
        expect((t as any).sampleParams[map[pd.id]]).toBe(want)
      } else {
        expect(t.sound[pd.id]).toBe(pd.min)
      }
    }
  })
  test('unknown param id returns null (no throw)', () => {
    const t = fakeTrack()
    expect(paramApply(t, 'nonexistent', 0.5)).toBeNull()
    expect(paramById('nonexistent')).toBeNull()
  })
  test('norm/denorm round-trip', () => {
    for (const pd of PARAMS) {
      const mid = pd.min + (pd.max - pd.min) / 2
      expect(paramNorm(pd.id, mid)).toBeCloseTo(0.5, 10)
      expect(paramDenorm(pd.id, 0)).toBe(pd.min)
      expect(paramDenorm(pd.id, 1)).toBe(pd.max)
    }
  })
  test('paramsForTrack: synth tracks get sound params, drum tracks do not', () => {
    const synth = paramsForTrack('synth')
    const drum = paramsForTrack('drum')
    expect(synth).toContain('cutoff')
    expect(drum).not.toContain('cutoff')
    expect(drum).toContain('mix.vol')
    expect(drum).toContain('scAmount')
    expect(synth).not.toContain('masterVol')
  })
})

describe('recordPoint + quantStep', () => {
  test('inserts sorted, replaces at identical step', () => {
    const lane = { pts: [] }
    recordPoint(lane, 8, 0.5)
    recordPoint(lane, 0, 0.1)
    recordPoint(lane, 4, 0.3)
    expect(lane.pts).toEqual([[0, 0.1], [4, 0.3], [8, 0.5]])
    recordPoint(lane, 4, 0.9)   /* same step → replace */
    expect(lane.pts).toEqual([[0, 0.1], [4, 0.9], [8, 0.5]])
    expect(lane.pts.length).toBe(3)
  })
  test('caps at 512 points', () => {
    const lane = { pts: [] }
    for (let i = 0; i < 600; i++) recordPoint(lane, i, i / 600)
    expect(lane.pts.length).toBe(512)
  })
  test('quantStep: on snaps to whole steps, off keeps fractions, wraps the loop', () => {
    expect(quantStep(3.6, 16, true)).toBe(4)
    expect(quantStep(3.2, 16, true)).toBe(3)
    expect(quantStep(3.6, 16, false)).toBeCloseTo(3.6, 10)
    expect(quantStep(17, 16, true)).toBe(1)
    expect(quantStep(-1, 16, true)).toBe(15)
  })
})

describe('applyLanes', () => {
  test("'state' lanes write through the registry; 'lock' lanes are skipped", () => {
    const p = fakeProject()
    p.lanes = [
      { track: 2, param: 'mix.sendA', mode: 'state', pts: [[0, 0.2], [8, 0.8], [16, 0.2]] },
      { track: 5, param: 'cutoff', mode: 'lock', pts: [[0, 500], [16, 5000]] },
      { track: -1, param: 'masterVol', mode: 'state', pts: [[0, 0.4]] },
    ]
    const cutoffBefore = p.tracks[5].sound.cutoff
    const r0 = applyLanes(p, 0)
    expect(p.tracks[2].mix.sendA).toBeCloseTo(0.2, 10)
    expect(p.masterVol).toBeCloseTo(0.4, 10)
    expect(r0.mixed).toBe(true)
    expect(r0.macroed).toBe(false)
    /* interpolation mid-segment */
    applyLanes(p, 4)
    expect(p.tracks[2].mix.sendA).toBeCloseTo(0.5, 10)
    /* lock lane never touches track state (legacy per-voice path only) */
    expect(p.tracks[5].sound.cutoff).toBe(cutoffBefore)
  })
  test('macro lanes flag macroed so the caller re-resolves targets', () => {
    const p = fakeProject()
    p.lanes = [{ track: -1, param: 'macro.0', mode: 'state', pts: [[0, 0.9]] }]
    const r = applyLanes(p, 0)
    expect(p.macroVals[0]).toBeCloseTo(0.9, 10)
    expect(r.macroed).toBe(true)
  })
})

describe('persistence + backfill', () => {
  test('lane with mode survives loadProjectObj round-trip', () => {
    const p = fakeProject()
    p.lanes = [
      { track: 5, param: 'cutoff', mode: 'lock', pts: [[0, 0.2], [16, 0.8]] },
      { track: 2, param: 'mix.sendA', mode: 'state', pts: [[0, 0.1], [8, 0.9]] },
      { track: -1, param: 'masterVol', mode: 'state', pts: [[0, 0.7]] },
    ]
    loadProjectObj(deep(p))
    const whole = JSON.stringify(I.p)
    loadProjectObj(JSON.parse(whole))
    expect(JSON.stringify(I.p)).toBe(whole)
    expect(I.p.lanes.length).toBe(3)
    expect(I.p.lanes[1].mode).toBe('state')
  })
  test('legacy lane (no mode) backfills: sound → lock, others → state', () => {
    expect(laneModeBackfill('cutoff', undefined)).toBe('lock')
    expect(laneModeBackfill('mix.vol', undefined)).toBe('state')
    expect(laneModeBackfill('masterVol', undefined)).toBe('state')
    expect(laneModeBackfill('cutoff', 'state')).toBe('state')  /* explicit wins */
    const p = fakeProject()
    p.lanes = [{ track: 5, param: 'cutoff', pts: [[0, 0.5]] }]
    loadProjectObj(deep(p))
    expect(I.p.lanes[0].mode).toBe('lock')
  })
})

describe('midiMap → lane recording integration', () => {
  test('midiPathToParam maps all documented path shapes', () => {
    expect(midiPathToParam('track.2.mix.vol')).toEqual({ track: 2, param: 'mix.vol' })
    expect(midiPathToParam('track.2.scAmount')).toEqual({ track: 2, param: 'scAmount' })
    expect(midiPathToParam('master.vol')).toEqual({ track: -1, param: 'masterVol' })
    expect(midiPathToParam('macro.3')).toEqual({ track: -1, param: 'macro.3' })
    expect(midiPathToParam('garbage')).toBeNull()
  })
})
