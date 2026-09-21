import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { asRuntime } from "@flow-state-dev/core/types";
import { describe, expect, it, vi } from "vitest";
import {
  createInMemoryWorkflowStore,
  createWorkflowBuilderTools,
  createWorkflowDocument,
  runSavedWorkflow,
  type WorkflowDocument,
} from "../src";
import { createMockContext } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const demoPath = join(here, "../demo/dynamic-workflow.json");

function loadDemoDoc(): WorkflowDocument {
  const raw = JSON.parse(readFileSync(demoPath, "utf8")) as WorkflowDocument & {
    _comment?: string;
  };
  const { _comment: _ignored, ...doc } = raw as WorkflowDocument & { _comment?: string };
  void _ignored;
  return doc as WorkflowDocument;
}

describe("dynamic workflow builder + run on demand", () => {
  it("tools create + append steps → persist in store → runSavedWorkflow yields map/http/tool chain", async () => {
    const store = createInMemoryWorkflowStore();
    const tools = createWorkflowBuilderTools(store);
    const ctx = createMockContext();

    const created = await asRuntime(tools.createWorkflow).run(
      {
        id: "notify-plan",
        title: "Map summary then HTTP notify then log tool",
        defaultModel: "mock-model",
      },
      ctx,
    );
    expect(created).toEqual({
      id: "notify-plan",
      title: "Map summary then HTTP notify then log tool",
      entrySequencerId: "main",
      ok: true,
    });

    await asRuntime(tools.appendStep).run(
      {
        workflowId: "notify-plan",
        sequencerId: "main",
        stepId: "planMap",
        block: {
          type: "map",
          mappings: {
            kind: "plan",
            summary: "$.message",
            intent: "plan",
          },
        },
      },
      ctx,
    );

    await asRuntime(tools.appendStep).run(
      {
        workflowId: "notify-plan",
        sequencerId: "main",
        stepId: "notifyHttp",
        block: {
          type: "http",
          method: "POST",
          url: "https://example.invalid/hooks/dynamic",
          headers: {
            "Content-Type": "application/json",
            "X-Demo": "dynamic-workflow",
          },
          body: {
            event: "dynamic-plan",
            summary: "$.summary",
            intent: "$.intent",
          },
        },
      },
      ctx,
    );

    await asRuntime(tools.appendStep).run(
      {
        workflowId: "notify-plan",
        sequencerId: "main",
        stepId: "emitTool",
        block: {
          type: "tool",
          toolId: "logDynamic",
          args: {
            ok: "$.ok",
            status: "$.status",
            accepted: "$.body.accepted",
          },
        },
      },
      ctx,
    );

    const saved = await store.get("notify-plan");
    expect(saved?.flow.blocks.main).toEqual({
      type: "sequencer",
      steps: ["planMap", "notifyHttp", "emitTool"],
    });
    expect(saved?.flow.blocks.planMap?.type).toBe("map");
    expect(saved?.flow.blocks.notifyHttp?.type).toBe("http");
    expect(saved?.flow.blocks.emitTool?.type).toBe("tool");

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://example.invalid/hooks/dynamic");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        event: "dynamic-plan",
        summary: "ship dynamic poc",
        intent: "plan",
      });
      return new Response(JSON.stringify({ accepted: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const logDynamic = vi.fn(async (args: unknown) => ({ logged: true, args }));

    const result = await runSavedWorkflow(
      store,
      "notify-plan",
      { message: "ship dynamic poc" },
      {
        defaultModel: "mock-model",
        fetch: fetchMock as unknown as typeof fetch,
        tools: { logDynamic },
      },
      { ctx: createMockContext() },
    );

    expect(result.output).toEqual({
      logged: true,
      args: { ok: true, status: 200, accepted: true },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(logDynamic).toHaveBeenCalledOnce();
    expect(result.flow.kind).toBe("dynamic-workflow:notify-plan");
    expect(result.entryBlock.name).toBe("main");
  });

  it("loads demo/dynamic-workflow.json from store and runs the same chain", async () => {
    const doc = loadDemoDoc();
    const store = createInMemoryWorkflowStore([doc]);

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ accepted: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const logDynamic = vi.fn(async (args: unknown) => ({ logged: true, args }));

    const { output } = await runSavedWorkflow(
      store,
      "notify-plan",
      { message: "from demo json" },
      {
        fetch: fetchMock as unknown as typeof fetch,
        tools: { logDynamic },
      },
      { ctx: createMockContext() },
    );

    expect(output).toEqual({
      logged: true,
      args: { ok: true, status: 200, accepted: true },
    });
  });

  it("replaceWorkflowSteps + setWorkflowEntryAction mutate and persist", async () => {
    const store = createInMemoryWorkflowStore();
    const tools = createWorkflowBuilderTools(store);
    const ctx = createMockContext();

    await asRuntime(tools.createWorkflow).run(
      { id: "w1", title: "Replace demo" },
      ctx,
    );

    await asRuntime(tools.replaceSteps).run(
      {
        workflowId: "w1",
        sequencerId: "main",
        steps: ["onlyMap"],
        blocks: {
          onlyMap: {
            type: "map",
            mappings: { echo: "$.message" },
          },
        },
      },
      ctx,
    );

    await asRuntime(tools.setEntryAction).run(
      {
      workflowId: "w1",
      actionName: "run",
      blockId: "main",
      description: "entry",
      },
      ctx,
    );

    const { output } = await runSavedWorkflow(
      store,
      "w1",
      { message: "hi" },
      {},
      { ctx: createMockContext() },
    );
    expect(output).toEqual({ echo: "hi" });
  });

  it("refuses to run an empty sequencer", async () => {
    const store = createInMemoryWorkflowStore([
      createWorkflowDocument({ id: "empty", title: "Empty" }),
    ]);
    await expect(
      runSavedWorkflow(store, "empty", {}, {}, { ctx: createMockContext() }),
    ).rejects.toThrow(/has no steps/);
  });

  it("getWorkflow returns the saved document", async () => {
    const store = createInMemoryWorkflowStore();
    const tools = createWorkflowBuilderTools(store);
    const ctx = createMockContext();
    await asRuntime(tools.createWorkflow).run({ id: "g1", title: "G" }, ctx);
    const got = await asRuntime(tools.getWorkflow).run({ workflowId: "g1" }, ctx);
    expect(got.found).toBe(true);
    expect((got.document as WorkflowDocument).title).toBe("G");
  });
});
