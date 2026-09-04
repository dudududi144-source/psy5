# ENGINEERING ROAST — PSY6 v0.25.0 under the production knife

> Written by the engineer who shipped it, on the owner's order: "give yourself
> a very harsh roast as a software engineer releasing to production — dissect
> the design to arrange everything professionally."
>
> Every finding below is reproducible from the repo at bb8344bb (v0.25.0).
> Each carries a verdict: **FIXED in v0.26.0** or **standing debt** (with the
> reason it was left).

---

## The headline

We built a real engine and wrapped it in an archaeology dig. Twenty-five
releases of layered "one more directive" engineering produced a product whose
**core is genuinely professional** (48 asserted gates, deterministic composer,
pool discipline, kit-governed sound) and whose **surface is a developer
console**: stale copy, duplicate truths, three files that disagree about which
song the demo button plays, four styles that silently bypass the flagship
feature of v0.24.0, and a boot screen that offers fifteen equally-weighted
choices to someone who just wants to hear psytrance. A commercial A&R person
would close the tab in eleven seconds. The roast follows.

---

## 1. The demo buttons do not play the demo songs — THREE sources of truth, THREE different stories

**Evidence.** `data/demos/demo-darkpsy.json` pins `seed: 777` and
`tests/usability.test.ts` hardens exactly that (line 72: `seed: 777`). The
actual UI button (`js/main.js`, v0.25.0) plays
`composeBoot('DARK-PSY', 5, 90210)`. So the "demo recipe" file, the test that
certifies it, and the button the user presses describe **two different songs**.
The shipped demo documentation is documentation of a song the product never
plays. This is the purest specimen of the layered-build disease: run A wrote
the files, run B rewired the buttons, run C's test kept certifying the files,
and nobody ever compared all three.

**FIXED (v0.26.0).** One identity per demo: file = test = button = seed 90210
for DARK-PSY, minutes 8 (the full showcase form). The demos are regenerated
from `compose()` itself — the form summary in the JSON is now *measured*, not
transcribed.

## 2. The seed table exists twice, in two files, with no relationship

**Evidence.** `js/library.js` exports `READY_SEEDS` (the album and the tests
consume it). `js/main.js` hand-copies the same nine numbers into local
`SET_SEEDS` for the boot buttons. Two copies of a nine-value truth table,
eighty lines apart in runtime responsibility, zero shared import. The DARK-PSY
demo drift above is exactly what this structure produces on schedule.

**FIXED (v0.26.0).** `main.js` imports `READY_SEEDS` from `library.js`. One
table. The local copy is deleted.

## 3. Production copy asserts a self-gate count that has been false for six releases

**Evidence.** `js/main.js` hardcodes **"full Self-Gate (19 checks)"** — twice
(boot note + engine-picker note). The real MAIN suite is **48 HARD entries**
(`tools/e2e.mjs` EXPECTED, reconciled live by G45). The count drifted somewhere
around v0.11 and nobody noticed, because copy is nobody's test. The user's
first contact with the product is a claim that the product's own tab
disproves one click later.

**FIXED (v0.26.0).** `js/gates-manifest.mjs` is now the single source of the
48 gate ids; `tools/e2e.mjs` imports it (its EXPECTED *is* the manifest), the
boot note renders the manifest count, and a bun test statically reconciles the
manifest against the ids `js/ui/tests.js` actually registers. Drift of this
class is now structurally impossible without a red suite.

## 4. Four of nine shipped styles silently bypass the v0.24.0 flagship feature

**Evidence.** v0.24.0's headline: *"every hit plays through the kit."*
`STYLE_KIT` maps exactly five styles; the test hardens the ceiling ("exactly
the 5 styles — no extras, no gaps"). `PSYTRANCE`, `GOA`, `TECHNO`, `TRANCE` —
a quarter of the product's genre surface — fall through
`STYLE_KIT[style] || DEFAULT_KIT` and ride the FULL-ON kit with no decision
behind it. TECHNO at 132 BPM gets a full-on kit at 145 BPM's character. The
data file that documents styles (`data/styles.json`) is frozen at five entries
— a snapshot of a younger product wearing the clothes of the current one.

**FIXED (v0.26.0).** `styles.json` documents all nine shipped styles;
`STYLE_KIT` carries nine deliberate mappings onto the existing six kits
(PSYTRANCE/GOA/TRANCE → `psy-classic` where that is the honest truth, TECHNO →
`progressive`); the kit test asserts nine-with-gaps-zero. Honest limitation
recorded: no NEW kit sound-design was commissioned this run — the fix is
governance (every style is a *decision*), not new patches.

## 5. The boot screen is a system dialog, not a product entrance

**Evidence.** The power screen offers, all visually equal: a hero, nine genre
buttons, three "demo" buttons that are *conceptual duplicates* of genre SETs
(same style, near-same seeds — before this run, one of them wasn't even the
song its own file described), a raw COMPOSE row (style/length/seed — three
developer nouns), an ENGINE A/B picker ("MAIN POOLED (DEFAULT) | WORKLET
(EXPERIMENTAL)" — an internal QA tool promoted to a first-class consumer
choice), and three paragraphs of explainer text. No hierarchy, no grouping, no
visual identity beyond monospace. The hero exists (good, v0.17.0), then the
screen immediately buries it under twelve more equal buttons.

**FIXED (v0.26.0).** The screen is restructured into an explicit hierarchy —
hero → genre grid → SHOWCASE (three distinct 8-minute demo films) → advanced
composer → engine picker demoted to a secondary footnote row with the honest
reduced-gate warning. Copy tightened to product voice. The test contract
(hero first / 9 ⚡ SETs / BARE last) is preserved and still asserted.

## 6. The product's own first field report was a CSP complaint — and the product still carries two inline handlers

**Evidence.** `index.html` lines 130/134: two `onclick="..."` attributes on
the help overlay. Inline handlers are `unsafe-inline` CSP patterns. The owner's
DevTools screenshot (v0.13.1 run) was diagnosed as the *preview wrapper's* CSP,
not ours — and the correct response was to make the app maximally
CSP-compatible anyway. Two handlers slipped through.

**FIXED (v0.26.0).** Handlers wired in `main.js`; the HTML carries zero inline
JS.

## 7. Every keystroke in the library search rebuilds up to 456 DOM rows

**Evidence.** `js/ui/sound.js` `renderLib()` — `$('libQ').oninput=renderLib`
with a full `innerHTML=''` + 456-row rebuild per input event. On a mid-range
laptop that's perceptible jank; on the low-end machines the owner actually
tests on, it's a freeze-shaped experience. The signature cache avoids *no-op*
rebuilds but a keystroke is by definition a change.

**FIXED (v0.26.0).** 120 ms trailing debounce on the search input; list built
through a DocumentFragment; clicks delegated to the container instead of 456
individual handlers.

## 8. `powerOn()` is a god function wearing a comment

**Evidence.** Context creation, engine A/B with fallback, four project-priority
sources (resume / compose / share / style), kit warming with idle slicing,
sample hydration, hint application, fifteen `wire*()` calls, render loop start,
FSM transition, two different toasts — one function, ~40 dense lines. Every
boot-adjacent change in the last ten runs touched it. That is the definition
of a change-amplifier.

**FIXED (v0.26.0).** Split into named single-concern steps (`bootAudio`,
`bootProject`, `bootWire`, `bootStart`) composed by a thin `powerOn`. Identical
boot behavior (asserted by the same gates), human-shaped code.

## 9. The gate manifest was reconciled only at e2e runtime, in the most expensive way possible

**Evidence.** `tools/e2e.mjs` hand-listed 48 EXPECTED ids; `js/ui/tests.js`
registers ids at runtime; the only thing proving they agree was running the
entire headless suite. A typo in either list surfaced as a red CI run after
nine minutes instead of a red unit test after twenty seconds. (The tests did
statically parse `tests.js` for specific ids before — after the fact, per
feature.)

**FIXED (v0.26.0).** See finding 3 — shared manifest + a 20-second bun test
that reconciles it against the runtime source.

## 10. The docs require hand-syncing numbers every release, and the release checklist is the only machine that knows

**Evidence.** README/ARCHITECTURE carry test counts (657/51), library size
(456), gate accounting (48 HARD + 2 evidence). `tools/verify.mjs` pins the SW
version against CHANGELOG — the one place where drift is automated — but every
other number is manual. Eleven CHANGELOG entries literally contain the phrase
"re-pinned". This is the maintenance tax of a pin-based engineering culture:
honest, but unpriced.

**STANDING DEBT (documented, not hidden).** Deriving doc numbers from the code
needs a small docgen pass (counts → markdown interpolation). It is scheduled
after v0.26.0; doing it *inside* this run would have ballooned a governance fix
into an infrastructure project. The roast says so, on the record.

---

## What is genuinely good (the roast's mirror — needed for calibration)

- **The engine discipline is real**: preallocated pools, tier-0 starvation
  accounting, allocation-light trigger path, honest durEst windows. The G44
  stress gate is the kind of test commercial DAW teams skip.
- **Determinism is a first-class citizen**, not a vibes word: seeded RNG,
  byte-identity pins, double-run proofs.
- **The honesty culture** — "documented reduced set", counted fallbacks,
  measured thresholds, "honest limits" sections — is rare and valuable. This
  roast exists because that culture demands it.
- 657 bun tests / 48 HARD browser gates that actually catch things.

## The verdict

v0.26.0 is the "release to production" pass the owner ordered: the three
truth-sources collapse into one (demos), the seed table into one, the gate
count into one manifest, the styles into full kit governance, the boot screen
into a hierarchy, the library search into a debounce, and the boot function
into readable engineering. What remains (doc-number docgen, new kit sound
design, worklet feature parity) is **documented debt with owners and reasons**,
not surprises.

*— the engineer, on the record, bb8344bb → v0.26.0*
