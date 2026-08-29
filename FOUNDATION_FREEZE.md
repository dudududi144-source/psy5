# FOUNDATION FREEZE

> **Device-lineage note.** This repository is the home of the **PSY6** device.
> The PSY4/PSY5 references below are historical records from the foundation
> reconciliation gate (the provenance of the PSY device family: PSY4 → PSY5 →
> PSY6). They describe the state of the external `psy-foundation` repo at
> gate time; the current device is PSY6, built on psy-foundation.

This document captures the exact state of `psy-foundation` at the start of the
Reconciliation + Canonical Foundation Gate. It is the baseline against which
all reconciliation work is measured.

## Snapshot

| Field | Value |
| --- | --- |
| HEAD | `9063064cd849cd3b24d9f9cb4ef471d3cfbfdb4b` |
| remote HEAD (origin/main) | `9063064cd849cd3b24d9f9cb4ef471d3cfbfdb4b` |
| Branch | `main` |
| Worktree status | clean (no uncommitted changes) |
| Test count | 250 pass / 0 fail (357,016 expect() calls) |
| Lint | clean (biome, 112 files) |
| Typecheck | clean (13 packages) |
| Build | `bun run build` not run (per user rule: never `bun run build`) |
| Last commit message | `Final: LICENSE, CONTRIBUTING, data files, protocol docs, benchmark results` |

## Package list (13)

### Library packages (10)
1. `@psy-foundation/transport` — 12 tests
2. `@psy-foundation/protocol` — 8 tests
3. `@psy-foundation/device-sdk` — 12 tests
4. `@psy-foundation/fixtures` — 10 tests
5. `@psy-foundation/scheduler` — 18 tests
6. `@psy-foundation/analysis` — 26 tests
7. `@psy-foundation/music` — 43 tests
8. `@psy-foundation/material` — 23 tests
9. `@psy-foundation/learning` — 32 tests
10. `@psy-foundation/dsp` — 39 tests

### Research apps (3)
11. `@psy-foundation/reference-lab` — 5 tests
12. `@psy-foundation/sync-lab` — 7 tests
13. `@psy-foundation/benchmark-lab` — 11 tests

## Repository contents

- `packages/` — 10 library packages
- `apps/` — 3 research apps
- `benchmarks/` — transport-accuracy.ts + analysis-accuracy.ts
- `data/` — scales.json, motifs.json, rhythms.json, presets.json, styles.json
- `docs/` — architecture/forensic-audit.md, protocol/protocol.md, research/final-benchmarks.md, research/transport-benchmark-m1.md
- `.github/workflows/ci.yml` — CI pipeline
- `LICENSE` (MIT), `README.md`, `CONTRIBUTING.md`
- `biome.json`, `tsconfig.base.json`, `bun.lock`

## What this freeze means

- This is the **baseline** for the reconciliation gate.
- Any changes during the gate MUST be additive (audit docs, contract tests) —
  not destructive (no migration, no runtime replacement, per Rule 0).
- If the gate produces a different HEAD, the freeze document is updated to
  reflect the post-gate state, with the pre-gate HEAD preserved here.

## Reference: PSY4

PSY4 is the **reference runtime** at this gate. It is NOT in this repository.
Its runtime has been proven in browser with continuous playback. The
foundation's job is to become the canonical shared infrastructure that PSY4's
proven subsystems can eventually migrate to — but NOT during this gate.

PSY4 repository: `https://github.com/dudududi144-source/psy4`
PSY4 proven runtime path: `RADIO → RadioObservationLayer → MusicalTransport → Scheduler → AudioContext → continuous playback`

## Date

Frozen at the start of the Reconciliation + Canonical Foundation Gate.
