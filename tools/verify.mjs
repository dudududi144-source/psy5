/**
 * PSY6 repository verification — the same gates CI runs before deploy.
 *
 * Usage: node tools/verify.mjs   (exit 0 = green, 1 = red)
 *
 * Checks:
 *   1. Standalone JS files parse (node --check): worklets, soundBank, factory-presets.
 *   2. Every inline <script> block of index.html and playground/index.html parses.
 *   3. Document structure: doctype present, exactly one <html>/<head>/<body>,
 *      balanced <script>/<style> tags.
 *
 * Zero dependencies — runs with plain Node (also Bun-compatible).
 */

import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';

let failures = 0;
const tmp = mkdtempSync(join(tmpdir(), 'psy6-verify-'));

function fail(msg) {
  failures++;
  console.error('  ✗ ' + msg);
}
function ok(msg) {
  console.log('  ✓ ' + msg);
}

/* ── 1. standalone JS ─────────────────────────────────────── */
console.log('== standalone JS ==');
const standalone = [
  ...readdirSync('worklets').filter(f => f.endsWith('.js')).map(f => 'worklets/' + f),
  'soundBank.js',
  'factory-presets.js',
];
for (const f of standalone) {
  try {
    execFileSync('node', ['--check', f], { stdio: 'pipe' });
    ok(f);
  } catch (e) {
    fail(`${f}: ${String(e.stderr).split('\n').slice(0, 3).join(' ')}`);
  }
}

/* ── 2 + 3. HTML documents ────────────────────────────────── */
const docs = ['index.html', 'playground/index.html'];
for (const doc of docs) {
  console.log('== ' + doc + ' ==');
  let html;
  try {
    html = readFileSync(doc, 'utf8');
  } catch (e) {
    fail('cannot read: ' + e.message);
    continue;
  }

  if (!/^<!DOCTYPE html>/i.test(html)) fail('missing <!DOCTYPE html> at byte 0');
  else ok('doctype');

  for (const tag of ['html', 'head', 'body']) {
    const open = (html.match(new RegExp('<' + tag + '(\\s|>)', 'g')) || []).length;
    const close = (html.match(new RegExp('</' + tag + '>', 'g')) || []).length;
    if (open !== 1 || close !== 1) fail(`<${tag}> open=${open} close=${close} (expected 1/1)`);
    else ok(`<${tag}> … </${tag}>`);
  }

  const sOpen = (html.match(/<script\b/g) || []).length;
  const sClose = (html.match(/<\/script>/g) || []).length;
  if (sOpen !== sClose) fail(`<script> open=${sOpen} close=${sClose}`);
  else ok(`${sOpen} <script> blocks, balanced`);

  const stOpen = (html.match(/<style\b/g) || []).length;
  const stClose = (html.match(/<\/style>/g) || []).length;
  if (stOpen !== stClose) fail(`<style> open=${stOpen} close=${stClose}`);
  else ok(`${stOpen} <style> blocks, balanced`);

  // parse every inline script
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let m, i = 0, bad = 0;
  while ((m = re.exec(html)) !== null) {
    i++;
    const attrs = m[1], body = m[2];
    const src = /src\s*=\s*["']([^"']+)["']/.exec(attrs);
    if (src) { ok(`script #${i}: external (${src[1]}) — skipped`); continue; }
    const file = join(tmp, doc.replace(/[/.]/g, '_') + '_' + i + '.js');
    writeFileSync(file, body);
    try {
      execFileSync('node', ['--check', file], { stdio: 'pipe' });
      ok(`script #${i}: parses (${body.split('\n').length} lines)`);
    } catch (e) {
      bad++;
      fail(`script #${i}: SYNTAX ERROR → ${String(e.stderr).split('\n').slice(0, 4).join(' | ')}`);
    }
  }
  if (i === 0) fail('no <script> blocks found');
}

rmSync(tmp, { recursive: true, force: true });

console.log(failures === 0 ? '\nVERIFY: GREEN (0 failures)' : `\nVERIFY: RED (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
