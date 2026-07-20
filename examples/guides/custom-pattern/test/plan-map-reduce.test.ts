import { describe, it, expect } from "vitest";
import { testFlow } from "@flow-state-dev/testing";
import wordCountFlow from "../src/word-count-flow";

// Deterministic map worker — no model, no API key.

describe("mapReduce custom pattern", () => {
  it("maps each document to its word count and reduces to a total", async () => {
    const result = await testFlow({
      flow: wordCountFlow,
      action: "count",
      userId: "u",
      input: { documents: ["a b c", "one two", "single"] },
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    // 3 + 2 + 1
    expect(result.output).toEqual({ total: 6 });
  });

  it("handles an empty document set", async () => {
    const result = await testFlow({
      flow: wordCountFlow,
      action: "count",
      userId: "u",
      input: { documents: [] },
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ total: 0 });
  });
});
