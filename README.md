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
| `index.html` | **The PSY6 device** — standalone groovebox (power-on screen, Perform/Sequencer/Sound/Mixer/Self-Gate tabs). Self-contained by design. |
| `worklets/psy-engine.js` | PSY6 real-time audio engine — single `AudioWorkletProcessor` (transport, ring-buffer event queue, preallocated voice pool, master chain). |
| `worklets/psy-dsp.js` | PSY6 DSP primitives — Moog ladder, polyBLEP saw/square, saturation, phaser, bus EQ (`AudioWorkletProcessor`s). |
| `soundBank.js`, `factory-presets.js` | Factory preset data used by the device. |
| `foundation/` | **psy-foundation** — shared packages (music, material, learning, dsp, scheduler, transport, protocol, device-sdk, analysis, fixtures, composition). Single source of truth for musical primitives. See `FOUNDATION_API.md`. |
| `tests/` | Bun test suite for foundation packages. |
| `playground/` | The PSY6 browser playground (deployed to Cloudflare Pages as project `psy6`). |
| `data/` | scales / motifs / rhythms / presets / styles JSON. |
| `samples/` | Drum one-shot sample manifest + WAVs. |
| `tools/verify.mjs` | Repository verification gates (syntax + document structure) — run by CI before deploy. |

## Run it

```bash
# Device: open index.html directly in a browser, or
npx serve .          # then visit /

# Playground (what Cloudflare Pages deploys):
open playground/index.html
```

No bundler, no install, no account. Everything runs locally in your browser.

## Tests

```bash
bun test             # foundation suite
node tools/verify.mjs  # syntax + structure gates (CI runs this before deploy)
```

Current verified test counts and benchmark numbers live in
[CHANGELOG.md](CHANGELOG.md) — every claim there is reproducible with the
commands shown next to it.

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

- `.github/workflows/pages-deployment.yaml` — pushes to `main` that touch
  `playground/**` first run the `verify` gates, then deploy `playground/` to
  Cloudflare Pages (project `psy6`). Requires the repository secrets
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to be configured.

## Non-negotiable rules

1. One source of truth per piece of musical state — the device consumes
   `foundation/`, it does not re-implement it.
2. Transport is not renderer, renderer is not UI.
3. No device policy — PSY6 is built from foundation primitives.
4. Every claim has evidence.
5. The `process()` hot path is allocation-free.

## License

MIT.
