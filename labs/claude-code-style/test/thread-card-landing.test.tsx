// @vitest-environment happy-dom
/**
 * A thread card's accept, on a stand-in server whose run session holds one review stop. The review's `lands` decide
 * what the accept offers; the card never offers a way its review doesn't list, never reads a failed
 * landing as accepted, and sends the way you chose.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodingBoardTask, ReviewDetail } from "../src/app";
import { codingBoardTask } from "./coding-board-task";
import { ThreadCard } from "../src/components/ThreadCard";
import { RUN, reviewStop, stubServer, underReview, verdictOf, type Posted } from "./stub-server";

afterEach(cleanup);

const REVIEW: ReviewDetail = {
  branch: "conductor/t0/ha62-h01/t-7f3c--code",
  commits: 1,
  subjects: ["docs: note the vendor pick"],
  judge: null,
  checks: null,
  lands: ["pull-request", "merge"],
};

const codingTask = (patch: Partial<CodingBoardTask> = {}): CodingBoardTask =>
  codingBoardTask({
    ...underReview(codingBoardTask({ id: "t-1", title: "Add a CHANGELOG line", goal: "Add a line", harness: "claude-code" })),
    ...patch,
    state: patch.state,
  });

/**
 * A run session holding `review` as its review stop (none: no stop yet), and the review answers
 * the accept sent, by the land each named. `answer` answers each POST. `emit` stores a new stop.
 */
function stubRun(review: ReviewDetail | undefined, answer?: (posted: Posted) => Promise<void> | void) {
  const server = stubServer({ items: { [RUN.sessionId]: review === undefined ? [] : [reviewStop("stop-1", review)] }, ...(answer === undefined ? {} : { answer }) });
  const accepted = () => server.posts.flatMap((posted) => {
    const verdict = verdictOf(posted);
    return verdict?.verdict === "accepted" ? [verdict.land] : [];
  });
  const emit = (next: ReviewDetail, stop: string) => server.push(RUN.sessionId, reviewStop(stop, next));
  return { server, accepted, emit };
}

/** Draws `task`'s card, its board holding `task` as drawn; `rerender` draws `next`, and the board holds it from then. */
function renderCard(task: CodingBoardTask, run: ReturnType<typeof stubRun>, onOpen = vi.fn()) {
  run.server.board["s-1"] = [task];
  const { rerender } = render(run.server.wrap(<ThreadCard sessionId="s-1" task={task} onOpen={onOpen} />));
  return {
    onOpen,
    rerender: (next: CodingBoardTask) => {
      run.server.board["s-1"] = [next];
      rerender(run.server.wrap(<ThreadCard sessionId="s-1" task={next} onOpen={onOpen} />));
    },
  };
}

const card = () => screen.getByRole("region", { name: "Task: Add a CHANGELOG line" });

describe("a thread card's accept", () => {
  it("offers only the landings its review lists, and sends the one chosen with the accept", async () => {
    const run = stubRun(REVIEW);
    renderCard(codingTask(), run);
    await waitFor(() => expect(within(card()).getByRole("button", { name: "Open a PR" })).toBeTruthy());
    expect(within(card()).getByRole("button", { name: "Merge locally" })).toBeTruthy();
    expect(within(card()).queryByRole("button", { name: "Resolve" })).toBeNull();
    fireEvent.click(within(card()).getByRole("button", { name: "Merge locally" }));
    await waitFor(() => expect(run.accepted()).toEqual(["merge"]));
  });

  it("offers no way its review doesn't list: a review that lists one landing shows only that one", async () => {
    renderCard(codingTask(), stubRun({ ...REVIEW, lands: ["pull-request"] }));
    await waitFor(() => expect(within(card()).getByRole("button", { name: "Open a PR" })).toBeTruthy());
    expect(within(card()).queryByRole("button", { name: "Merge locally" })).toBeNull();
  });

  it("is a plain Resolve when the review lists no landing, sending no land", async () => {
    const run = stubRun({ ...REVIEW, lands: [] });
    renderCard(codingTask(), run);
    const resolveButton = await waitFor(() => within(card()).getByRole("button", { name: "Resolve" }));
    fireEvent.click(resolveButton);
    await waitFor(() => expect(run.accepted()).toEqual([undefined]));
  });

  it("offers no accept for a coding review until the review is read, so a plain accept can't go before its lands are known", async () => {
    renderCard(codingTask(), stubRun(undefined));
    expect((within(card()).getByRole("button", { name: "Resolve" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows why a landing failed, offers its retry, and never reads as accepted", async () => {
    renderCard(
      codingTask(),
      stubRun({
        ...REVIEW,
        landFailed: { land: "pull-request", message: "gh: permission denied to push" },
        landAttempts: [{ land: "pull-request", message: "gh: permission denied to push" }],
      }),
    );
    const alert = await waitFor(() => within(card()).getByRole("alert"));
    expect(alert.textContent).toBe("Opening the PR failed: gh: permission denied to push");
    expect(within(card()).getByRole("button", { name: "Retry: Open a PR" })).toBeTruthy();
    expect(within(card()).getByRole("button", { name: "Merge locally" })).toBeTruthy();
    expect(card().textContent).not.toMatch(/accepted/i);
  });

  it("retries the same landing that failed, sending its land again", async () => {
    const run = stubRun({
      ...REVIEW,
      landFailed: { land: "merge", message: "checkout is dirty" },
      landAttempts: [{ land: "merge", message: "checkout is dirty" }],
    });
    renderCard(codingTask(), run);
    fireEvent.click(await waitFor(() => within(card()).getByRole("button", { name: "Retry: Merge locally" })));
    await waitFor(() => expect(run.accepted()).toEqual(["merge"]));
  });

  it("reads as landing, not accepted, while the accept is on its way, and says why when it is refused", async () => {
    let refuse!: (error: Error) => void;
    const run = stubRun(REVIEW, (posted) => (verdictOf(posted) === undefined ? undefined : new Promise<void>((_, reject) => (refuse = reject))));
    renderCard(codingTask(), run);
    fireEvent.click(await waitFor(() => within(card()).getByRole("button", { name: "Open a PR" })));
    await waitFor(() => expect(within(card()).getAllByRole("button", { name: "Landing…" })).toHaveLength(2));
    expect(card().textContent).not.toMatch(/accepted/i);
    refuse(new Error("The thread isn't waiting on your review."));
    await waitFor(() => expect(within(card()).getByRole("alert").textContent).toBe("Couldn't resolve: The thread isn't waiting on your review."));
  });

  it("a retry that fails with the same message is a new round, so its buttons come back", async () => {
    const failure = { land: "pull-request" as const, message: "no push remote" };
    const run = stubRun({ ...REVIEW, landFailed: failure, landAttempts: [failure] });
    const { rerender } = renderCard(codingTask(), run);
    fireEvent.click(await waitFor(() => within(card()).getByRole("button", { name: "Retry: Open a PR" })));
    await waitFor(() => expect(run.accepted()).toEqual(["pull-request"]));
    // The answered stop stays the latest until the run stops for review again: the accept stays down.
    expect(within(card()).getAllByRole("button", { name: "Landing…" })).toHaveLength(2);
    // The run tried again, failed with the same words, and stopped for review under a new round:
    // the board's row holds the new stop too.
    await act(async () => run.emit({ ...REVIEW, landFailed: failure, landAttempts: [failure] }, "stop-2"));
    rerender(underReview(codingTask(), "stop-2"));
    await waitFor(() => expect(within(card()).getByRole("button", { name: "Retry: Open a PR" })).toBeTruthy());
    expect(within(card()).queryByRole("button", { name: "Landing…" })).toBeNull();
    // The second retry answers the new round's stop, not the one already answered.
    fireEvent.click(within(card()).getByRole("button", { name: "Retry: Open a PR" }));
    await waitFor(() => expect(run.accepted()).toEqual(["pull-request", "pull-request"]));
    const answered = run.server.posts.filter((posted) => verdictOf(posted) !== undefined).map((posted) => posted.body.suspensionId);
    expect(answered).toEqual(["stop-1", "stop-2"]);
  });

  it("keeps Request changes: it opens the task's view, where the words go", async () => {
    const run = stubRun(REVIEW);
    const { onOpen } = renderCard(codingTask(), run);
    fireEvent.click(await waitFor(() => within(card()).getByRole("button", { name: "Request changes" })));
    expect(onOpen).toHaveBeenCalledWith("t-1");
    expect(run.server.posts).toEqual([]);
  });

  it("shows the pull request a landed task opened, as a link to it", async () => {
    renderCard(
      codingTask({
        status: "completed",
        asks: [],
        landed: { kind: "pull-request", url: "https://github.com/acme/relay/pull/7", number: 7, branch: "t-1--code", base: "main" },
      }),
      stubRun(undefined),
    );
    const link = within(card()).getByRole("link", { name: "PR #7" });
    expect(link.getAttribute("href")).toBe("https://github.com/acme/relay/pull/7");
    expect(within(card()).queryByRole("button", { name: /Open a PR|Merge locally|Resolve/ })).toBeNull();
  });
});
