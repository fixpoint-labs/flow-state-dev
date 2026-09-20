/**
 * FIX-963 — a recorder failure AFTER a task's result has committed must not be
 * swallowed, and must not abandon the board.
 *
 * Both backings announce a task change as a tail call, strictly after the
 * durable write resolves. So a failure in the announcement rejects a call whose
 * write already landed, and the two recorder blocks wrapped around every worker
 * see it as an ordinary throw. Today that produces two different wrong answers
 * from one root cause:
 *
 *   - on the SUCCESS path the throw is handed to the per-worker rescue, which
 *     writes the failure and (under `onError: "skip"`) swallows it — the drain
 *     reports `completed` with `error === undefined`, and the only trace is on
 *     transient items nothing persists;
 *   - on the ERROR path nothing catches it at all: it escapes the rescue, the
 *     `forEach` rejects, and every task that had not started is abandoned.
 *
 * Lives here rather than in `packages/orchestration` for the reason FIX-951's
 * sibling scenario does: the escape only emerges from full `runAction`
 * composition — worker sequencer → `.rescue()` → `.forEach` fan-out. A passing
 * block-level test proves nothing about it.
 *
 * The announcement failure is injected through a store wrapper that delegates
 * the write and then throws, which is the real shape: commit first, announce
 * second, outside the write's own `try`.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import {
  taskBoard,
  taskBoardStateSchema,
  taskWorkerInputSchema,
} from "@flow-state-dev/orchestration/task-board";
import {
  getOrCreateTaskCollection,
  type Task,
  type TaskCollectionRef,
} from "@flow-state-dev/orchestration";
import { testFlow } from "@flow-state-dev/testing";
import { z } from "zod";
import { itemsByType } from "../helpers/assertions";

const COLLECTION_ID = "recorder-failure-board";
/** Held-out value the siblings must carry, so a hollow pass can't sneak through. */
const SALT = "salt-7c02";
const ANNOUNCE_ERROR = "change announcement blew up";
const REPORT_ERROR = "report emission blew up";
const POISON = "poison";
const RECORDER_FAILURE_COMPONENT = "task-board-recorder-failure";

/**
 * How much write provenance the store hands back on a read.
 *
 * - `keep` — a conforming built-in backing. `didWriteLand` can answer.
 * - `none` — a ref that maintains no provenance at all. The permanent answer
 *   for a caller-supplied store: *cannot tell*.
 * - `no-incarnation` — a row that was already in a persistent store before
 *   write provenance shipped. Nothing backfills the nonce, so this is also
 *   *cannot tell*, and permanently so.
 */
type Provenance = "keep" | "none" | "no-incarnation";

function stripProvenance<T extends Task>(task: T, mode: Provenance): T {
  if (mode === "keep") return task;
  if (mode === "no-incarnation") return { ...task, incarnationId: undefined };
  return {
    ...task,
    revision: undefined,
    writeLog: undefined,
    writeLogTruncated: undefined,
    incarnationId: undefined,
  };
}

/**
 * When the store throws relative to the durable write.
 *
 * - `after-commit` — the real shape of this defect: the write lands, the change
 *   announcement runs as a tail call, and THAT throws.
 * - `before-commit` — the store is simply down and the task is untouched.
 *   Nothing was saved, nothing is uncertain, and this must keep reaching the
 *   caller exactly as it does today.
 */
type FailPoint = "after-commit" | "before-commit";

/** Every task whose id starts with this is poisoned. */
function isPoisoned(id: string): boolean {
  return id.startsWith(POISON);
}

/**
 * A store that fails one of its two write-backs, either side of the commit.
 * Everything else delegates.
 */
function announcementFailingStore(
  inner: TaskCollectionRef,
  options: {
    failOn: "complete" | "fail";
    failPoint?: FailPoint;
    provenance?: Provenance;
  }
): TaskCollectionRef {
  const { failOn, failPoint = "after-commit", provenance = "keep" } = options;
  const view = (task: Task | undefined) =>
    task === undefined ? undefined : stripProvenance(task, provenance);
  const write = async <T>(
    verb: "complete" | "fail",
    id: string,
    commit: () => Promise<T>
  ): Promise<T> => {
    const poisoned = failOn === verb && isPoisoned(id);
    if (poisoned && failPoint === "before-commit") {
      throw new Error(ANNOUNCE_ERROR);
    }
    const outcome = await commit();
    if (poisoned) throw new Error(ANNOUNCE_ERROR);
    return outcome;
  };
  return {
    ...inner,
    get: ((id: string) => view(inner.get(id) as Task | undefined)) as never,
    list: ((filter?: never) =>
      (inner.list(filter) as Task[]).map((t) => view(t))) as never,
    complete: ((id: string, output: unknown, opts?: never) =>
      write("complete", id, () => inner.complete(id, output, opts))) as never,
    fail: ((id: string, error: string, opts?: never) =>
      write("fail", id, () => inner.fail(id, error, opts))) as never,
  };
}

function buildFlow(options: {
  failOn: "complete" | "fail";
  onError: "skip" | "fail";
  provenance?: Provenance;
  collectionId?: string;
  kind?: string;
  /**
   * Make the REPORT itself fail. The collection factory is handed the
   * recorder's own context, which is the context the report is emitted
   * through — so this reaches the real seam rather than a stand-in.
   */
  breakReporting?: boolean;
  failPoint?: FailPoint;
  tasks?: Array<{ id: string; goal: string }>;
  /** Run the drain twice in one request, to prove a second batch is independent. */
  batches?: number;
}) {
  const collectionId = options.collectionId ?? COLLECTION_ID;
  const worker = handler({
    name: "recorder-failure-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ ok: z.string() }),
    execute: async (input) => {
      // On the error-path half the poisoned worker has to FAIL, so the error
      // recorder is the one that writes. Its own failure is ordinary worker
      // trouble; the recorder failing to announce it is the defect.
      if (options.failOn === "fail" && isPoisoned(input.taskId)) {
        throw new Error("worker blew up");
      }
      return { ok: `${input.goal}:${SALT}` };
    },
  }) as Parameters<typeof taskBoard>[0]["workers"];

  const board = taskBoard({
    name: collectionId,
    collection: async (ctx) => {
      if (options.breakReporting === true) {
        (
          ctx as unknown as { _emitComponentAwaited?: unknown }
        )._emitComponentAwaited = () =>
          Promise.reject(new Error(REPORT_ERROR));
      }
      return announcementFailingStore(
        await getOrCreateTaskCollection({ ctx, backing: "request", collectionId }),
        {
          failOn: options.failOn,
          ...(options.provenance !== undefined
            ? { provenance: options.provenance }
            : {}),
          ...(options.failPoint !== undefined
            ? { failPoint: options.failPoint }
            : {}),
        }
      );
    },
    concurrency: 2,
    workers: worker,
    initialTasks: options.tasks ?? [
      { id: POISON, goal: POISON },
      { id: "sibling-a", goal: "sibling-a" },
      { id: "sibling-b", goal: "sibling-b" },
    ],
    onError: options.onError,
    onIdle: "complete",
    maxIterations: 50,
  });

  const root = sequencer({
    name: "recorder-failure-root",
    inputSchema: z.unknown(),
    stateSchema: taskBoardStateSchema,
  }).step(board.drain);

  return defineFlow({
    kind: options.kind ?? "fix963-recorder-failure",
    actions: {
      run: {
        block:
          (options.batches ?? 1) > 1
            ? root.step(board.drain)
            : root,
      },
    },
  })();
}

function finalStatuses(
  items: readonly unknown[],
  collectionId: string = COLLECTION_ID
): Record<string, string> {
  const statuses: Record<string, string> = {};
  for (const item of itemsByType(items as never, "component")) {
    const data = (item as { data?: Record<string, unknown> }).data;
    if (data?.collectionId !== collectionId) continue;
    const task = data.task as { id?: string; status?: string } | undefined;
    if (task?.id === undefined || task.status === undefined) continue;
    statuses[task.id] = task.status;
  }
  return statuses;
}

/** Every recorder-failure entry on the stream, in order. */
function recorderFailureItems(items: readonly unknown[]): Array<{
  transient?: boolean;
  data: Record<string, unknown>;
}> {
  return itemsByType(items as never, "component")
    .filter(
      (i) =>
        (i as { component?: string }).component === RECORDER_FAILURE_COMPONENT
    )
    .map((i) => i as unknown as { transient?: boolean; data: Record<string, unknown> });
}

function siblingOutputs(
  items: readonly unknown[],
  collectionId: string = COLLECTION_ID
): string[] {
  return itemsByType(items as never, "component")
    .map((i) => (i as { data?: Record<string, unknown> }).data)
    .filter((d) => d?.collectionId === collectionId)
    .map((d) => (d?.task as { output?: { ok?: string } } | undefined)?.output?.ok)
    .filter((v): v is string => typeof v === "string");
}

describe("FIX-963: a recorder failure after the write committed", () => {
  it.each([
    ["success recorder", "complete" as const],
    ["error recorder", "fail" as const],
  ])(
    "fails the run when the %s cannot announce a committed write",
    async (_label, failOn) => {
      const result = await testFlow({
        flow: buildFlow({ failOn, onError: "skip" }),
        action: "run",
        userId: "u",
        input: undefined,
        unmockedGeneratorPolicy: "error",
      });

      // BR-8 — being honest must not cost the siblings, and this is asserted
      // FIRST because it is the non-negotiable half. On the error-recorder
      // side today's failure is exactly here: the throw escapes the rescue,
      // the fan-out rejects, and a sibling is left mid-flight.
      const statuses = finalStatuses(result.items);
      expect(statuses["sibling-a"]).toBe("completed");
      expect(statuses["sibling-b"]).toBe("completed");

      // Anti-hollow-pass: a board that abandoned its siblings can still report
      // a status for them. Their output has to carry the held-out value.
      const outputs = siblingOutputs(result.items);
      expect(outputs).toContain(`sibling-a:${SALT}`);
      expect(outputs).toContain(`sibling-b:${SALT}`);

      // BR-8 / BR-9 / BR-10 — and only then does the run fail, naming the task.
      expect(result.error).toBeDefined();
      expect(String(result.error)).toContain(POISON);
    }
  );

  it("reports on a saved entry that survives the run, not a diagnostic trace", async () => {
    // BR-16. This is the assertion that would have caught the original bug:
    // the failure was visible the whole time, on transient items nothing kept.
    const result = await testFlow({
      flow: buildFlow({ failOn: "complete", onError: "skip" }),
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "error",
    });

    const reports = recorderFailureItems(result.items);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.data).toMatchObject({
      taskId: POISON,
      recorder: "complete",
      verdict: "committed",
      error: ANNOUNCE_ERROR,
    });
    // Persisted, not stream-only. `transient` is what decides that, and the
    // whole point is that this entry is still there afterwards.
    expect(reports[0]?.transient).toBeUndefined();
  });

  it("says 'undetermined' — its own value — on a store that keeps no write record", async () => {
    // BR-3 / D1. The permanent answer for a caller-supplied store: nothing
    // there keeps the receipt the question is answered from. It must not be
    // collapsed into "the write did not land", which is the confident wrong
    // answer the write record exists to remove.
    const result = await testFlow({
      flow: buildFlow({
        failOn: "complete",
        onError: "skip",
        provenance: "none",
        collectionId: "undetermined-board",
        kind: "fix963-undetermined",
      }),
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "error",
    });

    const reports = recorderFailureItems(result.items);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.data).toMatchObject({ verdict: "undetermined" });
    // Distinct from BOTH neighbours, asserted rather than assumed.
    expect(reports[0]?.data.verdict).not.toBe("committed");
    // D1 — and it fails the run, same as a committed one.
    expect(result.error).toBeDefined();
  });

  it("does not report a store that is simply down on an untouched task", async () => {
    // BR-7, and the load-bearing negative for the whole change. A write that
    // committed NOTHING is not a bookkeeping failure: the record says so, and
    // the error goes back the way it always did. Turning this into a report
    // would make every ordinary outage look like a lost result.
    const result = await testFlow({
      flow: buildFlow({
        failOn: "complete",
        onError: "skip",
        failPoint: "before-commit",
        collectionId: "store-down-board",
        kind: "fix963-store-down",
      }),
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "error",
    });

    expect(recorderFailureItems(result.items)).toHaveLength(0);
    // The pre-existing path: the throw reaches the rescue, which records the
    // failure on the task, and `onError: "skip"` carries on.
    expect(result.error).toBeUndefined();
    expect(finalStatuses(result.items, "store-down-board")[POISON]).toBe(
      "errored"
    );
  });

  it("says 'undetermined', not 'no', for the same outage on a pre-provenance row", async () => {
    // BR-7b, and the sharp edge of D1. This is the SAME failure as the test
    // above — the store is down, the task untouched — but on a row that was
    // already in a persistent store before the write record shipped. Such a
    // row carries no identity nonce, an ordinary claim does not add one, and
    // nothing backfills it; `didWriteLand` therefore withholds before it ever
    // reaches the arms that would have answered "nothing committed". So the
    // board reports, and the run fails, where the previous test does neither.
    //
    // It is the only way a BUILT-IN store answers "cannot tell", and the
    // population that feels D1 on upgrade — until those rows drain.
    const result = await testFlow({
      flow: buildFlow({
        failOn: "complete",
        onError: "skip",
        failPoint: "before-commit",
        provenance: "no-incarnation",
        collectionId: "legacy-row-board",
        kind: "fix963-legacy-row",
      }),
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "error",
    });

    const reports = recorderFailureItems(result.items);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.data).toMatchObject({ verdict: "undetermined" });
    expect(result.error).toBeDefined();
  });

  it("releases the row it could not confirm, instead of leaving it claimed", async () => {
    // BR-3b, and the case that needs it: the write never landed AND the board
    // cannot tell that it didn't. The rethrow this path replaces was not just
    // loudness — it handed the task to the rescue, whose fenced write settled
    // it. Swallowing without settling leaves the row `in_progress` under a
    // lease nobody renews, recoverable only by waiting the lease out.
    //
    // `after-commit` would not exercise this: the write landed, so the row is
    // already terminal and the release has nothing to do.
    const result = await testFlow({
      flow: buildFlow({
        failOn: "complete",
        onError: "skip",
        failPoint: "before-commit",
        provenance: "none",
        collectionId: "release-board",
        kind: "fix963-release",
      }),
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "error",
    });

    const statuses = finalStatuses(result.items, "release-board");
    expect(statuses[POISON]).toBeDefined();
    expect(statuses[POISON]).not.toBe("in_progress");
    // Reported as undetermined too — the release does not make the answer
    // definite, it only keeps the row recoverable.
    expect(recorderFailureItems(result.items)[0]?.data).toMatchObject({
      verdict: "undetermined",
    });
  });

  it("fails the run immediately when the report itself cannot be delivered", async () => {
    // BR-13, and the one failure that is fatal where it happens rather than at
    // the tail: deferral works by leaving the report on the stream for the tail
    // to find, and here that is precisely what did not happen. It escapes the
    // worker rescue and `onError: "skip"` alike — a board that cannot report
    // has nothing left to be honest with.
    const result = await testFlow({
      flow: buildFlow({
        failOn: "complete",
        onError: "skip",
        breakReporting: true,
        collectionId: "broken-report-board",
        kind: "fix963-broken-report",
      }),
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "error",
    });

    expect(result.error).toBeDefined();
    expect(String(result.error)).toContain(REPORT_ERROR);
    // And no entry was left behind claiming otherwise.
    expect(recorderFailureItems(result.items)).toHaveLength(0);
  });

  it("names every failing task, not just the first", async () => {
    // BR-10. A run with two bookkeeping failures must not read as a run with
    // one — the caller's error is how they find out which tasks to look at.
    const result = await testFlow({
      flow: buildFlow({
        failOn: "complete",
        onError: "skip",
        collectionId: "two-failures-board",
        kind: "fix963-two-failures",
        tasks: [
          { id: POISON, goal: POISON },
          { id: "poison-2", goal: "poison-2" },
          { id: "sibling-a", goal: "sibling-a" },
        ],
      }),
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "error",
    });

    expect(String(result.error)).toContain(POISON);
    expect(String(result.error)).toContain("poison-2");
    expect(recorderFailureItems(result.items)).toHaveLength(2);
    expect(finalStatuses(result.items, "two-failures-board")["sibling-a"]).toBe(
      "completed"
    );
  });

  it("does not report or fail when the write was declined or the row parked", async () => {
    // BR-4 / BR-5 / BR-11, the load-bearing negatives (BP-035). A board whose
    // recorders never throw must behave byte for byte as before: no entry, no
    // new failure mode. Proven against the FIX-951 scenario's own trigger — a
    // task settled out from under its worker, whose write-back is DECLINED
    // rather than failing.
    const healthy = await testFlow({
      flow: buildFlow({
        failOn: "complete",
        onError: "skip",
        collectionId: "healthy-board",
        kind: "fix963-healthy",
        // Nothing named `poison`, so the store never throws.
        tasks: [
          { id: "task-a", goal: "task-a" },
          { id: "task-b", goal: "task-b" },
        ],
      }),
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "error",
    });

    expect(healthy.error).toBeUndefined();
    expect(healthy.status).toBe("completed");
    expect(recorderFailureItems(healthy.items)).toHaveLength(0);
  });

  it("does not let a second batch inherit the first one's failure", async () => {
    // BR-12. Reports accumulate on the per-REQUEST item buffer and a request
    // can drain the same board twice, so the tail has to scope its read to its
    // own run. The second drain finds nothing left to do and must report
    // success — a high-water mark or a bare collection filter would fail it.
    const result = await testFlow({
      flow: buildFlow({
        failOn: "complete",
        onError: "skip",
        collectionId: "two-batch-board",
        kind: "fix963-two-batches",
        batches: 2,
      }),
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "error",
    });

    // The FIRST batch failed, so the run failed — that part is unchanged.
    // What this pins is that exactly one report exists and the second drain
    // did not raise on it a second time.
    expect(recorderFailureItems(result.items)).toHaveLength(1);
    expect(String(result.error)).toContain(POISON);
  });
});
