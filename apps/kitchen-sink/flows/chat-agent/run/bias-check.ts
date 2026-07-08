/**
 * Bias check pipeline — runs in the background after the router produces output.
 *
 * Wraps `biasAnalyzer` in `responseAuditor` for threshold filtering + UI
 * display. The auditor emits the `audit-annotation` component item itself when
 * it surfaces results, so no manual emit is needed here. Skips the LLM calls
 * entirely when the `biasCheck` feature is off.
 */
import { sequencer } from "@flow-state-dev/core";
import { biasAnalyzer } from "@thought-fabric/core/metacognition";
import { AnalyzerResultSchema, responseAuditor } from "@flow-state-dev/patterns/response-auditor";
import { z } from "zod";
import { DEFAULT_KITCHEN_SINK_MODEL } from "../../../lib/models";

// Adapter: bridges biasAnalyzer (userInput/aiResponse → BiasAnalyzerOutput)
// to the responseAuditor contract (userInput/response → AnalyzerResult).
const biasAnalyzerAdapter = sequencer({
  name: "bias-adapter",
  inputSchema: z.object({ userInput: z.string(), response: z.string() }),
  // responseAuditor collects each analyzer's output as an AnalyzerResult.
  // The terminal `.map` below hand-builds that shape; declaring it here
  // makes the sequencer's runtime exit gate reject any drift (e.g. a score
  // outside [0,1], or a renamed field) before it reaches the auditor.
  outputSchema: AnalyzerResultSchema,
})
  .map((input: { userInput: string; response: string }) => ({
    userInput: input.userInput,
    aiResponse: input.response,
  }))
  .step(biasAnalyzer({ model: DEFAULT_KITCHEN_SINK_MODEL }))
  .map((output: Record<string, unknown>) => {
    const annotations = (output.annotations as Array<Record<string, unknown>>) ?? [];
    const severity = output.severity as string;
    return {
      analyzerId: output.analyzerId as string,
      category: output.category as string,
      score: output.score as number,
      shouldSurface: (output.score as number) >= 0.3,
      annotations: annotations.map((a) => ({
        type: a.biasType as string,
        label: (a.biasType as string).replace(/_/g, " "),
        severity: severity as "info" | "warning" | "critical",
        description: a.description as string,
        evidence: a.evidence as string | undefined,
      })),
      supplementary: {
        summary: output.summary,
        label: output.label,
        sycophancyScore: output.sycophancyScore,
        counterArguments: output.counterArguments,
      },
    };
  });

const auditor = responseAuditor({
  analyzers: [biasAnalyzerAdapter],
  threshold: 0.3,
});

export const biasCheck = sequencer({
  name: "bias-check",
  inputSchema: z.string()
})
  .map((aiResponse: string, ctx) => ({
    userInput: String(
      (ctx.parent?.input as Record<string, unknown>)?.message ?? "",
    ),
    response: aiResponse,
  }))
  .stepIf(
    (_input, ctx) => !!(ctx.session.state.features as any).biasCheck,
    auditor,
  );
