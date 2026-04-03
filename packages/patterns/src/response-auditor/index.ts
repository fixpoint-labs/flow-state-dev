/**
 * Response Auditor Pattern
 *
 * A generic, composable post-generation analysis sidechain that attaches to
 * any generator via `.work()`, runs pluggable analyzers against the completed
 * response + original input, and produces structured annotations.
 *
 * Pipeline: [captureContext] → [runAnalyzers (forEach)] → [aggregateResults] → [applyThreshold]
 *
 * Because it runs via `.work()`, the primary response streams unblocked. Audit
 * results appear after the response completes as a "second pass" annotation.
 */
import { sequencer, handler } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  AnalyzerResultSchema,
  auditorInputSchema,
  responseAuditorStateSchema,
  type AnalyzerResult,
  type ResponseAuditorConfig,
} from "./schemas";

export {
  AnalyzerResultSchema,
  AuditAnnotationSchema,
  auditorInputSchema,
  responseAuditorStateSchema,
} from "./schemas";

export type {
  AnalyzerResult,
  AuditAnnotation,
  AuditorInput,
  ResponseAuditorState,
  ResponseAuditorConfig,
  DisplayMode,
} from "./schemas";

// ---------------------------------------------------------------------------
// Internal Blocks
// ---------------------------------------------------------------------------

/**
 * Extracts userInput and response from the `.work()` input.
 *
 * When the auditor is composed via `.work()`, it receives the preceding step's
 * output. For typical chat pipelines that's the generator output. The auditor
 * expects `{ userInput, response }` — the connector on `.work()` should map
 * the pipeline value to this shape, or the block upstream should produce it.
 *
 * This block stores the captured context in sequencer state for downstream
 * blocks and passes it through.
 */
export const captureContext = handler({
  name: "capture-context",
  inputSchema: auditorInputSchema,
  outputSchema: auditorInputSchema,
  sequencerStateSchema: responseAuditorStateSchema,
  execute: async (input, ctx) => {
    await ctx.sequencer!.patchState({
      userInput: input.userInput,
      response: input.response,
    });
    return input;
  },
});

/**
 * Fan-out block that runs all configured analyzers in parallel.
 *
 * This is created dynamically by the factory because it needs to reference the
 * analyzer blocks from config. Each analyzer receives `{ userInput, response }`
 * and should return an `AnalyzerResult`.
 */
function createRunAnalyzers(
  analyzers: BlockDefinition<any, any>[],
  maxConcurrency?: number,
) {
  // Wrap each analyzer in an error-safe runner so one failure doesn't abort the fan-out
  const safeAnalyzer = handler({
    name: "analyzer-runner",
    inputSchema: z.object({
      analyzerIndex: z.number(),
      userInput: z.string(),
      response: z.string(),
    }),
    outputSchema: AnalyzerResultSchema.nullable(),
    execute: async (input, ctx) => {
      const analyzer = analyzers[input.analyzerIndex];
      if (!analyzer) return null;
      try {
        const result = await analyzer.run(
          { userInput: input.userInput, response: input.response },
          ctx,
        );
        return AnalyzerResultSchema.parse(result);
      } catch {
        return null;
      }
    },
  });

  return handler({
    name: "run-analyzers",
    inputSchema: auditorInputSchema,
    outputSchema: z.array(AnalyzerResultSchema),
    sequencerStateSchema: responseAuditorStateSchema,
    execute: async (input, ctx) => {
      // Build tasks for parallel execution
      const tasks = analyzers.map((_, i) => ({
        analyzerIndex: i,
        userInput: input.userInput,
        response: input.response,
      }));

      // Run in parallel with optional concurrency limit
      const concurrency = maxConcurrency ?? tasks.length;
      const results: AnalyzerResult[] = [];

      for (let i = 0; i < tasks.length; i += concurrency) {
        const batch = tasks.slice(i, i + concurrency);
        const batchResults = await Promise.all(
          batch.map((task) => safeAnalyzer.run(task, ctx)),
        );
        for (const r of batchResults) {
          if (r != null) results.push(r);
        }
      }

      await ctx.sequencer!.patchState({ results });
      return results;
    },
  });
}

/**
 * Collects analyzer results and computes an overall score (average of all
 * analyzer scores).
 */
export const aggregateResults = handler({
  name: "aggregate-results",
  inputSchema: z.array(AnalyzerResultSchema),
  outputSchema: z.object({
    results: z.array(AnalyzerResultSchema),
    overallScore: z.number(),
  }),
  sequencerStateSchema: responseAuditorStateSchema,
  execute: async (results, ctx) => {
    const overallScore =
      results.length > 0
        ? results.reduce((sum, r) => sum + r.score, 0) / results.length
        : 0;

    await ctx.sequencer!.patchState({ overallScore });

    return { results, overallScore };
  },
});

/**
 * Filters analyzer results to only those above the configured threshold.
 * Results where `shouldSurface` is true OR score exceeds the threshold are kept.
 */
function createApplyThreshold(threshold: number) {
  return handler({
    name: "apply-threshold",
    inputSchema: z.object({
      results: z.array(AnalyzerResultSchema),
      overallScore: z.number(),
    }),
    outputSchema: z.object({
      results: z.array(AnalyzerResultSchema),
      surfacedResults: z.array(AnalyzerResultSchema),
      overallScore: z.number(),
    }),
    sequencerStateSchema: responseAuditorStateSchema,
    execute: async (input, ctx) => {
      const surfacedResults = input.results.filter(
        (r) => r.shouldSurface || r.score >= threshold,
      );

      await ctx.sequencer!.patchState({ surfacedResults });

      return {
        results: input.results,
        surfacedResults,
        overallScore: input.overallScore,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Re-export standalone block references for remixability.
// `runAnalyzers` and `applyThreshold` are created dynamically by the factory,
// so we export the static blocks and the factory helpers.
// ---------------------------------------------------------------------------

export { createRunAnalyzers as runAnalyzers };
export { createApplyThreshold as applyThreshold };

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a response auditor sequencer — a `.work()`-compatible block that
 * runs pluggable analyzers against a completed AI response and produces
 * structured annotations.
 *
 * ```ts
 * mainSequencer
 *   .then(primaryGenerator)
 *   .work(
 *     (output) => ({ userInput: output.userInput, response: output.text }),
 *     responseAuditor({
 *       analyzers: [biasAnalyzer, toneAnalyzer],
 *       threshold: 0.3,
 *       displayMode: 'inline',
 *     })
 *   )
 * ```
 */
export function responseAuditor(config: ResponseAuditorConfig) {
  const threshold = config.threshold ?? 0.3;
  const runBlock = createRunAnalyzers(config.analyzers, config.maxConcurrency);
  const thresholdBlock = createApplyThreshold(threshold);

  return sequencer({
    name: "response-auditor",
    inputSchema: auditorInputSchema,
    stateSchema: responseAuditorStateSchema,
  })
    .then(captureContext)
    .then(runBlock)
    .then(aggregateResults)
    .then(thresholdBlock);
}
