/**
 * PSY6 v0.10.0 P1 — sample store tests (pure, memory backend).
 *
 *  - id identity: fnv1a(name + length + sampleRate + first-4096-samples hash)
 *    → re-import idempotency; every input component changes the id
 *  - canonical record shape (key order) + normalize/reverse math
 *  - import guards (20 s / 50 MB) — honest refusals
 *  - persistence split: project JSON references by id + metadata ONLY
 *  - EXPORT bundle: base64 round-trip, missing ids reported, 30 MB guard
 */
import { describe, expect, test } from 'bun:test'
import { sampleId, makeRecord, memoryBackend, createSampleStore, normalizePcm, peakOf, reversedCopy, guardImport, exportBundle, importBundle, pcmToB64, b64ToPcm, referencedSampleIds, SAMPLE_CAPS } from '../js/samplestore.js'
import { compose } from '../js/composer.js'

const tone = (n: number, f = 0.0) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.sin((i + f) * 0.05) * 0.5; return a }

describe('sample identity (deterministic, idempotent)', () => {
  test('same inputs → same id; any component change → different id', () => {
    const a = tone(1000), b = tone(1000)
    const id1 = sampleId('kick.wav', 44100, 1000, a)
    const id2 = sampleId('kick.wav', 44100, 1000, b)
    expect(id1).toBe(id2)                      /* identical content → idempotent */
    expect(id1.startsWith('S')).toBe(true)
    expect(sampleId('kick2.wav', 44100, 1000, a)).not.toBe(id1)   /* name matters */
    expect(sampleId('kick.wav', 48000, 1000, a)).not.toBe(id1)    /* rate matters */
    expect(sampleId('kick.wav', 44100, 1001, a)).not.toBe(id1)    /* length matters */
    const c = tone(1000, 0.31)
    expect(sampleId('kick.wav', 44100, 1000, c)).not.toBe(id1)    /* first samples matter */
  })

  test('id is computed BEFORE normalize — re-import with NORM on/off keeps identity', () => {
    const raw = [tone(2000)]
    const r1 = makeRecord('hat', 44100, raw, { normalize: false, addedAt: 1 })
    const r2 = makeRecord('hat', 44100, raw, { normalize: true, addedAt: 2 })
    expect(r1.id).toBe(r2.id)
    expect(r2.peak).toBeCloseTo(SAMPLE_CAPS.normalizePeak, 7)   /* f32: measured, ≈0.95 */
    expect(r2.peak).toBeGreaterThan(r1.peak)
  })

  test('canonical record key order (load→save byte stability)', () => {
    const r = makeRecord('x', 44100, [tone(100)], { addedAt: 7 })
    expect(Object.keys(r)).toEqual(['id', 'name', 'sampleRate', 'channels', 'length', 'durationSec', 'peak', 'pcm', 'pcmReversed', 'addedAt'])
  })
})

describe('pcm math', () => {
  test('normalizePcm: peak → 0.95 (f32-exact ≈); silence untouched (never NaN)', () => {
    const n = normalizePcm([tone(500)], 0.95)
    expect(n.peak).toBeCloseTo(0.95, 7)                     /* metadata = measured f32 peak */
    expect(peakOf(n.channels)).toBeCloseTo(0.95, 7)
    const silent = [new Float32Array(64)]
    const s = normalizePcm(silent)
    expect(s.peak).toBe(0)
    expect(s.channels[0].every(v => v === 0)).toBe(true)
  })

  test('reversedCopy: exact mirror, multi-channel, odd length', () => {
    const a = new Float32Array([0.1, -0.2, 0.3, 0.4, 0.5])
    const b = new Float32Array([0.9, 0.8])
    const r = reversedCopy([a, b])
    expect(Array.from(r[0])).toEqual([0.5, 0.4, 0.3, -0.2, 0.1].map(Math.fround))
    expect(Array.from(r[1])).toEqual([0.8, 0.9].map(Math.fround))
    /* the mirror is EXACT in f32 terms: r[0][i] === a[len-1-i] bit-for-bit */
    for (let i = 0; i < a.length; i++) expect(r[0][i]).toBe(a[a.length - 1 - i])
  })
})

describe('import guards (documented caps)', () => {
  test('refusals: empty, >50MB, >20s; boundaries pass', () => {
    expect(guardImport(0, 1).ok).toBe(false)
    expect(guardImport(50 * 1024 * 1024 + 1, 1).ok).toBe(false)
    expect(guardImport(1000, 20.01).ok).toBe(false)
    expect(guardImport(50 * 1024 * 1024, 20).ok).toBe(true)
    expect(guardImport(1000, 0).ok).toBe(false)
  })
})

describe('store (memory backend)', () => {
  test('put/get/list/delete round-trip, addedAt-stable list order', async () => {
    const st = createSampleStore(memoryBackend())
    const r1 = makeRecord('aaa', 44100, [tone(900)], { addedAt: 20 })
    const r2 = makeRecord('bbb', 44100, [tone(900)], { addedAt: 10 })
    await st.put(r1); await st.put(r2)
    const got = await st.get(r1.id)
    expect(got && got.name).toBe('aaa')
    const rows = await st.list()
    expect(rows.map(r => r.name)).toEqual(['bbb', 'aaa'])   /* addedAt order */
    expect(await st.delete(r2.id)).toBe(true)
    expect(await st.get(r2.id)).toBeNull()
    const est = await st.estimate()
    expect(est.usage).toBeGreaterThan(0)
  })
})

describe('persistence split (the contract)', () => {
  test('project JSON references samples by id + metadata — NEVER PCM', () => {
    const p = compose('FULL-ON', 3, 424242).project
    p.tracks[0].sampleId = 'Sabc123'
    p.tracks[0].sampleMeta = { name: 'kick.wav', durationSec: 0.42, peak: 0.95 }
    const j = JSON.stringify(p)
    expect(j.includes('Sabc123')).toBe(true)
    expect(j.includes('"sampleMeta"')).toBe(true)
    expect(j.toLowerCase().includes('"pcm"')).toBe(false)   /* no PCM anywhere */
    expect(referencedSampleIds(p)).toEqual(['Sabc123'])
    p.tracks[3].sampleId = 'Sabc123'
    expect(referencedSampleIds(p)).toEqual(['Sabc123'])     /* deduped */
  })
})

describe('EXPORT bundle (base64, guarded)', () => {
  test('b64 codec round-trip is bit-exact', () => {
    const a = tone(3001)
    const b = b64ToPcm(pcmToB64(a))
    expect(b.length).toBe(a.length)
    for (let i = 0; i < a.length; i++) expect(b[i]).toBe(a[i])
  })

  test('export → import round-trip; missing ids reported honestly', async () => {
    const st = createSampleStore(memoryBackend())
    const rec = makeRecord('clap', 44100, [tone(4410), tone(4410)], { normalize: true, addedAt: 1 })
    await st.put(rec)
    const p = compose('FULL-ON', 3, 424242).project
    p.tracks[0].sampleId = rec.id
    p.tracks[2].sampleId = 'Smissing00'
    const b = await exportBundle(p, st)
    expect(b.ok).toBe(true)
    expect(b.records.length).toBe(1)
    expect(b.missing).toEqual(['Smissing00'])
    expect(b.overCap).toBe(false)
    /* fresh store (a new browser) — import rehydrates with identical identity */
    const st2 = createSampleStore(memoryBackend())
    const n = await importBundle(b.records, st2)
    expect(n).toBe(1)
    const back = await st2.get(rec.id)
    expect(back).not.toBeNull()
    expect(back!.sampleRate).toBe(rec.sampleRate)
    expect(back!.length).toBe(rec.length)
    for (let c = 0; c < 2; c++) for (let i = 0; i < rec.length; i++) expect(back!.pcm[c][i]).toBe(rec.pcm[c][i])
  })

  test('30 MB base64 hard guard trips', async () => {
    const st = createSampleStore(memoryBackend())
    const big = new Float32Array(6 * 1024 * 1024).fill(0.1)   /* 24 MB raw → ~32 MB b64 */
    const rec = makeRecord('huge', 44100, [big], { addedAt: 1 })
    await st.put(rec)
    const p = compose('FULL-ON', 3, 424242).project
    p.tracks[0].sampleId = rec.id
    const b = await exportBundle(p, st)
    expect(b.overCap).toBe(true)
    expect(b.b64Bytes).toBeGreaterThan(SAMPLE_CAPS.exportMaxBytes)
  })
})
