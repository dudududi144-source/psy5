import { describe, expect, test } from 'bun:test'
import {
  actionKey, contextKey, BanditLearner, BanditPolicy, LearningStore, DO_NOTHING, BanditError,
} from '../foundation/learning/bandit.mjs'
import { mulberry32, subSeed, fnv1a } from '../foundation/foundation.mjs'
import {
  ensureCop, copilotInit, copilotReload, copilotSnapshot, buildContext, candidateActions,
  copilotBarHook, copilotGesture, copilotApply, copilotVote, copilotToggleLearn, copilotStats,
} from '../js/copilot.js'
import { I } from '../js/state.js'
import { buildStyle } from '../js/presets.js'

const seedRng = (label: string, i: number) => mulberry32(subSeed(parseInt(fnv1a('test').slice(0, 8), 16) >>> 0, label + '#' + i))

/* ---------------- foundation: keys ---------------- */
describe('foundation/learning bandit — keys', () => {
  test('actionKey is order-independent and distinguishes custom fields', () => {
    expect(actionKey({ type: 'layer-toggle', track: 2 })).toBe(actionKey({ track: 2, type: 'layer-toggle' }))
    expect(actionKey({ type: 'layer-toggle', track: 2 })).not.toBe(actionKey({ type: 'layer-toggle', track: 3 }))
    expect(actionKey({ type: 'fill' })).not.toBe(actionKey({ type: 'variation' }))
    expect(actionKey(DO_NOTHING)).toBe('type=do-nothing')
  })
  test('contextKey is order-independent', () => {
    expect(contextKey({ a: 1, b: 'x' })).toBe(contextKey({ b: 'x', a: 1 }))
  })
  test('bad inputs throw BanditError', () => {
    expect(() => actionKey(null as any)).toThrow(BanditError)
    expect(() => contextKey(42 as any)).toThrow(BanditError)
  })
})

/* ---------------- foundation: policy semantics ---------------- */
describe('foundation/learning bandit — policy', () => {
  test('rng is REQUIRED (determinism rule)', () => {
    const l = new BanditLearner({})
    expect(() => l.decide({ c: 1 }, 'copilot', [{ type: 'fill' }], {} as any)).toThrow(BanditError)
  })
  test('cold-start explores untried candidates deterministically', () => {
    const l1 = new BanditLearner({ epsilon: 0.5, minTrials: 3 })
    const l2 = new BanditLearner({ epsilon: 0.5, minTrials: 3 })
    const cands = [{ type: 'fill' }, { type: 'variation' }]
    const seq1: string[] = [], seq2: string[] = []
    for (let i = 0; i < 5; i++) {
      const d1 = l1.decide({ c: 1 }, 'copilot', cands, { rng: seedRng('cs', i) })
      const d2 = l2.decide({ c: 1 }, 'copilot', cands, { rng: seedRng('cs', i) })
      seq1.push(d1.action.type + ':' + d1.reason)
      seq2.push(d2.action.type + ':' + d2.reason)
    }
    expect(seq1).toEqual(seq2)
    expect(seq1.every((s) => s.endsWith('cold-start'))).toBe(true)
  })
  test('exploit: preference ranking A>B after consistent rewards', () => {
    const l = new BanditLearner({ epsilon: 0.5, minTrials: 1, abstainThreshold: 0.1 })
    const ctx = { c: 1 }, cands = [{ type: 'fill' }, { type: 'variation' }]
    for (let i = 0; i < 30; i++) {
      const d = l.decide(ctx, 'copilot', cands, { rng: seedRng('ex', i) })
      l.recordOutcome(ctx, 'copilot', d.action, d.action.type === 'fill' ? 1 : 0, i)
    }
    const recs = l.store.allRecords()
    const a = recs.find((r) => r.action.type === 'fill')!
    const b = recs.find((r) => r.action.type === 'variation')
    expect(a).toBeDefined()
    expect(a.avgReward).toBe(1)
    expect(b).toBeDefined() // exploration must have tried both
    if (b) expect(a.avgReward).toBeGreaterThan(b.avgReward)
    const probe = new BanditPolicy({ epsilon: 0, minTrials: 1, abstainThreshold: 0.1 })
    const pd = probe.decide(contextKey(ctx), 'copilot', cands, l.store, seedRng('ex', 99))
    expect(pd.action.type).toBe('fill')
    expect(pd.reason).toBe('exploit')
  })
  test('abstention fires when all expected rewards < threshold', () => {
    const l = new BanditLearner({ epsilon: 0, minTrials: 1, abstainThreshold: 0.2 })
    const ctx = { c: 2 }, cands = [{ type: 'fill' }, { type: 'variation' }]
    for (let i = 0; i < 8; i++) {
      const d = l.decide(ctx, 'copilot', cands, { rng: seedRng('ab', i) })
      l.recordOutcome(ctx, 'copilot', d.action, 0, i)
    }
    const d = l.decide(ctx, 'copilot', cands, { rng: seedRng('ab', 99) })
    expect(d.action.type).toBe('do-nothing')
    expect(d.reason).toBe('abstain')
  })
  test('DO_NOTHING is always available, even with zero candidates', () => {
    const l = new BanditLearner({ epsilon: 0, minTrials: 1, abstainThreshold: 0.5 })
    const ctx = { c: 3 }
    const d = l.decide(ctx, 'copilot', [], { rng: seedRng('dn', 0) })
    expect(d.action.type).toBe('do-nothing')
    l.recordOutcome(ctx, 'copilot', d.action, 0, 0)
  })
  test('serialization round-trip preserves decisions and stats', () => {
    const l = new BanditLearner({ epsilon: 0, minTrials: 1, abstainThreshold: 0.1 })
    const ctx = { c: 4 }, cands = [{ type: 'fill' }, { type: 'variation' }]
    for (let i = 0; i < 6; i++) {
      const d = l.decide(ctx, 'copilot', cands, { rng: seedRng('rt', i) })
      l.recordOutcome(ctx, 'copilot', d.action, d.action.type === 'fill' ? 1 : 0, i)
    }
    const json = JSON.parse(JSON.stringify(l.toJSON()))
    const l2 = BanditLearner.fromJSON(json)
    expect(l2.stats()).toEqual(l.stats())
    const d1 = l.decide(ctx, 'copilot', cands, { rng: seedRng('rt', 50) })
    const d2 = l2.decide(ctx, 'copilot', cands, { rng: seedRng('rt', 50) })
    expect(actionKey(d2.action)).toBe(actionKey(d1.action))
    expect(d2.reason).toBe(d1.reason)
  })
  test('same seed + same history → same suggestions (determinism)', () => {
    const run = () => {
      const l = new BanditLearner({ epsilon: 0.15, minTrials: 2, abstainThreshold: 0.1 })
      const ctx = { c: 5 }, cands = [{ type: 'fill' }, { type: 'variation' }]
      const seq: string[] = []
      for (let i = 0; i < 12; i++) {
        const d = l.decide(ctx, 'copilot', cands, { rng: seedRng('dt', i) })
        seq.push(actionKey(d.action) + '/' + d.reason)
        l.recordOutcome(ctx, 'copilot', d.action, d.action.type === 'fill' ? 1 : 0, i)
      }
      return seq
    }
    expect(run()).toEqual(run())
  })
  test('store fromJSON rejects bad payloads', () => {
    expect(() => LearningStore.fromJSON({} as any)).toThrow(BanditError)
    expect(() => BanditLearner.fromJSON({ v: 2 } as any)).toThrow(BanditError)
  })
  test('stats reports do-nothing rate and top action', () => {
    const l = new BanditLearner({ epsilon: 0, minTrials: 1, abstainThreshold: 0.9 })
    const ctx = { c: 6 }, cands = [{ type: 'fill' }]
    l.decide(ctx, 'copilot', cands, { rng: seedRng('st', 0) }) // cold-start → fill
    l.recordOutcome(ctx, 'copilot', { type: 'fill' }, 0.5, 0)
    const d1 = l.decide(ctx, 'copilot', cands, { rng: seedRng('st', 1) }) // exploit fill (0.5 >= 0.9? no → abstain)
    const st = l.stats()
    expect(st.decisions).toBe(2)
    if (d1.reason === 'abstain') expect(st.doNothing).toBe(1)
    expect(st.topAction).not.toBeNull()
    expect(st.topAction!.avgReward).toBe(0.5)
  })
})

/* ---------------- device glue (js/copilot.js) ---------------- */
function freshDevice() {
  I.p = buildStyle('TECHNO', 42)
  I.cop = null
  copilotInit()
}
describe('device co-pilot glue', () => {
  test('context is quantized and reflects layers/density/gestures', () => {
    freshDevice()
    const ctx = buildContext()
    expect(ctx.layers).toBeGreaterThanOrEqual(0)
    expect(ctx.layers).toBeLessThanOrEqual(4)
    expect(ctx.density).toBeGreaterThanOrEqual(0)
    expect(ctx.energy).toBe(Math.round(ctx.energy * 4) / 4)
    expect(ctx.macros.length).toBe(4)
    expect(ctx.gestures.fill).toBeDefined()
    copilotGesture('fill'); copilotGesture('fill'); copilotGesture('fill'); copilotGesture('fill')
    expect(buildContext().gestures.fill).toBe(4) // bucket caps at 4
  })
  test('candidates map onto existing device paths', () => {
    freshDevice()
    const cands = candidateActions(I.p)
    const types = cands.map((c) => c.type)
    expect(types).toContain('fill')
    expect(types).toContain('variation')
    expect(types).toContain('groove-toggle')
    const gt = cands.find((c) => c.type === 'groove-toggle') as any
    expect(['straight', 'psy-push']).toContain(gt.to)
    expect(gt.to).not.toBe(I.p.groove)
  })
  test('decisions fire every 4 bars and LEARN OFF is fully inert', () => {
    freshDevice()
    expect(copilotStats().decisions).toBe(0)
    copilotBarHook(); copilotBarHook(); copilotBarHook()
    expect(copilotStats().decisions).toBe(0)
    copilotBarHook()
    expect(copilotStats().decisions).toBe(1)
    copilotToggleLearn() // OFF
    for (let i = 0; i < 8; i++) copilotBarHook()
    expect(copilotStats().decisions).toBe(1)
    expect(copilotStats().sug).toBeNull()
    copilotToggleLearn() // ON again
  })
  test('reward mapping: apply+user fill → +0.5, panic → −0.5, timeout → 0, vote → ±1', () => {
    freshDevice()
    const c = ensureCop()
    const mkSug = () => ({ decision: { action: { type: 'fill' }, reason: 'cold-start', confidence: 0, expectedReward: null, contextKey: 'x', role: 'copilot', at: 0 }, ctx: { t: 1 }, applied: false, applyBar: 0, resolved: true, voted: false })
    // apply + user fill within 2 bars → +0.5
    c.sug = mkSug(); copilotApply()
    expect(c.applies).toBe(1)
    copilotGesture('fill')
    const exps = c.learner.store.experiences
    expect(exps[exps.length - 1].reward).toBe(0.5)
    // new suggestion, panic within window → −0.5
    c.sug = mkSug(); copilotApply(); copilotGesture('panic')
    expect(exps[exps.length - 1].reward).toBe(-0.5)
    // new suggestion, no signal → window closes at 0
    c.sug = mkSug(); copilotApply()
    copilotBarHook(); copilotBarHook(); copilotBarHook()
    expect(exps[exps.length - 1].reward).toBe(0)
    // explicit vote +1
    c.sug = mkSug(); copilotVote(1)
    expect(exps[exps.length - 1].reward).toBe(1)
    expect(c.sug.voted).toBe(true)
  })
  test('persistence: snapshot → reload round-trip; absent field → fresh', () => {
    freshDevice()
    for (let i = 0; i < 8; i++) copilotBarHook()
    const before = copilotStats()
    const snap = copilotSnapshot()
    expect(snap.v).toBe(1)
    I.p.copilot = JSON.parse(JSON.stringify(snap))
    copilotReload()
    const after = copilotStats()
    expect(after.decisions).toBe(before.decisions)
    // absent field → fresh learner
    delete I.p.copilot
    copilotReload()
    expect(copilotStats().decisions).toBe(0)
  })
  test('continuity: reload from snapshot continues the seeded decision stream', () => {
    freshDevice()
    for (let i = 0; i < 4; i++) copilotBarHook()
    const d1count = copilotStats().decisions
    expect(d1count).toBe(1)
    const snap = copilotSnapshot()
    I.p.copilot = JSON.parse(JSON.stringify(snap))
    copilotReload()
    for (let i = 0; i < 4; i++) copilotBarHook()
    const withReload = copilotStats().decisions
    // fresh run of 8 decisions must hit the same count
    freshDevice()
    for (let i = 0; i < 8; i++) copilotBarHook()
    expect(copilotStats().decisions).toBe(withReload)
  })
})
