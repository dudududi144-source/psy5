# FOUNDATION STATUS

## Reconciliation Gate — Final Report

### Foundation HEAD
`9063064cd849cd3b24d9f9cb4ef471d3cfbfdb4b` (post-final-polish, pre-gate)

### PSY4 HEAD
`6d15032` — "FOUNDATION RECONCILIATION: audit psy4 vs psy-foundation"

### Foundation tests
250 pass / 0 fail (13 packages: 10 lib + 3 apps)

### PSY4 tests
104 foundation tests pass (transport 60 + radio 44) + pre-foundation verified
subsystems (BeatPLL 48, MelodyObserver 13, PatternMutator, RadioStateGate 8, Learning 4).

### Canonical Transport
**NOT CANONICAL.** Foundation transport is missing 10 critical features vs PSY4:
epoch, source, holdover, AudioContext integration, predictBeats, subscribe,
seek, setTempo, out-of-order rejection, stale event policy. PSY4's MusicalTransport
is the proven reference. See `audit/CONTRACT_GAPS.md` GAP-T1..T10.

### Canonical Radio
**NOT CANONICAL.** Foundation analysis mixes signal/features/inference. PSY4's
RadioObservationLayer enforces strict separation (SIGNAL → FEATURES → OBSERVATION
→ INFERENCE → TRANSPORT). 4 critical gaps. See GAP-R1..R4.

### Canonical Scheduler
**NOT CANONICAL (different purpose).** Foundation scheduler is offline
(plan→events). PSY4's scheduler is runtime (AudioContext-driven with lookahead).
An adapter is required. The 414ms bug (predictBeats(0.15) at 145 BPM = empty
array) is FIXED in PSY4 by computing 16th-note times from the beat grid. See
GAP-S1..S3.

### Canonical Protocol
**CANONICAL CANDIDATE.** Foundation protocol is more complete than PSY4's
(PSY4 has no formal protocol). Add versioning (GAP-P1) and it's canonical.

### Canonical Device SDK
**CANONICAL CANDIDATE.** Foundation device-sdk is clean and decoupled. Add
local scheduling hooks (GAP-D1) and it's canonical.

### Duplicate implementations
1. **Transport**: foundation TransportClock vs psy4 MusicalTransport.
2. **Radio**: foundation Analyzer vs psy4 RadioObservationLayer.
3. **Scheduler**: foundation offline scheduler vs psy4 runtime scheduler.
4. **BeatPLL**: foundation BeatEstimator vs psy4 `src/lib/beatPLL.ts`.

### Migration required
**YES** — but NOT during this gate. Per Rule 0: no migration, no runtime
replacement. The migration plan (`audit/MIGRATION_PLAN.md`) defines 5 phases
(A-E). This gate performs Phase A only (consumer contract tests that document
gaps). Phases B-E are post-gate.

### Current runtime safety
**SAFE.** PSY4's runtime is untouched. No migration performed. No runtime
replacement. The foundation's 250 tests still pass. PSY4's 104 tests still pass.

### Blocking conflicts
17 critical contract gaps (10 transport + 4 radio + 3 scheduler) that MUST be
closed before foundation can be canonical for those domains. Documented in
`audit/CONTRACT_GAPS.md` and proven by failing tests in
`tests/consumer-contract/`.

### Recommended next migration
**Phase B** of the migration plan: bring foundation transport up to PSY4's
feature level (epoch, source, holdover, AudioContext, predictBeats, subscribe,
seek, setTempo, out-of-order rejection). Port PSY4's 60 transport tests to the
foundation. Build `FoundationTransportAdapter`. Then Phase C: migrate PSY4's
protocol layer to foundation protocol. Then Phase D: prove a second consumer
runs in a browser. Then Phase E: delete PSY4's duplicate implementations.

## Per-domain summary

| Domain | Status | Recommendation | Critical gaps |
| --- | --- | --- | --- |
| TRANSPORT | NOT CANONICAL | PSY4 REFERENCE ONLY | 10 |
| RADIO | NOT CANONICAL | PSY4 REFERENCE ONLY | 4 |
| SCHEDULER | NOT CANONICAL | ADAPTER REQUIRED | 3 |
| PROTOCOL | CANONICAL CANDIDATE | CANONICAL FOUNDATION | 0 (1 low-risk) |
| DEVICE SDK | CANONICAL CANDIDATE | CANONICAL FOUNDATION | 0 (1 low-risk) |
| MUSIC | CANONICAL CANDIDATE | CANONICAL FOUNDATION | 0 |
| MATERIAL | CANONICAL CANDIDATE | CANONICAL FOUNDATION | 0 (2 low-risk) |
| DSP | CANONICAL CANDIDATE | CANONICAL FOUNDATION | 0 |
| FIXTURES | CANONICAL CANDIDATE | CANONICAL FOUNDATION | 0 (3 low-risk) |
| LEARNING | CANONICAL CANDIDATE | CANONICAL FOUNDATION | 0 |

## What this gate produced

- `FOUNDATION_FREEZE.md` — baseline snapshot
- `audit/FOUNDATION_RECONCILIATION.md` — cross-repo comparison
- `audit/MIGRATION_PLAN.md` — 5-phase migration path (A-E)
- `audit/CONTRACT_GAPS.md` — 17 critical + 7 low-risk gaps documented
- `tests/consumer-contract/transport-contract.test.ts` — contract tests (expected to fail)
- `FOUNDATION_API.md` — versioned API reference
- `FOUNDATION_STATUS.md` — this report

## Final rule (verified)

PSY4 is the proven reference. Foundation is the canonical target. The gate
proves the foundation is NOT YET ready to be canonical for transport/radio/
scheduler — but it IS ready (or near-ready) for protocol/device-sdk/music/
material/dsp/fixtures/learning. No migration was performed. PSY4's runtime
is safe.
