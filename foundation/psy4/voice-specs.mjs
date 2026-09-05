/**
 * VoiceSpecs — Single Source of Truth for all voice parameters.
 *
 * Based on PSY3_SOUND_DESIGN_RULES + COMMERCIAL_AUDIO_AUDIT + PSY4_DEEP_ROAST.
 * The forensic bridge (offline render) reads from these specs.
 *
 * Key principles (from PSY3):
 * 1. Sub over click (kick sub 90x longer than click)
 * 2. Bass leaves room (filter drops to 150Hz)
 * 3. Band-limited oscillators (no aliasing)
 * 4. Controlled mutation (not random)
 * 5. Section-aware FX (kick dry, lead delay)
 * 6. Subtle saturation (15% mix)
 * 7. Frequency-dependent stereo (mono <120Hz)
 *
 * Ported from psy-foundation v2.0.0 @ edd1e5f (apps/web/src/lib/psy4/voice-specs.ts) — mechanical TS→JS conversion, math byte-identical.
 * (The spec *interfaces* — KickSpec, BassSpec, LeadSpec, PadSpec, AcidSpec,
 * HatSpec, SnareSpec, BusGains, MasterSpec, ArrangementSpec — are type
 * declarations only and are dropped in JS; all spec const objects below keep
 * their exact values.)
 */

// ═══════════════════════════════════════════════════════════════
// KICK — 3-layer: sub (dominant) + mid + click
// ═══════════════════════════════════════════════════════════════

export const KICK_SPEC = {
  fundamental: 50, // Phase D: was 38 (below PA sub cutoff), now 50 (full-on standard)
  subDecay: 0.65, // Phase D: was 0.45, now 0.65 (proper full-on sustain)
  subLevel: 1.0,
  midDecay: 0.05,
  midLevel: 0.5,
  midFreq: 150,
  clickDecay: 0.002,
  clickLevel: 0.35,
  pitchStart: 200,
  pitchDecay: 0.012,
  saturation: 1.8,
  hpFreq: 30,
}

// ═══════════════════════════════════════════════════════════════
// BASS — 3-layer: sub + body + character, pluck/sustain mode
// ═══════════════════════════════════════════════════════════════

export const BASS_SPEC = {
  mode: 'pluck',
  subLevel: 0.3,
  bodyLevel: 0.7,
  characterLevel: 0.2,
  cutoffStart: 1200,
  cutoffEnd: 150,
  res: 0.3,
  pluckDecay: 0.12, // Phase D: was 0.08, now 0.12 (16th note overlap at 145 BPM)
  sustainLevel: 0.6,
  sustainRelease: 0.004,
  hpFreq: 40, // Phase 3 Day 2: lower HP (was 45 — let more sub through)
  saturation: 2.0,
  sidechainDepth: 0.75,
}

// ═══════════════════════════════════════════════════════════════
// LEAD — 4-layer: fundamental + octave + air + FM
// ═══════════════════════════════════════════════════════════════

export const LEAD_SPEC = {
  oscCount: 2,
  detune: 12,
  octaveLevel: 0.6,
  octaveDetune: 7,
  airLevel: 0.18, // Phase 3 Day 2: more air (was 0.12 — too dark for psytrance)
  airDecay: 0.15,
  fmLevel: 0.35,
  fmRatio: 2.0,
  fmIndex: 180,
  cutoff: 9000, // Phase D: was 5200, now 9000 (proper psytrance lead brightness)
  res: 0.7,
  filterEnvAmount: 5.0,
  filterEnvDecay: 0.25,
  lfoRate: 2.0,
  lfoDepth: 1.0,
  saturation: 2.0,
  delaySend: 0.25,
  reverbSend: 0.25,
  hpFreq: 80,
  gain: 0.6,
}

// ═══════════════════════════════════════════════════════════════
// PAD — 5-layer: 3 osc + chorus + shimmer
// ═══════════════════════════════════════════════════════════════

export const PAD_SPEC = {
  oscCount: 3,
  detune: 7,
  octaveOsc: true,
  chorusDepth: 0.7, // Phase 3 Day 2: deeper chorus (was 0.5 — more movement)
  chorusRate: 0.3,
  shimmerLevel: 0.4, // Phase 3 Day 2: more shimmer (was 0.3 — more air)
  cutoff: 600,
  res: 0.3,
  filterLfoRate: 0.15,
  filterLfoDepth: 0.6, // Phase 3 Day 2: deeper filter sweep (was 0.5)
  saturation: 1.0,
  reverbSend: 0.4,
  hpFreq: 80,
  attack: 0.3,
  release: 0.4,
  gain: 0.4,
}

// ═══════════════════════════════════════════════════════════════
// ACID — bidirectional filter LFO
// ═══════════════════════════════════════════════════════════════

export const ACID_SPEC = {
  waveType: 'square',
  cutoff: 800,
  res: 0.85,
  lfoRate: 2.0,
  lfoDepth: 0.7,
  envAmount: 2.0,
  envDecay: 0.12,
  distortion: 3.0,
  hpFreq: 100,
  gain: 0.3,
}

// ═══════════════════════════════════════════════════════════════
// HAT — metallic synthesis + per-hit variation
// ═══════════════════════════════════════════════════════════════

export const HAT_SPEC = {
  metallicFreqs: [540, 800, 1080, 1360, 1700, 2400],
  bpFreq: 12000,
  bpRes: 0.5,
  hpFreq: 6000,
  closedDecay: 0.04,
  openDecay: 0.18,
  pitchVar: 0.02,
  panVar: 0.1,
  gain: 1.2,
}

// ═══════════════════════════════════════════════════════════════
// SNARE — 2 tone + filtered noise
// ═══════════════════════════════════════════════════════════════

export const SNARE_SPEC = {
  tone1Freq: 180,
  tone2Freq: 330,
  toneDecay: 0.05,
  noiseBpFreq: 1800,
  noiseBpRes: 0.7,
  noiseHpFreq: 1000,
  noiseDecay: 0.08,
  gain: 0.4,
}

// ═══════════════════════════════════════════════════════════════
// BUS GAINS — frequency ownership
// ═══════════════════════════════════════════════════════════════

export const BUS_GAINS = {
  drum: 0.8,
  bass: 0.35,
  music: 1.2, // Phase D: was 2.5 (+8dB clip risk), now 1.2 (safe level)
  fx: 1.0,
}

// ═══════════════════════════════════════════════════════════════
// MASTER CHAIN — full PSY3-style chain
// ═══════════════════════════════════════════════════════════════

export const MASTER_SPEC = {
  hpFreq: 25,
  mbLowXover: 180,
  mbHighXover: 3500,
  mbLowThr: 0.3, // raised: less low-band compression
  mbMidThr: 0.2, // raised: less mid compression
  mbHighThr: 0.25, // raised: less high compression = more air
  glueThr: 0.8, // raised: 0.6 → 0.8 (much less glue compression)
  glueRatio: 1.5, // lowered: 2.0 → 1.5 (gentler ratio)
  glueAttack: 0.01, // slower: 0.005 → 0.01 (let transients through)
  glueRelease: 0.2, // slower: 0.15 → 0.2 (more natural)
  glueMakeup: 1.0, // lowered: 1.1 → 1.0 (no makeup = no pumping)
  satDrive: 1.0, // lowered = less saturation = cleaner
  satMix: 0.1, // lowered = less sat mix = more transparency
  stereoWidth: 1.3, // slightly less width = more mono compatibility
  monoBelowHz: 120,
  ceiling: 0.95, // raised = less limiting = more dynamics
  targetLufs: -9, // Phase 3: club target for psytrance (was -12)
}

// ═══════════════════════════════════════════════════════════════
// ARRANGEMENT — 88-bar structure
// ═══════════════════════════════════════════════════════════════

export const ARRANGEMENT_SPEC = {
  sections: [
    {
      name: 'intro',
      bars: 8,
      energy: 0.5,
      tensionShape: 'rise',
      voices: ['kick', 'bass', 'hats', 'shaker'],
    },
    {
      name: 'build1',
      bars: 16,
      energy: 0.7,
      tensionShape: 'rise',
      voices: ['kick', 'bass', 'hats', 'shaker', 'pad', 'lead'],
    },
    {
      name: 'drop1',
      bars: 16,
      energy: 1.0,
      tensionShape: 'arc',
      voices: ['kick', 'bass', 'hats', 'shaker', 'pad', 'lead', 'counter', 'snare'],
    },
    {
      name: 'break',
      bars: 8,
      energy: 0.4,
      tensionShape: 'fall',
      voices: ['kick', 'pad', 'texture', 'riser'],
    },
    {
      name: 'drop2',
      bars: 16,
      energy: 1.0,
      tensionShape: 'arc',
      voices: ['kick', 'bass', 'hats', 'shaker', 'pad', 'lead', 'counter', 'snare', 'acid'],
    },
    {
      name: 'climax',
      bars: 16,
      energy: 1.0,
      tensionShape: 'sustain',
      voices: [
        'kick',
        'bass',
        'hats',
        'shaker',
        'pad',
        'lead',
        'counter',
        'snare',
        'acid',
        'impact',
      ],
    },
    { name: 'outro', bars: 8, energy: 0.3, tensionShape: 'fall', voices: ['kick', 'bass', 'pad'] },
  ],
}
// Total: 88 bars = ~2.4 minutes at 145 BPM
