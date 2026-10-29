/**
 * A Cursor run reports what it spent into the running request when it ends,
 * however it ends (FIX-2145): the tokens Cursor reported, no cost (Cursor's
 * figure is an estimate), and no billing (Cursor doesn't say).
 *
 * Why it matters: Cursor reports usage per turn, so a run stopped mid-way has
 * already spent the turns it finished, and they must still count.
 */
import { describe, expect, it } from "vitest";
import { createTestContext } from "@flow-state-dev/testing";
import { REQUEST_SPEND_SEAM, type HarnessRunSpend } from "@flow-state-dev/core/types";
import { cursorAgent, INTERNAL_SDK_VERSION_READER, type CursorAgentOptions } from "../src/agent";
import { TESTED_SDK_VERSION, type CursorAgentLike, type CursorRunLike, type CursorSdkMessage, type ResolvedCursorClient } from "../src/types";

const GATE_OFF = {
  [INTERNAL_SDK_VERSION_READER]: () => ({ kind: "version", version: TESTED_SDK_VERSION }),
} as CursorAgentOptions;

const TURN_USAGE: CursorSdkMessage = {
  type: "usage",
  usage: { inputTokens: 300, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
} as CursorSdkMessage;

/** A client whose one run streams `stream` and settles with `wait`. */
function scripted(stream: () => AsyncIterable<CursorSdkMessage>, wait?: () => Promise<unknown>): () => ResolvedCursorClient {
  const run: CursorRunLike = {
    id: "run_1",
    stream,
    wait: (wait ?? (async () => ({ status: "finished", usage: { inputTokens: 1200, outputTokens: 300 } }))) as never,
    async cancel() {},
  };
  const agent: CursorAgentLike = { agentId: "agent_1", send: async () => run, close() {} };
  return () => ({ create: async () => agent, resume: async () => agent });
}

async function runReporting(block: ReturnType<typeof cursorAgent>, signal?: AbortSignal) {
  const reported: HarnessRunSpend[] = [];
  const runtime = await createTestContext({});
  (runtime.ctx as unknown as Record<symbol, unknown>)[REQUEST_SPEND_SEAM] = { reportHarnessRun: (run: HarnessRunSpend) => reported.push(run) };
  if (signal !== undefined) (runtime.ctx as { signal?: AbortSignal }).signal = signal;
  const outcome = await Promise.resolve(block.config.execute?.({ prompt: "go" }, runtime.ctx as never)).then(
    () => "returned",
    () => "threw",
  );
  return { reported, outcome };
}

describe("cursorAgent reports its run's spend", () => {
  it("reports the run's settled tokens, with no cost and no billing", async () => {
    const block = cursorAgent({
      ...GATE_OFF,
      resolveCursorClient: scripted(async function* () {
        yield TURN_USAGE;
      }),
    });

    const { reported, outcome } = await runReporting(block);

    expect(outcome).toBe("returned");
    expect(reported).toEqual([{ harness: "cursor", inputTokens: 1200, outputTokens: 300, costUsd: null, billing: null }]);
  });

  it("keeps the turns a stopped run finished", async () => {
    const stop = new AbortController();
    const block = cursorAgent({
      ...GATE_OFF,
      resolveCursorClient: scripted(async function* () {
        yield TURN_USAGE;
        setTimeout(() => stop.abort(), 10);
        await new Promise(() => {});
      }),
    });

    const { reported, outcome } = await runReporting(block, stop.signal);

    expect(outcome).toBe("threw");
    expect(reported).toEqual([{ harness: "cursor", inputTokens: 300, outputTokens: 100, costUsd: null, billing: null }]);
  });

  it("reports a run that failed before any turn as one run with nothing reported", async () => {
    const block = cursorAgent({
      ...GATE_OFF,
      resolveCursorClient: scripted(async function* () {
        throw new Error("the runtime went away");
      }),
    });

    const { reported, outcome } = await runReporting(block);

    expect(outcome).toBe("threw");
    expect(reported).toEqual([{ harness: "cursor", inputTokens: null, outputTokens: null, costUsd: null, billing: null }]);
  });

  it("counts cached prompt tokens as input", async () => {
    // Cursor counts cache reads and writes apart from input; a worker's total
    // read without them would miss most of a cached run's prompt.
    const block = cursorAgent({
      ...GATE_OFF,
      resolveCursorClient: scripted(
        async function* () {
          yield TURN_USAGE;
        },
        async () => ({ status: "finished", usage: { inputTokens: 100, outputTokens: 200, cacheReadTokens: 10_000, cacheWriteTokens: 50 } }),
      ),
    });

    const { reported } = await runReporting(block);

    expect(reported).toEqual([{ harness: "cursor", inputTokens: 10_150, outputTokens: 200, costUsd: null, billing: null }]);
  });
});
