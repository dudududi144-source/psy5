/**
 * Policy — decides what action to take given a context and the experience store.
 *
 * Implements an epsilon-greedy contextual bandit with abstention:
 *  - With probability epsilon, explore (try a random action from candidates).
 *  - Otherwise exploit (pick the action with the highest average reward).
 *  - If no action has enough trials, cold-start (try the least-explored).
 *  - If the best action's avg reward is below abstainThreshold, DO NOTHING.
 *
 * DO NOTHING is always a candidate. This is the abstention mechanism: the
 * system can choose to stay silent when nothing has worked well.
 */

import type { MusicalAction, MusicalContext } from '@psy-foundation/protocol'
import type { ExperienceStore } from './store.ts'
import type { Decision, LearnedRecord, PolicyOptions } from './types.ts'

const DEFAULT_POLICY: Required<PolicyOptions> = {
  epsilon: 0.1,
  minTrials: 3,
  abstainThreshold: 0.1,
  confidenceGrowth: 0.1,
}

export class Policy {
  private readonly opts: Required<PolicyOptions>
  private readonly rng: () => number

  constructor(opts: PolicyOptions = {}, rng: () => number = Math.random) {
    this.opts = { ...DEFAULT_POLICY, ...opts }
    this.rng = rng
  }

  /**
   * Decide what action to take.
   *
   * @param context current musical context
   * @param role the role being decided for (e.g. 'lead', 'bass')
   * @param store the experience store
   * @param candidates available actions (e.g. play material X, play material Y).
   *                   DO NOTHING is always added automatically.
   */
  decide(
    context: MusicalContext,
    role: string,
    store: ExperienceStore,
    candidates: MusicalAction[]
  ): Decision {
    // Always include do-nothing as a candidate.
    const allCandidates: MusicalAction[] = [...candidates, { type: 'do-nothing' as const }]
    const records = store.recordsFor(context, role)

    // Map candidates to their records (if any).
    const scored = allCandidates.map((action) => {
      const rec = records.find((r) => actionMatches(r.action, action))
      return { action, record: rec ?? null }
    })

    // Cold-start: if no action has minTrials, pick the least-tried (or random).
    const tried = scored.filter((s) => s.record && s.record.trials >= this.opts.minTrials)
    if (tried.length === 0) {
      // Prefer an action that has never been tried (explore the unknown).
      const untried = scored.filter((s) => !s.record || s.record.trials === 0)
      if (untried.length > 0) {
        const pick = untried[Math.floor(this.rng() * untried.length)] ?? scored[0]
        if (!pick) throw new Error('no candidates')
        return {
          action: pick.action,
          reason: 'cold-start',
          record: pick.record,
          confidence: 0,
        }
      }
      // All have some trials but below minTrials — pick the least tried.
      const leastTried = scored
        .slice()
        .sort((a, b) => (a.record?.trials ?? 0) - (b.record?.trials ?? 0))[0]
      if (!leastTried) throw new Error('no candidates')
      return {
        action: leastTried.action,
        reason: 'cold-start',
        record: leastTried.record,
        confidence: this.confidence(leastTried.record?.trials ?? 0),
      }
    }

    // Exploration: with probability epsilon, try a random action.
    if (this.rng() < this.opts.epsilon) {
      const pick = scored[Math.floor(this.rng() * scored.length)] ?? scored[0]
      if (!pick) throw new Error('no candidates')
      return {
        action: pick.action,
        reason: 'explore',
        record: pick.record,
        confidence: this.confidence(pick.record?.trials ?? 0),
      }
    }

    // Exploitation: pick the action with the highest avg reward.
    const best = tried
      .slice()
      .sort((a, b) => (b.record?.avgReward ?? 0) - (a.record?.avgReward ?? 0))[0]
    if (!best || !best.record) throw new Error('no tried action')
    const bestRecord = best.record

    // Abstention: if the best action's reward is below threshold, do nothing.
    if (bestRecord.avgReward < this.opts.abstainThreshold && best.action.type !== 'do-nothing') {
      const doNothing = scored.find((s) => s.action.type === 'do-nothing')
      if (doNothing) {
        return {
          action: doNothing.action,
          reason: 'abstain',
          record: doNothing.record ?? null,
          confidence: 1 - bestRecord.avgReward,
        }
      }
    }

    return {
      action: best.action,
      reason: 'exploit',
      record: bestRecord,
      confidence: this.confidence(bestRecord.trials),
    }
  }

  private confidence(trials: number): number {
    // Asymptotic growth: 1 - 1/(1 + trials * growth)
    return 1 - 1 / (1 + trials * this.opts.confidenceGrowth)
  }
}

/** Check if a stored action matches a candidate action. */
function actionMatches(stored: MusicalAction, candidate: MusicalAction): boolean {
  if (stored.type !== candidate.type) return false
  if (stored.type === 'do-nothing' && candidate.type === 'do-nothing') return true
  if (stored.type === 'play' && candidate.type === 'play')
    return stored.materialId === candidate.materialId
  if (stored.type === 'variation' && candidate.type === 'variation') {
    return stored.materialId === candidate.materialId && stored.transform === candidate.transform
  }
  return false
}

/** Find the best record for a context (helper for stats). */
export function bestRecord(records: LearnedRecord[]): LearnedRecord | null {
  if (records.length === 0) return null
  return records.slice().sort((a, b) => b.avgReward - a.avgReward)[0] ?? null
}
