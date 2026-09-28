/**
 * Changing a task from its row (FIX-1629 BR-9 – BR-15).
 *
 * The row changes a task only through the flow's own actions, dispatched the
 * way the action bar dispatches them. What it has to get right is reading the
 * answer: the dispatch returns a request id and no output, and a refused verb
 * writes nothing, so the tool's `{ ok, error }` lives only on the root trace of
 * the request the row sent. A refusal read as success is the failure these
 * legs exist to catch.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import type { ActionInputSchema } from "@flow-state-dev/client";
import {
  TaskCollectionsView,
  type RowActions,
} from "../src/react/components/workspace/task-collections-view";
import type { Task, TaskStreamItem } from "../src/react/lib/task-collection-state";

const parked: Task = { id: "task-a", goal: "refund", status: "parked", feedback: "needs a person" };

function taskItem(task: Task): TaskStreamItem {
  return {
    id: `item_${task.id}`,
    type: "component",
    status: "completed",
    requestId: "req_0",
    itemIndex: 0,
    provenance: { blockName: "board", blockInstanceId: "b:0", phase: "main" },
    ts: 1_000,
    component: "task-change",
    data: { collectionId: "issues", taskId: task.id, kind: "review_requested", task },
  } as never as TaskStreamItem;
}

const withTaskId: ActionInputSchema = {
  type: "object",
  fields: { taskId: { type: "string", required: true }, reason: { type: "string", required: false } },
};
const schemas: Record<string, ActionInputSchema> = {
  post: { type: "object", fields: { body: { type: "string", required: true } } },
  answer: {
    type: "object",
    fields: { taskId: { type: "string", required: true }, answer: { type: "string", required: true } },
  },
  cancelTask_issues: withTaskId,
};

/** One request as the panel's request groups carry it. */
function request(requestId: string, status: string, rawItems: unknown[]) {
  return { requestId, status, rawItems } as RowActions["requests"][number];
}

/** The root trace of a request, carrying the handler's output inline. */
function rootTrace(requestId: string, output: unknown, status = "completed", error?: string) {
  return {
    id: `${requestId}_trace`,
    type: "block_trace",
    requestId,
    blockName: "cancelTask_issues",
    blockKind: "handler",
    blockInstanceId: `${requestId}:root:0`,
    status,
    provenance: { blockName: "cancelTask_issues", blockInstanceId: `${requestId}:root:0`, phase: "main" },
    ...(output === undefined ? {} : { output: { kind: "inline", value: output } }),
    ...(error === undefined ? {} : { error: { message: error } }),
  };
}

function Harness(props: Partial<RowActions> & { names?: string[] }) {
  const rowActions: RowActions = {
    names: props.names ?? Object.keys(schemas),
    schemas: props.schemas ?? schemas,
    run: props.run ?? vi.fn(async () => ({ requestId: "req_1" })),
    requests: props.requests ?? [],
  };
  return (
    <TaskCollectionsView
      items={[taskItem(parked)]}
      dispatchRuns={[]}
      truncation="complete"
      onOpenDispatchRun={vi.fn()}
      rowActions={rowActions}
    />
  );
}

function row(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-task-id="task-a"]')!;
}

async function open() {
  await userEvent.click(within(row()).getAllByRole("button")[0]!);
}

describe("the actions a row offers", () => {
  it("BR-9 · lists the flow's actions that take a taskId, and no other", async () => {
    render(<Harness />);
    await open();

    const actions = within(row()).getByRole("group", { name: /actions/i });
    expect(within(actions).getByRole("button", { name: "answer" })).toBeInTheDocument();
    expect(within(actions).getByRole("button", { name: "cancelTask_issues" })).toBeInTheDocument();
    expect(within(actions).queryByRole("button", { name: "post" })).toBeNull();
  });

  it("BR-11 · says so, and where to read how, when none qualify", async () => {
    render(<Harness names={["post"]} />);
    await open();

    expect(within(row()).getByText(/no actions that take a taskId/i)).toBeInTheDocument();
    const link = within(row()).getByRole("link");
    expect(link.getAttribute("href")).toContain("task-board#changing-tasks-from-outside-a-run");
  });

  it("BR-12 · opens the form with the task's id filled in and locked", async () => {
    render(<Harness />);
    await open();
    await userEvent.click(within(row()).getByRole("button", { name: "cancelTask_issues" }));

    const field = row().querySelector<HTMLInputElement>('[data-field="taskId"] input')!;
    expect(field.value).toBe("task-a");
    expect(field.readOnly || field.disabled).toBe(true);
  });
});

describe("running one", () => {
  it("BR-13 · dispatches through the panel's action path with the taskId fixed", async () => {
    const run = vi.fn(async () => ({ requestId: "req_1" }));
    render(<Harness run={run} />);
    await open();
    await userEvent.click(within(row()).getByRole("button", { name: "cancelTask_issues" }));
    await userEvent.type(row().querySelector<HTMLInputElement>('[data-field="reason"] input')!, "dupe");
    await userEvent.click(within(row()).getByRole("button", { name: /^run$/i }));

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("cancelTask_issues", { taskId: "task-a", reason: "dupe" });
  });

  async function submitted(requests: RowActions["requests"], dispatch: Awaited<ReturnType<RowActions["run"]>> = { requestId: "req_1" }) {
    const run = vi.fn(async () => dispatch);
    const { rerender } = render(<Harness run={run} />);
    await open();
    await userEvent.click(within(row()).getByRole("button", { name: "cancelTask_issues" }));
    await userEvent.click(within(row()).getByRole("button", { name: /^run$/i }));
    rerender(<Harness run={run} requests={requests} />);
    return row().querySelector<HTMLElement>("[data-outcome]");
  }

  it("BR-14 · reports success when the tool answered ok", async () => {
    const outcome = await submitted([request("req_1", "completed", [rootTrace("req_1", { ok: true })])]);
    expect(outcome?.getAttribute("data-outcome")).toBe("ok");
  });

  it("BR-15 · reports a refusal returned as a value, in the tool's words, never as success", async () => {
    const error = 'terminal_task_write_declined: task "task-a" is cancelled, which is terminal.';
    const outcome = await submitted([
      request("req_1", "completed", [rootTrace("req_1", { ok: false, error, taskId: "task-a" })]),
    ]);
    expect(outcome?.getAttribute("data-outcome")).toBe("refused");
    expect(outcome?.textContent).toContain(error);
  });

  it("BR-15 · reports a failed request with its error", async () => {
    const outcome = await submitted([
      request("req_1", "failed", [rootTrace("req_1", undefined, "failed", "board-not-declared: not this channel")]),
    ]);
    expect(outcome?.getAttribute("data-outcome")).toBe("failed");
    expect(outcome?.textContent).toContain("board-not-declared");
  });

  it("BR-15 · says the outcome is not visible when the request left no trace", async () => {
    const outcome = await submitted([request("req_1", "completed", [])]);
    expect(outcome?.getAttribute("data-outcome")).toBe("unknown");
    expect(outcome?.textContent).toMatch(/isn't visible/i);
  });

  it("BR-15 · shows a dispatch that threw, and keeps the form filled for a retry", async () => {
    const outcome = await submitted([], { error: "Network down" });
    expect(outcome?.getAttribute("data-outcome")).toBe("failed");
    expect(outcome?.textContent).toContain("Network down");
    expect(row().querySelector<HTMLInputElement>('[data-field="taskId"] input')?.value).toBe("task-a");
  });

  it("does not show the previous run's answer as the answer to the next one", async () => {
    // Run once and see it succeed; run again on the now-settled task. Until the
    // second run's own answer is in, the row must not still say "Done", or a
    // refusal would read as success for as long as the dispatch takes.
    let release: (value: { requestId: string }) => void = () => {};
    const run = vi
      .fn<RowActions["run"]>()
      .mockResolvedValueOnce({ requestId: "req_1" })
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const answered = [request("req_1", "completed", [rootTrace("req_1", { ok: true })])];
    const { rerender } = render(<Harness run={run} requests={answered} />);
    await open();
    await userEvent.click(within(row()).getByRole("button", { name: "cancelTask_issues" }));
    await userEvent.click(within(row()).getByRole("button", { name: /^run$/i }));
    expect(row().querySelector("[data-outcome]")?.getAttribute("data-outcome")).toBe("ok");

    await userEvent.click(within(row()).getByRole("button", { name: /^run$/i }));
    expect(row().querySelector("[data-outcome]")?.getAttribute("data-outcome")).toBe("pending");

    release({ requestId: "req_2" });
    const refused = rootTrace("req_2", { ok: false, error: "terminal_task_write_declined" });
    rerender(<Harness run={run} requests={[...answered, request("req_2", "completed", [refused])]} />);
    await screen.findByText(/Refused: terminal_task_write_declined/);
  });

  it("reads only the request it sent, not an older one on the same session", async () => {
    const outcome = await submitted([
      request("req_old", "completed", [rootTrace("req_old", { ok: true })]),
      request("req_1", "in_progress", []),
    ]);
    expect(outcome?.getAttribute("data-outcome")).toBe("pending");
  });
});
