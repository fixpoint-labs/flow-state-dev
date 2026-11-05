// @vitest-environment happy-dom
/**
 * A teammate's task shows what it came back with. A teammate (researcher,
 * writer) answers a task in text, and the board stores that text as the row's
 * output as is: a plain string (workforce's `agent-after-answer-in-a-task`
 * test pins that shape on the real engine). A coding task's run stores an
 * object whose `answer` is the text. Read only the second way, a teammate's
 * finished task opened on a popup with no result in it, though the answer was
 * written: a researcher's long review read DONE with nothing under it.
 *
 * A task that ends done with nothing written says so in its popup, rather
 * than reading as a plain success with nothing under it.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@flow-state-dev/client";
import { createLabAdapter, toBoardTask, type BoardTask, type LabAdapter } from "../src/adapter";
import { PopupView } from "../src/components/Popups";
import { lookOf } from "../src/lib/looks";

afterEach(cleanup);

const REVIEW = "Here are the 20 newest pull requests, reviewed:\n\n| PR | Verdict |\n| --- | --- |\n| #4735 | ready |";

/** A researcher's task as its run settled it: done, its answer the row's output. */
const doneRow = (output: unknown) => ({
  id: "task_r",
  title: "Review 20 newest FSD pull requests",
  goal: "Review the 20 newest pull requests on fixpoint-labs/flow-state-dev.",
  assignee: "researcher",
  status: "completed",
  attempts: 1,
  run: { sessionId: "run_r" },
  ...(output === undefined ? {} : { output }),
});

describe("a teammate's finished task reads its answer", () => {
  it("takes a teammate's text answer, the row's output as is, as the task's result", () => {
    expect(toBoardTask(doneRow(REVIEW)).result).toBe(REVIEW);
  });

  it("still takes a coding run's answer from its output's `answer`", () => {
    expect(toBoardTask(doneRow({ answer: "Fixed it.", branch: "teammates/task_r" })).result).toBe("Fixed it.");
  });

  it("has no result when the answer is blank or absent", () => {
    expect(toBoardTask(doneRow(undefined)).result).toBeUndefined();
    expect(toBoardTask(doneRow("  \n")).result).toBeUndefined();
    expect(toBoardTask(doneRow({ answer: "" })).result).toBeUndefined();
  });

  it("reads the answer off the conversation's copy of the ended row, which the board's read leaves out", async () => {
    // The board's read never carries an ended task's output. On the real engine the
    // conversation's stream gets a copy that does, once its notice is delivered
    // (`metadata_changed`, with the output a plain string): the case of a popup
    // opened after the task ended, whose run is never followed.
    const { output: _, ...listed } = doneRow(REVIEW);
    const copy = {
      id: "task-change:board/task_r#3",
      requestId: "req_3",
      type: "component",
      component: "task-change",
      ts: 3,
      itemIndex: 0,
      status: "completed",
      data: { collectionId: "tasks", taskId: "task_r", kind: "metadata_changed", task: doneRow(REVIEW) },
    };
    const history: Record<string, unknown[]> = { wks_cos: [copy] };
    const client = {
      subscribe: () => ({ close() {} }),
      sessions: {
        state: async (id: string) => ({ at: 1, sessionCreatedAt: 1, items: history[id] ?? [], pagination: { hasMore: false, nextOffset: (history[id] ?? []).length } }),
        stream: () => ({ close() {} }),
        get: async (id: string) => ({ id, flowKind: "agent" }),
      },
      flow: () => ({ read: async () => ({ ok: true, tasks: [listed] }) }),
    } as unknown as Client;
    let tasks: BoardTask[] = [];
    const stop = createLabAdapter(client).watchTasks("wks_cos", (next) => (tasks = next));
    for (let i = 0; i < 100 && tasks[0]?.result === undefined; i++) await new Promise((r) => setTimeout(r, 20));
    stop();
    expect(tasks[0]).toMatchObject({ status: "done", result: REVIEW });
  });
});

/** An adapter that holds one conversation's rows, read the way the lab reads them, and nothing else. */
function rowsAdapter(rows: Record<string, unknown>[]): LabAdapter {
  return {
    watchTasks: (_sessionId: string, onChange: (tasks: BoardTask[]) => void) => {
      onChange(rows.map((row) => toBoardTask(row)));
      return () => {};
    },
    watchRun: (_id: string, onChange: (steps: never[]) => void) => {
      onChange([]);
      return () => {};
    },
    taskActions: () => ({}),
  } as unknown as LabAdapter;
}

const openTask = (rows: Record<string, unknown>[]) => {
  render(
    <PopupView
      adapter={rowsAdapter(rows)}
      popup={{ kind: "task", sessionId: "wks_cos", taskId: "task_r" }}
      nameOf={(id) => id}
      lookOf={(id) => lookOf({ id, name: id })}
      isCoding={() => false}
      coders={[]}
      onClose={() => {}}
    />,
  );
  return screen.getByRole("dialog");
};

describe("a teammate's finished task's popup", () => {
  it("shows the answer it wrote in its result box", async () => {
    const popup = openTask([doneRow(REVIEW)]);
    // The result box draws the answer as Markdown: its table is a table, not pipes.
    const box = within(popup).getByRole("region", { name: "Result" });
    await waitFor(() => expect([...box.querySelectorAll("td")].map((td) => td.textContent)).toEqual(["#4735", "ready"]));
    expect(box.textContent).toContain("Here are the 20 newest pull requests, reviewed:");
    expect(box.textContent).not.toContain("| --- |");
    expect(within(popup).queryByRole("region", { name: "No result" })).toBeNull();
  });

  it("says a done task wrote no result, rather than showing a success with nothing in it", () => {
    const popup = openTask([doneRow(undefined)]);
    expect(within(popup).queryByRole("region", { name: "Result" })).toBeNull();
    expect(within(popup).getByRole("region", { name: "No result" }).textContent).toMatch(/researcher finished without writing a result/);
  });

  it("control: a task still running says nothing about a result yet", () => {
    const popup = openTask([{ ...doneRow(undefined), status: "in_progress" }]);
    expect(within(popup).queryByRole("region", { name: "No result" })).toBeNull();
  });
});
