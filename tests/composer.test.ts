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
import { compose, COMPOSER_STYLES, SECTION_CHAIN, sectionsFingerprint, variantStepDiff, VARIANT_DIFF_MIN, KICK_VEL_MAX_DELTA, COMPOSER_LENGTHS, allocateBars } from '../js/composer.js'
import { songSteps } from '../js/bounce.js'
import { SCALES } from '../js/model.js'
import { PROGRESSION_TEMPLATES, pickProgression, chordDegreeAt, chordClasses } from '../foundation/music/progression.mjs'
import { paramById } from '../js/params.js'
import { LIMITS } from '../js/limits.js'
import { loadProjectObj, I } from '../js/state.js'

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
  test('9th FX track carries the riser preset; 10th TRANZ carries the complement', () => {
    expect(p.tracks.length).toBe(10)
    expect(p.tracks[8].presetId).toMatch(/FX-/)
    /* v0.19.0 TRANZ: the carrier TYPE is the one the fx lane lacks —
       riser-kits get an impact TRANZ; TRANCE (fx=impact) gets a riser */
    const fxT = (p.tracks[8].sound && p.tracks[8].sound.type) || p.tracks[8].type
    const zT = (p.tracks[9].sound && p.tracks[9].sound.type) || p.tracks[9].type
    expect(p.tracks[9].name).toBe('TRANZ')
    expect(zT === 'impact' || zT === 'riser').toBe(true)
    expect(zT).not.toBe(fxT)
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
    /* v0.27.0 REBUILD VALUE: pad legato scheduling + gate bump and the
       ear-candy pops moved the fingerprint from bb16ce280ff48f88 (v0.9.0).
       v0.29.0 REBUILD VALUE: the pad bed's spread-voicing third (psyreason
       dc072ca port) moved it again from 4eaab7523d9195e8. The snapshot
       pass itself still touches NO pattern data — the pin's purpose
       (snapshots don't mutate patterns) is unchanged. */
    expect(createHash('sha256').update(c.stats.fingerprint).digest('hex').slice(0, 16)).toBe('c8d0e57236f6373d')
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
  test('PINNED: FULL-ON/DARK-PSY/PROGRESSIVE outputs byte-identical per-build (v0.13.0 kit-swap values)', () => {
    /* any intentional change to the recipes (or shared code paths they
       consume) must consciously update these pins — documented contract.
       v0.9.0 REBUILD VALUES: the chord progression engine (P1) re-tones
       bass/lead/pad/arp per the active progression, so all whole-project
       hashes moved vs v0.8.0 (v0.8.0 values recorded in CHANGELOG 0.8.0:
       FULL-ON 338e…/1d9c…/3db8…, DARK-PSY 038f…/6290…/766a…, PROGRESSIVE
       d8c7…/c73d…/d6bb…). v0.10.0: hashes moved AGAIN (composer ins lanes
       + ins base states ride the project JSON; v0.9.0 values recorded in
       CHANGELOG 0.10.0). Determinism re-proven: same seed → byte-identical;
       rhythm tracks byte-identical to v0.8.0 (pinned in the harmony suite). */
    const pins: Record<string, string[]> = {
      /* v0.19.0 RE-PIN: (1) the composer now WRITES scene.trans transition
         configs onto section landings (the v0.16 vocabulary, composed) and
         (2) composed projects carry a 10th TRANZ carrier track — whole-
         project hashes moved; the v0.13.0 values (FULL-ON 83dc9fd03da4dfb4/
         8d9f4e650f55ab87/b0236a5c7bd79fb6, DARK-PSY c5447a30c3f617cd/
         5869a01eeb4731be/b47472b344feb926, PROGRESSIVE d2b3aa8779e19e26/
         06b85c7953e71189/f892f5610afff47e) are recorded in CHANGELOG
         0.19.0. PATTERN-level form-fp (bb16ce280ff48f88) is UNCHANGED —
         asserted above; determinism re-proven (double run byte-identical);
         the RHYTHM pins (harmony suite) are UNCHANGED — trans is scene
         metadata, never pattern data. */
      /* v0.27.0 RE-PIN: escalating build fills (psyreason 77ea289), ear-candy
         bass octave pops (63e1fe3), pad legato scheduling + gate bump
         (f766049) and the pad-legato gate — whole-project hashes moved.
         v0.19.0 values recorded in CHANGELOG 0.19.0. Determinism re-proven
         (double run byte-identical); harmony invariant re-proven (0 viol). */
      /* v0.29.0 RE-PIN: KICK DIMS (psyreason dceec3e/719211c) — DP() now
         seeds body/subk/sat onto every kick preset, so composed projects
         carry the dims in tr.sound and whole-project hashes moved.
         v0.27.0 values (FULL-ON e75a885028ab3e9c/aadce05d24d240e6/
         60f432e4984cbda4, DARK-PSY 152d23dfd353e848/dec249d54cafa297/
         dcdee5361a94aab3, PROGRESSIVE 379c4af5155af77c/fbbd3d7ae927c1f1/
         887afecad1e4e719) recorded here. Determinism re-proven (double run
         byte-identical); harmony invariant re-proven (0 viol). */
      /* v0.29.0 RE-PIN #2: PAD SPREAD VOICING (composer bed third, psyreason
         dc072ca) + PAD TIMBRE (per-style+seed detune/cutoff tint + `width`,
         psyreason dc4f68c/6c8c152/4e09726) — whole-project hashes moved
         again. Phase-1 values (FULL-ON 3e7cf22db15cb096/af9c375fd3e34ed1/
         e3a4ad78f43ddfa8, DARK-PSY cd1456cd06e7ab4d/8769a2f74414975f/
         9b0a969099d911b9, PROGRESSIVE 632df9863e6c9f2f/734caf4e8a5743d0/
         3666798ae4faeec0) recorded here. Determinism re-proven (double run
         byte-identical); harmony invariant re-proven (0 viol). */
      'FULL-ON': ['ad7dc8a9503a278f', '66091ab6725c8754', 'ae4c8d748850fc44'],
      'DARK-PSY': ['bdef2fe82836af78', 'e813b31df033a923', '6ac89d47741323fb'],
      'PROGRESSIVE': ['b6ec451238c2075f', '7cd07faa68d3a2d3', '6ac64acf61b8d3cc'],
    }
    for (const [styleId, hashes] of Object.entries(pins)) {
      ;[3, 5, 8].forEach((minutes, i) => {
        const h = createHash('sha256').update(JSON.stringify(compose(styleId, minutes, SEED).project)).digest('hex').slice(0, 16)
        expect(h).toBe(hashes[i])
      })
    }
  })
})

/* ============ CHORD PROGRESSION ENGINE (v0.9.0 P1 — harmonic coherence) ====
 * Every composed TONAL note (bass/lead/pad/arp) must be a member of the
 * active bar's diatonic triad; rhythm tracks are byte-identical to v0.8.0;
 * progression picks are deterministic and diverse. The chord-tone audit
 * walks the SHARED songSteps expansion — the same walk the WAV renderer,
 * the MIDI exporter and the live scheduler bookkeeping use — so the gate
 * proves the SONG, not just the patterns. */
describe('chord progression engine (v0.9.0 P1)', () => {
  const ivOf = (scaleIv: number[], cls: number) => scaleIv[cls % 7] % 12

  function auditProject(styleId: string, minutes: number, seed: number) {
    const p = JSON.parse(JSON.stringify(compose(styleId, minutes, seed).project))
    const scaleIv = SCALES[p.scale as keyof typeof SCALES]
    const h = p.harmony
    let notes = 0, violations = 0
    for (const y of songSteps(p)) {
      const pat = p.patterns[p.scenes[y.scene].pattern]
      const cls = chordClasses(chordDegreeAt(h, Math.floor(y.phase / 16)))
      const pcs = cls.map((cv: number) => ivOf(scaleIv, cv))
      for (const tk of ['4', '5', '6', '7']) {
        const d = pat.data[tk]
        const st = d.steps[y.phase % d.len]
        if (!st.on) continue
        notes++
        const pc = ((st.note - p.root) % 12 + 12) % 12
        if (!pcs.includes(pc)) violations++
      }
    }
    return { notes, violations }
  }

  test('templates: 12 per family × 9 families, 4/8-bar diatonic loops, unique ids', () => {
    for (const [fam, list] of Object.entries(PROGRESSION_TEMPLATES)) {
      expect(Object.keys(COMPOSER_STYLES)).toContain(fam)
      expect(list.length).toBe(12)
      expect(new Set(list.map(t => t.id)).size).toBe(12)
      for (const t of list) {
        expect([4, 8]).toContain(t.bars)
        expect(t.degrees.length).toBe(t.bars)
        for (const d of t.degrees) { expect(d).toBeGreaterThanOrEqual(0); expect(d).toBeLessThanOrEqual(6) }
      }
    }
    expect(Object.keys(PROGRESSION_TEMPLATES).length).toBe(9)
  })

  test('pick: deterministic, in-family, seed-sensitive (fnv1a(seed+":prog"))', () => {
    for (const fam of Object.keys(COMPOSER_STYLES)) {
      const a = pickProgression(fam, 424242)
      const b = pickProgression(fam, 424242)
      expect(a.id).toBe(b.id)
      expect(PROGRESSION_TEMPLATES[fam as keyof typeof PROGRESSION_TEMPLATES]).toContain(a)
    }
    /* at least one of 5 seeds lands on a different template (not a constant) */
    const ids = new Set([1, 2, 3, 4, 5].map(s => pickProgression('FULL-ON', s).id))
    expect(ids.size).toBeGreaterThan(1)
  })

  test('HARMONIC INVARIANT: 0 chord-tone violations across ALL styles/lengths via the shared expansion', () => {
    let total = 0, viol = 0
    for (const styleId of Object.keys(COMPOSER_STYLES)) {
      for (const minutes of [3, 5, 8]) {
        const r = auditProject(styleId, minutes, SEED)
        total += r.notes
        viol += r.violations
        expect(r.violations).toBe(0)
      }
    }
    /* the audit is non-vacuous: it must have actually listened to >20k notes */
    expect(total).toBeGreaterThan(20000)
    /* and it generalizes: 3 more seeds × 2 styles */
    for (const s of [777, 12345, 999999]) for (const styleId of ['FULL-ON', 'FOREST']) {
      const r = auditProject(styleId, 5, s)
      expect(r.violations).toBe(0)
    }
  })

  test('harmony metadata rides the project (family/progId/degrees) and stats carry the id', () => {
    const c = compose('FULL-ON', 3, SEED)
    expect(c.project.harmony.family).toBe('FULL-ON')
    expect(c.project.harmony.progId).toBe(c.stats.progression)
    expect(PROGRESSION_TEMPLATES['FULL-ON'].find(t => t.id === c.project.harmony.progId)!.degrees).toEqual(c.project.harmony.degrees)
    expect(c.project.harmony.degrees.length).toBe(c.project.harmony.progBars)
  })

  test('DIVERSITY: ≥8 distinct progressions across 20 seeds, every style', () => {
    const counts: Record<string, number> = {}
    for (const styleId of Object.keys(COMPOSER_STYLES)) {
      const set = new Set(Array.from({ length: 20 }, (_, i) => compose(styleId, 3, 1000 + i * 77).stats.progression))
      counts[styleId] = set.size
      expect(set.size).toBeGreaterThanOrEqual(8)
    }
    expect(Object.keys(counts).length).toBe(9)
  })

  test('v0.13.1: the four NEW styles compose deterministically with valid form', () => {
    const NEW_STYLES = ['PSYTRANCE', 'GOA', 'TECHNO', 'TRANCE']
    expect(Object.keys(COMPOSER_STYLES).length).toBe(9)
    for (const styleId of NEW_STYLES) {
      const a = compose(styleId, 3, 555)
      const b = compose(styleId, 3, 555)
      expect(JSON.stringify(a.project)).toBe(JSON.stringify(b.project)) /* deterministic */
      expect(a.form.sections.length).toBe(7)
      expect(a.stats.scenes).toBeGreaterThan(7)
      expect(a.form.bpm).toBe(COMPOSER_STYLES[styleId].bpm)
      expect(a.project.bpm).toBe(COMPOSER_STYLES[styleId].bpm)
      /* harmony rides its own family — every pick lands in the style's templates */
      expect(PROGRESSION_TEMPLATES[styleId]).toContain(pickProgression(styleId, 555))
      /* loads through the project pipeline */
      loadProjectObj(a.project)
      expect(I.p.tracks.length).toBe(10)
      expect(I.p.arranger.steps.length).toBe(a.project.arranger.steps.length)
    }
    /* different styles at the same seed give DIFFERENT songs (bpm/form vary) */
    const bpms = new Set(NEW_STYLES.map(s => compose(s, 3, 555).form.bpm))
    expect(bpms.size).toBe(4)
  })

  test('RHYTHM DIGESTS: kick/snare/hat/perc/fx digests == the v0.27.0 pins', () => {
    /* v0.27.0 RE-PIN: the escalating BUILD/RISER fills intentionally move the
       SNARE track (that is the feature — quarter→8th→16th escalation).
       v0.8.0 pre-P1 / v0.9.0 values recorded in CHANGELOG. The digest law is
       unchanged: rhythm tracks move ONLY through documented composer edits. */
    const pins: Record<string, string> = {
      'FULL-ON/3': '45c7137dd775a135', 'FULL-ON/5': '49195c67794491fd', 'FULL-ON/8': '8f89c21b60fba366',
      'DARK-PSY/3': '9f4648dc3c25cb2e', 'DARK-PSY/5': '620bb94065355a49', 'DARK-PSY/8': '6ec4494beff9ef6d',
      'PROGRESSIVE/3': '8da7f69a570d81c1', 'PROGRESSIVE/5': 'acc2deeafee7bd93', 'PROGRESSIVE/8': 'bebeed3bdde70b15',
      'FOREST/3': 'b411e90ea880ea34', 'FOREST/5': '2e6b5813d9688b38', 'FOREST/8': 'ae52a14689fe0692',
      'HI-TECH/3': '6db83aae1497419a', 'HI-TECH/5': '16bfb5488722c410', 'HI-TECH/8': 'ae43088abc0c9968',
    }
    for (const [key, want] of Object.entries(pins)) {
      const [styleId, mStr] = key.split('/')
      const c = compose(styleId, parseInt(mStr, 10), SEED)
      const dig: string[] = []
      for (const pk of Object.keys(c.project.patterns)) {
        const pat = c.project.patterns[pk as keyof typeof c.project.patterns]
        const sub: Record<string, unknown> = {}
        for (const tk of ['0', '1', '2', '3', '8']) sub[tk] = pat.data[tk]
        dig.push(pk + ':' + createHash('sha256').update(JSON.stringify(sub)).digest('hex').slice(0, 16))
      }
      expect(createHash('sha256').update(dig.join('|')).digest('hex').slice(0, 16)).toBe(want)
    }
  })

  test('PROGRESSIONS ARE AUDIBLE: bass notes move with the chord (not a static root pedal)', () => {
    const p = compose('FULL-ON', 3, SEED).project
    /* collect distinct bass pitch classes across the DROP pattern — with an
       8-bar multi-chord progression there must be more than one */
    const pcs = new Set<number>()
    const d = p.patterns['C3'].data[4]
    for (const st of d.steps) if (st.on) pcs.add(((st.note - p.root) % 12 + 12) % 12)
    expect(pcs.size).toBeGreaterThan(1)
  })
})


/* ============ COMPOSER GROWTH (v0.9.0 P4 — 12 and 20 minute forms) ========
 * Lengths >8 min compose the 11-section EXTENDED_CHAIN (DROP3 + a second
 * BREAK + BRIDGE + OUTRO2); 3/5/8-min outputs stay byte-identical (the
 * legacy-9 pins above are the proof). Memory tiers: full-song renders
 * refuse beyond SONG_HARD_MAX_SEC (30 min) BEFORE any Web Audio work;
 * stems/sections keep the 10-min SONG_MAX_SEC cap (songStemsGuard). */
describe('composer growth (v0.9.0 P4)', () => {
  const EXTENDED_IDS = ['INTRO', 'BUILD', 'DROP', 'BREAK', 'RISER', 'DROP2', 'BREAK2', 'BRIDGE', 'DROP3', 'OUTRO', 'OUTRO2']

  test('allocateBars walks the PASSED weight list (Run-15 NaN regression)', () => {
    const two = allocateBars(100, [0.5, 0.5])
    expect(two.length).toBe(2) /* the old code returned 7 entries (NaN-chain bug) */
    expect(two.reduce((a, b) => a + b, 0)).toBe(100)
    expect(two).toEqual([52, 48]) /* remainder absorber hits the longest (tie -> later) */
    expect(allocateBars(80, [0.25, 0.25, 0.25, 0.25]).reduce((a, b) => a + b, 0)).toBe(80)
    const ext = allocateBars(436, [0.07, 0.09, 0.12, 0.08, 0.07, 0.12, 0.08, 0.09, 0.13, 0.08, 0.07])
    expect(ext.length).toBe(11)
    expect(ext.reduce((a, b) => a + b, 0)).toBe(436)
    for (const b of ext) { expect(b).toBeGreaterThanOrEqual(4); expect(b % 4).toBe(0) }
  })

  test('COMPOSER_LENGTHS now carries 12 and 20', () => {
    expect(COMPOSER_LENGTHS).toEqual([3, 5, 8, 12, 20])
  })

  test('12/20-min forms: 11 sections in the documented extended order, every style', () => {
    for (const styleId of Object.keys(COMPOSER_STYLES)) {
      for (const minutes of [12, 20]) {
        const r = compose(styleId, minutes, SEED)
        expect(r.form.sections.map(s => s.id)).toEqual(EXTENDED_IDS)
        expect(r.form.totalBars).toBe(r.form.sections.reduce((a, s) => a + s.bars, 0))
        for (const s of r.form.sections) { expect(s.bars).toBeGreaterThanOrEqual(4); expect(s.bars % 4).toBe(0) }
        /* extended-form tiers: DROP3 exists, two BREAK-family sections,
           BRIDGE and OUTRO2 present */
        expect(r.form.sections.filter(s => s.id.startsWith('DROP')).length).toBe(3)
        expect(r.form.sections.filter(s => s.id.startsWith('BREAK') || s.id === 'BRIDGE').length).toBe(3)
        expect(r.form.sections.filter(s => s.id.startsWith('OUTRO')).length).toBe(2)
      }
    }
  })

  test('12/20-min length accuracy ≤±5% and determinism (all styles)', () => {
    /* 9 styles × 2 lengths × 2 determinism runs = 36 full extended forms —
       legitimately the suite's heaviest test; carries an explicit generous
       per-test cap (the default 5 s is a CI-box lottery on the 2-core
       runner, v0.19.0). */
    for (const styleId of Object.keys(COMPOSER_STYLES)) {
      for (const minutes of [12, 20]) {
        const a = compose(styleId, minutes, SEED)
        const b = compose(styleId, minutes, SEED)
        expect(JSON.stringify(a)).toBe(JSON.stringify(b))
        const err = Math.abs(a.form.lengthSec - minutes * 60) / (minutes * 60)
        expect(err).toBeLessThanOrEqual(0.05)
      }
    }
  }, 30000)

  test('vmin ≥ 0.15 holds at 12/20-min across all 5 styles', () => {
    let minV = 1
    for (const styleId of Object.keys(COMPOSER_STYLES)) {
      for (const minutes of [12, 20]) {
        minV = Math.min(minV, compose(styleId, minutes, SEED).stats.minVariantDiff)
      }
    }
    expect(minV).toBeGreaterThanOrEqual(VARIANT_DIFF_MIN)
  })

  test('extended scenes reference valid patterns; behavior mapping keeps breakdowns breakdown-y', () => {
    const p = compose('FULL-ON', 12, SEED).project
    for (const sc of p.scenes) expect(p.patterns[sc.pattern]).toBeTruthy()
    /* BRIDGE/BREAK2 behave like BREAK: no kick, half-time snare */
    const bridgePat = p.patterns[p.scenes.find(s => s.name === 'BRIDGE')!.pattern]!
    expect(bridgePat.data[0].steps.some(s => s.on)).toBe(false) /* kick silent */
    expect(bridgePat.data[1].steps.some(s => s.on)).toBe(true)  /* snare present */
    /* DROP3 behaves like DROP: full 4-on-floor kick */
    const drop3Pat = p.patterns[p.scenes.find(s => s.name === 'DROP3')!.pattern]!
    const kickHits = drop3Pat.data[0].steps.filter(s => s.on).length
    expect(kickHits).toBeGreaterThanOrEqual(16)
    /* mix snapshots follow the behavior mapping (BREAK2 gets the BREAK mix) */
    const break2 = p.scenes.find(s => s.name === 'BREAK2')!
    expect(break2.mix).toBeTruthy()
    expect(break2.mix!.tracks['5']!.sendA).toBeGreaterThan(0.2) /* spatial BREAK sends */
  })

  test('SONG_HARD_MAX_SEC: renderSong refuses >30 min BEFORE Web Audio (null, no OfflineAudioContext)', async () => {
    const { renderSong, SONG_HARD_MAX_SEC } = await import('../js/bounce.js')
    expect(SONG_HARD_MAX_SEC).toBe(1800)
    const p = compose('FULL-ON', 20, SEED).project
    const over = JSON.parse(JSON.stringify(p))
    over.arranger.on = true
    over.arranger.steps = [{ scene: 0, bars: 3000 }] /* 3000 bars @145 ≈ 4965 s ≫ 1800 */
    const r = await renderSong(over)
    expect(r).toBeNull()
    /* a legal long-form (20 min) passes the hard cap (guard is >1800) */
    const { songDurationSec } = await import('../js/bounce.js')
    const d20 = songDurationSec(p)
    expect(d20.withTail).toBeLessThanOrEqual(SONG_HARD_MAX_SEC)
    expect(d20.withTail).toBeGreaterThan(600) /* genuinely long-form territory */
  })
})
