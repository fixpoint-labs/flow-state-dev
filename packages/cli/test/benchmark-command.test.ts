import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { BenchmarkDefinition } from "@flow-state-dev/testing";
import {
  buildBenchmarkRun,
  loadBenchmarkDefinition,
} from "../src/commands/benchmark";
import { CliError } from "../src/resolve-block";
import { EXIT_DISCOVERY_ERROR, EXIT_INVALID_ARGS } from "../src/exit-codes";

const fixturesDir = resolve(import.meta.dirname, "benchmark-fixtures");

function def(overrides: Partial<BenchmarkDefinition> = {}): BenchmarkDefinition {
  return {
    name: "demo",
    patterns: ["supervisor", "debate"],
    tasks: [
      { id: "r1", category: "reasoning", prompt: "p1", rubric: ["c"] },
      { id: "c1", category: "critique-revision", prompt: "p2", rubric: ["c"] },
    ],
    model: "openai/gpt-5.4-mini",
    judgeModel: "anthropic/claude-haiku-4-5",
    runs: 3,
    baseline: true,
    ...overrides,
  };
}

describe("buildBenchmarkRun", () => {
  it("uses definition defaults when no options are passed", () => {
    const run = buildBenchmarkRun(def(), {});
    expect(run.config.model).toBe("openai/gpt-5.4-mini");
    expect(run.config.runs).toBe(3);
    expect(run.names).toEqual(["supervisor", "debate"]);
    expect(run.config.baseline).toBe(true);
    expect(run.format).toBe("table");
  });

  it("applies model / judge / runs overrides", () => {
    const run = buildBenchmarkRun(def(), {
      model: "openrouter/x",
      judgeModel: "openai/gpt-5.4-mini",
      runs: "5",
    });
    expect(run.config.model).toBe("openrouter/x");
    expect(run.config.judgeModel).toBe("openai/gpt-5.4-mini");
    expect(run.config.runs).toBe(5);
  });

  it("filters tasks by category", () => {
    const run = buildBenchmarkRun(def(), { category: "reasoning" });
    expect(run.config.tasks.map((t) => t.id)).toEqual(["r1"]);
  });

  it("throws when a category matches no tasks", () => {
    try {
      buildBenchmarkRun(def(), { category: "tool-use" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(EXIT_INVALID_ARGS);
    }
  });

  it("subsets patterns from --patterns", () => {
    const run = buildBenchmarkRun(def(), { patterns: "supervisor, debate ,extra" });
    expect(run.names).toEqual(["supervisor", "debate", "extra"]);
  });

  it("honors --no-baseline (baseline: false)", () => {
    const run = buildBenchmarkRun(def(), { baseline: false });
    expect(run.config.baseline).toBe(false);
  });

  it("defers to the definition's baseline when --no-baseline is absent", () => {
    // Commander sets options.baseline = true when --no-baseline is NOT passed.
    // A definition's `baseline: false` must still take effect in that case.
    const run = buildBenchmarkRun(def({ baseline: false }), { baseline: true });
    expect(run.config.baseline).toBe(false);

    const onByDef = buildBenchmarkRun(def({ baseline: true }), { baseline: true });
    expect(onByDef.config.baseline).toBe(true);
  });

  it("rejects an invalid format", () => {
    try {
      buildBenchmarkRun(def(), { format: "yaml" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(EXIT_INVALID_ARGS);
    }
  });

  it("rejects a non-positive --runs", () => {
    expect(() => buildBenchmarkRun(def(), { runs: "0" })).toThrow(CliError);
    expect(() => buildBenchmarkRun(def(), { maxCost: "-1" })).toThrow(CliError);
  });
});

describe("loadBenchmarkDefinition", () => {
  it("loads a valid default-exported definition", async () => {
    const loaded = await loadBenchmarkDefinition(
      resolve(fixturesDir, "sample-benchmark.ts"),
    );
    expect(loaded.name).toBe("fixture-benchmark");
    expect(loaded.tasks.length).toBe(1);
  });

  it("errors with a discovery code for a missing file", async () => {
    await expect(
      loadBenchmarkDefinition(resolve(fixturesDir, "does-not-exist.ts")),
    ).rejects.toMatchObject({ exitCode: EXIT_DISCOVERY_ERROR });
  });

  it("errors with an invalid-args code for a non-benchmark module", async () => {
    await expect(
      loadBenchmarkDefinition(resolve(fixturesDir, "not-a-benchmark.ts")),
    ).rejects.toMatchObject({ exitCode: EXIT_INVALID_ARGS });
  });
});
