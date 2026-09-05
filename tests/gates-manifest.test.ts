/**
 * PSY6 v0.26.0 — GATES MANIFEST reconciliation (roast fix #3/#9).
 *
 * docs/ENGINEERING-ROAST.md: the 48-id MAIN Self-Gate list used to live in
 * tools/e2e.mjs (hand-typed) and was asserted by js/ui/tests.js at runtime;
 * the only reconciliation was the full 9-minute headless suite. A typo in
 * either copy surfaced as red CI instead of a fast red unit test.
 *
 * js/gates-manifest.js is now the single source. This test statically proves
 * that js/ui/tests.js registers EXACTLY the manifest ids (plus the two
 * realtime evidence gates and the worklet reduced-set ids), so the three
 * surfaces — manifest, runtime registration, boot copy — can never drift
 * apart silently again.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MAIN_GATE_IDS,
  MAIN_GATE_COUNT,
  REALTIME_EVIDENCE_IDS,
} from '../js/gates-manifest.js'

const ROOT = new URL('..', import.meta.url).pathname
const TESTS_SRC = readFileSync(join(ROOT, 'js/ui/tests.js'), 'utf8')

/* ids registered by gate('...') literals in the runtime source. G1 is
   registered as gate('G1-'+st) — a template, so the literal 'G1-' prefix is
   what statics can see. Worklet gates (G14w/G15w) and the realtime evidence
   gates (G17/G25) are registered too — allowed as documented extras. */
const registered = new Set<string>()
for (const m of TESTS_SRC.matchAll(/gate\('([A-Za-z0-9-]+)'/g)) {
  const raw = m[1]
  registered.add(raw.startsWith('G1-') ? 'G1-*' : raw)
}

describe('gates manifest — single source of truth (v0.26.0)', () => {
  test('the manifest is well-formed: 50 unique ids, G1 expanded per style', () => {
    expect(MAIN_GATE_IDS.length).toBe(MAIN_GATE_COUNT)
    expect(new Set(MAIN_GATE_IDS).size).toBe(MAIN_GATE_IDS.length)
    expect(MAIN_GATE_IDS.filter(id => id.startsWith('G1-')).length).toBe(4)
    expect(MAIN_GATE_COUNT).toBe(50)
  })

  test('every manifest id is registered by js/ui/tests.js', () => {
    const missing = MAIN_GATE_IDS.filter(id => {
      if (id.startsWith('G1-')) return !registered.has('G1-*')
      return !registered.has(id)
    })
    expect(missing).toEqual([])
  })

  test('the realtime evidence gates are registered on-device (but CI-excluded)', () => {
    for (const id of REALTIME_EVIDENCE_IDS) {
      expect(registered.has(id)).toBe(true)
    }
  })

  test('no unexpected gate registrations outside manifest + documented extras', () => {
    const manifestNorm = new Set<string>(['G1-*'])
    for (const id of MAIN_GATE_IDS) {
      if (!id.startsWith('G1-')) manifestNorm.add(id)
    }
    const extras = [...registered].filter(id => !manifestNorm.has(id))
    /* documented extras: realtime evidence + worklet reduced set */
    const allowed = new Set([...REALTIME_EVIDENCE_IDS, 'G14w', 'G15w'])
    const unexpected = extras.filter(id => !allowed.has(id))
    expect(unexpected).toEqual([])
  })

  test('tools/e2e.mjs consumes the manifest (no hand-listed copy)', () => {
    const e2e = readFileSync(join(ROOT, 'tools/e2e.mjs'), 'utf8')
    expect(e2e.includes('gates-manifest.js')).toBe(true)
    expect(e2e.includes("'G1-TECHNO'")).toBe(false)
  })

  test('the boot copy derives the count from the manifest (roast #3 regression guard)', () => {
    const mainJs = readFileSync(join(ROOT, 'js/main.js'), 'utf8')
    expect(mainJs.includes('gates-manifest.js')).toBe(true)
    expect(mainJs.includes('MAIN_GATE_COUNT')).toBe(true)
    expect(mainJs.includes('19 checks')).toBe(false)
  })
})
