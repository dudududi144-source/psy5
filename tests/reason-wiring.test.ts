/**
 * v0.24.0 — REASON WIRING: the kit-governed reason system in js/engine.js
 *
 * Phase 2 of Run 23 ("PSYREASON PORT"): every kit-coherent drum hit plays
 * through the kit system by default — the 8 REASON_TYPES via
 * renderReasonPcm(kitPatch(kit,type)), the 12 KIT_ROM_ROLES via
 * renderRomPcm under kitRomSpec leveling + kit-root tuning, the 6 legacy
 * synth/FX types unchanged.
 *
 * HONEST HARNESS NOTE (the repo's bun reality): no test constructs a
 * PooledEngine — there is no WebAudio in bun and the repo's engine tests
 * pin `PooledEngine.prototype` pure methods + source strings (see
 * tests/drum-v15.test.ts, tests/perc-rom.test.ts). This file follows that
 * harness: pure prototype methods (rootMul/rmsRatio/romBuffer/warmRom/
 * drumDurEst) run against a minimal fake `this` (the SAME pattern the
 * browser gates use with real contexts), full-project decisions run through
 * the exported loadProjectObj, and structural invariants are pinned as
 * source strings. The ACOUSTIC evidence lives in tools/rom-audit.mjs
 * (48 kit×type renders) and the in-page gates (G11 sidechain-on-ROM-path,
 * G48/G49 recalibrated, NEW G52 reason-path liveness + choke + kit A/B).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PooledEngine } from '../js/engine.js'
import { loadProjectObj } from '../js/state.js'
import {
  KIT_IDS, DEFAULT_KIT, ENGINE_ROLES, KIT_ROM_ROLES,
  kitPatch, kitRomSpec, kitRootHz, kitChoke, kitWarmTypes,
  isReasonEngineType, isKitRomType,
} from '../foundation/dsp/kit-reason.mjs'
import { REASON_TYPES } from '../foundation/dsp/reason-engines.mjs'
import { ROM_TYPES, romSpec } from '../foundation/dsp/perc-rom.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENGINE_SRC = readFileSync(join(ROOT, 'js/engine.js'), 'utf8')
const MAIN_SRC = readFileSync(join(ROOT, 'js/main.js'), 'utf8')
const STATE_SRC = readFileSync(join(ROOT, 'js/state.js'), 'utf8')
const SOUND_SRC = readFileSync(join(ROOT, 'js/ui/sound.js'), 'utf8')
const COMPOSE_SRC = readFileSync(join(ROOT, 'js/ui/compose.js'), 'utf8')
const SW_SRC = readFileSync(join(ROOT, 'sw.js'), 'utf8')

/* ── the fake engine `this` for prototype methods — the same fields the
   constructor initializes, no WebAudio anywhere. createBuffer mimics the
   one method romBuffer touches. ── */
const fakeEng = (kitId: string = DEFAULT_KIT, rootHz = 0, sr = 48000) => ({
  kitId, rootHz, _rrType: new Map<string, number>(), romCache: new Map<string, any>(),
  reasonRenders: 0, romRenders: 0, reasonFallbacks: 0, romFallbacks: 0,
  rootMul: PooledEngine.prototype.rootMul, rmsRatio: PooledEngine.prototype.rmsRatio,
  ctx: { sampleRate: sr, createBuffer: (ch: number, len: number, s: number) => ({ length: len, sampleRate: s, duration: len / s, copyToChannel: () => {} }) },
})
const romBuffer = PooledEngine.prototype.romBuffer as (this: any, t: string) => any

/* every psy5 drum type vocabulary — the Sound-tab TYPE list + the engine's
   extra voices (crash/ride/revcym/agogo/timbale have engine branches and
   presets but predate the editor list) */
const ALL_TYPES = [
  'kick', 'snare', 'clap', 'hatC', 'hatO', 'tom', 'rim', 'conga', 'bongo', 'cowbell', 'clave',
  'zap', 'boom', 'glitch', 'shaker', 'riser', 'impact', 'darbuka', 'tambourine', 'triangle', 'downlifter',
  'crash', 'ride', 'revcym', 'agogo', 'timbale',
]
const LEGACY_TYPES = ['zap', 'boom', 'glitch', 'riser', 'impact', 'downlifter']

describe('kit patch resolution (the data the engine renders through)', () => {
  test('kitPatch: all 8 engine roles x 6 kits return objects with finite rms > 0', () => {
    for (const kit of KIT_IDS) for (const role of ENGINE_ROLES) {
      const p = kitPatch(kit, role)
      expect(p).toBeTruthy()
      expect(typeof p!.rms).toBe('number')
      expect(Number.isFinite(p!.rms)).toBe(true)
      expect(p!.rms).toBeGreaterThan(0)
    }
  })
  test('kitRomSpec: all 12 rom roles x 6 kits return {f0mul, rms>0}', () => {
    for (const kit of KIT_IDS) for (const t of KIT_ROM_ROLES) {
      const s = kitRomSpec(kit, t)
      expect(s).toBeTruthy()
      expect(Number.isFinite(s!.f0mul)).toBe(true)
      expect(s!.rms).toBeGreaterThan(0)
    }
  })
  test('romSpec (perc-rom base table) covers all 12 kit rom roles — the rmsRatio denominator exists', () => {
    for (const t of KIT_ROM_ROLES) {
      const base = romSpec(t)
      expect(base).toBeTruthy()
      expect(base!.rms).toBeGreaterThan(0)
    }
  })
})

describe('rootMul math (the kit-root transposer)', () => {
  const rootMul = PooledEngine.prototype.rootMul as (this: any) => number
  test('rootHz 0 = the kit\'s own root → exactly 1', () => {
    expect(rootMul.call({ rootHz: 0, kitId: 'psy-classic' })).toBe(1)
    expect(rootMul.call({ rootHz: 0, kitId: 'dark-forest' })).toBe(1)
  })
  test('+1 octave (2x kit root) → 2; −1 octave (0.5x) → 0.5', () => {
    const r = kitRootHz('psy-classic')
    expect(rootMul.call({ rootHz: 2 * r, kitId: 'psy-classic' })).toBeCloseTo(2, 12)
    expect(rootMul.call({ rootHz: 0.5 * r, kitId: 'psy-classic' })).toBeCloseTo(0.5, 12)
  })
  test('beyond ±1 octave clamps to [.5, 2]', () => {
    const r = kitRootHz('psy-classic')
    expect(rootMul.call({ rootHz: 4 * r, kitId: 'psy-classic' })).toBe(2)
    expect(rootMul.call({ rootHz: 0.25 * r, kitId: 'psy-classic' })).toBe(0.5)
    expect(rootMul.call({ rootHz: 400, kitId: 'psy-classic' })).toBeLessThanOrEqual(2)
  })
  test('setRootHz accepts the musical window (20..500 Hz), 0/invalid = kit root', () => {
    const setRootHz = PooledEngine.prototype.setRootHz as (this: any, hz: number) => void
    const e: any = { rootHz: 7 }
    setRootHz.call(e, 55); expect(e.rootHz).toBe(55)
    setRootHz.call(e, 19); expect(e.rootHz).toBe(0)
    setRootHz.call(e, 501); expect(e.rootHz).toBe(0)
    setRootHz.call(e, 0); expect(e.rootHz).toBe(0)
  })
})

describe('routing classification — the FULL table (a future type cannot silently fall out of kit governance)', () => {
  test('every psy5 drum type is exactly one of {REASON_TYPES, KIT_ROM_ROLES, legacy-synth/FX}', () => {
    const classification: Record<string, string> = {}
    for (const t of ALL_TYPES) {
      const isRe = isReasonEngineType(t), isKr = isKitRomType(t)
      const legacy = LEGACY_TYPES.includes(t)
      expect(isRe && isKr).toBe(false) /* the two predicates are disjoint (RUN23-1b contract) */
      expect(isRe && legacy).toBe(false)
      expect(isKr && legacy).toBe(false)
      expect(isRe || isKr || legacy).toBe(true) /* nothing falls through */
      classification[t] = isRe ? 'reason' : isKr ? 'kitrom' : 'legacy'
    }
    /* pin the exact table */
    expect(Object.fromEntries(Object.entries(classification).filter(([, v]) => v === 'reason'))).toEqual({
      kick: 'reason', snare: 'reason', clap: 'reason', hatO: 'reason', hatC: 'reason', tom: 'reason', crash: 'reason', ride: 'reason',
    })
    expect(Object.fromEntries(Object.entries(classification).filter(([, v]) => v === 'kitrom'))).toEqual({
      conga: 'kitrom', bongo: 'kitrom', darbuka: 'kitrom', rim: 'kitrom', shaker: 'kitrom', tambourine: 'kitrom',
      triangle: 'kitrom', cowbell: 'kitrom', clave: 'kitrom', agogo: 'kitrom', timbale: 'kitrom', revcym: 'kitrom',
    })
    expect(Object.fromEntries(Object.entries(classification).filter(([, v]) => v === 'legacy'))).toEqual({
      zap: 'legacy', boom: 'legacy', glitch: 'legacy', riser: 'legacy', impact: 'legacy', downlifter: 'legacy',
    })
  })
  test('romBuffer returns a buffer for REASON_TYPES (R: keys) and KIT_ROM_ROLES (K: keys), null for legacy', () => {
    for (const t of REASON_TYPES) {
      const e = fakeEng()
      const ab = romBuffer.call(e, t)
      expect(ab).toBeTruthy()
      expect(ab.length).toBeGreaterThan(0)
      expect(e.romCache.has('R:' + t + ':' + DEFAULT_KIT + ':0:2@48000')).toBe(true)
      expect(e.reasonRenders).toBe(1)
    }
    for (const t of KIT_ROM_ROLES) {
      const e = fakeEng()
      const ab = romBuffer.call(e, t)
      expect(ab).toBeTruthy()
      expect(e.romCache.has('K:' + t + ':' + DEFAULT_KIT + ':0:100@48000')).toBe(true)
      expect(e.romRenders).toBe(1)
    }
    for (const t of LEGACY_TYPES) {
      const e = fakeEng()
      expect(romBuffer.call(e, t)).toBe(null)
      expect(e.reasonRenders).toBe(0); expect(e.romRenders).toBe(0)
    }
  })
  test('romBuffer caches: per-engine hit → no re-render; fresh engine reuses the module-shared render', () => {
    const e = fakeEng()
    romBuffer.call(e, 'kick') /* renders OR hits the shared cache from an earlier test — both fill romCache */
    expect(e.romCache.has('R:kick:' + DEFAULT_KIT + ':0:2@48000')).toBe(true)
    const renders1 = e.reasonRenders
    romBuffer.call(e, 'kick')
    expect(e.reasonRenders).toBe(renders1) /* per-engine cache: certainly no re-render */
    /* conga with a fresh variant (unique cache key) → exactly one render, second call cached */
    e._rrType.set('conga', 1)
    romBuffer.call(e, 'conga'); romBuffer.call(e, 'conga')
    expect(e.romRenders).toBe(1)
    expect(e.romCache.has('K:conga:' + DEFAULT_KIT + ':1:100@48000')).toBe(true)
    /* a second engine reuses the shared render (AudioBuffers are context-independent) */
    const e2 = fakeEng()
    romBuffer.call(e2, 'kick')
    expect(e2.reasonRenders).toBe(0)
  })
  test('kit governance is audible in the KEY: the same type renders per-kit cache keys', () => {
    for (const kit of KIT_IDS) {
      const e = fakeEng(kit)
      expect(romBuffer.call(e, 'kick')).toBeTruthy()
      expect(e.romCache.has('R:kick:' + kit + ':0:2@48000')).toBe(true)
    }
  })
  test('setKit refuses unknown kits (the engine never lies about what is playing)', () => {
    const setKit = PooledEngine.prototype.setKit as (this: any, id: string) => boolean
    const e: any = { kitId: DEFAULT_KIT }
    expect(setKit.call(e, 'dark-forest')).toBe(true)
    expect(e.kitId).toBe('dark-forest')
    expect(setKit.call(e, 'no-such-kit')).toBe(false)
    expect(e.kitId).toBe('dark-forest')
    for (const k of KIT_IDS) expect(setKit.call({ kitId: '' } as any, k)).toBe(true)
  })
})

describe('triggerRom semantics (pinned structurally — voice spawning needs a live ctx)', () => {
  test('round-robin advances on SUCCESS only (per-type 2-variant)', () => {
    expect(ENGINE_SRC).toContain('this._rrType.set(type,((this._rrType.get(type)||0)+1)%2)')
    expect(ENGINE_SRC).toContain('this._rrType=new Map()')
  })
  test('voice registry: lastType/lastTrack recorded, amp anchors the choke ramp', () => {
    expect(ENGINE_SRC).toContain("v.lastType=type;v.lastTrack=tr.idx;v.amp=Math.max(amp,.001)")
    expect(ENGINE_SRC).toContain("this.lastType='';this.lastTrack=-1")
  })
  test('CHOKE: hatC+hatExclusive closes busy hatO voices (25ms), crash/ride maxPoly fades the OLDEST (60ms)', () => {
    expect(ENGINE_SRC).toContain("if(type==='hatC'&&ck.hatExclusive)")
    expect(ENGINE_SRC).toContain('og.exponentialRampToValueAtTime(.0001,when+.025)')
    expect(ENGINE_SRC).toContain("const mx=type==='crash'?ck.crashMaxPoly:ck.rideMaxPoly")
    expect(ENGINE_SRC).toContain('og.exponentialRampToValueAtTime(.0001,when+.06)')
    expect(ENGINE_SRC).toContain('if(old===null||o.lastTrigger<old.lastTrigger)old=o')
  })
  test('CRITICAL BUG GUARD: kick fires sidechain on the ROM early-return path', () => {
    expect(ENGINE_SRC).toContain("if(ty0==='kick')this.sidechain(when,tr.idx)")
    expect(ENGINE_SRC).toContain('v0.24.0 BUG GUARD')
  })
  test('honest counters: reason hits increment romSpawns AND reasonSpawns; fallbacks likewise both', () => {
    expect(ENGINE_SRC).toContain('this.romSpawns++;if(isReasonEngineType(type))this.reasonSpawns++')
    expect(ENGINE_SRC).toContain('if(isRe)this.reasonFallbacks++;this.romFallbacks++')
  })
  test('REASON_SHARED module cache exists beside ROM_SHARED (same context-independence law)', () => {
    expect(ENGINE_SRC).toContain('const REASON_SHARED=new Map()')
    expect(ENGINE_SRC).toContain('(isRe?REASON_SHARED:ROM_SHARED).set(key,ab)')
  })
  test('the ROM early-return routes the REASON union (a reason kick can never reach the old synth path)', () => {
    expect(ENGINE_SRC).toContain('if((REASON_TYPES.has(ty0)||ROM_TYPES.has(ty0))&&this.triggerRom(')
  })
  test('opts.rom===false = exact legacy path (both rom classes off)', () => {
    expect(ENGINE_SRC).toContain('this.romOn=opts.rom!==false')
  })
  test('warmRom accepts the union (REASON_TYPES ∪ ROM_TYPES ∪ KIT_ROM_ROLES)', () => {
    expect(ENGINE_SRC).toContain('if(!REASON_TYPES.has(t)&&!ROM_TYPES.has(t))continue')
  })
  test('loadSnapshot carries the additive honesty surface', () => {
    expect(ENGINE_SRC).toContain('romSpawns:this.romSpawns,romRenders:this.romRenders,romFallbacks:this.romFallbacks,romSteals:this.romSteals,romOn:this.romOn')
    expect(ENGINE_SRC).toContain('reasonSpawns:this.reasonSpawns,reasonRenders:this.reasonRenders,reasonFallbacks:this.reasonFallbacks,kitId:this.kitId')
  })
})

describe('warm list (the boot warm loop)', () => {
  test('kitWarmTypes: length 20, kick first, contains crash + conga', () => {
    const list = kitWarmTypes(DEFAULT_KIT)
    expect(list.length).toBe(20)
    expect(list[0]).toBe('kick')
    expect(list).toContain('crash')
    expect(list).toContain('conga')
  })
  test('every warm member passes the union routing test (nothing unrenderable)', () => {
    for (const t of kitWarmTypes('tribal-raw')) {
      expect(isReasonEngineType(t) || isKitRomType(t) || ROM_TYPES.has(t)).toBe(true)
    }
  })
  test('main.js warms the PROJECT\'s kit at power-on, idle-sliced, from kitWarmTypes', () => {
    expect(MAIN_SRC).toContain('kitWarmTypes((I.p&&I.p.kit)||DEFAULT_KIT)')
    expect(MAIN_SRC).toContain('requestIdleCallback||(cb=>setTimeout(cb,16))')
  })
})

describe('state round-trip (kit + kitPinned persist through the load path)', () => {
  const clone = (o: any) => JSON.parse(JSON.stringify(o))
  const mkProject = (kit: any, pinned: any) => {
    const p: any = {
      version: 3, seed: 'PSY6', bpm: 145, root: 41, style: 'FULL-ON', groove: 'straight',
      patterns: {}, currentPattern: 'A', scenes: [], lanes: [], tracks: [],
    }
    for (let i = 0; i < 8; i++) p.tracks.push({ idx: i, kind: i < 4 ? 'drum' : 'synth', type: i < 4 ? 'kick' : 'lead', presetId: 'x' + i, name: 't' + i, sound: { type: 'kick', tune: 1 }, mix: { vol: .8, pan: 0, mute: false, solo: false, sendA: 0, sendB: 0 } })
    if (kit !== undefined) p.kit = kit
    if (pinned !== undefined) p.kitPinned = pinned
    return p
  }
  test('valid kit + pin survive loadProjectObj byte-stably (double load idempotent)', () => {
    const loaded = loadProjectObj(clone(mkProject('dark-forest', true)))
    expect(loaded.kit).toBe('dark-forest')
    expect(loaded.kitPinned).toBe(true)
    const again = loadProjectObj(clone(loaded))
    expect(again.kit).toBe('dark-forest')
    expect(again.kitPinned).toBe(true)
  })
  test('absent kit → DEFAULT_KIT + unpinned (tolerant legacy defaults)', () => {
    const loaded = loadProjectObj(clone(mkProject(undefined, undefined)))
    expect(loaded.kit).toBe(DEFAULT_KIT)
    expect(loaded.kitPinned).toBe(false)
  })
  test('INVALID kit id falls back to the default (the engine refuses unknown kits)', () => {
    const loaded = loadProjectObj(clone(mkProject('no-such-kit', false)))
    expect(loaded.kit).toBe(DEFAULT_KIT)
  })
  test('loadProjectObj is the ONE kit-apply point (I.eng.setKit called when an engine exists)', () => {
    expect(STATE_SRC).toContain("if(p.kit==null||!kitPatch(p.kit,'kick'))p.kit=DEFAULT_KIT")
    expect(STATE_SRC).toContain('if(I.eng&&I.eng.setKit)I.eng.setKit(p.kit)')
  })
})

describe('choke config (kitChoke: hat exclusivity + cymbal polyphony for every kit)', () => {
  test('hatExclusive===true and crash/ride maxPoly 2 for all 6 kits', () => {
    for (const kit of KIT_IDS) {
      const ck = kitChoke(kit)
      expect(ck).toBeTruthy()
      expect(ck!.hatExclusive).toBe(true)
      expect(ck!.crashMaxPoly).toBe(2)
      expect(ck!.rideMaxPoly).toBe(2)
    }
  })
  test('kitRootHz positive for all kits (rootMul divides safely); unknown kit → 0', () => {
    for (const k of KIT_IDS) expect(kitRootHz(k)).toBeGreaterThan(20)
    expect(kitRootHz('nope')).toBe(0)
  })
})

describe('UI + composer hooks (the wiring is reachable, not just available)', () => {
  test('Sound tab KIT selector: auto (follow style) + KIT_IDS, sets pin, saves snapshot', () => {
    expect(SOUND_SRC).toContain("'<option value=\"auto\">KIT auto (follow style)</option>'")
    expect(SOUND_SRC).toContain('p.kitPinned=false;p.kit=STYLE_KIT[String(p.style||\'\').toLowerCase()]||DEFAULT_KIT')
    expect(SOUND_SRC).toContain('p.kitPinned=true;p.kit=s.value')
    expect(SOUND_SRC).toContain('I.eng.setKit(p.kit);warmKit(p.kit)')
    expect(SOUND_SRC).toContain('saveProject()')
    expect(SOUND_SRC).toContain('aria-label')
  })
  test('composer style hook in BOTH compose paths (header modal + power screen) + composeBoot', () => {
    expect(COMPOSE_SRC.split('STYLE_KIT[String(styleId).toLowerCase()]').length).toBe(3) /* both compose paths */
    expect(COMPOSE_SRC.split('r.project.kitPinned = true').length).toBe(3)
    expect(MAIN_SRC.replace(/\s/g, '')).toContain('STYLE_KIT[String(style).toLowerCase()]||DEFAULT_KIT')
  })
  test('syncKitSel mirrors state on every renderAll', () => {
    expect(MAIN_SRC).toContain('syncKitSel();')
  })
})

describe('release pins', () => {
  test('sw.js CACHE_VERSION bumped to psy6-v0.24.0', () => {
    expect(SW_SRC).toContain("const CACHE_VERSION = 'psy6-v0.24.0'")
  })
  test('drumDurEst windows UNTOUCHED (pool discipline moved zero)', () => {
    const durEst = PooledEngine.prototype.drumDurEst
    expect(durEst('kick', 1)).toBeCloseTo(0.62, 12)
    expect(durEst('tom', 1)).toBeCloseTo(0.57, 12)
    expect(durEst('conga', 1)).toBeCloseTo(0.4, 12)
    expect(durEst('crash', 1)).toBeCloseTo(3.0, 12)
  })
})
