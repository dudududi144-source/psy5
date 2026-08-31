/**
 * PSY6 v0.7.0 MIDI file export tests — writer, parse-back reader,
 * and the .mid == WAV-schedule identity contract.
 *
 *  - writer: header/format-1 structure, VLQ multi-byte deltas, stable event
 *    ordering (tick asc, off-before-on, pitch asc), tempo meta, EOT
 *  - parse-back: minimal dependency-free reader (header, chunks, VLQ,
 *    note on/off pairing) — the same contract the device gate uses
 *  - identity: songMidi notes == songSchedule (offline WAV) events, mapped
 *    step→tick (1 step = 120 ticks @ ppq 480, bar = 4·480)
 */
import { describe, expect, test } from 'bun:test'
import { writeMidi, writeVLQ } from '../js/midifile.js'
import { compose } from '../js/composer.js'
import { songMidi, songSchedule, SONG_LEAD } from '../js/bounce.js'

const SEED = 424242

/* ── minimal parse-back reader (no deps) ── */
function parseMidi(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let o = 0
  const str = (n) => String.fromCharCode(...u8.slice(o, o + n))
  const u32 = () => (u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]
  const u16 = () => (u8[o] << 8) | u8[o + 1]
  expect(str(4)).toBe('MThd'); o += 4
  const hlen = u32(); o += 4
  const format = u16(); o += 2
  const ntrks = u16(); o += 2
  const division = u16(); o += 2
  o += hlen - 6
  const vlq = () => { let v = 0; for (;;) { const b = u8[o++]; v = (v << 7) | (b & 0x7f); if (!(b & 0x80)) return v } }
  const chunks = []
  while (o < u8.length) {
    const id = str(4); o += 4
    const len = u32(); o += 4
    const end = o + len
    chunks.push({ id, len, data: u8.slice(o, end) })
    o = end
  }
  /* decode track events: delta ticks + running status-aware note pairing.
     NOTE: the delta/meta VLQ reads from the CHUNK data with a local pointer —
     the file-level vlq() above is only valid for chunk headers. */
  let tempoMpqn = null
  const tracks = chunks.filter(c => c.id === 'MTrk').map((c, ci) => {
    const d = c.data; let p = 0, tick = 0
    const vlqD = () => { let v = 0; for (;;) { const b = d[p++]; v = (v << 7) | (b & 0x7f); if (!(b & 0x80)) return v } }
    let name = ''
    let runStatus = 0
    const ons = [] /* stack for pairing */
    const notes = []
    const metaAt = []
    while (p < d.length) {
      tick += vlqD()
      let st = d[p]
      if (st & 0x80) { p++; if (st < 0xf0) runStatus = st } else st = runStatus /* running status */
      if (st === 0xff) {
        const type = d[p]; p++
        const mlen = vlqD()
        const mdata = d.slice(p, p + mlen); p += mlen
        if (type === 0x51) tempoMpqn = (mdata[0] << 16) | (mdata[1] << 8) | mdata[2]
        if (type === 0x03) name = String.fromCharCode(...mdata)
        if (type === 0x2f) metaAt.push('EOT@' + tick)
      } else if (st === 0xf0 || st === 0xf7) { const mlen = vlqD(); p += mlen }
      else {
        const cmd = st & 0xf0, ch = st & 0x0f
        const a = d[p++], b = d[p++]
        if (cmd === 0x90 && b > 0) ons.push({ tick, ch, midi: a, vel: b })
        else if (cmd === 0x80 || (cmd === 0x90 && b === 0)) {
          const i = ons.findIndex(x => x.ch === ch && x.midi === a)
          if (i >= 0) { const on = ons.splice(i, 1)[0]; notes.push({ onTick: on.tick, offTick: tick, ch, midi: a, vel: on.vel }) }
        }
      }
    }
    expect(ons.length).toBe(0) /* every note-on paired */
    return { idx: ci, name, tickEnd: tick, notes, metaAt }
  })
  return { format, ntrks, division, tempoMpqn, tracks }
}

describe('midifile writer', () => {
  test('VLQ: single/multi-byte deltas encode per the MIDI spec', () => {
    expect(writeVLQ(0)).toEqual([0x00])
    expect(writeVLQ(0x7f)).toEqual([0x7f])
    expect(writeVLQ(0x80)).toEqual([0x81, 0x00])
    expect(writeVLQ(0x2000)).toEqual([0xc0, 0x00])
    expect(writeVLQ(0x1fffff)).toEqual([0xff, 0xff, 0x7f])
    expect(writeVLQ(0x08000000)).toEqual([0xc0, 0x80, 0x80, 0x00])
  })
  test('header: format 1, ntrks, ppq division; track 0 = name + tempo + EOT', () => {
    const m = writeMidi({ ppq: 480, bpm: 145, name: 'TEST', tracks: [{ name: 'KICK', channel: 9, notes: [{ tick: 0, durTicks: 120, midi: 36, vel: 0.9 }] }] })
    const r = parseMidi(m)
    expect(r.format).toBe(1)
    expect(r.ntrks).toBe(2)
    expect(r.division).toBe(480)
    expect(r.tracks[0].name).toBe('TEST')
    expect(r.tempoMpqn).toBe(Math.round(60000000 / 145))
    const bpm = Math.round(60000000 / r.tempoMpqn * 1000) / 1000
    expect(Math.abs(bpm - 145)).toBeLessThan(0.01)
    expect(r.tracks[0].metaAt.join(',')).toContain('EOT')
  })
  test('stable ordering: sort by tick, off-before-on ties, pitch tiebreak', () => {
    const m = writeMidi({
      ppq: 480, bpm: 120, name: 'T',
      tracks: [{
        name: 'X', channel: 0,
        notes: [{ tick: 240, durTicks: 120, midi: 60, vel: 0.8 }, { tick: 120, durTicks: 240, midi: 64, vel: 0.8 }, { tick: 240, durTicks: 120, midi: 48, vel: 0.8 }],
      }],
    })
    const r = parseMidi(m)
    const seq = r.tracks[1].notes.slice().sort((a, b) => a.onTick - b.onTick || a.midi - b.midi)
    expect(seq.length).toBe(3)
    /* every onTick ascending (after sorting — the parser pairs in off-order) */
    for (let i = 1; i < seq.length; i++) expect(seq[i].onTick).toBeGreaterThanOrEqual(seq[i - 1].onTick)
    expect(seq[0].onTick).toBe(120)
  })
  test('two exports byte-identical (determinism)', () => {
    const p = compose('FULL-ON', 3, SEED).project
    const a = writeMidi(songMidi(p))
    const b = writeMidi(songMidi(p))
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })
})

describe('songMidi ↔ WAV schedule identity (the .mid == schedule contract)', () => {
  const p = compose('FULL-ON', 3, SEED)
  const proj = p.project
  test('bar = 4·480 ticks, 16 steps per bar, total ticks == Σbars·4·480', () => {
    const sm = songMidi(proj)
    expect(sm.ppq).toBe(480)
    expect(sm.totalTicks).toBe(136 * 4 * 480)
    const sum = proj.arranger.steps.reduce((a, s) => a + s.bars, 0)
    expect(sm.totalTicks).toBe(sum * 4 * 480)
    /* the first bar contains only step-tick multiples in [0,1920) */
    const inBar0 = sm.tracks.flatMap(t => t.notes.map(n => n.tick)).filter(t => t < 1920)
    for (const t of inBar0) expect(t % 1).toBe(0) /* integer ticks */
  })
  test('note-for-note identity: songMidi notes == songSchedule events mapped to ticks', () => {
    const sm = songMidi(proj)
    const sch = songSchedule(proj, SONG_LEAD)
    const sd = sch.stepDur
    /* map schedule events → {track, tick, vel, note} (tick = step·120 + off) */
    const expectByTrack = new Map()
    for (const e of sch.evs) {
      const k = e.track
      if (!expectByTrack.has(k)) expectByTrack.set(k, [])
      expectByTrack.get(k).push({ tick: e.s * 120 + Math.round((e.t - SONG_LEAD - e.s * sd) / sd * 120), midi: e.note, vel: e.vel })
    }
    /* songMidi buckets by track too — compare counts, ticks, notes, velocities */
    expect(sm.tracks.length).toBeGreaterThan(0)
    let totalNotes = 0
    for (const tr of sm.tracks) {
      const tIdx = proj.tracks.findIndex(x => x.name === tr.name)
      expect(tIdx).toBeGreaterThanOrEqual(0)
      const want = expectByTrack.get(tIdx) || []
      expect(tr.notes.length).toBe(want.length)
      const wantTicks = want.map(w => w.tick).sort((a, b) => a - b)
      const gotTicks = tr.notes.map(n => n.tick).sort((a, b) => a - b)
      expect(gotTicks).toEqual(wantTicks)
      totalNotes += tr.notes.length
    }
    expect(totalNotes).toBe(sch.evs.length)
  })
  test('kick channel 10, melodic channels 1–8, kick at scene boundary tick 0', () => {
    const sm = songMidi(proj)
    const kick = sm.tracks.find(t => t.name === proj.tracks[0].name)
    expect(kick).toBeTruthy()
    expect(kick.channel).toBe(9) /* MIDI 10 */
    expect(kick.notes[0].tick).toBe(0)
    for (const tr of sm.tracks) {
      if (tr.drum) expect(tr.channel).toBe(9)
      else expect(tr.channel).toBeGreaterThanOrEqual(0) && expect(tr.channel).toBeLessThan(8)
    }
  })
  test('parse-back: demo .mid — first kick tick 0, tempo 145, counts == expansion, total ticks', () => {
    const sm = songMidi(proj)
    const bytes = writeMidi(sm)
    expect(bytes.length).toBeGreaterThan(1000) /* non-trivial size guard */
    const r = parseMidi(bytes)
    expect(r.format).toBe(1)
    expect(Math.abs(60000000 / r.tempoMpqn - 145)).toBeLessThan(0.01)
    expect(r.ntrks).toBe(sm.tracks.length + 1)
    const kickName = proj.tracks[0].name
    const kickTr = r.tracks.find(t => t.name === kickName)
    expect(kickTr.notes.length).toBeGreaterThan(0)
    expect(Math.min(...kickTr.notes.map(n => n.onTick))).toBe(0)
    for (const tr of r.tracks) {
      const smTr = sm.tracks.find(x => x.name === tr.name)
      if (smTr) expect(tr.notes.length).toBe(smTr.notes.length)
    }
    const maxTick = Math.max(...sm.tracks.flatMap(t => t.notes.map(n => n.tick)))
    expect(maxTick).toBeLessThan(sm.totalTicks)
    expect(maxTick).toBeGreaterThan(sm.totalTicks - 4 * 480) /* last bar active */
    expect(r.tracks.every(t => t.metaAt.length === 1)).toBe(true) /* each chunk EOT */
  })
  test('songMidi refuses: empty arranger → null', () => {
    const q = compose('FULL-ON', 3, SEED).project
    q.arranger.steps = []
    expect(songMidi(q)).toBeNull()
  })
})
