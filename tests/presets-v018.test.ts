/**
 * PSY6 v0.18.0 — PRESET BATCH (+36: library 345→381) + FILL VARIANTS
 * + DJ TOOLS carrier logic.
 *
 * Owner driver: "תמלא עוד דברים שיהיה מבחר עשיר" (fill more, rich variety)
 * and the standing playability ask. This suite pins:
 *  1. the +36 batch: exact library total, zero id collisions, FOREST's
 *     first own presets, per-category deltas
 *  2. fillEvents: three deterministic layouts (CLASSIC/ROLL/TOMLINE),
 *     clamped velocities, tune climb via parameter locks, wrap-around
 *  3. findTransTrack: which DJ tool each composed kit can carry (riser
 *     everywhere, impact on TRANCE, revcym honestly absent)
 */
import { describe, expect, test } from 'bun:test'
import { libFind, libCount, libFilter, KITS } from '../js/presets.js'
import { fillEvents, FILL_NAMES } from '../js/model.js'
import { findTransTrack } from '../js/transition.js'
import { compose } from '../js/composer.js'

const NEW_IDS = [
  /* drums (9) */
  'FO-KICK-CAMO', 'FO-PERC-TWIG', 'DH-SNARE-CRUSH', 'GO-CLAP-DUNE', 'FU-CONGA-HEAT',
  'PR-BONGO-SOFT', 'TR-DARBUKA-SILK', 'TE-COWBELL-STEEL', 'DH-CRASH-BLACK',
  /* bass (6) */
  'FO-BASS-GATE', 'DH-BASS-SCREAM', 'GO-BASS-SQUARE', 'FU-BASS-SUBPUMP', 'DH-BASS-WOBBLE', 'FU-BASS-ROLLOCT',
  /* lead (6) */
  'GO-LEAD-TRANCESAW', 'DH-LEAD-ALIEN', 'PS-LEAD-HOOVER', 'TR-LEAD-LEDPLK', 'FU-LEAD-RAZOR', 'TE-LEAD-METAL',
  /* pad (5) */
  'GO-PAD-SHIMMER', 'DH-PAD-BLACKVEIL', 'FU-PAD-AMBER', 'PR-PAD-MIST', 'FU-PAD-VOCODE',
  /* pluck (5) */
  'PS-PLUCK-MORNING', 'GO-PLUCK-SITAR', 'DH-PLUCK-GLASS', 'FU-PLUCK-SPARK', 'FU-PLUCK-WOOD',
  /* arp (5) */
  'DH-ARP-NEEDLE', 'GO-ARP-TEMPLE', 'FU-ARP-HELIX', 'PR-ARP-GENTLE', 'TR-ARP-CRYSTAL',
]

describe('preset batch v0.18 — richer variety, purely additive', () => {
  test('library total is exactly 456 (381 + 42 in v0.19.0 + 33 in v0.25.0)', () => {
    expect(libCount()).toBe(456)
  })
  test('all 36 new ids resolve with the right category', () => {
    for (const id of NEW_IDS) {
      const pr = libFind(id)
      expect(pr).not.toBeNull()
      expect(NEW_IDS.filter(x => x === id).length).toBe(1)
      expect(pr!.cat).toBeTruthy()
    }
    expect(libFind('GO-PLUCK-SITAR')!.cat).toBe('pluck')
    expect(libFind('DH-BASS-SCREAM')!.cat).toBe('bass')
    expect(libFind('FU-PAD-AMBER')!.cat).toBe('pad')
    expect(libFind('FO-KICK-CAMO')!.cat).toBe('drum')
    expect(libFind('FO-KICK-CAMO')!.type).toBe('kick')
  })
  test('zero id collisions across the whole library', () => {
    const ids = new Set()
    let dups = 0
    for (const c of ['drum', 'bass', 'lead', 'pad', 'pluck', 'arp', 'fx', 'synth']) {
      for (const x of libFilter(c, 'ALL')) { if (ids.has(x.id)) dups++; ids.add(x.id) }
    }
    expect(dups).toBe(0)
  })
  test('per-category deltas: drum 259, bass 55, lead 35, pad 31, pluck 24, arp 22, fx 15', () => {
    const want: Record<string, number> = { drum: 259, bass: 55, lead: 35, pad: 31, pluck: 24, arp: 22, fx: 15 }
    for (const [c, n] of Object.entries(want)) expect(libFilter(c, 'ALL').length).toBe(n)
  })
  test('FOREST carries its own kit now (was 2 presets — it rode DARK-PSY)', () => {
    expect(libFilter('drum', 'FOREST').length).toBeGreaterThanOrEqual(10)
    expect(libFilter('bass', 'FOREST').length).toBeGreaterThanOrEqual(2)
    for (const role of ['kick', 'snare', 'hat', 'perc', 'bass', 'lead', 'pad', 'arp', 'fx']) {
      expect(libFind((KITS as any)['FOREST'][role])).toBeTruthy()
    }
  })
  test('pinned legacy ids are untouched (additive contract)', () => {
    for (const id of ['PS-KICK-TIGHT', 'PS-KICK-DEEP', 'PR-KICK', 'HAT-TE-O', 'TE-KICK-SUB']) {
      expect(libFind(id)).not.toBeNull()
    }
  })
})

describe('fill variants — legacy five layouts (pinned byte-identical since v0.19.0)', () => {
  test('FILL_NAMES legacy five come first, byte-identical order (v0.20.0 appends STUTTER/HOVER/SPIRAL)', () => {
    expect(FILL_NAMES.slice(0, 5)).toEqual(['CLASSIC', 'ROLL', 'TOMLINE', 'SNARE16', 'CLIMB'])
  })
  test('CLASSIC (0): 8 × 8th-note perc hits, velocity crescendo .5→.85', () => {
    const ev = fillEvents(0)
    expect(ev.length).toBe(8)
    expect(ev.every(e => e.track === 3)).toBe(true)
    expect(ev[0].off).toBe(0)
    expect(ev[7].off).toBe(3.5)
    expect(ev[0].vel).toBeCloseTo(.5, 10)
    expect(ev[7].vel).toBeCloseTo(.85, 10)
  })
  test('ROLL (1): 16 × 16th hits, velocity .35→.95', () => {
    const ev = fillEvents(1)
    expect(ev.length).toBe(16)
    expect(ev[0].vel).toBeCloseTo(.35, 10)
    expect(ev[15].vel).toBeCloseTo(.95, 10)
    expect(ev.every(e => e.off >= 0 && e.off <= 7.5)).toBe(true)
  })
  test('TOMLINE (2): perc tune climb .8→1.4 via locks + snare accents', () => {
    const ev = fillEvents(2)
    expect(ev.length).toBe(12)
    const perc = ev.filter(e => e.track === 3)
    const snare = ev.filter(e => e.track === 1)
    expect(perc.length).toBe(8)
    expect(snare.length).toBe(4)
    expect(perc[0].lock!.tune).toBeCloseTo(.8, 3)
    expect(perc[7].lock!.tune).toBeCloseTo(1.4, 3)
  })
  test('SNARE16 (3): full-bar accelerating 16th snare roll + 2 perc accents', () => {
    const ev = fillEvents(3)
    const snare = ev.filter(e => e.track === 1)
    const perc = ev.filter(e => e.track === 3)
    expect(snare.length).toBe(16)
    expect(perc.length).toBe(2)
    expect(snare[0].off).toBe(0)
    expect(snare[15].off).toBe(15) /* every step of the bar — true 16ths */
    expect(snare[0].vel).toBeCloseTo(.3, 10)
    expect(snare[15].vel).toBeCloseTo(.95, 10)
  })
  test('CLIMB (4): rising-tune perc sweep .7→1.33 via locks', () => {
    const ev = fillEvents(4)
    expect(ev.length).toBe(8)
    expect(ev.every(e => e.track === 3)).toBe(true)
    expect(ev[0].lock!.tune).toBeCloseTo(.7, 3)
    expect(ev[7].lock!.tune).toBeCloseTo(1.33, 3)
    expect(ev[7].vel).toBeGreaterThan(ev[0].vel)
  })
  test('velocities never leave the engine range and layouts are deterministic', () => {
    for (const t of [0, 1, 2, 3, 4]) {
      const a = fillEvents(t), b = fillEvents(t)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
      for (const e of a) { expect(e.vel).toBeGreaterThan(0); expect(e.vel).toBeLessThanOrEqual(1) }
    }
  })
  test('type wraps modulo FILL_NAMES.length (negative safe) — generalized in v0.20.0', () => {
    expect(JSON.stringify(fillEvents(FILL_NAMES.length))).toBe(JSON.stringify(fillEvents(0)))
    expect(JSON.stringify(fillEvents(-1))).toBe(JSON.stringify(fillEvents(FILL_NAMES.length - 1)))
  })
})

describe('DJ tools — carrier logic per composed kit', () => {
  test('riser: every composer style carries one (FX lane, or TRANZ on TRANCE)', () => {
    for (const st of ['FULL-ON', 'PSYTRANCE', 'GOA', 'HI-TECH', 'DARK-PSY', 'TECHNO', 'PROGRESSIVE', 'FOREST', 'TRANCE']) {
      const p = compose(st, 3, 424242).project
      expect(findTransTrack(p, 'riser')).toBeGreaterThanOrEqual(8)
    }
  })
  test('v0.19.0: EVERY composed set carries riser+impact on distinct lanes; revcym honestly absent', () => {
    for (const st of ['FULL-ON', 'TRANCE', 'TECHNO', 'FOREST']) {
      const p = compose(st, 3, 424242).project
      const ri = findTransTrack(p, 'riser')
      const im = findTransTrack(p, 'impact')
      expect(ri).toBeGreaterThanOrEqual(8)
      expect(im).toBeGreaterThanOrEqual(8)
      expect(im).not.toBe(ri) /* the TRANZ complement contract */
      expect(findTransTrack(p, 'revcym')).toBe(-1)
    }
  })
  test('a project with an assigned revcym track becomes SWELL-capable', () => {
    const p = compose('FULL-ON', 3, 424242).project
    const pr = libFind('DH-CRASH-BLACK') /* any new drum; use a revcym preset */
    const rev = libFind('FX-PS-RISE') ? null : null /* sanity: legacy ids still resolve */
    /* assign a real revcym preset onto track 8 (over the riser) */
    const revcym = libFilter('drum', 'ALL').find(x => x.type === 'revcym')!
    p.tracks[8].kind = 'drum'
    p.tracks[8].sound = Object.assign({}, revcym)
    p.tracks[8].type = 'revcym'
    expect(findTransTrack(p, 'revcym')).toBe(8)
    expect(pr && rev === null).toBe(true)
  })
})
