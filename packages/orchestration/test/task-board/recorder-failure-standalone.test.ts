/**
 * What the recorders do about a failed announcement when nobody has told them
 * where to report it (FIX-963).
 *
 * `createRecordSuccess` and `createRecordError` are exported blocks. `taskBoard()`
 * composes them behind a drain that ends in a tail check, and the gate composes
 * them around a handed-off task — but a consumer can compose them itself, and
 * then there is no tail and nothing that will ever read the report.
 *
 * So **deferring is the configured behaviour, not the default one.** A recorder
 * that has not been told a tail is coming raises where it stands, which is what
 * a caller composing these blocks by hand already got before any of this
 * existed: the announcement's rejection propagated. Defaulting to defer instead
 * would make a standalone consumer *quieter* than it was, which is the exact
 * dishonesty this issue exists to remove — reintroduced by its own fix, one
 * caller over.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext, StateRef } from "@flow-state-dev/core/types";
import { runForTest } from "@flow-state-dev/testing";
import {
  createRecordError,
  createRecordSuccess,
} from "../../src/task-board/blocks/record-result";
import { TaskBoardRecorderFailureError } from "../../src/task-board/blocks/recorder-failure";
import {
  createSequencerBackedTaskCollection,
  ticketForClaim,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createFakeSequencerState } from "../helpers";

const ANNOUNCE_ERROR = "change announcement blew up";

interface Fixture {
  collection: TaskCollectionRef;
  sequencer: StateRef<{ currentClaim?: unknown }>;
  emitted: Array<{ component: string; data: Record<string, unknown> }>;
  ctx: BlockContext;
}

/**
 * A claimed row on a conforming backing, wrapped so the named write commits and
 * then throws — the shape of an announcement that runs after the durable write
 * resolves.
 */
async function claimedWithFailingAnnouncement(
  failOn: "complete" | "fail"
): Promise<Fixture> {
  const state = createFakeSequencerState<{ tasks: Record<string, unknown> }>({
    tasks: {},
  });
  const inner = createSequencerBackedTaskCollection({
    collectionId: "tasks",
    sequencer: state,
  });
  await inner.addTask({ id: "t", goal: "work" });
  const task = (await inner.claim("w"))!;

  const collection = {
    ...inner,
    complete: async (...args: Parameters<TaskCollectionRef["complete"]>) => {
      const outcome = await inner.complete(...args);
      if (failOn === "complete") throw new Error(ANNOUNCE_ERROR);
      return outcome;
    },
    fail: async (...args: Parameters<TaskCollectionRef["fail"]>) => {
      const outcome = await inner.fail(...args);
      if (failOn === "fail") throw new Error(ANNOUNCE_ERROR);
      return outcome;
    },
  } as unknown as TaskCollectionRef;

  const bodyState = createFakeSequencerState<{ currentClaim?: unknown }>({
    currentClaim: ticketForClaim("tasks", task),
  });
  const emitted: Array<{ component: string; data: Record<string, unknown> }> =
    [];

  return {
    collection,
    sequencer: bodyState as unknown as StateRef<{ currentClaim?: unknown }>,
    emitted,
    ctx: {
      sequencer: bodyState,
      _emitComponentAwaited: async (
        component: string,
        data: Record<string, unknown>
      ) => {
        emitted.push({ component, data });
      },
    } as unknown as BlockContext,
  };
}

describe("a recorder composed with no reporting wiring raises rather than deferring", () => {
  it("recordSuccess throws when it cannot announce a committed write", async () => {
    const fx = await claimedWithFailingAnnouncement("complete");

    const block = createRecordSuccess({
      name: "standalone-record-success",
      collection: async () => fx.collection,
      // No `recorderFailure`. There is no drain around this block.
    });

    await expect(
      runForTest(block, { ok: true }, fx.ctx)
    ).rejects.toBeInstanceOf(TaskBoardRecorderFailureError);

    // Still reported, so the entry is there for anyone who does read the stream.
    expect(fx.emitted).toHaveLength(1);
    expect(fx.emitted[0]?.data).toMatchObject({
      recorder: "complete",
      verdict: "committed",
    });
    // And with no drain to scope the read to, it carries no run stamp.
    expect(fx.emitted[0]?.data.runId).toBeUndefined();
  });

  it("recordError throws too, and `onError` does not decide it", async () => {
    const fx = await claimedWithFailingAnnouncement("fail");

    const block = createRecordError({
      name: "standalone-record-error",
      collection: async () => fx.collection,
      // `"skip"` is the setting that would swallow an ordinary worker failure.
      // It has no say here: the board's own bookkeeping is not a task outcome.
      onError: "skip",
    });

    await expect(
      runForTest(block, new Error("worker blew up"), fx.ctx)
    ).rejects.toBeInstanceOf(TaskBoardRecorderFailureError);

    expect(fx.emitted).toHaveLength(1);
    expect(fx.emitted[0]?.data).toMatchObject({ recorder: "fail" });
  });

  it("still returns quietly when a tail is declared — the drain's own case", async () => {
    // The control, and the reason the default matters: `taskBoard()` says
    // `defer` explicitly, and only then does the recorder return so the
    // siblings can finish before the tail fails the run.
    const fx = await claimedWithFailingAnnouncement("complete");

    const block = createRecordSuccess({
      name: "deferring-record-success",
      collection: async () => fx.collection,
      recorderFailure: { onRecorderFailure: "defer" },
    });

    await expect(
      runForTest(block, { ok: true }, fx.ctx)
    ).resolves.toBeUndefined();
    expect(fx.emitted).toHaveLength(1);
  });
});
