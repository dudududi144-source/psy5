import { describe, expect, test } from 'bun:test'
import {
  type ChordType,
  type RhythmPattern,
  type Scale,
  backbeat,
  chordNotes,
  chordPcs,
  chordTension,
  combine,
  degreeToMidi,
  density,
  drivingHats,
  fourOnFloor,
  fragment,
  generateBassPattern,
  generateMotif,
  getChordType,
  getScale,
  humanize,
  invert,
  invertRhythm,
  isInScale,
  listChordTypes,
  listScales,
  nameToPc,
  nearestDegree,
  offbeatHats,
  pcToName,
  psyKick,
  retrograde,
  rhythm,
  sampleTension,
  scalePcs,
  stableDegrees,
  swing,
  tensionToDensity,
  tensionToOctave,
  transpose,
  vary,
  voiceChord,
} from '../src/index.ts'

describe('scales', () => {
  test('phrygian-dominant scale is available with correct intervals', () => {
    const s = getScale('phrygian-dominant')
    expect(s).not.toBeNull()
    const pd = s as Scale
    expect(pd.intervals).toEqual([0, 1, 4, 5, 7, 8, 10])
  })

  test('scale aliases resolve to the same scale', () => {
    const a = getScale('spanish-gypsy') as Scale
    expect(a.name).toBe('phrygian-dominant')
    const b = getScale('phrygian-major') as Scale
    expect(b.name).toBe('phrygian-dominant')
    const c = getScale('aeolian') as Scale
    expect(c.name).toBe('minor')
  })

  test('listScales returns at least 15 scales', () => {
    expect(listScales().length).toBeGreaterThanOrEqual(15)
  })

  test('scalePcs returns the pitch classes for a root', () => {
    const major = getScale('major') as Scale
    expect(scalePcs(0, major)).toEqual([0, 2, 4, 5, 7, 9, 11])
    // D major: D E F# G A B C#
    expect(scalePcs(2, major)).toEqual([2, 4, 6, 7, 9, 11, 1])
  })

  test('degreeToMidi wraps across octaves', () => {
    const major = getScale('major') as Scale
    expect(degreeToMidi(0, major, 0, 4)).toBe(60) // C4
    expect(degreeToMidi(0, major, 7, 4)).toBe(72) // C5 (one octave up)
    expect(degreeToMidi(0, major, -1, 4)).toBe(59) // B3 (one degree below root)
  })

  test('isInScale detects scale membership', () => {
    const major = getScale('major') as Scale
    expect(isInScale(0, major, 60)).toBe(true) // C4
    expect(isInScale(0, major, 61)).toBe(false) // C#4
    expect(isInScale(0, major, 62)).toBe(true) // D4
    expect(isInScale(0, major, 72)).toBe(true) // C5
  })

  test('nearestDegree finds the closest scale degree', () => {
    const major = getScale('major') as Scale
    expect(nearestDegree(0, major, 60)).toBe(0) // C -> degree 0
    expect(nearestDegree(0, major, 62)).toBe(1) // D -> degree 1
    expect(nearestDegree(0, major, 64)).toBe(2) // E -> degree 2
    expect(nearestDegree(0, major, 67)).toBe(4) // G -> degree 4
  })

  test('stableDegrees returns root and fifth indices', () => {
    const major = getScale('major') as Scale
    expect(stableDegrees(major)).toEqual([0, 4])
    const minor = getScale('minor') as Scale
    expect(stableDegrees(minor)).toEqual([0, 4])
    const penta = getScale('major-pentatonic') as Scale
    // [0,2,4,7,9] -> fifth (7) is at index 3
    expect(stableDegrees(penta)).toEqual([0, 3])
  })

  test('pcToName and nameToPc round-trip all 12 pitch classes', () => {
    for (let pc = 0; pc < 12; pc++) {
      const name = pcToName(pc)
      expect(nameToPc(name)).toBe(pc)
    }
    expect(pcToName(0)).toBe('C')
    expect(pcToName(1)).toBe('C#')
    expect(pcToName(11)).toBe('B')
  })
})

describe('chords', () => {
  test('major chord has intervals [0, 4, 7]', () => {
    const maj = getChordType('major') as ChordType
    expect(maj.intervals).toEqual([0, 4, 7])
  })

  test('dom7 is reachable via the "7" alias', () => {
    const dom = getChordType('7') as ChordType
    expect(dom.name).toBe('dom7')
    expect(dom.intervals).toEqual([0, 4, 7, 10])
  })

  test('chordNotes returns midi notes at the requested octave', () => {
    const maj = getChordType('major') as ChordType
    // C major at octave 4: C4=60, E4=64, G4=67
    expect(chordNotes(0, maj)).toEqual([60, 64, 67])
    // A minor at octave 4: A4=69, C5=72, E5=76
    const min = getChordType('minor') as ChordType
    expect(chordNotes(9, min)).toEqual([69, 72, 76])
  })

  test('chordPcs returns wrapped pitch classes', () => {
    const dom9 = getChordType('dom9') as ChordType
    // G dom9: G B D F A -> pcs [7, 11, 2, 5, 9]
    expect(chordPcs(7, dom9)).toEqual([7, 11, 2, 5, 9])
  })

  test('chordTension: major is less tense than dim7', () => {
    const major = getChordType('major') as ChordType
    const dim7 = getChordType('dim7') as ChordType
    expect(chordTension(major)).toBeLessThan(chordTension(dim7))
    expect(chordTension(major)).toBeLessThanOrEqual(0.5)
    expect(chordTension(dim7)).toBeGreaterThan(0.3)
  })

  test('voiceChord without previous returns default close-position voicing', () => {
    const maj = getChordType('major') as ChordType
    const voiced = voiceChord(0, maj, undefined)
    expect(voiced).toEqual([60, 64, 67])
  })

  test('voiceChord with previous voicing leads smoothly', () => {
    const maj = getChordType('major') as ChordType
    const prev = chordNotes(0, maj) // C major: [60, 64, 67]
    // D major target: pcs [2, 6, 9]; nearest to prev -> [62, 66, 69]
    const voiced = voiceChord(2, maj, prev)
    expect(voiced.length).toBe(3)
    const movement = voiced.reduce((sum, n, i) => sum + Math.abs(n - (prev[i] as number)), 0)
    expect(movement).toBeLessThan(12) // less than an octave total movement
    // All notes should be within an octave of the previous voicing
    for (let i = 0; i < voiced.length; i++) {
      expect(Math.abs((voiced[i] as number) - (prev[i] as number))).toBeLessThanOrEqual(6)
    }
  })

  test('listChordTypes returns at least 15 chord types', () => {
    expect(listChordTypes().length).toBeGreaterThanOrEqual(15)
  })
})

describe('motif', () => {
  test('generateMotif produces in-scale notes', () => {
    const scale = getScale('major') as Scale
    const notes = generateMotif(0, scale, { seed: 1, steps: 32 })
    expect(notes.length).toBeGreaterThan(0)
    for (const n of notes) {
      expect(isInScale(0, scale, n.midi)).toBe(true)
    }
  })

  test('generateMotif is deterministic for a given seed', () => {
    const scale = getScale('major') as Scale
    const a = generateMotif(0, scale, { seed: 1, steps: 16 })
    const b = generateMotif(0, scale, { seed: 1, steps: 16 })
    expect(a).toEqual(b)
  })

  test('different seeds produce different motifs', () => {
    const scale = getScale('major') as Scale
    const a = generateMotif(0, scale, { seed: 1, steps: 32 })
    const b = generateMotif(0, scale, { seed: 2, steps: 32 })
    expect(a).not.toEqual(b)
  })

  test('generateMotif ends on the root on the final step', () => {
    const scale = getScale('major') as Scale
    const notes = generateMotif(0, scale, { seed: 1, steps: 32 })
    const last = notes[notes.length - 1] as { step: number; midi: number }
    expect(last.step).toBe(31)
    expect(last.midi).toBe(degreeToMidi(0, scale, 0, 4))
  })

  test('transpose shifts notes by scale degrees and stays in scale', () => {
    const scale = getScale('major') as Scale
    const notes = generateMotif(0, scale, { seed: 1, steps: 16 })
    const t = transpose(notes, 0, scale, 2)
    expect(t.length).toBe(notes.length)
    const len = scale.intervals.length
    for (let i = 0; i < notes.length; i++) {
      // Transposed note remains in scale
      expect(isInScale(0, scale, t[i].midi as number)).toBe(true)
      // Degree shifted by exactly 2 (mod scale length)
      const oldDeg = nearestDegree(0, scale, notes[i].midi as number)
      const newDeg = nearestDegree(0, scale, t[i].midi as number)
      const diff = (((newDeg - oldDeg) % len) + len) % len
      expect(diff).toBe(2)
    }
  })

  test('invert mirrors the contour around the first note', () => {
    const scale = getScale('major') as Scale
    const notes = generateMotif(0, scale, { seed: 1, steps: 16 })
    const inv = invert(notes, 0, scale)
    expect(inv.length).toBe(notes.length)
    // First note unchanged
    const first = notes[0] as { midi: number }
    const invFirst = inv[0] as { midi: number }
    expect(invFirst.midi).toBe(first.midi)
    // All inverted notes remain in scale
    for (const n of inv) {
      expect(isInScale(0, scale, n.midi)).toBe(true)
    }
  })

  test('fragment keeps only the first N notes', () => {
    const scale = getScale('major') as Scale
    const notes = generateMotif(0, scale, { seed: 1, steps: 32 })
    const f = fragment(notes, 3)
    expect(f.length).toBe(3)
    expect(f[0]).toEqual(notes[0])
  })

  test('retrograde reverses note order', () => {
    const scale = getScale('major') as Scale
    const notes = generateMotif(0, scale, { seed: 1, steps: 16 })
    const r = retrograde(notes)
    expect(r.length).toBe(notes.length)
    const first = notes[0] as { midi: number }
    const last = notes[notes.length - 1] as { midi: number }
    const rFirst = r[0] as { midi: number }
    const rLast = r[r.length - 1] as { midi: number }
    expect(rFirst.midi).toBe(last.midi)
    expect(rLast.midi).toBe(first.midi)
  })

  test('vary with "none" returns an equal-valued copy', () => {
    const scale = getScale('major') as Scale
    const notes = generateMotif(0, scale, { seed: 1, steps: 16 })
    const v = vary(notes, 0, scale, 'none')
    expect(v).not.toBe(notes) // different reference
    expect(v).toEqual(notes) // same content
  })
})

describe('bass', () => {
  test('kb3 pattern generates 5 notes (kick + 4 offbeats)', () => {
    const scale = getScale('minor') as Scale
    const notes = generateBassPattern(0, scale, { style: 'kb3' })
    expect(notes.length).toBe(5)
    const steps = notes.map((n) => n.step)
    expect(steps).toEqual([0, 2, 6, 10, 14])
  })

  test('four-on-floor places 4 notes on beats 0, 4, 8, 12', () => {
    const scale = getScale('minor') as Scale
    const notes = generateBassPattern(0, scale, { style: 'four-on-floor' })
    expect(notes.length).toBe(4)
    expect(notes.map((n) => n.step)).toEqual([0, 4, 8, 12])
  })

  test('bass pattern is deterministic for a given seed', () => {
    const scale = getScale('minor') as Scale
    const a = generateBassPattern(0, scale, { seed: 42 })
    const b = generateBassPattern(0, scale, { seed: 42 })
    expect(a).toEqual(b)
  })

  test('sampleTension: build rises, peak maxes at midpoint, valley minimises at midpoint', () => {
    expect(sampleTension('build', 0.5)).toBeGreaterThan(sampleTension('build', 0))
    expect(sampleTension('build', 1)).toBeGreaterThan(sampleTension('build', 0.5))
    expect(sampleTension('peak', 0.5)).toBeGreaterThan(0.9)
    expect(sampleTension('peak', 0)).toBeLessThan(0.1)
    expect(sampleTension('valley', 0.5)).toBeLessThan(0.1)
    expect(sampleTension('valley', 0)).toBeGreaterThan(0.9)
    expect(sampleTension('flat', 0.5)).toBe(0.5)
  })

  test('tensionToDensity is monotonically non-decreasing', () => {
    const d0 = tensionToDensity(0)
    const d05 = tensionToDensity(0.5)
    const d1 = tensionToDensity(1)
    expect(d0).toBeLessThanOrEqual(d05)
    expect(d05).toBeLessThanOrEqual(d1)
  })

  test('tensionToOctave increases (or stays) with tension', () => {
    const o0 = tensionToOctave(0, 3)
    const o05 = tensionToOctave(0.5, 3)
    const o1 = tensionToOctave(1, 3)
    expect(o0).toBeLessThanOrEqual(o05)
    expect(o05).toBeLessThanOrEqual(o1)
    expect(o1).toBeGreaterThanOrEqual(o0)
  })
})

describe('rhythm', () => {
  test('fourOnFloor places hits on every 4th step', () => {
    const p = fourOnFloor(16) as RhythmPattern
    expect(p.hits.filter((h) => h).length).toBe(4)
    expect(p.hits[0]).toBe(true)
    expect(p.hits[4]).toBe(true)
    expect(p.hits[8]).toBe(true)
    expect(p.hits[12]).toBe(true)
    expect(p.hits[1]).toBe(false)
  })

  test('offbeatHats places hits on the offbeats', () => {
    const p = offbeatHats(16) as RhythmPattern
    expect(p.hits.filter((h) => h).length).toBe(4)
    expect(p.hits[2]).toBe(true)
    expect(p.hits[6]).toBe(true)
    expect(p.hits[10]).toBe(true)
    expect(p.hits[14]).toBe(true)
    expect(p.hits[0]).toBe(false)
  })

  test('psyKick has 4 kicks on beats 1-4', () => {
    const p = psyKick() as RhythmPattern
    expect(p.hits.filter((h) => h).length).toBe(4)
    expect(p.hits.length).toBe(16)
    expect(p.hits[0]).toBe(true)
    expect(p.hits[4]).toBe(true)
    expect(p.hits[8]).toBe(true)
    expect(p.hits[12]).toBe(true)
  })

  test('drivingHats hits every step and accents downbeats', () => {
    const p = drivingHats(16) as RhythmPattern
    expect(p.hits.every((h) => h)).toBe(true)
    expect(p.velocities).toBeDefined()
    const vel = p.velocities as number[]
    expect(vel[0]).toBe(1.0)
    expect(vel[4]).toBe(1.0)
    expect(vel[8]).toBe(1.0)
    expect(vel[12]).toBe(1.0)
    expect(vel[1]).toBe(0.5)
    expect(vel[2]).toBe(0.5)
  })

  test('swing delays odd-indexed hits via micros', () => {
    const p = drivingHats(8) as RhythmPattern
    const swung = swing(p, 0.5) as RhythmPattern
    expect(swung.micros).toBeDefined()
    const micros = swung.micros as number[]
    expect(micros[0]).toBe(0)
    expect(micros[1]).toBe(0.5)
    expect(micros[3]).toBe(0.5)
    // Even-indexed micros remain 0
    expect(micros[2]).toBe(0)
    expect(micros[4]).toBe(0)
  })

  test('humanize is deterministic for a given seed', () => {
    const p = drivingHats(8) as RhythmPattern
    const a = humanize(p, 0.01, 42) as RhythmPattern
    const b = humanize(p, 0.01, 42) as RhythmPattern
    expect(a.micros).toEqual(b.micros)
    // Different seed -> different micros
    const c = humanize(p, 0.01, 7) as RhythmPattern
    expect(a.micros).not.toEqual(c.micros)
  })

  test('combine merges two patterns via OR', () => {
    const a = fourOnFloor(8) as RhythmPattern // [T,F,F,F,T,F,F,F]
    const b = offbeatHats(8) as RhythmPattern // [F,F,T,F,F,F,T,F]
    const c = combine(a, b) as RhythmPattern
    expect(c.hits).toEqual([true, false, true, false, true, false, true, false])
  })

  test('invertRhythm flips hits to rests and vice versa', () => {
    const p = fourOnFloor(8) as RhythmPattern
    const inv = invertRhythm(p) as RhythmPattern
    expect(inv.hits).toEqual([false, true, true, true, false, true, true, true])
  })

  test('density returns the fraction of true hits', () => {
    expect(density(fourOnFloor(16))).toBe(0.25)
    expect(density(drivingHats(16))).toBe(1.0)
    expect(density({ hits: [false, false, false, false] })).toBe(0)
  })

  test('backbeat places hits on beats 2 and 4 (steps 4 and 12)', () => {
    const p = backbeat(16) as RhythmPattern
    expect(p.hits.filter((h) => h).length).toBe(2)
    expect(p.hits[4]).toBe(true)
    expect(p.hits[12]).toBe(true)
    expect(p.hits[0]).toBe(false)
    expect(p.hits[8]).toBe(false)
  })

  test('rhythm builder constructs a pattern from hits and velocities', () => {
    const p = rhythm([true, false, true, false], { velocities: [1.0, 0, 0.5, 0] }) as RhythmPattern
    expect(p.hits).toEqual([true, false, true, false])
    expect(p.velocities).toEqual([1.0, 0, 0.5, 0])
  })
})
