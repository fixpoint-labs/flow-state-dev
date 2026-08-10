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
  openLeaseRenewalScope,
  stampLeaseRenewal,
  startLeaseRenewal,
  ticketForClaim,
  type RenewalTimer,
  type TaskCollectionRef,
} from "../../src/tasks";
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
