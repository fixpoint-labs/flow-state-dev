import { describe, expect, it } from "vitest";
import { defaultBenchmarkRegistry } from "@flow-state-dev/patterns";
import benchmark from "../src/benchmark";
import { tasks } from "../src/tasks";

// Guards the published suite: well-formed tasks + the benchmark's pattern names
// stay in sync with the registry, so a renamed/removed adapter fails here rather
// than at run time against a paid model.

describe("pattern-benchmark suite", () => {
  it("defines a non-empty, well-formed task suite", () => {
    expect(tasks.length).toBeGreaterThanOrEqual(8);
    for (const task of tasks) {
      expect(task.id).toBeTruthy();
      expect(task.prompt.length).toBeGreaterThan(0);
      expect(task.rubric.length).toBeGreaterThan(0);
      for (const criterion of task.rubric) {
        expect(criterion.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("has unique task ids", () => {
    const ids = tasks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers all four categories", () => {
    const categories = new Set(tasks.map((t) => t.category));
    expect(categories).toEqual(
      new Set(["reasoning", "multi-step-research", "critique-revision", "tool-use"]),
    );
  });

  it("references only registered patterns", () => {
    for (const name of benchmark.patterns ?? []) {
      expect(defaultBenchmarkRegistry[name]).toBeDefined();
    }
  });

  it("uses a distinct judge model and includes the baseline", () => {
    expect(benchmark.model).toBeTruthy();
    expect(benchmark.judgeModel).toBeTruthy();
    expect(benchmark.judgeModel).not.toBe(benchmark.model);
    expect(benchmark.baseline).toBe(true);
  });
});
