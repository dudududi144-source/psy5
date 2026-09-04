/* ============ COMPOSER UI (v0.5.0) — power-screen row + header modal ============
   The composer itself is pure (js/composer.js). This module only:
   - collects style/length/seed,
   - protects non-empty projects (explicit confirm listing what is replaced),
   - loads the composed project into memory (keep = load; cancel = discard),
   - lands the user on the Perform tab with the arranger active.
   The seed field's INITIAL value uses Date.now (UI convenience only — the
   composition path itself is fully deterministic on the field's value). */
import { $, I, toast, loadProjectObj } from '../state.js';
import { compose, COMPOSER_STYLES } from '../composer.js';
import { DEFAULT_KIT, STYLE_KIT, kitWarmTypes } from '../../foundation/dsp/kit-reason.mjs';
import { arrToggle } from '../arranger.js';
import { applyComposerSampleHints } from './samples.js';

function hasNotes(p) {
  if (!p) return false;
  return Object.values(p.patterns || {}).some(pat => Object.values(pat.data || {}).some(d => (d.steps || []).some(s => s.on)));
}
function readForm(styleSel, lenSel, seedInp) {
  const styleId = styleSel.value;
  const minutes = +lenSel.value;
  const seedRaw = (seedInp.value || '').trim();
  const seed = seedRaw === '' ? (Date.now() % 1000000) : (isNaN(+seedRaw) ? seedRaw : +seedRaw);
  return { styleId, minutes, seed };
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
  const bpm = (COMPOSER_STYLES[styleId] || {}).bpm || '?';
  el.textContent = styleId + ' · ' + bpm + ' BPM · ~' + minutes + ' min · seed editable — same seed = identical song';
}
export function wireCompose() {
  /* ── power-screen row: compose BEFORE boot (goes through powerOn) ── */
  const pb = $('bCompose');
  if (pb) pb.onclick = () => {
    const { styleId, minutes, seed } = readForm($('compStyle'), $('compLen'), $('compSeed'));
    const r = compose(styleId, minutes, seed);
    /* v0.24.0 KIT HOOK (power-screen path — same rule as the header modal) */
    if (I.p && I.p.kitPinned && kitWarmTypes(I.p.kit).length) { r.project.kit = I.p.kit; r.project.kitPinned = true }
    else { r.project.kit = STYLE_KIT[String(styleId).toLowerCase()] || DEFAULT_KIT; r.project.kitPinned = false }
    r.project.sampleHints = JSON.parse(JSON.stringify(r.sampleHints)); /* v0.10.0 hints ride the project */
    I.pendingHints = true;
    I.pendingCompose = r.project;
    I.composedLoad = r.form;
    const styleBtn = document.querySelector('#stylePicker button'); /* any style boots; powerOn prefers pendingCompose */
    if (styleBtn) styleBtn.click();
  };
  /* ── header modal: compose while running ── */
  const hb = $('bComposeHdr');
  if (hb) hb.onclick = () => { const m = $('composeModal'); if (m) { m.style.display = 'flex'; updateInfo() } };
  const cancel = $('cmpCancel');
  if (cancel) cancel.onclick = () => { const m = $('composeModal'); if (m) m.style.display = 'none' };
  const go = $('cmpGo');
  if (go) go.onclick = () => {
    const { styleId, minutes, seed } = readForm($('cmpStyle'), $('cmpLen'), $('cmpSeed'));
    if (hasNotes(I.p) && !confirm('COMPOSE replaces the current in-memory project:\n• all scenes, patterns and lanes\n• the arranger chain\n• project bpm/scale/root\nYour current project is NOT saved. Continue?')) return;
    const r = compose(styleId, minutes, seed);
    /* v0.24.0 KIT HOOK — the composed set follows its style's kit unless the
       user PINNED one in the Sound tab (the pin rides the live project and
       carries across a compose; loadProjectObj applies the kit to the engine). */
    if (I.p && I.p.kitPinned && kitWarmTypes(I.p.kit).length) { r.project.kit = I.p.kit; r.project.kitPinned = true }
    else { r.project.kit = STYLE_KIT[String(styleId).toLowerCase()] || DEFAULT_KIT; r.project.kitPinned = false }
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
  for (const id of ['cmpStyle', 'cmpLen', 'cmpSeed']) { const el = $(id); if (el) el.onchange = updateInfo }
}
