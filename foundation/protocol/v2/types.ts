/**
 * PSYBUS v2 — canonical bus types for psy-foundation.
 *
 * Transcribed from the psyboss family repo's proven spec:
 * `/home/z/psy-work/family/psyboss/docs/PSYBUS.md` (read-only source of truth).
 *
 * Transcription rules (task 3.6):
 * - Field names are kept EXACTLY as the spec spells them (`rev`, `vel`, `durBeats`,
 *   `reportLatencyMs`, …) so family repos can map 1:1 without a field-translation layer.
 * - Every field carries a `@provenance` TSDoc tag pointing at the spec section it came from.
 * - Nothing is invented: if the spec does not define a field, this file does not add it.
 *   The few places the spec *references* a type without defining it (`MusicalKey`, `Scale`,
 *   `Section`, `Unsubscribe`) are declared here with an explicit honesty note.
 *
 * Spec sections used:
 * - §"The message envelope"        → {@link BusEnvelope}
 * - §"The payload discriminated union" → {@link BusPayload} and the 15 payload interfaces
 * - §"The branded types"           → {@link DeviceId} … {@link Provenance}, {@link SampleRef}
 * - §"The host interface"          → {@link Unsubscribe} (type only; the bus runtime itself is
 *   integrator scope — see docs/PSYBUS_V2_ADOPTION.md "Deferred from the spec")
 * - §"Transport tiers (same types, different wire)" → the reason these types carry no
 *   transport-specific fields (see packages/protocol/src/v2/envelope.ts for the canonical-JSON
 *   codec decision).
 */

/**
 * Protocol version of this envelope implementation.
 *
 * @provenance foundation-side constant. PSYBUS.md does NOT define a version field inside the
 * envelope (§"The message envelope" fixes the field list, and adding one would break 1:1 family
 * mapping), so the version lives at the codec level: `decodeEnvelope` refuses inputs offered as
 * a protocol version other than this one. Exported so hosts/devices can negotiate.
 */
export const PSYBUS_PROTOCOL_VERSION = 2

/** Monotonic transport revision — "ticks since start" (§"The message envelope"). */
export type Rev = number

/**
 * Deterministic seed for this performance (§"The message envelope", §"Design principles" #4:
 * "Every event carries a `rev` and `seed`. Replay is byte-identical.").
 *
 * The spec does not bound the value; psyboss's default seed is `0x9e3779b9` (2654435769,
 * ARCHITECTURE.md §"Determinism & replay identity"), which exceeds `2^31 - 1`, so validation
 * accepts any safe integer rather than a uint31.
 */
export type Seed = number

/**
 * Publisher identity.
 *
 * @provenance psyboss/docs/PSYBUS.md §"The branded types" (`DeviceId = string & { __brand: 'DeviceId' }`).
 * The brand is phantom (erased at runtime); validation in envelope.ts is what makes a plain
 * string safe to brand.
 */
export type DeviceId = string & { readonly __brand: 'DeviceId' }

/** Track identity. @provenance psyboss/docs/PSYBUS.md §"The branded types". */
export type TrackId = string & { readonly __brand: 'TrackId' }

/** Scene identity (per-track scene matrix slot). @provenance psyboss/docs/PSYBUS.md §"The branded types". */
export type SceneId = string & { readonly __brand: 'SceneId' }

/** Parameter identity (for `param.lock` / `param.set`). @provenance psyboss/docs/PSYBUS.md §"The branded types". */
export type ParamId = string & { readonly __brand: 'ParamId' }

/** Choke-group identity (hardware-style mute groups). @provenance psyboss/docs/PSYBUS.md §"The branded types". */
export type ChokeGroupId = string & { readonly __brand: 'ChokeGroupId' }

/**
 * Musical key of the performance, e.g. `"A"` / `"F#"`.
 *
 * @provenance psyboss/docs/PSYBUS.md §"The payload discriminated union" (`context.key: MusicalKey`).
 * HONESTY NOTE: the spec *references* this type but never defines it. Foundation defines it as
 * a non-empty string; validation enforces that and nothing more.
 */
export type MusicalKey = string

/**
 * Musical scale of the performance, e.g. `"phrygian"`.
 *
 * @provenance psyboss/docs/PSYBUS.md §"The payload discriminated union" (`context.scale: Scale`).
 * HONESTY NOTE: referenced-but-undefined in the spec; foundation defines it as a non-empty string.
 */
export type Scale = string

/**
 * Arrangement section label, e.g. `"intro" | "build" | "drop"`.
 *
 * @provenance psyboss/docs/PSYBUS.md §"The payload discriminated union" (`context.section: Section`).
 * HONESTY NOTE: referenced-but-undefined in the spec; foundation defines it as a non-empty string
 * (legacy `SectionEvent.section` / `MusicalContext.section` were plain strings too).
 */
export type Section = string

/**
 * License under which referenced sample bytes may be used.
 *
 * @provenance psyboss/docs/PSYBUS.md §"The branded types" (`Provenance.license`).
 * The literal list is transcribed verbatim, including the spec's `'psboss-dsp'` spelling
 * (matching ARCHITECTURE.md §L3: `license: 'psboss-dsp'`). It is kept letter-exact — even the
 * apparent `s`-vs-`y` asymmetry vs the repo name — because it is part of the wire contract the
 * family already emits; "fixing" it here would fork the protocol.
 */
export type SampleLicense =
  | 'CC0'
  | 'CC-BY'
  | 'CC-BY-SA'
  | 'CC-BY-NC'
  | 'commercial-licensed'
  | 'psboss-dsp'

/**
 * Provenance record for sample material. The host refuses to route events whose samples lack
 * this metadata (§"Design principles" #6: "Provenance or nothing").
 *
 * @provenance psyboss/docs/PSYBUS.md §"The branded types" (`interface Provenance`).
 */
export interface Provenance {
  /** License tag; see {@link SampleLicense}. @provenance PSYBUS.md §"The branded types". */
  license: SampleLicense
  /** URL or generator id, e.g. `"PSYBOSS DSP generator v1"`. @provenance PSYBUS.md §"The branded types". */
  source: string
  /** Optional author string. @provenance PSYBUS.md §"The branded types" (`author?`). */
  author?: string
  /** Epoch ms at which the license was verified. @provenance PSYBUS.md §"The branded types". */
  verifiedAt: number
  /**
   * Integrity fingerprint of the sample bytes (spec: "sha-256 of sample bytes"); procedural
   * generators emit the `dsp:<soundId>:<seed>` form (ARCHITECTURE.md §L3).
   * @provenance PSYBUS.md §"The branded types".
   */
  fingerprint: string
}

/**
 * Reference to a sample, by id + provenance. Sample bytes are NEVER carried in an envelope —
 * only this reference is (which is what makes the 64 KiB envelope bound in envelope.ts sane).
 *
 * @provenance psyboss/docs/PSYBUS.md §"The branded types" (`interface SampleRef`; `provenance`
 * is REQUIRED — "host refuses to route without it").
 */
export interface SampleRef {
  /** Sample id within the device's library. @provenance PSYBUS.md §"The branded types". */
  id: string
  /** REQUIRED license/integrity record; see {@link Provenance}. @provenance PSYBUS.md §"The branded types". */
  provenance: Provenance
}

/**
 * The v2 message envelope — the single canonical frame every payload kind travels in.
 *
 * @provenance psyboss/docs/PSYBUS.md §"The message envelope" (`interface BusEnvelope<T>`),
 * field-for-field and in spec declaration order (which is also the canonical-JSON key order,
 * see envelope.ts).
 */
export interface BusEnvelope<T extends BusPayload = BusPayload> {
  /** Monotonic transport revision, stamped by the host. @provenance PSYBUS.md §"The message envelope" (`rev`). */
  rev: Rev
  /** Deterministic performance seed for replay. @provenance PSYBUS.md §"The message envelope" (`seed`). */
  seed: Seed
  /** Publisher device id. @provenance PSYBUS.md §"The message envelope" (`src`). */
  src: DeviceId
  /** Target device id or `'broadcast'` for all. @provenance PSYBUS.md §"The message envelope" (`dst`). */
  dst: DeviceId | 'broadcast'
  /** Audio-context time (seconds) the event is valid at. @provenance PSYBUS.md §"The message envelope" (`ts`). */
  ts: number
  /** Typed payload; see {@link BusPayload}. @provenance PSYBUS.md §"The message envelope" (`payload`). */
  payload: T
}

// ---------------------------------------------------------------------------
// Payload discriminated union — §"The payload discriminated union", 15 kinds.
// Per-kind interfaces are named `<Kind>Payload`; field names are verbatim spec.
// ---------------------------------------------------------------------------

/**
 * `{ kind: 'transport'; bpm; beat; bar; phase; playing }` — host → devices, sample-accurate.
 *
 * @provenance psyboss/docs/PSYBUS.md §"The payload discriminated union", transport group.
 * Supersedes legacy `TransportState` snapshots + `BeatEvent` (see deprecations.ts).
 */
export interface TransportPayload {
  /** Discriminator literal. @provenance PSYBUS.md §payload union. */
  kind: 'transport'
  /** Tempo in BPM. @provenance PSYBUS.md §payload union (`bpm`). */
  bpm: number
  /** Absolute beat index. @provenance PSYBUS.md §payload union (`beat`). */
  beat: number
  /** Absolute bar index. @provenance PSYBUS.md §payload union (`bar`). */
  bar: number
  /** Phase within the current beat/bar (spec gives no unit bound; foundation validates ≥ 0 finite). @provenance PSYBUS.md §payload union (`phase`). */
  phase: number
  /** Whether the transport is rolling. @provenance PSYBUS.md §payload union (`playing`). */
  playing: boolean
}

/** `{ kind: 'transport.seek'; beat }` — reposition the one clock. @provenance PSYBUS.md §payload union. */
export interface TransportSeekPayload {
  /** Discriminator literal. @provenance PSYBUS.md §payload union. */
  kind: 'transport.seek'
  /** Absolute beat to seek to. @provenance PSYBUS.md §payload union (`beat`). */
  beat: number
}

/** `{ kind: 'transport.start' }` — start the transport. @provenance PSYBUS.md §payload union. */
export interface TransportStartPayload {
  /** Discriminator literal. @provenance PSYBUS.md §payload union. */
  kind: 'transport.start'
}

/** `{ kind: 'transport.stop' }` — stop the transport. @provenance PSYBUS.md §payload union. */
export interface TransportStopPayload {
  /** Discriminator literal. @provenance PSYBUS.md §payload union. */
  kind: 'transport.stop'
}

/**
 * `{ kind: 'context'; key; scale; energy; section }` — the "what key are we in" channel,
 * host → devices.
 *
 * @provenance psyboss/docs/PSYBUS.md §"The payload discriminated union", musical-context group.
 * Supersedes legacy `MusicalContext` snapshots + `SectionEvent`/`EnergyEvent` (deprecations.ts).
 */
export interface ContextPayload {
  /** Discriminator literal. @provenance PSYBUS.md §payload union. */
  kind: 'context'
  /** Musical key; see {@link MusicalKey}. @provenance PSYBUS.md §payload union (`key`). */
  key: MusicalKey
  /** Scale; see {@link Scale}. @provenance PSYBUS.md §payload union (`scale`). */
  scale: Scale
  /** Energy 0..1 (foundation bound; family convention). @provenance PSYBUS.md §payload union (`energy`). */
  energy: number
  /** Section label; see {@link Section}. @provenance PSYBUS.md §payload union (`section`). */
  section: Section
}

/**
 * `{ kind: 'note'; track; note; vel; durBeats; channel }` — host OR device → devices.
 * Spec field names kept verbatim: `vel` (not `velocity`), `durBeats` (duration in BEATS, not
 * seconds — unit change vs legacy `NoteEvent.duration`).
 *
 * @provenance psyboss/docs/PSYBUS.md §"The payload discriminated union", note/trigger group.
 */
export interface NotePayload {
  /** Discriminator literal. @provenance PSYBUS.md §payload union. */
  kind: 'note'
  /** Target track. @provenance PSYBUS.md §payload union (`track`). */
  track: TrackId
  /** MIDI note number 0..127 (foundation bound). @provenance PSYBUS.md §payload union (`note`). */
  note: number
  /** Velocity 0..1 (foundation bound; family convention). @provenance PSYBUS.md §payload union (`vel`). */
  vel: number
  /** Duration in beats. @provenance PSYBUS.md §payload union (`durBeats`). */
  durBeats: number
  /** Numeric channel (spec: `number`; legacy `NoteEvent.channel` was a string — see deprecations.ts). @provenance PSYBUS.md §payload union (`channel`). */
  channel: number
}

/** `{ kind: 'note.off'; track; note }` — explicit note release (legacy events had no note-off). @provenance PSYBUS.md §payload union. */
export interface NoteOffPayload {
  /** Discriminator literal. @provenance PSYBUS.md §payload union. */
  kind: 'note.off'
  /** Target track. @provenance PSYBUS.md §payload union (`track`). */
  track: TrackId
  /** MIDI note number to release. @provenance PSYBUS.md §payload union (`note`). */
  note: number
}

/**
 * `{ kind: 'trig'; track; scene; sampleRef? }` — scene trigger; when a sample is referenced its
 * `sampleRef` MUST carry provenance (§"Design principles" #6).
 *
 * @provenance psyboss/docs/PSYBUS.md §"The payload discriminated union"; trig path described in
 * ARCHITECTURE.md §L2 ("The trig path is now wired through the bus").
 */
export interface TrigPayload {
  /** Discriminator literal. @provenance PSYBUS.md §payload union. */
  kind: 'trig'
  /** Target track. @provenance PSYBUS.md §payload union (`track`). */
  track: TrackId
  /** Scene slot to arm/fire. @provenance PSYBUS.md §payload union (`scene`). */
  scene: SceneId
  /** Optional sample reference; REQUIRED to be fully provenanced when present. @provenance PSYBUS.md §payload union (`sampleRef?`). */
  sampleRef?: SampleRef
}

/** `{ kind: 'sidechain.duck'; target; depth; releaseMs }` — device-to-device pumping ("sidechain without a cable"). @provenance PSYBUS.md §payload union + §"What PSYBUS unlocks". */
export interface SidechainDuckPayload {
  /** Discriminator literal. @provenance PSYBUS.md §payload union. */
  kind: 'sidechain.duck'
  /** Track whose gain ducks. @provenance PSYBUS.md §payload union (`target`). */
  target: TrackId
  /** Duck depth 0..1 (foundation bound). @provenance PSYBUS.md §payload union (`depth`). */
  depth: number
  /** Release time in milliseconds. @provenance PSYBUS.md §payload union (`releaseMs`). */
  releaseMs: number
}

/** `{ kind: 'choke'; group; except? }` — hardware-style choke group (e.g. open-hat stops on closed-hat). @provenance PSYBUS.md §payload union + §"What PSYBUS unlocks". */
export interface ChokePayload {
  /** Discriminator literal. @provenance PSYBUS.md §payload union. */
  kind: 'choke'
  /** Choke group id. @provenance PSYBUS.md §payload union (`group`). */
  group: ChokeGroupId
  /** Optional device exempted from the choke (e.g. the publisher). @provenance PSYBUS.md §payload union (`except?`). */
  except?: DeviceId
}

/** `{ kind: 'param.lock'; track; step; param; value }` — per-step parameter lock "as events; recordable, deterministic, replayable". @provenance PSYBUS.md §payload union + §"What PSYBUS unlocks". */
export interface ParamLockPayload {
  /** Discriminator literal. @provenance PSYBUS.md §payload union. */
  kind: 'param.lock'
  /** Target track. @provenance PSYBUS.md §payload union (`track`). */
  track: TrackId
  /** Step index within the pattern. @provenance PSYBUS.md §payload union (`step`). */
  step: number
  /** Parameter id. @provenance PSYBUS.md §payload union (`param`). */
  param: ParamId
  /** Locked value (foundation validates finite). @provenance PSYBUS.md §payload union (`value`). */
  value: number
}

/** `{ kind: 'param.set'; track; param; value }` — live parameter change. @provenance PSYBUS.md §payload union. */
export interface ParamSetPayload {
  /** Discriminator literal. @provenance PSYBUS.md §payload union. */
  kind: 'param.set'
  /** Target track. @provenance PSYBUS.md §payload union (`track`). */
  track: TrackId
  /** Parameter id. @provenance PSYBUS.md §payload union (`param`). */
  param: ParamId
  /** New value (foundation validates finite). @provenance PSYBUS.md §payload union (`value`). */
  value: number
}

/** `{ kind: 'latency'; device; reportLatencyMs }` — device → host telemetry. @provenance PSYBUS.md §payload union (telemetry/health group). */
export interface LatencyPayload {
  /** Discriminator literal. @provenance PSYBUS.md §payload union. */
  kind: 'latency'
  /** Reporting device. @provenance PSYBUS.md §payload union (`device`). */
  device: DeviceId
  /** Measured latency in milliseconds. @provenance PSYBUS.md §payload union (`reportLatencyMs`). */
  reportLatencyMs: number
}

/** `{ kind: 'voice.count'; device; active; stolen }` — device → host telemetry ("no more '16 voices' claims that are actually 6"). @provenance PSYBUS.md §payload union + §"What PSYBUS unlocks". */
export interface VoiceCountPayload {
  /** Discriminator literal. @provenance PSYBUS.md §payload union. */
  kind: 'voice.count'
  /** Reporting device. @provenance PSYBUS.md §payload union (`device`). */
  device: DeviceId
  /** Currently active voices. @provenance PSYBUS.md §payload union (`active`). */
  active: number
  /** Voices stolen (oldest-steal policy, ARCHITECTURE.md §"Voice management"). @provenance PSYBUS.md §payload union (`stolen`). */
  stolen: number
}

/** `{ kind: 'error'; device; code; message }` — the spec's error frame (device → host). @provenance PSYBUS.md §payload union (telemetry/health group). */
export interface ErrorPayload {
  /** Discriminator literal. @provenance PSYBUS.md §payload union. */
  kind: 'error'
  /** Device reporting the error. @provenance PSYBUS.md §payload union (`device`). */
  device: DeviceId
  /** Machine-readable error code. @provenance PSYBUS.md §payload union (`code`). */
  code: string
  /** Human-readable message. @provenance PSYBUS.md §payload union (`message`). */
  message: string
}

/**
 * Every message on the bus is one of these 15 kinds — "Typed end-to-end. Every message is a
 * discriminated union. No `any`. No stringly-typed." (§"Design principles" #3).
 *
 * @provenance psyboss/docs/PSYBUS.md §"The payload discriminated union".
 *
 * HONESTY NOTE: the spec defines NO heartbeat, ack or nack kind. Health is expressed by the
 * `latency` / `voice.count` / `error` telemetry kinds only. Foundation does not invent any.
 */
export type BusPayload =
  | TransportPayload
  | TransportSeekPayload
  | TransportStartPayload
  | TransportStopPayload
  | ContextPayload
  | NotePayload
  | NoteOffPayload
  | TrigPayload
  | SidechainDuckPayload
  | ChokePayload
  | ParamLockPayload
  | ParamSetPayload
  | LatencyPayload
  | VoiceCountPayload
  | ErrorPayload

/** All `kind` discriminators, in spec declaration order. */
export type BusPayloadKind = BusPayload['kind']

/**
 * Unsubscribe function returned by `PsyBus.subscribe` (§"The host interface").
 *
 * @provenance psyboss/docs/PSYBUS.md §"The host interface" (`Unsubscribe`). Referenced-but-undefined
 * in the spec; foundation defines it as the standard `() => void`. Identical in shape to legacy
 * `channel.Unsubscribe`, which is why that legacy alias is NOT deprecated.
 */
export type Unsubscribe = () => void

// ---------------------------------------------------------------------------
// Foundation-side brand casts (ergonomics, not spec).
// The spec assumes branded literals; these casts are the documented way to obtain
// them. They are honest ONLY after validateEnvelope/buildEnvelope have vetted the
// string (non-empty, bounded length, no control characters) — see envelope.ts.
// ---------------------------------------------------------------------------

/** Brand a validated string as {@link DeviceId}. */
export function asDeviceId(s: string): DeviceId {
  return s as DeviceId
}
/** Brand a validated string as {@link TrackId}. */
export function asTrackId(s: string): TrackId {
  return s as TrackId
}
/** Brand a validated string as {@link SceneId}. */
export function asSceneId(s: string): SceneId {
  return s as SceneId
}
/** Brand a validated string as {@link ParamId}. */
export function asParamId(s: string): ParamId {
  return s as ParamId
}
/** Brand a validated string as {@link ChokeGroupId}. */
export function asChokeGroupId(s: string): ChokeGroupId {
  return s as ChokeGroupId
}
