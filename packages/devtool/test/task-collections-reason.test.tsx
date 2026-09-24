/**
 * The Tasks tab's Reason column (FIX-1481, ER-Devtool checklist row 4).
 *
 * A task carries a short note about itself on `feedback`, and until now the
 * only way to read it was the per-row JSON expander. The column renders it.
 *
 * The predicate is the PRESENCE OF THE FIELD, never the `parked` status. Three
 * verbs write it — parking for review, a failed attempt heading for a retry,
 * and resuming — so a `pending` row can legitimately carry one, and a
 * parked-keyed column would have to suppress it. The two rules that pin this
 * are BR-4 (a `pending` row with a note shows it) and BR-8 (a board where
 * nothing carries one grows no column); keying on status breaks one or the
 * other, so neither can be satisfied by accident.
 *
 * **Presence, not truthiness, and the value is rendered as stored.** BR-4 says
 * the predicate is the presence of the field and BR-3 says the field is
 * rendered as the row carries it. Both `awaitReview` and `unpark` accept an
 * empty or whitespace string through `z.string().optional()`, so that value
 * reaches the board as a real stored note. A panel whose job is to report what
 * the substrate holds has no business deciding that one is not worth showing,
 * and trimming on the way out would silently rewrite a stored value. The two
 * `whitespace` cases below are what hold that line.
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

  // BR-3's stale-note case (a task that failed, retried, then parked with no
  // reason) is no longer a view concern: parking with no reason now clears the
  // note, and that is asserted where it lives, in the orchestration
  // collection tests ("awaitReview with no reason clears a failed attempt's
  // note"). The view still renders the field exactly as the row carries it.

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

  it("BR-4 · whitespace · summons the column for a note that is only spaces", () => {
    // `awaitReview(id, "   ")` and `unpark(id, "")` both persist, because
    // `feedback` is `z.string().optional()` and neither verb rejects a blank.
    // So this is a row that genuinely carries a note, and the column is keyed
    // on the field being there — not on the value being worth reading.
    //
    // Suppressing it would hide the caller's bug in the one surface whose job
    // is to show what is stored, and it would make BR-4's predicate
    // "presence of the field" false as written.
    renderBoard({
      id: "task-blank",
      goal: "parked with a blank note",
      status: "parked",
      feedback: "   ",
    });

    expect(screen.getByRole("columnheader", { name: /reason/i })).toBeInTheDocument();
    expect(reasonCellOf("task-blank").textContent).toBe("   ");
  });

  it("BR-3 · whitespace · renders a note's surrounding spaces as stored", () => {
    // BR-3: "the field is rendered as the row carries it." Trimming here
    // would be a silent rewrite of a stored value — the same smoothing BR-3
    // forbids, arriving as a display convenience.
    renderBoard({ ...parkedWithReason, feedback: "  see the thread  " });

    expect(reasonCellOf("task-a").textContent).toBe("  see the thread  ");
    expect(reasonCellOf("task-a").getAttribute("title")).toBe("  see the thread  ");
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
