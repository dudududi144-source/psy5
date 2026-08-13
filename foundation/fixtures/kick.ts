/** Write a synthetic kick (decaying 50Hz sine burst, ~60ms) into the signal at time `at`. */
export function synthesizeKick(
  at: number,
  sampleRate: number,
  signal: Float32Array,
  gain = 1
): void {
  const startSample = Math.floor(at * sampleRate)
  const durationSec = 0.06
  const numSamples = Math.floor(durationSec * sampleRate)
  const freq = 50
  for (let i = 0; i < numSamples; i++) {
    const idx = startSample + i
    if (idx < 0 || idx >= signal.length) break
    const t = i / sampleRate
    const env = Math.exp(-t * 30)
    const pitchEnv = freq * (1 + 2 * Math.exp(-t * 80))
    signal[idx] += gain * env * Math.sin(2 * Math.PI * pitchEnv * t)
  }
}

/** Write a continuous bass note (sustained sine) between [startSec, endSec). */
export function synthesizeBassNote(
  freqHz: number,
  startSec: number,
  endSec: number,
  sampleRate: number,
  signal: Float32Array,
  gain = 0.3
): void {
  const startSample = Math.floor(startSec * sampleRate)
  const endSample = Math.min(signal.length, Math.floor(endSec * sampleRate))
  for (let i = startSample; i < endSample; i++) {
    const t = (i - startSample) / sampleRate
    const env = Math.min(1, t * 20) * Math.min(1, (endSample - i) / (sampleRate * 0.05))
    signal[i] += gain * env * Math.sin(2 * Math.PI * freqHz * t)
  }
}

/** Write a sustained lead tone (sawtooth-ish via harmonics). */
export function synthesizeLead(
  freqHz: number,
  startSec: number,
  endSec: number,
  sampleRate: number,
  signal: Float32Array,
  gain = 0.15
): void {
  const startSample = Math.floor(startSec * sampleRate)
  const endSample = Math.min(signal.length, Math.floor(endSec * sampleRate))
  for (let i = startSample; i < endSample; i++) {
    const t = (i - startSample) / sampleRate
    const env = Math.min(1, t * 5) * Math.min(1, (endSample - i) / (sampleRate * 0.1))
    const phase = 2 * Math.PI * freqHz * t
    signal[i] +=
      gain * env * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.3 * Math.sin(3 * phase))
  }
}

/** Write a pad/ambient texture (low sustained harmonics). */
export function synthesizePad(
  freqHz: number,
  startSec: number,
  endSec: number,
  sampleRate: number,
  signal: Float32Array,
  gain = 0.08
): void {
  const startSample = Math.floor(startSec * sampleRate)
  const endSample = Math.min(signal.length, Math.floor(endSec * sampleRate))
  for (let i = startSample; i < endSample; i++) {
    const t = (i - startSample) / sampleRate
    const fadeIn = Math.min(1, t / (sampleRate * 0.5))
    const fadeOut = Math.min(1, (endSample - i) / (sampleRate * 0.5))
    const env = fadeIn * fadeOut
    const phase = 2 * Math.PI * freqHz * t
    signal[i] += gain * env * (Math.sin(phase) + 0.4 * Math.sin(phase * 1.5))
  }
}
