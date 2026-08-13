/**
 * Musical learning — real weighted preference learning.
 *
 * Unlike PSY4's learning.ts (which is passive bookkeeping — vote counting),
 * this module implements a transparent weighted-preference model that
 * ACTUALLY influences future candidate selection.
 *
 * Learning loop:
 *   1. Observe a motif outcome (sounded/collided/skipped)
 *   2. Extract features (pitch class, interval, rhythm, register, role)
 *   3. Update preference weights for those features
 *   4. Future CandidateScorer reads these weights via learnedPreference score
 *
 * No neural network. No ML. Just transparent, explainable weighted updates.
 */

import type { Motif } from '@psy-foundation/music'

/** A feature that can be learned about. */
export interface LearnedFeature {
  /** Feature key (e.g. 'pc:4', 'interval:7', 'role:lead', 'register:4'). */
  key: string
  /** Current weight (-1..1). Positive = preferred, negative = avoided. */
  weight: number
  /** How many times this feature has been observed. */
  observations: number
  /** How many times it was in a successful motif. */
  successes: number
  /** How many times it was in a failed motif. */
  failures: number
}

/** A learning observation — what happened when a motif was used. */
export interface MusicalLearningObservation {
  motif: Motif
  outcome: 'sounded' | 'collided' | 'skipped'
  /** Reward signal -1..1 (sounded=positive, collided=negative, skipped=0). */
  reward: number
  /** Bar index when this happened. */
  bar: number
}

export interface MusicalLearningConfig {
  /** Learning rate (how fast weights update). Default 0.1. */
  learningRate?: number
  /** Weight decay per bar (prevents stale preferences). Default 0.001. */
  decayPerBar?: number
  /** Max observations to keep in history. Default 1000. */
  historySize?: number
  /** Min observations before a feature weight is trusted. Default 3. */
  minObservations?: number
}

const DEFAULT_CONFIG: Required<MusicalLearningConfig> = {
  learningRate: 0.1,
  decayPerBar: 0.001,
  historySize: 1000,
  minObservations: 3,
}

export class MusicalLearning {
  private readonly config: Required<MusicalLearningConfig>
  private readonly features = new Map<string, LearnedFeature>()
  private readonly history: MusicalLearningObservation[] = []
  private currentBar = 0

  constructor(config: MusicalLearningConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /** Observe a motif outcome and update weights. */
  observe(obs: MusicalLearningObservation): void {
    this.history.push(obs)
    if (this.history.length > this.config.historySize) {
      this.history.shift()
    }
    this.currentBar = Math.max(this.currentBar, obs.bar)

    // Extract features from the motif
    const features = this.extractFeatures(obs.motif)

    // Update each feature's weight based on the reward
    const reward = obs.reward
    for (const key of features) {
      let feature = this.features.get(key)
      if (!feature) {
        feature = { key, weight: 0, observations: 0, successes: 0, failures: 0 }
        this.features.set(key, feature)
      }

      feature.observations += 1
      if (reward > 0) feature.successes += 1
      if (reward < 0) feature.failures += 1

      // Weighted update: move weight toward the reward signal
      const delta = reward * this.config.learningRate
      feature.weight = Math.max(-1, Math.min(1, feature.weight + delta))
    }
  }

  /** Apply time-based decay to all weights. Call once per bar. */
  advanceBar(): void {
    this.currentBar += 1
    const decay = this.config.decayPerBar
    for (const feature of this.features.values()) {
      feature.weight *= 1 - decay
    }
  }

  /**
   * Get the learned preference score for a motif (0..1).
   * Used by CandidateScorer for the learnedPreference subscore.
   */
  preferenceFor(motif: Motif): number {
    const features = this.extractFeatures(motif)
    if (features.length === 0) return 0.5 // neutral

    let totalWeight = 0
    let count = 0
    for (const key of features) {
      const feature = this.features.get(key)
      if (feature && feature.observations >= this.config.minObservations) {
        // Map weight from -1..1 to 0..1
        totalWeight += (feature.weight + 1) / 2
        count += 1
      }
    }

    if (count === 0) return 0.5 // not enough data — neutral
    return totalWeight / count
  }

  /** Get all learned features (for debugging / introspection). */
  getLearnedFeatures(): LearnedFeature[] {
    return Array.from(this.features.values()).sort((a, b) => b.observations - a.observations)
  }

  /** Get a specific feature's current state. */
  getFeature(key: string): LearnedFeature | undefined {
    return this.features.get(key)
  }

  /** Total observations recorded. */
  get observationCount(): number {
    return this.history.length
  }

  /** Number of unique features learned. */
  get featureCount(): number {
    return this.features.size
  }

  /** Current bar index. */
  get bar(): number {
    return this.currentBar
  }

  /** Get the weights as a Map (for CandidateScorer). */
  getWeights(): Map<string, number> {
    const weights = new Map<string, number>()
    for (const [key, feature] of this.features) {
      if (feature.observations >= this.config.minObservations) {
        weights.set(key, feature.weight)
      }
    }
    return weights
  }

  /** Reset all learning. */
  reset(): void {
    this.features.clear()
    this.history.length = 0
    this.currentBar = 0
  }

  /** Serialize for persistence. */
  toJSON(): { features: LearnedFeature[]; history: MusicalLearningObservation[]; bar: number } {
    return {
      features: Array.from(this.features.values()),
      history: [...this.history],
      bar: this.currentBar,
    }
  }

  /** Load from JSON. */
  static fromJSON(
    data: { features: LearnedFeature[]; history: MusicalLearningObservation[]; bar: number },
    config?: MusicalLearningConfig
  ): MusicalLearning {
    const learning = new MusicalLearning(config)
    for (const f of data.features) learning.features.set(f.key, f)
    learning.history.push(...data.history)
    learning.currentBar = data.bar
    return learning
  }

  /** Extract feature keys from a motif. */
  private extractFeatures(motif: Motif): string[] {
    const features: string[] = []

    // Pitch class features
    for (const pc of motif.pitchClasses) {
      features.push(`pc:${pc}`)
    }

    // Interval features
    for (const interval of motif.intervals) {
      features.push(`interval:${interval}`)
    }

    // Role feature
    features.push(`role:${motif.role}`)

    // Register feature
    const avgRegister = Math.round((motif.register.min + motif.register.max) / 2 / 12)
    features.push(`register:${avgRegister}`)

    // Rhythmic density feature (quantized)
    const densityBin = Math.floor(motif.rhythmicDensity * 4)
    features.push(`density:${densityBin}`)

    return features
  }
}

/**
 * Default reward function for musical outcomes.
 * sounded = positive (0.3), collided = negative (-0.5), skipped = neutral (0).
 */
export function defaultMusicalReward(outcome: 'sounded' | 'collided' | 'skipped'): number {
  switch (outcome) {
    case 'sounded':
      return 0.3
    case 'collided':
      return -0.5
    case 'skipped':
      return 0.0
  }
}
