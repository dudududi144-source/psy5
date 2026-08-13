/**
 * Transport v1 — the canonical musical time model.
 *
 * See audit/TRANSPORT_CANONICAL_DESIGN.md for the full contract.
 *
 * Design principles (from psy4, generalized):
 * 1. AudioContext.currentTime (via nowFn) is the ONLY musical clock.
 * 2. Anchor-based time — no accumulation drift.
 * 3. Immutable snapshots — consumers cannot modify state.
 * 4. Epoch increments on every disruption.
 * 5. Holdover on source loss — transport continues, confidence decays.
 * 6. No phase reset on tempo change — re-anchor preserves position.
 * 7. Out-of-order observations rejected.
 * 8. Half/double tempo tracked as hypotheses — no false certainty.
 */

import type {
  TempoHypothesis,
  TransportConfig,
  TransportGrid,
  TransportListener,
  TransportObservation,
  TransportSnapshot,
  TransportSource,
  TransportSubscription,
} from './v1-types.ts'
import { DEFAULT_TRANSPORT_CONFIG } from './v1-types.ts'

export class Transport {
  private readonly config: TransportConfig
  private readonly nowFn: () => number

  // ── Anchor-based clock ──
  private anchorTime = 0
  private anchorBeatIndex = 0

  // ── Tempo ──
  private bpm: number
  private confidence = 0
  private locked = false
  private source: TransportSource = 'internal'

  // ── Epoch ──
  private epoch = 0

  // ── Beat tracking ──
  private beatIndex = 0
  private beatsPerBar: number
  private lastObsTime = 0
  private lastObsConfidence = 0
  private observationCount = 0

  // ── Holdover ──
  private holdoverActive = false
  private holdoverStartTime = 0
  private holdoverBpm = 0

  // ── Hypotheses ──
  private hypotheses: TempoHypothesis[] = []

  // ── Running state ──
  private running = false

  // ── Subscribers ──
  private readonly listeners = new Set<TransportListener>()

  constructor(nowFn: () => number, config: Partial<TransportConfig> = {}) {
    this.nowFn = nowFn
    this.config = { ...DEFAULT_TRANSPORT_CONFIG, ...config }
    this.bpm = this.config.initialBpm
    this.beatsPerBar = this.config.beatsPerBar
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Control
  // ═══════════════════════════════════════════════════════════════════════

  start(): void {
    if (this.running) return
    const now = this.nowFn()
    this.running = true
    this.anchorTime = now
    this.anchorBeatIndex = this.beatIndex
    this.epoch++
    this.notify()
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    this.epoch++
    this.notify()
  }

  seek(beatIndex: number): void {
    const now = this.nowFn()
    this.beatIndex = beatIndex
    this.anchorBeatIndex = beatIndex
    this.anchorTime = now
    this.epoch++
    this.notify()
  }

  setTempo(bpm: number, source: TransportSource = 'internal'): void {
    const now = this.nowFn()
    // Re-anchor to preserve CURRENT position (no phase reset).
    const currentBeatIndex = this.computeBeatIndex(now)
    this.anchorTime = now
    this.anchorBeatIndex = currentBeatIndex
    this.beatIndex = currentBeatIndex
    this.bpm = Math.max(this.config.minBpm, Math.min(this.config.maxBpm, bpm))
    this.source = source
    this.epoch++
    this.notify()
  }

  reset(): void {
    const now = this.nowFn()
    this.running = false
    this.bpm = this.config.initialBpm
    this.confidence = 0
    this.locked = false
    this.source = 'internal'
    this.anchorTime = now
    this.anchorBeatIndex = 0
    this.beatIndex = 0
    this.lastObsTime = 0
    this.lastObsConfidence = 0
    this.observationCount = 0
    this.holdoverActive = false
    this.holdoverBpm = 0
    this.hypotheses = []
    this.epoch++
    this.notify()
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Observation
  // ═══════════════════════════════════════════════════════════════════════

  observeBeat(obs: TransportObservation): void {
    // NaN / Infinity guard
    if (!Number.isFinite(obs.time) || !Number.isFinite(obs.confidence)) return
    // Confidence floor — reject very-low-confidence observations
    if (obs.confidence < this.config.lockThreshold * 0.5) return

    const _now = this.nowFn()

    // First observation — anchor
    if (!this.running || this.observationCount === 0) {
      this.anchorTime = obs.time
      this.anchorBeatIndex = this.beatIndex
      this.lastObsTime = obs.time
      this.lastObsConfidence = obs.confidence
      this.observationCount = 1
      this.source = obs.source
      this.holdoverActive = false
      this.confidence = obs.confidence
      this.notify()
      return
    }

    // Out-of-order / duplicate rejection
    const observedInterval = obs.time - this.lastObsTime
    if (observedInterval <= 0 || observedInterval > 10) {
      // Reject — do NOT update lastObsTime (discard entirely)
      return
    }

    const beatDuration = 60 / this.bpm

    // Half/double tempo: pick the candidate whose observedBpm is closer to current
    const candidate1 = Math.max(1, Math.floor(observedInterval / beatDuration))
    const candidate2 = candidate1 + 1
    const obsBpm1 = 60 / (observedInterval / candidate1)
    const obsBpm2 = 60 / (observedInterval / candidate2)
    const periodsElapsed =
      Math.abs(obsBpm1 - this.bpm) <= Math.abs(obsBpm2 - this.bpm) ? candidate1 : candidate2

    const observedPeriod = observedInterval / periodsElapsed
    const observedBpm = 60 / observedPeriod

    // Tempo update (single smoothing)
    if (observedBpm >= this.config.minBpm && observedBpm <= this.config.maxBpm) {
      const tempoGain = 0.08
      this.bpm += (observedBpm - this.bpm) * tempoGain
    }

    // Phase error — re-anchor only if large
    const predictedBeatTime = this.lastObsTime + periodsElapsed * beatDuration
    const phaseError = obs.time - predictedBeatTime
    const newBeatIndex = this.beatIndex + periodsElapsed
    const isBarBoundary = newBeatIndex % this.beatsPerBar === 0

    if (Math.abs(phaseError) > this.config.reanchorThresholdSec && isBarBoundary) {
      // Smooth re-anchor: 30% correction per bar boundary
      const correctedTime = predictedBeatTime + phaseError * 0.3
      this.anchorTime = correctedTime
      this.anchorBeatIndex = newBeatIndex
      this.epoch++
    } else if (Math.abs(phaseError) > this.config.reanchorThresholdSec * 3) {
      // Large phase error mid-bar — re-anchor immediately
      this.anchorTime = obs.time
      this.anchorBeatIndex = newBeatIndex
      this.epoch++
    }

    this.beatIndex = newBeatIndex
    this.lastObsTime = obs.time
    this.lastObsConfidence = obs.confidence
    this.observationCount++

    // Exit holdover
    if (this.holdoverActive) {
      this.holdoverActive = false
      this.source = obs.source
    }

    // Confidence update (exponential smoothing)
    this.confidence = this.confidence * 0.85 + obs.confidence * 0.15

    // Lock
    if (
      this.observationCount >= this.config.minObservationsForLock &&
      this.confidence > this.config.lockThreshold
    ) {
      this.locked = true
    }

    // Update tempo hypotheses
    this.updateHypotheses(observedBpm, periodsElapsed)

    this.notify()
  }

  loseSource(): void {
    const now = this.nowFn()
    this.holdoverActive = true
    this.holdoverStartTime = now
    this.holdoverBpm = this.bpm
    this.source = 'internal'
    this.locked = false
    this.confidence *= 0.5
    this.notify()
  }

  onAudioContextResume(): void {
    const now = this.nowFn()
    // Re-anchor at current position
    const currentBeatIndex = this.computeBeatIndex(now)
    this.anchorTime = now
    this.anchorBeatIndex = currentBeatIndex
    this.beatIndex = currentBeatIndex
    this.epoch++
    this.notify()
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Reads
  // ═══════════════════════════════════════════════════════════════════════

  snapshot(): TransportSnapshot {
    const now = this.nowFn()
    return this.computeSnapshot(now)
  }

  predictBeats(horizonSec = 0.2): number[] {
    const snap = this.snapshot()
    const result: number[] = []
    let t = snap.nextBeatTime
    const maxTime = snap.timestamp + horizonSec
    while (t < maxTime) {
      if (t > snap.timestamp) result.push(t)
      t += snap.beatDuration
    }
    return result
  }

  gridAt(audioTime: number): TransportGrid {
    const beatDuration = 60 / this.bpm
    const beatsSinceAnchor = (audioTime - this.anchorTime) / beatDuration
    const beatIndex = this.anchorBeatIndex + beatsSinceAnchor
    const flooredBeatIndex = Math.floor(beatIndex)
    const phase = beatIndex - flooredBeatIndex
    const bar = Math.floor(flooredBeatIndex / this.beatsPerBar)
    const beat = flooredBeatIndex - bar * this.beatsPerBar
    return { beatIndex: flooredBeatIndex, phase, bar, beat }
  }

  getHypotheses(): TempoHypothesis[] {
    return [...this.hypotheses]
  }

  isRunning(): boolean {
    return this.running
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Subscription
  // ═══════════════════════════════════════════════════════════════════════

  subscribe(listener: TransportListener): TransportSubscription {
    this.listeners.add(listener)
    return { unsubscribe: () => this.listeners.delete(listener) }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Private
  // ═══════════════════════════════════════════════════════════════════════

  private computeBeatIndex(now: number): number {
    const beatDuration = 60 / this.bpm
    return this.anchorBeatIndex + (now - this.anchorTime) / beatDuration
  }

  private computeSnapshot(now: number): TransportSnapshot {
    const beatDuration = 60 / this.bpm
    const beatFloat = this.computeBeatIndex(now)
    const beatIndex = Math.floor(beatFloat)
    const phase = beatFloat - beatIndex
    const bar = Math.floor(beatIndex / this.beatsPerBar)
    const beat = beatIndex - bar * this.beatsPerBar
    const beatTime = this.anchorTime + (beatIndex - this.anchorBeatIndex) * beatDuration
    const barTime = this.anchorTime + (bar * this.beatsPerBar - this.anchorBeatIndex) * beatDuration
    const nextBeatTime = beatTime + beatDuration

    // Holdover confidence decay
    let effectiveConfidence = this.confidence
    if (this.holdoverActive) {
      const elapsed = now - this.holdoverStartTime
      const halfLife = this.config.holdoverHalfLifeSec
      effectiveConfidence = this.confidence * 0.5 ** (elapsed / halfLife)
    }

    return {
      timestamp: now,
      bpm: this.holdoverActive ? this.holdoverBpm : this.bpm,
      confidence: effectiveConfidence,
      locked: this.locked && !this.holdoverActive,
      beatTime,
      barTime,
      beat,
      bar,
      beatIndex,
      phase,
      barPhase: (beat + phase) / this.beatsPerBar,
      source: this.source,
      epoch: this.epoch,
      beatsPerBar: this.beatsPerBar,
      beatDuration,
      nextBeatTime,
      holdover: this.holdoverActive,
    }
  }

  private updateHypotheses(observedBpm: number, _periodsElapsed: number): void {
    const half = observedBpm / 2
    const double = observedBpm * 2

    const existing = (bpm: number) => this.hypotheses.find((h) => Math.abs(h.bpm - bpm) < 1)

    const isCloseToDouble = Math.abs(observedBpm - this.bpm * 2) < this.bpm * 0.1
    const isCloseToHalf = Math.abs(observedBpm - this.bpm / 2) < this.bpm * 0.1

    if (isCloseToDouble) {
      const ex = existing(double)
      if (ex) {
        this.hypotheses = this.hypotheses.map((h) =>
          h === ex
            ? { ...h, evidence: h.evidence + 1, confidence: Math.min(1, h.confidence + 0.1) }
            : h
        )
      } else {
        this.hypotheses.push({ bpm: double, confidence: 0.3, evidence: 1 })
      }
    }

    if (isCloseToHalf) {
      const ex = existing(half)
      if (ex) {
        this.hypotheses = this.hypotheses.map((h) =>
          h === ex
            ? { ...h, evidence: h.evidence + 1, confidence: Math.min(1, h.confidence + 0.1) }
            : h
        )
      } else {
        this.hypotheses.push({ bpm: half, confidence: 0.3, evidence: 1 })
      }
    }

    // Decay hypotheses that aren't getting evidence
    this.hypotheses = this.hypotheses
      .map((h) => ({ ...h, confidence: h.confidence * 0.95 }))
      .filter((h) => h.confidence > 0.05)

    // Keep the main hypothesis
    const main = existing(this.bpm)
    if (!main && this.locked) {
      this.hypotheses.push({
        bpm: this.bpm,
        confidence: this.confidence,
        evidence: this.observationCount,
      })
    }
  }

  private notify(): void {
    const snap = this.snapshot()
    for (const listener of this.listeners) {
      listener(snap)
    }
  }
}
