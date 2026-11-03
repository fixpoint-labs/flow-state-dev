// @vitest-environment happy-dom
/**
 * A coding run's review in Inbox names what the run committed and what the
 * judge said, so the user can decide without opening the branch. Inbox reads
 * that from the stop's data with harness-manager's browser reader; drawn
 * through the generic suspension route the card gets no detail and says
 * neither.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { SuspensionItem } from "@flow-state-dev/core/items";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Ask } from "../src/lib/reads";

vi.mock("../src/lib/lab-data", () => ({ useLab: () => ({ answer: async () => {} }) }));
const { AskCard } = await import("../src/components/AskCard");

afterEach(cleanup);

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

const reviewAsk = (data: unknown): Ask => ({
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
    kind: "review",
    message: "Review the run's changes",
    allow: ["submit"],
    resumeSchema: VERDICT_SCHEMA,
    data,
  } as unknown as SuspensionItem,
});

describe("Inbox's review names the run's commits and the judge's verdict", () => {
  it("reads them from the stop's data", () => {
    render(
      <AskCard
        ask={reviewAsk({
          branch: "fix-1/implement",
          commits: 2,
          subjects: ["Add the line", "Add the test"],
          judge: { verdict: "done", confidence: 0.82, reason: "" },
        })}
      />,
    );
    expect(screen.getByText(/2 commits/)).toBeTruthy();
    expect(screen.getByText(/Add the test/)).toBeTruthy();
    expect(screen.getByText(/Judge: done, 0\.82/)).toBeTruthy();
  });

  it("control: a stop with no review data names neither", () => {
    render(<AskCard ask={reviewAsk(undefined)} />);
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(screen.queryByText(/commit/)).toBeNull();
    expect(screen.queryByText(/Judge:/)).toBeNull();
  });
});
