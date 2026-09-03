# PSY6 ULTIMATE — Full Architecture Specification

## 1. Design Philosophy

PSY6 ULTIMATE follows the non-negotiable rules of the PSY family:

1. One source of truth per piece of musical state
2. Transport is not renderer, renderer is not UI
3. No device policy — this IS the device, built from foundation primitives
4. Every claim has evidence — benchmarks included

## 2. Layer Architecture

The instrument is organized in 5 layers, top to bottom:

- **UI Layer**: Knobs, XY Pad, Step Sequencer, Arranger View, Performance Pads
- **Brain Layer**: ContinuousMusicalState, CandidateGenerator, GrammarBuilder, StyleSelector
- **Scheduler Layer**: TempoClock (BPM + Swing), SectionArranger, StepScheduler
- **Engine Layer**: PooledEngine, SynthVoice pool, DrumVoice pool, AudioBus
- **Preset Layer**: Factory Library, Genre Tags, Style Builder

## 3. PooledEngine — Zero GC Architecture

### Problem
Creating Web Audio nodes per-note causes GC pauses leading to audio dropouts.

### Solution
Pre-allocate all voices at init. Reuse via round-robin.

SYNTH_VOICES = 20 (melodic: bass, lead, arp, pad)
DRUM_VOICES = 24 (percussive: kick, snare, hat, perc, fx)

Each voice:
- Created ONCE at AudioContext init
- All nodes pre-connected (osc -> filter -> vca -> bus)
- noteOn() only updates parameters (freq, gain, envelope)
- panic() cancels scheduled values and zeroes gain

### Voice Lifecycle
INIT: create voice -> connect to bus -> idle
NOTE: nextVoice() -> set params -> schedule envelope -> active
END: envelope completes -> voice returns to pool -> idle
PANIC: cancelScheduledValues -> gain=0 -> idle

### 3b. Dual engine — MAIN (default) | WORKLET (experimental)

The power screen selects the audio engine. MAIN (section 3) is the default
and the reference; nothing about it changes when WORKLET exists.

**WORKLET** (`js/worklet-engine.js` + `worklets/psy-engine.js`, processor
`psy-engine`): the MAIN thread scheduler keeps computing events; the worklet
fires them sample-accurately on the audio thread. Mapping model→worklet:
voice ids per track kind/type, MIDI→Hz, bpm + per-bus delay/reverb sends
(bus send = max of member tracks). What cannot map cleanly is skipped and
documented on the power screen (fixed delay length, fixed-shape bass duck,
world-param synth voices, worklet-internal IR) — never approximated
silently.

Transport channels: LIVE — outbox handshake (commands buffer until the
worklet's first `stats` message proves the port is attached; Chrome builds
processors lazily and pre-attach posts are lost nondeterministically).
OFFLINE — commands are replayed at construction via
`processorOptions.initialMessages` (the offline render thread never drains
its input message queue). Self-Gate: MAIN runs 15/15; WORKLET runs a reduced
but real 3/3 (G2, G14w, G15w) using the worklet's own stats.

## 4. Brain Layer — Generative Composition

### ContinuousMusicalState
Persists across phrase boundaries. Never resets.

State contains:
- leadLastMidi (last note played by lead)
- bassLastMidi (last note played by bass)
- contourMomentum (direction of melodic movement)
- registerCenter (average pitch)
- energy (0-1, from section + user input)

### CandidateGenerator
Per-bar, generates 5 candidates with different characteristics:

Candidate dimensions:
1. density (notes per bar)
2. registerShift (octave displacement)
3. syncopationBias (off-grid probability)
4. contourDirection (up/down/flat)
5. repetitionFactor (how much to repeat previous motif)

Scoring (6 axes):
- harmonicFit (does it fit current chord/scale?)
- bassComplement (register separation from bass)
- continuity (distance from previous phrase)
- novelty (information gain)
- styleFit (matches selected genre grammar)
- energyFit (matches current energy level)

Best candidate = highest totalScore

## 5. Scheduler — Timing Architecture

TempoClock:
  - bpm: 60-200
  - swing: 0-100%
  - timeSource: AudioContext.currentTime (NOT Date.now)

StepScheduler:
  - lookahead: 25ms
  - interval: setInterval(scheduler, 25)

SectionArranger:
  sections: [INTRO, BUILD, DROP, BREAK, RISER, DROP2, LOOP]
  Each section: { bars, energy, density, activeTracks }
  Auto-advance: when bar count reached -> next section

## 6. Audio Signal Flow

SynthVoice:
  osc1 -> filter -> vca -> trackBus -> master
  osc2 -> filter

DrumVoice (v0.12.0 — multi-layer; every layer zeroed at the hit anchor,
  pool discipline unchanged — drumDurEst formulas untouched):
  KICK   osc   (sine, SUB)   pitch env f0*startMult -> f0 (punch -> depth)
         osc2  (triangle BODY, tone -> body/sub balance)
         noise -> HP(3800+1400*punch) -> gain  (CLICK, 5 ms)
         out -> soft-clip WaveShaper (tanh, engine-shared curve) -> trackBus
         (non-kick types route out -> trackBus DIRECTLY — the shaper is
          kick-only, everything else keeps the exact dry path)
  HAT    6x square osc, inharmonic ratios [2, 3, 4.16, 5.43, 6.79, 8.21]
         *40 Hz*tune (806-style recipe; lazy first-hit init)
         -> BP 10k -> HP(7200*sqrt(tone)) -> gain  + noise touch (HP 8k)
  CLAP   noise -> BP(1150*tone, per-burst offsets [1, 1.07, .94, 1.1])
         4 bursts (~11 ms spacing) + tail burst (long decay)
  SNARE  osc2 (triangle TONE, 0.4-semitone drop, punch -> decay)
         + noise -> BP(1900*tone)  (dual-band)
  TOM    osc (sine sweep 180->92*tune) + strike noise (BP 1800, 8 ms)
  RIM    osc (sine) + FM: modulator 2.76x, depth 1.4x -> osc.frequency
  SHAKER noise -> BP(5500*tone) dual-envelope micro-structure
  CONGA/BONGO  sine + pitch bend + noise touch (membrane model)
  COWBELL  osc square 560*tune + osc2 square 845*tune (documented 1.509)
  CLAVE  osc sine 2500*tune + osc2 sine 3750*tune (wood modes 1 : 1.5)
  ZAP    osc glide 1600*tune -> 70*tune + BP chirp 4000 -> 200
  BOOM   osc sub drop 70*tune -> 28 + LP 400 touch (reverb-ready tail)
  IMPACT osc sub 60->30 + osc2 triangle body 120->55
  DARBUKA (v0.14.0) osc2 triangle DUM sweep 1.5*f0->f0 (165 Hz base, 45 ms
         bend) + osc sine TEK ping 690->560*tune + BP snap 4200*tone
  TAMBOURINE (v0.14.0) metal stack at 95 Hz base -> BP 8.2k ->
         HP(5600*sqrt(tone)) + osc sine membrane thump 195*tune
  TRIANGLE (v0.14.0) metal stack at 205 Hz base -> BP 10.5k -> HP 3.2k,
         TWO-stage decay (fast set-down then long ring; decay maps ring)
  DOWNLIFTER (v0.14.0) noise HP 6.2k -> 180 (exponential descent) +
         osc sine 180*tune -> 42 (the riser's mirror)
  v0.14.0 optional params (all legacy-neutral — absent = exact v0.13.1):
    kick dist 0..1 (lazy drive gain 1+5.5*d^2 into the EXISTING shaper,
         node built on first use, rerouted via connect()),
    kick glide 0..1 (SUB pitch-env start += 2.6*f0),
    clap bursts 2..6 (precomputed CLAP_B/CLAP_D tables; nb=4 = the exact
         v0.12.0 arrays — Chrome truncates overlapping ramps, so middle
         bursts render as damped ripples: honest, deterministic),
    hat bright 0.5..2 (BP corner *= sqrt(bright))

Master chain (v0.12.0 P3):
  master -> [width network] -> EQ3 -> [glue comp -> makeup] -> comp -> analyser -> destination
  width network (ONLY when widthMaster != 1 — at 1 the network is OUT,
  the exact pre-v0.12.0 graph):
    master -> splitter -> mid=(L+R)/2, side=(L-R)/2
    side -> HP 300 Hz (bass mono protection, documented) -> width gain
    merger: L' = mid + w*side, R' = mid - w*side -> eqLow
  delay (mono default | fx.pingPong 1 = two cross-fed taps, hard L/R outs,
  one lowpass per leg, delayFbClamp feedback)
  reverb: convolver, fx.irKind 'classic'(1.8 s, byte-identical to v0.11.0)
    | 'short'(1.2 s bright) | 'long'(3.2 s dark, one-pole LP 2600) —
    seeded deterministic IRs (sends.mjs IR_VARIANTS)

## 7. Preset System

Genres: TECHNO, PSYTRANCE, TRANCE, PROGRESSIVE, DARK-PSY, GOA, FULL-ON,
HI-TECH (+ ANY) — 8 musical genres as of v0.12.0
Categories: drum, bass, lead, pad, pluck, arp, fx
SYNTH VOICE (v0.13.0 v2-lite) — osc1+osc2 → mix gains → BiquadFilter (env:
  start cut·fenv → cut over fdec; fenv legacy 3, fdec legacy atk+dec·0.7)
  → VCA (ADSR-ish) → chain insert (drive/crush/filter|MOOG) → sends.
  OPTIONAL preset params, all legacy-neutral: fenv (env amount),
  fdec (env decay), penv/pdec (pitch env semitones+decay — exponential
  descent at noteOn), sub (lazy sine sub-osc one octave below; the node is
  built on first use, absent ⇒ v0.12.0 graph bit-identical). noteOn returns
  the merged param object (per-voice scratch — no per-hit allocation).
MOOG INSERT (v0.13.0) — ins.filtOn 4 → AudioWorkletNode 'moog-filter'
  (worklets/psy-dsp.js MoogFilterProcessor: 4-stage tanh ladder, PSY3 port)
  in the chain insert slot: cWS → moog → duck. prepInsertDSP(ctx) loads the
  module once per context (powerOn preloads live; bounce/freeze prep offline
  when projectUsesMoog). Unloadable → counted biquad-LP fallback.
LOAD TELEMETRY (v0.13.0) — PooledEngine.loadSnapshot(): active voices,
  steals, tier-0 starvation attempts, counters, latency; the header LOAD
  chip paints it at 4 Hz. G44 asserts the discipline under stress.
UI OPTIONS EXPOSURE (v0.13.1) — the v0.12.0/v0.13.0 engine capabilities get
  their controls: master WIDTH slider (master.widthMaster 0..2, registered
  in params.js since v0.12.0), PING-PONG toggle (fx.pingPong), IR variant
  select (fx.irKind classic/short/long), 6 BPM-synced delay divisions
  (sends.mjs DIV_STEPS adds 1/16, 3/8, 1/2 — additive, unknown falls back
  to 3/16), factory-library search box (#libQ substring filter over
  name/id/genre). Composer styles 5 → 9: PSYTRANCE 142 / GOA 140
  harmonicMinor / TECHNO 132 / TRANCE 138 ride their own KITS rows and
  their own 12-template PROGRESSION_TEMPLATES families (9 families; the
  module-load validator covers them; the 5 legacy families are
  byte-untouched). A11y: all labels associated (for= / nesting /
  aria-label) — G45 pins the whole exposure contract with numbers.

Library: 312 presets (195 drums + 117 synths), unique ids,
schema-validated (G40 +
tests/v2-library.test.ts). KITS: 8 layered per-genre kits mapping the 9
composer roles {kick, snare, hat, perc, bass, lead, pad, arp, fx} to
preset ids; COMPOSER_STYLES ride the kits (kick sacred-consistent per
style — pattern data untouched, form-fp asserted). Drum preset schema:
{id, name, genre, cat:'drum', engine:'DRUM', type, tune, decay, tone,
punch} — the SAME v1 parameter surface drives the v2 voices (neutral
defaults; new capability ships as NEW presets/types, not new required
fields).

## 8. MIDI Integration

Web MIDI API: navigator.requestMIDIAccess()
- Note On (0x90): trigger pad / sequencer note
- Note Off (0x80): release
- CC (0xB0): map to knob (auto-learn)

## 9. Performance Budget

Target: 60fps UI; allocation-free `process()` hot path; worker-timed
lookahead scheduling to minimise timing jitter at 145 BPM. There is **no
absolute "zero dropouts" guarantee** — GC-pause risk is minimised by design
(preallocated pools, no per-note nodes), and the optional WORKLET engine
moves rendering onto the audio thread, but real-time audio depends on the
host machine. The Self-Gate (15/15 MAIN, 3/3 WORKLET) is the regression
harness; it does not certify a host.
Memory: 20 SynthVoice + 24 DrumVoice (pre-allocated), 0 runtime allocations
in the `process()`/trigger hot path
CPU: Scheduler < 1ms, Voice trigger < 0.1ms, UI render < 8ms

## 10. Deployment

Option A: npx serve . (local dev server) — the device is native ES
          modules (js/*.js), so it needs an HTTP origin, not file://
Option B: Deploy to Cloudflare Pages / Netlify / GitHub Pages
          (static hosting serves the modules as-is — no bundler)

No build step. No dependencies. No server required.

## 11. Evidence Layer — CI Gates (v0.4.0)

The device verifies ITSELF in CI, using the same code paths a human presses:

- `tools/e2e.mjs` — zero-dependency CDP driver (bun/node>=22 native
  WebSocket): ephemeral no-store static server, fresh-profile headless Chrome
  with the autoplay-policy bypass, boots the MAIN engine via real UI clicks,
  presses RUN SELF-GATE, reads `window.__psy6Gates` (machine-readable), and
  emits `{gate, pass, evidence}` JSON. Exit code nonzero on any failure.
- `.github/workflows/ci-gates.yml` — job `verify` (verify.mjs + bun test)
  then job `gates` (headless Chrome e2e). `gates` is blocking; one automatic
  retry of the driver before going red; never `continue-on-error`.

Subset honesty: all MAIN-mode gates are pure computation or deterministic
OfflineAudioContext renders (fixed schedules; inequality/integer criteria —
never bit-exact audio), so CI has no realtime dependency. The WORKLET reduced
set (G14w/G15w) and live-scheduler loop checks stay local-only; they are
exercised from the live site at each release. See README "Self-Gate in CI".

## 12. MIDI / Capture / Stems / Share (v0.4.0)

**MIDI layer** — `js/midi.js` is a DOM-free core: bytes in (0x90/0x80/0xB0)
→ host callbacks out (`noteOn/noteOff/panic/dispatch`). Web MIDI access is
injected via a settable provider, so Bun tests drive a MockMIDIAccess
through the same code path as a real device. CC learn binds the next
received CC to a parameter path stored in `project.midiMap` (versioned);
dispatch resolves paths (`macro.N`, `master.vol`, `track.i.mix.*`,
`track.i.scAmount`) through pure `resolveMidiParam(p, path, v01)`. CC 0 is
ignored (bank select); CC 123 = PANIC. No MIDI clock sync — out of scope.

**Capture tap** — `js/capture.js`: a ScriptProcessorNode (deprecated but
universal; zero graph changes to the MAIN engine) taps the analyser output
in parallel (analyser → tap → zero-gain sink). Samples accumulate in
preallocated growable Float32 chunks (262144 frames); per-callback work is
one `.set()`; frame totals are Float64-tracked. Start/stop are quantized to
the scheduler's 16-step bar grid via `I.barHooks`; encoding reuses the
bounce `wavEncode` (no duplicate encoder). Stopping capture never touches
the transport.

**Stems** — `renderBounce(p, loops, {trackIdx})` reuses the exact bounce
graph; only track `i`'s events are scheduled, so every other track
contributes exactly 0 samples. The full-mix path is unchanged (same
schedule hash). `stemTracks()` reports the non-empty tracks.

**Share format** — project → canonical JSON (object keys sorted; array
order preserved) → `CompressionStream('deflate-raw')` → base64url →
`#p=<token>`. Canonicalization makes identical projects byte-identical
links. Guards: warn > 6 KB, refuse > 50 KB. Boot with `#p=` shows a consent
banner — the project is never loaded without an explicit click. Learner
state (`p.copilot`) travels inside the project payload.

---
Architecture version: 1.2
Status: IMPLEMENTED

## 13. Song Engine (v0.6.0)

```
arranger [scene,bars] ──► songSteps(p) generator  ◄── single source of truth
                              │  (live phase rule: sc.step = sc.step % newLoop;
                              │   empty scene → previous pattern continues;
                              │   scene.fill → 8 half-step kick hits)
                              ▼
        ┌────────── songSchedule (pure oracle, bun-tested) ──────────┐
        │  evs / sections / totalSteps / total — evHash-identical to │
        │  the render walk (G24 asserts equality)                    │
        └──────────────────────────┬─────────────────────────────────┘
                                   ▼
   renderSong: OfflineAudioContext + PooledEngine (SAME graph as loop bounce)
   per step: stepEvents(cp, phase) → eng.trigger     ── identical to schedTick
             applyLanes(cp, phase) → syncMix(cp, t=stepTime) / resolveMacros
   tail: +2 bars (32 steps) for delay/reverb release
                                   ▼
        wavEncode (EXISTING encoder) → psy6-song-<bpm>bpm.wav
```

- Deep clone: the render never touches the live project (loop-bounce guarantee).
- `syncMix(p, when)` gained an optional time anchor (defaults to
  `ctx.currentTime` — zero behavior change for live/loop paths); state-lane
  glides anchor exactly at their step time offline vs up-to-LOOKAHEAD early
  live (documented difference, same class as worker-timer jitter).
- Frame formula: `ceil(sr·(0.05 + (Σbars·16 + 32)·(60/bpm/4)))` — asserted
  exactly (10,075,254 @ 145 BPM / 136 bars) in tests + G24.
- PLAY SONG reuses `arrToggle(true)` (chain restart at section 0) + the
  existing transport start — zero new engine behavior. RECORD SONG reuses the
  existing capture tap + WAV encoder with an auto-stop bar hook.
- Gate-truth hygiene: canonical inventory (24 MAIN entries = 22 hard +
  2 evidence-only realtime G17/G25; WORKLET 3/3) documented above
  `runSelfGate()`; CI subset asserts all 22 hard gates. Gaps G3/G4/G7/G20
  never existed in any commit (git log -S) — left unrenumbered.
- PWA (v0.6.0): `manifest.webmanifest` + `sw.js` — **network-first** for
  navigations and same-origin GETs (cache is offline fallback ONLY), cache
  version const `psy6-v0.6.0` — **release checklist: bump this const on EVERY
  release** (grep it in tools/verify.mjs), `activate` cleans old caches,
  skipWaiting + clients.claim. Rollback rule: any staleness in live
  verification (served bytes ≠ tag SHA across two consecutive loads with SW
  active) → remove the SW registration, keep the manifest, document honestly.

## 14. Evolution + Interop (v0.7.0)

### Section variants — no identical repeats

```
compose(): base sections C1..C7 (form) ──► arranger steps (occurrence walk)
                 │                              │
                 │ family used n>1 times        │ occurrence j of a family
                 ▼                              ▼
   deriveVariant(basePat, sec, k)      st.scene = variantMap[base][j-1]
   (deep copy + seeded ops)            → DROP, DROP 2, DROP 3 …
```

- Op set (all seeded via `rngFor(seedInt, 'variant:<family>:<k>')`, nothing
  re-rolled): hat density/offset swap, bass octave shifts on off-phrase steps
  + velocity re-jitter + roll micro re-offset, lead motif re-processed through
  the foundation `MotifTransformer` (transpose/retrograde/omission/invert —
  rewritten with fillSection's cursor walk), perc re-seeding, pad voicing
  swap. **KICK (track 0) is sacred**: positions/note/micro/prob untouched;
  velocity accents only (`|Δvel| ≤ 0.1`).
- Lane deltas: one family-dedicated `(track,param)` pair per family via the
  param registry — DROP→(7,cutoff), DROP2→(4,res), BREAK→(6,detune),
  RISER→(2,mix.sendA), BUILD→(4,cutoff) — values open progressively with the
  variant index; the registry applies `state` lanes globally in array order,
  so the most open (last) curve governs (documented semantics).
- Difference contract: `variantStepDiff(a,b) = |D|/|U|` (union of on-steps;
  note / vel>0.02 / micro>2 count as different) — every pair incl. the base
  must reach `VARIANT_DIFF_MIN = 0.15`.

### MIDI export — shared expansion, pure writer

```
songSteps(p) ──► songSchedule  ──► renderSong ──► psy6-song-<bpm>bpm.wav
     │               (oracle)
     └──► songMidi(p) ──► writeMidi ──► psy6-song-<bpm>bpm.mid
          (bounce.js)      (js/midifile.js — pure format-1 writer)
```

- ONE expansion: both consumers walk the same `songSteps` generator +
  `stepEvents` — the `.mid == WAV schedule` identity is asserted
  note-for-note (bun) and by G26 (in-gate parse-back).
- Tick map: 1 step = ppq/4 = 120 ticks; bar = 4·480 = 1920; total =
  Σbars·4·480. Groove/micro offsets convert seconds → ticks at the same
  resolution (`off/sd·120`, rounded).
- Writer format notes: MThd (format 1, ntrks, division 480); track 0 =
  `FF 03` name + `FF 51` tempo (μs/quarter = 60e6/bpm) + `FF 2F` EOT; one
  MTrk per track with name meta + note on (`9n`) / off (`8n`) pairs; VLQ
  deltas (7-bit groups, continuation bit — multi-byte unit-tested); event
  ordering stable: tick ↑, off-before-on at ties (no stuck notes), pitch ↑.
- Channels (device convention): melodic (`kind==='synth'`) tracks → 1–8 in
  track order (budget: >8 melodic → export refuses); every drum-kind track →
  channel 10 (index 9, GM percussion) with its own preset note. `durTicks` =
  1 step — a trigger map; the WAV is the authoritative sound.

### Follow-action FSM (chain mode only)

```
scene active (chain on) ── bar boundary end (sc.step % 16 === 0) ──┐
   sc.followBarsIn++                                               │
   barsIn >= followBars(fw, scn, loop) ?                           │
     yes → followCount++                                           │
           resolveFollow(p, activeScene, followCount)              │
             - prob roll: rng()*100 >= prob → mode = 'next'        │
             - random: pool = scenes with patterns;                │
               pick = pool[floor(rng()*pool.length)]               │
             - next/prev: ±1 with wrap; empty → null (no skip)     │
             - scene: target if it has a pattern, else null        │
           nxt != null → I.pending = nxt   (SAME quantized path)   │
     no  → legacy chainNext at pattern-loop end (scenes without    │
           follow behave EXACTLY as before)                        │
```

- Seeding: `rng = mulberry32(fnv(projectSeed + ':' + transitionCounter))` —
  the counter increments per resolution in the transport session and resets
  at transport start, so the same seed + start replays the identical
  sequence (G27 pins the 20-transition walk for seed 424242).
- PRECEDENCE: PLAY SONG (arranger) never consults follows — the arranger's
  internal advance calls the captured launch directly; follow actions live
  ONLY in the `p.chain` branch of `schedTick`.
- `afterBars` overrides the section length: `afterBars > scene.bars >
  pattern loop (loopSteps/16 — the legacy cadence)`.

## v0.5.0 — UNLIMIT + COMPOSER

### Limits config (`js/limits.js`)

Single source of truth for hard ceilings: `MAX_TRACKS 16`, `MAX_STEPS 128`,
`MAX_SCENES 64`, `PATTERN_LENGTHS {8,16,32,64,128}`, `LOOP_CAP 1024`.
`DEFAULTS` (8 tracks / 16 steps / 8 scenes) preserve historical behavior.
Every consumer reads the config (no hard-coded numbers); raising a ceiling
never grows the pre-allocated voice pools — priority voice stealing absorbs
polyphony. Growth is always an explicit user action (+TRACK / length select /
+SCENE).

### Param registry + automation (`js/params.js`, `js/autorec.js`)

23 automatable parameters as `{id, label, min, max, def, target, apply}`;
`apply(target, v)` writes through to the live state with clamping — the same
path a knob uses. Lanes are `{track, param, pts, mode}`:

- `mode:'lock'` — legacy per-voice lane: values ride `ev.lock` into voices
  (stepEvents), no state writes. All pre-v0.5.0 lanes backfill to this for
  sound params → byte-identical legacy behavior.
- `mode:'state'` — live automation: the scheduler evaluates the lane
  (linear interpolation, `laneEval`) EVERY STEP and writes through the
  registry; mix/sidechain touches trigger an engine `syncMix`, macro lanes
  re-resolve targets, project params (`masterVol`, `macro.N`, `track:-1`)
  target the project.

Recording: ARM-AUTO (master enable) + per-lane arm (targets; multiple
simultaneous). Knob moves (mixer, synth editor, macros) and MIDI CC via the
existing midiMap funnel into `autoRecMove(track, param, raw)` which lands
points at the quantized playhead step (1/16 toggleable; exact fractional
position when off). Points replace on identical steps, insert sorted, cap
at 512. The automation editor (lane list + curve canvas + playhead) renders
from the same registry.

### Composer pipeline (`js/composer.js`)

Pure and deterministic — no DOM, no Date.now/Math.random; every decision
draws from `rngFor(seed, label)` sub-streams over the foundation primitives:

1. **Form**: section chain INTRO→BUILD→DROP→BREAK→RISER→DROP2→OUTRO with
   per-section energy arcs; `totalBars = minutes·bpm/4` snapped to multiples
   of 4; weights allocate bars (min 4, multiples of 4) with the remainder
   absorbed by the longest section — the bar sum equals the target exactly.
2. **Patterns**: one per section, `len = min(bars,8)·16` (respects the
   128-step ceiling; longer sections repeat their scene in the arranger).
   All tracks share the section length so `loopLen` is exact.
3. **Recipes**: kick/bass/hats/perc/snare/lead/pad/arp/fx scaled by the
   section energy; snare-roll fills end BUILD and RISER; the psy-push groove
   is composed INTO bass micro offsets on drops (project groove is global);
   the lead motif is generated on the scale and varied per section via
   foundation `MotifTransformer` (drops state it, BREAK inverts or
   retrogrades, BUILD fragments, RISER shifts octaves, OUTRO omits).
4. **Lanes**: BUILD lead cutoff sweep + RISER pad sendA/B rise, written as
   `mode:'state'` lanes through the registry.
5. **Output**: scenes renamed by section (color-tagged, bars override set),
   9th FX track with the riser preset, arranger `[{scene,bars}]` pre-loaded,
   `p.arranger.on`. Same seed+style+minutes → byte-identical project;
   different seeds → different fingerprints (tested across 20 seeds).

## 15. Scene State + Master + Stems (v0.8.0)

### Scene mix snapshot model

```
scene.mix = null                                     ← legacy/absent (zero change)
          | { tracks: { [trackIdx]: { vol, pan, sendA, sendB, scAmount } },
              master?: { eqLow, eqMid, eqHigh, compOn, compThresh, compRatio,
                         compAttack, compRelease, compMakeup },
              note?: string }
```

`normalizeSceneMix` (js/scenes.js) validates + clamps into CANONICAL form —
ascending track keys, registry field order — on every write AND on load
(`loadProjectObj` scene rebuild; the same canonical-order pitfall the
follow-actions run documented). Everything invalid/empty → null.

### Application path (one primitive, three callers)

```
PERF.launch (instant) ─────────────┐
scheduler pending-launch (quantized:│─→ applySceneMix(p,i) → eng.syncMix(p, WHEN)
  PLAY SONG / chain / follows) ─────┤         (registry writes; WHEN = launch anchor:
renderSong sectionStart (offline) ──┘          ctx-time | bar boundary | exact step)
```

Precedence: the snapshot writes the mix state AT the launch; the per-step
automation player (`applyLanes`) evaluates on top every step — continuous
lanes win per-step. Composer snapshots are pure functions of (section id,
energy, variant index): INTRO low / BUILD rising (bass duck 40) /
DROP+DROP2 full+dry (bass duck 55) / BREAK spatial, duck off / RISER swell,
duck off / OUTRO fall; variant pan lean ±0.12; KICK level never in a
composer snapshot.

### Master chain (v0.8.0)

```
tracks ─┬─ input → duck → pan ──┬──────────────→ master ─ eqLow ─ eqMid ─ eqHigh ─┐
        │      (post-fader)     └→ sA → delay bus ────────────┘                  │ (compOn 1)
        │                                 └→ sB → reverb bus ──┘   eqHigh → glueComp → makeup ─┘
        └───────────────────────────────────────────────────────→ (compOn 0: straight to) → masterComp → analyser → out
```

compOn 0 (default) REMOVES the glue node from the graph (rewire, not
threshold-bypass) — neutral. `applyMaster(p, when)` is the single apply path
(called from syncMix with the same anchor); `opts.masterFlat` builds the
exact pre-v0.8.0 topology for the G29 neutral A/B. The 9 master params are
registry params (project target ⇒ lane.track −1 ⇒ automatable, ARM-AUTO
recordable, MIDI-learnable via `master.<param>` denorm, snapshot-able via
`scene.mix.master`). `ensureMaster` backfills+clamps legacy projects.

### Single-renderer song API (js/bounce.js)

```
renderSong(p, {
  trackFilter  → stem of ONE track (events filtered — other tracks never
                 spawn voices; fill flourish only on track-3 stems)
  bounds       → [startBar,endBar) SECTION = full arrangement render SLICED
                 (startFrame = LEAD before the section; N = sectionFrames)
  ctrl         → progress + cancel (unchanged)
})
pcmFromBuffer(buf, startFrame, N) → wavEncode — the slicing step
```

Why bounds = full render + slice (measured, not assumed): skipping events or
shortening the offline buffer perturbs the whole Chrome offline render at the
1e-3 level even FAR BEFORE the change point (each path is individually
deterministic; identical event set + identical buffer length = bit-exact —
bounds [0,136] over the 136-bar song matched the full render exactly).
The only way a section is sample-equal to the song is to BE the song's
render, sliced. Cost equals a SONG bounce; SONG_MAX_SEC + songStemsGuard
(per-stem 10 min, 60 audio-minute total budget) are the memory caps.

The UI (power-screen row + header modal) collects style/length/seed, guards
overwrites with an explicit confirm, and lands on the Perform tab with the
arranger active — composition happens in a fresh in-memory project the user
keeps or discards.

### Shortcut registry (`js/shortcuts.js`)

Single table drives both the keydown dispatcher and the help overlay;
`findCollisions()` is unit-tested empty. The registry is the audit record:
before v0.5.0 the only global bindings were Space/r/z/1-8 (header.js);
1-8 moved to pad triggers, track selection to Shift+1-8, and arrows, f, v,
b and ? were added.

---
Architecture version: 1.4
Status: IMPLEMENTED

## 16. Scene Evolution + Pro Growth (v0.9.0)

### Chord progression engine (`foundation/music/progression.mjs`)

One seeded progression per project: 12 templates per style family (4/8-bar
loops of diatonic degrees 0..6), picked by `fnv1a(seed + ':prog')`. A chord
is the DIATONIC TRIAD (d, d+2, d+4) — mode-aware because the semitones come
from the style's own scale (phrygian/minor/harmonic-minor). The project
carries `p.harmony = { family, progId, progBars, degrees }` so gates, the
library and evolution can re-derive chords without re-composing. The
composer bakes per PATTERN bar (`chord = degrees[patternBar % progBars]`,
offset 0 — section starts are harmonic anchors): bass roots, lead-motif
snap (nearest chord-tone class, deterministic tie-break), pad root+fifth,
arp chord-tone cycles. **Rhythm tracks never consume the progression**;
their v0.8.0 bytes are pinned by 15 digests. The harmonic invariant is
audited through the SHARED `songSteps` expansion (the same walk renderSong,
songMidi and the live scheduler bookkeeping use) — 0 violations over 69k+
notes in the bun suite, 0 over 8,448 in gate G31.

### Evolution pipeline position (`js/evolution.js`)

```
scene launch (applySceneMix glide) → EVOLUTION (event-list transform) → lane automation (locks/registry)
```

Evolution rewrites the EVENT LIST at each step of the song walk — never the
pattern data, never the timing grid. Base events come from `stepEvents`
(the one deterministic per-step function every consumer already shares);
ops are seeded per (evolution seed, absolute song bar, step-in-bar) via
`barSeed`; results flow through the existing lock channel (voice-level
param overrides) clamped to param-registry ranges. PRECEDENCE: where a lane
covers a (track,param) pair at a step, the LANE WINS — evolution only fills
lane-free pairs (documented in code and here). Bass rolls inject the chord
root of the AUDIBLY active PATTERN bar (not the song bar — 8-bar progressions
repeat inside longer sections and the baked harmony is what sounds). The
offline walk knows the absolute bar directly; the live scheduler derives it
from the arranger position (`absBarOf`) and pauses evolution when the
arranger is off (no song position — manual launches stop the arranger).
`p.evolution = { on: false, intensity: 35, seed? }` is materialized lazily;
OFF/absent → `stepEvents` output is returned untouched (the byte-identity
contract G32 pins).

### Library = recipes (`js/library.js`)

`p.library = null | { songs: [{id,name,style,seed,len,composerMeta}],
activeSongId }`. A song is the compose() INPUT TUPLE — rendering means
`compose(style, len, seed)` in memory (deterministic, byte-reproducible);
no pattern data is duplicated. Ids derive from fnv of the recipe content +
sequence (deterministic). Persistence: absent → null; a present library is
rebuilt canonically inside `loadProjectObj` (invalid entries dropped,
active pointer fixed) — the same load→save byte-stability discipline as
scenes. Album continuity (stash/restore) lives in the UI glue
(`js/ui/library.js`): LOAD and library-target COMPOSE NEW carry the album;
the plain header COMPOSE starts fresh (intentional).

### Form-growth tiers (`js/composer.js`)

Lengths ≤8 min keep the per-style 7-section chains (byte-identical, pinned).
Lengths >8 min compose the 11-section EXTENDED_CHAIN (INTRO, BUILD, DROP,
BREAK, RISER, DROP2, BREAK2, BRIDGE, DROP3, OUTRO, OUTRO2 — weights sum 1)
and map every section to a canonical BEHAVIOR (`beh`: DROP2/DROP3→DROP,
BREAK2/BRIDGE→BREAK, OUTRO2→OUTRO) consumed by `fillSection`,
`sectionMotif` and `mixForSection`, so grammar, snapshots and motif ops
stay coherent on new sections. `allocateBars` walks the PASSED weight list
(the Run-15 NaN regression is pinned). Memory tiers: full-song renders
refuse >`SONG_HARD_MAX_SEC` (1800 s) before any Web Audio allocation
(unit-tested null return); 10–30 min renders are user-confirmed with the
progress/cancel modal; stems and SECTION bounce keep the 10-min
`SONG_MAX_SEC` cap via `songStemsGuard`. Long-form project JSON exceeds the
~5 MB localStorage quota (12-min ≈ 3.8 MB, 20-min ≈ 6.4 MB) — SAVE fails by
design there; EXPORT/SHARE unaffected (documented in README + CHANGELOG).

## 17. Sonic Palette (v0.10.0)

### Sample pipeline (import → store → cache → trigger)

```
file (≤20s, ≤50MB, ≤128 rows)
  → decodeAudioData → Float32Array[] (per channel)
  → makeRecord: id = 'S'+fnv1a(name:length:sampleRate:first-4096-samples)
     (id computed BEFORE normalize → re-import idempotent)
  → optional normalize (peak → 0.95, f32-measured metadata) + reversedCopy
  → IndexedDB 'psy6-samples'/'samples' (injectable backend: memory in Bun)
  → engine cache: PooledEngine.loadSampleBuffer → AudioBuffer pair
    (normal + pre-reversed) — context-independent, shared live/offline
  → trigger(): voiceMode==='sample' && cache hit
     → per-hit AudioBufferSourceNode + env GainNode → chain input
     playbackRate = 2^(tune/12); slice = [startPct,endPct)% (pre-reversed
     PCM for reverse); release extends past the slice end
     → per-track active-voice cap 8, TIME-AWARE oldest-stolen stop()
       (only voices competing at `when` count — the offline walk schedules
       the whole song upfront; a time-blind stealer would stop() future
       sources and silently drop hits — caught by G34's own numbers)
  → missing sample → synth fallback (counted: renderSong.sampleFallbacks,
     one-shot UI toast)
```

Persistence split (THE contract): project JSON carries `sampleId` +
`sampleMeta {name,durationSec,peak}` + `sampleParams` + `sampleHints`
(names only) — NEVER PCM. localStorage/save/share are metadata-only by
construction; file EXPORT may bundle base64 PCM behind an explicit confirm
with a 30 MB base64 hard guard; IMPORT rehydrates into IndexedDB. The
injectable-backend interface (`createSampleStore(backend)`) keeps the whole
store Bun-testable (memory backend) — the MockMIDI pattern.

### Insert chain (per track, pre-send)

```
input ─→ dTrim ─→ dWS ─→ dWet ─┐
   └───→ dDry ─────────────────┴─→ cIn ─→ cWS ─→ [filt] ─→ duck ─→ pan
                                                     (filt REMOVED when off)
                                                        ↑ sends tap after pan
```

- Defaults are EXACT bypass: drive 0 → dTrim 1 / dWet 0 / dDry 1 (the wet
  branch contributes exact zeros; ±0 sign flips are the only theoretical
  artifact), crush 16 → null-curve WaveShaper passthrough, filter node
  REMOVED. G35 proves the neutral contract in-session (perturb→restore
  maxDiff 8.94e-8 < 1e-6) + structurally (zero nodes restored) + at the
  schedule layer (all pure-JS pins).
- WHY drive is trim+fixed-curve (not a per-amount curve grid): WaveShaper
  `.curve` swaps and node reconnects are NOT time-anchorable — offline
  bounces walk the whole song before rendering, so curve swaps would apply
  the FINAL curve to the entire render. The composer's ins lanes (BUILD
  filt sweeps, RISER filt+drive rise) must be time-correct offline; the
  trim/wet/dry path is pure AudioParam automation and is. Known honest
  limitation: user-drawn insCrush lanes render with the final bits offline
  (composer never emits them).
- Chrome OfflineAudioContext renders are NOT bit-identical across sessions
  (observed: 3 sessions → 3 PCM hashes at an identical scheduleHash);
  within a session identical graphs ARE bit-identical (G34 maxDiff 0.0).
  All cross-machine pins are therefore pure-JS (schedules/JSON); PCM
  comparisons are in-session only, with the documented tolerance doctrine.

### Composer integration

BUILD opens `insFiltFreq` lanes on lead (5) + pad (6); RISER opens the perc
(3) filter + rises its drive. Base states `filtOn:1` on those tracks
(mode-static offline). The kick (track 0) NEVER receives inserts or insert
lanes — sacred, pinned. `COMPOSER_SAMPLE_HINTS {0:'kick',3:'perc',6:'atmos'}`
ride the compose result and the project as names-only provenance; resolved
once at compose arrival against the store (hit → sample voice baked, miss →
synth + toast), never re-applied on RESUME.

## 18. Resample + Slices + Key (v0.11.0)

### Resample (realtime) and Freeze (offline)

RESAMPLE reuses the v0.4.0 CaptureTap state machine verbatim: a RESAMPLE
arm is `armed-start` with an auto-stop counter — the bar hook decrements
it once capturing and finishes at exactly the Nth boundary (quantized
start, transport never touched). `resampleFrames(bars, bpm, rate)` is the
pure trim target (the capture START is bar-quantized, so [0, want) is the
window; realtime scheduler skew of a few ms is documented — evidence
class, like G17/G25). The sink hands raw Float32 channels to the SAMPLES
drawer, which stores them through the ONE programmatic import path
(`importChannelsAsSample` — count guard → makeRecord → name+hash8 → put →
engine cache → drawer refresh).

FREEZE renders one pattern loop of one track through the ONE renderer:
`freezePrep(p, idx)` deep-clones the project and zeroes the track's
sendA/sendB/scAmount (POST-insert PRE-send tap point: inserts baked,
sends and sidechain excluded — a frozen track re-sent does not double
sends or ducking), then `renderBounce(cp, 1, {trackIdx})` — the proven
STEM path. The 0.05 s schedule lead is trimmed with `pcmFromBuffer` so
frame 0 of the sample is the loop's first step; sample-voice playback then
aligns like the original pattern. The MASTER section (EQ3 + glue + comp)
IS baked — there is no pre-master tap without a parallel renderer
(forbidden); G36 logs the resulting double-master RMS delta when the
frozen sample is re-rendered (−3.8 dB on the demo kick loop: the legacy
comp re-squashes already-mastered material — bounded, measured,
documented, not hidden). Tails past the loop end truncate exactly as
stems have always rendered.

### The one-renderer steal-fix (v0.11.0)

The sample-voice cap-8 oldest-stolen `stop()` was no-arg. During an
OFFLINE schedule walk (all triggers scheduled before `startRendering()`)
a no-arg stop executes at wall-clock — BEFORE the render — and erases the
stolen future-scheduled hit entirely (G36 caught it: a frozen 8-bar kick
loop retriggered per-step lost its whole first cap window). The steal now
stops the source at the steal moment `when` (time-anchored): live
semantics unchanged, offline time-correct, and the env is reaped by
`onended` instead of a synchronous disconnect (same wall-clock hazard).

### Derived samples (non-destructive editing)

Every edit op (fade-in/fade-out/gain/normalize/reverse) bakes a NEW PCM
copy into a NEW record: id = `fnv(baseId + ':' + op + ':' +
canonicalParams)` — canonical params are clamped/rounded BEFORE both the
id and the math, so the id always describes the actual PCM and
re-derivation is idempotent (same inputs → same id → the put replaces).
Chains chain from the parent id (the effective base). The base import is
byte-immutable; derived records own their PCM copies (deleting the base
orphans only the lineage display). Slice derivations (`kind: 'sliced'`)
are the exception that proves the rule: they SHARE the base PCM arrays
(no duplication) and store the detected boundaries as pct metadata; their
id hashes the detected pcts, so re-detection is idempotent too.

### Slicing + per-step locks

`detectTransients` is a pure energy-flux onset detector (512-frame hop
RMS → positive flux → 1.5×-mean adaptive threshold → strongest-first
greedy pick, 35 ms spacing, 16 cap, stable tie-break): same PCM in, same
boundaries out, forever. Playback resolves `sliceIdx` against a sliced
record's pcts inside the PURE `samplePlayback` (slice k = [pcts[k−1],
pcts[k]) — replaces the start/end window; 0 = full sample). Per-step
selection rides the EXISTING lock channel: `ev.lock.smpSlice` (the
registry param id) overrides the track's sliceIdx for that hit — so
lanes, ARM-AUTO recording, MIDI-learn and snapshots work by construction
with zero new persistence surface. SLICES → STEPS writes the classic
breakbeat fill (step i → slice (i mod N) + 1, all steps ON) through the
normal pattern model.

### Key detection

`js/keydetect.js` computes a 12-bin chroma by direct DFT at the pitch-
class fundamentals (C4 base) over the sample's mid section ([25%, 75%),
4 s cap) and correlates it against the rotated Krumhansl-Schmuckler
major/minor profiles (Pearson r; deterministic scan order). The scanned
register is C4..B4 — a documented honest limitation (fundamentals-only).
`tuneToRoot` maps the sample's tonic onto the project root pitch class
with the minimal signed shift ((rootPc − samplePc) mod 12 folded into
−5..+6 — the same destination as the literal 0..11 reading, smallest
voice-leading). The KEY → ROOT button applies it to the selected track's
`sampleParams.tune` and logs key, r, delta and before → after in the
toast. Composer output is UNCHANGED this run (form-fp + legacy pins
asserted at Phase 0 and by every battery).
