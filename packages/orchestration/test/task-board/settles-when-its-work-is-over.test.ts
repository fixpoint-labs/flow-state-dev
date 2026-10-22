/**
 * The claim gate settles a dispatched task once, when its work is over
 * (FIX-2077, rule 6): its request and that request's background work have
 * ended, no filed work still holds it, and nothing is queued for it. A task
 * that waits keeps its claim with no lease (D1), so it is never run twice.
 *
 * The gate runs as a real action root under `runAction`, so the engine's
 * drains and its request-end seam are the real ones. A second action stands
 * in for a later request for the same task (a notice of a piece's ending, a
 * queued message): it admits itself with `taskRequestAdmission`.
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
  createTaskGate,
  currentWorkerClaim,
  noteTaskAnswer,
  taskRequestAdmission,
  taskWorkerInputSchema,
} from "../../src/task-board";
import { runningTaskOf, takeRunningSteers, type ShownSteer } from "../../src/skills/steer-context";
import {
  createResourceBackedTaskCollection,
  type Task,
  type TaskChangeEvent,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createFakeResourceCollection } from "../helpers";
// Not exported from the engine's entry: the stop of a parked turn, as its routes run it.
import { createParkedStopDeps, stopSuspendedRequest } from "../../../engine/src/durability/stop-suspended";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Behaviour = (ctx: BlockContext, ledger: TaskCollectionRef) => Promise<unknown>;

async function harness(options: { queued?: () => boolean; steerTurn?: boolean } = {}) {
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
    workQueued: async () => options.queued?.() ?? false,
    ...(options.steerTurn === true ? { steerTurn: { entry: "steerTurn" } } : {}),
  };
  const gate = createTaskGate({
    name: "settle-board",
    boardId: "settle-board",
    onError: "skip",
    collection: async () => ledger(),
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
          const steers = running === undefined ? [] : await takeRunningSteers(running, `turn:${ctx.request.identity.id}`);
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
      message: { inputSchema: z.object({}), block: later(false) },
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
  const run = () =>
    runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "implement",
      input: {
        boardId: "settle-board",
        assignee: "coder",
        taskId: "t1",
        attempt: claimed.attempts,
        createdAt: claimed.createdAt,
        incarnationId: claimed.incarnationId,
        payload: { taskId: "t1", goal: "do it", attempts: claimed.attempts, input: {} },
      },
      userId: "u1",
      sessionId: "s_task",
      stores,
      runtimeConfig,
    });
  const runLater = (actionName: "notice" | "message" | "steerTurn") =>
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

  it("a message queued for the task runs before the settle, and its answer never becomes the output", async () => {
    let queued = true;
    const h = await harness({ queued: () => queued });

    await h.run();
    expect(await h.row()).toMatchObject({ status: "in_progress", waitingOn: "queued", output: "the answer" });

    queued = false;
    h.setLaterTurn(async () => "the message's answer");
    await h.runLater("message");

    expect(await h.row()).toMatchObject({ status: "completed", output: "the answer" });
  });

  it("a task held by a queued message keeps its claim's lease, and its run link says when the attempt started", async () => {
    const h = await harness({ queued: () => true });

    await h.run();

    const row = (await h.row())!;
    expect(row).toMatchObject({ status: "in_progress", waitingOn: "queued" });
    // What the message rule counts from: messages from before this attempt hold nothing.
    expect(row.run?.startedAt).toEqual(expect.any(Number));
    // A message that never runs must not hold the task forever: a span from
    // the check, the lease lapses and the reclaim takes the task back.
    expect(row.leaseUntil).toBeGreaterThanOrEqual(row.run!.startedAt! + row.leaseDurationMs!);
  });

  it("a resume keeps the attempt's start: a message sent before it still counts as queued", async () => {
    // The gate links the run again on a resume. Restarting the window there
    // would drop a message delivered while the task waited, and the task would
    // complete past it.
    const h = await harness();
    h.setBehaviour(async (ctx) => ({ resumedWith: await ctx.suspend!({ reason: "human_input", message: "waiting" }) }));
    const first = await h.run();
    const startedAt = (await h.row())!.run!.startedAt;
    expect(startedAt).toEqual(expect.any(Number));
    h.advance(60_000);

    await h.resume(first.requestId!, { ok: true });

    expect((await h.row())!.run!.startedAt).toBe(startedAt);
  });

  it("a checkpoint the message's request reports is the output", async () => {
    let queued = true;
    const h = await harness({ queued: () => queued });
    await h.run();

    queued = false;
    h.setLaterTurn(async (ctx, ledger) => {
      await ledger.reportProgress!("t1", { output: "checkpointed" }, { claim: currentWorkerClaim(ctx)! });
      return "the message's answer";
    });
    await h.runLater("message");

    expect(await h.row()).toMatchObject({ status: "completed", output: "checkpointed" });
  });

  it.each(["notice", "message"] as const)(
    "a %s request while the task's own request is stopped settles nothing: the task waits on that stop, and the resume settles it",
    async (later) => {
      const h = await harness();
      h.setBehaviour(async (ctx) => {
        const resolution = await ctx.suspend!({ reason: "human_input", message: "which one?" });
        return { resumedWith: resolution };
      });
      const first = await h.run();
      expect(await h.row()).toMatchObject({ status: "in_progress", waitingOn: "person" });

      // A piece of the task ends (or a message arrives) while its own turn waits on the person.
      h.setLaterTurn(async () => "an answer while it waits");
      await h.runLater(later);

      expect(await h.row()).toMatchObject({ status: "in_progress", waitingOn: "person", attempts: 1 });
      expect((await h.row())?.leaseUntil).toBeUndefined();

      const resumed = await h.resume(first.requestId!, { ok: true });
      expect(resumed.error).toBeUndefined();
      expect(await h.row()).toMatchObject({ status: "completed", attempts: 1, output: { resumedWith: { ok: true } } });
    }
  );

  it("a parked request that is stopped fails its attempt: the task never sits waiting with no lease and no payer", async () => {
    const h = await harness();
    h.setBehaviour(async (ctx) => ctx.suspend!({ reason: "human_input", message: "which one?" }));
    const first = await h.run();
    expect(await h.row()).toMatchObject({ status: "in_progress", waitingOn: "person" });

    expect(await h.stop(first.requestId!)).toBe("stopped");

    const row = await h.row();
    // Two attempts: the stopped one fails and the task goes back for its retry.
    expect(row?.status === "pending" || row?.status === "errored").toBe(true);
    expect(row?.waitingOn).toBeUndefined();
  });

  it.each([
    ["human_input", "person"],
    ["human_approval", "person"],
    ["external_event", "wait"],
  ] as const)("a %s stop keeps its claim with no lease, and the resume settles it on attempt 1", async (reason, waitingOn) => {
    const h = await harness();
    h.setBehaviour(async (ctx) => {
      const resolution = await ctx.suspend!({ reason, message: "waiting" });
      return { resumedWith: resolution };
    });

    const first = await h.run();

    expect(await h.row()).toMatchObject({ status: "in_progress", waitingOn, attempts: 1 });
    expect((await h.row())?.leaseUntil).toBeUndefined();
    h.advance(60_000);
    expect(await h.reclaim()).toBeNull();

    const resumed = await h.resume(first.requestId!, { ok: true });

    expect(resumed.error).toBeUndefined();
    expect(await h.row()).toMatchObject({ status: "completed", attempts: 1 });
    expect((await h.row())?.waitingOn).toBeUndefined();
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
    // Past the claim's lease: no reclaim runs the task again.
    h.advance(60_000);
    expect(await h.reclaim()).toBeNull();

    // The owed turn (the wake's, or its fast-path start) runs with the steer as its message.
    await h.runLater("steerTurn");

    expect(h.steerTurns).toEqual([["Use the North America numbers"]]);
    expect(await h.row()).toMatchObject({ status: "completed", output: "answered: Use the North America numbers", attempts: 1 });
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
