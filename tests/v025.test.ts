/**
 * v0.25.0 P1 — STRATIFICATION II tests.
 * Pins the batch that fills the owner's thin-cell report:
 *   - texture: a category with ZERO factory presets before v0.25.0 → one
 *     evolving bed per genre (9/9)
 *   - synth: exactly 1 preset before → 6 (5 new utility voices)
 *   - FOREST: every category cell non-zero
 *   - BANDPASS dimension: the library was 75× lowpass vs 2× bandpass →
 *     6 bandpass acid basses across 6 genres (psyreason 8e97cd6 dimension,
 *     exceeded: per-genre res/fenv laws, not one template)
 *   - WIDE pads: detune 24-30 (the stereo-width dimension) × 4 genres
 * v0.30.0: absolute counts re-pinned to the FOUNDATION RESET library
 * (130 junk presets deleted, 11 psy4 presets added → 337 total).
 * Every claim reproducible: bun test tests/v025.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { libCount, libFilter, libFind } from '../js/presets.js'

const ALL = libFilter('all', 'ALL')
const NINE = ['FULL-ON', 'DARK-PSY', 'FOREST', 'HI-TECH', 'PSYTRANCE', 'GOA', 'TECHNO', 'TRANCE', 'PROGRESSIVE']

describe('v0.25.0 stratification II (counts re-pinned to the v0.30.0 FOUNDATION RESET)', () => {
  test('library = 337 presets (the reset deleted 130 junk presets, added 11 psy4), all ids unique', () => {
    expect(libCount()).toBe(337)
    const ids = new Set(ALL.map(p => p.id))
    expect(ids.size).toBe(ALL.length)
  })

  test('texture category: one evolving bed per genre — 9/9 (was 0 everywhere)', () => {
    const tex = libFilter('texture', 'ALL')
    expect(tex.length).toBe(9)
    for (const g of NINE) expect(tex.some(p => p.genre === g)).toBe(true)
    for (const t of tex) {
      expect(t.engine).toBe('SYNTH')
      expect(t.atk).toBeGreaterThanOrEqual(1.2)   // beds evolve slowly
      expect(t.lfoDest).toBe('cutoff')            // movement is tonal, not gatey
    }
  })

  test('synth category: 1 → 6 utility voices', () => {
    expect(libFilter('synth', 'ALL').length).toBe(6)
  })

  test('FOREST: 28 presets — every cell non-zero after the junk purge (was 32 pre-reset)', () => {
    expect(libFilter('all', 'FOREST').length).toBe(28)
    for (const cat of ['drum', 'bass', 'lead', 'pad', 'pluck', 'arp', 'fx', 'synth', 'texture']) {
      expect(libFilter(cat, 'FOREST').length).toBeGreaterThan(0)
    }
  })

  test('bandpass dimension: 6 acid basses across 6 genres, distinct laws', () => {
    const bp = libFilter('bass', 'ALL').filter(p => p.fType === 'bandpass')
    expect(bp.length).toBe(6) // the runtime library had ZERO bandpass before v0.25.0
    const genres = new Set(bp.map(p => p.genre))
    for (const g of ['PSYTRANCE', 'TECHNO', 'HI-TECH', 'DARK-PSY', 'TRANCE', 'PROGRESSIVE']) {
      expect(genres.has(g)).toBe(true)
    }
    const laws = new Set(bp.map(p => `${p.res}/${p.fenv}`))
    expect(laws.size).toBe(6) // stratified, not one template
    for (const b of bp) {
      expect(b.res).toBeGreaterThanOrEqual(12)  // acid needs the squelch
      expect(b.fenv).toBeGreaterThanOrEqual(6)
    }
  })

  test('wide pads: 4 new pads at detune 24-30 (the width dimension)', () => {
    const wide = libFilter('pad', 'ALL').filter(p => (p.detune || 0) >= 24)
    expect(wide.length).toBeGreaterThanOrEqual(9) // 5 legacy wide + 4 new
    for (const g of ['TRANCE', 'TECHNO', 'PSYTRANCE', 'GOA', 'FOREST']) {
      expect(wide.some(p => p.genre === g)).toBe(true)
    }
  })

  test('v0.25 ids + the v0.30.0 psy4 additions resolve through libFind + AUDITION path (cat/engine contract)', () => {
    for (const id of ['TX-PS-NIGHT', 'SN-PS-ZAPPER', 'FS-BASS-MYCELIUM', 'PSB-ACIDBP-V25', 'TR-PAD-WIDESAW', 'PL-FS-DEWDROP', 'FX-FS-DOWN', 'DR-SHAKER-GRAVE', 'HT-SHAKER-CIRCUIT', 'TXD-PS-VEIL', 'TXD-FS-MOSS']) {
      const p = libFind(id)
      expect(p).toBeTruthy()
      expect(p!.engine === 'DRUM' ? p!.cat === 'drum' : p!.cat !== 'drum').toBe(true)
    }
  })
})
