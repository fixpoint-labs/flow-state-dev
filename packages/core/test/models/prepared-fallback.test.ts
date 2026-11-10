// FIX-2520.
/**
 * A fallback group (a model array, an intent) prepares each candidate's call
 * for that candidate's own provider: the person's files go to
 * each in the form its provider reads, and a candidate that takes over after
 * another failed is not handed messages built for the first.
 */
import { describe, expect, it } from "vitest";
import { createFallbackModel } from "../../src/models/fallbackModel";
import { withPreparedMessages } from "../../src/models/prepared-model";
import type { GeneratorModel } from "../../src/types/model";

const RETRY = { maxAttemptsPerModel: 1, baseDelayMs: 0, maxDelayMs: 0 };

/** A candidate that records the messages it got, and fails when told to. */
function candidate(seen: unknown[][], fail = false): GeneratorModel {
  const record = (messages: unknown[]) => {
    seen.push(messages);
    // A 503: a failure every call path falls through to the next candidate on.
    if (fail) throw Object.assign(new Error("candidate down"), { statusCode: 503 });
  };
  return {
    modelId: "m",
    async generate(options) {
      record(options.messages as unknown[]);
      return { text: "ok" } as never;
    },
    async *stream(options) {
      record(options.messages as unknown[]);
      yield { type: "finish", fullResult: { text: "ok" } } as never;
    },
  };
}

/** A prepare that writes the target's PDF reading into the messages. */
const prepare = async (messages: unknown[], target?: { accepts: readonly string[] }) => [
  ...messages,
  target === undefined ? "no target" : target.accepts.includes("application/pdf") ? "pdf as file" : "pdf as text",
];

function group(seenA: unknown[][], seenB: unknown[][]) {
  return createFallbackModel({
    groupName: "g",
    retryPolicy: RETRY,
    models: [
      { modelId: "acme/house", providerName: "acme", model: candidate(seenA, true) },
      { modelId: "anthropic/x", providerName: "anthropic", model: candidate(seenB) },
    ],
  });
}

describe("a fallback group's prepared calls", () => {
  it("prepares each candidate's generate call for its own provider", async () => {
    const seenA: unknown[][] = [];
    const seenB: unknown[][] = [];
    await withPreparedMessages(group(seenA, seenB), prepare).generate({ messages: ["hi"] } as never);
    expect(seenA).toEqual([["hi", "pdf as text"]]);
    expect(seenB).toEqual([["hi", "pdf as file"]]);
  });

  it("prepares each candidate's stream call for its own provider", async () => {
    const seenA: unknown[][] = [];
    const seenB: unknown[][] = [];
    for await (const _ of withPreparedMessages(group(seenA, seenB), prepare).stream!({ messages: ["hi"] } as never)) void _;
    expect(seenA).toEqual([["hi", "pdf as text"]]);
    expect(seenB).toEqual([["hi", "pdf as file"]]);
  });

  it("leaves a group's call unprepared when the run has no prepare", async () => {
    const seenA: unknown[][] = [];
    const seenB: unknown[][] = [];
    await withPreparedMessages(group(seenA, seenB), undefined).generate({ messages: ["hi"] } as never);
    expect(seenB).toEqual([["hi"]]);
  });
});
