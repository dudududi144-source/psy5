/**
 * soundBank.ts runtime smoke test — the sound bank is a TypeScript library
 * artifact; Bun validates that it parses, evaluates and exports a coherent
 * bank (previously mis-named soundBank.js, uncheckable by JS tooling).
 */
import { describe, expect, test } from 'bun:test'
import { SOUND_BANK, getByCategory, DRUMS, BASSES, LEADS, PADS, PLUCKS, ARPS, FXS, TEXTURES } from '../soundBank.ts'

describe('PSY sound bank', () => {
  test('exports a non-empty unified bank', () => {
    expect(Array.isArray(SOUND_BANK)).toBe(true)
    expect(SOUND_BANK.length).toBeGreaterThan(100)
  })
  test('category arrays sum to the bank', () => {
    const total = DRUMS.length + BASSES.length + LEADS.length + PADS.length
      + PLUCKS.length + ARPS.length + FXS.length + TEXTURES.length
    expect(total).toBe(SOUND_BANK.length)
  })
  test('every preset has id, name, genre and engine', () => {
    for (const p of SOUND_BANK) {
      expect(typeof p.id).toBe('string')
      expect(p.id.length).toBeGreaterThan(0)
      expect(typeof p.name).toBe('string')
      expect(typeof p.genre).toBe('string')
      expect(typeof p.engine).toBe('string')
    }
  })
  test('getByCategory filters correctly', () => {
    expect(getByCategory('drum').length).toBe(DRUMS.length)
    expect(getByCategory('nonexistent' as never)).toEqual([])
  })
})
