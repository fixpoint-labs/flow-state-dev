// @vitest-environment happy-dom
/**
 * A thread card's accept, on a stub adapter that hands the card one review. The review's `lands` decide
 * what the accept offers; the card never offers a way its review doesn't list, never reads a failed
 * landing as accepted, and sends the way you chose.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LabAdapter, LabTask, ReviewDetail } from "../src/adapter";
import { ThreadCard } from "../src/components/ThreadCard";

afterEach(cleanup);

const REVIEW: ReviewDetail = {
  branch: "conductor/t0/ha62-h01/t-7f3c--code",
  commits: 1,
  subjects: ["docs: note the vendor pick"],
  judge: null,
  checks: null,
  lands: ["pull-request", "merge"],
};

const codingTask = (patch: Partial<LabTask> = {}): LabTask =>
  ({
    id: "t-1",
    title: "Add a CHANGELOG line",
    goal: "Add a line",
    status: "in_progress",
    harness: "claude-code",
    openHold: { kind: "review", prompt: "Accept the changes, or ask for changes in words." },
    ...patch,
  }) as LabTask;

/** An adapter whose only read is the run's review, and whose accept is `resolve`. */
function stubAdapter(review: ReviewDetail | undefined, resolve = vi.fn(async (_s: string, _t: string, _land?: string) => {})) {
  const adapter = {
    watchTaskWork: (_sessionId: string, _taskId: string, onChange: (work: unknown) => void) => {
      onChange({ entries: [], ...(review === undefined ? {} : { review }) });
      return () => {};
    },
    resolve,
  };
  return { adapter: adapter as unknown as LabAdapter, resolve };
}

function renderCard(task: LabTask, adapter: LabAdapter, onOpen = vi.fn()) {
  render(<ThreadCard adapter={adapter} sessionId="s-1" task={task} onOpen={onOpen} />);
  return { onOpen };
}

const card = () => screen.getByRole("region", { name: "Task: Add a CHANGELOG line" });

describe("a thread card's accept", () => {
  it("offers only the landings its review lists, and sends the one chosen with the accept", async () => {
    const { adapter, resolve } = stubAdapter(REVIEW);
    renderCard(codingTask(), adapter);
    await waitFor(() => expect(within(card()).getByRole("button", { name: "Open a PR" })).toBeTruthy());
    expect(within(card()).getByRole("button", { name: "Merge locally" })).toBeTruthy();
    expect(within(card()).queryByRole("button", { name: "Resolve" })).toBeNull();
    fireEvent.click(within(card()).getByRole("button", { name: "Merge locally" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith("s-1", "t-1", "merge"));
  });

  it("offers no way its review doesn't list: a review that lists one landing shows only that one", async () => {
    const { adapter } = stubAdapter({ ...REVIEW, lands: ["pull-request"] });
    renderCard(codingTask(), adapter);
    await waitFor(() => expect(within(card()).getByRole("button", { name: "Open a PR" })).toBeTruthy());
    expect(within(card()).queryByRole("button", { name: "Merge locally" })).toBeNull();
  });

  it("is a plain Resolve when the review lists no landing, sending no land", async () => {
    const { adapter, resolve } = stubAdapter({ ...REVIEW, lands: [] });
    renderCard(codingTask(), adapter);
    const resolveButton = await waitFor(() => within(card()).getByRole("button", { name: "Resolve" }));
    fireEvent.click(resolveButton);
    await waitFor(() => expect(resolve).toHaveBeenCalledWith("s-1", "t-1", undefined));
  });

  it("offers no accept for a coding review until the review is read, so a plain accept can't go before its lands are known", async () => {
    const { adapter } = stubAdapter(undefined);
    renderCard(codingTask(), adapter);
    expect((within(card()).getByRole("button", { name: "Resolve" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows why a landing failed, offers its retry, and never reads as accepted", async () => {
    const { adapter } = stubAdapter({
      ...REVIEW,
      landFailed: { land: "pull-request", message: "gh: permission denied to push" },
      landAttempts: [{ land: "pull-request", message: "gh: permission denied to push" }],
    });
    renderCard(codingTask(), adapter);
    const alert = await waitFor(() => within(card()).getByRole("alert"));
    expect(alert.textContent).toBe("Opening the PR failed: gh: permission denied to push");
    expect(within(card()).getByRole("button", { name: "Retry: Open a PR" })).toBeTruthy();
    expect(within(card()).getByRole("button", { name: "Merge locally" })).toBeTruthy();
    expect(card().textContent).not.toMatch(/accepted/i);
  });

  it("retries the same landing that failed, sending its land again", async () => {
    const { adapter, resolve } = stubAdapter({
      ...REVIEW,
      landFailed: { land: "merge", message: "checkout is dirty" },
      landAttempts: [{ land: "merge", message: "checkout is dirty" }],
    });
    renderCard(codingTask(), adapter);
    fireEvent.click(await waitFor(() => within(card()).getByRole("button", { name: "Retry: Merge locally" })));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith("s-1", "t-1", "merge"));
  });

  it("reads as landing, not accepted, while the accept is on its way, and says why when it is refused", async () => {
    let refuse!: (error: Error) => void;
    const resolve = vi.fn(() => new Promise<void>((_, reject) => (refuse = reject)));
    const { adapter } = stubAdapter(REVIEW, resolve);
    renderCard(codingTask(), adapter);
    fireEvent.click(await waitFor(() => within(card()).getByRole("button", { name: "Open a PR" })));
    await waitFor(() => expect(within(card()).getAllByRole("button", { name: "Landing…" })).toHaveLength(2));
    expect(card().textContent).not.toMatch(/accepted/i);
    refuse(new Error("The thread isn't waiting on your review."));
    await waitFor(() => expect(within(card()).getByRole("alert").textContent).toBe("Couldn't resolve: The thread isn't waiting on your review."));
  });

  it("keeps Request changes: it opens the task's view, where the words go", async () => {
    const { adapter, resolve } = stubAdapter(REVIEW);
    const { onOpen } = renderCard(codingTask(), adapter);
    fireEvent.click(await waitFor(() => within(card()).getByRole("button", { name: "Request changes" })));
    expect(onOpen).toHaveBeenCalledWith("t-1");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("shows the pull request a landed task opened, as a link to it", async () => {
    const { adapter } = stubAdapter(undefined);
    renderCard(
      codingTask({
        status: "completed",
        openHold: undefined,
        landed: { kind: "pull-request", url: "https://github.com/acme/relay/pull/7", number: 7, branch: "t-1--code", base: "main" },
      }),
      adapter,
    );
    const link = within(card()).getByRole("link", { name: "PR #7" });
    expect(link.getAttribute("href")).toBe("https://github.com/acme/relay/pull/7");
    expect(within(card()).queryByRole("button", { name: /Open a PR|Merge locally|Resolve/ })).toBeNull();
  });
});
