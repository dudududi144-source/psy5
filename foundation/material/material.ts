/**
 * `createMaterial` builder and the `MaterialLibrary` Map-backed store.
 *
 * A `Material` is the runtime container defined by `@psy-foundation/protocol`:
 * it pairs an opaque `payload` with the metadata the scheduler/learner need to
 * pick it (role, style, tempo range, key compatibility, energy, novelty,
 * source, confidence, usage stats). This module adds the typed payload layer
 * (via `MaterialPayload`) and a queryable in-memory library.
 */

import type { Material, MaterialType } from '@psy-foundation/protocol'
import type { MaterialPayload } from './types.ts'

export interface MaterialMetadata {
  role: string
  style: string
  tempoRange: [number, number]
  keyCompatibility: number[]
  energy: number
  novelty: number
  source: string
  confidence: number
}

export interface CreateMaterialOptions extends MaterialMetadata {
  id?: string
  payload: MaterialPayload
}

const idCounters: Record<string, number> = {}

function pad4(n: number): string {
  return n.toString().padStart(4, '0')
}

function autoId(kind: string): string {
  const next = (idCounters[kind] ?? 0) + 1
  idCounters[kind] = next
  return `${kind}-${pad4(next)}`
}

/** Build a `Material` with full metadata, zeroed usage stats, and auto-id. */
export function createMaterial(opts: CreateMaterialOptions): Material {
  const kind = opts.payload.kind
  const id = opts.id ?? autoId(kind)
  return {
    id,
    type: kind as MaterialType,
    role: opts.role,
    style: opts.style,
    tempoRange: opts.tempoRange,
    keyCompatibility: opts.keyCompatibility,
    energy: opts.energy,
    novelty: opts.novelty,
    source: opts.source,
    confidence: opts.confidence,
    usageCount: 0,
    reward: 0,
    lastUsed: null,
    payload: opts.payload,
  }
}

export interface MaterialQuery {
  type?: MaterialType
  role?: string
  style?: string
  bpm?: number
  rootPc?: number
  minEnergy?: number
  maxEnergy?: number
  limit?: number
}

/**
 * Map-based material store with duplicate-id guards and filtered queries.
 * Serialisable via `toJSON()` / `fromJSON()` for snapshot transport.
 */
export class MaterialLibrary {
  private readonly materials = new Map<string, Material>()

  add(material: Material): void {
    if (this.materials.has(material.id)) {
      throw new Error(`Material with id "${material.id}" already exists`)
    }
    this.materials.set(material.id, material)
  }

  get(id: string): Material | undefined {
    return this.materials.get(id)
  }

  remove(id: string): boolean {
    return this.materials.delete(id)
  }

  get size(): number {
    return this.materials.size
  }

  list(): Material[] {
    return Array.from(this.materials.values())
  }

  query(opts: MaterialQuery): Material[] {
    // Capture optional filter values into local consts so filter callbacks
    // do not need to repeatedly narrow `opts.x` (also keeps the noUnchecked
    // check happy if it is ever re-enabled).
    const type = opts.type
    const role = opts.role
    const style = opts.style
    const bpm = opts.bpm
    const rootPc = opts.rootPc
    const minEnergy = opts.minEnergy
    const maxEnergy = opts.maxEnergy
    const limit = opts.limit

    let out = this.list().filter((m) => {
      if (type !== undefined && m.type !== type) return false
      if (role !== undefined && m.role !== role) return false
      if (style !== undefined && m.style !== style) return false
      if (bpm !== undefined) {
        const lo = m.tempoRange[0]
        const hi = m.tempoRange[1]
        if (bpm < lo || bpm > hi) return false
      }
      if (rootPc !== undefined && !m.keyCompatibility.includes(rootPc)) return false
      if (minEnergy !== undefined && m.energy < minEnergy) return false
      if (maxEnergy !== undefined && m.energy > maxEnergy) return false
      return true
    })

    if (limit !== undefined && limit >= 0) {
      out = out.slice(0, limit)
    }
    return out
  }

  markUsed(id: string, at: number): void {
    const m = this.materials.get(id)
    if (!m) throw new Error(`Material with id "${id}" not found`)
    m.usageCount += 1
    m.lastUsed = at
  }

  addReward(id: string, reward: number): void {
    const m = this.materials.get(id)
    if (!m) throw new Error(`Material with id "${id}" not found`)
    m.reward += reward
  }

  toJSON(): Material[] {
    return this.list()
  }

  static fromJSON(data: Material[]): MaterialLibrary {
    const lib = new MaterialLibrary()
    for (const m of data) {
      // Re-insert by reference; bypass duplicate-guard for snapshot restores
      // that may contain the same id when called on a fresh library.
      lib.materials.set(m.id, { ...m })
    }
    return lib
  }
}
