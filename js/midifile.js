/* ============ STANDARD MIDI FILE WRITER (v0.7.0) — pure, dependency-free ============
   writeMidi({ppq, bpm, tracks}) → Uint8Array. Format 1:
     track 0      — tempo meta (FF 51) + track name (FF 03) + EOT
     track 1..n   — one chunk per track: name meta + note on/off pairs + EOT
   Channels: the CALLER assigns (device convention: melodic tracks → channels
   1–8 (index 0–7), drums → channel 10 (index 9)). Notes {tick, durTicks,
   midi, vel}: tick/durTicks in PPQ ticks, midi 0–127, vel 0–1 → ×127.
   Event ordering: stable sort by tick; ties broken note-off BEFORE note-on
   (prevents stuck notes at boundaries), then by pitch, then by channel.
   VLQ delta times: standard 7-bit groups with continuation bits — multi-byte
   cases are unit-tested (deltas ≥ 128 / ≥ 16384). */

const TPQ_META = 0x51;   /* Set Tempo   */
const NAME_META = 0x03;  /* Track Name  */
const EOT_META = 0x2f;   /* End of Track */

function vlq(n) {
  /* variable-length quantity — MIDI delta-time encoding */
  let v = Math.max(0, Math.round(n)) | 0;
  const out = [v & 0x7f];
  v >>= 7;
  while (v > 0) { out.unshift(0x80 | (v & 0x7f)); v >>= 7 }
  return out;
}
function strBytes(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out.push(c < 128 ? c : 63) } /* ASCII-safe, '?' fallback */
  return out;
}
function chunk(id, payload) {
  const len = payload.length;
  return [...strBytes(id), (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, ...payload];
}
function meta(type, data) { return [0xff, type, ...vlq(data.length), ...data] }

export function writeMidi({ ppq, bpm, name, tracks }) {
  ppq = ppq || 480;
  const ntrks = 1 + tracks.length;
  /* header: MThd — format 1, ntrks, division */
  const head = chunk('MThd', [0, 1, (ntrks >> 8) & 0xff, ntrks & 0xff, (ppq >> 8) & 0xff, ppq & 0xff]);
  /* track 0: name + tempo + EOT (delta 0 throughout) */
  const mpqn = Math.round(60000000 / bpm);
  const t0 = [
    ...vlq(0), ...meta(NAME_META, strBytes(name || 'PSY6')),
    ...vlq(0), ...meta(TPQ_META, [(mpqn >> 16) & 0xff, (mpqn >> 8) & 0xff, mpqn & 0xff]),
    ...vlq(0), ...meta(EOT_META, []),
  ];
  const chunksOut = [head, chunk('MTrk', t0)];
  for (const tr of tracks) {
    /* collect raw events: on/off per note, ordered per the documented rule */
    const evs = [];
    for (const n of tr.notes) {
      const midi = Math.max(0, Math.min(127, Math.round(n.midi)));
      const vel = Math.max(1, Math.min(127, Math.round((n.vel == null ? 0.8 : n.vel) * 127)));
      evs.push({ tick: Math.max(0, Math.round(n.tick)), type: 1 /* on */, midi, vel });
      evs.push({ tick: Math.max(0, Math.round(n.tick + Math.max(1, n.durTicks == null ? 120 : n.durTicks))), type: 0 /* off */, midi, vel: 0 });
    }
    evs.sort((a, b) => a.tick - b.tick || a.type - b.type || a.midi - b.midi);
    const ch = Math.max(0, Math.min(15, tr.channel | 0));
    let last = 0;
    const payload = [...vlq(0), ...meta(NAME_META, strBytes(tr.name || ('CH' + (ch + 1))))];
    for (const e of evs) {
      payload.push(...vlq(e.tick - last), (e.type ? 0x90 : 0x80) | ch, e.midi, e.vel);
      last = e.tick;
    }
    payload.push(...vlq(0), ...meta(EOT_META, []));
    chunksOut.push(chunk('MTrk', payload));
  }
  let total = 0;
  for (const c of chunksOut) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunksOut) { out.set(c, o); o += c.length }
  return out;
}

/* writeVLQ — exported for the unit tests (multi-byte cases) */
export { vlq as writeVLQ };
