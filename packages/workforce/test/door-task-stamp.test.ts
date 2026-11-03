/**
 * A line sent into a worker's session from a task carries the task's id.
 *
 * An app's task screen sends `respond { message, taskId }`. The built-in doors
 * take the optional `taskId` through `doorTask`, and the engine stamps it on
 * the user's line and on the reply, so the task's view finds both in the store
 * after a reload, with no app memory of what it sent. Precedence against a
 * scope's own mark is the engine's test (`action-task-of.test.ts`); this one
 * proves only that the built-in doors are wired, and that the inventory row
 * says so, because a strict door refuses a key it doesn't declare.
 *
 * Red state produced before this was trusted: the `agent` door without
 * `taskOf` returns the line and the reply with no `taskId`.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { mintWorkers } from "../src/hire";
import { openInventory } from "../src/inventory/open-inventory";
import { workerInventoryRowSchema } from "../src/inventory/collections";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { defineCoordinatorFlow } from "../src/coordinator/coordinator-flow";
import { createErrorReporter, defineErrorReporterFlow } from "../src/error-reporter";
import { createWorkerInstallation } from "../src/workers/installation";
import { doorTask, workerDoorOf } from "../src/worker-door";
import { workerConfigSchema } from "../src/worker-config";

const USER_ID = "u_person";

async function turn(input: { message: string; taskId?: string }) {
  const [worker] = mintWorkers([{ id: "support.otto", declared: {}, body: "You answer questions." }]);
  const state = createFlowState({
    flows: { [worker!.id]: worker! },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({
      generators: {
        "agent-answer": mockGenerator({ name: "agent-answer", script: [{ when: () => true, then: { text: "the reply" } }] })
      },
      policy: "allow"
    })
  });
  try {
    const runtime = await state.getRuntime();
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow: worker!,
      actionName: "respond",
      input,
      userId: USER_ID,
      sessionId: "otto-conversation",
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    });
    expect(result.error).toBeUndefined();
    const [request] = await runtime.stores.request.list({ sessionId: "otto-conversation", withItems: true });
    return (request?.items ?? [])
      .filter((item) => item.type === "message")
      .map((item) => ({ role: (item as unknown as { role: string }).role, taskId: item.taskId }));
  } finally {
    await state.dispose();
  }
}

describe("a door turn sent from a task", () => {
  it("stores the user's line and the reply stamped with the task's id", async () => {
    expect(await turn({ message: "where is my refund?", taskId: "task_42" })).toEqual([
      { role: "user", taskId: "task_42" },
      { role: "assistant", taskId: "task_42" }
    ]);
  });

  it("stamps nothing when the line names no task", async () => {
    expect(await turn({ message: "where is my refund?" })).toEqual([
      { role: "user", taskId: undefined },
      { role: "assistant", taskId: undefined }
    ]);
  });
});

describe("every built-in door takes a task", () => {
  const installation = createWorkerInstallation();
  const reporter = createErrorReporter({
    worker: "error-reporter",
    operator: { userId: "op", orgId: "org" },
    tracker: { project: "shared/storefront" },
    secrets: () => [],
    log: () => {}
  });
  const doors = {
    agent: defineAgentWorkerFlow({})({ id: "agent" }),
    "agent on an installation": defineAgentWorkerFlow({ installation })({ id: "agent-i" }),
    coordinator: defineCoordinatorFlow({ installation, routeModel: "typesafe-ai/jev" })({ id: "coordinator" }),
    "error reporter": defineErrorReporterFlow({ reporter, installation, harness: () => handler({ name: "stand-in-harness", inputSchema: z.object({ prompt: z.string() }), execute: () => ({}) }), mcpTools: (async () => ({})) as never })({
      id: "error-reporter"
    })
  };
  for (const [name, flow] of Object.entries(doors)) {
    it(`the ${name} door`, () => {
      expect(workerDoorOf({ ...flow, kind: name }).takesTask).toBe(true);
      // A strict door still refuses any other key.
      const schema = (flow.actions.respond as { inputSchema: z.ZodTypeAny }).inputSchema;
      expect(schema.safeParse({ message: "hi", taskId: "task_1" }).success).toBe(true);
    });
  }
});

describe("doorTask", () => {
  const base = z.object({ message: z.string() }).strict();
  const task = doorTask(base);

  it("takes an optional, non-empty task id beside the door's own input, keeping it strict", () => {
    expect(task.inputSchema.safeParse({ message: "hi" }).success).toBe(true);
    expect(task.inputSchema.safeParse({ message: "hi", taskId: "t" }).success).toBe(true);
    expect(task.inputSchema.safeParse({ message: "hi", taskId: "" }).success).toBe(false);
    expect(task.inputSchema.safeParse({ message: "hi", other: 1 }).success).toBe(false);
  });

  it("names the task the input carries", () => {
    expect(task.taskOf({ message: "hi", taskId: "t" })).toBe("t");
    expect(task.taskOf({ message: "hi" })).toBeUndefined();
  });
});

describe("the inventory row says whether a worker's door takes a task", () => {
  const message = z.object({ message: z.string() });
  const echo = handler({ name: "door-echo", inputSchema: message, outputSchema: message, execute: (i) => i });
  const plainDesk = defineFlow({
    kind: "desk",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    actions: { respond: { inputSchema: message, block: echo, userMessage: (i: { message: string }) => i.message } }
  });

  it("is true for the built-in agent door and false for a door that hasn't opted in", async () => {
    const workers = mintWorkers(
      [
        { id: "eng.lead", declared: { description: "lead" }, body: "" },
        { id: "eng.desk", declared: { description: "desk", flow: "desk" }, body: "" }
      ],
      { workerFlows: { desk: plainDesk } }
    );
    const sent: { workers: { id: string; doorTakesTask: boolean }[] }[] = [];
    await openInventory(
      { workers },
      {
        run: async (request) => void sent.push(request.input as never),
        userId: "u",
        orgId: "org",
        workerWriter: { flowKind: "inventory-writer" }
      }
    );
    const byId = Object.fromEntries(sent[0]!.workers.map((w) => [w.id, w.doorTakesTask]));
    expect(byId).toEqual({ "eng.lead": true, "eng.desk": false });
    // The door itself is unchanged: both are `respond`.
    expect(workers.map((w) => workerDoorOf(w).door)).toEqual(["respond", "respond"]);
  });

  it("is false for a custom door that declares taskOf without taking the key", () => {
    // The flag is read off what the door accepts, not off `taskOf` alone: a
    // strict door that never declared `taskId` refuses a turn that sends it,
    // and a stripping one drops it before `taskOf` reads it. Either way an app
    // trusting a `true` here would send the key and get no stamp, or a refusal.
    const taskOf = (i: { taskId?: string }) => i.taskId;
    const doorWith = (inputSchema: z.ZodTypeAny) =>
      workerDoorOf({
        id: "eng.desk",
        kind: "desk",
        actions: { respond: { inputSchema, block: echo, userMessage: (i: { message: string }) => i.message, taskOf } }
      });
    expect(doorWith(message.strict())).toEqual({ door: "respond", takesTask: false });
    expect(doorWith(message)).toEqual({ door: "respond", takesTask: false });
    expect(doorWith(doorTask(message.strict()).inputSchema)).toEqual({ door: "respond", takesTask: true });
  });

  it("reads false on a row written before the field (BP-030)", () => {
    const old = workerInventoryRowSchema.parse({ id: "eng.lead", kind: "agent", door: "respond" });
    expect(old.doorTakesTask).toBe(false);
  });
});
