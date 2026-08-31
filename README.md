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
bun test             # 208 tests across 19 files — 208 pass / 0 fail (29935 expect() calls)
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
| `tests/arranger.test.ts` | 7 | section arranger: bar-quantized advance, persistence, manual override, paused transport |
| `tests/sidechain.test.ts` | 10 | kick-triggered sidechain: envelope shape, overlap continuity, project round-trip |
| `tests/sends.test.ts` | 9 | BPM-synced delay divisions, feedback clamps, deterministic IR, project round-trip |
| `tests/bounce.test.ts` | 8 | bounce schedule determinism, WAV header/data integrity, clipping |
| `tests/midi.test.ts` | 20 | MIDI IN core: note routing, CC learn + round-trip, param dispatch, CC0/CC123 rules, provider injection |
| `tests/capture.test.ts` | 7 | live capture: buffer growth accounting, bar-quantization math, bounce-encoder reuse |
| `tests/stems.test.ts` | 6 | stem discovery, per-track schedule determinism, full-mix hash unchanged |
| `tests/share.test.ts` | 12 | share links: canonical ordering, round-trip, determinism, learner survival, size guards |
| `tests/limits.test.ts` | 14 | v0.5.0 ceilings: 16 tracks / 128 steps / 64 scenes, mixed loopLen, addTrack, step-alias regression, legacy byte-stability |
| `tests/scenes.test.ts` | 14 | scene bank: add/duplicate/clear/reorder/rename/color/bars/fill, chain over 32+ scenes, launch semantics, persistence |
| `tests/params.test.ts` | 12 | param registry completeness + clamps, recordPoint/quantStep math, applyLanes state-vs-lock, MIDI→lane mapping |
| `tests/composer.test.ts` | 14 | composer determinism, 7-section structure, length ±5%, step invariants, 20-seed uniqueness, output integrity |
| `tests/usability.test.ts` | 7 | shortcut registry (no collisions, taskbook bindings), demo recipes recompose + boot |

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
| `G17` (live capture) | **realtime** ScriptProcessor tap + real scheduler | runs on-device; CI reports it as non-asserted info — **local-only assertion** |
| `G14w`, `G15w` (WORKLET engine reduced set) | worklet offline render | **local-only** — worklet rendering is environment-sensitive in CI; exercised from the live site at release |

CI asserts **18/19** MAIN gates (all except realtime G17); the full
**19/19** runs on a real device / real browser session.

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
