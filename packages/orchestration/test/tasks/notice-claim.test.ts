/**
 * A task's ending reaches the session that filed it once (FIX-2123): through
 * the filer's wait, or through `onTaskSettled`, never both.
 *
 * - The turn that filed the task is still running: its notice waits for it to
 *   end, so a wait in that turn reads the ending first and drops the notice.
 *   On a flow's defaults, where the turn holds no line.
 * - A turn that never waits hears it from `onTaskSettled`, sent as the turn ends.
 * - A notice already running (taken) when another turn waits on the task: the
 *   wait answers that the ending arrives as a notice, and the notice is the one
 *   delivery.
 * - A notice already delivered when the filer waits on the task: no notice is
 *   coming, so the wait answers with the task's output (FIX-2181).
 *
 * Each runs on the in-memory stores and on SQLite.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FlowInstance, GeneratorModelCallOptions } from "@flow-state-dev/core/types";
import { inMemoryStores, type StoreAdapter } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { dispatcher, handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import type { TaskSettledInput } from "../../src";
import { defineTaskCollection, NOTICE_DUE_MS, type TaskCollectionRef, type TaskWorker } from "../../src/tasks";
import { taskBoard } from "../../src/task-board";
import {
  approve,
  awaitApproval,
  fileCall,
  finishTask,
  finalAnswer,
  rows,
  runtimeFor,
  SESSION,
  stepModel,
  toolResults,
  until,
  untilTakersEnded,
  USER,
  waitAgain,
  waitCall,
  waitFlow,
  waitedTaskId
} from "./wait-fixture";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const STORES: ReadonlyArray<readonly [string, () => Promise<StoreAdapter>]> = [
  ["in-memory", async () => inMemoryStores()],
  [
    "sqlite",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "fsd-notice-claim-"));
      dirs.push(dir);
      return sqliteStores({ filename: join(dir, "store.db") });
    }
  ]
];

/** The notice markers a row still owes (a cleared marker is `null`). */
function owedMarkers(row: { metadata?: Record<string, unknown> }): string[] {
  return Object.entries(row.metadata ?? {})
    .filter(([key, value]) => key.startsWith("noticeOwed:") && value !== null)
    .map(([key]) => key);
}

/** Start a turn through the host's dispatch, which applies the action's concurrency. */
async function startTurn(state: ReturnType<typeof runtimeFor>): Promise<string> {
  const router = await state.getRouter();
  const path = ["wait-board", SESSION, "actions", "run"];
  const sent = await router.POST(
    new Request(`http://localhost/api/flows/${path.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: USER, input: {} })
    }),
    { params: { path } }
  );
  expect(sent.status).toBe(202);
  return ((await sent.json()) as { request: { id: string } }).request.id;
}

async function eventually(check: () => boolean, withinMs: number): Promise<void> {
  const deadline = Date.now() + withinMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`not within ${withinMs}ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Until the row's notice is delivered: the notice turn ran, acknowledged it and ended. */
async function untilDelivered(state: ReturnType<typeof runtimeFor>, flow: FlowInstance): Promise<void> {
  for (const deadline = Date.now() + 5_000; owedMarkers((await rows(state, flow))[0]!).length > 0; await settle(10)) {
    if (Date.now() > deadline) throw new Error("the notice was never acknowledged");
  }
  await untilTakersEnded(state, (await rows(state, flow))[0]!);
}

describe.each(STORES)("a task's ending is heard once by its filer (%s)", { timeout: 30_000 }, (_name, stores) => {
  it("on the defaults, the filing turn's wait is the delivery: no onTaskSettled block runs beside it", async () => {
    // The turn action holds no line and the notice entry queues: the notice is
    // sent the moment the task ends, while the turn that filed it still runs.
    const notices: TaskSettledInput[] = [];
    const { model, seen } = stepModel([waitCall("c1"), finalAnswer]);
    const flow = waitFlow(model, { endsOnFiling: "already done", heard: notices });
    const state = runtimeFor(flow, await stores());
    try {
      const turn = await startTurn(state);
      await until(state, turn, "completed", 10_000);
      expect(toolResults(seen[1]!.messages)).toContain("already done");
      // Past the notice's due time: the copy sent at the ending, the one sent
      // as the turn ended and the pass's resend have all had their chance.
      await settle(2_500);
      expect(notices).toEqual([]);
      expect(owedMarkers((await rows(state, flow))[0]!)).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it("a turn that files a task and never waits on it hears its ending once, from onTaskSettled, as the turn ends", async () => {
    const notices: TaskSettledInput[] = [];
    const { model } = stepModel([fileCall("f1"), finalAnswer]);
    const flow = waitFlow(model, { endsOnFiling: "already done", heard: notices });
    const state = runtimeFor(flow, await stores());
    try {
      const turn = await startTurn(state);
      await until(state, turn, "completed", 10_000);
      // Sent as the turn ends, not a resend's backoff later.
      await eventually(() => notices.length > 0, 1_500);
      expect(notices).toEqual([expect.objectContaining({ ending: "completed", output: "already done" })]);
      await settle(2_500);
      expect(notices).toHaveLength(1);
      expect(owedMarkers((await rows(state, flow))[0]!)).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it("a filing request parked on a person holds nothing: its task's notice is heard during the park, and the resumed wait on the task answers with its output, the notice already heard", async () => {
    const notices: TaskSettledInput[] = [];
    const seen: GeneratorModelCallOptions[] = [];
    let taskId = "";
    const { model } = stepModel(
      [
        fileCall("f1"),
        (opts) => {
          taskId = waitedTaskId([opts], 0);
          return awaitApproval("p1")(opts);
        },
        waitAgain("w1", () => taskId),
        finalAnswer
      ],
      seen
    );
    const flow = waitFlow(model, { endsOnFiling: "already done", heard: notices });
    const state = runtimeFor(flow, await stores());
    try {
      const turn = await startTurn(state);
      await until(state, turn, "suspended", 10_000);
      // While the person decides, the conversation hears the task that finished.
      await eventually(() => notices.length === 1, 6_000);
      expect(notices).toEqual([expect.objectContaining({ taskId, ending: "completed", output: "already done" })]);
      await untilDelivered(state, flow);

      // No notice is coming any more (FIX-2181): the wait answers with the task.
      await approve(state, turn);
      await until(state, turn, "completed", 10_000);
      const answer = toolResults(seen[3]!.messages);
      expect(answer).toContain(taskId);
      expect(answer).toContain("already done");
      expect(answer).not.toContain("arrivesAsNotice");
      await settle(500);
      expect(notices).toHaveLength(1);
    } finally {
      await state.dispose();
    }
  });

  it("a notice held a while for its filing request is heard within seconds of that request's park, not at its resend's backoff", async () => {
    // The filer hears a task it filed as soon as its turn stops on a
    // person: the person may take hours, and the turn holds the notice no more.
    // Timed against the row's own resend record, not a fixed sleep: the turn
    // parks once two resends have been turned away for it, so its next resend
    // is a known 8 s out, and the notice must be heard before that.
    const notices: TaskSettledInput[] = [];
    const heardAt: number[] = [];
    let taskId = "";
    let parkedAt = 0;
    let backoffSendAt = 0;
    const { model } = stepModel([
      fileCall("f1"),
      async (opts) => {
        taskId = waitedTaskId([opts], 0);
        // The turn runs on while its task's notice is held for it, until the
        // pass has sent it again twice and the second copy was turned away
        // for this running request too.
        const resent = await heldAfterResends(2);
        expect(notices).toEqual([]);
        backoffSendAt = resent.at + NOTICE_DUE_MS * 2 ** resent.n;
        parkedAt = Date.now();
        return awaitApproval("p1")(opts);
      },
      finalAnswer
    ]);
    const flow = waitFlow(model, {
      endsOnFiling: "already done",
      heard: notices,
      heardGate: async () => {
        heardAt.push(Date.now());
      }
    });
    const state = runtimeFor(flow, await stores());
    /** Wait until the row's notice has been resent `n` times and that copy was turned away for its running filer. */
    const heldAfterResends = async (n: number): Promise<{ at: number; n: number }> => {
      const deadline = Date.now() + 20_000;
      for (;;) {
        if (Date.now() > deadline) throw new Error(`the notice was not resent ${n} times and held within 20 s`);
        const meta = (await rows(state, flow))[0]?.metadata ?? {};
        const record = <T>(prefix: string) => Object.entries(meta).find(([key]) => key.startsWith(prefix))?.[1] as T | null | undefined;
        const resent = record<{ at: number; n: number }>("noticeResent:");
        const deferred = record<{ at: number; whileRunning?: string }>("noticeDeferred:");
        if (resent != null && resent.n >= n && deferred?.whileRunning !== undefined && deferred.at >= resent.at) return resent;
        await settle(50);
      }
    };
    try {
      const turn = await startTurn(state);
      await until(state, turn, "suspended", 20_000);
      await eventually(() => notices.length === 1, 15_000);
      expect(notices).toEqual([expect.objectContaining({ taskId, ending: "completed", output: "already done" })]);
      // Heard after the park, and before the resend its backoff would have sent.
      expect(heardAt[0]).toBeGreaterThanOrEqual(parkedAt);
      expect(heardAt[0]).toBeLessThan(backoffSendAt);

      await approve(state, turn);
      await until(state, turn, "completed", 10_000);
      await settle(500);
      expect(notices).toHaveLength(1);
    } finally {
      await state.dispose();
    }
  });

  it("a request that runs again after its park sends the notice it held as it ends, not at the next resend", async () => {
    const notices: TaskSettledInput[] = [];
    let taskId = "";
    const { model } = stepModel([
      fileCall("f1"),
      (opts) => {
        taskId = waitedTaskId([opts], 0);
        return awaitApproval("p1")(opts);
      },
      // Back from the park, the turn runs while the task ends: its notice is held for it.
      finishTask("x1", () => taskId, "found it"),
      finalAnswer
    ]);
    const flow = waitFlow(model, { heard: notices });
    const state = runtimeFor(flow, await stores());
    try {
      const turn = await startTurn(state);
      await until(state, turn, "suspended", 10_000);
      await approve(state, turn);
      await until(state, turn, "completed", 10_000);
      await eventually(() => notices.length > 0, 1_000);
      expect(notices).toEqual([expect.objectContaining({ taskId, ending: "completed", output: "found it" })]);
      await settle(2_500);
      expect(notices).toHaveLength(1);
    } finally {
      await state.dispose();
    }
  });

  it("a wait that finds the notice already running answers that the ending arrives as a notice, and the notice is heard once", async () => {
    // As in a Workforce session: the turn holds the line and the notice defers
    // on it, so the notice runs once the filing turn ends. A second turn
    // (`hold` never waits) starts beside that running notice and waits on the task.
    const notices: TaskSettledInput[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const seen: GeneratorModelCallOptions[] = [];
    let taskId = "";
    const { model } = stepModel(
      [
        fileCall("f1"),
        (opts) => {
          taskId = waitedTaskId([opts], 0);
          return finalAnswer(opts);
        },
        waitAgain("w1", () => taskId),
        finalAnswer
      ],
      seen
    );
    const flow: FlowInstance = waitFlow(model, { endsOnFiling: "already done", heard: notices, noticeAfterTurn: true, heardGate: () => gate });
    const state = runtimeFor(flow, await stores());
    try {
      const filing = await startTurn(state);
      await until(state, filing, "completed", 10_000);
      // The notice's block is running, held open.
      await eventually(() => notices.length === 1, 5_000);

      const second = await startTurn(state);
      await until(state, second, "completed", 10_000);
      const answer = toolResults(seen[3]!.messages);
      expect(answer).toContain(taskId);
      expect(answer).toContain('"arrivesAsNotice":true');
      expect(answer).toContain("as a notice");
      expect(answer).not.toContain("already done");

      release();
      await settle(2_500);
      expect(notices).toHaveLength(1);
      expect(owedMarkers((await rows(state, flow))[0]!)).toEqual([]);
    } finally {
      release();
      await state.dispose();
    }
  });

  it("a later turn's wait on a task whose notice was already heard answers with the task's output, not that a notice is coming", async () => {
    // The notice came and went: no notice is coming any more, so a wait that
    // answered "it comes as a notice" would hand the model nothing at all.
    const notices: TaskSettledInput[] = [];
    const seen: GeneratorModelCallOptions[] = [];
    let taskId = "";
    const { model } = stepModel(
      [
        fileCall("f1"),
        (opts) => {
          taskId = waitedTaskId([opts], 0);
          return finalAnswer(opts);
        },
        waitAgain("w1", () => taskId),
        finalAnswer
      ],
      seen
    );
    const flow = waitFlow(model, { endsOnFiling: "already done", heard: notices });
    const state = runtimeFor(flow, await stores());
    try {
      const filing = await startTurn(state);
      await until(state, filing, "completed", 10_000);
      await eventually(() => notices.length === 1, 5_000);
      await untilDelivered(state, flow);

      const later = await startTurn(state);
      await until(state, later, "completed", 10_000);
      const answer = toolResults(seen[3]!.messages);
      expect(answer).toContain(taskId);
      expect(answer).toContain("already done");
      expect(answer).not.toContain("arrivesAsNotice");
      await settle(500);
      expect(notices).toHaveLength(1);
    } finally {
      await state.dispose();
    }
  });
});

describe("a row filed by a block run outside a request (FIX-2123)", () => {
  it("leaves nothing for a host's shutdown to wait on: its context records no ended requests, so no notice is held for it", async () => {
    // `testBlock` builds a request's context but never ends the request. A
    // request-end hook registered there stays owed in the process, and every
    // host's shutdown in it waits out its drain budget for it.
    const board = taskBoard({
      name: "outside-run",
      boardId: "outside-run",
      mode: "delegation",
      collection: defineTaskCollection({ id: "outside-run-ledger", scope: "user" }),
      workers: { implement: dispatcher({ name: "outside-impl", type: "task", action: "implement", session: "per-task" }) as unknown as TaskWorker }
    });
    const file = handler({
      name: "outside-file",
      inputSchema: z.unknown(),
      uses: [board.capability],
      execute: async (_input, ctx) => {
        const tasks = await (ctx.cap as Record<string, { tasks: () => Promise<TaskCollectionRef> }>)["outside-run"].tasks();
        await tasks.addTask({ goal: "work", assignee: "implement" });
        return {};
      }
    });
    expect((await testBlock(file, { input: undefined })).error).toBeNull();

    const state = runtimeFor(waitFlow(stepModel([]).model));
    await state.getRouter();
    const started = Date.now();
    await state.dispose();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
