// foundation/music/progression.mjs — PSY6 v0.9.0 P1 chord progression engine
// (pure, deterministic, immutable — foundation contract: no DOM, no Date.now,
// no Math.random; every pick derives from fnv1a of the project seed string).
//
// Purpose: give the composer HARMONIC COHERENCE. Before this module the
// composer's bass sat on the scale root, the lead motif floated freely on the
// scale and pad/arp used fixed intervals — every section was harmonically
// static. Now every style family owns 12 seeded progression templates
// (4/8-bar loops of diatonic scale degrees); the composer picks ONE per
// project via fnv1a(seed + ':prog') and derives bass roots, lead motif
// harmonization and pad/arp voicings from the active bar's chord.
//
// Degree convention (all templates): integers 0..6 are SCALE degrees of the
// style's mode — 0=i, 1=bII/ii, 2=bIII/III, 3=iv/IV, 4=v/V, 5=bVI/VI,
// 6=bVII/VII (the exact semitone is mode-aware: it comes from the scale's
// interval list, e.g. degree 1 is a bII in phrygian [0,1,3,5,7,8,10] but a
// dim triad root in harmonic minor). A chord on degree d is the DIATONIC
// TRIAD (d, d+2, d+4) — three scale degrees stacked in thirds within the
// mode — so voicings are automatically mode-aware without per-mode tables.
//
// Rhythm tracks (kick/snare/hat/perc/fx) never consume this module: the
// progression only reshapes tonal material (bass/lead/pad/arp).

export class MusicError extends Error { constructor(msg) { super(msg); this.name = "MusicError"; } }

/* 12 templates per style family × 5 families. Each: { id, bars, degrees }
 * — degrees has exactly `bars` entries (one chord per bar, looped). The
 * 4-bar templates are the classic minor-mode loops; the 8-bar ones give the
 * composer a half-form harmonic arc. Families bias their picks: FULL-ON and
 * PROGRESSIVE lean on the i–VI–III–VII / i–iv–VI family of loops, DARK-PSY
 * and HI-TECH on bII/bVII tension loops, FOREST on harmonic-minor v (major
 * dominant) colors. All degrees stay within 0..6 (diatonic). */
export const PROGRESSION_TEMPLATES = {
  'FULL-ON': [
    { id: 'i-VI-III-VII', bars: 4, degrees: [0, 5, 2, 6] },
    { id: 'i-iv-vII-i', bars: 4, degrees: [0, 3, 6, 0] },
    { id: 'i-vII-VI-v', bars: 4, degrees: [0, 6, 5, 4] },
    { id: 'i-bII-i-vII', bars: 4, degrees: [0, 1, 0, 6] },
    { id: 'i-i-VI-vII', bars: 4, degrees: [0, 0, 5, 6] },
    { id: 'i-III-vII-iv', bars: 4, degrees: [0, 2, 6, 3] },
    { id: 'i-VI-iv-vII-x2', bars: 8, degrees: [0, 5, 3, 6, 0, 5, 2, 6] },
    { id: 'i-vII-VI-pedal', bars: 8, degrees: [0, 0, 6, 6, 5, 5, 6, 6] },
    { id: 'i-v-vII-iv', bars: 4, degrees: [0, 4, 6, 3] },
    { id: 'i-VI-vII-i', bars: 4, degrees: [0, 5, 6, 0] },
    { id: 'i-iv-i-VI-vII', bars: 8, degrees: [0, 3, 0, 6, 0, 5, 0, 6] },
    { id: 'i-vII-i-VI', bars: 4, degrees: [0, 6, 0, 5] },
  ],
  'DARK-PSY': [
    { id: 'i-bII-pedal', bars: 4, degrees: [0, 1, 0, 0] },
    { id: 'i-bII-III-i', bars: 4, degrees: [0, 1, 2, 0] },
    { id: 'i-bII-i-vII', bars: 4, degrees: [0, 1, 0, 6] },
    { id: 'i-i-bII-i', bars: 4, degrees: [0, 0, 1, 0] },
    { id: 'i-VI-bII-i', bars: 4, degrees: [0, 5, 1, 0] },
    { id: 'i-vII-bII-i', bars: 4, degrees: [0, 6, 1, 0] },
    { id: 'i-bII-arc', bars: 8, degrees: [0, 1, 0, 1, 0, 6, 0, 1] },
    { id: 'i-bII-vII-blocks', bars: 8, degrees: [0, 0, 1, 1, 0, 0, 6, 6] },
    { id: 'i-III-bII-i', bars: 4, degrees: [0, 2, 1, 0] },
    { id: 'i-iv-bII-i', bars: 4, degrees: [0, 3, 1, 0] },
    { id: 'i-vII-VI-bII-desc', bars: 8, degrees: [0, 6, 5, 1, 0, 6, 5, 0] },
    { id: 'i-bII-vII-VI', bars: 4, degrees: [0, 1, 6, 5] },
  ],
  'PROGRESSIVE': [
    { id: 'i-VI-III-VII', bars: 4, degrees: [0, 5, 2, 6] },
    { id: 'i-iv-VI-VII', bars: 4, degrees: [0, 3, 5, 6] },
    { id: 'i-VI-iv-v', bars: 4, degrees: [0, 5, 3, 4] },
    { id: 'i-VII-VI-iv', bars: 4, degrees: [0, 6, 5, 3] },
    { id: 'i-iv-v-i', bars: 4, degrees: [0, 3, 4, 0] },
    { id: 'i-VI-VII-v', bars: 4, degrees: [0, 5, 6, 4] },
    { id: 'i-VI-III-VII-iv-v', bars: 8, degrees: [0, 5, 2, 6, 0, 5, 3, 4] },
    { id: 'i-VI-iv-VII-pedal', bars: 8, degrees: [0, 0, 5, 5, 3, 3, 6, 6] },
    { id: 'i-III-VI-iv', bars: 4, degrees: [0, 2, 5, 3] },
    { id: 'i-v-VI-III', bars: 4, degrees: [0, 4, 5, 2] },
    { id: 'i-iv-i-VI-VII-v', bars: 8, degrees: [0, 3, 0, 5, 0, 6, 0, 4] },
    { id: 'i-VII-iv-VI', bars: 4, degrees: [0, 6, 3, 5] },
  ],
  'FOREST': [
    { id: 'i-VI-III-VII', bars: 4, degrees: [0, 5, 2, 6] },
    { id: 'i-iv-v-i', bars: 4, degrees: [0, 3, 4, 0] },
    { id: 'i-V-VI-VII', bars: 4, degrees: [0, 4, 5, 6] },
    { id: 'i-VII-VI-V', bars: 4, degrees: [0, 6, 5, 4] },
    { id: 'i-iv-VI-VII', bars: 4, degrees: [0, 3, 5, 6] },
    { id: 'i-III-VI-iv', bars: 4, degrees: [0, 2, 5, 3] },
    { id: 'i-V-iv-i-VI-VII', bars: 8, degrees: [0, 4, 3, 0, 0, 5, 6, 4] },
    { id: 'i-iv-V-pedal', bars: 8, degrees: [0, 0, 3, 3, 4, 4, 5, 5] },
    { id: 'i-VI-V-i', bars: 4, degrees: [0, 5, 4, 0] },
    { id: 'i-iv-i-V', bars: 4, degrees: [0, 3, 0, 4] },
    { id: 'i-VI-iv-VII-V-iv', bars: 8, degrees: [0, 5, 3, 6, 0, 4, 3, 0] },
    { id: 'i-V-VI-iv', bars: 4, degrees: [0, 4, 5, 3] },
  ],
  'HI-TECH': [
    { id: 'i-bII-osc', bars: 4, degrees: [0, 1, 0, 1] },
    { id: 'i-bII-vII-osc', bars: 4, degrees: [0, 1, 6, 1] },
    { id: 'i-vII-bII-i', bars: 4, degrees: [0, 6, 1, 0] },
    { id: 'i-VI-bII-vII', bars: 4, degrees: [0, 5, 1, 6] },
    { id: 'i-bII-i-VI', bars: 4, degrees: [0, 1, 0, 5] },
    { id: 'i-iv-bII-vII', bars: 4, degrees: [0, 3, 1, 6] },
    { id: 'i-bII-vII-arc', bars: 8, degrees: [0, 1, 0, 1, 6, 1, 0, 5] },
    { id: 'i-bII-vII-blocks', bars: 8, degrees: [0, 0, 1, 0, 6, 6, 1, 1] },
    { id: 'i-III-bII-vII', bars: 4, degrees: [0, 2, 1, 6] },
    { id: 'i-vII-VI-bII', bars: 4, degrees: [0, 6, 5, 1] },
    { id: 'i-bII-iv-VI-osc', bars: 8, degrees: [0, 1, 3, 1, 0, 5, 6, 1] },
    { id: 'i-bII-VI-i', bars: 4, degrees: [0, 1, 5, 0] },
  ],
  /* ── v0.13.1: four NEW families for the four new composer styles
     (PSYTRANCE / GOA / TECHNO / TRANCE). Same 12-template contract, same
     degree convention; purely additive — the five legacy families are
     byte-untouched. ── */
  'PSYTRANCE': [
    { id: 'i-VI-III-VII', bars: 4, degrees: [0, 5, 2, 6] },
    { id: 'i-iv-VI-vII', bars: 4, degrees: [0, 3, 5, 6] },
    { id: 'i-VI-iv-v', bars: 4, degrees: [0, 5, 3, 4] },
    { id: 'i-vII-VI-v', bars: 4, degrees: [0, 6, 5, 4] },
    { id: 'i-bII-i-vII', bars: 4, degrees: [0, 1, 0, 6] },
    { id: 'i-III-iv-i', bars: 4, degrees: [0, 2, 3, 0] },
    { id: 'i-VI-iv-vII-x2', bars: 8, degrees: [0, 5, 3, 6, 0, 5, 3, 6] },
    { id: 'i-vII-VI-pedal', bars: 8, degrees: [0, 0, 6, 6, 5, 5, 6, 6] },
    { id: 'i-iv-i-VI', bars: 4, degrees: [0, 3, 0, 5] },
    { id: 'i-VI-vII-iv', bars: 4, degrees: [0, 5, 6, 3] },
    { id: 'i-iv-VI-i-vII', bars: 8, degrees: [0, 3, 5, 0, 0, 6, 0, 5] },
    { id: 'i-VI-i-vII', bars: 4, degrees: [0, 5, 0, 6] },
  ],
  'GOA': [
    { id: 'i-iv-V-i', bars: 4, degrees: [0, 3, 4, 0] },
    { id: 'i-V-iv-i', bars: 4, degrees: [0, 4, 3, 0] },
    { id: 'i-V-VI-VII', bars: 4, degrees: [0, 4, 5, 6] },
    { id: 'i-bII-V-i', bars: 4, degrees: [0, 1, 4, 0] },
    { id: 'i-III-iv-V', bars: 4, degrees: [0, 2, 3, 4] },
    { id: 'i-VI-V-iv', bars: 4, degrees: [0, 5, 4, 3] },
    { id: 'i-V-iv-VI-VII', bars: 8, degrees: [0, 4, 3, 5, 6, 4, 3, 0] },
    { id: 'i-iv-V-pedal', bars: 8, degrees: [0, 0, 3, 3, 4, 4, 0, 0] },
    { id: 'i-V-bII-i', bars: 4, degrees: [0, 4, 1, 0] },
    { id: 'i-iv-V-vII-i', bars: 8, degrees: [0, 3, 4, 3, 4, 0, 0, 6] },
    { id: 'i-V-i-iv', bars: 4, degrees: [0, 4, 0, 3] },
    { id: 'i-III-V-i', bars: 4, degrees: [0, 2, 4, 0] },
  ],
  'TECHNO': [
    { id: 'i-pedal-bII', bars: 4, degrees: [0, 0, 0, 1] },
    { id: 'i-i-iv-i', bars: 4, degrees: [0, 0, 3, 0] },
    { id: 'i-bII-pedal', bars: 4, degrees: [0, 1, 0, 0] },
    { id: 'i-iv-pedal', bars: 4, degrees: [0, 3, 0, 0] },
    { id: 'i-i-VI-i', bars: 4, degrees: [0, 0, 5, 0] },
    { id: 'i-vII-i-bII', bars: 4, degrees: [0, 6, 0, 1] },
    { id: 'i-i-iv-blocks', bars: 8, degrees: [0, 0, 3, 3, 0, 0, 1, 1] },
    { id: 'i-bII-osc', bars: 8, degrees: [0, 1, 0, 1, 0, 1, 0, 6] },
    { id: 'i-iv-vII-i', bars: 4, degrees: [0, 3, 6, 0] },
    { id: 'i-bII-III-i', bars: 4, degrees: [0, 1, 2, 0] },
    { id: 'i-i-VI-blocks', bars: 8, degrees: [0, 0, 5, 5, 0, 0, 3, 3] },
    { id: 'i-bII-i-VI', bars: 4, degrees: [0, 1, 0, 5] },
  ],
  'TRANCE': [
    { id: 'i-V-VI-III', bars: 4, degrees: [0, 4, 5, 2] },
    { id: 'i-III-VII-VI', bars: 4, degrees: [0, 2, 6, 5] },
    { id: 'i-V-iv-VI', bars: 4, degrees: [0, 4, 3, 5] },
    { id: 'i-VI-III-VII', bars: 4, degrees: [0, 5, 2, 6] },
    { id: 'i-VI-iv-V', bars: 4, degrees: [0, 5, 3, 4] },
    { id: 'i-V-vII-VI', bars: 4, degrees: [0, 4, 6, 5] },
    { id: 'i-V-VI-III-iv-V', bars: 8, degrees: [0, 4, 5, 2, 3, 4, 0, 0] },
    { id: 'i-VI-V-pedal', bars: 8, degrees: [0, 5, 5, 4, 4, 0, 0, 6] },
    { id: 'i-III-iv-VI', bars: 4, degrees: [0, 2, 3, 5] },
    { id: 'i-iv-VI-V-iv-VII', bars: 8, degrees: [0, 3, 5, 4, 3, 6, 4, 0] },
    { id: 'i-VI-V-i', bars: 4, degrees: [0, 5, 4, 0] },
    { id: 'i-III-VI-VII', bars: 4, degrees: [0, 2, 5, 6] },
  ],
};

const FAMILY_IDS = Object.keys(PROGRESSION_TEMPLATES);

/* validate at module load — a broken template must fail loudly, not compose
 * off-key music (foundation contract: fail fast on invariant breach) */
for (const fam of FAMILY_IDS) {
  const list = PROGRESSION_TEMPLATES[fam];
  if (!Array.isArray(list) || list.length !== 12) throw new MusicError("family " + fam + " must own exactly 12 templates");
  const seen = new Set();
  for (const t of list) {
    if (!t || typeof t.id !== "string") throw new MusicError("family " + fam + " template missing id");
    if (seen.has(t.id)) throw new MusicError("duplicate progression id " + t.id + " in " + fam);
    seen.add(t.id);
    if (!Number.isInteger(t.bars) || (t.bars !== 4 && t.bars !== 8)) throw new MusicError("progression " + t.id + " bars must be 4 or 8");
    if (!Array.isArray(t.degrees) || t.degrees.length !== t.bars) throw new MusicError("progression " + t.id + " degrees must have " + t.bars + " entries");
    for (const d of t.degrees) {
      if (!Number.isInteger(d) || d < 0 || d > 6) throw new MusicError("progression " + t.id + " degree out of diatonic range: " + d);
    }
  }
}

/* pickProgression — deterministic template selection for one project.
 * Hash input is the SPEC string: projectSeed + ':prog' (fnv1a, the device
 * hashing convention); the last 8 hex digits choose the template uniformly.
 * Same seed ⇒ same template, every machine, forever. */
export function pickProgression(family, seed) {
  const list = PROGRESSION_TEMPLATES[family];
  if (!list) throw new MusicError("unknown progression family: " + family);
  const key = String(seed) + ':' + 'prog';
  let h = fnv1aLocal(key);
  const idx = parseInt(h.slice(-8), 16) % list.length;
  return list[idx];
}

/* chordDegreeAt — the active chord's scale degree for absolute bar `bar`
 * of a pattern playing `prog` (the loop restarts with the pattern). */
export function chordDegreeAt(prog, bar) {
  if (!prog || !Array.isArray(prog.degrees)) throw new MusicError("chordDegreeAt: prog invalid");
  const n = prog.degrees.length;
  return prog.degrees[((bar % n) + n) % n];
}

/* chordClasses — the chord's three scale-degree CLASSES (diatonic triad),
 * kept in 0..6: [root, third, fifth] stacked in thirds within the mode.
 * Mode-awareness comes from the SCALE the caller resolves degrees against —
 * this function is scale-agnostic on purpose. */
export function chordClasses(cd) {
  if (!Number.isInteger(cd) || cd < 0 || cd > 6) throw new MusicError("chordClasses: degree out of range: " + cd);
  return [cd, (cd + 2) % 7, (cd + 4) % 7];
}

/* snapDegreeToChord — harmonize one melodic degree into the chord: the
 * NEAREST chord-tone class in circular 7-degree space (ties resolve to the
 * EARLIER class in the [root, third, fifth] order — deterministic). Returns
 * a class in 0..6; the caller re-applies the event's octave. */
export function snapDegreeToChord(deg, classes) {
  if (!Number.isInteger(deg)) throw new MusicError("snapDegreeToChord: deg invalid: " + deg);
  if (!Array.isArray(classes) || classes.length !== 3) throw new MusicError("snapDegreeToChord: classes invalid");
  /* normalize first — transformer ops (inversion/transpose) legitimately
   * produce out-of-range degrees; degreeToSemitone wraps them mod-7 too */
  const d = ((deg % 7) + 7) % 7;
  let best = classes[0], bestD = 7;
  for (const c of classes) {
    let dist = Math.abs(d - c) % 7;
    if (dist > 3) dist = 7 - dist;
    if (dist < bestD) { bestD = dist; best = c }
  }
  return best;
}

/* local fnv1a (same algorithm as foundation/foundation.mjs — duplicated here
 * so this module stays dependency-free like its music/ siblings) */
function fnv1aLocal(str) {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xFFFFFFFFFFFFFFFFn;
  }
  return h.toString(16);
}
