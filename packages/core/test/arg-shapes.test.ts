import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler } from "../src";
import type { BlockContext } from "../src/types/block";
import {
  isConcurrencyOptions,
  isInlineConfig,
  resolveCallShape
} from "../src/blocks/internal/arg-shapes";

const block = handler({
  name: "b",
  inputSchema: z.number(),
  outputSchema: z.number(),
  execute: (v) => v + 1
});

const block2 = handler({
  name: "b2",
  inputSchema: z.number(),
  outputSchema: z.number(),
  execute: (v) => v + 2
});

const connector = (v: number, _ctx: BlockContext): number => v * 2;
const factory = (cfg: Record<string, unknown>) =>
  handler({ ...cfg, execute: (v: unknown) => v } as any);

describe("isInlineConfig", () => {
  it("accepts an object carrying a Zod outputSchema", () => {
    expect(isInlineConfig({ outputSchema: z.string() })).toBe(true);
  });

  it("accepts an object carrying only an execute function", () => {
    expect(isInlineConfig({ execute: () => undefined })).toBe(true);
  });

  it("rejects a block definition", () => {
    expect(isInlineConfig(block)).toBe(false);
  });

  it("rejects non-objects and a plain object with neither marker", () => {
    expect(isInlineConfig(undefined)).toBe(false);
    expect(isInlineConfig(() => undefined)).toBe(false);
    expect(isInlineConfig({ foo: 1 })).toBe(false);
  });
});

describe("isConcurrencyOptions", () => {
  it("accepts maxConcurrency / concurrency objects", () => {
    expect(isConcurrencyOptions({ maxConcurrency: 2 })).toBe(true);
    expect(isConcurrencyOptions({ concurrency: 3 })).toBe(true);
  });

  it("accepts a `blocks` declaration on its own", () => {
    // `forEach(factory, { blocks })` has no connector and no concurrency knob;
    // if the object is not read as options here it becomes the per-item block
    // and the declaration is dropped silently.
    expect(isConcurrencyOptions({ blocks: [block] })).toBe(true);
    expect(resolveCallShape([() => block, { blocks: [block] }], "iterating")).toEqual({
      blockOrFactory: expect.any(Function),
      connector: undefined,
      options: { blocks: [block] }
    });
  });

  it("treats an empty object as options (preserved current behavior)", () => {
    expect(isConcurrencyOptions({})).toBe(true);
  });

  it("rejects a block definition and non-objects", () => {
    expect(isConcurrencyOptions(block)).toBe(false);
    expect(isConcurrencyOptions(undefined)).toBe(false);
  });
});

describe("resolveCallShape — child", () => {
  it("(block)", () => {
    expect(resolveCallShape([block], "child")).toEqual({ block, connector: undefined });
  });

  it("(connector, block)", () => {
    const shape = resolveCallShape([connector, block], "child");
    expect(shape).toEqual({ block, connector });
  });

  it("(factory, inlineConfig)", () => {
    const inlineConfig = { name: "inline", outputSchema: z.number() };
    const shape = resolveCallShape([factory, inlineConfig], "child");
    expect(shape).toEqual({ factory, inlineConfig });
    expect(shape.block).toBeUndefined();
  });

  it("a factory without an inline config is treated as a connector, not a factory", () => {
    // factory + block (not inline config) → connector form
    const shape = resolveCallShape([factory, block], "child");
    expect(shape.block).toBe(block);
    expect(shape.connector).toBe(factory);
    expect(shape.factory).toBeUndefined();
  });
});

describe("resolveCallShape — sideChain", () => {
  it("(block)", () => {
    expect(resolveCallShape([block], "sideChain")).toEqual({
      block,
      connector: undefined,
      options: undefined
    });
  });

  it("(connector, block)", () => {
    expect(resolveCallShape([connector, block], "sideChain")).toEqual({
      block,
      connector,
      options: undefined
    });
  });

  it("(block, options) — second arg is options, not a connector", () => {
    const options = { name: "task" };
    expect(resolveCallShape([block, options], "sideChain")).toEqual({
      block,
      connector: undefined,
      options
    });
  });

  it("(connector, block, options)", () => {
    const options = { name: "task" };
    expect(resolveCallShape([connector, block, options], "sideChain")).toEqual({
      block,
      connector,
      options
    });
  });
});

describe("resolveCallShape — iterating", () => {
  it("(block)", () => {
    expect(resolveCallShape([block], "iterating")).toEqual({
      blockOrFactory: block,
      connector: undefined,
      options: undefined
    });
  });

  it("(connector, block)", () => {
    expect(resolveCallShape([connector, block], "iterating")).toEqual({
      blockOrFactory: block,
      connector,
      options: undefined
    });
  });

  it("(factory)", () => {
    expect(resolveCallShape([factory], "iterating")).toEqual({
      blockOrFactory: factory,
      connector: undefined,
      options: undefined
    });
  });

  it("(connector, factory)", () => {
    expect(resolveCallShape([connector, factory], "iterating")).toEqual({
      blockOrFactory: factory,
      connector,
      options: undefined
    });
  });

  it("(block, options) — trailing concurrency options, no connector", () => {
    const options = { maxConcurrency: 2 };
    expect(resolveCallShape([block, options], "iterating")).toEqual({
      blockOrFactory: block,
      connector: undefined,
      options
    });
  });

  it("(connector, block, options)", () => {
    const options = { concurrency: 4 };
    expect(resolveCallShape([connector, block, options], "iterating")).toEqual({
      blockOrFactory: block,
      connector,
      options
    });
  });

  it("(connector, factory, options) — factory in slot 2 with a trailing options arg", () => {
    const options = { concurrency: 2 };
    expect(resolveCallShape([connector, factory, options], "iterating")).toEqual({
      blockOrFactory: factory,
      connector,
      options
    });
  });

  it("(block, {}) — empty object is treated as options, not a connector slot", () => {
    expect(resolveCallShape([block, {}], "iterating")).toEqual({
      blockOrFactory: block,
      connector: undefined,
      options: {}
    });
  });

  it("(connector, block) where block sits in slot 2 — connector inferred because slot 2 is not options", () => {
    const shape = resolveCallShape([connector, block2], "iterating");
    expect(shape.blockOrFactory).toBe(block2);
    expect(shape.connector).toBe(connector);
  });
});
