import { synthesizeBassNote, synthesizeKick, synthesizeLead, synthesizePad } from './kick.ts'
import { Rng } from './rng.ts'
import type { Fixture } from './types.ts'

const SAMPLE_RATE = 44100

function makeSignal(durationSec: number): Float32Array {
  return new Float32Array(Math.ceil(durationSec * SAMPLE_RATE))
}

/** Generate `count` beat times at `bpm` starting at `start` seconds. */
function beatsAtBpm(bpm: number, count: number, start = 0): number[] {
  const interval = 60 / bpm
  return Array.from({ length: count }, (_, i) => start + i * interval)
}

/** Clamp signal samples to [-1, 1] to keep audio valid after additive synthesis. */
function clampSignal(signal: Float32Array): void {
  for (let i = 0; i < signal.length; i++) {
    const v = signal[i]
    if (v === undefined) continue
    if (v > 1) signal[i] = 1
    else if (v < -1) signal[i] = -1
  }
}

// 1. perfect-150: 150 BPM, 16 bars, regular kicks every 0.4s.
export function genPerfect150(): Fixture {
  const bpm = 150
  const beatCount = 64 // 16 bars * 4 beats
  const interval = 60 / bpm // 0.4
  const durationSec = beatCount * interval // 25.6
  const beats = beatsAtBpm(bpm, beatCount)
  const signal = makeSignal(durationSec)
  for (const t of beats) synthesizeKick(t, SAMPLE_RATE, signal, 1)
  clampSignal(signal)
  return {
    id: 'perfect-150',
    name: 'Perfect 150 BPM',
    anomaly: 'perfect',
    sampleRate: SAMPLE_RATE,
    durationSec,
    signal,
    groundTruthBeats: beats,
    groundTruthBpm: bpm,
    description:
      '150 BPM, 16 bars, regular kicks every 0.4s. Reference fixture with perfect timing.',
  }
}

// 2. jitter-150: 150 BPM, ±10ms deterministic jitter per beat. seed=2.
export function genJitter150(): Fixture {
  const bpm = 150
  const beatCount = 64
  const interval = 60 / bpm
  const durationSec = 25.6
  const rng = new Rng(2)
  const beats: number[] = []
  for (let i = 0; i < beatCount; i++) {
    const jitter = rng.range(-0.01, 0.01)
    beats.push(i * interval + jitter)
  }
  const signal = makeSignal(durationSec)
  for (const t of beats) synthesizeKick(t, SAMPLE_RATE, signal, 1)
  clampSignal(signal)
  return {
    id: 'jitter-150',
    name: 'Jittered 150 BPM',
    anomaly: 'jitter',
    sampleRate: SAMPLE_RATE,
    durationSec,
    signal,
    groundTruthBeats: beats,
    groundTruthBpm: bpm,
    description: '150 BPM, 16 bars, ±10ms deterministic jitter per beat (mulberry32 seed=2).',
  }
}

// 3. tempo-ramp: bpm(t) = 130 + 2t over ~20s. Beats placed at cumulative integral.
export function genTempoRamp(): Fixture {
  const durationSec = 20.5
  const signal = makeSignal(durationSec)
  const beats: number[] = []
  // bpm(t) = 130 + 2t. Beat n satisfies integral_0^t (130+2s)/60 ds = n, i.e. 130t + t^2 = 60n.
  // Solve: t = (-130 + sqrt(130^2 + 240n)) / 2.
  let n = 0
  while (true) {
    const t = (-130 + Math.sqrt(130 * 130 + 240 * n)) / 2
    if (t >= durationSec) break
    beats.push(t)
    synthesizeKick(t, SAMPLE_RATE, signal, 1)
    n++
  }
  clampSignal(signal)
  return {
    id: 'tempo-ramp',
    name: 'Tempo Ramp 130 to 170',
    anomaly: 'tempo-ramp',
    sampleRate: SAMPLE_RATE,
    durationSec,
    signal,
    groundTruthBeats: beats,
    groundTruthBpm: null,
    description:
      'Linear tempo ramp bpm(t)=130+2t over ~20s. Beats placed by cumulative integral. Strictly decreasing intervals.',
  }
}

// 4. tempo-jump: 130 BPM 8 bars, then 160 BPM 8 bars.
export function genTempoJump(): Fixture {
  const bpm1 = 130
  const bpm2 = 160
  const beatCount1 = 32 // 8 bars * 4
  const beatCount2 = 32
  const interval1 = 60 / bpm1 // ~0.4615
  const interval2 = 60 / bpm2 // 0.375
  const section1End = beatCount1 * interval1 // time at beat 32
  const durationSec = section1End + beatCount2 * interval2 + 0.5
  const beats: number[] = []
  for (let i = 0; i < beatCount1; i++) beats.push(i * interval1)
  for (let i = 0; i < beatCount2; i++) beats.push(section1End + i * interval2)
  const signal = makeSignal(durationSec)
  for (const t of beats) synthesizeKick(t, SAMPLE_RATE, signal, 1)
  clampSignal(signal)
  return {
    id: 'tempo-jump',
    name: 'Tempo Jump 130 to 160',
    anomaly: 'tempo-jump',
    sampleRate: SAMPLE_RATE,
    durationSec,
    signal,
    groundTruthBeats: beats,
    groundTruthBpm: null,
    description:
      '8 bars @ 130 BPM then 8 bars @ 160 BPM. Exactly one discontinuous interval change.',
  }
}

// 5. missing-beat: 150 BPM 16 bars, beat index 32 removed (2x gap).
export function genMissingBeat(): Fixture {
  const bpm = 150
  const beatCount = 64
  const interval = 60 / bpm
  const durationSec = 25.6
  const missingIndex = 32
  const beats: number[] = []
  for (let i = 0; i < beatCount; i++) {
    if (i === missingIndex) continue
    beats.push(i * interval)
  }
  const signal = makeSignal(durationSec)
  for (const t of beats) synthesizeKick(t, SAMPLE_RATE, signal, 1)
  clampSignal(signal)
  return {
    id: 'missing-beat',
    name: 'Missing Beat (index 32)',
    anomaly: 'missing-beat',
    sampleRate: SAMPLE_RATE,
    durationSec,
    signal,
    groundTruthBeats: beats,
    groundTruthBpm: bpm,
    description: '150 BPM, 16 bars, beat index 32 removed (one 2x interval).',
  }
}

// 6. false-kick: 150 BPM, extra low-strength kick halfway between beats 40 and 41.
export function genFalseKick(): Fixture {
  const bpm = 150
  const beatCount = 64
  const interval = 60 / bpm
  const durationSec = 25.6
  const falseKickTime = (40 * interval + 41 * interval) / 2 // 16.2
  const beats: number[] = []
  for (let i = 0; i < beatCount; i++) beats.push(i * interval)
  beats.push(falseKickTime)
  beats.sort((a, b) => a - b)
  const signal = makeSignal(durationSec)
  for (let i = 0; i < beatCount; i++) synthesizeKick(i * interval, SAMPLE_RATE, signal, 1)
  synthesizeKick(falseKickTime, SAMPLE_RATE, signal, 0.3)
  clampSignal(signal)
  return {
    id: 'false-kick',
    name: 'False Kick (between 40 and 41)',
    anomaly: 'false-kick',
    sampleRate: SAMPLE_RATE,
    durationSec,
    signal,
    groundTruthBeats: beats,
    groundTruthBpm: bpm,
    description:
      '150 BPM, 16 bars, extra low-strength (gain 0.3) kick halfway between beats 40 and 41.',
  }
}

// 7. half-time: 150 BPM, odd-index beats at gain 0.3.
export function genHalfTime(): Fixture {
  const bpm = 150
  const beatCount = 64
  const interval = 60 / bpm
  const durationSec = 25.6
  const beats = beatsAtBpm(bpm, beatCount)
  const signal = makeSignal(durationSec)
  for (let i = 0; i < beatCount; i++) {
    const gain = i % 2 === 0 ? 1 : 0.3
    synthesizeKick(i * interval, SAMPLE_RATE, signal, gain)
  }
  clampSignal(signal)
  return {
    id: 'half-time',
    name: 'Half-Time Accent',
    anomaly: 'half-time',
    sampleRate: SAMPLE_RATE,
    durationSec,
    signal,
    groundTruthBeats: beats,
    groundTruthBpm: bpm,
    description:
      '150 BPM, 16 bars, odd-index beats at gain 0.3 (tempting half-time interpretation).',
  }
}

// 8. double-time: 75 BPM strong kicks, quiet ghost kicks halfway between. True bpm=75.
export function genDoubleTime(): Fixture {
  const bpm = 75
  const beatCount = 64
  const interval = 60 / bpm // 0.8
  const durationSec = beatCount * interval // 51.2
  const mainBeats: number[] = []
  const ghostBeats: number[] = []
  for (let i = 0; i < beatCount; i++) mainBeats.push(i * interval)
  for (let i = 0; i < beatCount - 1; i++) {
    ghostBeats.push((i * interval + (i + 1) * interval) / 2)
  }
  const beats = [...mainBeats, ...ghostBeats].sort((a, b) => a - b)
  const signal = makeSignal(durationSec)
  for (const t of mainBeats) synthesizeKick(t, SAMPLE_RATE, signal, 1)
  for (const t of ghostBeats) synthesizeKick(t, SAMPLE_RATE, signal, 0.4)
  clampSignal(signal)
  return {
    id: 'double-time',
    name: 'Double-Time Ghosts',
    anomaly: 'double-time',
    sampleRate: SAMPLE_RATE,
    durationSec,
    signal,
    groundTruthBeats: beats,
    groundTruthBpm: bpm,
    description: '75 BPM strong kicks, gain 0.4 ghost kicks halfway between. True bpm=75.',
  }
}

// 9. gap-500ms: 150 BPM, 500ms silence inserted after beat 24.
export function genGap500ms(): Fixture {
  const bpm = 150
  const beatCount = 64
  const interval = 60 / bpm
  const gapSec = 0.5
  const gapAfterBeat = 24
  const durationSec = beatCount * interval + gapSec // 26.1
  const beats: number[] = []
  for (let i = 0; i < beatCount; i++) {
    const t = i * interval + (i > gapAfterBeat ? gapSec : 0)
    beats.push(t)
  }
  const signal = makeSignal(durationSec)
  for (const t of beats) synthesizeKick(t, SAMPLE_RATE, signal, 1)
  clampSignal(signal)
  return {
    id: 'gap-500ms',
    name: '500ms Gap After Beat 24',
    anomaly: 'gap-500ms',
    sampleRate: SAMPLE_RATE,
    durationSec,
    signal,
    groundTruthBeats: beats,
    groundTruthBpm: bpm,
    description: '150 BPM, 500ms silence inserted after beat 24 (one 0.9s interval).',
  }
}

// 10. gap-2s: 150 BPM, 2s silence inserted after beat 24.
export function genGap2s(): Fixture {
  const bpm = 150
  const beatCount = 64
  const interval = 60 / bpm
  const gapSec = 2
  const gapAfterBeat = 24
  const durationSec = beatCount * interval + gapSec // 27.6
  const beats: number[] = []
  for (let i = 0; i < beatCount; i++) {
    const t = i * interval + (i > gapAfterBeat ? gapSec : 0)
    beats.push(t)
  }
  const signal = makeSignal(durationSec)
  for (const t of beats) synthesizeKick(t, SAMPLE_RATE, signal, 1)
  clampSignal(signal)
  return {
    id: 'gap-2s',
    name: '2s Gap After Beat 24',
    anomaly: 'gap-2s',
    sampleRate: SAMPLE_RATE,
    durationSec,
    signal,
    groundTruthBeats: beats,
    groundTruthBpm: bpm,
    description: '150 BPM, 2s silence inserted after beat 24 (one 2.4s interval).',
  }
}

// 11. sparse: 150 BPM, kicks only on beats 0 and 2 of each 4-beat bar.
export function genSparse(): Fixture {
  const bpm = 150
  const beatCount = 64
  const interval = 60 / bpm
  const durationSec = 25.6
  const beats: number[] = []
  for (let i = 0; i < beatCount; i++) {
    const pos = i % 4
    if (pos === 0 || pos === 2) beats.push(i * interval)
  }
  const signal = makeSignal(durationSec)
  for (const t of beats) synthesizeKick(t, SAMPLE_RATE, signal, 1)
  clampSignal(signal)
  return {
    id: 'sparse',
    name: 'Sparse (Beats 1 and 3)',
    anomaly: 'sparse',
    sampleRate: SAMPLE_RATE,
    durationSec,
    signal,
    groundTruthBeats: beats,
    groundTruthBpm: bpm,
    description:
      '150 BPM, 16 bars, kicks only on beats 1 and 3 of each bar (tempting half-time at 75 BPM).',
  }
}

// 12. dense-bass: 150 BPM kicks plus continuous 55Hz bass notes between each kick.
export function genDenseBass(): Fixture {
  const bpm = 150
  const beatCount = 64
  const durationSec = 25.6
  const beats = beatsAtBpm(bpm, beatCount)
  const signal = makeSignal(durationSec)
  for (const t of beats) synthesizeKick(t, SAMPLE_RATE, signal, 1)
  for (let i = 0; i < beatCount - 1; i++) {
    const start = beats[i] + 0.05
    const end = beats[i + 1] - 0.05
    synthesizeBassNote(55, start, end, SAMPLE_RATE, signal, 0.3)
  }
  clampSignal(signal)
  return {
    id: 'dense-bass',
    name: 'Dense Bass (55Hz)',
    anomaly: 'dense-bass',
    sampleRate: SAMPLE_RATE,
    durationSec,
    signal,
    groundTruthBeats: beats,
    groundTruthBpm: bpm,
    description: '150 BPM, 16 bars, kicks plus continuous 55Hz bass notes between each kick.',
  }
}

// 13. lead-heavy: 150 BPM kicks plus continuous 440Hz lead synth across the whole signal.
export function genLeadHeavy(): Fixture {
  const bpm = 150
  const beatCount = 64
  const durationSec = 25.6
  const beats = beatsAtBpm(bpm, beatCount)
  const signal = makeSignal(durationSec)
  for (const t of beats) synthesizeKick(t, SAMPLE_RATE, signal, 1)
  synthesizeLead(440, 0, durationSec, SAMPLE_RATE, signal, 0.15)
  clampSignal(signal)
  return {
    id: 'lead-heavy',
    name: 'Lead Heavy (440Hz)',
    anomaly: 'lead-heavy',
    sampleRate: SAMPLE_RATE,
    durationSec,
    signal,
    groundTruthBeats: beats,
    groundTruthBpm: bpm,
    description:
      '150 BPM, 16 bars, kicks plus continuous 440Hz lead synth across the whole signal.',
  }
}

// 14. breakdown: 140 BPM, 16 bars. Bars 5-8 no kicks, only 110Hz pad.
export function genBreakdown(): Fixture {
  const bpm = 140
  const beatsPerBar = 4
  const beatCount = 16 * beatsPerBar // 64
  const interval = 60 / bpm
  const durationSec = beatCount * interval // ~27.4286
  const beats: number[] = []
  const signal = makeSignal(durationSec)
  // Pad covers bars 5-8 (beats 16-31).
  const padStart = 16 * interval
  const padEnd = 32 * interval
  synthesizePad(110, padStart, padEnd, SAMPLE_RATE, signal, 0.08)
  for (let i = 0; i < beatCount; i++) {
    const bar = Math.floor(i / beatsPerBar) // 0..15
    const inBreakdown = bar >= 4 && bar < 8 // bars 5-8 (1-indexed)
    if (inBreakdown) continue
    const t = i * interval
    beats.push(t)
    synthesizeKick(t, SAMPLE_RATE, signal, 1)
  }
  clampSignal(signal)
  return {
    id: 'breakdown',
    name: 'Breakdown (Pad Bars 5-8)',
    anomaly: 'breakdown',
    sampleRate: SAMPLE_RATE,
    durationSec,
    signal,
    groundTruthBeats: beats,
    groundTruthBpm: bpm,
    description:
      '140 BPM, 16 bars. Bars 5-8 no kicks, only 110Hz pad. Tests relock after breakdown.',
  }
}
