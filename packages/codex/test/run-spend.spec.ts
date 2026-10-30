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
  return { reported, outcome, settled: settledOf(reported) };
}

/** The run's last report (the one that stands), its run id checked and dropped. */
function settledOf(reported: HarnessRunSpend[]) {
  const last = reported.at(-1);
  if (last === undefined) return [];
  expect(new Set(reported.map((r) => r.runId)).size).toBe(1);
  expect(typeof last.runId).toBe("string");
  const { runId: _runId, model: _model, ...rest } = last;
  return [rest];
}

const COMPLETED: CodexThreadEvent[] = [
  { type: "thread.started", thread_id: "thr_1" },
  { type: "turn.started" },
  { type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 200 } },
] as CodexThreadEvent[];

describe("codexAgent reports its run's spend", () => {
  it("reports Codex's tokens, no cost, and api-key billing when its client was handed a key", async () => {
    const block = codexAgent({ ...GATE_OFF, resolveCodexClient: scripted(COMPLETED) as never, client: { apiKey: "sk-test" }, model: "gpt-5.4-codex" });

    const { settled: reported, outcome } = await runReporting(block);

    expect(outcome).toBe("returned");
    expect(reported).toEqual([{ harness: "codex", inputTokens: 1000, outputTokens: 200, costUsd: null, billing: "api-key" }]);
  });

  it("says nothing about billing when no key was handed to its client", async () => {
    const block = codexAgent({ ...GATE_OFF, resolveCodexClient: scripted(COMPLETED) as never });

    const { settled: reported } = await runReporting(block);

    expect(reported).toEqual([{ harness: "codex", inputTokens: 1000, outputTokens: 200, costUsd: null, billing: null }]);
  });

  it("reports a run whose stream failed before any usage as one run with nothing reported", async () => {
    const block = codexAgent({
      ...GATE_OFF,
      resolveCodexClient: scripted([{ type: "thread.started", thread_id: "thr_1" }] as CodexThreadEvent[], new Error("codex exited 1")) as never,
    });

    const { settled: reported, outcome } = await runReporting(block);

    expect(outcome).toBe("threw");
    expect(reported).toEqual([{ harness: "codex", inputTokens: null, outputTokens: null, costUsd: null, billing: null }]);
  });
});

/**
 * FIX-2288: a Codex run names its model from the start and says "not
 * reported" until its turn ends. Why it matters: a task card shows "Codex ·
 * gpt-5" while the run works, with no tokens rather than 0, and the real total
 * once Codex reports it.
 */
describe("codexAgent reports its spend as the run goes", () => {
  it("reports the model it was started with and no tokens at the start, then the turn's tokens", async () => {
    const block = codexAgent({ ...GATE_OFF, resolveCodexClient: scripted(COMPLETED) as never, model: "gpt-5" });

    const { reported } = await runReporting(block);

    expect(reported.map((r) => [r.model, r.inputTokens, r.outputTokens])).toEqual([
      ["gpt-5", null, null],
      ["gpt-5", 1000, 200],
      ["gpt-5", 1000, 200],
    ]);
  });

  it("names no model when Codex runs its own default", async () => {
    const block = codexAgent({ ...GATE_OFF, resolveCodexClient: scripted(COMPLETED) as never });

    const { reported } = await runReporting(block);

    expect(reported[0]).toMatchObject({ model: null, inputTokens: null, outputTokens: null });
  });
});
