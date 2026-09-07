/**
 * Scripted Cursor client — the same seam `packages/cursor/test/agent.spec.ts`
 * uses. No runtime, no network.
 */
import type {
  CursorAgentLike,
  CursorCreateOptions,
  CursorRunLike,
  CursorRunResult,
  CursorSdkMessage,
  CursorSendOptions,
  ResolvedCursorClient,
} from "@flow-state-dev/cursor";

export interface Recorder {
  created: Array<CursorCreateOptions & { local?: { cwd?: string } }>;
  resumed: Array<{ id: string; options: CursorCreateOptions & { local?: { cwd?: string } } }>;
  sent: Array<{ prompt: string; options: CursorSendOptions | undefined }>;
}

const DEFAULT_WAIT: CursorRunResult = {
  status: "finished",
  result: "did the work",
  usage: {
    inputTokens: 10,
    outputTokens: 4,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 14,
    reasoningTokens: 0,
  },
  model: { id: "composer-2.5" },
};

const OK_STREAM: CursorSdkMessage[] = [
  { type: "system", subtype: "init", model: { id: "composer-2.5" } },
  { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "done" }] } },
];

export function scriptedCursor(opts: { agentId?: string; waitResult?: CursorRunResult } = {}) {
  const rec: Recorder = { created: [], resumed: [], sent: [] };

  const makeRun = (): CursorRunLike => ({
    id: "run_1",
    stream() {
      return (async function* () {
        for (const message of OK_STREAM) yield message;
      })();
    },
    async wait() {
      return opts.waitResult ?? DEFAULT_WAIT;
    },
    async cancel() {},
    supports() {
      return true;
    },
  });

  const makeAgent = (id: string): CursorAgentLike => ({
    agentId: id,
    async send(prompt: string, options?: CursorSendOptions) {
      rec.sent.push({ prompt, options });
      return makeRun();
    },
    close() {},
  });

  const resolve = (): ResolvedCursorClient => ({
    async create(options) {
      rec.created.push(options);
      return makeAgent(opts.agentId ?? "agent_1");
    },
    async resume(id, options) {
      rec.resumed.push({ id, options });
      return makeAgent(id);
    },
  });

  return { resolve, rec };
}
