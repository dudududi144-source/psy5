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
bun test             # 74 tests across 7 files — 74 pass / 0 fail (1004 expect() calls)
node tools/verify.mjs  # syntax + structure gates (CI runs this before deploy) — GREEN
```

Suite breakdown (all runnable with `bun test`):

| File | Tests | Covers |
| --- | --- | --- |
| `tests/voice-stealing.test.ts` | 11 | worklet priority-tier voice allocation |
| `tests/determinism.test.ts` | 18 | per-bar seeding, groove templates, micro timing |
| `tests/master-oversampling.test.ts` | 3 | 2x oversampled master saturation + aliasing benchmark |
| `tests/foundation-primitives.test.ts` | 13 | foundation PRNG / fnv1a / scale tables (pinned vectors) |
| `tests/soundbank.test.ts` | 4 | sound bank coherence |
| `tests/copilot.test.ts` | 18 | co-pilot contextual bandit: context building, reward mapping, serialization round-trip, determinism, foundation extension |
| `tests/arranger.test.ts` | 7 | section arranger: bar-quantized advance, persistence, manual override, paused transport |

## Benchmarks

`bun test tests/master-oversampling.test.ts` prints the numbers it asserts
against. Latest run — sawtooth sweep 12→16 kHz @ 44.1 kHz through the real
worklet MasterChain, alias-only band 16.5–22.05 kHz:

- native saturation: **68.5 dB** alias-band energy
- 2x oversampled saturation: **−11.0 dB**
- **reduction: 79.6 dB**

Device Self-Gate (Self-Gate tab → RUN SELF-GATE): **10/10 passed**, including
G9 — 64 consecutive hats + kick on every 4th step under deliberate pool
overload: `kicks=16/16 hats=64/64 tier0Steals=0 steals=70/0/2 peak=0.752`
(the kick is never dropped, zero tier-0 voice starvation), and G10 — the
CO-PILOT learner ranks a consistently rewarded action above a zero-reward one
(`fillAvg=1.00(n=45) > varAvg=0.00(n=2)`, probe `exploit fill`) and abstains
(DO_NOTHING) when every candidate's expected reward is below the threshold.

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
   ├── engine       pooled voices (synth 20 / drum 24), master chain
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
