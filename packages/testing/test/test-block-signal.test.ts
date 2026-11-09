/**
 * `testBlock({ signal })`: the block under test runs under a signal the test
 * holds, so a test can stop a run the way a host does (a deadline, a user's
 * stop) and see what the block does with it.
 *
 * Without it a stop can only be tested by calling the block's handler
 * directly, which skips the host path `testBlock` exists to run.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "../src";

/** A handler that waits until its run's signal fires, then fails with the signal's reason. */
const waitsForItsStop = handler({
  name: "waits-for-its-stop",
  inputSchema: z.object({}),
  outputSchema: z.string(),
  execute: async (_input, ctx) =>
    new Promise<string>((_resolve, reject) => {
      const signal = ctx.signal;
      if (signal === undefined) return reject(new Error("the run has no signal"));
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
});

describe("testBlock({ signal })", () => {
  it("runs the block under the caller's signal", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const block = handler({
      name: "reads-its-signal",
      inputSchema: z.object({}),
      outputSchema: z.boolean(),
      execute: async (_input, ctx) => {
        seen = ctx.signal;
        return ctx.signal?.aborted ?? true;
      },
    });
    const { output, error } = await testBlock(block, { input: {}, signal: controller.signal });
    expect(error).toBeNull();
    expect(output).toBe(false);
    controller.abort();
    // What the block was handed is the caller's: firing it reaches the block's.
    expect(seen?.aborted).toBe(true);
  });

  it("reaches the block when the caller aborts mid-run, with the caller's reason", async () => {
    const controller = new AbortController();
    const reason = new Error("stopped by the test");
    setTimeout(() => controller.abort(reason), 20);
    const result = await Promise.race([
      testBlock(waitsForItsStop, { input: {}, signal: controller.signal }),
      new Promise<"never stopped">((resolve) => setTimeout(() => resolve("never stopped"), 1_000)),
    ]);
    expect(result).not.toBe("never stopped");
    const { error } = result as Awaited<ReturnType<typeof testBlock>>;
    expect(String(error?.cause ?? error)).toContain("stopped by the test");
  });

  it("runs under a signal that never fires when none is given, as before", async () => {
    let seen: AbortSignal | undefined;
    const block = handler({
      name: "reads-its-default-signal",
      inputSchema: z.object({}),
      outputSchema: z.boolean(),
      execute: async (_input, ctx) => {
        seen = ctx.signal;
        return true;
      },
    });
    await testBlock(block, { input: {} });
    expect(seen?.aborted ?? false).toBe(false);
  });
});
