// @vitest-environment happy-dom
/**
 * TASKS, at Shift Coordinator (FIX-1794 S11): the tasks the person's
 * conversation filed, read through the conversation's own `listTasks` action.
 *
 * What it lists is what that read answered: the conversation's own board, never
 * a store or a Lab-wide walk. It reads again each time the Lab is read again,
 * which is after each turn the person sends (the reload floor), and on no
 * tool's name.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TasksPanel } from "../src/components/TasksPanel";
import { toSeat } from "../src/lib/reads";

type Row = { id: string; goal: string; status: string; assignee?: string; attempts: number };
let rows: Row[] = [];
let refusal: string | null = null;
const calls: string[] = [];

vi.mock("../src/lib/lab-data", () => {
  const lab = { clients: { userId: "alice" } };
  return { useLab: () => lab };
});
vi.mock("../src/lib/conversation-tasks", () => ({
  readConversationTasks: async (_c: unknown, kind: string, sessionId: string) => {
    calls.push(`list ${kind} ${sessionId}`);
    if (refusal !== null) throw new Error(refusal);
    return [...rows];
  },
}));

const cos = toSeat({ id: "chief-of-staff", kind: "coordinator", door: "run" })!;

beforeEach(() => {
  rows = [];
  refusal = null;
  calls.length = 0;
});
afterEach(cleanup);

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const shown = () =>
  screen.queryAllByTestId("cos-task").map((li) => ({
    id: li.getAttribute("data-task-id"),
    status: li.getAttribute("data-status"),
    text: li.textContent,
  }));

describe("the tasks panel (S11)", () => {
  it("says tasks belong to a conversation before there is one, and reads nothing", async () => {
    render(<TasksPanel seat={cos} sessionId={null} readAt={1} />);
    await settle();
    expect(screen.getByTestId("cos-tasks-none")).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("lists what the conversation's own read answers: each task's goal, status and delegate", async () => {
    rows = [
      { id: "t1", goal: "Audit the licenses", status: "completed", assignee: "licenses", attempts: 1 },
      { id: "t2", goal: "Write the release notes", status: "pending", attempts: 0 },
    ];
    render(<TasksPanel seat={cos} sessionId="s1" readAt={1} />);
    await settle();
    expect(calls).toEqual(["list coordinator s1"]);
    expect(shown()).toEqual([
      { id: "t1", status: "completed", text: expect.stringContaining("Audit the licenses") },
      { id: "t2", status: "pending", text: expect.stringContaining("Write the release notes") },
    ]);
    expect(shown()[0]!.text).toContain("licenses");
    expect(shown()[1]!.text).toContain("unassigned");
  });

  it("says so when the conversation has filed nothing", async () => {
    render(<TasksPanel seat={cos} sessionId="s1" readAt={1} />);
    await settle();
    expect(screen.getByTestId("cos-tasks-empty")).toBeTruthy();
  });

  it("reads again when the Lab is read again, and only then", async () => {
    rows = [{ id: "t1", goal: "Audit the licenses", status: "in_progress", assignee: "licenses", attempts: 1 }];
    const view = render(<TasksPanel seat={cos} sessionId="s1" readAt={1} />);
    await settle();
    view.rerender(<TasksPanel seat={cos} sessionId="s1" readAt={1} />);
    await settle();
    expect(calls).toEqual(["list coordinator s1"]);
    rows = [{ id: "t1", goal: "Audit the licenses", status: "completed", assignee: "licenses", attempts: 1 }];
    view.rerender(<TasksPanel seat={cos} sessionId="s1" readAt={2} />);
    await settle();
    expect(calls).toEqual(["list coordinator s1", "list coordinator s1"]);
    expect(shown()).toEqual([{ id: "t1", status: "completed", text: expect.stringContaining("Audit the licenses") }]);
  });

  it("shows why the read failed", async () => {
    refusal = "This conversation keeps no task board.";
    render(<TasksPanel seat={cos} sessionId="s1" readAt={1} />);
    await settle();
    expect(screen.getByTestId("cos-tasks-failure").textContent).toContain("This conversation keeps no task board.");
  });
});
