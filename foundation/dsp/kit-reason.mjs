/* REASON KIT LIBRARY (v0.24.0) — the cohesion layer.
 *
 * A kit is ONE instrument: every role tuned to the kit root, every role
 * leveled to the family loudness law, one character per kit.
 * Kits 1-3 ported+extended from psyreason devices/redrum/kit-builtin.ts;
 * kits 4-6 designed to surpass it (PSY6 originals).
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The owner's v0.23.0 verdict: individual sounds are good now ("you made a
 * real conga") but "there is no connection between them" — the kit does not
 * cohere as ONE instrument, and sounds destroy the mix dynamics and harmony.
 * The fix is DATA, not more DSP: each kit declares
 *   · rootHz        — the fundamental of the key center; the whole kit hangs
 *                     off this one number
 *   · rom f0mul     — pitched-percussion fundamentals as CLEAN JUST RATIOS of
 *                     the root (1, 1.5, 2, 2.52, 3, 4, 4.5, 5.04, 6, 8, …) so
 *                     the conga/bongo/darbuka/rim/wood/metal family stacks in
 *                     octaves and fifths against the bass — the "connection"
 *   · rms           — every role leveled inside its family loudness band
 *                     (mirrors foundation/dsp/perc-rom.mjs SPEC magnitudes —
 *                     the anti-"dynamics destroyer" law, kit-governed)
 *   · engine patches— the 8 roles rendered by the NEW reason engines
 *                     (foundation/dsp/reason-engines.mjs, Phase 1a), one
 *                     character per kit, drive capped at 6 dB
 *
 * ── SHAPE (frozen contract — engine + Phase-2 wiring rely on exactly this) ──
 * { id, name, style, blurb, rootHz,
 *   choke: { hatExclusive, crashMaxPoly, rideMaxPoly },
 *   humanize,
 *   engine: {
 *     kick:  { body:{wave,startHz,endHz,pitchDecayMs,bodyDecayMs},
 *              punch:{ratio,amount,decayMs}, click:{amount,ms,hpHz},
 *              filter:{cutoff,res}, driveDb, velTrack, rms },
 *     snare: { body:{startHz,endHz,pitchDecayMs}, tone:{amount,decayMs},
 *              noise:{bpHz,q,amount,decayMs}, driveDb, velTrack, rms },
 *     clap:  { taps:[bpHz,bpHz,bpHz], tapMs:[0,·,·], bursts:[dMs,dMs,dMs],
 *              tail:{decayMs,amount}, driveDb, velTrack, rms },
 *     hatO:  { metal:{hz,ratio,amount}, noise:{amount,hpHz}, hp:{hz,q},
 *              decayMs, driveDb, velTrack, rms },
 *     hatC:  { same shape as hatO },
 *     tom:   { body:{startHz,endHz,pitchDecayMs,bodyDecayMs},
 *              filter:{cutoff,res}, driveDb, velTrack, rms, tuneRatio },
 *     crash: { metal:{hz,ratio,amount}, hp:{hz,q}, decayMs, driveDb,
 *              velTrack, rms },
 *     ride:  { metal:{hz,ratio,amount}, ping:{hz,amount}, hp:{hz,q},
 *              decayMs, driveDb, velTrack, rms },
 *   },
 *   rom: { conga:{f0mul,rms}, bongo:{…}, darbuka, rim, shaker, tambourine,
 *          triangle, cowbell, clave, agogo, timbale, revcym },
 * }
 *
 * ── PORT MAPPING (kit-builtin.ts → engine shape, kits 1–3) ─────────────────
 *   · body.startHz/endHz/pitchDecayMs ported VERBATIM (kick 168/150/175,
 *     tom 218/190/235, snare 196/170/210 — the tests pin these).
 *   · their amp.decayMs → kick body.bodyDecayMs (218/260/190; the brief's
 *     pitchDecayMs×4.5 fallback applies only when absent) → snare
 *     tone.decayMs AND noise.decayMs → hats decayMs → clap tail.decayMs
 *     (the three burst onsets/decays are derived: tapMs [0,12,24] fixed).
 *   · their noise.mix → snare noise.amount / hat noise.amount;
 *     snare tone.amount = 1 − mix (their mix governs the tone↔noise crossfade).
 *   · their noise.bpHz → clap taps + hat hp.hz (7600/8200/7200 — pinned) +
 *     crash/ride metal.hz; their filter.cutoff → hat noise.hpHz.
 *     crash/ride hp.hz = bpHz/2 (an octave under the wash center so the metal
 *     bank base is not amputated; their filter.cutoff is subsumed by the
 *     metal bank's ratio spread).
 *   · kick/snare driveDb + velTrack ported verbatim (3.5/5.0/1.5 — pinned);
 *     hats/tom/crash/ride had NO driveDb in the source → 0 (faithful).
 *   · clap filter.cutoff is superseded by the tap band-pass centers.
 *   · PSY6 extensions the source lacked (our shape demands them): kick
 *     punch {ratio = transient pitch multiplier over startHz, amount 0..1,
 *     decayMs} + click; hats/crash/ride metal (their hats are noise-only;
 *     the metal ping is what makes them sit IN the kit instead of on top).
 *   · tom tuneRatio = 1 in every kit — the tom follows the kit root via
 *     Phase-2 wiring (root × 1); body startHz is the ported/design register.
 *
 * ── KIT RATIO INTENT (the musical contract per kit) ────────────────────────
 *   psy-classic   E1 41.2 — conga 2× (octave, the classic full-on slap),
 *                 tom 1× via wiring, bongo 4.5× (fifth over the octave-fifth
 *                 stack), darbuka 2.52× (major third over the octave),
 *                 rim 6×, cowbell 12× (three octaves + fifth), clave 24×
 *                 (an octave over the cowbell), agogo 16× (four octaves),
 *                 timbale 5.04× (major third over two octaves).
 *   dark-forest   D1 36.71 — conga 2× (low tribal heartbeat), bongo 4.5×,
 *                 darbuka 3× (the twelfth), rim 6×, cowbell 12× (lands ≈A —
 *                 a fifth color over D), clave 32× (five octaves), agogo 16×,
 *                 timbale 5.04×.
 *   progressive   A1 55.0 — the minimal kit: conga 2×, bongo 3× (twelfth),
 *                 darbuka 2.52×, rim 4× (two-octave unison), cowbell 8×
 *                 (the root, three octaves up), clave 24×, agogo 12× (a fifth
 *                 over the cowbell), timbale 4.5×.
 *   hi-tech       G#1 51.91 — conga 2×, bongo 4×, darbuka 2.52×, rim 4.5×,
 *                 cowbell 8×, clave 24×, agogo 12×, timbale 5.04×;
 *                 tom startHz 260 ≈ 5×root.
 *   forest-organic F1 43.65 — conga 2×, bongo 4×, darbuka 2.52×, rim 4.5×,
 *                 cowbell 10.08× (major third over three octaves — lands
 *                 ≈A over F), clave 24×, agogo 12×, timbale 6×;
 *                 tom startHz 196 ≈ 4.5×root.
 *   tribal-raw    G1 49.0 — conga 2×, bongo 3×, darbuka 2.52×, rim 4.5×,
 *                 cowbell 12×, clave 24×, agogo 8×, timbale 5.04×;
 *                 tom startHz 220 ≈ 4.5×root.
 *
 * Pure data + accessors: ZERO imports, ZERO dependencies, deterministic.
 * The whole library is deep-frozen at module load — a frozen contract.
 */

/* ── Role vocabulary (psy5 type names) ─────────────────────────────────── */

/* The 8 roles rendered by the NEW reason engines (Phase 1a). */
export const ENGINE_ROLES = Object.freeze([
  'kick', 'snare', 'clap', 'hatO', 'hatC', 'tom', 'crash', 'ride',
]);

/* The 12 types that stay on perc-rom.mjs modal DSP, now kit-governed. */
export const KIT_ROM_ROLES = Object.freeze([
  'conga', 'bongo', 'darbuka', 'rim', 'shaker', 'tambourine',
  'triangle', 'cowbell', 'clave', 'agogo', 'timbale', 'revcym',
]);

/* ── The kits ──────────────────────────────────────────────────────────── */

export const REASON_KITS = deepFreeze({

  /* 1 ── psy-classic ───────────────────────────────────────────────────── */
  'psy-classic': {
    id: 'psy-classic',
    name: 'Psy Classic',
    style: 'full-on',
    blurb: 'The E-center classic. Kick and tom sit on the root, conga an octave up, bongo the fifth over it — every voice one key, ROM-leveled.',
    rootHz: 41.2, /* E1 — the classic full-on key center */
    choke: { hatExclusive: true, crashMaxPoly: 2, rideMaxPoly: 2 },
    humanize: true,
    engine: {
      kick: {
        body: { wave: 'sine', startHz: 168, endHz: 44, pitchDecayMs: 42, bodyDecayMs: 218 },
        punch: { ratio: 1.6, amount: 0.35, decayMs: 16 },
        click: { amount: 0.3, ms: 5, hpHz: 1500 },
        filter: { cutoff: 950, res: 1 },
        driveDb: 3.5, velTrack: 0.5, rms: 0.20,
      },
      snare: {
        body: { startHz: 196, endHz: 196, pitchDecayMs: 10 },
        tone: { amount: 0.1, decayMs: 150 },
        noise: { bpHz: 1850, q: 1.1, amount: 0.9, decayMs: 150 },
        driveDb: 2.0, velTrack: 0.6, rms: 0.15,
      },
      clap: {
        taps: [1150, 1150, 1150], tapMs: [0, 12, 24], bursts: [24, 20, 16],
        tail: { decayMs: 92, amount: 0.55 },
        driveDb: 2.0, velTrack: 0.5, rms: 0.14,
      },
      hatC: {
        metal: { hz: 3800, ratio: 1.47, amount: 0.3 },
        noise: { amount: 0.8, hpHz: 9200 },
        hp: { hz: 7600, q: 1 },
        decayMs: 42, driveDb: 0, velTrack: 0.7, rms: 0.062,
      },
      hatO: {
        metal: { hz: 3800, ratio: 1.47, amount: 0.25 },
        noise: { amount: 0.8, hpHz: 8600 },
        hp: { hz: 6400, q: 1 },
        decayMs: 330, driveDb: 0, velTrack: 0.7, rms: 0.075,
      },
      tom: {
        body: { startHz: 218, endHz: 118, pitchDecayMs: 120, bodyDecayMs: 232 },
        filter: { cutoff: 2600, res: 1 },
        driveDb: 0, velTrack: 0.5, rms: 0.12, tuneRatio: 1,
      },
      crash: {
        metal: { hz: 5050, ratio: 1.43, amount: 0.7 },
        hp: { hz: 2525, q: 0.8 },
        decayMs: 720, driveDb: 0, velTrack: 0.6, rms: 0.095,
      },
      ride: {
        metal: { hz: 6050, ratio: 1.47, amount: 0.6 },
        ping: { hz: 4840, amount: 0.5 },
        hp: { hz: 3025, q: 0.7 },
        decayMs: 520, driveDb: 0, velTrack: 0.6, rms: 0.075,
      },
    },
    rom: {
      conga:      { f0mul: 2,    rms: 0.105 },
      bongo:      { f0mul: 4.5,  rms: 0.095 },
      darbuka:    { f0mul: 2.52, rms: 0.10 },
      rim:        { f0mul: 6,    rms: 0.08 },
      shaker:     { f0mul: 1,    rms: 0.06 },
      tambourine: { f0mul: 1,    rms: 0.068 },
      triangle:   { f0mul: 1,    rms: 0.055 },
      cowbell:    { f0mul: 12,   rms: 0.085 },
      clave:      { f0mul: 24,   rms: 0.085 },
      agogo:      { f0mul: 16,   rms: 0.08 },
      timbale:    { f0mul: 5.04, rms: 0.08 },
      revcym:     { f0mul: 1,    rms: 0.08 },
    },
  },

  /* 2 ── dark-forest ────────────────────────────────────────────────────── */
  'dark-forest': {
    id: 'dark-forest',
    name: 'Dark Forest',
    style: 'darkpsy',
    blurb: 'D-center darkpsy. Low tribal conga, twelfth darbuka, metals riding the fifth — dark but never off-key.',
    rootHz: 36.71, /* D1 — darker, lower center */
    choke: { hatExclusive: true, crashMaxPoly: 2, rideMaxPoly: 2 },
    humanize: true,
    engine: {
      kick: {
        body: { wave: 'sine', startHz: 150, endHz: 38, pitchDecayMs: 55, bodyDecayMs: 260 },
        punch: { ratio: 1.5, amount: 0.4, decayMs: 20 },
        click: { amount: 0.28, ms: 6, hpHz: 1200 },
        filter: { cutoff: 700, res: 1 },
        driveDb: 5.0, velTrack: 0.6, rms: 0.215,
      },
      snare: {
        body: { startHz: 170, endHz: 170, pitchDecayMs: 10 },
        tone: { amount: 0.1, decayMs: 130 },
        noise: { bpHz: 1500, q: 1.1, amount: 0.9, decayMs: 130 },
        driveDb: 3.0, velTrack: 0.6, rms: 0.16,
      },
      clap: {
        taps: [950, 950, 950], tapMs: [0, 12, 24], bursts: [22, 18, 14],
        tail: { decayMs: 80, amount: 0.5 },
        driveDb: 2.0, velTrack: 0.5, rms: 0.135,
      },
      hatC: {
        metal: { hz: 4100, ratio: 1.47, amount: 0.3 },
        noise: { amount: 0.8, hpHz: 9800 },
        hp: { hz: 8200, q: 1 },
        decayMs: 36, driveDb: 0, velTrack: 0.7, rms: 0.058,
      },
      hatO: {
        metal: { hz: 4100, ratio: 1.47, amount: 0.25 },
        noise: { amount: 0.8, hpHz: 9000 },
        hp: { hz: 7000, q: 1 },
        decayMs: 300, driveDb: 0, velTrack: 0.7, rms: 0.07,
      },
      tom: {
        body: { startHz: 190, endHz: 95, pitchDecayMs: 130, bodyDecayMs: 250 },
        filter: { cutoff: 2200, res: 1 },
        driveDb: 0, velTrack: 0.5, rms: 0.125, tuneRatio: 1,
      },
      crash: {
        metal: { hz: 5400, ratio: 1.43, amount: 0.7 },
        hp: { hz: 2700, q: 0.8 },
        decayMs: 700, driveDb: 0, velTrack: 0.6, rms: 0.09,
      },
      ride: {
        metal: { hz: 6500, ratio: 1.47, amount: 0.6 },
        ping: { hz: 5200, amount: 0.5 },
        hp: { hz: 3250, q: 0.7 },
        decayMs: 480, driveDb: 0, velTrack: 0.6, rms: 0.08,
      },
    },
    rom: {
      conga:      { f0mul: 2,    rms: 0.098 },
      bongo:      { f0mul: 4.5,  rms: 0.09 },
      darbuka:    { f0mul: 3,    rms: 0.095 },
      rim:        { f0mul: 6,    rms: 0.075 },
      shaker:     { f0mul: 1,    rms: 0.055 },
      tambourine: { f0mul: 1,    rms: 0.062 },
      triangle:   { f0mul: 1,    rms: 0.05 },
      cowbell:    { f0mul: 12,   rms: 0.08 },
      clave:      { f0mul: 32,   rms: 0.078 },
      agogo:      { f0mul: 16,   rms: 0.075 },
      timbale:    { f0mul: 5.04, rms: 0.078 },
      revcym:     { f0mul: 1,    rms: 0.082 },
    },
  },

  /* 3 ── progressive ────────────────────────────────────────────────────── */
  'progressive': {
    id: 'progressive',
    name: 'Progressive',
    style: 'progressive',
    blurb: 'A-center groove kit. Minimal ratios (root and twelfth), the smoothest drive in the library, hats forward.',
    rootHz: 55.0, /* A1 — melodic, groove-oriented center */
    choke: { hatExclusive: true, crashMaxPoly: 2, rideMaxPoly: 2 },
    humanize: true,
    engine: {
      kick: {
        body: { wave: 'sine', startHz: 175, endHz: 50, pitchDecayMs: 36, bodyDecayMs: 190 },
        punch: { ratio: 1.45, amount: 0.3, decayMs: 14 },
        click: { amount: 0.22, ms: 4, hpHz: 1400 },
        filter: { cutoff: 1200, res: 1 },
        driveDb: 1.5, velTrack: 0.4, rms: 0.19,
      },
      snare: {
        body: { startHz: 210, endHz: 210, pitchDecayMs: 10 },
        tone: { amount: 0.15, decayMs: 160 },
        noise: { bpHz: 2100, q: 1.1, amount: 0.85, decayMs: 160 },
        driveDb: 1.0, velTrack: 0.6, rms: 0.145,
      },
      clap: {
        taps: [1300, 1300, 1300], tapMs: [0, 12, 24], bursts: [26, 22, 18],
        tail: { decayMs: 100, amount: 0.6 },
        driveDb: 1.0, velTrack: 0.5, rms: 0.145,
      },
      hatC: {
        metal: { hz: 3600, ratio: 1.47, amount: 0.3 },
        noise: { amount: 0.75, hpHz: 8800 },
        hp: { hz: 7200, q: 1 },
        decayMs: 48, driveDb: 0, velTrack: 0.7, rms: 0.066,
      },
      hatO: {
        metal: { hz: 3600, ratio: 1.47, amount: 0.25 },
        noise: { amount: 0.75, hpHz: 8200 },
        hp: { hz: 6100, q: 1 },
        decayMs: 360, driveDb: 0, velTrack: 0.7, rms: 0.078,
      },
      tom: {
        body: { startHz: 235, endHz: 130, pitchDecayMs: 110, bodyDecayMs: 220 },
        filter: { cutoff: 2900, res: 1 },
        driveDb: 0, velTrack: 0.5, rms: 0.115, tuneRatio: 1,
      },
      crash: {
        metal: { hz: 4800, ratio: 1.43, amount: 0.65 },
        hp: { hz: 2400, q: 0.8 },
        decayMs: 750, driveDb: 0, velTrack: 0.6, rms: 0.10,
      },
      ride: {
        metal: { hz: 5800, ratio: 1.47, amount: 0.55 },
        ping: { hz: 4640, amount: 0.5 },
        hp: { hz: 2900, q: 0.7 },
        decayMs: 560, driveDb: 0, velTrack: 0.6, rms: 0.072,
      },
    },
    rom: {
      conga:      { f0mul: 2,    rms: 0.095 },
      bongo:      { f0mul: 3,    rms: 0.085 },
      darbuka:    { f0mul: 2.52, rms: 0.09 },
      rim:        { f0mul: 4,    rms: 0.07 },
      shaker:     { f0mul: 1,    rms: 0.058 },
      tambourine: { f0mul: 1,    rms: 0.06 },
      triangle:   { f0mul: 1,    rms: 0.052 },
      cowbell:    { f0mul: 8,    rms: 0.078 },
      clave:      { f0mul: 24,   rms: 0.075 },
      agogo:      { f0mul: 12,   rms: 0.07 },
      timbale:    { f0mul: 4.5,  rms: 0.075 },
      revcym:     { f0mul: 1,    rms: 0.078 },
    },
  },

  /* 4 ── hi-tech (PSY6 original — 160–180 BPM aggression) ───────────────── */
  'hi-tech': {
    id: 'hi-tech',
    name: 'Hi-Tech',
    style: 'hi-tech',
    blurb: 'G#-center 160–180 BPM weapon. Tightest kick in the library, cracked snare, razor hats — aggression inside the loudness law.',
    rootHz: 51.91, /* G#1 — the hi-tech center */
    choke: { hatExclusive: true, crashMaxPoly: 2, rideMaxPoly: 2 },
    humanize: true,
    engine: {
      kick: {
        body: { wave: 'sine', startHz: 180, endHz: 42, pitchDecayMs: 30, bodyDecayMs: 180 },
        punch: { ratio: 1.8, amount: 0.5, decayMs: 12 },
        click: { amount: 0.4, ms: 3, hpHz: 2200 },
        filter: { cutoff: 1400, res: 1.2 },
        driveDb: 6, velTrack: 0.55, rms: 0.225,
      },
      snare: {
        body: { startHz: 175, endHz: 168, pitchDecayMs: 12 },
        tone: { amount: 0.4, decayMs: 110 },
        noise: { bpHz: 1600, q: 1.2, amount: 0.85, decayMs: 110 },
        driveDb: 4.5, velTrack: 0.6, rms: 0.165,
      },
      clap: {
        taps: [1750, 1750, 1750], tapMs: [0, 10, 20], bursts: [14, 12, 10],
        /* v0.27.0 RE-TUNE (G52 law fix): the tight hi-tech bursts (14/12/10)
           + 70 ms tail rendered 0.0895 — 40% under the old 0.15 target and
           BELOW the clap band floor [0.12,0.16]. drive 3.5→6 (the field
           bound) + tail 0.5 lifts the render to ≈0.111 and the target is
           honest at the band floor 0.12 (err ≈8%, G52 law worst back under
           15% everywhere). */
        tail: { decayMs: 70, amount: 0.5 },
        driveDb: 6, velTrack: 0.5, rms: 0.12,
      },
      hatC: {
        metal: { hz: 6400, ratio: 1.52, amount: 0.5 },
        noise: { amount: 0.75, hpHz: 11000 },
        hp: { hz: 9800, q: 1.1 },
        decayMs: 30, driveDb: 1.5, velTrack: 0.75, rms: 0.07,
      },
      hatO: {
        metal: { hz: 6400, ratio: 1.52, amount: 0.45 },
        noise: { amount: 0.75, hpHz: 11000 },
        hp: { hz: 9800, q: 1.1 },
        decayMs: 220, driveDb: 1.5, velTrack: 0.75, rms: 0.082,
      },
      tom: {
        body: { startHz: 260, endHz: 143, pitchDecayMs: 80, bodyDecayMs: 150 },
        filter: { cutoff: 3200, res: 1 },
        driveDb: 2, velTrack: 0.5, rms: 0.13, tuneRatio: 1,
      },
      crash: {
        metal: { hz: 5800, ratio: 1.5, amount: 0.7 },
        hp: { hz: 2900, q: 0.8 },
        decayMs: 380, driveDb: 1, velTrack: 0.6, rms: 0.10,
      },
      ride: {
        metal: { hz: 7200, ratio: 1.45, amount: 0.55 },
        ping: { hz: 5600, amount: 0.5 },
        hp: { hz: 3600, q: 0.7 },
        decayMs: 420, driveDb: 0.5, velTrack: 0.6, rms: 0.08,
      },
    },
    rom: {
      conga:      { f0mul: 2,    rms: 0.11 },
      bongo:      { f0mul: 4,    rms: 0.10 },
      darbuka:    { f0mul: 2.52, rms: 0.105 },
      rim:        { f0mul: 4.5,  rms: 0.082 },
      shaker:     { f0mul: 1,    rms: 0.065 },
      tambourine: { f0mul: 1,    rms: 0.07 },
      triangle:   { f0mul: 1,    rms: 0.058 },
      cowbell:    { f0mul: 8,    rms: 0.092 },
      clave:      { f0mul: 24,   rms: 0.088 },
      agogo:      { f0mul: 12,   rms: 0.082 },
      timbale:    { f0mul: 5.04, rms: 0.085 },
      revcym:     { f0mul: 1,    rms: 0.088 },
    },
  },

  /* 5 ── forest-organic (PSY6 original — tribal warmth) ──────────────────── */
  'forest-organic': {
    id: 'forest-organic',
    name: 'Forest Organic',
    style: 'forest',
    blurb: 'F-center tribal warmth. Round kick, conga trio forward, woody clave/agogo/darbuka at the law top.',
    rootHz: 43.65, /* F1 — the organic forest center */
    choke: { hatExclusive: true, crashMaxPoly: 2, rideMaxPoly: 2 },
    humanize: true,
    engine: {
      kick: {
        body: { wave: 'sine', startHz: 150, endHz: 40, pitchDecayMs: 48, bodyDecayMs: 260 },
        punch: { ratio: 1.4, amount: 0.25, decayMs: 22 },
        click: { amount: 0.18, ms: 6, hpHz: 900 },
        filter: { cutoff: 750, res: 0.9 },
        driveDb: 4, velTrack: 0.5, rms: 0.215,
      },
      snare: {
        body: { startHz: 168, endHz: 160, pitchDecayMs: 14 },
        tone: { amount: 0.22, decayMs: 145 },
        noise: { bpHz: 1350, q: 1.0, amount: 0.8, decayMs: 145 },
        driveDb: 3, velTrack: 0.55, rms: 0.15,
      },
      clap: {
        taps: [1050, 1050, 1050], tapMs: [0, 14, 28], bursts: [26, 22, 18],
        tail: { decayMs: 110, amount: 0.65 },
        driveDb: 2.5, velTrack: 0.5, rms: 0.145,
      },
      hatC: {
        metal: { hz: 5200, ratio: 1.44, amount: 0.3 },
        noise: { amount: 0.85, hpHz: 7800 },
        hp: { hz: 6800, q: 0.9 },
        decayMs: 55, driveDb: 0.5, velTrack: 0.7, rms: 0.06,
      },
      hatO: {
        metal: { hz: 5200, ratio: 1.44, amount: 0.28 },
        noise: { amount: 0.85, hpHz: 7200 },
        hp: { hz: 6400, q: 0.9 },
        decayMs: 380, driveDb: 0.5, velTrack: 0.7, rms: 0.075,
      },
      tom: {
        body: { startHz: 196, endHz: 108, pitchDecayMs: 140, bodyDecayMs: 280 },
        filter: { cutoff: 2000, res: 0.9 },
        driveDb: 1, velTrack: 0.5, rms: 0.13, tuneRatio: 1,
      },
      crash: {
        metal: { hz: 4600, ratio: 1.4, amount: 0.55 },
        hp: { hz: 2300, q: 0.7 },
        decayMs: 900, driveDb: 0, velTrack: 0.55, rms: 0.09,
      },
      ride: {
        metal: { hz: 5600, ratio: 1.42, amount: 0.5 },
        ping: { hz: 4400, amount: 0.45 },
        hp: { hz: 2800, q: 0.7 },
        decayMs: 600, driveDb: 0, velTrack: 0.6, rms: 0.07,
      },
    },
    rom: {
      conga:      { f0mul: 2,    rms: 0.12 },
      bongo:      { f0mul: 4,    rms: 0.105 },
      darbuka:    { f0mul: 2.52, rms: 0.118 },
      rim:        { f0mul: 4.5,  rms: 0.082 },
      shaker:     { f0mul: 1,    rms: 0.062 },
      tambourine: { f0mul: 1,    rms: 0.068 },
      triangle:   { f0mul: 1,    rms: 0.058 },
      cowbell:    { f0mul: 10.08, rms: 0.085 },
      clave:      { f0mul: 24,   rms: 0.088 },
      agogo:      { f0mul: 12,   rms: 0.083 },
      timbale:    { f0mul: 6,    rms: 0.082 },
      revcym:     { f0mul: 1,    rms: 0.08 },
    },
  },

  /* 6 ── tribal-raw (PSY6 original — the wildcard that surpasses the
        reference project's kit count) ────────────────────────────────────── */
  'tribal-raw': {
    id: 'tribal-raw',
    name: 'Tribal Raw',
    style: 'forest',
    blurb: 'G-center wildcard. Maximal hand-percussion character, moderate drive — the ROM voices carry the kit.',
    rootHz: 49.0, /* G1 — the raw tribal center */
    choke: { hatExclusive: true, crashMaxPoly: 2, rideMaxPoly: 2 },
    humanize: true,
    engine: {
      kick: {
        body: { wave: 'sine', startHz: 158, endHz: 44, pitchDecayMs: 46, bodyDecayMs: 235 },
        punch: { ratio: 1.55, amount: 0.4, decayMs: 18 },
        click: { amount: 0.25, ms: 5, hpHz: 1100 },
        filter: { cutoff: 850, res: 1 },
        driveDb: 4, velTrack: 0.55, rms: 0.22,
      },
      snare: {
        body: { startHz: 180, endHz: 172, pitchDecayMs: 12 },
        tone: { amount: 0.3, decayMs: 140 },
        noise: { bpHz: 1450, q: 1.05, amount: 0.82, decayMs: 140 },
        driveDb: 3.5, velTrack: 0.6, rms: 0.155,
      },
      clap: {
        taps: [980, 980, 980], tapMs: [0, 15, 30], bursts: [30, 26, 22],
        tail: { decayMs: 120, amount: 0.7 },
        driveDb: 2.5, velTrack: 0.5, rms: 0.15,
      },
      hatC: {
        metal: { hz: 5600, ratio: 1.46, amount: 0.35 },
        noise: { amount: 0.8, hpHz: 8400 },
        hp: { hz: 7000, q: 0.9 },
        decayMs: 50, driveDb: 1, velTrack: 0.7, rms: 0.062,
      },
      hatO: {
        metal: { hz: 5600, ratio: 1.46, amount: 0.32 },
        noise: { amount: 0.8, hpHz: 7800 },
        hp: { hz: 6600, q: 0.9 },
        decayMs: 400, driveDb: 1, velTrack: 0.7, rms: 0.078,
      },
      tom: {
        body: { startHz: 220, endHz: 121, pitchDecayMs: 130, bodyDecayMs: 260 },
        filter: { cutoff: 2400, res: 0.9 },
        driveDb: 1.5, velTrack: 0.5, rms: 0.13, tuneRatio: 1,
      },
      crash: {
        metal: { hz: 5000, ratio: 1.42, amount: 0.68 },
        hp: { hz: 2500, q: 0.75 },
        decayMs: 820, driveDb: 0.5, velTrack: 0.55, rms: 0.092,
      },
      ride: {
        metal: { hz: 6000, ratio: 1.44, amount: 0.52 },
        ping: { hz: 4800, amount: 0.48 },
        hp: { hz: 3000, q: 0.7 },
        decayMs: 560, driveDb: 0.5, velTrack: 0.6, rms: 0.075,
      },
    },
    rom: {
      conga:      { f0mul: 2,    rms: 0.125 },
      bongo:      { f0mul: 3,    rms: 0.108 },
      darbuka:    { f0mul: 2.52, rms: 0.115 },
      rim:        { f0mul: 4.5,  rms: 0.084 },
      shaker:     { f0mul: 1,    rms: 0.066 },
      tambourine: { f0mul: 1,    rms: 0.072 },
      triangle:   { f0mul: 1,    rms: 0.06 },
      cowbell:    { f0mul: 12,   rms: 0.095 },
      clave:      { f0mul: 24,   rms: 0.085 },
      agogo:      { f0mul: 8,    rms: 0.08 },
      timbale:    { f0mul: 5.04, rms: 0.086 },
      revcym:     { f0mul: 1,    rms: 0.084 },
    },
  },
});

/* ── Manifest-level exports ────────────────────────────────────────────── */

export const KIT_IDS = Object.freeze([
  'psy-classic', 'dark-forest', 'progressive', 'hi-tech', 'forest-organic', 'tribal-raw',
]);

export const DEFAULT_KIT = 'psy-classic';

/* Every data/styles.json style name covered — the composer's kit selector. */
/* v0.26.0 (roast fix #4): ALL NINE shipped composer styles are kit-governed.
   Before this map, psytrance/goa/techno/trance silently fell through to
   DEFAULT_KIT — a quarter of the genre surface with no kit decision behind it.
   Mapping law: the five NATIVE styles ride the kit that declares them; the
   classic-family styles (psytrance/goa/trance — 138-142 BPM, the psy-classic
   key center and character) ride 'psy-classic'; TECHNO (132 BPM, mechanical
   groove) rides 'progressive' — its closest tempo/groove family. No new kit
   sound design was commissioned in v0.26.0 (documented in the roast). */
export const STYLE_KIT = Object.freeze({
  'full-on': 'psy-classic',
  'darkpsy': 'dark-forest',
  'progressive': 'progressive',
  'forest': 'forest-organic',
  'hi-tech': 'hi-tech',
  'psytrance': 'psy-classic',
  'goa': 'psy-classic',
  'techno': 'progressive',
  'trance': 'psy-classic',
});

/* v0.26.0 — canonical style→kit lookup (roast fix #4, live specimen #2).
   The map keys on the composer's lowercase labels ('dark-psy'); the kit
   declarations and data/styles.json say 'darkpsy'. The raw toLowerCase()
   lookups missed DARK-PSY FOREVER and silently served DEFAULT_KIT — the
   roast's finding #4 was actually five unmapped styles, not four. One
   canonical accessor now: exact lowercase first, then hyphen-stripped. */
const STYLE_KIT_NORM = Object.freeze(
  Object.fromEntries(Object.entries(STYLE_KIT).map(([k, v]) => [k.toLowerCase().replace(/-/g, ''), v]))
);
export function styleKit(styleId) {
  if (!styleId) return DEFAULT_KIT;
  const k = String(styleId).toLowerCase();
  return STYLE_KIT[k] || STYLE_KIT_NORM[k.replace(/-/g, '')] || DEFAULT_KIT;
}

/* The warm loop slices: engine core first (kick,snare,clap,hatC,hatO,tom,
   crash — note hatC BEFORE hatO), then ride, then the ROM family in order.
   8 engine roles + 12 ROM roles = 20. */
const WARM_ORDER = Object.freeze([
  'kick', 'snare', 'clap', 'hatC', 'hatO', 'tom', 'crash', 'ride',
  'conga', 'bongo', 'darbuka', 'rim', 'shaker', 'tambourine',
  'triangle', 'cowbell', 'clave', 'agogo', 'timbale', 'revcym',
]);

/* ── Accessors (null-safe: a bad id or role NEVER throws) ──────────────── */

/* kitPatch — the reason-engine patch for one role of one kit.
   Roles outside ENGINE_ROLES (rom types, unknown names) → null. */
export function kitPatch(kitId, role) {
  const kit = REASON_KITS[kitId];
  if (!kit || ENGINE_ROLES.indexOf(role) === -1) return null;
  const patch = kit.engine[role];
  return patch || null;
}

/* ── v0.29.0 KICK DIMS — the preset→patch bridge (psyreason re-review #2) ──
   psyreason dceec3e/719211c made its kicks expressively distinct by treating
   PUNCH/BODY/SUBK/SAT as four independent synthesis dimensions instead of
   one fixed recipe. psy5's runtime kick is the kit-governed REASON render,
   whose rich patch was per-KIT data with no preset-level authoring — every
   kick preset in a kit rendered the SAME patch (only tune/decay/amp moved).
   This bridge lifts the three missing dimensions into the patch:

     body 0..1 — depth of the pitch drop  (endHz down, pitch sweep longer)
     subk  0..1 — sub-tail length         (bodyDecayMs up = longer sub)
     sat   0..1 — saturation drive        (driveDb ± around the kit value)
     punch (already a preset param) — transient shape (amount up, ratio down)

   NEUTRAL-CENTERED LAW: every factor is 1.0 (or ±0 dB) when the dimension
   reads 0.5, so {body:.5,subk:.5,sat:.5} reproduces the EXACT kit patch —
   pinned by kick-dims-v029.test.ts. The patch is deep-frozen data: a
   cloned, mutated copy is returned; the kit object is never touched.
   `patch.rms` is deliberately UNTOUCHED — renderReasonPcm RMS-normalizes
   to it, so the kit's level governance (G52 ±15%) holds under any dims. */
const cl01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export function applyKickDims(patch, dims) {
  if (!patch || !dims) return patch;
  const d = dims || {};
  const has =
    d.body != null || d.subk != null || d.sat != null ||
    d.punch != null;
  if (!has) return patch;
  const body = cl01(d.body != null ? d.body : 0.5);
  const subk = cl01(d.subk != null ? d.subk : 0.5);
  const sat = cl01(d.sat != null ? d.sat : 0.5);
  const punch = cl01(d.punch != null ? d.punch : 0.5);
  const out = {
    ...patch,
    body: patch.body ? { ...patch.body } : patch.body,
    punch: patch.punch ? { ...patch.punch } : patch.punch,
    click: patch.click ? { ...patch.click } : patch.click,
    filter: patch.filter ? { ...patch.filter } : patch.filter,
  };
  if (out.body) {
    /* EXACT-NEUTRAL FORM: every factor is written as 1 + k·(x−0.5) so the
       neutral point computes to precisely 1.0 in float64 (a `0.75+0.5·x`
       layout evaluates to 1 ulp off at x=.5 and would break bit-neutrality
       — pinned by kick-dims-v029.test.ts). body .5 → ×1.0; .85 → deep. */
    if (out.body.endHz != null) out.body.endHz = Math.max(18, out.body.endHz * (1 - 0.28 * (body - 0.5)));
    if (out.body.pitchDecayMs != null) out.body.pitchDecayMs = Math.max(10, out.body.pitchDecayMs * (1 + 0.5 * (body - 0.5)));
    /* subk .5 → ×1.0 tail (neutral); .85 → 14% longer sub tail */
    if (out.body.bodyDecayMs != null) out.body.bodyDecayMs = Math.max(40, out.body.bodyDecayMs * (1 + 0.4 * (subk - 0.5)));
  }
  if (out.punch) {
    /* punch .5 → ×1.0 (neutral); higher punch = fatter transient, lower ratio */
    if (out.punch.amount != null) out.punch.amount = Math.min(1, Math.max(0, out.punch.amount * (1 + 0.6 * (punch - 0.5))));
    if (out.punch.ratio != null) out.punch.ratio = Math.max(1.05, out.punch.ratio * (1 - 0.36 * (punch - 0.5)));
  }
  /* sat .5 → ±0 dB (exact: +5.5·0); ±2.75 dB around the kit drive at the extremes */
  if (patch.driveDb != null) out.driveDb = Math.max(0, patch.driveDb + 5.5 * (sat - 0.5));
  return out;
}

/* kitRomSpec — the kit-governed {f0mul, rms} for one ROM type of one kit.
   Fresh object (the caller may mutate its copy); never the live spec. */
export function kitRomSpec(kitId, type) {
  const kit = REASON_KITS[kitId];
  if (!kit || KIT_ROM_ROLES.indexOf(type) === -1) return null;
  const spec = kit.rom[type];
  return spec ? { f0mul: spec.f0mul, rms: spec.rms } : null;
}

/* kitRootHz — the kit's key-center fundamental (0 for an unknown kit). */
export function kitRootHz(kitId) {
  const kit = REASON_KITS[kitId];
  return kit ? kit.rootHz : 0;
}

/* kitChoke — the choke configuration (hat exclusive pair + cymbal poly). */
export function kitChoke(kitId) {
  const kit = REASON_KITS[kitId];
  return kit ? kit.choke : null;
}

/* kitMeta — {id, name, style, blurb} for kit pickers and toasts. */
export function kitMeta(kitId) {
  const kit = REASON_KITS[kitId];
  if (!kit) return null;
  return { id: kit.id, name: kit.name, style: kit.style, blurb: kit.blurb };
}

/* Type-vocabulary predicates — the same split the Phase-2 wiring uses to
   route a psy5 drum type to a reason engine vs the kit-governed ROM path. */
export function isReasonEngineType(t) {
  return ENGINE_ROLES.indexOf(t) !== -1;
}

export function isKitRomType(t) {
  return KIT_ROM_ROLES.indexOf(t) !== -1;
}

/* kitWarmTypes — the pre-warm order for one kit (the warm loop slices).
   Engine core first, then ride, then the ROM family; 20 types total.
   Unknown kit → [] (never throws). */
export function kitWarmTypes(kitId) {
  if (!REASON_KITS[kitId]) return [];
  return WARM_ORDER.slice();
}

/* ── Internals ─────────────────────────────────────────────────────────── */

/* deepFreeze — make the library immutable all the way down (a frozen
   contract: consumers read patches, Phase-2 wiring derives its own mutable
   runtime state from copies). */
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}
