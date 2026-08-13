# psy-foundation

> Shared musical infrastructure for the PSY device family.
> Not a device — the gravity every PSY device is built on.

[![tests](https://img.shields.io/badge/tests-250%20pass-brightgreen)]()
[![packages](https://img.shields.io/badge/packages-13-blue)]()
[![license](https://img.shields.io/badge/license-MIT-blue)]()

SHARED TIME · SHARED PROTOCOL · SHARED MUSICAL LANGUAGE · SHARED MATERIAL ·
SHARED LEARNING PRIMITIVES — but every device stays LOCAL, DETERMINISTIC,
INDEPENDENT, MUSICAL.

## Quick start

```bash
bun install
bun test          # 250 tests, all green
bun run benchmarks  # real numbers
```

## Packages

### Library packages (10)

| Package | Tests | Purpose |
| --- | --- | --- |
| [`transport`](packages/transport) | 12 | MusicalTransport: beat/bar/phase/bpm/confidence. Observer-fed PLL with octave-fold. |
| [`protocol`](packages/protocol) | 8 | MusicalEvent types + Channel abstraction. Transport-agnostic messaging. |
| [`device-sdk`](packages/device-sdk) | 12 | PsyDevice interface + DeviceHost + ReferenceDevice. |
| [`fixtures`](packages/fixtures) | 10 | 14 synthetic radio fixtures (deterministic, seeded). |
| [`scheduler`](packages/scheduler) | 18 | MusicalPlan → ScheduledEvent[]. Deterministic pure function. |
| [`analysis`](packages/analysis) | 26 | onset/beat/tempo/pitch/chroma/spectral features. Multi-hypothesis tempo. |
| [`music`](packages/music) | 43 | 18 scales, 18 chords, motif generator, variation ops, bass grammar, rhythm. |
| [`material`](packages/material) | 23 | 9 material kinds + MaterialLibrary + seed library. |
| [`learning`](packages/learning) | 32 | CONTEXT+ACTION+OUTCOME+REWARD. DO NOTHING is legal. Contextual bandit. |
| [`dsp`](packages/dsp) | 39 | PolyBLEP osc, Moog filter, ADSR, delay, reverb, metering, voice pool. |

### Research apps (3)

| App | Tests | Purpose |
| --- | --- | --- |
| [`reference-lab`](apps/reference-lab) | 5 | Analyze audio → BPM, beat grid, phase, key, energy, features, sections. |
| [`sync-lab`](apps/sync-lab) | 7 | Simulate devices A/B/C → sync, drift, relock verification. |
| [`benchmark-lab`](apps/benchmark-lab) | 11 | Full benchmark suite: timing, runtime, music, learning. |

**250 tests total. All green.**

## Usage examples

### Transport — track beats from a radio

```typescript
import { TransportClock } from '@psy-foundation/transport';

const clock = new TransportClock({ initialBpm: 120 });

// Radio observer pushes beats (NOT pulled):
clock.observe({ observedAt: 1.0, strength: 1 });
clock.observe({ observedAt: 1.4, strength: 1 }); // 150 bpm

const snap = clock.snapshot(2.0);
console.log(snap.bpm, snap.beat, snap.phase, snap.locked);
```

### Scheduler — convert a plan to events

```typescript
import { schedule, step, emptyTrack } from '@psy-foundation/scheduler';

const kick = emptyTrack('kick', 'kick', 36, 16, 0.5);
kick.steps[0] = step({ on: true });
kick.steps[4] = step({ on: true });

const events = schedule(
  { tracks: [kick], fromBar: 0, barCount: 1 },
  { originAudioTime: 0, bpm: 150, beatsPerBar: 4 }
);
```

### Music — generate a motif

```typescript
import { generateMotif, getScale } from '@psy-foundation/music';

const scale = getScale('phrygian-dominant');
const notes = generateMotif(4, scale, { seed: 42, steps: 32 });
// 32-step call-&-response motif in E phrygian dominant
```

### Learning — contextual bandit with abstention

```typescript
import { Learner } from '@psy-foundation/learning';

const learner = new Learner({ policy: { epsilon: 0.1, abstainThreshold: 0.1 } });

const decision = learner.decide(context, 'lead', [
  { type: 'play', materialId: 'motif-1' },
  { type: 'play', materialId: 'motif-2' },
]);

if (decision.action.type === 'do-nothing') {
  // The system chose to stay silent — sometimes the best move.
}

learner.recordOutcome(context, 'lead', decision.action, { type: 'sounded', durationSec: 0.5 }, audioTime);
```

### DSP — pooled voice synthesis

```typescript
import { PolyBlepOsc, MoogLadder, Adsr, VoicePool } from '@psy-foundation/dsp';

const osc = new PolyBlepOsc({ waveform: 'saw', sampleRate: 44100, frequency: 220 });
const filter = new MoogLadder(44100, 800, 0.7);
const env = new Adsr({ sampleRate: 44100, attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3 });

// Process one sample:
const sample = filter.process(env.process() * osc.process());
```

## Architecture

```
                    psy-foundation
                          │
             ┌────────────┼────────────┐
             │            │            │
          TRANSPORT     MUSIC        AUDIO
             │            │            │
             └────────────┼────────────┘
                          │
                      DEVICE SDK
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
       PSY6             DRUMS             SAMPLER
        │                 │                 │
        └─────────────────┼─────────────────┘
                          │
                         FX
                          │
                    FUTURE DEVICES
```

## Non-negotiable rules

1. **Investigation before code.**
2. **One source of truth** per piece of musical state.
3. **Radio is observer, not clock.**
4. **Transport ≠ renderer ≠ radio ≠ UI.**
5. **No device policy.**
6. **Every claim has evidence.**

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

## Benchmarks

Run `bun apps/benchmark-lab/src/index.ts` for the full suite. Headline numbers:

- **Transport accuracy**: perfect-150 median phase error **0.01ms**, P95 3.7ms
- **Sparse fix**: sparse fixture correctly estimates 150 BPM (was 75 in M1)
- **Runtime**: transport snapshot < 10μs, DSP osc < 1μs
- **Learning**: abstention works — DO NOTHING chosen when best reward < threshold

## Relation to the PSY family

- **NOVA** — generation/orchestration (agent layer). Sibling, not a dependency.
- **FORGE** — validation/CI/delivery. Foundation publishes a benchmark contract that Forge consumes.
- **PSY DEVICES** — products built on this foundation.

## License

MIT — see [LICENSE](LICENSE).
