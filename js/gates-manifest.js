/* ── PSY6 GATES MANIFEST — the single source of truth (v0.26.0) ──────────
   Roast fix #3/#9 (docs/ENGINEERING-ROAST.md): the MAIN Self-Gate suite used
   to be hand-listed in tools/e2e.mjs AND asserted by js/ui/tests.js at
   runtime AND described by a hardcoded count in the boot copy ("19 checks" —
   stale for six releases). Three copies of one truth, reconciled only by a
   nine-minute CI run.

   Now: THIS module is the manifest.
   - tools/e2e.mjs imports MAIN_GATE_IDS as its EXPECTED list.
   - js/main.js renders MAIN_GATE_COUNT in the boot copy.
   - tests/gates-manifest.test.ts statically reconciles this list against the
     gate() ids js/ui/tests.js actually registers (red in ~20 s, not 9 min).
   - REALTIME_EVIDENCE_IDS (G17 live capture, G25 record-song) run on-device
     as evidence only — explicitly NOT CI-asserted (documented subset
     boundary; both are wall-clock-dependent).

   EDIT HERE. Never in the copies. */
export const G1_STYLES = ['TECHNO', 'PSYTRANCE', 'TRANCE', 'PROGRESSIVE'];

export const MAIN_GATE_IDS = [
  ...G1_STYLES.map((s) => 'G1-' + s),
  'G2', 'G5', 'G6', 'G8', 'G9', 'G10', 'G11', 'G12', 'G13', 'G14',
  'G15', 'G16', 'G18', 'G19', 'G21', 'G22', 'G23', 'G24', 'G26', 'G27',
  'G28', 'G29', 'G30', 'G31', 'G32', 'G33', 'G34', 'G35', 'G36', 'G37',
  'G38', 'G39', 'G40', 'G41', 'G42', 'G43', 'G44', 'G45', 'G46', 'G47',
  'G48', 'G49', 'G50', 'G51', 'G52',
];

/* 49 ids — v0.26.0 added G52 (reason liveness, v0.23.0): it was registered
   in js/ui/tests.js but silently missing from the hand-typed e2e list — the
   roast's own #9 found its live specimen three releases in. */
export const MAIN_GATE_COUNT = MAIN_GATE_IDS.length;

export const REALTIME_EVIDENCE_IDS = ['G17', 'G25'];
