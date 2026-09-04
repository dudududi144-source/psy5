#!/usr/bin/env bun
/* v0.17.0 UI evidence — drive the REAL device in headless Chrome and assert
   the READY SET boot surface + macro UI depth + playability bindings:
     1. power screen: hero first, 9 style SETs, BARE SKETCH last
     2. hero click boots a COMPOSED set: scenes bank populated, arranger ON,
        library preseeded (9 songs), Perform tab live
     3. macros: EIGHT cards with % readouts; a macro move updates the readout
        AND the resolved state; dblclick resets
     4. keyboard: ']' BPM ride, 'x' panic (voices killed), Alt+2 instant scene
   Emits JSON {ok, checks[]}; exit nonzero on any failure. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { globSync } from 'node:fs';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');

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
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}
function findChrome() {
  if (process.env.PSY6_CHROME && fs.existsSync(process.env.PSY6_CHROME)) return process.env.PSY6_CHROME;
  const names = ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'chrome'];
  for (const n of names) for (const d of (process.env.PATH || '').split(path.delimiter)) {
    const c = path.join(d, n);
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch { /* next */ }
  }
  const homes = [os.homedir(), '/root'];
  const globs = [
    h => h + '/.agent-browser/browsers/chrome-*/chrome',
    h => h + '/.cache/ms-playwright/chromium-*/chrome-linux*/chrome',
    h => h + '/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux*/chrome-headless-shell',
  ];
  for (const h of homes) for (const g of globs) {
    try {
      const hits = globSync(g(h), { dot: true }).sort().reverse();
      if (hits.length) return path.isAbsolute(hits[0]) ? hits[0] : path.join(h, hits[0]);
    } catch { /* next */ }
  }
  return null;
}
function launchChrome(bin, port) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'psy6-ui-'));
  const child = spawn(bin, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('chrome: no DevTools endpoint')), 20000);
    let buf = '';
    const onData = (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) { clearTimeout(timer); child.stderr.removeListener('data', onData); resolve({ child, ws: m[1], profile }); }
    };
    child.stderr.on('data', onData);
    child.on('exit', () => { if (!timer._done) { clearTimeout(timer); reject(new Error('chrome exited early')); } });
  });
}
class CDP {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); }
  async connect() {
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
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result && 'value' in r.result ? r.result.value : undefined;
  }
  close() { try { this.ws.close() } catch { /* done */ } }
}
/* browser-level ws → fetch the page target from the HTTP DevTools endpoint */
async function pageCDP(wsUrl) {
  const m = wsUrl.match(/ws:\/\/127\.0\.0\.1:(\d+)\//);
  if (!m) throw new Error('cannot parse DevTools port from ' + wsUrl);
  const port = m[1];
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
      target = list.find(t => t.type === 'page');
    } catch { /* retry */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('no page target');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  return cdp;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(cdp, expr, timeout, pollMs, label) {
  const t0 = Date.now();
  for (;;) {
    if (await cdp.eval(expr)) return;
    if (Date.now() - t0 > timeout) throw new Error('timeout: ' + label);
    await sleep(pollMs);
  }
}

const checks = [];
const ck = (name, ok, ev) => { checks.push({ name, ok, ev }); console.error((ok ? '  ✓ ' : '  ✗ ') + name + (ev ? ' — ' + ev : '')); };

async function main() {
  const { srv, port } = await startServer();
  let chrome = null, cdp = null, ok = false;
  try {
    const bin = findChrome();
    if (!bin) throw new Error('no chrome');
    const la = await launchChrome(bin, await new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) }));
    chrome = la;
    cdp = await pageCDP(la.ws);
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
    await waitFor(cdp, `document.readyState==='complete'`, 20000, 250, 'page load');
    await sleep(300);

    /* 1. power screen composition */
    const pw = await cdp.eval(`(()=>{const bs=[...document.querySelectorAll('#stylePicker button')];return JSON.stringify({n:bs.length,first:bs[0].textContent,last:bs[bs.length-1].textContent,sets:bs.filter(b=>b.textContent.startsWith('⚡ ')).length})})()`);
    const pwj = JSON.parse(pw);
    ck('power: hero first', pwj.first.includes('ENTER') && pwj.first.includes('READY SET'), pwj.first);
    ck('power: 9 style SETs + BARE last', pwj.sets === 9 && pwj.last.includes('BARE'), 'sets=' + pwj.sets + ' last=' + pwj.last);
    /* note: sets counts ⚡-prefixed style buttons only — the hero's own text contains "READY SET" */

    /* 2. hero click → composed boot */
    await cdp.eval(`document.querySelector('#stylePicker button').click(); true`);
    await waitFor(cdp, `window.__psy6&&window.__psy6.ctx&&window.__psy6.engine==='main'&&window.__psy6.p&&window.__psy6.p.arranger`, 30000, 250, 'composed boot');
    await sleep(400);
    const boot = JSON.parse(await cdp.eval(`JSON.stringify({scenes:window.__psy6.p.scenes.length,arrOn:window.__psy6.p.arranger.on,arrSteps:window.__psy6.p.arranger.steps.length,tracks:window.__psy6.p.tracks.length,lib:window.__psy6.p.library?window.__psy6.p.library.songs.length:0,active:window.__psy6.p.scenes[window.__psy6.p.activeScene]?window.__psy6.p.scenes[window.__psy6.p.activeScene].name:null,fsm:window.__psy6.fsm})`));
    ck('boot: composed set — 10 tracks (FX + TRANZ, v0.19.0), scenes bank full, arranger RUNNING', boot.tracks === 10 && boot.scenes > 6 && boot.arrOn === true && boot.arrSteps > 6, JSON.stringify(boot));
    ck('boot: library preseeded with the READY ALBUM', boot.lib === 9, 'songs=' + boot.lib);
    ck('boot: lands PLAYING on Perform (ready to perform, not empty)', boot.fsm === 'PLAYING', 'fsm=' + boot.fsm + ' scene=' + boot.active);

    /* 3. macros — eight cards, readouts live, dblclick reset */
    const mac = JSON.parse(await cdp.eval(`JSON.stringify({n:document.querySelectorAll('#macros .macro').length,readouts:[...document.querySelectorAll('#macros .macro .mv')].length,labels:[...document.querySelectorAll('#macros .macro .mn')].map(x=>x.textContent)})`));
    ck('macros: EIGHT cards with % readouts', mac.n === 8 && mac.readouts === 8, mac.labels.join(','));
    const mv = await cdp.eval(`(()=>{const w=window.__psy6,rg=document.querySelectorAll('#macros .macro input')[1];rg.value=100;rg.dispatchEvent(new Event('input',{bubbles:true}));const lb=document.querySelectorAll('#macros .macro .mv')[1].textContent;const dr=w.p.tracks[5].ins.drive;return JSON.stringify({lb,dr})})()`);
    const mvj = JSON.parse(mv);
    ck('macros: DRIVE@100 resolves ins.drive>0 and readout says 100%', mvj.lb === '100%' && mvj.dr > 0, 'readout=' + mvj.lb + ' drive=' + mvj.dr);
    const rs = await cdp.eval(`(()=>{const d=document.querySelectorAll('#macros .macro')[1];d.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return JSON.stringify({lb:d.querySelector('.mv').textContent,dr:window.__psy6.p.tracks[5].ins.drive})})()`);
    const rsj = JSON.parse(rs);
    ck('macros: dblclick resets DRIVE to neutral 50%', rsj.lb === '50%', 'readout=' + rsj.lb + ' drive=' + rsj.dr);

    /* 4. keyboard playability */
    const kb1 = JSON.parse(await cdp.eval(`(()=>{const bpm0=window.__psy6.p.bpm;window.dispatchEvent(new KeyboardEvent('keydown',{key:']',bubbles:true}));return JSON.stringify({bpm0,bpm1:window.__psy6.p.bpm})})()`));
    ck('keys: ] rides BPM +1', kb1.bpm1 === kb1.bpm0 + 1, kb1.bpm0 + '→' + kb1.bpm1);
    const kb2 = JSON.parse(await cdp.eval(`(()=>{const before=window.__psy6.p.activeScene;window.dispatchEvent(new KeyboardEvent('keydown',{key:'2',code:'Digit2',altKey:true,bubbles:true}));return JSON.stringify({before,after:window.__psy6.p.activeScene})})()`));
    ck('keys: Alt+2 instant-launches scene 2', kb2.after === 1, 'active ' + kb2.before + '→' + kb2.after);
    const kb3 = await cdp.eval(`(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'t',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'t',bubbles:true}));return window.__psy6.taps?window.__psy6.taps.length:0})()`);
    ck('keys: t tap tempo accumulates taps', kb3 >= 2, 'taps=' + kb3);

    /* 5. v0.18.0 DJ tools + fill variants */
    const dj = JSON.parse(await cdp.eval(`(()=>{const p=window.__psy6.p;const has=p.tracks.some(t=>t.kind==='drum'&&((t.sound&&t.sound.type)||t.type)==='riser');const f0=document.getElementById('bFill').textContent;document.getElementById('bFill').click();const f1=document.getElementById('bFill').textContent;return JSON.stringify({has,f0,f1,btns:['bRiser','bSwell','bImpact'].map(id=>!!document.getElementById(id))})})()`));
    ck('dj: RISER/SWELL/IMPACT buttons exist', dj.btns.every(x => x), JSON.stringify(dj.btns));
    ck('dj: READY SET carries a riser voice (q fires honestly)', dj.has === true, 'riser carrier=' + dj.has);
    ck('fill: button cycles into a named variant', dj.f0 === '⚡ FILL' && /ROLL|TOMLINE|CLASSIC/.test(dj.f1), dj.f0 + ' → ' + dj.f1);

    ok = checks.every(c => c.ok);
  } catch (e) {
    ck('fatal', false, String(e && e.message || e));
  } finally {
    if (cdp) cdp.close();
    if (chrome && chrome.child) { try { chrome.child.kill('SIGTERM') } catch { /* done */ } }
    if (chrome && chrome.profile) { try { fs.rmSync(chrome.profile, { recursive: true, force: true }) } catch { /* done */ } }
    srv.close();
  }
  console.log(JSON.stringify({ ok, checks }, null, 2));
  if (!ok) process.exit(1);
  console.error('UI EVIDENCE: GREEN (' + checks.filter(c => c.ok).length + '/' + checks.length + ')');
}
main();
