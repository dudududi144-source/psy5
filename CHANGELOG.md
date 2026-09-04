# CHANGELOG — PSY6

All notable changes to the PSY6 device repository. Every claim below is
reproducible with the command shown next to it.

## [0.26.0] — Run 25: PRODUCT FINISH — the engineering roast, on the record

> Owner: "we built in layers and got a hysterical mess — go over EVERYTHING,
> roast yourself as an engineer releasing to production, dissect the design,
> bring the demos to the final full version, organize the repo."

- **docs/ENGINEERING-ROAST.md** — ten findings, each evidence-anchored at
  v0.25.0, each FIXED here or standing as documented debt. Highlights:
  the demo buttons played a different DARK-PSY song than the file+test
  pinned (777 vs 90210); the boot copy claimed "19 checks" against a real
  48; the seed table existed twice; four of nine styles silently bypassed
  kit governance; two inline onclick handlers survived a CSP field report;
  the library search rebuilt 456 DOM rows per keystroke.
- **Demos → SHOWCASE (roast #1)** — `data/demos/*.json` are the 8-minute
  full-form versions (292–300 bars, ~480 s, 40 scenes each), form summaries
  generated from `compose()` itself. File = usability test = boot button =
  one identity per demo (FULL-ON 424242, DARK-PSY 90210, FOREST 1337).
  Static guard: the button wiring is regex-pinned to the file recipe, and
  the duplicate local seed table is banned (`READY_SEEDS` in library.js is
  the only table).
- **Gates manifest (roast #3/#9)** — `js/gates-manifest.js` is the single
  source of the MAIN gate list; `tools/e2e.mjs` imports it, the boot copy
  renders the live count, and a bun test statically reconciles it against
  the ids `js/ui/tests.js` registers. Live specimen found during the audit:
  **G52 (v0.23.0, reason liveness) was registered in-page but missing from
  the hand-typed e2e EXPECTED list** — three releases unasserted while the
  docs claimed CI coverage. Manifest now carries **49 CI-asserted ids**.
- **Kit governance 9/9 (roast #4 — now FIVE findings)** — `STYLE_KIT` maps
  all nine styles; psytrance/goa/trance ride `psy-classic`, techno rides
  `progressive` (the documented family law). `data/styles.json` documents all
  nine styles. The fix's own browser check found the fifth bypass: DARK-PSY's
  dedicated `dark-forest` kit was UNREACHABLE since v0.23.0 — the map key
  `darkpsy` never matched the runtime lookup key `dark-psy`, so the flagship
  style silently rode DEFAULT_KIT and the unit pins stayed green. Runtime
  lookup is now ONE canonical accessor `styleKit()` (case/hyphen-insensitive),
  used by all four call sites; DARK-PSY showcase browser-verified booting
  with kit `dark-forest`. Honest limitation: no new kit sound design this
  run — governance only.
- **Power screen hierarchy (roast #5)** — hero → genre grid → SHOWCASE /
  ADVANCED two-column row → engine A/B demoted to a secondary footnote.
  Product-voice copy; the ui-evidence contract (hero first / 9 ⚡ SETs /
  BARE last) unchanged and still asserted.
- **Zero inline JS (roast #6)** — the two helpOverlay `onclick=` attributes
  are wired in main.js; index.html carries no inline handlers.
- **Search perf (roast #7)** — 120 ms debounce, DocumentFragment build,
  delegated clicks (456 per-row closures gone).
- **powerOn() split (roast #8)** — bootAudio / bootProject / bootWarmKit /
  bootStart; behavior identical, the same gates assert the same boot.
- **Standing debt (documented)** — doc-number docgen, new kit sound design,
  worklet feature parity.
- **Tests**: 657 → **665** across 52 files (gates-manifest reconciliation
  suite + demo coherence guards). `verify` GREEN. SW `psy6-v0.26.0`.

## [0.25.0] — Run 24: STRATIFICATION II — no more lonely options

> Owner: "don't let every feature have just a few lonely options" / instruction
> 14: take from psyreason, test, extend, improve, surpass.

- **Library 423 → 456** (`bun test tests/v025.test.ts`) — 33 new presets that
  fill the thin cells the owner kept hitting:
  - **texture 0 → 9** — the category existed in the runtime LIB key set but
    held ZERO factory presets (the soundBank TEXTURES never reached it); now
    one slow-evolving bed per genre (9/9), LFO-cutoff movement, atk ≥ 1.2 s.
  - **synth 1 → 6** — the loneliest category gets 5 utility voices (zapper,
    screamer, gnarl, stab, brute).
  - **FOREST 22 → 32** — the thinnest genre (siblings owned 45-62) gets 2
    basses, 2 leads, 2 pads, 1 pluck, 2 drum FX (+ its first texture); every
    FOREST cell non-zero.
  - **BANDPASS dimension 0 → 6 in the runtime library** — 6 bandpass acid
    basses across PSYTRANCE/
    TECHNO/HI-TECH/DARK-PSY/TRANCE/PROGRESSIVE with per-genre res/fenv laws
    (the filter dimension was 75× lowpass); takes psyreason's 8e97cd6 "bass
    acid bandpass" idea and exceeds it (6 distinct laws, not one template).
  - **WIDE pads** — 4 new pads at detune 24-30 (psyreason's "pad stereo
    width" dimension, realized through our 2-osc detune engine).
- **UI**: the library category dropdown gains `texture` (was invisible);
  genre dropdown already derives from the library itself (v0.19.0 law).
- **Tests**: `bun test` 650 → 657 across 51 files — tests/v025.test.ts pins
  every claim above (7 tests); v2-library schema walker now accepts the
  texture cat; exact-count pins recalibrated 423 → 456 in v018/v019 suites.

## [0.24.0] — Run 23: PSYREASON PORT — the KIT-GOVERNED REASON SYSTEM (every hit plays through the kit)

> Owner: "replace ALL your sounds with psyreason's; the kit must COHERE — no
> more disconnected sounds, nothing that destroys dynamics."

### The wiring (js/engine.js v0.24.0)
- **Routing law** — `trigger()` resolves every drum type through the kit system
  BEFORE any pooled voice is selected (extends the v0.23.0 ROM early-return):
  the 8 REASON_TYPES (kick/snare/clap/hatO/hatC/tom/crash/ride) render via
  `renderReasonPcm(type, kitPatch(kitId, type), sr, variant, 2)` — layer 2 is
  the unity loudness layer, so patch.rms IS the mixed level; the 12
  KIT_ROM_ROLES render via `renderRomPcm(type, sr, {rootMul, rmsMul, variant})`
  with `rmsMul = kitRomSpec(kit,type).rms / romSpec(type).rms` clamped [0.5,2]
  and `rootMul` from the live root override; the 6 legacy synth/FX types
  (zap/boom/glitch/riser/impact/downlifter) keep the exact DrumVoice path.
  `opts.rom===false` disables BOTH rom classes → the exact pre-v0.24.0 path.
- **2-variant round-robin** per type (`this._rrType`, advanced on SUCCESS only)
  anti-machine-guns repeated hits; the variant is part of the cache key.
- **Render-once caches**: `REASON_SHARED` (keys `R:<type>:<kit>:<variant>:<layer>@<sr>`)
  beside `ROM_SHARED` (kit ROM keys `K:<type>:<kit>:<variant>:<rootMul%>@<sr>`)
  — AudioBuffers are context-independent, offline bounces reuse live buffers.
- **KIT CHOKE** (`kitChoke(kitId)`): hatC + hatExclusive → every OTHER busy
  hatO RomVoice ramps to .0001 over 25 ms; crash/ride at maxPoly → the OLDEST
  same-type voice fades 60 ms. Time-anchored (cancel ≥ when, re-anchor from
  the hit's stored sustain `v.amp`) — value-continuous offline.
- **Sidechain bug guard** — kick now routes through the ROM path; the
  early-return used to skip the duck. The duck fires on the ROM path
  (`v0.24.0 BUG GUARD` comment pins it; gate G11 covers it end-to-end).
- **Kit/root APIs**: `setKit(id)` (refuses unknown kits), `setRootHz(hz)`
  (20..500 Hz, 0 = kit root), `rootMul()` (clamp [.5,2] around kitRootHz),
  `rmsRatio(type)`. New RomVoice fields lastType/lastTrack/amp; killAll clears
  them. Honest counters: reason hits increment romSpawns AND reasonSpawns
  (fallbacks likewise both); loadSnapshot + the LOAD chip carry
  reasonSpawns/reasonRenders/reasonFallbacks/kitId.
- **Boot warm** (main.js): the power-on idle-sliced warm loop now warms
  `kitWarmTypes(project.kit)` — 20 types, AFTER the project load so the
  PROJECT's kit is the one warmed (cache keys on kitId). Sound-tab kit changes
  re-warm the new kit the same way.
- **State** (state.js): `p.kit='psy-classic'` + `p.kitPinned=false` backfill in
  loadProjectObj (invalid id → DEFAULT_KIT); loadProjectObj is the ONE
  kit-apply point (fresh boot, resume, share, compose paths).
- **UI** (ui/sound.js): KIT select in the Sound tab — `auto (follow style)` +
  the 6 kits by name; auto → unpinned + STYLE_KIT[style]; explicit → pinned;
  both setKit + warm + save. `syncKitSel` mirrors state on every render.
- **Composer style hook** (main.js composeBoot + ui/compose.js both compose
  paths): a composed set takes `STYLE_KIT[style] || DEFAULT_KIT` unless the
  user pinned a kit — the pin carries across compose.

### Evidence
- `tests/reason-wiring.test.ts` — kit patch resolution (8 roles × 6 kits),
  rootMul math, the FULL routing classification table (26 types pinned so a
  future type cannot silently fall out of kit governance), warm list (20,
  kick first), state round-trip, choke config.
- `tools/rom-audit.mjs` — new kit×type REASON table: all 6 kits × 8 types,
  duration law (buffer == REASON_DUR ≤ drumDurEst window), peak ≤ 0.97,
  RMS within ±15% of patch.rms (peak-clamped buffers documented — the peak
  law has the final word by renderReasonPcm's documented order).
- In-page gates brought to the v0.24.0 routing reality (honest, measured,
  verified statically + by the 650-test suite — the sandbox cannot run the
  headless battery, CI is the authority): **G39/G47 pin the LEGACY synth
  layer via `{rom:false}` engines** (dist/glide/bursts/click are legacy-
  DrumVoice params — their laws hold by construction, labels say LEGACY
  pin); **G48's tom pair → `{rom:false}`** (the v0.15 bend laws are synth
  laws; the REASON tom is G52/audit territory) while conga/bongo/cowbell/
  clave stay on the kit path (share/ratio laws are amplitude-invariant
  under the kit rmsMul); **G49's crash laws moved to the REASON renderer**
  (the G48 raw-law precedent — measured on renderReasonPcm: mid/early
  .084–.360 per kit, 4–12k share .77–.88 renderer-level → law .60 with
  margin; the engine render keeps peak+determinism evidence); **G9/G15's
  starvation law moved to the ROM pool** (`romSteals` — kick+hats leave the
  drum pool, the drum-pool tier-0 count stays pinned at 0 as a tripwire);
  **G44 widens to steals+romSteals>0** (synth tiers still steal). G40's
  probes are behavioral (tom ZCR descent holds on the reason membrane's
  pitch envelope; cowbell tone→tilt still maps) — untouched. NEW **G52**
  gates the default reason path itself: reason spawns live + fallbacks 0 +
  determinism + kit-governance audible (psy-classic vs tribal-raw maxDiff)
  + 48 kit×type RMS±15%/peak≤.97 + hatC→hatO choke audible + kick-
  sidechain-on-ROM-path.
- Browser evidence (headless Chromium, real AudioContext, 44.1 kHz): boot
  enters READY SET → engine kit psy-classic, warm renders at power-on; the
  arranged groove fires 1080+ ROM spawns / 85+ reason spawns with ZERO
  fallbacks and ZERO steals over a minute (status bar LOAD 2–5%, latency
  42 ms, kit name surfaced in the honesty bar); the SOUND panel kit picker
  switches psy-classic → dark-forest LIVE (pinned, lazy per-kit renders,
  still 0 fallbacks); desktop 1440×900 + mobile 390×844 layouts verified
  pixel-clean.
- Honest limits: the in-page gate battery (incl. G52) is CI-asserted (the
  sandbox's known Chrome OOM blocks the local 50-gate run — same as v0.23.0);
  the worklet engine keeps its documented reduced synth (rom/reason are
  pooled-engine features); setRootHz() ships unwired by design (the project
  is degree-based — no user tonic exists; the kit-level root law carries the
  harmony lock); listening quality on real monitors remains the owner's
  judgment.

## [0.23.0] — Run 22: PERCUSSION ROM v3 — the synth-quality ceiling breaker

> Owner (instruction 13, 4th time on sounds): "עדיין יש קונגה וקראשים
> וצלילים נוראיים בתופים… יש עדיין בכל מיני מקומות צלילים שהורסים את כל
> הדינימקיה וההרמוניה… אני רוצה שיפור מקיף משמעותי מאוד באיכות וודא שהכל
> רץ בלי בעיה ובלי לאגים ותקיעות" — congas/crashes still terrible; sounds
> in various places destroying the dynamics and harmony; comprehensive
> quality improvement; everything running without lags or stuck states.

### Diagnosis — why 3 rebuilds of the synth voices still read "cheap"
The pooled DrumVoice renders percussion with ≤2 oscillators + a noise tap.
Physics doesn't negotiate:
- **Membranes** (conga/bongo/darbuka) ring with the measured circular-membrane
  mode ladder — 1.0, 1.02 (the near-degenerate beat partner), 1.475, 2.09,
  2.33, 2.63, 3.01, 3.36, 3.76 ×f0 — each mode with its OWN decay (highs die
  first). Two sines = a beep. No envelope fixes that; the partials are
  missing.
- **Metals** (crash/triangle/cowbell) live on dense inharmonic stacks. The
  crash used the hat's 6 squares → hollow ring; the **triangle was literally
  bandpass noise** (no ring at all); the **cowbell was two RAW squares with
  no filter** — the harshness that kept cutting through the mix.
- **Loudness** was per-recipe folklore — a crash at vel·0.5 + wash next to a
  clave at vel·0.7 lands wherever it lands → the "dynamics destroyers".

### The fix — `foundation/dsp/perc-rom.mjs` (render ONCE, play like a sampler)
- **13 types** (`ROM_TYPES`): conga, bongo, darbuka, crash, revcym, triangle,
  tambourine, shaker, agogo, timbale, cowbell, clave, rim. Each renders ONCE
  per (type, sampleRate) into a Float32Array → AudioBuffer cache:
  - membranes: the full 9-mode ladder with per-mode decay + seeded slap
    transient (BP noise 1.9 kHz) + snap touch (3.4 kHz) + shell resonance;
    darbuka = dum (LP'd deep membrane) + tek (metallic band 3.2 kHz);
  - crash: **20-square inharmonic bank** (10 ratios × detuned beating
    partners, seeded per-partial phase) through the crash corners
    (BP 8.6 k → HP 4.6 k) + shimmer wash + splash transient + two-stage
    envelope (hold 12 %, then decay) — 3.0 s;
  - revcym: the same bank as a 2.6-power swell with a HARD cut at 92 %;
  - triangle: stretched near-harmonic ring (n·f0·(1+0.0009n²), 9 partials)
    + the 5.5 kHz "ting" beat pair + strike;
  - cowbell: the 808 recipe (560:845) **finally band-passed at 1.9 kHz**
    with the real two-stage env;
  - tambourine (jingle stack 6.2–30 k + head thump), shaker (swept BP
    6.4→4.8 k, shaped attack), agogo (1:1.506 bell), timbale (shell modes +
    2.6 k rim crack), clave (1:2.63 wood), rim (wood + wire buzz).
- **Anti-"dynamics destroyer" family law**: every buffer is RMS-leveled to
  its spec target (measured band 0.062–0.105, crest preserved), peaks
  ≤ 0.97 — `bun tools/rom-audit.mjs` prints the table, **13/13 PASS**.
- **Determinism**: mulberry32 seeded from fnv1a(type) — same type + sr →
  byte-identical PCM (pinned). Zero DOM/AudioContext/wall-clock in the
  module (bun-testable headless).

### Engine integration (`js/engine.js`) — pool discipline moved ZERO
- `trigger()` routes `ROM_TYPES` hits **BEFORE any pooled voice is selected**
  — a ROM hit neither consumes nor steals a DrumVoice; it plays through its
  own **8-voice RomVoice pool** (pooled env gain + pooled tilt highshelf;
  the per-hit BufferSource is the one unavoidable allocation, GC-reaped —
  the same law as the sample path).
- Per-hit semantics preserved: `tune` → playbackRate (classic sampler pitch,
  clamp .25–4), `tone` → highshelf tilt ±9 dB @ 3.2 kHz, `punch` → 30 ms
  attack overdrive, `decay<0.95` → env fade at the window. `drumDurEst` is
  UNTOUCHED (the 25-type table stays bit-exact — steal semantics, busyUntil
  windows, G44 discipline all pin to it).
- **Click-free pooling for ANY rate**: a 15 ms safety fade is ALWAYS
  scheduled at min(bufferDur/rate, durEst·1.15+.02) — even a pitch-down
  conga ring that outlives its window fades, never cuts.
- `opts.rom=false` = the exact pre-v0.23.0 synth path (bit-for-bit, for the
  neutral A/B and the gates). Render failure → counted legacy fallback
  (`romFallbacks`), never silence.
- `warmRom` + `main.js` power-on warm loop (idle-sliced): all 13 buffers
  render at boot (~150 ms total, spread across idle slices) — the lazy
  first-hit render (~1–40 ms) is the documented exception the owner should
  never meet.
- `loadSnapshot` carries the honest counters: romSpawns/romRenders/
  romFallbacks/romSteals + pools.rom. `killAll` panics the ROM pool.
- **Offline bounce inherits everything** (same PooledEngine in the
  OfflineAudioContext) — WAV renders get the ROM too.
- Worklet engine: documented split, never faked — the experimental worklet
  keeps its V_PERC synth for the 13 types (WORKLET_LIMITATIONS entry).

### The bug the browser caught (and why this release is safer for it)
The first integration exported `ROM_TYPES` as an **Array** while the engine
routes hits through `ROM_TYPES.has()` on EVERY drum event — the first live
audition threw on all 13 types (a wrong-container throw inside the scheduler
tick = exactly the "stuck" class the owner keeps reporting). Fixed as a Set
+ regression pin (`typeof ROM_TYPES.has === 'function'`). **The caught-live
bug never reached a release commit.**

### Evidence
- `bun test` — **561/561 GREEN** (18 new ROM gates: render/window/loudness
  laws, 44.1 kHz parity, recipe pins — the membrane ladder, the cymbal bank,
  the 808 cowbell, clave 1:2.63, agogo 1:1.506 — integration pins, manifest
  integrity).
- `bun run verify` — GREEN.
- `bun tools/rom-audit.mjs` — 13/13 PASS (peak ≤ 0.97, RMS within ±1.5 dB of
  spec, buffer ≤ drumDurEst window, byte-deterministic).
- Browser (real AudioContext, REAL device): boot warms 13/13 (fallbacks 0);
  all 13 types audition through the RomVoice pool, errs []; the Full-On
  arrangement fires **40 natural ROM spawns** in the live groove with 0
  steals, LOAD 20 %, latency 42 ms; offline render of all 13 types through
  the full engine graph → peak 0.589 / RMS 0.09 / 0 fallbacks; tune
  0.7→1.3 measurably re-pitches the conga buffer (ZC 250→294).
- In-page SELF-GATE battery (same session, before the sandbox's known
  Chrome OOM ended it early): **28 gates run, 28 PASS, 0 FAIL** — including
  G1 genre renders, G14 every-event-voiced, G15 overload discipline, G23
  all-styles composer bounces, G29 master chain — every render exercising
  the ROM path. The authoritative full 50-gate battery runs in CI.
- `samples/manifest.json`: **12 ghost entries removed** (28 → 16; every
  listed file now exists — the browser could 404 on six kicks/claps/hats
  and six nord/md files that were never committed).

### Honest limits
- The ROM buffers are MONO (the pan/send stage stereoizes); per-hit `decay`
  can shorten but not lengthen a ring (buffers are decay=1 renders; decay>1
  keeps the natural tail inside the longer window — documented).
- The worklet engine keeps its reduced synth set for the 13 types (opt-in
  experimental path; documented in WORKLET_LIMITATIONS).
- First-hit lazy render remains the hot-path exception (~1–40 ms/type) for
  anyone who beats the boot warm loop; monitoring quality on real speakers
  remains the owner's judgment.

## [0.22.0] — Run 21: PADS v3 "LIVE GRID" — the pad surface rebuilt from the pure layer out

> Owner verdict on the old pads, with a screenshot: "סאונדים מתחת לכל ביקורת
> זה לא עובד" — 16 pads ALL reading "Trance" (the label was
> `presetName.split(' ')[0]`), half of them DEAD (the `i % tracks.length`
> map landed pads on synth tracks and `padHit` silently refused), every
> card a blank rectangle. This run replaces the whole pad surface; the
> environment was lost mid-run and the repo is the single source of truth
> (fresh clone off `4963c71`, remote verified with ls-remote).

### The repair — pure first (`js/model.js`)
- **`padKit(p, mode)`** — the ONE pad-grid builder (DOM-free, bun-owned):
  - **DRUM**: one pad per REAL drum track, then musical VARIANT pads fill
    the grid to 16 — 16 distinct recipes (`+OCT −OCT TIGHT LONG PUNCH DARK
    BRITE SUB +5TH −5TH GATE WASH SNAP DEEP AIR HOLLOW`) riding the per-hit
    parameter lock (the exact mechanism step locks use). ZERO dead pads for
    any kit size; a set with no drum voices yields honest 'empty' markers
    (the UI toasts the Sound-tab fix — the established dj() convention).
  - **`padLabel`**: the genre word is stripped ("Trance Punch Kick" →
    "PUNCH KICK"); "Trance"×16 can never happen again (bun-pinned).
  - **SCALE**: 16 pads = two octaves of the project scale with REAL note
    names (root 33 minor → A3, B3, C4…). **CHORD**: diatonic triads with
    correct quality symbols (natural minor: Am, B°, C, Dm, Em, F, G).
- **`PAD_GLYPHS`** — 25 per-type envelope silhouettes (every `drumDurEst`
  branch covered, bun-verified against the switch itself). Rendered as SVG
  polylines inside the pads: every pad shows the SHAPE of its sound — the
  blank-card era is over.

### The surface (`js/ui/perform.js`, `css/app.css`)
- `renderPads` rebuilds from `padKit` with a signature gate (the rAF loop
  renders free); voice pads show label + glyph + type + track no.; variant
  pads carry the accent-tinted modifier tag; SCALE/CHORD pads show the big
  note/chord name + roman degree. Honest tooltips everywhere.
- `padHit` consumes the pad map: DRUM always fires (voice or variant lock);
  SCALE/CHORD fall back to the first synth track instead of the hard-coded
  index 4 (which silently died when track 4 wasn't a synth); offline/stale
  states answer with toasts, never silence.

### Playability
- **Keys 1-8 + y u i o p j k l** — the full 16-pad grid playable from the
  keyboard (registry-validated, collision-tested, help overlay renders it).
- Pads record while REC is armed (recHit on the mapped track) — variants
  record onto their base track.

### Gates
- `bun test`: 543/543 GREEN (new `tests/pads-v022.test.ts`: zero-dead-pad
  contract for 4 styles, clamp-range locks, identity uniqueness, note-name
  math, chord qualities, glyph coverage, honest empties).
- `node tools/verify.mjs`: GREEN.

## [0.21.0] — Run 20k: THROW TOOLS (ECHO THROW + MUFFLE) — the two classic DJ performance moves, quantized release

> Standing owner directive: playability ("יוכל בפועל לשחק תוך כדי תנועה") —
> the Perform layer gains the two moves every psy DJ reaches for, with the
> honest-state discipline this repo is built on. (v0.20.0 itself — grooves
> 4→13, scales 5→13 + the SCALE picker, fills 5→8 — shipped GREEN: bun
> 533/533, verify GREEN, ui-evidence GREEN, CI Gates full suite SUCCESS.)

### ECHO THROW (`g` / Perform button)
- Slams the master delay feedback to its ceiling (0.8 — the `delayFbClamp`
  max) so whatever is playing smears into dark analog-style repeats (the
  loop's lowpass shapes them). RELEASE: press the SAME tool again, or let
  the armed barHook auto-release after 2 bar boundaries. The release
  restores the exact pre-throw value.
### MUFFLE (`h` / Perform button)
- Pulls the master EQ high/mid shelves down (−12/−9 dB, the registry
  clamps) — the DJ veil for builds and breaks. Same arm/release contract.
### State discipline
- Momentary by design: NO pushHist, NO automation write — the release
  restores the exact pre-throw values, so project state is net-identical
  unless the user SAVES mid-throw (documented behavior). The scheduler
  fires barHooks only while playing: a stopped transport holds the throw
  until the next play — exactly how a held DJ move behaves.
- Zero engine change: both throws write REAL project state the engine
  already reads on syncMix (delay feedback + master EQ) — the offline
  renderers, the worklet path and every gate remain untouched.
- Shortcut registry grew (g/h — collision-tested like every entry); the
  stale 'f' label (5 layouts) now reads the real 8.

### Battery
- bun **533/533** (45 files) · `verify` GREEN (v0.21.0) · ui-evidence
  **16/16** (adds the THROW arm/slam/release-restore checks driven through
  the REAL keyboard dispatcher in the booted device).
- CI Gates on v0.20.0 (2ecb6f3): **full e2e suite SUCCESS** (the release
  box historically runs in-page 49/50 with G17 realtime info-only).

## [0.20.0] — Run 20j: GROOVES 4→13 + SCALES 5→13 + FILLS 5→8 + the SCALE picker (the three loneliest choice axes got fat)

> Owner directive (verbatim): "אוי ואבוי חשוב לדחוף מיד שלא נאבד את העבודה
> הקשה" — the fear was unfounded (remote == local, verified `git
> ls-remote`), and the standing v0.19.0 directive ("שפר משמעותית… חסרים
> הרבה אופציות") kept driving: the three choice axes that were thinnest
> grew, and one control that NEVER existed shipped.

### GROOVES 4→13 — the feel vocabulary
- Nine new groove templates join Straight / MPC 54% / Psy Push / Humanize,
  same pure `(track, step, rng, sd, tick) → seconds` contract, deterministic
  through the caller's per-bar seeded rng, applied before the probability
  gate: **MPC 58%** (heavier swing), **Shuffle 62%** (breaks-feel swing),
  **Psy Glide** (bass ahead of the grid — the flying-bass lock),
  **Lazy Bass** (bass behind the grid — the modern psy drag),
  **HH Lift** (even 16th hats pushed +ticks), **Perc Drag** (perc lane
  late — organic humanization), **Push 16ths** (all odd 16ths +, KICK
  excluded — the sacred zone holds), **Laid Back** (everything behind),
  **Drunk** (seeded ±5-tick chaos).
- Track-scoping is asserted by test (glide/lazy touch only the bass,
  hhlift only even hats, perc-drag only perc, push16 never the kick);
  every template stays inside the step (|off| < sd) across tracks/steps/
  trials; the picker derives from `Object.keys(GROOVES)` (zero UI drift
  possible).

### SCALES 5→13 — three foundation voices were UNWIRED (+ five new)
- The foundation table already carried phrygianDominant, doubleHarmonic
  and minorPentatonic — the device exposed only 5 of the 8. All three are
  wired now, plus five NEW foundation scales: **lydian** (#4 dream),
  **mixolydian**, **hungarianMinor** (dark-exotic), **melodicMinor**,
  **majorPentatonic** (uplifting Goa arps).
- Additive-only discipline held: the legacy five keys stay byte-identical
  (pinned), every device scale aliases the foundation table (never
  re-implemented — pinned), composer styles untouched (the 9 whole-project
  hashes did not move), every scale ascending + in-range (pinned).

### THE SCALE PICKER — a control that never existed
- `p.scale` was ONLY settable at project creation; the live pads
  (CHORD/NOTE), evolution mutations and melodic lanes all read it, but the
  user could not change it. The header now carries **Scale** (next to
  Groove), derived from the vocabulary itself (the FOREST-filter
  discipline: a future scale can never silently vanish), wired through
  pushHist (undo-honest), driving pads/evolution immediately.

### FILLS 5→8 — three arrivals, the last modulo hardcode dies
- **STUTTER** — last-beat tuned 8th perc stutter (the glitch breath),
  **HOVER** — the anti-fill: one hit then dissolve into the pre-drop
  vacuum, **SPIRAL** — perc/snare alternating accel (quarters → 8ths,
  rising). The legacy five layouts stay byte-identical (pinned);
  `fillEvents` modulo now generalizes over `FILL_NAMES.length` (the %5
  hardcode is gone).

### Battery
- bun **533/533** across 45 files (the new `tests/v020.test.ts` adds 19:
  groove determinism/bounds/scoping/stepEvents-path, scale byte-identity
  + foundation-alias + validity, fill layout shapes, header/index.html
  picker wiring; the v018/v019 fill pins re-recorded — legacy shapes
  asserted byte-identical, wrap semantics generalized).
- `verify` GREEN (sw CACHE_VERSION == CHANGELOG latest, v0.20.0).
- e2e: full suite asserted on push by CI (60-min window + retry), as
  released in v0.19.0 (in-page Self-Gate 49/50, G17 realtime info-only).

## [0.19.0] — Run 20i: COMPOSED TRANSITIONS (the composer finally ships the v0.16 vocabulary) + TRANZ carrier + library 381→423 + fills 3→5 + DJ DOWN

> Owner report (verbatim): "צירפתי קודם שפר משמעותית מה שעשית נתח תבין איך
> אפשר להשיג עוד מה צריך לתקן אם יש באגים והכל משמעותית אני רוצה לשפר ואז
> בסוף תדחוף הכל מסודר צירפתי קובץ טוקן" — analyze deeply, fix the bugs,
> improve everything significantly, push it all organized.

### COMPOSED TRANSITIONS — the fix that matters most
- The v0.16 transition vocabulary existed but **the composer never wrote
  it**: every composed set (READY SET boot, COMPOSE, the library — the
  product's main content path) shipped bare pattern swaps. Now `compose()`
  writes a deterministic, style-aware `scene.trans` onto every TRUE section
  landing:
  - DROP / DROP2 / DROP3 landings — stacked riser (2 bars 70 % / 1 bar),
    impact on the boundary, bass-cut vacuum (85 % aggressive styles /
    50 % gentle), xfade 2 beats (aggressive) / 4 (gentle: TRANCE, TECHNO,
    PROGRESSIVE)
  - RISER landings — 1-bar riser + 1-beat glide; BREAK/BRIDGE landings —
    a pure 4-beat glide (a breath, never a hit); OUTRO landings — the long
    8-beat glide out
  - Song start (scene 0) is never a boundary; variant scenes (intra-family
    repeats) never carry trans; every payload canonical through
    `normalizeTrans` (loader/scheduler see exactly the v0.16 shape)
- Deterministic: the whole plan draws from `rngFor(seedInt, 'trans')` —
  same seed + style → byte-identical trans payloads (bun-tested).
- ONE plan, three consumers: the live scheduler (arranger lookahead), the
  offline render (`renderSong`/`songSchedule`), and now the MIDI export —
  no parallel logic anywhere.
- **Pin discipline (the documented contract):** the 9 whole-project
  composer hashes moved (re-pinned above the test, v0.13.0 values recorded
  here: FULL-ON 83dc9fd03da4dfb4/8d9f4e650f55ab87/b0236a5c7bd79fb6,
  DARK-PSY c5447a30c3f617cd/5869a01eeb4731be/b47472b344feb926,
  PROGRESSIVE d2b3aa8779e19e26/06b85c7953e71189/f892f5610afff47e) and the
  evolution OFF baseline moved (4385→4389 events, hash
  b8de08b276873400). **UNMOVED:** the pattern-level form-fp
  (bb16ce280ff48f88) and the rhythm/harmony byte-identity pins — trans is
  scene metadata, never pattern data. The three static demo JSONs keep
  their legacy 9-track shape; every FRESH compose carries the new one.

### THE TRANZ CARRIER — composed sets can actually fire the vocabulary
- Before: composed kits carried a riser on the FX lane (8/9 styles) and an
  impact only on TRANCE (1/9) — most composed drop landings would have
  fired a riser and skipped the hit. Now `compose()` adds a 10th drum
  track, **TRANZ**, carrying the TYPE the FX lane lacks (fx=riser →
  TRANZ=impact; fx=impact → TRANZ=riser), genre-matched preset where one
  exists. Every composed set can fire riser AND impact (bun-tested across
  all 9 styles). revcym stays an honest skip in composed projects — a
  third always-almost-silent lane for a garnish was judged not worth it
  (SWELL remains fully available: assign any revcym preset, or the DJ
  tool toasts the Sound-tab fix).
- `songMidi` now rides the SAME transition plan (trans triggers + the
  bass-cut windows) — the ".mid == WAV schedule" contract holds at full
  fidelity, note-for-note (the identity test walks both).

### LIBRARY 381→423 (+42, purely additive — zero id moves, zero collisions)
- **FOREST's own kit (9 roles):** the genre rode DARK-PSY from v0.7.0 and
  owned exactly 2 presets — now Root/Moss kicks, Twig Snare, Fern Hat,
  Root+Vine Congas, Drip Shaker, Spore Glitch, Lichen+Undergrowth Bass,
  Bark+Canopy Leads, Moss+Fog Pads, Branch+Spore Arps, Riser+Impact FX.
  The composer's FOREST style rides `KITS['FOREST']` (its own row).
- Pluck 15→23 (the thinnest synth category): 8 new voices, one per genre
  (Faery, Glint, Harp, Drop, Thorn, Dew, Shard, Metal).
- Carrier refills: 3 revcym + 2 downlifter + 1 impact presets (the DJ
  tools' honest-refusal paths now have genre-local answers).
- 4 more congas (the owner's historical pain point: Goa Deep, Trance
  Sand, Techno Ghost, Full-On Glade) + 2 bass / 2 lead / 2 pad refills.
- `gen:'v19'` marks the presets opting into the synth-v2 params (penv/
  pdec/sub) — the legacy-neutrality rule (ANY gen marker = explicit
  opt-in, clamps enforced) is enforced by test.

### FILLS 3→5 + DJ DOWN
- Two new fill layouts (pure `fillEvents` in model.js, bun-owned):
  **SNARE16** — a full-bar accelerating 16th snare roll (.3→.95) with two
  perc accents; **CLIMB** — a rising-tune perc sweep (.7→1.33 through
  parameter locks). `PERF.fillCycle` generalizes over `FILL_NAMES.length`
  (the %3 hardcode is gone).
- **DJ DOWN** — the downlifter fired ON DEMAND (Perform button + `d` key):
  the riser's mirror for endings and wind-downs. Honest refusal toast when
  the set lacks the voice; the library now carries 6 downlifter presets.

### FIX — the genre filter that silently dropped FOREST
- `wireSound()` hardcoded the genre dropdown and had drifted: FOREST (a
  first-class genre since v0.18.0) was **unfilterable** in the Sound tab.
  The dropdown is now DERIVED from the library itself — every genre that
  owns presets appears, and a future genre can never silently vanish
  again (pinned by test). The fill cycle's %3 hardcode died the same day.

### Battery
- bun **514/514** across 44 files (the new `tests/v019.test.ts` adds 11:
  composed-transition contract, determinism, schedule-fires evidence,
  carrier pair, genre data contract, DJ DOWN wiring, fill vocabulary;
  composer/evolution/presets/midifile/v2-library pins re-recorded). The
  heaviest composer test (36 full 12/20-min forms) carries an explicit
  30 s cap — the default 5 s was a CI-box lottery.
- `verify` GREEN. e2e: the in-page Self-Gate runs **49/50** on the release
  box (G17 realtime capture is info-only by design, skew -99 ms on the
  loaded box — the only non-passed entry; G25 record-song pass). All 48
  hard gates' evidence captured GREEN across chunked runs (G24 full song
  render 10,075,254 frames non-silent; G26 MIDI = 4389 notes note-for-note;
  G32 evolution OFF pin 4389/b8de08b276873400; G40 lib=423 kits=9/9;
  G50 transition precision numbers unchanged: cut 4.9e-4, swell ×14.09,
  imp ×1.89, rMid 0.273>0.079, det 2.4e-7). Gates G42–G51 carry bun-level
  coverage and are asserted by the CI single-pass job (7 GB runner) on
  push. ui-evidence 14/14 (the fill-label check accepts all five variant
  names).

## [0.18.0] — Run 20h: LIBRARY 345→381 (+36 presets, FOREST's first own voices) + FILL VARIANTS + DJ TOOLS (on-demand transitions)

> Owner report (verbatim): "תמשיך" — continue: more content, richer
> variety, deeper playability, everything verified, pushed properly.

### LIBRARY 345→381 — the thin side gets fat
- +36 factory presets, purely additive (every id new, zero collisions —
  bun-tested; no pinned id moves; the v0.12.0 floor + legacy pins intact):
  - 9 drums across underrepresented type/genre cells, including the
    FIRST TWO FOREST presets ever (Forest Camo Kick, Forest Twig Perc —
    FOREST rode the DARK-PSY kit with zero presets of its own until now),
    Hi-Tech Crush Snare + Black Crash, Goa Dune Clap, Full-On Heat Conga,
    Prog Soft Bongo, Trance Silk Darbuka, Techno Steel Cowbell
  - 27 synths weighted to the thin categories: 6 bass, 6 lead, 5 pad,
    5 pluck, 5 arp — Goa Sitar Pluck, Hi-Tech Scream Bass, Full-On Amber
    Pad, Psy Hoover Lead, Trance Crystal Arp and friends
- Data-layer discipline kept: presets using the v2-lite opt-in fields
  (penv/pdec) carry `gen:'v18'` — the legacy-neutrality rule now reads
  ANY gen marker as an explicit opt-in generation (synth-v2 tests
  generalized, clamps still enforced).

### FILL VARIANTS — the FILL button learned three patterns
- `fillEvents(type)` (pure, model.js, bun-owned): CLASSIC (the legacy
  8×8th crescendo), ROLL (16×16th .35→.95), TOMLINE (perc tune-climb
  .8→1.4 through parameter locks + snare accents). The FILL button/`f`
  key cycles and shows the variant on its label (⚡ FILL · ROLL).
- Deterministic layouts, velocities clamped, missing tracks skipped
  honestly; type wraps modulo 3.

### DJ TOOLS — the v0.16 transition voices, fired ON DEMAND
- RISER / SWELL / IMPACT buttons in Perform (plus `q` / `w` / `e` keys):
  the transition-voice types (riser/revcym/impact, v0.12–v0.15 drum
  types) triggered NOW through the same eng.trigger path the scene
  transitions use — for jams and manual builds.
- Carrier logic = `findTransTrack` (the SAME lookup scene transitions
  use): a set without that voice type refuses HONESTLY with a toast
  pointing at the Sound-tab fix — never retypes or creates tracks.
  Every READY SET carries a riser on the FX lane (bun-tested per style);
  TRANCE carries an impact; revcym is one ASSIGN away.

### G51 — the new gate (offline, CI-asserted)
- Four representative NEW voices (GO-PLUCK-SITAR, DH-BASS-SCREAM,
  FU-PAD-AMBER, FO-KICK-CAMO) render through the real preset→track→
  PooledEngine path: non-silent (peak .26), pairwise distinct
  (min PCM maxDiff .38), spectral-centroid spread 2564 Hz across the
  four, deterministic (maxDiff 0.0), FOREST presets present.
- e2e now asserts 48 gates (G51 added to EXPECTED).

### Verification (every claim reproducible)
- `bun test` → 501 pass / 0 fail (15 new in tests/presets-v018.test.ts;
  synth-v2 neutrality generalized to gen opt-ins).
- `node tools/verify.mjs` → GREEN. `bun tools/e2e.mjs` → GREEN 48/48
  (single full run on this box). `bun tools/ui-evidence.mjs` → GREEN
  14/14 (adds DJ buttons, riser carrier, fill-cycle label checks).
- GitHub CI (ci-gates.yml) asserts the full suite on push with a
  60-minute window + automatic retry.

## [0.17.0] — Run 20g: READY SET boot (never empty) + MACROS 8/8 REAL + playability layer

> Owner report (verbatim): "עוד לא סיימנו בחן שוב ותמשיך גם כהמשתמש יקבל
> את המערכת מסודרת ומאורגנת יותר כבר מוכנה לביצוע ולא ריקה וגם לשפר
> משחקיות למשתמש ולוודא תקינות של הכל להריץ הכל ולראות שהכל מגיב ועובד
> נכון ומדיוק ... ותמלא עוד דברים שיהיה מבחר עשיר ולא רק כמה פונקציות
> בודדות לכל דבר" — test everything again; the user must receive the
> system organized, arranged and READY TO PERFORM — not empty; improve
> playability; verify everything runs, responds and is precise; fill in
> more so every surface carries rich variety, not a few single functions.

### READY SET — the device boots ARRANGED, not empty
- The power screen now leads with a primary hero: "▶ ENTER — READY SET ·
  FULL-ON · 3:00 ARRANGED". One press composes a COMPLETE deterministic
  set (intro→build→drop→break→riser→drop2→outro: scenes, variant scenes,
  mix snapshots, automation lanes, transitions, the arranger chain) and
  lands on Perform with the arranger RUNNING. The old experience (a bare
  skeleton) remains as the explicitly-labeled "∅ BARE SKETCH" escape hatch.
- All NINE composer styles became one-press READY SETs on the power screen
  (FULL-ON / DARK-PSY / PROGRESSIVE / FOREST / HI-TECH / PSYTRANCE / GOA /
  TECHNO / TRANCE) — pinned seeds per style, so the same set every time
  (replayable, deterministic). The three demo buttons ride the same path.
- READY ALBUM: every composed boot preseeds the SONG LIBRARY with the
  booted song (active) plus one pinned-recipe per style — 9 songs, ~1 KB,
  deterministic ids (`readyAlbum` in js/library.js). The album UI is rich
  from the first second; recipes stay byte-reproducible.
- Power-screen copy updated to say exactly what ENTER does.

### MACROS 8/8 REAL — no more dead controls
- Owner truth found in code: DRIVE and MOVEMENT were RENDERED in the UI
  but `resolveMacros` only read ENERGY and SPACE — two dead knobs; 4..7
  did not exist. All eight now resolve to real engine state, recomputed
  idempotently from the per-track base snapshot (no accumulation, pure,
  deterministic — the same contract ENERGY always had):
  - ENERGY (0): cutoff brightness + drum/bass levels (legacy, unchanged)
  - DRIVE (1): insert saturation on the music bus + gentle bit-crush on
    drum bodies 1–3. Kick and bass stay SACRED (zero macro writes).
  - SPACE (2): delay + reverb sends (legacy, unchanged)
  - MOVEMENT (3): stereo spread (pad/arp left-right, hats/perc opposite)
    + LFO depth on music synths
  - FILTER (4): extra tone tilt over the music-bus cutoff (dark ↔ bright)
  - TIGHT (5): drum envelope length (loose ↔ tight, clamped 0.02..4 s)
  - HAUNT (6): pitch destabilizer on lead/arp (detune 0..48 cents-bias)
  - FAZE (7): LFO speed on the music bus (0..16 Hz)
- Macro cards show a live % readout; double-click resets to neutral 0.5;
  every card carries a tooltip describing exactly what it resolves to.

### PLAYABILITY — the performer gets more hands-on controls
- Keyboard (registry-tested, collision-free, help overlay auto-updates):
  `t` tap tempo (pure `tapTempo` math, 2.5 s window, clamped 40..300) ·
  `[` / `]` live BPM ride ±1 · `x` PANIC · `c` chain toggle · `s` save ·
  `Alt+1..8` INSTANT-launch scene N (the live jump that quantized
  launches and arrows did not cover).
- Macro/scene/pad surfaces remain the performance core; all new bindings
  are documented in the in-app help (?).

### Verification (every claim reproducible)
- `bun test` → 486 pass / 0 fail (17 new in tests/macros8.test.ts: all
  eight macros move real clamped state; idempotent recompute; ENERGY
  legacy contract; determinism; tapTempo window/average/clamp;
  readyAlbum validity + byte-determinism; all 9 pinned sets compose).
- `node tools/verify.mjs` → GREEN. `bun tools/e2e.mjs` → GREEN 47/47
  (the CI subset boots through the NEW hero path: click #stylePicker
  button #1 = READY SET compose boot → all gates pass on top of it).
- Hero boot = the deterministic FULL-ON 424242 set: 9 tracks, 12+
  scenes, arranger on, library preseeded — organized and playing.

## [0.16.0] — Run 20f: TRANSITIONS v1 (smooth section hand-offs) + the LOAD/CRASH fix + UI precision & layout overhaul

> Owner report (verbatim): "כרגע המערכת עם מלא לאגים ובעיות וחוסר דיוק היה
> יותר טוב מקודם אבל חשוב להמשיך לשפר להגיע להישגים לבחון הכל היטב משהו
> שם מעמיס וזה קורס בנוסף דברים יושבים לא טוב עדיין לבחון הכל וכל הדרכים
> תריץ תבחן תראה מה שאתה יכול בכל דרך לביצוע שיפור ותיקון וייעול ווידוא
> שהכל רץ חלק וברמה מסחרית גבוהה מאוד" — the system is full of lags,
> problems and imprecision; something overloads and it crashes; things
> don't sit well; run/test/fix/optimize everything until it runs smoothly
> at a very high commercial level. Prior round added the standing asks:
> smoother transitions between built sections, more presets/genres,
> real-time playability. v0.16.0 ships the missing transition vocabulary,
> finds and kills the render storm behind the reported overload, fixes
> transition-precision bugs (double impact, beat-math, glide-vs-automation),
> and repairs the two visible layout defects. Commands: `bun test`
> (469 tests / 41 files), `node tools/verify.mjs`, `bun tools/e2e.mjs`
> (50/50 HARD in two chunks — G50 new; see the CI memory note in README).

### TRANSITIONS v1 — the section hand-off vocabulary (js/transition.js, new)
- `scene.trans` (OPTIONAL, per scene, canonical/normalized, legacy-neutral):
  `riser 0|1|2` (bars of riser INTO the next section — 2 stacks an earlier
  under-sweep), `revcym 0|1` (reverse-cymbal swell across the last bar),
  `impact 0|1` (hit exactly ON the boundary), `cut 0|1` (bass vacuum — the
  last 2 steps are silent, the DJ pre-drop cut), `xfade 0..8` beats (the
  glide span of THIS scene's own mix snapshot at launch; 0 = the exact
  legacy 20 ms). Absent/null trans = byte-identical legacy behavior.
- Elements ride EXISTING drum voices by TYPE (riser/revcym/impact are drum
  types since v0.12.0–v0.15.0) through the SAME `eng.trigger` path — no new
  DSP, no parallel engine. A project without a matching voice type skips
  that element honestly (`findTransTrack → −1`).
- ONE plan, TWO consumers: offline `songTransPlan` (single source for the
  `songSchedule` oracle AND `renderSong`) + live `armTrans` in the
  scheduler (arranger = full vocabulary; chain/follow = 1–2 bar lookahead;
  manual quantized launch = impact + xfade, documented honestly).
- UI: a TRANS row on every scene card — R (cycles off/1bar/2bar), REV,
  IMP, CUT, xf—/xf1b/xf2b/xf4b/xf8b — plus a "T" badge on cards that
  carry a config. Everything writes through `sceneSetTrans` (normalized).
- G50 (HARD, CI): on a real 2×4-bar composed song with a mix snapshot
  (bass 1 → .25): bass-cut ratio 4.9e-4; HF swell ×14.1 into the boundary;
  impact sub-peak ×1.89 control; xfade 2-beat glide mid-window 0.273 vs
  instant 0.079 converging to 0.081; determinism 1.2e-7.
- Bun suite: normalize/clamp/canonical stability, xfade beat-math,
  cutSpan, transEvents step math (incl. song-start clamp + missing-voice
  skip), planTransLive lookahead gates, songSchedule integration
  (events at exact steps, bass vanishes in the cut window, trans-free
  schedule byte-identical via evHash).

### THE LOAD/CRASH FIX — the render storm is gone
- Root cause: the scheduler set `I.renderDirty=true` on EVERY 25 ms tick
  while playing, and `renderAll()` rebuilt SIXTEEN UI subsystems per flag —
  scene cards (innerHTML × ~45 nodes × up to 64 scenes), the whole mixer
  (strips + master + FX bars), the 345-row preset list, the step grid,
  synth editor, lanes, param selects — up to 60×/s, forever, even for
  hidden tabs. That is the reported "משהו שם מעמיס וזה קורס".
- Now: full renders are EVENT-driven (project load, launches, edits, tab
  switches) + ONE bar-aligned refresh when automation or per-bar evolution
  actually moved visible state (≤ ~0.5 Hz at 128 BPM — an ~80× reduction
  in the steady-playing case). Audio timing was never touched by the flag.
- Per-tab rendering: hidden tabs no longer rebuild at all (the 345-row
  list, the mixer, the seq grid all lived behind `display:none`); switching
  tabs renders the arriving tab within one frame.
- Signature caches where event-rate renders remain: scene bank (content
  signature → class-only active/pending refresh), mixer two-tier (value
  sync guarded by `document.activeElement` so an in-flight fader drag is
  never yanked; rebuild only on structure change), master bar value-sync,
  preset list + lane param select sig-gates.
- G45 had to follow the contract change: it now force-builds the library
  list before counting (mirroring its existing `renderMixer()` call) —
  same assertions, honest against on-demand rendering.

### TRANSITION PRECISION — three real bugs fixed
- Double impact: the pending-apply branch cleared `I.transArmedFor` BEFORE
  the manual-impact guard read it — an armed boundary fired TWO impacts
  (queue + manual). Now the fired state (`I.transImpFired`) is captured
  before the clear; the manual path only fills the un-armed gap.
- Beat math: `xfadeTc` treated xfade beats as STEPS (τ off by 4× — an
  "xf2b" glide closed in half a beat). Now τ = 4N·sd/3 (N beats, ~95 % at
  3τ); bun tests pin the formula.
- Glide vs automation: the composer's mix lanes call `syncMix()` every
  step with the legacy 20 ms τ — which re-anchored the strips mid-xfade
  and audibly snapped the glide shut (both offline and live). The launch
  now records the in-flight glide (τ + 3τ settle deadline) and lane-driven
  syncMix inside the span REUSES that τ; after settle, legacy behavior.

### LAYOUT — "דברים יושבים לא טוב" (verified with DOM overflow audits + screenshots at 780/1440)
- ACTIVE TAB WAS INVISIBLE: the global `button.on` (orange background,
  specificity 0-1-1) beat `nav button`'s transparent background (0-0-2) —
  the current tab rendered as a solid orange block with orange-on-orange
  text. Explicit `nav button.on` overrides (transparent bg + orange text).
- SCENE CARDS: 3-up at ~230 px could not hold 4 control rows (ops, follow,
  TRANS) — overlapping/clipped text. Now 2 comfortable cards per row (1 on
  narrow phones), every row on one line; the follow row FINALLY has the
  compact chip styling (it was raw 13 px controls breaking the 8 px grid);
  prob/bars inputs widened (no more "10" for "100").
- PADS: 8-wide grid on desktop (2 compact rows instead of a 4×4 wall that
  pushed every panel ~1900 px down); 4-wide stays on narrow screens.
- Horizontal overflow: 0 px on every tab at both audited widths.

### Verification (v0.16.0)
- `bun test`: 469 pass / 0 fail (41 files, 504,987 expects; +18 transition
  tests in tests/transitions.test.ts).
- `node tools/verify.mjs`: GREEN (0 failures).
- `bun tools/e2e.mjs`: 50/50 HARD in two chunks — A: 49/49 (all except
  G50), B: G50 GREEN. Single-run peak OOMs a 4 GB box (documented in
  README; chunking is evidence-neutral — every gate is independent).
- Live checks: boot → play → all five tabs → scene TRANS row edits →
  arranger on — zero page errors, zero layout overflow, LOAD chip single
  digits while playing.

## [0.15.0] — Run 20e: PERCUSSION v3 (owner-flagged conga fix) + 4 new voices (crash/revcym/agogo/timbale) + library 312→345

> Owner report (verbatim): "יש הרבה בעיות במיוחד עם סאונדים בשם conga הם
> בעייתיים יש גם עוד קצת פרקשנסן בעייתיים יש לשפר עוד ולהוסיף" — many
> problems, ESPECIALLY the conga sounds; more problematic percussions;
> improve further AND add. The complaint was structural: the conga voice
> is the perc lane of ALL EIGHT composer kits (PS-CONGA-LOW,
> DR-CONGA-GRAVE, GO-CONGA-RITUAL, FO-CONGA-PUSH, TE-CONGA-WAREHOUSE,
> TR-CONGA-ISLE, PR-CONGA-EARTH, HT-CONGA-CIRCUIT) — every generated song
> carried the flawed model. v0.15.0 rebuilds five perc voices, adds four
> new ones, and grows the library by 33 presets. Commands: `bun test`
> (451 tests / 40 files), `node tools/verify.mjs`, `bun tools/e2e.mjs`
> (46/46 HARD — G48/G49 new).

### PERCUSSION v3 — five voices rebuilt inside the SAME pooled nodes

Every rebuild: same DrumVoice topology (no new nodes, no topology change),
same parameter surface (tune/decay/tone/punch keep their meaning — the
sound behind them is rebuilt), same drumDurEst windows (pool discipline
moved ZERO), hot path stays allocation-free.

| voice | was (v0.12.0) | now (v0.15.0) |
|---|---|---|
| conga | bare sine, 1.08×→1 bend over 50 ms, 4 ms noise — read as a BEEP | shell-reinforced membrane: strike bend 1.25–1.7×→1 over 35 ms (punch maps depth), shell partial at 2.6×f0 with bend (tone maps level), slap transient 2.1 kHz·tone (punch maps level) |
| bongo | same bare-sine beep at 440 Hz | same membrane model, deeper bend 1.35–1.8×→1 in 28 ms (slappier family), partial 2.7×f0, slap 3.2 kHz·tone |
| tom | one sine sweep 180→92 Hz + 8 ms noise | two-stage pitch: bend 1.45×→1 in 28 ms THEN the glide, overtone sine 1.6×f0, wider strike noise |
| cowbell | static 560+845 squares | strike transient on the lower square (1.05×→1, 10 ms) + tone maps a detune spread between the pair (tone 1 = 0 cents = the old pair) |
| clave | two sine modes only | modes unchanged + broadband KNOCK transient (1.1 kHz·tone bandpass, punch-scaled) |

G48 evidence (solo hits, fresh offline contexts, the G46 methodology):
conga shell-partial band (744–920 Hz) share **.039** (the bare sine put ≈0
there), attack/body RMS **×2.04**; bongo partial share **.017** (diluted by
the strong fundamental + slap total — still ≈0 on the old beep); tom
bend-band/glide-band **×12.4**; cowbell tone-spread maxDiff **2.8e-1**;
clave knock maxDiff **2.2e-2**; min peak **.31**; determinism **6.0e-8**.

Pooled-reuse safety: the hit() zero-anchor now also resets osc/osc2.detune
— the cowbell spread can never leak into a voice reused by another type.
Bit-neutral for every legacy path (detune was always 0 before v0.15.0).

### FOUR NEW VOICES — the transition/bell/shell territory was empty

- **crash** — cymbal wash: the EXISTING 6-square inharmonic metal stack
  (HAT_RATIOS, lazily shared — no new nodes) at a 52 Hz·tune base, BP 8.6k
  / HP 4.6k·√tone, TWO-stage envelope (set-down to .6 level by 40% of the
  ring, then the long decay — the shimmer a one-point exponential cannot
  hold) + a highpassed noise wash (punch maps level, tone maps corner).
  decay maps the ring up to ~4 s. G49: mid-ring RMS(1.0–2.0 s) **.371×**
  early (a one-point exp sits far below), 4–12 kHz share **.49**.
- **revcym** — the reverse-cymbal transition classic: metal stack + noise
  swell EXPONENTIALLY into the drop, HARD cut at dur (the vacuum the ear
  wants). Place the hit on the drop; the swell leads INTO it. G49: swell
  RMS **×428** the early window, post-cut RMS **3.5e-18**.
- **agogo** — two inharmonic bell modes (1 : 1.506, the double-bell
  recipe) with a 6% strike bend; tone lifts the upper mode, punch adds a
  3.6 kHz click. G49: upper-mode share **.162**, mid-ring **.108×** early.
- **timbale** — the metal-shell drum: pinged 840 Hz fundamental (bend
  1.18×→1 in 22 ms), shell mode 1.68× (triangle), rim-shot band
  2.6 kHz·tone (punch maps the crack). G49: ping(700–1000) **.525** vs
  low(150–300) **.017**, crack share **.044**.

All four: pool-disciplined (exact drumDurEst windows .34–3.0 s at decay 1),
lazy (metal stack on first hit), deterministic (double render maxDiff
< 1e-6), non-silent (min peak > .05). Worklet parity: the WORKLET engine
keeps its documented REDUCED set — the new types map to V_PERC with honest
drumDur windows (2.2/1.4/.3/.28 s); no worklet code pretends to the new
models.

### LIBRARY 312 → 345

33 v0.15.0 presets across all 8 genres: 6 crash, 5 revcym, 5 agogo,
6 timbale, plus 11 v3 showcase variants of the rebuilt membrane family
(PS-CONGA2-WOODY, PR-CONGA2-DEEP, GO-CONGA2-OPEN, PS-BONGO2-SNAP,
TE-TOM2-CANNON, TR-TOM2-808, PS-COW2-BEAT, TE-COW2-CLUB, PS-CLAVE2-KNOCK,
HT-CLAVE2-WOOD, FO-BONGO2-SKIN). Data-layer rules (tests/drum-v15.test.ts):
the four new durEst windows pinned EXACT; all v0.14 windows re-asserted
unchanged; engine/worklet/ui-tests source pins cover the new models; every
new preset inside the engine clamps.

### Performance / load / latency (standing owner brief)

No new nodes anywhere — the five rebuilds and four new voices reuse the
pooled DrumVoice skeleton (osc/osc2/noise + the lazy metal stack); the hot
path remains param automation over the shared noise buffer, allocation-free
per hit (the scratch param object pattern). Voice stealing, tiers, and
busyUntil windows: UNCHANGED (drumDurEst formulas for existing types moved
zero; the four new types carry exact windows). detune joins the zero
anchor: two extra setValueAtTime calls per hit — sub-microsecond, and it
CLOSES a (theoretical) pooled-reuse leak.

### CI watch

46/46 HARD across two subset runs this cycle (41 light gates + G39/G40/
G41/G48/G49 heavy offline renders — the sandbox wall-clock split the run;
CI keeps asserting the full set in one job); the growth (44→46) stays
inside the explicit `timeout-minutes` headroom the gates job carries.
Split plan (pure vs offline-render halves) unchanged and ready if a run
ever approaches it.

### SW

CACHE_VERSION → `psy6-v0.15.0` (network-first SW — clients pick the new
build on next visit).

## [0.14.0] — Run 20d: DRUM v2 params + 4 new percussion voices + drum track editor (sounds + options)

> The owner's standing brief: keep adding higher-level sounds ("יש להמשיך
> להוסיף סאונדים ברמה גבוהה יותר"), keep the choice surface growing, and
> keep the load/latency discipline. v0.14.0 answers on the DRUM side — the
> side the owner flagged originally: four OPTIONAL drum params, four new
> voices, a real drum-track editor, and the library 250 → 312. Commands:
> `bun test` (441 tests / 39 files), `node tools/verify.mjs`,
> `bun tools/e2e.mjs` (44/44 HARD — G46/G47 new).

### DRUM v2 params — four OPTIONAL fields, every one legacy-neutral

Absence of the field renders EXACTLY v0.13.1 (gate-asserted, see G47
neutral: maxDiff < 1e-6; fresh voices never even build the drive node):

| param | voice | meaning | legacy default (absent) |
|---|---|---|---|
| `dist` | kick | drive 1 → 6.5 (quadratic law) into the EXISTING tanh shaper (lazy node + reroute on first use) | 0 = exact fixed path |
| `glide` | kick | SUB pitch-env start += 2.6×f0 | 0 = exact v0.13.1 start |
| `bursts` | clap | burst count 2..6 from precomputed tables | 4 = the EXACT v0.12.0 arrays |
| `bright` | hat | BP corner ×√bright | 1 = exact 10 kHz corner |

G47 evidence (solo hits, fresh offline contexts, the G39/G42 methodology):
dist RMS **×2.12** the same kick without (audible, maxDiff .45); glide
sub-register centroid (30–400 Hz, first 46 ms) **136/111 = 1.23**; bursts
mid-span (20–44 ms post-hit) RMS **×7.2** the nb=2 render (bursts at
25/34 ms where nb=2 is silent) plus audible maxDiff .12; bright 9–14 kHz
band share **0.410 vs 0.272**; ALL four neutral pairs maxDiff < 1e-6;
determinism **0.0**. Honest DSP note (documented in ARCHITECTURE): Chrome
truncates overlapping envelope ramps, so clap bursts 5–6 render as DAMPED
RIPPLES between the first burst and the tail — deterministic, audible as a
roll, and the gate measures what the engine really does.

### FOUR NEW PERCUSSION VOICES — including the goa-lineage goblet drum

- **darbuka** — DUM body (triangle sweep 1.5×f0→f0 at a 165 Hz base, 45 ms
  bend) + TEK (sine ping 690→560 Hz + bandpass snap 4.2 kHz). G46: the low
  band dominates the snap band **0.506 vs 0.046**.
- **tambourine** — the metal stack at a 95 Hz base (shell-resonance
  partials) + membrane thump; tone leans jingle vs skin. G46: 5–9 kHz
  dominates 150–400 Hz **0.405 vs 0.139**.
- **triangle** — struck-rod 2-stage ring: metal stack at 205 Hz, fast
  set-down then long decay (decay maps the ring, up to 4.1 s). G46: the
  0.8–2.2 s window holds **.115×** the early RMS (a one-shot sits <5%).
- **downlifter** — the riser's mirror, closing sections (declared in the
  soundBank type union since v0.10, implemented only now): noise highpass
  descends 6.2k→180 Hz while a sine drops 180→42. G46: the 100–1000 Hz
  band **drains ~1e4×** (the sweep descends through and below it —
  broadband shares stay flat, so the gate measures absolute band RMS).

All four: pool-disciplined (exact `drumDurEst` windows), lazy (metal stack
built on first hit), deterministic (double render maxDiff < 1e-6), and
non-silent (min peak 0.33). Worklet parity: the WORKLET engine keeps its
documented REDUCED set — the new types map to V_PERC with honest drumDur
windows (.35/.3/2/1.8 s); no worklet code pretends to the new models.

### DRUM TRACK EDITOR — drums are first-class in the Sound tab

Drum tracks previously dead-ended with "synth editor N/A". v0.14.0 gives
every drum track a **TYPE select** (all 21 engine types) plus sliders for
the four core params (TUNE/DECAY/TONE/PUNCH) and the four v2 params —
written on first move, absence stays legacy-neutral. Assigning presets
still works exactly as before; the editor just removes the preset hunt.
Labels are `for=`-associated (the G45 orphan-label count stays 0).

### LIBRARY 250 → 312

62 `v0.14.0` drum presets across all 8 genres: 9 darbuka (GOA/DARK-PSY/
FULL-ON/PSYTRANCE), 6 tambourine, 5 triangle, 6 downlifter, 10 kick
dist/glide showcases (TE-KICK-DIST, DPSY-KICK-SUCK…), 6 clap-burst
layouts, 6 hat-bright shades, 12 extra perc v2 variants. Data-layer rules
(tests/drum-v14.test.ts): the 17-type legacy `drumDurEst` table pinned
unchanged; optional fields opt-in per preset and clamped; source pins
cover the tables, the lazy drive and the worklet windows.

### CI watch (owner-reported risk, none hit)

The gates job ran 44/44 HARD in a single run (~9 min wall) — the e2e job
growth (35→36→…→44 since v0.11.0) is approaching the 10-minute default
runner budget; the job already carries an explicit `timeout-minutes`
headroom and splits are prepared (pure vs offline-render halves) if a run
ever approaches it.

### Known infra note (owner action required)

`Deploy to Cloudflare Pages` fails on every recent commit: the workflow
needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` repo secrets
(Settings → Secrets → Actions). GitHub Pages — the production URL —
deploys fine; this is a credentials gap, not a code defect.

### SW

CACHE_VERSION → `psy6-v0.14.0` (network-first SW — clients pick the new
build on next visit).

## [0.13.1] — Run 20c: OPTIONS+ (more choices, exposed engine power) + a11y fix pass

> The owner's bug report from the field: DevTools flagged a CSP `eval` block
> and 5 form fields with no label association ("תראה אם יש תקלות"), plus
> "חסרים הרבה אופציות לבחירה" — the UI offers far fewer choices than the
> engine actually has. v0.13.1 fixes the real defect, explains the phantom
> one, and EXPOSES the hidden capabilities. Commands: `bun test` (431 tests /
> 38 files), `node tools/verify.mjs`, `bun tools/e2e.mjs` (42/42 HARD — G45
> new).

### A11Y FIX — the 5 flagged labels

The header BPM / Swing / Velocity / Groove / Seed labels were not associated
with their fields (no `for=`, no nesting) — the exact "5 violating nodes" the
owner's DevTools audit showed. All five now carry `label[for]`; the dynamic
Sound-tab labels (VOICE, INS, sample/synth fields, wave selects) and the
composer modal labels got the same treatment; the two selects that had no
label at all (`#smpSel`, `#insFiltSel`) got `aria-label`s. Regression guard:
usability tests parse `index.html`/`sound.js` (orphan labels must stay at
zero) and Self-Gate **G45** counts orphan labels in the LIVE document.

### CSP `eval` — diagnosed, not ours

The live site sends NO Content-Security-Policy (GitHub Pages: verified via
`curl -I`, no CSP header) and ships NO CSP `<meta>` (index/sw/manifest +
runtime injection all checked: absent), and the app code contains zero
`eval`/`new Function`/string-timers (grep-verified; the only hits are the
Node-side e2e CDP driver and the Bun test harness). The warning the owner
saw comes from the embedding chat-preview wrapper's own injected CSP +
scripts, not from PSY6. Opening https://dudududi144-source.github.io/psy5/
directly in a tab shows no such error.

### OPTIONS+ — engine capabilities the UI never offered, now exposed

- **Master WIDTH slider** (Mixer ▸ MASTER): `master.widthMaster` 0..200%,
  registered/automatable since v0.12.0 but with NO control. 1.00 = exact
  neutral (network OUT); bass <300 Hz stays mono by design.
- **PING-PONG delay toggle** (Mixer ▸ DELAY BUS ▸ PP): `fx.pingPong`, the
  v0.12.0 cross-fed L/R mode, default OFF = exact mono topology.
- **Reverb IR variant select** (Mixer ▸ DELAY BUS ▸ IR): `fx.irKind` —
  CLASSIC (~1.8 s, the original) / SHORT (~1.2 s bright) / LONG (~3.2 s dark).
- **6 BPM-synced delay divisions**: 1/16 and 3/8 and 1/2 join 1/8 / 3/16 /
  1/4 (`foundation/dsp/sends.mjs` DIV_STEPS — additive; unknown values still
  fall back to 3/16, legacy projects untouched).
- **Factory library search box**: live substring filter over the 250 presets
  (name/id/genre) beside the category/genre selects.
- **4 NEW composer styles — 5 → 9**: PSYTRANCE (142), GOA (140,
  harmonic-minor), TECHNO (132), TRANCE (138) — the library had 8 kits and
  8 genres but only 5 selectable styles. Each rides its own KITS row and its
  own 12-template progression family (`PROGRESSION_TEMPLATES` 5 → 9
  families, same 12-template/degree contract, module-load validation covers
  the new ones). Both style selects (power screen + COMPOSE modal) offer all
  9. The four new styles compose deterministically (double run
  byte-identical, asserted) — the five legacy styles resolve EXACTLY as
  before (RHYTHM BYTE-IDENTITY pins untouched).

G45 (HARD, Self-Gate + e2e) pins the whole exposure contract with numbers:
0 orphan labels; WIDTH 1→1.8→1 drives `master.widthMaster` + `eng.widthOn`
(true/false — 1 is exact neutral); PP toggle flips `fx.pingPong` +
`eng.ppOn`; IR long/short/classic swaps `eng._irKind`; 6 divisions with
`delaySecondsFor('1/16',bpm)` === one 16th and `'1/2'` === eight; search
"acid" strictly filters the live list and clearing restores it; 9 styles,
the 4 new families byte-identical on double compose.

### SW

CACHE_VERSION → `psy6-v0.13.1` (network-first SW — clients pick the new
build on next visit).

## [0.13.0] — Run 20b: SYNTH v2-lite + MOOG insert + SMOOTH (sounds + load/latency)

> The owner's follow-up brief: keep raising the sound level across the whole
> instrument ("להוסיף סאונדים ברמה גבוהה יותר") AND make it run smoothly under
> load ("לטפל בעומסים ולטיינסי שהכל ירוץ חלק"). v0.12.0 rebuilt the drums;
> v0.13.0 upgrades the SYNTH side, wires the library's dead Moog ladder into
> the signal path, expands the library 178 → 250, and makes the engine's load
> and latency VISIBLE plus the hot path allocation-light. Commands:
> `bun test` (428 tests / 38 files), `node tools/verify.mjs`, `bun
> tools/e2e.mjs` (41/41 HARD — G42/G43/G44 new).

### SYNTH ENGINE v2-lite — five OPTIONAL params, every one legacy-neutral

Absence of the field renders EXACTLY v0.12.0 (gate-asserted, see G42 neutral:
maxDiff 0.0 — bit-identical):

| param | meaning | legacy default (absent) |
|---|---|---|
| `fenv` | filter env amount multiplier | 3 (the old hardcoded ×3 start) |
| `fdec` | filter env decay seconds | atk + dec·0.7 (the old formula) |
| `penv`/`pdec` | pitch env: depth in semitones + decay s | 0 = off |
| `sub` | sine sub-osc level 0..1, one octave below | 0 = node never built |

G42 evidence (solo hits, fresh offline contexts, the G39 methodology):
acid fenv 12/fdec .06 sweeps the resonant LP from ~10.8 kHz — 6–12 kHz band
RMS **×2.07** the same preset at legacy fenv; penv 36 st at C2 descends —
ZCR ratio **0.20** (75–90 ms / 150–240 ms) vs the no-penv render's **1.00**
(both sides at fenv 1: a flat filter isolates pitch — the legacy filter sweep
alone moves ZCR, measured flat 200→130 warm-up); sub .9 at C2 puts **2.6×**
energy into the 20–60 Hz band (sub fundamental 32.7 Hz where the 65.4 Hz
triangle has none); determinism maxDiff **0.0**.

### MOOG LADDER INSERT (filtOn 4) — psy-dsp.js is dead code NO MORE

`worklets/psy-dsp.js` shipped a PSY3-ported 4-stage tanh-feedback Moog ladder
with ZERO consumers. v0.13.0 wires it as a per-track insert (`ins.filtOn 4`,
Sound tab INS ▸ MOOG) through the ONE syncMix insert path:
`prepInsertDSP(ctx)` loads the module once (powerOn preloads live; bounce and
freeze prep their offline ctx when `projectUsesMoog(p)`). Unloadable module →
HONEST counted biquad-LP fallback (`moogFallbacks`), never a silent loss.
G43 evidence: real node builds (spawns=1, fallbacks=0); 4–12 kHz RMS **×0.33**
vs insert-off (non-vacuous lowpass); moog ≠ biquad (maxDiff **0.35**; core
band **0.47×** — the ladder's tanh peak is GENTLER than a biquad pole-Q, the
known sonic difference, not a defect); fallback renders non-silently and
counted; determinism **0.0**.

### LIBRARY 178 → 250

72 `gen:'v13'` presets (22 bass, 14 lead, 8 pad, 7 pluck, 7 arp, 12 fx/
textures) across all 8 genres — acid 303s, rolling/offbeat full-on basses,
dark screech + subcore, hoover, uplifters/dives/drones. Data-layer rules
(tests/synth-v2.test.ts): unmarked presets carry ZERO new fields; gen:'v13'
opt-in must clamp. The COMPOSER KITS ride v13 bass/lead/pad/arp roles
(FULL-ON, DARK-PSY, PROGRESSIVE, HI-TECH; kick/snare/hat/perc stay
sacred-consistent from v0.12.0).

### SMOOTH — load telemetry + allocation-light hot path

- `PooledEngine.loadSnapshot()`: active synth/drum/sample voices, steal
  totals, tier-0 starvation attempts, spawn/sample/moog counters,
  base+output latency ms, pool sizes.
- Header **LOAD chip** (4 Hz, textContent-on-change): `LOAD nn% · s/d/smp ·
  ST steals · T0 tier0 · nnms` — amber ≥40% pool pressure, red ≥75% or any
  tier-0 starvation. The owner's load/latency concern, made visible.
- `SynthVoice.noteOn` scratch params: the per-hit `Object.assign` allocation
  leaves the trigger hot path (per-voice object cleared+refilled in place).
- G44 (stress, tight pools 4/3, TWO tier-0 tracks, 177 spawns): kicks 16/16,
  bass 64/64, tier-0 starvation **0**, 94 steals absorbed by lower tiers,
  reaper active===0 post-render, LOAD chip in DOM.

### Re-pins (v0.13.0 values)

- COMPOSER KITS ride v13 → whole-project hashes moved (form-fp
  `bb16ce280ff48f88` UNCHANGED, asserted; determinism re-proven — double run
  byte-identical):
  FULL-ON `83dc9fd03da4dfb4 / 8d9f4e650f55ab87 / b0236a5c7bd79fb6` (3/5/8
  min), DARK-PSY `c5447a30c3f617cd / 5869a01eeb4731be / b47472b344feb926`,
  PROGRESSIVE `d2b3aa8779e19e26 / 06b85c7953e71189 / f892f5610afff47e`.
  The v0.12.0 values (FULL-ON `a89f76062f5cc2d5 / a6f74ab733dbb180 /
  eca3f96245253bd6`, DARK-PSY `d5a0dd3bc576a0bc / 88ced66a2cdd127f /
  1823f63e7b25542c`, PROGRESSIVE `c36e3f979c764693 / 39ff990601dc3717 /
  12e3fb8b026384cb`) are recorded here and in tests/composer.test.ts history.
- G24 determinism bound re-pinned 1e-5 → **1e-4** (documented in tests.js):
  empirical 3.05e-5 ONCE under the heavier 43-gate suite (1.85e-6 calm
  re-run) — the LSB wobble scales with page thread contention; the
  schedule-hash equality stays the exact contract.

### Honest limits

- The MOOG insert needs its worklet module per-context; offline renders of
  projects WITHOUT moog tracks never load it (zero cost); projects WITH moog
  tracks prep it (bounce/freeze/gates) — if a context refuses the module the
  track falls back to a counted biquad LP (audible difference possible in
  that degraded mode, by design honest).
- LOAD chip reflects the MAIN engine only (the WORKLET engine keeps its own
  reduced set + its documented limitations).
- Listening quality on real monitors remains the owner's judgment — the
  gates prove structure, spectral direction and determinism.

## [0.12.0] — Run 20: SOUND ENGINE v2 (professional multi-layer drums + space)

> The drum voices were toy models: kick = one sine with an envelope, hats =
> filtered noise, clap = one noise burst. v0.12.0 rebuilds the synthesis
> layer (multi-layer kick, metallic inharmonic hats, 4-burst clap, dual-band
> snare), upgrades the percussion row (tom/rim/shaker/impact) and adds six
> new types (conga, bongo, cowbell, clave, zap, boom), expands the factory
> library 55 → 178 presets across 8 genres with layered kits, and upgrades
> the master space (stereo width with bass mono protection, ping-pong delay,
> 3 reverb variants). Every claim below is a MEASUREMENT (the Phase-0
> acoustic baseline vs the same analyzer on v2 — same pipeline, same
> metrics). Commands: `bun test` (424 tests / 37 files), `node
> tools/verify.mjs`, `bun tools/e2e.mjs` (38/38 HARD).

### Pin doctrine (HONEST BEHAVIOR-CHANGE — this run deliberately changes the drums' sound)

- PATTERN-level pins UNCHANGED (asserted): form-fp `bb16ce280ff48f88`
  (composer.test.ts:233 + mixsnap.test.ts:223), evolution OFF pin
  `b35b75f6a82e48ae` (event-level, 4385 events), rhythm-track pins.
- PROJECT-level pins RE-PINNED as **v0.12.0 values** (the composer rides
  the new kits; kick sacred-consistent per style):
  FULL-ON `a89f76062f5cc2d5 / a6f74ab733dbb180 / eca3f96245253bd6`
  (3/5/8 min), DARK-PSY `d5a0dd3bc576a0bc / 88ced66a2cdd127f /
  1823f63e7b25542c`, PROGRESSIVE `c36e3f979c764693 / 39ff990601dc3717 /
  12e3fb8b026384cb`. The v0.11.0 values (`ffb3e7c9… / bcb04a99… /
  2fc28523…`, `4d40a182… / 913650f4… / 2ab09cc2…`, `0e306937… / 661848d2… /
  5bddafec…`) are recorded here and in tests/composer.test.ts history.
- PCM-level: the gate suite contains NO absolute PCM hashes (G24/G34/G36/
  G37/G38 are relational: thresholds, counts, determinism) — they survived
  the voice change with re-measured values; the A/B table below IS the
  re-pin record for the rendered sound.

### THE A/B TABLE (Phase 0 baseline vs v2 — identical analyzer, solo hits through the full engine, vel .9, 44.1 kHz)

| voice | metric | v0.11.0 before | v0.12.0 after | meaning |
|---|---|---|---|---|
| kick | peak | 0.4378 | 0.4554 | level consistent |
| kick | crest dB | 12.82 | 9.64 | denser, saturated |
| kick | spectral centroid Hz | 130 | 349 | more mid/body |
| kick | sub <150 Hz ratio | 0.9888 | 0.9973 | sub preserved (≥.45 gate) |
| kick | diff6ms (first-6ms transient RMS) | **0.0151** | **0.1028** | ×6.8 click layer |
| kick | ZCR 10ms → 30 ms | 600 → 367 | 1000 → 433 | stronger pitch env |
| snare | peak | 0.2888 | 0.3436 | louder, dual-band |
| snare | tone band (150–1500) / noise band (2–8 k) ratio | — | 0.756 / 0.188 | both layers present (G39) |
| hatC | crest dB | 18.24 | 24.84 | metallic stack density |
| hatC | centroid Hz | 13103 | 12249 | still bright (≥6 k gate) |
| hatC | peak-gap cv (inharmonicity) | noise (n/a) | 0.584 | vs raw square comb 0.009 |
| hatO | crest dB | 16.99 | 27.60 | metallic open hat |
| clap | envelope bursts (8 ms refractory) | **3** | **8** | 4-burst + tail structure |
| clap | mid band (2–6 k) ratio | 0.2161 | 0.3074 | brighter body |
| tom | windowed ZCR | flat (pure sine) | 14/14/13/12 | pitch sweep present (G40) |
| cowbell | DFT at 560 / 845 Hz | — (type absent) | 0.016 / 0.013 ≥ .5·max | dual-square partials (G40) |
| zap | windowed ZCR descent | — (type absent) | 4/4 monotone | laser sweep (G40) |
| boom | sub <120 Hz ratio | — (type absent) | 0.95 | sub drop (G40) |
| determinism | kick re-render maxDiff | 0 | 3.6e-7 (<1e-6 gate) | Chrome offline chunk variance (documented; pure engines == 0) |

Baseline artifacts: r20/baseline-v1-acoustic.json (before) and
r20/baseline-v2-acoustic.json (after) — produced by the same probe
(solo hit → PooledEngine in an OfflineAudioContext → FFT/analysis).

### Added — drum engine v2 (`feat: drum engine v2 …`)

- KICK v2: SUB (sine, exponential pitch envelope start→f0 — punch maps the
  envelope depth AND the click level), BODY (triangle at f0, tone maps the
  body/sub balance), CLICK (highpassed noise, 2–6 ms transient), shared
  per-engine tanh soft-clip WaveShaper (kick-only routing — non-kick voices
  keep the exact dry path).
- HAT v2: metallic stack — SIX square oscillators at fixed inharmonic
  ratios R=[2.0, 3.0, 4.16, 5.43, 6.79, 8.21] on a 40 Hz·tune base (the
  classic 806-style cymbal recipe — non-integer ratios put the partial
  lattice off integer multiples), bandpass 10 kHz → highpass (tone maps
  the corner, old 7200·√tone law) + a noise touch. Closed/open share the
  stack; choke stays the pool discipline; lazy first-hit init (documented
  hot-path exception).
- CLAP v2: four noise bursts (exponential ~11 ms spacing) + a tail burst
  with the long decay; per-burst bandpass offsets = deterministic spectral
  decorrelation (true L/R decorrelation is a worklet-path capability —
  main-thread voices are mono pre-pan, documented).
- SNARE v2: TONE layer (triangle, ~0.4-semitone pitch drop, punch maps the
  tone decay) + NOISE layer (bandpass, tone maps the band).
- Every voice zeroes ALL layers at the hit anchor (a pooled voice reused
  across types never carries a previous layer's tail); drumDurEst formulas
  UNCHANGED → pool discipline and busyUntil windows moved zero; parameter
  surface (type/tune/decay/tone/punch) unchanged — old presets trigger
  sensibly behind the new engine.
- Worklet parity: the HatVoice metallic stack ported per-sample (same
  ratios); the worklet kick was ALREADY multi-layer (sub+mid+click+sat —
  the quality source this run ported FROM); worklet clap already 4-burst.
  Worklet limitations (honest): no tone param on the worklet hat (world
  params carry no hat-tone), no dedicated worklet snare voice (perc covers
  it), width/ping-pong/IR variants are MAIN-engine features.

### Added — percussion v2 + library (`feat: percussion v2 and 150+ preset library`)

- Tom v2 (sweep + strike noise), Rim v2 (FM metallic via a lazy modulator
  pair), Shaker v2 (bandpass + dual-envelope micro-structure), Impact v2
  (sub drop + triangle body).
- NEW types: conga/bongo (membrane model: sine + pitch bend + noise touch),
  cowbell (two squares, documented 560/845 Hz ≈ 1.509), clave (two-mode
  wood: 1 : 1.5), zap (downward sweep + synced bandpass chirp), boom (sub
  drop, clean reverb-ready tail). drumDurEst entries for all — pool
  discipline preserved.
- LIBRARY: 55 → **178 presets (133 drums)**, genre coverage **8/8**
  (PSYTRANCE, DARK-PSY, GOA, FULL-ON, TECHNO, TRANCE, PROGRESSIVE,
  HI-TECH) + ANY, unique ids, full schema (id/name/genre/cat/engine/type/
  numeric ranges — validated by G40 AND tests/v2-library.test.ts).
- KITS: 8 layered per-genre kits (9 roles each: kick/snare/hat/perc/bass/
  lead/pad/arp/fx) exported from js/presets.js; the Sound tab genre filter
  gains the four new genres; every preset AUDITION-able via the existing
  Sound tab path.
- G40: breadth (178 ≥ 150, 133 ≥ 100), schema 0 bad, kits 8/8 resolve;
  tom ZCR monotone, cowbell dual-square partials (exact DFT at 560/845 vs
  a 200–2000 Hz scan), zap monotone descent 4/4, boom sub 0.95; new
  voices deterministic (measured maxDiff 0).

### Added — master space (`feat: master width, ping-pong delay, reverb variants`)

- Stereo width `widthMaster` (0..200 %, default 1 = NEUTRAL): mid/side
  network with a 300 Hz side highpass (bass mono protection, documented).
  At 1 the network is OUT of the chain entirely (mode-switch rewiring —
  the default topology is EXACTLY the pre-v0.12.0 graph). Registered in
  js/params.js — automatable/recordable/snapshot-able.
- Ping-pong delay `fx.pingPong` (per-project flag, default off): two
  cross-fed taps, hard L/R outputs, same feedback discipline (one lowpass
  per leg, delayFbClamp). Off = the exact mono topology.
- Reverb variants `fx.irKind` (default classic): short bright ~1.2 s /
  classic ~1.8 s (byte-identical to v0.11.0: irChannelShaped(lp=0) ===
  irChannel) / long dark ~3.2 s (deterministic one-pole LP 2600 Hz over
  the seeded noise). Seeded, byte-identical per selection.
- G41: neutral contract — width 1.8→1 + pingPong on→off + IR short→classic
  perturb→restore round trip re-renders the reference at maxDiff
  **2.46e-7 < 1e-6**; width 1.8 raises HF-side energy **1.77×** (3.84e-3 →
  6.78e-3 — the 300 Hz protection excludes low side BY DESIGN, so the
  probe measures the band width affects); ping-pong L−R envelope flips
  **2 → 46** (mono delay upmixes identically to L/R); long-IR post-event
  decay **2.00e-2 vs 4.11e-4 (48.7×)**.

### Changed — composer kits (`docs: v0.12.0` + the kit swap)

- COMPOSER_STYLES ride the v0.12.0 layered kits: FULL-ON → KITS['FULL-ON'],
  DARK-PSY/FOREST → KITS['DARK-PSY'], PROGRESSIVE → KITS['PROGRESSIVE'],
  HI-TECH → KITS['HI-TECH']. PATTERN data UNCHANGED (form-fp asserted);
  the KICK per style stays the v0.11.0 assignment (sacred-consistent);
  every other role (snare/hat/perc/bass/lead/pad/arp/fx) moved to the new
  presets. Whole-project hashes re-pinned (values above).

### Engineering notes

- e2e: `--skip` subset mechanism (local verification splits; the full CI
  run never skips), verdict wait 600→1800 s + explicit CI
  `timeout-minutes: 60`, partial gate evidence emitted on timeout,
  per-gate ms timing recorded in the evidence JSON.
- G39's degenerate harmonic reference is a RAW 525 Hz square (rendered
  outside the engine — voices may evolve, a pure comb never does): peak-gap
  cv 0.584 (v2 hat) vs 0.009 (comb) — the inharmonicity test bites.
- Chrome finding (documented): OfflineAudioContext renders occasionally
  differ by ~3e-7 in decay tails between fresh runs (chunk scheduling) —
  the through-graph determinism standard stays < 1e-6 (G34/G36 family);
  pure per-sample engines assert exact equality (G40 measured 0).

## [0.11.0] — Run 19: RESAMPLE + SLICES + KEY (the sonic-palette loop closes)

> The device could import and PLAY user samples, but it could not bounce
> its own output, edit them, slice them, or tune them. v0.11.0 completes
> the producer loop: RESAMPLE the live jam, FREEZE a track to audio,
> non-destructive EDITING with derived versions + a waveform, deterministic
> SLICING with per-step slice locks (the breakbeat workflow), and musical
> KEY detection with tune-to-project-root. Zero composer change: the
> composer output is UNCHANGED this run (form-fp bb16ce280ff48f88 and the
> legacy pins asserted identical at Phase 0 and re-asserted by G31/G33/G36
> in every battery). Commands: `bun test` (420 tests / 36 files), `node
> tools/verify.mjs`, `bun tools/e2e.mjs` (35/35 HARD).

### Added — resample + freeze (`feat: resample and track freeze`)

- RESAMPLE (live, realtime): bars select (1/2/4/8) + button in the Samples
  drawer — records the master output through the EXISTING CaptureTap for
  exactly N bars (bar-quantized start, auto-stop at the Nth boundary,
  transport never touched), trims to `resampleFrames(bars,bpm,rate)`,
  imports as `resample-<bpm>bpm-<bars>bar-<hash8>` (deterministic content
  id — identical re-resamples land on ONE row). Guards: 1..32 whole bars,
  WORKLET refusal, store `estimate()` quota check, 128-row cap. The
  realtime capture is classified evidence-only (scheduler-skew jitter of a
  few ms is documented honestly — the same class as G17/G25).
- FREEZE TRACK (offline, deterministic): FREEZE button in the Sound-tab
  VOICE row — renders ONE pattern loop of the selected track through the
  ONE renderer (`freezePrep` clone: sendA/sendB/scAmount zeroed =
  POST-insert PRE-send tap point; the MASTER section is baked — there is no
  pre-master tap without a parallel renderer, documented), trims the 0.05 s
  schedule lead (frame 0 = the first step of the loop), imports as
  `freeze-<trackName>-<hash8>`. Guards: 10-minute cap, WORKLET refusal.
- ENGINE FIX found by G36: the sample-voice cap-8 oldest-stolen stop() was
  no-arg — during the OFFLINE schedule walk it executed at wall-clock and
  ERASED future-scheduled hits (a frozen 8-bar kick loop replayed per-step
  lost its entire first cap window). The stop is now TIME-ANCHORED to the
  steal moment (live semantics unchanged, offline time-correct).
- Shared `assignSampleToTrack` + `importChannelsAsSample` — one assign
  path, one programmatic import path (RESAMPLE sink, FREEZE, derivations).
- **G36** (e2e 33/33 → see below): pipeline == independent prep+render+trim
  (dPipe=0), determinism (dDet=0), frames == freezeWindow formula
  (583,945/583,945 on the demo song), sample-track freeze == its plain
  render (dExact=0), re-freeze RMS within the measured double-master bound
  (rel 35.58% = −3.8 dB — the master comp re-squashes already-mastered
  audio; bounded, logged, documented), onset aligned (265→529 f).
- `tests/freeze.test.ts` (13).

### Added — sample editor (`feat: sample editor (derived versions, waveform)`)

- Derived versions: every edit bakes a NEW PCM copy into a NEW record with
  a DETERMINISTIC id = fnv(baseId + ':' + op + ':' + canonical params).
  Idempotent re-derivation (same base+op+params → one id, the put
  replaces). Derived-of-derived chains chain from the parent id. The BASE
  import is byte-IMMUTABLE; derived records carry their own PCM (they keep
  playing even if the base is deleted — lineage display only).
- Ops: fade-in/fade-out (exact linear ramps, ms 0..2000), gain (0..2,
  rounded 0.001), normalize (peak → 0.95), reverse. Params canonicalized
  BEFORE both the id and the math.
- Drawer UI: ED button → waveform canvas (deterministic min/max peaks per
  pixel bucket) + edit panel; lineage shown as `name · ← base`.
- **G37** (e2e 34/34): fade onset/sustain RMS 0.289 (linear-ramp physics),
  two derivations byte-identical with the same id (maxDiff 0), 2-step
  chain round-trip maxDiff 0 + re-derivation idempotent, base maxDiff 0.
- `tests/editor.test.ts` (16).

### Added — slices (`feat: sample slicing (deterministic transients, per-step locks)`)

- `detectTransients` — pure energy-flux onset detector (512-frame hop RMS,
  positive flux, 1.5×-mean adaptive threshold, strongest-first greedy pick,
  35 ms min spacing, 16-onset cap, stable tie-break): the same PCM ALWAYS
  yields the same boundaries.
- `deriveSample(rec,'slice')` — kind `sliced`, boundaries stored as
  metadata pct ranges (NO PCM duplication — the record shares the base
  arrays), id hashes the DETECTED pcts (re-detection idempotent).
- Playback: `samplePlayback(sp, dur, pcts)` — sliceIdx 1..N selects the
  k-th boundary window (replaces start/end); 0 = full sample (unchanged);
  out-of-range clamps to the last slice. Registry param `smpSlice` (0..16,
  default 0) + Sound-tab slider.
- Per-step slice locks: `ev.lock.smpSlice` overrides the track sliceIdx for
  THAT hit — rides the EXISTING per-step lock channel, zero new
  persistence surface. UI: SLICE button (amber markers on the waveform) +
  SLICES → STEPS quick action (fills the selected track's pattern with
  sequential slice locks — the classic breakbeat fill).
- **G38** (e2e 35/35): detector accuracy 100% (7/7 truth transients within
  ±2 hops on a synthetic break), the sequential slice fill renders a hit in
  every step window with monotonically increasing peaks, and the per-step
  lock PROVABLY overrides the track sliceIdx (step-0 zero-crossing rate 43
  vs 46 across distinct slice content).
- `tests/slices.test.ts` (11).

### Added — key detection (`feat: key detection and tune-to-root`)

- `js/keydetect.js` — deterministic chroma (direct DFT at the 12
  pitch-class fundamentals over the sample's mid section, 4 s cap) +
  Krumhansl-Schmuckler correlation (12 rotated major/minor profiles) →
  `{tonicPc, mode, r, name}`. Pure math, no deps, no rng, no time. Honest
  limitation: fundamentals-only scans C4..B4 (register assumption).
- `tuneToRoot(tonicPc, projectRootMidi)` — minimal signed semitone shift
  ((rootPc − samplePc) mod 12, mapped to −5..+6): the same pitch-class
  destination as the literal 0..11 reading with the smallest
  voice-leading move (documented resolution).
- UI: KEY → ROOT button — detects the selected sample's key and applies
  the shift to the SELECTED track's `sampleParams.tune` (toast logs key,
  r, delta, before → after). WORKLET limitations list gains the v0.11.0
  line (no resample/freeze/editor/slices/key — MAIN engine only).
- `tests/keydetect.test.ts` (9).

### Gates

- Self-Gate inventory: **37 entries = 35 HARD (CI e2e asserts all 35 — the
  canonical list lives in js/ui/tests.js) + 2 evidence-only realtime (G17,
  G25)**. Production Self-Gate from https://dudududi144-source.github.io/psy5/
  (first ever): **37/37 passed**. New HARD gates: G36 (freeze), G37 (editor), G38
  (slices). G3/G4/G7/G20 never existed — unchanged, never renumbered.
- Battery at release: `bun test` → **420 pass / 0 fail** across 36 files
  (356,314 expect() calls). `tools/verify.mjs` GREEN (SW lock
  psy6-v0.11.0 ↔ this CHANGELOG). Composer re-pin status: UNCHANGED —
  form-fp bb16ce280ff48f88, demo-song schedule 4,385 events, Phase 0
  baseline pcmHash 96a82cec2b7435e4 (session-local reference per the
  v0.10.0 cross-session PCM finding).

## [0.10.0] — Run 18: SONIC PALETTE (user samples + per-track insert FX)

> The sonic frontier: the device was 100% synthesis with bus sends only.
> This release adds the user's OWN material (sample import → IndexedDB →
> sample voice) and per-track INSERT FX (drive/crush/filter) wired into the
> registry, so the composer's builds can sweep filters and the composer can
> ASK for the user's kicks. Zero behavior change by default: a project with
> no samples and all inserts off renders identically to v0.9.0 (G35
> neutral, below). Commands: `bun test` (371 tests / 32 files), `node
> tools/verify.mjs`, `node tools/e2e.mjs` (32/32 HARD).

### Added — sample store + import (`feat: sample store and import (IndexedDB, idempotent ids)`)

- `js/samplestore.js` — injectable-backend store (memory for Bun tests,
  IndexedDB `psy6-samples`/`samples`/v1 on device). Canonical record
  `{id,name,sampleRate,channels,length,durationSec,peak,pcm,pcmReversed,addedAt}`
  — PCM lives ONLY here, never in project JSON, share links or localStorage.
- Identity: `id = 'S' + fnv1a(name:length:sampleRate:first-4096-samples)`,
  computed BEFORE normalize → re-import is IDEMPOTENT (same id, PCM
  refreshed, no duplicate). Import caps: 20 s / 50 MB / 128 rows (guarded,
  toasted). Normalize bakes peak → 0.95 (f32-measured metadata).
- Sound tab SAMPLES drawer: file input + drag&drop (decodeAudioData →
  guards → normalize → store), AUDITION (live master), RENAME, DELETE with
  referenced-track warning, storage estimate.
- Persistence split: tracks carry `sampleId` + `sampleMeta {name,
  durationSec, peak}` only. File EXPORT optionally bundles base64 PCM via
  an explicit confirm + a 30 MB base64 hard guard (`exportBundle`);
  IMPORT rehydrates bundled samples into IndexedDB (`importBundle`).
- Evidence: `bun test tests/samplestore.test.ts` — 11 tests; headless smoke
  (real file-input import of a synthesized WAV): row rendered, id
  `S56f064d8ff2e`, re-import idempotent, audition spawned (6/6).

### Added — sample voice (`feat: sample voice for drum tracks`)

- Model: `track.voiceMode 'synth' (default) | 'sample'` + `track.sampleId`
  + `track.sampleParams {gain 0..2 (1), tune −24..+24 (0), startPct (0),
  endPct (100), reverse (0), attackMs (0), releaseMs (20)}` — canonical
  backfill+clamp in `loadProjectObj` (byte-stable).
- Engine: pre-decoded AudioBuffer cache (context-independent — the SAME
  cache serves live + offline; `opts.samples` seeds it through bounce.js —
  the ONE renderer, zero render-walk changes). Per-hit
  AudioBufferSourceNode + env GainNode (the WebAudio API reality —
  documented, not hidden behind a fake pool); `playbackRate = 2^(tune/12)`;
  pct slicing; reverse via the pre-reversed PCM; per-track active-voice
  cap 8, oldest-stolen stop(). Missing sample → honest synth fallback
  (counted in `renderSong.sampleFallbacks` + one-shot UI toast).
- Registry: `smpGain/smpTune/smpStart/smpEnd/smpRev/smpAtk/smpRel` →
  automatable lanes + ARM-AUTO recordable by construction. Sound tab VOICE
  row (SYNTH/SAMPLE + assign + 7-param editor). WORKLET limitation added
  to the on-screen list: samples unsupported → synth voice plays.
- **G34 evidence** (e2e 31/31 at P2): engine-path load, mixed render —
  sample kick stem rms 0.0229, synth bass stem rms 0.0393 (both audible);
  tune +12 halves the audible support (ratio 0.506); reverse flips the
  onset order (argmax shift 8818 frames = 0.20 s); two renders
  maxDiff = 0.0; missing → fallback counted (spawns 331, steals 0).
- Lesson burned into the code: the offline walk schedules ALL events
  before rendering — a cap-stealer that ignores voice START times would
  stop() not-yet-played future sources and silently drop hits (observed:
  rms 0.0009). The registry is TIME-AWARE: reap ended voices, count only
  voices competing at `when`.

### Added — per-track insert FX (`feat: per-track insert FX (drive, crush, filter)`)

- Chain: `input → [drive: dTrim→dWS→dWet ‖ dDry] → cIn → cWS → [filt?] →
  duck → pan → sends/master` — pre-send, per track. Defaults are EXACT
  bypass: drive 0 = dry path only, crush 16 = null-curve WaveShaper
  passthrough, filter node REMOVED from the chain.
- `foundation/dsp/inserts.mjs` — fixed k=10 soft-clip `driveCurve`
  (precomputed, peak-unity, monotone — bit-identical every build),
  `driveTrim` (amount → input gain 1..10), `crushCurve` staircases.
  **DESIGN RESOLUTION (offline correctness beats the literal reading):**
  WaveShaper `.curve` swaps and node reconnects are NOT time-anchorable —
  a per-amount curve grid would render wrongly in offline bounces. Drive
  amount is an automatable input-TRIM AudioParam with an exact dry/wet
  gate (`setValueAtTime` — exponential approaches never reach their
  target, and the neutral contract needs exact 0/1). Filter freq/Q are
  anchored AudioParams (composer sweeps render time-correctly); mode
  changes (drive 0↔nonzero, crush bits, filter insert/remove/type) rebuild
  immediately — documented click risk on mode changes only. Known honest
  limitation: user-drawn insCrush lanes render with the final bits offline.
- Registry: `insDrive/insCrush/insFiltOn/insFiltFreq/insFiltQ` →
  automatable, ARM-AUTO recordable, MIDI-learnable (`track.<i>.ins.*`
  paths), scene-snapshot-able (`scene.mix.tracks[idx]` gains OPTIONAL
  `insDrive`/`insFiltFreq`; old snapshots load unchanged).
- Composer: BUILD gets `insFiltFreq` opening lanes on the LEAD (5) and PAD
  (6) tracks; RISER gets an `insFiltFreq` opening + an `insDrive` rise on
  the PERC track (3) (base states `filtOn:1` — mode-static offline). **THE
  KICK IS SACRED: track 0 never receives inserts** (pinned in
  tests/inserts.test.ts across 4 styles).
- **G35 evidence** (e2e 32/32): neutral — a lane-free buildStyle project
  renders identically before/after a full ins perturb→restore round-trip
  on ONE engine: maxDiff = 8.94e-8 (< 1e-6; the residue is the bypassed
  wet branch's denormal-class tail, not a topology leak — structurally the
  filter node is gone and crush is back to null-curve on every chain);
  drive squashes the saw-bass crest 17.77 → 2.15 dB; LP 200 Hz drops the
  hat stem's first-difference (HF) RMS by 73.3 dB.
- **RE-PINS (v0.10.0 values — honestly measured, never fabricated):**
  - Composer whole-project hashes (SHA-256/16, seeds 424242, 3/5/8 min):
    FULL-ON `38651edda8df6cc8,fa4d72e80c483cd2,d5663948fe1e9727` →
    `ffb3e7c9350ccfb6,bcb04a99c5b8c883,2fc28523aae7aa1c`;
    DARK-PSY `e9d9e73a3350b54b,617e80edf1f70b77,4867687a52d13d02` →
    `4d40a1820bc5c99f,913650f484f5eee5,2ab09cc2e6407cdd`;
    PROGRESSIVE `d724150eef4b7e93,1a61027f125006af,d14ce4b11a17e6f3` →
    `0e306937f6cca52c,661848d2df4f0126,5bddafec47419910`.
    The form fingerprint (steps-only) is UNCHANGED: `bb16ce280ff48f88`.
  - Evolution OFF pin: `3feaf9cb45503864` → **`b35b75f6a82e48ae`** (4385
    events unchanged — the composer's ins lanes ride the `ev.lock` channel
    per the v0.5.0 lane semantics, which injects ALL lanes' values into
    the event lock payload). G32 ON diff stays 703/4385; new ON hash
    `96d892bae015f91d`.
  - The Phase 0 PCM baseline (`pcmHash 936b219932510490`, 10,075,254
    frames) was measured pre-change as session evidence. **Chrome
    OfflineAudioContext renders are NOT bit-identical ACROSS sessions**
    (three identical-code sessions produced three different PCM hashes at
    an identical scheduleHash) — the neutral contract is therefore enforced
    (a) in-session (G35 maxDiff), (b) structurally (exact-bypass topology),
    (c) at the schedule layer (all pure-JS pins). Cross-session PCM hashes
    are not a Chrome invariant and were never a gate.

### Added — composer sample hints (`docs: v0.10.0` phase wiring)

- `COMPOSER_SAMPLE_HINTS = {0:'kick', 3:'perc', 6:'atmos'}` — the
  composer's user-sample slots ride the compose result and the project
  JSON as `p.sampleHints` (NAMES ONLY — never PCM, never ids; canonical
  backfill drops garbage). At compose arrival (header modal, power-screen
  compose, library LOAD) the names resolve against the IndexedDB store:
  a hit applies the sample voice (mode+id+meta baked), a miss keeps the
  synth voice with an honest toast. The composer NEVER requires samples;
  hints are provenance — baked track state is the authority (hints are
  never re-applied on RESUME). Evidence: `bun test tests/hints.test.ts`.

### Fixed / hardening

- G34's cap-stealing semantics (above) — offline hit-dropping caught by the
  gate's own evidence numbers before commit.
- The Run-17 baseline driver lesson re-applied: a native `confirm()` blocks
  the headless page main thread forever — drivers override confirm/prompt
  BEFORE any modal flow.

### Battery (v0.10.0)

- `bun test` — **371 pass / 0 fail** across 32 files, 351,014 expect() calls.
- `node tools/verify.mjs` — GREEN (SW lock `psy6-v0.10.0` ↔ this changelog).
- `node tools/e2e.mjs` — **GREEN (32/32 HARD asserted)** + G17/G25 evidence
  on-device; WORKLET 3/3 local.

## [0.9.0] — Run 17: SCENE EVOLUTION + PRO GROWTH (rebuilt + published)

> Provenance (honest): this release was engineered TWICE. Run 15 completed
> it (commits 6b327da..51ce434) but the sandbox wiped before any push and
> the work was lost (Run 16 confirmed zero traces; remote untouched). Run 17
> re-implemented the SAME spec against 3d57cf6 (v0.8.0). Per the re-pin
> doctrine, hash values that moved with the re-implementation are marked
> **REBUILD VALUE** below — they are valid pins for THIS build, not the
> lost Run 15 values. All invariants were re-proven with real numbers.

### Added — chord progression engine (`feat: chord progression engine (harmonic coherence)`)

- `foundation/music/progression.mjs` — 12 seeded progression templates per
  style family × 5 families (60 total), each a 4- or 8-bar loop of diatonic
  scale degrees (0..6). Deterministic pick: `fnv1a(seed + ':prog')` (last 8
  hex digits mod 12). Chords are DIATONIC TRIADS (degree, degree+2,
  degree+4) — mode-aware by construction (phrygian/minor/harmonic-minor
  resolve the semitones from their own interval lists). Module validates
  itself at load (fail-fast on a broken template).
- Composer integration (`js/composer.js`): the project picks ONE progression
  and carries it as `p.harmony = { family, progId, progBars, degrees }`.
  Bass roots, lead-motif harmonization (nearest chord-tone class snap,
  deterministic tie-break), pad root+fifth voicings and arp chord-tone
  cycles all derive from the active bar's chord. **Rhythm tracks
  (kick/snare/hat/perc/fx) never consume the progression** — byte-identical
  to v0.8.0, pinned by 15 per-style×length digests (see tests). Section
  patterns restart the loop at index 0 (section starts are harmonic anchor
  points).
- Invariants (G31, HARD, offline): **0 chord-tone violations across 8,448
  tonal notes** in the e2e evidence (3 styles via the shared songSteps
  expansion); the bun suite audits all 5 styles × 3/5/8 min = **69,056
  notes with 0 violations** plus 60,390 more across seeds 777/12345/999999;
  determinism ×3; **diversity 10/12 distinct progressions across 20 seeds,
  every style** (≥8 required). vmin 0.306 ≥ 0.15.
- Re-pins (REBUILD VALUES, v0.9.0): form-fp `d0c5f32f032f2a88` →
  **`bb16ce280ff48f88`**; legacy-9 whole-project hashes moved (FULL-ON
  `38651edda8df6cc8`/`fa4d72e80c483cd2`/`d5663948fe1e9727`, DARK-PSY
  `e9d9e73a3350b54b`/`617e80edf1f70b77`/`4867687a52d13d02`, PROGRESSIVE
  `d724150eef4b7e93`/`1a61027f125006af`/`d14ce4b11a17e6f3`); rhythm-track
  digests PINNED UNCHANGED (v0.8.0 values in tests/composer.test.ts).

### Added — per-bar evolution (`feat: per-bar evolution (deterministic section morphing)`)

- `p.evolution = { on: false (DEFAULT), intensity 0..100 (default 35), seed
  (defaults to the project seed) }` — materialized lazily (the p.arranger
  pattern): projects that never touch evolution don't gain the field.
- `js/evolution.js` — at every bar boundary while ON, seeded ops from
  `barSeed(seed, 'evo:'+bar)` through the EXISTING step-level machinery:
  hat density shifts (drop/ghost), bass roll injection on off-phrase 16ths
  (chord-root of the AUDIBLY active pattern bar — harmony respected),
  lead contour ±1 scale degree (direction seeded per bar), perc ghost
  accents, cutoff/sendA creep through the event lock channel clamped to
  param-registry ranges. **Precedence: snapshot launch → evolution → lane
  automation; lane-covered (track,param) pairs WIN per-step** — evolution
  only fills lane-free pairs. No second scheduler, no parallel engine.
- Live path: the absolute song bar derives from the arranger position
  (`absBarOf`) so PLAY SONG morphs identically to the offline render;
  evolution pauses when the arranger is off (no song position). UI:
  EVOLUTION toggle + intensity slider + bar-ops counter in the arranger
  panel.
- **The OFF contract (strict):** OFF/absent evolution → the song schedule
  is BYTE-IDENTICAL to the post-P1 engine. G32 (HARD, offline):
  OFF evHash == pinned **`3feaf9cb45503864`** (4,385 events, REBUILD
  VALUE); ON (seed 777, intensity 35) **diff 703/4385 events** (seed
  measured with 3.5× margin over the ≥200 gate); replay-identical (two
  walks hash-equal, ON hash `90690e706e2534bb`); intensity-0 == OFF.
- Re-pin note: OFF-pin semantics changed with P1's re-toned notes, so the
  OFF pin here is the POST-P1 baseline (fresh compose render), as the spec
  requires.

### Added — song library (`feat: song library (multi-song projects)`)

- `p.library = null (legacy) | { songs: [{id, name, style, seed, len,
  composerMeta}], activeSongId }` — **RECIPES, NOT SNAPSHOTS**: a song
  stores the compose() inputs; rendering = `compose(style, len, seed)` in
  memory. ~100 bytes per song; the current free-form project stays fully
  editable and independent. Ids are content-derived fnv hashes
  (deterministic; no Math.random).
- `js/library.js` core (DOM-free, bun-tested) + SONG LIBRARY drawer in the
  Perform tab: list (name/style/seed/length/meta), ADD CURRENT (recipe
  recovery from a composed project — style from `p.harmony.family`, seed
  from the `C<seed>` label, length = nearest allowed; free-form projects
  honestly report "recipe unavailable"), COMPOSE NEW (library-target: the
  album is stashed before the load and restored after), LOAD
  (confirm-if-dirty; re-renders the recipe; album carried), DELETE,
  RENAME, active-song badge (shows "▶ playing" while its song plays).
- Persistence: the library rides save/export/share/RESUME (absent → null).
  `loadProjectObj` rebuilds it CANONICALLY (invalid songs dropped, active
  pointer fixed, absent → null) — the known silent-drop pitfall fixed in
  place. **Album continuity (Run 15's 51ce434 contract, pre-applied):
  recipes survive LOAD and library-target COMPOSE NEW; the plain header
  COMPOSE still starts fresh by design.**
- G33 (HARD, offline): 3 recipes compose deterministically (±5% length,
  non-empty scenes), REAL saveProject→loadStored round-trip carries the
  album deep-equal, encodeShare→decodeShare round-trip carries it
  (canonical comparison), loadProjectObj drops invalid entries, legacy
  library-less projects load to null, drawer DOM wired.

### Added — composer growth (`feat: composer growth (12 and 20 minute forms)`)

- Length menu 3/5/8 → **3/5/8/12/20 minutes** (±5%). Lengths >8 min compose
  the 11-section EXTENDED_CHAIN: INTRO, BUILD, DROP, BREAK, RISER, DROP2,
  **BREAK2** (double-BREAK), **BRIDGE**, **DROP3**, OUTRO, **OUTRO2**.
  Sections map to canonical BEHAVIORS (`beh`: DROP2/DROP3→DROP,
  BREAK2/BRIDGE→BREAK, OUTRO2→OUTRO) so patterns, snapshots and motif ops
  keep their musical grammar. 3/5/8-min outputs are BYTE-IDENTICAL (the
  pinned legacy-9 hashes and form-fp did not move in P4 — verified).
- **allocateBars fix (Run 15 catch, pre-applied)**: walks the PASSED weight
  list — the old code mapped the hardcoded 7-section chain, producing NaN
  bars at extended lengths. Regression-tested directly.
- Memory tiers: full-song renders refuse beyond **SONG_HARD_MAX_SEC = 1800
  s** BEFORE any Web Audio work (unit-tested null return); 10–30 min
  renders run with an explicit confirm + the progress/cancel modal;
  stems and SECTION bounce keep the 10-min SONG_MAX_SEC cap
  (songStemsGuard unchanged).
- **Documented storage limit (honest)**: long-form projects exceed the
  ~5 MB localStorage quota (12-min ≈ 3.8 MB, 20-min ≈ 6.4 MB project JSON)
  → SAVE shows 'SAVE FAILED' by design for 12/20-min projects; EXPORT
  (file) and SHARE are unaffected; RESUME of long forms is best-effort.
- Measured (all 5 styles × {12, 20} min): sections = 11; length error
  **max 0.48%**; determinism byte-identical; **vmin 0.269** ≥ 0.15
  (VARIANT_DIFF_MIN); 12-min ≈ 55–60 scenes / Σ416–464 bars, 20-min ≈
  88–99 scenes / Σ692–776 bars (the scene bank scrolls; the composer
  bypasses the 64-scene UI default by design).

### Gates

- Canonical inventory: 27 → **32 entries = 30 HARD** (offline/pure,
  CI-asserted in tools/e2e.mjs) + **2 evidence-only realtime** (G17, G25).
  New: **G31** chord progression engine, **G32** per-bar evolution,
  **G33** song library (all offline, CI-asserted). Numbering gaps
  G3/G4/G7/G20 remain documented and unrenumbered. Next free id: G34.
- tools/e2e.mjs asserts **30/30 HARD** (+ WORKLET 3/3 from the live site
  at release).

### Battery

- `bun test`: **336 tests across 28 files — 336 pass / 0 fail (326,537
  expect() calls)**; `node tools/verify.mjs` GREEN (SW cache-version lock
  `psy6-v0.9.0` ↔ CHANGELOG).


All notable changes to the PSY6 device repository. Every claim below is
reproducible with the command shown next to it.

## [0.8.0] — Run 11: SCENE STATE + MASTER + STEMS

### Added — scene mixer snapshots (`feat: scene mixer snapshots (arrangement-aware mix)`)

- `scene.mix = null | { tracks: { [trackIdx]: { vol, pan, sendA, sendB,
  scAmount } }, master?: {…9 master params}, note?: string }` — absent/null =
  legacy scene, zero behavior change. Payloads are validated + clamped into a
  CANONICAL form (ascending track keys, registry field order) on every write
  and on load, so load→save byte-stability holds regardless of how a save was
  produced. Persisted in save/export/share/RESUME.
- **One application primitive** (`applySceneMix`, js/scenes.js) on every
  launch path: instant launch (state.js), the quantized scheduler
  pending-launch branch (PLAY SONG, chain, follow actions, manual quantized)
  and the offline renderSong section launch — each gliding via the existing
  `syncMix(p, when)` anchor. Documented precedence: snapshot applies AT the
  launch, then per-step automation lanes evaluate on top (the continuous
  automation wins per-step).
- The composer populates every scene's snapshot from the section energy
  curve (pure function of section id + energy + variant index — no rng):
  INTRO low melodic level + light space, BUILD rising with bass duck 40,
  DROP/DROP2 full + dry + **bass duck 55**, BREAK spatial (sendA/sendB up,
  ducking off), RISER swell (pad/fx up, no ducking), OUTRO fall. Variant
  scenes lean pan ±0.12 so arranger repeats move in stereo. **The KICK level
  never appears in a composer snapshot** (kick is sacred — level too).
- Composer determinism re-proven: same seed → byte-identical project
  INCLUDING snapshots (`bun test tests/mixsnap.test.ts`).
- Fingerprint deltas (documented): form-fp **UNCHANGED**
  (`d0c5f32f032f2a88` — patterns untouched by the snapshot pass); the
  9 legacy-style whole-project hashes re-pinned to the v0.8.0 values
  (FULL-ON `338e9537…/1d9c77e2…/3db876a1…`, DARK-PSY `038f8e5b…/62902511…/
  766a8576…`, PROGRESSIVE `d8c7d9ac…/c73d8755…/d6bb48ee…` for 3/5/8 min —
  the only delta is the added mix payloads; run `bun test tests/composer.test.ts`).
- Share cap raised 51200 → **65536** bytes: a snapshot-bearing composed song
  compresses to 38,726 B → **51,636** base64url chars, crossing the old 50 KB
  cap by 0.8% — a share of the device's own composed output is a first-class
  flow (js/share.js comment documents the arithmetic).
- UI: scene bank rows gain **MIX→SCENE** (writes the current mixer state into
  the scene; mute/solo deliberately not captured), **×MIX** (clear), and a MIX
  badge on scenes carrying a snapshot; toast confirmations.
- **G28 (offline, CI-asserted)**: scripted bass-only 2-section song — snapshot
  bass-vol 0.5 vs live 0.8 → per-section RMS ratio **2.529** in the mandated
  [2.0, 2.6] (theory (0.8/0.5)²=2.56; the setTargetAtTime glide damps the
  first ms — logged); null-mix control ratio **1.0038**; schedule hash
  identical (the layer is opt-in). Repro: `bun tools/e2e.mjs`.

### Added — master EQ3 + glue compressor (`feat: master EQ and glue compressor (automation-ready)`)

- Chain: `master → EQ3 → [glueComp → makeup gain] → existing master comp →
  analyser`. EQ3: low shelf 100 Hz, mid peak 1 kHz (Q 0.8), high shelf 8 kHz,
  each ±12 dB. Glue: threshold −40..0 dB, ratio 1..20, attack 1..100 ms,
  release 20..1000 ms, makeup 0..24 dB, `compOn` 0/1 — **bypass REMOVES the
  node from the chain** (guaranteed neutral).
- 9 params registered in js/params.js (`eqLow eqMid eqHigh compOn compThresh
  compRatio compAttack compRelease compMakeup`, project target): automatable
  (lane.track −1), ARM-AUTO-recordable, MIDI-learnable (`master.<param>` CC
  0–1 → full range via `paramDenorm`), and scene-snapshot-able
  (`scene.mix.master`). `ensureMaster` backfills legacy projects with neutral
  defaults + clamps (loadProjectObj — the canonical-order pitfall respected).
  MASTER panel in the Mixer tab (GLUE toggle + 8 controls, tooltips).
  Worklet limitation documented (worklet master has its own
  saturation/limiter).
- **G29 (offline, CI-asserted)**: (a) neutral tolerance — default engine vs
  `masterFlat` (the exact pre-v0.8.0 topology) max sample diff **1.79e-7 <
  1e-6** on both channels (EQ biquads at 0 dB + glue removed); (b)
  compression evidence on the dense PSYTRANCE loop at −20 dB/4:1/10 ms/
  150 ms/makeup 0 — crest factor 9.25 → **6.59 (2.94 dB ∈ [0.5, 6])**.
  Chrome's DynamicsCompressor applies an IMPLICIT makeup gain (observed
  **+4.25 dB** RMS rise), so the RMS-reduction contract is evaluated
  makeup-invariantly as crest reduction, with the raw RMS delta logged.
  Repro: `bun tools/e2e.mjs`.

### Added — song stems + section bounce (`feat: song stems and section bounce (one renderer)`)

- renderSong is the ONE renderer: `opts.trackFilter` renders one track's stem
  through the same machinery as the loop-bounce stems (non-matching tracks
  never spawn voices — no signal math); `opts.bounds` returns an arranger
  range **as a slice of the full arrangement render** — the section exactly
  as it appears in the song (phase continuity, mix snapshots and FX bleed all
  real). File formula (documented, asserted):
  `frames = ceil(sr·(0.05 + (barsInRange·16 + 32)·60/bpm/4))`.
- **Empirical finding (documented in js/bounce.js)**: skipping events or
  shortening the offline buffer perturbs the WHOLE Chrome offline render at
  the 1e-3 level (each path is individually deterministic; identical event
  set + length = bit-exact). Hence section bounce = full render + slice,
  which makes the music window sample-EXACT vs the full render. Cost equals a
  SONG bounce; the 10-minute guard applies.
- UI: **STEMS checkbox** in the SONG bounce path →
  `psy6-song-stem-<trackName>.wav` for every non-empty track (sequential
  downloads, progress label + toasts); **BOUNCE SECTION** in the timeline
  editor on a contiguous selection (click / shift+click) →
  `psy6-section-<sceneName>-<idx>.wav`. Memory caps (`songStemsGuard`,
  refusal toasts): per-stem ≤ 10 min; Σ stems × duration ≤ **60
  audio-minutes** (> 6 stems on long songs is exactly what this refuses).
- **G30 (offline, CI-asserted)** on the demo song (FULL-ON 3min 424242):
  stem frames == formula (**10,075,254**), kick stem RMS **0.0551** > melodic
  stem RMS **0.0391** (track 4), DROP section frames == formula (**732,137**),
  section music window vs full-render slice **maxDiff 2.98e-7** (G24-class
  float wobble; contract bound 1e-5). Repro: `bun tools/e2e.mjs`.

### Changed — gate inventory + e2e runtime

- Canonical inventory (js/ui/tests.js): **27 device entries = 25 HARD
  (offline/pure, CI-asserted 27/27 including G28/G29/G30) + 2 evidence-only
  realtime (G17, G25)**; WORKLET reduced set 3/3. Gaps G3/G4/G7/G20 remain
  documented-never-existed; next free id **G31**. e2e default timeout
  300 → 600 s (three new heavy offline gates).
- Battery at release: `bun test` → **300/300 across 26 files (303,842
  expect() calls)**; `node tools/verify.mjs` GREEN.

### Evidence (reproducible)

```
bun test                          # 300/300 (26 files) — incl. mixsnap/master/stems-song suites
node tools/verify.mjs             # GREEN (sw.js CACHE_VERSION == CHANGELOG lock at psy6-v0.8.0)
bun tools/e2e.mjs                 # headless Chrome: 27/27 asserted gates + G17/G25 evidence
bun -e "import('./js/composer.js').then(async m=>{const c=m.compose('FULL-ON',3,424242);console.log(c.stats)})"
                                  # {145 BPM, 17 scenes, 9 tracks, variants 10, snapshots 17,
                                  #  minVariantDiff 0.338} — form-fp unchanged d0c5f32f032f2a88
```

## [0.7.0] — Run 10: EVOLUTION + INTEROP

### Added — composer section variants, no identical repeats (`feat: composer section variants (no identical repeats)`)

- Every section family used more than once in the arranger now derives n−1
  variant scenes (naming `base+" 2"`, `" 3"`, …), so **no arranger repeat is
  ever identical**. Variants are the base pattern mutated by deterministic
  seeded ops (hat density/offset swap, bass octave shifts on off-phrase
  steps + velocity re-jitter, lead motif re-processed through the foundation
  `MotifTransformer`, perc repositioning, pad voicing swap) plus a per-variant
  lane delta on family-dedicated `(track,param)` pairs via the param registry
  (values open progressively across variants).
- **KICK IS SACRED**: variant kicks keep exact positions/note/micro/prob —
  velocity accents only, `|Δvel| ≤ 0.1` (`KICK_VEL_MAX_DELTA`, asserted).
- Difference metric (documented constant `VARIANT_DIFF_MIN = 0.15`):
  `variantStepDiff = |D|/|U|` over the union of on-steps, content-aware
  (note / vel>0.02 / micro>2). EVERY pair within a family incl. the base must
  reach it. Empirical FULL-ON/3min/424242 family minimums: INTRO .933,
  BUILD .849, DROP .591, BREAK .836, RISER .840, DROP2 .338, OUTRO .886 —
  all 9 style×length combos ≥ 0.306. Repro:
  `bun test tests/composer.test.ts`.
- Form unchanged: 108-bar form / 17-step / 136-bar arranger for the 3-min
  demo; base patterns untouched (form fingerprint **pinned** to the v0.6.0
  value `d0c5f32f032f2a88`). Fingerprint delta vs the Run 9 Phase-0 record:
  the FORM hash is byte-stable; the project content delta is 7→17 scenes,
  3→11 lanes, 10 variant patterns. Same seed → byte-identical project
  INCLUDING variants. Uniqueness extended project-wide (all patterns).
- **G23 extended (not forked)**: evidence now reports `variants=10
  vmin=0.338 norepeat=true`.
- G24 Chrome-float determinism bound documented at `1e-5` (empirical
  4.17e-7…1.13e-6; the schedule `evHash` equality remains the exact layer).

### Added — FOREST and HI-TECH composer styles (`feat: forest and hitech composer styles`)

- Both are full recipes in `COMPOSER_STYLES` (nothing hand-rolled outside
  the dict): per-style section chain + energy arcs, preset map, and a
  `recipe` sub-dict (hatGhostMul / bassGrammar / percMul / percOdd /
  energyVar / riserEvery / variant op weights).
- FOREST ~150 BPM, harmonicMinor (darker scale bias): longer builds
  (w .15) + more BREAK weight (.145), denser hats (1.6), rolling forest
  bass grammar, ops {hatRot .55, bassOct .65}. 3min/424242 → 16 scenes,
  Σ=128 bars, 179.2 s (−0.44 %).
- HI-TECH ~155 BPM, phrygian: faster turnover (INTRO .09/BUILD .11),
  percMul 1.8 + odd-16th glitch layer, energyVar 0.10 (seeded per-section
  jitter), aggressive riser (one sweep per bar), ops {.5, .55}.
  3min/424242 → 17 scenes, Σ=136 bars, 179.61 s (−0.22 %).
- Legacy styles byte-identical: 9 project hashes (3 legacy styles ×
  3/5/8 min) pinned in tests. All five styles render non-silent through the
  G23 evidence loop (min section RMS 0.064). UI: 5 styles in both pickers +
  third demo (`#bDemoForest`, FOREST 3min, same deterministic recipe path).

### Added — standard MIDI file export (`feat: standard MIDI file export`)

- `js/midifile.js`: pure, dependency-free **format-1** writer — track 0 =
  tempo meta + track name; one chunk per track; VLQ deltas (multi-byte cases
  unit-tested); stable ordering (tick ↑, off-before-on, pitch).
- Shared song expansion — **no parallel logic**: `songMidi(p)` (bounce.js)
  walks the SAME `songSteps` generator + `stepEvents` the offline WAV
  renderer walks. Mapping: 1 step = 120 ticks (ppq 480), bar = 4·480,
  total = Σbars·4·480 = 261,120 for the demo. Channels: melodic → 1–8,
  drums → 10 (GM). `durTicks` = 1 step (trigger map; the WAV stays the
  authoritative sound).
- `.mid == WAV schedule` contract asserted note-for-note in bun (4,385
  notes) **and** by **G26** (HARD, offline, CI-eligible): in-gate parse-back
  of the demo export — `bytes=36695 fmt=1 ppq=480 trks=10 tempo=145
  firstKick=0 notes=4385 total=261120 det=true`. e2e asserts 24 gates.
- UI: EXPORT MIDI in the bounce modal (disabled + hint when the arranger is
  empty) → `psy6-song-<bpm>bpm.mid`.

### Added — seeded follow actions, chain mode (`feat: seeded follow actions (chain mode)`)

- `scene.follow = {mode:'none'|'next'|'prev'|'random'|'scene', target?,
  prob 0–100 (default 100), afterBars?}` — edited in the scene bank row.
- **PRECEDENCE (documented)**: PLAY SONG strictly follows the arranger;
  follow actions apply ONLY in chain mode, through the same quantized
  `I.pending` launch path. `prob<100` miss → documented `'next'` fallback.
  Random pick seeded: `mulberry32(fnv(projectSeed + ':' +
  transitionCounter))` — replayable per transport session. `afterBars`
  overrides the section length (`afterBars > scene.bars > pattern loop`).
- **G27** (HARD, offline simulation, CI-asserted): scripted chain walks the
  PINNED 20-transition random sequence
  `[2,2,11,11,9,9,4,13,8,16,11,9,1,15,8,1,8,6,0,13,0]`, replay-identical;
  next/prev wrap exact; scene lock; prob=0 fallback. e2e asserts 24 gates.
- `loadProjectObj` backfills follow canonically (absent/invalid → absent;
  legacy load→save byte-stability holds).

### Release — v0.7.0 (`docs: v0.7.0`)

- Battery: **271 tests across 23 files — 271 pass / 0 fail (302,947
  expect() calls)**; `node tools/verify.mjs` GREEN.
- Gates: **24 HARD MAIN (CI-asserted, incl. G26 MIDI + G27 follow) + 2
  evidence-only realtime (G17, G25)** = 26 device entries; WORKLET 3/3.
- PWA: `sw.js` `CACHE_VERSION = 'psy6-v0.7.0'` (verify.mjs enforces the
  version↔CHANGELOG lock).

## [0.6.0] — Run 9: SONG ENGINE

### Added — full-song offline render (`feat: full-song offline render (song bounce)`)

- Bounce modal gains MODE `SONG` (enabled only when the arranger has
  sections): renders the WHOLE `[scene,bars]` arrangement through the live
  machinery — `stepEvents` (per-bar seeded groove), the live scene-launch
  phase rule (`sc.step = sc.step % newLoop`), per-scene auto-FILL, and the
  per-step automation player (`applyLanes` → `syncMix`/`resolveMacros`) —
  no parallel renderer. `js/bounce.js`: `songSteps` generator (single source
  of phase truth), `songSchedule` pure oracle, `songSections`, `songFrames`,
  `songDurationSec`, `songRenderController`, `renderSong`.
- Frame formula (documented + asserted): `ceil(sr·(0.05+(Σbars·16+32)·(60/bpm/4)))`
  — 0.05 s lead-in (loop-bounce convention) + music + 2-bar FX tail.
- Progress bar (section name + percent, via OfflineAudioContext suspend at
  section boundaries) + CANCEL (clean abort, live AudioContext untouched).
- 10-minute render cap (memory guard — toast refusal beyond).
- Output: `psy6-song-<bpm>bpm.wav`.

### Added — arranger timeline editor + PLAY SONG (`feat: arranger timeline editor + play song`)

- Perform-tab timeline: blocks width ∝ bars, scene colors, click-select;
  bars ±, reorder ◀▶ (no drag-drop — consistent with the scene bank),
  insert-from-scene, DELETE; total readout sections/bars/mm:ss.
- `arrMoveStep` / `arrInsertStep` / `arrSongInfo` (reuses song-render
  grouping) in `js/arranger.js`; ▶ PLAY SONG button (chain restart at
  section 0, quantized when playing, boots transport when stopped).
- Edits persist via project JSON (save/export/share round-trip tested).

### Added — record live song playback (`feat: record live song playback`)

- RECORD SONG (transport row): arms the existing capture tap, starts with
  PLAY SONG at section 0, auto-stops at the end of the final section +1 bar,
  encodes with the existing WAV encoder → `psy6-song-live-<bpm>bpm.wav`.
- **G25** (realtime, evidence-only): 4-bar two-section song → `dur=9.381s`
  vs `want=9.375s` (**skew 6 ms**), `rms=0.0818`, header valid.
- **Real bug found and fixed by G25** (the non-vacuous-gate rule paying off
  again): a second capture in one page session included the first capture's
  audio — `CaptureTap.start()` now resets accumulated chunks/frames
  (js/capture.js) and a completed capture retires its tap (js/ui/capture.js).
  Repro: CAPTURE 1 bar → RECORD SONG → first capture's frames leaked into
  the song file (494592 = 82944 + 411648).

### Changed — gate-truth hygiene (`docs: gate inventory truth + song engine docs`)

- Canonical gate inventory documented above `runSelfGate()`: **24 MAIN
  entries = 22 hard (offline/pure, CI-asserted) + 2 evidence-only realtime
  (G17, G25)**; WORKLET reduced set 3/3. Numbering gaps G3/G4/G7/G20 never
  existed in any commit (verified `git log -S` over all history) — left
  unrenumbered because all historical evidence cites the shipped ids.
- CI subset (`tools/e2e.mjs`): asserts all 22 hard gates (G24 joins; G17/G25
  explicitly excluded as realtime).

### Added — PWA (`feat: pwa manifest + service worker (network-first, versioned)`)

- `manifest.webmanifest` (standalone, device colors) + icons 192/512 generated
  by `tools/gen-icons.mjs` (zero-dep PNG encoder, seeded `mulberry32(0x9056)`
  sequencer motif — deterministic pixels, committed).
- `sw.js`: **network-first** for same-origin GETs (cache = offline fallback
  ONLY; every successful response refreshes the cached copy), `activate`
  purges old caches, skipWaiting + clients.claim. Cache version const
  `psy6-v0.6.0` is asserted against the latest CHANGELOG heading by BOTH
  `tools/verify.mjs` (release gate) and `tests/pwa.test.ts` — a release that
  forgets the bump fails verification. Rollback rule documented in
  ARCHITECTURE §13: any served-bytes staleness under SW → remove the
  registration, keep the manifest, document honestly.

### Evidence (reproducible)

- `bun test` — **236 pass / 0 fail** across 21 files, 47,241 expect() calls
  (incl. `tests/song.test.ts` 12: phase rules == live-scheduler oracle,
  frame formula pinned to 10,075,254, sections [16,16,24,16,16,32,16]=136
  bars, fills 3 launches × 8 hits, schedule determinism, duration guard,
  cancel contract).
- `node tools/verify.mjs` — GREEN (0 failures).
- **G24** (device, OfflineAudioContext): `N=10075254/10075254 bars=136
  rms=[0.0665,0.098,0.1088,0.0848,0.0867,0.1046,0.0688] sched=true
  det=maxDiff=3.73e-7` — Chrome float nondeterminism between identical
  renders is real; the documented bound (max sample diff < 1e-6) is used and
  the actual max diff is logged, never rounded to a claim of byte-equality.

## [0.5.0] — Run 7: UNLIMIT + COMPOSER

### Added — device limits lifted (`feat: lift device limits (16 tracks, 128 steps, 64 scenes)`)

- `js/limits.js` — single-source ceilings: `MAX_TRACKS 16`, `MAX_STEPS 128`,
  `MAX_SCENES 64`, `PATTERN_LENGTHS {8,16,32,64,128}`, `LOOP_CAP 1024`.
  `DEFAULTS` (8 tracks / 16-step patterns / 8 scenes) are unchanged since
  v0.1.0 — raised limits are CEILINGS reached only by explicit user action.
- `+TRACK` action grows projects to 16 (neutral INIT-SYNTH preset; pattern
  data grows with it). Voice pools did NOT grow — polyphony is absorbed by
  the existing priority voice stealing.
- Sequencer: 128-step grid with zoom + horizontal scroll, O(1) playhead
  toggling (no per-frame sweep), legacy lengths (4/12/24) surfaced in the
  length select instead of silently mis-displaying.
- FIX (pre-existing): lengthening a pattern SHARED step objects across
  repeats — editing step 16 silently edited step 0. Steps are now cloned
  (lock objects included). Regression-tested.
- G21 (offline, CI-asserted): 128-step pattern with events at steps 0/64/127
  — exact order on the deterministic schedule AND audible onsets in the
  render, silent gap, `loopLen=128`; a 12-track project renders 12
  non-silent stems (min peak 0.167).
- Reproduce: `bun test tests/limits.test.ts` · `bun test` → 161/161 at this
  commit · `GATE_EXTRA=G21 bun /home/z/.run6/psy7-p0-local.mjs` →
  `SELF-GATE: 20/20 passed`.

### Added — scene bank (`feat: scene bank (64 scenes, manage UI)`)

- `js/scenes.js` — DOM-free scene operations + the documented scene schema:
  `{name, pattern, color 0-7|null, bars 1-64|null, fill bool}`. Fields are
  backfilled on load with neutral defaults and rebuilt in canonical key
  order so load→save stays byte-stable.
- Scene bank UI: scrollable bank up to 64 scenes, inline rename, duplicate,
  clear, reorder (up/down), color tags, per-scene bars override (pre-fills
  the arranger section length), per-scene auto-FILL toggle (fires the FILL
  op at launch — instant or at the quantized bar boundary), current/queued
  indicators, +SCENE.
- Launch semantics unchanged: click = quantized, alt = instant,
  shift = assign (assign no longer clobbers custom names). Chain advance
  extracted to pure `chainNext` (32+ scene wrap tested).
- Reproduce: `bun test tests/scenes.test.ts` (14 tests) · headless UI flow
  10/10 (driver in worklog).

### Added — automation everywhere (`feat: full-parameter automation lanes + live recording`)

- `js/params.js` — param registry: 23 automatable parameters
  (`{id,label,min,max,def,target,apply}`): synth sound (cutoff/res/atk/dec/
  sus/rel/gate/detune/lfoRate/lfoDepth), mixer (vol/pan/sendA/sendB),
  sidechain (scAmount/attack/hold/release), project (masterVol, 4 macros).
  Every apply clamps; per-kind filtering (drum tracks get no synth params).
- Lane model: `{track, param, pts, mode}` — `mode:'lock'` = legacy per-voice
  lane (exact v0.1.0–v0.4.0 behavior; legacy lanes backfill to it),
  `mode:'state'` = live automation applied EVERY STEP through the registry
  (knob-equivalent writes; scheduler syncs the engine after mix/sc/master
  and re-resolves macros).
- Recording: ARM-AUTO + per-lane arm (multiple simultaneous); knob moves
  (mixer, synth editor, macros) and MIDI CC via the existing midiMap land
  in armed lanes at the quantized playhead (1/16, toggleable off).
- Automation editor: param select, +LANE, ARM-AUTO, Q toggle, clear, lane
  list with live value readout, curve canvas + playhead.
- G22 (CI-asserted): scripted record session writes the EXACT expected
  quantized points (replace on duplicate); offline apply matches laneEval
  within 1e-9; lock lanes never touch track state.
- Reproduce: `bun test tests/params.test.ts` (12 tests).

### Added — song composer (`feat: deterministic song composer (complete unique arrangements)`)

- `js/composer.js` — pure, deterministic, seeded by (seed, style, minutes).
  Section chain INTRO→BUILD→DROP→BREAK→RISER→DROP2→OUTRO with energy arcs
  (foundation `arcAt`); bars scale to the target as multiples of 4 and sum
  EXACTLY to the target (3-min FULL-ON = 108 bars = 178.76 s, −0.69 %).
- 3 style templates: FULL-ON 145 / DARK-PSY 148 / PROGRESSIVE 138 BPM, per
  style preset maps; 9th FX track carries the riser preset.
- Per-section patterns (≤128-step ceiling; longer sections repeat their
  scene in the arranger). Recipes scale with section energy; fills end
  BUILD/RISER; psy-push groove is COMPOSED INTO bass micro offsets on drops
  (project groove is global); the lead motif is varied per section through
  foundation `MotifTransformer` (transpose/invert/retrograde/omission/
  fragmentation/octaveShift).
- Lane suggestions via the registry: BUILD lead cutoff sweep, RISER pad
  sendA/B rise (`mode:'state'`).
- Uniqueness: 20 seeds → all 190 pairs JSON-unequal AND ≥90 % unique
  melodic fingerprints (same seed = byte-identical, tested).
- UI: power-screen COMPOSE row + header modal (style/length/seed editable,
  overwrite confirm, fresh in-memory project, lands on Perform with the
  arranger active and playing).
- G23 (CI-asserted): fixed seed → 7 sections, length ±5 %, byte-identical
  regenerate, EVERY section bounces non-silent — per-section RMS
  `[0.0613, 0.0984, 0.1113, 0.0878, 0.0906, 0.1076, 0.0587]`.
- Reproduce: `bun test tests/composer.test.ts` (14 tests).

### Added — usability (`feat: usability pass (shortcuts, tooltips, demos, touch targets)`)

- `js/shortcuts.js` — single shortcut registry; the keydown dispatcher AND
  the help overlay render from it; collision finder unit-tested. Audit:
  the only prior global handler was Space/r/z/1-8 in header.js; 1-8 moved
  to pad triggers, track select to Shift+1-8; arrows (scene prev/next),
  f (fill), v (variation), b (bounce), ? (help) are new.
- Native tooltips on header controls; demo songs as composer recipes
  (`data/demos/*.json`, 460 B each — the client recomposes byte-identically;
  loading boots into memory only); touch targets ≥ 40 px on primary
  controls; 390 px width verified with no horizontal page scroll.
- Reproduce: `bun test tests/usability.test.ts` (7 tests).

### Battery at release

- `bun test` → **208/208 across 19 files (29 935 expects)** · `node
  tools/verify.mjs` → GREEN (0 failures) · device Self-Gate **22/22 MAIN**
  (G1-×4, G2, G5, G6, G8, G9, G10, G11, G12, G13, G14, G15, G16, G17, G18,
  G19, G21, G22, G23) + **3/3 WORKLET** · `tools/e2e.mjs` CI subset = 21
  asserted (all MAIN gates except realtime G17). The taskbook anticipated
  "23/23"; the honest count is 22 (19 + G21/G22/G23).
- G17 note: the realtime capture gate passes on idle sessions (skew 6 ms)
  and may exceed its ±50 ms skew under concurrent offline-render load
  (ScriptProcessor buffer-fill artifact) — it remains info-only in CI, as
  documented since v0.4.0.

## [0.11.0] — Run 19: RESAMPLE + SLICES + KEY (the sonic-palette loop closes)

> The device could import and PLAY user samples, but it could not bounce
> its own output, edit them, slice them, or tune them. v0.11.0 completes
> the producer loop: RESAMPLE the live jam, FREEZE a track to audio,
> non-destructive EDITING with derived versions + a waveform, deterministic
> SLICING with per-step slice locks (the breakbeat workflow), and musical
> KEY detection with tune-to-project-root. Zero composer change: the
> composer output is UNCHANGED this run (form-fp bb16ce280ff48f88 and the
> legacy pins asserted identical at Phase 0 and re-asserted by G31/G33/G36
> in every battery). Commands: `bun test` (420 tests / 36 files), `node
> tools/verify.mjs`, `bun tools/e2e.mjs` (35/35 HARD).

### Added — resample + freeze (`feat: resample and track freeze`)

- RESAMPLE (live, realtime): bars select (1/2/4/8) + button in the Samples
  drawer — records the master output through the EXISTING CaptureTap for
  exactly N bars (bar-quantized start, auto-stop at the Nth boundary,
  transport never touched), trims to `resampleFrames(bars,bpm,rate)`,
  imports as `resample-<bpm>bpm-<bars>bar-<hash8>` (deterministic content
  id — identical re-resamples land on ONE row). Guards: 1..32 whole bars,
  WORKLET refusal, store `estimate()` quota check, 128-row cap. The
  realtime capture is classified evidence-only (scheduler-skew jitter of a
  few ms is documented honestly — the same class as G17/G25).
- FREEZE TRACK (offline, deterministic): FREEZE button in the Sound-tab
  VOICE row — renders ONE pattern loop of the selected track through the
  ONE renderer (`freezePrep` clone: sendA/sendB/scAmount zeroed =
  POST-insert PRE-send tap point; the MASTER section is baked — there is no
  pre-master tap without a parallel renderer, documented), trims the 0.05 s
  schedule lead (frame 0 = the first step of the loop), imports as
  `freeze-<trackName>-<hash8>`. Guards: 10-minute cap, WORKLET refusal.
- ENGINE FIX found by G36: the sample-voice cap-8 oldest-stolen stop() was
  no-arg — during the OFFLINE schedule walk it executed at wall-clock and
  ERASED future-scheduled hits (a frozen 8-bar kick loop replayed per-step
  lost its entire first cap window). The stop is now TIME-ANCHORED to the
  steal moment (live semantics unchanged, offline time-correct).
- Shared `assignSampleToTrack` + `importChannelsAsSample` — one assign
  path, one programmatic import path (RESAMPLE sink, FREEZE, derivations).
- **G36** (e2e 33/33 → see below): pipeline == independent prep+render+trim
  (dPipe=0), determinism (dDet=0), frames == freezeWindow formula
  (583,945/583,945 on the demo song), sample-track freeze == its plain
  render (dExact=0), re-freeze RMS within the measured double-master bound
  (rel 35.58% = −3.8 dB — the master comp re-squashes already-mastered
  audio; bounded, logged, documented), onset aligned (265→529 f).
- `tests/freeze.test.ts` (13).

### Added — sample editor (`feat: sample editor (derived versions, waveform)`)

- Derived versions: every edit bakes a NEW PCM copy into a NEW record with
  a DETERMINISTIC id = fnv(baseId + ':' + op + ':' + canonical params).
  Idempotent re-derivation (same base+op+params → one id, the put
  replaces). Derived-of-derived chains chain from the parent id. The BASE
  import is byte-IMMUTABLE; derived records carry their own PCM (they keep
  playing even if the base is deleted — lineage display only).
- Ops: fade-in/fade-out (exact linear ramps, ms 0..2000), gain (0..2,
  rounded 0.001), normalize (peak → 0.95), reverse. Params canonicalized
  BEFORE both the id and the math.
- Drawer UI: ED button → waveform canvas (deterministic min/max peaks per
  pixel bucket) + edit panel; lineage shown as `name · ← base`.
- **G37** (e2e 34/34): fade onset/sustain RMS 0.289 (linear-ramp physics),
  two derivations byte-identical with the same id (maxDiff 0), 2-step
  chain round-trip maxDiff 0 + re-derivation idempotent, base maxDiff 0.
- `tests/editor.test.ts` (16).

### Added — slices (`feat: sample slicing (deterministic transients, per-step locks)`)

- `detectTransients` — pure energy-flux onset detector (512-frame hop RMS,
  positive flux, 1.5×-mean adaptive threshold, strongest-first greedy pick,
  35 ms min spacing, 16-onset cap, stable tie-break): the same PCM ALWAYS
  yields the same boundaries.
- `deriveSample(rec,'slice')` — kind `sliced`, boundaries stored as
  metadata pct ranges (NO PCM duplication — the record shares the base
  arrays), id hashes the DETECTED pcts (re-detection idempotent).
- Playback: `samplePlayback(sp, dur, pcts)` — sliceIdx 1..N selects the
  k-th boundary window (replaces start/end); 0 = full sample (unchanged);
  out-of-range clamps to the last slice. Registry param `smpSlice` (0..16,
  default 0) + Sound-tab slider.
- Per-step slice locks: `ev.lock.smpSlice` overrides the track sliceIdx for
  THAT hit — rides the EXISTING per-step lock channel, zero new
  persistence surface. UI: SLICE button (amber markers on the waveform) +
  SLICES → STEPS quick action (fills the selected track's pattern with
  sequential slice locks — the classic breakbeat fill).
- **G38** (e2e 35/35): detector accuracy 100% (7/7 truth transients within
  ±2 hops on a synthetic break), the sequential slice fill renders a hit in
  every step window with monotonically increasing peaks, and the per-step
  lock PROVABLY overrides the track sliceIdx (step-0 zero-crossing rate 43
  vs 46 across distinct slice content).
- `tests/slices.test.ts` (11).

### Added — key detection (`feat: key detection and tune-to-root`)

- `js/keydetect.js` — deterministic chroma (direct DFT at the 12
  pitch-class fundamentals over the sample's mid section, 4 s cap) +
  Krumhansl-Schmuckler correlation (12 rotated major/minor profiles) →
  `{tonicPc, mode, r, name}`. Pure math, no deps, no rng, no time. Honest
  limitation: fundamentals-only scans C4..B4 (register assumption).
- `tuneToRoot(tonicPc, projectRootMidi)` — minimal signed semitone shift
  ((rootPc − samplePc) mod 12, mapped to −5..+6): the same pitch-class
  destination as the literal 0..11 reading with the smallest
  voice-leading move (documented resolution).
- UI: KEY → ROOT button — detects the selected sample's key and applies
  the shift to the SELECTED track's `sampleParams.tune` (toast logs key,
  r, delta, before → after). WORKLET limitations list gains the v0.11.0
  line (no resample/freeze/editor/slices/key — MAIN engine only).
- `tests/keydetect.test.ts` (9).

### Gates

- Self-Gate inventory: **37 entries = 35 HARD (CI e2e asserts all 35 — the
  canonical list lives in js/ui/tests.js) + 2 evidence-only realtime (G17,
  G25)**. Production Self-Gate from https://dudududi144-source.github.io/psy5/
  (first ever): **37/37 passed**. New HARD gates: G36 (freeze), G37 (editor), G38
  (slices). G3/G4/G7/G20 never existed — unchanged, never renumbered.
- Battery at release: `bun test` → **420 pass / 0 fail** across 36 files
  (356,314 expect() calls). `tools/verify.mjs` GREEN (SW lock
  psy6-v0.11.0 ↔ this CHANGELOG). Composer re-pin status: UNCHANGED —
  form-fp bb16ce280ff48f88, demo-song schedule 4,385 events, Phase 0
  baseline pcmHash 96a82cec2b7435e4 (session-local reference per the
  v0.10.0 cross-session PCM finding).

## [0.7.0] — Run 10: EVOLUTION + INTEROP

### Added — composer section variants, no identical repeats (`feat: composer section variants (no identical repeats)`)

- Every section family used more than once in the arranger now derives n−1
  variant scenes (naming `base+" 2"`, `" 3"`, …), so **no arranger repeat is
  ever identical**. Variants are the base pattern mutated by deterministic
  seeded ops (hat density/offset swap, bass octave shifts on off-phrase
  steps + velocity re-jitter, lead motif re-processed through the foundation
  `MotifTransformer`, perc repositioning, pad voicing swap) plus a per-variant
  lane delta on family-dedicated `(track,param)` pairs via the param registry
  (values open progressively across variants).
- **KICK IS SACRED**: variant kicks keep exact positions/note/micro/prob —
  velocity accents only, `|Δvel| ≤ 0.1` (`KICK_VEL_MAX_DELTA`, asserted).
- Difference metric (documented constant `VARIANT_DIFF_MIN = 0.15`):
  `variantStepDiff = |D|/|U|` over the union of on-steps, content-aware
  (note / vel>0.02 / micro>2). EVERY pair within a family incl. the base must
  reach it. Empirical FULL-ON/3min/424242 family minimums: INTRO .933,
  BUILD .849, DROP .591, BREAK .836, RISER .840, DROP2 .338, OUTRO .886 —
  all 9 style×length combos ≥ 0.306. Repro:
  `bun test tests/composer.test.ts`.
- Form unchanged: 108-bar form / 17-step / 136-bar arranger for the 3-min
  demo; base patterns untouched (form fingerprint **pinned** to the v0.6.0
  value `d0c5f32f032f2a88`). Fingerprint delta vs the Run 9 Phase-0 record:
  the FORM hash is byte-stable; the project content delta is 7→17 scenes,
  3→11 lanes, 10 variant patterns. Same seed → byte-identical project
  INCLUDING variants. Uniqueness extended project-wide (all patterns).
- **G23 extended (not forked)**: evidence now reports `variants=10
  vmin=0.338 norepeat=true`.
- G24 Chrome-float determinism bound documented at `1e-5` (empirical
  4.17e-7…1.13e-6; the schedule `evHash` equality remains the exact layer).

### Added — FOREST and HI-TECH composer styles (`feat: forest and hitech composer styles`)

- Both are full recipes in `COMPOSER_STYLES` (nothing hand-rolled outside
  the dict): per-style section chain + energy arcs, preset map, and a
  `recipe` sub-dict (hatGhostMul / bassGrammar / percMul / percOdd /
  energyVar / riserEvery / variant op weights).
- FOREST ~150 BPM, harmonicMinor (darker scale bias): longer builds
  (w .15) + more BREAK weight (.145), denser hats (1.6), rolling forest
  bass grammar, ops {hatRot .55, bassOct .65}. 3min/424242 → 16 scenes,
  Σ=128 bars, 179.2 s (−0.44 %).
- HI-TECH ~155 BPM, phrygian: faster turnover (INTRO .09/BUILD .11),
  percMul 1.8 + odd-16th glitch layer, energyVar 0.10 (seeded per-section
  jitter), aggressive riser (one sweep per bar), ops {.5, .55}.
  3min/424242 → 17 scenes, Σ=136 bars, 179.61 s (−0.22 %).
- Legacy styles byte-identical: 9 project hashes (3 legacy styles ×
  3/5/8 min) pinned in tests. All five styles render non-silent through the
  G23 evidence loop (min section RMS 0.064). UI: 5 styles in both pickers +
  third demo (`#bDemoForest`, FOREST 3min, same deterministic recipe path).

### Added — standard MIDI file export (`feat: standard MIDI file export`)

- `js/midifile.js`: pure, dependency-free **format-1** writer — track 0 =
  tempo meta + track name; one chunk per track; VLQ deltas (multi-byte cases
  unit-tested); stable ordering (tick ↑, off-before-on, pitch).
- Shared song expansion — **no parallel logic**: `songMidi(p)` (bounce.js)
  walks the SAME `songSteps` generator + `stepEvents` the offline WAV
  renderer walks. Mapping: 1 step = 120 ticks (ppq 480), bar = 4·480,
  total = Σbars·4·480 = 261,120 for the demo. Channels: melodic → 1–8,
  drums → 10 (GM). `durTicks` = 1 step (trigger map; the WAV stays the
  authoritative sound).
- `.mid == WAV schedule` contract asserted note-for-note in bun (4,385
  notes) **and** by **G26** (HARD, offline, CI-eligible): in-gate parse-back
  of the demo export — `bytes=36695 fmt=1 ppq=480 trks=10 tempo=145
  firstKick=0 notes=4385 total=261120 det=true`. e2e asserts 24 gates.
- UI: EXPORT MIDI in the bounce modal (disabled + hint when the arranger is
  empty) → `psy6-song-<bpm>bpm.mid`.

### Added — seeded follow actions, chain mode (`feat: seeded follow actions (chain mode)`)

- `scene.follow = {mode:'none'|'next'|'prev'|'random'|'scene', target?,
  prob 0–100 (default 100), afterBars?}` — edited in the scene bank row.
- **PRECEDENCE (documented)**: PLAY SONG strictly follows the arranger;
  follow actions apply ONLY in chain mode, through the same quantized
  `I.pending` launch path. `prob<100` miss → documented `'next'` fallback.
  Random pick seeded: `mulberry32(fnv(projectSeed + ':' +
  transitionCounter))` — replayable per transport session. `afterBars`
  overrides the section length (`afterBars > scene.bars > pattern loop`).
- **G27** (HARD, offline simulation, CI-asserted): scripted chain walks the
  PINNED 20-transition random sequence
  `[2,2,11,11,9,9,4,13,8,16,11,9,1,15,8,1,8,6,0,13,0]`, replay-identical;
  next/prev wrap exact; scene lock; prob=0 fallback. e2e asserts 24 gates.
- `loadProjectObj` backfills follow canonically (absent/invalid → absent;
  legacy load→save byte-stability holds).

### Release — v0.7.0 (`docs: v0.7.0`)

- Battery: **271 tests across 23 files — 271 pass / 0 fail (302,947
  expect() calls)**; `node tools/verify.mjs` GREEN.
- Gates: **24 HARD MAIN (CI-asserted, incl. G26 MIDI + G27 follow) + 2
  evidence-only realtime (G17, G25)** = 26 device entries; WORKLET 3/3.
- PWA: `sw.js` `CACHE_VERSION = 'psy6-v0.7.0'` (verify.mjs enforces the
  version↔CHANGELOG lock).

## [0.4.0] — Run 6: EVIDENCE + PLAY + CAPTURE + STEMS + SHARE

### Added — CI gate evidence (`ci: run self-gate evidence in CI`)

- `tools/e2e.mjs` — zero-dependency CDP driver (bun/node>=22 native
  WebSocket): ephemeral no-store static server, fresh-profile headless
  Chrome with the autoplay-policy bypass, boots the MAIN engine via real UI
  clicks, presses RUN SELF-GATE, reads `window.__psy6Gates`, emits
  machine-readable `{gate, pass, evidence}` JSON, exits nonzero on failure.
- `.github/workflows/ci-gates.yml` — job `verify` (`node tools/verify.mjs` +
  `bun test`) → job `gates` (headless Chrome e2e). `gates` is **blocking**
  with ONE automatic retry of the driver before going red; no
  `continue-on-error` anywhere. Gate evidence uploaded as a CI artifact.
- Subset honesty: all MAIN-mode gates are pure computation or deterministic
  OfflineAudioContext renders (fixed schedules; inequality/integer criteria —
  never bit-exact audio) → CI has no realtime dependency. The WORKLET
  reduced set (G14w/G15w), the realtime capture gate (G17) and live-loop
  checks stay local-only (G17 runs on-device and is reported in CI as
  non-asserted info). See README "Self-Gate in CI".
- Reproduce: `bun tools/e2e.mjs --out gates-evidence.json` →
  `E2E GATES: GREEN (18/18 asserted)` (G1×4, G2, G5, G6, G8–G16, G18, G19).

### Added — MIDI IN with CC learn (`feat: midi input with cc learn`)

- `js/midi.js` — DOM-free MIDI IN core; Web MIDI access injected via a
  settable provider (tests drive a MockMIDIAccess through the same byte
  path as a real device).
- Note On (0x90, vel>0) → triggers the currently-selected track, velocity =
  vel/127, MIDI note = pitch; Note Off (0x80 or 0x90-vel-0) → releases that
  track's synth voices (new `PooledEngine.killTrack` + voice ownership;
  drum one-shots are never cut mid-hit — documented semantics).
- CC learn: pick one of 57 mappable targets (macros 0–7, master.vol,
  per-track mix.vol/pan/sendA/sendB/mute/scAmount), press LEARN, move a
  control → binding stored in `project.midiMap` (versioned, save/export/
  import round-trip; absent → empty map, backfilled).
- CC 0 ignored (bank select); CC 123 → PANIC. Dispatch resolves paths via
  pure `resolveMidiParam(p, path, v01)`; macros resolve against the PASSED
  project (a real bug the Bun tests caught: `resolveMacros` previously read
  the global project — fixed with an optional target argument).
- UI: Perform-tab MIDI section (device selector, LEARN mode + indicator,
  bound-CC list with clear buttons); graceful "Web MIDI unsupported" note
  on non-Chromium — no crash. **No MIDI clock sync — out of scope.**
- Self-Gate **G16** (pure, scripted MockMIDI session, exact assertions):
  `note=60/vel=100@t4 offs=2 learn=45→track.2.scAmount sc=55 cc0kept=true
  panic=1 rt=true`.
- Tests: `tests/midi.test.ts` (20 tests).

### Added — live capture to WAV (`feat: live capture to wav`)

- Master-output tap: `ScriptProcessorNode` (**deprecated but universally
  supported — chosen deliberately**: zero changes to the MAIN engine graph,
  no worklet module reload). Growable preallocated Float32 chunks
  (262144 frames ≈ 5.9 s): per-callback cost is one `.set()` — no
  per-callback allocation; frame counts tracked in Float64.
- The tap is parallel (analyser → tap → zero-gain sink) — it never inserts
  itself into the live path. CAPTURE button (distinct from sequencer REC):
  ARM → recording starts on the next 16-step bar boundary (scheduler
  `I.barHooks`) → STOP arms a bar-quantized stop → encoded by the EXISTING
  bounce WAV encoder (no duplicate encoder) → downloads
  `psy6-capture-<bpm>bpm.wav`. Panic-safe: capture never touches the
  transport; transport-stop mid-capture finishes immediately (documented).
- Self-Gate **G17** (REALTIME — local-only; CI reports info, never
  asserts): real tap + real scheduler, one bar captured:
  `frames=82944 dur=1.881s bar=1.875s skew=6ms` (tolerance ±50 ms)
  `rms=0.0798 hdr=valid`.
- Tests: `tests/capture.test.ts` (growth accounting, quantization math,
  encoder-reuse WAV round-trip).

### Added — per-track stem export (`feat: per-track stem export`)

- `renderBounce(p, loops, {trackIdx})` renders a stem through the SAME
  deterministic offline graph — only that track's events trigger, so the
  other tracks contribute exactly 0 (no voices spawn). No options →
  full-mix render byte-identical to v0.3.0 (same schedule hash).
- Bounce modal MODE select (MIX | STEMS): STEMS renders N files for
  non-empty tracks only, sequential downloads (350 ms apart — browsers
  throttle rapid clicks), named `psy6-stem-<trackName>.wav`.
- Self-Gate **G18** (offline, CI-asserted). Isolation semantics stated
  honestly: no-voice regions are EXACTLY 0 (the bass stem's silence spans
  the kick's whole timeframe); the residual after a track's own voice is
  its own exponential decay tail — physics, not bleed (bounded ≤ 1e-3):
  `kickRMS=0.0696 bassRMS=0.0675 silentRegions=0/0 kickOwnTail=0.000034
  N=84893 det=true`.
- Tests: `tests/stems.test.ts` (discovery, per-track determinism, full-mix
  hash unchanged).

### Added — share links via URL hash (`feat: share links via url hash`)

- `js/share.js` (DOM-free): project → canonical JSON (key order pinned —
  arrays keep order) → `CompressionStream('deflate-raw')` → base64url →
  `location.hash` (`#p=<token>`). Same project ⇒ byte-identical link.
  No Date.now / Math.random.
- Guards: compressed token > 6 KB → warn (Chrome URL limits); > 50 KB →
  hard error with clear toast. Environments without CompressionStream are
  told to use file EXPORT — never a silently degraded link.
- Consent: `#p=` on boot shows a power-screen banner — LOAD SHARE (explicit
  click; replaces the in-memory project, learner snapshot included) or
  DISMISS. **Never auto-loads.**
- Self-Gate **G19** (pure, CI-asserted): default PSYTRANCE round-trip
  deep-equal, learner (`p.copilot`) survives, byte-identical determinism:
  `json=21944B token=1960B warn=false det=true learner=true`.
- Tests: `tests/share.test.ts`.

### Fixed

- `resolveMacros(target)` — macro resolution now resolves the project it is
  given (Bun tests caught it reading the global project).
- Power-screen engine note: gate count text corrected to the real number.

### Evidence (v0.4.0, local runs)

- `bun test` → **147 pass / 0 fail** across **14 files**, **6886** `expect()`
  calls (~175 ms).
- `node tools/verify.mjs` → **GREEN** (0 failures).
- `bun tools/e2e.mjs` → **E2E GATES: GREEN (18/18 asserted)** + G17 info
  (realtime capture) PASS on-device.
- Device Self-Gate (MAIN): **19/19** (G1×4, G2, G5, G6, G8–G16, G17, G18,
  G19). WORKLET reduced set unchanged: **3/3** (G2 + G14w + G15w).

## [0.3.0] — Run 4: SOUND SIGNATURE + CAPTURE

### Added — kick-triggered sidechain ducking (`feat: kick-triggered sidechain ducking`)

- Per-track `scAmount` 0–100 (**default 0 — zero behavior change**),
  `scAttackMs` 12 / `scHoldMs` 0 / `scReleaseMs` 140; backfilled into projects
  saved before sidechain existed.
- Engine: ONE persistent `duck` GainNode per track bus (input → duck → pan),
  created at init — **no per-hit nodes**. Kick events automate every bus whose
  `scAmount > 0` (never the kick's own bus) using ONLY `setValueAtTime` +
  `linearRampToValueAtTime`: dip to `1 − amount/100` → attack → [hold] →
  linear recovery.
- Overlap-safe: fast 16th-note kick rolls at 145 BPM start each new envelope
  from the exact value of the previous one — value-continuous, click-free,
  always recovers to 1.0. Envelope math lives in
  `foundation/dsp/sidechain.mjs` (pure, deterministic, bun-testable).
- Mixer strips: SC depth slider + attack/hold/release drawer (⋯).
- Self-Gate **G11** (offline render; the duck is isolated as the ducked/plain
  window-RMS ratio, removing the synth's own note envelope from the
  measurement): `dipMin=72% recoveryMin=100% amt0Events=0 amt75Events=8`.
- Tests: `tests/sidechain.test.ts`.

### Added — per-track delay/reverb sends (`feat: per-track delay and reverb sends`)

- DELAY bus: BPM-synced, division `1/8 | 3/16 (default) | 1/4`, feedback
  0–80 % (default 35 %) with a 4.5 kHz lowpass inside the feedback loop.
- REVERB bus: deterministic synthetic stereo IR — seeded decorrelated noise
  (canonical `mulberry32`, one seed per channel), exponential decay over
  ~1.8 s, generated at init. No external files, no `Math.random`; the same
  seeds produce a byte-identical IR on every machine.
- Per-track `mix.sendA` / `mix.sendB` 0–100 (**default 0 — zero behavior
  change**) — post-fader taps; project `fx {delayDiv, delayFb}` + backfill.
- Mixer: DLY/REV per strip + global DIV/FB controls.
- Self-Gate **G12**: `sendRMS=0.0150 reverbRMS=0.0050 zeroRMS=0.0001
  delay@145ms=206.9/310.3/413.8 irIdentical=true`.
- Tests: `tests/sends.test.ts`.

### Added — offline WAV bounce (`feat: offline WAV bounce`)

- BOUNCE button → modal (loops 1/2/4/8, default 2) → offline render through a
  FRESH engine graph (the live engine is never touched) → 16-bit PCM stereo
  44.1 kHz WAV (44-byte RIFF header) → download `psy6-bounce-<bpm>bpm.wav`.
- Same event function as live playback (per-bar seeded `stepEvents`) — the
  schedule is deterministic; two renders of the same project have byte-identical
  schedules. Documented difference vs live: no worker-timer lookahead jitter —
  events land at mathematically exact sample positions.
- Self-Gate **G13**: `samples=148192/148192 rms=0.089 schedIdentical=true`.
- Tests: `tests/bounce.test.ts`.

### Added — optional worklet engine mode (`feat: optional worklet engine mode (experimental, documented)`)

- Power screen engine selector: **MAIN** (pooled — default and reference) |
  **WORKLET** (experimental). MAIN is untouched by default (zero behavior
  change).
- `js/worklet-engine.js`: model→worklet mapping (voice ids, MIDI→Hz, bpm,
  per-bus sends) + **documented limitations** (per-track sends collapse to
  per-BUS max; fixed 0.5 s delay length — no division control; fixed-shape
  bass-bus duck instead of per-track sidechain; worklet world-params drive
  synth voices, not the synth editor; worklet-internal IR). The power screen
  lists the limitations verbatim.
- Transport channels: LIVE — outbox handshake (commands buffer until the
  worklet's first `stats` message proves the processor port is attached;
  Chrome builds processors lazily and pre-attach posts are lost
  nondeterministically) with a 200 ms timer backstop; OFFLINE — commands are
  replayed at construction via `processorOptions.initialMessages` because the
  offline render thread never drains its input message queue.
- Self-Gate is mode-aware: **15/15 in MAIN** (G1–G15), **3/3 reduced set in
  WORKLET** (G2 + G14w + G15w — real checks on worklet stats, not skipped).
  Evidence: G14 `peak=0.785 residualEvents=0` · G15 `tier0Steals=0
  hatSteals=41 kicks=16/16 peak=1.016` · G14w `peak=0.710 residualEvents=0
  kicksVoiced=8/8` · G15w `tier0Victims=0 hatSteals=188 kicksVoiced=16/16
  peak=0.938`.
- `fix: resume suspended AudioContext on power on` — the context is now
  `resume()`d on power-on (autoplay-policy-safe); both engines verified
  producing live audio in a real browser.

### Fixed — the "79.6 dB" aliasing claim was vacuous

- The 2x oversampled master saturation never advanced its input ring cursor
  (`osInIdx`), so the oversampler re-read stale input: the "2x oversampled"
  path processed a heavily-attenuated (near-silent) signal and the earlier
  **79.6 dB reduction** claim was a measurement of near-silence — not of
  alias reduction. The old test asserted `reduction > 10 dB`, which the
  broken path "passed" vacuously.
- Fixed (all three `processSat` copies): the cursor advances.
  **Honest benchmark** (same sweep, same band): native **68.5 dB** →
  oversampled **60.4 dB** → **reduction 8.2 dB**. A non-silent-output guard
  test now prevents a silent-output regression from faking the number again
  (oversampled-path peak must be > 0.5; measured 0.729).

### Verified (this release)

| Check | Command | Result |
| --- | --- | --- |
| Test suite | `bun test` | **102 pass / 0 fail**, 10 files, 6321 expect() calls |
| Repo gates | `node tools/verify.mjs` | **GREEN (0 failures)** |
| Aliasing benchmark | `bun test tests/master-oversampling.test.ts` | 68.5 dB → 60.4 dB (**8.2 dB reduction**, honest) |
| Device Self-Gate, MAIN | Self-Gate tab → RUN SELF-GATE | **15/15 passed** |
| Device Self-Gate, WORKLET | power screen → WORKLET → RUN SELF-GATE | **3/3 passed** (reduced set) |

## [0.2.0] — Run 3: GO LIVE + BRAIN

### Added

- **GitHub Pages deployment, zero secrets** (`ci: add GitHub Pages deployment`)
  — `.github/workflows/deploy-gh-pages.yml` deploys the repo root on every
  push to `main`. Live URL: https://dudududi144-source.github.io/psy5/
  (device at `/`, playground at `/playground/`). Asset-reference audit: all
  ES-module imports, worklet `addModule` URLs and links are relative paths
  (verified over HTTP: both pages boot, Self-Gate passes from the live URL).
- **CO-PILOT** (`feat: co-pilot learner wired to device`) — consent-driven
  contextual bandit connecting `foundation/learning` to the device:
  - `foundation/learning/bandit.mjs`: dependency-free port of the learning
    package semantics (epsilon-greedy + cold-start + abstention; DO_NOTHING
    always legal; injected seeded RNG; full JSON round-trip).
  - Decision loop every 4 bars while playing (scheduler bar hooks); context =
    energy, scene, active layers, density, bars-since-variation, macros,
    gesture counts; candidates mapped onto existing device paths (FILL,
    VARIATION, groove toggle, layer toggle, scene nudge, DO_NOTHING).
  - Rewards: explicit 👍/👎 (+1/−1); implicit +0.5 (user FILL/VAR/scene within
    2 bars of APPLY); −0.5 (PANIC/UNDO or dismiss within 2 bars); 0 (window
    closed with no signal). Suggestions NEVER auto-apply — APPLY/DISMISS in
    the Perform-tab panel, LEARN toggle is fully inert when OFF.
  - Learner state persisted inside the project (`p.copilot` v1); absent on
    import → fresh learner. Exploration seeded from projectSeed+decision
    counter — same seed+history reproduces the same suggestions.
- **Section arranger** (`feat: section arranger`) — project-level
  [scene, bars] chain with bar-quantized auto-advance reusing the existing
  scene-launch transition, upcoming-section indicator in the Perform tab,
  manual override stops auto-advance; stored in save/export.
- Self-Gate **G10** (device now 10/10): scripted 50-decision session —
  `fillAvg=1.00(n=45) > varAvg=0.00(n=2)`, probe exploits fill, abstention
  fires under all-low rewards.
- Bun suite: **74 tests across 7 files — 74 pass / 0 fail** (18 co-pilot +
  7 arranger tests added; 49 pre-existing all green).

### Verified

- `bun test` 74/74 · `node tools/verify.mjs` GREEN · device Self-Gate 10/10
  (G9 evidence unchanged: `kicks=16/16 hats=64/64 tier0Steals=0`).
- Device boots from https://dudududi144-source.github.io/psy5/ and passes the
  Self-Gate from the live URL in a headless browser.

## [1.0.0] — PSY6 stabilization, engine and groove release

### Fixed — deploy pipeline (`fix: repair failing deploy pipeline`)

`playground/index.html` was structurally corrupted: a stray `<` plus an
orphaned JS fragment and a mangled `!DOCTYPE` line before `<html>`, orphaned
HTML panels before `<head>`, and feature blocks (RECORDER / COLLAB / AI /
CLOUD / MIDILEARN) machine-spliced inside unrelated function bodies with a
recurring `});` vs `}` brace bug that made the main script unparseable
(`node --check` failed: `SyntaxError: Unexpected token ')'`).

- Feature objects hoisted to top level; host functions (`makeTimerWorker`,
  fbForm submit handler, `bumpStat`) restored to their original bodies;
  broken keyboard handlers fixed; spliced auto-calls removed (including
  `RECORDER.start()` prompting for microphone access on page load).
- Orphaned panels moved into `<main><div class="grid">`; the WORKLETS
  fragment moved into a proper `<script>` after the main script.
- `tools/verify.mjs` added: standalone-JS, ES-module, inline-script and
  document-structure gates (zero dependencies).
- CI (`.github/workflows/pages-deployment.yaml`): a `verify` job now runs
  `node tools/verify.mjs` and gates the deploy job. The deploy job itself is
  unchanged and still requires the repository secrets
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` — **note:** those
  secrets are an ops prerequisite that cannot be created from code; the
  deploy leg cannot be exercised from a local clone.

Verify locally: `node tools/verify.mjs` → `VERIFY: GREEN (0 failures)`.

### Changed — device identity (`refactor: unify device identity to PSY6`)

- `worklets/psy4-engine.js` → `worklets/psy-engine.js`
  (processor `psy4-engine` → `psy-engine`, class `Psy4EngineProcessor` →
  `PsyEngineProcessor`); `worklets/psy4-dsp.js` → `worklets/psy-dsp.js`.
- Playground `addModule` URLs updated; device-identity comments now say
  PSY6; historical PSY3/PSY4/PSY5 attributions kept and labeled as history.
- README rewritten for PSY6-on-psy-foundation; FOUNDATION_STATUS.md and
  FOUNDATION_FREEZE.md carry device-lineage preambles.

### Changed — modular device (`refactor: split index.html into ES modules`)

The 62 KB `index.html` monolith (CSS + markup + model + scheduler + engine +
UI + self-gate in one file) is split into native ES modules with zero
behavior change (code text byte-identical per module; only import/export
declarations added):

```
js/model.js      constants, scales, mk* factories, PRNG, hash, stepEvents
js/presets.js    factory library, assignPresetToTrack, buildStyle
js/engine.js     PooledEngine + SynthVoice + DrumVoice
js/state.js      shared state I, history, macros, PERF, save/load, $, toast
js/scheduler.js  worker timer + lookahead loop
js/ui/header.js  js/ui/perform.js  js/ui/seq.js  js/ui/sound.js
js/ui/mix.js     js/ui/tests.js    — one module per tab
js/main.js       renderAll / renderLoop / meter / powerOn / boot
css/app.css      extracted styles
```

`index.html` is now 63 lines: markup plus
`<script type="module" src="js/main.js"></script>`. All modules are well
under the 500-line limit (largest: `js/presets.js`, 169 lines).

Verified: device boots, scheduler advances, sequencer/preset/mixer
interactions work, Self-Gate passes — in a headless browser.

### Added — priority voice stealing (`feat: priority voice stealing in pooled engine`)

Tiers: `0` = kick/bass · `1` = hats/snare/clap/perc · `2` = lead/arp/pluck ·
`3` = pad/fx/texture.

- **Worklet engine** (`worklets/psy-engine.js`): when a pool is exhausted,
  the oldest ACTIVE voice of the lowest-priority non-empty tier above tier 0
  (scan 3 → 2 → 1) is stolen; within a tier the oldest active voice loses.
  Tier-0 voices are never stolen — a new tier-0 note retriggers its
  dedicated voice. Oldest-active tracking via monotonic trigger sequence;
  victim scans are numeric compares over preallocated pools — the
  `process()` hot path stays allocation-free.
  *(Interpretation note:* “steal from the lowest non-empty tier above tier 0”
  is implemented as lowest **priority** — pads/fx are sacrificed before hats
  — the only reading consistent with the tier priorities; ambiguity resolved
  in favor of musical behavior.*)*
- Pool sizes and per-voice tier assignment are init-time parameters
  (`AudioWorkletNode` `processorOptions: { poolSizes, tiers }`, defaults =
  the historical sizes) and re-tunable at runtime via a `config` port
  message; per-tier steal counters ship in the stats payload.
- **Device pooled engine** (`js/engine.js`): same tier policy; pool sizes
  are constructor parameters (defaults 20 synth / 24 drum); per-track
  dedicated tier-0 voices; `tier0StealAttempts` guard counter.
- **Self-Gate G9** (device): 64 consecutive open-hat 16ths + kick on every
  4th step, rendered offline with a 3-voice drum pool (deliberate overload).
  Latest run evidence: `kicks=16/16 hats=64/64 tier0Steals=0
  steals(h1/h2/h3)=70/0/2 peak=0.752` → PASS. Full gate: **9/9 passed**.
- Tests: `tests/voice-stealing.test.ts` — 11 pass / 0 fail (loads the real
  worklet source in a stubbed AudioWorklet environment).

### Added — deterministic per-bar seeding, full-range micro, grooves (`feat: deterministic per-bar seeding, full-range micro timing, groove templates`)

- `stepEvents()` draws all probabilistic decisions from a per-bar seeded
  RNG: `seed = fnv1a(projectSeed + ":" + barIndex)` (first 32 bits). Bar
  index derives from the step position modulo the pattern loop — the same
  bar produces the identical event list on every loop pass.
- Project seed exposed in the header, stored in the project, included in
  save/export/import; older projects backfill `seed='PSY6'`.
- Micro timing is now full-range: `micro[-100..100] → [-0.5..+0.5]` of a
  16th step (the previous 0.45 cap is gone); negative offsets (ahead of
  grid) are honored end-to-end. Step editor hint updated.
- Groove templates — named per-step offset transforms applied
  deterministically **before** the probability gate, all randomness from
  the per-bar RNG: `straight` (default — existing feel preserved),
  `mpc54` (54–58 % swing on odd 16ths), `psy-push` (odd bass 16ths pushed
  +6..+8 ticks against the kick; 1 tick = 1/64 of a 16th-step ≈ 10–13 ms
  at 145 BPM), `humanize` (seeded gaussian-ish micro, ±3 % of a step).
  Selection stored per project and in save/export; swing slider unchanged.
- Tests: `tests/determinism.test.ts` — 18 pass / 0 fail.

### Added — 2x oversampled master saturation (`feat: 2x oversampled master saturation`)

- Worklet `MasterChain` stage 3 (tanh saturation) now runs at twice the
  native rate: zero-stuffing + 33-tap halfband polyphase FIR (Blackman,
  cutoff = Nyquist/2 at the 2x rate) → saturate both 2x samples →
  anti-alias halfband → decimate. Linear phase, 16-sample delay, zero
  allocation. The true-peak limiter stays at native rate.
- Togglable for A/B: `processorOptions { masterOversample }` or a `config`
  port message.
- **Benchmark** (`tests/master-oversampling.test.ts`; run
  `bun test tests/master-oversampling.test.ts`): sawtooth sweep 12 → 16 kHz
  @ 44.1 kHz through the real MasterChain (satDrive 4.0, satMix 1.0),
  alias-only band 16.5–22.05 kHz (above the sweep fundamental, below
  Nyquist — pure foldback of the 2f/3f harmonics):

  | Configuration | Alias-band energy |
  | --- | --- |
  | Before — native saturation | **68.5 dB** |
  | After — 2x oversampled saturation | **−11.0 dB** |
  | **Reduction** | **79.6 dB** |

### Changed — foundation is the single source of truth (`refactor: device consumes foundation as single source of truth`)

- `js/model.js` imports `mulberry32`, `fnv1a` and the scale table from
  `foundation/` via native ESM relative imports (no bundler). The device's
  local PRNG/hash/scale-interval copies are deleted; device scale keys
  (`minor`, `major`, `dorian`, `phrygian`) are aliases onto
  `foundation/music/context.mjs` SCALES — interval data lives only in the
  foundation.
- `fnv1a` was **added to the foundation** (with pinned-vector tests) rather
  than duplicated. Pinned vectors prove behavior-neutrality (same PRNG
  sequence, same hashes, same per-bar event streams).
- Runtime lookahead scheduling stays device-local (the foundation scheduler
  is the offline plan→events primitive — the purpose boundary documented in
  FOUNDATION_STATUS.md; building the runtime adapter was out of scope for
  this brief). `foundation/learning` has no device consumer yet.
- `package.json` added (`psy6`, private, ESM) with `test` / `verify` /
  `benchmark` scripts.
- `soundBank.js` was TypeScript with a `.js` extension — renamed
  `soundBank.ts` and given a runtime smoke test
  (`tests/soundbank.test.ts`, 4 tests).
- Removed five legacy test files (`music/dsp/learning/transport/analysis
  .test.ts`) that were copied in "from psy-foundation family": they import
  `@psy-foundation/*` and `../src/index.ts` — paths that never existed in
  this repository — so they were never runnable here. Replaced by
  `tests/foundation-primitives.test.ts` (13 tests) which tests the
  foundation packages this repo actually ships.

### Verified state (this release)

| Check | Command | Result |
| --- | --- | --- |
| Test suite | `bun test` | **49 pass / 0 fail**, 5 files, 917 expect() calls |
| Repo gates | `node tools/verify.mjs` | **GREEN (0 failures)** |
| Aliasing benchmark | `bun test tests/master-oversampling.test.ts` | 68.5 dB → −11.0 dB (**79.6 dB reduction**) |
| Device Self-Gate | Self-Gate tab → RUN SELF-GATE | **9/9 passed** |
| Playground | open `playground/index.html` | boots, worklets load, no console errors |
