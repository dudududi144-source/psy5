import type { AudioTime } from '@psy-foundation/transport'

export interface ScheduledNote {
  at: AudioTime
  note: number
  velocity: number
  duration: number
  channel: string
}

export type ScheduledEvent =
  | ({ type: 'note' } & ScheduledNote)
  | { type: 'param'; at: AudioTime; channel: string; param: string; value: number; rampSec: number }

export interface PatternStep {
  on: boolean
  vel: number
  prob: number
  micro: number
  note: number
  lock?: Record<string, number>
}

export interface PatternTrack {
  id: string
  role: string
  defaultNote: number
  durationBeats: number
  steps: PatternStep[]
}

export interface MusicalPlan {
  tracks: PatternTrack[]
  fromBar: number
  barCount: number
}

export interface SchedulerOptions {
  beatsPerBar?: number
  swing?: number
  humanizeSec?: number
  seed?: number
  originAudioTime: AudioTime
  bpm: number
}
