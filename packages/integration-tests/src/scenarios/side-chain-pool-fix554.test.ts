/**
 * FIX-554 — request-scoped side-chain pool.
 *
 * Verifies that `.sideChain()` tasks dispatched inside an inner sequencer no
 * longer block the parent's next step. Two sibling branches each call
 * `.sideChain()`; the second branch's task must start while the first's is
 * still running.
 *
 * Also covers:
 * - SSE stream lifetime: the request stays open until the pool drains, so
 *   items emitted by background work after the main chain finishes still
 *   reach the response.
 * - Backwards-compat: the first scenario doubles as a regression check on the
 *   old per-sequencer path, under which the second branch could not start
 *   until the first branch's task had finished.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { testFlow } from "@flow-state-dev/testing";
import { z } from "zod";

const SLEEP_MS = 80;

describe("FIX-554: request-scoped side-chain pool", () => {
  it("sibling sequencers' .sideChain() tasks run concurrently: the second starts while the first is still running", async () => {
    // A holds until B's task has started. Under the pool, B starts while A is
    // still running, so A is released at once. Under the legacy per-sequencer
    // auto-await, branch B could not start until A had finished, so A sits out
    // its fallback and reports no overlap. Ordering, not wall time, so CPU load
    // cannot fail it.
    let bStarted!: () => void;
    const started = new Promise<void>((resolve) => (bStarted = resolve));
    let overlapped: boolean | undefined;
    let bRan = false;

    const slowA = handler({
      name: "slow-a",
      inputSchema: z.unknown(),
      outputSchema: z.number(),
      execute: async () => {
        let fallback: ReturnType<typeof setTimeout> | undefined;
        overlapped = await Promise.race([
          started.then(() => true),
          new Promise<boolean>((resolve) => (fallback = setTimeout(() => resolve(false), 2_000)))
        ]);
        clearTimeout(fallback);
        return 0;
      }
    });
    const slowB = handler({
      name: "slow-b",
      inputSchema: z.unknown(),
      outputSchema: z.number(),
      execute: async () => {
        bRan = true;
        bStarted();
        return 0;
      }
    });

    const branchA = sequencer({ name: "branch-a", inputSchema: z.unknown() }).sideChain(slowA);
    const branchB = sequencer({ name: "branch-b", inputSchema: z.unknown() }).sideChain(slowB);

    const root = sequencer({ name: "root", inputSchema: z.unknown() })
      .step(branchA)
      .step(branchB);

    const flow = defineFlow({
      kind: "fix554-flow",
      actions: { run: { block: root } }
    })({ id: "test" });

    const result = await testFlow({
      flow,
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "allow"
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    expect(bRan).toBe(true);
    expect(overlapped).toBe(true);
  });

  it("SSE stream stays open until background work completes — slow .sideChain() still surfaces", async () => {
    let sideChainCompletedAt = 0;
    const slow = handler({
      name: "slow-bg",
      inputSchema: z.unknown(),
      outputSchema: z.number(),
      execute: async () => {
        await new Promise((r) => setTimeout(r, SLEEP_MS));
        sideChainCompletedAt = Date.now();
        return SLEEP_MS;
      }
    });

    const inner = sequencer({ name: "inner", inputSchema: z.unknown() })
      .sideChain(slow);

    const root = sequencer({ name: "root", inputSchema: z.unknown() })
      .step(inner);

    const flow = defineFlow({
      kind: "fix554-stream",
      actions: { run: { block: root } }
    })({ id: "test" });

    const start = Date.now();
    const result = await testFlow({
      flow,
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "allow"
    });
    const completed = Date.now();

    expect(result.status).toBe("completed");
    // Background work finished before the request returned (drain is the
    // gate). If the main chain had returned without waiting for the pool,
    // sideChainCompletedAt would be 0 or > completed.
    expect(sideChainCompletedAt).toBeGreaterThan(0);
    expect(sideChainCompletedAt).toBeLessThanOrEqual(completed);
    expect(completed - start).toBeGreaterThanOrEqual(SLEEP_MS - 5);
  });

  it("waitForSideChain drains only the calling sequencer's scope", async () => {
    const orderLog: string[] = [];
    const fast = (name: string, ms: number) =>
      handler({
        name,
        inputSchema: z.unknown(),
        outputSchema: z.number(),
        execute: async () => {
          await new Promise((r) => setTimeout(r, ms));
          orderLog.push(name);
          return ms;
        }
      });

    // Inner sequencer dispatches a slow task and waits for *its own* work.
    // A separate sibling dispatches an even slower task; the inner's
    // waitForSideChain must NOT block on the sibling.
    const inner = sequencer({ name: "inner", inputSchema: z.unknown() })
      .sideChain(fast("inner-fast", 20))
      .waitForSideChain()
      .tap(() => {
        orderLog.push("inner-after-wait");
      });

    const sibling = sequencer({ name: "sibling", inputSchema: z.unknown() })
      .sideChain(fast("sibling-slow", 100));

    const root = sequencer({ name: "root", inputSchema: z.unknown() })
      .step(sibling)
      .step(inner);

    const flow = defineFlow({
      kind: "fix554-scope",
      actions: { run: { block: root } }
    })({ id: "test" });

    const result = await testFlow({
      flow,
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "allow"
    });
    expect(result.status).toBe("completed");

    // inner-fast settles before inner-after-wait; sibling-slow lands later
    // (drained by the request executor, not by inner's waitForSideChain).
    const innerFastIdx = orderLog.indexOf("inner-fast");
    const innerAfterIdx = orderLog.indexOf("inner-after-wait");
    const siblingIdx = orderLog.indexOf("sibling-slow");
    expect(innerFastIdx).toBeGreaterThanOrEqual(0);
    expect(innerAfterIdx).toBeGreaterThan(innerFastIdx);
    expect(siblingIdx).toBeGreaterThanOrEqual(0);
    // Inner's barrier waited for inner-fast only — sibling-slow finished
    // after inner-after-wait.
    expect(siblingIdx).toBeGreaterThan(innerAfterIdx);
  });
});
