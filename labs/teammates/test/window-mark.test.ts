/**
 * The divider's place: before the first entry the worker read word for word.
 * A worker with a history summary reads from the turn after the summary's
 * mark, so a divider at the window's first turn would show turns as read that
 * were only summarized; one labelled summarized with no summary would promise
 * the worker remembers turns it dropped.
 */
import { describe, expect, it } from "vitest";
import { toEntries, windowMarkOf } from "../src/adapter";

const user = (requestId: string) => ({ id: `${requestId}_you`, requestId, type: "message", role: "user", content: [{ text: `you in ${requestId}` }] });
const answer = (requestId: string) => ({ id: `${requestId}_lead`, requestId, type: "message", role: "assistant", content: [{ text: `lead in ${requestId}` }] });
/** An item the conversation doesn't draw, first in its turn. */
const hidden = (requestId: string) => ({ id: `${requestId}_hidden`, requestId, type: "reasoning", content: [] });

const items = ["r1", "r2", "r3", "r4"].flatMap((r) => [hidden(r), user(r), answer(r)]);
const entries = toEntries(items, new Set());

describe("the history window's divider", () => {
  it("draws none while every turn is in the window", () => {
    expect(windowMarkOf(items, entries, {})).toBeUndefined();
  });

  it("sits before the window's first turn, out of view, when there is no summary", () => {
    expect(windowMarkOf(items, entries, { historyStart: "r3" })).toEqual({ firstVerbatimEntryId: "r3_you", summarized: false });
  });

  it("sits after the summary's mark, labelled summarized, when the summary reaches into the window", () => {
    // The window still holds r2, but r2 is in the summary, so the worker reads from r3.
    expect(windowMarkOf(items, entries, { historyStart: "r2", summarizedThrough: "r2" })).toEqual({ firstVerbatimEntryId: "r3_you", summarized: true });
  });

  it("is summarized before any turn has left the window, since the summary folds early", () => {
    expect(windowMarkOf(items, entries, { summarizedThrough: "r1" })).toEqual({ firstVerbatimEntryId: "r2_you", summarized: true });
  });

  it("sits before the first turn that started after the mark when turns overlap", () => {
    // r1 answers after r2 has begun: r2 is read word for word, so the divider can't sit after r1's answer.
    const overlapped = [user("r1"), user("r2"), answer("r2"), answer("r1"), user("r3"), answer("r3")];
    expect(windowMarkOf(overlapped, toEntries(overlapped, new Set()), { summarizedThrough: "r1" })).toEqual({ firstVerbatimEntryId: "r2_you", summarized: true });
  });

  it("calls turns out of view when the window starts past the summary's mark", () => {
    expect(windowMarkOf(items, entries, { historyStart: "r4", summarizedThrough: "r2" })).toEqual({ firstVerbatimEntryId: "r4_you", summarized: false });
  });
});
