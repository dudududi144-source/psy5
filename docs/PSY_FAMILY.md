# PSY6 & the PSY family — roles, wire, and the Task 19 adoption record

> Written by the psy-foundation lead engineer (Task 19, owner-authorized write).
> The device line is PSY4 → PSY5 → PSY6; this repository (named `psy5`) hosts the
> **PSY6** groovebox. Numbers below are measured, not claimed.

## 1. The family contract (one sentence per law)

- **foundation owns HOW-it-sounds.** Voices → bus glue → master chain, plus the
  PSYBUS v2 protocol and the render endpoint. Its render defines "correct"
  (8-bar seed-42 md5 `f2f81ed62a25743358417bed75ab67f7`, −10.7 LUFS, −1.2 dBTP).
- **Devices own WHAT-and-when.** Patterns, sections, live manipulation. A device
  never re-implements the master chain, the voices, or the protocol.
- **The wire is one codec.** PSYBUS v2 — vendored verbatim
  (`foundation/protocol/v2/*` are byte-identical copies of psy-foundation
  `packages/protocol/src/v2`, md5-verified at vendor time). No dialects.

## 2. Roles matrix (no duplicates)

| Member | Serious role | Personal capabilities (non-duplicated) | Wire status |
| --- | --- | --- | --- |
| **psy-foundation** | The engine: voices, bus glue, master chain, protocol, render endpoint | Deterministic render (md5-pinned), forensic route, acceptance gate, Tier 0–3 support ladder | IS the standard |
| **psy-anthem** | The composer: anthems/arrangements rendered by the engine | WHAT→HOW over HTTP (Task 17-b) | ✅ proven (17-b) |
| **psysampler** | The looper: rhythm, slices, live manipulation | Layered drum lanes, loudness-economics table (Task 18) | ✅ proven (18) |
| **PSY6 (this repo)** | The groovebox: song forms, scenes, grooves, CO-PILOT | Section arranger (scene = {pattern, bars}), 13 groove templates, 8 fill layouts, per-step prob/micro/vel resolved by the device's own deterministic walker, contextual-bandit CO-PILOT, pooled-voice worklet engine | ✅ proven (19, this document) |
| `psy-sampler` | — | ⚠️ separate repo also claiming the sampler role — owner decision pending (flagged in Task 18) | — |

## 3. What Task 19 actually wired

1. **Codec, verbatim.** `foundation/protocol/v2/{types,envelope,deprecations}.ts`
   copied byte-identical from psy-foundation. The stale v1 dialect files
   (`channel/events/state.ts` — zero references, the exact "third dialect" trap
   the 2026-09-04 audit warned about) were deleted.
2. **The bridge, one place.** `js/family-wire.js` — `projectToWire(project,
   {sections})` drives the device's OWN deterministic walker (`model.js
   stepEvents`: swing, 13 grooves, per-step prob/micro/vel/locks) so the wire
   carries exactly what the live engine would play. Lane map: 0 KICK→kick(36),
   1 SNARE→snare(38), 2 HATS→hat(42, kit-probe: hatO preset → openhat),
   3 PERC→perc(45), 4 BASS→bass(step note), 5 LEAD→lead(step note),
   6 PAD→pad(step note), 7 ARP→acid(step note — the family's plucked voice).
   Unmappable extras are COUNTED, never guessed. The groove survives the wire:
   ts = grid + the device's own offset (swing/groove/micro), µs-quantized.
   Sections = the arranger model (`scene = {pattern, bars}`) — song structure
   rides the wire.
3. **The proof, over live HTTP.** `tools/e2e-pipeline.mjs`: factory
   `buildStyle('PSYTRANCE', 42)` → A–B–A 12 bars → wire → foundation
   `/api/render-notes` → WAV → `tools/acceptance-check.mjs` (verbatim
   foundation copy). **8/8 claims**: 200+audio/wav; RIFF/WAVE 3,504,428 bytes;
   structural gates (format/TP/DC/alive) PASS on both forms; X-Notes-Dropped=0;
   HTTP determinism (same body → md5 `c0102ea6cc94…`); wire byte-stability
   (300 envelopes / 47,461 bytes); span matches bars.
4. **The honest economics line** (recorded, not gated — the 17-a law):
   A–B–A 12 bars = 300 notes / 47,461 wire bytes → I=−18.0 LUFS, LRA=0.2.
   A 4 bars = 100 notes / 15,691 bytes → I=−17.7 LUFS, LRA=0.8.
   **Form bought structure, not loudness** (−0.30 LU for +31,770 bytes):
   density is the loudness lever, arrangement is the motion lever. Loop wires
   are static by design; the groovebox's real-time motion lives in its worklet
   engine, exactly as the looper's motion lives in its live FX.

## 4. Honest boundaries

- `js/family-wire.js` imports the vendored `.ts` codec, so it runs where
  TypeScript loads (bun — the repo's test/e2e runner). The in-browser device
  does NOT load it; wiring an in-browser "export → render" path is future work,
  deliberately not claimed here.
- Drum `tune` locks are device-local expression and are not carried on the
  v2 note payload (documented reduction, not a silent drop).
- Loudness: loop wires land quiet (−18 LUFS) because the factory WHAT is
  grid-spaced; foundation's own −10.7 LUFS reference uses its full
  arrangement. Density, not gain, closes that gap (Task 17-a/18 economics).

## 5. Verify it yourself

```bash
bun test                    # 629 pass / 0 fail (12 new wire tests in tests/family-wire.test.ts)
node tools/verify.mjs       # GREEN
# needs foundation's dev server (FOUNDATION_URL, default http://localhost:3100):
bun tools/e2e-pipeline.mjs  # 8/8 claims
```
