/**
 * Factory builders for the 8 most common material kinds.
 *
 * Each builder constructs the typed payload (using `@psy-foundation/music`
 * generators where appropriate) and wraps it in a fully-populated `Material`
 * via `createMaterial`. Sensible defaults are supplied for any metadata the
 * caller omits so the common case stays terse.
 */

import {
  type BassNote,
  type BassStyle,
  type MotifNote,
  type RhythmPattern,
  type Scale,
  generateBassPattern,
  generateMotif,
  getScale,
} from '@psy-foundation/music'
import type { Material } from '@psy-foundation/protocol'
import { type CreateMaterialOptions, type MaterialMetadata, createMaterial } from './material.ts'
import type {
  BassPatternPayload,
  DrumPatternPayload,
  FXGesturePayload,
  FillPayload,
  MotifPayload,
  PresetPayload,
  RhythmPayload,
  TexturePayload,
} from './types.ts'

const ALL_PCS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const DEFAULT_TEMPO_RANGE: [number, number] = [120, 160]
const DEFAULT_ENERGY = 0.5
const DEFAULT_NOVELTY = 0.3
const DEFAULT_SOURCE = 'factory'
const DEFAULT_CONFIDENCE = 0.8

interface MetadataDefaults {
  role?: string
  style?: string
  tempoRange?: [number, number]
  keyCompatibility?: number[]
  energy?: number
  novelty?: number
  source?: string
  confidence?: number
  id?: string
}

function buildMetadata(defaults: MetadataDefaults, overrides: MetadataDefaults): MaterialMetadata {
  const merged = { ...defaults, ...overrides }
  return {
    role: merged.role ?? 'unknown',
    style: merged.style ?? 'generic',
    tempoRange: merged.tempoRange ?? DEFAULT_TEMPO_RANGE,
    keyCompatibility: merged.keyCompatibility ?? ALL_PCS,
    energy: merged.energy ?? DEFAULT_ENERGY,
    novelty: merged.novelty ?? DEFAULT_NOVELTY,
    source: merged.source ?? DEFAULT_SOURCE,
    confidence: merged.confidence ?? DEFAULT_CONFIDENCE,
  }
}

// --- Motif -----------------------------------------------------------------

export interface MakeMotifOptions extends MetadataDefaults {
  rootPc: number
  scaleName: string
  seed?: number
  steps?: number
  density?: number
}

export function makeMotifMaterial(opts: MakeMotifOptions): Material {
  const scale = getScale(opts.scaleName)
  if (!scale) {
    throw new Error(`Unknown scale: ${opts.scaleName}`)
  }
  const genOpts: { seed?: number; steps?: number; density?: number } = {}
  if (opts.seed !== undefined) genOpts.seed = opts.seed
  if (opts.steps !== undefined) genOpts.steps = opts.steps
  if (opts.density !== undefined) genOpts.density = opts.density
  const notes: MotifNote[] = generateMotif(opts.rootPc, scale as Scale, genOpts)

  const payload: MotifPayload = {
    kind: 'motif',
    rootPc: opts.rootPc,
    scaleName: opts.scaleName,
    notes,
  }

  const metaDefaults: MetadataDefaults = {
    role: 'lead',
    style: opts.scaleName,
    tempoRange: DEFAULT_TEMPO_RANGE,
    keyCompatibility: [opts.rootPc],
    energy: DEFAULT_ENERGY,
    novelty: DEFAULT_NOVELTY,
    source: DEFAULT_SOURCE,
    confidence: DEFAULT_CONFIDENCE,
  }
  const createOpts: CreateMaterialOptions = {
    ...buildMetadata(metaDefaults, opts),
    id: opts.id,
    payload,
  }
  return createMaterial(createOpts)
}

// --- Bass ------------------------------------------------------------------

export interface MakeBassPatternOptions extends MetadataDefaults {
  rootPc: number
  scaleName: string
  style?: BassStyle
  seed?: number
}

export function makeBassPatternMaterial(opts: MakeBassPatternOptions): Material {
  const scale = getScale(opts.scaleName)
  if (!scale) {
    throw new Error(`Unknown scale: ${opts.scaleName}`)
  }
  const genOpts: { style?: BassStyle; seed?: number } = {}
  if (opts.style !== undefined) genOpts.style = opts.style
  if (opts.seed !== undefined) genOpts.seed = opts.seed
  const notes: BassNote[] = generateBassPattern(opts.rootPc, scale as Scale, genOpts)

  const payload: BassPatternPayload = {
    kind: 'bass-pattern',
    rootPc: opts.rootPc,
    scaleName: opts.scaleName,
    style: opts.style ?? 'kb3',
    notes,
  }

  const metaDefaults: MetadataDefaults = {
    role: 'bass',
    style: opts.style ?? 'kb3',
    tempoRange: DEFAULT_TEMPO_RANGE,
    keyCompatibility: [opts.rootPc],
    energy: 0.6,
    novelty: DEFAULT_NOVELTY,
    source: DEFAULT_SOURCE,
    confidence: DEFAULT_CONFIDENCE,
  }
  const createOpts: CreateMaterialOptions = {
    ...buildMetadata(metaDefaults, opts),
    id: opts.id,
    payload,
  }
  return createMaterial(createOpts)
}

// --- Rhythm ----------------------------------------------------------------

export interface MakeRhythmOptions extends MetadataDefaults {
  pattern: RhythmPattern
}

export function makeRhythmMaterial(opts: MakeRhythmOptions): Material {
  const steps = opts.pattern.hits.length
  const velocities = opts.pattern.velocities ?? opts.pattern.hits.map((h) => (h ? 1.0 : 0.0))
  const micros = opts.pattern.micros ?? new Array<number>(steps).fill(0)

  const payload: RhythmPayload = {
    kind: 'rhythm',
    steps,
    hits: opts.pattern.hits.slice(),
    velocities,
    micros,
  }

  const metaDefaults: MetadataDefaults = {
    role: 'rhythm',
    style: 'generic',
    tempoRange: DEFAULT_TEMPO_RANGE,
    keyCompatibility: ALL_PCS,
    energy: DEFAULT_ENERGY,
    novelty: DEFAULT_NOVELTY,
    source: DEFAULT_SOURCE,
    confidence: DEFAULT_CONFIDENCE,
  }
  const createOpts: CreateMaterialOptions = {
    ...buildMetadata(metaDefaults, opts),
    id: opts.id,
    payload,
  }
  return createMaterial(createOpts)
}

// --- Drum pattern ----------------------------------------------------------

export interface MakeDrumPatternOptions extends MetadataDefaults {
  tracks: Record<string, RhythmPattern>
}

export function makeDrumPatternMaterial(opts: MakeDrumPatternOptions): Material {
  // Deep-copy the tracks so the library owns its own data.
  const tracks: Record<string, RhythmPattern> = {}
  for (const [name, pat] of Object.entries(opts.tracks)) {
    tracks[name] = {
      hits: pat.hits.slice(),
      velocities: pat.velocities?.slice(),
      probabilities: pat.probabilities?.slice(),
      micros: pat.micros?.slice(),
    }
  }

  const payload: DrumPatternPayload = {
    kind: 'drum-pattern',
    tracks,
  }

  const metaDefaults: MetadataDefaults = {
    role: 'drums',
    style: 'generic',
    tempoRange: DEFAULT_TEMPO_RANGE,
    keyCompatibility: ALL_PCS,
    energy: DEFAULT_ENERGY,
    novelty: DEFAULT_NOVELTY,
    source: DEFAULT_SOURCE,
    confidence: DEFAULT_CONFIDENCE,
  }
  const createOpts: CreateMaterialOptions = {
    ...buildMetadata(metaDefaults, opts),
    id: opts.id,
    payload,
  }
  return createMaterial(createOpts)
}

// --- Fill ------------------------------------------------------------------

export interface MakeFillOptions extends MetadataDefaults {
  steps: number
  notesByStep: number[][]
  velocities: number[]
  role?: string
}

export function makeFillMaterial(opts: MakeFillOptions): Material {
  const payload: FillPayload = {
    kind: 'fill',
    steps: opts.steps,
    notesByStep: opts.notesByStep.map((s) => s.slice()),
    velocities: opts.velocities.slice(),
    role: opts.role ?? 'fill',
  }

  const metaDefaults: MetadataDefaults = {
    role: opts.role ?? 'fill',
    style: 'generic',
    tempoRange: DEFAULT_TEMPO_RANGE,
    keyCompatibility: ALL_PCS,
    energy: 0.7,
    novelty: DEFAULT_NOVELTY,
    source: DEFAULT_SOURCE,
    confidence: DEFAULT_CONFIDENCE,
  }
  const createOpts: CreateMaterialOptions = {
    ...buildMetadata(metaDefaults, opts),
    id: opts.id,
    payload,
  }
  return createMaterial(createOpts)
}

// --- Preset ----------------------------------------------------------------

export interface MakePresetOptions extends MetadataDefaults {
  engine: string
  params: Record<string, number>
}

export function makePresetMaterial(opts: MakePresetOptions): Material {
  const payload: PresetPayload = {
    kind: 'preset',
    engine: opts.engine,
    params: { ...opts.params },
  }

  const metaDefaults: MetadataDefaults = {
    role: 'preset',
    style: opts.engine,
    tempoRange: DEFAULT_TEMPO_RANGE,
    keyCompatibility: ALL_PCS,
    energy: DEFAULT_ENERGY,
    novelty: DEFAULT_NOVELTY,
    source: DEFAULT_SOURCE,
    confidence: DEFAULT_CONFIDENCE,
  }
  const createOpts: CreateMaterialOptions = {
    ...buildMetadata(metaDefaults, opts),
    id: opts.id,
    payload,
  }
  return createMaterial(createOpts)
}

// --- FX gesture ------------------------------------------------------------

export interface MakeFXGestureOptions extends MetadataDefaults {
  param: string
  points: Array<{ t: number; v: number }>
  durationSec: number
}

export function makeFXGestureMaterial(opts: MakeFXGestureOptions): Material {
  const payload: FXGesturePayload = {
    kind: 'fx-gesture',
    param: opts.param,
    points: opts.points.map((p) => ({ t: p.t, v: p.v })),
    durationSec: opts.durationSec,
  }

  const metaDefaults: MetadataDefaults = {
    role: 'fx',
    style: 'generic',
    tempoRange: DEFAULT_TEMPO_RANGE,
    keyCompatibility: ALL_PCS,
    energy: DEFAULT_ENERGY,
    novelty: 0.6,
    source: DEFAULT_SOURCE,
    confidence: DEFAULT_CONFIDENCE,
  }
  const createOpts: CreateMaterialOptions = {
    ...buildMetadata(metaDefaults, opts),
    id: opts.id,
    payload,
  }
  return createMaterial(createOpts)
}

// --- Texture ---------------------------------------------------------------

export interface MakeTextureOptions extends MetadataDefaults {
  rootHz: number
  partials: Array<{ ratio: number; amp: number }>
  lfo?: { rateHz: number; depth: number }
}

export function makeTextureMaterial(opts: MakeTextureOptions): Material {
  const payload: TexturePayload = {
    kind: 'texture',
    rootHz: opts.rootHz,
    partials: opts.partials.map((p) => ({ ratio: p.ratio, amp: p.amp })),
    lfo: opts.lfo ? { rateHz: opts.lfo.rateHz, depth: opts.lfo.depth } : undefined,
  }

  const metaDefaults: MetadataDefaults = {
    role: 'texture',
    style: 'drone',
    tempoRange: DEFAULT_TEMPO_RANGE,
    keyCompatibility: ALL_PCS,
    energy: 0.3,
    novelty: DEFAULT_NOVELTY,
    source: DEFAULT_SOURCE,
    confidence: DEFAULT_CONFIDENCE,
  }
  const createOpts: CreateMaterialOptions = {
    ...buildMetadata(metaDefaults, opts),
    id: opts.id,
    payload,
  }
  return createMaterial(createOpts)
}
