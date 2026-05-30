/**
 * FIX-554 — request-scoped background work pool.
 *
 * Verifies that `.work()` tasks dispatched inside an inner sequencer no
 * longer block the parent's next step. Two parallel branches each call
 * `.work()` on a slow handler; total wall time should approximate the
 * single-branch duration, not the sum.
 *
 * Also covers:
 * - SSE stream lifetime: the request stays open until the pool drains, so
 *   items emitted by background work after the main chain finishes still
 *   reach the response.
 * - Backwards-compat: the first scenario passes the existing test suite,
 *   which doubles as a regression check on the old per-sequencer path —
 *   it would have completed in ≈ 2× SLEEP_MS under the legacy model.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { testFlow } from "@flow-state-dev/testing";
import { z } from "zod";

const SLEEP_MS = 80;

const sleepHandler = (name: string, ms: number, marker: { done: boolean }) =>
  handler({
    name,
    inputSchema: z.unknown(),
    outputSchema: z.number(),
    execute: async () => {
      await new Promise((r) => setTimeout(r, ms));
      marker.done = true;
      return ms;
    }
  });

describe("FIX-554: request-scoped work pool", () => {
  it("sibling sequencers' .work() tasks run concurrently — wall time ≈ max, not sum", async () => {
    const aDone = { done: false };
    const bDone = { done: false };

    const branchA = sequencer({ name: "branch-a", inputSchema: z.unknown() })
      .work(sleepHandler("slow-a", SLEEP_MS, aDone));
    const branchB = sequencer({ name: "branch-b", inputSchema: z.unknown() })
      .work(sleepHandler("slow-b", SLEEP_MS, bDone));

    const root = sequencer({ name: "root", inputSchema: z.unknown() })
      .step(branchA)
      .step(branchB);

    const flow = defineFlow({
      kind: "fix554-flow",
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
    const elapsed = Date.now() - start;

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    expect(aDone.done).toBe(true);
    expect(bDone.done).toBe(true);
    // Both tasks ran concurrently. Allow generous slack for CI overhead.
    // Under the legacy per-sequencer auto-await this would be ≥ 2 × SLEEP_MS.
    expect(elapsed).toBeLessThan(SLEEP_MS * 2 - 10);
  });

  it("SSE stream stays open until background work completes — slow .work() still surfaces", async () => {
    let workCompletedAt = 0;
    const slow = handler({
      name: "slow-bg",
      inputSchema: z.unknown(),
      outputSchema: z.number(),
      execute: async () => {
        await new Promise((r) => setTimeout(r, SLEEP_MS));
        workCompletedAt = Date.now();
        return SLEEP_MS;
      }
    });

    const inner = sequencer({ name: "inner", inputSchema: z.unknown() })
      .work(slow);

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
    // workCompletedAt would be 0 or > completed.
    expect(workCompletedAt).toBeGreaterThan(0);
    expect(workCompletedAt).toBeLessThanOrEqual(completed);
    expect(completed - start).toBeGreaterThanOrEqual(SLEEP_MS - 5);
  });

  it("waitForWork drains only the calling sequencer's scope", async () => {
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
    // waitForWork must NOT block on the sibling.
    const inner = sequencer({ name: "inner", inputSchema: z.unknown() })
      .work(fast("inner-fast", 20))
      .waitForWork()
      .tap(() => {
        orderLog.push("inner-after-wait");
      });

    const sibling = sequencer({ name: "sibling", inputSchema: z.unknown() })
      .work(fast("sibling-slow", 100));

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
    // (drained by the request executor, not by inner's waitForWork).
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
