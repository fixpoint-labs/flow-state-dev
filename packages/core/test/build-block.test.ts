import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { BlockConfig } from "../src/types/block";
import { buildBlock } from "../src/blocks/internal/build-block";
import { asRuntime } from "../src/types/block";
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

  it("mapModelOutput stashes the mapper without changing run() output", async () => {
    const block = buildBlock({
      kind: "handler",
      config: {
        name: "rich",
        execute: (value: number) => ({ items: [{ id: "a", v: value }], n: 1 })
      }
    });

    const mapped = block.mapModelOutput((out) => `n=${out.n}`);

    // Schemas are preserved.
    expect(mapped.outputSchema).toBe(block.outputSchema);
    expect(mapped.inputSchema).toBe(block.inputSchema);

    // The structured output continues to flow through the substrate's run().
    const ctx = createMockContext();
    await expect(runForTest(mapped, 5, ctx)).resolves.toEqual({
      items: [{ id: "a", v: 5 }],
      n: 1
    });

    // The original block has no mapper; the mapped clone carries it.
    expect(asRuntime(block)._modelOutputMapper).toBeUndefined();
    const mapper = asRuntime(mapped)._modelOutputMapper;
    expect(mapper).toBeDefined();
    await expect(Promise.resolve(mapper!({ items: [], n: 3 } as never, ctx))).resolves.toBe("n=3");
  });

  it("connectInput preserves an installed mapModelOutput mapper", () => {
    // `connectInput` keeps `TOutputSchema`, so any mapper installed via
    // `mapModelOutput` is still type-valid against the rebuilt block. The
    // rebuild must forward it through.
    const block = buildBlock({
      kind: "handler",
      config: {
        name: "with-mapper",
        execute: (n: number) => ({ doubled: n * 2 })
      }
    }).mapModelOutput((out) => `doubled=${out.doubled}`);

    const reshaped = block.connectInput((s: string) => Number(s));
    expect(asRuntime(reshaped)._modelOutputMapper).toBeDefined();
  });

  it("connectOutput drops mapModelOutput (output type changes)", () => {
    const block = buildBlock({
      kind: "handler",
      config: {
        name: "drop-mapper",
        execute: (n: number) => ({ doubled: n * 2 })
      }
    }).mapModelOutput((out) => `doubled=${out.doubled}`);

    const reshaped = block.connectOutput((out) => out.doubled);
    expect(asRuntime(reshaped)._modelOutputMapper).toBeUndefined();
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
});
