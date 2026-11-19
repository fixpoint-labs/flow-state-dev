/**
 * What your answer to a coding task's hold sends, as the Inbox client takes
 * it. Where it goes is the hold's own: the coding board view reads each row's
 * holds with orchestration's Inbox (`asks`, routed to the board's `updateTask`
 * for a question, to the run's stop for a review), and `popup-holds.test.tsx`
 * answers both through the popup. Sent wrong, an accept loses the note a
 * failed landing hands back to the coding session.
 */
import { describe, expect, it } from "vitest";
import { inboxAnswerOf } from "../src/lib/task";

describe("an answer, as the Inbox client takes it", () => {
  it("sends a question's words as text", () => {
    expect(inboxAnswerOf({ text: "Only line 1." })).toEqual({ text: "Only line 1." });
  });

  it("sends Ask for changes with its words", () => {
    expect(inboxAnswerOf({ verdict: "revise", words: "Keep the old wording." })).toEqual({ value: { verdict: "revise", words: "Keep the old wording." } });
  });
});

describe("an accept carries its note to the run", () => {
  it("keeps the words and the landing on an accept", () => {
    expect(inboxAnswerOf({ verdict: "accepted", land: "pull-request", words: "Keep trying until it's pushed." })).toEqual({
      value: { verdict: "accepted", land: "pull-request", words: "Keep trying until it's pushed." },
    });
  });

  it("sends a bare accept as before", () => {
    expect(inboxAnswerOf({ verdict: "accepted" })).toEqual({ value: { verdict: "accepted" } });
  });
});
