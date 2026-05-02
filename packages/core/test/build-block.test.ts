import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { BlockConfig } from "../src/types/block";
import { asRuntime, BlockNestingError } from "../src/types/block";
import { buildBlock } from "../src/blocks/internal/build-block";
import { handler, sequencer } from "../src/blocks";
import { createMockContext, runForTest } from "./helpers";
class RetryableError extends Error {}
class FatalError extends Error {}

describe("buildBlock", () => {
  it("requires a non-empty block name", () => {
    const config = {
      name: "",
      execute: () => "ok"
    } as unknown as BlockConfig;

    expect(() =>
      buildBlock({
        kind: "handler",
        config
      })
    ).toThrow("non-empty");
  });

  it("requires an execute function", () => {
    expect(() =>
      buildBlock({
        kind: "handler",
        config: { name: "missing-execute" } as BlockConfig
      })
    ).toThrow("without an execute function");
  });

  it("validates input and output schemas", async () => {
    const block = buildBlock({
      kind: "handler",
      config: {
        name: "validated",
        inputSchema: z.object({ count: z.number() }),
        outputSchema: z.object({ total: z.number() }),
        execute: (input: { count: number }) => ({ total: input.count + 1 })
      }
    });

    const ctx = createMockContext();
    await expect(runForTest(block, { count: 1 }, ctx)).resolves.toEqual({ total: 2 });
    await expect(runForTest(block, { count: "bad" } as unknown as { count: number }, ctx)).rejects.toThrow(
      "input validation failed"
    );
  });

  it("keeps config.execute as user logic and exposes framework behavior via run()", async () => {
    const execute = vi.fn((input: { count: number }) => ({ total: input.count + 1 }));
    const block = buildBlock({
      kind: "handler",
      config: {
        name: "raw-execute",
        inputSchema: z.object({ count: z.number() }),
        outputSchema: z.object({ total: z.number() }),
        execute
      }
    });

    const ctx = createMockContext();
    expect(
      block.config.execute?.({ count: "bad" } as unknown as { count: number }, ctx)
    ).toEqual({ total: "bad1" });
    await expect(runForTest(block, { count: "bad" } as unknown as { count: number }, ctx)).rejects.toThrow(
      "input validation failed"
    );
  });

  it("supports connectInput and connectOutput", async () => {
    const block = buildBlock({
      kind: "handler",
      config: {
        name: "math",
        execute: (value) => value * 2
      }
    })
      .connectInput((value: string) => Number(value))
      .connectOutput((value) => `n:${value}`);

    const ctx = createMockContext();
    await expect(runForTest(block, "4", ctx)).resolves.toBe("n:8");
  });

  it("connectInput preserves declaredResources", () => {
    const resources = {
      session: { myResource: { stateSchema: z.object({ x: z.number() }) } }
    };
    const block = buildBlock({
      kind: "handler",
      config: {
        name: "with-resources",
        execute: (value) => value
      },
      declaredResources: resources
    });

    expect(block.declaredResources).toBe(resources);

    const connected = block.connectInput((value: string) => Number(value));
    expect(connected.declaredResources).toBe(resources);
  });

  it("connectOutput preserves declaredResources", () => {
    const resources = {
      session: { myResource: { stateSchema: z.object({ x: z.number() }) } }
    };
    const block = buildBlock({
      kind: "handler",
      config: {
        name: "with-resources",
        execute: (value) => value
      },
      declaredResources: resources
    });

    const connected = block.connectOutput((value) => `n:${value}`);
    expect(connected.declaredResources).toBe(resources);
  });

  it("propagates errors without retry (server owns retry)", async () => {
    let attempts = 0;
    const block = buildBlock({
      kind: "handler",
      config: {
        name: "no-retry",
        execute: () => {
          attempts += 1;
          throw new RetryableError("try again");
        }
      }
    });

    const ctx = createMockContext();
    await expect(runForTest(block, 1, ctx)).rejects.toThrow("try again");
    expect(attempts).toBe(1);
  });

  it("calls lifecycle hooks", async () => {
    const onCompleted = vi.fn();
    const onErrored = vi.fn();
    const ctx = createMockContext();

    const okBlock = buildBlock({
      kind: "handler",
      config: {
        name: "ok",
        onCompleted,
        execute: (value) => value + 1
      }
    });

    await expect(runForTest(okBlock, 1, ctx)).resolves.toBe(2);
    expect(onCompleted).toHaveBeenCalledWith(2, ctx);

    const failingBlock = buildBlock({
      kind: "handler",
      config: {
        name: "fail",
        onErrored,
        execute: () => {
          throw "boom";
        }
      }
    });

    await expect(runForTest(failingBlock, 1, ctx)).rejects.toThrow("boom");
    expect(onErrored).toHaveBeenCalledTimes(1);
    expect(onErrored.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  describe("BP-011 runtime guard (FIX-503)", () => {
    it("throws BlockNestingError when a block is invoked from inside a handler's execute", async () => {
      const inner = handler({
        name: "inner",
        execute: () => "inner-result"
      });

      const outer = handler({
        name: "outer",
        execute: async (_input, ctx) => asRuntime(inner)._run(undefined, ctx)
      });

      const ctx = createMockContext();
      await expect(runForTest(outer, undefined, ctx)).rejects.toBeInstanceOf(BlockNestingError);
    });

    it("does NOT throw for sibling blocks dispatched concurrently against a shared ctx", async () => {
      // thenAll / forEachBackground dispatch sibling blocks against the same ctx.
      // The handler-execute flag must live on a per-call wrapper, not the shared
      // ctx, so concurrent siblings don't observe each other's flags.
      const a = handler({ name: "a", execute: async () => "a-done" });
      const b = handler({ name: "b", execute: async () => "b-done" });
      const ctx = createMockContext();
      const [ra, rb] = await Promise.all([
        runForTest(a, undefined, ctx),
        runForTest(b, undefined, ctx)
      ]);
      expect([ra, rb]).toEqual(["a-done", "b-done"]);
    });

    it("_runUnchecked clears INSIDE_EXECUTE so the called block's children dispatch normally", async () => {
      // Regression for the bug bot finding: _runUnchecked must not leak the
      // caller's INSIDE_EXECUTE flag into the dispatched block. Otherwise a
      // sequencer (or any compound block) called via _runUnchecked from
      // inside a handler would throw at the first child step.
      const inner = sequencer({ name: "inner-seq", inputSchema: z.unknown() })
        .then(handler({ name: "inner-step-1", execute: () => "step-1" }))
        .then(handler({ name: "inner-step-2", execute: () => "step-2" }));

      const outer = handler({
        name: "outer-handler",
        execute: async (_input, ctx) => asRuntime(inner)._runUnchecked(undefined, ctx)
      });

      const ctx = createMockContext();
      await expect(runForTest(outer, undefined, ctx)).resolves.toBe("step-2");
    });
  });
});
