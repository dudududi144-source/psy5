/**
 * PSY6 v0.5.0 usability tests.
 *
 *  - shortcut registry: no collisions (unit-tested for collisions — the
 *    dispatcher and help overlay both render from this one table)
 *  - registry covers the taskbook bindings: space, arrows, 1-8, f, v, b, ?
 *  - demo files: valid composer recipes; recompose deterministically;
 *    composed projects load (loadProjectObj) with scenes + arranger intact
 */
import { describe, expect, test } from 'bun:test'
import { SHORTCUTS, findCollisions, helpRows } from '../js/shortcuts.js'
import { compose } from '../js/composer.js'
import { loadProjectObj, I } from '../js/state.js'
import { readFileSync, existsSync } from 'node:fs'

describe('shortcut registry', () => {
  test('no duplicate bindings', () => {
    expect(findCollisions()).toEqual([])
  })
  test('covers the taskbook bindings', () => {
    const keys = SHORTCUTS.map(s => s.key)
    expect(keys).toContain('Space')
    expect(keys).toContain('ArrowLeft')
    expect(keys).toContain('ArrowRight')
    for (let i = 1; i <= 8; i++) expect(keys).toContain(String(i))
    expect(keys).toContain('f')
    expect(keys).toContain('v')
    expect(keys).toContain('b')
    expect(keys).toContain('?')
    expect(keys).toContain('Escape')
  })
  test('every shortcut has a non-empty label and group', () => {
    for (const sc of SHORTCUTS) { expect(sc.label.length).toBeGreaterThan(2); expect(sc.group.length).toBeGreaterThan(2) }
  })
  test('help rows group every shortcut exactly once', () => {
    const rows = helpRows()
    const total = rows.reduce((a, g) => a + g.items.length, 0)
    expect(total).toBe(SHORTCUTS.length)
  })
})

describe('a11y — label associations (v0.13.1 regression guard)', () => {
  /* the owner's DevTools audit flagged 5 orphan header labels (BPM/Swing/
     Velocity/Groove/Seed). Every static label must carry for= matching an
     existing element id; the dynamic Sound-tab labels are for=/id= pairs. */
  test('every header form field has an associated label[for]', () => {
    const html = readFileSync('index.html', 'utf8')
    for (const id of ['bpm', 'swing', 'padVel', 'grooveSel', 'seedIn', 'cmpStyle']) {
      expect(html.includes('for="' + id + '"')).toBe(true)
    }
  })
  test('no orphan <label> remains in index.html or the Sound-tab builders', () => {
    const html = readFileSync('index.html', 'utf8')
    const soundJs = readFileSync('js/ui/sound.js', 'utf8')
    /* every full label element either carries for= or NESTS a labelable field */
    const labels = html.match(/<label\b[^>]*>[\s\S]*?<\/label>/g) || []
    expect(labels.length).toBeGreaterThan(0)
    for (const el of labels) {
      const open = el.slice(0, el.indexOf('>') + 1)
      const nests = /<(input|select|textarea)\b/.test(el.slice(open.length))
      expect(/for=/.test(open) || nests).toBe(true)
    }
    expect(soundJs.includes('<label>VOICE</label>')).toBe(false)
    expect(soundJs.includes('for="voiceModeSel"')).toBe(true)
  })
})

describe('demo songs', () => {
  const demos = [
    { file: 'data/demos/demo-fullon.json', style: 'FULL-ON', minutes: 3, seed: 424242 },
    { file: 'data/demos/demo-darkpsy.json', style: 'DARK-PSY', minutes: 5, seed: 777 },
    { file: 'data/demos/demo-forest.json', style: 'FOREST', minutes: 3, seed: 424242 },
  ]
  test('demo files exist and are valid composer recipes', () => {
    for (const d of demos) {
      expect(existsSync(d.file)).toBe(true)
      const doc = JSON.parse(readFileSync(d.file, 'utf8'))
      expect(doc.kind).toBe('psy6-demo')
      expect(doc.style).toBe(d.style)
      expect(doc.minutes).toBe(d.minutes)
      expect(doc.seed).toBe(d.seed)
      expect(doc.form.sections.length).toBe(7)
    }
  })
  test('demo recipes recompose deterministically into bootable projects', () => {
    for (const d of demos) {
      const doc = JSON.parse(readFileSync(d.file, 'utf8'))
      const a = compose(doc.style, doc.minutes, doc.seed)
      const b = compose(doc.style, doc.minutes, doc.seed)
      expect(JSON.stringify(a.project)).toBe(JSON.stringify(b.project))
      /* the shipped form summary matches the recomposition */
      expect(a.form.sections.map(s => ({ id: s.id, bars: s.bars }))).toEqual(doc.form.sections)
      expect(a.form.totalBars).toBe(doc.form.totalBars)
      /* loads through the project pipeline with scenes + arranger intact —
         the pipeline preserves exactly what the composer emitted (base +
         variant scenes per the v0.7.0 no-identical-repeats contract) */
      loadProjectObj(a.project)
      expect(I.p.scenes.length).toBe(a.stats.scenes)
      expect(I.p.scenes.length).toBeGreaterThan(7) /* variants exist in every demo */
      expect(I.p.arranger.steps.length).toBe(a.project.arranger.steps.length)
      expect(I.p.arranger.on).toBe(true)
      expect(I.p.tracks.length).toBe(9)
    }
  })
  test('the two demos use different styles', () => {
    expect(demos[0].style).not.toBe(demos[1].style)
  })
})
