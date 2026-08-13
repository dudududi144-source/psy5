# FOUNDATION API

Versioned API reference for `psy-foundation`. Every package declares its API
version. Breaking changes require a version bump.

## Versioning rules

1. Each package exports a `API_VERSION` constant.
2. Breaking changes (removed/renamed exports, changed signatures) bump the
   major version.
3. Additive changes (new exports, new optional params) do NOT bump.
4. Consumers can check `import { API_VERSION } from '@psy-foundation/transport'`
   and refuse to run if the version is too low.
5. NEVER use `latest`, `master`, or implicit compatibility. Always version.

## Current API versions

| Package | Version | Status |
| --- | --- | --- |
| `@psy-foundation/transport` | v0 (pre-canonical) | NOT CANONICAL — see CONTRACT_GAPS.md |
| `@psy-foundation/protocol` | v1 | CANONICAL CANDIDATE |
| `@psy-foundation/device-sdk` | v1 | CANONICAL CANDIDATE |
| `@psy-foundation/fixtures` | v1 | CANONICAL CANDIDATE |
| `@psy-foundation/scheduler` | v1 (offline) | NOT CANONICAL for runtime (adapter required) |
| `@psy-foundation/analysis` | v0 (pre-canonical) | NOT CANONICAL — see CONTRACT_GAPS.md |
| `@psy-foundation/music` | v1 | CANONICAL CANDIDATE |
| `@psy-foundation/material` | v1 | CANONICAL CANDIDATE |
| `@psy-foundation/learning` | v1 | CANONICAL CANDIDATE |
| `@psy-foundation/dsp` | v1 | CANONICAL CANDIDATE |

## API surface by package

### @psy-foundation/transport v0

```typescript
// Clock
class TransportClock {
  constructor(opts?: TransportClockOptions)
  observe(beat: BeatObservation): void
  snapshot(atAudioTime: number): MusicalTransport
  predict(atAudioTime: number): PredictedBeatTime
  reset(): void
  onRevision(cb: (t: MusicalTransport) => void): () => void
}

// Types
interface MusicalTransport {
  bpm, beat, bar, beatsPerBar, beatTime, barTime,
  phase, barPhase, confidence, locked, revision,
  origin: { audioTime, beatIndex, bpm },
  lastObservationAgo, observationCount
}

interface BeatObservation { observedAt, strength, source? }
interface TransportClockOptions { /* 12 optional fields */ }
```

**v1 will add** (per CONTRACT_GAPS.md): `epoch`, `source`, `holdover`/`loseSource()`,
`nowFn` constructor, `onAudioContextResume()`, `predictBeats(horizonSec)`, `subscribe()`,
`seek(beatIndex)`, `setTempo(bpm, source)`.

### @psy-foundation/protocol v1

```typescript
// Events
type MusicalEvent = BeatEvent | SectionEvent | EnergyEvent | DropEvent | NoteEvent | PatternEvent

// State
interface TransportState { bpm, beat, bar, phase, locked, confidence, revision }
interface MusicalContext { key, rootPc, scale, energy, style, section, beatsPerBar }
interface DeviceCapabilities { audio, midi, inputs, outputs, voices, latencyMs, roles }
interface Material { id, type, role, style, tempoRange, keyCompatibility, energy, ... }
type MusicalAction = { type: 'play' | 'variation' | 'do-nothing' }
interface Experience { context, action, outcome, reward, at }

// Channel
interface Channel { subscribe, publish, close, name }
class InMemoryChannel implements Channel
```

**v2 will add**: `protocolVersion` field on all state types.

### @psy-foundation/device-sdk v1

```typescript
interface PsyDevice {
  id: string
  capabilities(): DeviceCapabilities
  onTransport(transport: MusicalTransport): void
  onContext(context: MusicalContext): void
  onEvent(event: MusicalEvent): void
  onStart?(): void
  onStop?(): void
  reportLatencyMs?(): number
}

class DeviceHost {
  register(device: PsyDevice): void
  unregister(id: string): void
  pushTransport(transport: MusicalTransport, nowMs: number): void
  pushContext(context: MusicalContext): void
  publish(event: MusicalEvent): void
  list(): Array<{ id, capabilities }>
  findByRole(role: string): PsyDevice[]
  dispose(): void
}

class ReferenceDevice implements PsyDevice
```

**v2 will add**: `scheduleLocal(events)` hook on PsyDevice.

### @psy-foundation/scheduler v1 (offline)

```typescript
function schedule(plan: MusicalPlan, opts: SchedulerOptions): ScheduledEvent[]

interface MusicalPlan { tracks: PatternTrack[], fromBar: number, barCount: number }
interface PatternStep { on, vel, prob, micro, note, lock? }
interface ScheduledEvent = NoteEvent | ParamEvent

// Helpers
function step(partial?): PatternStep
function emptyTrack(id, role, defaultNote, stepCount, durationBeats?): PatternTrack
```

**v2 will add**: `RuntimeScheduler` adapter with lookahead, AudioContext integration,
stale-event policy (see MIGRATION_PLAN.md Phase B).

### @psy-foundation/analysis v0

```typescript
class Analyzer {
  constructor(opts: AnalyzerOptions)
  ingest(frame: Float32Array): AnalyzerFrame
  pushOnset(onset: Onset): void
  detectOnsetsIn(signal: Float32Array): Onset[]
  estimateTempo(): { best, top }
  musicalTempo(): TempoHypothesis | null
  // getters: latestFrame, latestInference, latestPitch, latestChroma, ...
}

// Primitives
function detectOnsets(signal, opts): Onset[]
function detectPitch(frame, sampleRate): PitchEstimate
function chroma(mag, sampleRate): Float32Array
function estimateTempo(onsets, opts): { best, top }
```

**v1 will add**: signal/observation state separation, real confidence (not loudness),
triple timestamp model, strict transport boundary (see CONTRACT_GAPS.md GAP-R1..R4).

### @psy-foundation/music v1

```typescript
// Scales (18)
function getScale(name: string): Scale | null
function scalePcs(rootPc, scale): number[]
function degreeToMidi(rootPc, scale, degree, octave?): number

// Chords (18)
function getChordType(name): ChordType | null
function chordNotes(rootPc, type, octave?): number[]
function voiceChord(rootPc, type, previousVoicing, octave?): number[]

// Motif
function generateMotif(rootPc, scale, opts?): MotifNote[]
function transpose/invert/fragment/retrograde(notes, ...): MotifNote[]

// Bass + rhythm
function generateBassPattern(rootPc, scale, opts?): BassNote[]
function fourOnFloor/offbeatHats/psyKick/...(): RhythmPattern
```

### @psy-foundation/material v1

```typescript
class MaterialLibrary {
  add(material: Material): void
  get(id: string): Material | undefined
  query(opts): Material[]
  markUsed(id: string, at: number): void
  addReward(id: string, reward: number): void
  toJSON(): Material[]
  static fromJSON(data): MaterialLibrary
}

// Factory
function makeMotifMaterial/makeBassPatternMaterial/...(opts): Material
function createSeedLibrary(): MaterialLibrary
```

**v2 will add**: `validateMaterial(material)`, structured provenance.

### @psy-foundation/learning v1

```typescript
class Learner {
  constructor(opts?)
  decide(context, role, candidates): Decision
  recordOutcome(context, role, action, outcome, at, reward?): void
  stats(): LearningStats
  records(): LearnedRecord[]
  reset(): void
}

interface Decision { action: MusicalAction, reason, record, confidence }
interface LearningStats { totalExperiences, regret, retrievalQuality, explorationRate, abstentionRate, ... }
```

### @psy-foundation/dsp v1

```typescript
// Oscillators
class PolyBlepOsc { constructor(opts), process(), setFrequency(), reset() }
class FmOscillator { constructor(opts), process(), setCarrier/setModulator/setModIndex() }
class WavetableOsc { constructor(opts), process(), setFrequency() }

// Filters
class OnePoleLP / OnePoleHP / BiquadFilter / MoogLadder

// Envelopes
class Adsr { gateOn(), gateOff(), process(), reset() }
class PitchEnvelope { trigger(), process(), reset() }

// FX + metering + voice pool
class Delay / SchroederReverb / RmsMeter / PeakMeter / LufsMeter
class VoicePool<V extends Voice> { allocate(), noteOn(), allOff(), panic() }
```

## Dependency direction

```
psy-foundation (bottom layer)
       ↑
       │ (consumes)
     PSY6 / future devices
       │
       ├── product UI
       ├── product arrangement
       └── product-specific behavior
```

Foundation NEVER imports from a device. Devices import from foundation.
Foundation has zero dependency on React, Next.js, psyLive, or any specific
audio graph implementation.
