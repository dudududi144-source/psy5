/**
 * Granular Synthesis — spawns thousands of tiny grains from a buffer.
 *
 * Each grain is 10-100ms of audio with its own:
 * - Position in source buffer
 * - Pitch (playback rate)
 * - Pan
 * - Envelope (Hann window for smooth edges)
 * - Duration
 *
 * Creates textures impossible with oscillators — evolving pads, risers, atmospheres.
 * This is what professional psytrance uses for texture beds.
 *
 * Usage:
 *   const buf = GrainCloud.generateNoiseBuffer(rng, 2.0)
 *   const cloud = new GrainCloud(buf, rng)
 *   cloud.setDensity(80)  // 80 grains/sec
 *   const [left, right] = cloud.process()
 *
 * Ported from psy-foundation v2.0.0 @ edd1e5f (apps/web/src/lib/psy4/granular.ts) — mechanical TS→JS conversion, math byte-identical.
 * (The `import type { Rng } from './forensic/prng'` type-only import is dropped
 * in JS; GrainCloud still accepts Rng instances at runtime. The Grain
 * interface is a type declaration only — grain objects carry the same fields:
 * pos, pitch, pan, dur, age.)
 */

import { DEFAULT_SR } from './constants.mjs'

export class GrainCloud {
  grains = []
  density = 50
  grainDurMs = 50
  pitchVar = 0.1
  posVar = 0.5
  sampleCount = 0

  constructor(buffer, rng) {
    this.buffer = buffer
    this.rng = rng
    this.samplesPerGrain = Math.floor(DEFAULT_SR / this.density)
  }

  setDensity(d) {
    this.density = d
    this.samplesPerGrain = Math.floor(DEFAULT_SR / d)
  }

  setGrainDuration(ms) {
    this.grainDurMs = ms
  }
  setPitchVar(v) {
    this.pitchVar = v
  }
  setPosVar(v) {
    this.posVar = v
  }
  setAmp(a) {
    this.amp = a
  }
  setBuffer(buf) {
    this.buffer = buf
    this.reset()
  }

  amp = 1.0

  spawnGrain() {
    const grainDur = Math.floor((DEFAULT_SR * this.grainDurMs) / 1000)
    const posRange = this.buffer.length - grainDur - 1
    const basePos = this.rng.range(0, Math.max(1, posRange))
    this.grains.push({
      pos: basePos,
      pitch: 1 + this.rng.range(-this.pitchVar, this.pitchVar),
      pan: this.rng.range(-1, 1),
      dur: grainDur,
      age: 0,
    })
  }

  process() {
    this.sampleCount++
    if (this.sampleCount >= this.samplesPerGrain) {
      this.spawnGrain()
      this.sampleCount = 0
    }

    let outL = 0
    let outR = 0
    for (let i = this.grains.length - 1; i >= 0; i--) {
      const g = this.grains[i]
      if (g.age >= g.dur) {
        this.grains.splice(i, 1)
        continue
      }
      const samplePos = Math.floor(g.pos + g.age * g.pitch)
      const sample = this.buffer[samplePos % this.buffer.length] ?? 0
      // Hann envelope (smooth grain edges)
      const env = 0.5 * (1 - Math.cos((2 * Math.PI * g.age) / g.dur))
      // Equal-power pan
      const panAngle = (g.pan + 1) * 0.25 * Math.PI
      const panL = Math.cos(panAngle)
      const panR = Math.sin(panAngle)
      outL += sample * env * panL * this.amp
      outR += sample * env * panR * this.amp
      g.age++
    }
    return [outL, outR]
  }

  reset() {
    this.grains = []
    this.sampleCount = 0
  }

  get activeGrains() {
    return this.grains.length
  }

  // ── Factory: generate source buffer procedurally ──

  static generateNoiseBuffer(rng, durationSec) {
    const len = Math.floor(DEFAULT_SR * durationSec)
    const buf = new Float32Array(len)
    // Pink-ish noise (filtered white noise)
    let last = 0
    for (let i = 0; i < len; i++) {
      const white = rng.range(-1, 1)
      last = last * 0.95 + white * 0.05
      buf[i] = last * 10
    }
    return buf
  }

  static generateSawBuffer(freq, durationSec) {
    const len = Math.floor(DEFAULT_SR * durationSec)
    const buf = new Float32Array(len)
    const period = DEFAULT_SR / freq
    for (let i = 0; i < len; i++) {
      const phase = (i % period) / period
      buf[i] = 2 * phase - 1
    }
    return buf
  }

  static generateMixedBuffer(rng, freq, durationSec, noiseLevel = 0.5) {
    const len = Math.floor(DEFAULT_SR * durationSec)
    const buf = new Float32Array(len)
    const period = DEFAULT_SR / freq
    let noiseState = 0
    for (let i = 0; i < len; i++) {
      const phase = (i % period) / period
      const saw = 2 * phase - 1
      const white = rng.range(-1, 1)
      noiseState = noiseState * 0.95 + white * 0.05
      buf[i] = saw * (1 - noiseLevel) + noiseState * 3 * noiseLevel
    }
    return buf
  }
}
