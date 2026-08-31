// foundation/dsp/sidechain.mjs — kick-triggered sidechain ducking math (PSY6)
// Pure, deterministic, zero dependencies. No DOM, no AudioContext, no wall-clock.
//
// The device schedules ONE persistent GainNode per track bus (created once at
// engine init — no per-hit nodes). Each kick event plans a duck envelope on
// every target bus whose scAmount > 0 using ONLY setValueAtTime +
// linearRampToValueAtTime (no exponentialRamp, no setTargetAtTime — the dip
// must be piecewise-linear and value-continuous so fast 16th-note kick
// combinations at 145 BPM never click and always recover to 1.0).
//
// Overlap policy (next kick lands inside the previous envelope): the new
// envelope starts from the EXACT value the previous envelope has at that
// instant (value continuity → no step, no click). The previous envelope's
// pending recovery ramp finishes at its originally scheduled end time, which
// caps the new envelope's recovery — the plan reflects that faithfully so
// subsequent overlap math stays exact.

/* planDuck — compute the automation events for one duck.
 *
 * st        previous envelope state on this bus ({t0, dip, attack, release, end})
 *             or null when the bus is idle.
 * when      kick trigger time (seconds, AudioContext timeline).
 * dip       target gain during the duck, = 1 - amount/100, in (0..1).
 * attack    seconds from `when` to full dip  (> 0).
 * hold      seconds the dip is held            (>= 0).
 * release   seconds from end-of-hold to 1.0    (> 0).
 * out       scratch object reused across calls (hot path: zero allocation).
 *             gets { v0, t1, holdT, end, relStart, dip }
 * returns out.
 */
export function planDuck(st, when, dip, attack, hold, release, out) {
  let v0 = 1;
  let end = when + attack + hold + release;
  let holdSeg = hold;
  if (st && when < st.end) {
    // overlapping the previous envelope — start from its exact value there
    v0 = duckValueAt(st, when);
    if (end > st.end) {
      // the previous envelope's pending ramp-to-1 (already on the AudioParam
      // timeline) completes at st.end and cannot be re-scheduled without
      // cancel — it caps the new recovery.
      end = st.end;
      if (when + attack + hold >= end) holdSeg = 0; // hold segment would fight the capped release
    }
  }
  out.dip = dip;
  out.v0 = v0 < 0 ? 0 : (v0 > 1 ? 1 : v0);
  out.t1 = when + attack;
  out.holdT = holdSeg > 0 ? out.t1 + holdSeg : -1; // -1 = no hold event
  out.end = end;
  out.relStart = out.holdT >= 0 ? out.holdT : out.t1;
  return out;
}

/* nextState — derive the follow-up state from a plan (written into `out2`). */
export function nextState(plan, when, attack, out2) {
  out2.t0 = when;
  out2.dip = plan.dip;
  out2.attack = attack;
  out2.release = Math.max(plan.end - plan.relStart, 1e-4);
  out2.end = plan.end;
  return out2;
}

/* duckValueAt — exact value of a planned envelope at time t (seconds). */
export function duckValueAt(st, t) {
  if (!(t < st.end)) return 1;
  const t1 = st.t0 + st.attack;
  const t2 = st.end - st.release; // start of the recovery ramp
  if (t <= st.t0) return 1;
  if (t < t1) return 1 + (st.dip - 1) * ((t - st.t0) / Math.max(st.attack, 1e-6));
  if (t < t2) return st.dip;
  return st.dip + (1 - st.dip) * ((t - t2) / Math.max(st.release, 1e-6));
}

/* duckParams — normalized per-track sidechain parameters (seconds).
 * Mirrors the project fields scAmount / scAttackMs / scHoldMs / scReleaseMs
 * (absent → defaults: 0 / 12 / 0 / 140). amount <= 0 means "never duck". */
export function duckParams(track) {
  const amount = track && track.scAmount != null ? track.scAmount : 0;
  if (amount <= 0) return null;
  return {
    amount: amount > 100 ? 100 : amount,
    attack: Math.max(track.scAttackMs != null ? track.scAttackMs : 12, 1) / 1000,
    hold: Math.max(track.scHoldMs != null ? track.scHoldMs : 0, 0) / 1000,
    release: Math.max(track.scReleaseMs != null ? track.scReleaseMs : 140, 5) / 1000,
  };
}

/* DEFAULT_SC — canonical backfill for projects saved before sidechain existed. */
export const DEFAULT_SC = { scAmount: 0, scAttackMs: 12, scHoldMs: 0, scReleaseMs: 140 };
