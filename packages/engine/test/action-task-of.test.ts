/**
 * `ActionCore.taskOf`: an action names the task its request is for, read from
 * the action's input. The engine stamps that id on the `userMessage` echo and
 * on every item the request emits, so a task's view finds a line sent from it,
 * and the reply, by `item.taskId` alone. A nearer scope marked with
 * `_markTaskScope` keeps its own id: a task's own work keeps its own stamp.
 * Trace items stay unstamped, as they are under `_markTaskScope`.
 */
import { DEFAULT_ORG_ID, defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { RuntimeItem } from "@flow-state-dev/core/internal";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import type { StoreRegistry } from "../src/stores/types";

const input = z.object({ message: z.string(), taskId: z.string().optional() });
type Input = z.infer<typeof input>;

const say = handler({
  name: "say",
  inputSchema: input,
  outputSchema: z.object({}),
  execute: async ({ message }, ctx) => {
    ctx.emit.message(`Heard: ${message}`);
    return {};
  }
});

function registryOf(flow: unknown) {
  const registry = createFlowRegistry();
  registry.register(flow as never);
  return registry;
}

function contentItems(items: RuntimeItem[]): RuntimeItem[] {
  return items.filter((i) => i.type === "message");
}

async function itemsOf(stores: StoreRegistry, requestId: string): Promise<RuntimeItem[]> {
  return (await stores.request.get(requestId))?.items ?? [];
}

async function run(flow: ReturnType<ReturnType<typeof defineFlow>>, actionInput: Input) {
  const stores = createInMemoryStores();
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "respond",
    input: actionInput,
    userId: "u1",
    sessionId: "s1",
    stores,
    runtimeConfig: {}
  });
  expect(result.error).toBeUndefined();
  return { stores, items: await itemsOf(stores, result.requestId!) };
}

describe("ActionCore.taskOf", () => {
  const flow = defineFlow({
    kind: "task-of",
    actions: {
      respond: {
        block: say,
        userMessage: (i: Input) => i.message,
        taskOf: (i: Input) => i.taskId
      }
    }
  })({ id: "task-of" });

  it("stamps the request's task on the user's line and on what the request emits", async () => {
    const { items } = await run(flow, { message: "hello", taskId: "task_7" });
    const messages = contentItems(items);
    expect(messages.map((m) => (m as { role?: string }).role)).toEqual(["user", "assistant"]);
    expect(messages.map((m) => m.taskId)).toEqual(["task_7", "task_7"]);
  });

  it("stamps nothing when the input names no task", async () => {
    const { items } = await run(flow, { message: "hello" });
    expect(contentItems(items)).toHaveLength(2);
    expect(items.every((i) => i.taskId === undefined)).toBe(true);
  });

  it("leaves trace items unstamped", async () => {
    const { items } = await run(flow, { message: "hello", taskId: "task_7" });
    const traces = items.filter((i) => i.type === "block_trace");
    expect(traces.length).toBeGreaterThan(0);
    expect(traces.every((i) => i.taskId === undefined)).toBe(true);
  });

  it("stamps nothing for an action that declares no taskOf, even when the input carries a taskId", async () => {
    const plain = defineFlow({
      kind: "task-of-absent",
      actions: { respond: { block: say, userMessage: (i: Input) => i.message } }
    })({ id: "task-of-absent" });
    const { items } = await run(plain, { message: "hello", taskId: "task_7" });
    expect(contentItems(items)).toHaveLength(2);
    expect(items.every((i) => i.taskId === undefined)).toBe(true);
  });

  it("stamps the request's task on the error item of a request that fails", async () => {
    // The failure explanation is built by the runtime, not a block: without
    // the stamp a task's view shows the user's line and no reason it failed.
    const failing = defineFlow({
      kind: "task-of-failing",
      actions: {
        respond: {
          block: handler({
            name: "boom",
            inputSchema: input,
            outputSchema: z.object({}),
            execute: async () => {
              throw new Error("boom");
            }
          }),
          userMessage: (i: Input) => i.message,
          taskOf: (i: Input) => i.taskId
        }
      }
    })({ id: "task-of-failing" });
    const stores = createInMemoryStores();
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow: failing,
      actionName: "respond",
      input: { message: "hello", taskId: "task_7" },
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: {}
    });
    const errors = (await itemsOf(stores, result.requestId!)).filter((i) => i.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.taskId).toBe("task_7");
  });

  it("lets an inner scope marked with another task keep its own mark", async () => {
    const mark = (id: string | null) =>
      handler({
        name: `mark-${id ?? "none"}`,
        inputSchema: input,
        outputSchema: input,
        execute: (i, ctx) => {
          ctx._markTaskScope?.(id);
          return i;
        }
      });
    const scoped = (id: string | null) =>
      defineFlow({
        kind: `task-of-scoped-${id ?? "none"}`,
        actions: {
          respond: {
            block: sequencer({ name: "turn", inputSchema: input }).step(mark(id)).step(say),
            userMessage: (i: Input) => i.message,
            taskOf: (i: Input) => i.taskId
          }
        }
      })({ id: `task-of-scoped-${id ?? "none"}` });

    // A scope a task-board worker marks wins over the request's task: the
    // user's line is the request's; the work done under the mark is the mark's.
    const marked = await run(scoped("task_other"), { message: "hi", taskId: "task_7" });
    expect(contentItems(marked.items).map((m) => m.taskId)).toEqual(["task_7", "task_other"]);

    // Clearing a scope's mark falls back to the request's task, not to none.
    const cleared = await run(scoped(null), { message: "hi", taskId: "task_7" });
    expect(contentItems(cleared.items).map((m) => m.taskId)).toEqual(["task_7", "task_7"]);
  });

  it("still stamps what a resumed request emits", async () => {
    // A resumed request re-enters with no echo (it is already in the log);
    // the work it does after the gate still belongs to the task.
    const gate = handler({
      name: "gate",
      inputSchema: input,
      outputSchema: z.unknown(),
      execute: async (_i, ctx) => ctx.suspend!({ reason: "user_approval", message: "Approve?" })
    });
    const after = handler({
      name: "after",
      inputSchema: z.any(),
      outputSchema: z.object({}),
      execute: async (_i, ctx) => {
        ctx.emit.message("resumed reply");
        return {};
      }
    });
    const resumable = defineFlow({
      kind: "task-of-resume",
      actions: {
        respond: {
          block: sequencer({ name: "turn", durable: true, inputSchema: input }).step(gate).step(after),
          userMessage: (i: Input) => i.message,
          taskOf: (i: Input) => i.taskId
        }
      }
    })({ id: "task-of-resume" });

    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({
      checkpoints: stores.checkpoints,
      suspensions: stores.suspensions,
      leases: stores.leases
    });
    const initial = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow: resumable,
      actionName: "respond",
      input: { message: "hi", taskId: "task_7" },
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;
    const [suspension] = await provider.listSuspended({ status: "pending" });
    await provider.suspend({ ...suspension!, status: "approved", resolvedAt: Date.now() });
    const { finished } = await continueRequest({
      requestId,
      stores,
      flowRegistry: registryOf(resumable),
      resumeContext: { suspensionId: suspension!.suspensionId, action: "approve", resumedBy: "reviewer" },
      runtimeConfig: { durabilityProvider: provider }
    });
    await finished;
    expect((await stores.request.get(requestId))?.status).toBe("completed");

    const all = await itemsOf(stores, requestId);
    // The approval prompt and its resolution are the runtime's own items; a
    // task's view that dropped them would lose the gate after a reload.
    const gateItems = all.filter((i) => i.type === "suspension" || i.type === "suspension_resume");
    expect(gateItems.map((i) => i.type).sort()).toEqual(["suspension", "suspension_resume"]);
    expect(gateItems.every((i) => i.taskId === "task_7")).toBe(true);

    const messages = contentItems(all);
    const reply = messages.find((m) => JSON.stringify(m).includes("resumed reply"));
    expect(reply?.taskId).toBe("task_7");
    expect(messages.filter((m) => (m as { role?: string }).role === "user").map((m) => m.taskId)).toEqual(["task_7"]);
  });
});
