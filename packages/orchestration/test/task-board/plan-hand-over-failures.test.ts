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
 *   its re-mark: the conditional write a wait makes, put in under
 *   `getTask`'s own check, which refuses that wait (below);
 * - the ledger's `lapseWait` or `markWait` write throws;
 * - the row is gone to the wait's own read when the drain resumes;
 * - the wait gate resumes with something that is not a wait outcome;
 * - the seam throws, rather than refusing, once the claim is released.
 *
 * And the one wait the filing session itself could make on a handed-over
 * row, `getTask({ id, wait: true })` from a turn in the same session, is
 * refused up front, whether the drain holds the row's slot or has lapsed it,
 * and the plan runs on to its end.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, generator, handler, sequencer } from "@flow-state-dev/core";
import type { FlowInstance, GeneratorModel, GeneratorModelCallOptions } from "@flow-state-dev/core/types";
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
import { createTaskToolsCapability, taskSettledEntry } from "../../src";

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
  garbledResume: false,
  /** Hold the drain between its lapse and its re-mark, once: the window a filer's wait would land in. */
  holdAfterLapse: undefined as { lapsed: () => void; release: Promise<void> } | undefined
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
        const hold = fault.holdAfterLapse;
        if (hold !== undefined && id === "fact-check" && lapsed.outcome !== "declined") {
          fault.holdAfterLapse = undefined;
          hold.lapsed();
          await hold.release;
        }
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

/**
 * The filing agent's turn, each time it runs: one
 * `getTask({ id: "fact-check", wait: true })`, then an answer once the tool
 * has returned. `seen` holds what each step was sent.
 */
function filerModel(): { model: GeneratorModel; seen: GeneratorModelCallOptions[] } {
  const seen: GeneratorModelCallOptions[] = [];
  const model: GeneratorModel = {
    modelId: "step-model",
    async generate() {
      throw new Error("legacy generate must not be called");
    },
    async generateStep(options) {
      seen.push(options);
      const last = (options.messages as Array<Record<string, unknown>>).at(-1);
      if (last?.role === "tool") return { text: "done", finishReason: "stop" };
      return {
        toolCalls: [{ toolCallId: `g${seen.length}`, toolName: "getTask", args: { id: "fact-check", wait: true } }],
        finishReason: "tool-calls"
      };
    }
  };
  return { model, seen };
}

/** What the tool returned to the filer's model last: the tool result its latest step was sent. */
function toolResultsOf(seen: GeneratorModelCallOptions[]): string {
  const out: string[] = [];
  const last = (seen.at(-1)?.messages ?? []).at(-1) as Record<string, unknown> | undefined;
  for (const m of last === undefined ? [] : [last]) {
    if (m.role !== "tool" || !Array.isArray(m.content)) continue;
    for (const part of m.content as Array<Record<string, unknown>>) {
      if (part.type === "tool-result") out.push(JSON.stringify(part.output));
    }
  }
  return out.join(" | ");
}

/**
 * @param filer The model of a turn in the plan's own session holding the task
 *   tools over the plan's ledger, run as the `waitOnStep` action. The ledger then
 *   names each row's filer (`delivery`), which a wait needs: this session
 *   filed the plan.
 */
function planFlow(filer?: GeneratorModel): FlowInstance {
  const ledger = defineTaskCollection({
    id: "plan-fail-steps",
    scope: "user",
    ...(filer !== undefined ? { delivery: {} } : {})
  });
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
        .map((row) => ({ id: row.id, status: row.status, wait: row.wait }))
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
      rows: { block: rows },
      ...(filer !== undefined
        ? {
            waitOnStep: {
              block: sequencer({ name: "filer-turn" }).step(
                generator({
                  name: "filer",
                  model: filer,
                  prompt: "p",
                  uses: [
                    createTaskToolsCapability(
                      async (ctx) =>
                        getOrCreateTaskCollection({
                          ctx: ctx as never,
                          backing: "resource",
                          collectionId: "plan-fail-steps",
                          collection: resolveResourceCollection(ctx as never, "plan-fail-steps")!
                        }),
                      undefined,
                      { resumesWaits: true }
                    )
                  ]
                })
              ),
              inputSchema: z.object({}).passthrough()
            }
          }
        : {})
    },
    task: { actions: { work: { block: ownSession } } }
  } as never)({ id: "plan-hand-over-fails" });
}

type Row = { id: string; status: string; wait?: { requestId?: string; lapsed?: true; drain?: true } };

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
    fault.holdAfterLapse = undefined;
  });

  /**
   * @param seamThrows Fail the first child session's birth: the seam throws past the claim's release.
   * @param filer The filing agent's model, run by the `waitOnStep` action (see {@link planFlow}).
   */
  async function boot(options: { seamThrows?: boolean; filer?: GeneratorModel } = {}) {
    const flow = planFlow(options.filer);
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

  describe("a filing agent's getTask wait on a step the drain handed over", () => {
    /** The filer's wait was refused, pointing at the plan, and the plan then ran every row to its end. */
    async function expectRefusedAndThePlanCompletes(
      booted: Awaited<ReturnType<typeof boot>>,
      runId: string,
      waitOnStep: { requestId?: string },
      seen: GeneratorModelCallOptions[]
    ) {
      // Refused in the call: the filer's turn never parked on the step.
      expect({ status: (await booted.recordOf(waitOnStep.requestId!))?.status }).toEqual({ status: "completed" });
      const result = toolResultsOf(seen);
      expect(result).toContain("wait_on_plan_step");
      expect(result).toContain("wait on the plan instead");
      expect(result).toContain("Nothing was written");
      open();
      expect(await booted.until(async () => (await booted.recordOf(runId))?.status === "completed")).toBe(true);
      expect((await booted.rowsNow()).map((row) => [row.id, row.status])).toEqual([
        ["outline", "completed"],
        ["fact-check", "completed"],
        ["publish", "completed"]
      ]);
      // The step has ended, its slot still marked as the drain's: a wait now
      // returns its ending at once, never a refusal pointing at a plan that's over.
      const again = await booted.act("waitOnStep");
      expect({ status: (await booted.recordOf(again.requestId!))?.status }).toEqual({ status: "completed" });
      const ending = toolResultsOf(seen);
      expect(ending).not.toContain("wait_on_plan_step");
      expect(ending).toContain('"ok":true');
      expect(ending).toContain('"id":"fact-check"');
      expect(ending).toContain('"status":"completed"');
    }

    it("is refused while the drain holds the step's wait slot, and the plan completes", async () => {
      holdTheStep();
      const filer = filerModel();
      const booted = await boot({ filer: filer.model });
      const run = await booted.act("run");
      expect(await booted.until(async () => (await booted.recordOf(run.requestId!))?.status === "suspended")).toBe(true);
      const waitOnStep = await booted.act("waitOnStep");
      await expectRefusedAndThePlanCompletes(booted, run.requestId!, waitOnStep, filer.seen);
    }, 20_000);

    it("is refused while the drain has lapsed the slot at its deadline and not yet taken it again, and the plan completes", async () => {
      holdTheStep();
      const filer = filerModel();
      const booted = await boot({ filer: filer.model });
      let release: () => void = () => undefined;
      const lapsed = new Promise<void>((resolve) => {
        fault.holdAfterLapse = {
          lapsed: resolve,
          release: new Promise<void>((done) => {
            release = done;
          })
        };
      });
      const run = await booted.act("run");
      // The drain reached its deadline and lapsed the slot; it is held here, before it takes the slot again.
      await lapsed;
      const waitOnStep = await booted.act("waitOnStep").finally(release);
      await expectRefusedAndThePlanCompletes(booted, run.requestId!, waitOnStep, filer.seen);
    }, 20_000);

    it("gets through once a plan that failed after its lapse has released the step's slot", async () => {
      holdTheStep();
      const filer = filerModel();
      const booted = await boot({ filer: filer.model });
      // The drain lapses the slot at its deadline, and its re-mark throws: the plan fails.
      fault.holdAfterLapse = {
        lapsed: () => {
          fault.markThrows = true;
        },
        release: Promise.resolve()
      };
      const run = await booted.act("run");
      await expectAVisiblePlanFailure(booted, run.requestId!, /the ledger store is unavailable/);
      // The failed drain's request released the slot at its end, and its mark
      // with it: at once, not at the filer's next pass, which comes later (and
      // at least `LAPSED_SLOT_CHECK_MS` later outside this test).
      const released = await booted.until(
        async () => (await booted.rowsNow()).find((row) => row.id === "fact-check")?.wait === undefined,
        300
      );
      expect({ wait: (await booted.rowsNow()).find((row) => row.id === "fact-check")?.wait }).toEqual({ wait: undefined });
      expect(released).toBe(true);
      // So the filer's wait takes the slot and parks on the step, which still runs.
      const waitOnStep = await booted.act("waitOnStep");
      expect({ status: (await booted.recordOf(waitOnStep.requestId!))?.status }).toEqual({ status: "suspended" });
      expect((await booted.rowsNow()).find((row) => row.id === "fact-check")?.wait).toMatchObject({
        requestId: waitOnStep.requestId
      });
      expect(toolResultsOf(filer.seen)).not.toContain("wait_on_plan_step");
    }, 20_000);
  });
});
