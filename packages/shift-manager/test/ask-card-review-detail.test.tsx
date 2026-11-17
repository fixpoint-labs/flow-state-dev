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

  // FIX-2782: "What am I reviewing here?" The card said a branch, two subjects and a clamped judge line.
  it("says what was asked, the run's summary, the pull request, each changed file and the judge's whole reason", () => {
    const reason = "Both review comments are addressed: the button moved left of the composer and the test covers it. ".repeat(3).trim();
    render(
      <AskCard
        ask={reviewAsk({
          branch: "conductor/move-file-icon",
          commits: 1,
          subjects: ["Move the attach button"],
          judge: { verdict: "done", confidence: 0.64, reason },
          goal: "Address the review feedback on Move the attach-files + button",
          answer: "Moved the button and replied to both comments.\n\n- Replied: https://github.com/acme/app/pull/7#discussion_r1",
          pullRequests: [{ url: "https://github.com/acme/app/pull/7", number: 7 }],
          files: [
            { path: "src/composer.tsx", added: 4, removed: 2 },
            { path: "test/composer.test.tsx", added: 9, removed: 0 },
          ],
          fileCount: 2,
          added: 13,
          removed: 2,
        })}
      />,
    );
    expect(screen.getByText(/Address the review feedback on Move the attach-files/)).toBeTruthy();
    expect(screen.getByText(/Moved the button and replied to both comments/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /#7/ }).getAttribute("href")).toBe("https://github.com/acme/app/pull/7");
    expect(screen.getByText("src/composer.tsx")).toBeTruthy();
    expect(screen.getByText("test/composer.test.tsx")).toBeTruthy();
    expect(screen.getByText(/2 files changed/)).toBeTruthy();
    // The whole reason, not a clamped line.
    const judged = screen.getByText(reason);
    expect(judged.className).not.toMatch(/line-clamp/);
  });

  it("control: a stop with no review data names neither", () => {
    render(<AskCard ask={reviewAsk(undefined)} />);
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(screen.queryByText(/commit/)).toBeNull();
    expect(screen.queryByText(/Judge:/)).toBeNull();
  });
});
