# CHANGELOG — PSY6

All notable changes to the PSY6 device repository. Every claim below is
reproducible with the command shown next to it.

## [0.8.0] — Run 11: SCENE STATE + MASTER + STEMS

### Added — scene mixer snapshots (`feat: scene mixer snapshots (arrangement-aware mix)`)

- `scene.mix = null | { tracks: { [trackIdx]: { vol, pan, sendA, sendB,
  scAmount } }, master?: {…9 master params}, note?: string }` — absent/null =
  legacy scene, zero behavior change. Payloads are validated + clamped into a
  CANONICAL form (ascending track keys, registry field order) on every write
  and on load, so load→save byte-stability holds regardless of how a save was
  produced. Persisted in save/export/share/RESUME.
- **One application primitive** (`applySceneMix`, js/scenes.js) on every
  launch path: instant launch (state.js), the quantized scheduler
  pending-launch branch (PLAY SONG, chain, follow actions, manual quantized)
  and the offline renderSong section launch — each gliding via the existing
  `syncMix(p, when)` anchor. Documented precedence: snapshot applies AT the
  launch, then per-step automation lanes evaluate on top (the continuous
  automation wins per-step).
- The composer populates every scene's snapshot from the section energy
  curve (pure function of section id + energy + variant index — no rng):
  INTRO low melodic level + light space, BUILD rising with bass duck 40,
  DROP/DROP2 full + dry + **bass duck 55**, BREAK spatial (sendA/sendB up,
  ducking off), RISER swell (pad/fx up, no ducking), OUTRO fall. Variant
  scenes lean pan ±0.12 so arranger repeats move in stereo. **The KICK level
  never appears in a composer snapshot** (kick is sacred — level too).
- Composer determinism re-proven: same seed → byte-identical project
  INCLUDING snapshots (`bun test tests/mixsnap.test.ts`).
- Fingerprint deltas (documented): form-fp **UNCHANGED**
  (`d0c5f32f032f2a88` — patterns untouched by the snapshot pass); the
  9 legacy-style whole-project hashes re-pinned to the v0.8.0 values
  (FULL-ON `338e9537…/1d9c77e2…/3db876a1…`, DARK-PSY `038f8e5b…/62902511…/
  766a8576…`, PROGRESSIVE `d8c7d9ac…/c73d8755…/d6bb48ee…` for 3/5/8 min —
  the only delta is the added mix payloads; run `bun test tests/composer.test.ts`).
- Share cap raised 51200 → **65536** bytes: a snapshot-bearing composed song
  compresses to 38,726 B → **51,636** base64url chars, crossing the old 50 KB
  cap by 0.8% — a share of the device's own composed output is a first-class
  flow (js/share.js comment documents the arithmetic).
- UI: scene bank rows gain **MIX→SCENE** (writes the current mixer state into
  the scene; mute/solo deliberately not captured), **×MIX** (clear), and a MIX
  badge on scenes carrying a snapshot; toast confirmations.
- **G28 (offline, CI-asserted)**: scripted bass-only 2-section song — snapshot
  bass-vol 0.5 vs live 0.8 → per-section RMS ratio **2.529** in the mandated
  [2.0, 2.6] (theory (0.8/0.5)²=2.56; the setTargetAtTime glide damps the
  first ms — logged); null-mix control ratio **1.0038**; schedule hash
  identical (the layer is opt-in). Repro: `bun tools/e2e.mjs`.

### Added — master EQ3 + glue compressor (`feat: master EQ and glue compressor (automation-ready)`)

- Chain: `master → EQ3 → [glueComp → makeup gain] → existing master comp →
  analyser`. EQ3: low shelf 100 Hz, mid peak 1 kHz (Q 0.8), high shelf 8 kHz,
  each ±12 dB. Glue: threshold −40..0 dB, ratio 1..20, attack 1..100 ms,
  release 20..1000 ms, makeup 0..24 dB, `compOn` 0/1 — **bypass REMOVES the
  node from the chain** (guaranteed neutral).
- 9 params registered in js/params.js (`eqLow eqMid eqHigh compOn compThresh
  compRatio compAttack compRelease compMakeup`, project target): automatable
  (lane.track −1), ARM-AUTO-recordable, MIDI-learnable (`master.<param>` CC
  0–1 → full range via `paramDenorm`), and scene-snapshot-able
  (`scene.mix.master`). `ensureMaster` backfills legacy projects with neutral
  defaults + clamps (loadProjectObj — the canonical-order pitfall respected).
  MASTER panel in the Mixer tab (GLUE toggle + 8 controls, tooltips).
  Worklet limitation documented (worklet master has its own
  saturation/limiter).
- **G29 (offline, CI-asserted)**: (a) neutral tolerance — default engine vs
  `masterFlat` (the exact pre-v0.8.0 topology) max sample diff **1.79e-7 <
  1e-6** on both channels (EQ biquads at 0 dB + glue removed); (b)
  compression evidence on the dense PSYTRANCE loop at −20 dB/4:1/10 ms/
  150 ms/makeup 0 — crest factor 9.25 → **6.59 (2.94 dB ∈ [0.5, 6])**.
  Chrome's DynamicsCompressor applies an IMPLICIT makeup gain (observed
  **+4.25 dB** RMS rise), so the RMS-reduction contract is evaluated
  makeup-invariantly as crest reduction, with the raw RMS delta logged.
  Repro: `bun tools/e2e.mjs`.

### Added — song stems + section bounce (`feat: song stems and section bounce (one renderer)`)

- renderSong is the ONE renderer: `opts.trackFilter` renders one track's stem
  through the same machinery as the loop-bounce stems (non-matching tracks
  never spawn voices — no signal math); `opts.bounds` returns an arranger
  range **as a slice of the full arrangement render** — the section exactly
  as it appears in the song (phase continuity, mix snapshots and FX bleed all
  real). File formula (documented, asserted):
  `frames = ceil(sr·(0.05 + (barsInRange·16 + 32)·60/bpm/4))`.
- **Empirical finding (documented in js/bounce.js)**: skipping events or
  shortening the offline buffer perturbs the WHOLE Chrome offline render at
  the 1e-3 level (each path is individually deterministic; identical event
  set + length = bit-exact). Hence section bounce = full render + slice,
  which makes the music window sample-EXACT vs the full render. Cost equals a
  SONG bounce; the 10-minute guard applies.
- UI: **STEMS checkbox** in the SONG bounce path →
  `psy6-song-stem-<trackName>.wav` for every non-empty track (sequential
  downloads, progress label + toasts); **BOUNCE SECTION** in the timeline
  editor on a contiguous selection (click / shift+click) →
  `psy6-section-<sceneName>-<idx>.wav`. Memory caps (`songStemsGuard`,
  refusal toasts): per-stem ≤ 10 min; Σ stems × duration ≤ **60
  audio-minutes** (> 6 stems on long songs is exactly what this refuses).
- **G30 (offline, CI-asserted)** on the demo song (FULL-ON 3min 424242):
  stem frames == formula (**10,075,254**), kick stem RMS **0.0551** > melodic
  stem RMS **0.0391** (track 4), DROP section frames == formula (**732,137**),
  section music window vs full-render slice **maxDiff 2.98e-7** (G24-class
  float wobble; contract bound 1e-5). Repro: `bun tools/e2e.mjs`.

### Changed — gate inventory + e2e runtime

- Canonical inventory (js/ui/tests.js): **27 device entries = 25 HARD
  (offline/pure, CI-asserted 27/27 including G28/G29/G30) + 2 evidence-only
  realtime (G17, G25)**; WORKLET reduced set 3/3. Gaps G3/G4/G7/G20 remain
  documented-never-existed; next free id **G31**. e2e default timeout
  300 → 600 s (three new heavy offline gates).
- Battery at release: `bun test` → **300/300 across 26 files (303,842
  expect() calls)**; `node tools/verify.mjs` GREEN.

### Evidence (reproducible)

```
bun test                          # 300/300 (26 files) — incl. mixsnap/master/stems-song suites
node tools/verify.mjs             # GREEN (sw.js CACHE_VERSION == CHANGELOG lock at psy6-v0.8.0)
bun tools/e2e.mjs                 # headless Chrome: 27/27 asserted gates + G17/G25 evidence
bun -e "import('./js/composer.js').then(async m=>{const c=m.compose('FULL-ON',3,424242);console.log(c.stats)})"
                                  # {145 BPM, 17 scenes, 9 tracks, variants 10, snapshots 17,
                                  #  minVariantDiff 0.338} — form-fp unchanged d0c5f32f032f2a88
```

## [0.7.0] — Run 10: EVOLUTION + INTEROP

### Added — composer section variants, no identical repeats (`feat: composer section variants (no identical repeats)`)

- Every section family used more than once in the arranger now derives n−1
  variant scenes (naming `base+" 2"`, `" 3"`, …), so **no arranger repeat is
  ever identical**. Variants are the base pattern mutated by deterministic
  seeded ops (hat density/offset swap, bass octave shifts on off-phrase
  steps + velocity re-jitter, lead motif re-processed through the foundation
  `MotifTransformer`, perc repositioning, pad voicing swap) plus a per-variant
  lane delta on family-dedicated `(track,param)` pairs via the param registry
  (values open progressively across variants).
- **KICK IS SACRED**: variant kicks keep exact positions/note/micro/prob —
  velocity accents only, `|Δvel| ≤ 0.1` (`KICK_VEL_MAX_DELTA`, asserted).
- Difference metric (documented constant `VARIANT_DIFF_MIN = 0.15`):
  `variantStepDiff = |D|/|U|` over the union of on-steps, content-aware
  (note / vel>0.02 / micro>2). EVERY pair within a family incl. the base must
  reach it. Empirical FULL-ON/3min/424242 family minimums: INTRO .933,
  BUILD .849, DROP .591, BREAK .836, RISER .840, DROP2 .338, OUTRO .886 —
  all 9 style×length combos ≥ 0.306. Repro:
  `bun test tests/composer.test.ts`.
- Form unchanged: 108-bar form / 17-step / 136-bar arranger for the 3-min
  demo; base patterns untouched (form fingerprint **pinned** to the v0.6.0
  value `d0c5f32f032f2a88`). Fingerprint delta vs the Run 9 Phase-0 record:
  the FORM hash is byte-stable; the project content delta is 7→17 scenes,
  3→11 lanes, 10 variant patterns. Same seed → byte-identical project
  INCLUDING variants. Uniqueness extended project-wide (all patterns).
- **G23 extended (not forked)**: evidence now reports `variants=10
  vmin=0.338 norepeat=true`.
- G24 Chrome-float determinism bound documented at `1e-5` (empirical
  4.17e-7…1.13e-6; the schedule `evHash` equality remains the exact layer).

### Added — FOREST and HI-TECH composer styles (`feat: forest and hitech composer styles`)

- Both are full recipes in `COMPOSER_STYLES` (nothing hand-rolled outside
  the dict): per-style section chain + energy arcs, preset map, and a
  `recipe` sub-dict (hatGhostMul / bassGrammar / percMul / percOdd /
  energyVar / riserEvery / variant op weights).
- FOREST ~150 BPM, harmonicMinor (darker scale bias): longer builds
  (w .15) + more BREAK weight (.145), denser hats (1.6), rolling forest
  bass grammar, ops {hatRot .55, bassOct .65}. 3min/424242 → 16 scenes,
  Σ=128 bars, 179.2 s (−0.44 %).
- HI-TECH ~155 BPM, phrygian: faster turnover (INTRO .09/BUILD .11),
  percMul 1.8 + odd-16th glitch layer, energyVar 0.10 (seeded per-section
  jitter), aggressive riser (one sweep per bar), ops {.5, .55}.
  3min/424242 → 17 scenes, Σ=136 bars, 179.61 s (−0.22 %).
- Legacy styles byte-identical: 9 project hashes (3 legacy styles ×
  3/5/8 min) pinned in tests. All five styles render non-silent through the
  G23 evidence loop (min section RMS 0.064). UI: 5 styles in both pickers +
  third demo (`#bDemoForest`, FOREST 3min, same deterministic recipe path).

### Added — standard MIDI file export (`feat: standard MIDI file export`)

- `js/midifile.js`: pure, dependency-free **format-1** writer — track 0 =
  tempo meta + track name; one chunk per track; VLQ deltas (multi-byte cases
  unit-tested); stable ordering (tick ↑, off-before-on, pitch).
- Shared song expansion — **no parallel logic**: `songMidi(p)` (bounce.js)
  walks the SAME `songSteps` generator + `stepEvents` the offline WAV
  renderer walks. Mapping: 1 step = 120 ticks (ppq 480), bar = 4·480,
  total = Σbars·4·480 = 261,120 for the demo. Channels: melodic → 1–8,
  drums → 10 (GM). `durTicks` = 1 step (trigger map; the WAV stays the
  authoritative sound).
- `.mid == WAV schedule` contract asserted note-for-note in bun (4,385
  notes) **and** by **G26** (HARD, offline, CI-eligible): in-gate parse-back
  of the demo export — `bytes=36695 fmt=1 ppq=480 trks=10 tempo=145
  firstKick=0 notes=4385 total=261120 det=true`. e2e asserts 24 gates.
- UI: EXPORT MIDI in the bounce modal (disabled + hint when the arranger is
  empty) → `psy6-song-<bpm>bpm.mid`.

### Added — seeded follow actions, chain mode (`feat: seeded follow actions (chain mode)`)

- `scene.follow = {mode:'none'|'next'|'prev'|'random'|'scene', target?,
  prob 0–100 (default 100), afterBars?}` — edited in the scene bank row.
- **PRECEDENCE (documented)**: PLAY SONG strictly follows the arranger;
  follow actions apply ONLY in chain mode, through the same quantized
  `I.pending` launch path. `prob<100` miss → documented `'next'` fallback.
  Random pick seeded: `mulberry32(fnv(projectSeed + ':' +
  transitionCounter))` — replayable per transport session. `afterBars`
  overrides the section length (`afterBars > scene.bars > pattern loop`).
- **G27** (HARD, offline simulation, CI-asserted): scripted chain walks the
  PINNED 20-transition random sequence
  `[2,2,11,11,9,9,4,13,8,16,11,9,1,15,8,1,8,6,0,13,0]`, replay-identical;
  next/prev wrap exact; scene lock; prob=0 fallback. e2e asserts 24 gates.
- `loadProjectObj` backfills follow canonically (absent/invalid → absent;
  legacy load→save byte-stability holds).

### Release — v0.7.0 (`docs: v0.7.0`)

- Battery: **271 tests across 23 files — 271 pass / 0 fail (302,947
  expect() calls)**; `node tools/verify.mjs` GREEN.
- Gates: **24 HARD MAIN (CI-asserted, incl. G26 MIDI + G27 follow) + 2
  evidence-only realtime (G17, G25)** = 26 device entries; WORKLET 3/3.
- PWA: `sw.js` `CACHE_VERSION = 'psy6-v0.7.0'` (verify.mjs enforces the
  version↔CHANGELOG lock).

## [0.6.0] — Run 9: SONG ENGINE

### Added — full-song offline render (`feat: full-song offline render (song bounce)`)

- Bounce modal gains MODE `SONG` (enabled only when the arranger has
  sections): renders the WHOLE `[scene,bars]` arrangement through the live
  machinery — `stepEvents` (per-bar seeded groove), the live scene-launch
  phase rule (`sc.step = sc.step % newLoop`), per-scene auto-FILL, and the
  per-step automation player (`applyLanes` → `syncMix`/`resolveMacros`) —
  no parallel renderer. `js/bounce.js`: `songSteps` generator (single source
  of phase truth), `songSchedule` pure oracle, `songSections`, `songFrames`,
  `songDurationSec`, `songRenderController`, `renderSong`.
- Frame formula (documented + asserted): `ceil(sr·(0.05+(Σbars·16+32)·(60/bpm/4)))`
  — 0.05 s lead-in (loop-bounce convention) + music + 2-bar FX tail.
- Progress bar (section name + percent, via OfflineAudioContext suspend at
  section boundaries) + CANCEL (clean abort, live AudioContext untouched).
- 10-minute render cap (memory guard — toast refusal beyond).
- Output: `psy6-song-<bpm>bpm.wav`.

### Added — arranger timeline editor + PLAY SONG (`feat: arranger timeline editor + play song`)

- Perform-tab timeline: blocks width ∝ bars, scene colors, click-select;
  bars ±, reorder ◀▶ (no drag-drop — consistent with the scene bank),
  insert-from-scene, DELETE; total readout sections/bars/mm:ss.
- `arrMoveStep` / `arrInsertStep` / `arrSongInfo` (reuses song-render
  grouping) in `js/arranger.js`; ▶ PLAY SONG button (chain restart at
  section 0, quantized when playing, boots transport when stopped).
- Edits persist via project JSON (save/export/share round-trip tested).

### Added — record live song playback (`feat: record live song playback`)

- RECORD SONG (transport row): arms the existing capture tap, starts with
  PLAY SONG at section 0, auto-stops at the end of the final section +1 bar,
  encodes with the existing WAV encoder → `psy6-song-live-<bpm>bpm.wav`.
- **G25** (realtime, evidence-only): 4-bar two-section song → `dur=9.381s`
  vs `want=9.375s` (**skew 6 ms**), `rms=0.0818`, header valid.
- **Real bug found and fixed by G25** (the non-vacuous-gate rule paying off
  again): a second capture in one page session included the first capture's
  audio — `CaptureTap.start()` now resets accumulated chunks/frames
  (js/capture.js) and a completed capture retires its tap (js/ui/capture.js).
  Repro: CAPTURE 1 bar → RECORD SONG → first capture's frames leaked into
  the song file (494592 = 82944 + 411648).

### Changed — gate-truth hygiene (`docs: gate inventory truth + song engine docs`)

- Canonical gate inventory documented above `runSelfGate()`: **24 MAIN
  entries = 22 hard (offline/pure, CI-asserted) + 2 evidence-only realtime
  (G17, G25)**; WORKLET reduced set 3/3. Numbering gaps G3/G4/G7/G20 never
  existed in any commit (verified `git log -S` over all history) — left
  unrenumbered because all historical evidence cites the shipped ids.
- CI subset (`tools/e2e.mjs`): asserts all 22 hard gates (G24 joins; G17/G25
  explicitly excluded as realtime).

### Added — PWA (`feat: pwa manifest + service worker (network-first, versioned)`)

- `manifest.webmanifest` (standalone, device colors) + icons 192/512 generated
  by `tools/gen-icons.mjs` (zero-dep PNG encoder, seeded `mulberry32(0x9056)`
  sequencer motif — deterministic pixels, committed).
- `sw.js`: **network-first** for same-origin GETs (cache = offline fallback
  ONLY; every successful response refreshes the cached copy), `activate`
  purges old caches, skipWaiting + clients.claim. Cache version const
  `psy6-v0.6.0` is asserted against the latest CHANGELOG heading by BOTH
  `tools/verify.mjs` (release gate) and `tests/pwa.test.ts` — a release that
  forgets the bump fails verification. Rollback rule documented in
  ARCHITECTURE §13: any served-bytes staleness under SW → remove the
  registration, keep the manifest, document honestly.

### Evidence (reproducible)

- `bun test` — **236 pass / 0 fail** across 21 files, 47,241 expect() calls
  (incl. `tests/song.test.ts` 12: phase rules == live-scheduler oracle,
  frame formula pinned to 10,075,254, sections [16,16,24,16,16,32,16]=136
  bars, fills 3 launches × 8 hits, schedule determinism, duration guard,
  cancel contract).
- `node tools/verify.mjs` — GREEN (0 failures).
- **G24** (device, OfflineAudioContext): `N=10075254/10075254 bars=136
  rms=[0.0665,0.098,0.1088,0.0848,0.0867,0.1046,0.0688] sched=true
  det=maxDiff=3.73e-7` — Chrome float nondeterminism between identical
  renders is real; the documented bound (max sample diff < 1e-6) is used and
  the actual max diff is logged, never rounded to a claim of byte-equality.

## [0.5.0] — Run 7: UNLIMIT + COMPOSER

### Added — device limits lifted (`feat: lift device limits (16 tracks, 128 steps, 64 scenes)`)

- `js/limits.js` — single-source ceilings: `MAX_TRACKS 16`, `MAX_STEPS 128`,
  `MAX_SCENES 64`, `PATTERN_LENGTHS {8,16,32,64,128}`, `LOOP_CAP 1024`.
  `DEFAULTS` (8 tracks / 16-step patterns / 8 scenes) are unchanged since
  v0.1.0 — raised limits are CEILINGS reached only by explicit user action.
- `+TRACK` action grows projects to 16 (neutral INIT-SYNTH preset; pattern
  data grows with it). Voice pools did NOT grow — polyphony is absorbed by
  the existing priority voice stealing.
- Sequencer: 128-step grid with zoom + horizontal scroll, O(1) playhead
  toggling (no per-frame sweep), legacy lengths (4/12/24) surfaced in the
  length select instead of silently mis-displaying.
- FIX (pre-existing): lengthening a pattern SHARED step objects across
  repeats — editing step 16 silently edited step 0. Steps are now cloned
  (lock objects included). Regression-tested.
- G21 (offline, CI-asserted): 128-step pattern with events at steps 0/64/127
  — exact order on the deterministic schedule AND audible onsets in the
  render, silent gap, `loopLen=128`; a 12-track project renders 12
  non-silent stems (min peak 0.167).
- Reproduce: `bun test tests/limits.test.ts` · `bun test` → 161/161 at this
  commit · `GATE_EXTRA=G21 bun /home/z/.run6/psy7-p0-local.mjs` →
  `SELF-GATE: 20/20 passed`.

### Added — scene bank (`feat: scene bank (64 scenes, manage UI)`)

- `js/scenes.js` — DOM-free scene operations + the documented scene schema:
  `{name, pattern, color 0-7|null, bars 1-64|null, fill bool}`. Fields are
  backfilled on load with neutral defaults and rebuilt in canonical key
  order so load→save stays byte-stable.
- Scene bank UI: scrollable bank up to 64 scenes, inline rename, duplicate,
  clear, reorder (up/down), color tags, per-scene bars override (pre-fills
  the arranger section length), per-scene auto-FILL toggle (fires the FILL
  op at launch — instant or at the quantized bar boundary), current/queued
  indicators, +SCENE.
- Launch semantics unchanged: click = quantized, alt = instant,
  shift = assign (assign no longer clobbers custom names). Chain advance
  extracted to pure `chainNext` (32+ scene wrap tested).
- Reproduce: `bun test tests/scenes.test.ts` (14 tests) · headless UI flow
  10/10 (driver in worklog).

### Added — automation everywhere (`feat: full-parameter automation lanes + live recording`)

- `js/params.js` — param registry: 23 automatable parameters
  (`{id,label,min,max,def,target,apply}`): synth sound (cutoff/res/atk/dec/
  sus/rel/gate/detune/lfoRate/lfoDepth), mixer (vol/pan/sendA/sendB),
  sidechain (scAmount/attack/hold/release), project (masterVol, 4 macros).
  Every apply clamps; per-kind filtering (drum tracks get no synth params).
- Lane model: `{track, param, pts, mode}` — `mode:'lock'` = legacy per-voice
  lane (exact v0.1.0–v0.4.0 behavior; legacy lanes backfill to it),
  `mode:'state'` = live automation applied EVERY STEP through the registry
  (knob-equivalent writes; scheduler syncs the engine after mix/sc/master
  and re-resolves macros).
- Recording: ARM-AUTO + per-lane arm (multiple simultaneous); knob moves
  (mixer, synth editor, macros) and MIDI CC via the existing midiMap land
  in armed lanes at the quantized playhead (1/16, toggleable off).
- Automation editor: param select, +LANE, ARM-AUTO, Q toggle, clear, lane
  list with live value readout, curve canvas + playhead.
- G22 (CI-asserted): scripted record session writes the EXACT expected
  quantized points (replace on duplicate); offline apply matches laneEval
  within 1e-9; lock lanes never touch track state.
- Reproduce: `bun test tests/params.test.ts` (12 tests).

### Added — song composer (`feat: deterministic song composer (complete unique arrangements)`)

- `js/composer.js` — pure, deterministic, seeded by (seed, style, minutes).
  Section chain INTRO→BUILD→DROP→BREAK→RISER→DROP2→OUTRO with energy arcs
  (foundation `arcAt`); bars scale to the target as multiples of 4 and sum
  EXACTLY to the target (3-min FULL-ON = 108 bars = 178.76 s, −0.69 %).
- 3 style templates: FULL-ON 145 / DARK-PSY 148 / PROGRESSIVE 138 BPM, per
  style preset maps; 9th FX track carries the riser preset.
- Per-section patterns (≤128-step ceiling; longer sections repeat their
  scene in the arranger). Recipes scale with section energy; fills end
  BUILD/RISER; psy-push groove is COMPOSED INTO bass micro offsets on drops
  (project groove is global); the lead motif is varied per section through
  foundation `MotifTransformer` (transpose/invert/retrograde/omission/
  fragmentation/octaveShift).
- Lane suggestions via the registry: BUILD lead cutoff sweep, RISER pad
  sendA/B rise (`mode:'state'`).
- Uniqueness: 20 seeds → all 190 pairs JSON-unequal AND ≥90 % unique
  melodic fingerprints (same seed = byte-identical, tested).
- UI: power-screen COMPOSE row + header modal (style/length/seed editable,
  overwrite confirm, fresh in-memory project, lands on Perform with the
  arranger active and playing).
- G23 (CI-asserted): fixed seed → 7 sections, length ±5 %, byte-identical
  regenerate, EVERY section bounces non-silent — per-section RMS
  `[0.0613, 0.0984, 0.1113, 0.0878, 0.0906, 0.1076, 0.0587]`.
- Reproduce: `bun test tests/composer.test.ts` (14 tests).

### Added — usability (`feat: usability pass (shortcuts, tooltips, demos, touch targets)`)

- `js/shortcuts.js` — single shortcut registry; the keydown dispatcher AND
  the help overlay render from it; collision finder unit-tested. Audit:
  the only prior global handler was Space/r/z/1-8 in header.js; 1-8 moved
  to pad triggers, track select to Shift+1-8; arrows (scene prev/next),
  f (fill), v (variation), b (bounce), ? (help) are new.
- Native tooltips on header controls; demo songs as composer recipes
  (`data/demos/*.json`, 460 B each — the client recomposes byte-identically;
  loading boots into memory only); touch targets ≥ 40 px on primary
  controls; 390 px width verified with no horizontal page scroll.
- Reproduce: `bun test tests/usability.test.ts` (7 tests).

### Battery at release

- `bun test` → **208/208 across 19 files (29 935 expects)** · `node
  tools/verify.mjs` → GREEN (0 failures) · device Self-Gate **22/22 MAIN**
  (G1-×4, G2, G5, G6, G8, G9, G10, G11, G12, G13, G14, G15, G16, G17, G18,
  G19, G21, G22, G23) + **3/3 WORKLET** · `tools/e2e.mjs` CI subset = 21
  asserted (all MAIN gates except realtime G17). The taskbook anticipated
  "23/23"; the honest count is 22 (19 + G21/G22/G23).
- G17 note: the realtime capture gate passes on idle sessions (skew 6 ms)
  and may exceed its ±50 ms skew under concurrent offline-render load
  (ScriptProcessor buffer-fill artifact) — it remains info-only in CI, as
  documented since v0.4.0.

# CHANGELOG — PSY6

All notable changes to the PSY6 device repository. Every claim below is
reproducible with the command shown next to it.

## [0.7.0] — Run 10: EVOLUTION + INTEROP

### Added — composer section variants, no identical repeats (`feat: composer section variants (no identical repeats)`)

- Every section family used more than once in the arranger now derives n−1
  variant scenes (naming `base+" 2"`, `" 3"`, …), so **no arranger repeat is
  ever identical**. Variants are the base pattern mutated by deterministic
  seeded ops (hat density/offset swap, bass octave shifts on off-phrase
  steps + velocity re-jitter, lead motif re-processed through the foundation
  `MotifTransformer`, perc repositioning, pad voicing swap) plus a per-variant
  lane delta on family-dedicated `(track,param)` pairs via the param registry
  (values open progressively across variants).
- **KICK IS SACRED**: variant kicks keep exact positions/note/micro/prob —
  velocity accents only, `|Δvel| ≤ 0.1` (`KICK_VEL_MAX_DELTA`, asserted).
- Difference metric (documented constant `VARIANT_DIFF_MIN = 0.15`):
  `variantStepDiff = |D|/|U|` over the union of on-steps, content-aware
  (note / vel>0.02 / micro>2). EVERY pair within a family incl. the base must
  reach it. Empirical FULL-ON/3min/424242 family minimums: INTRO .933,
  BUILD .849, DROP .591, BREAK .836, RISER .840, DROP2 .338, OUTRO .886 —
  all 9 style×length combos ≥ 0.306. Repro:
  `bun test tests/composer.test.ts`.
- Form unchanged: 108-bar form / 17-step / 136-bar arranger for the 3-min
  demo; base patterns untouched (form fingerprint **pinned** to the v0.6.0
  value `d0c5f32f032f2a88`). Fingerprint delta vs the Run 9 Phase-0 record:
  the FORM hash is byte-stable; the project content delta is 7→17 scenes,
  3→11 lanes, 10 variant patterns. Same seed → byte-identical project
  INCLUDING variants. Uniqueness extended project-wide (all patterns).
- **G23 extended (not forked)**: evidence now reports `variants=10
  vmin=0.338 norepeat=true`.
- G24 Chrome-float determinism bound documented at `1e-5` (empirical
  4.17e-7…1.13e-6; the schedule `evHash` equality remains the exact layer).

### Added — FOREST and HI-TECH composer styles (`feat: forest and hitech composer styles`)

- Both are full recipes in `COMPOSER_STYLES` (nothing hand-rolled outside
  the dict): per-style section chain + energy arcs, preset map, and a
  `recipe` sub-dict (hatGhostMul / bassGrammar / percMul / percOdd /
  energyVar / riserEvery / variant op weights).
- FOREST ~150 BPM, harmonicMinor (darker scale bias): longer builds
  (w .15) + more BREAK weight (.145), denser hats (1.6), rolling forest
  bass grammar, ops {hatRot .55, bassOct .65}. 3min/424242 → 16 scenes,
  Σ=128 bars, 179.2 s (−0.44 %).
- HI-TECH ~155 BPM, phrygian: faster turnover (INTRO .09/BUILD .11),
  percMul 1.8 + odd-16th glitch layer, energyVar 0.10 (seeded per-section
  jitter), aggressive riser (one sweep per bar), ops {.5, .55}.
  3min/424242 → 17 scenes, Σ=136 bars, 179.61 s (−0.22 %).
- Legacy styles byte-identical: 9 project hashes (3 legacy styles ×
  3/5/8 min) pinned in tests. All five styles render non-silent through the
  G23 evidence loop (min section RMS 0.064). UI: 5 styles in both pickers +
  third demo (`#bDemoForest`, FOREST 3min, same deterministic recipe path).

### Added — standard MIDI file export (`feat: standard MIDI file export`)

- `js/midifile.js`: pure, dependency-free **format-1** writer — track 0 =
  tempo meta + track name; one chunk per track; VLQ deltas (multi-byte cases
  unit-tested); stable ordering (tick ↑, off-before-on, pitch).
- Shared song expansion — **no parallel logic**: `songMidi(p)` (bounce.js)
  walks the SAME `songSteps` generator + `stepEvents` the offline WAV
  renderer walks. Mapping: 1 step = 120 ticks (ppq 480), bar = 4·480,
  total = Σbars·4·480 = 261,120 for the demo. Channels: melodic → 1–8,
  drums → 10 (GM). `durTicks` = 1 step (trigger map; the WAV stays the
  authoritative sound).
- `.mid == WAV schedule` contract asserted note-for-note in bun (4,385
  notes) **and** by **G26** (HARD, offline, CI-eligible): in-gate parse-back
  of the demo export — `bytes=36695 fmt=1 ppq=480 trks=10 tempo=145
  firstKick=0 notes=4385 total=261120 det=true`. e2e asserts 24 gates.
- UI: EXPORT MIDI in the bounce modal (disabled + hint when the arranger is
  empty) → `psy6-song-<bpm>bpm.mid`.

### Added — seeded follow actions, chain mode (`feat: seeded follow actions (chain mode)`)

- `scene.follow = {mode:'none'|'next'|'prev'|'random'|'scene', target?,
  prob 0–100 (default 100), afterBars?}` — edited in the scene bank row.
- **PRECEDENCE (documented)**: PLAY SONG strictly follows the arranger;
  follow actions apply ONLY in chain mode, through the same quantized
  `I.pending` launch path. `prob<100` miss → documented `'next'` fallback.
  Random pick seeded: `mulberry32(fnv(projectSeed + ':' +
  transitionCounter))` — replayable per transport session. `afterBars`
  overrides the section length (`afterBars > scene.bars > pattern loop`).
- **G27** (HARD, offline simulation, CI-asserted): scripted chain walks the
  PINNED 20-transition random sequence
  `[2,2,11,11,9,9,4,13,8,16,11,9,1,15,8,1,8,6,0,13,0]`, replay-identical;
  next/prev wrap exact; scene lock; prob=0 fallback. e2e asserts 24 gates.
- `loadProjectObj` backfills follow canonically (absent/invalid → absent;
  legacy load→save byte-stability holds).

### Release — v0.7.0 (`docs: v0.7.0`)

- Battery: **271 tests across 23 files — 271 pass / 0 fail (302,947
  expect() calls)**; `node tools/verify.mjs` GREEN.
- Gates: **24 HARD MAIN (CI-asserted, incl. G26 MIDI + G27 follow) + 2
  evidence-only realtime (G17, G25)** = 26 device entries; WORKLET 3/3.
- PWA: `sw.js` `CACHE_VERSION = 'psy6-v0.7.0'` (verify.mjs enforces the
  version↔CHANGELOG lock).

## [0.4.0] — Run 6: EVIDENCE + PLAY + CAPTURE + STEMS + SHARE

### Added — CI gate evidence (`ci: run self-gate evidence in CI`)

- `tools/e2e.mjs` — zero-dependency CDP driver (bun/node>=22 native
  WebSocket): ephemeral no-store static server, fresh-profile headless
  Chrome with the autoplay-policy bypass, boots the MAIN engine via real UI
  clicks, presses RUN SELF-GATE, reads `window.__psy6Gates`, emits
  machine-readable `{gate, pass, evidence}` JSON, exits nonzero on failure.
- `.github/workflows/ci-gates.yml` — job `verify` (`node tools/verify.mjs` +
  `bun test`) → job `gates` (headless Chrome e2e). `gates` is **blocking**
  with ONE automatic retry of the driver before going red; no
  `continue-on-error` anywhere. Gate evidence uploaded as a CI artifact.
- Subset honesty: all MAIN-mode gates are pure computation or deterministic
  OfflineAudioContext renders (fixed schedules; inequality/integer criteria —
  never bit-exact audio) → CI has no realtime dependency. The WORKLET
  reduced set (G14w/G15w), the realtime capture gate (G17) and live-loop
  checks stay local-only (G17 runs on-device and is reported in CI as
  non-asserted info). See README "Self-Gate in CI".
- Reproduce: `bun tools/e2e.mjs --out gates-evidence.json` →
  `E2E GATES: GREEN (18/18 asserted)` (G1×4, G2, G5, G6, G8–G16, G18, G19).

### Added — MIDI IN with CC learn (`feat: midi input with cc learn`)

- `js/midi.js` — DOM-free MIDI IN core; Web MIDI access injected via a
  settable provider (tests drive a MockMIDIAccess through the same byte
  path as a real device).
- Note On (0x90, vel>0) → triggers the currently-selected track, velocity =
  vel/127, MIDI note = pitch; Note Off (0x80 or 0x90-vel-0) → releases that
  track's synth voices (new `PooledEngine.killTrack` + voice ownership;
  drum one-shots are never cut mid-hit — documented semantics).
- CC learn: pick one of 57 mappable targets (macros 0–7, master.vol,
  per-track mix.vol/pan/sendA/sendB/mute/scAmount), press LEARN, move a
  control → binding stored in `project.midiMap` (versioned, save/export/
  import round-trip; absent → empty map, backfilled).
- CC 0 ignored (bank select); CC 123 → PANIC. Dispatch resolves paths via
  pure `resolveMidiParam(p, path, v01)`; macros resolve against the PASSED
  project (a real bug the Bun tests caught: `resolveMacros` previously read
  the global project — fixed with an optional target argument).
- UI: Perform-tab MIDI section (device selector, LEARN mode + indicator,
  bound-CC list with clear buttons); graceful "Web MIDI unsupported" note
  on non-Chromium — no crash. **No MIDI clock sync — out of scope.**
- Self-Gate **G16** (pure, scripted MockMIDI session, exact assertions):
  `note=60/vel=100@t4 offs=2 learn=45→track.2.scAmount sc=55 cc0kept=true
  panic=1 rt=true`.
- Tests: `tests/midi.test.ts` (20 tests).

### Added — live capture to WAV (`feat: live capture to wav`)

- Master-output tap: `ScriptProcessorNode` (**deprecated but universally
  supported — chosen deliberately**: zero changes to the MAIN engine graph,
  no worklet module reload). Growable preallocated Float32 chunks
  (262144 frames ≈ 5.9 s): per-callback cost is one `.set()` — no
  per-callback allocation; frame counts tracked in Float64.
- The tap is parallel (analyser → tap → zero-gain sink) — it never inserts
  itself into the live path. CAPTURE button (distinct from sequencer REC):
  ARM → recording starts on the next 16-step bar boundary (scheduler
  `I.barHooks`) → STOP arms a bar-quantized stop → encoded by the EXISTING
  bounce WAV encoder (no duplicate encoder) → downloads
  `psy6-capture-<bpm>bpm.wav`. Panic-safe: capture never touches the
  transport; transport-stop mid-capture finishes immediately (documented).
- Self-Gate **G17** (REALTIME — local-only; CI reports info, never
  asserts): real tap + real scheduler, one bar captured:
  `frames=82944 dur=1.881s bar=1.875s skew=6ms` (tolerance ±50 ms)
  `rms=0.0798 hdr=valid`.
- Tests: `tests/capture.test.ts` (growth accounting, quantization math,
  encoder-reuse WAV round-trip).

### Added — per-track stem export (`feat: per-track stem export`)

- `renderBounce(p, loops, {trackIdx})` renders a stem through the SAME
  deterministic offline graph — only that track's events trigger, so the
  other tracks contribute exactly 0 (no voices spawn). No options →
  full-mix render byte-identical to v0.3.0 (same schedule hash).
- Bounce modal MODE select (MIX | STEMS): STEMS renders N files for
  non-empty tracks only, sequential downloads (350 ms apart — browsers
  throttle rapid clicks), named `psy6-stem-<trackName>.wav`.
- Self-Gate **G18** (offline, CI-asserted). Isolation semantics stated
  honestly: no-voice regions are EXACTLY 0 (the bass stem's silence spans
  the kick's whole timeframe); the residual after a track's own voice is
  its own exponential decay tail — physics, not bleed (bounded ≤ 1e-3):
  `kickRMS=0.0696 bassRMS=0.0675 silentRegions=0/0 kickOwnTail=0.000034
  N=84893 det=true`.
- Tests: `tests/stems.test.ts` (discovery, per-track determinism, full-mix
  hash unchanged).

### Added — share links via URL hash (`feat: share links via url hash`)

- `js/share.js` (DOM-free): project → canonical JSON (key order pinned —
  arrays keep order) → `CompressionStream('deflate-raw')` → base64url →
  `location.hash` (`#p=<token>`). Same project ⇒ byte-identical link.
  No Date.now / Math.random.
- Guards: compressed token > 6 KB → warn (Chrome URL limits); > 50 KB →
  hard error with clear toast. Environments without CompressionStream are
  told to use file EXPORT — never a silently degraded link.
- Consent: `#p=` on boot shows a power-screen banner — LOAD SHARE (explicit
  click; replaces the in-memory project, learner snapshot included) or
  DISMISS. **Never auto-loads.**
- Self-Gate **G19** (pure, CI-asserted): default PSYTRANCE round-trip
  deep-equal, learner (`p.copilot`) survives, byte-identical determinism:
  `json=21944B token=1960B warn=false det=true learner=true`.
- Tests: `tests/share.test.ts`.

### Fixed

- `resolveMacros(target)` — macro resolution now resolves the project it is
  given (Bun tests caught it reading the global project).
- Power-screen engine note: gate count text corrected to the real number.

### Evidence (v0.4.0, local runs)

- `bun test` → **147 pass / 0 fail** across **14 files**, **6886** `expect()`
  calls (~175 ms).
- `node tools/verify.mjs` → **GREEN** (0 failures).
- `bun tools/e2e.mjs` → **E2E GATES: GREEN (18/18 asserted)** + G17 info
  (realtime capture) PASS on-device.
- Device Self-Gate (MAIN): **19/19** (G1×4, G2, G5, G6, G8–G16, G17, G18,
  G19). WORKLET reduced set unchanged: **3/3** (G2 + G14w + G15w).

## [0.3.0] — Run 4: SOUND SIGNATURE + CAPTURE

### Added — kick-triggered sidechain ducking (`feat: kick-triggered sidechain ducking`)

- Per-track `scAmount` 0–100 (**default 0 — zero behavior change**),
  `scAttackMs` 12 / `scHoldMs` 0 / `scReleaseMs` 140; backfilled into projects
  saved before sidechain existed.
- Engine: ONE persistent `duck` GainNode per track bus (input → duck → pan),
  created at init — **no per-hit nodes**. Kick events automate every bus whose
  `scAmount > 0` (never the kick's own bus) using ONLY `setValueAtTime` +
  `linearRampToValueAtTime`: dip to `1 − amount/100` → attack → [hold] →
  linear recovery.
- Overlap-safe: fast 16th-note kick rolls at 145 BPM start each new envelope
  from the exact value of the previous one — value-continuous, click-free,
  always recovers to 1.0. Envelope math lives in
  `foundation/dsp/sidechain.mjs` (pure, deterministic, bun-testable).
- Mixer strips: SC depth slider + attack/hold/release drawer (⋯).
- Self-Gate **G11** (offline render; the duck is isolated as the ducked/plain
  window-RMS ratio, removing the synth's own note envelope from the
  measurement): `dipMin=72% recoveryMin=100% amt0Events=0 amt75Events=8`.
- Tests: `tests/sidechain.test.ts`.

### Added — per-track delay/reverb sends (`feat: per-track delay and reverb sends`)

- DELAY bus: BPM-synced, division `1/8 | 3/16 (default) | 1/4`, feedback
  0–80 % (default 35 %) with a 4.5 kHz lowpass inside the feedback loop.
- REVERB bus: deterministic synthetic stereo IR — seeded decorrelated noise
  (canonical `mulberry32`, one seed per channel), exponential decay over
  ~1.8 s, generated at init. No external files, no `Math.random`; the same
  seeds produce a byte-identical IR on every machine.
- Per-track `mix.sendA` / `mix.sendB` 0–100 (**default 0 — zero behavior
  change**) — post-fader taps; project `fx {delayDiv, delayFb}` + backfill.
- Mixer: DLY/REV per strip + global DIV/FB controls.
- Self-Gate **G12**: `sendRMS=0.0150 reverbRMS=0.0050 zeroRMS=0.0001
  delay@145ms=206.9/310.3/413.8 irIdentical=true`.
- Tests: `tests/sends.test.ts`.

### Added — offline WAV bounce (`feat: offline WAV bounce`)

- BOUNCE button → modal (loops 1/2/4/8, default 2) → offline render through a
  FRESH engine graph (the live engine is never touched) → 16-bit PCM stereo
  44.1 kHz WAV (44-byte RIFF header) → download `psy6-bounce-<bpm>bpm.wav`.
- Same event function as live playback (per-bar seeded `stepEvents`) — the
  schedule is deterministic; two renders of the same project have byte-identical
  schedules. Documented difference vs live: no worker-timer lookahead jitter —
  events land at mathematically exact sample positions.
- Self-Gate **G13**: `samples=148192/148192 rms=0.089 schedIdentical=true`.
- Tests: `tests/bounce.test.ts`.

### Added — optional worklet engine mode (`feat: optional worklet engine mode (experimental, documented)`)

- Power screen engine selector: **MAIN** (pooled — default and reference) |
  **WORKLET** (experimental). MAIN is untouched by default (zero behavior
  change).
- `js/worklet-engine.js`: model→worklet mapping (voice ids, MIDI→Hz, bpm,
  per-bus sends) + **documented limitations** (per-track sends collapse to
  per-BUS max; fixed 0.5 s delay length — no division control; fixed-shape
  bass-bus duck instead of per-track sidechain; worklet world-params drive
  synth voices, not the synth editor; worklet-internal IR). The power screen
  lists the limitations verbatim.
- Transport channels: LIVE — outbox handshake (commands buffer until the
  worklet's first `stats` message proves the processor port is attached;
  Chrome builds processors lazily and pre-attach posts are lost
  nondeterministically) with a 200 ms timer backstop; OFFLINE — commands are
  replayed at construction via `processorOptions.initialMessages` because the
  offline render thread never drains its input message queue.
- Self-Gate is mode-aware: **15/15 in MAIN** (G1–G15), **3/3 reduced set in
  WORKLET** (G2 + G14w + G15w — real checks on worklet stats, not skipped).
  Evidence: G14 `peak=0.785 residualEvents=0` · G15 `tier0Steals=0
  hatSteals=41 kicks=16/16 peak=1.016` · G14w `peak=0.710 residualEvents=0
  kicksVoiced=8/8` · G15w `tier0Victims=0 hatSteals=188 kicksVoiced=16/16
  peak=0.938`.
- `fix: resume suspended AudioContext on power on` — the context is now
  `resume()`d on power-on (autoplay-policy-safe); both engines verified
  producing live audio in a real browser.

### Fixed — the "79.6 dB" aliasing claim was vacuous

- The 2x oversampled master saturation never advanced its input ring cursor
  (`osInIdx`), so the oversampler re-read stale input: the "2x oversampled"
  path processed a heavily-attenuated (near-silent) signal and the earlier
  **79.6 dB reduction** claim was a measurement of near-silence — not of
  alias reduction. The old test asserted `reduction > 10 dB`, which the
  broken path "passed" vacuously.
- Fixed (all three `processSat` copies): the cursor advances.
  **Honest benchmark** (same sweep, same band): native **68.5 dB** →
  oversampled **60.4 dB** → **reduction 8.2 dB**. A non-silent-output guard
  test now prevents a silent-output regression from faking the number again
  (oversampled-path peak must be > 0.5; measured 0.729).

### Verified (this release)

| Check | Command | Result |
| --- | --- | --- |
| Test suite | `bun test` | **102 pass / 0 fail**, 10 files, 6321 expect() calls |
| Repo gates | `node tools/verify.mjs` | **GREEN (0 failures)** |
| Aliasing benchmark | `bun test tests/master-oversampling.test.ts` | 68.5 dB → 60.4 dB (**8.2 dB reduction**, honest) |
| Device Self-Gate, MAIN | Self-Gate tab → RUN SELF-GATE | **15/15 passed** |
| Device Self-Gate, WORKLET | power screen → WORKLET → RUN SELF-GATE | **3/3 passed** (reduced set) |

## [0.2.0] — Run 3: GO LIVE + BRAIN

### Added

- **GitHub Pages deployment, zero secrets** (`ci: add GitHub Pages deployment`)
  — `.github/workflows/deploy-gh-pages.yml` deploys the repo root on every
  push to `main`. Live URL: https://dudududi144-source.github.io/psy5/
  (device at `/`, playground at `/playground/`). Asset-reference audit: all
  ES-module imports, worklet `addModule` URLs and links are relative paths
  (verified over HTTP: both pages boot, Self-Gate passes from the live URL).
- **CO-PILOT** (`feat: co-pilot learner wired to device`) — consent-driven
  contextual bandit connecting `foundation/learning` to the device:
  - `foundation/learning/bandit.mjs`: dependency-free port of the learning
    package semantics (epsilon-greedy + cold-start + abstention; DO_NOTHING
    always legal; injected seeded RNG; full JSON round-trip).
  - Decision loop every 4 bars while playing (scheduler bar hooks); context =
    energy, scene, active layers, density, bars-since-variation, macros,
    gesture counts; candidates mapped onto existing device paths (FILL,
    VARIATION, groove toggle, layer toggle, scene nudge, DO_NOTHING).
  - Rewards: explicit 👍/👎 (+1/−1); implicit +0.5 (user FILL/VAR/scene within
    2 bars of APPLY); −0.5 (PANIC/UNDO or dismiss within 2 bars); 0 (window
    closed with no signal). Suggestions NEVER auto-apply — APPLY/DISMISS in
    the Perform-tab panel, LEARN toggle is fully inert when OFF.
  - Learner state persisted inside the project (`p.copilot` v1); absent on
    import → fresh learner. Exploration seeded from projectSeed+decision
    counter — same seed+history reproduces the same suggestions.
- **Section arranger** (`feat: section arranger`) — project-level
  [scene, bars] chain with bar-quantized auto-advance reusing the existing
  scene-launch transition, upcoming-section indicator in the Perform tab,
  manual override stops auto-advance; stored in save/export.
- Self-Gate **G10** (device now 10/10): scripted 50-decision session —
  `fillAvg=1.00(n=45) > varAvg=0.00(n=2)`, probe exploits fill, abstention
  fires under all-low rewards.
- Bun suite: **74 tests across 7 files — 74 pass / 0 fail** (18 co-pilot +
  7 arranger tests added; 49 pre-existing all green).

### Verified

- `bun test` 74/74 · `node tools/verify.mjs` GREEN · device Self-Gate 10/10
  (G9 evidence unchanged: `kicks=16/16 hats=64/64 tier0Steals=0`).
- Device boots from https://dudududi144-source.github.io/psy5/ and passes the
  Self-Gate from the live URL in a headless browser.

## [1.0.0] — PSY6 stabilization, engine and groove release

### Fixed — deploy pipeline (`fix: repair failing deploy pipeline`)

`playground/index.html` was structurally corrupted: a stray `<` plus an
orphaned JS fragment and a mangled `!DOCTYPE` line before `<html>`, orphaned
HTML panels before `<head>`, and feature blocks (RECORDER / COLLAB / AI /
CLOUD / MIDILEARN) machine-spliced inside unrelated function bodies with a
recurring `});` vs `}` brace bug that made the main script unparseable
(`node --check` failed: `SyntaxError: Unexpected token ')'`).

- Feature objects hoisted to top level; host functions (`makeTimerWorker`,
  fbForm submit handler, `bumpStat`) restored to their original bodies;
  broken keyboard handlers fixed; spliced auto-calls removed (including
  `RECORDER.start()` prompting for microphone access on page load).
- Orphaned panels moved into `<main><div class="grid">`; the WORKLETS
  fragment moved into a proper `<script>` after the main script.
- `tools/verify.mjs` added: standalone-JS, ES-module, inline-script and
  document-structure gates (zero dependencies).
- CI (`.github/workflows/pages-deployment.yaml`): a `verify` job now runs
  `node tools/verify.mjs` and gates the deploy job. The deploy job itself is
  unchanged and still requires the repository secrets
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` — **note:** those
  secrets are an ops prerequisite that cannot be created from code; the
  deploy leg cannot be exercised from a local clone.

Verify locally: `node tools/verify.mjs` → `VERIFY: GREEN (0 failures)`.

### Changed — device identity (`refactor: unify device identity to PSY6`)

- `worklets/psy4-engine.js` → `worklets/psy-engine.js`
  (processor `psy4-engine` → `psy-engine`, class `Psy4EngineProcessor` →
  `PsyEngineProcessor`); `worklets/psy4-dsp.js` → `worklets/psy-dsp.js`.
- Playground `addModule` URLs updated; device-identity comments now say
  PSY6; historical PSY3/PSY4/PSY5 attributions kept and labeled as history.
- README rewritten for PSY6-on-psy-foundation; FOUNDATION_STATUS.md and
  FOUNDATION_FREEZE.md carry device-lineage preambles.

### Changed — modular device (`refactor: split index.html into ES modules`)

The 62 KB `index.html` monolith (CSS + markup + model + scheduler + engine +
UI + self-gate in one file) is split into native ES modules with zero
behavior change (code text byte-identical per module; only import/export
declarations added):

```
js/model.js      constants, scales, mk* factories, PRNG, hash, stepEvents
js/presets.js    factory library, assignPresetToTrack, buildStyle
js/engine.js     PooledEngine + SynthVoice + DrumVoice
js/state.js      shared state I, history, macros, PERF, save/load, $, toast
js/scheduler.js  worker timer + lookahead loop
js/ui/header.js  js/ui/perform.js  js/ui/seq.js  js/ui/sound.js
js/ui/mix.js     js/ui/tests.js    — one module per tab
js/main.js       renderAll / renderLoop / meter / powerOn / boot
css/app.css      extracted styles
```

`index.html` is now 63 lines: markup plus
`<script type="module" src="js/main.js"></script>`. All modules are well
under the 500-line limit (largest: `js/presets.js`, 169 lines).

Verified: device boots, scheduler advances, sequencer/preset/mixer
interactions work, Self-Gate passes — in a headless browser.

### Added — priority voice stealing (`feat: priority voice stealing in pooled engine`)

Tiers: `0` = kick/bass · `1` = hats/snare/clap/perc · `2` = lead/arp/pluck ·
`3` = pad/fx/texture.

- **Worklet engine** (`worklets/psy-engine.js`): when a pool is exhausted,
  the oldest ACTIVE voice of the lowest-priority non-empty tier above tier 0
  (scan 3 → 2 → 1) is stolen; within a tier the oldest active voice loses.
  Tier-0 voices are never stolen — a new tier-0 note retriggers its
  dedicated voice. Oldest-active tracking via monotonic trigger sequence;
  victim scans are numeric compares over preallocated pools — the
  `process()` hot path stays allocation-free.
  *(Interpretation note:* “steal from the lowest non-empty tier above tier 0”
  is implemented as lowest **priority** — pads/fx are sacrificed before hats
  — the only reading consistent with the tier priorities; ambiguity resolved
  in favor of musical behavior.*)*
- Pool sizes and per-voice tier assignment are init-time parameters
  (`AudioWorkletNode` `processorOptions: { poolSizes, tiers }`, defaults =
  the historical sizes) and re-tunable at runtime via a `config` port
  message; per-tier steal counters ship in the stats payload.
- **Device pooled engine** (`js/engine.js`): same tier policy; pool sizes
  are constructor parameters (defaults 20 synth / 24 drum); per-track
  dedicated tier-0 voices; `tier0StealAttempts` guard counter.
- **Self-Gate G9** (device): 64 consecutive open-hat 16ths + kick on every
  4th step, rendered offline with a 3-voice drum pool (deliberate overload).
  Latest run evidence: `kicks=16/16 hats=64/64 tier0Steals=0
  steals(h1/h2/h3)=70/0/2 peak=0.752` → PASS. Full gate: **9/9 passed**.
- Tests: `tests/voice-stealing.test.ts` — 11 pass / 0 fail (loads the real
  worklet source in a stubbed AudioWorklet environment).

### Added — deterministic per-bar seeding, full-range micro, grooves (`feat: deterministic per-bar seeding, full-range micro timing, groove templates`)

- `stepEvents()` draws all probabilistic decisions from a per-bar seeded
  RNG: `seed = fnv1a(projectSeed + ":" + barIndex)` (first 32 bits). Bar
  index derives from the step position modulo the pattern loop — the same
  bar produces the identical event list on every loop pass.
- Project seed exposed in the header, stored in the project, included in
  save/export/import; older projects backfill `seed='PSY6'`.
- Micro timing is now full-range: `micro[-100..100] → [-0.5..+0.5]` of a
  16th step (the previous 0.45 cap is gone); negative offsets (ahead of
  grid) are honored end-to-end. Step editor hint updated.
- Groove templates — named per-step offset transforms applied
  deterministically **before** the probability gate, all randomness from
  the per-bar RNG: `straight` (default — existing feel preserved),
  `mpc54` (54–58 % swing on odd 16ths), `psy-push` (odd bass 16ths pushed
  +6..+8 ticks against the kick; 1 tick = 1/64 of a 16th-step ≈ 10–13 ms
  at 145 BPM), `humanize` (seeded gaussian-ish micro, ±3 % of a step).
  Selection stored per project and in save/export; swing slider unchanged.
- Tests: `tests/determinism.test.ts` — 18 pass / 0 fail.

### Added — 2x oversampled master saturation (`feat: 2x oversampled master saturation`)

- Worklet `MasterChain` stage 3 (tanh saturation) now runs at twice the
  native rate: zero-stuffing + 33-tap halfband polyphase FIR (Blackman,
  cutoff = Nyquist/2 at the 2x rate) → saturate both 2x samples →
  anti-alias halfband → decimate. Linear phase, 16-sample delay, zero
  allocation. The true-peak limiter stays at native rate.
- Togglable for A/B: `processorOptions { masterOversample }` or a `config`
  port message.
- **Benchmark** (`tests/master-oversampling.test.ts`; run
  `bun test tests/master-oversampling.test.ts`): sawtooth sweep 12 → 16 kHz
  @ 44.1 kHz through the real MasterChain (satDrive 4.0, satMix 1.0),
  alias-only band 16.5–22.05 kHz (above the sweep fundamental, below
  Nyquist — pure foldback of the 2f/3f harmonics):

  | Configuration | Alias-band energy |
  | --- | --- |
  | Before — native saturation | **68.5 dB** |
  | After — 2x oversampled saturation | **−11.0 dB** |
  | **Reduction** | **79.6 dB** |

### Changed — foundation is the single source of truth (`refactor: device consumes foundation as single source of truth`)

- `js/model.js` imports `mulberry32`, `fnv1a` and the scale table from
  `foundation/` via native ESM relative imports (no bundler). The device's
  local PRNG/hash/scale-interval copies are deleted; device scale keys
  (`minor`, `major`, `dorian`, `phrygian`) are aliases onto
  `foundation/music/context.mjs` SCALES — interval data lives only in the
  foundation.
- `fnv1a` was **added to the foundation** (with pinned-vector tests) rather
  than duplicated. Pinned vectors prove behavior-neutrality (same PRNG
  sequence, same hashes, same per-bar event streams).
- Runtime lookahead scheduling stays device-local (the foundation scheduler
  is the offline plan→events primitive — the purpose boundary documented in
  FOUNDATION_STATUS.md; building the runtime adapter was out of scope for
  this brief). `foundation/learning` has no device consumer yet.
- `package.json` added (`psy6`, private, ESM) with `test` / `verify` /
  `benchmark` scripts.
- `soundBank.js` was TypeScript with a `.js` extension — renamed
  `soundBank.ts` and given a runtime smoke test
  (`tests/soundbank.test.ts`, 4 tests).
- Removed five legacy test files (`music/dsp/learning/transport/analysis
  .test.ts`) that were copied in "from psy-foundation family": they import
  `@psy-foundation/*` and `../src/index.ts` — paths that never existed in
  this repository — so they were never runnable here. Replaced by
  `tests/foundation-primitives.test.ts` (13 tests) which tests the
  foundation packages this repo actually ships.

### Verified state (this release)

| Check | Command | Result |
| --- | --- | --- |
| Test suite | `bun test` | **49 pass / 0 fail**, 5 files, 917 expect() calls |
| Repo gates | `node tools/verify.mjs` | **GREEN (0 failures)** |
| Aliasing benchmark | `bun test tests/master-oversampling.test.ts` | 68.5 dB → −11.0 dB (**79.6 dB reduction**) |
| Device Self-Gate | Self-Gate tab → RUN SELF-GATE | **9/9 passed** |
| Playground | open `playground/index.html` | boots, worklets load, no console errors |
