/**
 * The Tasks tab's rows: a task opens in place, like an accordion.
 *
 * Reading a task used to mean a JSON block floating over the table, clipped at
 * the pane's edge. A row now leads with what a reader scans for (status, then
 * goal and reason), and opens below itself to show everything the task
 * carries, with the raw record folded at the bottom.
 *
 * Rows are found by task id (`data-task-id`), never by their text, so a leg
 * cannot pass by matching the same words somewhere else on the page.
 */
import { describe, expect, it, vi } from "vitest";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { TaskCollectionsView } from "../src/react/components/workspace/task-collections-view";
import type { Task, TaskStreamItem } from "../src/react/lib/task-collection-state";

function taskItem(task: Task, index = 0, kind = "review_requested", collectionId = "issues"): TaskStreamItem {
  return {
    id: `item_${collectionId}_${index}`,
    type: "component",
    status: "completed",
    requestId: "req_1",
    itemIndex: index,
    provenance: { blockName: "board", blockInstanceId: "b:0", phase: "main" },
    ts: 1_000 + index,
    component: "task-change",
    data: { collectionId, taskId: task.id, kind, task },
  } as never as TaskStreamItem;
}

function view(items: TaskStreamItem[]) {
  return (
    <TaskCollectionsView
      items={items}
      dispatchRuns={[]}
      truncation="complete"
      onOpenDispatchRun={vi.fn()}
    />
  );
}

function rowOf(taskId: string, collectionId = "issues"): HTMLElement {
  const row = document.querySelector<HTMLElement>(
    `[data-collection-id="${collectionId}"] [data-task-id="${taskId}"]`
  );
  expect(row).not.toBeNull();
  return row!;
}

function toggleOf(taskId: string, collectionId = "issues"): HTMLElement {
  return within(rowOf(taskId, collectionId)).getAllByRole("button")[0]!;
}

const full: Task = {
  id: "task-full",
  goal: "Answer the customer about their refund, with the whole policy quoted",
  title: "Refund question",
  status: "parked",
  attempts: 1,
  maxAttempts: 3,
  assignee: "support.accounts",
  priority: 2,
  labels: ["billing", "vip"],
  deps: ["task-zero"],
  feedback: "Needs a person to confirm the exception",
  error: "timed out once",
  input: { question: "where is my refund" },
  output: { draft: "hello" },
  metadata: { author: "support.general" },
  revision: 4,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
  leaseUntil: 1_700_000_200_000,
};

describe("a collapsed row", () => {
  it("BR-1 · leads with status, then goal, then reason", () => {
    render(view([taskItem(full)]));

    const slots = Array.from(rowOf("task-full").querySelectorAll("[data-slot]")).map((el) =>
      el.getAttribute("data-slot")
    );
    expect(slots.slice(0, 3)).toEqual(["status", "goal", "reason"]);
  });

  it("BR-1 · clamps goal and reason to one line with the full text on hover", () => {
    render(view([taskItem(full)]));

    const goal = rowOf("task-full").querySelector<HTMLElement>('[data-slot="goal"]')!;
    const reason = rowOf("task-full").querySelector<HTMLElement>('[data-slot="reason"]')!;
    expect(goal.className).toContain("truncate");
    expect(goal.getAttribute("title")).toBe(full.goal);
    expect(reason.className).toContain("truncate");
    expect(reason.getAttribute("title")).toBe(full.feedback);
  });

  it("BR-2 · lets goal and reason shrink rather than push the row wider", () => {
    // The flexible cells are `minmax(0, 1fr)`: without the zero minimum a grid
    // track grows to its content, and the reason is what gets pushed off screen.
    render(view([taskItem(full)]));

    const grid = rowOf("task-full").querySelector<HTMLElement>("[data-row-grid]")!;
    expect(grid.style.gridTemplateColumns).toContain("minmax(0, 1fr) minmax(0, 1fr)");
  });

  it("BR-3 · is collapsed until asked, with the disclosure wired", () => {
    render(view([taskItem(full)]));

    const toggle = toggleOf("task-full");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const controls = toggle.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls!)).toBeNull();
  });
});

describe("opening a row", () => {
  it("BR-3 · opens in place, below itself, on a click", async () => {
    render(view([taskItem(full)]));

    await userEvent.click(toggleOf("task-full"));

    const toggle = toggleOf("task-full");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const body = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(body).not.toBeNull();
    // Inside its own row, not floated over the list.
    expect(rowOf("task-full").contains(body)).toBe(true);
    expect(body!.className).not.toMatch(/absolute|fixed|w-\[28rem\]/);
  });

  it("BR-3 · opens from the keyboard", async () => {
    render(view([taskItem(full)]));

    toggleOf("task-full").focus();
    await userEvent.keyboard("{Enter}");
    expect(toggleOf("task-full").getAttribute("aria-expanded")).toBe("true");

    await userEvent.keyboard(" ");
    expect(toggleOf("task-full").getAttribute("aria-expanded")).toBe("false");
  });

  it("BR-4 · shows every field the task carries", async () => {
    render(view([taskItem(full)]));
    await userEvent.click(toggleOf("task-full"));

    const body = within(rowOf("task-full"));
    for (const label of [
      "Id",
      "Goal",
      "Title",
      "Status",
      "Attempts",
      "Assignee",
      "Priority",
      "Labels",
      "Deps",
      "Reason",
      "Error",
      "Input",
      "Output",
      "Metadata",
      "Revision",
      "Created",
      "Updated",
      "Lease until",
      "Latest change",
    ]) {
      expect(body.getByText(label, { selector: "dt" })).toBeInTheDocument();
    }
    const field = (label: string) =>
      body.getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;
    expect(field("Goal").textContent).toBe(full.goal);
    expect(field("Attempts").textContent).toBe("1 / 3");
    expect(field("Labels").textContent).toBe("billing, vip");
    expect(field("Deps").textContent).toBe("task-zero");
    expect(field("Reason").textContent).toBe(full.feedback);
    expect(field("Input").textContent).toContain("where is my refund");
    expect(field("Latest change").textContent).toContain("review_requested");
  });

  it("BR-4 · shows a carried field the list has no label for, under its own name", async () => {
    // The ledger carries more than the named list (retry and write-provenance
    // fields, and whatever a later substrate adds). Every one is shown, not
    // only in the folded raw record.
    const carried = {
      ...full,
      id: "task-extra",
      retryLedger: [{ attempt: 1, error: "timed out" }],
      abandonments: 2,
      leaseDurationMs: 30_000,
      writeLog: [{ id: "w1", revision: 4 }],
      writeLogTruncated: false,
      incarnationId: "inc-7f3",
    } as Task;
    render(view([taskItem(carried)]));
    await userEvent.click(toggleOf("task-extra"));

    const body = within(rowOf("task-extra"));
    const field = (label: string) =>
      body.getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;
    expect(field("retryLedger").textContent).toContain("timed out");
    expect(field("abandonments").textContent).toBe("2");
    expect(field("leaseDurationMs").textContent).toBe("30000");
    expect(field("writeLog").textContent).toContain("w1");
    expect(field("writeLogTruncated").textContent).toBe("false");
    expect(field("incarnationId").textContent).toBe("inc-7f3");
    // A field the list already names is not shown twice under its raw key.
    expect(body.queryByText("goal", { selector: "dt" })).toBeNull();
    expect(body.queryByText("feedback", { selector: "dt" })).toBeNull();
  });

  it("BR-4 · shows a carried empty list as empty, apart from an absent one", async () => {
    // `labels: []` is a field the task carries; hiding it reads the same as a
    // task that has no labels field at all.
    render(view([taskItem({ id: "task-empty", goal: "empty", status: "pending", labels: [], deps: [] })]));
    await userEvent.click(toggleOf("task-empty"));

    const body = within(rowOf("task-empty"));
    const field = (label: string) =>
      body.getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;
    expect(field("Labels").textContent).toBe("none");
    expect(field("Deps").textContent).toBe("none");
  });

  it("BR-4 · omits a field the task does not carry, rather than faking it", async () => {
    render(view([taskItem({ id: "task-bare", goal: "bare", status: "pending" })]));
    await userEvent.click(toggleOf("task-bare"));

    const body = within(rowOf("task-bare"));
    expect(body.getByText("Status", { selector: "dt" })).toBeInTheDocument();
    for (const absent of ["Title", "Reason", "Error", "Input", "Output", "Metadata", "Revision", "Labels", "Deps"]) {
      expect(body.queryByText(absent, { selector: "dt" })).toBeNull();
    }
  });

  it("BR-5 · keeps the raw record folded inside the row, complete and unchanged", async () => {
    render(view([taskItem(full)]));
    await userEvent.click(toggleOf("task-full"));

    const row = within(rowOf("task-full"));
    const fold = row.getByRole("button", { name: /raw json/i });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(rowOf("task-full").querySelector("pre")).toBeNull();

    await userEvent.click(fold);
    const pre = rowOf("task-full").querySelector("pre[data-raw-json]") ?? rowOf("task-full").querySelector("pre");
    expect(JSON.parse(pre!.textContent!)).toEqual(full);
  });

  it("BR-6 · stays open, showing new values, when the task changes underneath it", async () => {
    const { rerender } = render(view([taskItem(full)]));
    await userEvent.click(toggleOf("task-full"));

    rerender(view([taskItem(full), taskItem({ ...full, status: "pending", feedback: "answered" }, 1, "resumed")]));

    expect(toggleOf("task-full").getAttribute("aria-expanded")).toBe("true");
    const reasonField = within(rowOf("task-full")).getByText("Reason", { selector: "dt" })
      .nextElementSibling as HTMLElement;
    expect(reasonField.textContent).toBe("answered");
  });

  it("BR-6 · keeps two rows open at once, and a same-id task on another board separate", async () => {
    render(
      view([
        taskItem({ id: "a", goal: "first", status: "pending" }, 0),
        taskItem({ id: "b", goal: "second", status: "pending" }, 1),
        taskItem({ id: "a", goal: "elsewhere", status: "pending" }, 2, "added", "other"),
      ])
    );
    await userEvent.click(toggleOf("a"));
    await userEvent.click(toggleOf("b"));

    expect(toggleOf("a").getAttribute("aria-expanded")).toBe("true");
    expect(toggleOf("b").getAttribute("aria-expanded")).toBe("true");
    // Open state is keyed by board and task, so the other board's "a" is its own row.
    expect(toggleOf("a", "other").getAttribute("aria-expanded")).toBe("false");
  });

  it("BR-7 · contains a huge, marked-up or unbroken value inside the row", async () => {
    const token = "x".repeat(4000);
    render(view([taskItem({ id: "task-long", goal: `<b>${token}</b>`, status: "pending", input: token })]));
    await userEvent.click(toggleOf("task-long"));

    const goalField = within(rowOf("task-long")).getByText("Goal", { selector: "dt" })
      .nextElementSibling as HTMLElement;
    // Text, not markup.
    expect(goalField.querySelector("b")).toBeNull();
    expect(goalField.textContent).toContain("<b>");
    // Wraps anywhere, so one unbroken token cannot widen the pane.
    expect(goalField.className).toMatch(/break-all|break-words|\[overflow-wrap:anywhere\]/);
    const inputField = within(rowOf("task-long")).getByText("Input", { selector: "dt" })
      .nextElementSibling as HTMLElement;
    expect(inputField.innerHTML).toMatch(/overflow-auto|break-all|\[overflow-wrap:anywhere\]/);
  });
});

describe("a row that cannot render", () => {
  it("does not blank the tab: the other rows still show, and the bad one says so", () => {
    // A task the view cannot draw (a goal that is not text) must cost its own
    // row, never the whole board.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        view([
          taskItem({ id: "bad", goal: { not: "text" } as never, status: "pending" }, 0),
          taskItem({ id: "good", goal: "still readable", status: "pending" }, 1),
        ])
      );
    } finally {
      spy.mockRestore();
    }

    expect(within(rowOf("good")).getByText("still readable")).toBeInTheDocument();
    expect(rowOf("bad").textContent).toMatch(/could not be drawn/i);
  });
});
