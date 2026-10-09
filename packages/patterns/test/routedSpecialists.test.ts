import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { getOrCreateTaskCollection } from "@flow-state-dev/orchestration";
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

  it("completes every iteration's task under the attempt guard (FIX-951)", async () => {
    // The advisory write-backs scope themselves to the attempt they claimed
    // under, and the attempt number has to come from `claim`'s return value.
    // `addTask` returns the PRE-claim task, whose `attempts` is still 0,
    // while the claim increments it to 1 — so stamping the wrong one makes
    // every completion decline against a mismatched attempt and leaves each
    // task stuck `in_progress`.
    //
    // `history` is built from *completed* tasks only, so it is the visible
    // consequence: a wrong stamp empties it while every other assertion in
    // this file still passes. Three dispatched iterations, three entries.
    const pattern = routedSpecialists({
      name: "rs-attempt",
      workspace,
      specialists: {
        researcher: makeSpecialist("researcher", "research", "found-it"),
        analyst: makeSpecialist("analyst", "analysis", "analyzed"),
        critic: makeSpecialist("critic", "critique", "critiqued"),
      },
      controller: makeScriptedController("rs-attempt", [
        { specialist: "researcher", done: false, reasoning: "gather" },
        { specialist: "analyst", done: false, reasoning: "analyze" },
        { specialist: "critic", done: false, reasoning: "critique" },
        { specialist: null, done: true, reasoning: "complete" },
      ]),
      synthesizer: false,
      initialState: { goal: "attempt-scoping", status: "active" },
    });

    const result = await testBlock(pattern, {
      input: { message: "go" },
      session: { resources: { workspace: emptyWorkspaceState } },
    });

    expect(result.error).toBeNull();
    const out = result.output as {
      history: Array<{ specialist: string; output: unknown }>;
    };
    expect(out.history.map((h) => h.specialist)).toEqual([
      "researcher",
      "analyst",
      "critic",
    ]);
    // Assert the recorded OUTPUT, not just presence — that is what
    // `complete()` writes, so it is what a declined write would drop.
    expect(out.history.map((h) => h.output)).toEqual([
      { contributed: "researcher" },
      { contributed: "analyst" },
      { contributed: "critic" },
    ]);
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

// ---------------------------------------------------------------------------
// Legacy checkpoints (BP-030)
// ---------------------------------------------------------------------------

/**
 * A checkpoint written before the claim ticket existed carries the claimed
 * attempt as a bare `currentAttempt` and no `currentClaim`. These tests put
 * the control state into exactly that shape while the specialist runs — the
 * point a resumed run would pick up from — and then let the pattern's own
 * write-back record (or decline) the iteration.
 */
describe("routedSpecialists — legacy checkpoint (currentAttempt, no currentClaim)", () => {
  type LegacyCtx = {
    sequencer: {
      state: { currentTaskId?: string; currentClaim?: { attempt: number } };
      patchState: (patch: Record<string, unknown>) => Promise<void>;
    };
  };

  /** Rewrite the live control state into the pre-ticket shape. */
  async function rewriteAsLegacyCheckpoint(ctx: LegacyCtx): Promise<string> {
    const { currentTaskId, currentClaim } = ctx.sequencer.state;
    if (currentTaskId === undefined || currentClaim === undefined) {
      throw new Error("expected a claimed iteration to rewrite");
    }
    await ctx.sequencer.patchState({
      currentClaim: undefined,
      currentAttempt: currentClaim.attempt,
    });
    return currentTaskId;
  }

  async function boardFor(ctx: unknown, collectionId: string) {
    return getOrCreateTaskCollection({
      ctx: ctx as never,
      backing: "state",
      collectionId,
      state: (ctx as { sequencer: never }).sequencer,
    });
  }

  it("does not let attempt 1's late result overwrite a second attempt that holds the task", async () => {
    // The overwrite the old `expectAttempt` guard declined: the task was
    // reclaimed and claimed again (attempt 2) while attempt 1's specialist
    // was still running. Attempt 1's write-back is an ordinary
    // `in_progress -> completed` transition, so only an ownership guard can
    // refuse it — and a legacy record must still carry one.
    let taskId = "";
    const lateSpecialist = handler({
      name: "late-specialist",
      inputSchema: z.any(),
      outputSchema: z.object({ contributed: z.string() }),
      resources: { workspace },
      execute: async (_input, ctx) => {
        taskId = await rewriteAsLegacyCheckpoint(ctx as unknown as LegacyCtx);
        const board = await boardFor(ctx, "rs-legacy-reclaimed");
        // Attempt 1's lease is treated as lapsed and a second attempt takes the task.
        await board.reclaim(Number.MAX_SAFE_INTEGER);
        const second = await board.claim("second-attempt", {
          eligibility: (t) => t.id === taskId,
        });
        expect(second?.attempts).toBe(2);
        return { contributed: "attempt-1 (stale)" };
      },
    });

    const pattern = routedSpecialists({
      name: "rs-legacy-reclaimed",
      workspace,
      specialists: { late: lateSpecialist },
      controller: makeScriptedController("rs-legacy-reclaimed", [
        { specialist: "late", done: false, reasoning: "go" },
        { specialist: null, done: true, reasoning: "complete" },
      ]),
      synthesizer: false,
      initialState: { goal: "legacy", status: "active" },
    });

    const result = await testBlock(pattern, {
      input: { message: "go" },
      session: { resources: { workspace: emptyWorkspaceState } },
    });

    expect(result.error).toBeNull();
    const out = result.output as { history: Array<{ output: unknown }> };
    // Attempt 1's stale output must not have been recorded as the result.
    expect(out.history).toEqual([]);
    expect(taskId).not.toBe("");
  });

  it("still records the iteration when the legacy attempt is the one holding the task", async () => {
    // The guard must not strand a healthy legacy iteration `in_progress`
    // (the "skip the write-back" option would): with no reclaim, attempt 1
    // still owns the task and its result lands.
    const specialist = handler({
      name: "legacy-specialist",
      inputSchema: z.any(),
      outputSchema: z.object({ contributed: z.string() }),
      resources: { workspace },
      execute: async (_input, ctx) => {
        await rewriteAsLegacyCheckpoint(ctx as unknown as LegacyCtx);
        return { contributed: "legacy" };
      },
    });

    const pattern = routedSpecialists({
      name: "rs-legacy-healthy",
      workspace,
      specialists: { legacy: specialist },
      controller: makeScriptedController("rs-legacy-healthy", [
        { specialist: "legacy", done: false, reasoning: "go" },
        { specialist: null, done: true, reasoning: "complete" },
      ]),
      synthesizer: false,
      initialState: { goal: "legacy", status: "active" },
    });

    const result = await testBlock(pattern, {
      input: { message: "go" },
      session: { resources: { workspace: emptyWorkspaceState } },
    });

    expect(result.error).toBeNull();
    const out = result.output as { history: Array<{ output: unknown }> };
    expect(out.history.map((h) => h.output)).toEqual([{ contributed: "legacy" }]);
  });
});
