/**
 * The Tasks tab's Reason column (FIX-1481, ER-Devtool checklist row 4).
 *
 * A task carries a short note about itself on `feedback`, and until now the
 * only way to read it was the per-row JSON expander. The column renders it.
 *
 * The predicate is the PRESENCE OF THE NOTE, never the `parked` status. Three
 * verbs write the field — parking for review, a failed attempt heading for a
 * retry, and resuming — so a `pending` row can legitimately carry one, and a
 * parked-keyed column would have to suppress it. The two rules that pin this
 * are BR-4 (a `pending` row with a note shows it) and BR-8 (a board where
 * nothing carries one grows no column); keying on status breaks one or the
 * other, so neither can be satisfied by accident.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { TaskCollectionsView } from "../src/react/components/workspace/task-collections-view";
import type { Task, TaskStreamItem } from "../src/react/lib/task-collection-state";

/** One `task-change` item, so the fold produces a board carrying this task. */
function taskItem(task: Task, index = 0): TaskStreamItem {
  return {
    id: `item_${index}`,
    type: "component",
    status: "completed",
    requestId: "req_1",
    itemIndex: index,
    provenance: { blockName: "board", blockInstanceId: "b:0", phase: "main" },
    ts: 1_000 + index,
    component: "task-change",
    data: {
      collectionId: "issues",
      taskId: task.id,
      kind: "review_requested",
      task,
    },
  } as never as TaskStreamItem;
}

function renderBoard(...tasks: Task[]) {
  render(
    <TaskCollectionsView
      items={tasks.map((task, index) => taskItem(task, index))}
      childSessions={[]}
      truncation="complete"
      onOpenChildSession={vi.fn()}
    />
  );
}

/**
 * The Reason cell of the row whose id cell reads `taskId`, found by column
 * position rather than by a test-only hook on the markup.
 */
function reasonCellOf(taskId: string): HTMLElement {
  const headers = screen.getAllByRole("columnheader");
  const column = headers.findIndex((header) => /^reason$/i.test(header.textContent ?? ""));
  expect(column).toBeGreaterThan(-1);

  const row = screen
    .getAllByRole("row")
    .find((candidate) => candidate.querySelector("td")?.textContent === taskId);
  expect(row).toBeDefined();

  return Array.from(row!.querySelectorAll("td"))[column] as HTMLElement;
}

const parkedWithReason: Task = {
  id: "task-a",
  goal: "ship the thing",
  status: "parked",
  feedback: "Needs your call on the retry budget",
};

describe("the reason on a task row", () => {
  it("BR-1 · puts a parked row's reason on the row, with no expander opened", () => {
    renderBoard(parkedWithReason);

    // `getByText` reads rendered text content. The JSON expander is a closed
    // `<details>` holding one serialized blob, so a bare string match on the
    // reason cannot be satisfied by it.
    expect(screen.getByText("Needs your call on the retry budget")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /reason/i })).toBeInTheDocument();
  });

  it("BR-2 · shows an explicit nothing for a parked row nobody gave a reason", () => {
    // The column exists because the OTHER row has one. An empty cell here
    // would read as "no reason exists"; the dash says "this row carries
    // none", which is what the other columns already say when they have
    // nothing.
    renderBoard(parkedWithReason, {
      id: "task-b",
      goal: "the other thing",
      status: "parked",
    });

    // Read the dash out of the Reason column specifically. Two other columns
    // render a dash of their own, so an unscoped match would pass without the
    // Reason cell existing at all.
    expect(reasonCellOf("task-b").textContent).toBe("—");
  });

  it("BR-3 · leaves an earlier attempt's text on a row parked with no reason", () => {
    // TODAY'S BEHAVIOUR, asserted deliberately. `awaitReview` writes
    // `feedback` only when given one, so parking after a failed attempt does
    // not clear the failure text — the row genuinely still says that. The
    // clearing is an orchestration defect filed as a follow-up; the view
    // renders what the row carries rather than papering over it.
    //
    // When that defect is fixed this test goes red, and the red is the fix
    // landing, not a regression.
    renderBoard({
      id: "task-c",
      goal: "retry then park",
      status: "parked",
      feedback: "TypeError: cannot read property of undefined",
    });

    expect(
      screen.getByText("TypeError: cannot read property of undefined")
    ).toBeInTheDocument();
  });

  it("BR-4 · shows the note on a `pending` row that failed and was retried", () => {
    // The case that forbids keying the column on `parked`. `fail` patches the
    // row back to `pending` and captures the error on `feedback`, so this is
    // an ordinary board state and the note is the true explanation of it.
    renderBoard({
      id: "task-d",
      goal: "flaky step",
      status: "pending",
      feedback: "attempt 1 timed out",
    });

    expect(screen.getByText("attempt 1 timed out")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /reason/i })).toBeInTheDocument();
  });

  it("BR-5 · shows the text the unpark wrote, not the one it replaced", () => {
    // The fold holds the latest change per task id, so this asserts the view
    // reads that latest row rather than accumulating.
    render(
      <TaskCollectionsView
        items={[
          taskItem({ ...parkedWithReason, feedback: "the old reason" }, 0),
          taskItem(
            {
              ...parkedWithReason,
              status: "in_progress",
              feedback: "resumed: budget raised",
            },
            1
          ),
        ]}
        childSessions={[]}
        truncation="complete"
        onOpenChildSession={vi.fn()}
      />
    );

    expect(screen.getByText("resumed: budget raised")).toBeInTheDocument();
    expect(screen.queryByText("the old reason")).not.toBeInTheDocument();
  });

  it("BR-6 · keeps a long, unbroken or marked-up reason readable and the full text reachable", () => {
    const long = `<b>blocked</b> on ${"supercalifragilistic".repeat(12)}`;
    renderBoard({ ...parkedWithReason, feedback: long });

    const cell = screen.getByTitle(long);
    // Rendered as text: the markup is content, not markup. Were this ever
    // `dangerouslySetInnerHTML` the tag would vanish from `textContent`.
    expect(cell.textContent).toContain("<b>blocked</b>");
    expect(cell.querySelector("b")).toBeNull();
    // The cell is clamped, so one unbroken token cannot stretch the table.
    expect(cell.className).toContain("truncate");
    // ...and the whole string is still one hover away, so nothing is lost.
    expect(cell.getAttribute("title")).toBe(long);
  });

  it("BR-7 · leaves the per-row JSON expander exactly as it was", () => {
    renderBoard(parkedWithReason);

    const summary = screen.getByText("view");
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
  });

  it("BR-8 · grows no column at all when no row on the board carries one", () => {
    // Including parked rows. An always-present column would be an empty
    // column apologising for itself on every board that never parks anything.
    renderBoard(
      { id: "task-e", goal: "a", status: "parked" },
      { id: "task-f", goal: "b", status: "completed" }
    );

    expect(screen.queryByRole("columnheader", { name: /reason/i })).toBeNull();
    expect(screen.getByRole("columnheader", { name: /^status$/i })).toBeInTheDocument();
  });
});

describe("what row 4 may not do", () => {
  it("BR-18 · adds no Waiting-on-you column and no status of its own", () => {
    // *Waiting on you* stays a READING over parked-plus-reason (epic ER-2,
    // ER-8): the board shows the status and the reason, and the reader draws
    // the conclusion. The other half of BR-18 — that `TaskStatus` itself has
    // gained no value — is asserted on the exported union in
    // `packages/orchestration/test/schema/task.test.ts` ("status enum locks
    // the seven canonical statuses"), which is where a widening would have to
    // happen and where it already fails.
    renderBoard(parkedWithReason);

    for (const header of screen.getAllByRole("columnheader")) {
      expect(header.textContent ?? "").not.toMatch(/waiting/i);
    }
    expect(screen.getByText("parked")).toBeInTheDocument();
  });
});
