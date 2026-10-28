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

describe("cursorAgent reports its run's spend", () => {
  it("reports the run's settled tokens, with no cost and no billing", async () => {
    const block = cursorAgent({
      ...GATE_OFF,
      resolveCursorClient: scripted(async function* () {
        yield TURN_USAGE;
      }),
    });

    const { settled: reported, outcome } = await runReporting(block);

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

    const { settled: reported, outcome } = await runReporting(block, stop.signal);

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

    const { settled: reported, outcome } = await runReporting(block);

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

    const { settled: reported } = await runReporting(block);

    expect(reported).toEqual([{ harness: "cursor", inputTokens: 10_150, outputTokens: 200, costUsd: null, billing: null }]);
  });
});

/**
 * FIX-2288: a Cursor run names its configured model from the start, says "not
 * reported" until a turn finishes, then each finished turn's running total.
 * Why it matters: a task card reads these as the run works.
 */
describe("cursorAgent reports its spend as the run goes", () => {
  it("reports its configured model and no tokens at the start, then each finished turn's total, then the settled total", async () => {
    const block = cursorAgent({
      ...GATE_OFF,
      agent: { model: { id: "composer-2" } },
      resolveCursorClient: scripted(async function* () {
        yield TURN_USAGE;
        yield TURN_USAGE;
      }),
    } as CursorAgentOptions);

    const { reported } = await runReporting(block);

    expect(reported.map((r) => [r.model, r.inputTokens, r.outputTokens])).toEqual([
      ["composer-2", null, null],
      ["composer-2", 300, 100],
      ["composer-2", 600, 200],
      ["composer-2", 1200, 300],
    ]);
  });
});

describe("cursorAgent's settled report names the model the run settled on", () => {
  it("takes the wait result's model over the configured one, as the handle does", async () => {
    // A task card keeps the run's last report: a configured model the run did not use must not stand.
    const block = cursorAgent({
      ...GATE_OFF,
      agent: { model: { id: "composer-2" } },
      resolveCursorClient: scripted(
        async function* () {
          yield TURN_USAGE;
        },
        async () => ({ status: "finished", model: { id: "composer-2-fast" }, usage: { inputTokens: 1200, outputTokens: 300 } }),
      ),
    } as CursorAgentOptions);

    const { reported } = await runReporting(block);

    expect(reported.at(0)?.model).toBe("composer-2");
    expect(reported.at(-1)?.model).toBe("composer-2-fast");
  });
});

describe("cursorAgent reports the model the run names as soon as it names it", () => {
  it("reports the init message's model before any turn's tokens", async () => {
    // A long first turn must not show the configured model, or none, while Cursor already said which it runs.
    const block = cursorAgent({
      ...GATE_OFF,
      resolveCursorClient: scripted(async function* () {
        yield { type: "system", subtype: "init", model: { id: "composer-2" } } as CursorSdkMessage;
        yield TURN_USAGE;
      }),
    });

    const { reported } = await runReporting(block);

    expect(reported.map((r) => [r.model, r.inputTokens])).toEqual([
      [null, null],
      ["composer-2", null],
      ["composer-2", 300],
      ["composer-2", 1200],
    ]);
  });
});
