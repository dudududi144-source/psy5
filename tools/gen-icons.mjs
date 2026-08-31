#!/usr/bin/env node
/* PSY6 icon generator (Run 9 PWA) — deterministic, zero-dependency.
   Draws a 16-step sequencer motif (bar heights from mulberry32(0x9056)) in
   the device palette (--acc #ffb454 on --bg #0a0c0f, accent #4fd6c0) and
   encodes PNG (RGBA, filter 0) with node:zlib + a local CRC32 table.
   Same seed → byte-identical PNGs on every machine. Run: node tools/gen-icons.mjs */
import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}
function pngEncode(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; /* filter: none */
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const BG = [0x0a, 0x0c, 0x0f, 255];       /* --bg   */
  const PANEL = [0x14, 0x17, 0x1d, 255];    /* --panel*/
  const ACC = [0xff, 0xb4, 0x54, 255];      /* --acc  */
  const ACC2 = [0x4f, 0xd6, 0xc0, 255];     /* --acc2 */
  const LINE = [0x26, 0x2c, 0x38, 255];     /* --line */
  const set = (x, y, c) => { const o = (y * size + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = c[3]; };
  const rect = (x0, y0, x1, y1, c) => { for (let y = Math.max(0, y0); y <= Math.min(size - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(size - 1, x1); x++) set(x, y, c); };
  /* background + rounded frame */
  rect(0, 0, size - 1, size - 1, BG);
  const r = Math.round(size * 0.10);
  rect(0, 0, size - 1, r - 1, PANEL); rect(0, size - r, size - 1, size - 1, PANEL);
  rect(0, 0, r - 1, size - 1, PANEL); rect(size - r, 0, size - 1, size - 1, PANEL);
  rect(0, 0, size - 1, 0, LINE); rect(0, size - 1, size - 1, size - 1, LINE);
  rect(0, 0, 0, size - 1, LINE); rect(size - 1, 0, size - 1, size - 1, LINE);
  /* 16 sequencer steps — heights from the device's canonical PRNG */
  const rng = mulberry32(0x9056);
  const N = 16;
  const m = Math.round(size * 0.12);            /* margin */
  const gap = Math.round(size * 0.012);
  const cw = Math.floor((size - 2 * m - (N - 1) * gap) / N);
  const base = Math.round(size * 0.82);         /* baseline y */
  const maxH = Math.round(size * 0.52);
  for (let i = 0; i < N; i++) {
    const h = Math.round(maxH * (0.25 + 0.75 * rng()));
    const x0 = m + i * (cw + gap);
    const accent = (i % 4 === 0);               /* downbeat accent = --acc, others --acc2 */
    const c = accent ? ACC : ACC2;
    rect(x0, base - h, x0 + cw - 1, base, c);
    /* dim "playhead" cap on the step the seeded rng marks loud */
    if (h > maxH * 0.8) rect(x0, base - h - Math.round(size * 0.02), x0 + cw - 1, base - h - 1, ACC);
  }
  /* PSY6 wordmark bar (brand identity, no font needed): brand tick row */
  const wmY = Math.round(size * 0.90);
  rect(m, wmY, m + Math.round((size - 2 * m) * 0.34), wmY + Math.round(size * 0.015), ACC);
  return pngEncode(size, size, px);
}

for (const size of [192, 512]) {
  const png = drawIcon(size);
  const name = 'icon-' + size + '.png';
  writeFileSync(name, png);
  console.log('wrote ' + name + ' (' + png.length + ' bytes)');
}
