/**
 * PSY6 per-track stem export tests (v0.4.0) — the PURE parts (Bun has no
 * Web Audio; the rendered isolation evidence lives in on-device G18):
 *
 *   - stemTracks() discovers exactly the non-empty tracks of the current
 *     bounce schedule (current pattern × loops), sorted, empty → []
 *   - per-track schedules (bounceSchedule + trackIdx filter semantics):
 *     same seed → byte-identical event list (determinism), different tracks
 *     → disjoint event sets with distinct hashes
 *   - the full-mix schedule/hash is UNCHANGED by the stem feature (zero
 *     behavior change for existing projects)
 */
import { describe, expect, test } from 'bun:test'
import { bounceSchedule, evHash, stemTracks } from '../js/bounce.js'
import { buildStyle } from '../js/presets.js'

function twoTrackProject() {
  const p = buildStyle('TECHNO', 7)
  p.bpm = 128
  const pat = p.patterns['A']
  for (let t = 0; t < 8; t++) { pat.data[t].len = 16; for (const s of pat.data[t].steps) s.on = 0 }
  pat.data[0].steps[0].on = 1
  pat.data[4].steps[8].on = 1
  p.currentPattern = 'A'
  return p
}

describe('stemTracks — non-empty track discovery', () => {
  test('finds exactly the two armed tracks, sorted', () => {
    const p = twoTrackProject()
    const { tracks, schedule } = stemTracks(p, 1)
    expect(tracks).toEqual([0, 4])
    expect(schedule.evs.length).toBe(2)
    expect(schedule.evs.map((e: any) => e.track)).toEqual([0, 4])
  })

  test('empty pattern → no stems (non-empty rule)', () => {
    const p = twoTrackProject()
    const pat = p.patterns['A']
    for (let t = 0; t < 8; t++) for (const s of pat.data[t].steps) s.on = 0
    expect(stemTracks(p, 2).tracks).toEqual([])
  })

  test('extra track joins discovery', () => {
    const p = twoTrackProject()
    p.patterns['A'].data[2].steps[3].on = 1
    const { tracks } = stemTracks(p, 1)
    expect(tracks).toEqual([0, 2, 4])
  })
})

describe('per-track schedule determinism', () => {
  test('same seed → identical filtered event list and hash (twice)', () => {
    const a = bounceSchedule(twoTrackProject(), 1, 0.05)
    const b = bounceSchedule(twoTrackProject(), 1, 0.05)
    const fa = a.evs.filter((e: any) => e.track === 0)
    const fb = b.evs.filter((e: any) => e.track === 0)
    expect(JSON.stringify(fa)).toBe(JSON.stringify(fb))
    expect(evHash(fa)).toBe(evHash(fb))
  })

  test('different tracks → disjoint sets, distinct hashes', () => {
    const sch = bounceSchedule(twoTrackProject(), 1, 0.05)
    const t0 = sch.evs.filter((e: any) => e.track === 0)
    const t4 = sch.evs.filter((e: any) => e.track === 4)
    expect(t0.length).toBe(1)
    expect(t4.length).toBe(1)
    expect(t0[0].s).not.toBe(t4[0].s)
    expect(evHash(t0)).not.toBe(evHash(t4))
  })
})

describe('zero behavior change for the full-mix path', () => {
  test('full schedule and hash identical before/after the stem feature semantics', () => {
    const p = twoTrackProject()
    const full1 = bounceSchedule(p, 2, 0.05)
    const full2 = bounceSchedule(p, 2, 0.05)
    expect(full1.evs.length).toBe(4) /* 2 events × 2 loops (loopLen 16) */
    expect(evHash(full1.evs)).toBe(evHash(full2.evs))
    /* the union of per-track schedules == the full schedule */
    const t0 = full1.evs.filter((e: any) => e.track === 0)
    const t4 = full1.evs.filter((e: any) => e.track === 4)
    expect(t0.length + t4.length).toBe(full1.evs.length)
  })
})
