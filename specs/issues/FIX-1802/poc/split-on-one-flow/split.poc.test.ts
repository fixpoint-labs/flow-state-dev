/**
 * FIX-1802 POC · the split, on ONE worker flow, on TODAY's task board.
 * Experimental evidence, not a maintained test: run it with `run.sh`, which
 * copies it into packages/orchestration/test for the run.
 *
 * One flow, `worker-poc`, stands in for any worker flow that carries the
 * filing capability (`agent`, the coordinator, an app's own `em`). It keeps a
 * board in each of its sessions and it works tasks, so a worker on it can file
 * for a worker on the same flow: the case FIX-1794's POC never ran, because it
 * used two flows. Two user-scoped ledgers stand in for two of D6's partitions
 * (the conversation's and the task session's), which are not on `main`.
 *
 * Legs:
 *   O1  one flow    a board whose rows go to `work` on its OWN flow, through a
 *                   per-task target, where `work` takes rows `from` a ledger
 *                   resolver: does `defineFlow` accept it, and does it run?
 *   P1  the split   the task session files two pieces on its own board, parks
 *                   its own row, and its turn ends: does the board above exit
 *                   instead of waiting on the parked row?
 *   P2  settle      the pieces end and tell the task session. In that LATER
 *                   request, does the parked row above settle through the
 *                   binding written at park (its ledger and claim ticket),
 *                   with no task-board change, and does the conversation hear?
 *   P3  the fence   a forged ticket is refused on the parked row, and a replay
 *                   of the settle after it landed writes nothing.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  ticketForClaim,
  type Task,
  type TaskClaimTicket,
  type TaskCollectionRef,
  type TaskWorkerInput,
} from "../src/tasks";
import { taskBoard, taskLedgers, taskWorkerInputSchema } from "../src/task-board";

const FLOW = "worker-poc";
const ALICE = "alice";
const CONV = "conv_c";
const TOP = "top-tasks"; // stands in for the conversation's partition
const SPLIT = "split-tasks"; // stands in for the task session's partition

const topLedger = Object.assign(defineTaskCollection({ id: TOP, scope: "user" }), { id: TOP });
const splitLedger = Object.assign(defineTaskCollection({ id: SPLIT, scope: "user" }), { id: SPLIT });

/** What happened, in order. */
const ran: Array<{ taskId: string; sessionId: string }> = [];
const heard: Array<{ sessionId: string; taskId: string; status: string }> = [];
const settles: Array<{ outcome: string }> = [];
/** The parent binding S8 writes at park. Server-written state in the build; a map here. */
const bindings = new Map<string, { ledger: string; taskId: string; ticket: TaskClaimTicket; conversation: string }>();

const sessionOf = (ctx: BlockContext) => ctx.session.identity.id as string;

async function ledgerRef(ctx: BlockContext, id: string): Promise<TaskCollectionRef> {
  const collection = resolveResourceCollection(ctx, id);
  if (collection === undefined) throw new Error(`no ledger ${id}`);
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: id, collection });
}

/** Every board on this flow hands rows to `work` on THIS flow, through a per-task target. */
const handOff = (name: string) =>
  dispatcher<TaskWorkerInput>({ name, action: "work", session: "per-task", flowKind: () => FLOW });

const topBoard = taskBoard({
  name: "top_board",
  boardId: TOP,
  collection: topLedger,
  workers: {},
  defaultWorker: handOff("top-hand-off"),
  onReview: "exit",
  idlePollMs: 5,
  maxIterations: 200,
});

const splitBoard = taskBoard({
  name: "split_board",
  boardId: SPLIT,
  collection: splitLedger,
  workers: {},
  defaultWorker: handOff("split-hand-off"),
  onReview: "exit",
  idlePollMs: 5,
  maxIterations: 200,
});

/** The conversation files one top task. Its own id goes on the row from its own session, never input. */
const fileTop = handler({
  name: "file-top",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.null(),
  uses: [topBoard.capability],
  execute: async (input, ctx: any) => {
    await ctx.cap.top_board.addTask({ id: input.id, goal: input.id, assignee: "splitter", metadata: { conversation: sessionOf(ctx) } });
    return null;
  },
});

/** Start-on-add, for the task session's own board: a request of its own, in its own session. */
const runMySplitBoard = dispatcher({
  name: "run-my-split-board",
  action: "drainSplit",
  session: { id: (_input: unknown, ctx: BlockContext) => sessionOf(ctx) },
});

/** The worker. A top task splits; a piece just finishes. */
const work = handler({
  name: "work",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ taskId: z.string(), parked: z.boolean() }),
  execute: async (input: TaskWorkerInput, ctx: any) => {
    ran.push({ taskId: input.taskId, sessionId: sessionOf(ctx) });
    // A piece (`t1.p1`) just finishes; a top task (`t1`) splits.
    if (input.taskId.includes(".")) return { taskId: input.taskId, parked: false };

    // The split: two pieces on this task session's own board.
    const mine = await ledgerRef(ctx, SPLIT);
    await mine.addTask({ id: `${input.taskId}.p1`, goal: "piece one", assignee: "piecer" });
    await mine.addTask({ id: `${input.taskId}.p2`, goal: "piece two", assignee: "piecer" });

    // Park its own row above, and write the parent binding from the row it holds.
    const top = await ledgerRef(ctx, TOP);
    await top.awaitReview(input.taskId, "waiting on its pieces");
    const row = top.get(input.taskId)!;
    bindings.set(sessionOf(ctx), {
      ledger: TOP,
      taskId: input.taskId,
      ticket: ticketForClaim(top.collectionId, row),
      conversation: (row.metadata as { conversation: string }).conversation,
    });
    return { taskId: input.taskId, parked: true };
  },
});

/** A piece's ending goes to whoever handed it over: the task session. */
const tellSender = dispatcher({
  name: "tell-sender",
  action: "settled",
  inputSchema: z.object({ taskId: z.string(), parked: z.boolean() }),
  payload: (out) => ({ taskId: out.taskId, status: "completed" }),
  session: { from: true },
});

const workEntry = sequencer({ name: "work-entry", inputSchema: taskWorkerInputSchema })
  .step(work)
  .tapIf((out: { parked: boolean }) => out.parked, runMySplitBoard)
  .stepIf((out: { parked: boolean }) => !out.parked, tellSender);

/** The conversation hears; a task session with a binding settles its parent once no piece is open. */
const tellConversation = dispatcher({
  name: "tell-conversation",
  action: "settled",
  inputSchema: z.object({ conversation: z.string(), taskId: z.string(), status: z.string() }),
  payload: (i) => ({ taskId: i.taskId, status: i.status }),
  session: { id: (i: { conversation: string }) => i.conversation },
});

const settledStep = handler({
  name: "settled",
  inputSchema: z.object({ taskId: z.string(), status: z.string() }),
  outputSchema: z.object({ conversation: z.string(), taskId: z.string(), status: z.string() }).nullable(),
  execute: async (input, ctx: any) => {
    heard.push({ sessionId: sessionOf(ctx), taskId: input.taskId, status: input.status });
    const binding = bindings.get(sessionOf(ctx));
    if (binding === undefined) return null;
    // A piece's notice is its ending (in the build it is sent after the ending's write, S6), so a
    // piece counts as ended once it is settled on the board or has told this session.
    const told = new Set(heard.filter((h) => h.sessionId === sessionOf(ctx)).map((h) => h.taskId));
    const pieces = (await ledgerRef(ctx, SPLIT)).list().filter((t: Task) => t.id.startsWith(`${binding.taskId}.`));
    if (pieces.some((t) => t.status !== "completed" && t.status !== "errored" && !told.has(t.id))) return null;
    if (settles.length > 0) return null; // the build fences this with the ticket and the settle-owed marker

    // The later request: settle the parked row above through the binding, fenced by its ticket.
    const top = await ledgerRef(ctx, binding.ledger);
    const outcome = await top.complete(binding.taskId, { pieces: pieces.map((t) => t.id).sort() } as never, { claim: binding.ticket });
    settles.push({ outcome: JSON.stringify(outcome) });
    return { conversation: binding.conversation, taskId: binding.taskId, status: "completed" };
  },
});

const settledEntry = sequencer({ name: "settled-entry", inputSchema: z.object({ taskId: z.string(), status: z.string() }) })
  .step(settledStep)
  .stepIf((out: unknown) => out !== null, tellConversation);

const flow = defineFlow({
  kind: FLOW,
  // Both ledgers declared at flow level, so a task session resolves either by id.
  resources: { [TOP]: topLedger, [SPLIT]: splitLedger },
  actions: {
    fileTop: { inputSchema: fileTop.inputSchema, block: fileTop },
    drainTop: { block: topBoard.drain },
  },
  internal: { actions: { drainSplit: { block: splitBoard.drain }, settled: { block: settledEntry } } },
  task: {
    actions: {
      work: {
        block: workEntry,
        from: taskLedgers({
          name: "worker-door",
          resolve: async (ledgerId: string, ctx: BlockContext) => ledgerRef(ctx, ledgerId),
        }),
      },
    },
  },
})({ id: FLOW });

async function until(predicate: () => Promise<boolean> | boolean, label: string) {
  for (let i = 0; i < 400; i++) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("FIX-1802 POC · the split on one worker flow", () => {
  it("O1 P1 P2 P3", async () => {
    ran.length = heard.length = settles.length = 0;
    bindings.clear();
    const state = createFlowState({
      flows: { [FLOW]: flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({}),
    });
    try {
      const runtime = await state.getRuntime();
      const stores: StoreRegistry = runtime.stores;
      const act = (actionName: string, input: unknown = {}) =>
        runAction({ orgId: DEFAULT_ORG_ID, flow, actionName, input, userId: ALICE, sessionId: CONV, stores, runtimeConfig: { ...runtime.runtimeConfig } });
      const row = async (ledger: string, id: string) =>
        (await stores.resourceState.get("user", ALICE, `${ledger}/${id}`))?.state as Task | undefined;

      // O1 · it defines (above) and runs: the top task is worked on this same flow.
      expect((await act("fileTop", { id: "t1" })).error).toBeUndefined();
      const drained = await act("drainTop");
      expect(drained.error).toBeUndefined();

      // P1 · parked above, and the board above exited instead of waiting on it.
      await until(async () => (await row(TOP, "t1"))?.status === "parked", "t1 parked");
      const s1 = ran.find((r) => r.taskId === "t1")!.sessionId;
      expect(s1).not.toBe(CONV);
      const s1Record = await stores.session.get(s1);
      expect(s1Record).toMatchObject({ userId: ALICE, flowKind: FLOW, parentSessionId: CONV });
      // The drain returned once it handed the row over; nothing holds the conversation's request open.
      expect(JSON.stringify(drained.output)).not.toContain('"shouldContinue":true');

      // P2 · the pieces run in the task session's children, tell it, and the parent settles there.
      await until(async () => (await row(TOP, "t1"))?.status === "completed", "t1 settled from its pieces");
      for (const p of ["t1.p1", "t1.p2"]) {
        const piece = ran.find((r) => r.taskId === p)!;
        expect((await stores.session.get(piece.sessionId))?.parentSessionId).toBe(s1);
        expect((await row(SPLIT, p))?.status).toBe("completed");
      }
      expect(heard.filter((h) => h.sessionId === s1).map((h) => h.taskId).sort()).toEqual(["t1.p1", "t1.p2"]);
      expect((await row(TOP, "t1"))?.output).toEqual({ pieces: ["t1.p1", "t1.p2"] });
      await until(() => heard.some((h) => h.sessionId === CONV), "the conversation hears");
      expect(heard.filter((h) => h.sessionId === CONV)).toEqual([{ sessionId: CONV, taskId: "t1", status: "completed" }]);
      expect(settles).toHaveLength(1);

      // P3 · the fence: a replay after the settle writes nothing; a forged ticket on a parked row is refused.
      const binding = bindings.get(s1)!;
      const replay = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow: defineFlow({
          kind: "fence-probe",
          actions: {
            probe: {
              block: handler({
                name: "probe",
                inputSchema: z.object({}),
                outputSchema: z.object({ replay: z.string(), forged: z.string(), status: z.string(), genuine: z.string(), after: z.string() }),
                uses: [topBoard.capability],
                execute: async (_i, ctx: any) => {
                  const top = await ledgerRef(ctx, TOP);
                  const replay = await top.complete("t1", {} as never, { claim: binding.ticket });
                  await top.addTask({ id: "t2", goal: "t2" });
                  const t2 = (await top.claim("probe", { eligibility: (t: Task) => t.id === "t2" }))!;
                  const real = ticketForClaim(top.collectionId, t2);
                  await top.awaitReview("t2", "parked for the probe");
                  const forged = await top.complete("t2", {} as never, { claim: { ...real, attempt: real.attempt + 7 } });
                  const genuine = await top.complete("t2", { ok: true } as never, { claim: real });
                  return { replay: JSON.stringify(replay), forged: JSON.stringify(forged), status: "parked", genuine: JSON.stringify(genuine), after: top.get("t2")!.status };
                },
              }),
            },
          },
        })({ id: "fence-probe" }),
        actionName: "probe",
        input: {},
        userId: ALICE,
        sessionId: "probe",
        stores,
        runtimeConfig: { ...runtime.runtimeConfig },
      });
      expect(replay.error).toBeUndefined();
      const out = replay.output as { replay: string; forged: string; status: string; genuine: string; after: string };
      expect(out.replay).toContain("declined");
      expect(out.forged).toContain("declined");
      // The control: the same parked row takes the genuine ticket, so the refusal was the forgery.
      expect(out.after).toBe("completed");
      // Evidence for the README.
      console.log(JSON.stringify({ settle: settles[0], replay: out.replay, forged: out.forged, genuine: out.genuine }));
    } finally {
      await state.dispose();
    }
  });
});
