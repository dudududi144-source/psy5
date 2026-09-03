/* ============ SONG LIBRARY (v0.9.0 P3) — multi-song projects ============
   An ALBUM of composer RECIPES riding inside the project:

     p.library = null (legacy projects — the field stays ABSENT until the
                       user or a load materializes it)
               | { songs: [{ id, name, style, seed, len, composerMeta }],
                   activeSongId: id | null }

   RECIPES, NOT SNAPSHOTS: a song entry stores (style, seed, len) — the
   compose() inputs — and rendering it means compose(style, len, seed) in
   memory. The library never duplicates pattern data: songs cost ~100 bytes
   each, stay byte-reproducible forever, and the current free-form project
   remains fully editable independently of what the album holds.

   Album continuity (the Run-15 51ce434 contract): recipes survive LOAD and
   library-target COMPOSE NEW via stash/restore in the UI glue (ui/
   library.js) — the album travels with the session. The plain header
   COMPOSE deliberately starts fresh (documented behavior).

   Determinism: ids derive from fnv(projectSeed-style-seed-len-seq) — no
   Math.random, no Date.now. The whole module is DOM-free (bun-tested). */
import { compose, COMPOSER_STYLES, COMPOSER_LENGTHS } from './composer.js';
import { fnv, SCALES } from './model.js';
import { songDurationSec } from './bounce.js';

/* libraryOf — the project's library or null (absent/invalid → null; never
 * materializes anything: legacy projects read as library-less). */
export function libraryOf(p) {
  return (p && p.library && p.library.songs && Array.isArray(p.library.songs)) ? p.library : null;
}

/* libraryEnsure — materialize the canonical empty library (mutates p — call
 * only on real user intent, never in a read path). */
export function libraryEnsure(p) {
  if (!libraryOf(p)) p.library = { songs: [], activeSongId: null };
  if (p.library.activeSongId === undefined) p.library.activeSongId = null;
  return p.library;
}

/* canonicalSong — the exact persisted record shape (loadProjectObj rebuilds
 * through this; keep the field order canonical for load→save stability). */
function canonicalSong(s) {
  return {
    id: String(s.id),
    name: String(s.name == null || s.name === '' ? 'UNTITLED' : s.name).slice(0, 32),
    style: COMPOSER_STYLES[s.style] ? s.style : null,
    seed: (typeof s.seed === 'number' && isFinite(s.seed)) ? s.seed : (String(s.seed == null ? '' : s.seed).slice(0, 24)),
    len: COMPOSER_LENGTHS.includes(s.len) ? s.len : null,
    composerMeta: (s.composerMeta && typeof s.composerMeta === 'object' && !Array.isArray(s.composerMeta))
      ? { bpm: Number(s.composerMeta.bpm) || null, progression: s.composerMeta.progression != null ? String(s.composerMeta.progression).slice(0, 40) : null }
      : { bpm: null, progression: null },
  };
}

/* libraryAdd — append a recipe; returns the record (or null when the recipe
 * is invalid). Ids are content-derived fnv hashes kept unique by iteration
 * — deterministic across machines and session orders. */
export function libraryAdd(p, rec) {
  if (!rec || !COMPOSER_STYLES[rec.style]) return null;
  if (!(typeof rec.seed === 'number' || (typeof rec.seed === 'string' && rec.seed.length))) return null;
  if (!COMPOSER_LENGTHS.includes(rec.len)) return null;
  const lib = libraryEnsure(p);
  let id = 'L' + fnv(String(rec.style) + ':' + String(rec.seed) + ':' + String(rec.len) + ':' + lib.songs.length).slice(0, 10);
  while (lib.songs.some(s => s.id === id)) id = 'L' + fnv(id + '+').slice(0, 10);
  const song = canonicalSong({
    id,
    name: rec.name,
    style: rec.style,
    seed: rec.seed,
    len: rec.len,
    composerMeta: { bpm: COMPOSER_STYLES[rec.style].bpm, progression: null },
  });
  lib.songs.push(song);
  if (!lib.activeSongId) lib.activeSongId = song.id;
  return song;
}

/* libraryRemove — drop by id; clears the active pointer when needed. */
export function libraryRemove(p, id) {
  const lib = libraryOf(p);
  if (!lib) return false;
  const i = lib.songs.findIndex(s => s.id === id);
  if (i < 0) return false;
  lib.songs.splice(i, 1);
  if (lib.activeSongId === id) lib.activeSongId = lib.songs.length ? lib.songs[0].id : null;
  return true;
}

/* libraryRename — trim + cap at 32 chars (canonicalSong's limit). */
export function libraryRename(p, id, name) {
  const lib = libraryOf(p);
  if (!lib) return false;
  const s = lib.songs.find(x => x.id === id);
  if (!s) return false;
  s.name = String(name == null ? '' : name).trim().slice(0, 32) || s.name;
  return true;
}

/* librarySetActive — point the active badge at a song (or null). */
export function librarySetActive(p, id) {
  const lib = libraryOf(p);
  if (!lib) return false;
  if (id != null && !lib.songs.some(s => s.id === id)) { lib.activeSongId = null; return false }
  lib.activeSongId = id == null ? null : id;
  return true;
}

/* composeRecipe — the ONLY rendering path for a library song: the pure
 * composer with the recipe's inputs. In-memory; the live project is not
 * touched here (the UI glue decides what to do with the result). */
export function composeRecipe(rec) {
  return compose(rec.style, rec.len, rec.seed);
}

/* recipeFromProject — recover the recipe of a COMPOSED project (the ADD
 * CURRENT path). Composed projects carry p.harmony.family (the style) and
 * p.seed = 'C<seed>' (the compose label); the length is recovered as the
 * nearest allowed composer length to the arrangement's music duration.
 * Free-form projects (built styles, user patterns, imported songs without
 * harmony) honestly yield null — "recipe unavailable" in the UI. */
export function recipeFromProject(p) {
  if (!p || !p.harmony || !COMPOSER_STYLES[p.harmony.family]) return null;
  if (typeof p.seed !== 'string' || p.seed.charAt(0) !== 'C' || p.seed.length < 2) return null;
  const raw = p.seed.slice(1);
  const seed = isNaN(+raw) ? raw : +raw;
  if (seed === '' || seed == null) return null;
  const musicMin = songDurationSec(p).music / 60;
  if (!(musicMin > 0)) return null;
  const len = COMPOSER_LENGTHS.reduce((a, b) => Math.abs(b - musicMin) < Math.abs(a - musicMin) ? b : a, COMPOSER_LENGTHS[0]);
  return { style: p.harmony.family, seed, len, name: p.harmony.family + ' ' + seed + ' · ' + len + 'm' };
}

/* ── READY ALBUM (v0.17.0) — the "ready to perform, not empty" boot: a
   composed project arrives with a PRESEEDED song library — the booted song
   first (active), then one pinned-seed recipe per composer style. Recipes
   cost ~100 bytes each, so the album rides for free. Pure + deterministic
   (pinned seeds, content-derived ids) — bun-tested. */
export const READY_SEEDS = {
  'FULL-ON': 424242, 'DARK-PSY': 90210, 'PROGRESSIVE': 74747, 'FOREST': 1337,
  'HI-TECH': 99999, 'PSYTRANCE': 5150, 'GOA': 1994, 'TECHNO': 80808, 'TRANCE': 31337,
};
export function readyAlbum(p, style, seed, len) {
  if (!p || !COMPOSER_STYLES[style]) return null;
  const cur = libraryAdd(p, { name: style + ' READY SET', style, seed, len });
  for (const s of Object.keys(COMPOSER_STYLES)) {
    if (s === style) continue;
    libraryAdd(p, { name: s + ' · SET', style: s, seed: READY_SEEDS[s] || 1234, len: 3 });
  }
  if (cur) librarySetActive(p, cur.id);
  return libraryOf(p);
}

/* libraryValid — structural integrity (ids unique, styles/lengths known,
 * no null styles after canonicalization). Non-throwing; used by gates. */
export function libraryValid(p) {
  const lib = libraryOf(p);
  if (!lib) return true; /* library-less is valid (legacy) */
  if (lib.activeSongId !== null && !lib.songs.some(s => s.id === lib.activeSongId)) return false;
  const ids = new Set();
  for (const s of lib.songs) {
    if (!s || typeof s.id !== 'string' || !s.id) return false;
    if (ids.has(s.id)) return false;
    ids.add(s.id);
    if (!COMPOSER_STYLES[s.style]) return false;
    if (!COMPOSER_LENGTHS.includes(s.len)) return false;
    if (typeof s.name !== 'string') return false;
  }
  return true;
}
