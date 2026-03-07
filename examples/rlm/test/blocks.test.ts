import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { peek, grep, chunk } from "../src/flows/rlm/blocks";

const sampleContext = {
  text: "The quick brown fox jumps over the lazy dog. " +
    "Alice went to the market to buy some apples and oranges. " +
    "The weather forecast predicts rain for tomorrow. " +
    "Bob built a treehouse in the backyard last summer. " +
    "The conference on AI safety starts next Monday.",
  metadata: { tokenEstimate: 50 }
};

const emptyContext = { text: "", metadata: {} };

describe("peek tool", () => {
  it("reads from the beginning of context by default", async () => {
    const result = await testBlock(peek, {
      input: { start: 0, length: 50 },
      session: { resources: { context: sampleContext } }
    });

    expect(result.output.content).toHaveLength(50);
    expect(result.output.content).toContain("The quick brown fox");
    expect(result.output.totalLength).toBe(sampleContext.text.length);
    expect(result.output.rangeStart).toBe(0);
    expect(result.output.rangeEnd).toBe(50);
  });

  it("reads from a specific offset", async () => {
    const result = await testBlock(peek, {
      input: { start: 46, length: 20 },
      session: { resources: { context: sampleContext } }
    });

    expect(result.output.content).toHaveLength(20);
    expect(result.output.rangeStart).toBe(46);
  });

  it("handles empty context", async () => {
    const result = await testBlock(peek, {
      input: { start: 0, length: 100 },
      session: { resources: { context: emptyContext } }
    });

    expect(result.output.content).toBe("");
    expect(result.output.totalLength).toBe(0);
  });

  it("clamps range to context bounds", async () => {
    const result = await testBlock(peek, {
      input: { start: sampleContext.text.length - 10, length: 100 },
      session: { resources: { context: sampleContext } }
    });

    expect(result.output.content).toHaveLength(10);
    expect(result.output.rangeEnd).toBe(sampleContext.text.length);
  });
});

describe("grep tool", () => {
  it("finds matches with surrounding context", async () => {
    const result = await testBlock(grep, {
      input: { pattern: "fox", maxMatches: 10, surroundingChars: 20 },
      session: { resources: { context: sampleContext } }
    });

    expect(result.output.matches).toHaveLength(1);
    expect(result.output.matches[0].match).toBe("fox");
    expect(result.output.matches[0].surrounding).toContain("fox");
  });

  it("finds multiple matches", async () => {
    const result = await testBlock(grep, {
      input: { pattern: "the", maxMatches: 10, surroundingChars: 10 },
      session: { resources: { context: sampleContext } }
    });

    expect(result.output.matches.length).toBeGreaterThan(1);
  });

  it("respects maxMatches limit", async () => {
    const result = await testBlock(grep, {
      input: { pattern: "the", maxMatches: 1, surroundingChars: 10 },
      session: { resources: { context: sampleContext } }
    });

    expect(result.output.matches).toHaveLength(1);
  });

  it("returns empty for no matches", async () => {
    const result = await testBlock(grep, {
      input: { pattern: "zzzzz", maxMatches: 10, surroundingChars: 10 },
      session: { resources: { context: sampleContext } }
    });

    expect(result.output.matches).toHaveLength(0);
  });

  it("handles invalid regex gracefully", async () => {
    const result = await testBlock(grep, {
      input: { pattern: "[invalid", maxMatches: 10, surroundingChars: 10 },
      session: { resources: { context: sampleContext } }
    });

    expect(result.output.matches).toHaveLength(0);
  });
});

describe("chunk tool", () => {
  it("returns first chunk of context", async () => {
    const result = await testBlock(chunk, {
      input: { chunkIndex: 0, chunkSize: 100 },
      session: { resources: { context: sampleContext } }
    });

    expect(result.output.content).toHaveLength(100);
    expect(result.output.chunkIndex).toBe(0);
    expect(result.output.totalChunks).toBe(Math.ceil(sampleContext.text.length / 100));
    expect(result.output.rangeStart).toBe(0);
    expect(result.output.rangeEnd).toBe(100);
  });

  it("returns last chunk correctly", async () => {
    const chunkSize = 100;
    const totalChunks = Math.ceil(sampleContext.text.length / chunkSize);
    const result = await testBlock(chunk, {
      input: { chunkIndex: totalChunks - 1, chunkSize },
      session: { resources: { context: sampleContext } }
    });

    expect(result.output.chunkIndex).toBe(totalChunks - 1);
    expect(result.output.rangeEnd).toBe(sampleContext.text.length);
  });

  it("handles empty context", async () => {
    const result = await testBlock(chunk, {
      input: { chunkIndex: 0, chunkSize: 100 },
      session: { resources: { context: emptyContext } }
    });

    expect(result.output.content).toBe("");
    expect(result.output.totalChunks).toBe(1);
  });
});
