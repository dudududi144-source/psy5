/**
 * PSY6 v0.10.0 P4 — composer sample hints (pure — memory backend).
 *
 *  - COMPOSER_SAMPLE_HINTS shape: track slots {0,3,6} → names, NAMES ONLY
 *  - applySampleHints: hit → sample voice + id/meta; miss → reported, synth
 *    kept; never throws; idempotent
 *  - loadProjectObj canonical backfill: names-only map, invalid dropped,
 *    absent stays absent; no PCM anywhere
 */
import { describe, expect, test } from 'bun:test'
import { applySampleHints, makeRecord, memoryBackend, createSampleStore } from '../js/samplestore.js'
import { compose, COMPOSER_SAMPLE_HINTS } from '../js/composer.js'
import { loadProjectObj } from '../js/state.js'

const clone = (x: any) => JSON.parse(JSON.stringify(x))

describe('composer sample hints', () => {
  test('COMPOSER_SAMPLE_HINTS: the kick/perc/atmos slots, names only', () => {
    expect(Object.keys(COMPOSER_SAMPLE_HINTS).sort()).toEqual(['0', '3', '6'])
    for (const v of Object.values(COMPOSER_SAMPLE_HINTS)) {
      expect(typeof v).toBe('string')
      expect(v.length).toBeGreaterThan(0)
      expect(v.length).toBeLessThanOrEqual(32)
    }
    expect(compose('FULL-ON', 3, 424242).sampleHints).toEqual(COMPOSER_SAMPLE_HINTS)
  })

  test('applySampleHints: hit applies the sample voice; miss reported, synth kept', async () => {
    const st = createSampleStore(memoryBackend())
    await st.put(makeRecord('kick', 44100, [new Float32Array(4410).fill(0.4)], { addedAt: 1 }))
    const p: any = compose('FULL-ON', 3, 424242).project
    p.sampleHints = { 0: 'kick', 3: 'perc', 6: 'atmos' }
    const r = await applySampleHints(p, st)
    expect(r.applied).toBe(1)
    expect(r.appliedNames).toEqual(['kick'])
    expect(r.missing).toEqual(['perc (track 3)', 'atmos (track 6)'])
    /* hit: the sample voice is fully baked (mode + id + metadata) */
    expect(p.tracks[0].voiceMode).toBe('sample')
    expect(p.tracks[0].sampleId).toBe((await st.get(p.tracks[0].sampleId))!.id)
    expect(p.tracks[0].sampleMeta.name).toBe('kick')
    /* misses: synth voice untouched */
    expect(p.tracks[3].voiceMode).toBe('synth')
    expect(p.tracks[6].voiceMode).toBe('synth')
    /* idempotent: re-apply → same result, no duplicates */
    const r2 = await applySampleHints(p, st)
    expect(r2.applied).toBe(1)
    expect(p.tracks[0].sampleId).toBe(p.tracks[0].sampleId)
  })

  test('project JSON carries NAMES only — never PCM', () => {
    const p: any = compose('FULL-ON', 3, 424242).project
    p.sampleHints = { 0: 'kick' }
    const j = JSON.stringify(p)
    expect(j.includes('"sampleHints"')).toBe(true)
    expect(j.toLowerCase().includes('"pcm"')).toBe(false)
  })

  test('loadProjectObj canonical backfill: garbage dropped, names capped, absent stays absent', () => {
    const p: any = compose('FULL-ON', 3, 424242).project
    p.sampleHints = { 0: '  kick  ', 99: 'ghost', 2: 42, 4: '' }
    const loaded = loadProjectObj(clone(p))
    expect(loaded.sampleHints).toEqual({ 0: 'kick' })
    const bare = loadProjectObj(clone(compose('FULL-ON', 3, 424242).project))
    expect(bare.sampleHints).toBeUndefined()
    /* byte-stable across loads */
    expect(JSON.stringify(loadProjectObj(clone(loaded)))).toBe(JSON.stringify(loaded))
  })
})
