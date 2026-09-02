/* ============ SONG LIBRARY UI (v0.9.0 P3) — the album drawer ============
   Rows: name (click = inline rename) · style · seed · length · composerMeta
   badge (BPM/progression) · LOAD · ▶ active badge during PLAY SONG · ✕.
   Buttons: + ADD CURRENT (recipe recovery; free-form → honest toast),
   COMPOSE NEW (opens the header composer flagged library-target — the
   album survives via stash/restore; the plain header COMPOSE does NOT
   carry the album, documented).
   LOAD re-renders the recipe with compose() and loadProjectObj's the
   result — the ALBUM is stashed before and restored after (the Run 15
   51ce434 fix: albums survive LOAD and library-target COMPOSE NEW).
   Confirm-if-dirty protects unsaved edits. */
import { $, I, toast, pushHist, loadProjectObj } from '../state.js';
import { libraryOf, libraryAdd, libraryRemove, libraryRename, librarySetActive, composeRecipe, recipeFromProject, libraryValid } from '../library.js';
import { arrToggle } from '../arranger.js';
import { applyComposerSampleHints } from './samples.js';

function landOnPerform() {
  const btn = Array.from(document.querySelectorAll('nav button')).find(x => x.dataset.t === 'perform');
  if (btn) btn.click();
}

function renderLibrary() {
  const body = $('libBody');
  if (!body || !I.p) return;
  const lib = libraryOf(I.p);
  if (!lib || !lib.songs.length) {
    body.innerHTML = '<div class="note">Album is empty — ADD CURRENT stores this project\'s recipe, COMPOSE NEW renders a fresh song into it.</div>';
    return;
  }
  let html = '';
  lib.songs.forEach(s => {
    const active = lib.activeSongId === s.id;
    const playing = active && I.p.arranger && I.p.arranger.on && I.sched.on;
    html += '<div style="display:flex;gap:4px;align-items:center;margin:3px 0;flex-wrap:wrap">'
      + '<span class="dot" style="width:8px;height:8px;border-radius:50%;display:inline-block;background:' + (active ? 'var(--acc,#4fd6c0)' : '#555') + '"></span>'
      + '<span class="mono libNm" style="font-size:10px;min-width:0;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text" title="' + s.name + ' (double-click to rename)">' + s.name + '</span>'
      + '<span class="mono" style="font-size:9px;color:var(--dim)">' + s.style + ' · ' + s.seed + ' · ' + s.len + 'm' + (s.composerMeta && s.composerMeta.bpm ? ' · ' + s.composerMeta.bpm + ' BPM' : '') + (s.composerMeta && s.composerMeta.progression ? ' · ' + s.composerMeta.progression : '') + '</span>'
      + (playing ? '<span class="tag">▶ playing</span>' : (active ? '<span class="tag">active</span>' : ''))
      + '<button class="libLoad" data-id="' + s.id + '" title="LOAD — re-render this recipe in memory (confirm when the current project has unsaved edits); the album stays">LOAD</button>'
      + '<button class="libDel" data-id="' + s.id + '" title="remove this song from the album">✕</button>'
      + '</div>';
  });
  body.innerHTML = html;
  body.querySelectorAll('.libLoad').forEach(b => {
    b.onclick = function () {
      const id = this.dataset.id;
      const lib2 = libraryOf(I.p);
      if (!lib2 || !lib2.songs.some(s => s.id === id)) return;
      if (I.dirty && !confirm('LOAD replaces the current in-memory project (your edits are NOT saved).\nThe album itself is safe — it travels with the loaded song.\nContinue?')) return;
      const rec = lib2.songs.find(s => s.id === id);
      const r = composeRecipe(rec);
      const stash = I.p.library; /* album continuity (51ce434) */
      loadProjectObj(r.project);
      I.p.library = stash; /* restore the album — recipes survive LOAD */
      applyComposerSampleHints(r); /* v0.10.0: resolve sample hints at recipe render */
      librarySetActive(I.p, id);
      I.renderDirty = true;
      renderLibrary();
      try { arrToggle(true) } catch (e) { /* already on */ }
      landOnPerform();
      toast('LOADED ✓ ' + rec.name + ' — album carried (' + (stash ? stash.songs.length : 0) + ' songs)');
    };
  });
  body.querySelectorAll('.libDel').forEach(b => {
    b.onclick = function () {
      const id = this.dataset.id;
      const s = libraryOf(I.p) && libraryOf(I.p).songs.find(x => x.id === id);
      if (s && !confirm('DELETE "' + s.name + '" from the album?')) return;
      pushHist();
      libraryRemove(I.p, id);
      I.dirty = true;
      I.renderDirty = true;
      renderLibrary();
    };
  });
  body.querySelectorAll('.libNm').forEach(el => {
    el.ondblclick = function () {
      const id = this.parentElement.querySelector('.libLoad').dataset.id;
      const nm = prompt('RENAME song', this.textContent);
      if (nm != null) { pushHist(); libraryRename(I.p, id, nm); I.dirty = true; I.renderDirty = true; renderLibrary() }
    };
  });
}

function wireLibrary() {
  const bAdd = $('bLibAdd');
  if (bAdd) bAdd.onclick = function () {
    if (!I.p) return;
    const rec = recipeFromProject(I.p);
    if (!rec) { toast('ADD CURRENT: recipe unavailable — this is a free-form project (no composer recipe to store)'); return; }
    pushHist();
    const s = libraryAdd(I.p, rec);
    I.dirty = true;
    I.renderDirty = true;
    renderLibrary();
    if (s) toast('ADDED ✓ ' + s.name + ' — the album holds ' + libraryOf(I.p).songs.length + ' song(s)');
  };
  const bNew = $('bLibNew');
  if (bNew) bNew.onclick = function () {
    I.libComposeTarget = true; /* the composer modal will stash/restore the album */
    const m = $('composeModal');
    if (m) { m.style.display = 'flex'; const e = new Event('change'); const sel = $('cmpStyle'); if (sel) sel.dispatchEvent(e) }
    else toast('COMPOSE NEW needs the composer modal (not in this build)');
  };
  renderLibrary();
}

export { renderLibrary, wireLibrary };
