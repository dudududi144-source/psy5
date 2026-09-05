/**
 * v0.30.0 — PSY4 WIRING: the FOUNDATION RESET kit system in js/engine.js
 *
 * The successor of reason-wiring.test.ts (v0.24.0 kit-governed REASON/ROM
 * system — deleted with foundation/dsp/{kit-reason,perc-rom,
 * reason-engines}.mjs). Every drum/FX hit now renders through the psy4 kit
 * adapter js/psy4kit.mjs: renderPsy4Pcm over the foundation/psy4 voice
 * classes, 6 kits × 10 types, PSY4_SHARED module cache, per-kit root law.
 *
 * HONEST HARNESS NOTE (the repo's bun reality): no test constructs a
 * PooledEngine — there is no WebAudio in bun and the repo's engine tests
 * pin `PooledEngine.prototype` pure methods + source strings (see
 * tests/drum-v14.test.ts). This file follows that harness: pure prototype
 * methods (rootMul/romBuffer/warmRom/drumDurEst) run against a minimal
 * fake `this` (the SAME pattern the browser gates use with real contexts),
 * full-project decisions run through the exported loadProjectObj, and
 * structural invariants are pinned as source strings. The ACOUSTIC evidence
 * lives in tests/psy4kit.test.ts (render laws) and the in-page gates
 * (G11 sidechain-on-ROM-path, G48/G49/G52/G53 recalibrated to psy4).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PooledEngine } from '../js/engine.js'
import { loadProjectObj } from '../js/state.js'
import {
  PSY4_KIT_TYPES, KIT_IDS, DEFAULT_KIT,
  kitRootHzOf, kitWarmTypes, isPsy4KitId,
} from '../js/psy4kit.mjs'

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
  romRenders: 0, romFallbacks: 0,
  rootMul: PooledEngine.prototype.rootMul,
  ctx: { sampleRate: sr, createBuffer: (ch: number, len: number, s: number) => ({ length: len, sampleRate: s, duration: len / s, copyToChannel: () => {} }) },
})
const romBuffer = PooledEngine.prototype.romBuffer as (this: any, t: string) => any

/* the DEAD vocabulary — the membrane/metal junk family the FOUNDATION RESET
   deleted. The tests below refuse them: a resurrected type can never reach
   the render path (romBuffer → null), a cache key, or a durEst window. */
const DEAD_TYPES = [
  'tom', 'rim', 'conga', 'bongo', 'cowbell', 'clave', 'zap', 'boom', 'glitch',
  'darbuka', 'tambourine', 'triangle', 'crash', 'ride', 'revcym', 'agogo', 'timbale',
]

/* unique-variant allocator — the engine round-robins variants 0/1, so the
   fresh-render assertions use variants above that range to guarantee a
   PSY4_SHARED key no other test has populated. */
let VV = 10
const freshVariant = () => ++VV

describe('the psy4 kit vocabulary (the ONLY drum/FX types the engine knows)', () => {
  test('exactly 10 types: kick snare clap hatC hatO shaker riser impact texture downlifter', () => {
    expect(PSY4_KIT_TYPES.size).toBe(10)
    expect([...PSY4_KIT_TYPES].sort()).toEqual(['clap', 'downlifter', 'hatC', 'hatO', 'impact', 'kick', 'riser', 'shaker', 'snare', 'texture'])
  })
  test('6 kits, DEFAULT_KIT psy-classic (save-file compatible ids), all psy4 ids', () => {
    expect(KIT_IDS.length).toBe(6)
    expect(DEFAULT_KIT).toBe('psy-classic')
    for (const k of KIT_IDS) expect(isPsy4KitId(k)).toBe(true)
    expect(isPsy4KitId('no-such-kit')).toBe(false)
  })
  test('engine.js imports the psy4 kit adapter — the REASON/ROM stack is gone', () => {
    expect(ENGINE_SRC).toContain("from './psy4kit.mjs'")
    expect(ENGINE_SRC).toContain('renderPsy4Pcm')
    expect(ENGINE_SRC).not.toContain('kit-reason')
    expect(ENGINE_SRC).not.toContain('reason-engines')
    expect(ENGINE_SRC).not.toContain('perc-rom')
  })
})

describe('rootMul math (the kit-root transposer)', () => {
  const rootMul = PooledEngine.prototype.rootMul as (this: any) => number
  test('rootHz 0 = the kit\'s own root → exactly 1', () => {
    expect(rootMul.call({ rootHz: 0, kitId: 'psy-classic' })).toBe(1)
    expect(rootMul.call({ rootHz: 0, kitId: 'dark-forest' })).toBe(1)
  })
  test('+1 octave (2x kit root) → 2; −1 octave (0.5x) → 0.5', () => {
    const r = kitRootHzOf('psy-classic')
    expect(rootMul.call({ rootHz: 2 * r, kitId: 'psy-classic' })).toBeCloseTo(2, 12)
    expect(rootMul.call({ rootHz: 0.5 * r, kitId: 'psy-classic' })).toBeCloseTo(0.5, 12)
  })
  test('beyond ±1 octave clamps to [.5, 2]', () => {
    const r = kitRootHzOf('psy-classic')
    expect(rootMul.call({ rootHz: 4 * r, kitId: 'psy-classic' })).toBe(2)
    expect(rootMul.call({ rootHz: 0.25 * r, kitId: 'psy-classic' })).toBe(0.5)
    expect(rootMul.call({ rootHz: 400, kitId: 'psy-classic' })).toBeLessThanOrEqual(2)
  })
  test('kitRootHzOf: positive for all kits (rootMul divides safely), 0 for unknown', () => {
    for (const k of KIT_IDS) expect(kitRootHzOf(k)).toBeGreaterThan(20)
    expect(kitRootHzOf('nope')).toBe(0)
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
  test('romBuffer renders EVERY kit type (P4: cache keys), refuses the DEAD vocabulary', () => {
    for (const t of PSY4_KIT_TYPES) {
      const e = fakeEng()
      e._rrType.set(t, freshVariant())
      const ab = romBuffer.call(e, t)
      expect(ab).toBeTruthy()
      expect(ab.length).toBeGreaterThan(0)
      expect(e.romCache.has('P4:' + t + ':' + DEFAULT_KIT + ':' + VV + ':100@48000')).toBe(true)
      expect(e.romRenders).toBe(1)
      expect(e.romFallbacks).toBe(0)
    }
    for (const t of DEAD_TYPES) {
      const e = fakeEng()
      expect(romBuffer.call(e, t)).toBe(null)
      expect(e.romRenders).toBe(0); expect(e.romFallbacks).toBe(0) /* vocabulary refusal — not a counted fallback */
    }
  })
  test('romBuffer caches: per-engine hit → no re-render; fresh engine reuses the module-shared PSY4_SHARED render', () => {
    const v = freshVariant()
    const e = fakeEng()
    e._rrType.set('kick', v)
    romBuffer.call(e, 'kick')
    expect(e.romCache.has('P4:kick:' + DEFAULT_KIT + ':' + v + ':100@48000')).toBe(true)
    expect(e.romRenders).toBe(1)
    romBuffer.call(e, 'kick')
    expect(e.romRenders).toBe(1) /* per-engine cache: certainly no re-render */
    /* a second engine on the SAME key reuses the shared render (AudioBuffers are context-independent) */
    const e2 = fakeEng()
    e2._rrType.set('kick', v)
    romBuffer.call(e2, 'kick')
    expect(e2.romRenders).toBe(0)
  })
  test('kit governance is audible in the KEY: the same type renders per-kit cache keys', () => {
    for (const kit of KIT_IDS) {
      const e = fakeEng(kit)
      e._rrType.set('kick', freshVariant())
      expect(romBuffer.call(e, 'kick')).toBeTruthy()
      expect(e.romCache.has('P4:kick:' + kit + ':' + VV + ':100@48000')).toBe(true)
    }
  })
  test('the root law is audible in the KEY: rootMul is quantized into the key (±2 oct window)', () => {
    const r = kitRootHzOf('psy-classic')
    const e = fakeEng(DEFAULT_KIT, 2 * r)
    e._rrType.set('kick', freshVariant())
    expect(romBuffer.call(e, 'kick')).toBeTruthy()
    expect(e.romCache.has('P4:kick:' + DEFAULT_KIT + ':' + VV + ':200@48000')).toBe(true)
    const eHalf = fakeEng(DEFAULT_KIT, 0.5 * r)
    eHalf._rrType.set('kick', freshVariant())
    expect(romBuffer.call(eHalf, 'kick')).toBeTruthy()
    expect(eHalf.romCache.has('P4:kick:' + DEFAULT_KIT + ':' + VV + ':50@48000')).toBe(true)
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
  test('CHOKE — the FIXED psy4 kit law: hatC closes busy hatO voices (25ms exponential); the crash/ride poly choke died with the cymbal types', () => {
    expect(ENGINE_SRC).toContain("if(type==='hatC'){")
    expect(ENGINE_SRC).toContain("o.lastType!=='hatO'")
    expect(ENGINE_SRC).toContain('og.exponentialRampToValueAtTime(.0001,when+.025)')
    expect(ENGINE_SRC).not.toContain('crashMaxPoly')
    expect(ENGINE_SRC).not.toContain('hatExclusive')
  })
  test('CRITICAL BUG GUARD: kick fires sidechain on the ROM early-return path', () => {
    expect(ENGINE_SRC).toContain("if(ty0==='kick')this.sidechain(when,tr.idx)")
    expect(ENGINE_SRC).toContain('BUG GUARD (v0.24.0, kept)')
  })
  test('honest counters: kit hits increment romSpawns; render failures increment romFallbacks', () => {
    expect(ENGINE_SRC).toContain('this.romSpawns++;return true}')
    expect(ENGINE_SRC).toContain('this.romFallbacks++;return null')
  })
  test('PSY4_SHARED module cache exists (same context-independence law the ROM caches had)', () => {
    expect(ENGINE_SRC).toContain('const PSY4_SHARED=new Map()')
    expect(ENGINE_SRC).toContain('PSY4_SHARED.set(key,ab)')
  })
  test('the ROM early-return routes the PSY4_KIT_TYPES union (a kit kick can never reach the old synth path)', () => {
    expect(ENGINE_SRC).toContain('if(this.romOn&&tr.kind===\'drum\'){')
    expect(ENGINE_SRC).toContain('PSY4_KIT_TYPES.has(ty0)&&this.triggerRom(')
  })
  test('opts.rom===false = exact legacy path (the kit ROM off)', () => {
    expect(ENGINE_SRC).toContain('this.romOn=opts.rom!==false')
  })
  test('warmRom accepts exactly the kit union', () => {
    expect(ENGINE_SRC).toContain('if(!PSY4_KIT_TYPES.has(t))continue')
  })
  test('loadSnapshot carries the honesty surface (rom + kit id)', () => {
    expect(ENGINE_SRC).toContain('romSpawns:this.romSpawns,romRenders:this.romRenders,romFallbacks:this.romFallbacks,romSteals:this.romSteals,romOn:this.romOn,kitId:this.kitId')
  })
})

describe('warm list (the boot warm loop)', () => {
  test('kitWarmTypes: the 10 kit types, core first then FX, unknown kit → empty', () => {
    const list = kitWarmTypes(DEFAULT_KIT)
    expect(list).toEqual(['kick', 'snare', 'clap', 'hatC', 'hatO', 'shaker', 'riser', 'impact', 'texture', 'downlifter'])
    expect(kitWarmTypes('no-such-kit')).toEqual([])
    for (const t of kitWarmTypes('tribal-raw')) expect(PSY4_KIT_TYPES.has(t)).toBe(true)
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
  test('loadProjectObj is the ONE kit-apply point (psy4 id validation + I.eng.setKit when an engine exists)', () => {
    expect(STATE_SRC).toContain('if(p.kit==null||!isPsy4KitId(p.kit))p.kit=DEFAULT_KIT')
    expect(STATE_SRC).toContain('if(I.eng&&I.eng.setKit)I.eng.setKit(p.kit)')
  })
})

describe('UI + composer hooks (the wiring is reachable, not just available)', () => {
  test('Sound tab KIT selector: auto (follow style) + KIT_IDS, sets pin, saves snapshot', () => {
    expect(SOUND_SRC).toContain("'<option value=\"auto\">KIT auto (follow style)</option>'")
    expect(SOUND_SRC).toContain('p.kitPinned=false;p.kit=styleKit(p.style)') /* v0.26.0 canonical lookup (roast fix #4) */
    expect(SOUND_SRC).toContain('p.kitPinned=true;p.kit=s.value')
    expect(SOUND_SRC).toContain('I.eng.setKit(p.kit);warmKit(p.kit)')
    expect(SOUND_SRC).toContain('saveProject()')
    expect(SOUND_SRC).toContain('aria-label')
  })
  test('composer style hook in BOTH compose paths (header modal + power screen) + composeBoot', () => {
    expect(COMPOSE_SRC.split('styleKit(styleId)').length).toBe(3) /* both compose paths — v0.26.0 canonical lookup */
    expect(COMPOSE_SRC.split('r.project.kitPinned = true').length).toBe(3)
    expect(MAIN_SRC.replace(/\s/g, '')).toContain('r.project.kit=styleKit(style)') /* v0.26.0 canonical lookup */
  })
  test('syncKitSel mirrors state on every renderAll', () => {
    expect(MAIN_SRC).toContain('syncKitSel();')
  })
})

describe('release pins', () => {
  test('sw.js CACHE_VERSION bumped to psy6-v0.30.0', () => {
    expect(SW_SRC).toContain("const CACHE_VERSION = 'psy6-v0.30.0'")
  })
  test('drumDurEst — the NEW 10-type table (pool discipline: busyUntil windows derive from it)', () => {
    const durEst = PooledEngine.prototype.drumDurEst as (t: string, d?: number) => number
    /* exact windows at decay=1 */
    expect(durEst('kick', 1)).toBeCloseTo(0.62, 12)
    expect(durEst('snare', 1)).toBeCloseTo(0.26, 12)
    expect(durEst('clap', 1)).toBeCloseTo(0.4, 12)
    expect(durEst('hatO', 1)).toBeCloseTo(0.76, 12)
    expect(durEst('hatC', 1)).toBeCloseTo(0.08, 12)
    expect(durEst('shaker', 1)).toBeCloseTo(0.11, 12)
    expect(durEst('riser', 1)).toBeCloseTo(1.65, 12)
    expect(durEst('impact', 1)).toBeCloseTo(1.4, 12)
    expect(durEst('texture', 1)).toBeCloseTo(1.5, 12)
    expect(durEst('downlifter', 1)).toBeCloseTo(2, 12)
    /* decay laws */
    expect(durEst('kick', 2)).toBeCloseTo(1.12, 12)
    expect(durEst('downlifter', 0.5)).toBeCloseTo(1.45, 12)
    expect(durEst('impact', 0.5)).toBeCloseTo(0.85, 12)
  })
  test('DEAD types get NO window of their own — the default .5 law (vocabulary discipline)', () => {
    const durEst = PooledEngine.prototype.drumDurEst as (t: string, d?: number) => number
    for (const t of DEAD_TYPES) {
      expect(durEst(t, 1)).toBeCloseTo(0.5, 12)
      expect(durEst(t, 2)).toBeCloseTo(0.5, 12) /* the default ignores decay — a dead type can never smuggle a window back */
    }
  })
})
