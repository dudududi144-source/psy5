/**
 * PAD SPREAD (v0.29.0, PSY6) — psyreason re-review #2 port pins.
 *
 * psyreason dc072ca ("comprehensive pad overhaul — spread voicing +
 * octave-up 3rd + smoother envelope + wider alternating stereo"),
 * 6c8c152/4e09726 ("per-substyle pad timbre — pads differ per style"),
 * ported onto psy5's pooled architecture:
 *
 *   1. SPREAD VOICING (model.js padKit CHORD) — the grid's chord grows a
 *      FIFTH note: the 3rd one octave UP. notes[0..3] stay root+3+5+7
 *      (the v0.28.0 label/quality laws are untouched); notes[4] = notes[1]+12.
 *   2. PER-NOTE STEREO (js/engine.js SynthVoice) — an optional per-VOICE
 *      StereoPanner behind lock.pan/preset pan; absent/0 keeps the EXACT
 *      legacy wiring (vca→bus.input, no node — bit-neutral, audio-level
 *      proof is on-device G54). js/ui/perform.js padHit fires the 5-voice
 *      stack with alternating ±width pans and rebalanced velocities.
 *   3. COMPOSER BED (js/composer.js fillSection) — the pad voicing grows
 *      the same octave-up third (chord-tone safe: degree cd+2), so
 *      composed songs carry the same openness.
 *   4. PAD TIMBRE (js/composer.js compose) — the pad voice is tinted per
 *      style+seed: detune/cutoff multiply INSIDE the preset's designed
 *      envelope, `width` (0.3–0.8) seeds the live spread. Deterministic
 *      pure function of (styleId, seed); runs BEFORE the macro base
 *      snapshot so the macros resolve from the tinted base.
 *   5. SOURCE PINS — the pan wiring, the padHit alternating law, the
 *      padtimbre rng stream and the G54 registration.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { padKit, SCALES } from '../js/model.js'
import { buildStyle } from '../js/presets.js'
import { compose } from '../js/composer.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENGINE_SRC = readFileSync(join(ROOT, 'js/engine.js'), 'utf8')
const PERFORM_SRC = readFileSync(join(ROOT, 'js/ui/perform.js'), 'utf8')
const COMPOSER_SRC = readFileSync(join(ROOT, 'js/composer.js'), 'utf8')
const TESTS_SRC = readFileSync(join(ROOT, 'js/ui/tests.js'), 'utf8')
const MANIFEST_SRC = readFileSync(join(ROOT, 'js/gates-manifest.js'), 'utf8')

describe('spread voicing (padKit CHORD, model.js)', () => {
  test('every chord is the 5-note spread stack: root+3+5+7 + octave-up 3rd', () => {
    for (const scaleName of ['minor', 'phrygian', 'major', 'dorian'] as const) {
      const p = buildStyle('PSYTRANCE', 7)
      p.scale = scaleName as any
      p.root = 33
      const kit = padKit(p, 'CHORD')
      expect(kit.length).toBe(16)
      for (const e of kit as any[]) {
        expect(e.mode).toBe('chord')
        expect(e.notes.length).toBe(5)
        expect(e.notes[4]).toBe(e.notes[1] + 12) // the octave-up 3rd
        expect(['7', 'maj7', ''].some((s) => (e.label as string).endsWith(s))).toBe(true)
      }
    }
  })

  test('notes[0..3] keep the v0.28.0 diatonic-7th law (no drift)', () => {
    const p = buildStyle('TECHNO', 2)
    p.scale = 'minor'; p.root = 33
    const kit = padKit(p, 'CHORD')
    const minor = SCALES.minor, L = minor.length
    for (let i = 0; i < 7; i++) {
      const idx = i % L, oct = Math.floor(i / L)
      for (const k of [0, 1, 2, 3]) {
        const raw = idx + 2 * k // UNwrapped degree walk — the octave rides floor(raw/L) (same law as pads-v022's d7)
        const want = 33 + 24 + minor[raw % L] + 12 * (oct + Math.floor(raw / L))
        expect(kit[i].notes[k]).toBe(want)
      }
      expect(kit[i].notes[4]).toBe(kit[i].notes[1] + 12)
    }
  })
})

describe('composer pad bed + timbre (compose.js)', () => {
  test('composed pad sound carries the seeded width inside [0.3, 0.8]', () => {
    for (const styleId of ['FULL-ON', 'DARK-PSY', 'PROGRESSIVE', 'FOREST', 'TRANCE']) {
      const p = compose(styleId, 3, 424242).project
      const w = p.tracks[6]?.sound?.width
      expect(typeof w).toBe('number')
      expect(w).toBeGreaterThanOrEqual(0.3)
      expect(w).toBeLessThanOrEqual(0.8)
    }
  })

  test('pad timbre is a deterministic pure function of (styleId, seed)', () => {
    const a = compose('PSYTRANCE', 3, 424242).project
    const b = compose('PSYTRANCE', 3, 424242).project
    expect(JSON.stringify(a.tracks[6].sound)).toBe(JSON.stringify(b.tracks[6].sound))
    const other = compose('PSYTRANCE', 3, 777).project
    expect(JSON.stringify(a.tracks[6].sound)).not.toBe(JSON.stringify(other.tracks[6].sound))
  })

  test('tint stays inside the preset envelope: detune 4–30, cutoff clamped sane', () => {
    for (const styleId of ['FULL-ON', 'DARK-PSY', 'GOA', 'HI-TECH']) {
      const s = compose(styleId, 5, 424242).project.tracks[6].sound
      expect(s.detune).toBeGreaterThanOrEqual(4)
      expect(s.detune).toBeLessThanOrEqual(30)
      expect(s.cutoff).toBeGreaterThanOrEqual(200)
      expect(s.cutoff).toBeLessThanOrEqual(16000)
    }
  })
})

describe('source pins (the wiring exists where the roast can see it)', () => {
  test('SynthVoice: optional per-voice pan node, bit-neutral when absent', () => {
    expect(ENGINE_SRC).toContain('connect(bus,usePan)')
    expect(ENGINE_SRC).toContain('if(!this.panN)this.panN=this.ctx.createStereoPanner()')
    expect(ENGINE_SRC).toContain('const pan=clamp(p.pan||0,-1,1)')
    expect(ENGINE_SRC).toContain('this.connect(this.eng.chains[tr.idx],Math.abs(pan)>.001)')
  })

  test('perform.js padHit: 5-voice alternating-stereo law with rebalanced velocities', () => {
    expect(PERFORM_SRC).toContain('lock:{pan:(j%2===0?1:-1)*w}')
    expect(PERFORM_SRC).toContain('j===4?vel*.45:vel*.55')
    expect(PERFORM_SRC).toContain('(tr.sound&&tr.sound.width!=null)?tr.sound.width:.55')
  })

  test('composer: padtimbre rng stream runs BEFORE the macro base snapshot', () => {
    expect(COMPOSER_SRC).toContain("rngFor(seedInt, 'padtimbre')")
    const timbreAt = COMPOSER_SRC.indexOf("rngFor(seedInt, 'padtimbre')")
    const baseAt = COMPOSER_SRC.indexOf('t.base = deep(')
    expect(timbreAt).toBeGreaterThan(-1)
    expect(baseAt).toBeGreaterThan(timbreAt)
  })

  test('G54 registered in the self-gate suite AND the manifest', () => {
    expect(TESTS_SRC).toContain("gate('G54'")
    expect(MANIFEST_SRC).toContain("'G54'")
  })
})
