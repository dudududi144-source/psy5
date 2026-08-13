/**
 * Multi-hypothesis tempo tracker.
 *
 * For each candidate bpm in [minBpm, maxBpm] step `bpmStep`, for each octave
 * multiplier in `octaves`, score the (bpm, octave) hypothesis by trying 16
 * phase offsets and minimising the sum of squared distances from each onset to
 * its nearest beat. Lower score = better fit.
 */
import type { Onset } from './onset.ts'

export interface TempoHypothesis {
  /** Effective tempo in BPM (already octave-folded). */
  bpm: number
  /** Sum-of-squared-distances score; lower is better. */
  score: number
  /** Octave multiplier used (0.5, 1, or 2). */
  octave: number
  /** Best phase offset in seconds (start of the first beat). */
  phase: number
}

export interface TempoOptions {
  minBpm?: number
  maxBpm?: number
  bpmStep?: number
  octaves?: number[]
  /** Number of phase offsets to try per hypothesis. */
  phaseSteps?: number
}

export interface TempoResult {
  best: TempoHypothesis | null
  top: TempoHypothesis[]
}

const DEFAULTS: Required<TempoOptions> = {
  minBpm: 60,
  maxBpm: 200,
  bpmStep: 0.5,
  octaves: [0.5, 1, 2],
  phaseSteps: 16,
}

/**
 * Estimate the tempo of an onset list. Returns the best hypothesis plus the
 * top 5 by score. Ties are broken toward the lower bpm (avoids spurious
 * double/half-time picks); callers should use `pickMusicalWinner` to bias
 * toward a musical preferred range when several hypotheses score similarly.
 */
export function estimateTempo(
  onsets: Array<{ at: number }> | Onset[],
  opts: TempoOptions = {}
): TempoResult {
  const o = { ...DEFAULTS, ...opts }
  if (onsets.length === 0) return { best: null, top: [] }

  const onsetTimes: number[] = []
  for (const x of onsets) onsetTimes.push(x.at)

  // For each distinct effective bpm, keep only the lowest score across octaves.
  const byBpm = new Map<number, TempoHypothesis>()

  for (let candidate = o.minBpm; candidate <= o.maxBpm + 1e-9; candidate += o.bpmStep) {
    for (const octave of o.octaves) {
      const bpm = candidate * octave
      if (bpm < 1) continue
      const interval = 60 / bpm
      const { score, phase } = bestPhaseScore(onsetTimes, interval, o.phaseSteps)
      const existing = byBpm.get(bpm)
      if (!existing || score < existing.score - 1e-12) {
        byBpm.set(bpm, { bpm, score, octave, phase })
      }
    }
  }

  const all: TempoHypothesis[] = Array.from(byBpm.values())
  // Sort by score ascending; ties broken toward lower bpm (slower, musical
  // fundamental rather than double-time).
  all.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 1e-9) return a.score - b.score
    return a.bpm - b.bpm
  })

  const top = all.slice(0, 5)
  const best = top.length > 0 ? (top[0] as TempoHypothesis) : null
  return { best, top }
}

/** Try `phaseSteps` phase offsets and return the minimum score + its phase. */
function bestPhaseScore(
  onsetTimes: number[],
  interval: number,
  phaseSteps: number
): { score: number; phase: number } {
  let bestScore = Number.POSITIVE_INFINITY
  let bestPhase = 0
  for (let k = 0; k < phaseSteps; k++) {
    const phase = (k / phaseSteps) * interval
    let score = 0
    for (const t of onsetTimes) {
      const d = distanceToNearestBeat(t, phase, interval)
      score += d * d
    }
    if (score < bestScore - 1e-15) {
      bestScore = score
      bestPhase = phase
    }
  }
  return { score: bestScore, phase: bestPhase }
}

/** Distance from time `t` to the nearest beat at `phase + n*interval`. */
function distanceToNearestBeat(t: number, phase: number, interval: number): number {
  const rel = (t - phase) / interval
  const frac = rel - Math.round(rel)
  const abs = Math.abs(frac) * interval
  // Distance to nearest beat is min(abs, interval - abs), but the formula
  // abs(frac)*interval already gives the smaller side because |frac| <= 0.5
  // when using round().
  return abs
}

/**
 * Pick a musical winner from a list of hypotheses. If any hypothesis lies in
 * `preferredRange` with a score within `tolerance` (relative) of the best
 * score, prefer the in-range one. Otherwise return the lowest-score one.
 *
 * This is the function that resolves the sparse half-time ambiguity: when both
 * 75 and 150 BPM score 0, we want 150 (musical) rather than 75 (half-time).
 */
export function pickMusicalWinner(
  hypotheses: TempoHypothesis[],
  preferredRange: [number, number] = [100, 180],
  tolerance = 0.02
): TempoHypothesis | null {
  if (hypotheses.length === 0) return null
  const sorted = [...hypotheses].sort((a, b) => a.score - b.score)
  const best = sorted[0] as TempoHypothesis
  const bestScore = best.score
  const slack = Math.max(Math.abs(bestScore) * tolerance, 1e-9)
  // Among hypotheses within tolerance of the best score, prefer one in range.
  for (const h of sorted) {
    if (h.score > bestScore + slack) break
    if (h.bpm >= preferredRange[0] && h.bpm <= preferredRange[1]) return h
  }
  return best
}
