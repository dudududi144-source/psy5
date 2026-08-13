/**
 * CompositionEngine: the single authoritative composer.
 *
 * The engine composes whole phrases, not isolated bars. It follows a strict
 * hierarchy:
 *   1. Build GroovePlan (kick skeleton, subdivision, accents)
 *   2. Determine harmonic plan (chord tones, tension notes)
 *   3. Compose BASS against groove (bass knows where kick is)
 *   4. Compose LEAD against bass+harmony (lead leaves space for bass,
 *      stays in tessitura)
 *   5. Arrange parts (some roles OFF in BREAK / INTRO / OUTRO sections)
 *
 * Bass composition rules:
 *   - Bass ALWAYS places a ROOT on step 0 (beat 1) — the LOCKED invariant
 *     that keeps bass-kick alignment high.
 *   - In LOCKED mode: bass hits every kick step with ROOT.
 *   - In COMPLEMENTARY mode: bass hits the gaps between kicks with
 *     FIFTH / OCTAVE.
 *   - Bass register: octave 2 (MIDI 36-59).
 *   - Last bar of a phrase: CADENCE walk (fifth → root).
 *
 * Lead composition rules:
 *   - Lead MUST NOT overlap bass register (lead clamped to MIDI 60-84).
 *   - Lead respects harmonic context (chord tones preferred).
 *   - Lead max leap: grammar.maxLeap (default 7 semitones).
 *   - Lead tessitura center: grammar.tessituraCenter.
 *   - Lead uses motifs from memory, transformed purposefully.
 *   - Lead has call/response structure: first half = call (small
 *     transpositions of the phrase motif), second half = response
 *     (callResponse transform).
 */

import {
  ARRANGEMENT_ROLE_MAP,
  type ArrangementPlan,
  type ArrangementState,
  type RoleActivation,
  planArrangement,
} from './arrangement-state.ts'
import type { AdaptedCompositionIntent } from './composition-adaptation.ts'
import { type GroovePlan, buildGroovePlan } from './groove-plan.ts'
import type { LearnedMusicalContext } from './learned-context.ts'
import { createEmptyLearnedContext } from './learned-context.ts'
import { MotifMemory } from './motif-memory.ts'
import { type Motif, type MotifNote, createMotif } from './motif-v2.ts'
import type { MusicalContext } from './musical-context.ts'
import { generateMotifV2 } from './phrase-planner.ts'
import { Rng } from './rng.ts'
import { degreeToMidi, getScale, scalePcs } from './scales.ts'
import { type StyleGrammar, getStyleGrammar } from './style-grammar.ts'
import {
  callResponse,
  invert as invertMotif,
  retrograde as retrogradeMotif,
  transpose as transposeMotif,
} from './transformation.ts'

export interface ComposedBar {
  barIndex: number
  arrangementState: ArrangementState
  groove: GroovePlan
  /** Step indices within the bar that have a kick onset. */
  kickNotes: number[]
  /** Bass notes for this bar. */
  bassNotes: { midi: number; step: number; durationSteps: number; function: string }[]
  /** Lead notes for this bar. */
  leadNotes: { midi: number; step: number; durationSteps: number; velocity: number }[]
  /** Step indices within the bar that have a hat onset. */
  hatNotes: number[]
  /** Active chord pitch classes for this bar. */
  harmonicContext: number[]
  /** Role activation for this bar (copied from arrangement slot). */
  roles: RoleActivation
  /** Timbre intent from learned context (PSY4 translates to synth params). */
  timbreIntent?: {
    brightness: number
    harmonicity: number
    noisiness: number
    attack: number
    subEnergy: number
  }
}

export interface ComposedPhrase {
  bars: ComposedBar[]
  /** Indices (within the phrase) of the opening / peak / resolution bars. */
  phraseArc: { opening: number; peak: number; resolution: number }
  /** Motif ids used in this phrase (primary motif first). */
  motifIds: string[]
  /** If this phrase is a callback, the motif id it callbacks to. */
  callbackTo?: string
  seed: number
}

export interface ComposedSection {
  bars: ComposedBar[]
  phrases: ComposedPhrase[]
  arrangement: ArrangementPlan
  groove: GroovePlan
  seed: number
}

export interface CompositionEngineOptions {
  memory?: MotifMemory
  seed: number
  context: MusicalContext
  /** Optional explicit grammar; defaults to context.sectionRole lookup. */
  grammar?: StyleGrammar
  /** Optional learned preference function (0..1). When provided, motif selection is biased. */
  preferenceFor?: (motif: Motif) => number
  /** Optional learned musical context from radio observation. Changes bass/melody/rhythm grammar. */
  learnedContext?: LearnedMusicalContext
}

const BASS_OCTAVE = 2
const LEAD_MIN_MIDI = 60
const LEAD_MAX_MIDI = 84

export class CompositionEngine {
  private memory: MotifMemory
  private seed: number
  private context: MusicalContext
  private grammar: StyleGrammar
  private preferenceFor: ((motif: Motif) => number) | null
  private learned: LearnedMusicalContext

  constructor(opts: CompositionEngineOptions) {
    this.memory = opts.memory ?? new MotifMemory()
    this.seed = opts.seed
    this.context = opts.context
    this.grammar = opts.grammar ?? getStyleGrammar(opts.context.sectionRole || 'full-on')
    this.preferenceFor = opts.preferenceFor ?? null
    this.learned = opts.learnedContext ?? createEmptyLearnedContext()
    this.seedMemory()
  }

  /** Compose a single phrase as ONE musical object. */
  composePhrase(opts: {
    bars: number
    arrangementState: ArrangementState
    groove: GroovePlan
    harmonicContext: number[]
    previousPhrase?: ComposedPhrase
    /** If set, the phrase uses this motif (callback) instead of generating fresh. */
    callbackMotif?: Motif
    /** Optional adaptation intent — changes what is composed (not just filters). */
    intent?: AdaptedCompositionIntent
  }): ComposedPhrase {
    const { bars, arrangementState, groove, harmonicContext } = opts
    const intent = opts.intent
    // Per-phrase rng, derived deterministically from the engine seed + state.
    const rng = new Rng(
      (this.seed * 7919 + bars * 31 + arrangementState.length * 17 + harmonicContext.length * 7) >>>
        0
    )
    const roles = { ...ARRANGEMENT_ROLE_MAP[arrangementState] }

    // Apply intent to roles (adaptation changes WHO plays)
    if (intent) {
      if (intent.bassPressure < 0.3) roles.bass = false
      if (intent.leadPressure < 0.3) roles.lead = false
      if (intent.groovePressure < 0.3) {
        roles.kick = false
        roles.hats = false
      }
      if (intent.texturePressure > 0.6) roles.hats = true
    }

    const phraseMotif = opts.callbackMotif ?? this.choosePhraseMotif(rng, opts.previousPhrase)
    const callbackTo = opts.callbackMotif?.id

    const half = Math.floor(bars / 2)
    const composedBars: ComposedBar[] = []

    for (let bar = 0; bar < bars; bar++) {
      const isLast = bar === bars - 1
      const isResponse = bar >= half
      // Per-bar bass + lead rngs (independent streams).
      const bassRng = new Rng((this.seed * 131 + bar * 53 + 11) >>> 0)
      const leadRng = new Rng((this.seed * 191 + bar * 71 + 23) >>> 0)

      // 1. Kick — from groove, modified by learned rhythm if available
      let kickNotes: number[] = []
      if (roles.kick) {
        kickNotes = Array.from(new Set(groove.kickSteps)).sort((a, b) => a - b)
        // Wire learned kick grammar: if confidence is high, generate original
        // kick patterns from learned statistics (not copying, but same language)
        const learnedKick = this.learned.rhythm.kickGrammar
        const kickConf = this.learned.meta.confidence
        if (kickConf > 0.3 && learnedKick.some((v: number) => v > 0.1)) {
          // Generate original kick pattern from learned probabilities
          const kickRng = new Rng((this.seed * 211 + bar * 43 + 7) >>> 0)
          const generated: number[] = []
          for (let step = 0; step < groove.stepsPerBar; step++) {
            const prob = learnedKick[step % 16] ?? 0
            // Blend: 60% learned probability, 40% style groove
            const styleHas = groove.kickSteps.includes(step)
            const blended = styleHas ? 0.8 : prob * 0.6
            if (kickRng.next() < blended) {
              generated.push(step)
            }
          }
          // Always keep beat 1 (LOCKED invariant)
          if (!generated.includes(0)) generated.unshift(0)
          kickNotes = generated.sort((a, b) => a - b)
        }
      }

      // 2. Hats — from groove, modified by learned hat grammar if available
      let hatNotes: number[] = []
      if (roles.hats) {
        hatNotes = Array.from(new Set(groove.hatSteps)).sort((a, b) => a - b)
        // Wire learned hat grammar
        const learnedHats = this.learned.rhythm.hatGrammar
        if (this.learned.meta.confidence > 0.3 && learnedHats.some((v: number) => v > 0.1)) {
          const hatRng = new Rng((this.seed * 223 + bar * 47 + 13) >>> 0)
          const generated: number[] = []
          for (let step = 0; step < groove.stepsPerBar; step++) {
            const prob = learnedHats[step % 16] ?? 0
            const styleHas = groove.hatSteps.includes(step)
            const blended = styleHas ? 0.7 : prob * 0.5
            if (hatRng.next() < blended) {
              generated.push(step)
            }
          }
          hatNotes = generated.length > 0 ? generated.sort((a, b) => a - b) : hatNotes
        }
      }

      // 3. Bass — only if roles.bass. Apply intent to reduce bass density.
      let bassNotes = roles.bass
        ? this.composeBass(bar, groove, harmonicContext, bassRng, isLast)
        : []

      // 4. Lead — only if roles.lead. Apply intent to reduce lead density.
      let leadNotes = roles.lead
        ? this.composeLead(bar, bars, phraseMotif, harmonicContext, leadRng, isResponse)
        : []

      // Apply adaptation intent to change DENSITY (not just on/off)
      if (intent) {
        // Reduce bass notes proportionally to bassPressure
        if (intent.bassPressure < 0.6 && bassNotes.length > 1) {
          const keepRatio = Math.max(0.3, intent.bassPressure)
          const keepCount = Math.max(1, Math.floor(bassNotes.length * keepRatio))
          bassNotes = bassNotes.slice(0, keepCount)
        }
        // Reduce lead notes proportionally to leadPressure
        if (intent.leadPressure < 0.6 && leadNotes.length > 1) {
          const keepRatio = Math.max(0.2, intent.leadPressure)
          const keepCount = Math.max(1, Math.floor(leadNotes.length * keepRatio))
          leadNotes = leadNotes.slice(0, keepCount)
        }
        // Register shift: shift lead notes
        if (intent.registerShift !== 0 && leadNotes.length > 0) {
          const shift = intent.registerShift * 12
          leadNotes = leadNotes.map((n) => ({
            ...n,
            midi: Math.max(LEAD_MIN_MIDI, Math.min(LEAD_MAX_MIDI, n.midi + shift)),
          }))
        }
        // Rest pressure: silence some bars entirely
        if (intent.restPressure > 0.5 && bar % 4 === 2) {
          leadNotes = []
        }
        // High texture: add hats if sparse
        if (intent.texturePressure > 0.6 && hatNotes.length === 0 && roles.hats) {
          hatNotes = [2, 6, 10, 14]
        }
      }

      composedBars.push({
        barIndex: bar,
        arrangementState,
        groove,
        kickNotes,
        bassNotes,
        leadNotes,
        hatNotes,
        harmonicContext: harmonicContext.slice(),
        roles: { ...roles },
        timbreIntent:
          this.learned.meta.confidence > 0.3
            ? {
                brightness: this.learned.timbre.brightness,
                harmonicity: this.learned.timbre.harmonicity,
                noisiness: this.learned.timbre.noisiness,
                attack: this.learned.timbre.attack,
                subEnergy: this.learned.timbre.subEnergy,
              }
            : undefined,
      })
    }

    return {
      bars: composedBars,
      phraseArc: { opening: 0, peak: half, resolution: Math.max(0, bars - 1) },
      motifIds: [phraseMotif.id],
      callbackTo,
      seed: this.seed,
    }
  }

  /** Compose a full section (32-256 bars). */
  composeSection(opts: { bars: number }): ComposedSection {
    const groove = buildGroovePlan({
      context: this.context,
      seed: this.seed,
      bars: opts.bars,
      grammar: this.grammar,
    })
    const arrangement = planArrangement({
      bars: opts.bars,
      seed: this.seed,
      context: this.context,
    })

    // Slice the arrangement into phrases at state boundaries so each phrase
    // has a single ArrangementState. This keeps composePhrase's
    // role-activation logic correct (an INTRO phrase has no kick; a GROOVE
    // phrase has kick) while still respecting the arrangement's per-bar
    // state changes.
    const groups: { state: ArrangementState; start: number; length: number }[] = []
    let curState: ArrangementState | null = null
    let curStart = 0
    for (let bar = 0; bar < opts.bars; bar++) {
      const slot = arrangement.slots[bar]
      const state: ArrangementState = slot?.state ?? 'GROOVE'
      if (curState === null) {
        curState = state
        curStart = bar
      } else if (state !== curState) {
        groups.push({ state: curState, start: curStart, length: bar - curStart })
        curState = state
        curStart = bar
      }
    }
    if (curState !== null) {
      groups.push({
        state: curState,
        start: curStart,
        length: opts.bars - curStart,
      })
    }
    const totalPhrases = groups.length

    const phrases: ComposedPhrase[] = []
    const bars: ComposedBar[] = []
    let prev: ComposedPhrase | undefined
    let firstPhraseMotif: Motif | undefined

    for (let phraseIdx = 0; phraseIdx < groups.length; phraseIdx++) {
      const group = groups[phraseIdx] as { state: ArrangementState; start: number; length: number }
      const isLastPhrase = phraseIdx === totalPhrases - 1
      const harmonicContext = this.chooseHarmonicForPhrase(phraseIdx)
      const callbackMotif = isLastPhrase && firstPhraseMotif ? firstPhraseMotif : undefined

      const phrase = this.composePhrase({
        bars: group.length,
        arrangementState: group.state,
        groove,
        harmonicContext,
        previousPhrase: prev,
        callbackMotif,
      })

      // Re-index bars to absolute bar indices and sync per-bar roles from
      // the arrangement (in case the arrangement's slot has slightly
      // different roles than the state's default — e.g., due to jitter).
      for (const b of phrase.bars) {
        const absoluteBar = b.barIndex + group.start
        const absSlot = arrangement.slots.find((s) => s.barIndex === absoluteBar)
        const out: ComposedBar = { ...b, barIndex: absoluteBar }
        if (absSlot) {
          out.roles = { ...absSlot.roles }
        }
        bars.push(out)
      }
      phrases.push(phrase)

      // Capture the first phrase's motif for the final callback.
      if (phraseIdx === 0) {
        const id = phrase.motifIds[0]
        if (id) {
          const entry = this.memory.retrieve(id)
          if (entry) firstPhraseMotif = entry.motif
        }
      }
      prev = phrase
    }

    return { bars, phrases, arrangement, groove, seed: this.seed }
  }

  /** Get all notes from a composed section as flat arrays per part. */
  renderNotes(section: ComposedSection): {
    kick: { step: number; bar: number }[]
    bass: { midi: number; step: number; bar: number; function: string }[]
    lead: { midi: number; step: number; bar: number; velocity: number }[]
    hats: { step: number; bar: number }[]
  } {
    const kick: { step: number; bar: number }[] = []
    const bass: { midi: number; step: number; bar: number; function: string }[] = []
    const lead: { midi: number; step: number; bar: number; velocity: number }[] = []
    const hats: { step: number; bar: number }[] = []
    for (const bar of section.bars) {
      for (const step of bar.kickNotes) kick.push({ step, bar: bar.barIndex })
      for (const n of bar.bassNotes) {
        bass.push({ midi: n.midi, step: n.step, bar: bar.barIndex, function: n.function })
      }
      for (const n of bar.leadNotes) {
        lead.push({ midi: n.midi, step: n.step, bar: bar.barIndex, velocity: n.velocity })
      }
      for (const step of bar.hatNotes) hats.push({ step, bar: bar.barIndex })
    }
    return { kick, bass, lead, hats }
  }

  // ---------------- internal helpers ----------------

  /** Seed memory with 2-3 motifs so the first phrase has material to draw on. */
  private seedMemory(): void {
    if (this.memory.size > 0) return
    const baseMotif = generateMotifV2(
      { ...this.context, octave: 4 },
      (this.seed * 7 + 1) >>> 0,
      'lead'
    )
    this.memory.ingest(baseMotif, 0, { salience: 0.7, role: 'lead' })
    const altMotif = generateMotifV2(
      { ...this.context, octave: 4 },
      (this.seed * 13 + 31) >>> 0,
      'lead'
    )
    this.memory.ingest(altMotif, 0, { salience: 0.6, role: 'lead' })
  }

  /**
   * Choose the phrase motif. 30% of the time (deterministic via rng), pull
   * a motif from memory referenced by the previous phrase — a cross-phrase
   * callback. Otherwise generate a fresh motif. When a learned preference
   * function is provided, candidates are scored and the highest-scoring
   * motif is selected with 70% probability (30% exploration).
   */
  private choosePhraseMotif(rng: Rng, previousPhrase?: ComposedPhrase): Motif {
    // 30% chance: callback to previous phrase motif
    if (previousPhrase && rng.next() < 0.3) {
      const prevId = previousPhrase.motifIds[0]
      if (prevId) {
        const entry = this.memory.retrieve(prevId)
        if (entry) return entry.motif
      }
    }

    // Generate 3 candidate motifs
    const candidates: Motif[] = []
    for (let i = 0; i < 3; i++) {
      const freshSeed = (this.seed * 101 + rng.int(1, 1_000_000) + i * 7919) >>> 0
      candidates.push(generateMotifV2({ ...this.context, octave: 4 }, freshSeed, 'lead'))
    }

    // If learning is wired, score candidates and prefer the best (70% exploit, 30% explore)
    if (this.preferenceFor) {
      const prefFn = this.preferenceFor
      const scored = candidates.map((m) => ({ motif: m, score: prefFn ? prefFn(m) : 0.5 }))
      scored.sort((a, b) => b.score - a.score)
      if (rng.next() < 0.7) {
        // Exploit: pick highest-scoring
        const best = scored[0] as { motif: Motif; score: number }
        this.memory.ingest(best.motif, 0, { salience: 0.6, role: 'lead' })
        return best.motif
      }
      // Explore: pick a random candidate
      const pick = candidates[rng.int(0, candidates.length - 1)] as Motif
      this.memory.ingest(pick, 0, { salience: 0.6, role: 'lead' })
      return pick
    }

    // No learning: pick first candidate (deterministic)
    const motif = candidates[0] as Motif
    this.memory.ingest(motif, 0, { salience: 0.6, role: 'lead' })
    return motif
  }

  /**
   * Choose chord pitch classes for a phrase. Rotates through tonic /
   * subdominant / tonic / dominant across phrases so harmonic rhythm is
   * non-zero across a section.
   */
  private chooseHarmonicForPhrase(phraseIndex: number): number[] {
    const scale = getScale(this.context.scaleName)
    if (!scale) return [this.context.tonic]
    const pcs = scalePcs(this.context.tonic, scale)
    if (pcs.length < 5) return [pcs[0] ?? this.context.tonic]

    // Wire learned harmony: if pitch-class profile has data, use it to
    // influence which chord tones are selected (not copying, but preferring
    // pitch classes that were prominent in the source)
    const pcProfile = this.learned.harmony.pitchClassProfile
    const hasLearnedHarmony =
      this.learned.meta.confidence > 0.3 && pcProfile.some((v: number) => v > 0.05)

    const idx = ((phraseIndex % 4) + 4) % 4

    // Base progression: tonic / subdominant / tonic / dominant
    let baseChord: number[]
    if (idx === 0) {
      baseChord = [pcs[0] ?? 0, pcs[2] ?? 0, pcs[4] ?? 0]
    } else if (idx === 1) {
      baseChord = [pcs[3] ?? 0, pcs[5] ?? 0, pcs[7 % pcs.length] ?? 0]
    } else if (idx === 2) {
      baseChord = [pcs[0] ?? 0, pcs[2] ?? 0, pcs[4] ?? 0]
    } else {
      baseChord = [pcs[4] ?? 0, pcs[6 % pcs.length] ?? 0, pcs[8 % pcs.length] ?? 0]
    }

    if (hasLearnedHarmony) {
      // Blend: keep the progression structure but weight chord tones by
      // learned pitch-class profile. Replace one chord tone with a
      // high-weight pc from the learned profile if it's in the scale.
      const sortedPcs = pcProfile
        .map((weight: number, pc: number) => ({ pc, weight }))
        .filter(
          (x: { pc: number; weight: number }) => pcs.includes(x.pc) && !baseChord.includes(x.pc)
        )
        .sort((a: { weight: number }, b: { weight: number }) => b.weight - a.weight)

      if (sortedPcs.length > 0 && sortedPcs[0]) {
        const top = sortedPcs[0] as { pc: number; weight: number }
        // Replace the third chord tone with the learned-preferred pc
        baseChord = [baseChord[0] ?? 0, baseChord[1] ?? 0, top.pc]
      }
    }

    return baseChord
  }

  /**
   * Compose the bass for one bar against the groove.
   *
   * LOCKED mode: bass hits every kick step with ROOT (so bass+kick are
   * rhythmically locked).
   * COMPLEMENTARY mode: bass hits the gaps between kicks with FIFTH/OCTAVE
   * (so bass+kick interlock without colliding).
   *
   * Either way, beat 1 (step 0) ALWAYS gets a ROOT — the invariant that
   * keeps bass-kick alignment high.
   */
  private composeBass(
    bar: number,
    groove: GroovePlan,
    _harmonicContext: number[],
    rng: Rng,
    isLast: boolean
  ): { midi: number; step: number; durationSteps: number; function: string }[] {
    const scale = getScale(this.context.scaleName)
    if (!scale) return []

    const rootMidi = degreeToMidi(this.context.tonic, scale, 0, BASS_OCTAVE)
    const fifthMidi = degreeToMidi(this.context.tonic, scale, 4, BASS_OCTAVE)
    const octaveMidi = degreeToMidi(this.context.tonic, scale, 0, BASS_OCTAVE + 1)
    const thirdMidi = degreeToMidi(this.context.tonic, scale, 2, BASS_OCTAVE)
    const seventhMidi = degreeToMidi(this.context.tonic, scale, 6, BASS_OCTAVE)
    const beat = Math.max(1, Math.round(groove.stepsPerBar / 4))
    const tension = this.grammar.tensionPreference

    // Learned bass grammar: degree preferences from radio observation
    const bassDegPrefs = this.learned.bass.degreePreferences
    const hasLearnedBass =
      Object.keys(bassDegPrefs).length > 0 && this.learned.meta.confidence > 0.3

    /** Choose a bass pitch using learned preferences or fallback to style */
    const chooseBassPitch = (rng: Rng): { midi: number; fn: string } => {
      if (hasLearnedBass) {
        // Weighted selection from learned degree preferences
        const degrees = Object.entries(bassDegPrefs)
        const totalWeight = degrees.reduce((s, [, w]) => s + w, 0)
        let r = rng.next() * totalWeight
        for (const [degStr, weight] of degrees) {
          r -= weight
          if (r <= 0) {
            const deg = Number.parseInt(degStr, 10)
            const midi = degreeToMidi(this.context.tonic, scale, deg, BASS_OCTAVE)
            const fns = ['ROOT', 'THIRD', 'FIFTH', 'SEVENTH', 'OCTAVE']
            return { midi, fn: fns[deg] ?? 'PASSING' }
          }
        }
      }
      // Fallback: style-based selection
      const useFifth = rng.next() < 0.5
      return useFifth ? { midi: fifthMidi, fn: 'FIFTH' } : { midi: octaveMidi, fn: 'OCTAVE' }
    }

    const notes: { midi: number; step: number; durationSteps: number; function: string }[] = []

    // Beat 1: ALWAYS ROOT (LOCKED invariant — bass-kick alignment).
    notes.push({ midi: rootMidi, step: 0, durationSteps: 2, function: 'ROOT' })

    if (groove.bassKickAlignment === 'LOCKED') {
      for (const step of groove.kickSteps) {
        if (step === 0) continue
        if (rng.next() < 0.3 + tension * 0.2) {
          const pitch = chooseBassPitch(rng)
          const dur = rng.next() < 0.5 ? 1 : 2
          notes.push({ midi: pitch.midi, step, durationSteps: dur, function: pitch.fn })
        } else {
          notes.push({ midi: rootMidi, step, durationSteps: 2, function: 'ROOT' })
        }
      }
    } else {
      const half = Math.max(1, Math.round(groove.stepsPerBar / 8))
      const complementary = [half, beat + half, beat * 2 + half, beat * 3 + half]
      for (const step of complementary) {
        if (groove.kickSteps.includes(step) || step === 0) continue
        const pitch = chooseBassPitch(rng)
        notes.push({ midi: pitch.midi, step, durationSteps: 1, function: pitch.fn })
      }
    }

    // Offbeat passing/approach tones — vary per bar
    const offbeatVariation = (bar * 7 + this.seed * 13) % 4
    const offbeatTargets =
      offbeatVariation === 0
        ? [beat * 2, beat * 3]
        : offbeatVariation === 1
          ? [beat + 1, beat * 3 + 1]
          : offbeatVariation === 2
            ? [beat * 2 + 1]
            : [beat * 3, beat * 3 + 2]

    for (const step of offbeatTargets) {
      if (notes.some((n) => n.step === step)) continue
      if (step >= groove.stepsPerBar) continue
      if (rng.next() < 0.2 + groove.syncopationBudget * 0.3 + tension * 0.2) {
        const useApproach = rng.next() < 0.3
        if (useApproach) {
          const approachMidi = rootMidi + (rng.next() < 0.5 ? -1 : 1)
          notes.push({ midi: approachMidi, step, durationSteps: 1, function: 'APPROACH' })
        } else {
          const useThird = rng.next() < 0.5
          notes.push({
            midi: useThird ? thirdMidi : seventhMidi,
            step,
            durationSteps: 1,
            function: useThird ? 'THIRD' : 'PASSING',
          })
        }
      }
    }

    // Octave jump for energy on some bars
    if (rng.next() < 0.15 + tension * 0.15) {
      const jumpStep = beat * 2
      if (!notes.some((n) => n.step === jumpStep)) {
        notes.push({ midi: octaveMidi, step: jumpStep, durationSteps: 1, function: 'OCTAVE' })
      }
    }

    // Cadence on the last bar
    if (isLast) {
      const lastStep = groove.stepsPerBar - 2
      const filtered = notes.filter((n) => n.step < lastStep)
      notes.length = 0
      notes.push(...filtered)
      notes.push({ midi: fifthMidi, step: lastStep, durationSteps: 1, function: 'CADENCE' })
      notes.push({ midi: rootMidi, step: lastStep + 1, durationSteps: 2, function: 'CADENCE' })
    }

    // Clamp to octave 2 (MIDI 36-59)
    for (const n of notes) {
      while (n.midi < 36) n.midi += 12
      while (n.midi > 59) n.midi -= 12
    }

    notes.sort((a, b) => a.step - b.step)
    const deduped: typeof notes = []
    for (const n of notes) {
      if (!deduped.some((d) => d.step === n.step)) deduped.push(n)
    }
    return deduped
  }

  /**
   * Compose the lead for one bar against the bass+harmony.
   *
   * Call/response structure:
   *   - Bars in the first half (call): the phrase motif, with small
   *     transpositions for variety.
   *   - Bars in the second half (response): the callResponse transform of
   *     the phrase motif (shifts to the fifth, resolves the last note to
   *     the root).
   *
   * The rendered notes are clamped to tessitura (MIDI 60-84) and the max
   * leap is enforced by clamping consecutive intervals to ±maxLeap.
   */
  private composeLead(
    bar: number,
    _bars: number,
    phraseMotif: Motif,
    harmonicContext: number[],
    rng: Rng,
    isResponse: boolean
  ): { midi: number; step: number; durationSteps: number; velocity: number }[] {
    const scale = getScale(this.context.scaleName)
    if (!scale || phraseMotif.notes.length === 0) return []

    let motif = phraseMotif
    if (isResponse) {
      motif = callResponse(phraseMotif, this.context.tonic, scale, (this.seed + bar * 17) >>> 0)
    } else if (bar > 0) {
      // More aggressive per-bar variation (prevents 90% repetition)
      const variationChoice = (bar * 3 + this.seed) % 5
      if (variationChoice === 0) {
        // Transpose ±2 or ±3
        const t = rng.pick([-3, -2, 2, 3])
        motif = transposeMotif(phraseMotif, t, this.context.tonic, scale)
      } else if (variationChoice === 1) {
        // Invert (with 30% probability)
        if (rng.next() < 0.3) {
          motif = invertMotif(phraseMotif, this.context.tonic, scale)
        } else {
          const t = rng.pick([-2, 0, 2])
          if (t !== 0) motif = transposeMotif(phraseMotif, t, this.context.tonic, scale)
        }
      } else if (variationChoice === 2) {
        // Retrograde (with 20% probability)
        if (rng.next() < 0.2) {
          motif = retrogradeMotif(phraseMotif)
        }
      } else if (variationChoice === 3) {
        // Fragment (first half only, with 25% probability)
        if (rng.next() < 0.25) {
          const halfNotes = phraseMotif.notes.slice(0, Math.ceil(phraseMotif.notes.length / 2))
          if (halfNotes.length > 0) {
            motif = { ...phraseMotif, notes: halfNotes }
          }
        }
      }
      // variationChoice === 4: no change (original motif)
    }

    // Render motif notes, snapping to tessitura (MIDI 60-84).
    const notes = motif.notes.map((n) => {
      let midi = n.midi
      while (midi < LEAD_MIN_MIDI) midi += 12
      while (midi > LEAD_MAX_MIDI) midi -= 12
      return {
        midi,
        step: n.step,
        durationSteps: n.durationSteps,
        velocity: n.velocity,
      }
    })

    // Enforce max leap: clamp consecutive intervals to ±maxLeap.
    const maxLeap = this.grammar.maxLeap
    for (let i = 1; i < notes.length; i++) {
      const prev = notes[i - 1]
      const cur = notes[i]
      if (!prev || !cur) continue
      const interval = cur.midi - prev.midi
      if (Math.abs(interval) > maxLeap) {
        const sign = Math.sign(interval)
        cur.midi = prev.midi + sign * maxLeap
      }
    }

    // Snap to chord tones with some probability — keeps HARMONY_IGNORED away
    // while preserving the motif's overall shape.
    const chordPcs = new Set(harmonicContext)
    if (chordPcs.size > 0) {
      for (const n of notes) {
        const pc = ((n.midi % 12) + 12) % 12
        if (!chordPcs.has(pc) && rng.next() < 0.5) {
          for (let off = 1; off <= 2; off++) {
            const upPc = (((n.midi + off) % 12) + 12) % 12
            if (chordPcs.has(upPc)) {
              n.midi += off
              break
            }
            const downPc = (((n.midi - off) % 12) + 12) % 12
            if (chordPcs.has(downPc)) {
              n.midi -= off
              break
            }
          }
        }
      }
    }

    return notes
  }
}

// ---------------- pure transform helpers (involutions) ----------------

/**
 * Pure pitch inversion (no scale snapping). Mirrors each note around the
 * first note's MIDI value. This is a TRUE involution: applying it twice
 * returns the original motif exactly. Useful for property-based tests.
 */
export function invertPitchPure(motif: Motif): Motif {
  if (motif.notes.length === 0) {
    return createMotif([], {
      id: `${motif.id}:pureInvert`,
      rootPc: motif.rootPc,
      scaleName: motif.scaleName,
      steps: motif.steps,
      role: motif.role,
      sourceMotifId: motif.id,
      transformHistory: [...motif.transformHistory, 'invertPitchPure'],
    })
  }
  const first = motif.notes[0] as MotifNote
  const notes = motif.notes.map((n) => {
    if (n === first) return { ...n }
    const offset = n.midi - first.midi
    return { ...n, midi: first.midi - offset }
  })
  return createMotif(notes, {
    id: `${motif.id}:pureInvert`,
    rootPc: motif.rootPc,
    scaleName: motif.scaleName,
    steps: motif.steps,
    role: motif.role,
    sourceMotifId: motif.id,
    transformHistory: [...motif.transformHistory, 'invertPitchPure'],
  })
}

/**
 * Retrograde that is a TRUE involution: reversing note content while
 * preserving step positions. Wraps the existing transformation.retrograde
 * so callers can verify the involution property via the composition module.
 */
export function retrogradePure(motif: Motif): Motif {
  return retrogradeMotif(motif)
}

/** Convenience: how tightly the bass locks with the kick on beat 1. */
export function measureBassKickAlignment(
  bassNotes: { step: number; bar: number }[],
  kickNotes: { step: number; bar: number }[],
  bars: number
): number {
  if (bars === 0) return 0
  let aligned = 0
  for (let bar = 0; bar < bars; bar++) {
    const bassOnBeat1 = bassNotes.some((n) => n.bar === bar && n.step === 0)
    const kickOnBeat1 = kickNotes.some((n) => n.bar === bar && n.step === 0)
    if (bassOnBeat1 && kickOnBeat1) aligned++
  }
  return aligned / bars
}

/** Convenience: clamp a MIDI note into a register range. */
export function clampToRegister(midi: number, minMidi: number, maxMidi: number): number {
  let m = midi
  while (m < minMidi) m += 12
  while (m > maxMidi) m -= 12
  return m
}
