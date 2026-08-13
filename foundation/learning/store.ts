/**
 * ExperienceStore — the persistent memory of the learning system.
 *
 * Records every experience (context + action + outcome + reward) and aggregates
 * them into LearnedRecords for fast retrieval. This is the data layer; the
 * policy (./policy.ts) reads from it to make decisions.
 *
 * The store is in-memory but serializable (toJSON / fromJSON) so it can be
 * persisted to disk/DB by a future adapter.
 */

import type { Experience, MusicalAction, MusicalContext } from '@psy-foundation/protocol'
import { actionKey, contextKey } from './contextKey.ts'
import type { RewardFunction } from './reward.ts'
import { defaultReward } from './reward.ts'
import type { LearnedRecord } from './types.ts'

export class ExperienceStore {
  private readonly records = new Map<string, LearnedRecord>()
  private readonly experiences: Experience[] = []
  private readonly rewardFn: RewardFunction

  constructor(rewardFn: RewardFunction = defaultReward) {
    this.rewardFn = rewardFn
  }

  /**
   * Record an experience: in `context`, `action` was taken, producing `outcome`,
   * at audio-time `at`. The reward is computed from the outcome (or supplied).
   */
  record(
    context: MusicalContext,
    role: string,
    action: MusicalAction,
    outcome: Experience['outcome'],
    at: number,
    reward?: number
  ): LearnedRecord {
    const r = reward ?? this.rewardFn(outcome)
    const exp: Experience = { context, action, outcome, reward: r, at }
    this.experiences.push(exp)

    const cKey = contextKey(context, role)
    const aKey = actionKey(action)
    const key = `${cKey}::${aKey}`

    let rec = this.records.get(key)
    if (!rec) {
      rec = {
        contextKey: cKey,
        actionKey: aKey,
        action,
        trials: 0,
        totalReward: 0,
        avgReward: 0,
        soundedCount: 0,
        skippedCount: 0,
        collidedCount: 0,
        lastUpdated: at,
      }
      this.records.set(key, rec)
    }

    rec.trials += 1
    rec.totalReward += r
    rec.avgReward = rec.totalReward / rec.trials
    rec.lastUpdated = at

    switch (outcome.type) {
      case 'sounded':
        rec.soundedCount += 1
        break
      case 'skipped':
        rec.skippedCount += 1
        break
      case 'collided':
        rec.collidedCount += 1
        break
    }

    return rec
  }

  /** Get all learned records for a context + role. */
  recordsFor(context: MusicalContext, role: string): LearnedRecord[] {
    const cKey = contextKey(context, role)
    const out: LearnedRecord[] = []
    for (const rec of this.records.values()) {
      if (rec.contextKey === cKey) out.push(rec)
    }
    return out
  }

  /** Get a specific record. */
  get(context: MusicalContext, role: string, action: MusicalAction): LearnedRecord | undefined {
    const cKey = contextKey(context, role)
    const aKey = actionKey(action)
    return this.records.get(`${cKey}::${aKey}`)
  }

  /** Total experiences recorded. */
  get size(): number {
    return this.experiences.length
  }

  /** Number of unique (context, action) records. */
  get uniqueRecords(): number {
    return this.records.size
  }

  /** All experiences (raw log). */
  allExperiences(): readonly Experience[] {
    return this.experiences
  }

  /** All learned records. */
  allRecords(): LearnedRecord[] {
    return Array.from(this.records.values())
  }

  /** Serialize for persistence. */
  toJSON(): { experiences: Experience[]; records: LearnedRecord[] } {
    return {
      experiences: [...this.experiences],
      records: Array.from(this.records.values()),
    }
  }

  /** Load from JSON. */
  static fromJSON(
    data: { experiences: Experience[]; records: LearnedRecord[] },
    rewardFn?: RewardFunction
  ): ExperienceStore {
    const store = new ExperienceStore(rewardFn)
    for (const exp of data.experiences) store.experiences.push(exp)
    for (const rec of data.records) store.records.set(`${rec.contextKey}::${rec.actionKey}`, rec)
    return store
  }

  /** Clear all history. */
  reset(): void {
    this.records.clear()
    this.experiences.length = 0
  }
}
