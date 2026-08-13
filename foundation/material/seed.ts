/**
 * `createSeedLibrary()` — a starter set of ~18 materials covering every
 * major kind, ready for a fresh session to have something to play with.
 *
 * Ids are explicit (not auto-generated) so the seed corpus is stable across
 * runs and across re-imports from `toJSON()`.
 */

import {
  type RhythmPattern,
  backbeat,
  drivingHats,
  fourOnFloor,
  offbeatHats,
  psyKick,
} from '@psy-foundation/music'
import type { Material } from '@psy-foundation/protocol'
import {
  type MakeBassPatternOptions,
  type MakeDrumPatternOptions,
  type MakeFXGestureOptions,
  type MakeMotifOptions,
  type MakePresetOptions,
  type MakeRhythmOptions,
  type MakeTextureOptions,
  makeBassPatternMaterial,
  makeDrumPatternMaterial,
  makeFXGestureMaterial,
  makeMotifMaterial,
  makePresetMaterial,
  makeRhythmMaterial,
  makeTextureMaterial,
} from './factory.ts'
import { MaterialLibrary } from './material.ts'

const PSY_TEMPO: [number, number] = [140, 150]

export function createSeedLibrary(): MaterialLibrary {
  const lib = new MaterialLibrary()

  // --- 4 motifs: phrygian-dominant roots 4, 4, 9, 11 + harmonic-minor 11
  const motifSpecs: Array<{ id: string } & MakeMotifOptions> = [
    {
      id: 'motif-pd-4-a',
      rootPc: 4,
      scaleName: 'phrygian-dominant',
      seed: 1,
      tempoRange: PSY_TEMPO,
    },
    {
      id: 'motif-pd-4-b',
      rootPc: 4,
      scaleName: 'phrygian-dominant',
      seed: 2,
      tempoRange: PSY_TEMPO,
    },
    { id: 'motif-pd-9', rootPc: 9, scaleName: 'phrygian-dominant', seed: 3, tempoRange: PSY_TEMPO },
    { id: 'motif-hm-11', rootPc: 11, scaleName: 'harmonic-minor', seed: 4, tempoRange: PSY_TEMPO },
  ]
  for (const spec of motifSpecs) {
    lib.add(makeMotifMaterial(spec))
  }

  // --- 3 basses: kb3 root 4, kb3 root 9, offbeat root 9
  const bassSpecs: Array<{ id: string } & MakeBassPatternOptions> = [
    {
      id: 'bass-kb3-4',
      rootPc: 4,
      scaleName: 'phrygian-dominant',
      style: 'kb3',
      seed: 1,
      tempoRange: PSY_TEMPO,
    },
    {
      id: 'bass-kb3-9',
      rootPc: 9,
      scaleName: 'phrygian-dominant',
      style: 'kb3',
      seed: 2,
      tempoRange: PSY_TEMPO,
    },
    {
      id: 'bass-offbeat-9',
      rootPc: 9,
      scaleName: 'phrygian-dominant',
      style: 'offbeat',
      seed: 3,
      tempoRange: PSY_TEMPO,
    },
  ]
  for (const spec of bassSpecs) {
    lib.add(makeBassPatternMaterial(spec))
  }

  // --- 5 rhythms: psyKick, fourOnFloor, offbeatHats, drivingHats, backbeat
  const rhythmSpecs: Array<{ id: string } & MakeRhythmOptions> = [
    { id: 'rhythm-psy-kick', pattern: psyKick(), role: 'kick', energy: 0.8, tempoRange: PSY_TEMPO },
    {
      id: 'rhythm-four-on-floor',
      pattern: fourOnFloor(16),
      role: 'kick',
      energy: 0.8,
      tempoRange: PSY_TEMPO,
    },
    {
      id: 'rhythm-offbeat-hats',
      pattern: offbeatHats(16),
      role: 'hats',
      energy: 0.4,
      tempoRange: PSY_TEMPO,
    },
    {
      id: 'rhythm-driving-hats',
      pattern: drivingHats(16),
      role: 'hats',
      energy: 0.7,
      tempoRange: PSY_TEMPO,
    },
    {
      id: 'rhythm-backbeat',
      pattern: backbeat(16),
      role: 'snare',
      energy: 0.6,
      tempoRange: PSY_TEMPO,
    },
  ]
  for (const spec of rhythmSpecs) {
    lib.add(makeRhythmMaterial(spec))
  }

  // --- 2 drum patterns (multi-track)
  const drumSpecs: Array<{ id: string } & MakeDrumPatternOptions> = [
    {
      id: 'drum-psy-basic',
      tracks: {
        kick: psyKick(),
        hats: offbeatHats(16),
        snare: backbeat(16),
      },
      role: 'drums',
      style: 'psytrance',
      energy: 0.8,
      tempoRange: PSY_TEMPO,
    },
    {
      id: 'drum-psy-driving',
      tracks: {
        kick: fourOnFloor(16),
        hats: drivingHats(16),
        snare: backbeat(16),
      },
      role: 'drums',
      style: 'psytrance',
      energy: 0.9,
      tempoRange: PSY_TEMPO,
    },
  ]
  for (const spec of drumSpecs) {
    lib.add(makeDrumPatternMaterial(spec))
  }

  // --- 2 presets: psy-lead, psy-bass
  const presetSpecs: Array<{ id: string } & MakePresetOptions> = [
    {
      id: 'preset-psy-lead',
      engine: 'psy-lead',
      params: {
        osc: 2,
        cutoff: 0.7,
        resonance: 0.3,
        attack: 0.01,
        decay: 0.2,
        sustain: 0.6,
        release: 0.3,
      },
      role: 'lead',
      style: 'psytrance',
      tempoRange: PSY_TEMPO,
    },
    {
      id: 'preset-psy-bass',
      engine: 'psy-bass',
      params: {
        osc: 1,
        cutoff: 0.4,
        resonance: 0.5,
        attack: 0.005,
        decay: 0.15,
        sustain: 0.4,
        release: 0.1,
      },
      role: 'bass',
      style: 'psytrance',
      tempoRange: PSY_TEMPO,
    },
  ]
  for (const spec of presetSpecs) {
    lib.add(makePresetMaterial(spec))
  }

  // --- 1 fx-gesture: filter sweep
  const fxSpec: { id: string } & MakeFXGestureOptions = {
    id: 'fx-filter-sweep',
    param: 'cutoff',
    points: [
      { t: 0, v: 0.1 },
      { t: 0.5, v: 0.95 },
      { t: 1, v: 0.3 },
    ],
    durationSec: 4,
    role: 'fx',
    tempoRange: PSY_TEMPO,
  }
  lib.add(makeFXGestureMaterial(fxSpec))

  // --- 1 texture: drone at 55 Hz (A1)
  const textureSpec: { id: string } & MakeTextureOptions = {
    id: 'texture-drone-55',
    rootHz: 55,
    partials: [
      { ratio: 1, amp: 1.0 },
      { ratio: 2, amp: 0.5 },
      { ratio: 3, amp: 0.25 },
      { ratio: 1.5, amp: 0.4 },
    ],
    lfo: { rateHz: 0.1, depth: 0.2 },
    role: 'texture',
    tempoRange: PSY_TEMPO,
  }
  lib.add(makeTextureMaterial(textureSpec))

  return lib
}

/**
 * Helper for tests / introspection: build the seed library once and return
 * the materials grouped by type. Re-exports the RhythmPattern type so
 * downstream code can match drum-pattern tracks without an extra import.
 */
export function seedMaterialsByType(): Record<string, Material[]> {
  const lib = createSeedLibrary()
  const byType: Record<string, Material[]> = {}
  for (const m of lib.list()) {
    const bucket = byType[m.type] ?? []
    bucket.push(m)
    byType[m.type] = bucket
  }
  return byType
}

export type { RhythmPattern }
