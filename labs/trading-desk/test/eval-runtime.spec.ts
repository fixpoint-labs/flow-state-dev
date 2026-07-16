import { defineFlow, handler } from "@flow-state-dev/core";
import {
  createFlowState,
  inMemoryStores,
  runAction,
  type FlowState,
} from "@flow-state-dev/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { withEvalRuntime } from "../eval/runtime";

function buildFlowState(): FlowState {
  const stateSchema = z.object({ value: z.string().default("") });
  const analysisFlow = defineFlow({
    kind: "analysis",
    session: { stateSchema },
    actions: {
      analyze: {
        inputSchema: z.object({ value: z.string() }),
        block: handler({
          name: "write-eval-value",
          inputSchema: z.object({ value: z.string() }),
          outputSchema: z.object({ written: z.string() }),
          sessionStateSchema: stateSchema,
          execute: async (input, ctx) => {
            await ctx.session.patchState({ value: input.value });
            return { written: input.value };
          },
        }),
      },
      runArtifacts: {
        inputSchema: z.object({}),
        block: handler({
          name: "read-eval-value",
          inputSchema: z.object({}),
          outputSchema: z.object({ value: z.string() }),
          sessionStateSchema: stateSchema,
          execute: (_input, ctx) => ({ value: ctx.session.state.value ?? "" }),
        }),
      },
      fail: {
        inputSchema: z.object({}),
        block: handler({
          name: "fail-eval-run",
          inputSchema: z.object({}),
          outputSchema: z.object({ ok: z.boolean() }),
          execute: (): { ok: boolean } => {
            throw new Error("synthetic action failure");
          },
        }),
      },
    },
  })();

  return createFlowState({
    flows: { analysis: analysisFlow },
    stores: { default: { primary: inMemoryStores() } },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("withEvalRuntime", () => {
  it("runs multiple actions against the same session and store", async () => {
    const flowState = buildFlowState();

    const output = await withEvalRuntime(
      { loadFlowState: async () => flowState },
      async (runtime) => {
        const write = await runtime.run("analyze", { value: "persisted" }, "session-1");
        expect(write.error).toBeNull();

        const read = await runtime.run("runArtifacts", {}, "session-1");
        expect(read.error).toBeNull();
        return read.output;
      },
    );

    expect(output).toEqual({ value: "persisted" });
  });

  it("surfaces an action failure without throwing out of the runtime task", async () => {
    const flowState = buildFlowState();

    await withEvalRuntime(
      { loadFlowState: async () => flowState },
      async (runtime) => {
        const failed = await runtime.run("fail", {}, "session-1");
        expect(failed.error).toContain("synthetic action failure");

        const following = await runtime.run("runArtifacts", {}, "session-1");
        expect(following.error).toBeNull();
      },
    );
  });

  it("rejects a missing session before a read action can create it", async () => {
    const flowState = buildFlowState();
    const resolved = await flowState.getRuntime();

    await withEvalRuntime(
      { loadFlowState: async () => flowState },
      async (runtime) => {
        const read = await runtime.run("runArtifacts", {}, "missing-session");
        expect(read.error).toBe('Session "missing-session" not found');
        expect(read.output).toBeUndefined();
      },
    );

    expect(await resolved.stores.session.get("missing-session")).toBeUndefined();
  });

  it("reuses the persisted owner when evaluating a UI-created session", async () => {
    const flowState = buildFlowState();
    const resolved = await flowState.getRuntime();
    const flow = resolved.registry.get("analysis");
    if (flow === undefined) throw new Error("synthetic analysis flow missing");
    const seeded = await runAction({
      flow,
      actionName: "analyze",
      input: { value: "created-by-ui" },
      userId: "devuser",
      sessionId: "ui-session",
      stores: resolved.stores,
      runtimeConfig: resolved.runtimeConfig,
    });
    expect(seeded.error).toBeUndefined();

    const output = await withEvalRuntime(
      { loadFlowState: async () => flowState },
      async (runtime) => {
        const read = await runtime.run("runArtifacts", {}, "ui-session");
        expect(read.error).toBeNull();
        return read.output;
      },
    );

    expect(output).toEqual({ value: "created-by-ui" });
  });

  it("sets the data dir before loading config and disposes after success", async () => {
    const flowState = buildFlowState();
    const dispose = vi.spyOn(flowState, "dispose");
    vi.stubEnv("TRADING_DESK_DATA_DIR", "/tmp/original-data-dir");

    await withEvalRuntime(
      {
        dataDir: "/tmp/eval-runtime-success",
        loadFlowState: async () => {
          expect(process.env.TRADING_DESK_DATA_DIR).toBe("/tmp/eval-runtime-success");
          return flowState;
        },
      },
      async () => "done",
    );

    expect(dispose).toHaveBeenCalledOnce();
    expect(process.env.TRADING_DESK_DATA_DIR).toBe("/tmp/original-data-dir");
  });

  it("disposes when the runtime task throws", async () => {
    const flowState = buildFlowState();
    const dispose = vi.spyOn(flowState, "dispose");

    await expect(
      withEvalRuntime(
        { loadFlowState: async () => flowState },
        async () => {
          throw new Error("task failure");
        },
      ),
    ).rejects.toThrow("task failure");
    expect(dispose).toHaveBeenCalledOnce();
  });
});
