import type { DeviceCapabilities, MusicalContext, MusicalEvent } from '@psy-foundation/protocol'
import type { MusicalTransport } from '@psy-foundation/transport'

export interface PsyDevice {
  id: string
  capabilities(): DeviceCapabilities
  onTransport(transport: MusicalTransport): void
  onContext(context: MusicalContext): void
  onEvent(event: MusicalEvent): void
  onStart?(): void
  onStop?(): void
  reportLatencyMs?(): number
}
