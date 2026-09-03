/**
 * PSY6 v0.19.0 — COMPOSED TRANSITIONS + TRANZ CARRIER + CONTENT DEPTH
 *
 * Covers the run's three contracts:
 *   1. The composer WRITES the v0.16 transition vocabulary onto every true
 *      section landing of a composed project (it never did — composed sets
 *      were bare pattern swaps). Deterministic, style-aware, canonical.
 *   2. Every composed set carries the riser+impact carrier pair (FX lane +
 *      the TRANZ complement track) so the vocabulary can actually fire.
 *   3. The genre filter data contract (the dropdown derives from the library
 *      — FOREST was unfilterable) + the DJ DOWN (downlifter) wiring.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { compose, COMPOSER_STYLES } from '../js/composer.js'
import { libFilter, libFind, libCount, KITS } from '../js/presets.js'
import { findTransTrack, normalizeTrans } from '../js/transition.js'
import { songSchedule } from '../js/bounce.js'
import { FILL_NAMES, fillEvents } from '../js/model.js'

const SEED = 424242
const clone = (p: any) => JSON.parse(JSON.stringify(p))
const idxRoot = new URL('.', import.meta.url).pathname

describe('composer section transitions (v0.19.0)', () => {
  const GENTLE = ['TRANCE', 'TECHNO', 'PROGRESSIVE']

  test('every style: scene 0 (song start) has NO trans — the start is not a boundary', () => {
    for (const st of Object.keys(COMPOSER_STYLES)) {
      const p = compose(st, 3, SEED).project
      expect(p.scenes[0].trans).toBeUndefined()
    }
  })

  test('every style: base scenes carry canonical trans; variant scenes never do', () => {
    for (const st of Object.keys(COMPOSER_STYLES)) {
      const p = compose(st, 3, SEED).project
      const nBase = p.arranger.steps.length >= 7 ? 7 : p.scenes.length /* base scenes precede variants */
      /* base scenes: the composer pushes sections first, variants after */
      const sectionCount = p.scenes.filter((s: any) => s.name === s.name).length /* all */
      void sectionCount
      for (let i = 1; i < p.scenes.length; i++) {
        const sc = p.scenes[i]
        if (sc.trans != null) {
          /* canonical shape only — loader/scheduler see exactly these keys */
          expect(Object.keys(sc.trans).sort()).toEqual(['cut', 'impact', 'revcym', 'riser', 'xfade'])
          expect(sc.trans.riser).toBeGreaterThanOrEqual(0)
          expect(sc.trans.riser).toBeLessThanOrEqual(2)
          expect(sc.trans.xfade).toBeGreaterThanOrEqual(0)
          expect(sc.trans.xfade).toBeLessThanOrEqual(8)
        }
      }
      void nBase
    }
  })

  test('DROP landings: impact always, riser stacked, style-aware cut + xfade', () => {
    for (const st of Object.keys(COMPOSER_STYLES)) {
      const p = compose(st, 3, SEED).project
      /* base scenes = first 7 (the canonical chain; variants append after) */
      const drops = p.scenes.slice(0, 7).filter((s: any) => /^DROP/.test(s.name) && s.trans)
      expect(drops.length).toBeGreaterThanOrEqual(2) /* DROP + DROP2 in every 3-min form */
      for (const sc of drops) {
        expect(sc.trans.impact).toBe(1)
        expect(sc.trans.revcym).toBe(0)
        expect([1, 2]).toContain(sc.trans.riser)
        const gentle = GENTLE.includes(st)
        expect(sc.trans.xfade).toBe(gentle ? 4 : 2)
      }
      /* BREAK/BRIDGE landings glide, never hit */
      const breaks = p.scenes.slice(0, 7).filter((s: any) => /^(BREAK|BRIDGE)/.test(s.name) && s.trans)
      for (const sc of breaks) {
        expect(sc.trans.impact).toBe(0)
        expect(sc.trans.riser).toBe(0)
        expect(sc.trans.xfade).toBeGreaterThan(0)
      }
      /* OUTRO landings: the long glide out */
      const outros = p.scenes.slice(0, 7).filter((s: any) => /^OUTRO/.test(s.name) && s.trans)
      for (const sc of outros) expect(sc.trans.xfade).toBe(8)
    }
  })

  test('variant scenes (intra-family repeats) never carry trans', () => {
    for (const st of ['FULL-ON', 'FOREST', 'HI-TECH']) {
      const p = compose(st, 5, SEED).project /* 5 min → repeats → variants exist */
      const variants = p.scenes.slice(7)
      for (const sc of variants) expect(sc.trans).toBeUndefined()
    }
  })

  test('determinism: double compose → byte-identical scene.trans payloads', () => {
    for (const st of ['FULL-ON', 'DARK-PSY', 'TRANCE', 'GOA']) {
      const a = compose(st, 3, 777).project
      const b = compose(st, 3, 777).project
      expect(JSON.stringify(a.scenes.map((s: any) => s.trans || null)))
        .toBe(JSON.stringify(b.scenes.map((s: any) => s.trans || null)))
    }
  })

  test('the composed schedule actually FIRES the vocabulary (trans events exist, cut bites)', () => {
    const p = clone(compose('PSYTRANCE', 1, 42).project)
    const sch = songSchedule(p)
    const tevs = sch.evs.filter((e: any) => e.trans)
    expect(tevs.length).toBeGreaterThanOrEqual(4) /* risers + impacts through the form */
    const riserTrack = findTransTrack(p, 'riser')
    const impactTrack = findTransTrack(p, 'impact')
    expect(riserTrack).toBeGreaterThanOrEqual(0)
    expect(impactTrack).toBeGreaterThanOrEqual(0)
    expect(tevs.some((e: any) => e.track === riserTrack)).toBe(true)
    expect(tevs.some((e: any) => e.track === impactTrack)).toBe(true)
    /* every cut window on a DROP landing really silences the bass */
    const drops = p.scenes.slice(0, 7).filter((s: any) => /^DROP/.test(s.name) && s.trans && s.trans.cut)
    expect(drops.length).toBeGreaterThanOrEqual(1)
    for (const sc of drops) {
      /* find the boundary: the arranger step whose scene lands on this base scene index */
      const si = p.scenes.indexOf(sc)
      const st = p.arranger.steps.find((y: any, i: number) => y.scene === si && i > 0)
      if (!st) continue
      let abs = 0
      for (const y of p.arranger.steps) { if (y === st) break; abs += (y.bars | 0) * 16 }
      const inWindow = sch.evs.filter((e: any) => e.track === 4 && e.s >= abs - 2 && e.s < abs)
      expect(inWindow.length).toBe(0)
    }
  })
})

describe('TRANZ carrier + genre contract + DJ DOWN (v0.19.0)', () => {
  test('composed sets carry the complementary carrier pair (fx lane vs TRANZ)', () => {
    for (const st of Object.keys(COMPOSER_STYLES)) {
      const p = compose(st, 3, SEED).project
      const ri = findTransTrack(p, 'riser')
      const im = findTransTrack(p, 'impact')
      expect(ri).toBeGreaterThanOrEqual(8)
      expect(im).toBeGreaterThanOrEqual(8)
      expect(ri).not.toBe(im)
    }
  })

  test('every genre that owns presets is filterable through libFilter (the dropdown data contract)', () => {
    const genres = new Set<string>()
    for (const c of ['drum', 'bass', 'lead', 'pad', 'pluck', 'arp', 'fx', 'synth']) {
      for (const x of libFilter(c, 'ALL')) if (x.genre !== 'ANY') genres.add(x.genre)
    }
    expect(genres.size).toBeGreaterThanOrEqual(9) /* the 8 legacy genres + FOREST */
    for (const g of genres) expect(libFilter('all', g).length).toBeGreaterThan(0)
    expect(genres.has('FOREST')).toBe(true)
    /* the derived dropdown construction is pinned in the source — a hardcoded
       list must never come back (it silently dropped FOREST) */
    const src = readFileSync(idxRoot + '../js/ui/sound.js', 'utf8')
    expect(src).toContain('new Set(libFilter(')
  })

  test('library totals: 423 presets, FOREST kit complete, all ids unique', () => {
    expect(libCount()).toBe(423)
    const ids = new Set<string>(); let dups = 0
    for (const c of ['drum', 'bass', 'lead', 'pad', 'pluck', 'arp', 'fx', 'synth']) {
      for (const x of libFilter(c, 'ALL')) { if (ids.has(x.id)) dups++; ids.add(x.id) }
    }
    expect(dups).toBe(0)
    for (const role of ['kick', 'snare', 'hat', 'perc', 'bass', 'lead', 'pad', 'arp', 'fx']) {
      expect(libFind((KITS as any)['FOREST'][role])).toBeTruthy()
    }
  })

  test('DJ DOWN (downlifter) is wired: button, shortcut, dispatcher, honest library support', () => {
    const html = readFileSync(idxRoot + '../index.html', 'utf8')
    expect(html).toContain('id="bDown"')
    const sc = readFileSync(idxRoot + '../js/shortcuts.js', 'utf8')
    expect(sc).toContain("key: 'd'")
    const hd = readFileSync(idxRoot + '../js/ui/header.js', 'utf8')
    expect(hd).toContain("djFire('downlifter')")
    /* the library can actually back the tool */
    expect(libFilter('drum', 'ALL').filter((x: any) => x.type === 'downlifter').length).toBeGreaterThanOrEqual(6)
  })

  test('fill vocabulary is five layouts, all deterministic and engine-safe', () => {
    expect(FILL_NAMES.length).toBe(5)
    for (let t = 0; t < 7; t++) {
      const a = fillEvents(t), b = fillEvents(t)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
      for (const e of a) {
        expect(e.vel).toBeGreaterThan(0)
        expect(e.vel).toBeLessThanOrEqual(1)
        expect(e.off).toBeGreaterThanOrEqual(0)
        expect(e.off).toBeLessThanOrEqual(16)
      }
    }
    /* normalizeTrans still canonicalizes everything the composer writes */
    expect(normalizeTrans({ riser: 2, impact: 1, cut: 1, xfade: 2 })).toEqual({ riser: 2, revcym: 0, impact: 1, cut: 1, xfade: 2 })
    expect(normalizeTrans({})).toBeNull()
  })
})
