/**
 * v0.12.0 P2 — SOUND ENGINE v2 library tests.
 * Library breadth + schema + kit resolution (the bun-level twin of gate
 * G40; the spectral voice evidence lives in G39/G40 device gates).
 */
import { describe, test, expect } from 'bun:test'
import { libCount, libFilter, libFind, KITS } from '../js/presets.js'

const ALL = libFilter('all', 'ALL')
const DRUMS = ALL.filter(p => p.cat === 'drum')
const GENRES = ['PSYTRANCE', 'DARK-PSY', 'GOA', 'FULL-ON', 'TECHNO', 'TRANCE', 'PROGRESSIVE', 'HI-TECH']
const DRUM_TYPES = new Set(['kick', 'snare', 'clap', 'hatC', 'hatO', 'tom', 'rim', 'glitch', 'shaker', 'conga', 'bongo', 'cowbell', 'clave', 'zap', 'boom', 'riser', 'impact', 'darbuka', 'tambourine', 'triangle', 'downlifter'])
const clamp = (v: number | undefined, a: number, b: number) => v == null || (v >= a && v <= b)

describe('v2 library breadth (v0.12.0 P2)', () => {
  test('>=150 presets, >=100 drums, unique ids, genre coverage 8/8', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(150)
    expect(DRUMS.length).toBeGreaterThanOrEqual(100)
    expect(libCount()).toBe(ALL.length)
    const ids = new Set(ALL.map(p => p.id))
    expect(ids.size).toBe(ALL.length)
    for (const g of GENRES) expect(ALL.some(p => p.genre === g)).toBe(true)
  })
  test('every preset passes the schema check', () => {
    for (const p of ALL) {
      expect(p.id).toBeTruthy(); expect(p.name).toBeTruthy(); expect(p.genre).toBeTruthy()
      expect(['drum', 'bass', 'lead', 'pad', 'pluck', 'arp', 'fx', 'synth']).toContain(p.cat)
      expect(['DRUM', 'SYNTH']).toContain(p.engine)
      if (p.cat === 'drum') {
        expect(DRUM_TYPES.has(p.type)).toBe(true)
        expect(clamp(p.tune, .3, 2)).toBe(true)
        expect(clamp(p.decay, .1, 4)).toBe(true)
        expect(clamp(p.tone, .3, 2.5)).toBe(true)
        expect(clamp(p.punch, 0, 1)).toBe(true)
      }
    }
  })
  test('8 kits, every kit role resolves through libFind', () => {
    expect(Object.keys(KITS).length).toBe(8)
    for (const k of Object.keys(KITS)) {
      for (const role of ['kick', 'snare', 'hat', 'perc', 'bass', 'lead', 'pad', 'arp', 'fx']) {
        expect(libFind((KITS as any)[k][role])).toBeTruthy()
      }
    }
  })
  test('new v2 types present in the library (conga/bongo/cowbell/clave/zap/boom)', () => {
    for (const t of ['conga', 'bongo', 'cowbell', 'clave', 'zap', 'boom']) {
      expect(DRUMS.some(p => p.type === t)).toBe(true)
    }
  })
})
