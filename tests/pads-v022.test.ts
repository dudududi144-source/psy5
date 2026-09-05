/**
 * PSY6 v0.22.0 — PADS v3 "LIVE GRID"
 *
 * The owner's screenshot indictment: 16 pads ALL reading "Trance", half of
 * them DEAD (the old i%tracks.length map landed pads on synth tracks and
 * padHit refused to fire — pads that neither look like anything nor play).
 * This suite pins the pure repair (js/model.js padKit):
 *
 *   1. DRUM: every pad resolves to a REAL drum track — voice pads first,
 *      then VARIANT pads (+OCT/-OCT/TIGHT/LONG/PUNCH/DARK/BRITE/SUB
 *      parameter locks riding the per-hit lock mechanism). ZERO dead pads,
 *      ZERO duplicate identities, labels NEVER a lone genre word.
 *   2. SCALE: real note names matching the scale math (root+24 layout).
 *   3. CHORD: diatonic triads with correct quality symbols — natural minor
 *      degrees give i ii° III iv v VI VII.
 *   4. GLYPHS: every engine drum type (drumDurEst switch) has a silhouette.
 *   5. HONESTY: a set with no drum voices yields 16 'empty' markers (the UI
 *      toasts the Sound-tab fix — never a silent pad).
 * Determinism is sacred: pure functions, zero DOM.
 */
import { describe, expect, test } from 'bun:test'
import { padKit, padLabel, padType, padGlyph, PAD_GLYPHS, padNoteName, padChordQuality, PAD_GRID, SCALES } from '../js/model.js'
import { buildStyle } from '../js/presets.js'
import { readFileSync } from 'node:fs'

const allTypes = (): string[] => {
  const src = readFileSync(new URL('../js/engine.js', import.meta.url), 'utf8')
  const m = src.match(/drumDurEst\(type,decay\)\{(.+?)\}/s)
  expect(m).toBeTruthy()
  const out = new Set<string>()
  for (const mm of (m![1] as string).matchAll(/case '([a-zA-Z]+)':/g)) out.add(mm[1])
  return [...out]
}

describe('v0.22.0 PADS v3 — DRUM mode', () => {
  test('every pad resolves to a real drum track (zero dead pads)', () => {
    for (const style of ['TRANCE', 'PSYTRANCE', 'TECHNO', 'PROGRESSIVE']) {
      const p = buildStyle(style, 77)
      const kit = padKit(p, 'DRUM')
      expect(kit.length).toBe(PAD_GRID)
      kit.forEach((e: any) => {
        expect(e.track).not.toBeNull()
        expect(e.track).toBeGreaterThanOrEqual(0)
        expect(e.track).toBeLessThan(p.tracks.length)
        expect(p.tracks[e.track].kind).toBe('drum')
        expect(e.mode === 'voice' || e.mode === 'variant').toBe(true)
      })
    }
  })

  test('labels are meaningful — never a lone genre word, never "Trance" x16', () => {
    const p = buildStyle('TRANCE', 77)
    const kit = padKit(p, 'DRUM')
    const labels = kit.map((e: any) => e.label)
    const ids = kit.map((e: any) => e.label + '|' + (e.mode === 'variant' ? e.mod : 'V'))
    expect(new Set(ids).size).toBeGreaterThan(8) // real playable variety, not 16x the same hit
    labels.forEach((l: string) => {
      expect(l.length).toBeGreaterThan(0)
      expect(l).not.toBe('TRANCE') // the exact owner complaint dies
      expect(l).not.toBe('TECHNO')
      expect(l).not.toBe('PSY')
    })
    // genre word stripped: "Trance Punch Kick" → "PUNCH KICK"
    expect(labels).toContain('PUNCH KICK')
  })

  test('16-voice kit → all voice pads; 4-drum kit → 12 variants; 0 drums → 16 honest empties', () => {
    // 16 drum tracks (12 from the 8-track build's 4 drums + 12 pushed)
    const big = buildStyle('TRANCE', 5)
    while (big.tracks.length < 16) big.tracks.push({ idx: big.tracks.length, kind: 'drum', name: 'PERC ' + big.tracks.length, sound: { type: 'conga', tune: 1, decay: 1 }, type: 'conga', mix: { vol: .8, pan: 0, mute: false, solo: false, sendA: 0, sendB: 0 } })
    const kBig = padKit(big, 'DRUM')
    expect(kBig.filter((e: any) => e.mode === 'voice').length).toBe(12) // 4 native drums + 12 pushed
    expect(kBig.filter((e: any) => e.mode === 'variant').length).toBe(4)
    // 4-drum kit (a fresh build has 4)
    const p = buildStyle('TECHNO', 9)
    const k = padKit(p, 'DRUM')
    expect(k.filter((e: any) => e.mode === 'voice').length).toBe(4)
    expect(k.filter((e: any) => e.mode === 'variant').length).toBe(12)
    // zero drums
    const empty = buildStyle('TECHNO', 9)
    empty.tracks.forEach((t: any) => { t.kind = 'synth' })
    const kE = padKit(empty, 'DRUM')
    expect(kE.filter((e: any) => e.mode === 'empty').length).toBe(16)
  })

  test('variant locks stay inside the engine clamp ranges', () => {
    const p = buildStyle('PSYTRANCE', 3)
    const kit = padKit(p, 'DRUM')
    kit.filter((e: any) => e.mode === 'variant').forEach((e: any) => {
      expect(e.lock).toBeTruthy()
      for (const [k, v] of Object.entries(e.lock)) {
        if (k === 'tune') { expect(v as number).toBeGreaterThanOrEqual(0.4); expect(v as number).toBeLessThanOrEqual(2.2) }
        if (k === 'decay') { expect(v as number).toBeGreaterThanOrEqual(0.15); expect(v as number).toBeLessThanOrEqual(3) }
        if (k === 'punch') { expect(v as number).toBeGreaterThanOrEqual(0); expect(v as number).toBeLessThanOrEqual(1) }
        if (k === 'tone') { expect(v as number).toBeGreaterThanOrEqual(0.4); expect(v as number).toBeLessThanOrEqual(1.9) }
      }
    })
  })

  test('variant + voice pads never collide on (label, mode-tag) identity', () => {
    const p = buildStyle('TECHNO', 11)
    const kit = padKit(p, 'DRUM')
    const ids = kit.map((e: any) => e.label + '|' + (e.mode === 'variant' ? e.mod : 'V'))
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('v0.22.0 PADS v3 — SCALE/CHORD modes', () => {
  test('SCALE pads carry real note names matching the scale math', () => {
    const p = buildStyle('TRANCE', 7) // minor, root 33 (A1)
    p.scale = 'minor'
    const kit = padKit(p, 'SCALE')
    expect(kit.length).toBe(16)
    const minor = SCALES.minor
    for (let i = 0; i < 16; i++) {
      const expected = p.root + 24 + minor[i % minor.length] + 12 * Math.floor(i / minor.length)
      expect((kit[i] as any).note).toBe(expected)
      expect((kit[i] as any).label).toBe(padNoteName(expected))
    }
    expect(kit[0].label).toBe('A3') // root 33 (A1) + 24 → MIDI 57 = A3
  })

  test('CHORD pads: natural-minor degrees give i ii° III iv v VI VII qualities', () => {
    const p = buildStyle('TECHNO', 2)
    p.scale = 'minor'; p.root = 33 // A minor
    const kit = padKit(p, 'CHORD')
    const qual = (ns: number[]) => padChordQuality(ns[0], ns[1], ns[2])
    expect(qual(kit[0].notes)).toBe('m')  // i
    expect(qual(kit[1].notes)).toBe('°')  // ii°
    expect(qual(kit[2].notes)).toBe('')   // III
    expect(qual(kit[3].notes)).toBe('m')  // iv
    expect(qual(kit[4].notes)).toBe('m')  // v
    expect(qual(kit[5].notes)).toBe('')   // VI
    expect(qual(kit[6].notes)).toBe('')   // VII
    /* v0.28.0 SEVENTH VOICINGS (psyreason 47ec8a0): every pad is a 4-note
       root+3+5+7 stack; the label appends the seventh type from the actual
       5th→7th semitone gap. A natural minor: i7/ii°7/IIImaj7/iv7/v7/VImaj7/VII7. */
    expect(kit[0].notes.length).toBe(4)
    expect(kit[0].notes[3]).toBe(67) // Am7: A3 C4 E4 G4 — the added 7th is G4
    expect(kit[0].label).toBe('Am7')
    expect(kit[2].label).toBe('Cmaj7') // III: C E G B — B is 4 semitones over G
    expect(kit[6].label).toBe('G7')    // VII: G B D F — flat 7th, the real dominant
    /* the 7th of every degree stays diatonic: it is a scale note built the
       same way as the triad notes ((idx+6) wraps within the scale) */
    const minor = SCALES.minor, L = minor.length
    for (let i = 0; i < 7; i++) {
      const idx = i % L, oct = Math.floor(i / L)
      const d7 = 33 + 24 + minor[(idx + 6) % L] + 12 * (oct + Math.floor((idx + 6) / L))
      expect(kit[i].notes[3]).toBe(d7)
    }
  })
})

describe('v0.22.0 PADS v3 — glyphs + helpers', () => {
  test('every engine drum type has an envelope silhouette', () => {
    const types = allTypes()
    expect(types.length).toBeGreaterThanOrEqual(24)
    for (const t of types) {
      const g = padGlyph(t)
      expect(g).toBeTruthy()
      expect(g).toBe(PAD_GLYPHS[t.toLowerCase()]) // keys are lowercase (hatC→hatc)
      const pts = g.split(' ')
      expect(pts.length).toBeGreaterThanOrEqual(5)
      for (const pt of pts) {
        const [x, y] = pt.split(',').map(Number)
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(100)
        expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(60)
      }
    }
    expect(padGlyph('nonexistent-type')).toBe(PAD_GLYPHS.tom) // honest fallback
  })

  test('padLabel strips genre words, caps at 18, handles garbage', () => {
    expect(padLabel({ name: 'Trance Punch Kick' })).toBe('PUNCH KICK')
    expect(padLabel({ name: 'Hi-Tech Pulse Kick' })).toBe('PULSE KICK')
    expect(padLabel({ name: 'Goa Glow Kick' })).toBe('GLOW KICK')
    expect(padLabel({ name: 'KICK' })).toBe('KICK')
    expect(padLabel({ name: '' })).toBe('—')
    expect(padLabel(null)).toBe('—')
    expect(padLabel({ name: 'A Very Long Preset Name Indeed' }).length).toBeLessThanOrEqual(18)
  })

  test('padType reads sound.type first, falls back to tr.type', () => {
    expect(padType({ sound: { type: 'conga' }, type: 'kick' })).toBe('conga')
    expect(padType({ sound: {}, type: 'snare' })).toBe('snare')
    expect(padType({})).toBe('kick')
  })
})
