/**
 * Every exit the two result recorders take, pinned as they behave today.
 *
 * A characterization matrix, not a specification of what the recorders should
 * do. Each case is one row of the recorder equivalence table in
 * `specs/issues/FIX-1472/BUSINESS-RULES.md` (the `BR-n` in the comments below
 * refers to that table), and the table exists so the two recorders can share
 * their write step without any run noticing: same row states, same persisted
 * entries, same errors, same lease timing. A case that changes is a behaviour
 * change, whatever the diff calls itself.
 *
 * The cases that break silently are the ones to watch:
 *
 * - the success recorder's write that saved nothing, which must leave the lease
 *   renewing and the claim set for the rescue that follows (BR-4);
 * - the error recorder's own write that saved nothing, whose error — not the
 *   worker's — must reach the caller (BR-13);
 * - a recorder failure arriving at a deferring site, which is a nested board
 *   going wrong and must not abandon this board's siblings (BR-9).
 *
 * The rows the lease and standalone suites already pin exactly are cited rather
 * than repeated (BR-16, BR-17); every other row is asserted here, on both kinds
 * of site where the row depends on the site.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext, StateRef } from "@flow-state-dev/core/types";
import { runForTest } from "@flow-state-dev/testing";
import {
  createRecordError,
  createRecordSuccess,
  type RecorderFailureWiring,
} from "../../src/task-board/blocks/record-result";
import {
  TASK_BOARD_RECORDER_FAILURE_COMPONENT_TYPE,
  TaskBoardRecorderFailureError,
  TaskBoardReportFailureError,
} from "../../src/task-board/blocks/recorder-failure";
import {
  createStateBackedTaskCollection,
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

const ANNOUNCE_ERROR = "change announcement blew up";
const STORE_DOWN = "store unreachable";
/** The prefix the recorders' best-effort release write carries. */
const RELEASE_PREFIX = "task board could not confirm its own write";

/**
 * How the wrapped write behaves.
 *
 * - `ok` — commits and returns.
 * - `declined` — the row was settled by someone else first, so the fence
 *   declines the write as a value.
 * - `nothing-saved` — throws without writing: write correlation answers `false`.
 * - `saved` — commits, then throws, the way an announcement that runs after the
 *   durable write does: correlation answers `true`.
 * - `cant-tell` — throws without writing and leaves the row unreadable, so
 *   correlation answers `undefined`.
 */
type WriteMode = "ok" | "declined" | "nothing-saved" | "saved" | "cant-tell";

interface FixtureOptions {
  complete?: WriteMode;
  fail?: WriteMode;
  /** The row has no claim on it. */
  noClaim?: boolean;
  /** The worker parked its own row for review before leaving. */
  parked?: boolean;
  /** The best-effort release write throws too. */
  releaseThrows?: boolean;
  /** How the awaited emission seam behaves. */
  emit?: "ok" | "rejects" | "absent";
}

interface Fixture {
  ctx: BlockContext;
  /**
   * Ordered log of writes and report emissions, each tagged with whether
   * renewal was still running at that instant (and, for an emission, whether
   * the claim was still set).
   */
  seen: string[];
  emitted: Array<{ component: string; data: Record<string, unknown> }>;
  /** Renewal ticks still scheduled; non-zero means renewal was not stopped. */
  pending: () => number;
  claimSet: () => boolean;
  status: () => string | undefined;
  collection: TaskCollectionRef;
}

/**
 * A timer that never fires but reports whether a tick is still scheduled. A
 * stopped driver cancels its pending tick, so "still scheduled" is exactly
 * "renewal has not been stopped yet".
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

/**
 * One claimed row under a running renewal driver, reached through a collection
 * whose settlement writes behave as `opts` says.
 *
 * The caller opens the renewal scope as its own first statement — `enterWith`
 * publishes to the async resource it runs on, so opening it past an `await` in
 * here would publish to nobody.
 */
async function fixture(opts: FixtureOptions = {}): Promise<Fixture> {
  const state = createFakeSequencerState<{ tasks: Record<string, unknown> }>({
    tasks: {},
  });
  const inner = createStateBackedTaskCollection({
    collectionId: "tasks",
    state: state,
  });
  await inner.addTask({ id: "t", goal: "work" });
  const task = (await inner.claim("w", { leaseDurationMs: 30_000 }))!;
  const ticket = ticketForClaim("tasks", task);

  const clock = countingTimer();
  const renewal = () => (clock.pending() > 0 ? "renewing" : "stopped");
  const seen: string[] = [];
  let unreadable = false;

  const bodyState = createFakeSequencerState<{ currentClaim?: unknown }>(
    opts.noClaim ? {} : { currentClaim: ticket }
  );
  const claimSet = () => bodyState.state.currentClaim !== undefined;

  async function behave<T>(mode: WriteMode, write: () => Promise<T>): Promise<T> {
    switch (mode) {
      case "ok":
      case "declined":
        return write();
      case "saved": {
        await write();
        throw new Error(ANNOUNCE_ERROR);
      }
      case "nothing-saved":
        throw new Error(STORE_DOWN);
      case "cant-tell":
        unreadable = true;
        throw new Error(STORE_DOWN);
    }
  }

  const collection = {
    ...inner,
    get: (id: string) => {
      if (unreadable) throw new Error("row unreadable");
      return inner.get(id);
    },
    complete: async (...args: Parameters<TaskCollectionRef["complete"]>) => {
      seen.push(`complete:${renewal()}`);
      return behave(opts.complete ?? "ok", () => inner.complete(...args));
    },
    fail: async (...args: Parameters<TaskCollectionRef["fail"]>) => {
      const [, message] = args;
      if (String(message).startsWith(RELEASE_PREFIX)) {
        seen.push(`release:${renewal()}`);
        if (opts.releaseThrows) throw new Error("release blew up");
        return inner.fail(...args);
      }
      seen.push(`fail:${renewal()}`);
      return behave(opts.fail ?? "ok", () => inner.fail(...args));
    },
  } as unknown as TaskCollectionRef;

  if (opts.parked) await inner.awaitReview("t", "needs a human", { claim: ticket });
  if (opts.complete === "declined" || opts.fail === "declined") {
    // Settled out from under the worker: the claim fence declines terminal rows.
    await inner.cancel("t", "cancelled by a coordinator");
  }

  stampLeaseRenewal(
    startLeaseRenewal({ collection, ticket, claimedTask: task, timer: clock.timer })
  );
  expect(clock.pending()).toBe(1);

  const emitted: Fixture["emitted"] = [];
  const emitMode = opts.emit ?? "ok";
  const ctx = {
    sequencer: bodyState,
    ...(emitMode === "absent"
      ? {}
      : {
          _emitComponentAwaited: async (
            component: string,
            data: Record<string, unknown>
          ) => {
            seen.push(`emit:${renewal()}:${claimSet() ? "claim-set" : "claim-cleared"}`);
            if (emitMode === "rejects") throw new Error("emission rejected");
            emitted.push({ component, data });
          },
        }),
  } as unknown as BlockContext;

  return {
    ctx,
    seen,
    emitted,
    pending: clock.pending,
    claimSet,
    status: () => inner.get("t")?.status,
    collection,
  };
}

/** The three ways a recorder is composed, by what they do with a failure. */
const RAISING_SITES: Array<[string, RecorderFailureWiring | undefined]> = [
  // No wiring at all: a consumer composing the exported block by hand.
  ["composed with no wiring", undefined],
  // The hand-off gate's composition.
  ["the hand-off gate", { onRecorderFailure: "raise" }],
];
const DEFERRING: RecorderFailureWiring = {
  onRecorderFailure: "defer",
  runId: () => "run-1",
};
const ALL_SITES: Array<[string, RecorderFailureWiring | undefined]> = [
  ...RAISING_SITES,
  ["the drain (deferring)", DEFERRING],
];

function success(fx: Fixture, wiring?: RecorderFailureWiring) {
  return createRecordSuccess({
    name: "record-success",
    collection: async () => fx.collection,
    ...(wiring ? { recorderFailure: wiring } : {}),
  });
}

function failure(
  fx: Fixture,
  onError: "skip" | "fail",
  wiring?: RecorderFailureWiring
) {
  return createRecordError({
    name: "record-error",
    collection: async () => fx.collection,
    onError,
    ...(wiring ? { recorderFailure: wiring } : {}),
  });
}

describe("the success recorder", () => {
  it("writes nothing and stops renewal when there is no claim (BR-1)", async () => {
    openLeaseRenewalScope();
    const fx = await fixture({ noClaim: true });

    await expect(runForTest(success(fx), { ok: true }, fx.ctx)).resolves.toBeUndefined();

    expect(fx.seen).toEqual([]);
    expect(fx.pending()).toBe(0);
    expect(fx.status()).toBe("in_progress");
  });

  it("writes nothing, stops renewal and clears the claim on a row the worker parked (BR-2)", async () => {
    openLeaseRenewalScope();
    const fx = await fixture({ parked: true });

    await expect(runForTest(success(fx), { ok: true }, fx.ctx)).resolves.toBeUndefined();

    expect(fx.seen).toEqual([]);
    expect(fx.pending()).toBe(0);
    expect(fx.claimSet()).toBe(false);
    expect(fx.status()).toBe("parked");
  });

  it.each<[WriteMode, string]>([
    ["ok", "completed"],
    ["declined", "cancelled"],
  ])(
    "on a write that is %s: stops renewal after it, clears the claim, reports nothing (BR-3)",
    async (mode, finalStatus) => {
      openLeaseRenewalScope();
      const fx = await fixture({ complete: mode });

      await expect(runForTest(success(fx, DEFERRING), { ok: true }, fx.ctx)).resolves.toBeUndefined();

      // Renewal was live at the write and stopped after it (BR-17).
      expect(fx.seen).toEqual(["complete:renewing"]);
      expect(fx.pending()).toBe(0);
      expect(fx.claimSet()).toBe(false);
      expect(fx.emitted).toEqual([]);
      expect(fx.status()).toBe(finalStatus);
    }
  );

  it.each(ALL_SITES)(
    "rethrows the write's own error when it saved nothing, leaving renewal running and the claim set — %s (BR-4)",
    async (_site, wiring) => {
      openLeaseRenewalScope();
      const fx = await fixture({ complete: "nothing-saved" });

      const run = runForTest(success(fx, wiring), { ok: true }, fx.ctx);
      await expect(run).rejects.toThrow(STORE_DOWN);
      await expect(run).rejects.not.toBeInstanceOf(TaskBoardRecorderFailureError);

      // The rescue's fenced fail() comes next and needs both.
      expect(fx.pending()).toBe(1);
      expect(fx.claimSet()).toBe(true);
      // No release write, no report.
      expect(fx.seen).toEqual(["complete:renewing"]);
      expect(fx.emitted).toEqual([]);
      expect(fx.status()).toBe("in_progress");
    }
  );

  describe("a write that saved, then threw (BR-5)", () => {
    it.each(RAISING_SITES)(
      "stops renewal, clears the claim, reports `committed`, then raises — %s",
      async (_site, wiring) => {
        openLeaseRenewalScope();
        const fx = await fixture({ complete: "saved" });

        const run = runForTest(success(fx, wiring), { ok: true }, fx.ctx);
        await expect(run).rejects.toBeInstanceOf(TaskBoardRecorderFailureError);
        await expect(run).rejects.toThrow(/task "t"/);

        // No release write; the report goes out after the stop and the clear.
        expect(fx.seen).toEqual(["complete:renewing", "emit:stopped:claim-cleared"]);
        expect(fx.emitted[0]?.data).toMatchObject({ verdict: "committed" });
        expect(fx.status()).toBe("completed");
      }
    );

    it("returns quietly at the deferring site", async () => {
      openLeaseRenewalScope();
      const fx = await fixture({ complete: "saved" });

      await expect(runForTest(success(fx, DEFERRING), { ok: true }, fx.ctx)).resolves.toBeUndefined();

      expect(fx.seen).toEqual(["complete:renewing", "emit:stopped:claim-cleared"]);
      expect(fx.emitted).toHaveLength(1);
      expect(fx.status()).toBe("completed");
    });
  });

  describe("a write the board can't tell about (BR-6)", () => {
    it.each(RAISING_SITES)(
      "releases the row with one fenced fail, then reports `undetermined` and raises — %s",
      async (_site, wiring) => {
        openLeaseRenewalScope();
        const fx = await fixture({ complete: "cant-tell" });

        await expect(
          runForTest(success(fx, wiring), { ok: true }, fx.ctx)
        ).rejects.toBeInstanceOf(TaskBoardRecorderFailureError);

        // Renewal outlives the release write too (BR-17).
        expect(fx.seen).toEqual([
          "complete:renewing",
          "release:renewing",
          "emit:stopped:claim-cleared",
        ]);
        expect(fx.emitted[0]?.data).toMatchObject({ verdict: "undetermined" });
        expect(fx.status()).toBe("errored");
      }
    );

    it("returns quietly at the deferring site, row released", async () => {
      openLeaseRenewalScope();
      const fx = await fixture({ complete: "cant-tell" });

      await expect(runForTest(success(fx, DEFERRING), { ok: true }, fx.ctx)).resolves.toBeUndefined();

      expect(fx.seen).toEqual([
        "complete:renewing",
        "release:renewing",
        "emit:stopped:claim-cleared",
      ]);
      expect(fx.emitted[0]?.data).toMatchObject({ verdict: "undetermined" });
      expect(fx.status()).toBe("errored");
    });

    it("swallows the release write's own failure and still reports", async () => {
      openLeaseRenewalScope();
      const fx = await fixture({ complete: "cant-tell", releaseThrows: true });

      await expect(runForTest(success(fx, DEFERRING), { ok: true }, fx.ctx)).resolves.toBeUndefined();

      expect(fx.seen).toEqual([
        "complete:renewing",
        "release:renewing",
        "emit:stopped:claim-cleared",
      ]);
      expect(fx.emitted[0]?.data).toMatchObject({ verdict: "undetermined" });
      expect(fx.pending()).toBe(0);
    });
  });
});

describe("the error recorder", () => {
  const report = {
    collectionId: "tasks",
    taskId: "t",
    recorder: "complete" as const,
    verdict: "committed" as const,
    error: ANNOUNCE_ERROR,
  };

  it.each(ALL_SITES)(
    "rethrows a report that could not be delivered, untouched by `onError` — %s (BR-7)",
    async (_site, wiring) => {
      openLeaseRenewalScope();
      const fx = await fixture();
      const rescued = new TaskBoardReportFailureError(report, new Error("emission rejected"));

      await expect(
        runForTest(failure(fx, "skip", wiring), rescued, fx.ctx)
      ).rejects.toBe(rescued);

      expect(fx.pending()).toBe(0);
      expect(fx.seen).toEqual([]);
      expect(fx.claimSet()).toBe(true);
      expect(fx.status()).toBe("in_progress");
    }
  );

  it.each(RAISING_SITES)(
    "rethrows a recorder failure at a raising site, untouched by `onError` — %s (BR-8)",
    async (_site, wiring) => {
      openLeaseRenewalScope();
      const fx = await fixture();
      const rescued = new TaskBoardRecorderFailureError([report]);

      await expect(
        runForTest(failure(fx, "skip", wiring), rescued, fx.ctx)
      ).rejects.toBe(rescued);

      expect(fx.pending()).toBe(0);
      expect(fx.seen).toEqual([]);
      expect(fx.claimSet()).toBe(true);
      expect(fx.status()).toBe("in_progress");
    }
  );

  describe("a recorder failure at the deferring site is an ordinary worker error (BR-9)", () => {
    // A board nested inside this worker already failed its own run; rethrowing
    // here would reject this board's fan-out and abandon its siblings.
    it("`skip`: the row is failed and the recorder returns", async () => {
      openLeaseRenewalScope();
      const fx = await fixture();
      const rescued = new TaskBoardRecorderFailureError([report]);

      await expect(
        runForTest(failure(fx, "skip", DEFERRING), rescued, fx.ctx)
      ).resolves.toEqual({ recorded: "errored", error: rescued.message });

      expect(fx.seen).toEqual(["fail:renewing"]);
      expect(fx.status()).toBe("errored");
      expect(fx.claimSet()).toBe(false);
      expect(fx.pending()).toBe(0);
    });

    it("`fail`: the row is failed, then `onError` rethrows", async () => {
      openLeaseRenewalScope();
      const fx = await fixture();
      const rescued = new TaskBoardRecorderFailureError([report]);

      await expect(
        runForTest(failure(fx, "fail", DEFERRING), rescued, fx.ctx)
      ).rejects.toBe(rescued);

      expect(fx.seen).toEqual(["fail:renewing"]);
      expect(fx.status()).toBe("errored");
    });
  });

  it.each(["skip", "fail"] as const)(
    "writes nothing and stops renewal when there is no claim; `onError: %s` decides (BR-10)",
    async (onError) => {
      openLeaseRenewalScope();
      const fx = await fixture({ noClaim: true });
      const worker = new Error("worker blew up");

      const run = runForTest(failure(fx, onError, DEFERRING), worker, fx.ctx);
      if (onError === "fail") await expect(run).rejects.toBe(worker);
      else await expect(run).resolves.toEqual({ recorded: "errored", error: "worker blew up" });

      expect(fx.seen).toEqual([]);
      expect(fx.pending()).toBe(0);
      expect(fx.status()).toBe("in_progress");
    }
  );

  it.each(["skip", "fail"] as const)(
    "writes nothing on a parked row, clears the claim, stops renewal; `onError: %s` decides (BR-11)",
    async (onError) => {
      openLeaseRenewalScope();
      const fx = await fixture({ parked: true });
      const worker = new Error("worker blew up");

      const run = runForTest(failure(fx, onError, DEFERRING), worker, fx.ctx);
      if (onError === "fail") await expect(run).rejects.toBe(worker);
      else await expect(run).resolves.toEqual({ recorded: "errored", error: "worker blew up" });

      expect(fx.seen).toEqual([]);
      expect(fx.claimSet()).toBe(false);
      expect(fx.pending()).toBe(0);
      expect(fx.status()).toBe("parked");
    }
  );

  describe("a fail write that succeeds or is declined (BR-12)", () => {
    it.each<[WriteMode, string]>([
      ["ok", "errored"],
      ["declined", "cancelled"],
    ])("%s, `skip`: returns the errored record", async (mode, finalStatus) => {
      openLeaseRenewalScope();
      const fx = await fixture({ fail: mode });

      await expect(
        runForTest(failure(fx, "skip", DEFERRING), new Error("worker blew up"), fx.ctx)
      ).resolves.toEqual({ recorded: "errored", error: "worker blew up" });

      // Renewal was live at the write and stopped after it (BR-17).
      expect(fx.seen).toEqual(["fail:renewing"]);
      expect(fx.claimSet()).toBe(false);
      expect(fx.pending()).toBe(0);
      expect(fx.emitted).toEqual([]);
      expect(fx.status()).toBe(finalStatus);
    });

    it("`fail`: rethrows the original error", async () => {
      openLeaseRenewalScope();
      const fx = await fixture();
      const worker = new Error("worker blew up");

      await expect(
        runForTest(failure(fx, "fail", DEFERRING), worker, fx.ctx)
      ).rejects.toBe(worker);
      expect(fx.claimSet()).toBe(false);
      expect(fx.pending()).toBe(0);
    });

    it("`fail`: wraps a non-Error in an Error carrying its message", async () => {
      openLeaseRenewalScope();
      const fx = await fixture();

      const run = runForTest(failure(fx, "fail", DEFERRING), "plain string failure", fx.ctx);
      await expect(run).rejects.toBeInstanceOf(Error);
      await expect(run).rejects.toThrow("plain string failure");
      expect(fx.status()).toBe("errored");
    });
  });

  it.each(
    ALL_SITES.flatMap(([site, wiring]) =>
      (["skip", "fail"] as const).map((onError) => [site, wiring, onError] as const)
    )
  )(
    "propagates the fail write's own error when it saved nothing, claim still set — %s, `onError: %s` (BR-13)",
    async (_site, wiring, onError) => {
      openLeaseRenewalScope();
      const fx = await fixture({ fail: "nothing-saved" });

      const run = runForTest(failure(fx, onError, wiring), new Error("worker blew up"), fx.ctx);
      await expect(run).rejects.toThrow(STORE_DOWN);
      await expect(run).rejects.not.toBeInstanceOf(TaskBoardRecorderFailureError);

      expect(fx.claimSet()).toBe(true);
      expect(fx.pending()).toBe(0);
      expect(fx.seen).toEqual(["fail:renewing"]);
      expect(fx.emitted).toEqual([]);
      expect(fx.status()).toBe("in_progress");
    }
  );

  describe("a fail write that saved, or can't tell (BR-14)", () => {
    const cases: Array<[WriteMode, string[], string, string]> = [
      ["saved", ["fail:renewing", "emit:stopped:claim-cleared"], "committed", "errored"],
      [
        "cant-tell",
        ["fail:renewing", "release:renewing", "emit:stopped:claim-cleared"],
        "undetermined",
        "errored",
      ],
    ];

    it.each(
      cases.flatMap((c) => RAISING_SITES.map(([site, wiring]) => [...c, site, wiring] as const))
    )(
      "%s: reports, then raises a recorder failure — %s",
      async (mode, seen, verdict, finalStatus, _site, wiring) => {
        openLeaseRenewalScope();
        const fx = await fixture({ fail: mode });

        await expect(
          runForTest(failure(fx, "skip", wiring), new Error("worker blew up"), fx.ctx)
        ).rejects.toBeInstanceOf(TaskBoardRecorderFailureError);

        expect(fx.seen).toEqual(seen);
        expect(fx.emitted[0]?.data).toMatchObject({ recorder: "fail", verdict });
        expect(fx.status()).toBe(finalStatus);
      }
    );

    it.each(cases)(
      "%s: reports and returns at the deferring site; `onError: fail` is not consulted",
      async (mode, seen, verdict, finalStatus) => {
        openLeaseRenewalScope();
        const fx = await fixture({ fail: mode });

        await expect(
          runForTest(failure(fx, "fail", DEFERRING), new Error("worker blew up"), fx.ctx)
        ).resolves.toEqual({ recorded: "errored", error: "worker blew up" });

        expect(fx.seen).toEqual(seen);
        expect(fx.emitted[0]?.data).toMatchObject({ recorder: "fail", verdict });
        expect(fx.status()).toBe(finalStatus);
        expect(fx.pending()).toBe(0);
      }
    );
  });
});

describe("both recorders", () => {
  describe("a report that cannot be emitted propagates as a delivery failure (BR-15)", () => {
    it.each(["rejects", "absent"] as const)(
      "success recorder, emission %s: after renewal stopped and the claim cleared",
      async (emit) => {
        openLeaseRenewalScope();
        const fx = await fixture({ complete: "saved", emit });

        await expect(
          runForTest(success(fx, DEFERRING), { ok: true }, fx.ctx)
        ).rejects.toBeInstanceOf(TaskBoardReportFailureError);

        expect(fx.pending()).toBe(0);
        expect(fx.claimSet()).toBe(false);
      }
    );

    it.each(["rejects", "absent"] as const)(
      "error recorder, emission %s: after renewal stopped and the claim cleared",
      async (emit) => {
        openLeaseRenewalScope();
        const fx = await fixture({ fail: "saved", emit });

        await expect(
          runForTest(failure(fx, "skip", DEFERRING), new Error("worker blew up"), fx.ctx)
        ).rejects.toBeInstanceOf(TaskBoardReportFailureError);

        expect(fx.pending()).toBe(0);
        expect(fx.claimSet()).toBe(false);
      }
    );
  });

  // BR-16 (a recorder composed with no wiring raises, never defers) is pinned by
  // `recorder-failure-standalone.test.ts`, and the no-wiring site is also a
  // column of every raising case above.
  //
  // BR-17 (renewal stops only after the last fenced write, the release write
  // included) is pinned by `lease-settlement-boundary.test.ts`; the `:renewing`
  // tags in every writing case above assert it for each exit.

  describe("the persisted entry carries today's fields (BR-18)", () => {
    const rows = (
      [
        ["success", "saved", "committed"],
        ["success", "cant-tell", "undetermined"],
        ["error", "saved", "committed"],
        ["error", "cant-tell", "undetermined"],
      ] as const
    ).flatMap((row) =>
      [
        ["the drain", DEFERRING, "run-1"],
        ["the hand-off gate", { onRecorderFailure: "raise" }, undefined],
      ].map(
        ([site, wiring, runId]) =>
          [...row, site as string, wiring as RecorderFailureWiring, runId as string | undefined] as const
      )
    );

    it.each(rows)(
      "%s recorder, %s write, verdict %s — at %s",
      async (which, mode, verdict, _site, wiring, runId) => {
        openLeaseRenewalScope();
        const fx = await fixture(which === "success" ? { complete: mode } : { fail: mode });
        const block =
          which === "success" ? success(fx, wiring) : failure(fx, "skip", wiring);

        // Raises at the gate, returns at the drain; the entry is what is pinned.
        await runForTest(
          block,
          which === "success" ? { ok: true } : new Error("worker blew up"),
          fx.ctx
        ).catch(() => undefined);

        expect(fx.emitted).toHaveLength(1);
        expect(fx.emitted[0]?.component).toBe(TASK_BOARD_RECORDER_FAILURE_COMPONENT_TYPE);
        expect(fx.emitted[0]?.data).toEqual({
          collectionId: "tasks",
          taskId: "t",
          recorder: which === "success" ? "complete" : "fail",
          verdict,
          error: mode === "saved" ? ANNOUNCE_ERROR : STORE_DOWN,
          ...(runId !== undefined ? { runId } : {}),
        });
      }
    );
  });
});
