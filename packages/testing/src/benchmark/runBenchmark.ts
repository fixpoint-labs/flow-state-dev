/**
 * Cross-pattern benchmark engine.
 *
 * `runBenchmark` sweeps every (subject × task × repetition) cell, executing each
 * subject's sequencer through the test harness with a real (or injected) model
 * resolver, scoring the output with an LLM rubric judge plus any deterministic
 * code scorers, accruing a best-effort cost estimate, and folding the per-cell
 * results into a comparative `BenchmarkReport`.
 *
 * Design note — the judge: the spec framed the judge as "just another scorer",
 * but the judge must (a) use each task's locked `rubric` as its criteria and
 * (b) run against a *distinct* judge model. So the engine builds the judge
 * internally per task from `judgeModel` + the judge resolver, rather than taking
 * it in the generic `scorers` array. Generic `scorers` remain available for
 * deterministic, task-independent checks.
 *
 * Tests inject mock `modelResolver`/`judgeResolver`s, so the engine never needs
 * a real provider under test.
 */
import { createModelResolver } from "@flow-state-dev/core";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { testSequencer } from "../test-utilities/testSequencer";
import { analyzerScorer } from "../eval/analyzerScorer";
import { createLimiter } from "../eval/concurrency";
import { sumCostFromItems } from "../eval/cost";
import { buildBenchmarkReport } from "./report";
import type {
  BenchmarkRunResult,
  BenchmarkReport,
  RunBenchmarkConfig,
} from "./types";
import type { BenchmarkTask } from "@flow-state-dev/core";

/**
 * Builds a resolver that forces every model reference to `modelId`, wrapping the
 * default resolver. Mirrors the `fsdev run --model` override (run.ts) so the
 * benchmark holds the executor model fixed across all subjects.
 */
function forceModelResolver(modelId: string): ModelResolver {
  const base = createModelResolver();
  const resolver = ((_modelId: string, blockName?: string, options?: unknown) =>
    base(modelId, blockName, options as never)) as ModelResolver;
  resolver.resolveId = (_id: string, options?: { preferProvider?: string | string[] }) =>
    base.resolveId(modelId, options);
  return resolver;
}

interface Cell {
  subject: RunBenchmarkConfig["subjects"][number];
  task: BenchmarkTask;
  run: number;
}

/**
 * Runs the benchmark matrix and returns a comparative report. The independent
 * variable is the subject (coordination shape); model, tasks, and judge are held
 * fixed. Subject failures are recorded as errored cells (score 0) and never
 * abort the sweep; exceeding `maxCostUsd` stops scheduling further cells and
 * marks the report `budgetExceeded`.
 */
export async function runBenchmark(
  config: RunBenchmarkConfig,
): Promise<BenchmarkReport> {
  const {
    subjects,
    tasks,
    model,
    runs = 3,
    concurrency = 3,
    scorers = [],
    maxCostUsd,
    signal,
  } = config;

  const startedAt = Date.now();
  const warnings: string[] = [];

  const judgeModelId = config.judgeModel ?? model;
  if (config.judgeModel === undefined || config.judgeModel === model) {
    warnings.push(
      `Judge model equals executor model ("${model}"): self-preference bias is possible. ` +
        `Pass a distinct judgeModel for defensible scores.`,
    );
  }

  const executorResolver = config.modelResolver ?? forceModelResolver(model);
  const judgeResolver = config.judgeResolver ?? forceModelResolver(judgeModelId);

  // Per-task rubric judge: blinded (sees only task prompt + output), distinct
  // model, criteria locked to the task's published rubric.
  const judgeForTask = (task: BenchmarkTask) =>
    analyzerScorer({
      name: "rubric-judge",
      criteria: task.rubric,
      model: judgeModelId,
      modelResolver: judgeResolver,
    });

  const cells: Cell[] = [];
  for (const subject of subjects) {
    for (const task of tasks) {
      for (let run = 0; run < runs; run++) {
        cells.push({ subject, task, run });
      }
    }
  }

  const limiter = createLimiter(concurrency);
  const results: BenchmarkRunResult[] = [];
  let totalCostUsd = 0;
  let budgetExceeded = false;

  await Promise.all(
    cells.map((cell) =>
      limiter.run(async () => {
        if (signal?.aborted || budgetExceeded) {
          return;
        }

        const { subject, task, run } = cell;
        const cellStart = Date.now();

        let score = 0;
        let passed = false;
        let errored = false;
        let costUsd = 0;
        let output: unknown;
        const codeScores: Record<string, number> = {};

        try {
          const res = await testSequencer(subject.sequencer, {
            input: subject.mapTask(task),
            modelResolver: executorResolver,
          });

          if (res.error) {
            errored = true;
          } else {
            output = res.output;
            costUsd = sumCostFromItems(res.items);
            const judged = await judgeForTask(task).score({
              output,
              expected: task.expected as never,
              input: task.prompt,
            });
            score = judged.score;
            passed = judged.passed;
            // Include the judge's own LLM spend in the cell cost so the budget
            // guard reflects total spend, not just the executor call.
            costUsd += judged.costUsd ?? 0;

            for (const scorer of scorers) {
              const r = await scorer.score({
                output,
                expected: task.expected as never,
                input: task.prompt,
              });
              codeScores[scorer.name] = r.score;
            }
          }
        } catch {
          errored = true;
        }

        totalCostUsd += costUsd;
        if (maxCostUsd !== undefined && totalCostUsd >= maxCostUsd) {
          budgetExceeded = true;
        }

        results.push({
          subject: subject.name,
          kind: subject.kind,
          taskId: task.id,
          category: task.category,
          run,
          score,
          passed,
          errored,
          costUsd,
          latencyMs: Date.now() - cellStart,
          codeScores: scorers.length > 0 ? codeScores : undefined,
        });
      }),
    ),
  );

  return buildBenchmarkReport(results, {
    model,
    judgeModel: config.judgeModel,
    runs,
    startedAt,
    budgetExceeded,
    warnings,
  });
}
