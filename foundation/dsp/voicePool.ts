/**
 * Voice lifecycle — pooled voice allocation (the pattern from psy5).
 *
 * Voices are pre-allocated and run for the lifetime of the engine. `noteOn`
 * only re-targets AudioParams; no nodes are created or destroyed in the hot
 * path. This eliminates GC-induced audio dropouts.
 *
 * This module provides the abstract pool logic. A concrete voice (synth voice,
 * drum voice, etc.) implements the `Voice` interface.
 */

export interface Voice {
  /** Whether this voice is currently sounding. */
  readonly active: boolean
  /** Trigger the voice with a note + velocity. */
  noteOn(note: number, velocity: number): void
  /** Release the voice (note off). */
  noteOff(): void
  /** Force-stop immediately (panic). */
  panic(): void
}

/**
 * Voice pool — round-robin allocation of pre-created voices.
 *
 * Generic over the voice type. The caller provides a `voiceFactory` that
 * creates a fresh voice on initialization.
 */
export class VoicePool<V extends Voice> {
  private readonly voices: V[]
  private next = 0
  private readonly maxVoices: number

  constructor(voiceFactory: () => V, voiceCount: number) {
    this.voices = Array.from({ length: voiceCount }, () => voiceFactory())
    this.maxVoices = voiceCount
  }

  /** Allocate a voice (round-robin). Steals the oldest if all are active. */
  allocate(): V {
    // Try to find an inactive voice first.
    for (let i = 0; i < this.maxVoices; i++) {
      const idx = (this.next + i) % this.maxVoices
      const v = this.voices[idx]
      if (v && !v.active) {
        this.next = (idx + 1) % this.maxVoices
        return v
      }
    }
    // All active — steal the next in round-robin.
    const stolen = this.voices[this.next]
    if (stolen) stolen.panic()
    const v = this.voices[this.next]
    this.next = (this.next + 1) % this.maxVoices
    return v as V
  }

  /** Trigger a note on an allocated voice. */
  noteOn(note: number, velocity: number): V {
    const v = this.allocate()
    v.noteOn(note, velocity)
    return v
  }

  /** Release all voices (note off on everything). */
  allOff(): void {
    for (const v of this.voices) v.noteOff()
  }

  /** Panic — force-stop all voices. */
  panic(): void {
    for (const v of this.voices) v.panic()
  }

  get size(): number {
    return this.maxVoices
  }

  get activeCount(): number {
    let count = 0
    for (const v of this.voices) if (v.active) count += 1
    return count
  }

  /** Get all voices (for per-voice processing). */
  get all(): readonly V[] {
    return this.voices
  }
}
