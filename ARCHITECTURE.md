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

---
Architecture version: 1.1
Status: IMPLEMENTED
