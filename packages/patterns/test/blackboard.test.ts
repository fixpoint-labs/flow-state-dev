import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  blackboard,
  createBlackboard,
  createDispatchSpecialist,
  createCheckBlackboard,
  blackboardControlSchema,
  controllerOutputSchema,
} from "../src/blackboard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const boardSchema = z.object({
  analysis: z.string().optional(),
  data: z.array(z.string()).default([]),
  synthesis: z.string().optional(),
  status: z.enum(["active", "done"]).default("active"),
});

const board = createBlackboard(boardSchema);

const emptyBoardState = {
  analysis: undefined,
  data: [],
  synthesis: undefined,
  status: "active",
};

/**
 * Creates a deterministic controller handler that follows a script of decisions.
 * Each call pops the next decision from the script.
 */
function makeDeterministicController(
  name: string,
  script: Array<{ specialist: string | null; done: boolean; reasoning: string }>
) {
  let index = 0;
  return {
    block: handler({
      name,
      inputSchema: z.any(),
      outputSchema: controllerOutputSchema,
      sessionResources: { blackboard: board },
      execute: () => {
        if (index >= script.length) {
          return { specialist: null, done: true, reasoning: "Script exhausted" };
        }
        const decision = script[index];
        index += 1;
        return decision;
      },
    }),
    reset() {
      index = 0;
    },
  };
}

/**
 * A specialist that writes to the blackboard resource.
 */
function makeSpecialist(
  specialistName: string,
  contribute: (state: z.infer<typeof boardSchema>) => Partial<z.infer<typeof boardSchema>>
) {
  return handler({
    name: specialistName,
    inputSchema: z.any(),
    outputSchema: z.any(),
    sessionResources: { blackboard: board },
    execute: async (_input, ctx) => {
      const current = ctx.session.resources.blackboard.state as z.infer<typeof boardSchema>;
      const patch = contribute(current);
      await ctx.session.resources.blackboard.patchState(patch);
      return { specialist: specialistName, contributed: true };
    },
  });
}

// ---------------------------------------------------------------------------
// Specialist blocks
// ---------------------------------------------------------------------------

const analyst = makeSpecialist("analyst", () => ({
  analysis: "Thorough analysis of the problem domain.",
}));

const researcher = makeSpecialist("researcher", (state) => ({
  data: [...state.data, "Finding A", "Finding B"],
}));

const synthesizer = makeSpecialist("synthesizer-agent", (state) => ({
  synthesis: `Synthesis of ${state.data.length} findings: ${state.analysis ?? "no analysis"}`,
  status: "done" as const,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("blackboard", () => {
  describe("basic multi-specialist scenario", () => {
    it("coordinates 3 specialists through a shared blackboard", async () => {
      const ctrl = makeDeterministicController("test-bb-controller", [
        { specialist: "analyst", done: false, reasoning: "Need analysis first" },
        { specialist: "researcher", done: false, reasoning: "Need data gathering" },
        { specialist: "synthesizer-agent", done: false, reasoning: "Ready to synthesize" },
        { specialist: null, done: true, reasoning: "All contributions complete" },
      ]);

      const block = blackboard({
        name: "test-bb",
        blackboard: board,
        specialists: { analyst, researcher, "synthesizer-agent": synthesizer },
        controller: ctrl.block,
        synthesizer: false,
      });

      ctrl.reset();
      const result = await testBlock(block, {
        input: {},
        session: { resources: { blackboard: emptyBoardState } },
      });

      expect(result.error).toBeNull();
      const output = result.output as {
        blackboard: z.infer<typeof boardSchema>;
        iterations: number;
        history: Array<{ iteration: number; specialist: string; reasoning: string }>;
      };
      expect(output.iterations).toBe(4);
      expect(output.blackboard.analysis).toBe("Thorough analysis of the problem domain.");
      expect(output.blackboard.data).toEqual(["Finding A", "Finding B"]);
      expect(output.blackboard.synthesis).toContain("Synthesis of 2 findings");
      expect(output.blackboard.status).toBe("done");
      expect(output.history).toHaveLength(4);
    });
  });

  describe("termination", () => {
    it("terminates correctly when controller signals done immediately", async () => {
      const ctrl = makeDeterministicController("ctrl-done-immediate", [
        { specialist: null, done: true, reasoning: "Nothing to do" },
      ]);

      const block = blackboard({
        name: "done-immediate",
        blackboard: board,
        specialists: { analyst },
        controller: ctrl.block,
        synthesizer: false,
      });

      ctrl.reset();
      const result = await testBlock(block, {
        input: {},
        session: { resources: { blackboard: emptyBoardState } },
      });

      expect(result.error).toBeNull();
      const output = result.output as { iterations: number };
      expect(output.iterations).toBe(1);
    });

    it("exits cleanly when maxIterations is reached", async () => {
      // Controller never signals done — maxIterations will stop the loop
      const ctrl = makeDeterministicController("ctrl-max-iter", [
        { specialist: "analyst", done: false, reasoning: "iteration 1" },
        { specialist: "analyst", done: false, reasoning: "iteration 2" },
        { specialist: "analyst", done: false, reasoning: "iteration 3" },
        { specialist: "analyst", done: false, reasoning: "iteration 4" },
        { specialist: "analyst", done: false, reasoning: "iteration 5" },
        { specialist: "analyst", done: false, reasoning: "iteration 6" },
      ]);

      const block = blackboard({
        name: "max-iter",
        blackboard: board,
        specialists: { analyst },
        controller: ctrl.block,
        maxIterations: 3,
        synthesizer: false,
      });

      ctrl.reset();
      const result = await testBlock(block, {
        input: {},
        session: { resources: { blackboard: emptyBoardState } },
      });

      // loopBack exits silently when maxIterations is reached (no error thrown)
      expect(result.error).toBeNull();
      // 1 initial pass + 3 loop-backs = 4 iterations
      const output = result.output as { iterations: number };
      expect(output.iterations).toBe(4);
    });
  });

  describe("blackboard resource", () => {
    it("specialist writes are visible to subsequent iterations", async () => {
      const observedStates: Array<z.infer<typeof boardSchema>> = [];
      const observingSpecialist = handler({
        name: "observer",
        inputSchema: z.any(),
        outputSchema: z.any(),
        sessionResources: { blackboard: board },
        execute: async (_input, ctx) => {
          const state = ctx.session.resources.blackboard.state as z.infer<typeof boardSchema>;
          observedStates.push({ ...state, data: [...state.data] });
          await ctx.session.resources.blackboard.patchState({
            data: [...state.data, `item-${state.data.length}`],
          });
          return { ok: true };
        },
      });

      const ctrl = makeDeterministicController("ctrl-observe", [
        { specialist: "observer", done: false, reasoning: "observe 1" },
        { specialist: "observer", done: false, reasoning: "observe 2" },
        { specialist: null, done: true, reasoning: "done observing" },
      ]);

      const block = blackboard({
        name: "observe-test",
        blackboard: board,
        specialists: { observer: observingSpecialist },
        controller: ctrl.block,
        synthesizer: false,
      });

      ctrl.reset();
      const result = await testBlock(block, {
        input: {},
        session: { resources: { blackboard: emptyBoardState } },
      });

      expect(result.error).toBeNull();
      // First observation sees empty data
      expect(observedStates[0].data).toEqual([]);
      // Second observation sees what the first wrote
      expect(observedStates[1].data).toEqual(["item-0"]);
      // Final blackboard state has both writes
      const output = result.output as { blackboard: z.infer<typeof boardSchema> };
      expect(output.blackboard.data).toEqual(["item-0", "item-1"]);
    });

    it("seeds blackboard with initialState when provided", async () => {
      const ctrl = makeDeterministicController("ctrl-seed", [
        { specialist: null, done: true, reasoning: "Check initial state" },
      ]);

      const block = blackboard({
        name: "seed-test",
        blackboard: board,
        specialists: { analyst },
        controller: ctrl.block,
        synthesizer: false,
        initialState: { data: ["pre-seeded"], status: "active" },
      });

      ctrl.reset();
      const result = await testBlock(block, {
        input: {},
        session: { resources: { blackboard: emptyBoardState } },
      });

      expect(result.error).toBeNull();
      const output = result.output as { blackboard: z.infer<typeof boardSchema> };
      expect(output.blackboard.data).toEqual(["pre-seeded"]);
    });

    it("seeds blackboard with initialState function", async () => {
      const ctrl = makeDeterministicController("ctrl-fn-seed", [
        { specialist: null, done: true, reasoning: "Check function seed" },
      ]);

      const block = blackboard({
        name: "fn-seed-test",
        blackboard: board,
        specialists: { analyst },
        controller: ctrl.block,
        synthesizer: false,
        initialState: (input) => ({
          data: [(input as { topic: string }).topic],
          status: "active" as const,
        }),
      });

      ctrl.reset();
      const result = await testBlock(block, {
        input: { topic: "AI coordination" },
        session: { resources: { blackboard: emptyBoardState } },
      });

      expect(result.error).toBeNull();
      const output = result.output as { blackboard: z.infer<typeof boardSchema> };
      expect(output.blackboard.data).toEqual(["AI coordination"]);
    });
  });

  describe("synthesizer", () => {
    it("passes blackboard state and metadata to synthesizer", async () => {
      let synthesizerInput: unknown;
      const customSynthesizer = handler({
        name: "test-synth",
        inputSchema: z.any(),
        outputSchema: z.object({ summary: z.string() }),
        execute: (input) => {
          synthesizerInput = input;
          return { summary: "Synthesized result" };
        },
      });

      const ctrl = makeDeterministicController("ctrl-synth", [
        { specialist: "analyst", done: false, reasoning: "Need analysis" },
        { specialist: null, done: true, reasoning: "Ready to synthesize" },
      ]);

      const block = blackboard({
        name: "synth-test",
        blackboard: board,
        specialists: { analyst },
        controller: ctrl.block,
        synthesizer: customSynthesizer,
      });

      ctrl.reset();
      const result = await testBlock(block, {
        input: {},
        session: { resources: { blackboard: emptyBoardState } },
      });

      expect(result.error).toBeNull();
      expect(result.output).toEqual({ summary: "Synthesized result" });

      const received = synthesizerInput as {
        blackboard: unknown;
        iterations: number;
        history: unknown[];
      };
      expect(received.iterations).toBe(2);
      expect(received.blackboard).toBeDefined();
      expect(received.history).toHaveLength(2);
    });

    it("returns raw blackboard state when synthesizer is false", async () => {
      const ctrl = makeDeterministicController("ctrl-raw", [
        { specialist: "analyst", done: false, reasoning: "Go" },
        { specialist: null, done: true, reasoning: "Done" },
      ]);

      const block = blackboard({
        name: "raw-test",
        blackboard: board,
        specialists: { analyst },
        controller: ctrl.block,
        synthesizer: false,
      });

      ctrl.reset();
      const result = await testBlock(block, {
        input: {},
        session: { resources: { blackboard: emptyBoardState } },
      });

      expect(result.error).toBeNull();
      const output = result.output as {
        blackboard: z.infer<typeof boardSchema>;
        iterations: number;
        history: Array<{ iteration: number; specialist: string; reasoning: string }>;
      };
      expect(output.blackboard).toBeDefined();
      expect(output.iterations).toBe(2);
      expect(output.history).toHaveLength(2);
      expect(output.history[0].specialist).toBe("analyst");
      expect(output.history[1].specialist).toBe("(none)");
    });
  });

  describe("single specialist", () => {
    it("works with a single specialist", async () => {
      const ctrl = makeDeterministicController("ctrl-single", [
        { specialist: "analyst", done: false, reasoning: "Only one specialist" },
        { specialist: null, done: true, reasoning: "Done" },
      ]);

      const block = blackboard({
        name: "single-test",
        blackboard: board,
        specialists: { analyst },
        controller: ctrl.block,
        synthesizer: false,
      });

      ctrl.reset();
      const result = await testBlock(block, {
        input: {},
        session: { resources: { blackboard: emptyBoardState } },
      });

      expect(result.error).toBeNull();
      const output = result.output as { blackboard: z.infer<typeof boardSchema> };
      expect(output.blackboard.analysis).toBe("Thorough analysis of the problem domain.");
    });
  });

  describe("error handling", () => {
    it("throws descriptive error for unknown specialist name", async () => {
      const ctrl = makeDeterministicController("ctrl-unknown", [
        { specialist: "nonexistent", done: false, reasoning: "Bad routing" },
      ]);

      const block = blackboard({
        name: "unknown-test",
        blackboard: board,
        specialists: { analyst },
        controller: ctrl.block,
        synthesizer: false,
      });

      ctrl.reset();
      const result = await testBlock(block, {
        input: {},
        session: { resources: { blackboard: emptyBoardState } },
      });

      expect(result.error).not.toBeNull();
      expect(String(result.error)).toContain("No specialist registered for");
      expect(String(result.error)).toContain("nonexistent");
      expect(String(result.error)).toContain("analyst");
    });

    it("propagates specialist errors", async () => {
      const failingSpecialist = handler({
        name: "failing-specialist",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: () => {
          throw new Error("specialist exploded");
        },
      });

      const ctrl = makeDeterministicController("ctrl-fail", [
        { specialist: "failing-specialist", done: false, reasoning: "This will fail" },
      ]);

      const block = blackboard({
        name: "error-test",
        blackboard: board,
        specialists: { "failing-specialist": failingSpecialist },
        controller: ctrl.block,
        synthesizer: false,
      });

      ctrl.reset();
      const result = await testBlock(block, {
        input: {},
        session: { resources: { blackboard: emptyBoardState } },
      });

      expect(result.error).not.toBeNull();
      expect(String(result.error)).toContain("specialist exploded");
    });

    it("throws when specialists record is empty", () => {
      expect(() =>
        blackboard({
          name: "empty-test",
          blackboard: board,
          specialists: {},
          synthesizer: false,
        })
      ).toThrow("At least one specialist is required");
    });
  });

  describe("block structure", () => {
    it("returns a sequencer block", () => {
      const ctrl = makeDeterministicController("ctrl-struct", [
        { specialist: null, done: true, reasoning: "noop" },
      ]);

      const block = blackboard({
        name: "structure-test",
        blackboard: board,
        specialists: { analyst },
        controller: ctrl.block,
        synthesizer: false,
      });

      expect(block.kind).toBe("sequencer");
      expect(block.name).toBe("structure-test");
    });

    it("exports createBlackboard, createDispatchSpecialist, createCheckBlackboard, schemas", () => {
      expect(typeof createBlackboard).toBe("function");
      expect(typeof createDispatchSpecialist).toBe("function");
      expect(typeof createCheckBlackboard).toBe("function");
      expect(blackboardControlSchema).toBeDefined();
      expect(controllerOutputSchema).toBeDefined();
    });
  });
});
