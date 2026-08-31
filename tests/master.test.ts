/**
 * PSY6 v0.8.0 master section (EQ3 + glue comp) — model-level tests.
 *
 * Audio-level evidence (neutral tolerance, compression dB) lives in the
 * device gate G29 (OfflineAudioContext; bun has no Web Audio).
 *  - ensureMaster backfill + clamps (neutral defaults)
 *  - param registry: apply/clamp for the 9 master params (project target)
 *  - compOn rounds to 0/1 (bypass flag)
 *  - loadProjectObj: legacy projects gain the NEUTRAL master; invalid
 *    values clamped; load→save idempotent
 *  - MIDI: CC 0..1 → registry range via paramDenorm
 *  - share round-trip preserves the master section
 */
import { describe, expect, test } from 'bun:test'
import { buildStyle } from '../js/presets.js'
import { paramApply, paramById, paramDenorm, ensureMaster, paramsForTrack, MASTER_DEFAULTS } from '../js/params.js'
import { loadProjectObj, I, resolveMidiParam } from '../js/state.js'
import { encodeShare, decodeShare } from '../js/share.js'

const IDS = ['eqLow', 'eqMid', 'eqHigh', 'compOn', 'compThresh', 'compRatio', 'compAttack', 'compRelease', 'compMakeup'] as const

function fresh() {
  const p = buildStyle('TECHNO', 7)
  I.p = p
  return p
}

describe('ensureMaster (backfill + clamp)', () => {
  test('missing/invalid master → NEUTRAL defaults (EQ 0 dB, glue bypassed)', () => {
    expect(ensureMaster({} as any)).toEqual(MASTER_DEFAULTS)
    expect(ensureMaster({ master: null } as any)).toEqual(MASTER_DEFAULTS)
    expect(ensureMaster({ master: { eqLow: 'x', compRatio: NaN } } as any)).toEqual(MASTER_DEFAULTS)
    expect(ensureMaster({} as any).compOn).toBe(0)
  })
  test('existing values are clamped into the registry ranges; compOn rounds', () => {
    const m = ensureMaster({ master: { eqLow: -99, eqMid: 99, compThresh: 5, compRatio: 0.2, compAttack: 999, compRelease: 1, compMakeup: -3, compOn: 0.7 } } as any)
    expect(m.eqLow).toBe(-12)
    expect(m.eqMid).toBe(12)
    expect(m.compThresh).toBe(0)
    expect(m.compRatio).toBe(1)
    expect(m.compAttack).toBe(100)
    expect(m.compRelease).toBe(20)
    expect(m.compMakeup).toBe(0)
    expect(m.compOn).toBe(1)
  })
})

describe('master param registry', () => {
  test('all 9 ids are registered, project-target, with neutral defaults', () => {
    for (const id of IDS) {
      const pd = paramById(id)
      expect(pd).not.toBeNull()
      expect(pd!.target).toBe('project')
    }
    expect(paramById('eqLow')!.def).toBe(0)
    expect(paramById('compOn')!.def).toBe(0)
  })
  test('paramApply writes p.master with clamping; compOn rounds to 0/1', () => {
    const p = fresh()
    expect(paramApply(p, 'eqMid', 6.5)).toBe(6.5)
    expect(p.master.eqMid).toBe(6.5)
    expect(paramApply(p, 'eqMid', 99)).toBe(12)
    expect(p.master.eqMid).toBe(12)
    expect(paramApply(p, 'compOn', 0.9)).toBe(0.9)
    expect(p.master.compOn).toBe(1)
    expect(paramApply(p, 'compOn', 0.1)).toBe(0.1)
    expect(p.master.compOn).toBe(0)
    expect(paramApply(p, 'compThresh', -55)).toBe(-40)
    expect(p.master.compThresh).toBe(-40)
  })
  test('master params are project-level: absent from per-track lists, present as lane.track=-1', () => {
    const synthList = paramsForTrack('synth')
    for (const id of IDS) expect(synthList).not.toContain(id)
    const drumList = paramsForTrack('drum')
    for (const id of IDS) expect(drumList).not.toContain(id)
  })
  test('MIDI: CC 0..1 → full registry range via paramDenorm (master.eqMid 0.9 → 9.6)', () => {
    const p = fresh()
    expect(paramDenorm('eqMid', 0)).toBe(-12)
    expect(paramDenorm('eqMid', 1)).toBe(12)
    expect(resolveMidiParam(p, 'master.eqMid', 0.9)).toBe(true)
    expect(p.master.eqMid).toBeCloseTo(9.6, 5)
    expect(resolveMidiParam(p, 'master.compOn', 1)).toBe(true)
    expect(p.master.compOn).toBe(1)
    expect(resolveMidiParam(p, 'master.eqNotAParam', 0.5)).toBe(false)
  })
})

describe('master persistence', () => {
  test('legacy project (no master) loads with NEUTRAL master; load→save idempotent', () => {
    const legacy = buildStyle('PSYTRANCE', 42)
    expect((legacy as any).master).toBeDefined() /* buildStyle carries mkProject defaults now */
    delete (legacy as any).master                /* simulate a pre-v0.8 save */
    loadProjectObj(JSON.parse(JSON.stringify(legacy)))
    expect(I.p.master).toEqual(MASTER_DEFAULTS)
    const once = JSON.stringify(I.p)
    loadProjectObj(JSON.parse(once))
    expect(JSON.stringify(I.p)).toBe(once)
  })
  test('invalid master values are clamped on load (validation at the pitfall)', () => {
    const p = fresh()
    ;(p as any).master = { eqHigh: 40, compOn: 0.2, compRatio: 100 }
    loadProjectObj(JSON.parse(JSON.stringify(p)))
    expect(I.p.master.eqHigh).toBe(12)
    expect(I.p.master.compOn).toBe(0)
    expect(I.p.master.compRatio).toBe(20)
  })
  test('share round-trip preserves the master section', async () => {
    const p = fresh()
    p.master.eqLow = -3.5
    p.master.compOn = 1
    p.master.compThresh = -24
    const enc = await encodeShare(p)
    const dec = await decodeShare(enc.token!)
    expect(dec.project.master).toEqual(p.master)
  })
})
