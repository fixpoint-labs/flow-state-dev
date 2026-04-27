import { describe, expect, it } from "vitest";
import {
  hasPreferredProvider,
  normalizePreference,
  reorderByPreference,
} from "../../src/models/reorderByPreference";

interface Model {
  modelId: string;
  providerName: string;
}

const m = (modelId: string, providerName: string): Model => ({ modelId, providerName });

const PRESET_LARGE: Model[] = [
  m("openai/gpt-5.4", "openai"),
  m("anthropic/opus", "anthropic"),
  m("google/gemini-3", "google"),
  m("anthropic/sonnet", "anthropic"),
];

describe("normalizePreference", () => {
  it("returns null for undefined", () => {
    expect(normalizePreference(undefined)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(normalizePreference([])).toBeNull();
  });

  it("wraps single string in array", () => {
    expect(normalizePreference("anthropic")).toEqual(["anthropic"]);
  });

  it("passes through arrays", () => {
    expect(normalizePreference(["anthropic", "google"])).toEqual([
      "anthropic",
      "google",
    ]);
  });

  it("deduplicates preserving first occurrence", () => {
    expect(normalizePreference(["anthropic", "anthropic", "google"])).toEqual([
      "anthropic",
      "google",
    ]);
  });

  it("trims whitespace and drops empty entries", () => {
    expect(normalizePreference(["  anthropic  ", "", "google"])).toEqual([
      "anthropic",
      "google",
    ]);
  });
});

describe("reorderByPreference", () => {
  it("returns identity slice when prefer is undefined", () => {
    const out = reorderByPreference(PRESET_LARGE, undefined);
    expect(out.map((x) => x.modelId)).toEqual([
      "openai/gpt-5.4",
      "anthropic/opus",
      "google/gemini-3",
      "anthropic/sonnet",
    ]);
  });

  it("moves single preferred provider to the front", () => {
    const out = reorderByPreference(PRESET_LARGE, "anthropic");
    expect(out.map((x) => x.modelId)).toEqual([
      "anthropic/opus",
      "anthropic/sonnet",
      "openai/gpt-5.4",
      "google/gemini-3",
    ]);
  });

  it("honors multi-provider preference order", () => {
    const out = reorderByPreference(PRESET_LARGE, ["anthropic", "google"]);
    expect(out.map((x) => x.modelId)).toEqual([
      "anthropic/opus",
      "anthropic/sonnet",
      "google/gemini-3",
      "openai/gpt-5.4",
    ]);
  });

  it("preserves within-bucket relative order", () => {
    const list: Model[] = [
      m("anthropic/sonnet", "anthropic"),
      m("anthropic/opus", "anthropic"),
      m("openai/gpt-5.4", "openai"),
    ];
    const out = reorderByPreference(list, "anthropic");
    // sonnet still comes before opus because that was the original order
    expect(out.map((x) => x.modelId)).toEqual([
      "anthropic/sonnet",
      "anthropic/opus",
      "openai/gpt-5.4",
    ]);
  });

  it("empty preference array is treated as no-op", () => {
    const out = reorderByPreference(PRESET_LARGE, []);
    expect(out.map((x) => x.modelId)).toEqual(
      PRESET_LARGE.map((x) => x.modelId)
    );
  });

  it("unknown providers in prefer silently no-op", () => {
    const out = reorderByPreference(PRESET_LARGE, "foobar");
    expect(out.map((x) => x.modelId)).toEqual(
      PRESET_LARGE.map((x) => x.modelId)
    );
  });

  it("unknown providers mixed with known reorder only the known", () => {
    const out = reorderByPreference(PRESET_LARGE, ["foobar", "anthropic"]);
    expect(out.map((x) => x.modelId)).toEqual([
      "anthropic/opus",
      "anthropic/sonnet",
      "openai/gpt-5.4",
      "google/gemini-3",
    ]);
  });

  it("dedupes preference entries (first occurrence wins)", () => {
    const out = reorderByPreference(PRESET_LARGE, ["anthropic", "anthropic"]);
    expect(out.map((x) => x.modelId)).toEqual([
      "anthropic/opus",
      "anthropic/sonnet",
      "openai/gpt-5.4",
      "google/gemini-3",
    ]);
  });

  it("does not mutate the input array", () => {
    const copy = PRESET_LARGE.slice();
    reorderByPreference(PRESET_LARGE, "anthropic");
    expect(PRESET_LARGE).toEqual(copy);
  });

  it("returns a new array (defensive copy) when prefer is absent", () => {
    const out = reorderByPreference(PRESET_LARGE, undefined);
    expect(out).not.toBe(PRESET_LARGE);
  });
});

describe("hasPreferredProvider", () => {
  it("returns true when prefer is undefined", () => {
    expect(hasPreferredProvider(PRESET_LARGE, undefined)).toBe(true);
  });

  it("returns true when a preferred provider appears in the list", () => {
    expect(hasPreferredProvider(PRESET_LARGE, "anthropic")).toBe(true);
  });

  it("returns false when no preferred provider appears in the list", () => {
    expect(hasPreferredProvider(PRESET_LARGE, "foobar")).toBe(false);
  });

  it("returns true when any of several preferred providers matches", () => {
    expect(hasPreferredProvider(PRESET_LARGE, ["foobar", "google"])).toBe(true);
  });

  it("returns false for empty list regardless of prefer (except no-pref)", () => {
    expect(hasPreferredProvider([], "anthropic")).toBe(false);
  });
});
