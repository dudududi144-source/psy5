import { BeatEstimator } from './beatEstimator.ts'
import { ConfidenceTracker } from './confidenceTracker.ts'
import { PhaseCorrector } from './phaseCorrector.ts'
import type {
  BeatObservation,
  MusicalTransport,
  PredictedBeatTime,
  TransportClockOptions,
} from './types.ts'

const DEFAULTS: Required<TransportClockOptions> = {
  beatsPerBar: 4,
  initialBpm: 120,
  minBpm: 60,
  maxBpm: 200,
  tempoSmoothing: 0.3,
  phaseCorrectionRate: 0.5,
  relockWindow: 0.08,
  gapTimeout: 2.0,
  confidenceDecayPerSec: 0.15,
  confidenceGainPerObs: 0.25,
  lockMinObservations: 3,
  octaveFoldTolerance: 0.08,
}

export class TransportClock {
  private readonly opts: Required<TransportClockOptions>
  private readonly estimator: BeatEstimator
  private readonly corrector: PhaseCorrector
  private readonly confidence: ConfidenceTracker

  private origin: MusicalTransport['origin']
  private revision = 0
  private observationCount = 0
  private lastObservedAt: number | null = null
  private lastSnapshotAt = 0
  private readonly revisionListeners = new Set<(t: MusicalTransport) => void>()

  constructor(opts: TransportClockOptions = {}) {
    this.opts = { ...DEFAULTS, ...opts }
    this.estimator = new BeatEstimator({
      initialBpm: this.opts.initialBpm,
      minBpm: this.opts.minBpm,
      maxBpm: this.opts.maxBpm,
      tempoSmoothing: this.opts.tempoSmoothing,
      octaveFoldTolerance: this.opts.octaveFoldTolerance,
    })
    this.corrector = new PhaseCorrector({
      relockWindow: this.opts.relockWindow,
      phaseCorrectionRate: this.opts.phaseCorrectionRate,
    })
    this.confidence = new ConfidenceTracker({
      confidenceGainPerObs: this.opts.confidenceGainPerObs,
      confidenceDecayPerSec: this.opts.confidenceDecayPerSec,
    })
    this.origin = { audioTime: 0, beatIndex: 0, bpm: this.opts.initialBpm }
  }

  observe(beat: BeatObservation): void {
    const result = this.estimator.ingest(beat)
    const bpm = this.estimator.currentBpm

    if (result === null) {
      this.origin = { audioTime: beat.observedAt, beatIndex: 0, bpm }
      this.confidence.onObservation(beat.observedAt, null, false, 'none')
      this.observationCount += 1
      this.lastObservedAt = beat.observedAt
      this.bumpRevision()
      return
    }

    const correction = this.corrector.evaluate(this.origin, bpm, beat.observedAt)
    this.origin = correction.origin
    this.confidence.onObservation(
      beat.observedAt,
      result.intervalSec,
      correction.relocked,
      result.folded
    )
    this.observationCount += 1
    this.lastObservedAt = beat.observedAt

    if (correction.relocked || result.changed || result.folded !== 'none') {
      this.bumpRevision()
    }
  }

  snapshot(atAudioTime: number): MusicalTransport {
    if (atAudioTime > this.lastSnapshotAt) {
      this.confidence.decay(atAudioTime)
      this.lastSnapshotAt = atAudioTime
    }

    const bpm = this.estimator.currentBpm
    const secPerBeat = 60 / bpm
    const elapsed = atAudioTime - this.origin.audioTime
    const beatFloat = this.origin.beatIndex + elapsed / secPerBeat
    const beat = Math.floor(beatFloat)
    const beatsPerBar = this.opts.beatsPerBar
    const bar = Math.floor(beat / beatsPerBar)
    const phase = beatFloat - beat
    const beatInBar = beatFloat - bar * beatsPerBar
    const barPhase = beatInBar / beatsPerBar
    const beatTime = beatFloat * secPerBeat
    const barTime = beatInBar * secPerBeat
    const lastObservationAgo =
      this.lastObservedAt === null ? Number.POSITIVE_INFINITY : atAudioTime - this.lastObservedAt
    const confidence = this.confidence.current
    const locked =
      confidence >= 0.5 &&
      lastObservationAgo <= this.opts.gapTimeout &&
      this.observationCount >= this.opts.lockMinObservations

    return {
      bpm,
      beat,
      bar,
      beatsPerBar,
      beatTime,
      barTime,
      phase,
      barPhase,
      confidence,
      locked,
      revision: this.revision,
      origin: { ...this.origin },
      lastObservationAgo,
      observationCount: this.observationCount,
    }
  }

  predict(atAudioTime: number): PredictedBeatTime {
    const bpm = this.estimator.currentBpm
    const secPerBeat = 60 / bpm
    const elapsed = atAudioTime - this.origin.audioTime
    return this.origin.beatIndex + elapsed / secPerBeat
  }

  reset(): void {
    this.estimator.reset(this.opts.initialBpm)
    this.confidence.reset()
    this.origin = { audioTime: 0, beatIndex: 0, bpm: this.opts.initialBpm }
    this.revision = 0
    this.observationCount = 0
    this.lastObservedAt = null
    this.lastSnapshotAt = 0
    this.bumpRevision()
  }

  onRevision(cb: (t: MusicalTransport) => void): () => void {
    this.revisionListeners.add(cb)
    return () => this.revisionListeners.delete(cb)
  }

  private bumpRevision(): void {
    this.revision += 1
    const snap = this.snapshot(this.lastObservedAt ?? this.lastSnapshotAt ?? 0)
    for (const cb of this.revisionListeners) cb(snap)
  }
}
