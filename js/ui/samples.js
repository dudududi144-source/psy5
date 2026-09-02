/* ============ SAMPLES UI (v0.10.0 P1) — the user sample drawer ============
   Import (file input + drag&drop) → decode → guards (20 s / 50 MB, toasts)
   → optional normalize (peak 0.95, baked) → IndexedDB via the injectable
   store → list with AUDITION / RENAME / DELETE (warn when a project track
   references the sample). PCM never touches the project JSON; the drawer is
   the only writer. Hydration pulls referenced samples into the live engine
   cache (missing → synth fallback + one-shot toast, Phase 2). */
import { $, I, toast, pushHist } from '../state.js';
import { createSampleStore, makeRecord, guardImport, referencedSampleIds, applySampleHints, SAMPLE_CAPS, deriveSample } from '../samplestore.js';
import { armResample, captureStop, captureState } from './capture.js';
import { resampleGuard } from '../capture.js';

function ensureStore() {
  if (!I.sampleStore) I.sampleStore = createSampleStore();
  return I.sampleStore;
}

/* engine cache injection point — the PooledEngine grows loadSampleBuffer in
 * P2; until then (and in WORKLET mode, where samples are unsupported) the
 * drawer still stores/auditions honestly. */
function cacheSample(rec) {
  try { if (I.eng && I.eng.loadSampleBuffer) I.eng.loadSampleBuffer(rec) } catch (e) { /* cache is best-effort */ }
}

/* hydrateProjectSamples — load every sample referenced by the live project
 * into the engine cache; record missing ids for the one-shot fallback toast.
 * Fire-and-forget async — called after every project arrival (boot, RESUME,
 * LOAD, IMPORT, SHARE, COMPOSE-with-hints). */
export async function hydrateProjectSamples() {
  if (!I.p) return;
  const store = ensureStore();
  const ids = referencedSampleIds(I.p);
  const missing = [];
  for (const id of ids) {
    if (I.eng && I.eng.hasSampleBuffer && I.eng.hasSampleBuffer(id)) continue;
    const rec = await store.get(id);
    if (rec) cacheSample(rec); else missing.push(id);
  }
  I.missingSampleIds = missing;
  if (missing.length) toast('SAMPLES MISSING — ' + missing.length + ' referenced sample(s) not in this browser → synth fallback (import them in Sound ▸ Samples)');
  return { loaded: ids.length - missing.length, missing };
}

async function importFiles(files) {
  const store = ensureStore();
  const norm = $('smpNorm') ? $('smpNorm').checked : true;
  let ok = 0, list = Array.from(files || []);
  if (store.list) { const rows = await store.list(); if (rows.length + list.length > SAMPLE_CAPS.maxCount) { toast('SAMPLE STORE FULL — ' + SAMPLE_CAPS.maxCount + ' rows cap; delete some first'); return } }
  for (const f of list) {
    try {
      if (f.size > SAMPLE_CAPS.maxFileBytes) { toast('IMPORT REFUSED — ' + f.name + ': file exceeds the 50 MB cap'); continue }
      const ab = await f.arrayBuffer();
      const buf = await I.ctx.decodeAudioData(ab);
      const g2 = guardImport(f.size, buf.duration);
      if (!g2.ok) { toast('IMPORT REFUSED — ' + f.name + ': ' + g2.reason); continue }
      const channels = []; for (let c = 0; c < buf.numberOfChannels; c++) channels.push(new Float32Array(buf.getChannelData(c)));
      const rec = makeRecord(f.name.replace(/\.[^.]+$/, ''), buf.sampleRate, channels, { normalize: norm, addedAt: Date.now() });
      await store.put(rec);
      cacheSample(rec);
      ok++;
      toast('SAMPLE ✓ ' + rec.name + ' · ' + rec.durationSec.toFixed(2) + 's · peak ' + rec.peak.toFixed(2) + (norm ? ' (normalized)' : ''));
    } catch (e) { toast('IMPORT FAILED — ' + f.name + ': ' + (e && e.message || e)) }
  }
  if (ok) { I.dirty = false; /* store is global — not project state */ }
  renderSamples();
}

/* assignSampleToTrack (v0.11.0) — the ONE assign path (Sound-tab VOICE select,
 * RESAMPLE quick action, FREEZE) — extracted from the sound.js handler so no
 * flow duplicates the canonical write sequence. */
export function assignSampleToTrack(rec, idx) {
  if (!rec || !I.p || !I.p.tracks || !I.p.tracks[idx]) return false;
  const t = I.p.tracks[idx];
  pushHist();
  t.sampleId = rec.id;
  t.sampleMeta = { name: rec.name, durationSec: rec.durationSec, peak: rec.peak };
  t.voiceMode = 'sample'; /* assigning a sample means wanting to hear it */
  if (I.eng && !I.eng.hasSampleBuffer(rec.id)) I.eng.loadSampleBuffer(rec);
  if (I.missingSampleIds) I.missingSampleIds.length = 0;
  I.dirty = true; I.renderDirty = true;
  toast('SAMPLE → ' + (t.name || ('track-' + idx)) + ' ✓ ' + rec.name + ' — voice switched to SAMPLE');
  return true;
}

/* importChannelsAsSample (v0.11.0) — the ONE programmatic import path
 * (RESAMPLE sink, FREEZE, editor derivations): count guard → makeRecord →
 * name appended with the content hash8 → put → engine cache → drawer
 * refresh. normalize is caller's choice; derivations pass false (they bake
 * their own math) and so do freeze/resample (what you heard is what you
 * get). Returns the stored record or null (refusals toast). */
export async function importChannelsAsSample(baseName, channels, sampleRate, normalize) {
  const store = ensureStore();
  const rows = await store.list();
  if (rows.length >= SAMPLE_CAPS.maxCount) { toast('SAMPLE STORE FULL — ' + SAMPLE_CAPS.maxCount + ' rows cap; delete some first'); return null }
  const rec = makeRecord(String(baseName).slice(0, 24), sampleRate, channels, { normalize: !!normalize, addedAt: Date.now() });
  rec.name = (rec.name + '-' + rec.id.slice(1, 9)).slice(0, 32);
  await store.put(rec);
  cacheSample(rec);
  I.dirty = false; /* store is global — not project state */
  renderSamples();
  return rec;
}

/* resampleToStore (v0.11.0) — the RESAMPLE sink: raw captured channels →
 * store record. Name = 'resample-<bpm>bpm-<bars>bar-<hash8>' where hash8 is
 * the content id (id computed from the base name + PCM, so identical
 * re-resamples land on the SAME id — idempotent — and the name appends the
 * same hash8 again). */
async function resampleToStore(channels, meta) {
  try {
    const rec = await importChannelsAsSample('resample-' + meta.bpm + 'bpm-' + meta.bars + 'bar', channels, meta.sampleRate, false);
    if (!rec) return;
    toast('RESAMPLE ✓ ' + rec.name + ' · ' + rec.durationSec.toFixed(2) + 's');
    const t = I.p && I.p.tracks && I.p.tracks[I.selTrack] ? I.p.tracks[I.selTrack] : null;
    if (t) assignSampleToTrack(rec, I.selTrack);
  } catch (e) { toast('RESAMPLE IMPORT FAILED — ' + (e && e.message || e)) }
}

/* ── v0.11.0 P2: SAMPLE EDITOR — waveform preview + derived versions ──
   drawWave — deterministic min/max peaks per pixel bucket (ch0): the same
   PCM always paints the same picture (no rng, no time). Slice markers
   (P3) render on the same canvas. */
let editId = null;
let editRows = [];

function drawWave(rec) {
  const cv = $('smpWave');
  if (!cv || !rec || !rec.pcm || !rec.pcm[0]) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, mid = H / 2;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();
  const d = rec.pcm[0], n = d.length, bucket = Math.ceil(n / W);
  ctx.strokeStyle = '#4fd6c0';
  ctx.beginPath();
  for (let x = 0; x < W; x++) {
    const s0 = x * bucket, s1 = Math.min(n, s0 + bucket);
    if (s0 >= n) break;
    let mn = d[s0], mx = d[s0];
    for (let i = s0 + 1; i < s1; i++) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v }
    ctx.moveTo(x + 0.5, mid - mx * (mid - 1));
    ctx.lineTo(x + 0.5, mid - mn * (mid - 1));
  }
  ctx.stroke();
  /* v0.11.0 P3: slice markers on a SLICED record — amber verticals at the
     detected boundaries (inner boundaries only; 0/100 are the edges) */
  if (rec.derivedOp === 'slice' && rec.derivedParams && Array.isArray(rec.derivedParams.pcts)) {
    ctx.strokeStyle = '#e8b04f';
    ctx.beginPath();
    for (const p of rec.derivedParams.pcts) {
      const x = Math.round(p / 100 * W);
      ctx.moveTo(x + 0.5, 2); ctx.lineTo(x + 0.5, H - 2);
    }
    ctx.stroke();
  }
}

function selectEdit(rec, rows) {
  editId = rec.id;
  const cv = $('smpWave'), ed = $('smpEdit'), nm = $('smpEditName');
  if (!cv || !ed) return;
  drawWave(rec);
  cv.style.display = ''; ed.style.display = '';
  if (nm) {
    let lineage = '';
    if (rec.derivedFrom) { const base = (rows || []).find(x => x.id === rec.derivedFrom); lineage = ' ← ' + (base ? base.name : rec.derivedFrom) }
    const sliced = rec.derivedOp === 'slice' && rec.derivedParams ? ' · ' + (rec.derivedParams.pcts.length - 1) + ' slices' : '';
    nm.textContent = 'EDIT: ' + rec.name + lineage + ' · ' + rec.durationSec.toFixed(2) + 's · pk ' + rec.peak.toFixed(2) + sliced;
  }
  const asg = $('smpAssignSlices');
  if (asg) asg.style.display = (rec.derivedOp === 'slice') ? '' : 'none';
}

/* assignSlicesToSteps (v0.11.0 P3) — the classic breakbeat move: fill the
   SELECTED track's pattern with sequential slice locks (step i → slice
   (i % nSlices) + 1, all steps ON). Locks ride the EXISTING per-step lock
   channel (lock.smpSlice) — no new persistence surface. */
function assignSlicesToSteps() {
  const rec = editRows.find(x => x.id === editId);
  if (!rec || rec.derivedOp !== 'slice' || !rec.derivedParams) { toast('SLICES: select a SLICED sample first (ED ▸ SLICE)'); return }
  if (!I.p || I.selTrack == null || !I.p.tracks[I.selTrack]) { toast('SLICES: select a target track first'); return }
  const pat = I.p.patterns && I.p.patterns[I.p.currentPattern];
  const dk = pat && pat.data && pat.data[I.selTrack];
  if (!dk || !Array.isArray(dk.steps) || !dk.steps.length) { toast('SLICES: the selected track has no pattern data'); return }
  const nSlices = rec.derivedParams.pcts.length - 1;
  pushHist();
  for (let i = 0; i < dk.steps.length; i++) {
    const st = dk.steps[i];
    st.on = 1;
    st.lock = Object.assign({}, st.lock || {}, { smpSlice: (i % nSlices) + 1 });
  }
  I.dirty = true; I.renderDirty = true;
  after();
  toast('SLICES → ' + (rec.name) + ' ✓ ' + dk.steps.length + ' steps filled with slices 1..' + nSlices + ' (cycling)');
}

async function applyDerive(op, params) {
  const rec = editRows.find(x => x.id === editId);
  if (!rec) { toast('EDIT: select a sample first (ED button)'); return }
  try {
    const derived = deriveSample(rec, op, params);
    const store = ensureStore();
    const rows = await store.list();
    if (!rows.find(x => x.id === derived.id) && rows.length >= SAMPLE_CAPS.maxCount) { toast('SAMPLE STORE FULL — ' + SAMPLE_CAPS.maxCount + ' rows cap; delete some first'); return }
    await store.put(derived);
    cacheSample(derived);
    editId = derived.id;
    selectEdit(derived, editRows.concat([derived]));
    toast('DERIVED ✓ ' + derived.name + ' · pk ' + derived.peak.toFixed(2) + ' (base untouched)');
    renderSamples();
  } catch (e) { toast('DERIVE FAILED — ' + (e && e.message || e)) }
}

function audition(rec) {
  try {
    const ctx = I.ctx, eng = I.eng;
    if (!ctx) return;
    const buf = ctx.createBuffer(rec.channels, rec.length, rec.sampleRate);
    for (let c = 0; c < rec.channels; c++) buf.getChannelData(c).set(rec.pcm[c]);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = 0.9;
    src.connect(g); g.connect(eng ? eng.master : ctx.destination);
    src.start();
    setTimeout(() => { try { src.stop() } catch (e) { } }, Math.min(rec.durationSec * 1000 + 150, 20500));
  } catch (e) { toast('AUDITION FAILED — ' + (e && e.message || e)) }
}

function renderSamples() {
  const body = $('smpBody');
  if (!body) return;
  const store = ensureStore();
  store.list().then(rows => {
    if (!$('smpBody')) return;
    if (!rows.length) { $('smpBody').innerHTML = '<div class="note">No samples yet — IMPORT audio (wav/mp3/ogg/flac, ≤20s, ≤50MB) or drop files above. Samples live in IndexedDB; projects reference them by id.</div>'; updateMeta(rows); return }
    let html = '';
    rows.forEach(r => {
      const base = r.derivedFrom ? rows.find(x => x.id === r.derivedFrom) : null;
      html += '<div style="display:flex;gap:4px;align-items:center;margin:3px 0;flex-wrap:wrap">'
        + '<span class="mono smpNm" style="font-size:10px;min-width:0;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text" title="' + r.name + ' (double-click to rename)">' + r.name + '</span>'
        + (base ? '<span class="mono" style="font-size:8px;color:var(--dim)" title="derived from ' + base.name + '">← ' + base.name + '</span>' : '')
        + '<span class="mono" style="font-size:9px;color:var(--dim)">' + r.durationSec.toFixed(2) + 's · ' + r.sampleRate + 'Hz · ' + r.channels + 'ch · pk ' + r.peak.toFixed(2) + '</span>'
        + '<button class="smpAud" data-id="' + r.id + '" title="audition through the live master">AUD</button>'
        + '<button class="smpEd" data-id="' + r.id + '" title="waveform + derived edits (fade/gain/normalize/reverse — non-destructive)">ED</button>'
        + '<button class="smpDel" data-id="' + r.id + '" title="delete from the store (warns if a track references it)">✕</button>'
        + '</div>';
    });
    $('smpBody').innerHTML = html;
    editRows = rows;
    $('smpBody').querySelectorAll('.smpAud').forEach(b => { b.onclick = () => { const r = rows.find(x => x.id === b.dataset.id); if (r) audition(r) } });
    $('smpBody').querySelectorAll('.smpEd').forEach(b => { b.onclick = () => { const r = rows.find(x => x.id === b.dataset.id); if (r) selectEdit(r, rows) } });
    $('smpBody').querySelectorAll('.smpDel').forEach(b => {
      b.onclick = async () => {
        const id = b.dataset.id;
        const r = rows.find(x => x.id === id);
        const users = (I.p && I.p.tracks || []).map((t, i) => (t && t.sampleId === id) ? i : -1).filter(i => i >= 0);
        let msg = 'DELETE sample "' + (r ? r.name : id) + '" from the store?';
        if (users.length) msg += '\n\nWARNING: ' + users.length + ' track(s) of the current project reference it (' + users.map(i => I.p.tracks[i].name || ('track-' + i)).join(', ') + ') — they will fall back to the synth voice.';
        if (!confirm(msg)) return;
        await store.delete(id);
        renderSamples();
        toast('SAMPLE DELETED' + (users.length ? ' — referencing tracks fall back to synth' : ''));
      };
    });
    $('smpBody').querySelectorAll('.smpNm').forEach(el => {
      el.ondblclick = async function () {
        const id = this.parentElement.querySelector('.smpDel').dataset.id;
        const nm = prompt('RENAME sample', this.textContent);
        if (nm == null) return;
        const r = rows.find(x => x.id === id);
        if (!r) return;
        r.name = String(nm).trim().slice(0, 32) || r.name;
        await store.put(r); /* canonical re-put (id unchanged — content identity) */
        renderSamples();
      };
    });
    updateMeta(rows);
  });
}

function updateMeta(rows) {
  const el = $('smpMeta');
  if (!el) return;
  const store = ensureStore();
  store.estimate().then(est => {
    const usage = (est && est.usage || 0) / 1048576;
    el.textContent = rows.length + ' sample(s) · IndexedDB ≈ ' + usage.toFixed(1) + ' MB used' + (est && est.quota ? ' / ' + (est.quota / 1048576 | 0) + ' MB quota' : '') + ' · caps: 20s / 50MB / ' + SAMPLE_CAPS.maxCount + ' rows · PCM never enters project JSON, share links or localStorage';
  });
}

/* applyComposerSampleHints — the ONE compose-arrival hook: attach the
 * composer's hints to the live project (names only, persisted), resolve
 * them against the store (hit → sample voice, miss → synth + toast), and
 * hydrate the engine cache. Called from the header/power compose paths and
 * the library LOAD path — never on RESUME (baked track state is the
 * authority there; re-applying would override user voice edits). */
export async function applyComposerSampleHints(composeResult) {
  if (!I.p || !I.sampleStore) return;
  const hints = composeResult && composeResult.sampleHints;
  if (hints && !I.p.sampleHints) I.p.sampleHints = JSON.parse(JSON.stringify(hints));
  const hr = await applySampleHints(I.p, I.sampleStore);
  if (hr.applied) toast('SAMPLE HINTS ✓ ' + hr.applied + ' track(s) → user samples (' + hr.appliedNames.join(', ') + ')');
  if (hr.missing.length) toast('SAMPLE HINTS: ' + hr.missing.join(' · ') + ' — not in this browser → synth fallback');
  hydrateProjectSamples();
}

function wireSamples() {
  ensureStore();
  const bImp = $('bSmpImport'), f = $('smpF');
  if (bImp && f) bImp.onclick = () => f.click();
  if (f) f.onchange = () => { importFiles(f.files); f.value = '' };
  /* v0.11.0 RESAMPLE — record N bars of the live master into the store */
  const rb = $('bResample');
  if (rb) rb.onclick = async () => {
    if (!captureState() || captureState().state !== 'idle') { captureStop(); return }
    const bars = $('rsBars') ? ($('rsBars').value | 0) : 2;
    const g = resampleGuard(bars);
    if (!g.ok) { toast('RESAMPLE REFUSED — ' + g.reason); return }
    if (I.engine === 'worklet') { toast('RESAMPLE: unsupported on the WORKLET engine (reduced feature set)'); return }
    try { const est = await ensureStore().estimate(); if (est && est.quota && est.usage / est.quota > 0.9) { toast('RESAMPLE REFUSED — store quota nearly exhausted (' + (est.usage / 1048576 | 0) + ' MB used)'); return } } catch (e) { /* estimate is advisory */ }
    armResample(bars, resampleToStore);
  };
  const drop = $('smpDrop');
  /* v0.11.0 P2 — derived-edit wiring (one store path, deterministic ids) */
  const fin = $('smpFin'), fout = $('smpFout'), gb = $('smpGainB'), nb = $('smpNormB'), rv = $('smpRevB');
  if (fin) fin.onclick = () => applyDerive('fadein', { ms: $('smpFadeMs') ? ($('smpFadeMs').value | 0) : 250 });
  if (fout) fout.onclick = () => applyDerive('fadeout', { ms: $('smpFadeMs') ? ($('smpFadeMs').value | 0) : 250 });
  if (gb) gb.onclick = () => applyDerive('gain', { factor: $('smpGainPct') ? ($('smpGainPct').value | 0) / 100 : 1 });
  if (nb) nb.onclick = () => applyDerive('normalize', {});
  if (rv) rv.onclick = () => applyDerive('reverse', {});
  const sl = $('smpSliceB');
  if (sl) sl.onclick = () => applyDerive('slice', {});
  const asg = $('smpAssignSlices');
  if (asg) asg.onclick = assignSlicesToSteps;
  if (drop) {
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.borderColor = 'var(--acc,#4fd6c0)' });
    drop.addEventListener('dragleave', () => { drop.style.borderColor = '' });
    drop.addEventListener('drop', e => { e.preventDefault(); drop.style.borderColor = ''; importFiles(e.dataTransfer.files) });
  }
  /* one-shot honest toast when the ENGINE falls back to synth at trigger time
     (sample deleted after load / never imported in this browser) */
  if (!I._smpFbTimer) I._smpFbTimer = setInterval(() => {
    try { if (I.eng && I.eng.sampleFallbacks > 0 && !I._smpFbToasted) { I._smpFbToasted = true; toast('SAMPLES MISSING AT TRIGGER — synth fallback active (re-import in Sound ▸ Samples)') } } catch (e) { }
  }, 1000);
  renderSamples();
}

export { renderSamples, wireSamples };
