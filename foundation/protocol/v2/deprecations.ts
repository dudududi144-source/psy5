/**
 * PSYBUS v2 — machine-readable deprecation map for the legacy foundation envelope styles.
 *
 * This is DATA + TSDoc only. It performs NO runtime change to the legacy modules
 * (`../channel.ts`, `../events.ts`, `../state.ts`) — those stay untouched; the integrator and
 * repo owners schedule their retirement (task 3.6: "deprecate the other 3" envelope styles in
 * favor of the single canonical PSYBUS v2 bus).
 *
 * HONESTY MECHANISM (behavior-enforced, see tests/v2-envelope.test.ts "DeprecationMap honesty"):
 * - `LegacyTypeWitness` binds every dotted name this map may reference to the REAL legacy type
 *   via a type-only import. If a legacy type is renamed or removed, `tsc --noEmit` fails HERE —
 *   the map cannot drift from the code it documents.
 * - `LEGACY_TYPE_BINDINGS` mirrors the witness at runtime (tsc forces exact key equality), so
 *   `bun test` verifies every {@link DeprecationEntry} points at a witnessed name — a map entry
 *   with a typo'd or unwitnessed name fails the test suite immediately.
 * - The same is done on the v2 side (`V2TypeWitness` / `V2_TYPE_BINDINGS`) so `replacedBy`
 *   names real v2 exports, not prose.
 *
 * @provenance legacy inventory read from packages/protocol/src/{channel,events,state}.ts;
 * replacement semantics from psyboss/docs/PSYBUS.md (§ tags per entry).
 */

import type { Channel, ChannelListener, InMemoryChannel } from '../channel.ts'
import type {
  BeatEvent,
  DropEvent,
  EnergyEvent,
  EventTime,
  MusicalEvent,
  NoteEvent,
  PatternEvent,
  SectionEvent,
} from '../events.ts'
import type { DeviceState, MusicalContext, SessionState, TransportState } from '../state.ts'
import type {
  addressedTo,
  buildEnvelope,
  canonicalJson,
  decodeEnvelope,
  encodeEnvelope,
  isBroadcast,
  payloadOf,
  validateEnvelope,
} from './envelope.ts'
import type {
  BusEnvelope,
  BusPayload,
  ContextPayload,
  ErrorPayload,
  LatencyPayload,
  NoteOffPayload,
  NotePayload,
  ParamSetPayload,
  SampleRef,
  TrackId,
  TransportPayload,
  TrigPayload,
  VoiceCountPayload,
} from './types.ts'
import type { PSYBUS_PROTOCOL_VERSION } from './types.ts'

/**
 * Compile-time witness: every legacy name the map is allowed to reference, typed by the real
 * legacy export. Dotted keys are `<module>.<ExportName>`.
 */
export interface LegacyTypeWitness {
  'channel.Channel': Channel
  'channel.ChannelListener': ChannelListener
  'channel.InMemoryChannel': InMemoryChannel
  'events.MusicalEvent': MusicalEvent
  'events.BeatEvent': BeatEvent
  'events.SectionEvent': SectionEvent
  'events.EnergyEvent': EnergyEvent
  'events.DropEvent': DropEvent
  'events.NoteEvent': NoteEvent
  'events.PatternEvent': PatternEvent
  'events.EventTime': EventTime
  'state.TransportState': TransportState
  'state.MusicalContext': MusicalContext
  'state.DeviceState': DeviceState
  'state.SessionState': SessionState
}

/** Runtime mirror of {@link LegacyTypeWitness} — tsc forces exact key equality with the witness. */
export const LEGACY_TYPE_BINDINGS: { [K in keyof LegacyTypeWitness]: true } = {
  'channel.Channel': true,
  'channel.ChannelListener': true,
  'channel.InMemoryChannel': true,
  'events.MusicalEvent': true,
  'events.BeatEvent': true,
  'events.SectionEvent': true,
  'events.EnergyEvent': true,
  'events.DropEvent': true,
  'events.NoteEvent': true,
  'events.PatternEvent': true,
  'events.EventTime': true,
  'state.TransportState': true,
  'state.MusicalContext': true,
  'state.DeviceState': true,
  'state.SessionState': true,
}

/** Compile-time witness for the v2 side: names `replacedBy` may reference, bound to real v2 exports. */
export interface V2TypeWitness {
  BusEnvelope: BusEnvelope
  BusPayload: BusPayload
  TransportPayload: TransportPayload
  ContextPayload: ContextPayload
  NotePayload: NotePayload
  NoteOffPayload: NoteOffPayload
  TrigPayload: TrigPayload
  ParamSetPayload: ParamSetPayload
  LatencyPayload: LatencyPayload
  VoiceCountPayload: VoiceCountPayload
  ErrorPayload: ErrorPayload
  SampleRef: SampleRef
  TrackId: TrackId
  buildEnvelope: typeof buildEnvelope
  payloadOf: typeof payloadOf
  validateEnvelope: typeof validateEnvelope
  encodeEnvelope: typeof encodeEnvelope
  decodeEnvelope: typeof decodeEnvelope
  canonicalJson: typeof canonicalJson
  isBroadcast: typeof isBroadcast
  addressedTo: typeof addressedTo
  PSYBUS_PROTOCOL_VERSION: typeof PSYBUS_PROTOCOL_VERSION
}

/** Runtime mirror of {@link V2TypeWitness} — tsc forces exact key equality with the witness. */
export const V2_TYPE_BINDINGS: { [K in keyof V2TypeWitness]: true } = {
  BusEnvelope: true,
  BusPayload: true,
  TransportPayload: true,
  ContextPayload: true,
  NotePayload: true,
  NoteOffPayload: true,
  TrigPayload: true,
  ParamSetPayload: true,
  LatencyPayload: true,
  VoiceCountPayload: true,
  ErrorPayload: true,
  SampleRef: true,
  TrackId: true,
  buildEnvelope: true,
  payloadOf: true,
  validateEnvelope: true,
  encodeEnvelope: true,
  decodeEnvelope: true,
  canonicalJson: true,
  isBroadcast: true,
  addressedTo: true,
  PSYBUS_PROTOCOL_VERSION: true,
}

/** A witnessed legacy name (`<module>.<ExportName>`). */
export type LegacyName = keyof LegacyTypeWitness
/** A witnessed v2 export name. */
export type V2Name = keyof V2TypeWitness
/** Legacy module that owns a name. */
export type LegacyModuleName = 'channel' | 'events' | 'state'

/** One legacy envelope style, superseded by PSYBUS v2. */
export interface DeprecationEntry {
  /** Dotted legacy reference. MUST be a key of {@link LegacyTypeWitness} (tsc + tests enforce). */
  legacy: LegacyName
  /** v2 concept(s) that supersede it. Each MUST be a key of {@link V2TypeWitness}. */
  replacedBy: readonly V2Name[]
  /** Machine-readable status (only one today; explicit so consumers can switch on it). */
  status: 'deprecated-in-v2'
  /** Non-empty migration note. Field-level gaps vs the spec are stated honestly here. */
  migration: string
}

/** Module portion of a dotted {@link LegacyName}. */
export function legacyModuleOf(name: LegacyName): LegacyModuleName {
  const dot = name.indexOf('.')
  const prefix = dot === -1 ? name : name.slice(0, dot)
  if (prefix !== 'channel' && prefix !== 'events' && prefix !== 'state') {
    throw new Error(`legacy name '${name}' must be prefixed channel./events./state.`)
  }
  return prefix
}

/**
 * The deprecation map: every legacy envelope style in packages/protocol that PSYBUS v2
 * supersedes, with its migration note.
 *
 * @provenance per-entry PSYBUS.md sections are tagged inline; legacy shapes read from
 * packages/protocol/src/{channel,events,state}.ts at main@63ea4d9.
 */
export const DEPRECATIONS: readonly DeprecationEntry[] = [
  {
    legacy: 'channel.Channel',
    replacedBy: ['BusEnvelope', 'BusPayload', 'buildEnvelope'],
    status: 'deprecated-in-v2',
    migration:
      'The v1 Channel publishes BARE MusicalEvent values to every listener (broadcast-only, no frame). ' +
      'v2 moves every message into a BusEnvelope (src/dst unicast or broadcast, rev/seed/ts). ' +
      "A v1 fan-out corresponds to dst:'broadcast'. rev/seed/ts have no v1 place — the host stamps them " +
      '(ARCHITECTURE.md §L2). Use buildEnvelope() to wrap.',
  },
  {
    legacy: 'channel.ChannelListener',
    replacedBy: ['BusEnvelope', 'payloadOf'],
    status: 'deprecated-in-v2',
    migration:
      'v1 listeners receive a bare MusicalEvent. v2 listeners receive a BusEnvelope: unwrap with ' +
      'payloadOf() and switch on payload.kind (the v2 discriminator) instead of .type.',
  },
  {
    legacy: 'channel.InMemoryChannel',
    replacedBy: ['BusEnvelope', 'isBroadcast', 'addressedTo'],
    status: 'deprecated-in-v2',
    migration:
      'Tier-0 in-process transport remains valid (PSYBUS.md §"Transport tiers": same types, different wire) ' +
      'but must carry BusEnvelope frames through the v2 codec instead of bare events. Routing uses ' +
      'addressedTo()/isBroadcast(). The PsyBus host runtime (subscribe/publish/register/route/assertProvenance) ' +
      'is integrator scope — see docs/PSYBUS_V2_ADOPTION.md §"Deferred from the spec".',
  },
  {
    legacy: 'events.MusicalEvent',
    replacedBy: ['BusPayload'],
    status: 'deprecated-in-v2',
    migration:
      "The `type`-discriminated union is superseded by the spec's `kind`-discriminated BusPayload union, " +
      'always carried inside a BusEnvelope. Kind mapping: beat→transport, section→context, energy→context, ' +
      'drop→context or param.set, note→note (+ explicit note.off), pattern→trig. Field-level notes per entry.',
  },
  {
    legacy: 'events.BeatEvent',
    replacedBy: ['TransportPayload', 'BusEnvelope'],
    status: 'deprecated-in-v2',
    migration:
      'BeatEvent {beat, bar, transport: MusicalTransport, at} → BusEnvelope{ts: at} carrying a transport ' +
      'payload {bpm, beat, bar, phase, playing} (PSYBUS.md §payload union, transport group). The rich ' +
      'MusicalTransport snapshot has no spec fields — see state.TransportState entry.',
  },
  {
    legacy: 'events.SectionEvent',
    replacedBy: ['ContextPayload', 'BusEnvelope'],
    status: 'deprecated-in-v2',
    migration:
      'SectionEvent {section, bar, at} → context payload {section, key, scale, energy} in BusEnvelope{ts: at}. ' +
      'HONEST GAP: the spec context payload has NO bar field — bar belongs on transport envelopes; ' +
      'correlate via envelope rev/ts.',
  },
  {
    legacy: 'events.EnergyEvent',
    replacedBy: ['ContextPayload', 'BusEnvelope'],
    status: 'deprecated-in-v2',
    migration:
      'EnergyEvent {energy, at} → context payload {energy, ...} (0..1 on both sides) in BusEnvelope{ts: at}.',
  },
  {
    legacy: 'events.DropEvent',
    replacedBy: ['ContextPayload', 'ParamSetPayload'],
    status: 'deprecated-in-v2',
    migration:
      'No 1:1 spec kind exists for "drop" (honest gap in PSYBUS.md §payload union). Emit a context payload ' +
      'with the new energy level, or a param.set on a per-track intensity parameter. Do NOT invent a drop ' +
      'kind — the union is the protocol.',
  },
  {
    legacy: 'events.NoteEvent',
    replacedBy: ['NotePayload', 'NoteOffPayload', 'TrackId'],
    status: 'deprecated-in-v2',
    migration:
      'NoteEvent {note, velocity, duration, channel: string, at} → note payload {note, vel, durBeats, ' +
      'channel: number, track} (spec field names kept verbatim). Unit change: duration (seconds) → durBeats ' +
      '(beats). channel: string splits into track: TrackId + numeric channel. Note release is now explicit ' +
      '(note.off) — v1 had no note-off at all.',
  },
  {
    legacy: 'events.PatternEvent',
    replacedBy: ['TrigPayload', 'SampleRef'],
    status: 'deprecated-in-v2',
    migration:
      'PatternEvent {patternId, trackId, at} → trig payload {track, scene: patternId} in BusEnvelope{ts: at}. ' +
      'If the scene references a sample, sampleRef.provenance is REQUIRED (spec §"The branded types": the ' +
      'host refuses to route without it).',
  },
  {
    legacy: 'events.EventTime',
    replacedBy: ['BusEnvelope'],
    status: 'deprecated-in-v2',
    migration:
      'The bare `at: number` had no unit contract. v2 gives ts a spec semantic: audio-context time in ' +
      'seconds (PSYBUS.md §"The message envelope").',
  },
  {
    legacy: 'state.TransportState',
    replacedBy: ['TransportPayload', 'BusEnvelope'],
    status: 'deprecated-in-v2',
    migration:
      'Snapshot {bpm, beat, bar, phase, locked, confidence, revision} → transport payload + envelope. ' +
      'revision → envelope rev (host-stamped, monotonic). locked/confidence are psy4 radio-follow concerns ' +
      'with NO spec fields — keep them out-of-band (host config) or drop them; do not smuggle them into the ' +
      'payload union.',
  },
  {
    legacy: 'state.MusicalContext',
    replacedBy: ['ContextPayload'],
    status: 'deprecated-in-v2',
    migration:
      'Snapshot {key, rootPc, scale, energy, style, section, beatsPerBar} → context payload {key, scale, ' +
      'energy, section}. rootPc folds into the key string; style/beatsPerBar have no spec fields — host ' +
      'config, not bus traffic.',
  },
  {
    legacy: 'state.DeviceState',
    replacedBy: ['LatencyPayload', 'VoiceCountPayload', 'ErrorPayload'],
    status: 'deprecated-in-v2',
    migration:
      'Polling snapshot {id, online, lastSeen, capabilities} → device→host telemetry events: latency, ' +
      'voice.count, error (PSYBUS.md §payload union, telemetry/health group). online/lastSeen become ' +
      'presence the HOST derives from traffic; capabilities await the spec-defined DeviceCapabilities at ' +
      'PsyBus.register (§"The host interface", deferred — see the adoption doc).',
  },
  {
    legacy: 'state.SessionState',
    replacedBy: ['LatencyPayload', 'VoiceCountPayload'],
    status: 'deprecated-in-v2',
    migration:
      'Polling snapshot {id, startedAt, devices[]} → telemetry kinds + host register/unregister ' +
      '(PSYBUS.md §"The host interface"). Session id/startedAt stay out of the protocol: the spec defines ' +
      'no session envelope.',
  },
]

/**
 * Legacy exports INTENTIONALLY NOT in the map (honesty about scope):
 * - `channel.Unsubscribe` — identical in shape to v2 `Unsubscribe`; nothing to migrate.
 * - `state.DeviceCapabilities` — PSYBUS.md §"The host interface" references DeviceCapabilities
 *   but never defines it; a v2 replacement would be invention. Deferred with the PsyBus runtime.
 * - `state.MaterialType` / `Material` / `MusicalAction` / `MusicalOutcome` / `Experience` —
 *   learning-domain records, NOT envelope styles; out of protocol scope.
 */
export const NOT_DEPRECATED_NOTE =
  'Unsubscribe (identical to v2), DeviceCapabilities (spec references but does not define it — ' +
  'deferred with the PsyBus host runtime), Material/Experience family (learning-domain records, ' +
  'not envelope styles).'
