// @vitest-environment happy-dom
/**
 * A coding run's review in Inbox names what the run committed and what the
 * judge said, so the user can decide without opening the branch. Inbox reads
 * that from the stop's data with harness-manager's browser reader; drawn
 * through the generic suspension route the card gets no detail and says
 * neither.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

// FIX-2782: "What am I reviewing here?" The card showed a branch, two subjects and a judge line. It now carries
// what was asked, the run's own summary, this round's commits, where the pull request is and the files it changed.
describe("Inbox's review gives the user what to decide on", () => {
  const PR_URL = "https://github.com/acme/widgets/pull/5349";
  const data = {
    branch: "eng/attach-files-left",
    commits: 2,
    subjects: ["Address review: keep the button's label", "Move the attach-files button left"],
    judge: { verdict: "done", confidence: 0.64, reason: "The button moved.\nThe label stays, as the reviewer asked." },
    goal: "Address the review feedback on **Move the attach-files button**",
    answer: "Kept the button's label and moved it left.\n\nReplied to [the label comment](https://github.com/acme/widgets/pull/5349#discussion_r1).",
    pullRequests: [{ number: 5349, url: PR_URL }],
    round: { commits: 1, subjects: ["Address review: keep the button's label"] },
    files: [
      { path: "src/composer.tsx", added: 4, removed: 2 },
      { path: "assets/icon.png", added: null, removed: null },
    ],
    fileCount: 2,
    added: 4,
    removed: 2,
  };

  it("shows the goal, the run's summary, this round's commits apart from the branch's, the pull request and the files", () => {
    render(<AskCard ask={reviewAsk(data)} />);
    // What was asked and what the run says it did, as Markdown.
    expect(screen.getByText(/Address the review feedback on/)).toBeTruthy();
    // Streamdown draws bold as a marked span, not `<strong>`: no literal `**` is left.
    expect(screen.getByText("Move the attach-files button").getAttribute("data-streamdown")).toBe("strong");
    expect(screen.getByText(/Kept the button's label and moved it left/)).toBeTruthy();
    // The review comment it replied to stays a link (Streamdown draws one as a button that opens it).
    expect(screen.getByText("the label comment").getAttribute("data-streamdown")).toBe("link");
    // This round's one commit, and the one already on the branch, apart.
    expect(screen.getByText(/1 commit this round/)).toBeTruthy();
    expect(screen.getByText(/1 earlier on the branch/)).toBeTruthy();
    // Where to look: the pull request, and each file with its lines.
    expect(screen.getByRole("link", { name: /#5349/ }).getAttribute("href")).toBe(PR_URL);
    // The files fold under their totals, so a long list doesn't push the answer buttons out of an Inbox list.
    fireEvent.click(screen.getByRole("button", { name: /2 files changed/ }));
    expect(screen.getByText("src/composer.tsx")).toBeTruthy();
    expect(screen.getByText("assets/icon.png")).toBeTruthy();
    // The judge's whole reason, not three clamped lines.
    const reason = screen.getByText(/The label stays, as the reviewer asked/);
    expect(reason.closest("[data-review-judge]")?.querySelector(".line-clamp-3")).toBeNull();
  });
});
