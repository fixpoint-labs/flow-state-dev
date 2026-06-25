import { describe, expect, it } from "vitest";
import { generator, handler, sequencer } from "@flow-state-dev/core";
import type {
  GeneratorModel,
  ModelResolver,
  SequencerDefinition,
} from "@flow-state-dev/core/types";
import type {
  BenchmarkRegistry,
  BenchmarkSubject,
  BenchmarkTask,
} from "@flow-state-dev/core";
import { z } from "zod";
import {
  comparePatterns,
  defineBenchmark,
  runBenchmark,
} from "../src/benchmark";

// ---------------------------------------------------------------------------
// Benchmark engine tests. All execution goes through injected mock resolvers —
// no real LLM. The executor resolver answers subject generators (with token
// usage so the cost guard is exercisable); the judge resolver returns canned
// analyzer findings.
// ---------------------------------------------------------------------------

const inputSchema = z.object({ prompt: z.string() });

function executorResolver(text: string): ModelResolver {
  const r = ((modelId: string): GeneratorModel => ({
    modelId,
    async generate() {
      return {
        text,
        usage: { promptTokens: 1000, completionTokens: 1000, totalTokens: 2000 },
        finishReason: "stop",
      };
    },
    async *stream() {
      yield { type: "text_delta", textDelta: text };
      yield {
        type: "finish",
        finishReason: "stop",
        fullResult: { text, finishReason: "stop" },
      };
    },
  })) as ModelResolver;
  r.resolveId = (modelId: string) => modelId;
  return r;
}

function judgeResolver(score: number): ModelResolver {
  const structuredOutput = {
    findings: [{ criterion: "rubric", score, assessment: "ok" }],
  };
  const r = ((modelId: string): GeneratorModel => ({
    modelId,
    async generate() {
      return { structuredOutput, finishReason: "stop" };
    },
    async *stream() {
      yield {
        type: "finish",
        finishReason: "stop",
        fullResult: { structuredOutput, finishReason: "stop" },
      };
    },
  })) as ModelResolver;
  r.resolveId = (modelId: string) => modelId;
  return r;
}

function judgeResolverWithUsage(score: number): ModelResolver {
  const structuredOutput = {
    findings: [{ criterion: "rubric", score, assessment: "ok" }],
  };
  const r = ((modelId: string): GeneratorModel => ({
    modelId,
    async generate() {
      return {
        structuredOutput,
        usage: { promptTokens: 1_000_000, completionTokens: 0, totalTokens: 1_000_000 },
        finishReason: "stop",
      };
    },
    async *stream() {
      yield {
        type: "finish",
        finishReason: "stop",
        fullResult: { structuredOutput, finishReason: "stop" },
      };
    },
  })) as ModelResolver;
  r.resolveId = (modelId: string) => modelId;
  return r;
}

/** A subject whose sequencer makes no model call, so executor cost is 0. */
function noModelSubject(name: string): BenchmarkSubject {
  const seq = sequencer({
    name,
    inputSchema,
    stateSchema: z.record(z.string(), z.unknown()),
  }).step(
    handler({
      name: `${name}-echo`,
      inputSchema,
      outputSchema: z.string(),
      execute: async () => "a fixed answer",
    }),
  ) as SequencerDefinition<any, any>;
  return { name, kind: "pattern", sequencer: seq, mapTask: (task) => ({ prompt: task.prompt }) };
}

function genSubject(name: string, kind: "pattern" | "baseline"): BenchmarkSubject {
  const seq = sequencer({
    name,
    inputSchema,
    stateSchema: z.record(z.string(), z.unknown()),
  }).step(
    generator({
      name: `${name}-gen`,
      model: "openai/gpt-5.4-mini",
      inputSchema,
      outputSchema: z.string(),
      prompt: (input: { prompt: string }) => input.prompt,
    }),
  ) as SequencerDefinition<any, any>;
  return { name, kind, sequencer: seq, mapTask: (task) => ({ prompt: task.prompt }) };
}

function divergingSubject(name: string): BenchmarkSubject {
  const seq = sequencer({
    name,
    inputSchema,
    stateSchema: z.record(z.string(), z.unknown()),
  }).step(
    handler({
      name: `${name}-boom`,
      inputSchema,
      outputSchema: z.string(),
      execute: async () => {
        throw new Error("diverged");
      },
    }),
  ) as SequencerDefinition<any, any>;
  return { name, kind: "pattern", sequencer: seq, mapTask: (task) => ({ prompt: task.prompt }) };
}

const tasks: BenchmarkTask[] = [
  { id: "r1", category: "reasoning", prompt: "What is 2+2?", rubric: ["correct"] },
  { id: "c1", category: "critique-revision", prompt: "Improve this draft.", rubric: ["improved"] },
];

describe("runBenchmark", () => {
  it("sweeps subjects × tasks × runs and scores via the rubric judge", async () => {
    const report = await runBenchmark({
      subjects: [genSubject("supervisor", "pattern"), genSubject("single-generator", "baseline")],
      tasks,
      model: "openai/gpt-5.4-mini",
      judgeModel: "anthropic/claude-haiku-4-5",
      runs: 2,
      concurrency: 4,
      modelResolver: executorResolver("an answer"),
      judgeResolver: judgeResolver(0.8),
    });

    expect(report.subjects).toEqual(["supervisor", "single-generator"]);
    expect(report.categories).toContain("reasoning");
    expect(report.categories).toContain("critique-revision");

    const supOverall = report.stats.find(
      (s) => s.subject === "supervisor" && s.category === "overall",
    );
    expect(supOverall?.mean).toBeCloseTo(0.8, 5);
    expect(supOverall?.runs).toBe(4); // 2 tasks × 2 runs
    expect(supOverall?.successfulRuns).toBe(4);
    expect(report.warnings.length).toBe(0); // distinct judge model
  });

  it("warns when the judge model equals the executor model", async () => {
    const report = await runBenchmark({
      subjects: [genSubject("only", "pattern")],
      tasks: [tasks[0]],
      model: "openai/gpt-5.4-mini",
      runs: 1,
      modelResolver: executorResolver("x"),
      judgeResolver: judgeResolver(0.5),
    });
    expect(report.warnings.some((w) => w.includes("self-preference"))).toBe(true);
  });

  it("records a diverging subject as an errored cell without aborting the sweep", async () => {
    const report = await runBenchmark({
      subjects: [divergingSubject("broken"), genSubject("healthy", "baseline")],
      tasks: [tasks[0]],
      model: "openai/gpt-5.4-mini",
      judgeModel: "anthropic/claude-haiku-4-5",
      runs: 2,
      modelResolver: executorResolver("ok"),
      judgeResolver: judgeResolver(0.7),
    });

    const broken = report.stats.find(
      (s) => s.subject === "broken" && s.category === "overall",
    );
    expect(broken?.runs).toBe(2);
    expect(broken?.successfulRuns).toBe(0);
    expect(broken?.mean).toBe(0);

    const healthy = report.stats.find(
      (s) => s.subject === "healthy" && s.category === "overall",
    );
    expect(healthy?.successfulRuns).toBe(2);
    expect(healthy?.mean).toBeCloseTo(0.7, 5);
  });

  it("counts the judge's own LLM cost toward the budget", async () => {
    // The subject makes no model call (executor cost 0), so any nonzero total
    // cost must come from the judge — proving judge spend is accounted for.
    const report = await runBenchmark({
      subjects: [noModelSubject("p")],
      tasks: [tasks[0]],
      model: "openai/gpt-5.4-mini",
      judgeModel: "openai/gpt-5.4-mini",
      runs: 1,
      modelResolver: executorResolver("unused"),
      judgeResolver: judgeResolverWithUsage(0.6),
    });
    expect(report.totalCostUsd).toBeGreaterThan(0);
  });

  it("warns when maxCostUsd is set but a model is not in the pricing table", async () => {
    const report = await runBenchmark({
      subjects: [genSubject("p", "pattern")],
      tasks: [tasks[0]],
      model: "openrouter/meta-llama/llama-3.1-70b-instruct", // unpriced
      judgeModel: "anthropic/claude-haiku-4-5", // priced
      runs: 1,
      maxCostUsd: 1.0,
      modelResolver: executorResolver("a"),
      judgeResolver: judgeResolver(0.5),
    });
    expect(report.warnings.some((w) => w.includes("not in the pricing table"))).toBe(true);
  });

  it("trips the cost budget and marks the report budgetExceeded", async () => {
    // ~0.001 USD/cell at the gpt-5.4-mini rate; a 0.0015 ceiling trips after ~2 cells.
    const report = await runBenchmark({
      subjects: [genSubject("p", "pattern")],
      tasks: [tasks[0]],
      model: "openai/gpt-5.4-mini",
      judgeModel: "anthropic/claude-haiku-4-5",
      runs: 5,
      concurrency: 1,
      maxCostUsd: 0.0015,
      modelResolver: executorResolver("answer"),
      judgeResolver: judgeResolver(0.6),
    });

    expect(report.totalCostUsd).toBeGreaterThan(0);
    expect(report.budgetExceeded).toBe(true);
  });
});

describe("comparePatterns", () => {
  const registry: BenchmarkRegistry = {
    fake: {
      patternName: "fake",
      build: ({ model }) => {
        expect(model).toBe("openai/gpt-5.4-mini");
        return genSubject("fake", "pattern");
      },
    },
  };

  it("resolves registry names and appends the baseline", async () => {
    const report = await comparePatterns(registry, ["fake"], {
      tasks: [tasks[0]],
      model: "openai/gpt-5.4-mini",
      judgeModel: "anthropic/claude-haiku-4-5",
      runs: 1,
      modelResolver: executorResolver("a"),
      judgeResolver: judgeResolver(0.9),
    });

    expect(report.subjects).toContain("fake");
    expect(report.subjects).toContain("single-generator");
  });

  it("adds a pure-model baseline per baselineModels entry (cross-model)", async () => {
    const report = await comparePatterns(registry, ["fake"], {
      tasks: [tasks[0]],
      model: "openai/gpt-5.4-mini",
      judgeModel: "anthropic/claude-haiku-4-5",
      runs: 1,
      baselineModels: ["openai/gpt-5.4-mini", "anthropic/claude-sonnet-4-6"],
      modelResolver: executorResolver("a"),
      judgeResolver: judgeResolver(0.9),
    });

    // The run-model baseline keeps the canonical name and is the delta reference;
    // the stronger pure model appears as its own baseline row.
    expect(report.subjects).toContain("single-generator");
    expect(report.subjects).toContain("pure-claude-sonnet-4-6");
    expect(report.baselineSubjects).toEqual(
      expect.arrayContaining(["single-generator", "pure-claude-sonnet-4-6"]),
    );
    expect(report.primaryBaseline).toBe("single-generator");
  });

  it("omits the baseline when baseline: false", async () => {
    const report = await comparePatterns(registry, ["fake"], {
      tasks: [tasks[0]],
      model: "openai/gpt-5.4-mini",
      judgeModel: "anthropic/claude-haiku-4-5",
      runs: 1,
      baseline: false,
      modelResolver: executorResolver("a"),
      judgeResolver: judgeResolver(0.9),
    });
    expect(report.subjects).toEqual(["fake"]);
  });

  it("throws a clear error for an unknown pattern name", async () => {
    await expect(
      comparePatterns(registry, ["nope"], {
        tasks: [tasks[0]],
        model: "openai/gpt-5.4-mini",
        modelResolver: executorResolver("a"),
        judgeResolver: judgeResolver(0.9),
      }),
    ).rejects.toThrow(/Unknown benchmark pattern "nope".*fake/);
  });
});

describe("defineBenchmark", () => {
  it("returns the definition when valid", () => {
    const def = defineBenchmark({
      name: "demo",
      tasks: [tasks[0]],
      model: "openai/gpt-5.4-mini",
    });
    expect(def.name).toBe("demo");
  });

  it("throws when the task suite is empty", () => {
    expect(() =>
      defineBenchmark({ name: "empty", tasks: [], model: "openai/gpt-5.4-mini" }),
    ).toThrow(/at least one task/);
  });
});
