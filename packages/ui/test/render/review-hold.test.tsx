// @vitest-environment happy-dom
/**
 * A coding run that committed waits for the user's review (harness-manager's
 * `reviewChanges`). The review takes exactly two answers,
 * `{ verdict: "accepted" }` and `{ verdict: "revise", words }`; anything else,
 * free text included, is refused with a 400 and the run waits on. So the card
 * must send only those, and every app that draws stops through
 * `SuspensionCard` must get this card for a review, not the free-text question
 * card its union resume schema would otherwise fall to.
 *
 * Renders registry source the way `tool-awaiting.test.tsx` does.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { OutputItem, SuspensionItem } from "@flow-state-dev/core/items";
import { SuspensionResolverProvider, type SuspensionResolver } from "@flow-state-dev/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewHold, shortBranch, takesReviewVerdict, NO_RESOLVER_UNANSWERABLE, type ReviewDetail } from "../../registry/components/review-hold";
import { SuspensionCard } from "../../registry/components/suspension-card";
import { SessionItemsProvider } from "../../registry/components/session-items-context";

afterEach(cleanup);

/** A coding run's review, as harness-manager's browser reader hands it over. */
const DATA: ReviewDetail = {
  branch: "conductor/t0/ha62f1-h01/t-7f3c--change",
  commits: 4,
  subjects: ["Add the v2 endpoint", "Test the v2 endpoint", "Drop the v1 handler", "Update the README"],
  judge: { verdict: "done", confidence: 0.914, reason: "The endpoint exists and its test passes." },
};

describe("the review card draws a coding run's review", () => {
  it("shows the commits on the branch, three subjects and a count of the rest, and the judge", () => {
    render(<ReviewHold review={DATA} />);
    expect(screen.getByText("Ready for review")).toBeTruthy();
    expect(screen.getByText("4 commits")).toBeTruthy();
    expect(screen.getByText("…/t-7f3c--change").getAttribute("title")).toBe(DATA.branch);
    expect(screen.getByText("· Add the v2 endpoint")).toBeTruthy();
    expect(screen.queryByText("· Update the README")).toBeNull();
    expect(screen.getByText("· and 1 more")).toBeTruthy();
    expect(screen.getByText("Judge: done, 0.91")).toBeTruthy();
    expect(screen.getByText(DATA.judge!.reason)).toBeTruthy();
  });

  it("says so when git couldn't count the commits, and when no judge read the run", () => {
    render(<ReviewHold review={{ branch: "b", commits: null, subjects: [], judge: null }} />);
    expect(screen.getByText("Commits couldn't be read")).toBeTruthy();
    expect(screen.getByText("No judge read this run")).toBeTruthy();
  });

  it("a review that isn't a coding run's shows its prompt, the work under review", () => {
    render(<ReviewHold prompt={"Here is the PM role draft:\n\n# PM"} answer={async () => {}} />);
    expect(screen.getByText(/Here is the PM role draft/)).toBeTruthy();
    expect(screen.queryByText("Commits couldn't be read")).toBeNull();
    expect(screen.queryByText("No judge read this run")).toBeNull();
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
  });

  it("keeps a long branch segment's start and end", () => {
    expect(shortBranch("a/fix-2380-review-hold-in-teammates-popup")).toBe("…/fix-2380-r…ammates-popup");
    expect(shortBranch("main")).toBe("main");
  });
});

describe("the review card sends only the two answers a review takes", () => {
  it("Accept sends { verdict: accepted } and collapses to a receipt", async () => {
    const answer = vi.fn(async () => {});
    render(<ReviewHold review={DATA} answer={answer} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(screen.getByText("Accepted")).toBeTruthy());
    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenCalledWith({ verdict: "accepted" });
  });

  it("Ask for changes needs words, and sends them trimmed", async () => {
    const answer = vi.fn(async () => {});
    render(<ReviewHold review={DATA} answer={answer} />);
    const ask = screen.getByRole("button", { name: "Ask for changes" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("What to change"), { target: { value: "   " } });
    expect(ask.disabled).toBe(true);
    fireEvent.click(ask);
    expect(answer).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("What to change"), { target: { value: "  Keep v1 as a fallback. " } });
    fireEvent.click(ask);
    await waitFor(() => expect(screen.getByText("Changes asked for")).toBeTruthy());
    expect(answer).toHaveBeenCalledWith({ verdict: "revise", words: "Keep v1 as a fallback." });
  });

  it("a failed answer says why and keeps the words", async () => {
    const answer = vi.fn(async () => {
      throw new Error("The review is already answered.");
    });
    render(<ReviewHold review={DATA} answer={answer} />);
    fireEvent.change(screen.getByLabelText("What to change"), { target: { value: "More tests" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask for changes" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The review is already answered."));
    expect((screen.getByLabelText("What to change") as HTMLTextAreaElement).value).toBe("More tests");
  });

  it("an unanswerable review shows why and offers no buttons", () => {
    render(<ReviewHold review={DATA} answer={async () => {}} unanswerable="Its session names no flow." />);
    expect(screen.getByText("Its session names no flow.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("leaves room for an app's diff between the commits and the judge", () => {
    render(
      <ReviewHold review={DATA}>
        <div data-testid="diff">diff</div>
      </ReviewHold>,
    );
    expect(screen.getByTestId("diff")).toBeTruthy();
  });
});

/** harness-manager's `harnessReviewAnswerSchema` as the engine stores it (zod-to-json-schema). */
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

/** A review stop as the engine records it: `user_input`, submit allowed. */
const reviewItem = (kind: string | undefined, resumeSchema: unknown = VERDICT_SCHEMA): SuspensionItem =>
  ({
    id: "s1",
    type: "suspension",
    status: "completed",
    requestId: "req-1",
    suspensionId: "susp-1",
    reason: "user_input",
    ...(kind === undefined ? {} : { kind }),
    message: "Review the run's changes",
    allow: ["submit"],
    resumeSchema,
    data: DATA,
  }) as unknown as SuspensionItem;

describe("SuspensionCard draws a review stop with the review card", () => {
  it("answers through the app's resolver with submit and the verdict as data", async () => {
    const resolve = vi.fn<SuspensionResolver>(async () => {});
    render(
      <SuspensionResolverProvider resolve={resolve}>
        <SuspensionCard item={reviewItem("review")} />
      </SuspensionResolverProvider>,
    );
    expect(screen.getByText("Ready for review")).toBeTruthy();
    expect(screen.getByText("Review the run's changes")).toBeTruthy();
    // The stop's data is left to harness-manager's reader in the app: the card reads none of it.
    expect(screen.queryByText("4 commits")).toBeNull();
    expect(screen.queryByText("Judge: done, 0.91")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    expect(resolve).toHaveBeenCalledWith({ suspensionId: "susp-1", requestId: "req-1", action: "submit", data: { verdict: "accepted" } });
  });

  it("a review that ended unanswered says how it ended, not that it was reviewed", () => {
    const endedAs = (resolution: string) =>
      render(
        <SessionItemsProvider value={[{ type: "suspension_resume", suspensionId: "susp-1", resolution } as unknown as OutputItem]}>
          <SuspensionCard item={reviewItem("review")} />
        </SessionItemsProvider>,
      );
    endedAs("expired");
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.queryByText("Reviewed")).toBeNull();
    cleanup();
    endedAs("submitted");
    expect(screen.getByText("Reviewed")).toBeTruthy();
  });

  it("with no resolver it shows the review and says it can't be answered here", () => {
    render(<SuspensionCard item={reviewItem("review")} />);
    expect(screen.getByText("Ready for review")).toBeTruthy();
    expect(screen.getByText(NO_RESOLVER_UNANSWERABLE)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("control: the same stop without kind review falls to a free-text card, which a review refuses", () => {
    render(<SuspensionCard item={reviewItem(undefined)} />);
    expect(screen.queryByText("Ready for review")).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("a review whose answer isn't the verdict keeps the shape dispatch", () => {
    render(<SuspensionCard item={reviewItem("review", { type: "string" })} />);
    expect(screen.queryByText("Ready for review")).toBeNull();
  });

  it("reads the verdict from the schema, not from the kind alone", () => {
    expect(takesReviewVerdict(VERDICT_SCHEMA)).toBe(true);
    expect(takesReviewVerdict({ anyOf: [VERDICT_SCHEMA.anyOf[0]] })).toBe(false);
    expect(takesReviewVerdict(undefined)).toBe(false);
  });
});
