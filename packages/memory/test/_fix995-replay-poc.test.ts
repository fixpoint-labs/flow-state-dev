/**
 * Throwaway POC for FIX-995. Not shipped.
 *
 * Proves that a replayed `updateState` updater makes first-party helpers report
 * work that never committed. The fake ref runs the updater TWICE — attempt 1
 * against the pre-conflict state (its result is discarded, exactly as a losing
 * CAS attempt's is), attempt 2 against the winner's state, which is what
 * commits. That is the shape `runWithCAS` (engine/src/stores/cas.ts:131-160)
 * already implements for scope state and FIX-992 brings to resource state.
 */
import { describe, expect, it } from 'vitest'
import { evict, pin } from '../src/working-memory-helpers'
import { cullByTTL, markStale } from '../src/episodic-memory-helpers'

/** A ref whose `updateState` replays the updater once, mimicking one lost CAS round. */
function replayingRef<S extends object>(attempt1State: S, winnerState: S) {
  let committed: S = winnerState
  return {
    get state() {
      return committed
    },
    async updateState(updater: (s: S) => S | Promise<S>) {
      await updater(structuredClone(attempt1State)) // losing attempt — discarded
      committed = (await updater(structuredClone(winnerState))) as S // winning attempt
    },
  } as any
}

describe('FIX-995 — replayed updater reports uncommitted work', () => {
  it('evict() returns true for an entry it did not remove', async () => {
    const entry = { id: 'wm_1', content: 'x', importance: 1, salience: 1, pinned: false, addedAtTurn: 0, lastAccessedAtTurn: 0, durability: 'session', category: 'identity' }
    // Attempt 1 sees the entry. The winner already removed it, so attempt 2 no-ops.
    const ref = replayingRef({ entries: [entry], currentTurn: 0 }, { entries: [], currentTurn: 0 })

    const removed = await evict(ref, 'wm_1')

    expect(ref.state.entries).toHaveLength(0)
    expect(removed).toBe(false) // FAILS today: returns true
  })

  it('pin() returns true when the pin slots filled up under it', async () => {
    const target = { id: 'wm_1', content: 'x', importance: 1, salience: 1, pinned: false, addedAtTurn: 0, lastAccessedAtTurn: 0, durability: 'session', category: 'identity' }
    const other = (id: string) => ({ ...target, id, pinned: true })
    // Attempt 1: no pins, slot free. Winner: both slots taken.
    const ref = replayingRef(
      { entries: [target], currentTurn: 0 },
      { entries: [target, other('wm_2'), other('wm_3')], currentTurn: 0 },
    )

    const ok = await pin(ref, 'wm_1', { maxPinnedSlots: 2 })

    expect(ref.state.entries.find((e: any) => e.id === 'wm_1').pinned).toBe(false)
    expect(ok).toBe(false) // FAILS today: returns true
  })

  it('cullByTTL() accumulates IDs across attempts', async () => {
    const ep = (id: string) => ({ id, durability: 'persistent', occurredAtTurn: 0, encodedAt: '2020-01-01T00:00:00.000Z', consolidated: false, stale: false, content: 'x', subject: 'user' })
    // Attempt 1 sees ep_a and ep_b; the winner already culled ep_a.
    const ref = replayingRef(
      { episodes: [ep('ep_a'), ep('ep_b')], totalEncoded: 2 },
      { episodes: [ep('ep_b')], totalEncoded: 2 },
    )

    const culled = await cullByTTL(ref, 999, Date.parse('2030-01-01'), { persistentTurns: 1, persistentDays: 1, operator: 'OR' })

    expect(ref.state.episodes).toHaveLength(0)
    expect(culled).toEqual(['ep_b']) // FAILS today: ['ep_a','ep_b','ep_b']
  })

  it('markStale() accumulates IDs across attempts', async () => {
    const ep = (id: string, stale = false) => ({ id, durability: 'permanent', occurredAtTurn: 0, encodedAt: '2020-01-01T00:00:00.000Z', consolidated: false, stale, content: 'x', subject: 'user' })
    const ref = replayingRef(
      { episodes: [ep('ep_a'), ep('ep_b')], totalEncoded: 2 },
      { episodes: [ep('ep_a', true), ep('ep_b')], totalEncoded: 2 },
    )

    const marked = await markStale(ref, Date.parse('2030-01-01'), 1)

    expect(marked).toEqual(['ep_b']) // FAILS today: ['ep_a','ep_b','ep_b']
  })
})
