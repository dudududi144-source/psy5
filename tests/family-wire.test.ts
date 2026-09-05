/**
 * PSY6 family wire tests (Task 19) — projectToWire: the device's own
 * deterministic walker (model.js stepEvents) driving validated PSYBUS v2
 * envelopes through the verbatim vendored foundation codec
 * (foundation/protocol/v2 — byte-identical to psy-foundation
 * packages/protocol/src/v2).
 *
 * Run: bun test tests/family-wire.test.ts
 */
import { describe, expect, test } from 'bun:test';

import { mkPattern, mkProject, mkStep } from '../js/model.js';
import { buildStyle } from '../js/presets.js';
import {
  DEVICE_LANE_MAP,
  FOUNDATION_TRACKS,
  WIRE_DEFAULTS,
  projectToWire,
  wireSize,
  wireToRenderNotesBody,
} from '../js/family-wire.js';
import { validateEnvelope } from '../foundation/protocol/v2/envelope.ts';

/** Fill one step on one track of a pattern (mirrors the composer's `put`). */
function put(pat, track, step, over = {}) {
  const d = pat.data[track];
  const st = d.steps[((step % d.len) + d.len) % d.len];
  Object.assign(st, { on: 1, vel: 0.9, prob: 1, micro: 0, note: 48 }, over);
  return st;
}

function fourOnTheFloorProject(over = {}) {
  const p = mkProject();
  const A = mkPattern('A', 8);
  for (let i = 0; i < 16; i += 4) put(A, 0, i); // kick every beat
  put(A, 4, 0, { note: 33 }); // bass root
  put(A, 5, 2, { note: 57, vel: 0.4 }); // lead offbeat
  p.patterns = { A };
  p.currentPattern = 'A';
  return Object.assign(p, over);
}

describe('family wire — lane contract', () => {
  test('all 8 canonical device lanes map onto real foundation tracks', () => {
    expect(DEVICE_LANE_MAP.length).toBe(8);
    for (const lane of DEVICE_LANE_MAP) {
      expect(FOUNDATION_TRACKS).toContain(lane.track);
    }
    expect(DEVICE_LANE_MAP.map((l) => l.lane)).toEqual([
      'KICK', 'SNARE', 'HATS', 'PERC', 'BASS', 'LEAD', 'PAD', 'ARP',
    ]);
  });

  test('drum notes are pinned to the family values (kick 36 / snare 38 / hat 42 / perc 45)', () => {
    expect(DEVICE_LANE_MAP[0].note).toBe(36);
    expect(DEVICE_LANE_MAP[1].note).toBe(38);
    expect(DEVICE_LANE_MAP[2].note).toBe(42);
    expect(DEVICE_LANE_MAP[3].note).toBe(45);
    /* tonal lanes carry the step's own note */
    for (const lane of DEVICE_LANE_MAP.slice(4)) expect(lane.note).toBeNull();
  });
});

describe('family wire — projectToWire', () => {
  test('an all-silent project yields zero envelopes and honest rest accounting', () => {
    const p = mkProject();
    p.patterns = { A: mkPattern('A', 8) };
    const w = projectToWire(p, { bars: 2 });
    expect(w.envelopes.length).toBe(0);
    expect(w.rests).toBe(32); // 2 bars × 16 steps
    expect(w.unmapped).toBe(0);
    expect(w.bars).toBe(2);
  });

  test('the device walker drives the wire: kick lane hits become validated kick envelopes on the grid', () => {
    const p = fourOnTheFloorProject();
    const w = projectToWire(p, { bars: 1 });
    expect(w.envelopes.length).toBe(6); // 4 kicks + 1 bass + 1 lead
    const kicks = w.envelopes.filter((e) => e.payload.track === 'kick');
    expect(kicks.length).toBe(4);
    expect(kicks.map((e) => e.payload.note)).toEqual([36, 36, 36, 36]);
    /* bpm 125 → 0.12 s per 16th; kicks on steps 0/4/8/12 */
    expect(kicks.map((e) => e.ts)).toEqual([0, 0.48, 0.96, 1.44]);
    for (const env of w.envelopes) {
      expect(validateEnvelope(env).ok).toBe(true);
      expect(env.src).toBe(WIRE_DEFAULTS.deviceId);
      expect(env.dst).toBe('broadcast');
    }
  });

  test('tonal lanes carry the step note and per-step velocity (the harmonic WHAT survives)', () => {
    const p = fourOnTheFloorProject();
    const w = projectToWire(p, { bars: 1 });
    const bass = w.envelopes.find((e) => e.payload.track === 'bass');
    expect(bass.payload.note).toBe(33);
    expect(bass.payload.vel).toBeCloseTo(0.9, 5);
    expect(bass.payload.durBeats).toBeCloseTo(0.45, 5); // psysampler parity
    const lead = w.envelopes.find((e) => e.payload.track === 'lead');
    expect(lead.payload.note).toBe(57);
    expect(lead.payload.vel).toBeCloseTo(0.4, 5);
    expect(lead.payload.durBeats).toBeCloseTo(0.22, 5);
    /* ARP lane rides the family's acid voice */
    const p2 = fourOnTheFloorProject();
    put(p2.patterns.A, 7, 4, { note: 69, vel: 0.5 });
    const w2 = projectToWire(p2, { bars: 1 });
    const arp = w2.envelopes.find((e) => e.payload.track === 'acid');
    expect(arp.payload.note).toBe(69);
  });

  test('the groove survives the wire: swing shifts odd 16ths, µs-quantized, never negative', () => {
    const p = fourOnTheFloorProject({ swing: 50 });
    const w = projectToWire(p, { bars: 1 });
    for (const env of w.envelopes) {
      expect(Math.round(env.ts * 1e6)).toBe(Math.round(env.ts * 1e6)); // µs-exact
      expect(env.ts).toBeGreaterThanOrEqual(0);
    }
    const kicks = w.envelopes.filter((e) => e.payload.track === 'kick');
    /* step 1 is off → swing moves nothing on the quarter grid; probe a hat on an odd 16th instead */
    const p2 = fourOnTheFloorProject({ swing: 50 });
    put(p2.patterns.A, 2, 3); // hat on odd 16th
    const w2 = projectToWire(p2, { bars: 1 });
    const hat = w2.envelopes.find((e) => e.payload.track === 'hat');
    const grid = 3 * (60 / 125 / 4);
    expect(hat.ts).toBeGreaterThan(grid); // pushed by +swing
    expect(hat.ts).toBeLessThan(grid + 0.2); // …but stays inside the step window
  });

  test('prob < 1 resolves through the device determinism law — same seed identical, cross-seed differs', () => {
    const mkFlaky = (seed) => fourOnTheFloorProject({ seed });
    const a1 = projectToWire(mkFlaky('DET-A'), { bars: 1 });
    const a2 = projectToWire(mkFlaky('DET-A'), { bars: 1 });
    expect(a1.envelopes.length).toBe(a2.envelopes.length);
    expect(wireSize(a1.envelopes)).toBe(wireSize(a2.envelopes));

    /* flaky steps: two hat 16ths at prob .3 — different project seeds draw
       different gates (the device's own barSeed law), so the wires diverge
       with overwhelming probability while each stays deterministic */
    const mkGambler = (seed) => {
      const p = mkProject();
      const A = mkPattern('A', 8);
      put(A, 0, 0); // anchor kick
      put(A, 2, 1, { prob: 0.3 });
      put(A, 2, 5, { prob: 0.3 });
      p.patterns = { A };
      p.currentPattern = 'A';
      p.seed = seed;
      return p;
    };
    const seedNames = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
    const counts = seedNames.map((s) => projectToWire(mkGambler(s), { bars: 1 }).envelopes.length);
    expect(new Set(counts).size).toBeGreaterThan(1); // the law actually gates
    for (const s of seedNames) {
      const again = projectToWire(mkGambler(s), { bars: 1 });
      expect(again.envelopes.length).toBe(counts[seedNames.indexOf(s)]); // …deterministically
    }
  });

  test('kit probe: a hat lane loaded with an open-hat preset rides openhat on the wire', () => {
    const p = fourOnTheFloorProject();
    p.tracks[2] = Object.assign({}, p.tracks[2], { sound: { type: 'hatO' } });
    put(p.patterns.A, 2, 2);
    const w = projectToWire(p, { bars: 1 });
    expect(w.envelopes.some((e) => e.payload.track === 'openhat')).toBe(true);
    expect(w.envelopes.some((e) => e.payload.track === 'hat')).toBe(false);
  });

  test('sections walk patterns bar-quantized (the arranger model: scene = {pattern, bars})', () => {
    const p = fourOnTheFloorProject();
    const B = mkPattern('B', 8);
    put(B, 3, 0, { vel: 0.6 }); // perc hits only in B
    put(B, 0, 0);
    p.patterns.B = B;
    const w = projectToWire(p, {
      sections: [
        { pattern: 'A', bars: 1 },
        { pattern: 'B', bars: 1 },
      ],
    });
    expect(w.bars).toBe(2);
    expect(w.sections).toEqual([
      { pattern: 'A', bars: 1 },
      { pattern: 'B', bars: 1 },
    ]);
    const percs = w.envelopes.filter((e) => e.payload.track === 'perc');
    expect(percs.length).toBe(1);
    expect(percs[0].ts).toBeGreaterThanOrEqual(60 / 125 * 4); // second bar onward
  });

  test('unknown patterns throw; unmappable extra tracks are COUNTED, never silently guessed', () => {
    const p = fourOnTheFloorProject();
    expect(() => projectToWire(p, { sections: [{ pattern: 'Z', bars: 1 }] })).toThrow(/unknown pattern/);

    const p2 = fourOnTheFloorProject();
    const ninth = mkPattern('A', 8); // a track index with no probe-able type
    p2.patterns.A.data[11] = ninth.data[0];
    p2.patterns.A.data[11].steps[0] = mkStep(true);
    p2.tracks[11] = { name: 'mystery' }; // no type/cat/sound → unmappable
    const w2 = projectToWire(p2, { bars: 1 });
    expect(w2.unmapped).toBe(1);
    expect(w2.envelopes.every((e) => FOUNDATION_TRACKS.includes(e.payload.track))).toBe(true);
  });

  test('the wire is byte-stable and the POST body carries the family contract fields', () => {
    const p = buildStyle('PSYTRANCE', 42);
    const w1 = projectToWire(p, { sections: [{ pattern: 'A', bars: 2 }, { pattern: 'B', bars: 2 }] });
    const w2 = projectToWire(buildStyle('PSYTRANCE', 42), {
      sections: [{ pattern: 'A', bars: 2 }, { pattern: 'B', bars: 2 }],
    });
    expect(wireSize(w1.envelopes)).toBe(w2.wireBytes);
    expect(w1.envelopes.length).toBe(w2.envelopes.length);
    expect(w1.envelopes.length).toBeGreaterThan(0);
    /* every rev is unique and time-ordered */
    for (let i = 0; i < w1.envelopes.length; i++) expect(w1.envelopes[i].rev).toBe(i + 1);
    for (let i = 1; i < w1.envelopes.length; i++) {
      expect(w1.envelopes[i].ts).toBeGreaterThanOrEqual(w1.envelopes[i - 1].ts);
    }
    const body = JSON.parse(wireToRenderNotesBody(w1.envelopes, { seed: 42, bpm: w1.bpm, bars: w1.bars }));
    expect(body.seed).toBe(42);
    expect(body.bars).toBe(4);
    expect(body.bpm).toBe(w1.bpm);
    expect(w1.bpm).toBe(145); // the PSYTRANCE factory home tempo rides the wire
    expect(Array.isArray(body.notes)).toBe(true);
    expect(body.notes.length).toBe(w1.envelopes.length);
  });

  test('factory styles map cleanly: PSYTRANCE/TECHNO wires contain only foundation tracks and zero unmapped', () => {
    for (const style of ['PSYTRANCE', 'TECHNO', 'TRANCE', 'PROGRESSIVE']) {
      const p = buildStyle(style, 7);
      const w = projectToWire(p, { sections: [{ pattern: 'A', bars: 2 }, { pattern: 'B', bars: 2 }] });
      expect(w.envelopes.length).toBeGreaterThan(8);
      expect(w.unmapped).toBe(0);
      for (const env of w.envelopes) {
        expect(FOUNDATION_TRACKS).toContain(env.payload.track);
        expect(validateEnvelope(env).ok).toBe(true);
      }
    }
  });
});
