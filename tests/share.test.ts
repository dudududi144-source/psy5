/**
 * PSY6 share-link tests (v0.4.0).
 *
 * js/share.js is DOM-free: canonical JSON ordering pinned, deflate-raw via
 * CompressionStream (available in Bun), base64url token. Covered:
 *   - canonical ordering: two structurally equal projects with DIFFERENT
 *     key insertion order produce the identical canonical string
 *   - round-trip: encode → decode → deep-equal (canonical form both sides)
 *   - determinism: same project → byte-identical token (twice)
 *   - learner snapshot (p.copilot) survives the round trip
 *   - legacy project without new fields (midiMap/masterVol) loads via
 *     loadProjectObj backfill after a share round-trip
 *   - size-guard thresholds + base64url alphabet (URL-safe, no padding)
 *   - parseShareHash accepts only #p=<token>
 */
import { describe, expect, test } from 'bun:test'
import {
  canonicalProject, encodeShare, decodeShare, parseShareHash,
  SHARE_WARN_BYTES, SHARE_MAX_BYTES,
} from '../js/share.js'
import { buildStyle } from '../js/presets.js'
import { loadProjectObj } from '../js/state.js'
import { mulberry32 } from '../foundation/foundation.mjs'

describe('canonical JSON ordering', () => {
  test('key insertion order does not matter — canonical strings are identical', () => {
    const a = { bpm: 130, seed: 'X', tracks: [{ name: 'KICK', mix: { vol: 1, mute: false } }] }
    const b = { tracks: [{ mix: { mute: false, vol: 1 }, name: 'KICK' }], seed: 'X', bpm: 130 }
    expect(canonicalProject(a)).toBe(canonicalProject(b))
  })

  test('array order is preserved (steps are musical meaning)', () => {
    const a = { steps: [1, 0, 3] }
    const b = { steps: [3, 0, 1] }
    expect(canonicalProject(a)).not.toBe(canonicalProject(b))
  })
})

describe('share round-trip', () => {
  test('encode → decode deep-equals the original project', async () => {
    const p = buildStyle('PSYTRANCE', 42)
    const r = await encodeShare(p)
    expect(r.ok).toBe(true)
    const d = await decodeShare(r.token!)
    expect(d.ok).toBe(true)
    expect(canonicalProject(d.project)).toBe(canonicalProject(p))
  })

  test('same project → byte-identical token (determinism, twice)', async () => {
    const p = buildStyle('PSYTRANCE', 42)
    const r1 = await encodeShare(p)
    const r2 = await encodeShare(p)
    expect(r1.token).toBe(r2.token)
    const r3 = await encodeShare(buildStyle('PSYTRANCE', 42))
    expect(r3.token).toBe(r1.token)
  })

  test('different seed → different token', async () => {
    const r1 = await encodeShare(buildStyle('PSYTRANCE', 42))
    const r2 = await encodeShare(buildStyle('PSYTRANCE', 43))
    expect(r1.token).not.toBe(r2.token)
  })

  test('learner snapshot (p.copilot) survives', async () => {
    const p = buildStyle('TECHNO', 7)
    p.copilot = { v: 1, records: [{ k: 'test', a: 'fill', r: 1 }], stats: { decisions: 5 } }
    const d = await decodeShare((await encodeShare(p)).token!)
    expect(d.project.copilot).toEqual({ v: 1, records: [{ k: 'test', a: 'fill', r: 1 }], stats: { decisions: 5 } })
  })

  test('legacy project: missing midiMap/masterVol backfilled after share round-trip', async () => {
    const p: any = buildStyle('TECHNO', 7)
    delete p.midiMap
    delete p.masterVol
    const d = await decodeShare((await encodeShare(p)).token!)
    loadProjectObj(d.project)
    expect(d.project.midiMap.version).toBe(1)
    expect(d.project.masterVol).toBe(0.85)
  })

  test('invalid token / wrong payload rejected without crashing', async () => {
    await expect(decodeShare('!!!not-base64!!!')).rejects.toBeTruthy()
    /* valid deflate stream of a non-project payload must be rejected */
    const r = await encodeShare({ version: 1 } as any)
    await expect(decodeShare(r.token!)).rejects.toThrow('not a psy6 project')
  })
})

describe('token format + size guards', () => {
  test('token is URL-safe base64url: no +, /, or = padding', async () => {
    const r = await encodeShare(buildStyle('PSYTRANCE', 42))
    expect(r.ok).toBe(true)
    expect(r.token!).not.toMatch(/[+/=]/)
    expect(r.token!).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  test('sizes are logged honestly and thresholds are sane', async () => {
    const p = buildStyle('PSYTRANCE', 42)
    p.copilot = { v: 1, records: [], stats: {} }
    const r = await encodeShare(p)
    expect(r.jsonBytes).toBeGreaterThan(0)
    expect(r.tokenBytes).toBeGreaterThan(0)
    expect(r.tokenBytes).toBeLessThan(SHARE_WARN_BYTES) /* a default project must stay small */
    expect(SHARE_WARN_BYTES).toBe(6144)
    expect(SHARE_MAX_BYTES).toBe(51200)
    expect(r.warn).toBe(false)
  })

  test('oversized project hard-errors with too-large', async () => {
    const p = buildStyle('TECHNO', 7)
    /* deterministic pseudo-random junk — incompressible, pushes past 50 KB */
    const rnd = mulberry32(1234)
    let junk = ''
    for (let i = 0; i < 40000; i++) junk += (rnd() * 0xffffffff >>> 0).toString(16)
    p.patterns['A'].data[0].steps.forEach((s: any) => { s.lock = { note: 48, junk } })
    const r = await encodeShare(p)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('too-large')
    expect(r.tokenBytes).toBeGreaterThan(SHARE_MAX_BYTES)
  })
})

describe('hash parsing', () => {
  test('accepts only #p=<url-safe token>', () => {
    expect(parseShareHash('#p=abc_DEF-123')).toBe('abc_DEF-123')
    expect(parseShareHash('#p=')).toBeNull()
    expect(parseShareHash('#other=1')).toBeNull()
    expect(parseShareHash('')).toBeNull()
    expect(parseShareHash(null as any)).toBeNull()
    expect(parseShareHash('#p=abc#xss')).toBeNull()
  })
})
