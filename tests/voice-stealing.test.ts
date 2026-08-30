/**
 * PSY6 worklet voice-stealing policy tests.
 *
 * Loads worklets/psy-engine.js in a stubbed AudioWorklet environment
 * (Bun, no Web Audio) and verifies the priority-tier allocation policy:
 *
 *   Tiers: 0 = kick/bass (never stolen) · 1 = hats/snare/clap/perc
 *          2 = lead/arp/pluck           · 3 = pad/fx/texture (stolen first)
 *
 *   - A free voice in the requester's own pool always wins.
 *   - When exhausted, the OLDEST ACTIVE voice of the LOWEST-PRIORITY
 *     non-empty tier above tier 0 (scan 3 → 2 → 1) is stolen.
 *   - Tier-0 requests retrigger their dedicated voice (never stolen,
 *     never waiting).
 *   - Pool sizes + tier assignment are init-time parameters
 *     (processorOptions) and re-tunable via the `config` message.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'

// Voice ids (must match worklets/psy-engine.js)
const V_KICK = 0, V_BASS = 1, V_LEAD = 2, V_ACID = 3, V_PAD = 4
const V_HAT = 5, V_HAT_OPEN = 6, V_CLAP = 7, V_PERC = 8, V_SHAKER = 9
const V_TEXTURE = 10, V_RISER = 11, V_IMPACT = 12, V_SWEEP = 13
const V_ZAP = 14, V_BLIP = 15, V_DOWNLIFTER = 16, V_FM = 17

const SRC = readFileSync(new URL('../worklets/psy-engine.js', import.meta.url), 'utf8')

function loadEngine(processorOptions?: Record<string, unknown>): any {
  const fn = new Function(
    'sampleRate', 'currentFrame', 'performance', 'registerProcessor', 'AudioWorkletProcessor',
    SRC + '\nreturn PsyEngineProcessor;'
  )
  const Base = class {
    port = { onmessage: null as null | ((m: unknown) => void), postMessage() {} }
  }
  const Cls = fn(44100, 0, { now: () => 0 }, () => {}, Base)
  return new Cls({ processorOptions })
}

describe('psy-engine priority voice stealing', () => {
  test('default tier assignment matches the PSY6 tier table', () => {
    const eng = loadEngine()
    expect(eng.voiceTier[V_KICK]).toBe(0)
    expect(eng.voiceTier[V_BASS]).toBe(0)
    expect(eng.voiceTier[V_HAT]).toBe(1)
    expect(eng.voiceTier[V_HAT_OPEN]).toBe(1)
    expect(eng.voiceTier[V_CLAP]).toBe(1)
    expect(eng.voiceTier[V_PERC]).toBe(1)
    expect(eng.voiceTier[V_SHAKER]).toBe(1)
    expect(eng.voiceTier[V_LEAD]).toBe(2)
    expect(eng.voiceTier[V_ACID]).toBe(2)
    expect(eng.voiceTier[V_FM]).toBe(2)
    expect(eng.voiceTier[V_PAD]).toBe(3)
    expect(eng.voiceTier[V_TEXTURE]).toBe(3)
    expect(eng.voiceTier[V_RISER]).toBe(3)
    expect(eng.voiceTier[V_IMPACT]).toBe(3)
    expect(eng.voiceTier[V_SWEEP]).toBe(3)
    expect(eng.voiceTier[V_ZAP]).toBe(3)
    expect(eng.voiceTier[V_BLIP]).toBe(3)
    expect(eng.voiceTier[V_DOWNLIFTER]).toBe(3)
  })

  test('default pool sizes match the historical engine (34 voices)', () => {
    const eng = loadEngine()
    expect(eng.kickPool.length).toBe(4)
    expect(eng.bassPool.length).toBe(2)
    expect(eng.leadPool.length).toBe(4)
    expect(eng.acidPool.length).toBe(2)
    expect(eng.padPool.length).toBe(2)
    expect(eng.hatPool.length).toBe(4)
    expect(eng.clapPool.length).toBe(2)
    expect(eng.percPool.length).toBe(4)
    expect(eng.shakerPool.length).toBe(2)
    expect(eng.texturePool.length).toBe(2)
    expect(eng.fxPool.length).toBe(4)
    expect(eng.fmPool.length).toBe(2)
  })

  test('pool sizes are init-time parameters (processorOptions)', () => {
    const eng = loadEngine({ poolSizes: { hat: 1, kick: 2, lead: 8 } })
    expect(eng.hatPool.length).toBe(1)
    expect(eng.kickPool.length).toBe(2)
    expect(eng.leadPool.length).toBe(8)
  })

  test('tier assignment is an init-time parameter (processorOptions.tiers)', () => {
    const eng = loadEngine({ tiers: { [V_HAT]: 3 } })
    expect(eng.voiceTier[V_HAT]).toBe(3)
  })

  test('a free voice in the own pool always wins (no steal)', () => {
    const eng = loadEngine()
    const v = eng.getFreeVoice(eng.hatPool, V_HAT)
    expect(eng.hatPool.includes(v)).toBe(true)
    expect(v.active).toBeFalsy()
    expect(eng.stealCount[1] + eng.stealCount[2] + eng.stealCount[3]).toBe(0)
  })

  test('exhausted tier-1 pool steals the OLDEST ACTIVE voice within the tier', () => {
    const eng = loadEngine()
    eng.hatPool.forEach((h: any, i: number) => { h.active = true; h.lastTrigger = 100 + i })
    const victim = eng.getFreeVoice(eng.hatPool, V_HAT)
    expect(victim).toBe(eng.hatPool[0]) // oldest active hat (lastTrigger 100)
    expect(eng.stealCount[1]).toBe(1)
  })

  test('tier-0 requests retrigger the dedicated voice and are never stolen', () => {
    const eng = loadEngine()
    eng.kickPool.forEach((k: any) => { k.active = true; k.lastTrigger = 7 })
    // every other pool is loaded with active voices too — kick must not touch them
    eng.hatPool.forEach((h: any) => { h.active = true; h.lastTrigger = 99 })
    const k1 = eng.getFreeVoice(eng.kickPool, V_KICK)
    const k2 = eng.getFreeVoice(eng.kickPool, V_KICK)
    expect(eng.kickPool.indexOf(k1)).toBe(0)   // dedicated voice
    expect(eng.kickPool.indexOf(k2)).toBe(0)   // retriggers the same voice
    expect(k1.tier0 || k1 === eng.kickPool[0]).toBe(true)
  })

  test('tier-0 voices are never handed out as steal victims', () => {
    const eng = loadEngine({ poolSizes: { hat: 2 } })
    // kick dedicated (tier 0), one hat active (tier 1 victim)
    const kick = eng.getFreeVoice(eng.kickPool, V_KICK)
    kick.tier0 = true
    eng.hatPool.forEach((h: any) => { h.active = true; h.lastTrigger = 20 })
    const victim = eng.getFreeVoice(eng.hatPool, V_HAT)
    expect(victim.tier0).toBeFalsy()
    expect(eng.kickPool.includes(victim)).toBe(false)
  })

  test('cross-tier stealing scans 3 → 2 → 1 (lowest priority first)', () => {
    const eng = loadEngine()
    eng.leadPool.forEach((l: any, i: number) => { l.active = true; l.lastTrigger = 200 + i })
    eng.padPool.forEach((p: any, i: number) => { p.active = true; p.lastTrigger = 50 + i })
    const victim = eng.getFreeVoice(eng.leadPool, V_LEAD)
    expect(eng.padPool.includes(victim)).toBe(true)      // tier 3 pad stolen…
    expect(victim).toBe(eng.padPool[0])                  // …the oldest one
    expect(eng.stealCount[3]).toBe(1)
    // now pads silent → next victim is the oldest lead (tier 2, own tier)
    eng.padPool.forEach((p: any) => { p.active = false })
    const victim2 = eng.getFreeVoice(eng.leadPool, V_LEAD)
    expect(eng.leadPool.includes(victim2)).toBe(true)
    expect(victim2).toBe(eng.leadPool[0])                // oldest lead (200)
    expect(eng.stealCount[2]).toBe(1)
  })

  test('config message retunes pool sizes and tiers at runtime', () => {
    const eng = loadEngine()
    eng.handleMessage({ type: 'config', poolSizes: { hat: 6 } })
    expect(eng.hatPool.length).toBe(6)
    eng.handleMessage({ type: 'config', tiers: { [V_HAT]: 3, [V_PAD]: 1 } })
    expect(eng.voiceTier[V_HAT]).toBe(3)
    expect(eng.voiceTier[V_PAD]).toBe(1)
    // tierPools rebuilt: hats now victims of tier-3 scan (index 3 contains hatPool)
    expect(eng.tierPools[3].includes(eng.hatPool)).toBe(true)
    expect(eng.tierPools[1].includes(eng.padPool)).toBe(true)
  })

  test('config message still accepts play/stop after retuning', () => {
    const eng = loadEngine()
    eng.handleMessage({ type: 'config', poolSizes: { kick: 1 } })
    eng.handleMessage({ type: 'play' })
    expect(eng.playing).toBe(true)
    eng.handleMessage({ type: 'stop' })
    expect(eng.playing).toBe(false)
  })
})
