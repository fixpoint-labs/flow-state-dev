import type { FlowInstance } from "@flow-state-dev/core/types";
import { testFlow } from "../test-utilities/testFlow";
import { createLimiter } from "./concurrency";
import { buildReport } from "./report";
import type {
  EvalFlowConfig,
  EvalCaseResult,
  EvalReport,
  ScoreResult,
} from "./types";

export async function evalFlow<TInput = unknown>(
  flow: FlowInstance,
  config: EvalFlowConfig<TInput>,
): Promise<EvalReport> {
  const {
    action,
    dataset,
    scorers,
    concurrency = 1,
    userId = "eval-user",
    flowOptions,
    signal,
  } = config;
  const limiter = createLimiter(concurrency);
  const startedAt = Date.now();

  const promises = dataset.map((evalCase, index) =>
    limiter.run(async (): Promise<EvalCaseResult> => {
      if (signal?.aborted) {
        throw new Error("Eval aborted");
      }

      const caseId = evalCase.id ?? `case-${index}`;
      const caseStart = Date.now();

      try {
        const result = await testFlow({
          ...flowOptions,
          flow,
          action,
          input: evalCase.input,
          userId,
        } as any);

        const output = result.output;

        if (result.error) {
          return {
            caseId,
            input: evalCase.input,
            output,
            expected: evalCase.expected,
            error: { message: result.error.message, name: result.error.name },
            scores: {},
            passed: false,
            durationMs: Date.now() - caseStart,
          };
        }

        const scores: Record<string, ScoreResult> = {};

        for (const scorer of scorers) {
          const scoreResult = await scorer.score({
            output,
            expected: evalCase.expected as any,
            input: evalCase.input,
          });
          scores[scorer.name] = scoreResult;
        }

        const allPassed = Object.values(scores).every((s) => s.passed);

        return {
          caseId,
          input: evalCase.input,
          output,
          expected: evalCase.expected,
          scores,
          passed: allPassed,
          durationMs: Date.now() - caseStart,
        };
      } catch (err) {
        const error =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { message: String(err), name: "Error" };

        return {
          caseId,
          input: evalCase.input,
          output: undefined,
          expected: evalCase.expected,
          error,
          scores: {},
          passed: false,
          durationMs: Date.now() - caseStart,
        };
      }
    }),
  );

  const results = await Promise.all(promises);
  return buildReport(results, startedAt);
}
