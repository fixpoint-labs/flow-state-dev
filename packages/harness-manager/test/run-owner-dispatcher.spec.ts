/**
 * `runOwnerDispatcher` against a real task collection.
 *
 * The dispatcher's whole job is the claim's `eligibility`: another member's
 * row is never claimed, so it is never charged an attempt, and this member's
 * own row behind it still is. Drop the narrowing and the first test claims
 * Alice's row for Bob.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  createStateBackedTaskCollection,
  type TaskCollectionRef,
} from "@flow-state-dev/orchestration/tasks";
import { HARNESS_RUN_OWNER_KEY, runOwnerDispatcher } from "../src";

/** A minimal in-memory sequencer state: read, and serialized atomic writes. */
function fakeSequencerState(): unknown {
  let state: Record<string, unknown> = { tasks: {} };
  let busy: Promise<void> = Promise.resolve();
  const write = (next: Record<string, unknown>) => {
    state = { ...state, ...next };
  };
  return {
    name: "fake-sequencer",
    instanceId: "fake-sequencer#0",
    input: undefined,
    get state() {
      return state;
    },
    async patchState(updates: Record<string, unknown>) {
      await busy;
      write(updates);
    },
    async setState(next: Record<string, unknown>) {
      await busy;
      state = { ...next };
    },
    async atomicState(mutator: (s: Record<string, unknown>) => Record<string, unknown>) {
      const next = busy.then(() => write(mutator(state)));
      busy = next.catch(() => undefined);
      return next;
    },
  };
}

function board(): TaskCollectionRef {
  let clock = 0;
  return createStateBackedTaskCollection({
    collectionId: "eng.feature.work",
    state: fakeSequencerState() as never,
    onChange: () => undefined,
    now: () => ++clock,
  });
}

const as = (userId: string) => ({ user: { identity: { id: `${userId}:~org:acme`, userId } } }) as unknown as BlockContext;

async function ownedBy(tasks: TaskCollectionRef, id: string, userId: string) {
  await tasks.addTask({ id, goal: id });
  await tasks.patchMetadata(id, { [HARNESS_RUN_OWNER_KEY]: { userId } });
}

describe("runOwnerDispatcher", () => {
  it("skips another member's row, so the drainer's own row behind it is claimed", async () => {
    const tasks = board();
    // Alice's row is older, so it is first in claim order.
    await ownedBy(tasks, "alices", "alice");
    await ownedBy(tasks, "bobs", "bob");

    const claimed = await runOwnerDispatcher().claim(tasks, "w", as("bob"));

    expect(claimed?.id, "Bob's drain did not reach Bob's own row").toBe("bobs");
    // Alice's row is exactly as it was: never claimed, so never charged.
    expect(tasks.get("alices")?.status).toBe("pending");
    expect(tasks.get("alices")?.attempts ?? 0).toBe(0);
  });

  it("refuses, naming the owner, when the only live row is someone else's", async () => {
    const tasks = board();
    await ownedBy(tasks, "alices", "alice");

    await expect(runOwnerDispatcher().claim(tasks, "w", as("bob"))).rejects.toThrow(/"alice"/);
    expect(tasks.get("alices")?.status).toBe("pending");
    expect(tasks.get("alices")?.attempts ?? 0).toBe(0);
  });

  it("claims an unowned row for anyone, and returns null on an empty board", async () => {
    const tasks = board();
    await expect(runOwnerDispatcher().claim(tasks, "w", as("bob"))).resolves.toBeNull();
    await tasks.addTask({ id: "fresh", goal: "fresh" });
    expect((await runOwnerDispatcher().claim(tasks, "w", as("bob")))?.id).toBe("fresh");
  });
});
