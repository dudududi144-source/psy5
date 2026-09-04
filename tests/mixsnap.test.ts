/**
 * PSY6 v0.8.0 scene MIX SNAPSHOT tests.
 *
 * Model (documented in js/scenes.js): scene.mix = null | {tracks, master?, note?}
 *  - validation/clamping into CANONICAL form (sorted track keys, registry order)
 *  - persistence: loadProjectObj canonical rebuild, save/load byte-stability,
 *    share (canonicalProject) round-trip
 *  - application: applySceneMix writes through the param registry (knob-
 *    equivalent); null-mix scenes apply nothing (false)
 *  - composer population: every scene carries its section's energy-curve
 *    snapshot, KICK never appears, determinism byte-identical per seed
 *  - walk-order equality: the section-launch mix trace of the shared
 *    songSteps walk (used by BOTH the live scheduler and renderSong)
 */
import { describe, expect, test } from 'bun:test'
import { buildStyle } from '../js/presets.js'
import {
  normalizeSceneMix, sceneSetMix, captureSceneMix, applySceneMix,
} from '../js/scenes.js'
import { loadProjectObj, I } from '../js/state.js'
import { encodeShare, decodeShare, canonicalProject } from '../js/share.js'
import { compose, COMPOSER_STYLES } from '../js/composer.js'
import { songSteps } from '../js/bounce.js'
import { createHash } from 'node:crypto'

const SEED = 424242

function fresh() {
  const p = buildStyle('TECHNO', 7)
  I.p = p
  return p
}

describe('mix snapshot model (normalize/set/capture)', () => {
  test('normalize: clamps fields, sorts track keys, drops invalid entries', () => {
    const n = normalizeSceneMix({
      tracks: {
        7: { vol: 3, pan: -9, sendA: 0.5 },          /* vol→1, pan→-1, kept */
        2: { vol: 0.4, scAmount: 250 },              /* scAmount→100 */
        99: { vol: 0.5 },                            /* out of range → dropped */
        1: { vol: 'x' },                             /* invalid field → entry dropped */
      },
      master: { eqLow: -99, compRatio: 4 },          /* eqLow→-12, compRatio kept */
      note: '  drop 2 — darker  ',
    }, 8)
    expect(n).not.toBeNull()
    expect(Object.keys(n!.tracks)).toEqual(['2', '7'])  /* ascending; all-invalid entries dropped */
    expect(n!.tracks['7']).toEqual({ vol: 1, pan: -1, sendA: 0.5 })
    expect(n!.tracks['2']!.scAmount).toBe(100)
    expect(n!.master!.eqLow).toBe(-12)
    expect(n!.master!.compRatio).toBe(4)
    expect(n!.note).toBe('drop 2 — darker')
    /* field order is canonical (registry order) for byte-stable saves; only
       PROVIDED fields are stored (sparse payload — capture writes all five) */
    expect(Object.keys(n!.tracks['7']!)).toEqual(['vol', 'pan', 'sendA'])
  })
  test('normalize: null/empty/invalid → null (legacy scene, zero change)', () => {
    expect(normalizeSceneMix(null, 8)).toBeNull()
    expect(normalizeSceneMix(undefined, 8)).toBeNull()
    expect(normalizeSceneMix({}, 8)).toBeNull()
    expect(normalizeSceneMix({ tracks: {} }, 8)).toBeNull()
    expect(normalizeSceneMix({ tracks: { 0: {} } }, 8)).toBeNull()
    expect(normalizeSceneMix({ tracks: { 0: { vol: 0.5 } } }, 0)).toBeNull() /* no tracks exist */
    expect(normalizeSceneMix('nonsense', 8)).toBeNull()
  })
  test('sceneSetMix: writes canonical form, null clears, bad index rejected', () => {
    const p = fresh()
    expect(sceneSetMix(p, 0, { tracks: { 4: { vol: 0.3 } } })).toBe(true)
    expect(p.scenes[0].mix).toEqual({ tracks: { 4: { vol: 0.3 } } })
    expect(sceneSetMix(p, 0, null)).toBe(true)
    expect(p.scenes[0].mix).toBeUndefined()
    expect(sceneSetMix(p, 99, { tracks: { 4: { vol: 0.3 } } })).toBe(false)
    expect(sceneSetMix(null, 0, {})).toBe(false)
  })
  test('captureSceneMix: reflects the live mixer; mute/solo are NOT captured', () => {
    const p = fresh()
    p.tracks[4].mix.vol = 0.33
    p.tracks[4].mix.pan = 0.25
    p.tracks[4].mix.sendA = 0.4
    p.tracks[4].scAmount = 60
    p.tracks[4].mix.mute = true
    p.tracks[4].mix.solo = true
    const cap = captureSceneMix(p)
    expect(cap.tracks[4]).toEqual({ vol: 0.33, pan: 0.25, sendA: 0.4, sendB: 0, scAmount: 60, insDrive: 0, insFiltFreq: 20000 })
    expect(JSON.stringify(cap)).not.toContain('mute')
    expect(JSON.stringify(cap)).not.toContain('solo')
  })
})

describe('mix snapshot application', () => {
  test('applySceneMix: exact registry writes; returns false and writes nothing for null-mix', () => {
    const p = fresh()
    const before = JSON.stringify(p.tracks.map(t => ({ vol: t.mix.vol, pan: t.mix.pan, sendA: t.mix.sendA, sendB: t.mix.sendB, sc: t.scAmount })))
    expect(applySceneMix(p, 0)).toBe(false)  /* no snapshot */
    expect(JSON.stringify(p.tracks.map(t => ({ vol: t.mix.vol, pan: t.mix.pan, sendA: t.mix.sendA, sendB: t.mix.sendB, sc: t.scAmount })))).toBe(before)
    sceneSetMix(p, 0, { tracks: { 4: { vol: 0.25, pan: -0.5, sendA: 0.6, sendB: 0.7, scAmount: 45 } } })
    expect(applySceneMix(p, 0)).toBe(true)
    expect(p.tracks[4].mix.vol).toBe(0.25)
    expect(p.tracks[4].mix.pan).toBe(-0.5)
    expect(p.tracks[4].mix.sendA).toBe(0.6)
    expect(p.tracks[4].mix.sendB).toBe(0.7)
    expect(p.tracks[4].scAmount).toBe(45)
  })
  test('applySceneMix: master payload applies through the registered master params (Phase 2 wiring)', () => {
    const p = fresh()
    sceneSetMix(p, 0, { tracks: { 4: { vol: 0.5 } }, master: { eqLow: -6, compRatio: 4, compOn: 1 } })
    expect(applySceneMix(p, 0)).toBe(true)   /* track part applies */
    expect(p.tracks[4].mix.vol).toBe(0.5)
    expect(p.master.eqLow).toBe(-6)          /* registered ids write through */
    expect(p.master.compRatio).toBe(4)
    expect(p.master.compOn).toBe(1)
  })
  test('walk-order trace: songSteps + applySceneMix = the section-launch sequence (shared by scheduler and renderSong)', () => {
    const r = compose('FULL-ON', 3, SEED)
    const p = JSON.parse(JSON.stringify(r.project))
    /* walk the arrangement; at each sectionStart apply the snapshot and log the bass vol */
    const seen: Array<{ scene: string, bassVol: number | null, sc: number | null }> = []
    for (const y of songSteps(p as any)) {
      if (!y.sectionStart) continue
      const scn = p.scenes[y.scene]
      const applied = applySceneMix(p, y.scene)
      seen.push({
        scene: scn.name,
        bassVol: applied ? p.tracks[4].mix.vol : null,
        sc: applied && p.tracks[4].scAmount !== 0 ? p.tracks[4].scAmount : null,
      })
      if (seen.length > 8) break
    }
    expect(seen.length).toBe(9)
    expect(seen[0].scene).toBe('INTRO')
    expect(seen[0].bassVol).toBe(0.8)          /* INTRO snapshot bass vol */
    const drop = seen.find(s => s.scene === 'DROP')!
    expect(drop.bassVol).toBe(1)
    expect(drop.sc).toBe(55)                   /* DROP bass duck materialized */
    const brk = seen.find(s => s.scene === 'BREAK')!
    expect(brk.sc).toBeNull()                  /* BREAK: ducking off */
    expect(seen.some(s => s.scene === 'INTRO 2')).toBe(true) /* variants carry their own snapshots */
  })
})

describe('mix snapshot persistence', () => {
  test('loadProjectObj: canonical rebuild preserves a valid snapshot; legacy projects stay mix-free', () => {
    const p = fresh()
    sceneSetMix(p, 1, { tracks: { 5: { vol: 0.42 }, 2: { vol: 0.9 } }, note: 'x' })
    /* scramble key order to prove canonicalization on load */
    const scrambled = JSON.parse(JSON.stringify(p))
    scrambled.scenes[1].mix.tracks = { 2: scrambled.scenes[1].mix.tracks[2], 5: scrambled.scenes[1].mix.tracks[5] }
    loadProjectObj(scrambled)
    expect(I.p.scenes[1].mix).toEqual(p.scenes[1].mix)
    /* legacy project (no mix fields) loads → the canonical scene rebuild keeps
       every scene in the v0.5.0 schema with NO mix key (zero behavior change) */
    const legacy = buildStyle('PSYTRANCE', 42)
    loadProjectObj(JSON.parse(JSON.stringify(legacy)))
    const canon = legacy.scenes.map((sc: any) => ({ name: sc.name, pattern: sc.pattern == null ? null : sc.pattern, color: sc.color == null ? null : sc.color, bars: sc.bars == null ? null : sc.bars, fill: sc.fill === true }))
    expect(JSON.stringify(I.p.scenes)).toBe(JSON.stringify(canon))
    expect(JSON.stringify(I.p.scenes)).not.toContain('"mix"')
  })
  test('save/load round-trip byte-stability with snapshots (load→save→load idempotent)', () => {
    const p = fresh()
    sceneSetMix(p, 0, { tracks: { 4: { vol: 0.3 } }, master: { eqMid: 1.5 } })
    loadProjectObj(JSON.parse(JSON.stringify(p)))
    const once = JSON.stringify(I.p)
    loadProjectObj(JSON.parse(once))
    expect(JSON.stringify(I.p)).toBe(once)   /* load→save→load stable */
    expect(once).toContain('"mix":{"tracks":{"4":{"vol":0.3}},"master":{"eqMid":1.5}}')
  })
  test('share round-trip: canonical JSON → decode → deep-equal snapshots', async () => {
    const p = fresh()
    sceneSetMix(p, 2, { tracks: { 6: { vol: 0.77, sendB: 0.5 } }, note: 'break space' })
    const enc = await encodeShare(p)
    expect(enc.ok).toBe(true)
    const dec = await decodeShare(enc.token!)
    expect(dec.ok).toBe(true)
    expect(dec.project.scenes[2].mix).toEqual(p.scenes[2].mix)
    expect(canonicalProject(p)).toBe(canonicalProject(dec.project))
  })
})

describe('composer snapshots', () => {
  test('every scene carries a snapshot; KICK never appears in any of them', () => {
    for (const styleId of Object.keys(COMPOSER_STYLES)) {
      const r = compose(styleId, 3, SEED)
      expect(r.stats.snapshots).toBe(r.project.scenes.length)
      for (const sc of r.project.scenes) {
        expect(sc.mix).toBeTruthy()
        expect(sc.mix.tracks['0']).toBeUndefined()   /* KICK IS SACRED — level too */
        for (const k of Object.keys(sc.mix.tracks)) expect(+k).toBeLessThan(9)
      }
    }
  })
  test('curves: DROP full+dry+bass-duck, BREAK spatial (sends up, duck off), RISER no duck', () => {
    const r = compose('FULL-ON', 3, SEED)
    const byName = new Map(r.project.scenes.map(s => [s.name.split(' ')[0], s.mix]))
    const drop = byName.get('DROP')!
    expect(drop.tracks['4'].vol).toBe(1)
    expect(drop.tracks['4'].scAmount).toBe(55)
    expect(drop.tracks['5'].sendA).toBeLessThanOrEqual(0.1)   /* dry punch */
    const brk = byName.get('BREAK')!
    expect(brk.tracks['6'].sendA).toBeGreaterThan(0.3)        /* pad reverb send up */
    expect(brk.tracks['6'].sendB).toBeGreaterThan(0.4)
    expect(brk.tracks['5'].scAmount).toBe(0)                  /* no ducking in the breakdown */
    const riser = byName.get('RISER')!
    expect(riser.tracks['6'].vol).toBe(1)                     /* pad swell */
    expect(riser.tracks['8'].vol).toBe(1)                     /* FX full */
    expect(riser.tracks['4'].scAmount).toBe(0)
    const intro = byName.get('INTRO')!
    expect(intro.tracks['5'].vol).toBeLessThan(drop.tracks['5'].vol)  /* low vs full */
  })
  test('determinism: same seed → byte-identical project INCLUDING snapshots; different seed → different', () => {
    const a = JSON.stringify(compose('FULL-ON', 3, SEED).project)
    const b = JSON.stringify(compose('FULL-ON', 3, SEED).project)
    expect(a).toBe(b)
    expect(a).toContain('"mix"')
    const c = JSON.stringify(compose('FULL-ON', 3, 777).project)
    expect(c).not.toBe(a)
  })
  test('form fingerprint is UNCHANGED by the snapshot pass (patterns untouched)', () => {
    const c = compose('FULL-ON', 3, SEED)
    /* v0.27.0 REBUILD VALUE: the fingerprint moved from bb16ce280ff48f88
       (v0.9.0) because the pad legato scheduling + gate bump and the ear-candy
       pops re-shaped pattern data; the snapshot pass itself still touches NO
       pattern data — the pin's purpose (snapshots don't mutate patterns) is
       unchanged. */
    expect(createHash('sha256').update(c.stats.fingerprint).digest('hex').slice(0, 16)).toBe('4eaab7523d9195e8')
  })
})
