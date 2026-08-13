import { spectrum } from './dsp.ts'
import { spectralFlux } from './features.ts'
import {
  type MusicalInference,
  type SectionLabel,
  detectSectionBoundaries,
  inferMusical,
  refineTempoWithContext,
} from './inference.ts'
/**
 * Analyzer — stateful stream wrapper around the analysis primitives.
 *
 * Owns a rolling history of onsets, sections, and spectral-flux samples so
 * downstream consumers can ask "what is the latest musical context?" without
 * re-running the whole pipeline.
 */
import { type Onset, type OnsetOptions, detectOnsets } from './onset.ts'
import { type DominantPitchClass, type PitchResult, detectPitch } from './pitch.ts'
import { chroma, dominantPitchClass } from './pitch.ts'
import {
  type TempoHypothesis,
  type TempoOptions,
  type TempoResult,
  estimateTempo,
} from './tempo.ts'

export interface AnalyzerOptions {
  sampleRate: number
  frameSize?: number
  hopSize?: number
  onsetHistorySize?: number
  sectionHistorySize?: number
}

export interface AnalyzerFrame {
  index: number
  frame: Float32Array
  mag: Float32Array
  inference: MusicalInference
  pitch: PitchResult
  chroma: number[]
  dominantPitchClass: DominantPitchClass
  flux: number
}

export class Analyzer {
  private readonly _sampleRate: number
  private readonly _frameSize: number
  private readonly _hopSize: number
  private readonly _onsetHistorySize: number
  private readonly _sectionHistorySize: number

  private _frameCount = 0
  private _onsets: Onset[] = []
  private _sections: SectionLabel[] = []
  private _fluxHistory: number[] = []
  private _latestFrame: AnalyzerFrame | null = null
  private _prevMag: Float32Array | null = null

  constructor(opts: AnalyzerOptions) {
    this._sampleRate = opts.sampleRate
    this._frameSize = opts.frameSize ?? 1024
    this._hopSize = opts.hopSize ?? 512
    this._onsetHistorySize = opts.onsetHistorySize ?? 64
    this._sectionHistorySize = opts.sectionHistorySize ?? 32
  }

  get sampleRate(): number {
    return this._sampleRate
  }

  get frameSize(): number {
    return this._frameSize
  }

  get frameCount(): number {
    return this._frameCount
  }

  get onsets(): readonly Onset[] {
    return this._onsets
  }

  get sections(): readonly SectionLabel[] {
    return this._sections
  }

  get sectionBoundaries(): number[] {
    return detectSectionBoundaries(this._sections)
  }

  get fluxHistory(): readonly number[] {
    return this._fluxHistory
  }

  get latestFrame(): AnalyzerFrame | null {
    return this._latestFrame
  }

  get latestInference(): MusicalInference | null {
    return this._latestFrame ? this._latestFrame.inference : null
  }

  get latestPitch(): PitchResult | null {
    return this._latestFrame ? this._latestFrame.pitch : null
  }

  get latestChroma(): number[] | null {
    return this._latestFrame ? this._latestFrame.chroma : null
  }

  get latestDominantPitchClass(): DominantPitchClass | null {
    return this._latestFrame ? this._latestFrame.dominantPitchClass : null
  }

  /** Ingest a single time-domain frame, update histories, return the result. */
  ingest(frame: Float32Array | number[]): AnalyzerFrame {
    const mag = spectrum(frame)
    const pitch = detectPitch(frame, this._sampleRate)
    const chromaVec = chroma(mag, this._sampleRate)
    const dpc = dominantPitchClass(chromaVec)
    const inference = inferMusical(mag, this._sampleRate, this._onsets)

    let flux = 0
    if (this._prevMag) {
      flux = spectralFlux(this._prevMag, mag)
    }
    this._prevMag = mag

    this._fluxHistory.push(flux)
    if (this._fluxHistory.length > this._onsetHistorySize) {
      this._fluxHistory.shift()
    }

    this._sections.push(inference.section)
    if (this._sections.length > this._sectionHistorySize) {
      this._sections.shift()
    }

    const result: AnalyzerFrame = {
      index: this._frameCount,
      frame: frame instanceof Float32Array ? frame : new Float32Array(frame),
      mag,
      inference,
      pitch,
      chroma: chromaVec,
      dominantPitchClass: dpc,
      flux,
    }
    this._latestFrame = result
    this._frameCount += 1
    return result
  }

  /** Push an externally-detected onset into the rolling history. */
  pushOnset(onset: Onset): void {
    this._onsets.push(onset)
    if (this._onsets.length > this._onsetHistorySize) this._onsets.shift()
  }

  /** Run onset detection on a longer signal and merge results into history. */
  detectOnsetsIn(signal: Float32Array | number[]): Onset[] {
    const opts: OnsetOptions = {
      sampleRate: this._sampleRate,
      frameSize: this._frameSize,
      hopSize: this._hopSize,
    }
    const detected = detectOnsets(signal, opts)
    for (const o of detected) {
      this._onsets.push(o)
    }
    while (this._onsets.length > this._onsetHistorySize) this._onsets.shift()
    return detected
  }

  /** Multi-hypothesis tempo estimate over the current onset history. */
  estimateTempo(opts: TempoOptions = {}): TempoResult {
    return estimateTempo(this._onsets, opts)
  }

  /** Apply `refineTempoWithContext` to the best hypothesis. May be null. */
  musicalTempo(opts: TempoOptions = {}): TempoHypothesis | null {
    const { best } = this.estimateTempo(opts)
    if (!best) return null
    return refineTempoWithContext(best, this._onsets)
  }

  /** Reset all rolling state. */
  reset(): void {
    this._frameCount = 0
    this._onsets = []
    this._sections = []
    this._fluxHistory = []
    this._latestFrame = null
    this._prevMag = null
  }
}
