// @vitest-environment happy-dom
/**
 * A coding task whose work is a pull request (its run's own, or the one an
 * accept's Open a PR opened) stays open until the pull request merges or
 * closes (harness-manager's `awaitPullRequests`). The conversation's task line
 * must say so, *PR open · #7* with the link, and how to wake it, or the task
 * reads as plain `in_progress` while it only waits on a merge.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TasksPanel } from "../src/components/TasksPanel";
import { pullRequestsWaitedOn, type ConversationTask } from "../src/lib/conversation-tasks";
import { toWorker } from "../src/lib/reads";

const URL_7 = "https://github.com/acme/app/pull/7";

const WAITING: ConversationTask = {
  id: "t-7",
  goal: "Add a welcome line",
  status: "in_progress",
  assignee: "dev.coder",
  attempts: 1,
  run: { sessionId: "run-7", requestId: "r-1", attempt: 1 },
  holds: [
    {
      id: "wait_1",
      actor: "system",
      openedAt: 1,
      source: { kind: "task", closedBy: [{ by: "event", event: "pull-request", key: "github.com/acme/app/7" }] },
      ask: { kind: "external", prompt: "Waiting for pull request #7 to merge or close." },
    },
  ],
};

vi.mock("../src/lib/lab-data", () => {
  // The conversation board's view answers the two rows.
  const view = async () => {
    const value = [WAITING, { ...WAITING, id: "t-8", holds: undefined }];
    return { value, topics: [], keys: value.map((task) => task.id) };
  };
  const client = { userId: "alice", subscribe: () => ({ close: () => {} }), view };
  return { useLab: () => ({ client, refresh: async () => {} }) };
});
vi.mock("../src/lib/conversation-tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/conversation-tasks")>()),
  readPullRequestLinks: async () => new Map([[7, URL_7]]),
}));

afterEach(cleanup);

describe("a conversation's task waiting on its pull request", () => {
  it("is read off the row's open external hold, by number, with its run session", () => {
    expect(pullRequestsWaitedOn(WAITING)).toEqual({ numbers: [7], runSessionId: "run-7" });
    expect(pullRequestsWaitedOn({ ...WAITING, status: "completed" })).toBeUndefined();
    expect(pullRequestsWaitedOn({ ...WAITING, holds: undefined })).toBeUndefined();
  });

  it("shows PR open · #7 on its line, linked, with how to wake it; a task waiting on none shows neither", async () => {
    const worker = toWorker({ id: "shift-coordinator", kind: "coordinator", door: "run" })!;
    render(<TasksPanel worker={worker} sessionId="conv-1" />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const lines = screen.getAllByTestId("shift-coordinator-task");
    expect(lines).toHaveLength(2);
    expect(lines[0]!.querySelector('[data-testid="pull-request-wait"]')?.textContent).toBe("PR open · #7");
    expect(screen.getByRole("link", { name: "#7" }).getAttribute("href")).toBe(URL_7);
    expect(lines[0]!.querySelector('[data-testid="pull-request-hint"]')?.textContent).toBe("Merged? Say so here and I'll check.");
    expect(lines[1]!.querySelector('[data-testid="pull-request-wait"]')).toBeNull();
  });
});
