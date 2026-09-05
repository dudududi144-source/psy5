/* PSY6 FAMILY WIRE (Task 19) — the groovebox's WHAT rides the family wire.
 *
 * This module is the single place where a PSY6 project becomes PSYBUS v2
 * envelopes — the same wire the psy-anthem (Task 17-b) and psysampler
 * (Task 18) adoptions proved end-to-end against foundation's
 * POST /api/render-notes. The codec is NOT re-implemented here: it is the
 * verbatim vendored foundation protocol (foundation/protocol/v2/{types,
 * envelope,deprecations}.ts — byte-identical copies of psy-foundation
 * packages/protocol/src/v2, md5-verified at vendor time).
 *
 * Division of labor (the family's no-duplicates law):
 *   PSY6        owns WHAT-and-when — patterns, scenes, the section arranger,
 *               grooves (13 templates), fills (8 layouts), per-step
 *               probability/micro-timing resolved by the device's own
 *               deterministic walker (model.js stepEvents — the SAME
 *               function the real-time engine plays through);
 *   foundation  owns HOW-it-sounds — voices → bus glue → master chain,
 *               mastered WAV back over the render endpoint.
 *
 * Runtime honesty: this module imports the vendored .ts codec, so it runs
 * where TypeScript loads (bun — the repo's test/e2e runner), not in the
 * plain-browser device. The browser device keeps its real-time worklet
 * engine; wiring the wire into an in-browser export path is future work
 * (documented in docs/PSY_FAMILY.md), NOT silently claimed here.
 */

import { stepEvents, clamp, MAX_TRACKS } from './model.js';
import { canonicalJson, validateEnvelope } from '../foundation/protocol/v2/envelope.ts';
import { asTrackId } from '../foundation/protocol/v2/types.ts';

/** The 16 foundation voice/track names — exactly foundation's ExternalTrack
 *  union (apps/web/src/app/api/render-notes/route.ts). A stream with foreign
 *  track names is a consumer-side mapping bug and foundation answers 400. */
export const FOUNDATION_TRACKS = [
  'kick',
  'bass',
  'lead',
  'counter',
  'subbass',
  'hat',
  'openhat',
  'snare',
  'clap',
  'perc',
  'shaker',
  'pad',
  'acid',
  'riser',
  'impact',
  'texture',
];

/** PSY6's canonical 8 device lanes (model.js track map, documented on
 *  GROOVES) → foundation voices. Drum notes are pinned to the same values
 *  the psysampler e2e used (kick 36, hat 42) plus the GM-adjacent snare 38
 *  and perc 45, so all family members drive consistent drum voices against
 *  the same foundation engine. Tonal lanes (note == null) carry the step's
 *  own MIDI note — the device's harmonic WHAT passes through untouched.
 *
 *  durBeats: bass .45 and lead .22 mirror the psysampler wire (family
 *  parity where lanes overlap); pad is sustained (1 beat); grid percussion
 *  rides short envelopes. */
export const DEVICE_LANE_MAP = Object.freeze([
  { lane: 'KICK', track: 'kick', note: 36, durBeats: 0.25 },
  { lane: 'SNARE', track: 'snare', note: 38, durBeats: 0.25 },
  { lane: 'HATS', track: 'hat', note: 42, durBeats: 0.125 },
  { lane: 'PERC', track: 'perc', note: 45, durBeats: 0.25 },
  { lane: 'BASS', track: 'bass', note: null, durBeats: 0.45 },
  { lane: 'LEAD', track: 'lead', note: null, durBeats: 0.22 },
  { lane: 'PAD', track: 'pad', note: null, durBeats: 1.0 },
  { lane: 'ARP', track: 'acid', note: null, durBeats: 0.22 },
]);

/** drum-kit probe → foundation drum voice (for lanes whose preset type
 *  overrides the lane default — e.g. a hat lane loaded with an open-hat
 *  preset really plays 'openhat' on the wire). */
const DRUM_TYPE_MAP = Object.freeze({
  kick: 'kick',
  snare: 'snare',
  clap: 'clap',
  hatc: 'hat',
  hat: 'hat',
  hato: 'openhat',
  openhat: 'openhat',
  shaker: 'shaker',
  riser: 'riser',
});

/** synth category → foundation voice for user-added tracks (index ≥ 8). */
const SYNTH_CAT_MAP = Object.freeze({
  bass: 'bass',
  lead: 'lead',
  pad: 'pad',
  arp: 'acid',
  pluck: 'acid',
  texture: 'texture',
  synth: 'lead',
  fx: 'riser',
});

export const WIRE_DEFAULTS = Object.freeze({
  seed: 1,
  bpm: 125, // the PSY6 factory default (mkProject)
  deviceId: 'psy6',
});

const US = 1e6;
const qUs = (t) => Math.round(t * US) / US; // µs-quantized, deterministic
const clampMidi = (n) => Math.max(0, Math.min(127, Math.round(Number(n) || 0)));
const clampVel = (v) => clamp(Number(v) || 0.05, 0.05, 1); // the device's own vel law

/** Probe a track's drum type / synth category (track objects carry
 *  sound.type for drum kits and cat for synths — same fields padType reads). */
function probeTrack(p, t) {
  const tr = Array.isArray(p.tracks) ? p.tracks[t] : null;
  if (!tr) return '';
  const sd = tr.sound || {};
  return String(sd.type || tr.type || tr.cat || '').toLowerCase();
}

/** Map one stepEvents() event to a foundation voice. Returns null for
 *  tracks this bridge honestly cannot name (counted as unmapped, never
 *  silently guessed). */
function mapEvent(p, ev) {
  const t = ev.track;
  if (t >= 0 && t < DEVICE_LANE_MAP.length) {
    const lane = DEVICE_LANE_MAP[t];
    if (lane.note != null) {
      /* drum lane — the kit's own type can override the voice (hatO → openhat) */
      const probed = DRUM_TYPE_MAP[probeTrack(p, t)];
      return {
        track: probed || lane.track,
        note: lane.note,
        vel: clampVel(ev.vel),
        durBeats: lane.durBeats,
      };
    }
    return { track: lane.track, note: clampMidi(ev.note), vel: clampVel(ev.vel), durBeats: lane.durBeats };
  }
  if (t >= MAX_TRACKS) return null;
  const probed = probeTrack(p, t);
  const drum = DRUM_TYPE_MAP[probed];
  if (drum) {
    return { track: drum, note: drum === 'kick' ? 36 : drum === 'snare' ? 38 : drum === 'clap' ? 39 : 42, vel: clampVel(ev.vel), durBeats: 0.25 };
  }
  const synth = SYNTH_CAT_MAP[probed];
  if (synth) {
    return { track: synth, note: clampMidi(ev.note), vel: clampVel(ev.vel), durBeats: 0.3 };
  }
  return null;
}

/**
 * Convert a PSY6 project (its CURRENT patterns, grooves, swing, lanes,
 * per-step prob/micro/vel — everything the device would play) into
 * validated PSYBUS v2 note envelopes, using the device's own deterministic
 * event walker (stepEvents) — zero re-implementation of the WHAT.
 *
 * Sections: pass opts.sections = [{pattern, bars}, …] — exactly the
 * arranger/scene model (scene = {pattern, bars}) — to render a song
 * structure; the pattern switches at bar boundaries and stepEvents keeps
 * resolving groove/prob per bar from the project seed. Without sections,
 * opts.bars (default 1) loops the current pattern.
 *
 * The caller's project object is never mutated (shallow copy per walk).
 */
export function projectToWire(project, opts = {}) {
  if (!project || typeof project !== 'object') {
    throw new TypeError('projectToWire: project must be a PSY6 project object');
  }
  const seed = opts.seed ?? WIRE_DEFAULTS.seed;
  const bpm = Number(opts.bpm ?? project.bpm) || WIRE_DEFAULTS.bpm;
  const deviceId = String(opts.deviceId ?? WIRE_DEFAULTS.deviceId);
  if (deviceId.length === 0 || deviceId.length > 128) {
    throw new RangeError('deviceId exceeds PSYBUS MAX_ID_LENGTH (128)');
  }

  let plan;
  if (Array.isArray(opts.sections) && opts.sections.length > 0) {
    plan = opts.sections.map((sec) => {
      const bars = Math.max(1, Math.floor(Number(sec.bars) || 1));
      const pattern = String(sec.pattern ?? project.currentPattern ?? 'A');
      if (!project.patterns || !project.patterns[pattern]) {
        throw new TypeError(`projectToWire: sections reference unknown pattern "${pattern}"`);
      }
      return { pattern, bars };
    });
  } else {
    const bars = Math.max(1, Math.floor(Number(opts.bars) || 1));
    const pattern = String(project.currentPattern || 'A');
    if (!project.patterns || !project.patterns[pattern]) {
      throw new TypeError(`projectToWire: unknown current pattern "${pattern}"`);
    }
    plan = [{ pattern, bars }];
  }
  const totalBars = plan.reduce((a, s) => a + s.bars, 0);
  const secPerStep = 60 / bpm / 4; // 16th note

  const p = Object.assign({}, project); // never mutate the caller's project
  const envelopes = [];
  let rests = 0;
  let unmapped = 0;
  let rev = 0;
  let spanSec = 0;
  let s = 0;

  for (const sec of plan) {
    p.currentPattern = sec.pattern;
    const steps = sec.bars * 16;
    for (let i = 0; i < steps; i++, s++) {
      const evs = stepEvents(p, s);
      if (!evs.length) {
        rests += 1;
        continue;
      }
      const baseTs = s * secPerStep;
      for (const ev of evs) {
        const mapped = mapEvent(p, ev);
        if (!mapped) {
          unmapped += 1;
          continue;
        }
        /* ts = grid time + the device's own offset (swing/groove/micro, in
         * seconds) — the groove SURVIVES the wire. Clamped at 0 so a
         * negative micro on step 0 cannot fall before the window. */
        const ts = qUs(Math.max(0, baseTs + ev.off));
        if (ts > spanSec) spanSec = ts;
        const candidate = {
          rev: ++rev,
          seed,
          src: deviceId,
          dst: 'broadcast',
          ts,
          payload: {
            kind: 'note',
            track: asTrackId(mapped.track),
            note: mapped.note,
            vel: mapped.vel,
            durBeats: mapped.durBeats,
            channel: 0,
          },
        };
        const checked = validateEnvelope(candidate);
        if (!checked.ok) {
          throw new Error(
            `projectToWire: envelope failed PSYBUS v2 validation (${checked.error?.code} at ${checked.error?.path}: ${checked.error?.message}) — this is a bug in the mapping, not in your config`,
          );
        }
        envelopes.push(checked.value);
      }
    }
  }

  envelopes.sort((a, b) => a.ts - b.ts || a.rev - b.rev);
  const ordered = envelopes.map((env, i) => {
    const checked = validateEnvelope({ ...env, rev: i + 1 });
    if (!checked.ok) {
      throw new Error(
        `projectToWire: envelope ${i} failed validation after rev re-assignment: ${checked.error?.message ?? 'unknown'}`,
      );
    }
    return checked.value;
  });

  const wireBytes = Buffer.from(canonicalJson(ordered), 'utf8').length;
  return {
    envelopes: ordered,
    rejected: 0,
    rests,
    unmapped,
    wireBytes,
    spanSec,
    bars: totalBars,
    bpm,
    seed,
    sections: plan.map((sec) => ({ pattern: sec.pattern, bars: sec.bars })),
  };
}

/** Canonical-JSON byte size of a wire (the byte-stable efficiency metric). */
export function wireSize(envelopes) {
  return Buffer.from(canonicalJson(envelopes), 'utf8').length;
}

/** Build the exact POST body foundation's /api/render-notes consumes
 *  (same shape the anthem and psysampler pipelines send). */
export function wireToRenderNotesBody(envelopes, opts) {
  const { seed, bpm, bars } = opts;
  return JSON.stringify({
    seed,
    bpm,
    bars,
    notes: envelopes,
  });
}
