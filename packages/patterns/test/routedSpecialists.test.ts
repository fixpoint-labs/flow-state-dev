import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  routedSpecialists,
  createWorkspace,
} from "../src/routedSpecialists";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const workspaceSchema = z.object({
  goal: z.string().default(""),
  research: z.string().optional(),
  analysis: z.string().optional(),
  critique: z.string().optional(),
  status: z.enum(["active", "done"]).default("active"),
});

const workspace = createWorkspace(workspaceSchema);

const emptyWorkspaceState = {
  goal: "",
  research: undefined,
  analysis: undefined,
  critique: undefined,
  status: "active" as const,
};

/**
 * Builds a deterministic controller — pops scripted decisions one per call.
 * Replaces the LLM controller for predictable tests.
 */
function makeScriptedController(
  name: string,
  script: Array<{ specialist: string | null; done: boolean; reasoning: string }>
) {
  let i = 0;
  return handler({
    name: `${name}-controller`,
    inputSchema: z.any(),
    outputSchema: z.object({
      specialist: z.string().nullable(),
      done: z.boolean(),
      reasoning: z.string(),
    }),
    execute: () => {
      if (i >= script.length) {
        return { specialist: null, done: true, reasoning: "exhausted script" };
      }
      const decision = script[i++];
      return decision;
    },
  });
}

/** Specialist that writes a fixed value to one workspace field. */
function makeSpecialist(name: string, field: string, value: string) {
  return handler({
    name,
    inputSchema: z.any(),
    outputSchema: z.object({ contributed: z.string() }),
    resources: { workspace },
    execute: async (_input, ctx) => {
      await ctx.resources.workspace.patchState({ [field]: value });
      return { contributed: name };
    },
  });
}

/** Specialist that throws — exercises the rescue path. */
const failingSpecialist = handler({
  name: "failing-specialist",
  inputSchema: z.any(),
  outputSchema: z.any(),
  resources: { workspace },
  execute: () => {
    throw new Error("specialist failed");
  },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("routedSpecialists", () => {
  it("converges on the first iteration when controller returns done=true", async () => {
    const pattern = routedSpecialists({
      name: "rs-immediate-done",
      workspace,
      specialists: { researcher: makeSpecialist("researcher", "research", "data") },
      controller: makeScriptedController("rs-immediate-done", [
        { specialist: null, done: true, reasoning: "nothing to do" },
      ]),
      synthesizer: false,
      initialState: { goal: "test", status: "active" },
    });

    const result = await testBlock(pattern, { input: { message: "hello" }, session: { resources: { workspace: emptyWorkspaceState } } });

    expect(result.error).toBeNull();
    const out = result.output as {
      workspace: typeof workspaceSchema._type;
      iterations: number;
      history: Array<{ specialist: string }>;
    };
    expect(out.iterations).toBe(1);
    expect(out.history).toHaveLength(0);
    expect(out.workspace.research).toBeUndefined();
  });

  it("invokes specialists and tracks history across iterations", async () => {
    const pattern = routedSpecialists({
      name: "rs-multi",
      workspace,
      specialists: {
        researcher: makeSpecialist("researcher", "research", "found-it"),
        analyst: makeSpecialist("analyst", "analysis", "analyzed"),
      },
      controller: makeScriptedController("rs-multi", [
        { specialist: "researcher", done: false, reasoning: "need data" },
        { specialist: "analyst", done: false, reasoning: "now analyze" },
        { specialist: null, done: true, reasoning: "complete" },
      ]),
      synthesizer: false,
      initialState: { goal: "multi", status: "active" },
    });

    const result = await testBlock(pattern, { input: { message: "go" }, session: { resources: { workspace: emptyWorkspaceState } } });

    expect(result.error).toBeNull();
    const out = result.output as {
      workspace: typeof workspaceSchema._type;
      iterations: number;
      history: Array<{
        iteration: number;
        specialist: string;
        reasoning: string;
        output: unknown;
      }>;
    };
    expect(out.iterations).toBe(3);
    expect(out.workspace.research).toBe("found-it");
    expect(out.workspace.analysis).toBe("analyzed");
    expect(out.history).toHaveLength(2);
    expect(out.history[0]).toMatchObject({
      specialist: "researcher",
      reasoning: "need data",
    });
    expect(out.history[1]).toMatchObject({
      specialist: "analyst",
      reasoning: "now analyze",
    });
    expect(out.history[0].output).toMatchObject({ contributed: "researcher" });
    expect(out.history[1].output).toMatchObject({ contributed: "analyst" });
  });

  it("rescues failing specialists without aborting the loop", async () => {
    const pattern = routedSpecialists({
      name: "rs-rescue",
      workspace,
      specialists: {
        broken: failingSpecialist,
        recovery: makeSpecialist("recovery", "research", "recovered"),
      },
      controller: makeScriptedController("rs-rescue", [
        { specialist: "broken", done: false, reasoning: "try this" },
        { specialist: "recovery", done: false, reasoning: "recover" },
        { specialist: null, done: true, reasoning: "ok" },
      ]),
      synthesizer: false,
      initialState: { goal: "rescue", status: "active" },
    });

    const result = await testBlock(pattern, { input: { message: "go" }, session: { resources: { workspace: emptyWorkspaceState } } });

    expect(result.error).toBeNull();
    const out = result.output as {
      workspace: typeof workspaceSchema._type;
      iterations: number;
      history: Array<{ specialist: string; output: unknown }>;
    };
    expect(out.iterations).toBe(3);
    expect(out.workspace.research).toBe("recovered");
    // The recovery iteration completes successfully and lands in history;
    // the failed broken iteration is failed (not completed) and excluded.
    expect(out.history.map((h) => h.specialist)).toEqual(["recovery"]);
  });

  it("terminates at maxIterations when the controller never says done", async () => {
    const neverDoneController = handler({
      name: "rs-cap-controller",
      inputSchema: z.any(),
      outputSchema: z.object({
        specialist: z.string().nullable(),
        done: z.boolean(),
        reasoning: z.string(),
      }),
      execute: () => ({ specialist: "researcher", done: false, reasoning: "loop forever" }),
    });

    const pattern = routedSpecialists({
      name: "rs-cap",
      workspace,
      specialists: { researcher: makeSpecialist("researcher", "research", "x") },
      controller: neverDoneController,
      maxIterations: 3,
      synthesizer: false,
      initialState: { goal: "loop", status: "active" },
    });

    const result = await testBlock(pattern, { input: { message: "go" }, session: { resources: { workspace: emptyWorkspaceState } } });

    expect(result.error).toBeNull();
    const out = result.output as { iterations: number; history: unknown[] };
    // loopBack's `maxIterations` caps loop-back fires; 1 initial + 3 fires = 4 total.
    expect(out.iterations).toBe(4);
    expect(out.history).toHaveLength(4);
  });

  it("throws when no specialists are registered", () => {
    expect(() =>
      routedSpecialists({
        name: "rs-empty",
        workspace,
        specialists: {},
      })
    ).toThrow(/at least one specialist/i);
  });

  it("throws when controller returns null specialist with done=false", async () => {
    const badController = handler({
      name: "rs-bad-controller",
      inputSchema: z.any(),
      outputSchema: z.object({
        specialist: z.string().nullable(),
        done: z.boolean(),
        reasoning: z.string(),
      }),
      execute: () => ({ specialist: null, done: false, reasoning: "oops" }),
    });

    const pattern = routedSpecialists({
      name: "rs-null-spec",
      workspace,
      specialists: { researcher: makeSpecialist("researcher", "research", "x") },
      controller: badController,
      synthesizer: false,
      initialState: { goal: "bad", status: "active" },
    });

    const result = await testBlock(pattern, { input: { message: "go" }, session: { resources: { workspace: emptyWorkspaceState } } });

    // The dispatch is rescued, so the run does NOT error at the top level —
    // the failure surfaces as an empty iteration with no contribution.
    expect(result.error).toBeNull();
  });
});
