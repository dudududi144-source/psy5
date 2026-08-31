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

DrumVoice:
  noise -> bandpass -> gain -> out -> master
  osc -> gain -> out

Master chain:
  master -> compressor -> limiter -> analyser -> destination

## 7. Preset System

Genres: TECHNO, PSYTRANCE, TRANCE, PROGRESSIVE
Categories: drum, bass, lead, pad, pluck, arp, fx

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
Architecture version: 1.3
Status: IMPLEMENTED
