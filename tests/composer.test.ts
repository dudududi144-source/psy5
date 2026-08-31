/**
 * PSY6 v0.5.0 composer tests (pure — no audio context needed).
 *
 *  - determinism: same seed+style+length → byte-identical project (3 styles)
 *  - structure: 7-section chain, bars sum to the target (multiples of 4, ≥4),
 *    total length within ±5% of target, coherent energy curve
 *  - step invariants: every composed step respects the model ranges
 *  - uniqueness: 20 seeds → all pairwise JSON-unequal AND ≥90% unique
 *    melodic fingerprints (metric documented below)
 *  - integrity: scenes/patterns/arranger/lanes reference each other
 *    consistently; pattern lengths respect the 128-step ceiling
 */
import { describe, expect, test } from 'bun:test'
import { compose, COMPOSER_STYLES, SECTION_CHAIN, sectionsFingerprint } from '../js/composer.js'
import { paramById } from '../js/params.js'
import { LIMITS } from '../js/limits.js'

const SEED = 424242

describe('determinism', () => {
  test('same seed+style+length → byte-identical project (all styles)', () => {
    for (const styleId of Object.keys(COMPOSER_STYLES)) {
      const a = JSON.stringify(compose(styleId, 3, SEED).project)
      const b = JSON.stringify(compose(styleId, 3, SEED).project)
      expect(a).toBe(b)
    }
  })
  test('regenerate with unchanged fields → identical output incl. form', () => {
    const a = compose('FULL-ON', 5, SEED)
    const b = compose('FULL-ON', 5, SEED)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('structure validity', () => {
  const c = compose('FULL-ON', 3, SEED)
  test('section chain is the documented 7-section order', () => {
    expect(c.form.sections.map(s => s.id)).toEqual(SECTION_CHAIN.map(s => s.id))
    expect(c.form.sections.length).toBe(7)
  })
  test('bars sum to the target; every section ≥4 bars, multiple of 4', () => {
    const sum = c.form.sections.reduce((a, s) => a + s.bars, 0)
    expect(sum).toBe(c.form.totalBars)
    for (const s of c.form.sections) { expect(s.bars).toBeGreaterThanOrEqual(4); expect(s.bars % 4).toBe(0) }
  })
  test('total length within ±5% of target (3/5/8 minutes, all styles)', () => {
    for (const styleId of Object.keys(COMPOSER_STYLES)) {
      for (const minutes of [3, 5, 8]) {
        const r = compose(styleId, minutes, SEED)
        const err = Math.abs(r.form.lengthSec - minutes * 60) / (minutes * 60)
        expect(err).toBeLessThanOrEqual(0.05)
        expect(r.form.bpm).toBe(COMPOSER_STYLES[styleId].bpm)
      }
    }
  })
  test('energy curve is coherent: drops peak, outro releases', () => {
    const e = Object.fromEntries(c.form.sections.map(s => [s.id, s.energy]))
    expect(e.DROP).toBeGreaterThan(e.INTRO)
    expect(e.DROP2).toBeGreaterThanOrEqual(e.DROP - 0.1)
    expect(e.OUTRO).toBeLessThan(e.DROP)
    expect(e.BREAK).toBeLessThan(e.DROP)
  })
})

describe('step invariants', () => {
  test('every composed step respects the model ranges', () => {
    const p = compose('DARK-PSY', 5, SEED).project
    for (const pk of Object.keys(p.patterns)) {
      const pat = p.patterns[pk]
      for (const tk of Object.keys(pat.data)) {
        const d = pat.data[tk]
        expect(d.len).toBeLessThanOrEqual(LIMITS.MAX_STEPS)
        for (const st of d.steps) {
          expect(st.on === 0 || st.on === 1).toBe(true)
          if (st.on) {
            expect(st.vel).toBeGreaterThanOrEqual(0.05)
            expect(st.vel).toBeLessThanOrEqual(1)
            expect(st.prob).toBeGreaterThan(0)
            expect(st.prob).toBeLessThanOrEqual(1)
            expect(st.micro).toBeGreaterThanOrEqual(-100)
            expect(st.micro).toBeLessThanOrEqual(100)
            expect(Number.isInteger(st.note)).toBe(true)
            expect(st.note).toBeGreaterThanOrEqual(12)
            expect(st.note).toBeLessThanOrEqual(108)
          }
        }
      }
    }
  })
})

describe('uniqueness (20 seeds)', () => {
  test('all 190 seed pairs produce pairwise-different projects', () => {
    const seeds = Array.from({ length: 20 }, (_, i) => 1000 + i * 77)
    const outs = seeds.map(s => compose('FULL-ON', 3, s))
    const jsons = outs.map(o => JSON.stringify(o.project))
    for (let i = 0; i < 20; i++) for (let j = i + 1; j < 20; j++) expect(jsons[i]).not.toBe(jsons[j])
  })
  test('≥90% of seeds have a unique melodic fingerprint', () => {
    /* metric: signature = hash of every on-step (track,step,note,vel) on the
       melodic tracks (bass/lead/arp) across all sections; 20 seeds must yield
       ≥18 distinct signatures */
    const seeds = Array.from({ length: 20 }, (_, i) => 1000 + i * 77)
    const sigs = new Set()
    for (const s of seeds) {
      const c = compose('FULL-ON', 3, s)
      let sig = ''
      for (const sec of c.form.sections) {
        const pat = c.project.patterns[sec.pattern]
        for (const tk of ['4', '5', '7']) {
          const d = pat.data[tk]
          for (let i = 0; i < d.len; i++) {
            const st = d.steps[i]
            if (st.on) sig += tk + '.' + i + '.' + st.note + '.' + Math.round(st.vel * 1000) + ';'
          }
        }
      }
      sigs.add(sig)
    }
    expect(sigs.size / 20).toBeGreaterThanOrEqual(0.9)
  })
})

describe('output integrity', () => {
  const c = compose('FULL-ON', 3, SEED)
  const p = c.project
  test('scenes reference existing patterns; colors/bars set; renamed by section', () => {
    for (const sc of p.scenes) {
      expect(sc.pattern).not.toBeNull()
      expect(p.patterns[sc.pattern]).toBeTruthy()
      expect(sc.color).not.toBeNull()
      expect(sc.bars).toBeGreaterThanOrEqual(1)
      expect(sc.bars).toBeLessThanOrEqual(8)
    }
    expect(p.scenes.map(s => s.name)).toEqual(['INTRO', 'BUILD', 'DROP', 'BREAK', 'RISER', 'DROP2', 'OUTRO'])
  })
  test('arranger steps reference valid scenes with legal bars', () => {
    expect(p.arranger.on).toBe(true)
    expect(p.arranger.steps.length).toBeGreaterThanOrEqual(7)
    for (const st of p.arranger.steps) {
      expect(st.scene).toBeGreaterThanOrEqual(0)
      expect(st.scene).toBeLessThan(p.scenes.length)
      expect(st.bars).toBeGreaterThanOrEqual(1)
      expect(st.bars).toBeLessThanOrEqual(64)
    }
  })
  test('all tracks in a pattern share the same length (loop math)', () => {
    for (const pk of Object.keys(p.patterns)) {
      const pat = p.patterns[pk]
      const lens = Object.values(pat.data).map(d => d.len)
      expect(new Set(lens).size).toBe(1)
    }
  })
  test('lane suggestions are registry params in state mode', () => {
    expect(p.lanes.length).toBeGreaterThanOrEqual(3)
    for (const ln of p.lanes) {
      expect(paramById(ln.param)).not.toBeNull()
      expect(ln.mode).toBe('state')
      expect(ln.pts.length).toBeGreaterThanOrEqual(2)
    }
    expect(p.lanes.map(l => l.param)).toContain('cutoff')        /* BUILD sweep */
    expect(p.lanes.map(l => l.param)).toContain('mix.sendA')     /* RISER rise */
    expect(p.lanes.map(l => l.param)).toContain('mix.sendB')
  })
  test('9th FX track carries the riser preset', () => {
    expect(p.tracks.length).toBe(9)
    expect(p.tracks[8].presetId).toMatch(/FX-/)
  })
})
