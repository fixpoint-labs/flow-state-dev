/**
 * Real-path driver for the audit-annotation goal check. Run via `tsx -e` from
 * `apps/kitchen-sink` (by run.mts) so `@flow-state-dev/*`, `@thought-fabric/core`,
 * and `zod` resolve from the app's node_modules — goals/ is not a package.
 *
 * Runs the REAL `biasAnalyzer` (the same one `apps/kitchen-sink`'s bias-check
 * wires into `responseAuditor`) over a held-out, deliberately one-sided
 * response, through the real block engine, with a real model bound via the
 * Vercel AI Gateway. The response text is a fixture rather than
 * generator-produced, so the only stochastic step is the real analyzer's
 * judgment call — that judgment, and whether it causes `responseAuditor` to
 * emit an `audit-annotation` component item, is exactly what FIX-847 added.
 * Reports observations on a single `__GOAL__<json>` line; run.mts owns the
 * assertions and retries (analyzer judgment is inherently probabilistic).
 */
import { z } from "zod";
import { createGateway } from "@ai-sdk/gateway";
import { createModelResolver, sequencer } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { biasAnalyzer } from "@thought-fabric/core/metacognition";
import {
  responseAuditor,
  AnalyzerResultSchema,
  auditorInputSchema,
} from "@flow-state-dev/patterns/response-auditor";

const MODEL = process.env.GOAL_MODEL ?? "vercel/openai/gpt-5.4-mini";
const userInput = process.env.GOAL_USER_INPUT ?? "";
const aiResponse = process.env.GOAL_AI_RESPONSE ?? "";

const gatewayApiKey = process.env.AI_GATEWAY_API_KEY;
const modelResolver = createModelResolver({
  gateways: gatewayApiKey ? { vercel: createGateway({ apiKey: gatewayApiKey }) } : undefined,
});

// Same adapter shape as apps/kitchen-sink/flows/chat-agent/run/bias-check.ts:
// bridges biasAnalyzer's (userInput/aiResponse -> BiasAnalyzerOutput) contract
// to responseAuditor's (userInput/response -> AnalyzerResult) contract.
const biasAnalyzerAdapter = sequencer({
  name: "bias-adapter-goal",
  inputSchema: z.object({ userInput: z.string(), response: z.string() }),
  outputSchema: AnalyzerResultSchema,
})
  .map((input: { userInput: string; response: string }) => ({
    userInput: input.userInput,
    aiResponse: input.response,
  }))
  .step(biasAnalyzer({ model: MODEL }))
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
    };
  });

async function main(): Promise<void> {
  const audit = await testBlock(
    responseAuditor({ analyzers: [biasAnalyzerAdapter], threshold: 0.3 }),
    { input: { userInput, response: aiResponse } as z.infer<typeof auditorInputSchema>, modelResolver },
  );

  const card = audit.items.find(
    (i: { type?: string; component?: string }) =>
      i.type === "component" && (i as { component?: string }).component === "audit-annotation",
  );

  const result = {
    auditorError: audit.error === null ? null : String(audit.error),
    cardEmitted: card !== undefined,
    surfaced: card
      ? ((card as { data?: { surfacedResults?: unknown[] } }).data?.surfacedResults ?? []).length
      : 0,
    overallScore:
      (audit.output as { overallScore?: number } | undefined)?.overallScore ?? null,
    model: MODEL,
  };
  console.log("__GOAL__" + JSON.stringify(result));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
