/**
 * A task's ending as the line under the worker that ran it. A task filed with
 * `resultTo: "conversation"` ends as the worker's bare answer, with no task id
 * on the line: that is a finished task, never one drawn as failed.
 */
import { describe, expect, it } from "vitest";
import { toEntries } from "../src/adapter";

const CODER = "teammates.coder";
const line = (id: string, text: string) =>
  ({ id, type: "message", role: "assistant", agentName: CODER, status: "completed", requestId: "r1", content: [{ type: "output_text", text }] });
const row = (id: string, status: string) =>
  ({ id: `c-${id}`, type: "component", component: "task-change", status: "completed", requestId: "r1", data: { task: { id, status, assignee: CODER, title: id } } });

describe("a task's ending in the conversation", () => {
  it("draws a conversation-result answer, which names no task, as the answer and not as failed", () => {
    const [entry] = toEntries([line("a", "The README typo is fixed.")], new Set([CODER]));
    expect(entry).toMatchObject({ kind: "result", from: CODER, text: "The README typo is fixed." });
    expect(entry).not.toHaveProperty("failed");
  });

  it("still draws a named task that errored as failed", () => {
    const [entry] = toEntries([row("task_x", "errored"), line("b", "coder's task (task_x) ended: errored")], new Set([CODER]));
    expect(entry).toMatchObject({ kind: "result", taskId: "task_x", failed: true });
  });
});
