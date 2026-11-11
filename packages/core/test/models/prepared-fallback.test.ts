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

/** The typed refusal a run's prepare throws when a PDF's text is over the cap. */
class TooMuchText extends Error {
  readonly code = "pdf_text_too_large";
  readonly filename = "dense.pdf";
}

/** A prepare that can't send the PDF as text: only a target that reads PDFs gets the call. */
const refusesText = async (messages: unknown[], target?: { accepts: readonly string[] }) => {
  if (target?.accepts.includes("application/pdf") !== true) throw new TooMuchText("too much text");
  return messages;
};

function twoCandidates(seenA: unknown[][], seenB: unknown[][], second: string, failA = false) {
  return createFallbackModel({
    groupName: "g",
    retryPolicy: RETRY,
    models: [
      { modelId: "acme/house", providerName: "acme", model: candidate(seenA, failA) },
      { modelId: `${second}/x`, providerName: second, model: candidate(seenB) },
    ],
  });
}

// A file the first candidate can't take is a reason to try the next, not to
// stop: the next may read it as a file.
describe("a candidate its files can't be prepared for", () => {
  it("is passed over on a stream, and the next candidate that reads PDFs answers", async () => {
    const seenA: unknown[][] = [];
    const seenB: unknown[][] = [];
    const model = withPreparedMessages(twoCandidates(seenA, seenB, "anthropic"), refusesText);
    for await (const _ of model.stream!({ messages: ["hi"] } as never)) void _;
    expect(seenA).toEqual([]);
    expect(seenB).toEqual([["hi"]]);
  });

  it("is passed over on a generate, and the next candidate that reads PDFs answers", async () => {
    const seenA: unknown[][] = [];
    const seenB: unknown[][] = [];
    await withPreparedMessages(twoCandidates(seenA, seenB, "anthropic"), refusesText).generate({ messages: ["hi"] } as never);
    expect(seenB).toEqual([["hi"]]);
  });

  // The person is told which file, and why, not that every model failed.
  it("fails the call with the file's own error when no candidate could take it", async () => {
    const generate = withPreparedMessages(twoCandidates([], [], "other"), refusesText).generate({ messages: ["hi"] } as never);
    await expect(generate).rejects.toBeInstanceOf(TooMuchText);
    const stream = (async () => {
      for await (const _ of withPreparedMessages(twoCandidates([], [], "other"), refusesText).stream!({ messages: ["hi"] } as never)) void _;
    })();
    await expect(stream).rejects.toMatchObject({ code: "pdf_text_too_large", filename: "dense.pdf" });
  });
});

// A wrapper that copies a group and changes one thing (a benchmark that turns
// search off) keeps that change once the run prepares its calls.
it("keeps what a wrapper around a group changed, and still prepares each candidate", async () => {
  const seenA: unknown[][] = [];
  const seenB: unknown[][] = [];
  const base = group(seenA, seenB);
  const withoutSearch: GeneratorModel = { ...base, resolveSearchTool: undefined };
  const model = withPreparedMessages(withoutSearch, prepare);
  expect(model.resolveSearchTool).toBeUndefined();
  await model.generate({ messages: ["hi"] } as never);
  expect(seenB).toEqual([["hi", "pdf as file"]]);
});

// Preparing reads every file of the conversation: a retry of the same
// candidate reuses what it prepared.
it("prepares a candidate's call once, however often the call is retried", async () => {
  let prepared = 0;
  const counting = async (messages: unknown[]) => {
    prepared += 1;
    return messages;
  };
  const model = createFallbackModel({
    groupName: "g",
    retryPolicy: { maxAttemptsPerModel: 3, baseDelayMs: 0, maxDelayMs: 0 },
    models: [{ modelId: "acme/house", providerName: "acme", model: candidate([], true) }],
  });
  await expect(withPreparedMessages(model, counting).generate({ messages: ["hi"] } as never)).rejects.toThrow();
  expect(prepared).toBe(1);
});
