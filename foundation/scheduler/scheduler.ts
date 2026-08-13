import type { AudioTime } from '@psy-foundation/transport'
import { Rng } from './rng.ts'
import type {
  MusicalPlan,
  PatternStep,
  PatternTrack,
  ScheduledEvent,
  SchedulerOptions,
} from './types.ts'

const DEFAULT_OPTS: Required<Omit<SchedulerOptions, 'originAudioTime' | 'bpm'>> = {
  beatsPerBar: 4,
  swing: 0,
  humanizeSec: 0,
  seed: 1,
}

export function schedule(plan: MusicalPlan, opts: SchedulerOptions): ScheduledEvent[] {
  const o = { ...DEFAULT_OPTS, ...opts }
  const rng = new Rng(o.seed)
  const secPerBeat = 60 / o.bpm
  const secPerBar = secPerBeat * o.beatsPerBar
  const events: ScheduledEvent[] = []

  for (let barOffset = 0; barOffset < plan.barCount; barOffset++) {
    const barIndex = plan.fromBar + barOffset
    const barAudioTime: AudioTime = o.originAudioTime + barIndex * secPerBar
    for (const track of plan.tracks) {
      scheduleTrack(track, barAudioTime, secPerBeat, o, rng, events)
    }
  }

  events.sort((a, b) => a.at - b.at)
  return events
}

function scheduleTrack(
  track: PatternTrack,
  barAudioTime: AudioTime,
  secPerBeat: number,
  opts: Required<Omit<SchedulerOptions, 'originAudioTime' | 'bpm'>>,
  rng: Rng,
  out: ScheduledEvent[]
): void {
  const steps = track.steps
  const len = steps.length
  if (len === 0) return
  const stepBeats = opts.beatsPerBar / len

  for (let i = 0; i < len; i++) {
    const step: PatternStep | undefined = steps[i]
    if (!step || !step.on) continue
    if (step.prob < 1 && rng.next() > step.prob) continue

    let swingOffsetBeats = 0
    if (opts.swing > 0 && i % 2 === 1) swingOffsetBeats = opts.swing * stepBeats

    const offsetBeats = i * stepBeats + step.micro + swingOffsetBeats
    let at = barAudioTime + offsetBeats * secPerBeat
    if (opts.humanizeSec > 0) at += (rng.next() * 2 - 1) * opts.humanizeSec

    const note = step.note > 0 ? step.note : track.defaultNote
    out.push({
      type: 'note',
      at,
      note,
      velocity: step.vel,
      duration: track.durationBeats * secPerBeat,
      channel: track.role,
    })

    if (step.lock) {
      for (const [param, value] of Object.entries(step.lock)) {
        out.push({ type: 'param', at, channel: track.role, param, value, rampSec: 0.005 })
      }
    }
  }
}

export function barBeatToAudioTime(
  originAudioTime: AudioTime,
  bpm: number,
  beatsPerBar: number,
  bar: number,
  beatInBar: number
): AudioTime {
  const secPerBeat = 60 / bpm
  return originAudioTime + (bar * beatsPerBar + beatInBar) * secPerBeat
}

export function step(partial: Partial<PatternStep> = {}): PatternStep {
  return {
    on: partial.on ?? false,
    vel: partial.vel ?? 1,
    prob: partial.prob ?? 1,
    micro: partial.micro ?? 0,
    note: partial.note ?? 0,
    lock: partial.lock,
  }
}

export function emptyTrack(
  id: string,
  role: string,
  defaultNote: number,
  stepCount: number,
  durationBeats = 0.5
): PatternTrack {
  const steps: PatternStep[] = Array.from({ length: stepCount }, () => step())
  return { id, role, defaultNote, durationBeats, steps }
}
