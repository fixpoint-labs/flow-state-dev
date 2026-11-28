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
import { chainTaskRunning } from "../src/follow-up-chain";

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

/** A board on the wall clock, the one a claim order reads a lease against; `now` skews it. */
function board(now: () => number = Date.now): TaskCollectionRef {
  return createStateBackedTaskCollection({
    collectionId: "eng.feature.work",
    state: fakeSequencerState() as never,
    onChange: () => undefined,
    now,
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

  // A follow-up in another mode has a run of its own (`<board>/<root>/<its mode>`): its own checkout, branch and
  // session. A root held in its run (waiting on an answer, for as long as that takes) must not keep it
  // from starting. A follow-up in the root's mode shares the root's run, and still waits.
  it("claims a follow-up in another mode while its root runs, and keeps one that may share the root's mode waiting", async () => {
    const tasks = board();
    await tasks.createTask({ id: "root", goal: "add the feature", input: { mode: "implement" } });
    expect((await order().claim(tasks, "w1", bob))?.id).toBe("root");
    await tasks.createTask({ id: "root-review", goal: "review it", input: { mode: "review" }, followUpOf: "root" });
    await tasks.createTask({ id: "root-more", goal: "now also handle X", input: { mode: "Implement" }, followUpOf: "root" });

    expect((await order().claim(tasks, "w2", bob))?.id, "the other-mode follow-up waited on a run it does not share").toBe("root-review");
    expect(await order().claim(tasks, "w3", bob), "the same-mode follow-up was claimed beside its running root").toBeNull();
    expect(tasks.get("root-more")).toMatchObject({ status: "pending", attempts: 0 });

    // A follow-up naming no mode runs as its manager's own, which may be the root's: it waits too.
    await tasks.createTask({ id: "root-plain", goal: "and Y", followUpOf: "root" });
    expect(await order().claim(tasks, "w4", bob), "a follow-up that may share the root's run was claimed beside it").toBeNull();
  });

  // Two tasks of one run both left running with lapsed leases (state the claim did not yet guard against) are
  // each recoverable by the substrate's lease reclaim. Each running sibling must not keep the other from it:
  // one is reclaimed, and the other waits for it, so the run moves again and never has two holders.
  it("reclaims exactly one of two running tasks of a chain whose leases both lapsed", async () => {
    let skew = -10 * 60_000;
    const tasks = board(() => Date.now() + skew);
    await tasks.createTask({ id: "root", goal: "add the feature" });
    await tasks.createTask({ id: "root-f1", goal: "now also handle X", followUpOf: "root" });
    // Both claimed without the narrow, ten minutes ago: two holders whose leases have since lapsed.
    expect((await tasks.claim("w0"))?.id).toBe("root");
    expect((await tasks.claim("w0"))?.id).toBe("root-f1");
    skew = 0;

    const reclaimed = await order().claim(tasks, "w1", bob);
    expect(reclaimed?.id, "neither lapsed task was reclaimed").toBeDefined();
    expect(await order().claim(tasks, "w2", bob), "the second lapsed task was reclaimed beside the first").toBeNull();
  });

  // A pending follow-up waits on its root even once the root's lease lapsed: the root is reclaimed first, so the
  // follow-up never takes over a run whose task is still to finish.
  it("leaves a follow-up pending while its lapsed root is reclaimed", async () => {
    let skew = -10 * 60_000;
    const tasks = board(() => Date.now() + skew);
    await tasks.createTask({ id: "root", goal: "add the feature" });
    expect((await order().claim(tasks, "w0", bob))?.id).toBe("root");
    skew = 0;
    await tasks.createTask({ id: "root-f1", goal: "now also handle X", followUpOf: "root" });

    // Whichever the board's order would claim first, the follow-up is not among them.
    expect(chainTaskRunning(tasks.get("root-f1")!, tasks.list())?.id, "the follow-up passed its lapsed root").toBe("root");
    expect((await order().claim(tasks, "w1", bob))?.id).toBe("root");
    expect(await order().claim(tasks, "w2", bob)).toBeNull();
    expect(tasks.get("root-f1")).toMatchObject({ status: "pending", attempts: 0 });
  });
});
