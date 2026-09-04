/**
 * kit-reason.mjs (v0.24.0) — REASON KIT LIBRARY — the cohesion layer.
 *
 * The owner's v0.23.0 verdict: individual sounds are good but "there is no
 * connection between them" — the kit does not cohere as ONE instrument and
 * sounds destroy the mix dynamics and harmony. This file pins the DATA that
 * makes every kit one coherent instrument:
 *
 *   1. COMPLETENESS — 6 kits, every kit defines ALL 8 engine roles (every
 *      required subfield, finite, in-range) AND ALL 12 kit-governed ROM
 *      roles; choke/humanize/rootHz/meta present.
 *   2. WINDOW LAW — every pitched ROM f0mul × kit.rootHz lands inside its
 *      musically/physically sane window (hardcoded from the brief); the 4
 *      non-pitched types carry f0mul = 1.
 *   3. LOUDNESS LAW — every role's rms sits inside its family band (the
 *      anti-"dynamics destroyer", mirroring perc-rom SPEC magnitudes).
 *   4. CONSONANCE — the "connection": conga f0mul is a clean just ratio of
 *      the root (2 / 2.52 / 3 / 4 ±4%), tom tuneRatio ∈ {1, 1.5, 2} ±4%,
 *      and EVERY pitched rom f0mul is a member of the documented clean set.
 *   5. PORTS — kits 1–3 kick body.startHz (168/150/175) + driveDb
 *      (3.5/5.0/1.5) + hatC hp.hz (7600/8200/7200) match psyreason
 *      devices/redrum/kit-builtin.ts verbatim (plus tom/snare/hatO/clap
 *      fidelity pins).
 *   6. STYLE MAP — STYLE_KIT covers EXACTLY the 5 styles from
 *      data/styles.json (read live via node:fs).
 *   7. ACCESSORS — null-safe bad ids, warm loop = 20 types in the pinned
 *      order, deep-frozen data.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  REASON_KITS, KIT_IDS, DEFAULT_KIT, STYLE_KIT, ENGINE_ROLES, KIT_ROM_ROLES,
  kitPatch, kitRomSpec, kitRootHz, kitChoke, kitMeta,
  isReasonEngineType, isKitRomType, kitWarmTypes,
} from '../foundation/dsp/kit-reason.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/* ── hardcoded contract tables (from the brief) ────────────────────────── */

/* f0mul × rootHz must land inside its per-type window. */
const F0_WINDOWS = {
  conga: [70, 130], bongo: [140, 260], darbuka: [90, 170], rim: [170, 320],
  cowbell: [400, 620], clave: [900, 1400], agogo: [380, 700], timbale: [180, 320],
}
const NON_PITCHED = ['shaker', 'tambourine', 'triangle', 'revcym']

/* The family loudness law (mirror perc-rom spec magnitudes). */
const RMS_BANDS = {
  kick: [0.18, 0.23], snare: [0.13, 0.18], clap: [0.12, 0.16],
  hatC: [0.05, 0.075], hatO: [0.06, 0.085], tom: [0.10, 0.14],
  crash: [0.08, 0.11], ride: [0.06, 0.09],
  conga: [0.09, 0.13], bongo: [0.07, 0.11], darbuka: [0.08, 0.12],
  rim: [0.05, 0.085], cowbell: [0.07, 0.10], clave: [0.06, 0.09],
  agogo: [0.055, 0.085], timbale: [0.06, 0.09],
  shaker: [0.04, 0.07], tambourine: [0.045, 0.075], triangle: [0.04, 0.065],
  revcym: [0.07, 0.10],
}

/* Clean just ratios of the kit root (the documented musical set). */
const CLEAN_RATIOS = [1, 1.5, 2, 2.52, 3, 4, 4.5, 5.04, 6, 8, 10.08, 12, 16, 24, 32]

/* Required engine subfields per role, with sanity kinds:
   hz [20,20000] · ms [0,10000] · unit [0,1] · ratio [1,4] · drive [0,6] ·
   res [0,10] · q [0.05,20] · num (finite) · wave ('sine') ·
   arrHz (3×hz) · arrMs (3×ms). */
const BOUNDS = {
  hz: [20, 20000], ms: [0, 10000], unit: [0, 1], ratio: [1, 4],
  drive: [0, 6], res: [0, 10], q: [0.05, 20],
}
const ENGINE_FIELDS = {
  kick: [
    ['body.wave', 'wave'], ['body.startHz', 'hz'], ['body.endHz', 'hz'],
    ['body.pitchDecayMs', 'ms'], ['body.bodyDecayMs', 'ms'],
    ['punch.ratio', 'ratio'], ['punch.amount', 'unit'], ['punch.decayMs', 'ms'],
    ['click.amount', 'unit'], ['click.ms', 'ms'], ['click.hpHz', 'hz'],
    ['filter.cutoff', 'hz'], ['filter.res', 'res'],
    ['driveDb', 'drive'], ['velTrack', 'unit'], ['rms', 'num'],
  ],
  snare: [
    ['body.startHz', 'hz'], ['body.endHz', 'hz'], ['body.pitchDecayMs', 'ms'],
    ['tone.amount', 'unit'], ['tone.decayMs', 'ms'],
    ['noise.bpHz', 'hz'], ['noise.q', 'q'], ['noise.amount', 'unit'],
    ['noise.decayMs', 'ms'],
    ['driveDb', 'drive'], ['velTrack', 'unit'], ['rms', 'num'],
  ],
  clap: [
    ['taps', 'arrHz'], ['tapMs', 'arrMs'], ['bursts', 'arrMs'],
    ['tail.decayMs', 'ms'], ['tail.amount', 'unit'],
    ['driveDb', 'drive'], ['velTrack', 'unit'], ['rms', 'num'],
  ],
  hatO: [
    ['metal.hz', 'hz'], ['metal.ratio', 'ratio'], ['metal.amount', 'unit'],
    ['noise.amount', 'unit'], ['noise.hpHz', 'hz'],
    ['hp.hz', 'hz'], ['hp.q', 'q'], ['decayMs', 'ms'],
    ['driveDb', 'drive'], ['velTrack', 'unit'], ['rms', 'num'],
  ],
  hatC: [
    ['metal.hz', 'hz'], ['metal.ratio', 'ratio'], ['metal.amount', 'unit'],
    ['noise.amount', 'unit'], ['noise.hpHz', 'hz'],
    ['hp.hz', 'hz'], ['hp.q', 'q'], ['decayMs', 'ms'],
    ['driveDb', 'drive'], ['velTrack', 'unit'], ['rms', 'num'],
  ],
  tom: [
    ['body.startHz', 'hz'], ['body.endHz', 'hz'], ['body.pitchDecayMs', 'ms'],
    ['body.bodyDecayMs', 'ms'],
    ['filter.cutoff', 'hz'], ['filter.res', 'res'],
    ['driveDb', 'drive'], ['velTrack', 'unit'], ['rms', 'num'],
    ['tuneRatio', 'ratio'],
  ],
  crash: [
    ['metal.hz', 'hz'], ['metal.ratio', 'ratio'], ['metal.amount', 'unit'],
    ['hp.hz', 'hz'], ['hp.q', 'q'], ['decayMs', 'ms'],
    ['driveDb', 'drive'], ['velTrack', 'unit'], ['rms', 'num'],
  ],
  ride: [
    ['metal.hz', 'hz'], ['metal.ratio', 'ratio'], ['metal.amount', 'unit'],
    ['ping.hz', 'hz'], ['ping.amount', 'unit'],
    ['hp.hz', 'hz'], ['hp.q', 'q'], ['decayMs', 'ms'],
    ['driveDb', 'drive'], ['velTrack', 'unit'], ['rms', 'num'],
  ],
}

function isNum(v) { return typeof v === 'number' && Number.isFinite(v) }
function get(obj, path) {
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length; i++) {
    if (cur == null) return undefined
    cur = cur[parts[i]]
  }
  return cur
}
function nearClean(value, tol) {
  return CLEAN_RATIOS.some((r) => Math.abs(value / r - 1) <= tol)
}

/* ── 1 · manifest ──────────────────────────────────────────────────────── */

describe('kit-reason manifest', () => {
  test('6 kits, ids match REASON_KITS keys, default kit sane', () => {
    expect(KIT_IDS.length).toBe(6)
    expect([...KIT_IDS].sort()).toEqual(Object.keys(REASON_KITS).sort())
    expect(DEFAULT_KIT).toBe('psy-classic')
    expect(REASON_KITS[DEFAULT_KIT]).toBeDefined()
  })
  test('every kit carries id/name/style/blurb/rootHz/choke/humanize', () => {
    for (const id of KIT_IDS) {
      const k = REASON_KITS[id]
      expect(k.id).toBe(id)
      expect(typeof k.name).toBe('string'); expect(k.name.length).toBeGreaterThan(0)
      expect(typeof k.style).toBe('string'); expect(k.style.length).toBeGreaterThan(0)
      expect(typeof k.blurb).toBe('string'); expect(k.blurb.length).toBeGreaterThan(10)
      expect(isNum(k.rootHz)).toBe(true)
      expect(k.rootHz).toBeGreaterThanOrEqual(30) /* bass register, E1-ish */
      expect(k.rootHz).toBeLessThanOrEqual(60)
      expect(k.humanize).toBe(true)
      expect(k.choke.hatExclusive).toBe(true)
      expect(k.choke.crashMaxPoly).toBeGreaterThanOrEqual(1)
      expect(k.choke.rideMaxPoly).toBeGreaterThanOrEqual(1)
    }
  })
  test('role vocabulary: 8 engine roles, 12 kit-governed rom roles', () => {
    expect([...ENGINE_ROLES]).toEqual(['kick', 'snare', 'clap', 'hatO', 'hatC', 'tom', 'crash', 'ride'])
    expect([...KIT_ROM_ROLES]).toEqual([
      'conga', 'bongo', 'darbuka', 'rim', 'shaker', 'tambourine',
      'triangle', 'cowbell', 'clave', 'agogo', 'timbale', 'revcym',
    ])
  })
})

/* ── 2 · completeness ──────────────────────────────────────────────────── */

describe('kit-reason completeness — 8 engine roles × 6 kits', () => {
  test('every role defines every required subfield, finite, in-range', () => {
    for (const id of KIT_IDS) {
      for (const role of ENGINE_ROLES) {
        const patch = REASON_KITS[id].engine[role]
        expect(patch).toBeDefined()
        for (const [path, kind] of ENGINE_FIELDS[role]) {
          const v = get(patch, path)
          if (kind === 'wave') {
            expect(v).toBe('sine')
            continue
          }
          if (kind === 'arrHz' || kind === 'arrMs') {
            expect(Array.isArray(v)).toBe(true)
            expect(v.length).toBe(3)
            const [lo, hi] = kind === 'arrHz' ? BOUNDS.hz : BOUNDS.ms
            for (const x of v) { expect(isNum(x)).toBe(true); expect(x).toBeGreaterThanOrEqual(lo); expect(x).toBeLessThanOrEqual(hi) }
            continue
          }
          expect(isNum(v)).toBe(true)
          if (BOUNDS[kind]) {
            const [lo, hi] = BOUNDS[kind]
            expect(v).toBeGreaterThanOrEqual(lo)
            expect(v).toBeLessThanOrEqual(hi)
          }
        }
      }
    }
  })
})

describe('kit-reason completeness — 12 rom roles × 6 kits', () => {
  test('every rom type is {f0mul, rms} with finite numbers', () => {
    for (const id of KIT_IDS) {
      const rom = REASON_KITS[id].rom
      for (const type of KIT_ROM_ROLES) {
        const spec = rom[type]
        expect(spec).toBeDefined()
        expect(isNum(spec.f0mul)).toBe(true)
        expect(spec.f0mul).toBeGreaterThan(0)
        expect(isNum(spec.rms)).toBe(true)
        expect(spec.rms).toBeGreaterThan(0)
      }
    }
  })
})

/* ── 3 · window law ────────────────────────────────────────────────────── */

describe('kit-reason window law — f0mul × rootHz', () => {
  test('every pitched type lands inside its window', () => {
    for (const id of KIT_IDS) {
      const root = REASON_KITS[id].rootHz
      for (const type of Object.keys(F0_WINDOWS)) {
        const f0 = REASON_KITS[id].rom[type].f0mul * root
        const [lo, hi] = F0_WINDOWS[type]
        expect(f0).toBeGreaterThanOrEqual(lo)
        expect(f0).toBeLessThanOrEqual(hi)
      }
    }
  })
  test('non-pitched types carry f0mul = 1', () => {
    for (const id of KIT_IDS) {
      for (const type of NON_PITCHED) {
        expect(REASON_KITS[id].rom[type].f0mul).toBe(1)
      }
    }
  })
})

/* ── 4 · loudness law ──────────────────────────────────────────────────── */

describe('kit-reason loudness law — family rms bands', () => {
  test('every engine role rms sits inside its band', () => {
    for (const id of KIT_IDS) {
      for (const role of ENGINE_ROLES) {
        const rms = REASON_KITS[id].engine[role].rms
        const [lo, hi] = RMS_BANDS[role]
        expect(rms).toBeGreaterThanOrEqual(lo)
        expect(rms).toBeLessThanOrEqual(hi)
      }
    }
  })
  test('every rom type rms sits inside its band', () => {
    for (const id of KIT_IDS) {
      for (const type of KIT_ROM_ROLES) {
        const rms = REASON_KITS[id].rom[type].rms
        const [lo, hi] = RMS_BANDS[type]
        expect(rms).toBeGreaterThanOrEqual(lo)
        expect(rms).toBeLessThanOrEqual(hi)
      }
    }
  })
})

/* ── 5 · consonance — the "connection" the owner demands ───────────────── */

describe('kit-reason consonance — just ratios of the kit root', () => {
  test('conga f0mul ≈ a musical ratio of the root (2 / 2.52 / 3 / 4, ±4%)', () => {
    for (const id of KIT_IDS) {
      const m = REASON_KITS[id].rom.conga.f0mul
      const hit = [2, 2.52, 3, 4].some((r) => Math.abs(m / r - 1) <= 0.04)
      expect(hit).toBe(true)
    }
  })
  test('tom tuneRatio ≈ the root (1 / 1.5 / 2, ±4%)', () => {
    for (const id of KIT_IDS) {
      const r = REASON_KITS[id].engine.tom.tuneRatio
      const hit = [1, 1.5, 2].some((c) => Math.abs(r / c - 1) <= 0.04)
      expect(hit).toBe(true)
    }
  })
  test('every pitched rom f0mul is a member of the clean just-ratio set (±4%)', () => {
    for (const id of KIT_IDS) {
      for (const type of Object.keys(F0_WINDOWS)) {
        const m = REASON_KITS[id].rom[type].f0mul
        expect(nearClean(m, 0.04)).toBe(true)
      }
    }
  })
  test('within a kit, conga/tom stack cleanly (conga f0mul ÷ tom tuneRatio)', () => {
    for (const id of KIT_IDS) {
      const ratio = REASON_KITS[id].rom.conga.f0mul / REASON_KITS[id].engine.tom.tuneRatio
      expect(nearClean(ratio, 0.04)).toBe(true)
    }
  })
})

/* ── 6 · ports from psyreason kit-builtin.ts (verbatim-extended) ───────── */

describe('kit-reason ports — kits 1–3 match kit-builtin.ts', () => {
  test('kick body.startHz ported: 168 / 150 / 175', () => {
    expect(REASON_KITS['psy-classic'].engine.kick.body.startHz).toBe(168)
    expect(REASON_KITS['dark-forest'].engine.kick.body.startHz).toBe(150)
    expect(REASON_KITS['progressive'].engine.kick.body.startHz).toBe(175)
  })
  test('kick driveDb ported: 3.5 / 5.0 / 1.5', () => {
    expect(REASON_KITS['psy-classic'].engine.kick.driveDb).toBe(3.5)
    expect(REASON_KITS['dark-forest'].engine.kick.driveDb).toBe(5.0)
    expect(REASON_KITS['progressive'].engine.kick.driveDb).toBe(1.5)
  })
  test('hatC hp.hz ← their noise.bpHz: 7600 / 8200 / 7200', () => {
    expect(REASON_KITS['psy-classic'].engine.hatC.hp.hz).toBe(7600)
    expect(REASON_KITS['dark-forest'].engine.hatC.hp.hz).toBe(8200)
    expect(REASON_KITS['progressive'].engine.hatC.hp.hz).toBe(7200)
  })
  test('tom body ported: startHz 218/190/235, endHz 118/95/130, tuneRatio 1', () => {
    const kits = ['psy-classic', 'dark-forest', 'progressive']
    const starts = [218, 190, 235], ends = [118, 95, 130]
    kits.forEach((id, i) => {
      const tom = REASON_KITS[id].engine.tom
      expect(tom.body.startHz).toBe(starts[i])
      expect(tom.body.endHz).toBe(ends[i])
      expect(tom.tuneRatio).toBe(1)
    })
  })
  test('extended fidelity: kick bodyDecayMs, snare body, hatO hp.hz, clap taps, choke', () => {
    expect(REASON_KITS['psy-classic'].engine.kick.body.bodyDecayMs).toBe(218)   /* their amp.decayMs */
    expect(REASON_KITS['dark-forest'].engine.kick.body.bodyDecayMs).toBe(260)
    expect(REASON_KITS['progressive'].engine.kick.body.bodyDecayMs).toBe(190)
    expect(REASON_KITS['psy-classic'].engine.snare.body.startHz).toBe(196)
    expect(REASON_KITS['dark-forest'].engine.snare.body.startHz).toBe(170)
    expect(REASON_KITS['progressive'].engine.snare.body.startHz).toBe(210)
    expect(REASON_KITS['psy-classic'].engine.hatO.hp.hz).toBe(6400)
    expect(REASON_KITS['dark-forest'].engine.hatO.hp.hz).toBe(7000)
    expect(REASON_KITS['progressive'].engine.hatO.hp.hz).toBe(6100)
    expect(REASON_KITS['psy-classic'].engine.clap.taps[0]).toBe(1150)
    expect(REASON_KITS['dark-forest'].engine.clap.taps[0]).toBe(950)
    expect(REASON_KITS['progressive'].engine.clap.taps[0]).toBe(1300)
    for (const id of ['psy-classic', 'dark-forest', 'progressive']) {
      const c = REASON_KITS[id].choke
      expect(c.hatExclusive).toBe(true)
      expect(c.crashMaxPoly).toBe(2)
      expect(c.rideMaxPoly).toBe(2)
    }
  })
})

/* ── 7 · STYLE_KIT covers exactly data/styles.json ─────────────────────── */

describe('kit-reason STYLE_KIT — the 5 styles from data/styles.json', () => {
  const stylesJson = JSON.parse(readFileSync(join(ROOT, 'data/styles.json'), 'utf8'))
  const names = stylesJson.styles.map((s) => s.name)
  test('every style name from styles.json has a kit mapping', () => {
    expect(names.length).toBe(5)
    for (const name of names) {
      expect(typeof STYLE_KIT[name]).toBe('string')
      expect(KIT_IDS).toContain(STYLE_KIT[name])
    }
  })
  test('STYLE_KIT has exactly the 5 styles — no extras, no gaps', () => {
    expect(Object.keys(STYLE_KIT).sort()).toEqual([...names].sort())
  })
  test('each mapped kit declares its style back', () => {
    for (const name of names) {
      expect(REASON_KITS[STYLE_KIT[name]].style).toBe(name)
    }
  })
})

/* ── 8 · accessors + warm loop ─────────────────────────────────────────── */

describe('kit-reason accessors — null-safe, warm loop, frozen contract', () => {
  test('kitPatch: valid role → patch, rom type / bad kit / bad role → null', () => {
    expect(kitPatch('psy-classic', 'kick')).toBe(REASON_KITS['psy-classic'].engine.kick)
    expect(kitPatch('tribal-raw', 'ride')).toBe(REASON_KITS['tribal-raw'].engine.ride)
    expect(kitPatch('psy-classic', 'conga')).toBe(null)  /* rom type, not an engine role */
    expect(kitPatch('no-such-kit', 'kick')).toBe(null)
    expect(kitPatch('psy-classic', 'nope')).toBe(null)
  })
  test('kitRomSpec: valid type → fresh {f0mul,rms}, engine role / bad kit → null', () => {
    const spec = kitRomSpec('dark-forest', 'darbuka')
    expect(spec).toEqual({ f0mul: 3, rms: 0.095 })
    spec.f0mul = 999 /* a copy — the live data must not move */
    expect(REASON_KITS['dark-forest'].rom.darbuka.f0mul).toBe(3)
    expect(kitRomSpec('dark-forest', 'kick')).toBe(null)
    expect(kitRomSpec('no-such-kit', 'conga')).toBe(null)
  })
  test('kitRootHz / kitChoke / kitMeta', () => {
    expect(kitRootHz('psy-classic')).toBe(41.2)
    expect(kitRootHz('no-such-kit')).toBe(0)
    expect(kitChoke('hi-tech')).toEqual({ hatExclusive: true, crashMaxPoly: 2, rideMaxPoly: 2 })
    expect(kitChoke('no-such-kit')).toBe(null)
    const meta = kitMeta('forest-organic')
    expect(meta).toEqual({
      id: 'forest-organic', name: 'Forest Organic', style: 'forest',
      blurb: REASON_KITS['forest-organic'].blurb,
    })
    expect(kitMeta('no-such-kit')).toBe(null)
  })
  test('isReasonEngineType / isKitRomType split the psy5 type vocabulary', () => {
    expect(isReasonEngineType('kick')).toBe(true)
    expect(isReasonEngineType('hatC')).toBe(true)
    expect(isReasonEngineType('conga')).toBe(false)
    expect(isReasonEngineType('glitch')).toBe(false)
    expect(isKitRomType('conga')).toBe(true)
    expect(isKitRomType('revcym')).toBe(true)
    expect(isKitRomType('kick')).toBe(false)
    /* disjoint families */
    for (const t of ENGINE_ROLES) expect(isKitRomType(t)).toBe(false)
    for (const t of KIT_ROM_ROLES) expect(isReasonEngineType(t)).toBe(false)
  })
  test('kitWarmTypes: 20 types, pinned order, includes kick + conga', () => {
    const warm = kitWarmTypes('psy-classic')
    expect(warm.length).toBe(20)
    expect(warm[0]).toBe('kick')
    expect(warm).toContain('kick')
    expect(warm).toContain('conga')
    /* the warm loop slices: engine core first (hatC BEFORE hatO), then
       ride, then the ROM family in KIT_ROM_ROLES order */
    expect(warm.slice(0, 7)).toEqual(['kick', 'snare', 'clap', 'hatC', 'hatO', 'tom', 'crash'])
    expect(warm[7]).toBe('ride')
    expect(warm.slice(8)).toEqual([...KIT_ROM_ROLES])
    /* every entry is a real psy5 type in exactly one family */
    for (const t of warm) expect(isReasonEngineType(t) || isKitRomType(t)).toBe(true)
    expect(kitWarmTypes('no-such-kit')).toEqual([])
  })
  test('the whole library is deep-frozen (a frozen contract)', () => {
    expect(Object.isFrozen(REASON_KITS)).toBe(true)
    expect(Object.isFrozen(REASON_KITS['psy-classic'].engine)).toBe(true)
    expect(Object.isFrozen(REASON_KITS['tribal-raw'].rom.conga)).toBe(true)
    expect(Object.isFrozen(KIT_IDS)).toBe(true)
    expect(Object.isFrozen(STYLE_KIT)).toBe(true)
  })
})
