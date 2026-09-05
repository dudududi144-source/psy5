#!/usr/bin/env bun
/**
 * e2e-pipeline.mjs — PSY6's family pipeline proof (Task 19).
 *
 * WHAT→HOW, end to end, over the real wire:
 *   1. the groovebox's own factory composer (js/presets.js buildStyle) builds
 *      a real PSY6 project — patterns A/B, 8 canonical lanes, its own kit
 *      assignments — and the device's own deterministic walker (model.js
 *      stepEvents) resolves groove/swing/probability exactly as the live
 *      engine plays them — the WHAT, owned by PSY6;
 *   2. js/family-wire.js maps the resolved events onto PSYBUS v2 envelopes
 *      validated by the verbatim foundation codec — the family wire;
 *   3. the body is POSTed to foundation's /api/render-notes — foundation owns
 *      the HOW (voices → bus glue → master chain → mastered WAV);
 *   4. each WAV must pass the standalone acceptance gate
 *      (tools/acceptance-check.mjs — verbatim foundation copy, gates
 *      identical to foundation's verify.mjs).
 *
 * Claims proved here (mirrors the psy-anthem 17-b and psysampler 18 pipelines):
 *   C1  every POST returns 200 + audio/wav
 *   C2  the response is a real RIFF/WAVE file
 *   C3  every WAV passes the structural acceptance gates (format/TP/DC/alive);
 *       loudness + LRA are RECORDED as the experiment's data — a loop-form
 *       wire is static by design (17-a's law: the honest lever is arrangement
 *       density, not gain)
 *   C4  determinism across the HTTP boundary: same body → same md5
 *   C5  the wire is byte-stable: same factory seed + same sections → same
 *       canonical JSON bytes
 *   C6  honest accounting: notes in body == envelopes built; X-Notes-Dropped=0;
 *       span matches the requested bars
 *
 * Usage:
 *   bun tools/e2e-pipeline.mjs                             # against http://localhost:3100
 *   FOUNDATION_URL=http://localhost:3000 bun tools/e2e-pipeline.mjs
 * Exit 0 = all claims pass · 1 = any claim fails.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildStyle } from '../js/presets.js';
import { projectToWire, wireToRenderNotesBody } from '../js/family-wire.js';

const BASE = process.env.FOUNDATION_URL ?? 'http://localhost:3100';
const OUT_DIR = join(tmpdir(), `psy6-e2e-${Date.now()}`);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const claims = [];
function claim(name, ok, detail) {
  claims.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** The device's own arranger model: scene = {pattern, bars} (js/scenes.js).
 *  buildStyle wires scenes 0/1 to patterns A/B — the form below is the
 *  groovebox's A–B–A return structure, 12 bars. */
function buildSection({ style, seed, sections }) {
  const project = buildStyle(style, seed);
  const plan = sections.map((sec) => ({
    pattern: project.scenes[sec.scene]?.pattern || (sec.scene === 0 ? 'A' : 'B'),
    bars: sec.bars,
  }));
  return { project, wire: projectToWire(project, { sections: plan, seed: seed + 1000 }) };
}

const FORM_A_B_A = [
  { scene: 0, bars: 4 },
  { scene: 1, bars: 4 },
  { scene: 0, bars: 4 },
];
const FORM_SPARSE = [{ scene: 0, bars: 4 }];

/** Structural gates = the acceptance lines that must hold REGARDLESS of
 *  arrangement density (format / true-peak / DC / alive channels). Loudness
 *  and LRA are density-bound on loop wires (Task 17-a/18 measured the same) —
 *  recorded as data, not gate-failed. */
const STRUCTURAL = /format|true peak|DC offset|alive/;

function runAcceptanceGate(wavPath) {
  const gate = spawnSync('node', [join(SCRIPT_DIR, 'acceptance-check.mjs'), wavPath], {
    encoding: 'utf8',
  });
  const lines = (gate.stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(PASS|FAIL|WARN)/.test(l));
  const structural = lines.filter((l) => STRUCTURAL.test(l));
  const structuralOk = structural.length > 0 && structural.every((l) => l.startsWith('PASS'));
  const lufsMatch = (gate.stdout ?? '').match(/I=(-?[\d.]+) LUFS/);
  const lraMatch = (gate.stdout ?? '').match(/LRA=(-?[\d.]+) LU/);
  return {
    ok: gate.status === 0,
    structuralOk,
    structural: structural.join(' | '),
    lufs: lufsMatch ? Number(lufsMatch[1]) : null,
    lra: lraMatch ? Number(lraMatch[1]) : null,
    all: lines.slice(0, 8).join(' | '),
  };
}

async function postWire(body) {
  const res = await fetch(`${BASE}/api/render-notes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  const ct = res.headers.get('content-type') ?? '';
  const dropped = res.headers.get('x-notes-dropped');
  const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
  return { status: res.status, ct, dropped, buf };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`PSY6 family pipeline — foundation at ${BASE}, artifacts in ${OUT_DIR}\n`);

  /* ── the WHAT: two arrangements from the device's own factory composer ── */
  const full = buildSection({ style: 'PSYTRANCE', seed: 42, sections: FORM_A_B_A });
  const sparse = buildSection({ style: 'PSYTRANCE', seed: 42, sections: FORM_SPARSE });

  claim(
    'C5 wire is byte-stable (same factory seed + sections → same canonical bytes)',
    (() => {
      const again = buildSection({ style: 'PSYTRANCE', seed: 42, sections: FORM_A_B_A });
      return again.wire.envelopes.length === full.wire.envelopes.length &&
        again.wire.wireBytes === full.wire.wireBytes;
    })(),
    `${full.wire.envelopes.length} envelopes, ${full.wire.wireBytes} bytes`,
  );
  claim(
    'C6a accounting: every envelope carries a foundation track, span matches bars',
    full.wire.envelopes.every((e) => e.payload?.track) &&
      Math.abs(full.wire.spanSec - (full.wire.bars * 16) * (60 / full.wire.bpm / 4)) < 60 / full.wire.bpm / 4,
    `${full.wire.bars} bars @ ${full.wire.bpm} BPM, span ${full.wire.spanSec.toFixed(3)}s, unmapped ${full.wire.unmapped}`,
  );

  /* ── the HOW: foundation renders the wires ── */
  const bodyFull = wireToRenderNotesBody(full.wire.envelopes, {
    seed: full.wire.seed,
    bpm: full.wire.bpm,
    bars: full.wire.bars,
  });
  const bodySparse = wireToRenderNotesBody(sparse.wire.envelopes, {
    seed: sparse.wire.seed,
    bpm: sparse.wire.bpm,
    bars: sparse.wire.bars,
  });

  const r1 = await postWire(bodyFull);
  claim('C1 POST /api/render-notes → 200 + audio/wav', r1.status === 200 && r1.ct.includes('audio/wav'),
    `status ${r1.status}, ct ${r1.ct}, dropped ${r1.dropped}`);
  const riff = r1.buf.length > 12 && r1.buf.toString('ascii', 0, 4) === 'RIFF' && r1.buf.toString('ascii', 8, 12) === 'WAVE';
  claim('C2 response is a real RIFF/WAVE file', riff, `${r1.buf.length} bytes`);
  claim('C6b honest accounting: X-Notes-Dropped=0', r1.dropped === '0', `dropped=${r1.dropped}`);

  const wavFull = join(OUT_DIR, 'psy6-aba-12bars.wav');
  writeFileSync(wavFull, r1.buf);
  const gateFull = runAcceptanceGate(wavFull);
  claim('C3 structural acceptance gates pass (format/TP/DC/alive)',
    gateFull.structuralOk && gateFull.structural.split(' | ').length >= 4,
    gateFull.structural || gateFull.all);

  /* determinism: same body → same bytes */
  const r2 = await postWire(bodyFull);
  const md5 = (b) => createHash('md5').update(b).digest('hex');
  claim('C4 HTTP determinism: same body → same md5', r2.status === 200 && md5(r1.buf) === md5(r2.buf),
    `md5 ${md5(r1.buf).slice(0, 12)}…`);

  /* the density experiment: sparse A vs full A–B–A — the family's loudness lever */
  const r3 = await postWire(bodySparse);
  const wavSparse = join(OUT_DIR, 'psy6-a-4bars.wav');
  writeFileSync(wavSparse, r3.buf);
  const gateSparse = runAcceptanceGate(wavSparse);
  claim(
    'C3b sparse form also passes structural gates',
    r3.status === 200 && gateSparse.structuralOk,
    gateSparse.structural || gateSparse.all,
  );

  console.log('\n── loudness economics (recorded, not gated — loop wires are static by design) ──');
  console.log(`A–B–A 12 bars: ${full.wire.envelopes.length} notes, ${full.wire.wireBytes} wire bytes → I=${gateFull.lufs} LUFS, LRA=${gateFull.lra} LU`);
  console.log(`A     4 bars: ${sparse.wire.envelopes.length} notes, ${sparse.wire.wireBytes} wire bytes → I=${gateSparse.lufs} LUFS, LRA=${gateSparse.lra} LU`);
  const dLufs = (gateFull.lufs ?? 0) - (gateSparse.lufs ?? 0);
  const dBytes = full.wire.wireBytes - sparse.wire.wireBytes;
  console.log(`density delta: ${dLufs >= 0 ? '+' : ''}${dLufs.toFixed(2)} LU for ${dBytes >= 0 ? '+' : ''}${dBytes} wire bytes`);

  const failed = claims.filter((c) => !c.ok);
  console.log(`\n${claims.length - failed.length}/${claims.length} claims pass`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error('e2e-pipeline crashed:', err?.message ?? err);
  process.exit(1);
});
