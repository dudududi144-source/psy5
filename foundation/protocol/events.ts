import type { MusicalTransport } from '@psy-foundation/transport'

export type EventTime = number

export interface BeatEvent {
  type: 'beat'
  beat: number
  bar: number
  transport: MusicalTransport
  at: EventTime
}
export interface SectionEvent {
  type: 'section'
  section: string
  bar: number
  at: EventTime
}
export interface EnergyEvent {
  type: 'energy'
  energy: number
  at: EventTime
}
export interface DropEvent {
  type: 'drop'
  intensity: number
  at: EventTime
}
export interface NoteEvent {
  type: 'note'
  note: number
  velocity: number
  duration: number
  channel: string
  at: EventTime
}
export interface PatternEvent {
  type: 'pattern'
  patternId: string
  trackId: string
  at: EventTime
}

export type MusicalEvent =
  | BeatEvent
  | SectionEvent
  | EnergyEvent
  | DropEvent
  | NoteEvent
  | PatternEvent
export type EventOfType<T extends MusicalEvent['type']> = Extract<MusicalEvent, { type: T }>
