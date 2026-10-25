/**
 * A task's run cancelled while it waits for a user files nothing more
 * (FIX-2129), on a plain orchestration board: the claim gate admits the
 * resumed run holding no claim, so it may not settle the task, but it is
 * still that task's run, and a task it files names it as its filer. The
 * board's own write then refuses the filing under the cancelled task.
 *
 * The gate runs as a real action under `runAction` with durable execution.
 * The cancel is written as `cancelUserSuspension` writes it: the row
 * cancelled, the stop recorded `cancelled` with the task's cancel on its
 * resume data, and the request continued under its own id.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler, type GeneratorTool } from "@flow-state-dev/core";
import type { ActionCore } from "@flow-state-dev/core/types";
import {
  continueRequest,
  createCheckpointDurabilityProvider,
  createFlowRegistry,
  createInMemoryStores,
  runAction,
  type RuntimeConfig,
} from "@flow-state-dev/engine";
import { createMockModelResolver, runForTest } from "@flow-state-dev/testing";
import { z } from "zod";
import { createTaskToolsCapability } from "../../src/skills";
import { createTaskGate, taskWorkerInputSchema } from "../../src/task-board";
import { createResourceBackedTaskCollection, type TaskWorkerInput } from "../../src/tasks";
import { createFakeResourceCollection } from "../helpers";

const USER_ID = "u_cancelled_resume";
const SESSION_ID = "s_cancelled_resume";
const BOARD_ID = "cancelled-resume-board";
const LEDGER = "cancelled-resume-ledger";

async function harness() {
  const store = createFakeResourceCollection();
  const ledger = () => createResourceBackedTaskCollection({ collectionId: LEDGER, collection: store, now: () => Date.now() });
  const parent = await ledger();
  await parent.addTask({ id: "t1", goal: "do it", assignee: "coder", input: {} });
  const claimed = (await parent.claim("drain", { leaseDurationMs: 60_000 }))!;

  const tools = createTaskToolsCapability(async () => ledger());
  const presets = (tools as unknown as { __presetDefs?: { tools?: { controlTools?: unknown } } }).__presetDefs;
  const list = presets?.tools?.controlTools;
  const createTask = ((typeof list === "function" ? list({}) : list) as GeneratorTool[]).find((t) => t.config?.name === "createTask")!;

  const seen: unknown[] = [];
  const worker = handler({
    name: "cancelled-resume-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.unknown(),
    execute: async (_input: TaskWorkerInput, ctx) => {
      seen.push(await ctx.waitForUser({ kind: "input", prompt: "Which region?" }));
      seen.push(await runForTest(createTask, { goal: "a piece", assignee: "coder" }, ctx as never));
      return "done";
    },
  });
  const gate = createTaskGate({ name: BOARD_ID, boardId: BOARD_ID, onError: "fail", collection: async () => ledger() });
  const flow = defineFlow({ kind: "cancelled-resume", actions: { implement: gate({ block: worker } as unknown as ActionCore, "implement") } } as never)({
    id: "cancelled-resume",
  });

  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider(stores);
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const runtimeConfig: RuntimeConfig = { durabilityProvider: provider, requestHost: {}, modelResolver: createMockModelResolver({}) };

  const park = async () => {
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "implement",
      input: {
        boardId: BOARD_ID,
        assignee: "coder",
        taskId: "t1",
        attempt: claimed.attempts,
        createdAt: claimed.createdAt,
        incarnationId: claimed.incarnationId,
        payload: { taskId: "t1", goal: "do it", attempts: claimed.attempts, input: {} },
      },
      userId: USER_ID,
      sessionId: SESSION_ID,
      stores,
      runtimeConfig,
    });
    const requestId = result.requestId!;
    expect((await stores.request.get(requestId))?.status).toBe("suspended");
    const [stop] = (await provider.listSuspended({ status: "pending" })).filter((s) => s.requestId === requestId);
    return { requestId, stop: stop! };
  };

  /** Cancel the task, then continue its parked run as the cancel's resume does. */
  const cancelWhileWaiting = async (requestId: string, stop: Awaited<ReturnType<typeof park>>["stop"]) => {
    expect((await (await ledger()).cancel("t1")).outcome).toBe("recorded");
    await provider.suspend({ ...stop, status: "cancelled", resolvedBy: "cancel", resolvedAt: Date.now(), resumeData: { taskCancelled: true } });
    const continued = await continueRequest({
      requestId,
      resumeContext: { suspensionId: stop.suspensionId, action: "reject", data: { taskCancelled: true }, resumedBy: "cancel" },
      stores,
      flowRegistry: registry,
      runtimeConfig,
    } as never);
    await (continued as { finished: Promise<unknown> }).finished;
  };

  /**
   * The state a host leaves when it dies after a stop's continuation logged
   * the stop's resolution and before the run acted on it, then the crash's
   * plain continuation, which names no resolution of its own.
   */
  const crashAfterStopLogged = async (requestId: string, stop: Awaited<ReturnType<typeof park>>["stop"]) => {
    const resolvedAt = Date.now();
    await provider.suspend({ ...stop, status: "stopped", resolvedBy: "stop", resolvedAt });
    const record = (await stores.request.get(requestId))!;
    const items = record.items ?? [];
    const next = Math.max(...items.map((item) => (item as { itemIndex?: number }).itemIndex ?? 0)) + 1;
    const audit = { id: `item_suspension_resume_crash_${next}`, type: "suspension_resume", status: "completed", suspensionId: stop.suspensionId, resolution: "stopped", resolvedBy: "stop", resolvedAt, requestId, itemIndex: next };
    await stores.request.set(requestId, { ...record, status: "interrupted", result: undefined, items: [...items, audit as never] }, "any");
    const continued = await continueRequest({ requestId, stores, flowRegistry: registry, runtimeConfig } as never);
    await (continued as { finished: Promise<unknown> }).finished.catch(() => undefined);
  };

  return { ledger, seen, stores, park, cancelWhileWaiting, crashAfterStopLogged };
}

describe("a task's run cancelled while it waits for a user (FIX-2129)", () => {
  it("files nothing more: its filing names the task, and the board refuses it parent_cancelled", async () => {
    const h = await harness();
    const { requestId, stop } = await h.park();

    await h.cancelWhileWaiting(requestId, stop);

    expect(h.seen[0]).toEqual({ cancelled: true });
    expect(h.seen[1]).toMatchObject({ ok: false, error: expect.stringMatching(/parent_cancelled/) });
    const rows = (await h.ledger()).list();
    expect(rows.map((row) => row.id)).toEqual(["t1"]);
    expect(rows[0]!.status).toBe("cancelled");
  }, 20_000);

  it("a stop whose resolution a crash left logged still cancels the task and ends the run aborted, never answered", async () => {
    const h = await harness();
    const { requestId, stop } = await h.park();

    await h.crashAfterStopLogged(requestId, stop);

    expect(h.seen).toEqual([]);
    expect((await h.stores.request.get(requestId))?.status).toBe("aborted");
    expect((await h.ledger()).get("t1")?.status).toBe("cancelled");
  }, 20_000);
});
