// (b2) @flow-state-dev/codex as LAB-153 §7 shapes it, over the SDK shape its POC proved
// (spec-poc/LAB-153-codex-sdk-shape/ on #1535): thread id on the first streamed event,
// `resume <id>` under the hood, usage but no cost, abort as a throw that RACES the signal.
import { z } from "zod";
import { handler, modelPricingEstimator, findModelEntry } from "@flow-state-dev/core";
import {
  harnessRunInputSchema, harnessRunHandleSchema,
  type HarnessResolver, type HarnessSessionHook,
} from "./contract";
import { world, sleep } from "./world";

export const codexHandleSchema = harnessRunHandleSchema.extend({
  source: z.literal("codex/sdk"),
  usageDetail: z.object({ cachedInputTokens: z.number() }).nullable(),
});

export interface CodexAgentOptions {
  cwd?: HarnessResolver<string>;
  resume?: HarnessResolver<string | null>;
  /** LAB-153 §5 calls this `onThread`; LAB-154 §5 passes it as `onSession`. */
  onThread?: HarnessSessionHook;
  thread?: { model?: string; sandboxMode?: string; approvalPolicy?: string };
  /** POC knob: how long "the command the model ran" keeps writing into the checkout. */
  commandMs?: number;
}

let threads = 0;
/**
 * Fake `runStreamed()`. The command the model ran is modelled as a timer chain the
 * stream does not own — the LAB-153 finding: the SDK's kill reaches `codex`, not what
 * `codex` spawned, so the writes continue after the block has thrown.
 */
async function* fakeCodexStream(o: { cwd: string; resume: string | null; commandMs: number }) {
  const thread_id = o.resume ?? `thr_${++threads}`;
  yield { type: "thread.started", thread_id } as const;
  // A resumed turn has less to do — so attempt 2 in run.ts finishes inside the deadline.
  const endsAt = Date.now() + (o.resume ? 10 : o.commandMs);
  void (async () => {
    while (Date.now() < endsAt) { world.treeWrites.push({ cwd: o.cwd, by: thread_id, at: Date.now() }); await sleep(10); }
  })();
  await sleep(o.resume ? 10 : o.commandMs);
  yield { type: "item.completed", item: { type: "agent_message", text: `${o.resume ? "continued" : "started"} ${thread_id}` } } as const;
  yield { type: "turn.completed", usage: { input_tokens: 1200, cached_input_tokens: 400, output_tokens: 300 } } as const;
}

export function codexAgent(options: CodexAgentOptions = {}) {
  const model = options.thread?.model;
  return handler({
    name: "codex-agent",
    inputSchema: harnessRunInputSchema,
    outputSchema: codexHandleSchema,
    execute: async (input, ctx) => {
      const cwd = (await options.cwd?.(input, ctx)) ?? process.cwd();
      const resumeId = (await options.resume?.(input, ctx)) || null;
      const stream = fakeCodexStream({ cwd, resume: resumeId, commandMs: options.commandMs ?? 40 });
      const aborted = new Promise<never>((_, reject) => {
        const fail = () => reject(Object.assign(new Error("codex run aborted by its signal"), { name: "AbortError" }));
        if (ctx.signal?.aborted) fail(); else ctx.signal?.addEventListener("abort", fail, { once: true });
      });
      let sessionId: string | null = null;
      let finalMessage: string | null = null;
      let usage: { inputTokens: number; outputTokens: number; cached: number } | null = null;
      for (;;) {
        // The race is the LAB-153 decision: stop waiting when OUR signal fires, not when stdout closes.
        const next = await Promise.race([stream.next(), aborted]);
        if (next.done) break;
        const ev = next.value;
        if (ev.type === "thread.started") {
          sessionId = ev.thread_id;
          await options.onThread?.(sessionId, ctx); // durable before anything that can throw
        } else if (ev.type === "item.completed") finalMessage = ev.item.text;
        else if (ev.type === "turn.completed") usage = { inputTokens: ev.usage.input_tokens, outputTokens: ev.usage.output_tokens, cached: ev.usage.cached_input_tokens };
      }
      // Cost: estimated from core's one price table, only when the block knows the model; absent, never zero.
      const cost = model && usage && findModelEntry(model)?.pricing
        ? { usd: modelPricingEstimator().estimate({ prompt: usage.inputTokens, completion: usage.outputTokens, total: usage.inputTokens + usage.outputTokens, cacheReadTokens: usage.cached, cacheCreationTokens: 0 }, model), basis: "estimated" as const }
        : null;
      return {
        source: "codex/sdk" as const, status: "completed" as const, sessionId, url: null, dispatchedAt: Date.now(),
        outcome: "finished" as const, finalMessage,
        usage: usage && { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
        cost, usageDetail: usage && { cachedInputTokens: usage.cached },
      };
    },
  });
}
