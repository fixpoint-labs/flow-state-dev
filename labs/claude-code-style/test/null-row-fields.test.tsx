// @vitest-environment happy-dom
/**
 * The screens read the coding board row as the view sends it, where an
 * absent harness, landing or error is `null`, not a missing key. A check
 * written for a missing key (`=== undefined`) never matches a `null`, and
 * says nothing when it stops matching: a plain worker's review would wait on
 * a review it never gets, a task that landed nothing would draw a landing,
 * and a recorded-work read would go out for a run with no harness. Each case
 * here is a row with the field `null`, read by the screen that decides on it.
 *
 * Red states produced before this was trusted: each check below put back to
 * `=== undefined` (or `!== undefined`) fails its case.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { readsRecordedWork, type CodingBoardTask } from "../src/app";
import { SessionOverlayArea, SessionOverlayProvider } from "../src/components/flow-state/session-overlay";
import { TasksPane } from "../src/components/TasksPane";
import { ThreadCard } from "../src/components/ThreadCard";
import { ThreadView } from "../src/components/ThreadView";
import { codingBoardTask } from "./coding-board-task";
import { RUN, stubServer, underReview } from "./stub-server";

afterEach(cleanup);

const REVIEW_PROMPT = "Accept the changes, or ask for changes in words.";

/** A plain worker's task (no harness) stopped for your review in {@link RUN}. */
const plainReview = (): CodingBoardTask => underReview(codingBoardTask({ id: "t-1", title: "Draft the summary", goal: "Draft it", harness: null }));

function openView(task: CodingBoardTask) {
  render(
    stubServer().wrap(
      <SessionOverlayProvider>
        <SessionOverlayArea>
          <ThreadView sessionId="s-1" task={task} pinned={false} onClose={() => {}} />
        </SessionOverlayArea>
      </SessionOverlayProvider>,
    ),
  );
  return screen.getByRole("dialog", { name: `Task: ${task.title}` });
}

describe("a row whose harness is null: a plain worker's task", () => {
  it("never reads a run's recorded work, which only a coding run has", () => {
    const run = { ...RUN, attempt: 1 };
    expect(readsRecordedWork(codingBoardTask({ harness: null, run }))).toBe(false);
    expect(readsRecordedWork(codingBoardTask({ harness: "codex", run }))).toBe(true);
    expect(readsRecordedWork(codingBoardTask({ harness: "codex" }))).toBe(false);
  });

  it("can be resolved at once from its card: there is no coding review to wait for", async () => {
    render(stubServer().wrap(<ThreadCard sessionId="s-1" task={plainReview()} onOpen={() => {}} />));
    const card = screen.getByRole("region", { name: "Task: Draft the summary" });
    const resolve = await waitFor(() => within(card).getByRole("button", { name: "Resolve" }));
    expect((resolve as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows what it asks in its view's review card", async () => {
    const view = openView(plainReview());
    expect(await within(view).findByText(REVIEW_PROMPT)).toBeTruthy();
  });
});

describe("a row whose landing is null: nothing landed", () => {
  const settled = codingBoardTask({ id: "t-2", title: "Rename the log", status: "completed", harness: "codex", landed: null });

  it("draws no landing on its card", () => {
    render(stubServer().wrap(<ThreadCard sessionId="s-1" task={settled} onOpen={() => {}} />));
    expect(screen.getByRole("region", { name: "Task: Rename the log" }).querySelector("[data-landed]")).toBeNull();
  });

  it("draws no landing in its view", () => {
    expect(openView(settled).querySelector("[data-landed]")).toBeNull();
  });
});

describe("a row whose error is null: a failure the board gave no reason for", () => {
  const failed = codingBoardTask({ id: "t-3", title: "Export the report", status: "errored", error: null });

  it("draws no empty alert in its view, and says it failed", () => {
    const view = openView(failed);
    expect(within(view).queryAllByRole("alert")).toEqual([]);
    expect(within(view).getByText("Failed")).toBeTruthy();
  });

  it("draws no empty alert in the tasks pane's sheet", () => {
    render(
      stubServer().wrap(
        <SessionOverlayProvider>
          <SessionOverlayArea>
            <TasksPane sessionId="s-1" tasks={[failed]} openId="t-3" onOpen={() => {}} onMissing={() => {}} />
          </SessionOverlayArea>
        </SessionOverlayProvider>,
      ),
    );
    const sheet = screen.getByRole("dialog", { name: "Work: Export the report" });
    expect(within(sheet).queryAllByRole("alert")).toEqual([]);
  });
});
