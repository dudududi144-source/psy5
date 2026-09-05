/* ============ PER-BAR EVOLUTION (v0.9.0 P2) — sections that morph ============
   Deterministic, opt-in micro-variation at every BAR boundary while a song
   plays. State: p.evolution = { on: false (DEFAULT), intensity: 0..100
   (default 35), seed: (optional — defaults to the project seed) }. The
   field is materialized lazily (same pattern as p.arranger): projects that
   never touch evolution don't gain the field, so every pre-v0.9.0 project
   renders BYTE-IDENTICAL to before (the OFF contract — G32 pins it).

   Pipeline position (documented in ARCHITECTURE):
     snapshot launch → EVOLUTION → lane automation
   — the scene mix snapshot is applied first (v0.8.0 launch primitive), then
   evolution adjusts the EVENT LIST, then lane automation writes locks.
   Precedence per step: where a lane already covers a (track,param) pair in
   an event's lock, the LANE WINS — evolution's cutoff/sendA creep only
   fills pairs no lane covers at that step.

   Reuse mandate: evolution writes ONLY through existing machinery:
     - the base event list comes from stepEvents (the same deterministic
       per-step function the live scheduler, the WAV oracle and the MIDI
       exporter use) — there is no second scheduler and no parallel engine
     - ops are seeded via barSeed (fnv(seed+':'+label) → mulberry32), the
       device per-bar seeding convention
     - cutoff/sendA creep lands in the event `lock` channel (voice-level
       param overrides the engine already applies), clamped to the param
       REGISTRY ranges (paramById)
     - bass roll notes come from p.harmony (the P1 progression) when the
       project carries one, else the project root — evolution never plays
       an off-chord bass note
   No Date.now / Math.random anywhere: every decision derives from
   (evolutionSeed, absolute song bar, step-in-bar).

   Op set (probability ∝ intensity/100, all clamped):
     1. hat density shift   — drop one hat hit OR add a ghost hat (tr 2)
     2. bass roll injection — add a chord-root bass hit on an ODD 16th (tr 4)
     3. lead contour ±1     — transpose lead notes one SCALE degree (tr 5),
                              direction seeded per bar (coherent contour)
     4. perc ghost accents  — add a low-velocity perc hit (tr 3)
     5. cutoff/sendA creep  — per-bar seeded multiplier/offset through the
                              lock channel on lane-free pairs

   Live vs offline: the offline walk (songSchedule / renderSong / songMidi)
   knows the absolute song bar directly. The live scheduler is pattern-
   relative, so evolution keys to the ARRANGER position (the same absolute
   bar the offline walk computes for the same arrangement) and only applies
   while the arranger is ON (song mode — manual scene launches stop the
   arranger and therefore pause evolution; a plain pattern loop has no song
   position to evolve). Replay determinism holds in both paths. */
import { stepEvents, barSeed, clamp, SCALES } from './model.js';
import { paramById } from './params.js';
import { mulberry32, degreeToSemitone } from '../foundation/foundation.mjs';

/* evolutionState — lazy canonical backfill (never mutates untouched legacy
 * projects: the field appears only once this module is consulted). */
export function evolutionState(p) {
  if (!p) return { on: false, intensity: 35 };
  if (!p.evolution || typeof p.evolution !== 'object') p.evolution = { on: false, intensity: 35 };
  if (typeof p.evolution.on !== 'boolean') p.evolution.on = false;
  if (typeof p.evolution.intensity !== 'number' || !isFinite(p.evolution.intensity)) p.evolution.intensity = 35;
  p.evolution.intensity = clamp(Math.round(p.evolution.intensity), 0, 100);
  return p.evolution;
}

/* evolutionSeedOf — explicit seed or the project seed (string-safe). */
export function evolutionSeedOf(p) {
  const ev = evolutionState(p);
  return ev.seed != null ? String(ev.seed) : String(p.seed == null ? 'PSY6' : p.seed);
}

/* UI evidence counters (never part of the event output): ops applied while
   evolving schedules — the Perform-tab readout. Monotonic per session. */
const EVO_STATS = { ops: 0, bars: 0 };
export function evolutionStats() { return { ops: EVO_STATS.ops, bars: EVO_STATS.bars }; }
export function evolutionResetStats() { EVO_STATS.ops = 0; EVO_STATS.bars = 0; }

/* absBarOf — the absolute song bar for the LIVE path, derived from the
 * arranger position (idx/barsIn) without any new scheduler state:
 *   absBar = Σ bars of completed steps + (barsIn − 1)   [barsIn ≥ 1]
 * (at a section boundary the hook has already advanced idx and reset
 * barsIn to 0 → the formula yields the new section's first bar). Returns
 * −1 when the arranger is off (no song position → no evolution live). */
export function absBarOf(p) {
  const a = p && p.arranger;
  if (!a || a.v !== 1 || !a.on || !Array.isArray(a.steps)) return -1;
  let sum = 0;
  for (let i = 0; i < a.idx && i < a.steps.length; i++) sum += a.steps[i].bars | 0;
  const barsIn = a.barsIn | 0;
  return sum + (barsIn > 1 ? barsIn - 1 : 0);
}

/* transposeScaleDegree — move a midi note ±1 scale degree within the scale
 * (octave-correct wrap: below degree 0 → previous octave, above 6 → next).
 * Notes outside the scale are left unchanged (evolution never bends user
 * material off-pitch). */
function transposeScaleDegree(note, root, scaleIv, dir) {
  const pc = ((note - root) % 12 + 12) % 12;
  let idx = scaleIv.indexOf(pc);
  if (idx < 0) return note;
  idx += dir;
  let oct = 0;
  if (idx < 0) { idx += scaleIv.length; oct = -12 }
  if (idx >= scaleIv.length) { idx -= scaleIv.length; oct = 12 }
  return note - pc + scaleIv[idx] + oct;
}

/* chordRootAtPatternBar — the P1 progression's bass note for the ACTIVE
 * PATTERN bar (the exact mapping fillSection/deriveVariant baked into the
 * patterns: chord = degrees[patternBar % progBars]). Using the pattern bar
 * (not the song bar) keeps injections on the chord that is AUDIBLY playing
 * — 8-bar progressions repeat inside longer sections, so the song bar's
 * degree index can differ from the baked one. Falls back to the project
 * root when the project carries no harmony. */
function chordRootAtPatternBar(p, patternBar) {
  const h = p.harmony;
  if (h && Array.isArray(h.degrees) && h.degrees.length) {
    const iv = SCALES[p.scale] || SCALES.minor;
    const deg = h.degrees[((patternBar % h.degrees.length) + h.degrees.length) % h.degrees.length];
    return p.root + degreeToSemitone(iv, deg);
  }
  return p.root;
}

/* evolveStep — one step's evolution pass. Returns the (possibly new) event
 * array; `ops` accumulates the applied op count for the UI evidence. */
function evolveStep(p, base, bar, stepInBar, ops, patternBar) {
  const ev = p.evolution;
  const q = clamp(ev.intensity, 0, 100) / 100;
  if (q <= 0) return base;
  const seed = evolutionSeedOf(p);
  const barRng = mulberry32(barSeed(seed, 'evo:' + bar));
  const rng = mulberry32(barSeed(seed, 'evo:' + bar + ':' + stepInBar));
  let list = base, changed = false;
  const has = t => list.some(e => e.track === t);
  const drop = t => { list = list.filter(e => e.track !== t); changed = true };
  const add = e => { list = list.concat([e]); changed = true; ops.n++ };
  /* 1. hat density shift */
  if (rng() < 0.18 * q) {
    if (has(2) && rng() < 0.5) { drop(2); ops.n++ }
    else if (!has(2)) add({ track: 2, off: 0, vel: clamp(0.2 + rng() * 0.15, 0.05, 1), note: 48, lock: {} });
    else rng(); /* consume: keep stream shape stable across branches */
  }
  /* 2. bass roll injection on off-phrase (odd) 16ths — chord-root note of
        the AUDIBLY active pattern bar (see chordRootAtPatternBar) */
  if (stepInBar % 2 === 1 && rng() < 0.16 * q && !has(4)) {
    add({ track: 4, off: 0, vel: clamp(0.55 + rng() * 0.2, 0.05, 1), note: clamp(Math.round(chordRootAtPatternBar(p, patternBar)), 12, 108), lock: {} });
  }
  /* 3. lead contour ±1 scale degree (direction seeded per bar) */
  if (has(5) && rng() < 0.35 * q) {
    const dir = barRng() < 0.5 ? -1 : 1;
    const iv = SCALES[p.scale] || SCALES.minor;
    for (const e of list) if (e.track === 5) { e.note = clamp(Math.round(transposeScaleDegree(e.note, p.root, iv, dir)), 12, 108); changed = true }
    ops.n++;
  }
  /* 4. perc ghost accent */
  if (rng() < 0.14 * q && !has(3)) {
    add({ track: 3, off: 0, vel: clamp(0.15 + rng() * 0.15, 0.05, 1), note: 48, lock: {} });
  }
  /* 5. cutoff/sendA creep — per-bar decision, event-level locks, lane-free
     pairs only (lane-covered pairs win per-step), registry ranges.
     v0.28.0 ANTI-GARBAGE FAMILY CEILINGS (ported from psyreason 1457c48):
     the mutation may never push a family past its musical ceiling —
     bass/pad ≤ 2400 Hz (mud/whistle guard), lead ≤ 6500 Hz (scream guard);
     other families keep the registry ceiling. tr.sound.cat ships with the
     copied preset object (assignPresetToTrack), so no new imports. */
  if (barRng() < 0.45 * q) {
    const cutMul = 1 + (barRng() - 0.5) * 0.5 * q;
    const sendAdd = (barRng() - 0.5) * 0.16 * q;
    const cutRange = paramById('cutoff'); /* registry bounds (60..14000) */
    const FAMILY_CEIL = { bass: 2400, pad: 2400, lead: 6500 };
    for (const e of list) {
      const tr = p.tracks[e.track];
      if (!tr) continue;
      const lock = e.lock || (e.lock = {});
      if (lock.cutoff === undefined && tr.sound && typeof tr.sound.cutoff === 'number') {
        const famCeil = FAMILY_CEIL[tr.sound.cat];
        const hi = Math.min(cutRange ? cutRange.max : 14000, famCeil != null ? famCeil : Infinity);
        lock.cutoff = clamp(Math.round(tr.sound.cutoff * cutMul), cutRange ? cutRange.min : 60, hi);
        changed = true;
      }
      if (lock['mix.sendA'] === undefined && tr.mix && typeof tr.mix.sendA === 'number') {
        lock['mix.sendA'] = clamp(tr.mix.sendA + sendAdd, 0, 1);
        changed = true;
      }
    }
    ops.n++;
  }
  return changed ? list : base;
}

/* evolvedSongEvents — the SONG-walk wrapper (offline: songSchedule,
 * renderSong, songMidi). bar = absolute song bar = absStep >> 4. */
export function evolvedSongEvents(p, absStep, phase) {
  const base = stepEvents(p, phase);
  const ev = p.evolution;
  if (!ev || !ev.on) return base;
  const q = clamp(ev.intensity, 0, 100) / 100;
  if (q <= 0) return base;
  const bar = absStep >> 4;
  const ops = { n: 0 };
  const out = evolveStep(p, base, bar, ((phase % 16) + 16) % 16, ops, phase >> 4);
  if (ops.n > 0) { EVO_STATS.ops += ops.n; EVO_STATS.bars++ }
  return out;
}

/* evolvedLiveEvents — the live-scheduler wrapper (pattern-relative step).
 * Evolution applies only in song mode (arranger ON); the absolute bar comes
 * from the arranger position (absBarOf) so live playback morphs in exactly
 * the same bar-seeded way the offline render does. */
export function evolvedLiveEvents(p, phase) {
  const base = stepEvents(p, phase);
  const ev = p.evolution;
  if (!ev || !ev.on) return base;
  const q = clamp(ev.intensity, 0, 100) / 100;
  if (q <= 0) return base;
  const bar = absBarOf(p);
  if (bar < 0) return base;
  const ops = { n: 0 };
  const out = evolveStep(p, base, bar, ((phase % 16) + 16) % 16, ops, phase >> 4);
  if (ops.n > 0) { EVO_STATS.ops += ops.n; EVO_STATS.bars++ }
  return out;
}
