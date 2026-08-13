export type Anomaly =
  | 'perfect'
  | 'jitter'
  | 'tempo-ramp'
  | 'tempo-jump'
  | 'missing-beat'
  | 'false-kick'
  | 'half-time'
  | 'double-time'
  | 'gap-500ms'
  | 'gap-2s'
  | 'sparse'
  | 'dense-bass'
  | 'lead-heavy'
  | 'breakdown'

export interface Fixture {
  id: string
  name: string
  anomaly: Anomaly
  sampleRate: number
  durationSec: number
  signal: Float32Array
  groundTruthBeats: number[]
  groundTruthBpm: number | null
  description: string
}
