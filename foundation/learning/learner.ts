/**
 * Learner — the high-level facade combining store + policy + stats.
 *
 * Devices and orchestrators interact with this single class. It wraps the
 * ExperienceStore, Policy, and stats computation into one coherent API.
 */

import type { MusicalAction, MusicalContext, MusicalOutcome } from '@psy-foundation/protocol'
import { Policy } from './policy.ts'
import type { RewardFunction } from './reward.ts'
import { defaultReward } from './reward.ts'
import { computeStats } from './stats.ts'
import { ExperienceStore } from './store.ts'
import type { Decision, LearningStats, PolicyOptions } from './types.ts'

export class Learner {
  private readonly store: ExperienceStore
  private readonly policy: Policy
  private readonly decisions: Decision[] = []
  private readonly decisionLogSize: number

  constructor(
    opts: {
      policy?: PolicyOptions
      rewardFn?: RewardFunction
      decisionLogSize?: number
      rng?: () => number
    } = {}
  ) {
    this.store = new ExperienceStore(opts.rewardFn ?? defaultReward)
    this.policy = new Policy(opts.policy ?? {}, opts.rng)
    this.decisionLogSize = opts.decisionLogSize ?? 1000
  }

  /** Decide what action to take. */
  decide(context: MusicalContext, role: string, candidates: MusicalAction[]): Decision {
    const decision = this.policy.decide(context, role, this.store, candidates)
    this.decisions.push(decision)
    if (this.decisions.length > this.decisionLogSize) this.decisions.shift()
    return decision
  }

  /** Record the outcome of a decision. */
  recordOutcome(
    context: MusicalContext,
    role: string,
    action: MusicalAction,
    outcome: MusicalOutcome,
    at: number,
    reward?: number
  ): void {
    this.store.record(context, role, action, outcome, at, reward)
  }

  /** Convenience: decide + record in one call (when the outcome is known immediately). */
  decideAndRecord(
    context: MusicalContext,
    role: string,
    candidates: MusicalAction[],
    outcome: MusicalOutcome,
    at: number
  ): { decision: Decision; reward: number } {
    const decision = this.decide(context, role, candidates)
    const rec = this.store.record(context, role, decision.action, outcome, at)
    return { decision, reward: rec.avgReward }
  }

  /** Compute current learning stats. */
  stats(): LearningStats {
    return computeStats(this.store, this.decisions)
  }

  /** Access the underlying store (for advanced queries). */
  get store_(): ExperienceStore {
    return this.store
  }

  /** All learned records. */
  records() {
    return this.store.allRecords()
  }

  /** Recent decisions (for debugging / benchmarks). */
  recentDecisions(): readonly Decision[] {
    return this.decisions
  }

  /** Reset all learning. */
  reset(): void {
    this.store.reset()
    this.decisions.length = 0
  }

  /** Serialize for persistence. */
  toJSON() {
    return { store: this.store.toJSON(), decisions: [...this.decisions] }
  }
}
