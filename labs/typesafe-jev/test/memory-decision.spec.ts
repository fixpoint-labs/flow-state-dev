/**
 * Memory capture seam: Jev decides store / salience / kind.
 * Memory stays usable without this block.
 */
import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import {
  MEMORY_KIND_QUESTION,
  MEMORY_SALIENCE_QUESTION,
  MEMORY_STORE_QUESTION,
  createSystemOneMemoryDecision,
} from "../src/memory-decision";
import type { TypeSafeEvaluateOutput } from "../src/schemas";
import { scriptedClient } from "./scripted-client";

function decision(
  store: number,
  salience: number,
  kind: string,
): TypeSafeEvaluateOutput {
  return {
    model: "typesafe-ai/jev",
    answers: {
      [MEMORY_STORE_QUESTION]: { type: "boolean", probability: store },
      [MEMORY_SALIENCE_QUESTION]: {
        type: "score",
        score: salience,
        legend: { "0": "trivial", "1": "useful", "2": "critical" },
        probabilities: { "0": 0, "1": 0, "2": 1 },
        confidence: 0.9,
      },
      [MEMORY_KIND_QUESTION]: {
        type: "choice",
        choice: kind,
        probabilities: { [kind]: 0.9 },
        confidence: 0.9,
      },
    },
  };
}

describe("createSystemOneMemoryDecision", () => {
  it("stores a high-salience identity fact", async () => {
    const { client, calls } = scriptedClient(decision(0.92, 1.8, "identity"));
    const block = createSystemOneMemoryDecision({ client });
    const result = await testBlock(block, {
      input: { text: "My name is Ada and I live in Lisbon." },
    });
    expect(result.error).toBeNull();
    expect(result.output).toEqual({
      store: true,
      salience: 0.9,
      kind: "identity",
    });
    expect(calls).toHaveLength(1);
  });

  it("does not store when Jev says discard", async () => {
    const { client } = scriptedClient(decision(0.12, 0.2, "skip"));
    const result = await testBlock(createSystemOneMemoryDecision({ client }), {
      input: { text: "ok thanks" },
    });
    expect(result.error).toBeNull();
    expect(result.output).toEqual({
      store: false,
      salience: null,
      kind: null,
    });
  });
});
