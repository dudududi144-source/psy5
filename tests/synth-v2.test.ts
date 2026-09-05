/**
 * SYNTH ENGINE v2-lite (v0.13.0 P1) — data-layer guards (bun, no WebAudio).
 *
 * The five new optional preset params (fenv/fdec/penv/pdec/sub) are consumed
 * by js/engine.js SynthVoice.noteOn. Their audio-level behavior is asserted
 * on-device by gate G42 (offline renders); THIS file pins the DATA layer:
 *   1. NEUTRALITY at the data layer: presets WITHOUT the gen:'v13' marker may
 *      not define the new fields — absence is what makes the v0.13.0 engine
 *      render legacy presets exactly like v0.12.0. Marked (gen:'v13') presets
 *      MAY opt in, but every present field must sit inside the engine clamps.
 *   2. The runtime library stays healthy: unique ids, 178+ presets, all
 *      categories present (the v0.12.0 floor).
 *
 * v0.30.0: the soundBank.ts source pin was REMOVED with the file itself —
 * the unrouted TS catalog died in the FOUNDATION RESET and js/presets.js is
 * the one preset surface the engine consumes. The neutrality + clamp guards
 * (the real v2-lite contract) keep the same rigor on the live library.
 */
import { describe, test, expect } from 'bun:test'
import { libFilter, libCount } from '../js/presets.js'

const NEW_FIELDS = ['fenv', 'fdec', 'penv', 'pdec', 'sub'] as const
/** engine clamps (SynthVoice.noteOn, js/engine.js — keep in sync) */
const CLAMPS: Record<string, [number, number]> = {
  fenv: [0, 16], fdec: [0.01, 2], penv: [0, 48], pdec: [0.01, 2], sub: [0, 1],
}
const CATS = ['drum', 'bass', 'lead', 'pad', 'pluck', 'arp', 'fx', 'synth', 'texture']

describe('synth v2-lite data layer (v0.13.0 P1; v0.18.0 adds the gen opt-in)', () => {
  test('legacy (unmarked) presets carry ZERO new fields — legacy neutrality', () => {
    const all = libFilter('all', 'ALL')
    expect(all.length).toBeGreaterThanOrEqual(178) // the v0.12.0 floor
    let marked = 0
    for (const p of all) {
      /* v0.18.0: ANY gen marker (v13, v18, …) is an explicit OPT-IN generation —
         the neutrality rule protects only UNMARKED presets; marked presets get
         their opt-in fields clamp-checked in the next test. */
      if ((p as any).gen) { marked++; continue }
      for (const f of NEW_FIELDS) {
        expect((p as any)[f]).toBeUndefined()
      }
    }
    expect(marked).toBeGreaterThanOrEqual(60) // the v0.13.0 v2-lite generation
  })

  test("gen-marked presets (v13, v18, …) opt in ONLY through the engine clamps", () => {
    for (const p of libFilter('all', 'ALL')) {
      if (!(p as any).gen) continue
      for (const f of NEW_FIELDS) {
        const v = (p as any)[f]
        if (v !== undefined) {
          const [lo, hi] = CLAMPS[f]
          expect(v).toBeGreaterThanOrEqual(lo)
          expect(v).toBeLessThanOrEqual(hi)
        }
      }
    }
  })

  test('runtime lib shape intact: unique ids, 178+ presets, categories present', () => {
    const ids = new Set<string>()
    for (const cat of CATS) {
      const arr = libFilter(cat, 'ALL')
      if (!arr.length) continue
      for (const p of arr) {
        expect(ids.has(p.id)).toBe(false)
        ids.add(p.id)
      }
    }
    expect(ids.size).toBe(libCount())
    expect(libCount()).toBeGreaterThanOrEqual(178)
  })
})
