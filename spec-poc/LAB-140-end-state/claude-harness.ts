// (b1) @flow-state-dev/claude-code after LAB-152 + LAB-154 PR a — thinned from
// packages/claude-code/src/sdk/agent.ts to the seams the manager touches. The SDK is a
// fake async iterator speaking the shape `SdkMessageLike` already declares.
import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import {
  harnessRunInputSchema, harnessRunHandleSchema,
  type HarnessResolver, type HarnessSessionHook,
} from "./contract";
import { world, sleep } from "./world";

/** Claude's extension: the vendor's own reason, plus the dual LAB-154 PR a retires. */
export const claudeHandleSchema = harnessRunHandleSchema.extend({
  source: z.literal("claude-code/sdk"),
  resultSubtype: z.string().nullable(),
  toolsObserved: z.array(z.string()),
  costUsd: z.number().nullable(), // dual-read period only (LAB-152 decision 3)
});

export interface ClaudeCodeAgentOptions {
  detached?: boolean;
  recordWork?: boolean;
  cwd?: HarnessResolver<string>;
  /** LAB-154 §7: honoured on the background path only. */
  resume?: HarnessResolver<string | null>;
  onSession?: HarnessSessionHook;
}

let sessions = 0;
/** Fake SDK `query()`: names the session on the `init` message, then works, then reports. */
async function* fakeClaudeQuery(o: { prompt: string; cwd: string; resume: string | null }) {
  const session_id = o.resume ?? `claude-sess-${++sessions}`;
  yield { type: "system", subtype: "init", session_id } as const;
  world.treeWrites.push({ cwd: o.cwd, by: session_id, at: Date.now() });
  await sleep(5);
  yield {
    type: "result", subtype: "success", session_id,
    result: `${o.resume ? "continued" : "started"} ${session_id}: ${o.prompt.slice(0, 24)}`,
    usage: { input_tokens: 900, output_tokens: 120 }, total_cost_usd: 0.0123,
  } as const;
}

export function claudeCodeAgent(options: ClaudeCodeAgentOptions = {}) {
  const { detached = false, resume, onSession } = options;
  if (!detached && (resume !== undefined || onSession !== undefined)) {
    throw new Error("[claude-code] `resume`/`onSession` are background-path options; in-session, session state owns continuity.");
  }
  return handler({
    name: "claude-code-agent",
    inputSchema: harnessRunInputSchema,
    outputSchema: claudeHandleSchema,
    execute: async (input, ctx) => {
      const cwd = (await options.cwd?.(input, ctx)) ?? process.cwd();
      const resumeId = detached ? ((await resume?.(input, ctx)) || null) : null;
      let sessionId: string | null = null;
      let finalMessage: string | null = null;
      let subtype: string | null = null;
      let usage: { inputTokens: number; outputTokens: number } | null = null;
      let usd: number | null = null;
      // Forward-and-wait: the block's signal goes into the SDK's controller and the loop
      // runs until the SDK closes its stream (FIX-1301 tracks moving this to Codex's race).
      for await (const msg of fakeClaudeQuery({ prompt: input.prompt, cwd, resume: resumeId })) {
        if (msg.type === "system" && msg.session_id) {
          sessionId = msg.session_id;
          await onSession?.(sessionId, ctx); // before any turn work is consumed
        } else if (msg.type === "result") {
          subtype = msg.subtype;
          finalMessage = msg.result;
          usage = { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens };
          usd = msg.total_cost_usd;
        }
      }
      const outcome: "finished" | "stopped-at-limit" | "failed" =
        subtype === "success" ? "finished" : subtype?.startsWith("error_max") ? "stopped-at-limit" : "failed";
      return {
        source: "claude-code/sdk" as const, status: "completed" as const, sessionId, url: null,
        dispatchedAt: Date.now(), outcome, finalMessage, usage,
        cost: usd === null ? null : { usd, basis: "reported" as const },
        costUsd: usd, resultSubtype: subtype, toolsObserved: [],
      };
    },
  });
}
