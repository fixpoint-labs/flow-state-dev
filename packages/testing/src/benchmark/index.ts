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
import type { SequencerDefinition, UsesSlot } from "@flow-state-dev/core";
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
    model: opts.model,
  };
}

/** Last path segment of a model id, for compact baseline names. */
function shortModel(model: string): string {
  const parts = model.split("/");
  return parts[parts.length - 1];
}

/** Config for `comparePatterns` — `runBenchmark` config minus the resolved subjects. */
export type ComparePatternsConfig = Omit<RunBenchmarkConfig, "subjects"> & {
  /** Append the single-generator baseline. Default true. */
  baseline?: boolean;
  /**
   * Pure-model baselines to compare the patterns against. Defaults to one
   * baseline on the run's `model` (named `single-generator`). Provide several —
   * e.g. `[model, "anthropic/claude-sonnet-4-6"]` — to ask "do the patterns on
   * the cheap model beat both pure models?". Each is a single-generator subject
   * on that model, named `pure-<model>`.
   */
  baselineModels?: string[];
  /** Capabilities forwarded to each adapter's `build({ uses })`, so benchmarks
   *  that need tools (web search, code execution) can run via this convenience
   *  path rather than building subjects by hand. */
  uses?: UsesSlot;
};

/**
 * Resolves `names` against `registry` (patterns run on `config.model`), appends
 * a pure-model baseline per `baselineModels` entry (default: one on the run
 * model), and runs the benchmark. Throws a clear error naming the available
 * patterns when a name is missing.
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
    return adapter.build({ model: config.model, uses: config.uses });
  });

  if (config.baseline !== false) {
    const baselineModels = config.baselineModels ?? [config.model];
    for (const m of baselineModels) {
      // The same-model baseline keeps the canonical name so single-model runs
      // and existing scorecards read the same; extra pure models get distinct
      // `pure-<model>` names.
      const name = m === config.model ? "single-generator" : `pure-${shortModel(m)}`;
      subjects.push(baselineSubject({ model: m, name }));
    }
  }

  const { baseline: _baseline, baselineModels: _bm, uses: _uses, ...runConfig } = config;
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
