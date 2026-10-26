/**
 * The claim gate settles a dispatched task once, when its work is over
 * (FIX-2077, rule 6): its request and that request's background work have
 * ended, and no filed work still holds it. A task that waits keeps its claim
 * with no lease (D1), so it is never run twice.
 *
 * The gate runs as a real action root under `runAction`, so the engine's
 * drains and its request-end seam are the real ones. A second action stands
 * in for a later request for the same task (a notice of a piece's ending):
 * it admits itself with `taskRequestAdmission`.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { ActionCore, BlockContext } from "@flow-state-dev/core/types";
import {
  continueRequest,
  createCheckpointDurabilityProvider,
  createFlowRegistry,
  createInMemoryStores,
  runAction,
} from "@flow-state-dev/engine";
import { z } from "zod";
import {
  askMidway,
  createTaskGate,
  currentWorkerClaim,
  noteTaskAnswer,
  taskRequestAdmission,
  taskWorkerInputSchema,
} from "../../src/task-board";
import { runningTaskOf, takeRunningSteers, type ShownSteer } from "../../src/skills/steer-context";
import { createAskQuestion, createWaitForUserTool } from "../../src/skills/task-tools-capability";
import { runForTest } from "@flow-state-dev/testing";
import {
  createResourceBackedTaskCollection,
  filedWorkHolds,
  openHolds,
  type Task,
  type TaskChangeEvent,
  type TaskCollectionRef,
  type TaskWriteOutcome,
} from "../../src/tasks";
import { createFakeResourceCollection } from "../helpers";
// Not exported from the engine's entry: the stop of a parked turn, as its routes run it.
import { createParkedStopDeps, stopSuspendedRequest } from "../../../engine/src/durability/stop-suspended";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Behaviour = (ctx: BlockContext, ledger: TaskCollectionRef) => Promise<unknown>;

async function harness(
  options: {
    /** Run while the check asks whether filed work holds the task: after its read of the row, before the settle. */
    whileHoldsAreChecked?: (ledger: TaskCollectionRef) => Promise<void>;
    steerTurn?: boolean;
    /** What the gate's `complete` does after the store answers, with that answer. */
    afterComplete?: (outcome: TaskWriteOutcome) => Promise<void>;
    /** What the background step of the task's own work throws, if anything (FIX-2088). */
    workWriteFails?: () => string | undefined;
    /** What the background step of a later request throws, if anything (FIX-2088). */
    laterWriteFails?: () => string | undefined;
  } = {}
) {
  const store = createFakeResourceCollection();
  let clock = 1_000;
  const log: string[] = [];
  const events: TaskChangeEvent[] = [];
  const ledger = () =>
    createResourceBackedTaskCollection({
      collectionId: "settle-ledger",
      collection: store,
      now: () => clock,
      onChange: (event) => {
        events.push(event);
        log.push(`row:${event.kind}`);
      },
    });

  const parent = await ledger();
  await parent.addTask({ id: "t1", goal: "do it", assignee: "coder", input: {}, maxAttempts: 2 });
  const claimed = (await parent.claim("drain", { leaseDurationMs: 10_000 }))!;

  let behaviour: Behaviour = async () => "the answer";
  const worker = sequencer({ name: "settle-worker", inputSchema: taskWorkerInputSchema, durable: true })
    // Background work the task's own work starts: it outlives the entry's return.
    .sideChain(
      handler({
        name: "work-write",
        inputSchema: z.any(),
        execute: async () => {
          await sleep(30);
          const failure = options.workWriteFails?.();
          if (failure !== undefined) throw new Error(failure);
          log.push("wrote:work");
        },
      })
    )
    .step(
    handler({
      name: "settle-work",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) => behaviour(ctx as never, await ledger()),
    })
  );

  // The task session's steer entry (FIX-2086 D2), named when the flow declares one.
  const endRules = {
    filedWorkHolds: async (_ctx: BlockContext, task: Task, ref: TaskCollectionRef) => {
      await options.whileHoldsAreChecked?.(await ledger());
      return filedWorkHolds(ref, task.id);
    },
    ...(options.steerTurn === true ? { steerTurn: { entry: "steerTurn" } } : {}),
  };
  // The waits the gate writes, as it asks for them (a declined one included).
  const waits: Array<string | null> = [];
  const gate = createTaskGate({
    name: "settle-board",
    boardId: "settle-board",
    onError: "skip",
    collection: async () => {
      const ref = await ledger();
      const after = options.afterComplete;
      if (after === undefined) return ref;
      return new Proxy(ref, {
        get: (target, key, receiver) => {
          if (key === "complete") {
            return async (...args: Parameters<TaskCollectionRef["complete"]>) => {
              const outcome = await target.complete(...args);
              await after(outcome);
              return outcome;
            };
          }
          if (key === "setWaitingOn") {
            return async (...args: Parameters<NonNullable<TaskCollectionRef["setWaitingOn"]>>) => {
              waits.push(args[1]);
              return target.setWaitingOn!(...args);
            };
          }
          return Reflect.get(target, key, receiver);
        },
      });
    },
    endRules,
  });
  const entry = gate({ block: worker, durable: true } as unknown as ActionCore, "implement");

  // A later request for the same task: its turn answers, and that answer
  // counts as the task's result only when the entry says so.
  let laterTurn: Behaviour = async () => "a later answer";
  const later = (answerCounts: boolean) =>
    sequencer({ name: `later-${answerCounts}`, inputSchema: z.object({}) })
      .tap(
        taskRequestAdmission({
          name: `later-${answerCounts}`,
          answerCounts,
          find: async () => {
            const ref = await ledger();
            const row = ref.get("t1");
            return row === undefined ? undefined : { ref, row };
          },
          endRules,
        })
      )
      // Background work the later request starts before its turn, so a turn that throws still leaves it running.
      .sideChain(
        handler({
          name: "later-write",
          inputSchema: z.any(),
          execute: async () => {
            await sleep(10);
            const failure = options.laterWriteFails?.();
            if (failure !== undefined) throw new Error(failure);
          },
        })
      )
      .step(
        handler({
          name: `later-turn-${answerCounts}`,
          inputSchema: z.any(),
          outputSchema: z.unknown(),
          execute: async (_input, ctx) => laterTurn(ctx as never, await ledger()),
        })
      )
      .tap(noteTaskAnswer);

  // The turn a steer no request took is owed (D2): admitted for the task, its
  // message the steers it takes, its answer the task's result.
  let steerTurn: (steers: ShownSteer[], ctx: BlockContext, ledger: TaskCollectionRef) => Promise<unknown> = async (steers) =>
    `answered: ${steers.map((s) => s.message).join(", ")}`;
  const steerTurns: string[][] = [];
  // Whether the steer turn takes its steers: an entry that doesn't is the no-progress case.
  let steerTurnTakes = true;
  const steerEntry = sequencer({ name: "steer-turn", inputSchema: z.object({}) })
    .tap(
      taskRequestAdmission({
        name: "steer-turn",
        answerCounts: true,
        find: async () => {
          const ref = await ledger();
          const row = ref.get("t1");
          return row === undefined ? undefined : { ref, row };
        },
        endRules,
      })
    )
    .step(
      handler({
        name: "steer-turn-run",
        inputSchema: z.any(),
        outputSchema: z.unknown(),
        execute: async (_input, ctx) => {
          const running = await runningTaskOf(async () => ledger(), ctx as never);
          const steers =
            running === undefined || !steerTurnTakes ? [] : await takeRunningSteers(running, `turn:${ctx.request.identity.id}`);
          steerTurns.push(steers.map((s) => s.message));
          return steerTurn(steers, ctx as never, await ledger());
        },
      })
    )
    .tap(noteTaskAnswer);

  const flow = defineFlow({
    kind: "settle-gate",
    actions: {
      implement: entry,
      notice: { inputSchema: z.object({}), block: later(true) },
      check: { inputSchema: z.object({}), block: later(false) },
      steerTurn: { inputSchema: z.object({}), block: steerEntry },
    },
    request: {
      // Background work the flow's own end hook starts: the settle waits for it too.
      onFinished: sequencer({ name: "finished" }).sideChain(
        handler({
          name: "finished-write",
          inputSchema: z.any(),
          execute: async () => {
            await sleep(30);
            log.push("wrote:on-finished");
          },
        })
      ),
    },
  } as never)({ id: "settle-gate" });

  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases,
  });
  const runtimeConfig = { durabilityProvider: provider };
  /** Run the task's entry on `claim`: the harness's first claim, or a reclaim's. */
  const run = (claim: Task = claimed) =>
    runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "implement",
      input: {
        boardId: "settle-board",
        assignee: "coder",
        taskId: "t1",
        attempt: claim.attempts,
        createdAt: claim.createdAt,
        incarnationId: claim.incarnationId,
        payload: { taskId: "t1", goal: "do it", attempts: claim.attempts, input: {} },
      },
      userId: "u1",
      sessionId: "s_task",
      stores,
      runtimeConfig,
    });
  const runLater = (actionName: "notice" | "check" | "steerTurn") =>
    runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName,
      input: {},
      userId: "u1",
      sessionId: "s_task",
      stores,
      runtimeConfig,
    });
  const resume = async (requestId: string, data: unknown) => {
    const [suspension] = await provider.listSuspended({ status: "pending" });
    await provider.suspend({ ...suspension!, status: "submitted", resolvedAt: Date.now(), resumeData: data } as never);
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const { finished } = await continueRequest({
      requestId,
      stores,
      flowRegistry: registry,
      resumeContext: { suspensionId: suspension!.suspensionId, action: "submit", data },
      runtimeConfig,
    });
    return finished;
  };

  /** Stop the task's parked request, as the abort route or `ctx.session.stopRequest` stops it. */
  const stop = async (requestId: string) => {
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const deps = createParkedStopDeps({
      provider,
      stores,
      continueRequest: (options) => continueRequest({ ...options, stores, flowRegistry: registry, runtimeConfig } as never) as never,
    });
    const result = await stopSuspendedRequest(deps, (await stores.request.get(requestId))!);
    // The stopped turn continues and ends through its own lifecycle.
    for (let i = 0; i < 200 && (await stores.request.get(requestId))?.status === "suspended"; i += 1) await sleep(10);
    for (let i = 0; i < 200 && (await stores.request.get(requestId))?.finalizedAtMs == null; i += 1) await sleep(10);
    return result;
  };

  return {
    log,
    stop,
    waits,
    /** A steer written onto the stored row alone, as a host's upgrade step writes one: the row's wait is left as it was. */
    rawSteer: async (message: string) => {
      const [instance] = (await store.list()).filter((ref) => (ref.state as { id?: unknown }).id === "t1");
      const row = instance!.state as unknown as Task;
      await instance!.patchState({ steers: [...(row.steers ?? []), { id: `raw:${message}`, message, from: "user", at: clock }] } as never);
    },
    events,
    run,
    runLater,
    resume,
    row: async (): Promise<Task | undefined> => (await ledger()).get("t1"),
    ledger,
    advance: (ms: number) => {
      clock += ms;
    },
    reclaim: async () => (await ledger()).claim("drain", { leaseDurationMs: 10_000 }),
    setBehaviour: (next: Behaviour) => {
      behaviour = next;
    },
    setLaterTurn: (next: Behaviour) => {
      laterTurn = next;
    },
    setSteerTurnTakes: (takes: boolean) => {
      steerTurnTakes = takes;
    },
    setSteerTurn: (next: typeof steerTurn) => {
      steerTurn = next;
    },
    steerTurns,
  };
}

describe("the claim gate settles a task when its work is over", () => {
  it("settles after the entry's side chain and the side chain onFinished starts, once", async () => {
    const h = await harness();
    const before = h.log.length;

    await h.run();

    expect(h.log.slice(before)).toEqual(["row:run_linked", "wrote:work", "wrote:on-finished", "row:completed"]);
    expect(await h.row()).toMatchObject({ status: "completed", output: "the answer", attempts: 1 });
    expect(h.events.filter((e) => e.kind === "completed")).toHaveLength(1);
  });

  it("a task whose filed work is open stays running with no lease, and the next request for it settles it", async () => {
    const h = await harness();
    h.setBehaviour(async (ctx, ledger) => {
      await ledger.addTask({ id: "piece", goal: "a piece", assignee: "helper", filedByTask: currentWorkerClaim(ctx)!.taskId });
      return "first answer";
    });

    await h.run();

    expect(await h.row()).toMatchObject({ status: "in_progress", waitingOn: "filed", output: "first answer", attempts: 1 });
    expect((await h.row())?.leaseUntil).toBeUndefined();
    // Past the lease the claim committed to: the row is not handed out again.
    h.advance(60_000);
    const rival = await h.reclaim();
    expect(rival?.id).toBe("piece");
    expect(await h.row()).toMatchObject({ status: "in_progress", attempts: 1 });

    // The piece ends; the request its ending wakes is the last one for the task.
    await (await h.ledger()).complete("piece", "piece done");
    h.setLaterTurn(async () => "second answer");
    await h.runLater("notice");

    expect(await h.row()).toMatchObject({ status: "completed", output: "second answer", attempts: 1 });
    expect((await h.row())?.waitingOn).toBeUndefined();
  });

  it("a steer written onto a task waiting on its filed work gets its turn once that work ends", async () => {
    const h = await harness({ steerTurn: true });
    h.setBehaviour(async (ctx, ledger) => {
      await ledger.addTask({ id: "piece", goal: "a piece", assignee: "helper", filedByTask: currentWorkerClaim(ctx)!.taskId });
      return "first answer";
    });
    await h.run();
    expect(await h.row()).toMatchObject({ status: "in_progress", waitingOn: "filed" });

    await h.rawSteer("Use the v2 API.");
    expect((await h.reclaim())?.id).toBe("piece");
    await (await h.ledger()).complete("piece", "piece done");
    await h.runLater("notice");

    // The request the piece's end wakes takes no steer: it owes the turn.
    expect(await h.row()).toMatchObject({ status: "in_progress", waitingOn: "steer", attempts: 1 });
    await h.runLater("steerTurn");
    expect(h.steerTurns).toEqual([["Use the v2 API."]]);
    expect(await h.row()).toMatchObject({ status: "completed", output: "answered: Use the v2 API." });
  });

  it("a request whose own filed work ended before it did settles at its end", async () => {
    const h = await harness();
    h.setBehaviour(async (ctx, ledger) => {
      await ledger.addTask({ id: "piece", goal: "a piece", filedByTask: currentWorkerClaim(ctx)!.taskId });
      await ledger.cancel("piece", "not needed");
      return "answer";
    });

    await h.run();

    expect(await h.row()).toMatchObject({ status: "completed", output: "answer" });
  });

  it("a resume keeps the attempt's start on its run link", async () => {
    // The gate links the run again on a resume: the same attempt, started when it was.
    const h = await harness();
    h.setBehaviour(async (ctx) => ({ resumedWith: await ctx.suspend!({ reason: "human_input", message: "waiting" }) }));
    const first = await h.run();
    const startedAt = (await h.row())!.run!.startedAt;
    expect(startedAt).toEqual(expect.any(Number));
    h.advance(60_000);

    await h.resume(first.requestId!, { ok: true });

    expect((await h.row())!.run!.startedAt).toBe(startedAt);
  });

  it.each(["notice", "check"] as const)(
    "a %s request while the task's own request is stopped settles nothing: the task waits on that stop, and the resume settles it",
    async (later) => {
      const h = await harness();
      h.setBehaviour(async (ctx) => {
        const resolution = await ctx.suspend!({ reason: "human_input", message: "which one?" });
        return { resumedWith: resolution };
      });
      const first = await h.run();
      // The stop for a person is mirrored on the row as its suspension hold (FIX-2133).
      expect(await h.row()).toMatchObject({ status: "in_progress", waitingOn: "wait", holds: [{ source: { kind: "suspension" } }] });

      // A piece of the task ends (or a check runs) while its own turn waits on the person.
      h.setLaterTurn(async () => "an answer while it waits");
      await h.runLater(later);

      // The later request keeps the mirror: the task's own run is still parked on it.
      expect(await h.row()).toMatchObject({ status: "in_progress", waitingOn: "wait", attempts: 1, holds: [{ source: { kind: "suspension" } }] });
      expect((await h.row())?.leaseUntil).toBeUndefined();

      const resumed = await h.resume(first.requestId!, { ok: true });
      expect(resumed.error).toBeUndefined();
      expect(await h.row()).toMatchObject({ status: "completed", attempts: 1, output: { resumedWith: { ok: true } } });
    }
  );

  it("a parked request stopped while it waits for a user cancels its task on that attempt (FIX-2129): never left waiting, never asked again", async () => {
    const h = await harness();
    h.setBehaviour(async (ctx) => ctx.suspend!({ reason: "human_input", message: "which one?" }));
    const first = await h.run();
    expect(await h.row()).toMatchObject({ status: "in_progress", waitingOn: "wait", holds: [{ ask: { kind: "input", prompt: "which one?" } }] });

    expect(await h.stop(first.requestId!)).toBe("stopped");

    const row = await h.row();
    // A retry would ask the user the same thing again (rule 12): the stop cancels the task instead.
    expect(row).toMatchObject({ status: "cancelled", attempts: 1 });
    expect(row?.waitingOn).toBeUndefined();
  });

  it.each([
    ["human_input", true],
    ["human_approval", true],
    ["external_event", false],
  ] as const)("a %s stop keeps its claim with no lease, and the resume settles it on attempt 1", async (reason, forPerson) => {
    const h = await harness();
    h.setBehaviour(async (ctx) => {
      const resolution = await ctx.suspend!({ reason, message: "waiting" });
      return { resumedWith: resolution };
    });

    const first = await h.run();

    expect(await h.row()).toMatchObject({ status: "in_progress", waitingOn: "wait", attempts: 1 });
    // Only a stop for a person is mirrored on the row (FIX-2133).
    expect((await h.row())?.holds?.map((hold) => hold.source.kind)).toEqual(forPerson ? ["suspension"] : undefined);
    expect((await h.row())?.leaseUntil).toBeUndefined();
    h.advance(60_000);
    expect(await h.reclaim()).toBeNull();

    const resumed = await h.resume(first.requestId!, { ok: true });

    expect(resumed.error).toBeUndefined();
    expect(await h.row()).toMatchObject({ status: "completed", attempts: 1 });
    expect((await h.row())?.waitingOn).toBeUndefined();
    // The resume's admission closed the mirror.
    expect((await h.row())?.holds).toBeUndefined();
  });
});

describe("a task held on its questions midway (FIX-2133)", () => {
  it("a turn that asks ends unsettled, with no lease; the last answer owes one more turn on its attempt, which settles it", async () => {
    const h = await harness();
    const asked: unknown[] = [];
    h.setBehaviour(async (ctx, ledger) => {
      asked.push(await askMidway(ctx, ledger, [{ prompt: "Which date column?" }]));
      return "a partial answer";
    });
    await h.run();
    expect(asked).toEqual([{ ok: true, holds: [expect.any(String)] }]);
    const held = (await h.row())!;
    expect(held).toMatchObject({ status: "in_progress", attempts: 1, turn: 1 });
    expect(held.leaseUntil).toBeUndefined();
    expect(h.events.filter((e) => e.kind === "completed")).toHaveLength(0);
    // Past the lease: nothing takes it back while the question is open.
    h.advance(60_000);
    expect(await h.reclaim()).toBeNull();

    const hold = openHolds(held)[0]!.id;
    await (await h.ledger()).answer!("t1", { hold, message: "signup_date", from: "user", by: "u1" });
    h.setBehaviour(async () => "the whole answer");
    const turn = (await h.reclaim())!;
    expect(turn).toMatchObject({ attempts: 1, turn: 2 });
    await h.run(turn);
    expect(await h.row()).toMatchObject({ status: "completed", attempts: 1, output: "the whole answer" });
    expect(h.events.filter((e) => e.kind === "completed")).toHaveLength(1);
  });

  it("a question answered before the asking request ends still owes the next turn: the asking request settles nothing", async () => {
    const h = await harness();
    h.setBehaviour(async (ctx, ledger) => {
      const asked = await askMidway(ctx, ledger, [{ prompt: "Which date column?" }]);
      if (asked.ok) await ledger.answer!("t1", { hold: asked.holds[0]!, message: "signup_date", from: "user", by: "u1" });
      return "a partial answer";
    });
    await h.run();
    const row = (await h.row())!;
    expect(row).toMatchObject({ status: "in_progress", attempts: 1, turn: 1, turnOwed: true });
    expect(h.events.filter((e) => e.kind === "completed")).toHaveLength(0);

    h.setBehaviour(async () => "the whole answer");
    const turn = (await h.reclaim())!;
    expect(turn).toMatchObject({ attempts: 1, turn: 2 });
    await h.run(turn);
    expect(await h.row()).toMatchObject({ status: "completed", attempts: 1, output: "the whole answer" });
  });

  it("a turn that asked and was answered before it stopped for the user opens no stop on the row: the owed turn stays claimable", async () => {
    const h = await harness();
    h.setBehaviour(async (ctx, ledger) => {
      const asked = await askMidway(ctx, ledger, [{ prompt: "Which date column?" }]);
      if (asked.ok) await ledger.answer!("t1", { hold: asked.holds[0]!, message: "signup_date", from: "user", by: "u1" });
      // The same turn now stops for the user: one wait per turn, though its question is answered.
      return ctx.waitForUser({ kind: "approval", prompt: "Ship it now?" });
    });
    const first = await h.run();
    const row = (await h.row())!;
    expect(openHolds(row)).toEqual([]);
    expect(row).toMatchObject({ status: "in_progress", attempts: 1, turn: 1, turnOwed: true });
    expect(row.waitingOn).toBeUndefined();
    // The asking turn's own resume (its stop answered anyway, this harness having no cancel) takes neither the
    // owed turn nor a lease, and settles nothing.
    await h.resume(first.requestId!, { ok: true });
    expect(await h.row()).toMatchObject({ status: "in_progress", attempts: 1, turn: 1, turnOwed: true });
    expect(h.events.filter((e) => e.kind === "completed")).toHaveLength(0);
    expect(await h.reclaim()).toMatchObject({ attempts: 1, turn: 2 });
  });

  it("a durable turn replayed after a stop asks once: the replay gets the first ask back, not the questions twice", async () => {
    const h = await harness();
    // The request store's memo, as a durable host's `runOnce` keeps it across a resume's replay.
    const memo = new Map<string, unknown>();
    const runOnce = async <T,>(key: string, fn: () => Promise<T>): Promise<T> => {
      if (!memo.has(key)) memo.set(key, await fn());
      return memo.get(key) as T;
    };
    const asked: unknown[] = [];
    h.setBehaviour(async (ctx, ledger) => {
      const durable = Object.assign(Object.create(ctx), { runOnce });
      // The first execution, then the replay of the code before its stop.
      asked.push(await askMidway(durable, ledger, [{ prompt: "Which date column?" }]));
      asked.push(await askMidway(durable, ledger, [{ prompt: "Which date column?" }]));
      return "a partial answer";
    });
    await h.run();
    expect(openHolds((await h.row())!)).toHaveLength(1);
    expect(asked[1]).toEqual(asked[0]);
  });

  it("one wait per turn: the stop arm refuses to mirror a stop for a person on a row its own questions hold", async () => {
    // The cancel of the refused stop needs the host's resume, which this harness
    // has none of: the goal proves it on a real host (FIX-2133, leg e).
    const h = await harness();
    h.setBehaviour(async (ctx, ledger) => {
      await askMidway(ctx, ledger, [{ prompt: "Which date column?" }]);
      return ctx.waitForUser({ kind: "approval", prompt: "Ship it now?" });
    });
    await h.run();
    const row = (await h.row())!;
    // The row holds its question alone: no mirror, no wait recorded, not settled.
    expect(openHolds(row).map((hold) => hold.source.kind)).toEqual(["row"]);
    expect(row).toMatchObject({ status: "in_progress", attempts: 1 });
    expect(row.waitingOn).toBeUndefined();
  });
});

describe("a steer no request took gives the task one more turn before it settles (FIX-2086 D2)", () => {
  const steer = async (ledger: TaskCollectionRef, message: string) => ledger.steer!("t1", { message, from: "filer" });

  it("a steer after the last model call holds the task open with no lease, and its turn settles it once", async () => {
    const h = await harness({ steerTurn: true });
    h.setBehaviour(async (_ctx, ledger) => {
      // The last model call is over; the redirect lands before the request ends.
      await steer(ledger, "Use the North America numbers");
      return "first answer";
    });

    await h.run();

    expect(await h.row()).toMatchObject({ status: "in_progress", waitingOn: "steer", output: "first answer", attempts: 1 });
    expect((await h.row())?.leaseUntil).toBeUndefined();
    expect(h.events.filter((e) => e.kind === "completed")).toHaveLength(0);

    // The owed turn (the wake's, or its fast-path start) runs with the steer as its message.
    await h.runLater("steerTurn");

    expect(h.steerTurns).toEqual([["Use the North America numbers"]]);
    expect(await h.row()).toMatchObject({ status: "completed", output: "answered: Use the North America numbers", attempts: 1 });
    expect(h.events.filter((e) => e.kind === "completed")).toHaveLength(1);
  });

  it("with no wake to start it, the claim takes the owed steer turn on its same attempt, and whichever claims first wins (FIX-2133 D3)", async () => {
    const h = await harness({ steerTurn: true });
    h.setBehaviour(async (_ctx, ledger) => {
      await steer(ledger, "Use the North America numbers");
      return "first answer";
    });
    await h.run();
    expect(await h.row()).toMatchObject({ status: "in_progress", waitingOn: "steer", attempts: 1, turn: 1 });

    // The board's claim is the backstop: the same attempt, uncharged, a new turn, the mark cleared.
    h.setBehaviour(async () => "second answer");
    const claimed = await h.reclaim();
    expect(claimed).toMatchObject({ id: "t1", attempts: 1, turn: 2 });
    expect(claimed?.waitingOn).toBeUndefined();
    // The steer turn's start, arriving after, finds the turn taken: admitted for nothing, it takes no steer.
    await h.runLater("steerTurn");
    expect(h.steerTurns).toEqual([[]]);
    expect(await h.row()).toMatchObject({ status: "in_progress", attempts: 1, turn: 2 });

    await h.run(claimed!);
    expect(await h.row()).toMatchObject({ status: "completed", output: "second answer", attempts: 1 });
    expect(h.events.filter((e) => e.kind === "completed")).toHaveLength(1);
  });

  it("a steer the request took before its end settles at that end, with no extra turn", async () => {
    const h = await harness({ steerTurn: true });
    h.setBehaviour(async (ctx, ledger) => {
      await steer(ledger, "Skip the archive");
      const running = await runningTaskOf(async () => ledger, ctx);
      await takeRunningSteers(running!, `step:${ctx.request.identity.id}`);
      return "took it";
    });

    await h.run();

    expect(await h.row()).toMatchObject({ status: "completed", output: "took it", attempts: 1 });
  });

  it.each([
    ["reports no checkpoint", undefined, "checkpoint 1"],
    ["reports its own checkpoint", "checkpoint 2", "checkpoint 2"],
  ] as const)("after a checkpoint, a steer turn that %s settles on the latest checkpoint", async (_label, turnCheckpoint, output) => {
    const h = await harness({ steerTurn: true });
    h.setBehaviour(async (ctx, ledger) => {
      await ledger.reportProgress!("t1", { output: "checkpoint 1" }, { claim: currentWorkerClaim(ctx)! });
      await steer(ledger, "Add the totals");
      return "the answer";
    });
    h.setSteerTurn(async (_steers, ctx, ledger) => {
      if (turnCheckpoint !== undefined) {
        await ledger.reportProgress!("t1", { output: turnCheckpoint }, { claim: currentWorkerClaim(ctx)! });
      }
      return "the steer turn's answer";
    });

    await h.run();
    await h.runLater("steerTurn");

    expect(await h.row()).toMatchObject({ status: "completed", output, attempts: 1 });
  });

  it("a second steer during the owed turn gets one more, and the task settles after it", async () => {
    const h = await harness({ steerTurn: true });
    h.setBehaviour(async (_ctx, ledger) => {
      await steer(ledger, "first");
      return "a";
    });
    h.setSteerTurn(async (steers, _ctx, ledger) => {
      if (steers[0]?.message === "first") await steer(ledger, "second");
      return `turn for ${steers.map((s) => s.message).join(",")}`;
    });

    await h.run();
    await h.runLater("steerTurn");
    expect(await h.row()).toMatchObject({ status: "in_progress", waitingOn: "steer" });
    await h.runLater("steerTurn");

    expect(h.steerTurns).toEqual([["first"], ["second"]]);
    expect(await h.row()).toMatchObject({ status: "completed", output: "turn for second", attempts: 1 });
  });

  it("a steer that lands after the check read the row, before the settle, still gets its turn", async () => {
    // The steer arrives while the gate asks whether filed work holds the
    // task: after its own read of the row, before the complete. The complete
    // itself declines.
    let steered = false;
    const h = await harness({
      steerTurn: true,
      whileHoldsAreChecked: async (ledger) => {
        if (!steered) {
          steered = true;
          await steer(ledger, "late redirect");
        }
      },
    });
    h.setBehaviour(async () => "first answer");

    await h.run();

    expect(await h.row()).toMatchObject({ status: "in_progress", waitingOn: "steer", attempts: 1 });
    expect(h.events.filter((e) => e.kind === "completed")).toHaveLength(0);
    await h.runLater("steerTurn");

    expect(h.steerTurns).toEqual([["late redirect"]]);
    expect(await h.row()).toMatchObject({ status: "completed", output: "answered: late redirect", attempts: 1 });
    expect(h.events.filter((e) => e.kind === "completed")).toHaveLength(1);
  });

  it("a complete that declines for a steer owes no turn once another attempt has the row: the steer is that attempt's", async () => {
    // Between the decline and the check that runs again, the lease lapses, the
    // row is claimed again, and a steer lands for the new attempt.
    let raced = false;
    let h: Awaited<ReturnType<typeof harness>>;
    h = await harness({
      steerTurn: true,
      afterComplete: async (outcome) => {
        if (raced || outcome.outcome !== "declined" || outcome.reason !== "untaken-steers") return;
        raced = true;
        h.advance(10_000);
        expect((await h.reclaim())?.attempts).toBe(2);
        await steer(await h.ledger(), "for the second attempt");
      },
      whileHoldsAreChecked: async (ledger) => {
        // After the check's read, before the complete: the complete declines.
        if ((await ledger.get("t1"))?.steers === undefined) await steer(ledger, "late redirect");
      },
    });
    h.setBehaviour(async () => "first answer");

    await h.run();

    expect(raced).toBe(true);
    // The first attempt owes no turn: it never asks to wait on the steer.
    expect(h.waits).not.toContain("steer");
    expect(await h.row()).toMatchObject({ status: "in_progress", attempts: 2 });
    expect((await h.row())?.waitingOn).toBeUndefined();
    expect(h.events.filter((e) => e.kind === "completed")).toHaveLength(0);
  });

  it("a steer turn that takes none of its steers settles the task instead of owing another turn", async () => {
    const h = await harness({ steerTurn: true });
    h.setBehaviour(async (_ctx, ledger) => {
      await steer(ledger, "never read");
      return "first answer";
    });
    // An entry that is admitted but never takes: each turn would owe the next.
    h.setSteerTurnTakes(false);

    await h.run();
    await h.runLater("steerTurn");

    expect(h.steerTurns).toEqual([[]]);
    const row = await h.row();
    expect(row).toMatchObject({ status: "completed", attempts: 1 });
    expect(row?.steers).toEqual([expect.objectContaining({ message: "never read" })]);
    expect(row?.steers?.[0]?.takenBy).toBeUndefined();
    expect(h.events.filter((e) => e.kind === "completed")).toHaveLength(1);
  });

  it("a flow that declares no steer entry settles as before", async () => {
    const h = await harness();
    h.setBehaviour(async (_ctx, ledger) => {
      await steer(ledger, "too late");
      return "first answer";
    });

    await h.run();

    expect(await h.row()).toMatchObject({ status: "completed", output: "first answer" });
  });
});

/**
 * A task's background work that errors fails its attempt (FIX-2088), exactly
 * as if its request had thrown: it retries while attempts are left, otherwise
 * it fails, with the step named. The request itself stays completed (D2).
 */
describe("a task's background error fails its attempt", () => {
  it("a background step of the task's own work that throws fails the attempt, and the retry's result is the output", async () => {
    let fails: string | undefined = "capture timed out";
    const h = await harness({ workWriteFails: () => fails });

    const first = await h.run();

    expect(first.error).toBeUndefined();
    const retried = await h.row();
    expect(retried).toMatchObject({ status: "pending", attempts: 1 });
    expect(retried?.feedback).toContain('"work-write"');
    expect(retried?.feedback).toContain("capture timed out");
    // The attempt's answer is never recorded: the attempt failed.
    expect(retried?.output).toBeUndefined();

    fails = undefined;
    h.setBehaviour(async () => "the second answer");
    await h.run((await h.reclaim())!);

    expect(await h.row()).toMatchObject({ status: "completed", attempts: 2, output: "the second answer" });
  });

  it("a background step that always throws fails the task after its last attempt, with the step named", async () => {
    const h = await harness({ workWriteFails: () => "capture timed out" });

    await h.run();
    await h.run((await h.reclaim())!);

    const row = await h.row();
    expect(row).toMatchObject({ status: "errored", attempts: 2 });
    expect(row?.error).toContain('"work-write"');
    expect(row?.error).toContain("capture timed out");
    expect(h.events.filter((e) => e.kind === "completed")).toHaveLength(0);
  });

  /** The task's work files a piece and answers; the piece then ends, so the notice of its ending is the request that checks it. */
  async function waitingOnAPiece(h: Awaited<ReturnType<typeof harness>>) {
    h.setBehaviour(async (ctx, ledger) => {
      await ledger.addTask({ id: "piece", goal: "a piece", assignee: "helper", filedByTask: currentWorkerClaim(ctx)!.taskId });
      return "first answer";
    });
    await h.run();
    expect(await h.row()).toMatchObject({ status: "in_progress", waitingOn: "filed" });
    expect((await h.reclaim())?.id).toBe("piece");
    await (await h.ledger()).complete("piece", "piece done");
  }

  it("a background step of a later request admitted for the task that throws fails the attempt", async () => {
    const h = await harness({ laterWriteFails: () => "the notice's write failed" });
    await waitingOnAPiece(h);

    await h.runLater("notice");

    const row = await h.row();
    expect(row).toMatchObject({ status: "pending", attempts: 1 });
    expect(row?.feedback).toContain('"later-write"');
  });

  it("when the request also threw, the request's own error is the one recorded", async () => {
    // A later request: no gate rescue fails the attempt in-band, so the check
    // at its end is the one that records which error failed it.
    const h = await harness({ laterWriteFails: () => "the notice's write failed" });
    await waitingOnAPiece(h);

    h.setLaterTurn(async () => {
      throw new Error("the notice broke");
    });
    await h.runLater("notice");

    const row = await h.row();
    expect(row).toMatchObject({ status: "pending", attempts: 1 });
    expect(row?.feedback).toContain("the notice broke");
    expect(row?.feedback).not.toContain("the notice's write failed");
  });
});

/**
 * The model's two ways to wait on a person from a task turn (FIX-2131):
 * `askQuestion` holds the task, `waitForUser` suspends its run for an
 * approval or a review, and a turn opens one of them, never both. The tools
 * run inside the gate's real request, so their claim is the gate's.
 */
describe("a task turn's model waits on a person one way per turn (FIX-2131)", () => {
  const tools = (ledger: TaskCollectionRef) => ({
    question: createAskQuestion({ resolve: async () => ledger }).tool,
    wait: createWaitForUserTool({ resolve: async () => ledger }).tool,
  });

  it("askQuestion holds the task on the question: the turn ends unsettled, and the answer owes one more turn on the same attempt", async () => {
    const h = await harness();
    const said: unknown[] = [];
    h.setBehaviour(async (ctx, ledger) => {
      said.push(await runForTest(tools(ledger).question, { question: "Which region?" }, ctx));
      return "what I have so far";
    });
    await h.run();
    expect(said).toEqual([{ ok: true, taskId: "t1", questionId: expect.any(String) }]);
    const held = (await h.row())!;
    expect(held).toMatchObject({ status: "in_progress", attempts: 1 });
    expect(held.leaseUntil).toBeUndefined();
    expect(openHolds(held).map((hold) => hold.ask)).toEqual([{ kind: "question", prompt: "Which region?" }]);
    expect(h.events.filter((e) => e.kind === "completed")).toHaveLength(0);

    await (await h.ledger()).answer!("t1", { hold: openHolds(held)[0]!.id, message: "EU", from: "user", by: "u1" });
    h.setBehaviour(async () => "the EU answer");
    const turn = (await h.reclaim())!;
    expect(turn).toMatchObject({ attempts: 1 });
    await h.run(turn);
    expect(await h.row()).toMatchObject({ status: "completed", attempts: 1, output: "the EU answer" });
  });

  it("waitForUser refuses input on a task turn, naming askQuestion, and writes nothing", async () => {
    const h = await harness();
    const said: unknown[] = [];
    h.setBehaviour(async (ctx, ledger) => {
      said.push(await runForTest(tools(ledger).wait, { kind: "input", prompt: "Which region?" }, ctx));
      return "done without asking";
    });
    await h.run();
    expect(said).toEqual([{ ok: false, error: expect.stringMatching(/^input_is_a_question: .*askQuestion/) }]);
    const row = (await h.row())!;
    expect(row.holds ?? []).toEqual([]);
    expect(row).toMatchObject({ status: "completed", output: "done without asking" });
  });

  it("askQuestion and waitForUser in one step: the question, first, holds; the review is refused naming it, and the row has one source of holds", async () => {
    const h = await harness();
    const said: unknown[] = [];
    h.setBehaviour(async (ctx, ledger) => {
      const { question, wait } = tools(ledger);
      const settled = await Promise.allSettled([
        runForTest(question, { question: "Which region?" }, ctx),
        runForTest(wait, { kind: "review", prompt: "Does this draft read right?" }, ctx),
      ]);
      said.push(...settled.map((s) => (s.status === "fulfilled" ? s.value : String(s.reason))));
      return "partial";
    });
    await h.run();
    expect(said).toEqual([
      { ok: true, taskId: "t1", questionId: expect.any(String) },
      { ok: false, error: expect.stringMatching(/^one_wait_per_turn: .*askQuestion/) },
    ]);
    const row = (await h.row())!;
    expect(openHolds(row).map((hold) => hold.source.kind)).toEqual(["row"]);
  });

  it("waitForUser and askQuestion in one step: the review, first, suspends the run; the question is refused naming it, and no question is kept", async () => {
    const h = await harness();
    const said: unknown[] = [];
    h.setBehaviour(async (ctx, ledger) => {
      const { question, wait } = tools(ledger);
      const settled = await Promise.allSettled([
        runForTest(wait, { kind: "review", prompt: "Does this draft read right?" }, ctx),
        runForTest(question, { question: "Which region?" }, ctx),
      ]);
      said.push(settled[1]!.status === "fulfilled" ? settled[1]!.value : settled[1]!.reason);
      if (settled[0]!.status === "rejected") throw settled[0]!.reason;
      return settled[0]!.value;
    });
    const first = await h.run();
    expect(said).toEqual([{ ok: false, error: expect.stringMatching(/^one_wait_per_turn: .*waitForUser/) }]);
    const row = (await h.row())!;
    expect(openHolds(row).map((hold) => [hold.source.kind, hold.ask.kind])).toEqual([["suspension", "review"]]);

    // The review's verdict resumes the block on its attempt, which settles with it.
    await h.resume(first.requestId!, "looks right");
    const done = (await h.row())!;
    expect(done).toMatchObject({ status: "completed", attempts: 1 });
    expect(done.output).toEqual({ ok: true, kind: "review", answered: true, answer: "looks right" });
  });
});
