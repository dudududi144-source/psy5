/* ═══════════════════════════════════════════════════════════════════════
   PSY4KIT — the psy-foundation v2.0.0 kit adapter (v0.30.0 FOUNDATION RESET)

   OWNER MANDATE (instruction 20): "throw away ALL your sounds — connect ONLY
   with psy-foundation". The old kit stack (foundation/dsp/kit-reason.mjs +
   perc-rom.mjs + reason-engines.mjs — the conga/bongo/cowbell/clave ROM
   family and the reason synth voices) is GONE from the trigger path. Every
   drum/FX hit now renders through the psy4 voice classes ported from
   psy-foundation v2.0.0 @ edd1e5f (foundation/psy4/psy-voices.mjs —
   PsyKick/PsySnare/PsyHat/PsyShaker/PsyRiser/PsyImpact/PsyTexture, the
   PSY3-rule + commercial-audit-calibrated voice system).

   THE KIT VOCABULARY (the whole kit — nothing else exists):
     drums : kick · snare · clap · hatC · hatO · shaker
     fx    : riser · impact · texture · downlifter
   The membrane/metal junk family (conga bongo cowbell clave rim zap boom
   glitch darbuka tambourine triangle agogo timbale crash revcym) is DELETED
   — not deprecated, DELETED: presets, types, gates, glyphs.

   KIT = GENRE DNA. Six kits (same ids the project files already persist):
   each kit carries the foundation's voice-spec values with a NARROW,
   documented musical deviation set (kick fundamental/decay around the
   KICK_SPEC anchor 50 Hz/0.65 s — Phase D full-on standard — plus tone
   tilts), seeded deterministically per (kit, type, variant). Same seed →
   byte-identical PCM, forever (mulberry32/FNV-1a law, unchanged).

   LEVEL LAW: every render is peak-normalized to a per-type target table —
   the kit is level-coherent out of the box (kick owns the loudest peak,
   hats/shaker sit under it) — the role hierarchy the channel strip
   philosophy in foundation channel-presets.ts encodes as EQ/delay values.

   ROOT LAW: a kit declares its key-center fundamental (the same six roots
   kit-reason declared — E1/D1/A1/G#1/F1/G1). The project root transposes
   the PITCHED layers (kick sub+body) via rootMul; unpitched layers (snare
   noise, hats, shaker, FX) don't move. rootMul = clamp(rootHz/kitRootHz).
   ═══════════════════════════════════════════════════════════════════════ */

import {
        PsyKick, PsySnare, PsyHat, PsyShaker, PsyRiser, PsyImpact, PsyTexture,
} from '../foundation/psy4/psy-voices.mjs';
import { Rng } from '../foundation/psy4/prng.mjs';
import { KICK_SPEC, SNARE_SPEC } from '../foundation/psy4/voice-specs.mjs';

/* ── the kit vocabulary — the ONLY drum/FX types the engine knows ── */
export const PSY4_KIT_TYPES = new Set([
        'kick', 'snare', 'clap', 'hatC', 'hatO', 'shaker',
        'riser', 'impact', 'texture', 'downlifter',
]);

/* ── six kits, same ids as the legacy kit system (save-file compatible) ──
   kickFund/kickDecay cluster around KICK_SPEC (50 Hz / 0.65 s) — the
   deviations ARE the genre identity, kept narrow so every kit stays
   foundation-anchored. tilt = the highshelf tilt (dB at 3.2 kHz) the
   RomVoice path applies per preset `tone` — the kit default anchors it. */
const KITS = {
        'psy-classic': {
                name: 'Psy Classic', style: 'psytrance · full-on · goa · trance',
                blurb: 'The foundation spec verbatim — KICK_SPEC 50 Hz / 0.65 s, the Phase D full-on standard.',
                rootHz: 41.2, /* E1 — the classic full-on key center */
                kickFund: 50, kickDecay: 0.65, hatTone: 1.15, snareTone: 1.1, seed: 4242,
        },
        'dark-forest': {
                name: 'Dark Forest', style: 'darkpsy · forest',
                blurb: 'Deeper, longer sub — the forest floor at D1 with a darker hat tilt.',
                rootHz: 36.71, /* D1 — darker, lower center */
                kickFund: 46.5, kickDecay: 0.72, hatTone: 0.9, snareTone: 0.95, seed: 9021,
        },
        'progressive': {
                name: 'Progressive', style: 'progressive · techno',
                blurb: 'Softer punch, A1 center — the melodic groove kit.',
                rootHz: 55.0, /* A1 — melodic, groove-oriented center */
                kickFund: 48.5, kickDecay: 0.6, hatTone: 1.0, snareTone: 1.0, seed: 1337,
        },
        'hi-tech': {
                name: 'Hi-Tech', style: 'hi-tech',
                blurb: 'Tightest decay, G#1 center — the fast-terminal kit.',
                rootHz: 51.91, /* G#1 — the hi-tech center */
                kickFund: 52, kickDecay: 0.5, hatTone: 1.25, snareTone: 1.2, seed: 8080,
        },
        'forest-organic': {
                name: 'Forest Organic', style: 'forest',
                blurb: 'Longest sub breath at F1 — the organic forest center.',
                rootHz: 43.65, /* F1 — the organic forest center */
                kickFund: 46, kickDecay: 0.8, hatTone: 0.85, snareTone: 0.9, seed: 7331,
        },
        'tribal-raw': {
                name: 'Tribal Raw', style: 'tribal · raw grooves',
                blurb: 'G1 center, dry tilts — the raw floor kit.',
                rootHz: 49.0, /* G1 — the raw tribal center */
                kickFund: 48, kickDecay: 0.68, hatTone: 0.95, snareTone: 1.05, seed: 5150,
        },
};

export const KIT_IDS = Object.freeze(Object.keys(KITS));
export const DEFAULT_KIT = 'psy-classic';

/* style → kit — the SAME mapping law kit-reason declared (save files and
   composer calls keep working; the keys are the composer's style labels). */
const STYLE_KIT = {
        'full-on': 'psy-classic', 'darkpsy': 'dark-forest', 'dark-psy': 'dark-forest',
        'progressive': 'progressive', 'forest': 'forest-organic', 'hi-tech': 'hi-tech',
        'psytrance': 'psy-classic', 'goa': 'psy-classic', 'techno': 'progressive',
        'trance': 'psy-classic',
};
const STYLE_KIT_NORM = {};
for (const k of Object.keys(STYLE_KIT)) STYLE_KIT_NORM[k.toLowerCase().replace(/-/g, '')] = STYLE_KIT[k];
export function styleKit(styleId) {
        if (!styleId) return DEFAULT_KIT;
        const k = String(styleId).toLowerCase();
        return STYLE_KIT[k] || STYLE_KIT_NORM[k.replace(/-/g, '')] || DEFAULT_KIT;
}
export function kitMeta(kitId) {
        const kit = KITS[kitId];
        return kit ? { id: kitId, name: kit.name, style: kit.style, blurb: kit.blurb } : null;
}
export function isPsy4KitId(kitId) { return !!KITS[kitId]; }
/* kitRootHzOf — the kit's key-center fundamental (0 for an unknown kit) —
   the root law's denominator (engine.rootMul = rootHz / kitRootHzOf). */
export function kitRootHzOf(kitId) {
        const kit = KITS[kitId];
        return kit ? kit.rootHz : 0;
}
/* kitWarmTypes — the boot warm order (engine core first, then FX). */
const WARM_ORDER = ['kick', 'snare', 'clap', 'hatC', 'hatO', 'shaker', 'riser', 'impact', 'texture', 'downlifter'];
export function kitWarmTypes(kitId) { return isPsy4KitId(kitId) ? WARM_ORDER.slice() : []; }

/* ── LEVEL LAW — per-type peak targets (kit coherence out of the box) ──
   Kick owns the mix peak; hats/shaker sit clearly under; FX one-shots
   announce without shredding. (Derived from the foundation channel-strip
   role hierarchy: low end centered+dry, high-end groove supports.) */
const LEVEL_TARGET = {
        kick: 1.0, snare: 0.85, clap: 0.8, hatC: 0.55, hatO: 0.58, shaker: 0.45,
        riser: 0.7, impact: 0.9, texture: 0.45, downlifter: 0.7,
};

/* ── seeded helpers (FNV-1a → mulberry32 — the canonical psy6 law) ── */
function fnv1a(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(seed) { let a = seed >>> 0; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ ((t ^ (t >>> 14)) >>> 0); return (t ^ (t >>> 16)) / 4294967296; }; }

/* renderPsy4Pcm(type, sampleRate, {kitId, variant, rootMul}) → Float32Array
   Deterministic: Rng seeded fnv1a('psy4:'+kitId+':'+type+':'+variant);
   the foundation voices additionally seed their per-hit variation from the
   Rng instance — one Rng per render call → one variation draw per render. */
export function renderPsy4Pcm(type, sampleRate, opts) {
        const kit = KITS[(opts && opts.kitId) || DEFAULT_KIT] || KITS[DEFAULT_KIT];
        const variant = (opts && opts.variant) || 0;
        const rootMul = (opts && opts.rootMul) || 1;
        const rngSeed = fnv1a('psy4:' + kit.rootHz + ':' + type + ':' + variant);
        const rng = new Rng(rngSeed);
        const draw = (a, b) => a + rng.range(0, 1) * (b - a);
        const capSec = 2.5; /* render cap — every kit one-shot fits comfortably */
        const maxN = Math.round(capSec * sampleRate);
        let pcm = null;
        const render = (voice, until, hardMax) => {
                const out = new Float32Array(maxN);
                let n = 0;
                const hardN = hardMax ? Math.round(hardMax * sampleRate) : maxN;
                for (let i = 0; i < maxN; i++) {
                        const [s, done] = voice.render();
                        if (done && i > (until ? Math.round(until * sampleRate) : 64)) { n = i; break; }
                        out[i] = s; n = i + 1;
                        if (i >= hardN) { n = i + 1; break; } /* sustained voices: hard stop — the trim's fade closes the buffer */
                }
                return out.subarray(0, Math.max(n, 64));
        };
        if (type === 'kick') {
                /* KICK_SPEC anchor ± genre deviation. UPSTREAM TRUTH (verified in the
                   port): PsyKick reads its envelope from KICK_SPEC (single source of
                   truth) — the trigger `decay` argument is not referenced by render().
                   So the kit identity lives where the foundation allows it: the
                   fundamental (rootMul + kit anchor ± 3%) and the kit tilt — NOT a
                   fabricated decay knob. The trigger decay is passed anyway as the
                   documented kit anchor. */
                const v = new PsyKick(rng);
                const fund = Math.min(56, Math.max(40, kit.kickFund * rootMul * draw(0.97, 1.03)));
                const dec = kit.kickDecay * draw(0.94, 1.06);
                v.trigger(1.0, fund, dec);
                pcm = render(v, null, 0.85); /* spec envelope ends ≈ subDecay+0.05 s */
        } else if (type === 'snare') {
                const v = new PsySnare(rng);
                v.trigger(1.0);
                pcm = render(v, 0.22);
        } else if (type === 'clap') {
                /* CLAP — foundation-derived composite: four PsySnare bursts (the
                   classic 0/11/23/36 ms multi-burst) summed; the tail burst rides a
                   longer noise decay. Documented composite over foundation voices. */
                const out = new Float32Array(maxN);
                const offs = [0, 0.011, 0.023, 0.036];
                const amps = [0.9, 1.0, 0.95, 1.05];
                for (let b = 0; b < 4; b++) {
                        const bv = new PsySnare(new Rng(rngSeed + 101 + b));
                        bv.trigger(amps[b]);
                        const at = Math.round(offs[b] * sampleRate);
                        for (let i = 0; i < maxN - at; i++) {
                                const [s, done] = bv.render();
                                if (done) break;
                                out[at + i] += s * (b === 3 ? 1 : 0.8);
                        }
                }
                pcm = out;
        } else if (type === 'hatC' || type === 'hatO') {
                const v = new PsyHat(rng);
                v.trigger(1.0, type === 'hatO');
                pcm = render(v, type === 'hatO' ? 0.4 : 0.1);
        } else if (type === 'shaker') {
                const v = new PsyShaker(rng);
                v.trigger(1.0);
                pcm = render(v, 0.12);
        } else if (type === 'riser') {
                const v = new PsyRiser(rng);
                v.trigger(1.6, 1.0);
                pcm = render(v, 1.6);
        } else if (type === 'impact') {
                const v = new PsyImpact(rng);
                v.trigger(1.0);
                pcm = render(v, 1.6);
        } else if (type === 'texture') {
                const v = new PsyTexture(rng);
                v.trigger([220, 277.18, 329.63], 1.4, 1.0);
                pcm = render(v, 1.4, 1.6); /* sustained voice — hard stop + trim fade */
        } else if (type === 'downlifter') {
                /* the riser's mirror — the SAME PsyRiser render, reversed (deterministic
                   derivation; zero new DSP — the reversal is the downlifter). */
                const v = new PsyRiser(rng);
                v.trigger(1.4, 1.0);
                const fwd = render(v, 1.4);
                const out = new Float32Array(fwd.length);
                for (let i = 0, n = fwd.length; i < n; i++) out[i] = fwd[n - 1 - i];
                pcm = out;
        } else {
                return null; /* unknown type — caller counts a fallback, never lies */
        }
        /* CLOSE — every buffer ends at true zero: a 12 ms linear fade applied to
           the tail UNCONDITIONALLY (voices that stop mid-signal — the spec kick
           envelope's decayTotal cut, the sustained texture hard stop — would
           otherwise click), then the trailing-silence trim. */
        const fadeN = Math.min(pcm.length, Math.round(0.012 * sampleRate));
        for (let i = 0; i < fadeN; i++) pcm[pcm.length - 1 - i] *= i / fadeN;
        /* TRIM — cut the trailing silence (the composite clap + the sustained
           texture voice never raise `done` inside the cap; a tail of digital
           silence wastes ROM memory and pads the pool windows). */
        let last = -1;
        for (let i = 0; i < pcm.length; i++) if (Math.abs(pcm[i]) > 1e-4) last = i;
        if (last >= 0 && last < pcm.length - 1) {
                pcm = pcm.subarray(0, last + 1 + Math.round(0.005 * sampleRate));
        }
        /* LEVEL LAW — peak-normalize to the per-type target (documented table). */
        const target = LEVEL_TARGET[type] || 0.8;
        let peak = 0;
        for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > peak) peak = a; }
        if (peak > 1e-6) {
                const g = target / peak;
                for (let i = 0; i < pcm.length; i++) pcm[i] *= g;
        }
        return pcm;
}

/* kitLevelTarget — the level-law peak target for one type (evidence +
   gates read the law instead of guessing it). */
export function kitLevelTarget(type) { return LEVEL_TARGET[type] || 0; }

/* kitTiltDb(kitId, tone) — the RomVoice tilt anchor: the preset `tone`
   (0..~2, default 1) maps to a ±9 dB highshelf at 3.2 kHz around the kit's
   tilt bias (dark kits sit below, bright kits above). */
export function kitTiltBias(kitId) {
        const kit = KITS[kitId];
        if (!kit) return 0;
        return Math.round(Math.log2(kit.hatTone) * 6 * 10) / 10; /* ±octave-scaled dB */
}
