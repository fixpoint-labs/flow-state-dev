// @vitest-environment happy-dom
/**
 * A coding task whose work is a pull request (its run's own, or the one
 * **Open a PR** opened) stays open until the pull request merges or closes
 * (harness-manager's `awaitPullRequests`). The popup must say so, *PR open ·
 * #7* with the link, and say how to wake it, or the task reads as a run still
 * working while it only waits on a merge.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { toBoardTask, type LabAdapter } from "../src/adapter";
import { PULL_REQUEST_HINT, PullRequestOpen } from "../src/components/Popups";

afterEach(cleanup);

const URL_7 = "https://github.com/acme/app/pull/7";

/** A coding row waiting on pull request 7, as the board lists it: running, with the manager's external hold. */
const waitingRow = {
  id: "t-7",
  status: "in_progress",
  assignee: "coder.cursor",
  title: "Add a welcome line",
  goal: "Add it",
  run: { sessionId: "run-7", requestId: "r-1" },
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

describe("a coding task waiting on its pull request", () => {
  it("reads the wait off the row, by number, and never as waiting on you", () => {
    const task = toBoardTask(waitingRow);
    expect(task.pullRequests).toEqual([{ number: 7 }]);
    expect(task.waiting).toBeUndefined();
    expect(task.status).toBe("running");
  });

  it("reads none once the row settled", () => {
    expect(toBoardTask({ ...waitingRow, status: "completed" }).pullRequests).toBeUndefined();
  });

  it("shows PR open · #7, linked from the run session's record, and how to wake it", async () => {
    const adapter = { readPullRequests: async () => [{ number: 7, url: URL_7, title: "Add a welcome line" }] } as unknown as LabAdapter;
    render(<PullRequestOpen adapter={adapter} task={toBoardTask(waitingRow)} />);
    await waitFor(() => expect(screen.getByRole("link", { name: "#7" }).getAttribute("href")).toBe(URL_7));
    expect(screen.getByTestId("pull-request-wait").textContent).toBe("PR open · #7");
    expect(screen.getByTestId("pull-request-hint").textContent).toBe(PULL_REQUEST_HINT);
  });
});
