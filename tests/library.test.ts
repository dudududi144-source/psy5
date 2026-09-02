/**
 * PSY6 v0.9.0 P3 — song library tests (pure — no audio context).
 *
 *  - recipes are RECIPES: recipeFromProject(compose output) recovers
 *    (style, seed, len) and composeRecipe re-renders BYTE-IDENTICAL
 *  - library CRUD: content-derived deterministic ids, rename/remove/active
 *  - persistence: JSON round-trip verbatim; loadProjectObj canonical
 *    rebuild (invalid songs dropped, active pointer fixed, absent → null)
 *  - legacy: library-less projects read as null and stay untouched
 *  - G33 support: 3 recipes → compose determinism + ±5% length validity
 */
import { describe, expect, test } from 'bun:test'
import { compose, COMPOSER_STYLES, COMPOSER_LENGTHS } from '../js/composer.js'
import { libraryOf, libraryEnsure, libraryAdd, libraryRemove, libraryRename, librarySetActive, composeRecipe, recipeFromProject, libraryValid } from '../js/library.js'
import { loadProjectObj } from '../js/state.js'

const SEED = 424242
const clone = (p: any) => JSON.parse(JSON.stringify(p))

describe('library core (recipes, not snapshots)', () => {
  test('legacy projects: library absent → libraryOf null, libraryValid true, no field created by reads', () => {
    const p = compose('FULL-ON', 3, SEED).project
    expect(p.library).toBeUndefined()
    expect(libraryOf(p)).toBeNull()
    expect(libraryValid(p)).toBe(true)
    expect(p.library).toBeUndefined() /* reads never materialize */
  })

  test('RECIPE ROUND-TRIP: compose → recipeFromProject → composeRecipe == byte-identical project', () => {
    for (const [style, len, seed] of [['FULL-ON', 3, 424242], ['DARK-PSY', 5, 777], ['FOREST', 3, 31337]] as const) {
      const orig = compose(style, len, seed)
      const rec = recipeFromProject(orig.project)!
      expect(rec).not.toBeNull()
      expect(rec.style).toBe(style)
      expect(rec.seed).toBe(seed)
      expect(rec.len).toBe(len)
      const re = composeRecipe(rec)
      expect(JSON.stringify(re.project)).toBe(JSON.stringify(orig.project))
    }
  })

  test('library CRUD: add (deterministic ids), rename, active, remove', () => {
    const p = compose('FULL-ON', 3, SEED).project
    const a = libraryAdd(p, { name: 'Alpha', style: 'FULL-ON', seed: 424242, len: 3 })
    const b = libraryAdd(p, { name: 'Beta', style: 'DARK-PSY', seed: 777, len: 5 })
    expect(a && b).toBeTruthy()
    expect(a!.id).not.toBe(b!.id)
    expect(a!.id.startsWith('L')).toBe(true)
    expect(a!.composerMeta.bpm).toBe(145)
    /* id determinism: same ops on a fresh clone → same ids */
    const q = compose('FULL-ON', 3, SEED).project
    const a2 = libraryAdd(q, { name: 'Alpha', style: 'FULL-ON', seed: 424242, len: 3 })
    expect(a2!.id).toBe(a!.id)
    /* active pointer follows the first add */
    expect(libraryOf(p)!.activeSongId).toBe(a!.id)
    /* rename */
    expect(libraryRename(p, a!.id, '  Gamma  ')).toBe(true)
    expect(libraryOf(p)!.songs[0].name).toBe('Gamma')
    expect(libraryRename(p, a!.id, '')).toBe(true)
    expect(libraryOf(p)!.songs[0].name).toBe('Gamma') /* empty rename keeps */
    /* setActive validates membership */
    expect(librarySetActive(p, b!.id)).toBe(true)
    expect(libraryOf(p)!.activeSongId).toBe(b!.id)
    expect(librarySetActive(p, 'nope')).toBe(false)
    expect(libraryOf(p)!.activeSongId).toBeNull()
    /* remove clears the pointer, keeps the rest */
    libraryAdd(p, { name: 'C', style: 'FOREST', seed: 31337, len: 3 })
    expect(libraryRemove(p, b!.id)).toBe(true)
    expect(libraryOf(p)!.songs.length).toBe(2)
    expect(libraryRemove(p, b!.id)).toBe(false)
    expect(libraryValid(p)).toBe(true)
  })

  test('invalid recipes rejected; invalid entries fail libraryValid', () => {
    const p = compose('FULL-ON', 3, SEED).project
    expect(libraryAdd(p, { name: 'x', style: 'NOPE', seed: 1, len: 3 })).toBeNull()
    expect(libraryAdd(p, { name: 'x', style: 'FULL-ON', seed: 1, len: 7 })).toBeNull()
    expect(libraryAdd(p, { name: 'x', style: 'FULL-ON', seed: '', len: 3 })).toBeNull()
    const q: any = compose('FULL-ON', 3, SEED).project
    q.library = { songs: [{ id: 'X', name: 'bad', style: 'GHOST', seed: 1, len: 3, composerMeta: {} }], activeSongId: 'X' }
    expect(libraryValid(q)).toBe(false)
  })

  test('JSON round-trip: the library rides verbatim (save/export/share include it)', () => {
    const p = compose('FULL-ON', 3, SEED).project
    libraryAdd(p, { name: 'One', style: 'FULL-ON', seed: 424242, len: 3 })
    libraryAdd(p, { name: 'Two', style: 'PROGRESSIVE', seed: 999, len: 8 })
    const rt = clone(p)
    expect(JSON.stringify(rt.library)).toBe(JSON.stringify(p.library))
    expect(libraryValid(rt)).toBe(true)
  })

  test('loadProjectObj canonical rebuild: library survives, invalid dropped, absent → null', () => {
    const p = compose('FULL-ON', 3, SEED).project
    libraryAdd(p, { name: 'Keep', style: 'FULL-ON', seed: 424242, len: 3 })
    const dirty: any = clone(p)
    dirty.library.songs.push({ id: 'BAD1', name: 'ghost style', style: 'GHOST', seed: 1, len: 3 })
    dirty.library.songs.push({ id: 'BAD2', name: 'bad len', style: 'FULL-ON', seed: 1, len: 7 })
    const loaded = loadProjectObj(dirty)
    const lib = loaded.library!
    expect(lib.songs.length).toBe(1)
    expect(lib.songs[0].name).toBe('Keep')
    expect(lib.songs[0].id).toBe(p.library!.songs[0].id)
    expect(lib.activeSongId).toBe(lib.songs[0].id)
    /* load→save byte stability: canonicalize again → identical */
    const again = loadProjectObj(clone(loaded))
    expect(JSON.stringify(again.library)).toBe(JSON.stringify(loaded.library))
    /* absent → null (documented) */
    const bare = loadProjectObj(compose('FULL-ON', 3, SEED).project)
    expect(bare.library).toBeNull()
    /* legacy flag: libraryValid stays true for library-less */
    expect(libraryValid(bare)).toBe(true)
  })

  test('G33 SUPPORT: 3 recipes → compose determinism ×2 + length validity ±5%', () => {
    const recipes = [
      { id: 'L1', name: 'A', style: 'FULL-ON', seed: 424242, len: 3, composerMeta: { bpm: 145, progression: null } },
      { id: 'L2', name: 'B', style: 'DARK-PSY', seed: 777, len: 5, composerMeta: { bpm: 148, progression: null } },
      { id: 'L3', name: 'C', style: 'FOREST', seed: 31337, len: 3, composerMeta: { bpm: 150, progression: null } },
    ]
    const bars: number[] = []
    for (const rec of recipes) {
      const a = composeRecipe(rec)
      const b = composeRecipe(rec)
      expect(JSON.stringify(a.project)).toBe(JSON.stringify(b.project))
      const err = Math.abs(a.form.lengthSec - rec.len * 60) / (rec.len * 60)
      expect(err).toBeLessThanOrEqual(0.05)
      expect(a.project.scenes.length).toBeGreaterThan(0)
      expect(a.project.arranger.steps.length).toBeGreaterThan(0)
      bars.push(a.form.totalBars)
    }
    expect(bars.length).toBe(3)
  })
})
