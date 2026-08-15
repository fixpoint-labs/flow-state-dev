/**
 * FIX-1001 — a request must not report itself finished while its own
 * background work is still writing.
 *
 * Request-lifecycle contract scenario (AGENTS.md requires one for any change
 * to `runAction`'s terminal handling). The engine-tier tests in
 * `packages/engine/test/terminal-drain.test.ts` pin the internal ordering;
 * this pins the contract a flow author depends on, through the whole stack:
 * **work queued with `.sideChain()` has finished, and everything it wrote is in the
 * persisted record, by the time the request reports a terminal status — on a
 * non-success outcome, not just on success.**
 *
 * Two observables, together:
 *
 *  1. The run is still pending while the background task is parked on a gate
 *     the test controls. A task parked on a gate cannot finish on its own, so
 *     this cannot pass by the drain happening to be quick.
 *  2. The item the task emits after release is in the persisted record. Items
 *     are flushed immediately before the terminal patch, so a task still
 *     running at that point misses the flush entirely.
 *
 * The gate is what keeps this deterministic and cheap. An earlier version used
 * a real multi-hundred-millisecond sleep, which both weakened the assertion to
 * a timing sample and added enough load to destabilise a latency-sensitive
 * neighbour in the same suite.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { testFlow } from "@flow-state-dev/testing";
import { z } from "zod";

type Deferred = { promise: Promise<void>; resolve: () => void };
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Yield the macrotask queue so a non-draining implementation can settle. */
async function ticks(n = 4): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

/**
 * A background task parked on a gate. Once released it emits an item — the
 * durable artifact the assertions look for.
 */
function sideChainWriter(gate: Promise<void>, text: string) {
  return handler({
    name: "background-writer",
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    execute: async (_input: unknown, ctx: BlockContext) => {
      await gate;
      ctx.emit.message([{ type: "output_text", text }]);
      return null;
    }
  });
}

const failingStep = handler({
  name: "failing-step",
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  execute: async () => {
    throw new Error("the action failed");
  }
});

const succeedingStep = handler({
  name: "succeeding-step",
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  execute: async () => null
});

function buildFlow(kind: string, gate: Promise<void>, outcome: "fail" | "succeed") {
  return defineFlow({
    kind,
    actions: {
      run: {
        block: sequencer({ name: "root" })
          .sideChain(sideChainWriter(gate, `background-wrote:${outcome}`))
          .step(outcome === "fail" ? failingStep : succeedingStep)
      }
    }
  })({ id: "test" });
}

function textsOf(items: readonly unknown[]): string[] {
  return items.flatMap((item) =>
    ((item as { content?: Array<{ text?: string }> }).content ?? [])
      .map((c) => c.text)
      .filter((t): t is string => typeof t === "string")
  );
}

describe("FIX-1001: background work settles before a terminal status is reported", () => {
  it("a failing request waits for its background work, and the work's writes reach the record", async () => {
    const gate = deferred();

    const runPromise = testFlow({
      flow: buildFlow("terminal-drain-failed", gate.promise, "fail"),
      action: "run",
      userId: "u_drain",
      input: undefined,
      unmockedGeneratorPolicy: "error"
    });

    let settled = false;
    void runPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );

    // The step has thrown and the request is on its way to `failed`, with the
    // background task parked. Without the drain the run has already returned.
    await ticks();
    expect(settled).toBe(false);

    gate.resolve();
    const result = await runPromise;

    // The action genuinely failed — this is the non-success path, not a
    // success case wearing a different name.
    expect(result.status).toBe("failed");
    // The task's write is in the persisted record.
    expect(textsOf(result.items)).toContain("background-wrote:fail");
  });

  it("the success path keeps the same guarantee (control)", async () => {
    const gate = deferred();

    const runPromise = testFlow({
      flow: buildFlow("terminal-drain-completed", gate.promise, "succeed"),
      action: "run",
      userId: "u_drain",
      input: undefined,
      unmockedGeneratorPolicy: "error"
    });

    let settled = false;
    void runPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );

    await ticks();
    expect(settled).toBe(false);

    gate.resolve();
    const result = await runPromise;

    expect(result.status).toBe("completed");
    expect(textsOf(result.items)).toContain("background-wrote:succeed");
  });
});
