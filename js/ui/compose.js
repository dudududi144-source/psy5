/* ============ COMPOSER UI (v0.5.0) — power-screen row + header modal ============
   The composer itself is pure (js/composer.js). This module only:
   - collects style/length/seed,
   - protects non-empty projects (explicit confirm listing what is replaced),
   - loads the composed project into memory (keep = load; cancel = discard),
   - lands the user on the Perform tab with the arranger active.
   The seed field's INITIAL value uses Date.now (UI convenience only — the
   composition path itself is fully deterministic on the field's value). */
import { $, I, toast, loadProjectObj } from '../state.js';
import { compose, COMPOSER_STYLES, FORM_IDS } from '../composer.js';
import { styleKit, kitWarmTypes } from '../psy4kit.mjs';
import { arrToggle } from '../arranger.js';
import { applyComposerSampleHints } from './samples.js';
import { readyAlbum } from '../library.js'; /* v0.29.0: the pre-boot compose path enriches the album too (parity with composeBoot) */

function hasNotes(p) {
  if (!p) return false;
  return Object.values(p.patterns || {}).some(pat => Object.values(pat.data || {}).some(d => (d.steps || []).some(s => s.on)));
}
function readForm(styleSel, lenSel, seedInp, formSel) {
  const styleId = styleSel.value;
  const minutes = +lenSel.value;
  const seedRaw = (seedInp.value || '').trim();
  const seed = seedRaw === '' ? (Date.now() % 1000000) : (isNaN(+seedRaw) ? seedRaw : +seedRaw);
  const formId = (formSel && formSel.value) || undefined; /* '' = AUTO weighted chains */
  return { styleId, minutes, seed, formId };
}
function landOnPerform(form) {
  const btn = Array.from(document.querySelectorAll('nav button')).find(x => x.dataset.t === 'perform');
  if (btn) btn.click();
  try { arrToggle(true) } catch (e) { /* already on */ }
  if (!I.sched.on) { const bp = $('bPlay'); if (bp) bp.click() }
  toast('COMPOSED ✓ ' + form.style + ' · ' + form.totalBars + ' bars · ' + form.lengthSec.toFixed(0) + 's · seed ' + form.seed);
}
function updateInfo() {
  const el = $('cmpInfo'); if (!el) return;
  const styleId = $('cmpStyle').value;
  const minutes = +$('cmpLen').value;
  const formSel = $('cmpForm');
  const bpm = (COMPOSER_STYLES[styleId] || {}).bpm || '?';
  el.textContent = styleId + ' · ' + bpm + ' BPM · ~' + minutes + ' min' + (formSel && formSel.value ? ' · FORM: ' + formSel.value : ' · form: auto (weighted)') + ' · seed editable — same seed = identical song';
}
/* v0.29.0 FORM LIBRARY — populate both FORM selects (landing row + modal)
   from the composer's 36 named arrangements. AUTO ('') = the legacy
   weighted chains. */
function fillFormSelects() {
  const opts = '<option value="">FORM auto (weighted)</option>' + FORM_IDS.map((f) => '<option>' + f + '</option>').join('');
  for (const id of ['cmpForm', 'compForm']) { const s = $(id); if (s && !s.children.length) s.innerHTML = opts }
}
export function wireCompose() {
  /* ── power-screen row: compose BEFORE boot (goes through powerOn) ── */
  const pb = $('bCompose');
  if (pb) pb.onclick = () => {
    fillFormSelects();
    const { styleId, minutes, seed, formId } = readForm($('compStyle'), $('compLen'), $('compSeed'), $('compForm'));
    const r = compose(styleId, minutes, seed, undefined, formId);
    try { readyAlbum(r.project, styleId, seed, minutes) } catch (e) { /* album is enrichment — never blocks the boot */ }
    /* v0.24.0 KIT HOOK (power-screen path — same rule as the header modal) */
    if (I.p && I.p.kitPinned && kitWarmTypes(I.p.kit).length) { r.project.kit = I.p.kit; r.project.kitPinned = true }
    else { r.project.kit = styleKit(styleId); r.project.kitPinned = false }
    r.project.sampleHints = JSON.parse(JSON.stringify(r.sampleHints)); /* v0.10.0 hints ride the project */
    I.pendingHints = true;
    I.pendingCompose = r.project;
    I.composedLoad = r.form;
    const styleBtn = document.querySelector('#stylePicker button'); /* any style boots; powerOn prefers pendingCompose */
    if (styleBtn) styleBtn.click();
  };
  /* ── header modal: compose while running ── */
  const hb = $('bComposeHdr');
  if (hb) hb.onclick = () => { const m = $('composeModal'); if (m) { fillFormSelects(); m.style.display = 'flex'; updateInfo() } };
  const cancel = $('cmpCancel');
  if (cancel) cancel.onclick = () => { const m = $('composeModal'); if (m) m.style.display = 'none' };
  const go = $('cmpGo');
  if (go) go.onclick = () => {
    const { styleId, minutes, seed, formId } = readForm($('cmpStyle'), $('cmpLen'), $('cmpSeed'), $('cmpForm'));
    if (hasNotes(I.p) && !confirm('COMPOSE replaces the current in-memory project:\n• all scenes, patterns and lanes\n• the arranger chain\n• project bpm/scale/root\nYour current project is NOT saved. Continue?')) return;
    const r = compose(styleId, minutes, seed, undefined, formId);
    /* v0.24.0 KIT HOOK — the composed set follows its style's kit unless the
       user PINNED one in the Sound tab (the pin rides the live project and
       carries across a compose; loadProjectObj applies the kit to the engine). */
    if (I.p && I.p.kitPinned && kitWarmTypes(I.p.kit).length) { r.project.kit = I.p.kit; r.project.kitPinned = true }
    else { r.project.kit = styleKit(styleId); r.project.kitPinned = false }
    const m = $('composeModal'); if (m) m.style.display = 'none';
    /* v0.9.0 library-target COMPOSE NEW (51ce434 contract): when opened from
       the SONG LIBRARY drawer (bLibNew), the album is STASHED before the
       load and RESTORED after — recipes survive compose-new. The plain
       header COMPOSE leaves I.libComposeTarget unset and starts FRESH
       (documented behavior: no album there). */
    const libTarget = I.libComposeTarget === true;
    const stash = libTarget && I.p ? I.p.library : undefined;
    loadProjectObj(r.project);
    if (libTarget) { I.p.library = stash || null; I.libComposeTarget = false; }
    I.renderDirty = true;
    applyComposerSampleHints(r); /* v0.10.0: resolve the composer's sample slots (async, honest toasts) */
    landOnPerform(r.form);
  };
  for (const id of ['cmpStyle', 'cmpLen', 'cmpSeed', 'cmpForm']) { const el = $(id); if (el) el.onchange = updateInfo }
  fillFormSelects();
}
