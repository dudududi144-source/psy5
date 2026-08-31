#!/usr/bin/env bun
/* PSY6 E2E gate evidence — drives the real device in headless Chrome over raw
   CDP (zero npm deps; runtime: bun, or node>=22 for native WebSocket).

   Recipe (the one proven on-device since v0.2.x):
     1. ephemeral no-store static server (no stale disk caches),
     2. fresh-profile headless Chrome with the autoplay-policy bypass flag,
     3. boot MAIN engine via real UI clicks,
     4. run the on-device Self-Gate (same button a human presses),
     5. read machine-readable results (window.__psy6Gates),
     6. emit {gate, pass, evidence} JSON; exit nonzero on any failure.

   CI SUBSET — honest classification (see README "Self-Gate in CI"):
     - asserted here: every MAIN-mode gate. Each one is either pure
       computation (G2/G5/G6/G8/G10) or a deterministic OfflineAudioContext
       render (G1-*, G9, G11, G12, G13, G14, G15) — none depend on the live
       realtime scheduler. Criteria are inequalities and integer counters
       (peak/rms thresholds, "kicks===16"), not bit-exact audio, so they are
       stable across Chrome versions.
     - NOT run in CI: the WORKLET-engine reduced set (G14w/G15w — worklet
       offline rendering is environment-sensitive) and any live-scheduler
       loop check. Those stay local-only, run from the live site at release.

   Usage: bun tools/e2e.mjs [--out gates-evidence.json] [--timeout 300000]
   Env:   PSY6_CHROME=/path/to/chrome (else PATH names + known cache globs)
*/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { globSync } from 'node:fs';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const OUT = opt('--out', null);
const GATE_TIMEOUT = parseInt(opt('--timeout', '300000'), 10);

const EXPECTED = [
  'G1-TECHNO', 'G1-PSYTRANCE', 'G1-TRANCE', 'G1-PROGRESSIVE',
  'G2', 'G5', 'G6', 'G8', 'G9', 'G10', 'G11', 'G12', 'G13', 'G14', 'G15', 'G16', 'G18', 'G19', 'G21', 'G22', 'G23', 'G24', 'G26', 'G27',
];
/* G17 (live capture, v0.4.0) and G25 (record song, v0.6.0) are REALTIME —
   they run on-device (evidence-only) but are explicitly NOT asserted in CI
   (documented subset boundary). Both reuse the ScriptProcessor tap on the
   master output and depend on wall-clock scheduling. */
const EXCLUDED = new Set(['G17', 'G25']);
const PURE = new Set(['G2', 'G5', 'G6', 'G8', 'G10', 'G16', 'G19']);

/* ── 1. no-store static server on an ephemeral port ─────────────────────── */
function startServer() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const p = req.url.split('?')[0];
      const f = p === '/' ? '/index.html' : p;
      const full = path.join(ROOT, f);
      if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      fs.readFile(full, (err, data) => {
        if (err) { res.writeHead(404); return res.end('nf'); }
        const ext = path.extname(f);
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' }[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': mime,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        });
        res.end(data);
      });
    });
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/* ── 2. locate a Chrome/Chromium binary ─────────────────────────────────── */
function findChrome() {
  if (process.env.PSY6_CHROME && fs.existsSync(process.env.PSY6_CHROME)) return process.env.PSY6_CHROME;
  const names = ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'chrome'];
  for (const n of names) {
    for (const d of (process.env.PATH || '').split(path.delimiter)) {
      const c = path.join(d, n);
      try { fs.accessSync(c, fs.constants.X_OK); return c; } catch { /* next */ }
    }
  }
  const homes = [os.homedir(), '/root'];
  const globs = [
    h => h + '/.agent-browser/browsers/chrome-*/chrome',
    h => h + '/.cache/ms-playwright/chromium-*/chrome-linux*/chrome',
    h => h + '/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux*/chrome-headless-shell',
  ];
  for (const h of homes) {
    for (const g of globs) {
      try {
        const hits = globSync(g(h), { dot: true }).sort().reverse();
        if (hits.length) return path.isAbsolute(hits[0]) ? hits[0] : path.join(h, hits[0]);
      } catch { /* next */ }
    }
  }
  return null;
}

/* ── 3. launch headless Chrome, parse the CDP ws endpoint from stderr ───── */
function launchChrome(bin, port) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'psy6-e2e-'));
  const child = spawn(bin, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('chrome: no DevTools endpoint in 20s')), 20000);
    let buf = '';
    const onData = (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(timer);
        child.stderr.removeListener('data', onData);
        resolve({ child, ws: m[1], profile });
      }
    };
    child.stderr.on('data', onData);
    child.on('exit', (c) => { clearTimeout(timer); reject(new Error('chrome exited early code=' + c)); });
  });
}

class CDP {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); }
  async connect() {
    if (typeof WebSocket === 'undefined') throw new Error('no native WebSocket — run with bun (or node>=22)');
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('CDP ws error')); });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result && 'value' in r.result ? r.result.value : undefined;
  }
  close() { try { this.ws.close(); } catch { /* done */ } }
}

/* The stderr ws:// endpoint is the BROWSER-level socket (no Page domain).
   Fetch the page target from the HTTP DevTools endpoint and connect there. */
async function pageCDP(wsUrl) {
  const m = wsUrl.match(/ws:\/\/127\.0\.0\.1:(\d+)\//);
  if (!m) throw new Error('cannot parse DevTools port from ' + wsUrl);
  const port = m[1];
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      target = list.find((t) => t.type === 'page');
    } catch { /* retry */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('no page target on DevTools endpoint');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  return cdp;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cdp, expr, timeout, every = 500, label = expr) {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = await cdp.eval(expr); } catch { /* retry */ }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('timeout waiting for: ' + label);
    await sleep(every);
  }
}

/* ── 5. the scenario ────────────────────────────────────────────────────── */
async function main() {
  const { srv, port } = await startServer();
  const base = `http://127.0.0.1:${port}/index.html`;
  let chrome = null, cdp = null, verdict = { ok: false };
  try {
    const bin = findChrome();
    if (!bin) throw new Error('no Chrome/Chromium found (set PSY6_CHROME)');
    let free = null;
    const srvSock = net.createServer();
    free = await new Promise((res) => srvSock.listen(0, '127.0.0.1', () => { const p = srvSock.address().port; srvSock.close(() => res(p)); }));
    const la = await launchChrome(bin, free);
    chrome = la;
    cdp = await pageCDP(la.ws);
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: base });
    await waitFor(cdp, `document.readyState==='complete'`, 20000, 250, 'page load');
    await sleep(300);

    // boot MAIN engine exactly like a human: engine button (MAIN is default) + style button
    await cdp.eval(`(()=>{const b=Array.from(document.querySelectorAll('#enginePicker button')).find(x=>x.dataset.eng==='main');if(b)b.click();return true})()`);
    await cdp.eval(`(()=>{document.querySelector('#stylePicker button').click();return true})()`);
    await waitFor(cdp, `window.__psy6&&window.__psy6.ctx&&window.__psy6.ctx.state!=='suspended'&&window.__psy6.engine==='main'`, 30000, 250, 'MAIN boot');
    const boot = await cdp.eval(`JSON.stringify({engine:window.__psy6.engine,ctx:window.__psy6.ctx.state})`);

    // switch to the tests tab and press RUN SELF-GATE
    await cdp.eval(`(()=>{const btn=Array.from(document.querySelectorAll('nav button')).find(x=>x.dataset.t==='tests');btn.click();return true})()`);
    await cdp.eval(`document.querySelector('#bGate').click(); true`);
    await waitFor(cdp, `document.querySelector('#log').textContent.includes('SELF-GATE:')`, GATE_TIMEOUT, 1000, 'Self-Gate verdict line');

    const gates = await cdp.eval(`window.__psy6Gates?window.__psy6Gates.map(g=>({id:g.id,claim:g.claim,pass:g.pass,ev:g.ev||''})):[]`);
    const verdictLine = await cdp.eval(`(document.querySelector('#log').textContent.match(/SELF-GATE: \\d+\\/\\d+ passed/)||[''])[0]`);

    const byId = new Map(gates.map((g) => [g.id, g]));
    const missing = EXPECTED.filter((id) => !byId.has(id));
    const failed = gates.filter((g) => g.pass !== true && !EXCLUDED.has(g.id));
    const excludedInfo = gates.filter((g) => EXCLUDED.has(g.id)).map((g) => ({ id: g.id, pass: g.pass, ev: g.ev }));
    const ok = missing.length === 0 && failed.length === 0 && gates.length > 0;

    verdict = {
      ok,
      subset: {
        asserted: EXPECTED.map((id) => ({ id, class: PURE.has(id) ? 'pure-computation' : 'offline-render' })),
        notRunInCI: [
          { gates: 'G17 (live capture) + G25 (record song)', reason: 'realtime ScriptProcessor recording — run on-device (reported as info), never asserted in CI' },
          { gates: 'G14w/G15w (WORKLET engine reduced set)', reason: 'worklet offline rendering is environment-sensitive in CI; exercised locally and from the live site at release' },
          { gates: 'live-scheduler loop checks', reason: 'realtime loop not asserted in CI' },
        ],
        note: 'All asserted MAIN-mode gates are pure computation or deterministic OfflineAudioContext renders (G9/G14/G15 included — no realtime dependency in MAIN mode); criteria are inequality/integer, not bit-exact.',
      },
      boot,
      verdictLine,
      summary: { total: EXPECTED.length, passed: EXPECTED.filter((id) => byId.get(id) && byId.get(id).pass).length, failed: failed.length, missing, excludedInfo },
      gates: gates.map((g) => ({ ...g, class: PURE.has(g.id) ? 'pure-computation' : 'offline-render' })),
    };
  } catch (e) {
    verdict = { ok: false, error: String(e && e.message || e) };
  } finally {
    if (cdp) cdp.close();
    if (chrome && chrome.child) { try { chrome.child.kill('SIGTERM'); } catch { /* done */ } }
    if (chrome && chrome.profile) { try { fs.rmSync(chrome.profile, { recursive: true, force: true }); } catch { /* done */ } }
    srv.close();
  }

  const json = JSON.stringify(verdict, null, 2);
  if (OUT) { fs.writeFileSync(OUT, json + '\n'); }
  console.log(json);
  if (!verdict.ok) {
    console.error('E2E GATES: RED');
    process.exit(1);
  }
  console.error('E2E GATES: GREEN (' + verdict.summary.passed + '/' + verdict.summary.total + ' asserted)');
}

main();
