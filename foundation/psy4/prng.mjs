/**
 * Deterministic PRNG — mulberry32.
 *
 * All forensic rendering uses this. No Math.random() anywhere.
 * Same seed => same output, always.
 *
 * Ported from psy-foundation v2.0.0 @ edd1e5f (apps/web/src/lib/psy4/forensic/prng.ts) — mechanical TS→JS conversion, math byte-identical.
 */

export class Rng {
  constructor(seed) {
    // Ensure non-zero state
    this.state = seed >>> 0 || 1
  }

  /** Float in [0, 1) */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Float in [min, max) */
  range(min, max) {
    return min + this.next() * (max - min)
  }

  /** Integer in [min, max] inclusive */
  int(min, max) {
    return Math.floor(this.range(min, max + 1))
  }

  /** Pick from array */
  pick(arr) {
    // int() returns an index in [0, arr.length - 1] — always valid.
    return arr[this.int(0, arr.length - 1)]
  }

  /** Boolean with probability p */
  chance(p) {
    return this.next() < p
  }
}
