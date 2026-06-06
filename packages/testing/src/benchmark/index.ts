/**
 * Benchmark harness public surface.
 *
 * Re-exports the engine (`runBenchmark`), report helpers (`buildBenchmarkReport`,
 * `renderScorecard`), and pricing, plus the convenience layer:
 * - `baselineSubject` — the single-generator control every comparison needs.
 * - `comparePatterns` — resolve pattern names against a registry, append the
 *   baseline, and run. Takes the registry as an argument so `@flow-state-dev/testing`
 *   never imports `@flow-state-dev/patterns` (which only devDepends on testing).
 * - `defineBenchmark` — the declarative discovery shape consumed by the CLI.
 */
import { z } from "zod";
import { generator, sequencer } from "@flow-state-dev/core";
import type { SequencerDefinition } from "@flow-state-dev/core";
import type {
  BenchmarkRegistry,
  BenchmarkSubject,
} from "@flow-state-dev/core";
import { runBenchmark } from "./runBenchmark";
import type {
  BenchmarkDefinition,
  BenchmarkReport,
  RunBenchmarkConfig,
} from "./types";

const baselineInputSchema = z.object({ prompt: z.string() });

/**
 * Builds the single-generator baseline subject: one generator that answers the
 * task prompt directly, with no coordination. Deltas in the scorecard are
 * measured against this control — "patterns beat the naive single call" is the
 * load-bearing claim, so every comparison includes it.
 */
export function baselineSubject(opts: {
  model: string;
  name?: string;
}): BenchmarkSubject {
  const name = opts.name ?? "single-generator";
  const gen = generator({
    name: `${name}-generator`,
    model: opts.model,
    inputSchema: baselineInputSchema,
    outputSchema: z.string(),
    prompt:
      "You are a capable assistant. Answer the user's task directly, " +
      "completely, and correctly.",
    user: (input: { prompt: string }) => input.prompt,
  });

  const seq = sequencer({
    name,
    inputSchema: baselineInputSchema,
  }).step(gen) as SequencerDefinition<any, any>;

  return {
    name,
    kind: "baseline",
    sequencer: seq,
    mapTask: (task) => ({ prompt: task.prompt }),
  };
}

/** Config for `comparePatterns` — `runBenchmark` config minus the resolved subjects. */
export type ComparePatternsConfig = Omit<RunBenchmarkConfig, "subjects"> & {
  /** Append the single-generator baseline. Default true. */
  baseline?: boolean;
};

/**
 * Resolves `names` against `registry`, appends the single-generator baseline
 * (unless `baseline: false`), and runs the benchmark. Throws a clear error
 * naming the available patterns when a name is missing.
 */
export async function comparePatterns(
  registry: BenchmarkRegistry,
  names: string[],
  config: ComparePatternsConfig,
): Promise<BenchmarkReport> {
  const subjects: BenchmarkSubject[] = names.map((name) => {
    const adapter = registry[name];
    if (adapter === undefined) {
      const available = Object.keys(registry).join(", ") || "(none)";
      throw new Error(
        `Unknown benchmark pattern "${name}". Available: ${available}.`,
      );
    }
    return adapter.build({ model: config.model });
  });

  if (config.baseline !== false) {
    subjects.push(baselineSubject({ model: config.model }));
  }

  const { baseline: _baseline, ...runConfig } = config;
  return runBenchmark({ ...runConfig, subjects });
}

/**
 * Validates and returns a benchmark definition (CLI/registry discovery shape).
 * Identity at runtime; the validation catches an empty task suite early.
 */
export function defineBenchmark(def: BenchmarkDefinition): BenchmarkDefinition {
  if (def.tasks === undefined || def.tasks.length === 0) {
    throw new Error(
      `Benchmark "${def.name}" must define at least one task.`,
    );
  }
  return def;
}

export { runBenchmark } from "./runBenchmark";
export { buildBenchmarkReport, renderScorecard } from "./report";
export type { BuildBenchmarkReportMeta } from "./report";
export { estimateCostUsd } from "./pricing";
export type {
  RunBenchmarkConfig,
  SubjectCategoryStat,
  BenchmarkRanking,
  BenchmarkReport,
  BenchmarkRunResult,
  BenchmarkDefinition,
} from "./types";
