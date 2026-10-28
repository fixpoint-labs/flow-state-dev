/** `upgradeKeptTurns` (FIX-2086): a kept untaken turn becomes a steer, keyed so a second run adds nothing. */
import { describe, expect, it } from "vitest";
import { encodeUserSegment } from "@flow-state-dev/core/types";
import { upgradeKeptTurns, type KeptTurnUpgradeStores } from "../src";
import { runBoardSegment } from "../src/workspace";

const CELL = "alice:~org:acme";
const LEDGER = "tasks";
const PARTITION = "conv-1";

/** A user cell's resource state, in memory, with versions. */
function fakeStores(seed: Record<string, unknown>): KeptTurnUpgradeStores & { state: Map<string, { state: unknown; version: number }> } {
  const state = new Map<string, { state: unknown; version: number }>(Object.entries(seed).map(([key, value]) => [key, { state: value, version: 1 }]));
  return {
    state,
    session: { list: async () => [{ userId: "alice", orgId: "acme" }] },
    resourceState: {
      getByPrefix: async (_scope, cell, prefix) =>
        cell !== CELL ? {} : Object.fromEntries([...state.entries()].filter(([key]) => key.startsWith(prefix))),
      set: async (_scope, _cell, key, next, expected) => {
        const current = state.get(key);
        if (current?.version !== expected) return { ok: false, conflict: { currentValue: current?.state, currentVersion: current?.version ?? 0 } };
        state.set(key, { state: next, version: expected + 1 });
        return { ok: true, version: expected + 1 };
      },
    },
  };
}

const rowKey = (id: string) => `${LEDGER}/${encodeUserSegment(PARTITION)}/${id}`;
const runKey = (issue: string, phase: string) => `runs/${runBoardSegment(LEDGER, PARTITION)}/${issue}/${phase}`;
const turn = (patch: Record<string, unknown>) => ({ message: "", keptAt: 1, forAttempt: 1, deliveredTo: null, withdrawn: false, ...patch });
const options = { userCell: () => CELL, ledgers: [LEDGER] };

describe("upgradeKeptTurns", () => {
  it("writes each kept turn no attempt took onto its task as an untaken steer from its person, once", async () => {
    const stores = fakeStores({
      [rowKey("t1")]: { id: "t1", goal: "g", status: "parked", parkedForTurn: true, attempts: 1 }, // retired-name-refusal: the row shape the message door stored
      [runKey("t1", "answer")]: { taskId: "t1", sessionId: "sess_1" },
      "turns/t1/answer/2/aaaa": turn({ message: "Use the v2 API.", keptAt: 5, forAttempt: 2 }),
      "turns/t1/answer/1/bbbb": turn({ message: "Already taken.", deliveredTo: 1 }),
      "turns/t1/answer/2/cccc": turn({ message: "Withdrawn.", withdrawn: true }),
    });

    expect(await upgradeKeptTurns(stores, options)).toBe(1);
    expect((stores.state.get(rowKey("t1"))!.state as { steers: unknown[] }).steers).toEqual([
      { id: "turn:turns/t1/answer/2/aaaa", message: "Use the v2 API.", from: "user", by: "alice", at: 5 },
    ]);

    // A second run adds nothing.
    expect(await upgradeKeptTurns(stores, options)).toBe(0);
    expect((stores.state.get(rowKey("t1"))!.state as { steers: unknown[] }).steers).toHaveLength(1);
  });

  it("leaves a row waiting on its filed work waiting on it: the check that work's end wakes owes the steer its turn", async () => {
    const stores = fakeStores({
      [rowKey("t1")]: { id: "t1", goal: "g", status: "in_progress", keptOpenBy: "filed", attempts: 1 },
      [runKey("t1", "answer")]: { taskId: "t1", sessionId: "sess_1" },
      "turns/t1/answer/1/aaaa": turn({ message: "Use the v2 API." }),
    });

    expect(await upgradeKeptTurns(stores, options)).toBe(1);
    // Waiting on the steer would owe a turn nothing here starts.
    expect(stores.state.get(rowKey("t1"))!.state).toMatchObject({
      keptOpenBy: "filed",
      steers: [expect.objectContaining({ message: "Use the v2 API." })],
    });
  });

  it("leaves a finished task alone: a finished task takes no steer", async () => {
    const stores = fakeStores({
      [rowKey("t1")]: { id: "t1", goal: "g", status: "completed", attempts: 1, output: "done" },
      [runKey("t1", "answer")]: { taskId: "t1" },
      "turns/t1/answer/2/aaaa": turn({ message: "Too late." }),
    });
    expect(await upgradeKeptTurns(stores, options)).toBe(0);
    expect(stores.state.get(rowKey("t1"))!.state).not.toHaveProperty("steers");
  });

  it("finds the row through its run record only: a turn whose run names another task is not written onto this one", async () => {
    const stores = fakeStores({
      [rowKey("t1")]: { id: "t1", goal: "g", status: "pending", attempts: 1 },
      [runKey("t1", "answer")]: { taskId: "t2" },
      "turns/t1/answer/2/aaaa": turn({ message: "For another run." }),
    });
    expect(await upgradeKeptTurns(stores, options)).toBe(0);
  });
});
