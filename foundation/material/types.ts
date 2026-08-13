/**
 * Typed payloads for the 9 material kinds.
 *
 * Each `Material` in the protocol layer carries an opaque `payload: unknown`.
 * Here we define the discriminated union of concrete payload shapes so factory
 * builders, the seed library, and downstream consumers can stay type-safe.
 */

import type { BassNote, MotifNote, RhythmPattern } from '@psy-foundation/music'

export interface MotifPayload {
  kind: 'motif'
  rootPc: number
  scaleName: string
  notes: MotifNote[]
}

export interface RhythmPayload {
  kind: 'rhythm'
  steps: number
  hits: boolean[]
  velocities: number[]
  micros: number[]
}

export interface BassPatternPayload {
  kind: 'bass-pattern'
  rootPc: number
  scaleName: string
  style: string
  notes: BassNote[]
}

export interface DrumPatternPayload {
  kind: 'drum-pattern'
  tracks: Record<string, RhythmPattern>
}

export interface FillPayload {
  kind: 'fill'
  steps: number
  notesByStep: number[][]
  velocities: number[]
  role: string
}

export interface PhrasePayload {
  kind: 'phrase'
  bars: Array<{ motifId?: string; bassPatternId?: string; drumPatternId?: string }>
}

export interface FXGesturePayload {
  kind: 'fx-gesture'
  param: string
  points: Array<{ t: number; v: number }>
  durationSec: number
}

export interface PresetPayload {
  kind: 'preset'
  engine: string
  params: Record<string, number>
}

export interface TexturePayload {
  kind: 'texture'
  rootHz: number
  partials: Array<{ ratio: number; amp: number }>
  lfo?: { rateHz: number; depth: number }
}

export type MaterialPayload =
  | MotifPayload
  | RhythmPayload
  | BassPatternPayload
  | DrumPatternPayload
  | FillPayload
  | PhrasePayload
  | FXGesturePayload
  | PresetPayload
  | TexturePayload

/** Return the discriminant `kind` string of any material payload. */
export function payloadKind(payload: MaterialPayload): MaterialPayload['kind'] {
  return payload.kind
}
