/**
 * Tests for selectModel — declarative model selection utility.
 */
import { describe, expect, it } from "vitest";
import { selectModel } from "../src/models/selectModel";
import type { BlockContext } from "../src/types/block";

// Minimal stub that satisfies BlockContext for selectModel tests.
// selectModel only passes ctx through to rule callbacks — no fields accessed.
const stubCtx = {} as BlockContext;

describe("selectModel", () => {
  // ---------------------------------------------------------------------------
  // when rules
  // ---------------------------------------------------------------------------

  it("single when rule — matches → returns use value", async () => {
    const resolve = selectModel("preset/fast", {
      when: () => true,
      use: "preset/smart",
    });
    expect(await resolve({}, stubCtx)).toBe("preset/smart");
  });

  it("single when rule — no match → returns default", async () => {
    const resolve = selectModel("preset/fast", {
      when: () => false,
      use: "preset/smart",
    });
    expect(await resolve({}, stubCtx)).toBe("preset/fast");
  });

  it("when rule with use as string[] — returns array", async () => {
    const resolve = selectModel("preset/fast", {
      when: () => true,
      use: ["preset/smart", "preset/fast"],
    });
    expect(await resolve({}, stubCtx)).toEqual(["preset/smart", "preset/fast"]);
  });

  // ---------------------------------------------------------------------------
  // prefer rules
  // ---------------------------------------------------------------------------

  it("single prefer rule — returns override → uses it", async () => {
    const resolve = selectModel("preset/fast", {
      prefer: () => "custom/model",
    });
    expect(await resolve({}, stubCtx)).toBe("custom/model");
  });

  it("single prefer rule — returns undefined → falls back to default", async () => {
    const resolve = selectModel("preset/fast", {
      prefer: () => undefined,
    });
    expect(await resolve({}, stubCtx)).toBe("preset/fast");
  });

  it("single prefer rule — returns null → falls back to default", async () => {
    const resolve = selectModel("preset/fast", {
      prefer: () => null,
    });
    expect(await resolve({}, stubCtx)).toBe("preset/fast");
  });

  it("single prefer rule — returns empty string → falls back to default", async () => {
    const resolve = selectModel("preset/fast", {
      prefer: () => "",
    });
    expect(await resolve({}, stubCtx)).toBe("preset/fast");
  });

  it("single prefer rule — returns same as default → falls back (no-op)", async () => {
    const resolve = selectModel("preset/fast", {
      prefer: () => "preset/fast",
    });
    expect(await resolve({}, stubCtx)).toBe("preset/fast");
  });

  // ---------------------------------------------------------------------------
  // Default as string[]
  // ---------------------------------------------------------------------------

  it("default as string[] — returned as-is when no rule matches", async () => {
    const resolve = selectModel(["preset/smart", "preset/fast"], {
      when: () => false,
      use: "other/model",
    });
    expect(await resolve({}, stubCtx)).toEqual(["preset/smart", "preset/fast"]);
  });

  // ---------------------------------------------------------------------------
  // Multiple rules
  // ---------------------------------------------------------------------------

  it("multiple rules — first match wins", async () => {
    const resolve = selectModel("preset/fast", [
      { when: () => false, use: "first" },
      { when: () => true, use: "second" },
      { when: () => true, use: "third" },
    ]);
    expect(await resolve({}, stubCtx)).toBe("second");
  });

  it("mixed prefer + when — prefer evaluated first", async () => {
    const resolve = selectModel("preset/fast", [
      { when: () => true, use: "when-result" },
      { prefer: () => "prefer-result" },
    ]);
    // prefer is evaluated first across ALL rules before when rules
    expect(await resolve({}, stubCtx)).toBe("prefer-result");
  });

  it("prefer skipped, when wins", async () => {
    const resolve = selectModel("preset/fast", [
      { prefer: () => undefined },
      { when: () => true, use: "when-result" },
    ]);
    expect(await resolve({}, stubCtx)).toBe("when-result");
  });

  // ---------------------------------------------------------------------------
  // Async rules
  // ---------------------------------------------------------------------------

  it("async prefer rule — awaited correctly", async () => {
    const resolve = selectModel("preset/fast", {
      prefer: async () => {
        await new Promise((r) => setTimeout(r, 0));
        return "async-model";
      },
    });
    expect(await resolve({}, stubCtx)).toBe("async-model");
  });

  it("async when rule — awaited correctly", async () => {
    const resolve = selectModel("preset/fast", {
      when: async () => {
        await new Promise((r) => setTimeout(r, 0));
        return true;
      },
      use: "async-model",
    });
    expect(await resolve({}, stubCtx)).toBe("async-model");
  });

  // ---------------------------------------------------------------------------
  // Input/ctx forwarding
  // ---------------------------------------------------------------------------

  it("prefer rule receives input and ctx", async () => {
    const input = { userId: "u1" };
    const ctx = { userId: "u1" } as unknown as BlockContext;

    const resolve = selectModel("preset/fast", {
      prefer: (i, c) => {
        if (i === input && c === ctx) return "matched";
        return undefined;
      },
    });
    expect(await resolve(input, ctx)).toBe("matched");
  });

  it("when rule receives input and ctx", async () => {
    const input = { flag: true };
    const ctx = { flag: true } as unknown as BlockContext;

    const resolve = selectModel("preset/fast", {
      when: (i, c) => (i as typeof input).flag && (c as typeof ctx).flag,
      use: "flagged-model",
    });
    expect(await resolve(input, ctx)).toBe("flagged-model");
  });
});
