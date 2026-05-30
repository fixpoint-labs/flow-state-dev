/**
 * Response Auditor Pattern
 *
 * A generic, composable post-generation analysis sidechain that attaches to
 * any generator via `.work()`, runs pluggable analyzers against the completed
 * response + original input, and produces structured annotations.
 *
 * Pipeline: [captureContext] → [map to tasks] → [forEach analyzer] → [aggregateResults] → [applyThreshold]
 *
 * Because it runs via `.work()`, the primary response streams unblocked. Audit
 * results appear after the response completes as a "second pass" annotation.
 */
import { sequencer, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  AnalyzerResultSchema,
  auditorInputSchema,
  responseAuditorStateSchema,
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
 * output. The auditor expects `{ userInput, response }` — the connector on
 * `.work()` should map the pipeline value to this shape.
 *
 * Stores the captured context in sequencer state for downstream blocks.
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

    await ctx.sequencer!.patchState({ results, overallScore });

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
// Rescue fallback for analyzer errors
// ---------------------------------------------------------------------------

/**
 * Fallback block used by `.rescue()` — returns null when an analyzer fails,
 * so the forEach result can be filtered downstream.
 */
const analyzerErrorFallback = handler({
  name: "analyzer-error-fallback",
  inputSchema: z.any(),
  outputSchema: z.null(),
  execute: () => null,
});

// ---------------------------------------------------------------------------
// Exported factory helpers for remixability
// ---------------------------------------------------------------------------

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
 *   .step(primaryGenerator)
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
  const analyzers = config.analyzers;
  const thresholdBlock = createApplyThreshold(threshold);

  // Each analyzer is wrapped in a mini-sequencer with .rescue() so that
  // individual failures are caught at the framework level rather than
  // via manual try/catch. Failed analyzers produce null, filtered out
  // after the forEach.
  function createSafeAnalyzer(analyzer: typeof analyzers[number]) {
    return sequencer({
      name: `safe-${analyzer.name}`,
      inputSchema: auditorInputSchema,
    })
      .step(analyzer)
      .rescue([{ block: analyzerErrorFallback }]);
  }

  // Build the pipeline using the sequencer DSL:
  // 1. captureContext stores input in state
  // 2. map creates an array of identical inputs (one per analyzer) for forEach
  // 3. forEach fans out to analyzers using a factory function that selects
  //    the correct safe-wrapped analyzer per index
  // 4. map filters out nulls from failed analyzers
  // 5. aggregateResults computes overall score
  // 6. applyThreshold filters to surfaced results
  const safeAnalyzers = analyzers.map(createSafeAnalyzer);

  return sequencer({
    name: "response-auditor",
    inputSchema: auditorInputSchema,
    stateSchema: responseAuditorStateSchema,
  })
    .step(captureContext)
    .map((input: { userInput: string; response: string }) =>
      analyzers.map(() => ({ userInput: input.userInput, response: input.response })),
    )
    .forEach(
      (_item: { userInput: string; response: string }, index: number) =>
        safeAnalyzers[index],
      { maxConcurrency: config.maxConcurrency },
    )
    .map((results: unknown[]) => results.filter(Boolean))
    .step(aggregateResults)
    .step(thresholdBlock);
}
