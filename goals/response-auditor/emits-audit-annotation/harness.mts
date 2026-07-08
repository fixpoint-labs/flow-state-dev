/**
 * Deterministic real-path driver for the audit-annotation goal check. Run via
 * `tsx -e` from `apps/kitchen-sink` (by run.mts) so `@flow-state-dev/*` and `zod`
 * resolve from the app's node_modules — goals/ is not a package.
 *
 * A real generator produces a response with a real model, then `responseAuditor`
 * (with an always-surfacing analyzer) runs over it through the real block engine.
 * The always-surface analyzer fixes the one stochastic input that isn't FIX-847's
 * concern — whether the model flags bias — so the check reliably exercises
 * FIX-847's contribution: on surfaced results the pattern emits an
 * `audit-annotation` component item. Reports observations on a single
 * `__GOAL__<json>` line; run.mts owns the assertions.
 */
import { z } from "zod";
import { createGateway } from "@ai-sdk/gateway";
import { createModelResolver, generator, handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import {
  responseAuditor,
  AnalyzerResultSchema,
  auditorInputSchema,
} from "@flow-state-dev/patterns/response-auditor";

// Gateway-prefixed id so the real Vercel AI Gateway resolver serves it.
const MODEL = process.env.GOAL_MODEL ?? "vercel/openai/gpt-5.4-mini";
const topic = process.env.GOAL_TOPIC ?? "In one sentence, describe a sunrise.";

// Real resolver bound to the gateway — testBlock mocks generators by default,
// so injecting this is what makes the generator hit a real model.
const gatewayApiKey = process.env.AI_GATEWAY_API_KEY;
const modelResolver = createModelResolver({
  gateways: gatewayApiKey ? { vercel: createGateway({ apiKey: gatewayApiKey }) } : undefined,
});

const respond = generator({
  name: "respond",
  model: MODEL,
  inputSchema: z.object({ topic: z.string() }),
  prompt: "Answer in one sentence.",
  user: (i: { topic: string }) => i.topic,
  outputSchema: z.object({ text: z.string() }),
});

const alwaysSurface = handler({
  name: "always-surface",
  inputSchema: auditorInputSchema,
  outputSchema: AnalyzerResultSchema,
  execute: (input: { userInput: string; response: string }) => ({
    analyzerId: "always-surface",
    category: "test",
    score: 0.9,
    shouldSurface: true,
    annotations: [
      {
        type: "note",
        label: "Always surfaced",
        severity: "info" as const,
        description: input.response.slice(0, 60),
      },
    ],
  }),
});

async function main(): Promise<void> {
  // 1. Real model produces the response text that gets audited.
  const gen = await testBlock(respond, { input: { topic }, modelResolver });
  const response = String((gen.output as { text?: string } | undefined)?.text ?? "");

  // 2. Real auditor runs over it through the real block engine and emits.
  const audit = await testBlock(
    responseAuditor({ analyzers: [alwaysSurface], threshold: 0.3 }),
    { input: { userInput: topic, response }, modelResolver },
  );

  const card = audit.items.find(
    (i: { type?: string; component?: string; data?: unknown }) =>
      i.type === "component" &&
      (i as { component?: string }).component === "audit-annotation",
  );

  const result = {
    generatorOk: gen.error === null && response.length > 0,
    auditorError: audit.error === null ? null : String(audit.error),
    cardEmitted: card !== undefined,
    surfaced: card
      ? ((card as { data?: { surfacedResults?: unknown[] } }).data?.surfacedResults ?? []).length
      : 0,
    model: MODEL,
  };
  console.log("__GOAL__" + JSON.stringify(result));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
