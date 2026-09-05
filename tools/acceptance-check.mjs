#!/usr/bin/env node
/**
 * acceptance-check.mjs — standalone WAV acceptance gate for family consumers.
 *
 * WHO THIS IS FOR
 * Any agent or developer rendering audio OUTSIDE this repo (psy5, psysynth,
 * psydrum, …) who needs an objective, dependency-free answer to "did I just
 * ruin the sound?". It runs on plain node + ffmpeg/ffprobe. No repo code,
 * no install, no build — copy this one file into any machine.
 *
 * WHAT IT CHECKS (gates identical to foundation's scripts/verify.mjs)
 *   FORMAT      pcm_s16le, 2 channels, 44100 Hz (the canonical render format)
 *   LOUDNESS    integrated LUFS inside the club-master gate [-11, -7]
 *   TRUE PEAK   < 0 dBTP (warn — not fail — above -0.8: headroom thinning)
 *   DYNAMICS    LRA > 0.5 LU (0.0 = static/noise/silence, always broken)
 *   CLIPPING    sample peak ≤ -0.5 dBFS (the square-clip distortion signature
 *               of the audit-C3 limiter bug class — transients get squashed)
 *   DC OFFSET   < 0.001 per channel
 *   DEAD CH     RMS > -80 dB per channel (a muted/NaN channel)
 *   MONO DUP    channels statistically identical → WARN (legal for mono audio)
 * The tool also prints the file md5 — the first thing to compare when a
 * "deterministic" engine stops reproducing its own output.
 *
 * Usage:
 *   node acceptance-check.mjs <file.wav> [more.wav ...] [--json <out>]
 * Exit: 0 all gates pass · 1 any gate fails · 2 tool/usage error
 *
 * These gates describe the foundation's *canonical* render pipeline. A
 * consumer may legitimately target different numbers — then fork this file
 * and adjust the GATES table, consciously, instead of "listening once and
 * shipping".
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

const GATES = {
  lufsMin: -11,
  lufsMax: -7,
  truePeakMax: 0, // dBTP hard ceiling; warn zone starts at -0.8
  tpWarnAbove: -0.8,
  lraMin: 0.5,
  samplePeakMax: -0.5, // dBFS — above this, transients are being squared off
  dcMax: 0.001,
  deadChannelRmsBelow: -80, // dB
}

const args = process.argv.slice(2)
const jsonIdx = args.indexOf('--json')
let jsonOut = null
if (jsonIdx !== -1) {
  jsonOut = args[jsonIdx + 1]
  if (!jsonOut) usage('--json needs a path')
  args.splice(jsonIdx, 2)
}
const files = args.filter((a) => !a.startsWith('--'))
if (files.length === 0) usage('no input file given')

function usage(msg) {
  console.error(`acceptance-check: ${msg}
Usage: node acceptance-check.mjs <file.wav> [more.wav ...] [--json <out>]`)
  process.exit(2)
}

function run(bin, args) {
  return new Promise((res) => {
    const p = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    // ffprobe prints to stdout, ffmpeg filters to stderr — capture both.
    p.stdout.on('data', (d) => {
      out += d
    })
    p.stderr.on('data', (d) => {
      out += d
    })
    p.on('error', () => res({ code: 127, out: '' }))
    p.on('close', (code) => res({ code, out }))
  })
}

const last = (out, label) => {
  // ebur128/astats print running lines; the LAST match is the final summary.
  const m = [...out.matchAll(new RegExp(`${label}:\\s+([-\\d.]+)`, 'g'))]
  return m.length ? Number(m[m.length - 1][1]) : null
}

async function ffprobe(file) {
  const { code, out } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_name,sample_rate,channels',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1',
    file,
  ])
  if (code !== 0) return null
  return Object.fromEntries(
    out
      .trim()
      .split('\n')
      .map((l) => l.split('='))
  )
}

async function loudness(file) {
  const { code, out } = await run('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i',
    file,
    '-af',
    'ebur128=peak=true',
    '-f',
    'null',
    '-',
  ])
  if (code !== 0) return null
  return { lufs: last(out, 'I'), truePeak: last(out, 'Peak'), lra: last(out, 'LRA') }
}

async function astats(file) {
  const { code, out } = await run('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i',
    file,
    '-af',
    'astats=metadata=1:reset=0',
    '-f',
    'null',
    '-',
  ])
  if (code !== 0) return null
  // Track per-channel stats; the last line per metric per channel is final
  // because reset=0 makes every printed block cumulative over the file.
  const channels = new Map()
  let cur = 'overall'
  for (const line of out.split('\n')) {
    const ch = line.match(/Channel:\s*(\d+|Overall)/)
    if (ch) cur = ch[1]
    for (const metric of ['Peak level dB', 'RMS level dB', 'DC offset']) {
      const m = line.match(new RegExp(`${metric}:\\s+([-\\d.]+)`))
      if (m) {
        if (!channels.has(cur)) channels.set(cur, {})
        channels.get(cur)[metric] = Number(m[1])
      }
    }
  }
  return channels
}

async function check(file) {
  const report = {
    file,
    md5: createHash('md5').update(readFileSync(file)).digest('hex'),
    checks: [],
    fail: 0,
    warn: 0,
  }
  const add = (name, pass, detail, warnOnly = false) => {
    report.checks.push({ name, pass, detail })
    if (!pass) warnOnly ? report.warn++ : report.fail++
    console.log(`  ${pass ? 'PASS' : warnOnly ? 'WARN' : 'FAIL'}  ${name}  — ${detail}`)
  }

  const info = await ffprobe(file)
  if (!info) {
    add('readable', false, 'ffprobe could not read the file')
    return report
  }
  add(
    'format: 16-bit stereo 44.1k',
    info.codec_name === 'pcm_s16le' && info.channels === '2' && info.sample_rate === '44100',
    `codec=${info.codec_name}, channels=${info.channels}, sr=${info.sample_rate}, dur=${Number(info.duration ?? 0).toFixed(3)}s`
  )

  const loud = await loudness(file)
  if (!loud || loud.lufs === null) {
    add('loudness measurable', false, 'ffmpeg ebur128 produced no summary')
    return report
  }
  add(
    `integrated LUFS in [${GATES.lufsMin}, ${GATES.lufsMax}]`,
    loud.lufs >= GATES.lufsMin && loud.lufs <= GATES.lufsMax,
    `I=${loud.lufs} LUFS (club-master gate, same as foundation verify)`
  )
  add(
    `true peak < ${GATES.truePeakMax} dBTP`,
    loud.truePeak !== null && loud.truePeak < GATES.truePeakMax,
    `Peak=${loud.truePeak} dBTP${loud.truePeak !== null && loud.truePeak >= GATES.tpWarnAbove ? ' — thin headroom, canonical ceiling is -1.5' : ''}`,
    loud.truePeak !== null &&
      loud.truePeak >= GATES.tpWarnAbove &&
      loud.truePeak < GATES.truePeakMax
  )
  add(
    `LRA > ${GATES.lraMin} LU`,
    loud.lra !== null && loud.lra > GATES.lraMin,
    `LRA=${loud.lra} LU (0.0 = static output — a render that never moves)`
  )

  const stats = await astats(file)
  if (!stats || stats.size === 0) {
    add('astats measurable', false, 'ffmpeg astats produced no summary')
    return report
  }
  let worstPeak = Number.NEGATIVE_INFINITY
  for (const [ch, s] of stats) {
    if (ch === 'overall' || s['Peak level dB'] === undefined) continue
    worstPeak = Math.max(worstPeak, s['Peak level dB'])
    add(
      `ch${ch}: no DC offset`,
      Math.abs(s['DC offset'] ?? 1) < GATES.dcMax,
      `DC=${s['DC offset']}`
    )
    add(
      `ch${ch}: alive (RMS > ${GATES.deadChannelRmsBelow} dB)`,
      s['RMS level dB'] > GATES.deadChannelRmsBelow,
      `RMS=${s['RMS level dB']} dB`
    )
  }
  add(
    `sample peak ≤ ${GATES.samplePeakMax} dBFS`,
    worstPeak <= GATES.samplePeakMax,
    `worst=${worstPeak.toFixed(2)} dBFS (above → clipped/squashed transients)`
  )

  const chs = [...stats.keys()].filter((k) => k !== 'overall')
  if (chs.length === 2) {
    const a = stats.get(chs[0])
    const b = stats.get(chs[1])
    const identical =
      a['Peak level dB'] !== undefined &&
      Math.abs(a['Peak level dB'] - b['Peak level dB']) < 0.01 &&
      Math.abs(a['RMS level dB'] - b['RMS level dB']) < 0.01
    add(
      'stereo: channels differ',
      !identical,
      identical
        ? 'L/R statistically identical — mono duplicate dressed as stereo?'
        : 'L/R statistics differ — real stereo content',
      true
    )
  }

  return report
}

const reports = []
for (const f of files) {
  const path = isAbsolute(f) ? f : resolve(f)
  console.log(`\n${path}`)
  console.log(`md5=${createHash('md5').update(readFileSync(path)).digest('hex')}`)
  reports.push(await check(path))
}

const totalFail = reports.reduce((s, r) => s + r.fail, 0)
const totalWarn = reports.reduce((s, r) => s + r.warn, 0)
console.log(
  `\n===== acceptance summary: ${reports.length} file(s), ${totalFail} FAIL, ${totalWarn} WARN =====`
)
if (jsonOut) {
  const target = isAbsolute(jsonOut) ? jsonOut : resolve(jsonOut)
  writeFileSync(target, JSON.stringify({ gates: GATES, reports }, null, 2))
  console.log(`json report -> ${target}`)
}
process.exit(totalFail > 0 ? 1 : 0)
