import { describe, expect, test } from 'bun:test'
import {
  ExperienceStore,
  Learner,
  Policy,
  actionKey,
  antiCollisionReward,
  computeStats,
  contextKey,
  defaultReward,
} from '../src/index.ts'
import type { MusicalAction, MusicalContext } from '../src/index.ts'

function ctx(energy = 0.7, section = 'drop'): MusicalContext {
  return {
    key: 'A',
    rootPc: 9,
    scale: 'phrygian-dominant',
    energy,
    style: 'full-on',
    section,
    beatsPerBar: 4,
  }
}

function play(id: string): MusicalAction {
  return { type: 'play', materialId: id }
}
function variation(id: string, transform: string): MusicalAction {
  return { type: 'variation', materialId: id, transform }
}
const DO_NOTHING: MusicalAction = { type: 'do-nothing' }

describe('contextKey', () => {
  test('same context + role → same key', () => {
    expect(contextKey(ctx(), 'lead')).toBe(contextKey(ctx(), 'lead'))
  })
  test('different role → different key', () => {
    expect(contextKey(ctx(), 'lead')).not.toBe(contextKey(ctx(), 'bass'))
  })
  test('different energy bin → different key', () => {
    expect(contextKey(ctx(0.1), 'lead')).not.toBe(contextKey(ctx(0.9), 'lead'))
  })
  test('similar energy → same key (quantization)', () => {
    expect(contextKey(ctx(0.71), 'lead')).toBe(contextKey(ctx(0.74), 'lead'))
  })
})

describe('actionKey', () => {
  test('play action', () => {
    expect(actionKey(play('motif-001'))).toBe('play:motif-001')
  })
  test('variation action', () => {
    expect(actionKey(variation('motif-001', 'transpose'))).toBe('variation:motif-001:transpose')
  })
  test('do-nothing', () => {
    expect(actionKey(DO_NOTHING)).toBe('do-nothing')
  })
})

describe('reward', () => {
  test('sounded is positive', () => {
    expect(defaultReward({ type: 'sounded', durationSec: 0.5 })).toBeGreaterThan(0)
  })
  test('sounded too short is negative (glitch)', () => {
    expect(defaultReward({ type: 'sounded', durationSec: 0.01 })).toBeLessThan(0)
  })
  test('skipped is neutral', () => {
    expect(defaultReward({ type: 'skipped' })).toBe(0)
  })
  test('collided is negative', () => {
    expect(defaultReward({ type: 'collided', reason: 'bass overlap' })).toBeLessThan(0)
  })
  test('antiCollisionReward penalizes collisions more', () => {
    const collision = { type: 'collided' as const, reason: 'x' }
    expect(antiCollisionReward(collision)).toBeLessThan(defaultReward(collision))
  })
})

describe('ExperienceStore', () => {
  test('records experiences and aggregates to records', () => {
    const store = new ExperienceStore()
    store.record(ctx(), 'lead', play('m1'), { type: 'sounded', durationSec: 0.5 }, 1)
    store.record(ctx(), 'lead', play('m1'), { type: 'sounded', durationSec: 0.5 }, 2)
    store.record(ctx(), 'lead', play('m1'), { type: 'collided', reason: 'x' }, 3)
    const recs = store.recordsFor(ctx(), 'lead')
    expect(recs).toHaveLength(1)
    expect(recs[0].trials).toBe(3)
    expect(recs[0].soundedCount).toBe(2)
    expect(recs[0].collidedCount).toBe(1)
  })

  test('separates different actions', () => {
    const store = new ExperienceStore()
    store.record(ctx(), 'lead', play('m1'), { type: 'sounded', durationSec: 0.5 }, 1)
    store.record(ctx(), 'lead', play('m2'), { type: 'sounded', durationSec: 0.5 }, 2)
    expect(store.recordsFor(ctx(), 'lead')).toHaveLength(2)
  })

  test('separates different roles', () => {
    const store = new ExperienceStore()
    store.record(ctx(), 'lead', play('m1'), { type: 'sounded', durationSec: 0.5 }, 1)
    store.record(ctx(), 'bass', play('m1'), { type: 'sounded', durationSec: 0.5 }, 2)
    expect(store.recordsFor(ctx(), 'lead')).toHaveLength(1)
    expect(store.recordsFor(ctx(), 'bass')).toHaveLength(1)
  })

  test('size and uniqueRecords', () => {
    const store = new ExperienceStore()
    store.record(ctx(), 'lead', play('m1'), { type: 'sounded', durationSec: 0.5 }, 1)
    store.record(ctx(), 'lead', play('m1'), { type: 'sounded', durationSec: 0.5 }, 2)
    store.record(ctx(), 'lead', play('m2'), { type: 'sounded', durationSec: 0.5 }, 3)
    expect(store.size).toBe(3)
    expect(store.uniqueRecords).toBe(2)
  })

  test('toJSON / fromJSON round-trip', () => {
    const store = new ExperienceStore()
    store.record(ctx(), 'lead', play('m1'), { type: 'sounded', durationSec: 0.5 }, 1)
    const json = store.toJSON()
    const restored = ExperienceStore.fromJSON(json)
    expect(restored.size).toBe(1)
    expect(restored.uniqueRecords).toBe(1)
  })

  test('reset clears everything', () => {
    const store = new ExperienceStore()
    store.record(ctx(), 'lead', play('m1'), { type: 'sounded', durationSec: 0.5 }, 1)
    store.reset()
    expect(store.size).toBe(0)
    expect(store.uniqueRecords).toBe(0)
  })
})

describe('Policy — DO NOTHING is legal', () => {
  test('cold-start when no experience', () => {
    const store = new ExperienceStore()
    const policy = new Policy({ epsilon: 0 })
    const decision = policy.decide(ctx(), 'lead', store, [play('m1'), play('m2')])
    expect(decision.reason).toBe('cold-start')
    expect(decision.confidence).toBe(0)
  })

  test('exploits the best action after learning', () => {
    const store = new ExperienceStore()
    // m1 always sounds good, m2 always collides.
    for (let i = 0; i < 5; i++)
      store.record(ctx(), 'lead', play('m1'), { type: 'sounded', durationSec: 0.5 }, i)
    for (let i = 0; i < 5; i++)
      store.record(ctx(), 'lead', play('m2'), { type: 'collided', reason: 'x' }, i + 5)
    const policy = new Policy({ epsilon: 0, minTrials: 3 })
    const decision = policy.decide(ctx(), 'lead', store, [play('m1'), play('m2')])
    expect(decision.reason).toBe('exploit')
    expect(decision.action).toEqual(play('m1'))
    expect(decision.confidence).toBeGreaterThan(0)
  })

  test('abstains when best action is below threshold', () => {
    const store = new ExperienceStore()
    // Both candidates collide (negative reward).
    for (let i = 0; i < 5; i++)
      store.record(ctx(), 'lead', play('m1'), { type: 'collided', reason: 'x' }, i)
    for (let i = 0; i < 5; i++)
      store.record(ctx(), 'lead', play('m2'), { type: 'collided', reason: 'x' }, i + 5)
    const policy = new Policy({ epsilon: 0, minTrials: 3, abstainThreshold: 0.1 })
    const decision = policy.decide(ctx(), 'lead', store, [play('m1'), play('m2')])
    expect(decision.action.type).toBe('do-nothing')
    expect(decision.reason).toBe('abstain')
  })

  test('do-nothing is always a candidate (even with no explicit candidates)', () => {
    const store = new ExperienceStore()
    const policy = new Policy({ epsilon: 0 })
    const decision = policy.decide(ctx(), 'lead', store, [])
    expect(decision.action.type).toBe('do-nothing')
  })

  test('exploration: with epsilon=1, always explores', () => {
    const store = new ExperienceStore()
    for (let i = 0; i < 5; i++)
      store.record(ctx(), 'lead', play('m1'), { type: 'sounded', durationSec: 0.5 }, i)
    const policy = new Policy({ epsilon: 1, minTrials: 3 })
    let explored = false
    for (let i = 0; i < 20; i++) {
      const d = policy.decide(ctx(), 'lead', store, [play('m1'), play('m2')])
      if (d.reason === 'explore') explored = true
    }
    expect(explored).toBe(true)
  })

  test('confidence grows with trials', () => {
    const store = new ExperienceStore()
    for (let i = 0; i < 10; i++)
      store.record(ctx(), 'lead', play('m1'), { type: 'sounded', durationSec: 0.5 }, i)
    const policy = new Policy({ epsilon: 0, minTrials: 3 })
    const decision = policy.decide(ctx(), 'lead', store, [play('m1')])
    expect(decision.confidence).toBeGreaterThan(0.4)
  })
})

describe('Learner (facade)', () => {
  test('decide + recordOutcome flow', () => {
    const learner = new Learner({ policy: { epsilon: 0, minTrials: 3 } })
    // Cold-start: no experience yet.
    const d1 = learner.decide(ctx(), 'lead', [play('m1')])
    expect(d1.reason).toBe('cold-start')
    // Record the outcome.
    learner.recordOutcome(ctx(), 'lead', d1.action, { type: 'sounded', durationSec: 0.5 }, 1)
    expect(learner.stats().totalExperiences).toBe(1)
  })

  test('learns to prefer the better action', () => {
    const learner = new Learner({ policy: { epsilon: 0, minTrials: 3 } })
    // Train: m1 good, m2 bad.
    for (let i = 0; i < 5; i++) {
      learner.recordOutcome(ctx(), 'lead', play('m1'), { type: 'sounded', durationSec: 0.5 }, i)
      learner.recordOutcome(ctx(), 'lead', play('m2'), { type: 'collided', reason: 'x' }, i + 5)
    }
    // Now decide: should pick m1.
    const decision = learner.decide(ctx(), 'lead', [play('m1'), play('m2')])
    expect(decision.action).toEqual(play('m1'))
  })

  test('decideAndRecord combines both', () => {
    const learner = new Learner({ policy: { epsilon: 0, minTrials: 3 } })
    const result = learner.decideAndRecord(
      ctx(),
      'lead',
      [play('m1')],
      { type: 'sounded', durationSec: 0.5 },
      1
    )
    expect(result.decision).toBeDefined()
    expect(learner.stats().totalExperiences).toBe(1)
  })

  test('stats include regret, retrieval quality, exploration, abstention', () => {
    const learner = new Learner()
    // Record some mixed experiences.
    learner.recordOutcome(ctx(), 'lead', play('m1'), { type: 'sounded', durationSec: 0.5 }, 1)
    learner.recordOutcome(ctx(), 'lead', play('m2'), { type: 'collided', reason: 'x' }, 2)
    learner.recordOutcome(ctx(), 'lead', play('m1'), { type: 'sounded', durationSec: 0.5 }, 3)
    const stats = learner.stats()
    expect(stats.totalExperiences).toBe(3)
    expect(stats.uniqueRecords).toBe(2)
    expect(stats.regret).toBeGreaterThanOrEqual(0)
    expect(stats.averageReward).toBeGreaterThan(-1)
  })

  test('reset clears everything', () => {
    const learner = new Learner()
    learner.recordOutcome(ctx(), 'lead', play('m1'), { type: 'sounded', durationSec: 0.5 }, 1)
    learner.reset()
    expect(learner.stats().totalExperiences).toBe(0)
  })
})

describe('computeStats', () => {
  test('empty store → zero stats', () => {
    const store = new ExperienceStore()
    const stats = computeStats(store, [])
    expect(stats.totalExperiences).toBe(0)
    expect(stats.uniqueRecords).toBe(0)
    expect(stats.regret).toBe(0)
    expect(stats.retrievalQuality).toBe(0)
  })

  test('regret is zero when only one action exists', () => {
    const store = new ExperienceStore()
    for (let i = 0; i < 5; i++)
      store.record(ctx(), 'lead', play('m1'), { type: 'sounded', durationSec: 0.5 }, i)
    const stats = computeStats(store, [])
    expect(stats.regret).toBe(0)
  })

  test('regret is positive when a worse action was also tried', () => {
    const store = new ExperienceStore()
    for (let i = 0; i < 5; i++)
      store.record(ctx(), 'lead', play('m1'), { type: 'sounded', durationSec: 0.5 }, i)
    for (let i = 0; i < 5; i++)
      store.record(ctx(), 'lead', play('m2'), { type: 'collided', reason: 'x' }, i + 5)
    const stats = computeStats(store, [])
    expect(stats.regret).toBeGreaterThan(0)
  })
})
