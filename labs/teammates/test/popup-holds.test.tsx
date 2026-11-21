// @vitest-environment happy-dom
/**
 * A coding task's popup is where you answer what its run waits on you for.
 * A run that asks shows its question with a box; your answer lets it go on.
 * A run that committed leads its popup with its review (the judge's verdict,
 * its commits), and the popup's foot answers it: **Request changes** sends
 * your words back for one more run, which you review again, and **Accept**
 * completes the task. Without these the task waits on you with nothing on
 * screen to answer it.
 *
 * The answer goes to the hold the board's row holds when you answer (the
 * coding board view's `asks`), through orchestration's Inbox client: a
 * question to the board's `updateTask`, a review to the run's own stop. The
 * stand-in server here plays the board and the run.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/components/App";
import { TaskCard } from "../src/components/TaskCard";
import { lookOf } from "../src/lib/looks";
import { scriptedServer } from "./scripted-server";
import { codingTask, hold, Refused, stubServer, TestProvider, type Posted, POPUP_READ } from "./stub-server";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const LEAD = "teammates.chief-of-staff";
const BOARD = `conversation:${LEAD}`;
const TASK = "Coding task: Fix the typo in the README's first line";
const QUESTION = "Should I fix only line 1, or every typo?";
const BRANCH = "teammates/t1--change";

/** The review answer a POST carries, when it is one: the object in its body with a `verdict`. */
function verdictOf(posted: Posted): Record<string, any> | undefined {
  const find = (value: unknown): Record<string, any> | undefined => {
    if (typeof value !== "object" || value === null) return undefined;
    if ("verdict" in value) return value as Record<string, any>;
    for (const inner of Object.values(value)) {
      const found = find(inner);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return find(posted.body);
}

/**
 * Lead's coding task on Cursor, its run in `run-1`, over a stand-in that plays the board and the run:
 * told to, the run asks {@link QUESTION} first; then it waits for review (or, without `review`,
 * completes); Ask for changes runs it once more; with `lands`, a merge conflicts and a PR lands.
 */
function playRun({ asks = false, review = true, lands = false } = {}) {
  let stops = 0;
  let commits = 0;
  const said = (id: string, text: string) => ({ id, type: "message", role: "assistant", status: "completed", requestId: "q1", content: [{ type: "output_text", text }] });
  const current = (): CodingBoardTask => server.board[BOARD]![0]!;
  const set = (fields: Partial<CodingBoardTask>) => (server.board[BOARD]![0] = { ...current(), ...fields });
  const complete = (fields: Partial<CodingBoardTask> = {}) => set({ status: "completed", asks: [], completedAt: Date.now(), detail: { answer: "Fixed the typo in README.md, line 1.", answerCut: false }, ...fields });
  /** The run commits once more and stops for review, with `landFailed` when a landing just failed. */
  const stopForReview = (landFailed: { land: string; message: string } | null = null) => {
    commits += landFailed === null ? 1 : 0;
    const id = `stop-${++stops}`;
    const data = { branch: BRANCH, commits, subjects: ["docs: fix the README typo"], judge: { verdict: "done", confidence: 0.91, reason: "The typo on line 1 is fixed." }, checks: null, lands: lands ? ["pull-request", "merge"] : [], landFailed };
    server.push("run-1", { id, type: "suspension", kind: "review", status: "pending", requestId: "q1", itemIndex: 0, ts: Date.now(), data } as never);
    set({ asks: [hold("review", `${commits} commit${commits === 1 ? "" : "s"} on ${BRANCH}`, { id })] });
  };
  /** The run goes on past its question, or past nothing: it edits, then waits for review or completes, once the popup follows its session. */
  const carryOn = (): void => void setTimeout(() => (!server.streaming("run-1") ? carryOn() : review ? stopForReview() : complete()), 50);
  const server = stubServer({
    board: { [BOARD]: [codingTask({ id: "t1", assignee: "teammates.cursor", harness: "cursor", title: "Fix the typo in the README's first line", status: "in_progress", run: { sessionId: "run-1", requestId: "q1", attempt: 1 }, ...(asks ? { asks: [hold("question", QUESTION)] } : {}) })] },
    items: { "run-1": [said("s1", 'The typo is on line 1: "Relay keps".')] },
    answer: (posted) => {
      // A question's answer: the board's updateTask on the conversation, naming the hold.
      if (posted.path.endsWith("/actions/updateTask_tasks") && (posted.body.input as { answers?: string }).answers?.startsWith("hold-question")) {
        set({ asks: [] });
        carryOn();
        return { ok: true };
      }
      // A review's answer: the run's own stop.
      const verdict = verdictOf(posted);
      // As the engine's answer route: a stop that isn't the one the run waits on now was resolved, and is refused.
      const answered = (posted.body as { suspensionId?: string }).suspensionId;
      if (posted.path === "/api/flows/coder/requests/q1/answer" && answered !== current().asks[0]?.id) {
        throw new Refused(409, `Suspension "${answered}" has already been resolved (status: "resolved")`, "already-resolved");
      }
      if (posted.path === "/api/flows/coder/requests/q1/answer" && verdict !== undefined) {
        set({ asks: [] });
        if (verdict.verdict === "revise") {
          server.push("run-1", said(`r${stops}`, `Revising: ${verdict.words}`));
          setTimeout(() => stopForReview(), 50);
        } else if (verdict.land === "merge") {
          setTimeout(() => stopForReview({ land: "merge", message: "Merging conflicts in README.md, so it was stopped." }), 50);
        } else if (verdict.land === "pull-request") {
          complete({ landed: { kind: "pull-request", url: "https://github.com/acme/relay/pull/7", number: 7, branch: BRANCH, base: "main" } });
        } else complete();
      }
      return { ok: true };
    },
  });
  if (!asks) carryOn();
  window.history.replaceState(null, "", `/?worker=${LEAD}&session=${BOARD}&task=t1`);
  render(<TestProvider server={scriptedServer({ speed: 0.05 })} client={server.client}><App /></TestProvider>);
  return { popup: screen.findByRole("dialog", { name: TASK }, POPUP_READ), server };
}

describe("a coding task's popup answers what its run waits on you for", () => {
  it("answers the run's question, then reviews its commits: Ask for changes runs it again, Accept completes it", async () => {
    const popup = await playRun({ asks: true }).popup;

    const asked = await within(popup).findByRole("region", { name: "Waiting on you" }, { timeout: 2000 });
    expect(asked.textContent).toMatch(/Should I fix only line 1, or every typo\?/);
    fireEvent.change(within(asked).getByLabelText("Your answer"), { target: { value: "Only line 1." } });
    fireEvent.click(within(asked).getByRole("button", { name: "Answer" }));
    await waitFor(() => expect(within(popup).queryByRole("region", { name: "Waiting on you" })).toBeNull());

    const verdict = await within(popup).findByRole("region", { name: "Verdict" }, { timeout: 3000 });
    await waitFor(() => expect(popup.querySelector("[data-review-commit-count]")?.textContent).toBe("1 commit"));
    expect(verdict.textContent).toMatch(/^91%Done.*with high confidence\./);
    expect(within(popup).queryByRole("region", { name: "Result" })).toBeNull();

    const review = within(popup).getByRole("region", { name: "Your review" });
    fireEvent.change(within(review).getByLabelText("Note for the run"), { target: { value: "Keep the old wording." } });
    fireEvent.click(within(review).getByRole("button", { name: "Request changes" }));
    // One more run, reviewed again over both commits.
    await waitFor(() => expect(popup.querySelector("[data-review-commit-count]")?.textContent).toBe("2 commits"), { timeout: 3000 });
    expect(popup.textContent).toMatch(/Revising: Keep the old wording\./);

    fireEvent.click(within(await within(popup).findByRole("region", { name: "Your review" }, { timeout: 3000 })).getByRole("button", { name: "Accept" }));
    expect(await within(popup).findByRole("region", { name: "Result" }, { timeout: 2000 })).toBeTruthy();
    await waitFor(() => expect(within(popup).queryByRole("region", { name: "Your review" })).toBeNull());
  });

  it("answers the hold the board holds when you answer, not the one the box was first drawn for", async () => {
    const { popup: opened, server } = playRun({ asks: true });
    const popup = await opened;
    await within(popup).findByRole("region", { name: "Waiting on you" }, { timeout: 2000 });
    // The run asked again while the popup was open: the board now holds a new question, under a new id.
    server.board[BOARD]![0] = { ...server.board[BOARD]![0]!, asks: [hold("question", QUESTION, { id: "hold-question-2" })] };
    const from = server.boardReads.length;
    // The popup's own read has seen it: its next read by task id after the change, and a draw after that.
    await waitFor(() => expect(server.boardReads.slice(from).filter((read) => read.taskId === "t1").length).toBeGreaterThan(1));
    const asked = within(popup).getByRole("region", { name: "Waiting on you" });
    fireEvent.change(within(asked).getByLabelText("Your answer"), { target: { value: "Only line 1." } });
    fireEvent.click(within(asked).getByRole("button", { name: "Answer" }));
    await waitFor(() => expect(server.posts.some((posted) => posted.path.endsWith("/actions/updateTask_tasks"))).toBe(true));
    const sent = server.posts.find((posted) => posted.path.endsWith("/actions/updateTask_tasks"))!;
    expect(sent.body.input).toMatchObject({ id: "t1", answers: "hold-question-2", message: "Only line 1." });
  });

  it("refuses, out loud, a verdict on a review round the run has moved past: it never lands on the newer one", async () => {
    const { popup: opened, server } = playRun();
    const popup = await opened;
    const review = await within(popup).findByRole("region", { name: "Your review" }, { timeout: 3000 });
    // Between the draw and the click, the round was answered elsewhere and the run stopped for a newer one.
    server.board[BOARD]![0] = { ...server.board[BOARD]![0]!, asks: [hold("review", "2 commits on fix/readme-typo", { id: "stop-2" })] };
    fireEvent.click(within(review).getByRole("button", { name: "Accept" }));
    // The answer named the round the popup drew, and the server refused it: the popup says so.
    expect((await within(review).findByRole("alert", {}, { timeout: 2000 })).textContent).toMatch(/409/);
    const answers = server.posts.filter((posted) => posted.path === "/api/flows/coder/requests/q1/answer");
    expect(answers.map((posted) => (posted.body as { suspensionId?: string }).suspensionId)).toEqual(["stop-1"]);
    // Nothing landed: the newer round still waits on you, and the task isn't done.
    expect(server.board[BOARD]![0]!.asks.map((h) => h.id)).toEqual(["stop-2"]);
    expect(within(popup).queryByRole("region", { name: "Result" })).toBeNull();
  });

  // The popup opens on the run's latest step, so a hold drawn at the top of the feed is off-screen:
  // what you must act on sits outside the scrolling feed, below it, and the header says you're on.
  // A review's own body leads the feed, the run's steps folded under it.
  it("a pending question or review's answer sits below the scrolling feed, the header says so, and your verdict stays in the log", async () => {
    const popup = await playRun({ asks: true }).popup;
    const status = () => popup.querySelector("[data-overlay-status]")?.textContent;
    const feedOf = () => popup.querySelector('[data-entry="assistant"]')!.parentElement!;
    const belowFeed = (panel: HTMLElement) => {
      const feed = feedOf();
      expect(feed.contains(panel)).toBe(false);
      expect(feed.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    };

    const asked = await within(popup).findByRole("region", { name: "Waiting on you" }, { timeout: 2000 });
    await waitFor(() => expect(popup.querySelector('[data-entry="assistant"]')).not.toBeNull());
    belowFeed(asked);
    expect(status()).toBe("Waiting on you");
    fireEvent.change(within(asked).getByLabelText("Your answer"), { target: { value: "Only line 1." } });
    fireEvent.click(within(asked).getByRole("button", { name: "Answer" }));
    await waitFor(() => expect(within(popup).queryByRole("region", { name: "Waiting on you" })).toBeNull());

    const review = await within(popup).findByRole("region", { name: "Your review" }, { timeout: 3000 });
    belowFeed(review);
    expect(status()).toBe("Needs review");
    // The review leads the body, before the steps it was given over.
    const verdict = within(popup).getByRole("region", { name: "Verdict" });
    expect(verdict.compareDocumentPosition(feedOf()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(within(review).getByLabelText("Note for the run"), { target: { value: "Keep the old wording." } });
    fireEvent.click(within(review).getByRole("button", { name: "Request changes" }));
    await waitFor(() => expect(within(popup).queryByRole("region", { name: "Your review" })).toBeNull());
    // The pending card is gone; the feed keeps what you decided, where you decided it.
    const decisions = () => [...feedOf().querySelectorAll('[data-step="decision"]')].map((d) => d.textContent);
    expect(decisions()).toEqual(["Asked for changes: Keep the old wording."]);
    // It reads before the run's next turn, which it caused.
    const revising = await within(popup).findByText(/Revising: Keep the old wording\./, undefined, { timeout: 3000 });
    const decision = feedOf().querySelector('[data-step="decision"]')!;
    expect(decision.compareDocumentPosition(revising) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const again = await within(popup).findByRole("region", { name: "Your review" }, { timeout: 3000 });
    belowFeed(again);
    fireEvent.click(within(again).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(within(popup).queryByRole("region", { name: "Your review" })).toBeNull());
    expect(decisions()).toEqual(["Asked for changes: Keep the old wording.", "Accepted"]);
    // The result is the feed's last entry, where the popup opens.
    const result = await within(popup).findByRole("region", { name: "Result" }, { timeout: 2000 });
    expect(feedOf().contains(result)).toBe(true);
    expect([...feedOf().querySelectorAll("[data-step]")].pop()).toBe(result);
  });

  it("control: a run with nothing to ask and no review shows no box and no card, and completes on its own", async () => {
    const popup = await playRun({ review: false }).popup;
    expect(await within(popup).findByRole("region", { name: "Result" }, { timeout: 3000 })).toBeTruthy();
    expect(within(popup).queryByRole("region", { name: "Waiting on you" })).toBeNull();
    expect(within(popup).queryByRole("region", { name: "Your review" })).toBeNull();
  });
});

describe("accepting a coding task's review says where its work goes", () => {
  it("offers Open pull request and Merge locally; a merge that conflicts shows the error and a Retry, and a PR after it shows its link and what's next", async () => {
    const popup = await playRun({ lands: true }).popup;

    const review = await within(popup).findByRole("region", { name: "Your review" }, { timeout: 3000 });
    // Two clearly labelled ways to land, and no bare Accept: accepting without landing is in the menu.
    expect(await within(review).findByRole("button", { name: "Open pull request" })).toBeTruthy();
    expect(within(review).queryByRole("button", { name: "Accept" })).toBeNull();
    expect(within(review).getByText(/^Opens a PR from …\/t1--change, with the goal, commits, checks and the judge's verdict as its description\.$/)).toBeTruthy();
    fireEvent.click(within(review).getByRole("button", { name: "Merge locally" }));

    // The merge conflicted: the error, a Retry of it, and the other way.
    const again = await waitFor(
      () => {
        const card = within(popup).getByRole("region", { name: "Your review" });
        expect(within(card).getByRole("alert").textContent).toMatch(/Merging locally failed: Merging conflicts in README\.md/);
        return card;
      },
      { timeout: 3000 },
    );
    // A retry that fails with the same words is a new ask: Retry is offered again, not a receipt.
    const retry = within(again).getByRole("button", { name: "Retry: Merge locally" });
    fireEvent.click(retry);
    await waitFor(() => expect(within(popup).getByRole("button", { name: "Retry: Merge locally" })).not.toBe(retry), { timeout: 3000 });
    fireEvent.click(within(popup).getByRole("button", { name: "Open pull request" }));

    const result = await within(popup).findByRole("region", { name: "Result" }, { timeout: 3000 });
    await waitFor(() => expect(result.textContent).toMatch(/Opened pull request #7 into main\. Next: review and merge it\./));
    expect(within(result).getByRole("link", { name: "pull request #7" }).getAttribute("href")).toBe("https://github.com/acme/relay/pull/7");
  }, 20_000);

  it("names where an accepted task's work landed on its line in the thread", () => {
    const landed = codingTask({ id: "t1", assignee: "teammates.cursor", harness: "cursor", title: "Fix the typo", status: "completed", landed: { kind: "pull-request", url: "https://github.com/acme/relay/pull/7", number: 7, branch: BRANCH, base: "main" } });
    const { container } = render(<TaskCard task={landed} coding nameOf={(id) => id} onOpen={() => {}} />);
    expect(container.querySelector("[data-task-landed]")?.textContent).toBe("PR #7");
  });
});
