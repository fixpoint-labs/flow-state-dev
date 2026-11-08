// @vitest-environment happy-dom
/**
 * A coding task whose run opened a pull request stays open until the pull
 * request merges or closes (harness-manager's `awaitPullRequests`). Its card
 * and its view must say so, *PR open · #7* with the link, or the task reads
 * as still working, or as done, while it only waits on a merge. The view keeps
 * its composer, since your line is what wakes the task to read the pull
 * request again, and says so: nothing tells the task of a merge by itself yet.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LabAdapter, LabTask, TaskWork } from "../src/adapter";
import { SessionOverlayArea, SessionOverlayProvider } from "../src/components/flow-state/session-overlay";
import { ThreadCard } from "../src/components/ThreadCard";
import { ThreadView } from "../src/components/ThreadView";
import { PULL_REQUEST_HINT, rowNote, statusLine } from "../src/components/ThreadStatus";
import { columnOf } from "../src/lib/columns";

afterEach(cleanup);

const URL_7 = "https://github.com/acme/app/pull/7";

const WAITING: LabTask = {
  id: "t-7",
  title: "Rename the session log",
  goal: "Rename it",
  status: "in_progress",
  harness: "claude-code",
  statusNote: "Bash: gh pr create",
  pullRequests: [{ number: 7, url: URL_7, title: "Rename the session log" }],
};

const adapter = {
  watchTaskWork: (_: string, __: string, onChange: (work: TaskWork) => void) => {
    onChange({ entries: [] });
    return () => {};
  },
  taskActions: () => ({}),
  resolve: async () => {},
} as unknown as LabAdapter;

function openView(task: LabTask) {
  render(
    <SessionOverlayProvider>
      <SessionOverlayArea>
        <ThreadView adapter={adapter} sessionId="s-1" task={task} pinned={false} onClose={() => {}} />
      </SessionOverlayArea>
    </SessionOverlayProvider>,
  );
  return screen.getByRole("dialog", { name: `Task: ${task.title}` });
}

describe("a task waiting on its pull request", () => {
  it("reads PR open with its number, never its last tool call, and stays out of Resolved", () => {
    expect(statusLine(WAITING)).toBe("PR open · #7");
    expect(rowNote(WAITING)).toBe("PR open · #7");
    expect(columnOf(WAITING, false)).not.toBe("resolved");
  });

  it("shows PR open · #7 on its card, the number a link to the pull request", () => {
    render(<ThreadCard adapter={adapter} sessionId="s-1" task={WAITING} onOpen={() => {}} />);
    const card = screen.getByRole("region", { name: `Task: ${WAITING.title}` });
    expect(within(card).getByTestId("pull-request-wait").textContent).toBe("PR open · #7");
    expect(within(card).getByRole("link", { name: "#7" }).getAttribute("href")).toBe(URL_7);
  });

  it("keeps the view's composer, with the link and the line that says how to wake it", () => {
    const view = openView(WAITING);
    expect(within(view).getByRole("link", { name: "#7" }).getAttribute("href")).toBe(URL_7);
    expect(within(view).getByTestId("pull-request-hint").textContent).toBe(PULL_REQUEST_HINT);
    expect(within(view).getByRole("textbox", { name: "Message this task" })).toBeTruthy();
    expect(within(view).queryByText("This task is finished.")).toBeNull();
    // It isn't working: no live working line while it only waits on a merge.
    expect(within(view).queryByTestId("streaming-indicator")).toBeNull();
  });

  it("says none of it once the task completed", () => {
    const view = openView({ ...WAITING, status: "completed" });
    expect(within(view).queryByTestId("pull-request-wait")).toBeNull();
    expect(within(view).queryByTestId("pull-request-hint")).toBeNull();
    expect(within(view).getByText("This task is finished.")).toBeTruthy();
  });

  it("says none of it for a running task that waits on no pull request", () => {
    const { pullRequests: _none, ...running } = WAITING;
    expect(statusLine(running)).not.toContain("PR open");
    const view = openView(running);
    expect(within(view).queryByTestId("pull-request-hint")).toBeNull();
  });
});
