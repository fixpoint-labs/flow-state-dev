// @vitest-environment happy-dom
/**
 * What a task's buttons send, and where. Each goes to the board of the
 * conversation that filed the task, through the Inbox client's
 * `board(at)`, on its `"tasks"` collection. Re-run files the task again on
 * another coding worker with its brief kept and a line naming the task it
 * re-runs: sent anywhere else, or without the old brief, the new task runs
 * with no idea what it replaces, and its result never reaches the
 * conversation that asked for the first.
 */
import { createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Client } from "@flow-state-dev/client";
import { useTaskActions } from "../src/app";
import { codingTask, TestProvider } from "./stub-server";

/** The board's actions the popup sends, as `useTaskActions` hands them, over `client`. */
function actionsOn(client: Client) {
  const wrapper = ({ children }: { children: ReactNode }) => createElement(TestProvider, { client }, children);
  return renderHook(() => useTaskActions("wks_cos"), { wrapper }).result.current;
}

/**
 * A client that takes every board action, answering `answer`, and keeps each one sent.
 * `getTask_tasks` answers with `held`, the task as the board holds it, when given.
 */
function boardClient(answer: Record<string, unknown>, held?: Record<string, unknown>) {
  const sent: Array<{ flow: string; action: string; input: Record<string, unknown>; sessionId: string }> = [];
  const outputOf = (action: string) => (action === "getTask_tasks" && held !== undefined ? { ok: true, task: held } : answer);
  const client = {
    sessions: {
      get: async (id: string) => ({ id, flowKind: "agent" }),
    },
    flow: (flow: string) => ({
      send: async (action: string, input: Record<string, unknown>, { sessionId }: { sessionId: string }) => {
        sent.push({ flow, action, input, sessionId });
        return { id: `req_${sent.length - 1}` };
      },
      // Each action's answer is read by its request id, never by listing the session.
      request: (id: string) => ({
        result: async () => ({ status: "completed", output: outputOf(sent[Number(id.slice("req_".length))]!.action) }),
      }),
    }),
  } as unknown as Client;
  return { client, sent };
}

/** A coding task on Cursor that failed, as the board's `getTask` reads it, its brief whole. */
const failedRow = {
  id: "task_1",
  title: "Fix the typo",
  goal: "Fix the typo in the README's first line.",
  context: "Only line 1: leave the rest of the README alone.",
  assignee: "teammates.cursor",
  labels: ["docs"],
  priority: 2,
  status: "errored",
  error: "Cursor isn't set up on this machine.",
};
/** The same task as the coding board view lists it: no brief. */
const listed = (fields: Record<string, unknown> = {}) =>
  codingTask({ id: failedRow.id, title: failedRow.title, goal: failedRow.goal, assignee: failedRow.assignee, status: failedRow.status, harness: "cursor", error: failedRow.error, ...fields });

describe("a task's buttons act on the board of the conversation that filed it", () => {
  it("re-run files the task again on the other worker, the old brief kept and a line naming the old task by title", async () => {
    const { client, sent } = boardClient({ ok: true, taskId: "task_2" }, failedRow);
    const id = await actionsOn(client).rerun(listed(), "teammates.claude-code");

    expect(id).toBe("task_2");
    expect(sent.map((s) => s.action)).toEqual(["getTask_tasks", "createTask_tasks"]);
    const [, filed] = sent;
    expect([filed!.flow, filed!.action, filed!.sessionId]).toEqual(["agent", "createTask_tasks", "wks_cos"]);
    // Copied as filed, and only the assignee changed.
    expect(filed!.input).toMatchObject({ goal: failedRow.goal, title: "Fix the typo", labels: ["docs"], priority: 2, assignee: "teammates.claude-code" });
    const context = String(filed!.input.context);
    expect(context.startsWith(`${failedRow.context}\n\n`)).toBe(true);
    expect(context.slice(failedRow.context.length)).toMatch(/"Fix the typo", which failed on Cursor/);
  });

  it("re-run of a task filed with no brief carries just the line naming it", async () => {
    const { context: _, ...bare } = failedRow;
    const { client, sent } = boardClient({ ok: true, taskId: "task_2" }, { ...bare, status: "cancelled" });
    await actionsOn(client).rerun(listed({ status: "cancelled", harness: null }), "teammates.codex");
    expect(sent[1]!.input.context).toBe('This re-runs the task "Fix the typo", which was cancelled.');
  });

  it("re-run files nothing when the whole task can't be read", async () => {
    const { client, sent } = boardClient({ ok: false, error: "No task task_1 on this board." });
    await expect(actionsOn(client).rerun(listed(), "teammates.claude-code")).rejects.toThrow(/No task task_1/);
    expect(sent.map((s) => s.action)).toEqual(["getTask_tasks"]);
  });

  it("cancel, steer, release and retry go to the same board's own actions", async () => {
    const { client, sent } = boardClient({ ok: true });
    const actions = actionsOn(client);
    await actions.cancel("task_1");
    await actions.steer("task_1", "Only line 1.");
    await actions.release("task_1");
    await actions.retry("task_1");
    expect(sent.map(({ action, input, sessionId }) => [action, input, sessionId])).toEqual([
      ["updateTask_tasks", { id: "task_1", status: "cancelled" }, "wks_cos"],
      ["updateTask_tasks", { id: "task_1", message: "Only line 1." }, "wks_cos"],
      ["updateTask_tasks", { id: "task_1", status: "pending" }, "wks_cos"],
      ["retryTask_tasks", { id: "task_1" }, "wks_cos"],
    ]);
  });

  it("a refusal shows as the board's own words", async () => {
    const { client } = boardClient({ ok: false, error: 'already_open: task "Fix the typo" (task_2) is this same work for teammates.claude-code' }, failedRow);
    await expect(actionsOn(client).rerun(listed(), "teammates.claude-code")).rejects.toThrow(/^already_open: /);
  });
});
