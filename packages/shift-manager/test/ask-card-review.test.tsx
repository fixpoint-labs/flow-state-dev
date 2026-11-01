// @vitest-environment happy-dom
/**
 * A coding run's review in Inbox. Shift Manager's profiles turn
 * harness-manager's `reviewChanges` on, so a run that committed waits there
 * for the user, and the review takes only `{ verdict: "accepted" }` or
 * `{ verdict: "revise", words }`: anything else is refused and the task waits
 * on. So the ask card must draw a review with the registry's review card and
 * send exactly that through the Lab's answer route, never the free-text
 * question card its union answer schema would otherwise fall to.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SuspensionItem } from "@flow-state-dev/core/items";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Ask } from "../src/lib/reads";

const answer = vi.fn(async () => {});
vi.mock("../src/lib/lab-data", () => ({ useLab: () => ({ answer }) }));
const { AskCard } = await import("../src/components/AskCard");

afterEach(() => {
  cleanup();
  answer.mockClear();
});

/** harness-manager's `harnessReviewAnswerSchema`, as the engine stores it. */
const VERDICT_SCHEMA = {
  anyOf: [
    { type: "object", properties: { verdict: { type: "string", const: "accepted" } }, required: ["verdict"], additionalProperties: false },
    {
      type: "object",
      properties: { verdict: { type: "string", const: "revise" }, words: { type: "string", pattern: "\\S" } },
      required: ["verdict", "words"],
      additionalProperties: false,
    },
  ],
};

/** A coder's review ask, as Inbox reads it from the run's session. */
const reviewAsk = (marked: boolean): Ask => ({
  sessionId: "sess-run",
  workerId: "eng.coder",
  flowId: "devforce-coder",
  parentSessionId: null,
  kind: "review",
  since: 0,
  unanswerable: null,
  item: {
    id: "s1",
    type: "suspension",
    status: "completed",
    requestId: "req-1",
    suspensionId: "susp-1",
    reason: "user_input",
    ...(marked ? { kind: "review" } : {}),
    message: "Review the run's changes",
    allow: ["submit"],
    resumeSchema: VERDICT_SCHEMA,
    data: { branch: "b", commits: 1, subjects: ["Add the line"], judge: null },
  } as unknown as SuspensionItem,
});

describe("Inbox draws a coding run's review with the review card", () => {
  it("Accept answers the ask with submit and { verdict: accepted }", async () => {
    render(<AskCard ask={reviewAsk(true)} />);
    expect(screen.getByText("Ready for review")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(answer).toHaveBeenCalledTimes(1));
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ item: expect.objectContaining({ suspensionId: "susp-1" }) }), {
      action: "submit",
      data: { verdict: "accepted" },
    });
  });

  it("Ask for changes sends the words as a revision", async () => {
    render(<AskCard ask={reviewAsk(true)} titled />);
    fireEvent.change(screen.getByLabelText("What to change"), { target: { value: " Keep the old line. " } });
    fireEvent.click(screen.getByRole("button", { name: "Ask for changes" }));
    await waitFor(() => expect(answer).toHaveBeenCalledTimes(1));
    expect(answer).toHaveBeenCalledWith(expect.anything(), { action: "submit", data: { verdict: "revise", words: "Keep the old line." } });
  });

  it("control: the same stop, not marked as a review, draws no review card", () => {
    render(<AskCard ask={reviewAsk(false)} />);
    expect(screen.queryByText("Ready for review")).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });
});
