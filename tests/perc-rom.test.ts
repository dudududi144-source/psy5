/**
 * PERCUSSION ROM v3 (v0.23.0) — the synth-quality ceiling breaker.
 *
 * The owner (4× across runs 18–22): conga/crash/triangle/cowbell etc. are
 * "sounds below criticism" that destroy the mix dynamics. The fix renders 13
 * weak-synth types ONCE per sample-rate (foundation/dsp/perc-rom.mjs — modal
 * synthesis + seeded noise, the DSP the per-hit path can't afford) and plays
 * them through a pooled RomVoice sampler path.
 *
 * THIS FILE pins (bun, no WebAudio — the renderer is pure Float32Array math):
 *   1. RENDER LAW — all 13 types render finite, peak-safe, RMS-leveled PCM;
 *      byte-deterministic (same type+sr → identical Float32Array).
 *   2. WINDOW LAW — no buffer outlives its drumDurEst·1.15+.02 reuse window
 *      (a pooled steal can never cut an audible tail; pool discipline moved
 *      zero).
 *   3. LOUDNESS LAW — every type lands within ±1.5 dB of its spec RMS (the
 *      anti-"dynamics destroyer" family band; tools/rom-audit.mjs prints it).
 *   4. SAMPLE-RATE INDEPENDENCE — 44.1 kHz renders differ from 48 kHz (per-sr
 *      cache) but obey the same laws.
 *   5. SOURCE PINS — engine.js routes ROM_TYPES BEFORE any pooled voice is
 *      touched (a ROM hit neither consumes nor steals a DrumVoice), keeps
 *      romOn=false = legacy path, warmRom exists, loadSnapshot carries the
 *      honest counters; main.js warms at power-on; the sample manifest lists
 *      ONLY files that exist (the 12 ghost entries are gone).
 *   6. RECIPE PINS — the membrane mode ladder (the measured circular-membrane
 *      ratios incl. the 1.02 beat partner), the cymbal ratio bank, the clave
 *      1:2.63 and agogo 1:1.506 ratios — the recipes that make a conga a
 *      conga instead of a sine beep.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { renderRomPcm, ROM_TYPES, romSpec } from '../foundation/dsp/perc-rom.mjs'
import { PooledEngine } from '../js/engine.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENGINE_SRC = readFileSync(join(ROOT, 'js/engine.js'), 'utf8')
const MAIN_SRC = readFileSync(join(ROOT, 'js/main.js'), 'utf8')

const durEst = PooledEngine.prototype.drumDurEst

function stats(buf) {
  let peak = 0, sum = 0, finite = true
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i]
    if (!Number.isFinite(v)) finite = false
    const a = Math.abs(v); if (a > peak) peak = a
    sum += v * v
  }
  return { peak, rms: Math.sqrt(sum / buf.length), finite }
}

describe('PERCUSSION ROM v3 — render law', () => {
  test('all 13 types render finite, peak-safe, RMS-leveled PCM', () => {
    expect(ROM_TYPES.length).toBe(13)
    for (const t of ROM_TYPES) {
      const buf = renderRomPcm(t, 48000)
      const s = stats(buf)
      expect(s.finite).toBe(true)
      expect(s.peak).toBeLessThanOrEqual(0.9701)
      expect(s.peak).toBeGreaterThan(0.05) // not accidentally silent
      expect(s.rms).toBeGreaterThan(0.01)
    }
  })

  test('byte-deterministic: same (type, sampleRate) → identical PCM', () => {
    for (const t of ROM_TYPES) {
      const a = renderRomPcm(t, 48000)
      const b = renderRomPcm(t, 48000)
      expect(a.length).toBe(b.length)
      let same = true
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break }
      expect(same).toBe(true)
    }
  })

  test('window law: buffer ≤ drumDurEst·1.15+.02 (pool discipline moved zero)', () => {
    for (const t of ROM_TYPES) {
      const buf = renderRomPcm(t, 48000)
      const win = durEst(t, 1) * 1.15 + 0.02
      expect(buf.length / 48000).toBeLessThanOrEqual(win + 1e-6)
    }
  })

  test('loudness law: every type within ±1.5 dB of its spec RMS', () => {
    const dB = (x) => 20 * Math.log10(x)
    for (const t of ROM_TYPES) {
      const spec = romSpec(t)
      expect(spec).not.toBeNull()
      const s = stats(renderRomPcm(t, 48000))
      expect(Math.abs(dB(s.rms / spec.rms))).toBeLessThanOrEqual(1.5)
    }
  })

  test('44.1 kHz renders obey the same laws (per-sr cache entries)', () => {
    for (const t of ['conga', 'crash', 'clave']) {
      const buf = renderRomPcm(t, 44100)
      const s = stats(buf)
      expect(s.finite).toBe(true)
      expect(s.peak).toBeLessThanOrEqual(0.9701)
      const win = durEst(t, 1) * 1.15 + 0.02
      expect(buf.length / 44100).toBeLessThanOrEqual(win + 1e-6)
    }
  })

  test('unknown type / bad sampleRate throw (engine fallback path is counted)', () => {
    expect(() => renderRomPcm('kick', 48000)).toThrow()
    expect(() => renderRomPcm('conga', 0)).toThrow()
  })
})

describe('PERCUSSION ROM v3 — recipe pins (the physics that un-beep the drums)', () => {
  test('conga carries the 1.02 beat partner (acoustic beating, not a sine)', () => {
    const src = readFileSync(join(ROOT, 'foundation/dsp/perc-rom.mjs'), 'utf8')
    expect(src).toContain('[1.0, 1.0, 0.30], [1.02, 0.45, 0.26]')
    expect(src).toContain('1.475') // the (1,1) membrane mode
    expect(src).toContain('2.09')
  })

  test('crash bank is DENSE (10 primary ratios × 2 detuned partners = 20 squares)', () => {
    const src = readFileSync(join(ROOT, 'foundation/dsp/perc-rom.mjs'), 'utf8')
    expect(src).toContain('CYM_RATIOS = [1, 1.36, 1.79, 2.26, 2.81, 3.42, 4.09, 4.83, 5.64, 6.51]')
    expect(src).toContain('0.0068') // the beating partners
  })

  test('cowbell is the RENDERED 808 recipe (560:845 band-passed — no more raw squares)', () => {
    const src = readFileSync(join(ROOT, 'foundation/dsp/perc-rom.mjs'), 'utf8')
    expect(src).toContain('SPEC.cowbell.f0, f2 = 845')
    expect(src).toContain("biquadCoeffs('bandpass', sr, 1900, 1.1)")
  })

  test('clave 1:2.63 and agogo 1:1.506 (the measured wood/bell ratios)', () => {
    const src = readFileSync(join(ROOT, 'foundation/dsp/perc-rom.mjs'), 'utf8')
    expect(src).toContain('[1, 1.0, 0.028], [2.63, 0.55, 0.016]')
    expect(src).toContain('[1, 1.0, 0.16], [1.506, 0.72, 0.12]')
  })
})

describe('PERCUSSION ROM v3 — engine integration pins', () => {
  test('trigger routes ROM_TYPES BEFORE any pooled voice is touched', () => {
    expect(ENGINE_SRC).toContain('if(this.romOn&&tr.kind===\'drum\'){const sd0=tr.sound||{};const ty0=sd0.type||tr.type;if(ROM_TYPES.has(ty0)&&this.triggerRom(tr,when,ev.vel,ev.lock||{},ty0,sd0))return}')
    // the ROM branch sits BEFORE the nextVoice selection (no steal/consume)
    expect(ENGINE_SRC.indexOf('if(this.romOn&&tr.kind'))
      .toBeLessThan(ENGINE_SRC.indexOf('const tier=this.tierOfTrack(tr);const v=this.nextVoice(tr,tier,when)'))
  })

  test('romOn=false = exact legacy path (neutral opt-out survives)', () => {
    expect(ENGINE_SRC).toContain('this.romOn=opts.rom!==false')
  })

  test('reuse-boundary safety fade: last 15 ms always fades at min(buffer, window)', () => {
    expect(ENGINE_SRC).toContain('const natSec=ab.duration/tune,winSec=this.drumDurEst(type,decay)*1.15+.02,endSec=Math.min(natSec,winSec)')
  })

  test('RomVoice pool exists (8 voices) with pooled env gain + tilt highshelf', () => {
    expect(ENGINE_SRC).toContain('class RomVoice')
    expect(ENGINE_SRC).toContain("this.f.type='highshelf'")
    expect(ENGINE_SRC).toContain('for(let i=0;i<8;i++)this.romPool.push(new RomVoice(ctx,this))')
  })

  test('loadSnapshot carries the honest ROM counters', () => {
    expect(ENGINE_SRC).toContain('romSpawns:this.romSpawns,romRenders:this.romRenders,romFallbacks:this.romFallbacks,romSteals:this.romSteals,romOn:this.romOn')
  })

  test('warmRom exists and main.js warms at power-on (idle-sliced)', () => {
    expect(ENGINE_SRC).toContain('warmRom(types){')
    expect(MAIN_SRC).toContain('v0.23.0 PERCUSSION ROM warm')
  })

  test('killAll panics the ROM pool (stop = silence, no stuck tails)', () => {
    expect(ENGINE_SRC).toContain('for(const v of this.romPool){const t=this.ctx.currentTime')
  })
})

describe('PERCUSSION ROM v3 — sample manifest integrity', () => {
  test('manifest lists ONLY files that exist (the 12 ghost entries are gone)', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'samples/manifest.json'), 'utf8'))
    expect(manifest.length).toBe(16)
    for (const e of manifest) {
      expect(existsSync(join(ROOT, e['file']))).toBe(true)
      expect(e['category']).toBeTruthy()
    }
  })
})
