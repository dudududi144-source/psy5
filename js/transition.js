/* ============ TRANSITIONS v1 (v0.16.0) — smooth section hand-offs ============
   The owner's field report: transitions built between sections "don't go
   smoothly from one to the next". This module adds the missing vocabulary —
   a per-scene, OPTIONAL transition config that turns a bare pattern swap
   into a produced hand-off. Everything rides EXISTING voices (riser /
   revcym / impact are drum types since v0.12.0–v0.15.0) and the EXISTING
   mix-glide machinery (syncMix) — no parallel engine, no new DSP nodes.

   scene.trans (OPTIONAL; absent/null = EXACT legacy behavior — zero extra
   events, zero cut, the legacy 20 ms glide):
     { riser:  0|1|2  — bars of riser INTO this scene (2 stacks a second,
                        earlier riser under the main sweep)
       revcym: 0|1    — reverse-cymbal swell across the last bar
       impact: 0|1    — impact hit exactly on the boundary
       cut:    0|1    — bass silent for the last 2 steps (the DJ vacuum)
       xfade:  0..8   — beats; glide span of THIS scene's own mix-snapshot
                        application at launch (0/absent = legacy 20 ms) }

   SEMANTICS — "INTO this scene": riser/revcym/impact/cut fire at the END of
   the PREVIOUS section, computed from the boundary step/time where THIS
   scene lands. The boundary is always known from section data (offline) or
   one bar of scheduler lookahead (live) — never from a wall clock. All
   synthesis is seeded engine math; there is no Math.random/Date.now here.

   SOURCES OF LOOKAHEAD (honest scope):
     - songSchedule/renderSong (offline): full knowledge — all elements.
     - live scheduler via the ARRANGER: the next section's scene + bars are
       known at the current section's launch — all elements.
     - live scheduler via CHAIN/FOLLOW: the next scene is resolved one bar
       ahead — revcym / 1-bar riser / cut / impact possible (the legacy
       +1-bar chain-apply quirk becomes the transition bar — the swell
       plays INTO the drop).
     - manual quantized launch with no lookahead source: impact + xfade
       only (documented; riser/revcym/cut need a lookahead source).

   VOICE CARRIERS: the FX events trigger EXISTING drum tracks whose TYPE
   matches the element ('riser' / 'revcym' / 'impact'). A project without a
   matching track SKIPS that element (findTransTrack → -1) — never creates
   tracks, never retypes existing ones. Composer/synth projects carry the
   types through the v0.14+ library; the G50 fixture builds them explicitly.

   DETERMINISM: every time/step here derives from the step grid (sd = step
   seconds) and integer step arithmetic. The same project + same transport
   position produce identical event lists on every machine (asserted in
   tests/transitions.test.ts and gate G50). */

/* normalizeTrans — validate + clamp a payload into CANONICAL field order.
   Anything invalid/empty → null (the legacy shape: no trans field at all).
   Deterministic: same input → same canonical object (load→save stable). */
function normalizeTrans(t) {
  if (!t || typeof t !== 'object') return null;
  const ci = (v, lo, hi) => (v == null || !isFinite(v)) ? 0 : Math.max(lo, Math.min(hi, Math.round(v)));
  const out = {
    riser: ci(t.riser, 0, 2),
    revcym: t.revcym ? 1 : 0,
    impact: t.impact ? 1 : 0,
    cut: t.cut ? 1 : 0,
    xfade: Math.round(Math.max(0, Math.min(8, isFinite(+t.xfade) ? +t.xfade : 0)) * 100) / 100,
  };
  if (!out.riser && !out.revcym && !out.impact && !out.cut && !out.xfade) return null;
  return out;
}

/* xfadeTc — setTargetAtTime time constant for an xfade of N BEATS.
   A one-pole approach reaches ~95 % at 3τ → τ = span/3; N beats = 4N steps
   → τ = 4N·sd/3. 0/absent → the EXACT legacy constant (0.02 s) — the
   neutral contract. */
function xfadeTc(trans, sd) {
  const b = (trans && isFinite(+trans.xfade)) ? +trans.xfade : 0;
  return b > 0 ? (b * 4 * sd) / 3 : 0.02;
}

/* findTransTrack — lowest-index drum track whose TYPE matches; -1 = none.
   The type read mirrors the engine's DrumVoice dispatch ((sound&&type)||type). */
function findTransTrack(p, type) {
  const ts = (p && p.tracks) || [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t && t.kind === 'drum' && ((t.sound && t.sound.type) || t.type) === type) return i;
  }
  return -1;
}

/* cutSpan — the [from,to) ABSOLUTE step window where the bass is muted:
   the last 2 steps before the boundary (an 8th-note vacuum, the classic
   pre-drop cut). Clamped at 0 (a boundary at step 0..2 just shrinks). */
function cutSpan(boundaryStep) {
  return [Math.max(0, (boundaryStep | 0) - 2), boundaryStep | 0];
}

/* transEvents — the OFFLINE (full-knowledge) FX event list INTO a scene, on
   the absolute step grid. boundaryStep = the absolute step where this scene
   lands. sd = step seconds. findTrack = (type) → track index or -1.
   Riser timing: the sweep always ENDS at the boundary (the engine's riser
   voice sweeps exactly 1.6 s) — the start is clamped so a 2-bar setting
   stacks a second, EARLIER riser instead of leaving a silent gap.
   Events never start before step 0 (clamped — the song-start boundary
   simply gets a shorter sweep). Sorted by absStep ascending. */
function transEvents(trans, boundaryStep, sd, findTrack) {
  const out = [];
  if (!trans) return out;
  const B = Math.max(0, boundaryStep | 0);
  const push = (kind, type, step, vel) => {
    const ti = findTrack(type);
    if (ti >= 0) out.push({ kind, track: ti, absStep: Math.max(0, step | 0), vel, note: 48 });
  };
  if (trans.impact) push('impact', 'impact', B, .9);
  if (trans.revcym) push('revcym', 'revcym', B - 16, .85);
  if (trans.riser) {
    push('riser', 'riser', B - Math.round(1.6 / sd), .8);           /* main sweep — lands ON the boundary */
    if (trans.riser > 1) push('riser', 'riser', B - 32, .7);        /* stacked under-sweep one bar earlier */
  }
  out.sort((a, b) => a.absStep - b.absStep);
  return out;
}

/* planTransLive — the LIVE-scheduler arm: element times in AUDIO SECONDS
   for a boundary at boundaryTime, given lookaheadBars of knowledge.
   Returns { events: [{at, kind, track, vel}], cut: [from,to] | null }.
   lookaheadBars 0 → impact only (manual quantized launch). Sorted by at. */
function planTransLive(trans, boundaryTime, sd, lookaheadBars, findTrack) {
  const events = [];
  if (!trans) return { events, cut: null };
  const push = (kind, type, at, vel) => {
    const ti = findTrack(type);
    if (ti >= 0) events.push({ at, kind, track: ti, vel });
  };
  if (trans.impact) push('impact', 'impact', boundaryTime, .9);
  const bar = 16 * sd;
  if (trans.revcym && lookaheadBars >= 1) push('revcym', 'revcym', boundaryTime - bar, .85);
  if (trans.riser) {
    if (lookaheadBars >= 1) push('riser', 'riser', Math.max(boundaryTime - bar, boundaryTime - 1.6), .8);
    if (trans.riser > 1 && lookaheadBars >= 2) push('riser', 'riser', boundaryTime - 2 * bar, .7);
  }
  const cut = (trans.cut && lookaheadBars >= 1) ? [boundaryTime - 2 * sd, boundaryTime] : null;
  events.sort((a, b) => a.at - b.at);
  return { events, cut };
}

export { normalizeTrans, xfadeTc, findTransTrack, cutSpan, transEvents, planTransLive };
