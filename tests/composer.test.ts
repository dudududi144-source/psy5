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
import { createHash } from 'node:crypto'
import { compose, COMPOSER_STYLES, SECTION_CHAIN, sectionsFingerprint, variantStepDiff, VARIANT_DIFF_MIN, KICK_VEL_MAX_DELTA } from '../js/composer.js'
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

describe('uniqueness (20 seeds, project-wide incl. variants)', () => {
  test('all 190 seed pairs produce pairwise-different projects', () => {
    const seeds = Array.from({ length: 20 }, (_, i) => 1000 + i * 77)
    const outs = seeds.map(s => compose('FULL-ON', 3, s))
    const jsons = outs.map(o => JSON.stringify(o.project))
    for (let i = 0; i < 20; i++) for (let j = i + 1; j < 20; j++) expect(jsons[i]).not.toBe(jsons[j])
  })
  test('≥90% of seeds have a unique melodic fingerprint (ALL patterns, not just the form)', () => {
    /* metric: signature = hash of every on-step (track,step,note,vel) on the
       melodic tracks (bass/lead/arp) across ALL patterns (base + variants —
       project-wide per the v0.7.0 contract); 20 seeds must yield ≥18 distinct */
    const seeds = Array.from({ length: 20 }, (_, i) => 1000 + i * 77)
    const sigs = new Set()
    for (const s of seeds) {
      const c = compose('FULL-ON', 3, s)
      let sig = ''
      for (const pk of Object.keys(c.project.patterns)) {
        const pat = c.project.patterns[pk]
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
  test('scenes reference existing patterns; colors/bars set; base sections keep their names', () => {
    for (const sc of p.scenes) {
      expect(sc.pattern).not.toBeNull()
      expect(p.patterns[sc.pattern]).toBeTruthy()
      expect(sc.color).not.toBeNull()
      expect(sc.bars).toBeGreaterThanOrEqual(1)
      expect(sc.bars).toBeLessThanOrEqual(8)
    }
    expect(p.scenes.map(s => s.name)).toEqual([
      'INTRO', 'BUILD', 'DROP', 'BREAK', 'RISER', 'DROP2', 'OUTRO',
      'INTRO 2', 'BUILD 2', 'DROP 2', 'DROP 3', 'BREAK 2', 'RISER 2',
      'DROP2 2', 'DROP2 3', 'DROP2 4', 'OUTRO 2',
    ])
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
  test('variant lane deltas use dedicated (track,param) pairs; values open progressively', () => {
    /* base lanes + variant lanes on pairs the base never touches */
    const basePairs = new Set(p.lanes.filter(l => !l.variant).map(l => l.track + ':' + l.param))
    for (const ln of p.lanes.filter(l => l.variant)) {
      expect(basePairs.has(ln.track + ':' + ln.param)).toBe(false)
      expect(typeof ln.variant).toBe('string')
    }
    /* same-family variant lanes on one pair open progressively (k ascends) */
    const byPair = new Map()
    for (const ln of p.lanes.filter(l => l.variant)) {
      const k = ln.track + ':' + ln.param
      if (!byPair.has(k)) byPair.set(k, [])
      byPair.get(k).push(ln)
    }
    for (const [, lns] of byPair) {
      if (lns.length < 2) continue
      const tops = lns.map(l => l.pts[l.pts.length - 1][1])
      for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThan(tops[i - 1])
    }
  })
  test('9th FX track carries the riser preset', () => {
    expect(p.tracks.length).toBe(9)
    expect(p.tracks[8].presetId).toMatch(/FX-/)
  })
})

describe('section variants (v0.7.0 — no identical repeats)', () => {
  const c = compose('FULL-ON', 3, SEED)
  const p = c.project
  test('every family used >1x in the arranger got n−1 variant scenes (naming base+" k")', () => {
    expect(p.scenes.length).toBe(17) /* 7 base + 10 variants for FULL-ON/3min */
    expect(c.stats.variants).toBe(10)
    const byName = new Map(p.scenes.map(s => [s.name, s]))
    for (const base of ['INTRO', 'BUILD', 'DROP', 'BREAK', 'RISER', 'DROP2', 'OUTRO']) {
      const n = p.arranger.steps.filter(st => {
        const nm = p.scenes[st.scene].name
        return nm === base || nm.startsWith(base + ' ')
      }).length
      for (let k = 2; k <= n; k++) expect(byName.has(base + ' ' + k)).toBe(true)
      expect(byName.has(base + ' ' + (n + 1))).toBe(false)
    }
  })
  test('no arranger step repeats a scene: every repeat plays its own variant', () => {
    const seen = new Set()
    for (const st of p.arranger.steps) {
      expect(seen.has(st.scene)).toBe(false) /* consecutive repeats eliminated project-wide */
      seen.add(st.scene)
    }
    expect(seen.size).toBe(p.arranger.steps.length)
  })
  test('form unchanged: Σbars, form sections and the base fingerprint are stable', () => {
    expect(p.arranger.steps.reduce((a, s) => a + s.bars, 0)).toBe(136)
    expect(c.form.totalBars).toBe(108)
    expect(c.form.sections.map(s => s.id)).toEqual(SECTION_CHAIN.map(s => s.id))
    /* base patterns untouched by the variant ops — the form fingerprint hash
       is PINNED to the v0.6.0 value (Phase 0 record); any intentional change
       to fillSection must consciously update this pin (documented) */
    expect(createHash('sha256').update(c.stats.fingerprint).digest('hex').slice(0, 16)).toBe('d0c5f32f032f2a88')
  })
  test('pairwise step-difference within EVERY family ≥ VARIANT_DIFF_MIN (0.15), base included', () => {
    for (const styleId of Object.keys(COMPOSER_STYLES)) {
      for (const minutes of [3, 5, 8]) {
        const r = compose(styleId, minutes, SEED)
        const fam = new Map()
        for (const sc of r.project.scenes) {
          const base = sc.name.replace(/ \d+$/, '')
          if (!fam.has(base)) fam.set(base, [])
          fam.get(base).push(r.project.patterns[sc.pattern])
        }
        for (const [famName, pats] of fam) {
          if (pats.length < 2) continue
          for (let i = 0; i < pats.length; i++) for (let j = i + 1; j < pats.length; j++) {
            const d = variantStepDiff(pats[i], pats[j])
            expect(d).toBeGreaterThanOrEqual(VARIANT_DIFF_MIN)
          }
        }
        expect(r.stats.minVariantDiff).toBeGreaterThanOrEqual(VARIANT_DIFF_MIN)
      }
    }
  })
  test('KICK IS SACRED: variant kicks keep positions/note/micro/prob; |Δvel| ≤ 0.1', () => {
    for (const styleId of Object.keys(COMPOSER_STYLES)) {
      const r = compose(styleId, 3, SEED)
      const byName = new Map(r.project.scenes.map(s => [s.name, s]))
      for (const sc of r.project.scenes) {
        const base = sc.name.replace(/ \d+$/, '')
        if (sc.name === base) continue
        const a = r.project.patterns[byName.get(base)!.pattern].data[0]
        const b = r.project.patterns[sc.pattern].data[0]
        for (let i = 0; i < a.len; i++) {
          expect(!!a.steps[i].on).toBe(!!b.steps[i].on)
          if (a.steps[i].on) {
            expect(b.steps[i].note).toBe(a.steps[i].note)
            expect(b.steps[i].micro).toBe(a.steps[i].micro)
            expect(b.steps[i].prob).toBe(a.steps[i].prob)
            expect(Math.abs(b.steps[i].vel - a.steps[i].vel)).toBeLessThanOrEqual(KICK_VEL_MAX_DELTA)
          }
        }
      }
    }
  })
  test('variants respect the model ranges + pattern length ceiling (step invariants)', () => {
    for (const styleId of Object.keys(COMPOSER_STYLES)) {
      const r = compose(styleId, 5, SEED)
      for (const pk of Object.keys(r.project.patterns)) {
        const pat = r.project.patterns[pk]
        for (const tk of Object.keys(pat.data)) {
          const d = pat.data[tk]
          expect(d.len).toBeLessThanOrEqual(LIMITS.MAX_STEPS)
          for (const st of d.steps) {
            if (!st.on) continue
            expect(st.vel).toBeGreaterThanOrEqual(0.05)
            expect(st.vel).toBeLessThanOrEqual(1)
            expect(st.prob).toBeGreaterThan(0)
            expect(st.prob).toBeLessThanOrEqual(1)
            expect(st.note).toBeGreaterThanOrEqual(12)
            expect(st.note).toBeLessThanOrEqual(108)
          }
        }
      }
    }
  })
  test('share round-trip preserves variants (canonical comparison — share JSON sorts keys)', async () => {
    const { encodeShare, decodeShare } = await import('../js/share.js')
    const canon = (v: any): string => JSON.stringify(v, (_k, val) => {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const o: Record<string, unknown> = {}
        for (const k of Object.keys(val).sort()) o[k] = (val as Record<string, unknown>)[k]
        return o
      }
      return val
    })
    const r = await encodeShare(p)
    const d = await decodeShare(r.token!)
    expect(canon((d.project as any).scenes)).toBe(canon(p.scenes))
    expect(canon((d.project as any).patterns)).toBe(canon(p.patterns))
    expect(canon((d.project as any).arranger)).toBe(canon(p.arranger))
    expect(canon((d.project as any).lanes)).toBe(canon(p.lanes))
    expect((d.project as any).scenes.map((s: any) => s.name)).toEqual(p.scenes.map(s => s.name))
  })
})

describe('FOREST + HI-TECH styles (v0.7.0)', () => {
  test('both styles are full recipes: chain (7 canonical ids, weights sum 1) + recipe dict', () => {
    for (const styleId of ['FOREST', 'HI-TECH']) {
      const st = COMPOSER_STYLES[styleId]
      expect(st.chain!.length).toBe(7)
      expect(st.chain!.map(s => s.id)).toEqual(SECTION_CHAIN.map(s => s.id))
      expect(st.chain!.reduce((a, s) => a + s.w, 0)).toBeCloseTo(1, 9)
      expect(st.recipe).toBeTruthy()
      expect(st.recipe!.hatGhostMul).toBeGreaterThan(1)     /* denser hats */
      expect(st.recipe!.ops).toBeTruthy()                   /* variant op weights */
    }
    expect(COMPOSER_STYLES['FOREST']!.recipe!.bassGrammar).toBe('forest')
    expect(COMPOSER_STYLES['HI-TECH']!.recipe!.percOdd).toBe(true)
    expect(COMPOSER_STYLES['HI-TECH']!.recipe!.riserEvery).toBe(16) /* aggressive riser */
    expect(COMPOSER_STYLES['FULL-ON']!.recipe).toBeUndefined()      /* legacy = defaults */
  })
  test('length ±5% + bpm + form sums (3/5/8 min, both styles) — extends the structure suite', () => {
    for (const styleId of ['FOREST', 'HI-TECH']) {
      for (const minutes of [3, 5, 8]) {
        const r = compose(styleId, minutes, SEED)
        expect(r.form.bpm).toBe(COMPOSER_STYLES[styleId]!.bpm)
        expect(Math.abs(r.form.lengthSec - minutes * 60) / (minutes * 60)).toBeLessThanOrEqual(0.05)
        const sum = r.form.sections.reduce((a, s) => a + s.bars, 0)
        expect(sum).toBe(r.form.totalBars)
        for (const s of r.form.sections) { expect(s.bars).toBeGreaterThanOrEqual(4); expect(s.bars % 4).toBe(0) }
      }
    }
  })
  test('uniqueness (20 seeds per new style, project-wide JSON)', () => {
    for (const styleId of ['FOREST', 'HI-TECH']) {
      const seeds = Array.from({ length: 20 }, (_, i) => 1000 + i * 77)
      const jsons = seeds.map(s => JSON.stringify(compose(styleId, 3, s).project))
      for (let i = 0; i < 20; i++) for (let j = i + 1; j < 20; j++) expect(jsons[i]).not.toBe(jsons[j])
    }
  })
  test('recipe fields are audible: FOREST bass rolls 16ths incl. even steps; HI-TECH perc denser', () => {
    const forest = compose('FOREST', 3, SEED).project
    const fullon = compose('FULL-ON', 3, SEED).project
    const fDrop = forest.patterns['C3']!.data[4]  /* FOREST DROP bass */
    const oDrop = fullon.patterns['C3']!.data[4]  /* FULL-ON DROP bass (odd 16ths only) */
    const fEven = fDrop.steps.filter((s, i) => s.on && i % 2 === 0).length
    expect(fEven).toBeGreaterThan(20)             /* forest grammar: full 16th roll */
    const hTech = compose('HI-TECH', 3, SEED).project
    const dark = compose('DARK-PSY', 3, SEED).project
    const hPerc = hTech.patterns['C3']!.data[3]!.steps.filter(s => s.on).length
    const dPerc = dark.patterns['C3']!.data[3]!.steps.filter(s => s.on).length
    expect(hPerc).toBeGreaterThan(dPerc)          /* glitch density recipe audible */
  })
  test('PINNED: FULL-ON/DARK-PSY/PROGRESSIVE outputs byte-identical to the v0.8.0 Phase-1 hashes', () => {
    /* any intentional change to the legacy recipes (or to shared code paths
       they consume) must consciously update these pins — documented contract.
       v0.8.0 Phase-1 delta: the composer now populates scene.mix snapshots
       (energy-curve payloads; kick excluded) — patterns/fingerprint are
       UNCHANGED (form-fp still d0c5f32f032f2a88); the project JSON grows the
       mix payloads, so the whole-project pins moved (documented in
       CHANGELOG 0.8.0). Determinism re-proven: same seed → byte-identical. */
    const pins: Record<string, string[]> = {
      'FULL-ON': ['338e953768eb4d67', '1d9c77e2f3a03446', '3db876a150141b7f'],
      'DARK-PSY': ['038f8e5b27b46ab2', '62902511bfaabf9e', '766a857696b94ab5'],
      'PROGRESSIVE': ['d8c7d9acfa7bb40a', 'c73d87559d33e59e', 'd6bb48eeade0560a'],
    }
    for (const [styleId, hashes] of Object.entries(pins)) {
      ;[3, 5, 8].forEach((minutes, i) => {
        const h = createHash('sha256').update(JSON.stringify(compose(styleId, minutes, SEED).project)).digest('hex').slice(0, 16)
        expect(h).toBe(hashes[i])
      })
    }
  })
})
