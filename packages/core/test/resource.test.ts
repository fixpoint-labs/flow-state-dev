import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineResource } from "../src";

describe("defineResource", () => {
  it("throws when content and contentFile are both provided", () => {
    expect(() => defineResource({
      scope: "session",
      stateSchema: z.object({ value: z.string() }),
      content: "inline",
      contentFile: "./file.md"
    })).toThrow("either content or contentFile");
  });

  it("accepts prefetchMode: 'eager'", () => {
    const res = defineResource({
      scope: "session",
      stateSchema: z.object({ value: z.string() }),
      prefetchMode: "eager",
    });
    expect(res.prefetchMode).toBe("eager");
  });

  it("accepts prefetchMode: 'lazy'", () => {
    const res = defineResource({
      scope: "session",
      stateSchema: z.object({ value: z.string() }),
      prefetchMode: "lazy",
    });
    expect(res.prefetchMode).toBe("lazy");
  });

  it("rejects prefetchMode: 'partial' on a single resource", () => {
    expect(() => defineResource({
      scope: "session",
      stateSchema: z.object({ value: z.string() }),
      // @ts-expect-error: 'partial' is not a valid single-resource prefetchMode
      prefetchMode: "partial",
    })).toThrow("partial");
  });

  it("rejects an unknown prefetchMode value", () => {
    expect(() => defineResource({
      scope: "session",
      stateSchema: z.object({ value: z.string() }),
      // @ts-expect-error: unknown prefetchMode value
      prefetchMode: "bogus",
    })).toThrow("prefetchMode");
  });
});
