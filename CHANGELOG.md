# CHANGELOG — PSY6

All notable changes to the PSY6 device repository. Every claim below is
reproducible with the command shown next to it.

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
