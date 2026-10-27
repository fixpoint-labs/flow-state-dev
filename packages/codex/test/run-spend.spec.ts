/**
 * A Codex run reports what it spent into the running request when it ends,
 * however it ends (FIX-2145): the tokens Codex reported, no cost (Codex
 * reports none, and an estimate is never a reported cost), and `api-key`
 * billing when a key was handed to its client.
 *
 * Why it matters: per-worker usage counts a harness's tokens only through this
 * report, and a run that fails spent tokens too.
 */
import { describe, expect, it } from "vitest";
import { createTestContext } from "@flow-state-dev/testing";
import { REQUEST_SPEND_SEAM, type HarnessRunSpend } from "@flow-state-dev/core/types";
import { codexAgent, INTERNAL_SDK_VERSION_READER, type CodexAgentOptions } from "../src/agent";
import { TESTED_SDK_VERSION, type CodexThreadEvent } from "../src/types";

const GATE_OFF = {
  [INTERNAL_SDK_VERSION_READER]: () => ({ kind: "version", version: TESTED_SDK_VERSION }),
} as CodexAgentOptions;

/** A client whose thread replays `events`, then throws when `fail` is set. */
function scripted(events: CodexThreadEvent[], fail?: Error) {
  const thread = {
    id: "thr_1",
    async runStreamed() {
      return {
        events: (async function* () {
          for (const e of events) yield e;
          if (fail !== undefined) throw fail;
        })(),
      };
    },
  };
  return () => ({ startThread: () => thread, resumeThread: () => thread });
}

async function runReporting(block: ReturnType<typeof codexAgent>) {
  const reported: HarnessRunSpend[] = [];
  const runtime = await createTestContext({ declaredResources: block.declaredResources });
  (runtime.ctx as unknown as Record<symbol, unknown>)[REQUEST_SPEND_SEAM] = { reportHarnessRun: (run: HarnessRunSpend) => reported.push(run) };
  const outcome = await Promise.resolve(block.config.execute?.({ prompt: "go" }, runtime.ctx as never)).then(
    () => "returned",
    () => "threw",
  );
  return { reported, outcome };
}

const COMPLETED: CodexThreadEvent[] = [
  { type: "thread.started", thread_id: "thr_1" },
  { type: "turn.started" },
  { type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 200 } },
] as CodexThreadEvent[];

describe("codexAgent reports its run's spend", () => {
  it("reports Codex's tokens, no cost, and api-key billing when its client was handed a key", async () => {
    const block = codexAgent({ ...GATE_OFF, resolveCodexClient: scripted(COMPLETED) as never, client: { apiKey: "sk-test" }, model: "gpt-5.4-codex" });

    const { reported, outcome } = await runReporting(block);

    expect(outcome).toBe("returned");
    expect(reported).toEqual([{ harness: "codex", inputTokens: 1000, outputTokens: 200, costUsd: null, billing: "api-key" }]);
  });

  it("says nothing about billing when no key was handed to its client", async () => {
    const block = codexAgent({ ...GATE_OFF, resolveCodexClient: scripted(COMPLETED) as never });

    const { reported } = await runReporting(block);

    expect(reported).toEqual([{ harness: "codex", inputTokens: 1000, outputTokens: 200, costUsd: null, billing: null }]);
  });

  it("reports a run whose stream failed before any usage as one run with nothing reported", async () => {
    const block = codexAgent({
      ...GATE_OFF,
      resolveCodexClient: scripted([{ type: "thread.started", thread_id: "thr_1" }] as CodexThreadEvent[], new Error("codex exited 1")) as never,
    });

    const { reported, outcome } = await runReporting(block);

    expect(outcome).toBe("threw");
    expect(reported).toEqual([{ harness: "codex", inputTokens: null, outputTokens: null, costUsd: null, billing: null }]);
  });
});
