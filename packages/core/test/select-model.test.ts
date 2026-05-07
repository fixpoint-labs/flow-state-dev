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
    const resolve = selectModel("intent/utility", {
      when: () => true,
      use: "intent/chat",
    });
    expect(await resolve({}, stubCtx)).toBe("intent/chat");
  });

  it("single when rule — no match → returns default", async () => {
    const resolve = selectModel("intent/utility", {
      when: () => false,
      use: "intent/chat",
    });
    expect(await resolve({}, stubCtx)).toBe("intent/utility");
  });

  it("when rule with use as string[] — returns array", async () => {
    const resolve = selectModel("intent/utility", {
      when: () => true,
      use: ["intent/chat", "intent/utility"],
    });
    expect(await resolve({}, stubCtx)).toEqual(["intent/chat", "intent/utility"]);
  });

  // ---------------------------------------------------------------------------
  // preferProvider rules
  // ---------------------------------------------------------------------------

  it("preferProvider rule — sets preferProvider and returns structured selection", async () => {
    const resolve = selectModel("intent/utility", {
      preferProvider: () => "anthropic",
    });
    expect(await resolve({}, stubCtx)).toEqual({
      model: "intent/utility",
      preferProvider: "anthropic",
    });
  });

  it("preferProvider rule — returns array of provider names", async () => {
    const resolve = selectModel("intent/utility", {
      preferProvider: () => ["anthropic", "openai"],
    });
    expect(await resolve({}, stubCtx)).toEqual({
      model: "intent/utility",
      preferProvider: ["anthropic", "openai"],
    });
  });

  it("preferProvider rule — returns undefined → bare-string back-compat", async () => {
    const resolve = selectModel("intent/utility", {
      preferProvider: () => undefined,
    });
    expect(await resolve({}, stubCtx)).toBe("intent/utility");
  });

  it("preferProvider rule — returns null → bare-string back-compat", async () => {
    const resolve = selectModel("intent/utility", {
      preferProvider: () => null,
    });
    expect(await resolve({}, stubCtx)).toBe("intent/utility");
  });

  it("preferProvider rule — returns empty string → bare-string back-compat", async () => {
    const resolve = selectModel("intent/utility", {
      preferProvider: () => "",
    });
    expect(await resolve({}, stubCtx)).toBe("intent/utility");
  });

  it("preferProvider does not short-circuit — when rule still fires", async () => {
    const resolve = selectModel("intent/utility", [
      { preferProvider: () => "openai" },
      { when: () => true, use: "intent/chat" },
    ]);
    expect(await resolve({}, stubCtx)).toEqual({
      model: "intent/chat",
      preferProvider: "openai",
    });
  });

  // ---------------------------------------------------------------------------
  // Legacy `prefer` migration error
  // ---------------------------------------------------------------------------

  it("legacy `prefer` rule throws migration error at builder time", () => {
    expect(() =>
      selectModel("intent/utility", {
        // @ts-expect-error — legacy field intentionally tested
        prefer: () => "x",
      })
    ).toThrow(/`prefer` rule has been replaced/);
  });

  // ---------------------------------------------------------------------------
  // Default as string[]
  // ---------------------------------------------------------------------------

  it("default as string[] — returned as-is when no rule matches", async () => {
    const resolve = selectModel(["intent/chat", "intent/utility"], {
      when: () => false,
      use: "other/model",
    });
    expect(await resolve({}, stubCtx)).toEqual(["intent/chat", "intent/utility"]);
  });

  // ---------------------------------------------------------------------------
  // Multiple rules
  // ---------------------------------------------------------------------------

  it("multiple when rules — first match wins", async () => {
    const resolve = selectModel("intent/utility", [
      { when: () => false, use: "first" },
      { when: () => true, use: "second" },
      { when: () => true, use: "third" },
    ]);
    expect(await resolve({}, stubCtx)).toBe("second");
  });

  // ---------------------------------------------------------------------------
  // Async rules
  // ---------------------------------------------------------------------------

  it("async preferProvider rule — awaited correctly", async () => {
    const resolve = selectModel("intent/utility", {
      preferProvider: async () => {
        await new Promise((r) => setTimeout(r, 0));
        return "anthropic";
      },
    });
    expect(await resolve({}, stubCtx)).toEqual({
      model: "intent/utility",
      preferProvider: "anthropic",
    });
  });

  it("async when rule — awaited correctly", async () => {
    const resolve = selectModel("intent/utility", {
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

  it("preferProvider rule receives input and ctx", async () => {
    const input = { userId: "u1" };
    const ctx = { userId: "u1" } as unknown as BlockContext;

    const resolve = selectModel("intent/utility", {
      preferProvider: (i, c) => {
        if (i === input && c === ctx) return "anthropic";
        return undefined;
      },
    });
    expect(await resolve(input, ctx)).toEqual({
      model: "intent/utility",
      preferProvider: "anthropic",
    });
  });

  it("when rule receives input and ctx", async () => {
    const input = { flag: true };
    const ctx = { flag: true } as unknown as BlockContext;

    const resolve = selectModel("intent/utility", {
      when: (i, c) => (i as typeof input).flag && (c as typeof ctx).flag,
      use: "flagged-model",
    });
    expect(await resolve(input, ctx)).toBe("flagged-model");
  });
});
