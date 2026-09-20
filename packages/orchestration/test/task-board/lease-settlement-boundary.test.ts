/**
 * Where renewal stops relative to the write it protects (FIX-1005).
 *
 * The lease exists so a task is not worked twice. `complete()` and `fail()` are
 * fenced on the worker's claim ticket, and the fence refuses a write on a row
 * whose lease has lapsed — so the instant renewal stops is the instant a
 * finished worker's result becomes refusable. Stop it before the settlement and
 * a lease that expires during one store round trip turns a HEALTHY worker's
 * completed work into a lost claim: the task is recovered, another worker takes
 * it, and every side effect the first one already committed happens again. The
 * mechanism causes the exact failure it exists to prevent.
 *
 * The opposite ordering carries no matching hazard. A renewal in flight across
 * a settlement writes one field, `leaseUntil`; against a row that has just been
 * settled the fence declines it and the driver stops itself.
 *
 * So both recorders must stop renewal AFTER their write. The assertion below is
 * that boundary directly — was a renewal still scheduled at the instant the
 * fenced write began — rather than a race that would only fail sometimes.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext, StateRef } from "@flow-state-dev/core/types";
import { runForTest } from "@flow-state-dev/testing";
import {
  createRecordError,
  createRecordSuccess,
} from "../../src/task-board/blocks/record-result";
import {
  createSequencerBackedTaskCollection,
  startLeaseRenewal,
  ticketForClaim,
  type RenewalTimer,
  type TaskCollectionRef,
} from "../../src/tasks";
import {
  openLeaseRenewalScope,
  stampLeaseRenewal,
} from "../../src/tasks/lease-renewal-scope";
import { createFakeSequencerState } from "../helpers";

/**
 * A timer that never fires on its own but reports whether a tick is still
 * scheduled. A stopped driver cancels its pending tick, so "still scheduled" is
 * exactly "renewal has not been stopped yet".
 */
function countingTimer(): { timer: RenewalTimer; pending: () => number } {
  const entries: { cancelled: boolean }[] = [];
  return {
    timer: () => {
      const entry = { cancelled: false };
      entries.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    pending: () => entries.filter((e) => !e.cancelled).length,
  };
}

interface Fixture {
  collection: TaskCollectionRef;
  /** One entry per settlement: whether renewal was still scheduled then. */
  seen: string[];
  sequencer: StateRef<{ currentClaim?: unknown }>;
  /** Ticks still scheduled — non-zero means the driver has not been stopped. */
  pending: () => number;
}

/**
 * A claimed row, a running driver, and a collection that watches settlements.
 *
 * The caller opens the renewal scope itself, as its own first statement —
 * `enterWith` publishes to the async resource it runs on, so opening it in here
 * (past an `await`) would publish to a resource that dies with this helper and
 * leave each test reading whatever scope happened to be current.
 */
async function claimedUnderRenewal(): Promise<Fixture> {
  const state = createFakeSequencerState<{ tasks: Record<string, unknown> }>({
    tasks: {},
  });
  const inner = createSequencerBackedTaskCollection({
    collectionId: "tasks",
    sequencer: state,
  });
  await inner.addTask({ id: "t", goal: "work" });
  const task = (await inner.claim("w", { leaseDurationMs: 30_000 }))!;

  const clock = countingTimer();
  const seen: string[] = [];
  const label = () => (clock.pending() > 0 ? "renewing" : "stopped");

  const collection = {
    ...inner,
    complete: async (...args: Parameters<TaskCollectionRef["complete"]>) => {
      seen.push(`complete:${label()}`);
      return inner.complete(...args);
    },
    fail: async (...args: Parameters<TaskCollectionRef["fail"]>) => {
      seen.push(`fail:${label()}`);
      return inner.fail(...args);
    },
  } as unknown as TaskCollectionRef;

  const ticket = ticketForClaim("tasks", task);
  const bodyState = createFakeSequencerState<{ currentClaim?: unknown }>({
    currentClaim: ticket,
  });

  stampLeaseRenewal(
    startLeaseRenewal({
      collection,
      ticket,
      claimedTask: task,
      timer: clock.timer,
    })
  );
  // A 30s lease phases the first tick 10s out, so exactly one is scheduled and
  // none of them can fire during the test.
  expect(clock.pending()).toBe(1);

  return {
    collection,
    seen,
    sequencer: bodyState as unknown as StateRef<{ currentClaim?: unknown }>,
    pending: clock.pending,
  };
}

describe("the board's recorders stop renewal AFTER the fenced write", () => {
  it("recordSuccess is still renewing when complete() runs", async () => {
    openLeaseRenewalScope();
    const fx = await claimedUnderRenewal();

    const block = createRecordSuccess({
      name: "record-success",
      collection: async () => fx.collection,
    });

    await runForTest(block, { ok: true }, {
      sequencer: fx.sequencer,
    } as unknown as BlockContext);

    expect(fx.seen).toEqual(["complete:renewing"]);
  });

  it("recordError is still renewing when fail() runs", async () => {
    openLeaseRenewalScope();
    const fx = await claimedUnderRenewal();

    const block = createRecordError({
      name: "record-error",
      collection: async () => fx.collection,
      onError: "skip",
    });

    const result = await runForTest(block, new Error("boom"), {
      sequencer: fx.sequencer,
    } as unknown as BlockContext);

    expect((result as { recorded: string }).recorded).toBe("errored");
    expect(fx.seen).toEqual(["fail:renewing"]);
  });
});

describe("a recorder whose own write FAILS leaves renewal for its successor", () => {
  // The second half of the same boundary. `recordSuccess` stopping renewal on
  // the way out is right when `complete()` settled, and wrong when it threw:
  // the worker body's `.rescue()` then runs `recordError`, whose `fail()` is
  // fenced on the same claim. Stopping first hands that recovery write a lapsed
  // lease, so it is declined `lost-claim` and finished work is recovered and
  // repeated — the same failure as before, one exception path over.
  //
  // The rule this pins is not "stop on the way out" but "stop once no further
  // fenced write can follow".

  it("recordSuccess leaves the driver RUNNING when complete() throws", async () => {
    openLeaseRenewalScope();
    const fx = await claimedUnderRenewal();

    const exploding = {
      ...fx.collection,
      complete: async () => {
        throw new Error("store unreachable");
      },
    } as unknown as TaskCollectionRef;

    const block = createRecordSuccess({
      name: "record-success",
      collection: async () => exploding,
    });

    await expect(
      runForTest(block, { ok: true }, {
        sequencer: fx.sequencer,
      } as unknown as BlockContext)
    ).rejects.toThrow("store unreachable");

    // Still renewing, so the rescue's fenced `fail()` will not be refused.
    expect(fx.pending()).toBe(1);
  });

  it("and the rescue's fail() then runs while renewal is still live", async () => {
    // End to end over the two handlers, in the order the worker body runs them.
    openLeaseRenewalScope();
    const fx = await claimedUnderRenewal();

    const exploding = {
      ...fx.collection,
      complete: async () => {
        throw new Error("store unreachable");
      },
    } as unknown as TaskCollectionRef;

    const success = createRecordSuccess({
      name: "record-success",
      collection: async () => exploding,
    });
    await expect(
      runForTest(success, { ok: true }, {
        sequencer: fx.sequencer,
      } as unknown as BlockContext)
    ).rejects.toThrow("store unreachable");

    const rescue = createRecordError({
      name: "record-error",
      collection: async () => fx.collection,
      onError: "skip",
    });
    await runForTest(rescue, new Error("store unreachable"), {
      sequencer: fx.sequencer,
    } as unknown as BlockContext);

    expect(fx.seen).toEqual(["fail:renewing"]);
    // And only now is the driver released.
    expect(fx.pending()).toBe(0);
  });
});

describe("the swallow path releases the driver itself (FIX-963)", () => {
  // The exception above is narrow, and this is its other edge. When
  // `complete()` throws having ALREADY COMMITTED, no `.rescue()` follows: the
  // recorder reports the failure and returns rather than handing the error on.
  // So nothing is coming to make a further fenced write, and leaving the driver
  // running would renew a lease on a row nobody is coming back for — the timer
  // ticking on against a settled task until the request's signal aborts it.
  //
  // The test above and this one are the two halves of "stop once no further
  // fenced write can follow": there, one can; here, none can.

  /** A ctx that accepts an awaited component emit and records what it got. */
  function ctxWith(
    fx: Fixture,
    emitted: Array<{ component: string; data: Record<string, unknown> }>
  ): BlockContext {
    return {
      sequencer: fx.sequencer,
      _emitComponentAwaited: async (
        component: string,
        data: Record<string, unknown>
      ) => {
        emitted.push({ component, data });
      },
    } as unknown as BlockContext;
  }

  it("recordSuccess stops renewal when complete() committed and then threw", async () => {
    openLeaseRenewalScope();
    const fx = await claimedUnderRenewal();

    const announceFails = {
      ...fx.collection,
      complete: async (...args: Parameters<TaskCollectionRef["complete"]>) => {
        await fx.collection.complete(...args);
        throw new Error("change announcement blew up");
      },
    } as unknown as TaskCollectionRef;

    const emitted: Array<{ component: string; data: Record<string, unknown> }> =
      [];
    const block = createRecordSuccess({
      name: "record-success",
      collection: async () => announceFails,
    });

    // It returns rather than throwing — the deferring site leaves the raise to
    // the drain's tail.
    await runForTest(block, { ok: true }, ctxWith(fx, emitted));

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.data).toMatchObject({ verdict: "committed" });
    // The assertion this block exists for.
    expect(fx.pending()).toBe(0);
  });

  it("recordError stops renewal on the same path", async () => {
    openLeaseRenewalScope();
    const fx = await claimedUnderRenewal();

    const announceFails = {
      ...fx.collection,
      fail: async (...args: Parameters<TaskCollectionRef["fail"]>) => {
        await fx.collection.fail(...args);
        throw new Error("change announcement blew up");
      },
    } as unknown as TaskCollectionRef;

    const emitted: Array<{ component: string; data: Record<string, unknown> }> =
      [];
    const block = createRecordError({
      name: "record-error",
      collection: async () => announceFails,
      onError: "skip",
    });

    await runForTest(block, new Error("boom"), ctxWith(fx, emitted));

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.data).toMatchObject({ recorder: "fail" });
    expect(fx.pending()).toBe(0);
  });
});
