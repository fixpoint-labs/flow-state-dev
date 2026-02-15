import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { BlockConfig } from "../src/types/block";
import { buildBlock } from "../src/blocks/internal/build-block";
import { createMockContext } from "./helpers";

class RetryableError extends Error {}
class FatalError extends Error {}

describe("buildBlock", () => {
  it("requires a non-empty block name", () => {
    const config = {
      name: "",
      execute: () => "ok"
    } as unknown as BlockConfig<unknown, string>;

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
        config: { name: "missing-execute" } as BlockConfig<unknown, unknown>
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
    await expect(block.config.execute?.({ count: 1 }, ctx)).resolves.toEqual({ total: 2 });
    await expect(block.config.execute?.({ count: "bad" } as unknown as { count: number }, ctx)).rejects.toThrow(
      "input validation failed"
    );
  });

  it("supports connectInput and connectOutput", async () => {
    const block = buildBlock<number, number>({
      kind: "handler",
      config: {
        name: "math",
        execute: (value) => value * 2
      }
    })
      .connectInput((value: string) => Number(value))
      .connectOutput((value) => `n:${value}`);

    const ctx = createMockContext();
    await expect(block.config.execute?.("4", ctx)).resolves.toBe("n:8");
  });

  it("retries only retryable errors", async () => {
    let attempts = 0;
    const block = buildBlock<number, number>({
      kind: "handler",
      config: {
        name: "retryable",
        retry: {
          maxAttempts: 3,
          baseDelayMs: 0,
          retryableErrors: [RetryableError]
        },
        execute: () => {
          attempts += 1;
          if (attempts < 3) {
            throw new RetryableError("try again");
          }
          return attempts;
        }
      }
    });

    const ctx = createMockContext();
    await expect(block.config.execute?.(1, ctx)).resolves.toBe(3);
    expect(attempts).toBe(3);
  });

  it("does not retry non-retryable errors", async () => {
    let attempts = 0;
    const block = buildBlock<number, number>({
      kind: "handler",
      config: {
        name: "non-retryable",
        retry: {
          maxAttempts: 5,
          baseDelayMs: 0,
          retryableErrors: [RetryableError]
        },
        execute: () => {
          attempts += 1;
          throw new FatalError("fatal");
        }
      }
    });

    const ctx = createMockContext();
    await expect(block.config.execute?.(1, ctx)).rejects.toThrow("fatal");
    expect(attempts).toBe(1);
  });

  it("calls lifecycle hooks", async () => {
    const onCompleted = vi.fn();
    const onErrored = vi.fn();
    const ctx = createMockContext();

    const okBlock = buildBlock<number, number>({
      kind: "handler",
      config: {
        name: "ok",
        onCompleted,
        execute: (value) => value + 1
      }
    });

    await expect(okBlock.config.execute?.(1, ctx)).resolves.toBe(2);
    expect(onCompleted).toHaveBeenCalledWith(2, ctx);

    const failingBlock = buildBlock<number, number>({
      kind: "handler",
      config: {
        name: "fail",
        onErrored,
        execute: () => {
          throw "boom";
        }
      }
    });

    await expect(failingBlock.config.execute?.(1, ctx)).rejects.toThrow("boom");
    expect(onErrored).toHaveBeenCalledTimes(1);
    expect(onErrored.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });
});
