import {
  genBreakdown,
  genDenseBass,
  genDoubleTime,
  genFalseKick,
  genGap2s,
  genGap500ms,
  genHalfTime,
  genJitter150,
  genLeadHeavy,
  genMissingBeat,
  genPerfect150,
  genSparse,
  genTempoJump,
  genTempoRamp,
} from './generators.ts'
import type { Fixture } from './types.ts'

export const corpus: Fixture[] = [
  genPerfect150(),
  genJitter150(),
  genTempoRamp(),
  genTempoJump(),
  genMissingBeat(),
  genFalseKick(),
  genHalfTime(),
  genDoubleTime(),
  genGap500ms(),
  genGap2s(),
  genSparse(),
  genDenseBass(),
  genLeadHeavy(),
  genBreakdown(),
]

export function getFixture(id: string): Fixture {
  const f = corpus.find((x) => x.id === id)
  if (!f) throw new Error(`Unknown fixture: ${id}`)
  return f
}
