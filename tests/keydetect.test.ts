/* Run 19 P4 — KEY DETECTION: deterministic chroma + Krumhansl-Schmuckler. */
import { describe, expect, test } from 'bun:test';
import { chromaProfile, detectKey, tuneToRoot, PC_NAMES } from '../js/keydetect.js';

const SR = 44100;
const tone = (n: number, f: number, amp = 0.5) => {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = amp * Math.sin(2 * Math.PI * f * i / SR);
  return c;
};
/* pc → frequency (C4 = 261.63) */
const pcFreq = (pc: number) => 261.6255653 * Math.pow(2, pc / 12);

describe('chromaProfile — direct DFT at the 12 pitch classes', () => {
  test('a pure A (440 Hz = A4, the scanned register) lights pc 9 strongest', () => {
    const { chroma } = chromaProfile([tone(SR * 2, 440)], SR);
    const arr = Array.from(chroma);
    const maxPc = arr.indexOf(Math.max(...arr));
    expect(maxPc).toBe(9); /* A */
    expect(arr[9]).toBeGreaterThan(0);
  });
  test('deterministic — same PCM → identical chroma', () => {
    const a = chromaProfile([tone(SR, 261.63)], SR);
    const b = chromaProfile([tone(SR, 261.63)], SR);
    expect(Array.from(a.chroma)).toEqual(Array.from(b.chroma));
    expect(a.windowFrames).toBe(b.windowFrames);
  });
  test('empty PCM → zero chroma, no NaN', () => {
    const { chroma } = chromaProfile([new Float32Array(0)], SR);
    expect(Array.from(chroma).every(v => v === 0 && isFinite(v))).toBe(true);
  });
});

describe('detectKey — Krumhansl-Schmuckler over rotated profiles', () => {
  test('C major triad (C+E+G) → C major', () => {
    const n = SR * 2;
    const mix = new Float32Array(n);
    for (const pc of [0, 4, 7]) { const t = tone(n, pcFreq(pc), 0.3); for (let i = 0; i < n; i++) mix[i] += t[i] }
    const k = detectKey([mix], SR);
    expect(k.tonicPc).toBe(0);
    expect(k.mode).toBe('major');
    expect(k.name).toBe('C');
    expect(k.r).toBeGreaterThan(0.5);
  });
  test('A minor triad (A+C+E) → A minor', () => {
    const n = SR * 2;
    const mix = new Float32Array(n);
    for (const pc of [9, 0, 4]) { const t = tone(n, pcFreq(pc), 0.3); for (let i = 0; i < n; i++) mix[i] += t[i] }
    const k = detectKey([mix], SR);
    expect(k.tonicPc).toBe(9);
    expect(k.mode).toBe('minor');
    expect(k.name).toBe('Am');
  });
  test('deterministic — same PCM → identical key + correlation', () => {
    const n = SR * 2;
    const mix = new Float32Array(n);
    for (const pc of [0, 4, 7]) { const t = tone(n, pcFreq(pc), 0.3); for (let i = 0; i < n; i++) mix[i] += t[i] }
    const a = detectKey([mix], SR);
    const b = detectKey([mix], SR);
    expect(a.tonicPc).toBe(b.tonicPc);
    expect(a.mode).toBe(b.mode);
    expect(a.r).toBe(b.r);
  });
});

describe('tuneToRoot — minimal signed semitone shift', () => {
  test('same pc → 0; +5 and −7 destinations agree (mod 12)', () => {
    expect(tuneToRoot(9, 33)).toBe(0); /* root 33 (A1) pc 9, sample A → 0 */
    expect(tuneToRoot(0, 60)).toBe(0); /* C → C */
    expect(tuneToRoot(9, 60)).toBe(3); /* A → C: +3 st */
    expect(tuneToRoot(0, 57)).toBe(-3); /* C → A: −3 st (mod-12 literal would say +9) */
    expect(tuneToRoot(6, 60)).toBe(6); /* tritone stays +6 */
    expect(tuneToRoot(7, 60)).toBe(5); /* G → C: +5 is already minimal (|+5| < |−7|) */
  });
  test('result always maps sample pc onto the project root pc', () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const root of [33, 45, 60, 57]) {
        const t = tuneToRoot(tonic, root);
        expect(((tonic + t) % 12 + 12) % 12).toBe(((root % 12) + 12) % 12);
        expect(t).toBeGreaterThanOrEqual(-5);
        expect(t).toBeLessThanOrEqual(6);
      }
    }
  });
  test('PC_NAMES covers 12 classes', () => {
    expect(PC_NAMES.length).toBe(12);
    expect(PC_NAMES[0]).toBe('C');
    expect(PC_NAMES[9]).toBe('A');
  });
});
