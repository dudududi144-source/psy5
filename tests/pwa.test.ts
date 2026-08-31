/**
 * PSY6 PWA tests (Run 9) — static contract of the installable layer.
 *
 * The service worker is NETWORK-FIRST (cache = offline fallback only) and
 * version-locked to the CHANGELOG: tools/verify.mjs asserts the same pair —
 * this suite asserts it again from the test side, plus the manifest/icon
 * integrity and the SW behavioral pieces (network-first, cleanup,
 * skipWaiting/claim). The offline cache-serving smoke test runs live in the
 * release verification (CDP offline emulation) — not here.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'

const sw = readFileSync('sw.js', 'utf8')
const manifest = JSON.parse(readFileSync('manifest.webmanifest', 'utf8'))

describe('PWA: service worker version lock', () => {
  test('CACHE_VERSION matches the latest CHANGELOG entry', () => {
    const latest = /## \[([0-9]+\.[0-9]+\.[0-9]+)\]/.exec(readFileSync('CHANGELOG.md', 'utf8'))
    expect(latest).not.toBeNull()
    const ver = /const CACHE_VERSION = 'psy6-v([0-9]+\.[0-9]+\.[0-9]+)'/.exec(sw)
    expect(ver).not.toBeNull()
    expect(ver![1]).toBe(latest![1])
  })
  test('version string is used by activate() to purge old caches', () => {
    expect(sw).toContain("caches.keys()")
    expect(sw).toContain("k !== CACHE_VERSION")
    expect(sw).toContain("caches.delete(k)")
  })
})

describe('PWA: network-first, cache-safe-or-not-at-all', () => {
  test('fetch handler is GET + same-origin only', () => {
    expect(sw).toContain("req.method !== 'GET'")
    expect(sw).toContain("url.origin !== self.location.origin")
  })
  test('network-first: fetch() first, cache only in the catch (offline fallback)', () => {
    const fetchIdx = sw.indexOf('fetch(req)')
    const catchIdx = sw.indexOf('.catch(() =>')
    expect(fetchIdx).toBeGreaterThan(-1)
    expect(catchIdx).toBeGreaterThan(fetchIdx)
    expect(sw).toContain("caches.match(req, { ignoreSearch: true })")
    expect(sw).toContain("req.mode === 'navigate'")
    expect(sw).toContain("caches.match('./index.html')")
  })
  test('every successful response refreshes the cache copy (freshness)', () => {
    expect(sw).toContain('caches.open(CACHE_VERSION).then((c) => c.put(req, copy))')
  })
  test('takes over immediately: skipWaiting + clients.claim', () => {
    expect(sw).toContain('skipWaiting')
    expect(sw).toContain('clients.claim')
  })
})

describe('PWA: manifest + icons', () => {
  test('required fields, standalone display, device theme colors', () => {
    expect(manifest.name).toBe('PSY6 Groovebox')
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('./index.html')
    expect(manifest.background_color).toBe('#0a0c0f')
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2)
  })
  test('icons are real PNGs with matching IHDR dimensions', () => {
    for (const ic of manifest.icons) {
      const b = readFileSync(ic.src)
      expect(b.slice(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      const w = b.readUInt32BE(16), h = b.readUInt32BE(20)
      expect(`${w}x${h}`).toBe(ic.sizes)
    }
  })
  test('icon generation is deterministic (tools/gen-icons.mjs seeded PRNG)', () => {
    const gen = readFileSync('tools/gen-icons.mjs', 'utf8')
    expect(gen).toContain('mulberry32(0x9056)')
    expect(gen.includes('Math.random')).toBe(false)
  })
  test('index.html registers the SW best-effort and links the manifest', () => {
    const html = readFileSync('index.html', 'utf8')
    expect(html).toContain('rel="manifest"')
    expect(html).toContain("navigator.serviceWorker.register('sw.js')")
  })
})
