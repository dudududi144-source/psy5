/* ============ SONG COMPOSER (v0.5.0) — complete unique arrangements ============
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
     5. LANES — filter-sweep lane on BUILD (lead cutoff) and sendA/B rise on
        RISER (pad), written as 'state' lanes via the v0.5.0 param registry.
     6. OUTPUT — scenes renamed by section (color-tagged), arranger steps,
        9th track (FX riser), project bpm/scale/root per style. */
import { rngFor, degreeToSemitone } from '../foundation/foundation.mjs';
import { arcAt } from '../foundation/composition/form.mjs';
import { motifFromEvents, MotifTransformer } from '../foundation/music/motif.mjs';
import { SCALES, mkStep, deep } from './model.js';
import { initTracks, addTrackToProject, libFind, assignPresetToTrack } from './presets.js';

/* ── style templates ── */
export const COMPOSER_STYLES = {
  'FULL-ON': {
    label: 'FULL-ON', bpm: 145, scale: 'phrygian',
    presets: { kick: 'PS-KICK-TIGHT', snare: 'PS-KICK-DEEP', hat: 'PS-HAT', perc: 'PS-PERC', bass: 'PS-BASS-ROLL', lead: 'PS-LEAD-SQUELCH', pad: 'PS-PAD-PSYCH', arp: 'PS-ARP-ACID', fx: 'FX-PS-RISE' },
  },
  'DARK-PSY': {
    label: 'DARK-PSY', bpm: 148, scale: 'phrygian',
    presets: { kick: 'PS-KICK-DEEP', snare: 'PS-GLITCH', hat: 'PS-HAT', perc: 'PS-PERC', bass: 'PS-BASS-AGGRO', lead: 'PS-LEAD-FMTEX', pad: 'PS-PAD-PSYCH', arp: 'PS-ARP-ACID', fx: 'FX-PS-RISE' },
  },
  'PROGRESSIVE': {
    label: 'PROGRESSIVE', bpm: 138, scale: 'minor',
    presets: { kick: 'PR-KICK', snare: 'TR-CLAP', hat: 'PR-HAT', perc: 'PR-PERC', bass: 'PR-BASS-WARM', lead: 'PR-LEAD-MELODIC', pad: 'PR-PAD-EVOLVE', arp: 'PR-ARP-MELODIC', fx: 'FX-TE-RISE' },
  },
};

/* section chain: weights sum to 1; energy arcs [start,end] across the section */
const SECTION_CHAIN = [
  { id: 'INTRO', w: 0.125, energy: [0.25, 0.40], color: 3 },
  { id: 'BUILD', w: 0.125, energy: [0.40, 0.70], color: 4 },
  { id: 'DROP', w: 0.20, energy: [0.90, 0.95], color: 0 },
  { id: 'BREAK', w: 0.125, energy: [0.35, 0.50], color: 5 },
  { id: 'RISER', w: 0.10, energy: [0.50, 0.85], color: 4 },
  { id: 'DROP2', w: 0.20, energy: [0.95, 1.00], color: 0 },
  { id: 'OUTRO', w: 0.125, energy: [0.50, 0.20], color: 6 },
];
const SECTION_BY_ID = new Map(SECTION_CHAIN.map(s => [s.id, s]));

const put = (pat, track, step, vel, note, micro) => {
  const d = pat.data[track]; const L = d.len;
  const st = d.steps[((step % L) + L) % L];
  st.on = 1; st.vel = Math.min(1, Math.max(0.05, vel)); st.prob = 1;
  if (note != null) st.note = Math.round(note);
  if (micro != null) st.micro = Math.max(-100, Math.min(100, micro));
};

/* allocate bars: weights → multiples of 4 (min 4), remainder to the longest */
function allocateBars(totalBars) {
  const bars = SECTION_CHAIN.map(s => Math.max(4, Math.round((totalBars * s.w) / 4) * 4));
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

/* write one section pattern (len = min(bars,8)*16), all tracks equal length */
function fillSection(p, pat, section, bars, energy, ctx) {
  const len = Math.min(bars, 8) * 16;
  const { style, rng, motif, scaleIv, root } = ctx;
  for (const t of Object.keys(pat.data)) {
    const d = pat.data[t];
    d.len = len;
    d.steps = Array.from({ length: len }, () => mkStep(false));
  }
  const sec = section.id;
  const notes = { bass: root, leadBase: root + 24 };
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
  /* BASS — psy rolling on drops (odd 16ths, psy-push micro baked in), 8ths mid, sustained when calm */
  if (sec === 'DROP' || sec === 'DROP2' || energy >= 0.8) {
    for (let s = 1; s < len; s += 2) {
      const push = (sec === 'DROP' || sec === 'DROP2') ? 19 + Math.round(rng() * 6) : null; /* psy-push: +6..8 ticks */
      put(pat, 4, s, 0.82 + rng() * 0.1, notes.bass, push);
    }
  } else if (energy >= 0.55) {
    for (let s = 0; s < len; s += 2) if (rng() < 0.8) put(pat, 4, s, 0.7 + rng() * 0.1, notes.bass)
  } else {
    for (let b = 0; b < len / 16; b++) { put(pat, 4, b * 16, 0.8, notes.bass); put(pat, 4, b * 16 + 8, 0.75, notes.bass) }
  }
  /* HATS — offbeat core, 16th ghosts as energy rises */
  if (energy >= 0.35) {
    for (let b = 0; b < len / 16; b++) for (const o of [2, 6, 10, 14]) put(pat, 2, b * 16 + o, 0.45 + energy * 0.2)
    if (energy >= 0.75) for (let s = 0; s < len; s++) if (s % 2 === 0 && rng() < 0.3) put(pat, 2, s, 0.25 + rng() * 0.15)
  }
  /* PERC — seeded sparse density scaled by energy */
  for (let s = 0; s < len; s += 2) if (rng() < 0.06 + energy * 0.12) put(pat, 3, s, 0.3 + rng() * 0.4)
  /* SNARE — backbeat on full sections, half-time on BREAK */
  if (sec === 'BREAK') { for (let b = 0; b < len / 16; b++) { put(pat, 1, b * 16 + 4, 0.6); put(pat, 1, b * 16 + 12, 0.65) } }
  else if (energy >= 0.8) { for (let b = 0; b < len / 16; b++) { put(pat, 1, b * 16 + 4, 0.55); put(pat, 1, b * 16 + 12, 0.6) } }
  /* LEAD — the motif, varied per section; INTRO stays headless */
  if (sec !== 'INTRO' && (energy >= 0.55 || sec === 'BREAK')) {
    const evs = motif.events; let cursor = 0;
    const barsN = len / 16;
    for (let b = 0; b < barsN; b++) {
      cursor = b * 16;
      for (const ev of evs) {
        if (!ev.rest && cursor < len) {
          const n = degNote(ev.deg, ev.oct);
          put(pat, 5, cursor, 0.4 + ev.accent * 0.35, n);
        }
        cursor += ev.dur;
      }
    }
  }
  /* PAD — sustained roots when the mix has room */
  if (energy < 0.6 || sec === 'BREAK') {
    for (let b = 0; b < len / 16; b++) { put(pat, 6, b * 16, 0.35, root + 12); if (len >= 64) put(pat, 6, b * 16 + 8, 0.3, root + 12 + 7) }
  }
  /* ARP — hypno 16ths only at peak energy */
  if (energy >= 0.85) {
    const seq = [0, 2, 4, 6, 4, 2];
    for (let s = 0; s < len; s++) { if (rng() < 0.85) put(pat, 7, s, 0.28 + rng() * 0.12, root + 24 + degreeToSemitone(scaleIv, seq[s % seq.length])) }
  }
  /* FX — riser sweeps through the RISER section, one per 2 bars */
  if (sec === 'RISER') { for (let s = 0; s < len; s += 32) put(pat, 8, s, 0.8) }
  /* FILL — snare roll ending BUILD and RISER (last bar, rising velocity) */
  if (sec === 'BUILD' || sec === 'RISER') {
    const fb = len - 16;
    for (let k = 0; k < 16; k++) put(pat, 1, fb + k, 0.3 + (k / 16) * 0.6)
  }
  return pat;
}

/* compose — the pure entry point. targetMinutes ∈ {3,5,8} (any >0 works). */
export function compose(styleId, targetMinutes, seed, seedLabel) {
  const style = COMPOSER_STYLES[styleId] || COMPOSER_STYLES['FULL-ON'];
  const bpm = style.bpm;
  const seedInt = (typeof seed === 'number' ? seed : parseInt(fnvish(String(seed)), 16) >>> 0) | 0;
  const label = seedLabel || String(seed);

  /* 1. form: bars + energies */
  const rawTotal = (targetMinutes * bpm) / 4;           /* 1 bar = 4 beats */
  const totalBars = Math.max(28, Math.round(rawTotal / 4) * 4); /* multiple of 4 */
  const bars = allocateBars(totalBars);
  const sections = SECTION_CHAIN.map((s, i) => ({ ...s, bars: bars[i], energyMid: arcAt(s.energy, Math.floor(bars[i] / 2), bars[i]) }));

  /* 2. project shell */
  const p = {
    version: 3, bpm, swing: 0, root: 33, scale: style.scale, recQ: 1, chain: false,
    seed: 'C' + label, groove: 'straight', fx: { delayDiv: '3/16', delayFb: 0.35 }, masterVol: 0.85,
    activeScene: 0, currentPattern: 'C1', selTrack: 4,
    macroVals: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
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
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const motif = sectionMotif(seedInt, sec.id, baseMotif);
    const patName = 'C' + (i + 1);
    const pat = { name: patName, data: {} };
    for (let t = 0; t < p.tracks.length; t++) pat.data[t] = { len: 16, steps: Array.from({ length: 16 }, () => mkStep(false)) };
    fillSection(p, pat, sec, sec.bars, sec.energyMid, { style, rng, motif, scaleIv, root: p.root });
    p.patterns[patName] = pat;
    p.scenes.push({ name: sec.id, pattern: patName, color: sec.color, bars: Math.min(sec.bars, 8), fill: false });
    const loops = Math.max(1, Math.round(sec.bars / Math.min(sec.bars, 8)));
    for (let k = 0; k < loops; k++) arrSteps.push({ scene: sceneIdx, bars: Math.min(sec.bars, 8) });
    formSections.push({ id: sec.id, bars: sec.bars, energy: +sec.energyMid.toFixed(3), pattern: patName, scene: sceneIdx });
    sceneIdx++;
  }
  p.currentPattern = 'C1'; p.activeScene = 0;
  p.arranger = { v: 1, on: true, steps: arrSteps, idx: 0, barsIn: 0 };

  /* 4. lane suggestions (v0.5.0 registry, 'state' lanes) */
  const lanes = [];
  const build = formSections.find(s => s.id === 'BUILD');
  if (build) {
    const len = Math.min(build.bars, 8) * 16;
    lanes.push({ track: 5, param: 'cutoff', mode: 'state', pts: [[0, 600], [Math.floor(len / 2), 2400], [len - 1, 6000]] });
  }
  const riser = formSections.find(s => s.id === 'RISER');
  if (riser) {
    const len = Math.min(riser.bars, 8) * 16;
    lanes.push({ track: 6, param: 'mix.sendA', mode: 'state', pts: [[0, 0.05], [len - 1, 0.9]] });
    lanes.push({ track: 6, param: 'mix.sendB', mode: 'state', pts: [[0, 0.05], [len - 1, 0.85]] });
  }
  p.lanes = lanes;

  /* 5. stats + determinism fingerprint */
  const totalSecs = formSections.reduce((a, s) => a + s.bars, 0);
  const lengthSec = totalSecs * 4 * 60 / bpm;
  const fingerprint = sectionsFingerprint(p, formSections);
  return {
    project: p,
    form: { style: styleId, seed: label, bpm, sections: formSections, totalBars: totalSecs, lengthSec: +lengthSec.toFixed(2), targetSec: targetMinutes * 60 },
    stats: { tracks: p.tracks.length, scenes: p.scenes.length, lanes: p.lanes.length, lengthErr: +(((lengthSec - targetMinutes * 60) / (targetMinutes * 60)) * 100).toFixed(3), fingerprint },
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

export { SECTION_CHAIN, allocateBars };
