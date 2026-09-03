/* ============ SONG COMPOSER (v0.7.0) — complete unique arrangements ============
   Pure and deterministic: seeded by (projectSeed, styleId, targetMinutes).
   No DOM, no Date.now/Math.random anywhere — every decision draws from
   rngFor(projectSeed, label) sub-streams, so the same seed+style+length
   produces byte-identical output on every machine (tested).

   Pipeline (form BEFORE notes, per the foundation contract):
     1. SECTION CHAIN — INTRO→BUILD→DROP→BREAK→RISER→DROP2→OUTRO, bars per
        section scaled from the target length (weights → multiples of 4,
        remainder absorbed by the longest section), energy arcs per section.
     2. PATTERNS — one pattern per section (len = min(bars,8)×16 steps, all
        tracks equal length). Sections longer than 8 bars repeat their scene
        in the arranger instead of exceeding the 128-step pattern ceiling.
     3. TRACK RECIPES — kick/bass/hats/perc/snare/lead/pad/arp/fx per section
        scaled by the section energy arc; fills (snare rolls) end BUILD and
        RISER; groove is COMPOSED INTO the data (psy-push micro offsets on
        odd bass 16ths in drops) because project groove is global.
     4. LEAD MOTIF — generated on the scale, varied per section through the
        foundation MotifTransformer (drops state it, BREAK inverts, BUILD
        fragments, OUTRO omits) — real variation ops, not re-rolls.
     4b. HARMONY (v0.9.0) — one chord progression template per project
        (12 seeded 4/8-bar diatonic loops per style family, picked by
        fnv1a(seed+':prog')); bass roots, lead motif harmonization and
        pad/arp voicings derive from the active bar's diatonic triad.
        Kick/hats/perc/snare/fx NEVER consume the progression (rhythm is
        byte-identical to v0.8.0 — pinned). Project carries p.harmony
        metadata so gates/library/evolution can re-derive the chords.
     5. SECTION VARIANTS (v0.7.0) — every section family used more than once
        in the arranger gets n−1 derived variant scenes (naming: base+" 2",
        " 3", …) so NO arranger repeat is ever identical. Variants are the
        base pattern mutated by deterministic seeded ops (hats density/offset
        swap, bass octave/velocity re-jitter on off-phrase steps, lead motif
        re-processed through MotifTransformer, perc repositioning) plus a
        lane delta via the param registry. The KICK is sacred: positions,
        note, micro and prob untouched — velocity accents only (|Δvel| ≤ 0.1).
        Bars per scene, the form and the total length are unchanged.
     6. LANES — filter-sweep lane on BUILD (lead cutoff) and sendA/B rise on
        RISER (pad), written as 'state' lanes via the v0.5.0 param registry;
        variant lanes use family-dedicated (track,param) pairs (see below).
     7. OUTPUT — scenes renamed by section (color-tagged), arranger steps,
        9th track (FX riser), project bpm/scale/root per style. */
import { rngFor, degreeToSemitone } from '../foundation/foundation.mjs';
import { arcAt } from '../foundation/composition/form.mjs';
import { motifFromEvents, MotifTransformer } from '../foundation/music/motif.mjs';
import { pickProgression, chordDegreeAt, chordClasses, snapDegreeToChord } from '../foundation/music/progression.mjs';
import { SCALES, mkStep, deep } from './model.js';
import { initTracks, addTrackToProject, libFind, assignPresetToTrack, KITS } from './presets.js';
import { normalizeSceneMix } from './scenes.js';

/* composer length menu (minutes) — v0.9.0 P4 adds 12 and 20 (documented
 * tiers); the library's ADD CURRENT recovery snaps to the nearest of these. */
export const COMPOSER_LENGTHS = [3, 5, 8, 12, 20];
/* v0.10.0 SAMPLE HINTS — the composer's user-sample slots, by TRACK INDEX.
   Hints are NAMES ONLY (never PCM, never ids): at compose arrival the UI
   resolves each name against the IndexedDB sample store — a hit applies the
   sample voice to that track, a miss keeps the synth voice (honest toast).
   The composer NEVER requires samples: without any stored samples the
   output is exactly the v0.9.0-style all-synth arrangement. */
export const COMPOSER_SAMPLE_HINTS = { 0: 'kick', 3: 'perc', 6: 'atmos' };

/* ── style templates ──
   v0.7.0: every style is a FULL RECIPE in this dict — section chain
   (weights + energy arcs, same 7 canonical ids), per-track preset map,
   and a `recipe` sub-dict consumed by fillSection/deriveVariant:
     hatGhostMul  — ghost-16th hat density multiplier (denser hats)
     bassGrammar  — 'roll' (default psy odd-16th roll) | 'forest'
                    (rolling 16ths with octave wander)
     percMul      — perc density multiplier (HI-TECH glitch density)
     percOdd      — perc also fires on odd 16ths (glitch grammar)
     energyVar    — per-section energy jitter amplitude (higher variance)
     riserEvery   — FX sweep spacing in steps (16 = every bar, aggressive)
     ops          — variant op weights {hatRot, bassOct} (deriveVariant)
   Styles WITHOUT a recipe (FULL-ON/DARK-PSY/PROGRESSIVE) resolve every
   field to the v0.6.0 constant — their output is byte-identical to the
   pinned hashes in the tests. Nothing is hand-rolled outside this dict. */
export const COMPOSER_STYLES = {
  'FULL-ON': {
    label: 'FULL-ON', bpm: 145, scale: 'phrygian',
    presets: Object.assign({}, KITS['FULL-ON'], { kick: 'PS-KICK-TIGHT' }), /* v0.12.0 kit swap — kick sacred-consistent */
  },
  'DARK-PSY': {
    label: 'DARK-PSY', bpm: 148, scale: 'phrygian',
    presets: Object.assign({}, KITS['DARK-PSY'], { kick: 'PS-KICK-DEEP' }), /* v0.12.0 kit swap — kick sacred-consistent */
  },
  'PROGRESSIVE': {
    label: 'PROGRESSIVE', bpm: 138, scale: 'minor',
    presets: Object.assign({}, KITS['PROGRESSIVE'], { kick: 'PR-KICK' }), /* v0.12.0 kit swap — kick sacred-consistent */
  },
  'FOREST': {
    label: 'FOREST', bpm: 150, scale: 'harmonicMinor', /* darker scale bias */
    presets: Object.assign({}, KITS['DARK-PSY'], { kick: 'PS-KICK-DEEP' }), /* v0.12.0 kit swap (FOREST rides the DARK-PSY kit) — kick sacred-consistent */
    /* longer builds, more BREAK weight (weights sum to 1) */
    chain: [
      { id: 'INTRO', w: 0.11, energy: [0.20, 0.35], color: 3 },
      { id: 'BUILD', w: 0.15, energy: [0.35, 0.65], color: 4 },
      { id: 'DROP', w: 0.18, energy: [0.85, 0.92], color: 0 },
      { id: 'BREAK', w: 0.145, energy: [0.30, 0.45], color: 5 },
      { id: 'RISER', w: 0.095, energy: [0.45, 0.80], color: 4 },
      { id: 'DROP2', w: 0.17, energy: [0.90, 0.98], color: 0 },
      { id: 'OUTRO', w: 0.15, energy: [0.45, 0.15], color: 6 },
    ],
    recipe: { hatGhostMul: 1.6, bassGrammar: 'forest', percMul: 1.15, energyVar: 0, riserEvery: 32, ops: { hatRot: 0.55, bassOct: 0.65 } },
  },
  'HI-TECH': {
    label: 'HI-TECH', bpm: 155, scale: 'phrygian',
    presets: Object.assign({}, KITS['HI-TECH'], { kick: 'PS-KICK-TIGHT' }), /* v0.12.0 kit swap — kick sacred-consistent */
    /* faster section turnover, aggressive riser placement */
    chain: [
      { id: 'INTRO', w: 0.09, energy: [0.25, 0.42], color: 3 },
      { id: 'BUILD', w: 0.11, energy: [0.42, 0.72], color: 4 },
      { id: 'DROP', w: 0.21, energy: [0.90, 0.96], color: 0 },
      { id: 'BREAK', w: 0.115, energy: [0.35, 0.50], color: 5 },
      { id: 'RISER', w: 0.115, energy: [0.52, 0.88], color: 4 },
      { id: 'DROP2', w: 0.215, energy: [0.95, 1.00], color: 0 },
      { id: 'OUTRO', w: 0.145, energy: [0.50, 0.20], color: 6 },
    ],
    recipe: { hatGhostMul: 1.3, bassGrammar: 'roll', percMul: 1.8, percOdd: true, energyVar: 0.10, riserEvery: 16, ops: { hatRot: 0.5, bassOct: 0.55 } },
  },
  /* ── v0.13.1: four NEW composer styles — the library had 8 kits and 8
     genres but only 5 selectable styles; the owner asked for more choices.
     Each rides its OWN KITS row (9 roles) + its own 12-template progression
     family (foundation/music/progression.mjs). Purely additive: the five
     legacy styles resolve exactly as before (their pins never move). ── */
  'PSYTRANCE': {
    label: 'PSYTRANCE', bpm: 142, scale: 'phrygian',
    presets: Object.assign({}, KITS['PSYTRANCE'], { kick: 'PS-KICK-TIGHT' }), /* the classic tight kick — same id the legacy FULL-ON pin keeps */
    recipe: { hatGhostMul: 1.2, bassGrammar: 'roll', percMul: 1.0, energyVar: 0.05, riserEvery: 32, ops: { hatRot: 0.5, bassOct: 0.6 } },
  },
  'GOA': {
    label: 'GOA', bpm: 140, scale: 'harmonicMinor', /* melodic minor-dominant colors */
    presets: Object.assign({}, KITS['GOA'], { kick: 'GO-KICK-GLOW' }),
    recipe: { hatGhostMul: 1.1, bassGrammar: 'roll', percMul: 0.9, energyVar: 0, riserEvery: 32, ops: { hatRot: 0.45, bassOct: 0.7 } },
  },
  'TECHNO': {
    label: 'TECHNO', bpm: 132, scale: 'minor',
    presets: Object.assign({}, KITS['TECHNO'], { kick: 'TE-KICK2-CLUB' }),
    recipe: { hatGhostMul: 0.9, bassGrammar: 'roll', percMul: 1.2, energyVar: 0.04, riserEvery: 24, ops: { hatRot: 0.4, bassOct: 0.5 } },
  },
  'TRANCE': {
    label: 'TRANCE', bpm: 138, scale: 'minor',
    presets: Object.assign({}, KITS['TRANCE'], { kick: 'TR-KICK2-UPIFT' }),
    recipe: { hatGhostMul: 1.0, bassGrammar: 'roll', percMul: 0.85, energyVar: 0, riserEvery: 32, ops: { hatRot: 0.5, bassOct: 0.55 } },
  },
};

/* section chain: weights sum to 1; energy arcs [start,end] across the section.
   Extended forms (>8 min, v0.9.0 P4) use EXTENDED_CHAIN — 11 sections:
   the base 7 plus DROP3, a second BREAK, BRIDGE and OUTRO2. `beh` maps a
   section to the canonical BEHAVIOR fillSection/mixForSection/sectionMotif
   key on (DROP2/DROP3 behave like DROP; BREAK2/BRIDGE like BREAK; OUTRO2
   like OUTRO). Base sections have no beh — beh === id (byte-identical
   3/5/8-min output). */
const SECTION_CHAIN = [
  { id: 'INTRO', w: 0.125, energy: [0.25, 0.40], color: 3 },
  { id: 'BUILD', w: 0.125, energy: [0.40, 0.70], color: 4 },
  { id: 'DROP', w: 0.20, energy: [0.90, 0.95], color: 0 },
  { id: 'BREAK', w: 0.125, energy: [0.35, 0.50], color: 5 },
  { id: 'RISER', w: 0.10, energy: [0.50, 0.85], color: 4 },
  { id: 'DROP2', w: 0.20, energy: [0.95, 1.00], color: 0 },
  { id: 'OUTRO', w: 0.125, energy: [0.50, 0.20], color: 6 },
];
const EXTENDED_CHAIN = [
  { id: 'INTRO', w: 0.07, energy: [0.20, 0.35], color: 3 },
  { id: 'BUILD', w: 0.09, energy: [0.40, 0.70], color: 4 },
  { id: 'DROP', w: 0.12, energy: [0.90, 0.95], color: 0 },
  { id: 'BREAK', w: 0.08, energy: [0.35, 0.50], color: 5 },
  { id: 'RISER', w: 0.07, energy: [0.50, 0.85], color: 4 },
  { id: 'DROP2', w: 0.12, energy: [0.95, 1.00], color: 0 },
  { id: 'BREAK2', w: 0.08, energy: [0.35, 0.50], color: 5, beh: 'BREAK' },
  { id: 'BRIDGE', w: 0.09, energy: [0.45, 0.60], color: 6, beh: 'BREAK' },
  { id: 'DROP3', w: 0.13, energy: [0.92, 0.98], color: 0, beh: 'DROP' },
  { id: 'OUTRO', w: 0.08, energy: [0.50, 0.30], color: 6 },
  { id: 'OUTRO2', w: 0.07, energy: [0.30, 0.15], color: 6, beh: 'OUTRO' },
];
const SECTION_BY_ID = new Map(SECTION_CHAIN.map(s => [s.id, s]));

const put = (pat, track, step, vel, note, micro) => {
  const d = pat.data[track]; const L = d.len;
  const st = d.steps[((step % L) + L) % L];
  st.on = 1; st.vel = Math.min(1, Math.max(0.05, vel)); st.prob = 1;
  if (note != null) st.note = Math.round(note);
  if (micro != null) st.micro = Math.max(-100, Math.min(100, micro));
};

/* allocate bars: weights → multiples of 4 (min 4), remainder to the longest.
   v0.9.0 FIX (Run 15 catch): walk the PASSED weight list — the old code
   mapped SECTION_CHAIN (hardcoded 7) while reading ws[i], producing NaN
   bars for the extended 11-section chains. */
function allocateBars(totalBars, ws) {
  const W = ws || SECTION_CHAIN.map(s => s.w);
  const bars = W.map(w => Math.max(4, Math.round((totalBars * w) / 4) * 4));
  let sum = bars.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (sum !== totalBars && guard++ < 1000) {
    let bi = 0; for (let i = 1; i < bars.length; i++) if (bars[i] >= bars[bi]) bi = i;
    if (sum > totalBars) { if (bars[bi] > 4) { bars[bi] -= 4; sum -= 4 } else break }
    else { bars[bi] += 4; sum += 4 }
  }
  return bars;
}

/* lead motif: 16 one-step events on the scale (3 rests), varied per section */
function mkMotif(seed, scaleName, phraseRole) {
  const rng = rngFor(seed, 'motif:' + phraseRole);
  const evs = [];
  for (let i = 0; i < 16; i++) {
    if (i > 0 && rng() < 0.18) { evs.push({ deg: 0, oct: 0, dur: 1, accent: 0.2, rest: true }); continue }
    const deg = Math.floor(rng() * 7);
    const oct = rng() < 0.25 ? 1 : 0;
    evs.push({ deg, oct, dur: 1, accent: i % 4 === 0 ? 0.8 : 0.35, rest: false });
  }
  if (!evs.some(e => !e.rest)) evs[0] = { deg: 0, oct: 0, dur: 1, accent: 0.8, rest: false };
  return motifFromEvents(evs, { phraseRole, provenance: { source: 'psy6-composer', op: 'seed', songSeed: seed } });
}

const sectionMotif = (seed, sectionId, base) => {
  const rng = rngFor(seed, 'motifop:' + sectionId);
  if (sectionId === 'DROP') return base;
  if (sectionId === 'DROP2') return rng() < 0.5 ? MotifTransformer.omission(base, (seed ^ 0x9e37) | 0) : MotifTransformer.transpose(base, 2);
  if (sectionId === 'BREAK') return rng() < 0.5 ? MotifTransformer.invert(base) : MotifTransformer.retrograde(base);
  if (sectionId === 'BUILD') return MotifTransformer.fragmentation(base, 0, 8, 2);
  if (sectionId === 'RISER') return MotifTransformer.octaveShift(base, 1);
  if (sectionId === 'OUTRO') return MotifTransformer.omission(base, (seed ^ 0x1234) | 0);
  return base; /* INTRO: sparse head only (handled in the recipe) */
};

/* write one section pattern (len = min(bars,8)*16), all tracks equal length.
   v0.9.0: ctx.prog — the project's chord progression. Every TONAL note
   (bass/lead/pad/arp) derives from the active bar's diatonic triad; rhythm
   tracks (kick/snare/hat/perc/fx) are untouched by it. The pattern's bar j
   plays chord degrees[j % progBars] — sections restart the loop at index 0
   (section starts are harmonic anchor points: the psy convention). */
function fillSection(p, pat, section, bars, energy, ctx) {
  const len = Math.min(bars, 8) * 16;
  const { style, rng, motif, scaleIv, root, prog } = ctx;
  const rc = style.recipe || {}; /* v0.7.0 style recipe — defaults = v0.6.0 constants */
  const chordRootAt = bar => root + degreeToSemitone(scaleIv, chordDegreeAt(prog, bar)); /* bass register */
  for (const t of Object.keys(pat.data)) {
    const d = pat.data[t];
    d.len = len;
    d.steps = Array.from({ length: len }, () => mkStep(false));
  }
  const sec = section.beh || section.id; /* v0.9.0 P4: canonical behavior (BREAK2→BREAK, DROP3→DROP, OUTRO2→OUTRO, BRIDGE→BREAK) */
  const degNote = (deg, oct) => root + 24 + degreeToSemitone(scaleIv, deg) + 12 * (oct || 0);

  /* KICK — 4-on-floor when it kicks; silent in BREAK/RISER (breakdown feel) */
  if (sec !== 'BREAK' && sec !== 'RISER') {
    const full = energy >= 0.8 || sec === 'DROP' || sec === 'DROP2';
    for (let b = 0; b < len / 16; b++) {
      const base = b * 16;
      if (full) { put(pat, 0, base + 0, 0.95); put(pat, 0, base + 4, 0.95); put(pat, 0, base + 8, 0.95); put(pat, 0, base + 12, 0.95) }
      else { put(pat, 0, base + 0, 0.85); put(pat, 0, base + 8, 0.8) }
      if (full && energy > 0.92 && rng() < 0.3) put(pat, 0, base + 14, 0.55);
    }
  }
  /* BASS — psy rolling on drops (odd 16ths, psy-push micro baked in), 8ths mid,
     sustained when calm. FOREST recipe: rolling 16th grammar with octave
     wander on the drops (the forest rolling-bass variant). */
  if (sec === 'DROP' || sec === 'DROP2' || energy >= 0.8) {
    if (rc.bassGrammar === 'forest') {
      for (let s = 0; s < len; s++) {
        if (rng() < 0.14) continue; /* breaths keep it rolling, not static */
        const push = 19 + Math.round(rng() * 6);
        const bn = chordRootAt(Math.floor(s / 16)); /* v0.9.0: chord root per bar */
        put(pat, 4, s, 0.78 + rng() * 0.14, rng() < 0.22 ? bn + 12 : bn, push);
      }
    } else {
      for (let s = 1; s < len; s += 2) {
        const push = (sec === 'DROP' || sec === 'DROP2') ? 19 + Math.round(rng() * 6) : null; /* psy-push: +6..8 ticks */
        put(pat, 4, s, 0.82 + rng() * 0.1, chordRootAt(Math.floor(s / 16)), push);
      }
    }
  } else if (energy >= 0.55) {
    for (let s = 0; s < len; s += 2) if (rng() < 0.8) put(pat, 4, s, 0.7 + rng() * 0.1, chordRootAt(Math.floor(s / 16)))
  } else {
    for (let b = 0; b < len / 16; b++) { put(pat, 4, b * 16, 0.8, chordRootAt(b)); put(pat, 4, b * 16 + 8, 0.75, chordRootAt(b)) }
  }
  /* HATS — offbeat core, 16th ghosts as energy rises (density per recipe) */
  if (energy >= 0.35) {
    for (let b = 0; b < len / 16; b++) for (const o of [2, 6, 10, 14]) put(pat, 2, b * 16 + o, 0.45 + energy * 0.2)
    if (energy >= 0.75) for (let s = 0; s < len; s++) if (s % 2 === 0 && rng() < 0.3 * (rc.hatGhostMul || 1)) put(pat, 2, s, 0.25 + rng() * 0.15)
  }
  /* PERC — seeded sparse density scaled by energy (recipe multiplier +
     optional odd-16th glitch layer) */
  for (let s = 0; s < len; s += 2) if (rng() < (0.06 + energy * 0.12) * (rc.percMul || 1)) put(pat, 3, s, 0.3 + rng() * 0.4)
  if (rc.percOdd) { for (let s = 1; s < len; s += 2) if (rng() < (0.03 + energy * 0.07) * (rc.percMul || 1)) put(pat, 3, s, 0.22 + rng() * 0.3) }
  /* SNARE — backbeat on full sections, half-time on BREAK */
  if (sec === 'BREAK') { for (let b = 0; b < len / 16; b++) { put(pat, 1, b * 16 + 4, 0.6); put(pat, 1, b * 16 + 12, 0.65) } }
  else if (energy >= 0.8) { for (let b = 0; b < len / 16; b++) { put(pat, 1, b * 16 + 4, 0.55); put(pat, 1, b * 16 + 12, 0.6) } }
  /* LEAD — the motif, varied per section; INTRO stays headless. v0.9.0:
     every motif degree is SNAPPED into the active bar's chord (nearest
     chord-tone class, deterministic tie-break) — the melody keeps its
     contour but never leaves the harmony. */
  if (sec !== 'INTRO' && (energy >= 0.55 || sec === 'BREAK')) {
    const evs = motif.events; let cursor = 0;
    const barsN = len / 16;
    for (let b = 0; b < barsN; b++) {
      cursor = b * 16;
      const cls = chordClasses(chordDegreeAt(prog, b));
      for (const ev of evs) {
        if (!ev.rest && cursor < len) {
          const n = degNote(snapDegreeToChord(ev.deg, cls), ev.oct);
          put(pat, 5, cursor, 0.4 + ev.accent * 0.35, n);
        }
        cursor += ev.dur;
      }
    }
  }
  /* PAD — sustained chord voicings when the mix has room (v0.9.0: root +
     fifth of the active bar's chord — positions/velocities unchanged) */
  if (energy < 0.6 || sec === 'BREAK') {
    for (let b = 0; b < len / 16; b++) {
      const cd = chordDegreeAt(prog, b);
      put(pat, 6, b * 16, 0.35, root + 12 + degreeToSemitone(scaleIv, cd));
      if (len >= 64) put(pat, 6, b * 16 + 8, 0.3, root + 12 + degreeToSemitone(scaleIv, cd + 4));
    }
  }
  /* ARP — hypno 16ths only at peak energy (v0.9.0: cycles the active bar's
     chord tones: root/third/fifth/root+8ve) */
  if (energy >= 0.85) {
    const seqT = [0, 1, 2, 3, 2, 1];
    const arpTone = s => { const cd = chordDegreeAt(prog, Math.floor(s / 16)); return [cd, cd + 2, cd + 4, cd + 7][seqT[s % 6]] };
    for (let s = 0; s < len; s++) { if (rng() < 0.85) put(pat, 7, s, 0.28 + rng() * 0.12, root + 24 + degreeToSemitone(scaleIv, arpTone(s))) }
  }
  /* FX — riser sweeps through the RISER section, spacing per recipe
     (default one per 2 bars; HI-TECH one per bar — aggressive placement) */
  if (sec === 'RISER') { for (let s = 0; s < len; s += (rc.riserEvery || 32)) put(pat, 8, s, 0.8) }
  /* FILL — snare roll ending BUILD and RISER (last bar, rising velocity) */
  if (sec === 'BUILD' || sec === 'RISER') {
    const fb = len - 16;
    for (let k = 0; k < 16; k++) put(pat, 1, fb + k, 0.3 + (k / 16) * 0.6)
  }
  return pat;
}

/* ============ SECTION VARIANTS (v0.7.0) — no identical repeats ============
   PSY CONSTRAINT: the kick is sacred. Variant kicks keep their exact
   positions/note/micro/prob; only velocity accents (|Δvel| ≤ 0.1) are
   allowed. Variation targets hats/bass/lead/perc/pad + lane deltas.

   Difference metric (documented constant VARIANT_DIFF_MIN = 0.15):
   variantStepDiff(a,b) = |D| / |U| where U = steps (all tracks) where
   EITHER pattern has a note, D ⊆ U where the on-state differs OR both are
   on and (note differs ∨ |Δvel| > 0.02 ∨ |Δmicro| > 2). 0 = identical,
   1 = disjoint. Union normalization makes sparse (INTRO) and dense (DROP)
   families comparable. EVERY pair within a family — base included — must
   reach VARIANT_DIFF_MIN. */

export const VARIANT_DIFF_MIN = 0.15;
export const KICK_VEL_MAX_DELTA = 0.1;

function variantStepDiff(a, b) {
  let uni = 0, dif = 0;
  for (const tk of Object.keys(a.data)) {
    const da = a.data[tk], db = b.data[tk];
    const n = Math.min(da.len, db.len);
    for (let i = 0; i < n; i++) {
      const x = da.steps[i], y = db.steps[i];
      if (!x.on && !y.on) continue;
      uni++;
      if (!!x.on !== !!y.on) { dif++; continue }
      if ((x.note | 0) !== (y.note | 0) || Math.abs(x.vel - y.vel) > 0.02 || Math.abs((x.micro || 0) - (y.micro || 0)) > 2) dif++;
    }
  }
  return uni ? dif / uni : 0;
}

/* minVariantDiff — smallest pairwise diff within a family (base included) */
function minVariantDiff(pats) {
  let m = 1;
  for (let i = 0; i < pats.length; i++) for (let j = i + 1; j < pats.length; j++) m = Math.min(m, variantStepDiff(pats[i], pats[j]));
  return m;
}

/* deriveVariant — deep-copy the base pattern and mutate it into variant k
   (k = 1 → " 2"). Every op is seeded from its own rngFor stream; nothing
   is re-rolled from scratch, everything derives from the base material. */
function deriveVariant(basePat, sec, k, ctx) {
  const pat = deep(basePat);
  pat.name = basePat.name + 'v' + (k + 1);
  const rng = rngFor(ctx.seedInt, 'variant:' + sec.id + ':' + k);
  const energy = sec.energyMid;
  const rc = (ctx.style && ctx.style.recipe) || {}; /* per-style op weights */
  const ops = rc.ops || {};
  /* KICK (track 0) — SACRED: positions/note/micro/prob untouched; velocity
     accents only, hard-bounded at KICK_VEL_MAX_DELTA (±0.07 actual). */
  const dk = pat.data[0];
  if (dk) for (let i = 0; i < dk.len; i++) {
    const st = dk.steps[i];
    if (st.on) { const dv = (rng() - 0.5) * 0.14; if (Math.abs(dv) > 0.02) st.vel = Math.min(1, Math.max(0.05, st.vel + dv)) }
  }
  /* HATS (track 2) — density/offset swap: rotate the offbeat grid one 16th
     later on seeded bars; re-seed ghost 16ths at high energy; sections with
     no hat layer at all gain a low-velocity offbeat layer. */
  const dh = pat.data[2];
  if (dh) {
    for (let b = 0; b < dh.len / 16; b++) {
      if (rng() < (ops.hatRot != null ? ops.hatRot : 0.45)) for (const o of [2, 6, 10, 14]) {
        const src = dh.steps[b * 16 + o], dst = dh.steps[b * 16 + o + 1];
        if (src.on && !dst.on) { dst.on = 1; dst.vel = Math.min(1, Math.max(0.05, src.vel * (0.9 + rng() * 0.2))); dst.prob = 1; src.on = 0 }
        else if (src.on && dst.on) dst.vel = Math.min(1, dst.vel + 0.1);
      }
    }
    if (energy >= 0.75) { for (let s = 0; s < dh.len; s++) if (s % 2 === 0 && rng() < 0.3 * (rc.hatGhostMul || 1)) put(pat, 2, s, 0.25 + rng() * 0.15) }
    else if (!dh.steps.some(st => st.on)) { for (let b = 0; b < dh.len / 16; b++) for (const o of [2, 6, 10, 14]) if (rng() < 0.7) put(pat, 2, b * 16 + o, 0.3 + rng() * 0.12) }
  }
  /* BASS (track 4) — octave shifts (±12) on off-phrase (odd) steps, velocity
     re-jitter, roll micro re-offset on psy-push steps. */
  const db = pat.data[4];
  if (db) for (let i = 0; i < db.len; i++) {
    const st = db.steps[i];
    if (!st.on) continue;
    if (i % 2 === 1 && rng() < (ops.bassOct != null ? ops.bassOct : 0.6)) st.note = Math.min(108, Math.max(12, st.note + (rng() < 0.85 ? 12 : -12)));
    st.vel = Math.min(1, Math.max(0.05, st.vel + (rng() - 0.5) * 0.24));
    if (st.micro) st.micro = Math.max(-100, Math.min(100, st.micro + Math.round((rng() - 0.5) * 12)));
  }
  /* LEAD (track 5) — the section motif re-processed through the foundation
     MotifTransformer (never re-rolled), rewritten with the same cursor walk
     fillSection uses. Sections without a lead skip the op. */
  const dl = pat.data[5];
  if (dl && dl.steps.some(st => st.on) && ctx.sectionMotifs[sec.id]) {
    const m0 = ctx.sectionMotifs[sec.id];
    const pick = rng();
    let m;
    if (k % 2 === 1) m = pick < 0.5 ? MotifTransformer.transpose(m0, 3) : MotifTransformer.transpose(m0, -2);
    else if (pick < 0.4) m = MotifTransformer.retrograde(m0);
    else if (pick < 0.7) m = MotifTransformer.omission(m0, (ctx.seedInt ^ (0xABCD + k * 0x9E37)) | 0);
    else m = MotifTransformer.invert(m0);
    dl.steps = Array.from({ length: dl.len }, () => mkStep(false));
    const degNote = (deg, oct) => ctx.root + 24 + degreeToSemitone(ctx.scaleIv, deg) + 12 * (oct || 0);
    const barsN = dl.len / 16;
    for (let b = 0; b < barsN; b++) {
      let cursor = b * 16;
      const cls = chordClasses(chordDegreeAt(ctx.prog, b)); /* v0.9.0: chord-aware variant leads */
      for (const ev of m.events) {
        if (!ev.rest && cursor < dl.len) put(pat, 5, cursor, 0.4 + ev.accent * 0.35, degNote(snapDegreeToChord(ev.deg, cls), ev.oct));
        cursor += ev.dur;
      }
    }
  }
  /* PERC (track 3) — repositioning: re-seeded sparse density (same recipe). */
  const dp = pat.data[3];
  if (dp) { dp.steps = Array.from({ length: dp.len }, () => mkStep(false)); for (let s = 0; s < dp.len; s += 2) if (rng() < (0.06 + energy * 0.12) * (rc.percMul || 1)) put(pat, 3, s, 0.3 + rng() * 0.4); if (rc.percOdd) { for (let s = 1; s < dp.len; s += 2) if (rng() < (0.03 + energy * 0.07) * (rc.percMul || 1)) put(pat, 3, s, 0.22 + rng() * 0.3) } }
  /* PAD (track 6) — second-voicing interval swap where a pad exists
     (v0.9.0: chord-aware — the active bar's FIFTH voice moves to a picked
     alternative chord tone: fifth / third / fifth+octave in degree space). */
  const dd = pat.data[6];
  if (dd) {
    const pick = Math.floor(rng() * 3);
    const alts = [4, 2, 9]; /* degree-space offsets from the chord root */
    for (let i = 0; i < dd.len; i++) {
      const st = dd.steps[i];
      if (!st.on) continue;
      const cd = chordDegreeAt(ctx.prog, Math.floor(i / 16));
      if (st.note === ctx.root + 12 + degreeToSemitone(ctx.scaleIv, cd + 4)) st.note = ctx.root + 12 + degreeToSemitone(ctx.scaleIv, cd + alts[pick]);
      st.vel = Math.min(1, Math.max(0.05, st.vel + (rng() - 0.5) * 0.16))
    }
  }
  return pat;
}

/* variantLane — the per-variant lane delta via the param registry. One
   family-dedicated (track,param) pair per family (no clashes with the base
   BUILD/RISER lanes); values OPEN progressively with the variant index.
   The registry applies 'state' lanes globally in array order, so when a
   family has several variants the most open (last) curve governs — the
   documented global-apply semantics of the v0.5.0 lane model. */
const VARIANT_LANES = {
  DROP: { track: 7, param: 'cutoff', pts: k => [[0, 800 + 700 * k], [64, 2000 + 1600 * k], [127, 4200 + 2600 * k]] },
  DROP2: { track: 4, param: 'res', pts: k => [[0, 4 + 2 * k], [127, 10 + 4 * k]] },
  BREAK: { track: 6, param: 'detune', pts: k => [[0, 3 + 2.5 * k], [127, 9 + 5 * k]] },
  RISER: { track: 2, param: 'mix.sendA', pts: k => [[0, 0.08 + 0.08 * k], [127, 0.25 + 0.15 * k]] },
  BUILD: { track: 4, param: 'cutoff', pts: k => [[0, 500 + 400 * k], [127, 1800 + 1200 * k]] },
};

/* ── SCENE MIX SNAPSHOTS (v0.8.0) — from the section energy curve ──
   Pure function of (section id, energy mid, variant index) — no rng, so
   compose output stays byte-identical for a fixed seed. The KICK (track 0)
   NEVER appears in a composer snapshot: kick is sacred — its LEVEL, like
   its pattern, is not arrangement material. Curves:
     INTRO        — low melodic level, light space (sends ≈ .18/.22)
     BUILD        — levels rise with energy, bass duck ramps in
     DROP / DROP2 — full level, dry punch, bass duck materialized (sc 55)
     BREAK        — SPATIAL: sendA/sendB up, ducking off (sc 0)
     RISER        — swell: pad/lead up, no ducking anywhere, FX track full
     OUTRO        — fall: levels drop, space stays airy
   Variant k alternates a ±0.12 pan lean on hat/perc/lead so arranger
   repeats move in stereo as well. Applied on every launch path (see
   scenes.js SCENE MIX SNAPSHOTS). */
function mixForSection(sec, k) {
  const e = sec.energyMid, id = sec.beh || sec.id; /* v0.9.0 P4: behavior key */
  const r = v => Math.round(v * 1000) / 1000;
  const pan = k ? (k % 2 ? 0.12 : -0.12) : 0;
  const T = {};
  const set = (i, vol, sendA, sendB, sc, pn) => {
    const e2 = { vol: r(vol), pan: r(pn || 0), sendA: r(sendA || 0), sendB: r(sendB || 0) };
    if (sc != null) e2.scAmount = Math.round(sc);
    T[i] = e2;
  };
  if (id === 'INTRO') {
    set(2, .7, 0, .12); set(3, .6, .1, .1); set(4, .8, 0, 0); set(5, .5, .18, .2, 0); set(6, .6, .18, .28, 0); set(7, .4, .1, .15, 0);
  } else if (id === 'BUILD') {
    set(2, .75 + .2 * e, 0, .08, null, pan); set(3, .65 + .25 * e, .08, .08, null, pan); set(4, .9, 0, 0, 40);
    set(5, .6 + .3 * e, .12, .14, 0); set(6, .6 + .2 * e, .15, .2, 0); set(7, .5 + .3 * e, .1, .1, 0);
  } else if (id === 'DROP' || id === 'DROP2') {
    set(1, .95); set(2, .9, 0, .05, null, pan); set(3, .85, .06, .05, null, pan); set(4, 1, 0, 0, 55);
    set(5, 1, .08, .08, 0, pan); set(6, .8, .08, .1, 0); set(7, .85, .05, .05, 0);
  } else if (id === 'BREAK') {
    set(2, .6, .1, .15, null, pan); set(3, .55, .15, .15, null, pan); set(4, .7, .15, .18, 0);
    set(5, .8, .35, .4, 0, pan); set(6, .9, .4, .5, 0); set(7, .7, .3, .35, 0);
  } else if (id === 'RISER') {
    set(2, .7, .1, .12, null, pan); set(4, .8, 0, 0, 0); set(5, .9, .2, .22, 0, pan); set(6, 1, .3, .35, 0); set(7, .8, .18, .2, 0); set(8, 1, 0, 0, 0);
  } else { /* OUTRO */
    set(2, .6, 0, .1, null, pan); set(3, .5, .08, .1); set(4, .75, .05, .05, 25); set(5, .55, .15, .2, 0, pan); set(6, .6, .2, .3, 0); set(7, .4, .12, .18, 0);
  }
  return { tracks: T };
}

/* compose — the pure entry point. targetMinutes ∈ {3,5,8} (any >0 works). */
export function compose(styleId, targetMinutes, seed, seedLabel) {
  const style = COMPOSER_STYLES[styleId] || COMPOSER_STYLES['FULL-ON'];
  const bpm = style.bpm;
  const seedInt = (typeof seed === 'number' ? seed : parseInt(fnvish(String(seed)), 16) >>> 0) | 0;
  const label = seedLabel || String(seed);

  /* 1. form: bars + energies — v0.9.0 P4: lengths >8 min use the 11-section
     EXTENDED_CHAIN (DROP3 + double-BREAK + BRIDGE + OUTRO2); 3/5/8-min keep
     the exact per-style 7-section chains (byte-identical outputs, pinned). */
  const rc = style.recipe || {};
  const chain = targetMinutes > 8 ? EXTENDED_CHAIN : (style.chain || SECTION_CHAIN);
  const rawTotal = (targetMinutes * bpm) / 4;           /* 1 bar = 4 beats */
  const totalBars = Math.max(28, Math.round(rawTotal / 4) * 4); /* multiple of 4 */
  const bars = allocateBars(totalBars, chain.map(s => s.w));
  const sections = chain.map((s, i) => {
    let e = arcAt(s.energy, Math.floor(bars[i] / 2), bars[i]);
    if (rc.energyVar) { const j = rngFor(seedInt, 'evar:' + s.id)(); e = Math.min(1, Math.max(0.05, e + (j - 0.5) * rc.energyVar)) }
    return { ...s, bars: bars[i], energyMid: e };
  });

  /* 2. project shell — v0.9.0: the chord progression is picked FIRST (pure
     function of styleId+seed) and carried on the project as p.harmony */
  const prog = pickProgression(styleId, seedInt);
  const p = {
    version: 3, bpm, swing: 0, root: 33, scale: style.scale, recQ: 1, chain: false,
    seed: 'C' + label, groove: 'straight', fx: { delayDiv: '3/16', delayFb: 0.35 }, masterVol: 0.85,
    activeScene: 0, currentPattern: 'C1', selTrack: 4,
    macroVals: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    harmony: { family: styleId, progId: prog.id, progBars: prog.bars, degrees: prog.degrees.slice() },
    tracks: [], patterns: {}, scenes: [], lanes: [],
  };
  initTracks(p);
  const fxIdx = addTrackToProject(p);
  const presetMap = { 0: 'kick', 1: 'snare', 2: 'hat', 3: 'perc', 4: 'bass', 5: 'lead', 6: 'pad', 7: 'arp', 8: 'fx' };
  for (const [ti, key] of Object.entries(presetMap)) {
    const pr = libFind(style.presets[key]);
    if (pr) assignPresetToTrack(p, +ti, pr);
  }
  /* macro base snapshots — ENERGY/SPACE macros must work on composed projects
     exactly like on buildStyle projects (resolveMacros reads t.base) */
  p.tracks.forEach(t => { t.base = deep({ sound: t.sound, mix: { sendA: t.mix.sendA, sendB: t.mix.sendB, vol: t.mix.vol } }) });

  /* 3. sections → patterns + scenes + arranger */
  const rng = rngFor(seedInt, 'sections');
  const scaleIv = SCALES[style.scale] || SCALES.minor;
  const baseMotif = mkMotif(seedInt, style.scale, 'statement');
  const arrSteps = [];
  let sceneIdx = 0;
  const formSections = [];
  const secMotifs = {}; /* per-family fillSection motif — variants re-process it */
  const sceneMeta = []; /* scene idx → {sec, k} for the v0.8.0 snapshot pass */
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const motif = sectionMotif(seedInt, sec.beh || sec.id, baseMotif); /* v0.9.0 P4: behavior key */
    secMotifs[sec.id] = motif;
    const patName = 'C' + (i + 1);
    const pat = { name: patName, data: {} };
    for (let t = 0; t < p.tracks.length; t++) pat.data[t] = { len: 16, steps: Array.from({ length: 16 }, () => mkStep(false)) };
    fillSection(p, pat, sec, sec.bars, sec.energyMid, { style, rng, motif, scaleIv, root: p.root, prog });
    p.patterns[patName] = pat;
    p.scenes.push({ name: sec.id, pattern: patName, color: sec.color, bars: Math.min(sec.bars, 8), fill: false });
    sceneMeta.push({ sec, k: 0 });
    const loops = Math.max(1, Math.round(sec.bars / Math.min(sec.bars, 8)));
    for (let k = 0; k < loops; k++) arrSteps.push({ scene: sceneIdx, bars: Math.min(sec.bars, 8) });
    formSections.push({ id: sec.id, bars: sec.bars, energy: +sec.energyMid.toFixed(3), pattern: patName, scene: sceneIdx });
    sceneIdx++;
  }

  /* 3b. SECTION VARIANTS (v0.7.0) — every family used more than once in the
     arranger gets n−1 derived variant scenes; the arranger is rewritten so
     occurrence j of a family plays the base (j=0) then " 2", " 3", … Bars
     per step, the form and the total length are unchanged. */
  const vctx = { seedInt, scaleIv, root: p.root, sectionMotifs: secMotifs, style, prog };
  const usage = new Map();
  for (const st of arrSteps) usage.set(st.scene, (usage.get(st.scene) || 0) + 1);
  const occSeen = new Map();       /* scene → occurrences already assigned */
  const variantMap = new Map();    /* base scene → [variant scene idx, …] */
  let variantCount = 0;
  const famPats = new Map();       /* base scene → [patA, patB, …] for the metric */
  for (const st of arrSteps) {
    const base = st.scene, n = usage.get(base);
    const occ = occSeen.get(base) || 0;
    occSeen.set(base, occ + 1);
    if (n <= 1 || occ === 0) continue;
    if (!variantMap.has(base)) {
      const sec = sections[base];
      const famName = sec.id;
      const ids = [];
      const pats = [p.patterns[p.scenes[base].pattern]];
      for (let kk = 1; kk < n; kk++) {
        const patName = 'C' + (base + 1) + 'v' + (kk + 1);
        p.patterns[patName] = deriveVariant(p.patterns[p.scenes[base].pattern], sec, kk, vctx);
        p.scenes.push({ name: famName + ' ' + (kk + 1), pattern: patName, color: sec.color, bars: Math.min(sec.bars, 8), fill: false });
        sceneMeta.push({ sec, k: kk });
        ids.push(p.scenes.length - 1);
        pats.push(p.patterns[patName]);
        variantCount++;
      }
      variantMap.set(base, ids);
      famPats.set(base, pats);
    }
    const ids = variantMap.get(base);
    st.scene = ids[occ - 1];
  }
  /* variant lane deltas — provenance: which variant scene the curve belongs
     to (metadata only; the registry applies 'state' lanes globally in array
     order, so the most open (last) curve of a family governs) */
  const variantLanes = [];
  for (const [base, ids] of variantMap) {
    const spec = VARIANT_LANES[sections[base].id];
    if (!spec) continue; /* INTRO/OUTRO variants: step ops carry the variation */
    ids.forEach((sid, j) => variantLanes.push({ track: spec.track, param: spec.param, mode: 'state', pts: deep(spec.pts(j + 1)), variant: p.scenes[sid].name }));
  }
  /* family difference evidence (base included in every pairwise set) */
  let minFamDiff = 1;
  for (const [, pats] of famPats) minFamDiff = Math.min(minFamDiff, minVariantDiff(pats));

  p.currentPattern = 'C1'; p.activeScene = 0;
  p.arranger = { v: 1, on: true, steps: arrSteps, idx: 0, barsIn: 0 };

  /* 4. lane suggestions (v0.5.0 registry, 'state' lanes) — v0.10.0 adds
     INSERT-FX automation through the SAME registry lane mechanism:
     BUILD gets insFiltFreq opening lanes on the LEAD (5) and PAD (6)
     tracks; RISER gets an insFiltFreq opening + an insDrive rise on the
     PERC track (3). The kick (track 0) NEVER gets inserts — sacred, like
     its pattern. Base states carry ins {filtOn:1,...} (mode-static per
     track so offline renders are time-correct — see engine applyIns;
     drive is a trim/wet/dry AudioParam crossfade, never a curve swap).
     Lane evaluation follows the existing project-wide phase semantics
     (the same shape as the v0.5.0 cutoff lane). */
  const lanes = [];
  const trackIns = (i, patch) => { const t = p.tracks[i]; if (!t) return; t.ins = Object.assign({ drive: 0, crush: 16, filtOn: 0, filtFreq: 20000, filtQ: 1 }, t.ins || {}, patch) };
  const build = formSections.find(s => s.id === 'BUILD');
  if (build) {
    const len = Math.min(build.bars, 8) * 16;
    lanes.push({ track: 5, param: 'cutoff', mode: 'state', pts: [[0, 600], [Math.floor(len / 2), 2400], [len - 1, 6000]] });
    trackIns(5, { filtOn: 1, filtFreq: 500, filtQ: 0.8 });
    lanes.push({ track: 5, param: 'insFiltFreq', mode: 'state', pts: [[0, 500], [Math.floor(len / 2), 5000], [len - 1, 14000]] });
    trackIns(6, { filtOn: 1, filtFreq: 400, filtQ: 0.8 });
    lanes.push({ track: 6, param: 'insFiltFreq', mode: 'state', pts: [[0, 400], [Math.floor(len / 2), 3500], [len - 1, 9000]] });
  }
  const riser = formSections.find(s => s.id === 'RISER');
  if (riser) {
    const len = Math.min(riser.bars, 8) * 16;
    lanes.push({ track: 6, param: 'mix.sendA', mode: 'state', pts: [[0, 0.05], [len - 1, 0.9]] });
    lanes.push({ track: 6, param: 'mix.sendB', mode: 'state', pts: [[0, 0.05], [len - 1, 0.85]] });
    trackIns(3, { filtOn: 1, filtFreq: 600, filtQ: 1.2 });
    lanes.push({ track: 3, param: 'insFiltFreq', mode: 'state', pts: [[0, 600], [len - 1, 14000]] });
    lanes.push({ track: 3, param: 'insDrive', mode: 'state', pts: [[0, 0], [Math.floor(len / 2), 25], [len - 1, 60]] });
  }
  p.lanes = lanes.concat(variantLanes);

  /* 4b. SCENE MIX SNAPSHOTS (v0.8.0) — every scene carries its section's
     mix identity (energy-curve payload, canonicalized). Deterministic:
     pure function of (section id, energy, variant index). Kick untouched. */
  let snapCount = 0;
  sceneMeta.forEach((m, i) => {
    const mix = normalizeSceneMix(mixForSection(m.sec, m.k), p.tracks.length);
    if (mix) { p.scenes[i].mix = mix; snapCount++ }
  });

  /* 5. stats + determinism fingerprint */
  const totalSecs = formSections.reduce((a, s) => a + s.bars, 0);
  const lengthSec = totalSecs * 4 * 60 / bpm;
  const fingerprint = sectionsFingerprint(p, formSections);
  return {
    project: p,
    form: { style: styleId, seed: label, bpm, sections: formSections, totalBars: totalSecs, lengthSec: +lengthSec.toFixed(2), targetSec: targetMinutes * 60 },
    sampleHints: COMPOSER_SAMPLE_HINTS,
    stats: { tracks: p.tracks.length, scenes: p.scenes.length, lanes: p.lanes.length, variants: variantCount, snapshots: snapCount, progression: prog.id, minVariantDiff: +minFamDiff.toFixed(3), lengthErr: +(((lengthSec - targetMinutes * 60) / (targetMinutes * 60)) * 100).toFixed(3), fingerprint },
  };
}

/* structural fingerprint: per-section per-track on/vel/note digest — used by
   the uniqueness tests (same seed ⇒ identical; different seeds ⇒ different) */
export function sectionsFingerprint(p, formSections) {
  let h = '';
  for (const sec of formSections) {
    const pat = p.patterns[sec.pattern];
    h += sec.id + ':';
    for (const tk of Object.keys(pat.data)) {
      const d = pat.data[tk];
      for (let s = 0; s < d.len; s++) {
        const st = d.steps[s];
        if (st.on) h += tk + '.' + s + '.' + st.note + '.' + Math.round(st.vel * 100) + ';';
      }
    }
    h += '|';
  }
  return h;
}

/* fnv-ish string→int for string seeds (keeps the numeric contract of seeds) */
function fnvish(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) } return (h >>> 0).toString(16) }

export { SECTION_CHAIN, allocateBars, variantStepDiff, minVariantDiff, VARIANT_LANES };
