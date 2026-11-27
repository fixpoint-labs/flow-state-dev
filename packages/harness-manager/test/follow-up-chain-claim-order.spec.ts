/**
 * `followUpChainClaimOrder` and `runOwnerClaimOrder` against a real task collection.
 *
 * A follow-up continues its root's checkout and coding session, so it must not start while another task of its
 * chain runs. Refusing after the claim spends an attempt: with no retries the follow-up errors for good, with
 * retries the board can spend them all before the root ends. So the wait is decided at the claim, where a task
 * passed over stays pending and uncharged, and starts once the running task of its chain ends. Drop the narrow
 * and the first test claims the follow-up beside its running root.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import type { ClaimOrder, TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { createStateBackedTaskCollection } from "@flow-state-dev/orchestration/internal";
import { followUpChainClaimOrder, runOwnerClaimOrder } from "../src";

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

const bob = { user: { identity: { id: "bob:~org:acme", userId: "bob" } }, request: { identity: { orgId: "acme" } } } as unknown as BlockContext;

const orders: [string, () => ClaimOrder][] = [
  ["followUpChainClaimOrder", followUpChainClaimOrder],
  ["runOwnerClaimOrder", runOwnerClaimOrder],
];

describe.each(orders)("%s and a follow-up chain", (_name, order) => {
  it("leaves a follow-up pending and uncharged while its root runs, and claims it once the root completes", async () => {
    const tasks = board();
    await tasks.createTask({ id: "root", goal: "add the feature" });
    expect((await order().claim(tasks, "w1", bob))?.id).toBe("root");
    await tasks.createTask({ id: "root-f1", goal: "now also handle X", followUpOf: "root" });

    expect(await order().claim(tasks, "w2", bob), "the follow-up was claimed beside its running root").toBeNull();
    expect(tasks.get("root-f1")).toMatchObject({ status: "pending", attempts: 0 });

    await tasks.complete("root", { done: true });
    expect((await order().claim(tasks, "w2", bob))?.id).toBe("root-f1");
    expect(tasks.get("root-f1")).toMatchObject({ status: "in_progress", attempts: 1 });
  });

  it("starts one of two follow-ups claimed at once, and the other after it, never both and never neither", async () => {
    const tasks = board();
    await tasks.createTask({ id: "root", goal: "add the feature" });
    await order().claim(tasks, "w0", bob);
    await tasks.complete("root", { done: true });
    await tasks.createTask({ id: "root-f1", goal: "handle X", followUpOf: "root" });
    await tasks.createTask({ id: "root-f2", goal: "handle Y", followUpOf: "root" });

    const [a, b] = await Promise.all([order().claim(tasks, "w1", bob), order().claim(tasks, "w2", bob)]);
    const started = [a, b].filter((task) => task !== null);
    expect(started.map((task) => task!.id)).toEqual(["root-f1"]);
    expect(tasks.get("root-f2")).toMatchObject({ status: "pending", attempts: 0 });

    await tasks.complete("root-f1", { done: true });
    expect((await order().claim(tasks, "w1", bob))?.id).toBe("root-f2");
  });

  it("claims a task of another chain while a chain runs", async () => {
    const tasks = board();
    await tasks.createTask({ id: "root", goal: "add the feature" });
    await order().claim(tasks, "w1", bob);
    await tasks.createTask({ id: "root-f1", goal: "now also handle X", followUpOf: "root" });
    await tasks.createTask({ id: "other", goal: "unrelated" });
    expect((await order().claim(tasks, "w2", bob))?.id).toBe("other");
  });
});
