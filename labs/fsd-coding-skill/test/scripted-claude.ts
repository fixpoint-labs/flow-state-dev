/**
 * Scripted Claude Agent SDK client — the same seam
 * `packages/claude-code/test/sdk/agent.spec.ts` uses. No runtime, no network.
 */
import type {
  ClaudeAgentQueryOptions,
  ResolveClaudeAgent,
  SdkMessageLike,
} from "@flow-state-dev/claude-code/sdk";

export interface ClaudeRecorder {
  prompts: string[];
  options: Array<ClaudeAgentQueryOptions | undefined>;
  cwd: Array<string | undefined>;
  resume: Array<string | undefined>;
}

function defaultMessages(sessionId: string): SdkMessageLike[] {
  return [
    { type: "system", subtype: "init", session_id: sessionId },
    {
      type: "result",
      subtype: "success",
      result: "did the work",
      session_id: sessionId,
      usage: { input_tokens: 10, output_tokens: 4 },
      total_cost_usd: 0.01,
    },
  ];
}

export function scriptedClaude(opts: {
  messages?: SdkMessageLike[];
  sessionId?: string;
} = {}) {
  const sessionId = opts.sessionId ?? "sess_claude";
  const rec: ClaudeRecorder = { prompts: [], options: [], cwd: [], resume: [] };
  const resolve: ResolveClaudeAgent = () => ({
    query: async function* (args) {
      rec.prompts.push(
        typeof args.prompt === "string" ? args.prompt : JSON.stringify(args.prompt),
      );
      rec.options.push(args.options);
      rec.cwd.push(args.options?.cwd);
      rec.resume.push(args.options?.resume);
      for (const message of opts.messages ?? defaultMessages(sessionId)) {
        yield message;
      }
    },
  });
  return { rec, resolve };
}
