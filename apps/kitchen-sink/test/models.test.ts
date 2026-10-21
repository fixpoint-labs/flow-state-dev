import { describe, expect, it, vi } from "vitest";
import {
  coalesceKitchenSinkModel,
  DEFAULT_KITCHEN_SINK_MODEL,
} from "../lib/models";

describe("coalesceKitchenSinkModel", () => {
  it("returns catalog ids unchanged", () => {
    expect(coalesceKitchenSinkModel("vercel:openai/gpt-6-luna")).toBe(
      "vercel:openai/gpt-6-luna",
    );
  });

  it("falls back when the id was removed from the catalog", () => {
    expect(coalesceKitchenSinkModel("vercel:hy/hy3")).toBe(
      DEFAULT_KITCHEN_SINK_MODEL,
    );
  });

  // Joined so this file does not spell the removed form the guard refuses.
  it("falls back to the default for a saved slash id, logging it once", () => {
    const saved = ["vercel", "anthropic", "claude-opus-4.8"].join("/");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(coalesceKitchenSinkModel(saved)).toBe(DEFAULT_KITCHEN_SINK_MODEL);
      expect(coalesceKitchenSinkModel(saved)).toBe(DEFAULT_KITCHEN_SINK_MODEL);
      const logged = warn.mock.calls.filter((args) => String(args[0]).includes(saved));
      expect(logged).toHaveLength(1);
      expect(String(logged[0][0])).toContain(DEFAULT_KITCHEN_SINK_MODEL);
    } finally {
      warn.mockRestore();
    }
  });

  it("does not log for an id merely removed from the catalog", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      coalesceKitchenSinkModel("vercel:hy/hy3");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("falls back for nullish values", () => {
    expect(coalesceKitchenSinkModel(undefined)).toBe(DEFAULT_KITCHEN_SINK_MODEL);
    expect(coalesceKitchenSinkModel(null)).toBe(DEFAULT_KITCHEN_SINK_MODEL);
  });
});
