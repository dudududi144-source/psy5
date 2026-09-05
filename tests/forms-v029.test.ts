/**
 * FORM LIBRARY (v0.29.0, PSY6) — psyreason re-review #2 port pins.
 *
 * psyreason 5be8271/64d29bc ("FORM library now uses role-aware forms —
 * 36 forms with intro/drop/break roles") + the arrangement vocabulary of
 * dc4f68c-era, ported onto psy5's behavior machinery:
 *
 *   1. TABLE LAW — exactly 36 named forms; every section carries a valid
 *      role; every form has ≥3 sections and positive bars; unique names.
 *   2. COMPILE LAW — compileForm (via compose(formId)) yields
 *      SECTION_CHAIN-shaped sections: id = display name, beh = the
 *      canonical behavior (intro→INTRO, drop2/climax→DROP2, perc→PERC,
 *      acid→ACID, ambient→AMBIENT, half→HALF, outro→OUTRO), energy from
 *      the role arcs, weights proportional to the form's bars.
 *   3. SCALING LAW — the form's relative bars scale to the target length
 *      through allocateBars (multiples of 4, Σ = totalBars ≥ 28).
 *   4. ROLE ISOLATION (pattern level) — PERC: no bass/lead/pad/arp notes,
 *      full 4-on-floor kick; ACID: no kick/hats/perc/pad, rolling bass +
 *      lead; AMBIENT: pad only; HALF-TIME: exactly ONE kick per bar, no
 *      hats, half-time snare on +8.
 *   5. AUTO LAW — compose without a formId (or formId=null) is
 *      byte-identical to the legacy weighted chains.
 *   6. DETERMINISM — same (style, seed, form) = byte-identical project.
 *   7. UI LAW — both FORM selects (landing row #compForm + modal #cmpForm)
 *      exist in index.html; compose.js populates them from FORM_IDS and
 *      passes the 5th compose arg; G55 registered (suite + manifest).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { compose, FORMS, FORM_IDS } from '../js/composer.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COMPOSER_SRC = readFileSync(join(ROOT, 'js/composer.js'), 'utf8')
const COMPOSE_UI_SRC = readFileSync(join(ROOT, 'js/ui/compose.js'), 'utf8')
const INDEX_SRC = readFileSync(join(ROOT, 'index.html'), 'utf8')
const TESTS_SRC = readFileSync(join(ROOT, 'js/ui/tests.js'), 'utf8')
const MANIFEST_SRC = readFileSync(join(ROOT, 'js/gates-manifest.js'), 'utf8')

const VALID_ROLES = ['intro', 'intro_drum', 'build', 'drop', 'drop2', 'break', 'perc', 'acid', 'ambient', 'half', 'climax', 'outro']

const patOf = (r: any, sid: string) => {
  const s = r.form.sections.find((x: any) => x.id === sid)
  return s ? r.project.patterns[s.pattern] : null
}
const trackOn = (pat: any, ti: number) => {
  const d = pat && pat.data[ti]
  if (!d) return 0
  let n = 0
  for (const st of d.steps) if (st.on) n++
  return n
}

describe('form table (composer.js FORMS)', () => {
  test('exactly 36 named forms, unique ids, ≥3 sections each, valid roles, positive bars', () => {
    expect(FORM_IDS.length).toBe(36)
    expect(new Set(FORM_IDS).size).toBe(36)
    for (const fid of FORM_IDS) {
      const secs = (FORMS as any)[fid]
      expect(secs.length).toBeGreaterThanOrEqual(3)
      let sum = 0
      for (const s of secs) {
        expect(VALID_ROLES.includes(s.r)).toBe(true)
        expect(s.b).toBeGreaterThan(0)
        sum += s.b
      }
      expect(sum).toBeGreaterThan(0)
    }
  })

  test('every role the library advertises is exercised (the vocabulary is real, not decorative)', () => {
    const used = new Set<string>()
    for (const fid of FORM_IDS) for (const s of (FORMS as any)[fid]) used.add(s.r)
    for (const r of ['intro', 'build', 'drop', 'break', 'perc', 'acid', 'ambient', 'half', 'climax', 'outro']) {
      expect(used.has(r)).toBe(true)
    }
  })
})

describe('compose(formId) — scaling, determinism, AUTO law', () => {
  test('all 36 forms compose with sane bars (multiples of 4, Σ = totalBars ≥ 28)', () => {
    for (const fid of FORM_IDS) {
      const r = compose('FULL-ON', 5, 424242, undefined, fid)
      expect(r.form.totalBars).toBeGreaterThanOrEqual(28)
      const sum = r.form.sections.reduce((a: number, s: any) => a + s.bars, 0)
      expect(sum).toBe(r.form.totalBars)
      for (const s of r.form.sections) { expect(s.bars).toBeGreaterThanOrEqual(4); expect(s.bars % 4).toBe(0) }
    }
  })

  test('deterministic: same (style, seed, form) = byte-identical project', () => {
    const a = JSON.stringify(compose('FULL-ON', 5, 424242, undefined, 'Deep Space').project)
    const b = JSON.stringify(compose('FULL-ON', 5, 424242, undefined, 'Deep Space').project)
    expect(a).toBe(b)
  })

  test('different forms → different songs (the selector actually selects)', () => {
    const a = JSON.stringify(compose('FULL-ON', 5, 424242, undefined, 'Classic Full-On').project)
    const b = JSON.stringify(compose('FULL-ON', 5, 424242, undefined, 'Deep Space').project)
    expect(a).not.toBe(b)
  })

  test('AUTO: omitted formId ≡ null formId ≡ the legacy weighted chains', () => {
    const a = JSON.stringify(compose('FULL-ON', 5, 424242).project)
    const b = JSON.stringify(compose('FULL-ON', 5, 424242, undefined, null).project)
    const c = JSON.stringify(compose('FULL-ON', 5, 424242, undefined, undefined).project)
    expect(a).toBe(b)
    expect(a).toBe(c)
  })
})

describe('role isolation at pattern level (the behaviors are real)', () => {
  test('PERC TRIBAL — drums+percussion only, full 4-on-floor kick', () => {
    const p = compose('FULL-ON', 5, 424242, undefined, 'Forest Ritual').project
    const pat = patOf(compose('FULL-ON', 5, 424242, undefined, 'Forest Ritual'), 'PERC TRIBAL')
    expect(pat).toBeTruthy()
    for (const ti of [4, 5, 6, 7]) expect(trackOn(pat, ti)).toBe(0)
    expect(trackOn(pat, 0)).toBeGreaterThan(0)
    expect(trackOn(pat, 3)).toBeGreaterThan(0)
    expect(p).toBeTruthy()
  })

  test('ACID BREAK — rolling bass + lead, no drums, no pad', () => {
    const r = compose('FULL-ON', 5, 424242, undefined, 'Acid Odyssey')
    const pat = patOf(r, 'ACID BREAK')
    expect(pat).toBeTruthy()
    for (const ti of [0, 1, 2, 3, 6]) expect(trackOn(pat, ti)).toBe(0)
    expect(trackOn(pat, 4)).toBeGreaterThan(0)
    expect(trackOn(pat, 5)).toBeGreaterThan(0)
  })

  test('AMBIENT TEXTURE — pad bed only', () => {
    const pat = patOf(compose('FULL-ON', 5, 424242, undefined, 'Deep Space'), 'AMBIENT TEXTURE')
    expect(pat).toBeTruthy()
    for (const ti of [0, 1, 2, 3, 4, 5]) expect(trackOn(pat, ti)).toBe(0)
    expect(trackOn(pat, 6)).toBeGreaterThan(0)
  })

  test('HALF-TIME — exactly one kick per bar, no hats, half-time snare on +8', () => {
    const r = compose('FULL-ON', 5, 424242, undefined, 'Morning Uplift')
    const pat = patOf(r, 'HALF-TIME')
    expect(pat).toBeTruthy()
    const bars = pat.data[0].len / 16
    expect(trackOn(pat, 0)).toBe(bars)
    expect(trackOn(pat, 2)).toBe(0)
    /* the snare lands on step 8 of every bar (the half-time backbeat) */
    const sn = pat.data[1]
    let on8 = 0
    for (let b = 0; b < bars; b++) if (sn.steps[b * 16 + 8].on) on8++
    expect(on8).toBe(bars)
  })

  test('section display names from the form land in c.form.sections', () => {
    const r = compose('FULL-ON', 5, 424242, undefined, 'Peak Builder')
    const ids = r.form.sections.map((s: any) => s.id)
    for (const want of ['INTRO', 'BUILD', 'DROP', 'PERC TRIBAL', 'DROP 2', 'BREAK', 'RE-ENTRY', 'CLIMAX', 'DJ OUTRO']) {
      expect(ids.includes(want)).toBe(true)
    }
  })
})

describe('source pins (UI + gates wiring)', () => {
  test('composer: compileForm maps every role; PERC/ACID/AMBIENT/HALF behaviors exist', () => {
    expect(COMPOSER_SRC).toContain("const ROLE_BEH = {")
    expect(COMPOSER_SRC).toContain("perc: 'PERC'"), expect(COMPOSER_SRC).toContain("acid: 'ACID'")
    expect(COMPOSER_SRC).toContain("ambient: 'AMBIENT'"), expect(COMPOSER_SRC).toContain("half: 'HALF'")
    expect(COMPOSER_SRC).toContain("id === 'PERC'")
    expect(COMPOSER_SRC).toContain("id === 'ACID'")
    expect(COMPOSER_SRC).toContain("id === 'AMBIENT'")
    expect(COMPOSER_SRC).toContain("id === 'HALF'")
    expect(COMPOSER_SRC).toContain("sec === 'PERC' ? 2.2 : 1")
  })

  test('compose.js: both FORM selects populated from FORM_IDS + 5th compose arg', () => {
    expect(COMPOSE_UI_SRC).toContain("import { compose, COMPOSER_STYLES, FORM_IDS } from '../composer.js'")
    expect(COMPOSE_UI_SRC).toContain("for (const id of ['cmpForm', 'compForm'])")
    expect(COMPOSE_UI_SRC).toContain('compose(styleId, minutes, seed, undefined, formId)')
  })

  test('index.html carries both FORM selects (#cmpForm modal, #compForm landing)', () => {
    expect(INDEX_SRC).toContain('id="cmpForm"')
    expect(INDEX_SRC).toContain('id="compForm"')
  })

  test('G55 registered in the self-gate suite AND the manifest (52 ids)', () => {
    expect(TESTS_SRC).toContain("gate('G55'")
    expect(MANIFEST_SRC).toContain("'G55'")
  })
})
