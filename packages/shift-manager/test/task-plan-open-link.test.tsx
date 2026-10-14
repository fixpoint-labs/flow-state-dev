// @vitest-environment happy-dom
/**
 * A task row in the conversation's feed opens that task's session. The feed
 * was the one place a task showed with no way into it: the Tasks list and
 * Jump to went there, a row in the conversation did not.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { OutputItem } from "@flow-state-dev/core/items";
import { SessionScope, TaskBoardMeta } from "../src/components/TaskBoardMeta";
import { SessionItemsProvider } from "../src/components/flow-state/session-items-context";

afterEach(cleanup);

const meta = {
  id: "m1",
  type: "component",
  component: "task-board-meta",
  requestId: "r1",
  status: "completed",
  data: { collectionId: "tasks", status: "active" },
} as never;

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
  it("opens the task's session on the board of the conversation whose feed it is", async () => {
    window.history.pushState(null, "", "/");
    render(
      <SessionScope sessionId="s1" items={[change("errored")]}>
        <TaskBoardMeta item={meta} />
      </SessionScope>,
    );
    // Named by its task, since every row's control would otherwise read just "Open".
    expect(screen.getByTestId("task-open").getAttribute("aria-label")).toBe("Open Audit the licenses");
    await act(async () => screen.getByTestId("task-open").click());
    expect(window.location.pathname).toBe("/tasks/s1.tasks/t1/session");
  });

  it("offers no link on a board that isn't the conversation's own ledger", () => {
    // Another collection's task ids name nothing under <session>.tasks.
    const other = { ...(meta as object), data: { collectionId: "plan", status: "active" } } as never;
    const item = {
      ...(change("in_progress") as object),
      data: { collectionId: "plan", taskId: "t1", kind: "added", task: { id: "t1", goal: "Draft", status: "in_progress" } },
    } as unknown as OutputItem;
    render(
      <SessionScope sessionId="s1" items={[item]}>
        <TaskBoardMeta item={other} />
      </SessionScope>,
    );
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.queryByTestId("task-open")).toBeNull();
  });

  it("offers no link where the feed doesn't know its board", () => {
    render(
      <SessionItemsProvider value={[change("in_progress")]}>
        <TaskBoardMeta item={meta} />
      </SessionItemsProvider>,
    );
    expect(screen.getByText("Audit the licenses")).toBeTruthy();
    expect(screen.queryByTestId("task-open")).toBeNull();
  });
});
