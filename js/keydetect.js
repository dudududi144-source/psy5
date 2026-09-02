/* ── v0.11.0 P4: KEY DETECTION — deterministic chroma + Krumhansl-Schmuckler ──
   Pure math, no deps, no rng, no time: the same PCM always yields the same
   key. Chroma = direct DFT energy at the 12 pitch-class fundamentals (C4 =
   261.63 Hz base, equal temperament) over the sample's MID section (frames
   [25%, 75%), capped at 4 s for cost — the middle of a sample carries its
   tonal identity; attacks/transients at the edges do not). The chroma
   vector is correlated (Pearson r) against the 12 rotated K-S major and 12
   rotated K-S minor profiles; the best rotation names the key.
   HONEST LIMITATION (documented): fundamentals-only means the scanned
   register is C4..B4 — content pitched FAR outside that register (a sub
   bass at A1, a lead two octaves up) still keys correctly THROUGH its
   harmonic content only if energy lands in the scanned band; pure sine
   content far off-register keys to leakage noise. The tuneToRoot
   correction is exact regardless (it maps pitch CLASSES). */
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const KEY_WINDOW_MAX_SEC = 4;

/* chromaProfile — 12 raw DFT magnitudes (fundamental of each pitch class).
 * Deterministic: fixed window, closed-form DFT bins. */
export function chromaProfile(pcm, sampleRate) {
  const d = (Array.isArray(pcm) ? pcm[0] : pcm) || new Float32Array(0);
  const n = d.length;
  const out = new Float64Array(12);
  if (!n) return { chroma: out, windowFrames: 0 };
  let a = Math.floor(n * 0.25);
  const b0 = Math.ceil(n * 0.75);
  let win = Math.min(b0 - a, Math.round(KEY_WINDOW_MAX_SEC * sampleRate));
  if (win < 64) { a = 0; win = Math.min(n, 64) }
  const N = win;
  for (let pc = 0; pc < 12; pc++) {
    const f = 261.6255653 * Math.pow(2, pc / 12);
    const w = 2 * Math.PI * f / sampleRate;
    let re = 0, im = 0;
    for (let i = 0; i < N; i++) {
      const v = d[a + i], ph = w * i;
      re += v * Math.cos(ph);
      im -= v * Math.sin(ph);
    }
    out[pc] = Math.sqrt(re * re + im * im) / N;
  }
  return { chroma: out, windowFrames: N };
}

function pearson(x, y) {
  const n = x.length;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i] }
  const mx = sx / n, my = sy / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy }
  const den = Math.sqrt(sxx * syy);
  return den > 0 ? sxy / den : 0;
}

/* detectKey — {tonicPc 0..11 (C..B), mode 'major'|'minor', r, name,
 * chroma}. Ties break toward the lower pc / major (deterministic scan
 * order); r is the winning K-S Pearson correlation. */
export function detectKey(pcm, sampleRate) {
  const { chroma } = chromaProfile(pcm, sampleRate);
  const arr = Array.from(chroma);
  let best = null;
  for (let mode = 0; mode < 2; mode++) {
    const prof = mode === 0 ? KS_MAJOR : KS_MINOR;
    for (let ton = 0; ton < 12; ton++) {
      const rotated = [];
      for (let i = 0; i < 12; i++) rotated.push(prof[(i - ton + 12) % 12]);
      const r = pearson(arr, rotated);
      if (!best || r > best.r + 1e-12) best = { tonicPc: ton, mode: mode === 0 ? 'major' : 'minor', r, chroma: arr };
    }
  }
  best.name = PC_NAMES[best.tonicPc] + (best.mode === 'minor' ? 'm' : '');
  return best;
}

/* tuneToRoot — semitone shift that maps the sample's tonic onto the project
 * root pitch class. RESOLUTION (documented): the mandate's literal
 * (rootPc − samplePc) mod 12 yields 0..11 (up to +11 st); the minimal
 * signed equivalent ((d>6) ? d−12 : d) maps to −5..+6 — the same pitch
 * class destination with the smallest voice-leading move. Both satisfy
 * "sample pitch class == project root"; we ship the minimal one. */
export function tuneToRoot(tonicPc, projectRootMidi) {
  const rootPc = ((projectRootMidi % 12) + 12) % 12;
  let d = ((rootPc - tonicPc) % 12 + 12) % 12;
  if (d > 6) d -= 12;
  return d;
}

export { PC_NAMES, KS_MAJOR, KS_MINOR };
