# ROAST — PSY6 v0.26.0 @ HEAD, reviewed as a production release

> Owner's directive: "תעשה לעצמך roast מאוד חריף בתור מהנדס תוכנה המשחרר לפרודקשן" —
> a very harsh self-roast, as the software engineer who ships this to production.
> Written BEFORE the v0.27.0 rebuild; every finding below is either fixed in v0.27.0
> or listed honestly as open.

## Verdict

The engine under the hood is real work — pooled voices, deterministic composer,
kit governance, 657 tests. The product on top of it is a dev tool wearing a
Halloween costume of a DAW. If a competitor shipped this skin I'd laugh; if WE
ship it again I should be demoted. Here is the itemized indictment.

## 1. DESIGN — a forum admin panel, not a product (CRITICAL, the one the owner sees)

1.1. **The entrance explains instead of sells.** The power screen opens with a
paragraph of instructions ("Press ENTER — a complete arranged set loads
instantly: scenes, transitions, arranger and a preseeded song album. Ready to
perform, never empty."). Products SHOW, they don't make you READ. The demo
buttons — the single most impressive feature, 8-minute full-form songs — are
buried in a small secondary row like a terms-of-service checkbox.

1.2. **No visual identity.** System-ui font, Bootstrap-default buttons, a
2009-style radial gradient, and an orange/teal palette applied with no system.
The genre picker is nine identical grey rectangles. Nine. Identical. The product
about SOUND has no visual sound.

1.3. **Zero spacing system.** Paddings of 5/6/7/8/9/10/12px picked by dice roll.
Every panel has identical visual weight — the CO-PILOT (a niche feature) renders
exactly as prominently as the SCENES grid (the instrument).

1.4. **The CSS is a fossil dig.** `css/app.css` is 182 lines of patch-on-patch
with museum comments: "v0.16.1 FIX — the ACTIVE TAB rendered as a solid orange
block with invisible orange-on-orange text" — we SHIPPED a tab you cannot read,
and enshrined it as a comment. Hard-coded hex `#171c25` appears ~30 times
NEXT TO the `--panel2` variable holding the same value. Two spellings of one
color is not a theme, it's an archaeological site.

1.5. **Inline styles as an architecture.** 50+ `style="..."` attributes in
index.html and 50+ more in the JS UI builders. Theming is impossible; every
restyle is a greppable crime scene.

1.6. **No footer, no status bar.** A pro audio product shows engine state,
version, latency — permanently. We have a chip squeezed into a wrapping header.

1.7. **Mobile is tolerated, not designed.** A groovebox is a TOUCH instrument.
The pads work, but the shell (5 tabs of dense panels) turns a phone into
vertical soup. `user-scalable=no` without a compensating large-target design.

## 2. ENGINEERING — good bones, embarrassing skin

2.1. **index.html is 149 lines of 2000-character run-ons.** Unreviewable,
undiffable, unmaintainable. A one-line change lands as a wall-of-text diff.

2.2. **Modal markup hand-copied three times** (bounce / compose / help) with
duplicated hex literals instead of tokens. A border-radius change touches 5 files.

2.3. **Layer archaeology as release notes.** The CHANGELOG is honest (good!) but
the layer-cake history shows: v0.16.1 fixes v0.16.0's layout, v0.22 patches the
pads, v0.26 "finishes the product" — and the owner STILL cannot see a design
change. That is the definition of the hysterical mess he called out.

2.4. What was actually GOOD (kept): deterministic composer + self-comparing
tests, pooled engine + load telemetry, kit governance, honest self-gate, PWA
network-first. The roast is about the skin and the glue, not the DSP core.

## 3. PRODUCT — features nobody can find

3.1. The composer (the product's soul) lives in a modal opened from two
different buttons with three fields and a wall of warning text.

3.2. The Song Library (reproducible albums!) is a right-column panel titled
"recipes, not snapshots" — jargon as UX.

3.3. Nine genres, zero differentiation at the entrance. BPM, character, kit —
all invisible until after boot.

## The fix — v0.27.0 "PRODUCTION SKIN" (this release)

- **Design tokens**: one `:root` source of truth (space grid ×4px, two radii,
  two shadows, semantic palette). All hard-coded hexes in the shell die.
- **Landing page**: hero (brand + one line), genre CARDS with per-style color,
  BPM range and character line; demos as a featured showcase; compose as a
  clean inline form; engine A/B demoted to a footnote. No paragraphs.
- **App shell**: sticky transport header, icon+label nav, sticky status footer
  (engine · version · shortcuts). `#app` becomes a real flex column shell.
- **Components**: one panel style, one chip style, one button scale, LED-style
  meters, consistent focus rings, `prefers-reduced-motion` respected.
- **Sounds** (the part you HEAR, ported from psyreason's newest work):
  escalating quarter→8th→16th build fills; ear-candy (bass octave pops,
  open-hat pickups, master dip into the drop); legato crossfade pads (kills the
  per-bar organ stutter); transparent mastering (brickwall limiter + EQ trims +
  harshness clamps at the source).

## Open / honest

- The JS UI builders still emit some inline styles (they inherit tokens via
  CSS classes now; full builder refactor is a separate release).
- Mobile gets a real layout pass in the shell; per-tab mobile ergonomics
  (pads on phones) remain follow-up.
- Worklet engine pad still uses its own envelope; legato scheduling lands in
  the composer so both engines benefit.
