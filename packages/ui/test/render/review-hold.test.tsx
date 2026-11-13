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
import { LandedOutcome, LandFailure, orderedLands, ReviewHold, shortBranch, takesReviewVerdict, NO_RESOLVER_UNANSWERABLE, type ReviewDetail } from "../../registry/components/review-hold";
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
    expect(screen.getByTitle("Add the v2 endpoint").textContent).toBe("·Add the v2 endpoint");
    expect(screen.queryByTitle("Update the README")).toBeNull();
    expect(screen.getByText("· and 1 more")).toBeTruthy();
    expect(screen.getByText("Judge: done, 0.91")).toBeTruthy();
    expect(screen.getByText(DATA.judge!.reason)).toBeTruthy();
  });

  it("shows the project's checks, a red one open with its output, so the reviewer sees the code doesn't build before accepting", () => {
    const checks = [
      { command: "pnpm typecheck", exitCode: 0, timedOut: false, skipped: false, durationMs: 1200, tail: "" },
      { command: "pnpm test", exitCode: 1, timedOut: false, skipped: false, durationMs: 900, tail: "CHECK-MARKER: 1 failed" },
    ];
    render(<ReviewHold review={{ ...DATA, checks }} answer={async () => {}} />);
    expect(screen.getByText("Checks 1/2 passed")).toBeTruthy();
    expect(screen.getByText(/CHECK-MARKER: 1 failed/)).toBeTruthy();
    // Information, not a gate: the reviewer can still accept.
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
  });

  it("draws no checks line when none ran, rather than claiming 0/0", () => {
    render(<ReviewHold review={{ ...DATA, checks: null }} />);
    expect(screen.queryByText(/^Checks /)).toBeNull();
    render(<ReviewHold review={DATA} />);
    expect(screen.queryByText(/^Checks /)).toBeNull();
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

describe("a review whose host can land the work offers two labelled accepts", () => {
  it("Open a PR and Merge locally each send an accept naming its land, and there is no bare Accept", async () => {
    const answer = vi.fn(async () => {});
    render(<ReviewHold review={{ ...DATA, lands: ["pull-request", "merge"] }} answer={answer} />);
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.getByRole("button", { name: "Accept: Merge locally" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept: Open a PR" }));
    await waitFor(() => expect(screen.getByText("Accepted")).toBeTruthy());
    expect(answer).toHaveBeenCalledWith({ verdict: "accepted", land: "pull-request" });
  });

  it("a landing that failed shows its error and a Retry of the same way first, with the other way still offered", async () => {
    const answer = vi.fn(async () => {});
    const landFailed = { land: "merge" as const, message: "Merging conflicts in README.md, so it was stopped." };
    render(<ReviewHold review={{ ...DATA, lands: ["pull-request", "merge"], landFailed }} answer={answer} />);
    expect(screen.getByRole("alert").textContent).toBe(`Merging locally failed: ${landFailed.message}`);
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons.slice(0, 2)).toEqual(["Retry: Merge locally", "Accept: Open a PR"]);
    fireEvent.click(screen.getByRole("button", { name: "Retry: Merge locally" }));
    await waitFor(() => expect(answer).toHaveBeenCalledWith({ verdict: "accepted", land: "merge" }));
  });

  // FIX-2658: "Keep trying until the PR is pushed" was typed into the box and
  // Retry sent only the verdict, so the words reached nothing.
  it("a Retry carries what is in the text box, for the coding session if the landing fails again", async () => {
    const answer = vi.fn(async () => {});
    const landFailed = { land: "pull-request" as const, message: "GH005: refs longer than 255 bytes." };
    render(<ReviewHold review={{ ...DATA, lands: ["pull-request", "merge"], landFailed }} answer={answer} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Keep trying until the PR is pushed. " } });
    fireEvent.click(screen.getByRole("button", { name: "Retry: Open a PR" }));
    await waitFor(() =>
      expect(answer).toHaveBeenCalledWith({ verdict: "accepted", land: "pull-request", words: "Keep trying until the PR is pushed." }),
    );
  });

  it("lists each try of a landing that failed more than once", () => {
    const tries = [
      { land: "pull-request" as const, message: "GH005: refs longer than 255 bytes." },
      { land: "pull-request" as const, message: "remote: permission denied." },
    ];
    render(<ReviewHold review={{ ...DATA, lands: ["pull-request"], landFailed: tries[1], landAttempts: tries }} answer={vi.fn(async () => {})} />);
    const listed = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(listed).toContain(`Try 1: ${tries[0]!.message}`);
    expect(listed).toContain(`Try 2: ${tries[1]!.message}`);
  });

  it("a retry that fails with the same words is a new ask: Retry comes back, not the receipt of the last one", async () => {
    const answer = vi.fn(async () => {});
    const landFailed = { land: "merge" as const, message: "Merging conflicts in README.md, so it was stopped." };
    const review = { ...DATA, lands: ["pull-request", "merge"] as const, landFailed };
    const { rerender } = render(<ReviewHold review={{ ...review, lands: [...review.lands] }} holdId="susp-2" answer={answer} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry: Merge locally" }));
    await waitFor(() => expect(screen.getByText("Accepted")).toBeTruthy());
    // The same card, asked again with the same failure, under a new stop.
    rerender(<ReviewHold review={{ ...review, lands: [...review.lands] }} holdId="susp-3" answer={answer} />);
    expect(screen.getByRole("button", { name: "Retry: Merge locally" })).toBeTruthy();
    expect(screen.queryByText("Accepted")).toBeNull();
  });

  // A host that offers the accepts outside the card (a thread's own accept)
  // orders them with the same helper, so a retry is first in both places.
  it("orders the ways to land with a failed landing's way first, each way once, and keeps the review's order otherwise", () => {
    const lands = ["pull-request", "merge"] as const;
    expect(orderedLands(lands, null)).toEqual(["pull-request", "merge"]);
    expect(orderedLands(lands, { land: "merge" })).toEqual(["merge", "pull-request"]);
    expect(orderedLands(lands, { land: "pull-request" })).toEqual(["pull-request", "merge"]);
    // A copy, so a caller sorting the result never reorders the review's own list.
    expect(orderedLands(lands, null)).not.toBe(lands);
  });

  it("the failure line says which landing failed in its own words, and draws nothing when none did", () => {
    const { container } = render(<LandFailure failed={null} />);
    expect(container.textContent).toBe("");
    render(<LandFailure failed={{ land: "pull-request", message: "GH005: refs longer than 255 bytes." }} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Opening the PR failed: GH005: refs longer than 255 bytes.");
    expect(alert.getAttribute("data-land-failed")).toBe("pull-request");
  });

  it("the done state says where the work went and what comes next", () => {
    render(<LandedOutcome landed={{ kind: "pull-request", url: "https://github.com/acme/relay/pull/7", number: 7, branch: "b", base: "main" }} />);
    expect(screen.getByRole("link", { name: "pull request #7" }).getAttribute("href")).toBe("https://github.com/acme/relay/pull/7");
    expect(screen.getByText(/Next: review and merge it\./)).toBeTruthy();
    cleanup();
    render(<LandedOutcome landed={{ kind: "merge", branch: "main", commit: "c15d6f098abc0123", checkout: "/work/relay", from: "b" }} />);
    expect(screen.getByText("c15d6f098abc")).toBeTruthy();
    expect(screen.getByText("/work/relay")).toBeTruthy();
    expect(screen.getByText(/Next: push main when you're ready\./)).toBeTruthy();
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
