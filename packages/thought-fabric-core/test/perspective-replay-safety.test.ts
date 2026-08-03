/**
 * Replay safety for the perspective helpers (FIX-995).
 *
 * `createReplayingRef` mirrors the CAS retry loop: the updater runs once
 * against a pre-conflict snapshot whose result is discarded, then once against
 * the state a concurrent writer left behind, and only that second attempt
 * commits. A helper that reports its outcome through a binding declared
 * outside its callback returns the losing attempt's answer here.
 */
import { createReplayingRef } from '@flow-state-dev/testing'
import { describe, it, expect } from 'vitest'
import type {
  PerspectiveObservation,
  PerspectiveObservationsState,
  PerspectivePosition,
  PerspectivePositionsState,
} from '../src/identity/perspective'
import {
  addPerspectiveObservation,
  removePerspectiveObservation,
  addPerspectivePosition,
  challengePerspectivePosition,
  removePerspectivePosition,
} from '../src/identity/perspective-helpers'

function observation(id: string): PerspectiveObservation {
  return {
    id,
    content: `obs-${id}`,
    category: 'observation',
    confidence: 0.7,
    addedAt: 0,
  } as PerspectiveObservation
}

const obsState = (
  observations: PerspectiveObservation[],
  turnCounter = 0
): PerspectiveObservationsState => ({ observations, turnCounter }) as PerspectiveObservationsState

function position(id: string): PerspectivePosition {
  return {
    id,
    claim: `claim-${id}`,
    reasoning: 'because',
    confidence: 0.7,
    supportingObservations: [],
    challenges: [],
    addedAt: 0,
  } as PerspectivePosition
}

const posState = (positions: PerspectivePosition[]): PerspectivePositionsState =>
  ({ positions }) as PerspectivePositionsState

describe('perspective observations — replayed writes report the winning attempt', () => {
  it('removePerspectiveObservation() reports false when the winner no longer holds it', async () => {
    const ref = createReplayingRef(obsState([observation('pobs_1')]), obsState([]))

    expect(await removePerspectiveObservation(ref as never, 'pobs_1')).toBe(false)
  })

  it('removePerspectiveObservation() still reports true when the winner does hold it', async () => {
    const ref = createReplayingRef(
      obsState([observation('pobs_1')]),
      obsState([observation('pobs_1')])
    )

    expect(await removePerspectiveObservation(ref as never, 'pobs_1')).toBe(true)
  })

  it('addPerspectiveObservation() stamps addedAt from the turn that committed', async () => {
    // Decision 5's stale-read class: `addedAt` came from `ref.state.turnCounter`
    // read before the write, so a replay committed — and returned — a record
    // stamped with the losing attempt's counter.
    const ref = createReplayingRef(obsState([], 2), obsState([], 11))

    const added = await addPerspectiveObservation(ref as never, { content: 'hi' })

    expect(added.addedAt).toBe(11)
    expect(ref.committed.observations.at(-1)).toEqual(added)
  })
})

describe('perspective positions — replayed writes report the winning attempt', () => {
  it('challengePerspectivePosition() reports false when the winner no longer holds it', async () => {
    const ref = createReplayingRef(posState([position('ppos_1')]), posState([]))

    expect(await challengePerspectivePosition(ref as never, 'ppos_1', 'evidence')).toBe(false)
  })

  it('removePerspectivePosition() reports false when the winner no longer holds it', async () => {
    const ref = createReplayingRef(posState([position('ppos_1')]), posState([]))

    expect(await removePerspectivePosition(ref as never, 'ppos_1')).toBe(false)
  })

  it('removePerspectivePosition() still reports true when the winner does hold it', async () => {
    const ref = createReplayingRef(posState([position('ppos_1')]), posState([position('ppos_1')]))

    expect(await removePerspectivePosition(ref as never, 'ppos_1')).toBe(true)
  })

  it('addPerspectivePosition() indexes addedAt from the array that committed', async () => {
    // Decision 5's third site: `addedAt` fell back to `ref.state.positions.length`
    // — the very array a conflict would have changed.
    const ref = createReplayingRef(
      posState([position('ppos_1')]),
      posState([position('ppos_1'), position('ppos_2'), position('ppos_3')])
    )

    const added = await addPerspectivePosition(ref as never, { claim: 'c', reasoning: 'r' })

    expect(added.addedAt).toBe(3)
    expect(ref.committed.positions.at(-1)).toEqual(added)
  })
})
