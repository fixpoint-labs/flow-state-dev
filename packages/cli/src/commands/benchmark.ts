/**
 * `fsdev benchmark <file>` — runs a cross-pattern benchmark definition and
 * prints a comparative scorecard.
 *
 * The command is generic: it loads a default-exported `defineBenchmark(...)`
 * definition, resolves its `patterns` against the registry the definition
 * carries (so the CLI never imports a specific pattern package), runs the sweep
 * via `@flow-state-dev/testing`, and renders the report as a table, markdown, or
 * JSON. Real runs make real model calls and need provider credentials in the
 * environment; `--max-cost` stops the sweep early when the estimate is exceeded.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Command } from "commander";
import {
  baselineSubject,
  comparePatterns,
  runBenchmark,
  renderScorecard,
  type BenchmarkDefinition,
  type BenchmarkReport,
  type ComparePatternsConfig,
} from "@flow-state-dev/testing";
import { CliError } from "../resolve-block";
import {
  EXIT_SUCCESS,
  EXIT_EXECUTION_ERROR,
  EXIT_INVALID_ARGS,
  EXIT_DISCOVERY_ERROR,
  EXIT_INTERNAL_ERROR,
} from "../exit-codes";
import { loadEnvFiles } from "../load-env";

/** Raw commander options for `fsdev benchmark`. */
export interface BenchmarkCommandOptions {
  model?: string;
  judgeModel?: string;
  runs?: string;
  concurrency?: string;
  category?: string;
  patterns?: string;
  baseline?: boolean;
  baselineModel?: string[];
  maxCost?: string;
  output?: string;
  format?: string;
}

const SCORECARD_FORMATS = ["table", "markdown", "json"] as const;
type ScorecardFormat = (typeof SCORECARD_FORMATS)[number];

/** Resolved, ready-to-run benchmark derived from a definition + CLI options. */
export interface ResolvedBenchmarkRun {
  /** Pattern names to resolve against `registry` (when not using explicit subjects). */
  names?: string[];
  /** Definition-supplied registry for resolving `names`. */
  registry?: BenchmarkDefinition["registry"];
  /** Explicit subjects, when the definition provides them directly. */
  subjects?: BenchmarkDefinition["subjects"];
  /** Engine config with CLI overrides applied. */
  config: ComparePatternsConfig;
  /** Output format. */
  format: ScorecardFormat;
}

function parsePositiveInt(value: string, label: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new CliError(`--${label} must be a positive integer (got "${value}")`, EXIT_INVALID_ARGS);
  }
  return n;
}

function parsePositiveFloat(value: string, label: string): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new CliError(`--${label} must be a positive number (got "${value}")`, EXIT_INVALID_ARGS);
  }
  return n;
}

/**
 * Maps a benchmark definition + CLI options into a resolved run. Pure (no I/O):
 * applies model/judge/runs/concurrency/max-cost overrides, the `--category` task
 * filter, the `--patterns` subset, and `--no-baseline`. Throws `CliError` on
 * invalid input.
 */
export function buildBenchmarkRun(
  def: BenchmarkDefinition,
  options: BenchmarkCommandOptions,
): ResolvedBenchmarkRun {
  const format = (options.format ?? "table") as ScorecardFormat;
  if (!SCORECARD_FORMATS.includes(format)) {
    throw new CliError(
      `--format must be one of: ${SCORECARD_FORMATS.join(", ")} (got "${options.format}")`,
      EXIT_INVALID_ARGS,
    );
  }

  let tasks = def.tasks;
  if (options.category !== undefined) {
    tasks = tasks.filter((t) => t.category === options.category);
    if (tasks.length === 0) {
      throw new CliError(`No tasks in category "${options.category}".`, EXIT_INVALID_ARGS);
    }
  }

  const names =
    options.patterns !== undefined
      ? options.patterns.split(",").map((s) => s.trim()).filter(Boolean)
      : def.patterns;

  const model = options.model ?? def.model;
  // `--baseline-model` (repeatable) adds pure-model baselines beyond the run
  // model — e.g. compare cheap-model patterns against a pure stronger model. The
  // run model is always included so the same-model delta is present.
  const baselineModels =
    options.baselineModel !== undefined && options.baselineModel.length > 0
      ? Array.from(new Set([model, ...options.baselineModel]))
      : def.baselineModels;

  const config: ComparePatternsConfig = {
    tasks,
    model,
    judgeModel: options.judgeModel ?? def.judgeModel,
    runs: options.runs !== undefined ? parsePositiveInt(options.runs, "runs") : def.runs,
    concurrency:
      options.concurrency !== undefined
        ? parsePositiveInt(options.concurrency, "concurrency")
        : undefined,
    maxCostUsd:
      options.maxCost !== undefined ? parsePositiveFloat(options.maxCost, "max-cost") : undefined,
    scorers: def.scorers,
    baselineModels,
    // Commander defaults `--no-baseline` to `options.baseline === true` when the
    // flag is absent, so `??` would always override the definition. Only force
    // the baseline off when the user actually passed `--no-baseline`; otherwise
    // defer to the definition's `baseline` setting.
    baseline: options.baseline === false ? false : def.baseline,
  };

  return { names, registry: def.registry, subjects: def.subjects, config, format };
}

/** Dynamically imports a benchmark definition file (TS or JS) and validates its shape. */
export async function loadBenchmarkDefinition(file: string): Promise<BenchmarkDefinition> {
  const filePath = isAbsolute(file) ? file : resolve(process.cwd(), file);
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(filePath).href)) as Record<string, unknown>;
  } catch (err) {
    throw new CliError(
      `Cannot load benchmark file: ${filePath}\n${err instanceof Error ? err.message : String(err)}`,
      EXIT_DISCOVERY_ERROR,
    );
  }
  const def = (mod.default ?? mod.benchmark) as BenchmarkDefinition | undefined;
  // Boundary guard: the file is imported dynamically and may not have been built
  // with `defineBenchmark`, so re-validate the task suite here even though the
  // type marks it required.
  if (def === undefined || !Array.isArray(def.tasks)) {
    throw new CliError(
      `Benchmark file must default-export a defineBenchmark(...) definition: ${filePath}`,
      EXIT_INVALID_ARGS,
    );
  }
  return def;
}

/**
 * Loads the definition, runs the sweep, and writes the rendered scorecard to
 * `--output` or stdout. Returns the report so callers can branch on
 * `budgetExceeded`. Warnings are written to stderr.
 */
export async function executeBenchmarkCommand(
  file: string,
  options: BenchmarkCommandOptions,
): Promise<BenchmarkReport> {
  loadEnvFiles(process.cwd());
  const def = await loadBenchmarkDefinition(file);
  const run = buildBenchmarkRun(def, options);

  let report: BenchmarkReport;
  if (run.subjects !== undefined && run.subjects.length > 0) {
    // Honor baseline/baselineModels on the explicit-subjects path too, so a
    // definition with `subjects` and `baseline: true` still gets a control.
    const subjects = [...run.subjects];
    if (run.config.baseline !== false) {
      const baselineModels = run.config.baselineModels ?? [run.config.model];
      for (const m of baselineModels) {
        const name = m === run.config.model ? "single-generator" : `pure-${m.split("/").pop()}`;
        subjects.push(baselineSubject({ model: m, name }));
      }
    }
    report = await runBenchmark({ ...run.config, subjects });
  } else if (run.names !== undefined && run.names.length > 0) {
    if (run.registry === undefined) {
      throw new CliError(
        "Benchmark uses pattern names but provides no registry. Add `registry` to defineBenchmark or supply `subjects`.",
        EXIT_INVALID_ARGS,
      );
    }
    report = await comparePatterns(run.registry, run.names, run.config);
  } else {
    throw new CliError(
      "Benchmark defines neither `subjects` nor `patterns`.",
      EXIT_INVALID_ARGS,
    );
  }

  for (const warning of report.warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }

  const rendered = renderScorecard(report, run.format);
  if (options.output !== undefined) {
    const outPath = isAbsolute(options.output)
      ? options.output
      : resolve(process.cwd(), options.output);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, rendered + "\n", "utf-8");
    process.stderr.write(`Scorecard written to ${outPath}\n`);
  } else {
    process.stdout.write(rendered + "\n");
  }

  return report;
}

/** Registers the `benchmark` subcommand on the given commander program. */
export function registerBenchmarkCommand(program: Command): void {
  program
    .command("benchmark <file>")
    .description("Run a cross-pattern benchmark and print a comparative scorecard")
    .option("-m, --model <model>", "Override the executor model for all subjects")
    .option("--judge-model <model>", "Override the judge model")
    .option("--runs <n>", "Repetitions per (subject, task)")
    .option("--concurrency <n>", "Concurrent (subject, task, run) cells")
    .option("--category <name>", "Only run tasks in this category")
    .option("--patterns <names>", "Comma-separated subset of pattern names to run")
    .option(
      "--baseline-model <model>",
      "Add a pure-model baseline to compare against (repeatable; the run model is always included)",
      (value: string, previous: string[] | undefined) => (previous ?? []).concat(value),
      undefined,
    )
    .option("--no-baseline", "Skip the single-generator baseline subject")
    .option("--max-cost <usd>", "Abort the sweep when the estimated cost exceeds this")
    .option("--output <path>", "Write the scorecard to a file instead of stdout")
    .option("--format <format>", "Output format: table | markdown | json", "table")
    .action(async (file: string, options: BenchmarkCommandOptions) => {
      try {
        const report = await executeBenchmarkCommand(file, options);
        process.exitCode = report.budgetExceeded ? EXIT_EXECUTION_ERROR : EXIT_SUCCESS;
      } catch (err) {
        if (err instanceof CliError) {
          process.stderr.write(err.message + "\n");
          process.exitCode = err.exitCode;
          return;
        }
        process.stderr.write(
          `Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exitCode = EXIT_INTERNAL_ERROR;
      }
    });
}
