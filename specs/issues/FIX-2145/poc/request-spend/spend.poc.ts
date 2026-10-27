/**
 * POC (FIX-2145, throwaway): does a request's token count survive with trace
 * observability off, as it is by default under NODE_ENV=production?
 *
 * Runs one generator that reports 8 tokens under an action budget of 5, with
 * trace observability on and then off, and prints what the budget saw.
 * Run: see NOTES.md. Not part of any test suite.
 */
import { DEFAULT_ORG_ID, defineFlow, generator } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createInMemoryStores, runAction } from "../../../../../packages/engine/src";

async function runOnce(observability: "true" | "false") {
  process.env.FSDEV_TRACE_OBSERVABILITY = observability;
  const block = generator({ name: "spend-poc", model: "openai/gpt-6-luna", prompt: () => "p", user: () => "u" });
  const flow = defineFlow({
    kind: `spend-poc-${observability}`,
    actions: {
      run: { inputSchema: z.object({}), block, tokenBudget: { maxTotalTokens: 5, onExceeded: "error" } },
    },
  })();
  return runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: {},
    userId: "poc-user",
    sessionId: `poc-${observability}`,
    requestId: `poc-req-${observability}`,
    stores: createInMemoryStores(),
    runtimeConfig: {
      modelResolver: Object.assign(
        () => ({
          modelId: "openai/gpt-6-luna",
          async generate() {
            return { text: "ok", usage: { promptTokens: 4, completionTokens: 4, totalTokens: 8 } };
          },
        }),
        { resolveId: (id: string) => id },
      ),
    },
  });
}

describe("request token count, trace observability on vs off", () => {
  it("prints what the budget saw", async () => {
    const on = await runOnce("true");
    const off = await runOnce("false");
    console.log(`observability on  → error: ${on.error?.message ?? "none"}`);
    console.log(`observability off → error: ${off.error?.message ?? "none"}`);
    expect(on.error).toBeDefined();
  });
});
