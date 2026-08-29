/**
 * MusicalLearningKernel — the real learning + composition loop.
 *
 * This is the public API PSY6 consumes:
 *
 *   observe → learn → compose → evaluate → reward → update
 *
 * The kernel wraps CompositionEngine with:
 * - Incremental learning from observations
 * - Self-evaluation of composed phrases
 * - Reward-based preference updates
 * - Phrase state continuity
 * - Serialization for persistence
 */

import type { AdaptedCompositionIntent } from './composition-adaptation.ts'
import { CompositionEngine } from './composition-engine.ts'
import type { ComposedSection } from './composition-engine.ts'
import type { InteractionGrammar } from './interaction-grammar.ts'
import { createEmptyInteractionGrammar, updateInteractionGrammar } from './interaction-grammar.ts'
import type { LearnedMusicalContext, PhraseState } from './learned-context.ts'
import { createEmptyLearnedContext, createEmptyPhraseState } from './learned-context.ts'
import type { MusicalContext } from './musical-context.ts'
import type { DevelopmentDecision, DevelopmentOperator } from './phrase-development.ts'
import { applyDevelopment, chooseDevelopment } from './phrase-development.ts'
import { getScale, scalePcs } from './scales.ts'

// ── OBSERVATION ──
export interface MusicalObservation {
  /** What was heard — abstract features, NOT note sequences */
  tempo?: number
  key?: number
  scaleName?: string
  energy?: number
  density?: number
  /** Pitch class histogram from the observed audio (12 bins, 0..1) */
  pitchClassHistogram?: number[]
  /** Kick onset steps (0..15) */
  kickOnsets?: number[]
  /** Bass onset steps */
  bassOnsets?: number[]
  /** Lead pitch classes observed */
  leadPitchClasses?: number[]
  /** Bass intervals observed (semitones) */
  bassIntervals?: number[]
  /** Lead intervals observed (semitones) */
  leadIntervals?: number[]
  /** Spectral centroid (Hz) */
  spectralCentroid?: number
  /** Spectral flatness (0..1) */
  spectralFlatness?: number
  /** Bass register (MIDI octave) */
  bassRegister?: number
  /** Lead register (MIDI center) */
  leadRegister?: number
  /** Syncopation level (0..1) */
  syncopation?: number
  /** Bass scale degrees observed (for transition learning) */
  bassDegrees?: number[]
  /** Harmonic root pitch class (for harmony-lead interaction) */
  harmonicRoot?: number
  /** Tension level (0..1) */
  tension?: number
  /** Audio time of observation */
  timestamp?: number
  /** Confidence of this observation (0..1) */
  confidence?: number
}

// ── EVALUATION ──
export interface PhraseEvaluation {
  harmonicCoherence: number
  rhythmicCoherence: number
  bassKickAlignment: number
  melodicContourQuality: number
  registerSafety: number
  repetition: number
  novelty: number
  phraseContinuity: number
  styleAdherence: number
  learnedGrammarFit: number
  interactionQuality: number
  overall: number
}

// ── REWARD ──
export interface RewardSignal {
  /** -1..1 — positive = good, negative = bad */
  value: number
  /** Which aspect is being rewarded */
  aspect: 'harmony' | 'rhythm' | 'bass' | 'melody' | 'arrangement' | 'timbre' | 'overall'
  /** Explanation */
  reason: string
}

// ── THE KERNEL ──
export class MusicalLearningKernel {
  private engine: CompositionEngine
  private learned: LearnedMusicalContext
  private phraseState: PhraseState
  private seed: number
  private context: MusicalContext
  private observationCount = 0
  private evaluationHistory: PhraseEvaluation[] = []
  private rewardHistory: RewardSignal[] = []
  private bassDegreeWeights: Record<number, number> = {}
  private melodyDegreeWeights: Record<number, number> = {}
  private interactionGrammar: InteractionGrammar
  private lastDevelopmentOperator: DevelopmentOperator | null = null
  private developmentHistory: DevelopmentDecision[] = []

  constructor(opts: {
    seed: number
    context: MusicalContext
    learnedContext?: LearnedMusicalContext
    phraseState?: PhraseState
  }) {
    this.seed = opts.seed
    this.context = opts.context
    this.learned = opts.learnedContext ?? createEmptyLearnedContext()
    this.phraseState = opts.phraseState ?? createEmptyPhraseState()
    this.interactionGrammar = createEmptyInteractionGrammar()
    this.bassDegreeWeights = { ...this.learned.bass.degreePreferences }
    this.melodyDegreeWeights = { ...this.learned.melody.scaleDegreePreferences }
    this.engine = this.buildEngine()
  }

  // ── PUBLIC API ──

  /** Learn from a radio observation. Updates the learned context incrementally. */
  observe(obs: MusicalObservation): LearnedMusicalContext {
    this.observationCount++
    const lr = 0.05 // learning rate (incremental, bounded)
    const conf = obs.confidence ?? 0.5

    // TEMPO
    if (obs.tempo !== undefined) {
      this.learned.tempo.tempo = this.learned.tempo.tempo * (1 - lr) + obs.tempo * lr
      this.learned.tempo.tempoConfidence = Math.min(
        1,
        this.learned.tempo.tempoConfidence + lr * conf
      )
    }

    // HARMONY: pitch class histogram
    if (obs.pitchClassHistogram && obs.pitchClassHistogram.length === 12) {
      const current = this.learned.harmony.pitchClassProfile
      for (let i = 0; i < 12; i++) {
        current[i] = (current[i] ?? 0) * (1 - lr) + (obs.pitchClassHistogram[i] ?? 0) * lr
      }
      this.learned.harmony.tonalCenterConfidence = Math.min(
        1,
        this.learned.harmony.tonalCenterConfidence + lr * conf
      )
    }

    // BASS: degree preferences from bass intervals
    if (obs.bassIntervals && obs.bassIntervals.length > 0) {
      for (const interval of obs.bassIntervals) {
        // Map interval to scale degree (simplified: 0=root, 7=fifth, 12=octave)
        const degree = interval === 0 ? 0 : interval === 7 ? 4 : interval === 12 ? 0 : interval % 7
        this.bassDegreeWeights[degree] = (this.bassDegreeWeights[degree] ?? 0) + 0.1 * conf
      }
      // Normalize
      this.normalizeWeights(this.bassDegreeWeights)
      this.learned.bass.degreePreferences = { ...this.bassDegreeWeights }
    }

    // BASS: register
    if (obs.bassRegister !== undefined) {
      this.learned.bass.register = Math.round(
        this.learned.bass.register * (1 - lr) + obs.bassRegister * lr
      )
    }

    // MELODY: degree preferences from lead pitch classes
    if (obs.leadPitchClasses && obs.leadPitchClasses.length > 0) {
      const scale = getScale(this.context.scaleName)
      if (scale) {
        const pcs = scalePcs(this.context.tonic, scale)
        for (const pc of obs.leadPitchClasses) {
          const degree = pcs.indexOf(pc)
          if (degree >= 0) {
            this.melodyDegreeWeights[degree] = (this.melodyDegreeWeights[degree] ?? 0) + 0.1 * conf
          }
        }
        this.normalizeWeights(this.melodyDegreeWeights)
        this.learned.melody.scaleDegreePreferences = { ...this.melodyDegreeWeights }
      }
    }

    // MELODY: register
    if (obs.leadRegister !== undefined) {
      this.learned.melody.registerProfile = Math.round(
        this.learned.melody.registerProfile * (1 - lr) + obs.leadRegister * lr
      )
    }

    // RHYTHM: kick grammar
    if (obs.kickOnsets) {
      const current = this.learned.rhythm.kickGrammar
      for (const step of obs.kickOnsets) {
        if (step >= 0 && step < 16) {
          current[step] = Math.min(1, (current[step] ?? 0) + 0.15 * conf)
        }
      }
    }

    // RHYTHM: syncopation
    if (obs.syncopation !== undefined) {
      this.learned.rhythm.syncopation =
        this.learned.rhythm.syncopation * (1 - lr) + obs.syncopation * lr
    }

    // TIMBRE
    if (obs.spectralCentroid !== undefined) {
      this.learned.timbre.spectralCentroid =
        this.learned.timbre.spectralCentroid * (1 - lr) + obs.spectralCentroid * lr
      this.learned.timbre.brightness = Math.min(1, obs.spectralCentroid / 5000)
    }
    if (obs.spectralFlatness !== undefined) {
      this.learned.timbre.noisiness =
        this.learned.timbre.noisiness * (1 - lr) + obs.spectralFlatness * lr
    }

    // META
    this.learned.meta.confidence = Math.min(1, this.learned.meta.confidence + lr * conf * 0.5)
    this.learned.meta.observationWindow = this.observationCount
    this.learned.meta.source = 'radio'

    // INTERACTION GRAMMAR: learn relationships between voices
    this.interactionGrammar = updateInteractionGrammar(this.interactionGrammar, {
      kickOnsets: obs.kickOnsets,
      bassOnsets: obs.bassOnsets,
      bassDegrees: obs.bassDegrees,
      leadIntervals: obs.leadIntervals,
      harmonicRoot: obs.harmonicRoot,
      energy: obs.energy,
      density: obs.density,
      tension: obs.tension,
      leadRegister: obs.leadRegister,
      confidence: conf,
    })

    // Rebuild engine with updated learned context
    this.engine = this.buildEngine()

    return this.learned
  }

  /** Compose a section using the current learned context + phrase development. */
  compose(opts: {
    bars: number
    intent?: AdaptedCompositionIntent
  }): {
    section: ComposedSection
    nextPhraseState: PhraseState
    evaluation: PhraseEvaluation
    development: DevelopmentDecision
  } {
    // Choose development operator for this section
    const phrasesInSection = Math.ceil(opts.bars / 8)
    const devRng = {
      next: () => {
        this._devSeed = (this._devSeed * 1664525 + 1013904223) >>> 0
        return this._devSeed / 4294967296
      },
    }
    const development = chooseDevelopment(
      this.phraseState.phraseIndex,
      this.lastDevelopmentOperator,
      phrasesInSection,
      this.context.energy,
      this.context.tension,
      devRng
    )
    this.lastDevelopmentOperator = development.operator
    this.developmentHistory.push(development)

    // Apply development to context
    const modifiers = applyDevelopment(development, {
      density: this.context.density,
      energy: this.context.energy,
      tension: this.context.tension,
    })

    // Create modified context with development targets
    const modifiedContext: MusicalContext = {
      ...this.context,
      density: Math.min(1, Math.max(0.1, this.context.density * modifiers.densityModifier)),
      energy: Math.min(1, Math.max(0.1, this.context.energy * modifiers.energyModifier)),
      tension: Math.min(1, Math.max(0, this.context.tension * modifiers.tensionModifier)),
    }

    // Build engine with modified context
    const engine = new CompositionEngine({
      seed: this.seed,
      context: modifiedContext,
      learnedContext: this.learned,
      preferenceFor: this.preferenceForFn(),
    })

    const section = engine.composeSection({ bars: opts.bars })

    // Update phrase state from the last bar
    const lastBar = section.bars[section.bars.length - 1]
    if (lastBar) {
      this.phraseState = {
        phraseIndex: this.phraseState.phraseIndex + section.phrases.length,
        previousMotifId: section.phrases[section.phrases.length - 1]?.motifIds[0] ?? null,
        previousBassRegister: this.learned.bass.register,
        previousLeadRegister: this.learned.melody.registerProfile,
        harmonicState: lastBar.harmonicContext,
        energyState: modifiedContext.energy,
        densityState: modifiedContext.density,
        arrangementState: lastBar.arrangementState,
        lastContourDirection: this.computeContourDirection(section),
      }
    }

    // Self-evaluate
    const evaluation = this.evaluate(section)
    this.evaluationHistory.push(evaluation)

    return { section, nextPhraseState: this.phraseState, evaluation, development }
  }

  private _devSeed = 42

  private preferenceForFn(): ((motif: import('./motif-v2.ts').Motif) => number) | undefined {
    if (Object.keys(this.melodyDegreeWeights).length === 0) return undefined
    return (motif: import('./motif-v2.ts').Motif): number => {
      let score = 0
      let count = 0
      for (const pc of motif.pitchClasses) {
        const scale = getScale(this.context.scaleName)
        if (scale) {
          const pcs = scalePcs(this.context.tonic, scale)
          const deg = pcs.indexOf(pc)
          if (deg >= 0) {
            score += this.melodyDegreeWeights[deg] ?? 0.5
            count++
          }
        }
      }
      return count > 0 ? score / count : 0.5
    }
  }

  /** Evaluate a composed section. Returns structured evidence. */
  evaluate(section: ComposedSection): PhraseEvaluation {
    const bars = section.bars
    let _kickCount = 0
    let bassOnBeat1 = 0
    let barsWithKick = 0
    let chordTones = 0
    let totalNotes = 0
    const leadMidis: number[] = []
    let prevLeadMidi: number | null = null
    let contourChanges = 0
    let registerMin = 127
    let registerMax = 0
    const bassPcs = new Set<number>()
    const leadPcs = new Set<number>()

    for (const bar of bars) {
      if (bar.kickNotes.length > 0) {
        barsWithKick++
        _kickCount += bar.kickNotes.length
      }
      if (bar.bassNotes.some((n) => n.step === 0)) bassOnBeat1++
      for (const n of bar.bassNotes) {
        bassPcs.add(((n.midi % 12) + 12) % 12)
        const pc = ((n.midi % 12) + 12) % 12
        if (bar.harmonicContext.includes(pc)) chordTones++
        totalNotes++
      }
      for (const n of bar.leadNotes) {
        leadMidis.push(n.midi)
        leadPcs.add(((n.midi % 12) + 12) % 12)
        const pc = ((n.midi % 12) + 12) % 12
        if (bar.harmonicContext.includes(pc)) chordTones++
        totalNotes++
        if (prevLeadMidi !== null && Math.sign(n.midi - prevLeadMidi) !== 0) contourChanges++
        prevLeadMidi = n.midi
        registerMin = Math.min(registerMin, n.midi)
        registerMax = Math.max(registerMax, n.midi)
      }
    }

    const bassKickAlignment = barsWithKick > 0 ? bassOnBeat1 / barsWithKick : 1
    const harmonicCoherence = totalNotes > 0 ? chordTones / totalNotes : 0.5
    const rhythmicCoherence = bars.length > 0 ? barsWithKick / bars.length : 0
    const melodicContourQuality =
      leadMidis.length > 1 ? Math.min(1, (contourChanges / leadMidis.length) * 2) : 0.5
    const registerSafety = registerMax <= 84 && registerMin >= 60 ? 1 : 0.5
    const repetition = 1 - new Set(bars.map((b) => JSON.stringify(b.leadNotes))).size / bars.length
    const novelty = 1 - repetition
    const phraseContinuity = this.phraseState.previousMotifId ? 0.8 : 0.5

    // Style adherence: check if bass uses style-appropriate register
    const styleAdherence = bassPcs.size >= 2 ? 0.8 : 0.5

    // Learned grammar fit: check if output matches learned preferences
    let learnedGrammarFit = 0.5
    if (this.learned.meta.confidence > 0.3) {
      const learnedBassDegs = Object.keys(this.learned.bass.degreePreferences)
      if (learnedBassDegs.length > 0) {
        learnedGrammarFit = 0.7 // simplified: if learned grammar exists and was used
      }
    }

    // Interaction quality: bass + kick alignment
    const interactionQuality = bassKickAlignment

    const overall =
      harmonicCoherence * 0.2 +
      rhythmicCoherence * 0.15 +
      bassKickAlignment * 0.15 +
      melodicContourQuality * 0.15 +
      registerSafety * 0.05 +
      novelty * 0.1 +
      phraseContinuity * 0.1 +
      styleAdherence * 0.05 +
      learnedGrammarFit * 0.05

    return {
      harmonicCoherence,
      rhythmicCoherence,
      bassKickAlignment,
      melodicContourQuality,
      registerSafety,
      repetition,
      novelty,
      phraseContinuity,
      styleAdherence,
      learnedGrammarFit,
      interactionQuality,
      overall,
    }
  }

  /** Apply a reward signal. Updates learned preferences. */
  updateFromEvaluation(reward: RewardSignal): void {
    this.rewardHistory.push(reward)
    const lr = 0.1

    if (reward.value > 0) {
      // Positive reward: reinforce current preferences
      switch (reward.aspect) {
        case 'bass':
          for (const deg in this.bassDegreeWeights) {
            this.bassDegreeWeights[deg] =
              (this.bassDegreeWeights[deg] ?? 0) * (1 + lr * reward.value)
          }
          break
        case 'melody':
          for (const deg in this.melodyDegreeWeights) {
            this.melodyDegreeWeights[deg] =
              (this.melodyDegreeWeights[deg] ?? 0) * (1 + lr * reward.value)
          }
          break
        case 'rhythm':
          this.learned.rhythm.syncopation = Math.min(
            1,
            this.learned.rhythm.syncopation * (1 + lr * reward.value * 0.1)
          )
          break
      }
    } else if (reward.value < 0) {
      // Negative reward: reduce current preferences
      switch (reward.aspect) {
        case 'bass':
          for (const deg in this.bassDegreeWeights) {
            this.bassDegreeWeights[deg] =
              (this.bassDegreeWeights[deg] ?? 0) * (1 + lr * reward.value)
          }
          break
        case 'melody':
          for (const deg in this.melodyDegreeWeights) {
            this.melodyDegreeWeights[deg] =
              (this.melodyDegreeWeights[deg] ?? 0) * (1 + lr * reward.value)
          }
          break
      }
    }

    this.normalizeWeights(this.bassDegreeWeights)
    this.normalizeWeights(this.melodyDegreeWeights)
    this.learned.bass.degreePreferences = { ...this.bassDegreeWeights }
    this.learned.melody.scaleDegreePreferences = { ...this.melodyDegreeWeights }

    // Rebuild engine
    this.engine = this.buildEngine()
  }

  /** Get the current learned context. */
  getLearnedContext(): LearnedMusicalContext {
    return this.learned
  }

  /** Get the current interaction grammar. */
  getInteractionGrammar(): InteractionGrammar {
    return this.interactionGrammar
  }

  /** Reset all learning. */
  resetLearning(): void {
    this.learned = createEmptyLearnedContext()
    this.bassDegreeWeights = {}
    this.melodyDegreeWeights = {}
    this.interactionGrammar = createEmptyInteractionGrammar()
    this.phraseState = createEmptyPhraseState()
    this.observationCount = 0
    this.evaluationHistory = []
    this.rewardHistory = []
    this.lastDevelopmentOperator = null
    this.developmentHistory = []
    this.engine = this.buildEngine()
  }

  /** Serialize learning for persistence. */
  serializeLearning(): string {
    return JSON.stringify({
      learned: this.learned,
      interactionGrammar: this.interactionGrammar,
      phraseState: this.phraseState,
      bassDegreeWeights: this.bassDegreeWeights,
      melodyDegreeWeights: this.melodyDegreeWeights,
      observationCount: this.observationCount,
      evaluationHistory: this.evaluationHistory.slice(-100),
      rewardHistory: this.rewardHistory.slice(-100),
    })
  }

  /** Restore learning from serialized state. */
  restoreLearning(json: string): void {
    const data = JSON.parse(json)
    this.learned = data.learned
    this.phraseState = data.phraseState
    this.bassDegreeWeights = data.bassDegreeWeights ?? {}
    this.melodyDegreeWeights = data.melodyDegreeWeights ?? {}
    this.interactionGrammar = data.interactionGrammar ?? createEmptyInteractionGrammar()
    this.observationCount = data.observationCount ?? 0
    this.evaluationHistory = data.evaluationHistory ?? []
    this.rewardHistory = data.rewardHistory ?? []
    this.engine = this.buildEngine()
  }

  /** Get the current phrase state. */
  getPhraseState(): PhraseState {
    return this.phraseState
  }

  // ── PRIVATE ──

  private buildEngine(): CompositionEngine {
    const prefFn = (motif: import('./motif-v2.ts').Motif): number => {
      // Score motif based on learned melody preferences
      if (Object.keys(this.melodyDegreeWeights).length === 0) return 0.5
      let score = 0
      let count = 0
      for (const pc of motif.pitchClasses) {
        const scale = getScale(this.context.scaleName)
        if (scale) {
          const pcs = scalePcs(this.context.tonic, scale)
          const deg = pcs.indexOf(pc)
          if (deg >= 0) {
            score += this.melodyDegreeWeights[deg] ?? 0.5
            count++
          }
        }
      }
      return count > 0 ? score / count : 0.5
    }

    return new CompositionEngine({
      seed: this.seed,
      context: this.context,
      learnedContext: this.learned,
      preferenceFor: Object.keys(this.melodyDegreeWeights).length > 0 ? prefFn : undefined,
    })
  }

  private normalizeWeights(weights: Record<number, number>): void {
    const total = Object.values(weights).reduce((s, v) => s + v, 0)
    if (total > 0) {
      for (const k in weights) {
        weights[k] = weights[k] ?? 0 / total
      }
    }
  }

  private computeContourDirection(section: ComposedSection): number {
    const leadMidis = section.bars.flatMap((b) => b.leadNotes.map((n) => n.midi))
    if (leadMidis.length < 2) return 0
    const first = leadMidis[0] ?? 0
    const last = leadMidis[leadMidis.length - 1] ?? 0
    return Math.sign(last - first)
  }
}
