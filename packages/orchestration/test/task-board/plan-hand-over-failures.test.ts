/**
 * A plan board's drain that fails after it handed a row to a session of its
 * own. Past the hand-over the row is the child's, so the board has no claim to
 * fail it against and its `skip` policy has nothing to record: a failure there
 * is the plan's. Each one must end the drain's request `failed`, where its
 * filer can see it, and never run the rows after it. Before, each was
 * swallowed: the request stayed `in_progress` and the plan stopped with no
 * signal.
 *
 * Real runtime: `createFlowState` over in-memory stores, its dispatch seam,
 * its durability sweeper and its wakes, as `plan-hands-a-row-over.test.ts`.
 * Each failure is put in at the one write or read that makes it, by
 * wrapping it, and the rest runs as shipped:
 *
 * - another request takes the lapsed wait slot between the drain's lapse and
 *   its re-mark: the same conditional write `getTask({ id, wait: true })`
 *   makes;
 * - the ledger's `lapseWait` or `markWait` write throws;
 * - the row is gone to the wait's own read when the drain resumes;
 * - the wait gate resumes with something that is not a wait outcome;
 * - the seam throws, rather than refusing, once the claim is released.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { z } from "zod";
import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  MIN_LEASE_DURATION_MS,
  type TaskDispatcher,
  type TaskWorker,
  type TaskWorkerInput
} from "../../src/tasks";
import { taskSettledEntry } from "../../src";

/**
 * The one failure a test arms. Each is spent the first time it fires, except
 * `rowGone`: armed, it turns `"gone"` once the replay has read its recorded
 * hand-over (see `boot`), and the row stays gone from then on.
 */
const fault = vi.hoisted(() => ({
  takeSlotOnLapse: false,
  lapseThrows: false,
  markThrows: false,
  rowGone: false as boolean | "gone",
  garbledResume: false
}));

vi.mock("../../src/tasks/collection/resource-backed", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/tasks/collection/resource-backed")>();
  return {
    ...original,
    createResourceBackedTaskCollection: async (...args: Parameters<typeof original.createResourceBackedTaskCollection>) => {
      const ref = await original.createResourceBackedTaskCollection(...args);
      const { lapseWait, markWait, get } = ref;
      ref.lapseWait = async (id, gateId, requestId) => {
        if (fault.lapseThrows && id === "fact-check") {
          fault.lapseThrows = false;
          throw new Error("the ledger store is unavailable");
        }
        const lapsed = await lapseWait!.call(ref, id, gateId, requestId);
        if (fault.takeSlotOnLapse && id === "fact-check" && lapsed.outcome !== "declined") {
          fault.takeSlotOnLapse = false;
          // Another request in the filing session waits on the row now.
          await markWait!.call(ref, id, {
            gateId: `ask:${ref.collectionId}:${id}#another`,
            deadline: Date.now() + 600_000,
            requestId: "req_another"
          });
        }
        return lapsed;
      };
      ref.markWait = async (id, slot) => {
        if (fault.markThrows && id === "fact-check") {
          fault.markThrows = false;
          throw new Error("the ledger store is unavailable");
        }
        return markWait!.call(ref, id, slot);
      };
      ref.get = (id) => (fault.rowGone === "gone" && id === "fact-check" ? undefined : get.call(ref, id));
      return ref;
    }
  };
});

vi.mock("@flow-state-dev/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@flow-state-dev/core")>();
  return {
    ...original,
    parkOnWait: (ctx: Parameters<typeof original.parkOnWait>[0], input: Parameters<typeof original.parkOnWait>[1]) =>
      original.parkOnWait(
        {
          suspend: async (options) => {
            const resumed = await ctx.suspend!(options);
            if (!fault.garbledResume) return resumed;
            fault.garbledResume = false;
            return { garbled: true };
          }
        },
        input
      )
  };
});

const USER = "u_plan_fail";
const SESSION = "s_plan_fail";

/** The gate the handed-over step's work waits on, opened by the test. */
let open: () => void = () => undefined;
let opened: Promise<void> = Promise.resolve();
const holdTheStep = () => {
  opened = new Promise<void>((resolve) => {
    open = resolve;
  });
};

/** Claims under the shortest lease, so its lapse is observable on the wall clock: the board has no lease knob. */
const shortLease: TaskDispatcher = {
  async claim(collection, workerId) {
    return collection.claim(workerId, { leaseDurationMs: MIN_LEASE_DURATION_MS });
  }
};

function planFlow(): FlowInstance {
  const ledger = defineTaskCollection({ id: "plan-fail-steps", scope: "user" });
  const inline = handler({
    name: "inline-step",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.string(),
    execute: (input: TaskWorkerInput, ctx) => `${input.goal} in ${ctx.session.identity.id}`
  }) as TaskWorker;
  const ownSession = handler({
    name: "own-session-step",
    inputSchema: z.unknown(),
    outputSchema: z.string(),
    execute: async (input: TaskWorkerInput, ctx) => {
      await opened;
      return `${input.goal} in ${ctx.session.identity.id}`;
    }
  });
  const board = taskBoard({
    name: "plan",
    boardId: "plan",
    collection: ledger,
    workers: inline,
    newSession: dispatcher({ name: "own-session", type: "task", action: "work", session: "per-task" }),
    concurrency: 1,
    dispatcher: shortLease,
    initialTasks: [
      { id: "outline", goal: "Outline", assignee: "writer" },
      { id: "fact-check", goal: "Fact-check", assignee: "writer", deps: ["outline"], session: "new" },
      { id: "publish", goal: "Publish", assignee: "writer", deps: ["fact-check"] }
    ]
  });
  const rows = handler({
    name: "plan-rows",
    inputSchema: z.unknown(),
    outputSchema: z.any(),
    resources: { "plan-fail-steps": ledger },
    execute: async (_input, ctx) =>
      (
        await getOrCreateTaskCollection({
          ctx: ctx as never,
          backing: "resource",
          collectionId: "plan-fail-steps",
          collection: resolveResourceCollection(ctx as never, "plan-fail-steps")!
        })
      )
        .list()
        .map((row) => ({ id: row.id, status: row.status }))
  });
  return defineFlow({
    kind: "plan-hand-over-fails",
    resources: { "plan-fail-steps": ledger },
    internal: {
      actions: {
        onTaskSettled: taskSettledEntry({
          block: handler({ name: "note-heard", inputSchema: z.unknown(), outputSchema: z.unknown(), execute: () => ({}) })
        })
      }
    },
    actions: {
      run: { block: sequencer({ name: "run-plan", inputSchema: z.unknown() }).tap(board.drain).step(rows), durable: true },
      rows: { block: rows }
    },
    task: { actions: { work: { block: ownSession } } }
  } as never)({ id: "plan-hand-over-fails" });
}

type Row = { id: string; status: string };

describe("a plan drain that fails after handing a row over", () => {
  let state: ReturnType<typeof createFlowState> | undefined;
  afterEach(async () => {
    open();
    await state?.dispose();
    state = undefined;
    fault.takeSlotOnLapse = false;
    fault.lapseThrows = false;
    fault.markThrows = false;
    fault.rowGone = false;
    fault.garbledResume = false;
  });

  /** @param seamThrows Fail the first child session's birth: the seam throws past the claim's release. */
  async function boot(options: { seamThrows?: boolean } = {}) {
    const flow = planFlow();
    state = createFlowState({
      flows: { "plan-hand-over-fails": flow },
      stores: { default: { primary: inMemoryStores() } },
      durable: true,
      durabilityRetention: { sweepIntervalMs: 100 },
      waitDeadlines: { defaultMs: 1_000, minMs: 1_000 }
    });
    await state.getRouter();
    const runtime = await state.getRuntime();
    // The replay after a park reads the row for the seed and the claim before
    // it reaches the wait: a row gone to those reads is seeded again, or not
    // claimed, and the drain never reaches its wait. So the row goes once the
    // replay has read its recorded hand-over, which comes after both reads and
    // before the wait's own.
    const requests = runtime.stores.request;
    const getRunOnceResult = requests.getRunOnceResult.bind(requests);
    requests.getRunOnceResult = (async (requestId: string, key: string) => {
      const found = await getRunOnceResult(requestId, key);
      if (fault.rowGone === true && found.found && /^fsd\.plan\.dispatch:[^:]+:fact-check:\d+$/.test(key)) {
        fault.rowGone = "gone";
      }
      return found;
    }) as typeof requests.getRunOnceResult;
    let failBirth = options.seamThrows === true;
    if (options.seamThrows === true) {
      const sessions = runtime.stores.session;
      const set = sessions.set.bind(sessions);
      sessions.set = (async (...args: Parameters<typeof set>) => {
        const record = args[1] as { parentSessionId?: string } | undefined;
        if (failBirth && record?.parentSessionId === SESSION) {
          failBirth = false;
          throw new Error("the session store is unavailable");
        }
        return set(...args);
      }) as typeof sessions.set;
    }
    const act = (actionName: string) =>
      runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName,
        input: {},
        userId: USER,
        sessionId: SESSION,
        stores: runtime.stores,
        runtimeConfig: runtime.runtimeConfig
      });
    const recordOf = (requestId: string) => runtime.stores.request.get(requestId);
    const until = async (check: () => Promise<boolean>, ms = 8_000) => {
      for (const end = Date.now() + ms; Date.now() < end; ) {
        if (await check()) return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return check();
    };
    const rowsNow = async () => (await act("rows")).output as Row[];
    return { act, recordOf, until, rowsNow };
  }

  /** The drain's request ended `failed`, naming the row, which it left alone, and nothing after the row ran. */
  async function expectAVisiblePlanFailure(booted: Awaited<ReturnType<typeof boot>>, requestId: string, cause: RegExp) {
    const { recordOf, until, rowsNow } = booted;
    const failed = await until(async () => (await recordOf(requestId))?.status === "failed");
    expect({ status: (await recordOf(requestId))?.status }).toEqual({ status: "failed" });
    expect(failed).toBe(true);
    const error = JSON.stringify((await recordOf(requestId)) as { error?: unknown });
    expect(error).toContain("fact-check");
    expect(error).toMatch(cause);
    const rows = await rowsNow();
    // The row is its session's: the drain wrote nothing on it.
    expect(rows.find((row) => row.id === "fact-check")).toMatchObject({ status: "in_progress" });
    expect(rows.find((row) => row.id === "publish")).toMatchObject({ status: "pending" });
  }

  it("fails the plan when another request takes the lapsed slot before its re-mark", async () => {
    holdTheStep();
    const booted = await boot();
    const run = await booted.act("run");
    expect(await booted.until(async () => (await booted.recordOf(run.requestId!))?.status === "suspended")).toBe(true);
    fault.takeSlotOnLapse = true;
    await expectAVisiblePlanFailure(booted, run.requestId!, /wait_taken/);
  }, 20_000);

  it("fails the plan when the ledger's lapse write in its wait throws", async () => {
    holdTheStep();
    const booted = await boot();
    const run = await booted.act("run");
    expect(await booted.until(async () => (await booted.recordOf(run.requestId!))?.status === "suspended")).toBe(true);
    fault.lapseThrows = true;
    await expectAVisiblePlanFailure(booted, run.requestId!, /the ledger store is unavailable/);
  }, 20_000);

  it("fails the plan when the ledger's mark write in its wait throws", async () => {
    holdTheStep();
    const booted = await boot();
    const run = await booted.act("run");
    expect(await booted.until(async () => (await booted.recordOf(run.requestId!))?.status === "suspended")).toBe(true);
    // The next mark is the replay's, after the deadline.
    fault.markThrows = true;
    await expectAVisiblePlanFailure(booted, run.requestId!, /the ledger store is unavailable/);
  }, 20_000);

  it("fails the plan when the row it waits on is gone at its resume", async () => {
    holdTheStep();
    const booted = await boot();
    const run = await booted.act("run");
    expect(await booted.until(async () => (await booted.recordOf(run.requestId!))?.status === "suspended")).toBe(true);
    fault.rowGone = true;
    await expectAVisiblePlanFailure(booted, run.requestId!, /not found/);
  }, 20_000);

  it("fails the plan when its wait gate resumes with something that is not a wait outcome", async () => {
    holdTheStep();
    const booted = await boot();
    const run = await booted.act("run");
    expect(await booted.until(async () => (await booted.recordOf(run.requestId!))?.status === "suspended")).toBe(true);
    fault.garbledResume = true;
    await expectAVisiblePlanFailure(booted, run.requestId!, /not a wait outcome/);
  }, 20_000);

  it("fails the plan when the seam throws once the claim is released, and a later run takes the row up past its lease", async () => {
    holdTheStep();
    const booted = await boot({ seamThrows: true });
    // No park here: the drain's request runs to its end in this call, or never ends.
    const run = await Promise.race([
      booted.act("run"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the drain's request never ended")), 8_000))
    ]);
    await expectAVisiblePlanFailure(booted, run.requestId!, /the session store is unavailable/);

    // Nothing runs the row: no session was born for it. Once its lease lapses,
    // the plan run again claims it, hands it over, and finishes the plan.
    open();
    await new Promise((resolve) => setTimeout(resolve, MIN_LEASE_DURATION_MS + 200));
    const again = await booted.act("run");
    expect(await booted.until(async () => (await booted.recordOf(again.requestId!))?.status === "completed")).toBe(true);
    expect((await booted.rowsNow()).map((row) => [row.id, row.status])).toEqual([
      ["outline", "completed"],
      ["fact-check", "completed"],
      ["publish", "completed"]
    ]);
  }, 20_000);
});
