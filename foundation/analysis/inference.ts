/**
 * Musical inference: role occupancy, energy class, section label, and the
 * sparse-fix tempo refinement.
 */
import {
  bandEnergy,
  bassActivity,
  highEnergy,
  lowMidEnergy,
  spectralCentroid,
  spectralFlatness,
} from './features.ts'
import type { Onset } from './onset.ts'
import type { TempoHypothesis } from './tempo.ts'

export interface RoleOccupancy {
  /** Kick/sub presence in [0,1]. */
  kick: number
  /** Bass instrument body in [0,1]. */
  bass: number
  /** Lead/mid content in [0,1]. */
  lead: number
  /** Hats/high-frequency content in [0,1]. */
  hats: number
}

export type EnergyClass = 'silent' | 'low' | 'medium' | 'high'

export type SectionLabel = 'intro' | 'build' | 'drop' | 'breakdown' | 'outro'

export interface MusicalInference {
  occupancy: RoleOccupancy
  energy: EnergyClass
  section: SectionLabel
  /** Fraction of total band energy that lives in the bass (20-120 Hz) band. */
  bassRatio: number
  /** Spectral centroid in Hz (brightness). */
  brightness: number
  /** Spectral flatness in [0,1] (noisiness). */
  noisiness: number
}

export interface InferMusicalOptions {
  /** Threshold (sum of mags) below which the frame counts as silent. */
  silentThreshold?: number
  /** Threshold below which energy counts as low. */
  lowThreshold?: number
  /** Threshold above which energy counts as high. */
  highThreshold?: number
}

const INFER_DEFAULTS: Required<InferMusicalOptions> = {
  silentThreshold: 0.5,
  lowThreshold: 5,
  highThreshold: 25,
}

/**
 * Infer a musical description of a single magnitude spectrum.
 *
 * `onsets` is accepted so future context-aware versions can use onset history;
 * the current implementation uses it only indirectly (it doesn't change the
 * per-frame classification, but the call site can pass it for forwards
 * compatibility).
 */
export function inferMusical(
  mag: ArrayLike<number>,
  sampleRate: number,
  _onsets: Array<{ at: number }> | Onset[] = [],
  opts: InferMusicalOptions = {}
): MusicalInference {
  const o = { ...INFER_DEFAULTS, ...opts }
  const bass = bassActivity(mag, sampleRate)
  const lowMid = lowMidEnergy(mag, sampleRate)
  const mid = bandEnergy(mag, sampleRate, 500, 2000)
  const high = highEnergy(mag, sampleRate)
  const total = bass + lowMid + mid + high

  const bassRatio = total > 0 ? bass / total : 0
  const brightness = spectralCentroid(mag, sampleRate)
  const noisiness = spectralFlatness(mag)

  const maxBand = Math.max(bass, lowMid, mid, high)
  const norm = (v: number) => (maxBand > 0 ? v / maxBand : 0)
  const occupancy: RoleOccupancy = {
    kick: norm(bass),
    bass: norm(lowMid),
    lead: norm(mid),
    hats: norm(high),
  }

  // Energy class from total band energy.
  let energy: EnergyClass
  if (total <= o.silentThreshold) energy = 'silent'
  else if (total < o.lowThreshold) energy = 'low'
  else if (total < o.highThreshold) energy = 'medium'
  else energy = 'high'

  // Section label: a simple energy-and-bass heuristic. With per-frame info
  // alone we can't really know "intro" vs "outro", so this is a best-effort
  // guess that downstream code (section history) can override.
  let section: SectionLabel
  if (energy === 'silent') section = 'breakdown'
  else if (energy === 'low') section = 'intro'
  else if (energy === 'medium') section = 'build'
  else if (bassRatio > 0.4) section = 'drop'
  else section = 'build'

  return { occupancy, energy, section, bassRatio, brightness, noisiness }
}

/**
 * Indices where the section label changes.
 * E.g. ['intro','intro','build','drop'] -> [2, 3] (the first index of each
 * new label after the start).
 */
export function detectSectionBoundaries(sections: ArrayLike<SectionLabel>): number[] {
  const out: number[] = []
  const n = sections.length
  if (n === 0) return out
  let prev = sections[0] as SectionLabel
  for (let i = 1; i < n; i++) {
    const cur = sections[i] as SectionLabel
    if (cur !== prev) {
      out.push(i)
      prev = cur
    }
  }
  return out
}

export interface RefineTempoOptions {
  preferredRange?: [number, number]
}

/**
 * THE SPARSE FIX: if a winning hypothesis is below the preferred range and
 * doubling lands inside it, double the tempo with a 0.92 score penalty.
 *
 * This resolves the classic sparse half-time ambiguity — when only beats 1
 * and 3 are present, the multi-hypothesis tracker can lock to 75 BPM (half
 * the true 150). Doubling recovers the musical tempo.
 *
 * `onsets` is accepted for future context-aware refinement but unused here.
 */
export function refineTempoWithContext(
  hypothesis: TempoHypothesis,
  _onsets: Array<{ at: number }> | Onset[] = [],
  opts: RefineTempoOptions = {}
): TempoHypothesis {
  const range = opts.preferredRange ?? [100, 180]
  const { bpm, score } = hypothesis
  const doubled = bpm * 2
  if (bpm < range[0] && doubled >= range[0] && doubled <= range[1]) {
    return { ...hypothesis, bpm: doubled, score: score * 0.92 }
  }
  return hypothesis
}
