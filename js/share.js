/* PSY6 share links (v0.4.0): project → canonical JSON → deflate-raw →
   base64url → location.hash (#p=<token>).

   Determinism: canonicalProject() pins key ordering (sorted, arrays keep
   order), so the same project serializes byte-identically; deflate-raw is
   deterministic for a given input in a given runtime → the same project
   yields a byte-identical link. No Date.now / Math.random anywhere here.

   Size guards: compressed token > 6 KB → warn (Chrome URL limits);
   > ~50 KB → hard error. If CompressionStream is unavailable the caller is
   told to fall back to file EXPORT — never a silently degraded link.

   Consent: sharing NEVER auto-loads. The power screen shows a banner with
   LOAD SHARE / DISMISS; parsing helpers here are DOM-free (Bun-testable). */
const SHARE_WARN_BYTES = 6144;  /* > 6 KB compressed token → warn */
/* v0.8.0: 51200 → 65536. The composer's snapshot-bearing projects (scene.mix
   payloads, ~+7% raw) crossed the old cap after base64url expansion
   (38.7 KB deflate → 51,636 b64 chars) — a share of the device's OWN
   composed output is a first-class flow, so the hard cap moves to 64 KB.
   Still conservative: browser address bars handle ≥ 100 KB URLs. */
const SHARE_MAX_BYTES = 65536;  /* ~ 64 KB compressed token → hard error */

/* canonical JSON: every object's keys are sorted (arrays keep their order —
   step order is musical meaning). Two structurally equal projects produce
   the identical string regardless of key insertion order. */
function canonicalProject(p) {
  return JSON.stringify(p, function (k, v) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = {};
      for (const kk of Object.keys(v).sort()) o[kk] = v[kk];
      return o;
    }
    return v;
  });
}

function b64urlEncode(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

async function encodeShare(p) {
  const json = canonicalProject(p);
  const bytes = new TextEncoder().encode(json);
  if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') {
    return { ok: false, reason: 'no-compression', jsonBytes: bytes.length };
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const comp = new Uint8Array(await new Response(stream).arrayBuffer());
  const token = b64urlEncode(comp);
  if (token.length > SHARE_MAX_BYTES) {
    return { ok: false, reason: 'too-large', jsonBytes: bytes.length, tokenBytes: token.length };
  }
  return { ok: true, token, jsonBytes: bytes.length, tokenBytes: token.length, warn: token.length > SHARE_WARN_BYTES };
}

async function decodeShare(token) {
  const u8 = b64urlDecode(token);
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const raw = await new Response(stream).arrayBuffer();
  const json = new TextDecoder().decode(raw);
  const project = JSON.parse(json);
  if (!project || project.version !== 3 || !project.tracks) throw new Error('not a psy6 project');
  return { ok: true, project, jsonBytes: raw.length };
}

/* parse '#p=<token>' → token, or null (also used to detect non-share hashes) */
function parseShareHash(hash) {
  if (!hash || hash.charAt(0) !== '#') return null;
  const m = hash.match(/^#p=([A-Za-z0-9_-]+)$/);
  return m ? m[1] : null;
}

export { canonicalProject, encodeShare, decodeShare, parseShareHash, SHARE_WARN_BYTES, SHARE_MAX_BYTES };
