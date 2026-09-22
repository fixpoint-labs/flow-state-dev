import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import {
  compileAllBlocks,
  loadFlowFromJson,
  type FlowJsonConfig,
} from "../src";
import { createMockContext } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const demoPath = join(here, "../demo/demo-intake.json");

function loadDemo(): FlowJsonConfig {
  return JSON.parse(readFileSync(demoPath, "utf8")) as FlowJsonConfig;
}

describe("loadFlowFromJson", () => {
  it("loads the demo JSON into a defineFlow factory with the expected kind/actions", () => {
    const flow = loadFlowFromJson(loadDemo(), {
      defaultModel: "mock-model",
      tools: { logIntake: () => ({ ok: true }) },
      fetch: async () => new Response("{}", { status: 200 }),
    });

    expect(flow.kind).toBe("demo-intake");
    expect(Object.keys(flow.actions).sort()).toEqual(["run"]);
    expect(flow.actions.run.block.name).toBe("main");

    const instance = flow();
    expect(instance.kind).toBe("demo-intake");
    expect(instance.actions.run.block.name).toBe("main");
  });

  it("compiles sequencer / router / generator / map / http / tool blocks", () => {
    const blocks = compileAllBlocks(loadDemo(), {
      defaultModel: "mock-model",
      tools: { logIntake: () => ({ ok: true }) },
    });

    expect(blocks.main?.name).toBe("main");
    expect(blocks.classify?.name).toBe("classify");
    expect(blocks.branch?.name).toBe("branch");
    expect(blocks.planMap?.name).toBe("planMap");
    expect(blocks.notifyHttp?.name).toBe("notifyHttp");
    expect(blocks.emitTool?.name).toBe("emitTool");
  });

  it("runs map → http pipeline with injected fetch (dry side effect)", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://example.invalid/hooks/intake");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        event: "plan-intake",
        summary: "ship the poc",
        intent: "plan",
      });
      return new Response(JSON.stringify({ accepted: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const blocks = compileAllBlocks(loadDemo(), {
      defaultModel: "mock-model",
      fetch: fetchMock as unknown as typeof fetch,
      tools: { logIntake: () => ({ ok: true }) },
    });

    const ctx = createMockContext();
    const mapped = await runForTest(
      blocks.planMap!,
      { intent: "plan", message: "ship the poc" },
      ctx,
    );
    expect(mapped).toEqual({
      kind: "plan",
      summary: "ship the poc",
      intent: "plan",
    });

    const httpOut = await runForTest(blocks.notifyHttp!, mapped, ctx);
    expect(httpOut).toEqual({
      ok: true,
      status: 200,
      body: { accepted: true },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("runs the chat map + named tool side effect", async () => {
    const logIntake = vi.fn(async (args: unknown) => ({ logged: true, args }));
    const blocks = compileAllBlocks(loadDemo(), {
      defaultModel: "mock-model",
      tools: { logIntake },
    });

    const ctx = createMockContext();
    const mapped = await runForTest(
      blocks.chatMap!,
      { intent: "chat", message: "hello" },
      ctx,
    );
    expect(mapped).toEqual({
      kind: "chat",
      reply: "Hello — hello",
      intent: "chat",
    });

    const toolOut = await runForTest(blocks.emitTool!, mapped, ctx);
    expect(toolOut).toEqual({
      logged: true,
      args: { kind: "chat", text: "Hello — hello" },
    });
    expect(logIntake).toHaveBeenCalledOnce();
  });

  it("routes on $.intent — plan path and default fallback", async () => {
    const blocks = compileAllBlocks(loadDemo(), {
      defaultModel: "mock-model",
      tools: {
        logIntake: (args) => ({ logged: true, args }),
      },
      fetch: async () =>
        new Response(JSON.stringify({ accepted: true }), { status: 200 }),
    });

    const viaRouterPlan = await runForTest(
      blocks.branch!,
      { intent: "plan", message: "via-router" },
      createMockContext(),
    );
    expect(viaRouterPlan).toMatchObject({ ok: true, status: 200 });

    const viaRouterDefault = await runForTest(
      blocks.branch!,
      { intent: "unknown-intent", message: "fallback" },
      createMockContext(),
    );
    expect(viaRouterDefault).toMatchObject({
      logged: true,
      args: { kind: "chat", text: "Hello — fallback" },
    });
  });

  it("rejects missing model on generators", () => {
    const config = loadDemo();
    delete config.defaultModel;
    for (const block of Object.values(config.blocks)) {
      if (block.type === "generator") {
        delete (block as { model?: string }).model;
      }
    }
    expect(() => loadFlowFromJson(config)).toThrow(/no model configured/);
  });

  it("rejects unknown block references and cycles", () => {
    expect(() =>
      loadFlowFromJson({
        kind: "bad",
        actions: { run: { block: "missing" } },
        blocks: {
          main: { type: "map", mappings: { a: "1" } },
        },
        defaultModel: "m",
      }),
    ).toThrow(/unknown block id "missing"/);

    expect(() =>
      loadFlowFromJson({
        kind: "cycle",
        actions: { run: { block: "a" } },
        blocks: {
          a: { type: "sequencer", steps: ["b"] },
          b: { type: "sequencer", steps: ["a"] },
        },
        defaultModel: "m",
      }),
    ).toThrow(/cycle detected/);
  });
});
