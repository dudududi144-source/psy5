/**
 * PSY6 MIDI IN tests (v0.4.0).
 *
 * js/midi.js is the DOM-free core: Web MIDI access is INJECTED via a settable
 * provider, so a MockMIDIAccess drives the exact same code path a real device
 * would (bytes in → note on/off / CC). The host callbacks record or dispatch.
 *
 * Covered here:
 *   - note routing: 0x90 vel>0 → host.noteOn(selectedTrack, vel/127, note);
 *     0x80 and 0x90-vel-0 → host.noteOff; velocity normalized exactly
 *   - CC learn: beginLearn → next CC binds cc→paramPath (rebind wins), learn
 *     clears after capture, binding persists in project.midiMap (versioned)
 *   - CC → param dispatch actually changes values through resolveMidiParam
 *     (scAmount exact rounding, pan bipolar mapping, master.vol, macros)
 *   - CC 0 is ignored (never learned, never dispatched)
 *   - CC 123 → panic
 *   - unsupported environment: no provider → {ok:false,reason:'unsupported'};
 *     provider rejection → {ok:false,reason:'denied'}
 *   - persistence round-trip: midiMap survives JSON save/load; legacy project
 *     without the field backfills to an empty map via loadProjectObj
 */
import { describe, expect, test } from 'bun:test'
import { createMidiCore, emptyMidiMap, MIDI_MAP_VERSION } from '../js/midi.js'
import { resolveMidiParam, loadProjectObj } from '../js/state.js'
import { buildStyle } from '../js/presets.js'

function mkMockAccess() {
  const input = { id: 'mock-1', name: 'MOCK IN', onmidimessage: null }
  return { inputs: new Map([['mock-1', input]]), onstatechange: null, _input: input }
}

/** Standard scripted host: records notes, dispatches into a real project. */
function mkHost(p) {
  const notes = [], offs = []
  let panics = 0
  return {
    notes, offs, panics: () => panics,
    selectedTrack: () => 4,
    noteOn: (t, vel, note) => notes.push({ t, vel, note }),
    noteOff: (t) => offs.push({ t }),
    panic: () => { panics++ },
    dispatch: (path, v) => resolveMidiParam(p, path, v),
    onBind: null,
  }
}

function mkSession() {
  const p = buildStyle('TECHNO', 7)
  p.midiMap = emptyMidiMap()
  const host = mkHost(p)
  const core = createMidiCore(host)
  core.map = p.midiMap
  const send = (a: number[]) => core.onMessage({ data: Uint8Array.from(a) })
  return { p, host, core, send }
}

describe('midi note routing', () => {
  test('note on routes to the selected track with exact velocity', () => {
    const { host, send } = mkSession()
    send([0x90, 60, 100])
    expect(host.notes.length).toBe(1)
    expect(host.notes[0].t).toBe(4)
    expect(host.notes[0].note).toBe(60)
    expect(host.notes[0].vel).toBe(100 / 127)
  })

  test('note off: 0x80 and 0x90-with-vel-0 both release', () => {
    const { host, send } = mkSession()
    send([0x80, 60, 0])
    send([0x90, 62, 0])
    expect(host.offs.length).toBe(2)
  })

  test('note on with vel 0 never fires host.noteOn', () => {
    const { host, send } = mkSession()
    send([0x90, 60, 0])
    expect(host.notes.length).toBe(0)
    expect(host.offs.length).toBe(1)
  })
})

describe('cc learn', () => {
  test('next CC binds cc→paramPath, learn clears, binding persists', () => {
    const { p, core, send } = mkSession()
    core.beginLearn('track.2.scAmount')
    expect(core.learn).toBe('track.2.scAmount')
    send([0xB0, 45, 70])
    expect(core.learn).toBeNull()
    expect(p.midiMap.bindings[45]).toBe('track.2.scAmount')
    expect(core.last.kind).toBe('learn')
  })

  test('rebinding an already-bound cc wins', () => {
    const { p, core, send } = mkSession()
    core.beginLearn('track.2.scAmount')
    send([0xB0, 45, 70])
    core.beginLearn('master.vol')
    send([0xB0, 45, 10])
    expect(p.midiMap.bindings[45]).toBe('master.vol')
  })

  test('learn can be cancelled', () => {
    const { core, send } = mkSession()
    core.beginLearn('master.vol')
    core.cancelLearn()
    send([0xB0, 45, 70])
    expect(core.last.kind).toBe('unbound')
  })

  test('midiMap is versioned', () => {
    expect(emptyMidiMap().version).toBe(MIDI_MAP_VERSION)
    expect(MIDI_MAP_VERSION).toBe(1)
  })
})

describe('cc → param dispatch', () => {
  test('learned CC moves scAmount to the exact asserted value', () => {
    const { p, core, send } = mkSession()
    core.beginLearn('track.2.scAmount')
    send([0xB0, 45, 70])
    send([0xB0, 45, 70])
    expect(p.tracks[2].scAmount).toBe(55) /* round(70/127*100) */
  })

  test('unlearned CC dispatches nothing', () => {
    const { p, core, send } = mkSession()
    send([0xB0, 99, 70])
    expect(core.last.kind).toBe('unbound')
    expect(p.tracks[2].scAmount).toBe(0)
  })

  test('pan maps 0..1 → -1..+1, vol/sendA/sendB stay 0..1', () => {
    const p = buildStyle('TECHNO', 7)
    expect(resolveMidiParam(p, 'track.3.mix.pan', 0)).toBe(true)
    expect(p.tracks[3].mix.pan).toBe(-1)
    expect(resolveMidiParam(p, 'track.3.mix.pan', 1)).toBe(true)
    expect(p.tracks[3].mix.pan).toBe(1)
    expect(resolveMidiParam(p, 'track.3.mix.vol', 0.5)).toBe(true)
    expect(p.tracks[3].mix.vol).toBe(0.5)
    expect(resolveMidiParam(p, 'track.3.mix.sendA', 0.25)).toBe(true)
    expect(p.tracks[3].mix.sendA).toBe(0.25)
  })

  test('master.vol and macro.* dispatch to real fields', () => {
    const p = buildStyle('TECHNO', 7)
    expect(resolveMidiParam(p, 'master.vol', 0.5)).toBe(true)
    expect(p.masterVol).toBe(0.5)
    expect(resolveMidiParam(p, 'macro.0', 0.75)).toBe(true)
    expect(p.macroVals[0]).toBe(0.75)
  })

  test('mute toggles per received CC (CC0 ignored → no release toggle)', () => {
    const p = buildStyle('TECHNO', 7)
    expect(p.tracks[1].mix.mute).toBe(false)
    resolveMidiParam(p, 'track.1.mix.mute', 0.99)
    expect(p.tracks[1].mix.mute).toBe(true)
    resolveMidiParam(p, 'track.1.mix.mute', 0.99)
    expect(p.tracks[1].mix.mute).toBe(false)
  })

  test('unknown path returns false without mutating', () => {
    const p = buildStyle('TECHNO', 7)
    expect(resolveMidiParam(p, 'track.99.mix.vol', 0.5)).toBe(false)
    expect(resolveMidiParam(p, 'macro.99', 0.5)).toBe(false)
    expect(resolveMidiParam(p, 'nonsense', 0.5)).toBe(false)
  })
})

describe('cc 0 and cc 123 rules', () => {
  test('CC 0 is ignored even while a learn is pending', () => {
    const { p, core, send } = mkSession()
    core.beginLearn('track.2.scAmount')
    send([0xB0, 0, 64])
    expect(core.learn).toBe('track.2.scAmount')
    expect(p.midiMap.bindings[0]).toBeUndefined()
  })

  test('CC 123 triggers panic', () => {
    const { host, core, send } = mkSession()
    send([0xB0, 123, 0])
    expect(host.panics()).toBe(1)
  })
})

describe('provider injection / unsupported environments', () => {
  test('no provider → unsupported, no crash', async () => {
    const core = createMidiCore(mkHost(buildStyle('TECHNO', 7)))
    const r = await core.connect()
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('unsupported')
  })

  test('provider rejection → denied, no crash', async () => {
    const core = createMidiCore(mkHost(buildStyle('TECHNO', 7)))
    const r = await core.connect(async () => { throw new Error('user said no') })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('denied')
  })

  test('mock MIDIAccess: connect lists inputs and auto-attaches the first', async () => {
    const { core, send } = mkSession()
    const mock = mkMockAccess()
    const r = await core.connect(async () => mock)
    expect(r.ok).toBe(true)
    expect(r.connected).toBe(true)
    expect(r.inputs[0]).toEqual({ id: 'mock-1', name: 'MOCK IN' })
    expect(core.input).toBe(mock._input)
    /* full end-to-end through the attached input's onmidimessage */
    mock._input.onmidimessage({ data: Uint8Array.from([0x90, 60, 127]) })
    expect(core.last.kind).toBe('noteon')
    expect(core.last.vel).toBe(1)
  })
})

describe('persistence round-trip', () => {
  test('midiMap survives a JSON save/load cycle byte-exact', () => {
    const { p, core, send } = mkSession()
    core.beginLearn('track.4.mix.sendA')
    send([0xB0, 21, 100])
    const rt = JSON.parse(JSON.stringify(p))
    expect(rt.midiMap).toEqual(p.midiMap)
    expect(rt.midiMap.bindings[21]).toBe('track.4.mix.sendA')
  })

  test('legacy project without midiMap backfills to an empty map', () => {
    const legacy: any = buildStyle('TECHNO', 7)
    delete legacy.midiMap
    legacy.masterVol = undefined
    loadProjectObj(legacy)
    expect(legacy.midiMap.version).toBe(1)
    expect(Object.keys(legacy.midiMap.bindings).length).toBe(0)
    expect(legacy.masterVol).toBe(0.85)
  })
})
