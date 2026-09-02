/* ============ SAMPLES UI (v0.10.0 P1) — the user sample drawer ============
   Import (file input + drag&drop) → decode → guards (20 s / 50 MB, toasts)
   → optional normalize (peak 0.95, baked) → IndexedDB via the injectable
   store → list with AUDITION / RENAME / DELETE (warn when a project track
   references the sample). PCM never touches the project JSON; the drawer is
   the only writer. Hydration pulls referenced samples into the live engine
   cache (missing → synth fallback + one-shot toast, Phase 2). */
import { $, I, toast } from '../state.js';
import { createSampleStore, makeRecord, guardImport, referencedSampleIds, SAMPLE_CAPS } from '../samplestore.js';

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
      html += '<div style="display:flex;gap:4px;align-items:center;margin:3px 0;flex-wrap:wrap">'
        + '<span class="mono smpNm" style="font-size:10px;min-width:0;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text" title="' + r.name + ' (double-click to rename)">' + r.name + '</span>'
        + '<span class="mono" style="font-size:9px;color:var(--dim)">' + r.durationSec.toFixed(2) + 's · ' + r.sampleRate + 'Hz · ' + r.channels + 'ch · pk ' + r.peak.toFixed(2) + '</span>'
        + '<button class="smpAud" data-id="' + r.id + '" title="audition through the live master">AUD</button>'
        + '<button class="smpDel" data-id="' + r.id + '" title="delete from the store (warns if a track references it)">✕</button>'
        + '</div>';
    });
    $('smpBody').innerHTML = html;
    $('smpBody').querySelectorAll('.smpAud').forEach(b => { b.onclick = () => { const r = rows.find(x => x.id === b.dataset.id); if (r) audition(r) } });
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

function wireSamples() {
  ensureStore();
  const bImp = $('bSmpImport'), f = $('smpF');
  if (bImp && f) bImp.onclick = () => f.click();
  if (f) f.onchange = () => { importFiles(f.files); f.value = '' };
  const drop = $('smpDrop');
  if (drop) {
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.borderColor = 'var(--acc,#4fd6c0)' });
    drop.addEventListener('dragleave', () => { drop.style.borderColor = '' });
    drop.addEventListener('drop', e => { e.preventDefault(); drop.style.borderColor = ''; importFiles(e.dataTransfer.files) });
  }
  renderSamples();
}

export { renderSamples, wireSamples };
