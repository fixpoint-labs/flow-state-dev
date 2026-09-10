/** Scripted adapter client: records host feeds without spawning a harness. */
import type { CodexThreadEvent, CodexThreadLike, ResolvedCodexClient } from "@flow-state-dev/codex";

export function scriptedCodex(events?: CodexThreadEvent[], error?: Error) {
  const rec = {
    started: [] as Parameters<ResolvedCodexClient["startThread"]>[0][],
    resumed: [] as { id: string; options: Parameters<ResolvedCodexClient["startThread"]>[0] }[],
    prompts: [] as string[],
  };
  const thread = (): CodexThreadLike => ({
    id: null,
    async runStreamed(prompt) {
      rec.prompts.push(prompt);
      if (error) throw error;
      return { events: (async function* () {
        yield* events ?? [
          { type: "thread.started", thread_id: "codex-thread" },
          { type: "item.completed", item: { id: "msg", type: "agent_message", text: "done" } },
          { type: "turn.completed" },
        ];
      })() };
    },
  });
  const resolve = (): ResolvedCodexClient => ({
    startThread(options) { rec.started.push(options); return thread(); },
    resumeThread(id, options) { rec.resumed.push({ id, options }); return thread(); },
  });
  return { rec, resolve };
}
