/**
 * KICK DIMS (v0.29.0, PSY6) — psyreason re-review #2 port pins.
 *
 * psyreason dceec3e ("expressive kick synthesis") + 719211c ("kick preset
 * variety — seeded RNG per preset, wide decorrelated ranges") treat
 * PUNCH/BODY/SUBK/SAT as four INDEPENDENT kick synthesis dimensions.
 * psy5's runtime kick is the kit-governed REASON render; the patch was
 * per-KIT data with no preset-level authoring, so every kick preset inside
 * a kit rendered the same patch. The port lifts the dimensions:
 *
 *   1. BRIDGE LAW — foundation/dsp/kit-reason.mjs applyKickDims maps
 *      {body,subk,sat,punch} into a CLONE of the frozen kit patch:
 *      body → endHz down + pitch sweep longer · subk → bodyDecayMs (sub
 *      tail) longer · sat → driveDb ± around the kit value · punch →
 *      amount up / ratio down. rms is UNTOUCHED (the loudness governance
 *      normalizes every variant to the family level).
 *   2. NEUTRAL-CENTERED LAW — every factor is exactly 1.0 / ±0 dB when the
 *      dimension reads 0.5: {body:.5,subk:.5,sat:.5,punch:.5} reproduces
 *      the EXACT kit patch (bit-neutrality is asserted on-device by G53:
 *      neutral ≡ no-dims render md 0 through the full engine).
 *   3. FROZEN-SAFETY — REASON_KITS is deepFreeze data: applyKickDims never
 *      mutates it (null dims → the SAME object out; dims → a fresh clone).
 *   4. RENDER LAW — renderReasonPcm('kick', dimmed patch) obeys the family
 *      loudness law under dims (RMS ±15% of patch.rms, peak ≤ fround(.97))
 *      and stays byte-deterministic; extreme dim sets are AUDIBLY distinct
 *      (maxDiff > 1e-3).
 *   5. LIBRARY AUTO-DIMS — js/presets.js DP() seeds body/subk/sat per kick
 *      preset id (FNV-1a → mulberry32) over psyreason's wide decorrelated
 *      ranges (body .15–.85, subk .25–.85, sat .15–.85): every kick preset
 *      carries the three dims, ≥8 distinct triples across the library.
 *   6. SOURCE PINS — engine.js romBuffer carries the quantized dims cache
 *      signature ('d<body>_<subk>_<sat>_<punch>') and keeps the legacy
 *      ':2@' key when no dims; triggerRom computes the kick dims from the
 *      preset sound; the DrumVoice legacy kick reads the same dims
 *      neutral-centered; both warm loops pass the active kick preset.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { applyKickDims, kitPatch, KIT_IDS } from '../foundation/dsp/kit-reason.mjs'
import { renderReasonPcm } from '../foundation/dsp/reason-engines.mjs'
import { libFilter } from '../js/presets.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENGINE_SRC = readFileSync(join(ROOT, 'js/engine.js'), 'utf8')
const PRESETS_SRC = readFileSync(join(ROOT, 'js/presets.js'), 'utf8')
const MAIN_SRC = readFileSync(join(ROOT, 'js/main.js'), 'utf8')
const SOUND_SRC = readFileSync(join(ROOT, 'js/ui/sound.js'), 'utf8')
const TESTS_SRC = readFileSync(join(ROOT, 'js/ui/tests.js'), 'utf8')
const MANIFEST_SRC = readFileSync(join(ROOT, 'js/gates-manifest.js'), 'utf8')

const NEUTRAL = { body: 0.5, subk: 0.5, sat: 0.5, punch: 0.5 }
const LOW = { body: 0.15, subk: 0.4, sat: 0.25, punch: 0.2 }
const HIGH = { body: 0.85, subk: 0.85, sat: 0.85, punch: 0.95 }

const maxDiff = (a: Float32Array, b: Float32Array) => {
  let m = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) { const d = Math.abs(a[i] - b[i]); if (d > m) m = d }
  return m
}
const rmsOf = (x: Float32Array) => {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i] * x[i]
  return Math.sqrt(s / x.length)
}

describe('applyKickDims — the preset→patch bridge', () => {
  const base = kitPatch('psy-classic', 'kick')!

  test('null dims → the SAME object (zero-cost legacy path)', () => {
    expect(applyKickDims(base, null)).toBe(base)
    expect(applyKickDims(base, undefined)).toBe(base)
  })

  test('neutral {body:.5,subk:.5,sat:.5,punch:.5} reproduces the kit patch EXACTLY', () => {
    const out = applyKickDims(base, NEUTRAL)!
    expect(out.body!.endHz).toBe(base.body!.endHz)
    expect(out.body!.startHz).toBe(base.body!.startHz)
    expect(out.body!.pitchDecayMs).toBe(base.body!.pitchDecayMs)
    expect(out.body!.bodyDecayMs).toBe(base.body!.bodyDecayMs)
    expect(out.punch!.amount).toBe(base.punch!.amount)
    expect(out.punch!.ratio).toBe(base.punch!.ratio)
    expect(out.driveDb).toBe(base.driveDb)
    expect(out.rms).toBe(base.rms)
  })

  test('deep-frozen kit data is never mutated (clone law)', () => {
    const before = JSON.stringify(base)
    applyKickDims(base, HIGH)
    expect(JSON.stringify(base)).toBe(before)
    const out = applyKickDims(base, HIGH)!
    expect(out).not.toBe(base)
    expect(Object.isFrozen(base.body)).toBe(true)
  })

  test('body deepens the pitch drop monotonically', () => {
    const lo = applyKickDims(base, { body: 0.15 })!
    const hi = applyKickDims(base, { body: 0.85 })!
    expect(hi.body!.endHz!).toBeLessThan(base.body!.endHz!)
    expect(lo.body!.endHz!).toBeGreaterThan(base.body!.endHz!)
    expect(hi.body!.pitchDecayMs!).toBeGreaterThan(base.body!.pitchDecayMs!)
  })

  test('subk lengthens the sub tail monotonically', () => {
    const lo = applyKickDims(base, { subk: 0.25 })!
    const hi = applyKickDims(base, { subk: 0.85 })!
    expect(hi.body!.bodyDecayMs!).toBeGreaterThan(base.body!.bodyDecayMs!)
    expect(lo.body!.bodyDecayMs!).toBeLessThan(base.body!.bodyDecayMs!)
  })

  test('sat moves driveDb ± around the kit value; rms untouched', () => {
    const lo = applyKickDims(base, { sat: 0.15 })!
    const hi = applyKickDims(base, { sat: 0.85 })!
    expect(hi.driveDb!).toBeGreaterThan(base.driveDb!)
    expect(lo.driveDb!).toBeLessThan(base.driveDb!)
    expect(hi.rms).toBe(base.rms)
    expect(hi.driveDb!).toBeGreaterThanOrEqual(0)
  })

  test('works across every kit (all six kick patches stay sane)', () => {
    for (const kit of KIT_IDS) {
      const patch = kitPatch(kit, 'kick')
      if (!patch) continue
      for (const dims of [LOW, HIGH, NEUTRAL]) {
        const out = applyKickDims(patch, dims)!
        expect(out.body!.endHz!).toBeGreaterThanOrEqual(18)
        expect(out.body!.bodyDecayMs!).toBeGreaterThanOrEqual(40)
        expect(out.driveDb!).toBeGreaterThanOrEqual(0)
        expect(out.rms).toBe(patch.rms)
      }
    }
  })
})

describe('render law under dims (family loudness holds)', () => {
  const SR = 44100
  test('dimmed renders: RMS ±15% of patch.rms, peak ≤ fround(.97), deterministic', () => {
    for (const kit of ['psy-classic', 'dark-forest', 'tribal-raw']) {
      const base = kitPatch(kit, 'kick')!
      for (const dims of [LOW, HIGH]) {
        const pat = applyKickDims(base, dims)!
        const a = renderReasonPcm('kick', pat, SR, 0, 2)
        const b = renderReasonPcm('kick', pat, SR, 0, 2)
        expect(maxDiff(a, b)).toBe(0)
        const err = Math.abs(rmsOf(a) - pat.rms) / pat.rms
        expect(err).toBeLessThanOrEqual(0.15)
        let pk = 0
        for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i]); if (d > pk) pk = d }
        expect(pk).toBeLessThanOrEqual(Math.fround(0.97))
      }
    }
  })

  test('extreme dim sets are audibly distinct (md > 1e-3)', () => {
    const base = kitPatch('psy-classic', 'kick')!
    const a = renderReasonPcm('kick', applyKickDims(base, LOW)!, SR, 0, 2)
    const b = renderReasonPcm('kick', applyKickDims(base, HIGH)!, SR, 0, 2)
    expect(maxDiff(a, b)).toBeGreaterThan(1e-3)
  })
})

describe('library auto-dims (DP seeded per preset id)', () => {
  const kicks = libFilter('drum', 'ALL').filter((x: any) => x.type === 'kick')

  test('every kick preset carries body/subk/sat inside psyreason ranges', () => {
    expect(kicks.length).toBeGreaterThanOrEqual(30)
    for (const k of kicks as any[]) {
      for (const [f, lo, hi] of [['body', 0.15, 0.85], ['subk', 0.25, 0.85], ['sat', 0.15, 0.85]] as const) {
        expect(typeof k[f]).toBe('number')
        expect(k[f]).toBeGreaterThanOrEqual(lo)
        expect(k[f]).toBeLessThanOrEqual(hi)
      }
    }
  })

  test('dims are decorrelated — ≥8 distinct triples, no all-neutral preset', () => {
    const triples = new Set((kicks as any[]).map((k) => k.body + '_' + k.subk + '_' + k.sat))
    expect(triples.size).toBeGreaterThanOrEqual(8)
    for (const k of kicks as any[]) {
      const neutral = k.body === 0.5 && k.subk === 0.5 && k.sat === 0.5
      expect(neutral).toBe(false)
    }
  })

  test('non-kick drum types carry NO dims (the surface is kick-only)', () => {
    const others = libFilter('drum', 'ALL').filter((x: any) => x.type !== 'kick')
    for (const k of others as any[]) {
      expect(k.body == null && k.subk == null && k.sat == null).toBe(true)
    }
  })
})

describe('source pins (the wiring exists where the roast can see it)', () => {
  test('engine.js romBuffer: quantized dims cache signature + legacy :2@ key', () => {
    expect(ENGINE_SRC).toContain("applyKickDims")
    expect(ENGINE_SRC).toContain("'d'+cl(kickDims.body)+'_'+cl(kickDims.subk)+'_'+cl(kickDims.sat)+'_'+cl(kickDims.punch)")
    expect(ENGINE_SRC).toContain(":'2';key='R:'+type")
  })

  test('engine.js triggerRom: kick dims computed from the preset sound', () => {
    expect(ENGINE_SRC).toContain("const kd=type==='kick'&&p?{body:p.body,subk:p.subk,sat:p.sat,punch:p.punch}:null")
  })

  test('DrumVoice legacy kick: neutral-centered dims (absent ≡ .5)', () => {
    expect(ENGINE_SRC).toContain('const bN=p.body==null?.5:Math.min(Math.max(p.body,0),1)')
    expect(ENGINE_SRC).toContain('(1+.3*(skN-.5))')
    expect(ENGINE_SRC).toContain('(1+.5*(bN-.5))')
    expect(ENGINE_SRC).toContain('(1+.4*(bN-.5))')
    expect(ENGINE_SRC).toContain('(1-.3*(bN-.5))')
  })

  test('both warm loops pass the active kick preset (no first-hit render latency)', () => {
    expect(MAIN_SRC).toContain("I.eng.romBuffer(ty,ty==='kick'?kickP():null)")
    expect(SOUND_SRC).toContain("I.eng.romBuffer(ty,ty==='kick'?kickP():null)")
  })

  test('G53 registered in the self-gate suite AND the manifest', () => {
    expect(TESTS_SRC).toContain("gate('G53'")
    expect(MANIFEST_SRC).toContain("'G53'")
  })
})
