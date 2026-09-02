/* Run 19 P1 — FREEZE + RESAMPLE pure math (no Web Audio — audio proofs live
 * in the in-page gate G36; the Bun suite owns the deterministic math). */
import { describe, expect, test } from 'bun:test';
import { freezePrep, freezeWindow, freezeGuard } from '../js/bounce.js';
import { resampleFrames, resampleGuard } from '../js/capture.js';
import { loopLen } from '../js/model.js';
import { compose } from '../js/composer.js';

const clone = (x: any): any => JSON.parse(JSON.stringify(x));

/* deterministic fixture — the same compose the CI gates pin */
const p = compose('FULL-ON', 3, 424242).project;

describe('freezeWindow — pure frame math for one pattern loop', () => {
  test('frames == ceil((0.05 + steps·sd)·44100) − lead(2205), bars == steps/16', () => {
    const L = loopLen(p);
    const sd = 60 / p.bpm / 4;
    const want = Math.ceil((0.05 + L * sd) * 44100) - Math.ceil(0.05 * 44100);
    const w = freezeWindow(p);
    expect(w.steps).toBe(L);
    expect(w.bars).toBe(L / 16);
    expect(w.frames).toBe(want);
    expect(w.frames).toBeGreaterThan(0);
    expect(w.durationSec).toBeCloseTo(want / 44100, 12);
    expect(w.sampleRate).toBe(44100);
  });
  test('deterministic — same project → identical window, twice', () => {
    const a = freezeWindow(p);
    const b = freezeWindow(p);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  test('1-bar loop sanity: 16 steps @ 128 bpm == 1.875 s window', () => {
    const mini: any = { version: 3, bpm: 128, currentPattern: 'A', patterns: { A: { name: 'A', data: { 0: { len: 16, steps: [] }, 1: { len: 16, steps: [] } } } }, tracks: [], scenes: [], arranger: { steps: [] } };
    const w = freezeWindow(mini);
    expect(w.steps).toBe(16);
    expect(w.bars).toBe(1);
    expect(w.durationSec).toBeCloseTo(16 * (60 / 128 / 4), 4); /* ±1 sample ceil rounding = 1.1e-5 s */
  });
});

describe('freezePrep — pre-send contract on a clone', () => {
  test('zeroes sendA/sendB/scAmount on the frozen track only; input NEVER mutated', () => {
    const before = clone(p);
    const cp = freezePrep(p, 0);
    expect(cp.tracks[0].mix.sendA).toBe(0);
    expect(cp.tracks[0].mix.sendB).toBe(0);
    expect(cp.tracks[0].scAmount).toBe(0);
    // untouched tracks keep their mix
    expect(JSON.stringify(cp.tracks[1])).toBe(JSON.stringify(before.tracks[1]));
    // the LIVE project object is byte-identical to before the call
    expect(JSON.stringify(p)).toBe(JSON.stringify(before));
  });
  test('missing track index → clean clone, no throw', () => {
    const before = clone(p);
    const cp = freezePrep(p, 99);
    expect(JSON.stringify(p)).toBe(JSON.stringify(before));
    expect(cp.tracks.length).toBe(before.tracks.length);
  });
});

describe('freezeGuard — 10-minute flow cap', () => {
  test('refuses non-positive and >600 s', () => {
    expect(freezeGuard(0).ok).toBe(false);
    expect(freezeGuard(-1).ok).toBe(false);
    const over = freezeGuard(600.5);
    expect(over.ok).toBe(false);
    expect(String(over.reason)).toContain('10-minute');
  });
  test('accepts real loops', () => {
    expect(freezeGuard(3.75).ok).toBe(true);
    expect(freezeGuard(599).ok).toBe(true);
  });
});

describe('resampleFrames — exact N-bar trim target', () => {
  test('2 bars @128 bpm @44100 == 165375 frames (exactly 3.75 s)', () => {
    expect(resampleFrames(2, 128, 44100)).toBe(165375);
  });
  test('1 bar @128 bpm @44100 == round(82687.5) == 82688', () => {
    expect(resampleFrames(1, 128, 44100)).toBe(82688);
  });
  test('4 bars @140 bpm @48000 == 329143', () => {
    expect(resampleFrames(4, 140, 48000)).toBe(329143);
  });
  test('linear in bars', () => {
    expect(resampleFrames(8, 128, 44100)).toBe(resampleFrames(2, 128, 44100) * 4);
  });
});

describe('resampleGuard — 1..32 whole bars', () => {
  test('refuses 0, non-integers, and >32 bars', () => {
    expect(resampleGuard(0).ok).toBe(false);
    expect(resampleGuard(2.5).ok).toBe(false);
    const over = resampleGuard(33);
    expect(over.ok).toBe(false);
    expect(String(over.reason)).toContain('32-bar');
  });
  test('accepts 1 and 32', () => {
    expect(resampleGuard(1).ok).toBe(true);
    expect(resampleGuard(32).ok).toBe(true);
  });
});
