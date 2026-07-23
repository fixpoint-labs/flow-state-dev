import { describe, expect, it } from "vitest";
import {
  coalesceKitchenSinkModel,
  DEFAULT_KITCHEN_SINK_MODEL,
} from "../lib/models";

describe("coalesceKitchenSinkModel", () => {
  it("returns catalog ids unchanged", () => {
    expect(coalesceKitchenSinkModel("vercel/openai/gpt-5.6-luna")).toBe(
      "vercel/openai/gpt-5.6-luna",
    );
  });

  it("falls back when the id was removed from the catalog", () => {
    expect(coalesceKitchenSinkModel("vercel/hy/hy3")).toBe(
      DEFAULT_KITCHEN_SINK_MODEL,
    );
  });

  it("falls back for nullish values", () => {
    expect(coalesceKitchenSinkModel(undefined)).toBe(DEFAULT_KITCHEN_SINK_MODEL);
    expect(coalesceKitchenSinkModel(null)).toBe(DEFAULT_KITCHEN_SINK_MODEL);
  });
});
