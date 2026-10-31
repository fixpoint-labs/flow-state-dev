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
import type { SuspensionItem } from "@flow-state-dev/core/items";
import { SuspensionResolverProvider, type SuspensionResolver } from "@flow-state-dev/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewHold, reviewDetailOf, shortBranch, NO_RESOLVER_UNANSWERABLE } from "../../registry/components/review-hold";
import { SuspensionCard } from "../../registry/components/suspension-card";

afterEach(cleanup);

/** A review stop's data, as harness-manager writes it. */
const DATA = {
  branch: "conductor/t0/ha62f1-h01/t-7f3c--change",
  commits: 4,
  subjects: ["Add the v2 endpoint", "Test the v2 endpoint", "Drop the v1 handler", "Update the README"],
  judge: { verdict: "done", confidence: 0.914, reason: "The endpoint exists and its test passes." },
};

describe("the review card reads the stop's data", () => {
  it("shows the commits on the branch, three subjects and a count of the rest, and the judge", () => {
    render(<ReviewHold data={DATA} />);
    expect(screen.getByText("Ready for review")).toBeTruthy();
    expect(screen.getByText("4 commits")).toBeTruthy();
    expect(screen.getByText("…/t-7f3c--change").getAttribute("title")).toBe(DATA.branch);
    expect(screen.getByText("· Add the v2 endpoint")).toBeTruthy();
    expect(screen.queryByText("· Update the README")).toBeNull();
    expect(screen.getByText("· and 1 more")).toBeTruthy();
    expect(screen.getByText("Judge: done, 0.91")).toBeTruthy();
    expect(screen.getByText(DATA.judge.reason)).toBeTruthy();
  });

  it("says so when git couldn't count the commits, and when no judge read the run", () => {
    render(<ReviewHold data={{ branch: "b", commits: null, subjects: [], judge: null }} />);
    expect(screen.getByText("Commits couldn't be read")).toBeTruthy();
    expect(screen.getByText("No judge read this run")).toBeTruthy();
  });

  it("reads data of the wrong shape as unknown, never a throw", () => {
    expect(reviewDetailOf(undefined)).toEqual({ branch: null, commits: null, subjects: [], judge: null });
    expect(reviewDetailOf({ branch: 3, commits: "4", subjects: ["a", 1], judge: { verdict: "done" } })).toEqual({
      branch: null,
      commits: null,
      subjects: ["a"],
      judge: null,
    });
  });

  it("keeps a long branch segment's start and end", () => {
    expect(shortBranch("a/fix-2380-review-hold-in-teammates-popup")).toBe("…/fix-2380-r…ammates-popup");
    expect(shortBranch("main")).toBe("main");
  });
});

describe("the review card sends only the two answers a review takes", () => {
  it("Accept sends { verdict: accepted } and collapses to a receipt", async () => {
    const answer = vi.fn(async () => {});
    render(<ReviewHold data={DATA} answer={answer} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(screen.getByText("Accepted")).toBeTruthy());
    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenCalledWith({ verdict: "accepted" });
  });

  it("Ask for changes needs words, and sends them trimmed", async () => {
    const answer = vi.fn(async () => {});
    render(<ReviewHold data={DATA} answer={answer} />);
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
    render(<ReviewHold data={DATA} answer={answer} />);
    fireEvent.change(screen.getByLabelText("What to change"), { target: { value: "More tests" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask for changes" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The review is already answered."));
    expect((screen.getByLabelText("What to change") as HTMLTextAreaElement).value).toBe("More tests");
  });

  it("an unanswerable review shows why and offers no buttons", () => {
    render(<ReviewHold data={DATA} answer={async () => {}} unanswerable="Its session names no flow." />);
    expect(screen.getByText("Its session names no flow.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("leaves room for an app's diff between the commits and the judge", () => {
    render(
      <ReviewHold data={DATA}>
        <div data-testid="diff">diff</div>
      </ReviewHold>,
    );
    expect(screen.getByTestId("diff")).toBeTruthy();
  });
});

/** A review stop as the engine records it: `user_input`, submit allowed, harness-manager's union schema. */
const reviewItem = (kind: string | undefined): SuspensionItem =>
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
    resumeSchema: {
      anyOf: [
        { type: "object", properties: { verdict: { const: "accepted" } }, required: ["verdict"] },
        { type: "object", properties: { verdict: { const: "revise" }, words: { type: "string" } }, required: ["verdict", "words"] },
      ],
    },
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
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    expect(resolve).toHaveBeenCalledWith({ suspensionId: "susp-1", requestId: "req-1", action: "submit", data: { verdict: "accepted" } });
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
});
