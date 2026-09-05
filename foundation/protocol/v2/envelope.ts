/**
 * PSYBUS v2 — envelope codec: build, validate, encode, decode, addressing.
 *
 * Wire-format decision (documented in docs/PSYBUS_V2_ADOPTION.md §"Wire format"):
 * psyboss's PSYBUS.md defines the envelope/payload JSON+TS *shape* but no binary wire format —
 * §"Transport tiers (same types, different wire)" explicitly keeps the types identical across
 * in-process, postMessage, BroadcastChannel and WebRTC transports. Foundation therefore ships a
 * **canonical JSON** codec: a fully specified, byte-stable serialization (fixed key order per
 * kind, spec declaration order; unknown keys sorted by code unit) so that
 * encode(decode(encode(x))) === encode(x) byte-for-byte and replay logs/hashes are stable.
 *
 * Validation is total and exception-free: every public function returns a {@link Result} with a
 * typed {@link PsybusError}; no bad input can throw. Bounds the spec leaves open are declared
 * here as foundation-side constants with rationale (charter law: unbounded inputs are release
 * blockers).
 *
 * Strictness stance (documented): the envelope FRAME is exactly the 6 spec fields — unknown
 * frame fields are rejected. Payload objects with a known `kind` TOLERATE unknown extra fields
 * (forward compatibility) and the canonical writer preserves them in sorted order.
 *
 * @provenance psyboss/docs/PSYBUS.md §"The message envelope", §"The payload discriminated
 * union", §"The branded types"; addressing semantics from §"The host interface" (route "by dst
 * (unicast) or broadcast", ARCHITECTURE.md §L2).
 */
import { PSYBUS_PROTOCOL_VERSION, asDeviceId } from './types.ts'
import type { BusEnvelope, BusPayload, BusPayloadKind, DeviceId } from './types.ts'

// ---------------------------------------------------------------------------
// Result & typed errors
// ---------------------------------------------------------------------------

/**
 * Discriminated result — the v2 error style. No v2 function throws on bad input.
 *
 * @provenance foundation-side (task 3.6 requirement: "typed error, no exceptions on bad input").
 */
export type Result<T, E = PsybusError> = { ok: true; value: T } | { ok: false; error: E }

/** Closed set of v2 codec error codes. */
export type PsybusErrorCode =
  | 'invalid-envelope'
  | 'missing-field'
  | 'wrong-type'
  | 'out-of-range'
  | 'unknown-payload-kind'
  | 'unsupported-version'
  | 'invalid-json'
  | 'oversized'
  | 'unserializable'

/**
 * Typed codec/routing error. `path` is a dot-path into the envelope
 * (e.g. `payload.trig.sampleRef.provenance.license`).
 */
export interface PsybusError {
  code: PsybusErrorCode
  message: string
  path: string
}

// ---------------------------------------------------------------------------
// Foundation-side bounds (spec silent — declared + documented, never hidden)
// ---------------------------------------------------------------------------

/**
 * Maximum canonical-JSON size of one envelope, in UTF-8 bytes.
 * @provenance foundation-side bound. The spec sets no size limit, but sample bytes are never
 * inlined (SampleRef by design, §"The branded types"), so 64 KiB is generous for control
 * traffic while closing the DoS surface (charter law: unbounded inputs are release blockers).
 */
export const MAX_ENVELOPE_JSON_BYTES = 64 * 1024

/** Maximum length of any identifier string (device/track/scene/param/choke-group/code). @provenance foundation-side bound; spec silent. */
export const MAX_ID_LENGTH = 128

/** Maximum nesting depth accepted by the canonical writer. @provenance foundation-side bound (stack-safety). */
export const MAX_JSON_DEPTH = 64

// ---------------------------------------------------------------------------
// Canonical JSON — fixed key order per spec declaration order
// ---------------------------------------------------------------------------

/** Envelope key order = PSYBUS.md §"The message envelope" declaration order. */
const ENVELOPE_KEYS: readonly string[] = ['rev', 'seed', 'src', 'dst', 'ts', 'payload']

/**
 * Payload key order per kind = PSYBUS.md §"The payload discriminated union" declaration order
 * (`kind` first, as written in each union member).
 */
const PAYLOAD_KEYS: Record<BusPayloadKind, readonly string[]> = {
  transport: ['kind', 'bpm', 'beat', 'bar', 'phase', 'playing'],
  'transport.seek': ['kind', 'beat'],
  'transport.start': ['kind'],
  'transport.stop': ['kind'],
  context: ['kind', 'key', 'scale', 'energy', 'section'],
  note: ['kind', 'track', 'note', 'vel', 'durBeats', 'channel'],
  'note.off': ['kind', 'track', 'note'],
  trig: ['kind', 'track', 'scene', 'sampleRef'],
  'sidechain.duck': ['kind', 'target', 'depth', 'releaseMs'],
  choke: ['kind', 'group', 'except'],
  'param.lock': ['kind', 'track', 'step', 'param', 'value'],
  'param.set': ['kind', 'track', 'param', 'value'],
  latency: ['kind', 'device', 'reportLatencyMs'],
  'voice.count': ['kind', 'device', 'active', 'stolen'],
  error: ['kind', 'device', 'code', 'message'],
}

/** SampleRef key order = §"The branded types" declaration order. */
const SAMPLE_REF_KEYS: readonly string[] = ['id', 'provenance']
/** Provenance key order = §"The branded types" declaration order. */
const PROVENANCE_KEYS: readonly string[] = [
  'license',
  'source',
  'author',
  'verifiedAt',
  'fingerprint',
]

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Deterministic fallback order for unknown keys: code-unit sort (fully specified by ECMAScript). */
function sortedUnknownKeys(obj: Record<string, unknown>, known: ReadonlySet<string>): string[] {
  const keys: string[] = []
  for (const k of Object.keys(obj)) {
    if (!known.has(k)) keys.push(k)
  }
  return keys.sort()
}

function writeString(s: string): string {
  return JSON.stringify(s)
}

function writeNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`non-finite number cannot be canonicalized: ${n}`)
  return JSON.stringify(n === 0 ? 0 : n) // normalize -0 → 0 explicitly
}

/** Generic deterministic writer for values without a spec key order (extras, nested unknowns). */
function writeGeneric(v: unknown, depth: number): string {
  if (depth > MAX_JSON_DEPTH) throw new Error(`canonical JSON depth exceeds ${MAX_JSON_DEPTH}`)
  if (v === null) return 'null'
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false'
    case 'number':
      return writeNumber(v)
    case 'string':
      return writeString(v)
    case 'object': {
      if (Array.isArray(v)) {
        let out = '['
        for (let i = 0; i < v.length; i++) {
          if (i > 0) out += ','
          out += v[i] === undefined ? 'null' : writeGeneric(v[i], depth + 1)
        }
        return `${out}]`
      }
      const obj = v as Record<string, unknown>
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort()
      let out = '{'
      let first = true
      for (const k of keys) {
        if (!first) out += ','
        first = false
        out += `${writeString(k)}:${writeGeneric(obj[k], depth + 1)}`
      }
      return `${out}}`
    }
    default:
      throw new Error(`value of type ${typeof v} is not JSON-serializable`)
  }
}

/** Append canonical `key:value` pairs for the object's unknown keys, in sorted order. */
function writeExtras(
  obj: Record<string, unknown>,
  known: readonly string[],
  anyKnownEmitted: boolean,
  depth: number
): string {
  let out = ''
  for (const k of sortedUnknownKeys(obj, new Set(known))) {
    const v = obj[k]
    if (v === undefined) continue
    if (anyKnownEmitted || out.length > 0) out += ','
    out += `${writeString(k)}:${writeGeneric(v, depth)}`
  }
  return out
}

function writeProvenance(p: Record<string, unknown>): string {
  let out = '{'
  let first = true
  for (const k of PROVENANCE_KEYS) {
    const v = p[k]
    if (v === undefined) continue
    if (!first) out += ','
    first = false
    out += `${writeString(k)}:${writeGeneric(v, 2)}`
  }
  out += writeExtras(p, PROVENANCE_KEYS, !first, 3)
  return `${out}}`
}

function writeSampleRef(ref: Record<string, unknown>): string {
  let out = '{'
  let first = true
  for (const k of SAMPLE_REF_KEYS) {
    const v = ref[k]
    if (v === undefined) continue
    if (!first) out += ','
    first = false
    out += `${writeString(k)}:${k === 'provenance' && isPlainObject(v) ? writeProvenance(v) : writeGeneric(v, 2)}`
  }
  out += writeExtras(ref, SAMPLE_REF_KEYS, !first, 3)
  return `${out}}`
}

/**
 * Canonical JSON for any JSON-safe value: object keys sorted by code unit, `-0` normalized to
 * `0`, arrays order-preserved. Throws ONLY on non-JSON values / depth overflow — public API
 * functions catch and convert to {@link Result} errors, so no bad input ever escapes as an
 * exception.
 */
export function canonicalJson(value: unknown): string {
  return writeGeneric(value, 0)
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type FieldRule =
  | { t: 'int'; min?: number; max?: number; opt?: boolean }
  | { t: 'num'; min?: number; max?: number; opt?: boolean }
  | { t: 'bool'; opt?: boolean }
  | { t: 'id'; opt?: boolean }
  | { t: 'str'; min: number; max: number; opt?: boolean }
  | { t: 'sampleRef'; opt?: boolean }

const LICENSES: ReadonlySet<string> = new Set([
  'CC0',
  'CC-BY',
  'CC-BY-SA',
  'CC-BY-NC',
  'commercial-licensed',
  'psboss-dsp',
])

function err(
  code: PsybusErrorCode,
  path: string,
  message: string
): { ok: false; error: PsybusError } {
  return { ok: false, error: { code, path, message } }
}

function checkId(v: unknown): boolean {
  if (typeof v !== 'string') return false
  if (v.length === 0 || v.length > MAX_ID_LENGTH) return false
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return false
  }
  return true
}

function checkField(rule: FieldRule, v: unknown, path: string): PsybusError | null {
  if (v === undefined) {
    return { code: 'missing-field', path, message: 'required field is absent' }
  }
  switch (rule.t) {
    case 'int': {
      if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
        return { code: 'wrong-type', path, message: `expected safe integer, got ${typeof v}` }
      }
      if (rule.min !== undefined && v < rule.min) {
        return { code: 'out-of-range', path, message: `${v} < minimum ${rule.min}` }
      }
      if (rule.max !== undefined && v > rule.max) {
        return { code: 'out-of-range', path, message: `${v} > maximum ${rule.max}` }
      }
      return null
    }
    case 'num': {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return { code: 'wrong-type', path, message: `expected finite number, got ${typeof v}` }
      }
      if (rule.min !== undefined && v < rule.min) {
        return { code: 'out-of-range', path, message: `${v} < minimum ${rule.min}` }
      }
      if (rule.max !== undefined && v > rule.max) {
        return { code: 'out-of-range', path, message: `${v} > maximum ${rule.max}` }
      }
      return null
    }
    case 'bool':
      if (typeof v !== 'boolean') return { code: 'wrong-type', path, message: 'expected boolean' }
      return null
    case 'id':
      if (!checkId(v)) {
        return {
          code: 'wrong-type',
          path,
          message: `expected non-empty identifier ≤ ${MAX_ID_LENGTH} chars without control characters`,
        }
      }
      return null
    case 'str': {
      if (typeof v !== 'string') return { code: 'wrong-type', path, message: 'expected string' }
      if (v.length < rule.min || v.length > rule.max) {
        return {
          code: 'out-of-range',
          path,
          message: `string length ${v.length} outside [${rule.min}, ${rule.max}]`,
        }
      }
      return null
    }
    case 'sampleRef':
      return checkSampleRef(v, path)
  }
}

function checkSampleRef(v: unknown, path: string): PsybusError | null {
  if (!isPlainObject(v)) return { code: 'wrong-type', path, message: 'expected SampleRef object' }
  const idE = checkField({ t: 'id' }, v.id, `${path}.id`)
  if (idE) return idE
  const prov = v.provenance
  if (!isPlainObject(prov)) {
    return {
      code: 'missing-field',
      path: `${path}.provenance`,
      message: 'provenance is REQUIRED (spec: host refuses to route without it)',
    }
  }
  if (typeof prov.license !== 'string' || !LICENSES.has(prov.license)) {
    return {
      code: 'wrong-type',
      path: `${path}.provenance.license`,
      message:
        'license not in spec enum (CC0|CC-BY|CC-BY-SA|CC-BY-NC|commercial-licensed|psboss-dsp)',
    }
  }
  const srcE = checkField({ t: 'str', min: 1, max: 512 }, prov.source, `${path}.provenance.source`)
  if (srcE) return srcE
  if (prov.author !== undefined) {
    const aE = checkField({ t: 'str', min: 1, max: 512 }, prov.author, `${path}.provenance.author`)
    if (aE) return aE
  }
  const vE = checkField({ t: 'num', min: 0 }, prov.verifiedAt, `${path}.provenance.verifiedAt`)
  if (vE) return vE
  const fE = checkField(
    { t: 'str', min: 1, max: 256 },
    prov.fingerprint,
    `${path}.provenance.fingerprint`
  )
  if (fE) return fE
  return null
}

/**
 * Per-kind required-field rules. Field names are verbatim spec; bounds the spec leaves open are
 * foundation-side and documented in docs/PSYBUS_V2_ADOPTION.md §"Bounds the spec leaves open".
 */
const KIND_RULES: Record<BusPayloadKind, Record<string, FieldRule>> = {
  transport: {
    bpm: { t: 'num', min: 1, max: 1000 },
    beat: { t: 'int', min: 0 },
    bar: { t: 'int', min: 0 },
    phase: { t: 'num', min: 0 },
    playing: { t: 'bool' },
  },
  'transport.seek': { beat: { t: 'int', min: 0 } },
  'transport.start': {},
  'transport.stop': {},
  context: {
    key: { t: 'str', min: 1, max: 128 },
    scale: { t: 'str', min: 1, max: 128 },
    energy: { t: 'num', min: 0, max: 1 },
    section: { t: 'str', min: 1, max: 128 },
  },
  note: {
    track: { t: 'id' },
    note: { t: 'int', min: 0, max: 127 },
    vel: { t: 'num', min: 0, max: 1 },
    durBeats: { t: 'num', min: 0 },
    channel: { t: 'int', min: 0 },
  },
  'note.off': { track: { t: 'id' }, note: { t: 'int', min: 0, max: 127 } },
  trig: { track: { t: 'id' }, scene: { t: 'id' }, sampleRef: { t: 'sampleRef', opt: true } },
  'sidechain.duck': {
    target: { t: 'id' },
    depth: { t: 'num', min: 0, max: 1 },
    releaseMs: { t: 'num', min: 0 },
  },
  choke: { group: { t: 'id' }, except: { t: 'id', opt: true } },
  'param.lock': {
    track: { t: 'id' },
    step: { t: 'int', min: 0 },
    param: { t: 'id' },
    value: { t: 'num' },
  },
  'param.set': { track: { t: 'id' }, param: { t: 'id' }, value: { t: 'num' } },
  latency: { device: { t: 'id' }, reportLatencyMs: { t: 'num', min: 0 } },
  'voice.count': {
    device: { t: 'id' },
    active: { t: 'int', min: 0 },
    stolen: { t: 'int', min: 0 },
  },
  error: { device: { t: 'id' }, code: { t: 'id' }, message: { t: 'str', min: 0, max: 2048 } },
}

const ENVELOPE_KEY_SET: ReadonlySet<string> = new Set(ENVELOPE_KEYS)

/**
 * Validate an unknown value as a v2 envelope. Pure check — no exceptions, no mutation; returns
 * the envelope with branded identity fields on success.
 *
 * @provenance field list per PSYBUS.md §"The message envelope" + §"The payload discriminated
 * union". Unknown extra payload fields are TOLERATED (forward compatibility) and preserved by
 * the canonical writer; unknown `kind`s are REJECTED ('unknown-payload-kind') — the union is
 * the protocol; unknown envelope-frame fields are REJECTED — the frame is the protocol.
 */
export function validateEnvelope(x: unknown): Result<BusEnvelope> {
  if (!isPlainObject(x)) return err('invalid-envelope', '', 'expected envelope object')
  for (const k of Object.keys(x)) {
    if (!ENVELOPE_KEY_SET.has(k)) {
      return err(
        'invalid-envelope',
        k,
        `unknown envelope field '${k}' — the frame is exactly the 6 fields of PSYBUS.md §\"The message envelope\"`
      )
    }
  }
  const revE = checkField({ t: 'int', min: 0 }, x.rev, 'rev')
  if (revE) return { ok: false, error: revE }
  const seedE = checkField({ t: 'int' }, x.seed, 'seed')
  if (seedE) return { ok: false, error: seedE }
  const srcE = checkField({ t: 'id' }, x.src, 'src')
  if (srcE) return { ok: false, error: srcE }
  if (x.dst !== 'broadcast') {
    const dstE = checkField({ t: 'id' }, x.dst, 'dst')
    if (dstE) {
      if (dstE.code === 'missing-field') return { ok: false, error: dstE }
      return err(
        'wrong-type',
        'dst',
        'expected a DeviceId or the literal \'broadcast\' (PSYBUS.md §"The message envelope")'
      )
    }
  }
  const tsE = checkField({ t: 'num', min: 0 }, x.ts, 'ts')
  if (tsE) return { ok: false, error: tsE }

  if (x.payload === undefined) {
    return err('missing-field', 'payload', 'required field is absent')
  }
  const p = x.payload
  if (!isPlainObject(p)) {
    return err('wrong-type', 'payload', 'expected payload object')
  }
  if (typeof p.kind !== 'string') {
    return err('missing-field', 'payload.kind', 'payload must carry a string `kind` discriminator')
  }
  const rules = KIND_RULES[p.kind as BusPayloadKind]
  if (!rules) {
    return err(
      'unknown-payload-kind',
      'payload.kind',
      `unknown kind '${p.kind}' — not part of PSYBUS.md §\"The payload discriminated union\"`
    )
  }
  for (const [field, rule] of Object.entries(rules)) {
    const value = p[field]
    if (value === undefined) {
      if (!rule.opt) {
        return err(
          'missing-field',
          `payload.${field}`,
          `kind '${p.kind}' requires field '${field}'`
        )
      }
      continue
    }
    const fieldE = checkField(rule, value, `payload.${field}`)
    if (fieldE) return { ok: false, error: fieldE }
  }

  return {
    ok: true,
    value: {
      rev: x.rev as number,
      seed: x.seed as number,
      src: asDeviceId(x.src as string),
      dst: x.dst === 'broadcast' ? 'broadcast' : asDeviceId(x.dst as string),
      ts: x.ts as number,
      payload: p as unknown as BusPayload,
    },
  }
}

// ---------------------------------------------------------------------------
// Build (wrap) / unwrap / addressing helpers
// ---------------------------------------------------------------------------

/** Raw, pre-validation envelope input for {@link buildEnvelope} (plain strings, any payload). */
export interface EnvelopeInput {
  /** Monotonic transport revision. Required: the host stamps `rev` (ARCHITECTURE.md §L2) — the builder refuses to invent one. */
  rev: number
  /** Deterministic performance seed. */
  seed: number
  /** Publisher device id (validated + branded on success). */
  src: string
  /** Target device id or `'broadcast'`. */
  dst: string
  /** Audio-context time (seconds) the event is valid at. */
  ts: number
  /** Payload per {@link BusPayload} (validated per kind on success). */
  payload: unknown
}

/**
 * Build (wrap) an envelope from raw parts — the spec's "wrapping" direction. Validates and
 * brands; returns a typed error instead of throwing.
 *
 * @provenance PSYBUS.md §"The message envelope"; host-stamped `rev` per ARCHITECTURE.md §L2
 * ("Stamps every envelope with `rev` (monotonic) and `seed`").
 */
export function buildEnvelope(input: EnvelopeInput): Result<BusEnvelope> {
  return validateEnvelope({
    rev: input.rev,
    seed: input.seed,
    src: input.src,
    dst: input.dst,
    ts: input.ts,
    payload: input.payload,
  })
}

/** Unwrap the typed payload from an envelope ("unwrapping" direction). */
export function payloadOf(envelope: BusEnvelope): BusPayload {
  return envelope.payload
}

/** True when the envelope targets every device (`dst: 'broadcast'`). @provenance PSYBUS.md §"The message envelope" (`dst: DeviceId | 'broadcast'`). */
export function isBroadcast(envelope: BusEnvelope): boolean {
  return envelope.dst === 'broadcast'
}

/** True when the envelope should be delivered to `device` (unicast match or broadcast). @provenance PSYBUS.md §"The host interface" (route "by dst") + ARCHITECTURE.md §L2. */
export function addressedTo(envelope: BusEnvelope, device: DeviceId | string): boolean {
  return envelope.dst === 'broadcast' || envelope.dst === device
}

// ---------------------------------------------------------------------------
// Encode / decode
// ---------------------------------------------------------------------------

function writeEnvelopeCanonical(env: BusEnvelope): string {
  let out = '{'
  out += `"rev":${writeNumber(env.rev)}`
  out += `,"seed":${writeNumber(env.seed)}`
  out += `,"src":${writeString(env.src)}`
  out += `,"dst":${writeString(env.dst)}`
  out += `,"ts":${writeNumber(env.ts)}`
  out += `,"payload":${writePayloadCanonical(env.payload)}`
  return `${out}}`
}

function writePayloadCanonical(p: BusPayload): string {
  const obj = p as unknown as Record<string, unknown>
  const keys = PAYLOAD_KEYS[p.kind]
  if (!keys) throw new Error(`unknown payload kind: ${String((obj as { kind?: unknown }).kind)}`)
  let out = '{'
  let first = true
  for (const k of keys) {
    const v = obj[k]
    if (v === undefined) continue
    if (!first) out += ','
    first = false
    if (k === 'sampleRef' && isPlainObject(v)) {
      out += `${writeString(k)}:${writeSampleRef(v)}`
    } else {
      out += `${writeString(k)}:${writeGeneric(v, 2)}`
    }
  }
  out += writeExtras(obj, keys, !first, 3)
  return `${out}}`
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

/**
 * Encode an envelope to canonical JSON (byte-stable; see module doc). Re-validates the input
 * first, so an unvalidated/hand-built envelope can never reach the wire with an untyped shape.
 */
export function encodeEnvelope(envelope: BusEnvelope): Result<string> {
  const v = validateEnvelope(envelope)
  if (!v.ok) return v
  let json: string
  try {
    json = writeEnvelopeCanonical(v.value)
  } catch (e) {
    return err(
      'unserializable',
      '',
      e instanceof Error ? e.message : 'canonical serialization failed'
    )
  }
  if (byteLength(json) > MAX_ENVELOPE_JSON_BYTES) {
    return err('oversized', '', `canonical envelope exceeds ${MAX_ENVELOPE_JSON_BYTES} bytes`)
  }
  return { ok: true, value: json }
}

/** Options for {@link decodeEnvelope}. */
export interface DecodeOptions {
  /**
   * Protocol version the caller expects. Must be {@link PSYBUS_PROTOCOL_VERSION} (2) — this
   * codec implements v2 only. The envelope itself carries NO version field (spec field list is
   * fixed); versioning is a codec-level negotiation concern.
   */
  protocolVersion?: number
}

/**
 * Decode canonical (or any equivalent JSON) text into a validated v2 envelope. Exception-free:
 * malformed JSON, oversized input, unknown versions and invalid shapes all come back as typed
 * errors.
 */
export function decodeEnvelope(input: string, options?: DecodeOptions): Result<BusEnvelope> {
  if (
    options?.protocolVersion !== undefined &&
    options.protocolVersion !== PSYBUS_PROTOCOL_VERSION
  ) {
    return err(
      'unsupported-version',
      '',
      `decoder implements PSYBUS protocol v${PSYBUS_PROTOCOL_VERSION}, caller offered v${options.protocolVersion}`
    )
  }
  if (typeof input !== 'string') {
    return err('wrong-type', '', 'expected string input')
  }
  if (byteLength(input) > MAX_ENVELOPE_JSON_BYTES) {
    return err('oversized', '', `input exceeds ${MAX_ENVELOPE_JSON_BYTES} bytes`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(input) as unknown
  } catch (e) {
    return err('invalid-json', '', e instanceof Error ? e.message : 'JSON.parse failed')
  }
  return validateEnvelope(parsed)
}
