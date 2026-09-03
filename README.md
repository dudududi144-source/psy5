# PSY6 — Psytrance Groovebox

> PSY6 is a browser-based psytrance groovebox: pooled-voice audio engine,
> worker-timed scheduler, deterministic pattern model. Built on
> **psy-foundation** — the shared musical infrastructure of the PSY device
> family.

[![device](https://img.shields.io/badge/device-PSY6-ffb454)]()
[![foundation](https://img.shields.io/badge/built%20on-psy--foundation-4fd6c0)]()
[![license](https://img.shields.io/badge/license-MIT-blue)]()

LOCAL · DETERMINISTIC · NO SERVER · NO TELEMETRY · NO BUILD STEP

## What is in this repository

| Path | What it is |
| --- | --- |
| `index.html` | **The PSY6 device** — standalone groovebox (power-on screen, Perform/Sequencer/Sound/Mixer/Self-Gate tabs, CO-PILOT panel, section arranger). Self-contained by design. |
| `worklets/psy-engine.js` | PSY6 real-time audio engine — single `AudioWorkletProcessor` (transport, ring-buffer event queue, preallocated voice pool, master chain). |
| `worklets/psy-dsp.js` | PSY6 DSP primitives — Moog ladder, polyBLEP saw/square, saturation, phaser, bus EQ (`AudioWorkletProcessor`s). |
| `soundBank.js`, `factory-presets.js` | Factory preset data used by the device. |
| `foundation/` | **psy-foundation** — shared packages (music, material, learning, dsp, scheduler, transport, protocol, device-sdk, analysis, fixtures, composition). Single source of truth for musical primitives. The device consumes `foundation/learning/bandit.mjs` (contextual bandit with abstention) for the CO-PILOT. See `FOUNDATION_API.md`. |
| `tests/` | Bun test suite for foundation packages. |
| `playground/` | The PSY6 browser playground (deployed to Cloudflare Pages as project `psy6`). |
| `data/` | scales / motifs / rhythms / presets / styles JSON. |
| `samples/` | Drum one-shot sample manifest + WAVs. |
| `tools/verify.mjs` | Repository verification gates (syntax + document structure) — run by CI before deploy. |

## Run it

```bash
# Device (ES modules — needs an HTTP origin, not file://):
npx serve .          # then visit /

# Playground (what Cloudflare Pages deploys):
npx serve .          # then visit /playground/
```

No bundler, no install, no account. Everything runs locally in your browser.

## Tests

```bash
bun test             # 431 tests across 38 files — 431 pass / 0 fail (501220 expect() calls)
node tools/verify.mjs  # syntax + structure gates (CI runs this before deploy) — GREEN
bun tools/e2e.mjs    # headless-Chrome Self-Gate evidence (CI job `gates`) — JSON out
```

Suite breakdown (all runnable with `bun test`):

| File | Tests | Covers |
| --- | --- | --- |
| `tests/voice-stealing.test.ts` | 11 | worklet priority-tier voice allocation |
| `tests/determinism.test.ts` | 18 | per-bar seeding, groove templates, micro timing |
| `tests/master-oversampling.test.ts` | 4 | 2x oversampled master saturation + aliasing benchmark + non-silent-output guard |
| `tests/foundation-primitives.test.ts` | 13 | foundation PRNG / fnv1a / scale tables (pinned vectors) |
| `tests/soundbank.test.ts` | 4 | sound bank coherence |
| `tests/copilot.test.ts` | 18 | co-pilot contextual bandit: context building, reward mapping, serialization round-trip, determinism, foundation extension |
| `tests/arranger.test.ts` | 13 | section arranger: bar-quantized advance, persistence, manual override, paused transport + v0.6.0 timeline editor ops (move/insert), share round-trip, PLAY SONG offline-sim, song info |
| `tests/sidechain.test.ts` | 10 | kick-triggered sidechain: envelope shape, overlap continuity, project round-trip |
| `tests/sends.test.ts` | 10 | BPM-synced delay divisions, feedback clamps, deterministic IR, project round-trip |
| `tests/bounce.test.ts` | 8 | bounce schedule determinism, WAV header/data integrity, clipping |
| `tests/midi.test.ts` | 20 | MIDI IN core: note routing, CC learn + round-trip, param dispatch, CC0/CC123 rules, provider injection |
| `tests/capture.test.ts` | 7 | live capture: buffer growth accounting, bar-quantization math, bounce-encoder reuse |
| `tests/stems.test.ts` | 6 | stem discovery, per-track schedule determinism, full-mix hash unchanged |
| `tests/share.test.ts` | 12 | share links: canonical ordering, round-trip, determinism, learner survival, size guards |
| `tests/limits.test.ts` | 14 | v0.5.0 ceilings: 16 tracks / 128 steps / 64 scenes, mixed loopLen, addTrack, step-alias regression, legacy byte-stability |
| `tests/scenes.test.ts` | 14 | scene bank: add/duplicate/clear/reorder/rename/color/bars/fill, chain over 32+ scenes, launch semantics, persistence |
| `tests/params.test.ts` | 12 | param registry completeness + clamps, recordPoint/quantStep math, applyLanes state-vs-lock, MIDI→lane mapping |
| `tests/composer.test.ts` | 41 | composer determinism, 7-section structure, length ±5%, step invariants, 20-seed project-wide uniqueness, output integrity + v0.7.0 section variants (pairwise ≥ 0.15, KICK-SACRED bound, pinned form fingerprint, pinned legacy hashes) + FOREST/HI-TECH recipes + v0.9.0 chord-progressions (harmonic invariant via the shared expansion, diversity, rhythm byte-identity) + 12/20-min growth (extended chain, allocateBars regression, SONG_HARD_MAX_SEC refusal) |
| `tests/evolution.test.ts` | 15 | v0.9.0 per-bar evolution: OFF byte-identity contract (pinned post-P1 schedule), ON diff ≥200, replay determinism, intensity-0 == OFF, op hygiene (chord-root rolls, lane precedence, clamps), live absBar mapping |
| `tests/library.test.ts` | 7 | v0.9.0 song library: recipe round-trip (compose → recipeFromProject → composeRecipe byte-identical), CRUD + deterministic ids, JSON/save/loadProjectObj/share persistence, legacy null, G33 support |
| `tests/samplestore.test.ts` | 11 | v0.10.0 sample store: id identity + idempotent re-import, canonical record order, f32-accurate normalize/reverse, 20s/50MB guards, memory-backend round-trip, metadata-only persistence, EXPORT bundle base64 round-trip + 30MB guard |
| `tests/voice.test.ts` | 10 | v0.10.0 sample voice model: playback math (tune/slice/clamps), ensureVoice canonical + garbage-proof, byte-stable persistence, registry smp* write-through |
| `tests/inserts.test.ts` | 10 | v0.10.0 insert FX: curve determinism/shape (drive soft-clip, crush staircase), ensureIns canonical + clamps, registry ins* write-through, composer lanes + KICK-SACRED + form-fp unchanged, snapshot/canonical load |
| `tests/hints.test.ts` | 4 | v0.10.0 composer sample hints: names-only slots {0,3,6}, resolve hit/miss semantics, canonical backfill, no PCM |
| `tests/freeze.test.ts` | 13 | v0.11.0 freeze/resample math: freezeWindow formula, freezePrep purity + input immutability, 10-min guard, resampleFrames exact trims, 1..32-bar guard |
| `tests/editor.test.ts` | 16 | v0.11.0 derived samples: canonical params, deterministic ids + idempotence, exact fade/gain math, base immutability, chains, store round-trips |
| `tests/slices.test.ts` | 11 | v0.11.0 slices: deterministic energy-flux detection (monotonic, capped, ±2-hop accuracy), sliceIdx window math, kind 'sliced' metadata (no PCM duplication), round-trips |
| `tests/keydetect.test.ts` | 9 | v0.11.0 key detection: DFT chroma selectivity + determinism, K-S triad naming (C major / A minor), tuneToRoot minimal-signed math |
| `tests/midifile.test.ts` | 9 | v0.7.0 MIDI export: format-1 writer, VLQ multi-byte, stable ordering, dependency-free parse-back, `.mid == WAV schedule` note-for-note identity, byte-identical exports |
| `tests/follow.test.ts` | 13 | v0.7.0 follow actions: model validation, followBars precedence, all modes' 20-transition simulations, prob=0 fallback, seeded replayability, JSON + share round-trips |
| `tests/mixsnap.test.ts` | 14 | v0.8.0 scene mix snapshots: canonical validation/clamps, registry application, walk-order launch trace, persistence + share round-trips, composer energy-curve payloads (kick excluded), determinism incl. snapshots, form-fp unchanged |
| `tests/master.test.ts` | 9 | v0.8.0 master section: ensureMaster backfill/clamps, 9 registry params apply, compOn rounding, project-level exclusion, MIDI denorm, legacy load idempotence, share round-trip |
| `tests/stems-song.test.ts` | 6 | v0.8.0 song stems + section bounce: songStemTracks, stems memory caps (per-stem 10 min, 60 audio-minute budget), sectionFrames formula, songFrames unchanged |
| `tests/usability.test.ts` | 7 | shortcut registry (no collisions, taskbook bindings), demo recipes recompose + boot |
| `tests/song.test.ts` | 12 | v0.6.0 song render: phase rules == live-scheduler oracle, frame-count formula (pinned number), sections/fills, schedule determinism, duration guard, cancel contract |
| `tests/pwa.test.ts` | 10 | v0.6.0 PWA: SW CACHE_VERSION == CHANGELOG latest, network-first + cleanup + claim pieces, manifest/icon integrity, deterministic icon generator |

## Self-Gate in CI

The on-device Self-Gate (`RUN SELF-GATE` button, Tests tab) is also run by CI:
`.github/workflows/ci-gates.yml` job `gates` boots the real device in headless
Chrome (`tools/e2e.mjs`, autoplay bypass + fresh profile + no-store server) and
asserts the **deterministic offline subset** — machine-readable JSON per gate
(id, pass, evidence numbers) is uploaded as a CI artifact.

Honest subset classification (v0.4.0):

| Gates | Class | Where asserted |
| --- | --- | --- |
| `G2`, `G5`, `G6`, `G8`, `G10`, `G16`, `G19` | pure computation (hash/save-load/macro/pools/bandit/MIDI core/share codec) | CI + local |
| `G1-TECHNO`, `G1-PSYTRANCE`, `G1-TRANCE`, `G1-PROGRESSIVE` | deterministic OfflineAudioContext render | CI + local |
| `G9`, `G11`, `G12`, `G13`, `G14`, `G15`, `G18` | deterministic OfflineAudioContext render (steal counters / sidechain / sends / bounce / drain / default-pool overload / stem isolation) | CI + local |
| `G17` (live capture), `G25` (record song) | **realtime** ScriptProcessor tap + real scheduler | run on-device; CI reports them as non-asserted info — **local-only assertions** |
| `G21`, `G22`, `G23`, `G24` | v0.5.0/v0.6.0 offline+pure set (long patterns / automation / composer / **song render**) | CI + local |
| `G26` (MIDI export), `G27` (follow actions) | v0.7.0 offline+pure set (format-1 parse-back / seeded chain simulation) | CI + local |
| `G28` (scene mix snapshots), `G29` (master EQ+glue), `G30` (song stems + section bounce) | v0.8.0 offline+pure set (snapshot RMS ratio + null-mix control / neutral tolerance + crest compression / stem frames + RMS ordering + slice equality) | CI + local |
| `G31` (chord progression engine), `G32` (per-bar evolution), `G33` (song library) | v0.9.0 offline+pure set (0 chord-tone violations via the shared expansion + determinism + diversity / OFF==pin + ON diff ≥200 + replay + intensity-0 / recipes compose deterministically + save/share round-trips + canonical rebuild) | CI + local |
| `G34` (sample voice), `G35` (insert FX) | v0.10.0 offline set (engine-path load + mixed render both voices + tune-halves-support + reverse onset-flip + two-render maxDiff + missing→fallback counted / neutral perturb→restore maxDiff<1e-6 + structural zero-node restore + drive crest squash + LP high-band drop) | CI + local |
| `G36` (freeze track) | v0.11.0: pipeline == independent prep+render+trim (dPipe 0), determinism (dDet 0), frames == freezeWindow formula, sample-track freeze == its plain render (dExact 0), re-freeze RMS within the measured double-master bound (−3.8 dB logged), onset aligned | CI + local |
| `G37` (sample editor) | v0.11.0: fade onset/sustain RMS 0.289, derivations of base+op+params byte-identical (maxDiff 0), 2-step chain round-trip maxDiff 0 + idempotent, base immutable | CI + local |
| `G38` (slices) | v0.11.0: detector ≥90% of truths within ±2 hops (measured 100%), sequential slice locks hit every step window in order, per-step lock overrides the track sliceIdx (zero-crossing 43 vs 46) | CI + local |
| `G39` (drum engine v2) | v0.12.0: kick sub ≥.45 (0.997) + click diff6 ≥.05 (v1 0.0151 → 0.1028) + ZCR pitch descent; hat centroid ≥6 k (12249) + inharmonic gap-cv ≥.2 (0.584 vs degenerate comb 0.009); clap ≥4 bursts (v1 3 → 8); snare dual-band (0.756/0.188); 4 voices deterministic <1e-6 | CI + local |
| `G40` (percussion v2 + library) | v0.12.0: 178 presets (133 drums) ≥150/≥100, schema 0 bad, genres 8/8, kits 8/8 resolve; tom ZCR monotone descent, cowbell dual-square partials (DFT 560/845 Hz), zap monotone 4/4, boom sub 0.95; determinism 0 | CI + local |
| `G42` (synth v2-lite) | v0.13.0: acid fenv 6–12k RMS ×2.07 legacy; penv descent z-ratio 0.20 vs no-penv 1.00 (flat-filter isolation); sub 20–60 Hz 0.161 vs 0.062 (2.6×); neutral maxDiff 0.0; determinism 0 | CI + local |
| `G43` (moog insert) | v0.13.0: real node spawns=1/fallbacks=0; 4–12k ×0.33 vs insert-off; moog≠biquad maxDiff 0.35 (core 0.47× — gentler tanh peak); honest counted fallback; determinism 0 | CI + local |
| `G44` (load/steal stress) | v0.13.0: 177 spawns, tight pools 4/3, TWO tier-0 tracks: starvation 0, 94 steals absorbed, per-track counts exact, reaper active=0, LOAD chip in DOM | CI + local |
| `G45` (UI options exposure) | v0.13.1: 0 orphan labels in the live DOM; WIDTH slider 1→1.8→1 drives master.widthMaster + eng.widthOn (1 = exact neutral); PP toggle flips fx.pingPong + eng.ppOn; IR long/short/classic swaps eng._irKind; 6 delay divisions (1/16 & 1/2 math exact); search filters 250→6 and restores; 9 composer styles — the 4 new families compose byte-identical twice | CI + local |
| `G41` (master space) | v0.12.0: neutral perturb→restore maxDiff 2.46e-7; width 1.8 HF-side ×1.77 (300 Hz protection by design); ping-pong L−R flips 2→46; long-IR decay 48.7× short | CI + local |
| `G14w`, `G15w` (WORKLET engine reduced set) | worklet offline render | **local-only** — worklet rendering is environment-sensitive in CI; exercised from the live site at release |

Gate-truth accounting (v0.13.1 — canonical inventory lives as a comment above
`runSelfGate()` in js/ui/tests.js): the device runs **44 MAIN entries**, of
which **42 are hard** (offline/pure — CI asserts all 42 ids incl. G24 song
render, G26 MIDI export, G27 follow actions, G28 snapshots, G29 master,
G30 stems/sections, G31 progressions, G32 evolution, G33 library, G34 sample
voice, G35 insert FX, G36 freeze, G37 editor, G38 slices, G39 drum engine
v2, G40 percussion + library, G41 master space, G42 synth v2-lite, G43 moog
insert, G44 load/steal stress, G45 UI options exposure) and
**2 are evidence-only realtime** (G17 live capture, G25 record song — they
run on-device every time, are reported as info in CI, and are exercised
from the production URL at every release). WORKLET: 3/3 reduced set. Numbering gaps G3/G4/G7/G20
never existed in any shipped commit (verified with `git log -S` across all
history) and are left unrenumbered.

Note: although G9/G14/G15 were originally labelled "realtime-ish", code
inspection (js/ui/tests.js) shows that in MAIN mode they run entirely through
`OfflineAudioContext` with fixed event schedules — they are deterministic
offline renders, and their criteria are inequalities/integer counters
(peak/rms thresholds, `kicks===16`), never bit-exact audio, so they are
stable across Chrome versions. CI has no realtime dependency.

CI layout: job `verify` (verify.mjs + `bun test`) → job `gates`
(headless Chrome e2e; **blocking**, one automatic retry of the driver before
going red — no `continue-on-error` anywhere).

## Benchmarks

`bun test tests/master-oversampling.test.ts` prints the numbers it asserts
against. Latest run — sawtooth sweep 12→16 kHz @ 44.1 kHz through the real
worklet MasterChain, alias-only band 16.5–22.05 kHz:

- native saturation: **68.5 dB** alias-band energy
- 2x oversampled saturation: **60.4 dB**
- **reduction: 8.2 dB**

**Correction (v0.3.0):** an earlier version of this document claimed a
**79.6 dB** reduction. That claim was vacuous: the oversampler never advanced
its input ring cursor (`osInIdx`), so the “oversampled” path re-read stale
input and produced a heavily-attenuated (near-silent) output — the old number
measured near-silence, not alias reduction. The cursor now advances, the
benchmark asserts the honest figure, and a **non-silent-output guard test**
(oversampled-path peak > 0.5, measured 0.729) prevents a silent-output
regression from faking the number again.

Device Self-Gate (Self-Gate tab → RUN SELF-GATE): **19/19 passed** in the
default MAIN engine (v0.4.0: + G16 MIDI, G17 live capture, G18 stems,
G19 share links), including:

- **G9** — 64 consecutive hats + kick on every 4th step under deliberate pool
  overload (3-voice drum pool): `kicks=16/16 hats=64/64 tier0Steals=0
  steals=70/0/2 peak=0.752` (the kick is never dropped, zero tier-0 voice
  starvation).
- **G10** — the CO-PILOT learner ranks a consistently rewarded action above a
  zero-reward one (`fillAvg=1.00(n=45) > varAvg=0.00(n=2)`, probe `exploit
  fill`) and abstains (DO_NOTHING) when every candidate's expected reward is
  below the threshold.
- **G11 (sidechain)** — kick ducks `scAmount>0` buses ≥60 % within the attack
  window, full recovery before the next kick, zero automation when every
  `scAmount=0`: `dipMin=72% recoveryMin=100% amt0Events=0 amt75Events=8`.
- **G12 (sends)** — send>0 → signal in the bus output, send=0 → silent tail;
  BPM-synced delay times at 145 BPM for 1/8 / 3/16 / 1/4 =
  `206.9/310.3/413.8 ms`; IR byte-identical to the canonical seeded PRNG.
- **G13 (bounce)** — offline WAV render spans the exact scheduled sample
  count, is non-silent, and its event schedule hash is identical across
  renders: `samples=148192/148192 rms=0.089 schedIdentical=true`.
- **G14/G15** — full-project render with zero residual events
  (`peak=0.785 residualEvents=0`) and overload at DEFAULT pools (`tier0Steals=0
  hatSteals=41 kicks=16/16 peak=1.016`).

In the optional WORKLET engine the Self-Gate runs a reduced but real set:
**3/3 passed** (G2 deterministic build; G14w boot + sample-accurate queue
drain + all kicks voiced, `peak=0.710 residualEvents=0 kicksVoiced=8/8`;
G15w overload via worklet stats, `tier0Victims=0 hatSteals=188
kicksVoiced=16/16 peak=0.938`).

## Features (v0.7.0) — EVOLUTION + INTEROP

v0.7.0 closes the "complete, long, UNIQUE content" gap and adds standard
interchange: no composed section ever repeats identically, two new styles,
standard MIDI file export, and seeded follow actions for performance.

- **SECTION VARIANTS** — every section family used more than once in the
  arranger derives variant scenes (`DROP`, `DROP 2`, `DROP 3`, …) through
  deterministic seeded ops (hat density/offset swap, bass octave shifts +
  velocity re-jitter, lead motif re-processed through the foundation
  MotifTransformer, perc repositioning) plus a per-variant lane delta via the
  param registry (cutoff/res/detune/send curves open progressively across
  variants). **KICK IS SACRED**: kick patterns never move — velocity accents
  only (`|Δvel| ≤ 0.1`, asserted). Difference contract: every pair within a
  family (base included) reaches `variantStepDiff ≥ 0.15` (documented
  union-normalized metric); measured minimum 0.306 across all styles and
  lengths. The form, total length and base patterns are unchanged (form
  fingerprint pinned to the v0.6.0 hash `d0c5f32f032f2a88`).
- **5 COMPOSER STYLES** — FULL-ON 145, DARK-PSY 148, PROGRESSIVE 138,
  **FOREST ~150** (harmonicMinor, longer builds, denser hats, rolling forest
  bass) and **HI-TECH ~155** (glitch perc density, energy variance, per-bar
  riser sweeps). Legacy recipes are byte-pinned; the new ones are full
  recipes in the same dict.
- **EXPORT MIDI** — standard format-1 MIDI file of the WHOLE arranger from
  the SAME song expansion the offline WAV renderer walks (the `.mid` equals
  the WAV schedule, asserted note-for-note). 1 step = 120 ticks @ ppq 480;
  melodic tracks → channels 1–8, drums → channel 10 (GM); tempo meta from
  the project BPM. Trigger-map durations (1 step); the WAV is the
  authoritative sound.
- **FOLLOW ACTIONS** (chain mode only) — per-scene `next / prev / random /
  scene → target` with probability (miss → documented `next` fallback) and
  `afterBars` override. Random is SEEDED (`fnv(projectSeed + ':' +
  transitionCounter)`) — the same seed + start replays the identical
  sequence (G27 pins it). **PRECEDENCE: PLAY SONG always follows the
  arranger and ignores follow actions.**

## Features (v0.12.0) — SOUND ENGINE v2

The synthesis layer was rebuilt (this run DELIBERATELY changes the rendered
sound of drums/percussion — that is its purpose; the A/B table in
CHANGELOG 0.12.0 is the measured proof):

- **Drum engine v2** — the four core voices are multi-layer: KICK = sub
  (sine, exponential pitch envelope, punch→depth) + body (triangle,
  tone→balance) + click (highpassed noise transient) + shared tanh
  soft-clip; HAT = six inharmonic square oscillators (806-style ratios
  [2, 3, 4.16, 5.43, 6.79, 8.21]·40 Hz) → bandpass 10 k → tone-mapped
  highpass + noise touch; CLAP = four bursts (~11 ms exponential spacing)
  + tail; SNARE = tone (triangle, 0.4-semitone drop) + noise band. Same
  parameter surface (type/tune/decay/tone/punch) — old presets sound
  upgraded, not broken.
- **Percussion v2 + new types** — tom (sweep + strike noise), rim (FM
  metallic), shaker (bandpass + dual-envelope micro-structure), impact
  (sub + body); NEW: conga, bongo, cowbell (560+845 Hz squares), clave,
  zap, boom.
- **Library 250 presets / 8 genres** (PSYTRANCE, DARK-PSY, GOA, FULL-ON,
  TECHNO, TRANCE, PROGRESSIVE, HI-TECH) with layered per-genre kits
  (KITS export) — all AUDITION-able in the Sound tab.
- **Master space** — stereo width `widthMaster` (0–200 %, mid/side with
  300 Hz bass-mono protection; 1 = exact-neutral bypass), ping-pong delay
  (`fx.pingPong`), 3 reverb variants (`fx.irKind`: short bright 1.2 s /
  classic 1.8 s / long dark 3.2 s — seeded, deterministic).
- **Composer kits** — the composer rides the per-style kits (kick stays
  sacred-consistent per style); pattern data unchanged (form-fp asserted).
- **9 composer styles (v0.13.1)** — FULL-ON, DARK-PSY, PROGRESSIVE, FOREST,
  HI-TECH + NEW PSYTRANCE (142), GOA (140, harmonic-minor), TECHNO (132),
  TRANCE (138), each with its own 12-template progression family (9
  families total).
- **Mixer options exposed (v0.13.1)** — master WIDTH slider, PING-PONG
  delay toggle, reverb IR variant select (CLASSIC/SHORT/LONG), 6
  BPM-synced delay divisions (1/16 … 1/2), factory-library search box.
- **A11y (v0.13.1)** — every form label is associated (`for=`/nesting/
  `aria-label`); zero orphan labels, guarded by tests + G45.
- Honest DSP notes: main-thread voices are mono pre-pan (true L/R
  decorrelation is the worklet path); the hat metallic stack initializes
  lazily on a voice's first hat hit (documented hot-path exception); the
  worklet engine keeps its reduced feature set (no width/ping-pong/IR
  variants, no tone-mapped hat, no snare voice — documented limitations);
  through-graph determinism is < 1e-6 (Chrome offline chunk variance
  ~3e-7 documented), pure engines are bit-exact.

## Features (v0.11.0) — RESAMPLE + SLICES + KEY

- **RESAMPLE** (Samples drawer) — record the live master for 1/2/4/8 bars
  (bar-quantized start, auto-stop, transport untouched) straight into the
  sample store as `resample-<bpm>bpm-<bars>bar-<hash8>`; optional instant
  assign to the selected track. Guards: 1..32 bars, worklet refusal,
  store-quota check. Realtime capture (evidence-class, like live CAPTURE).
- **FREEZE TRACK** (Sound tab ▸ VOICE row) — render the selected track for
  one pattern loop into a sample (`freeze-<trackName>-<hash8>`). Tap point
  **POST-insert PRE-send**: inserts are baked, global sends and sidechain
  are EXCLUDED (zeroed on the prepped clone) so re-sending a frozen track
  never doubles sends or ducking; the master section is baked (no pre-master
  tap exists without a parallel renderer — documented). The 0.05 s schedule
  lead is trimmed: frame 0 of the frozen sample = the first step of the
  loop.
- **SAMPLE EDITOR** (drawer ▸ ED) — waveform canvas (deterministic min/max
  peaks per pixel bucket) + non-destructive edits: fade-in/fade-out
  (0..2000 ms), gain, normalize, reverse. Every edit creates a DERIVED
  sample (deterministic id = base+op+params; idempotent re-derivation;
  chains allowed); the base import is byte-immutable. Lineage shown
  (`name · ← base`).
- **SLICES** — SLICE detects transients with a deterministic energy-flux
  detector (up to 16 boundaries; stored as pct metadata on a `kind:
  'sliced'` derived record — no PCM duplication); amber markers on the
  waveform. Play slices via the `smpSlice` param (0 = full, 1..16) or the
  per-step lock channel (`lock.smpSlice` — automatable lanes, ARM-AUTO,
  MIDI-learn by construction). SLICES → STEPS fills the selected track's
  pattern with sequential slice locks (the classic breakbeat fill).
- **KEY → ROOT** — deterministic key detection (direct-DFT chroma over the
  mid section + Krumhansl-Schmuckler correlation); one click tunes the
  selected track onto the project root pitch class (minimal signed shift,
  −5..+6 st, logged in the toast).
- All four features are MAIN-engine only (the WORKLET limitations list says
  so on-screen). Sample-voice projects without slices/locks render exactly
  as v0.10.0 (defaults: sliceIdx 0, fades 0 ms — zero behavior change).


## Features (v0.10.0) — SONIC PALETTE

- **USER SAMPLES** (Sound tab ▸ Samples) — import your own kicks, vocal
  stabs, atmos (drag&drop or file input; wav/mp3/ogg/flac decoded by the
  browser; caps: 20 s / 50 MB / 128 rows). PCM lives in **IndexedDB** —
  project JSON, share links and localStorage carry id + metadata only.
  Ids are content-derived (`fnv1a(name+length+rate+first-4096-samples)`) →
  re-import is idempotent. Optional normalize (peak → 0.95, baked).
- **SAMPLE VOICE** — any track switches VOICE SYNTH→SAMPLE (Sound tab):
  per-hit buffer playback with gain/tune (±24 st)/start-end %/reverse/
  attack/release, all registry-automatable. Per-track 8-voice cap with
  oldest-stolen stealing (pool discipline). Missing sample → honest synth
  fallback + one-shot toast. Offline renders use the SAME buffers through
  the ONE renderer (bounce.js). **Not supported in WORKLET mode** (listed
  in the on-screen limitations). Honest WebAudio note: sample voices create
  a per-hit AudioBufferSourceNode + GainNode (buffers are pre-decoded once
  into a cache; nodes are GC-reaped on ended).
- **PER-TRACK INSERT FX** — drive / crush / filter per track, pre-send,
  in the Sound tab INS row and via the registry (`ins*` params):
  automatable lanes, ARM-AUTO recordable, MIDI-learnable,
  scene-snapshot-able (`insDrive`/`insFiltFreq` ride scene.mix optionally;
  old snapshots load unchanged). Defaults are EXACT bypass — a project with
  zero samples and all inserts off renders identical to v0.9.0 (G35
  neutral: perturb→restore maxDiff 8.94e-8; non-vacuous probes: drive
  squashes saw crest 17.77→2.15 dB, LP 200 Hz drops the hat high band
  73.3 dB).
- **COMPOSER SAMPLE HINTS** — composed songs ASK for your material:
  slots {0: kick, 3: perc, 6: atmos} resolve by NAME against the store at
  compose arrival (hit → sample voice, miss → synth + honest toast). The
  composer never requires samples; hints are names-only metadata.
- **COMPOSER INSERT LANES** — BUILD sections open insFiltFreq sweeps on
  the lead/pad, RISER opens the perc filter + rises its drive. THE KICK IS
  SACRED: track 0 never receives inserts or insert lanes.
- Honest storage notes: samples are per-BROWSER (IndexedDB); projects
  referencing missing samples fall back to synth; file EXPORT can bundle
  sample audio as base64 via an explicit checkbox confirm (30 MB hard
  guard) and IMPORT rehydrates it.

## Features (v0.9.0) — SCENE EVOLUTION + PRO GROWTH

- **CHORD PROGRESSION ENGINE** — every composed project now carries a
  seeded chord progression (`p.harmony`): 12 templates per style family
  (4/8-bar diatonic loops, mode-aware triad voicings), picked by
  `fnv1a(seed+':prog')`. Bass roots, lead-motif harmonization (nearest
  chord-tone snap) and pad/arp voicings follow the active bar's chord;
  kick/hats/perc/snare/fx are byte-identical to v0.8.0 (pinned digests).
  **Harmonic invariant: 0 off-chord tonal notes across 69k+ audited notes**
  via the shared songSteps expansion (G31). 10+ distinct progressions
  across 20 seeds per style.
- **PER-BAR EVOLUTION** (Perform tab → arranger panel) — opt-in
  (`p.evolution`, default OFF) deterministic section morphing: hat density
  shifts, chord-root bass rolls, ±1-scale-degree lead contour, perc ghosts,
  cutoff/sendA creep — seeded per (evolution seed, song bar) through the
  existing event machinery. Precedence documented: snapshot launch →
  evolution → lane automation (lane-covered pairs win per-step). Live PLAY
  SONG keys evolution to the arranger position — the same bar morphs
  identically offline. **Evolution-OFF determinism contract: OFF renders
  are BYTE-IDENTICAL to the pre-evolution engine (G32 pins the schedule
  hash); intensity-0 behaves exactly like OFF; ON replays hash-identically.**
- **SONG LIBRARY** — multi-song projects: the album stores composer
  RECIPES (style/seed/length, ~100 bytes each), never snapshots; LOAD
  re-renders the recipe in memory via the deterministic composer. ADD
  CURRENT recovers the recipe of a composed project (free-form projects
  honestly report "recipe unavailable"); COMPOSE NEW from the drawer keeps
  the album (stash/restore); LOAD is confirm-if-dirty; the active song
  badges "▶ playing" during PLAY SONG. The library rides save/export/
  share/RESUME and `loadProjectObj` rebuilds it canonically. The plain
  header COMPOSE starts a fresh project by design.
- **12 AND 20 MINUTE FORMS** — lengths 3/5/8/12/20 min (±5%, measured max
  error 0.48%). >8-min forms use an 11-section chain (DROP3, double-BREAK,
  BRIDGE, OUTRO2) with behavior mapping (DROP3 plays like DROP, BRIDGE like
  BREAK). 3/5/8-min outputs are byte-identical (pinned). Memory tiers:
  full-song bounce refuses >30 min before any Web Audio work
  (SONG_HARD_MAX_SEC); 10–30 min renders require explicit confirm and show
  the progress/cancel modal; stems and SECTION bounce stay capped at
  10 min. **Known storage limit (documented, honest): 12/20-min projects
  exceed the ~5 MB localStorage quota (12-min ≈ 3.8 MB, 20-min ≈ 6.4 MB
  JSON) — SAVE shows 'SAVE FAILED' by design; EXPORT (file) and SHARE are
  unaffected; RESUME of long forms is best-effort.**

## Features (v0.8.0) — SCENE STATE + MASTER + STEMS

- **SCENE MIX SNAPSHOTS** — every scene can carry a mix identity
  (`scene.mix`: per-track vol/pan/sendA/sendB/scAmount, optional master
  params, optional note). Applied on EVERY launch path (instant click, the
  quantized bar-boundary launch that PLAY SONG / chain / follow actions /
  manual launches all share, and the offline song render) through ONE
  primitive (`applySceneMix`) with a glide anchored at the launch point.
  **Precedence: the snapshot applies at the launch; per-step automation
  lanes evaluate on top** — continuous automation wins per-step, exactly as
  documented in js/scenes.js. Null-mix scenes are byte-identical to legacy
  behavior (opt-in; G28 asserts the event schedule is unchanged). The scene
  bank has MIX→SCENE (capture the current mixer — mute/solo deliberately not
  captured), ×MIX, and a MIX badge. The composer populates snapshots from
  the section energy curve (INTRO low → DROP full/dry/bass-duck → BREAK
  spatial/duck-off → RISER swell → OUTRO fall; variants lean pan ±0.12; the
  kick level NEVER appears in a composer snapshot). Form fingerprint
  unchanged (`d0c5f32f032f2a88`); whole-project legacy hashes re-pinned
  (documented in CHANGELOG 0.8.0).
- **MASTER SECTION** (Mixer tab → MASTER): EQ3 (low shelf 100 Hz / peak
  1 kHz Q 0.8 / high shelf 8 kHz, ±12 dB) + glue compressor (−40..0 dB,
  1..20:1, 1..100 ms, 20..1000 ms, makeup 0..24 dB, GLUE ON/OFF — bypass
  removes the node from the chain). Neutral by default: existing projects
  render identically within a measured **1.79e-7** max sample diff (G29).
  All 9 params are registry params: lane-automatable (track −1),
  ARM-AUTO-recordable, MIDI-learnable (`master.<param>`), snapshot-able.
- **SONG STEMS** (bounce modal → MODE SONG → STEMS checkbox): one
  `psy6-song-stem-<track>.wav` per non-empty track through the SAME
  renderSong (trackFilter — isolation by not spawning other voices, no
  signal math). Sequential downloads with progress. Memory caps
  (`songStemsGuard`): per-stem ≤ 10 min with tail; total budget
  Σ stems × duration ≤ 60 audio-minutes — > 6 stems on a long song is
  exactly what this refuses (toast).
- **SECTION BOUNCE** (Perform tab → timeline: click selects, shift+click
  extends a contiguous range → BOUNCE SECTION): `psy6-section-<scene>-<idx>
  .wav` — the selected arranger range **as it appears in the song** (slice
  of the full arrangement render; music window sample-exact vs the full
  render, G30 measured 2.98e-7). File = 0.05 s pre-roll + range music +
  2-bar FX tail; formula asserted. Renders the full arrangement (single
  renderer) and slices — cost equals a SONG bounce; the 10-minute guard
  applies. SHARE note: the share hard cap moved 50 → 64 KB so a composed
  snapshot-bearing song still fits a share link.

## Features (v0.6.0) — SONG ENGINE

The composer builds the arrangement; v0.6.0 makes the device able to **export
and record the actual song** (previously BOUNCE only rendered the current
pattern loop ×N — a composed 3-minute song bounced as a 26-second fragment).

- **SONG BOUNCE** (bounce modal → MODE `SONG`, enabled when the arranger has
  sections): offline-renders the whole `[scene,bars]` chain through the SAME
  live machinery — `stepEvents` per-bar seeded groove, the live scene-launch
  phase rule (`sc.step = sc.step % newLoop`), per-scene auto-FILL, and the
  per-step automation player (`applyLanes` → `syncMix`/`resolveMacros`), so
  state-lane sweeps land on voices exactly as in playback. Documented frame
  formula: `frames = ceil(sr·(0.05 + (Σbars·16 + 32)·(60/bpm/4)))` — the +32
  steps are a 2-bar FX release tail; the toast reports music length and
  with-tail length separately. Progress bar with section name; CANCEL aborts
  cleanly (never touches the live AudioContext). Output `psy6-song-<bpm>bpm.wav`.
  Render cap **10 minutes** (memory guard, toast refusal beyond).
- **ARRANGER TIMELINE EDITOR** (Perform tab): visual blocks, width ∝ bars,
  scene color; click-select → bars ±, reorder ◀▶, insert-from-scene, DELETE;
  total readout in sections/bars/mm:ss. All edits persist in
  `project.arranger` (save/export/share round-trip).
- **PLAY SONG**: jumps to section 0, quantized start when already playing,
  boots the transport when stopped; progress via the existing arranger state.
- **RECORD SONG** (transport row): captures the whole live PLAY SONG through
  the existing master tap, auto-stops at the end of the final section +1 bar,
  encodes with the existing WAV encoder → `psy6-song-live-<bpm>bpm.wav`.
- **G24** (offline, CI-asserted): composed FULL-ON 3min seed 424242 → song
  render: frame count == formula (10,075,254 samples), all 7 sections
  RMS > 0.03 (measured 0.0665–0.1088), event schedule == pure oracle
  (evHash equality), determinism max sample diff 3.73e-7 < 1e-6 (Chrome float
  nondeterminism between runs is real and documented — the bound is honest).
- **G25** (realtime, evidence-only): 4-bar two-section song recorded live →
  duration 9.381s vs 5-bar target 9.375s (**skew 6 ms**), RMS 0.082. G25 also
  exposed and fixed a real bug: a second capture in one page session included
  the first capture's audio (CaptureTap.start now resets state; completed
  captures retire their tap).

## Features (v0.5.0) — UNLIMIT + COMPOSER

### Ceilings (raised, defaults unchanged)

| Limit | v0.4.0 | v0.5.0 | How to reach it |
| --- | --- | --- | --- |
| Tracks | 8 | **16** | +TRACK button (Perform tab) |
| Steps per pattern-track | 32 | **128** | length select (Sequencer) |
| Scenes | 8 | **64** | +SCENE in the scene bank |
| Pattern length options | 4–32 | **8/16/32/64/128** | length select |
| Loop length cap | 96 | **1024** | automatic (LCM of track lengths) |
| Voice pools | 20 synth + 24 drum | **unchanged** | polyphony absorbed by priority stealing |

New projects still start 8 tracks / 16-step patterns / 8 scenes; legacy
projects load and sound identically (fields backfilled; load→save
byte-stable after one canonicalizing load).

### Scene bank

64 scenes with inline rename, duplicate, clear, reorder (up/down), color
tags, per-scene bars override (pre-fills the arranger), and a per-scene
auto-FILL toggle (fires the existing FILL op at launch — instant or at the
quantized bar boundary). Launch semantics unchanged: click = quantized,
alt = instant, shift+click = assign.

### Full-parameter automation

Every automatable parameter (23 in the registry: synth sound, mixer, sidechain,
master, macros) has a lane. Lanes are `(track, param)` pairs; `'state'` lanes
apply per-step through the registry (knob-equivalent), legacy `'lock'` lanes
keep exact per-voice behavior. ARM-AUTO + per-lane arm records knob moves and
MIDI CC into armed lanes at the quantized playhead — multiple lanes at once.
Editor: param picker, lane list with live value readout, curve canvas + playhead.

### Song composer (flagship)

COMPOSE (power screen + header) generates a complete unique arrangement —
INTRO→BUILD→DROP→BREAK→RISER→DROP2→OUTRO — from `(seed, style, minutes)`:
FULL-ON 145 / DARK-PSY 148 / PROGRESSIVE 138 BPM, 3/5/8 minutes (length
error < 1 % by construction, ±5 % asserted), per-section patterns with
energy-scaled recipes, lead motif varied per section via foundation
MotifTransformer, fills, a 9th FX riser track, filter/send lane suggestions,
and the arranger chain pre-loaded. Same seed = byte-identical song; 20 seeds
→ all pairwise different. Overwrite protection: composing over a non-empty
project requires an explicit confirm and happens in a fresh in-memory project.

### Usability

Keyboard shortcuts from a single tested registry (Space play/stop, arrows
scene prev/next, 1-8 pads, Shift+1-8 track select, f fill, v variation,
b bounce, ? help overlay, Esc close), tooltips on all header controls, two
shipped demo songs (composer recipes — deterministic recomposition), touch
targets ≥ 40 px on primary controls, 390 px layout verified.

## Features (v0.4.0)

### MIDI IN (hardware play)

Connect a MIDI controller in the Perform tab → notes play the currently
selected track (velocity = note-on velocity, MIDI note = pitch), CC learn
binds any of 57 parameters (macros, mixer incl. sendA/sendB/scAmount,
master) to a knob/fader, CC 123 = PANIC. Bindings persist in the project
(`midiMap`) and survive save/export/import/share. Honest scope: **no MIDI
clock sync** (out of scope, documented in the UI); note-off releases synth
voices only — drum one-shots are never cut mid-hit; `master.vol` is applied
by the MAIN engine only (the WORKLET engine persists but does not apply it);
Web MIDI needs a Chromium browser (graceful note elsewhere).

### Live capture (record the jam, losslessly)

CAPTURE in the transport bar records the master output losslessly: starts on
the next bar, stops on the next bar after that (16-step quantization), and
downloads `psy6-capture-<bpm>bpm.wav` via the same WAV encoder as bounce.
The tap is parallel to the listening path — starting/stopping capture can
never stop playback. Honest scope: built on `ScriptProcessorNode`
(**deprecated** API, chosen deliberately: zero changes to the MAIN engine
graph; universally supported in Chrome/Firefox/Safari); quantization skew is
bounded by the 1024-frame callback (measured 6 ms on-device, tolerance
±50 ms). Capture gate G17 is realtime and asserted on-device only.

### Stem export

BOUNCE → MODE: STEMS renders one WAV per **non-empty** track
(`psy6-stem-<trackName>.wav`, sequential downloads) through the same
deterministic offline graph as the mix bounce. Isolation semantics are
honest: tracks with no scheduled events contribute exactly 0; a track's own
FX-delay/reverb tail and decay tail belong to its own stem.

### Share links

SHARE copies a link (`#p=<token>`) containing the whole project — canonical
JSON key order, deflate-raw compressed, base64url — including the CO-PILOT
learner snapshot. Links are byte-identical for identical projects. A link is
NEVER auto-loaded: the power screen shows a consent banner (LOAD SHARE /
DISMISS). >6 KB links warn (browser URL limits), >50 KB are refused — use
EXPORT instead.

## Two engines — MAIN (default) and WORKLET (experimental)

The power screen offers a choice of audio engine:

- **MAIN** (default) — the pooled Web Audio engine (`js/engine.js`):
  preallocated synth/drum voice pools, per-track bus chain with kick-triggered
  sidechain ducking, BPM-synced delay + seeded-IR reverb sends, worker-timed
  lookahead scheduler. Full Self-Gate (15/15).
- **WORKLET** (experimental) — the single-processor AudioWorklet engine
  (`worklets/psy-engine.js`, processor `psy-engine`) driven through the
  adapter in `js/worklet-engine.js`. The MAIN thread schedules; the worklet
  fires events sample-accurately on the audio thread. Reduced Self-Gate
  (3/3).

WORKLET limitations (also listed on the power screen — nothing is faked):
per-track sends collapse to per-BUS max; delay division not exposed (fixed
0.5 s buffer); per-track sidechain → single fixed bass-bus duck; synth
editor params → worklet world params; worklet-internal reverb IR. What
CANNOT map cleanly is skipped and documented, never approximated silently.

## Device identity

The device is **PSY6**. The engine worklets are `worklets/psy-engine.js` and
`worklets/psy-dsp.js` (registered processor names: `psy-engine`, `moog-filter`,
`bl-saw`, `bl-square`, `saturation`, `phaser`, `bus-eq`).

Historical documents in this repository (`FOUNDATION_STATUS.md`,
`FOUNDATION_FREEZE.md`) reference earlier devices in the family — **PSY4** and
**PSY5** — as provenance for design decisions. Those are historical records;
the current device and all engine code are PSY6.

## Architecture

```
psy-foundation (shared musical primitives)
        ↑
      PSY6 device
   ├── model        patterns, steps, scales, deterministic RNG
   ├── scheduler    worker-timer + lookahead loop
   ├── engine       pooled voices (synth 20 / drum 24), sidechain duck buses,
   │                delay/reverb send buses, master chain  ← MAIN (default)
   ├── worklet-engine  model→worklet adapter                ← WORKLET (experimental)
   ├── bounce       offline WAV render (fresh graph, exact scheduling)
   └── UI           Perform · Sequencer · Sound · Mixer · Self-Gate
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full specification and
[FOUNDATION_API.md](FOUNDATION_API.md) for the versioned foundation API.

## Deployment

Three options — the device needs no build step and no secrets:

1. **GitHub Pages (live, zero secrets)** — `.github/workflows/deploy-gh-pages.yml`
   deploys the repo root on every push to `main`. Live URL:
   **https://dudududi144-source.github.io/psy5/** (device at `/`,
   playground at `/playground/`). No repository secrets required.
2. **Cloudflare Pages (needs the two secrets)** —
   `.github/workflows/pages-deployment.yaml` — pushes to `main` that touch
   `playground/**` first run the `verify` gates, then deploy `playground/` to
   Cloudflare Pages (project `psy6`). Requires the repository secrets
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to be configured.
3. **Local (HTTP origin required for ES modules — not `file://`)**:
   `npx serve .` — then visit `/` for the device and `/playground/` for the
   playground.

## Non-negotiable rules

1. One source of truth per piece of musical state — the device consumes
   `foundation/`, it does not re-implement it.
2. Transport is not renderer, renderer is not UI.
3. No device policy — PSY6 is built from foundation primitives.
4. Every claim has evidence.
5. The `process()` hot path is allocation-free.

## License

MIT.
