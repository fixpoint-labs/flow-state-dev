// @vitest-environment happy-dom
/** The feed's task row opens the session the Tasks list and Jump to already opened. */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutputItem } from "@flow-state-dev/core/items";
import { TaskBoardMeta, TaskBoardRefProvider } from "../src/components/TaskBoardMeta";

afterEach(cleanup);

const meta = {
  id: "m1",
  type: "component",
  component: "task-board-meta",
  requestId: "r1",
  status: "completed",
  data: { collectionId: "tasks", status: "active" },
} as never;

vi.mock("../src/components/flow-state/session-items-context", async (original) => ({
  ...(await original<object>()),
  useSessionItems: () => mocked.items,
}));
const mocked: { items: OutputItem[] } = { items: [] };

const change = (status: string): OutputItem =>
  ({
    id: "i1",
    type: "component",
    component: "task-change",
    requestId: "r1",
    status: "completed",
    data: { collectionId: "tasks", taskId: "t1", kind: "added", task: { id: "t1", goal: "Audit the licenses", status } },
  }) as unknown as OutputItem;

describe("a task row in the feed", () => {
  it("opens the task's session on the conversation's board, and doesn't toggle the row", async () => {
    window.history.pushState(null, "", "/");
    mocked.items = [change("errored")];
    render(
      <TaskBoardRefProvider value="s1.tasks">
        <TaskBoardMeta item={meta} />
      </TaskBoardRefProvider>,
    );
    await act(async () => screen.getByTestId("task-open").click());
    expect(window.location.pathname).toBe("/tasks/s1.tasks/t1/session");
  });

  it("offers no link where the feed doesn't know its board", () => {
    mocked.items = [change("in_progress")];
    render(<TaskBoardMeta item={meta} />);
    expect(screen.queryByTestId("task-open")).toBeNull();
  });
});
