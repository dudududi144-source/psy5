import type { MusicalEvent } from './events.ts'

export type ChannelListener<E = MusicalEvent> = (event: E) => void
export type Unsubscribe = () => void

export interface Channel {
  subscribe(listener: ChannelListener): Unsubscribe
  publish(event: MusicalEvent): void
  close(): void
  readonly name: string
}

export class InMemoryChannel implements Channel {
  readonly name: string
  private readonly listeners = new Set<ChannelListener>()
  private closed = false

  constructor(name = 'in-memory') {
    this.name = name
  }

  subscribe(listener: ChannelListener): Unsubscribe {
    if (this.closed) throw new Error(`Channel "${this.name}" is closed`)
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish(event: MusicalEvent): void {
    if (this.closed) return
    const listeners = Array.from(this.listeners)
    for (const l of listeners) l(event)
  }

  close(): void {
    this.closed = true
    this.listeners.clear()
  }

  get subscriberCount(): number {
    return this.listeners.size
  }
}
