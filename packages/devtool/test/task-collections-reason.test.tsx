/**
 * The Tasks tab's reason slot (FIX-1481, ER-Devtool checklist row 4; moved
 * onto the collapsed row by FIX-1629).
 *
 * A task carries a short note about itself on `feedback`, and the collapsed
 * row renders it beside the goal, so a retried row says why without opening.
 * A task waiting on a person shows what it was asked there instead: its open
 * question, or its run's stop (FIX-2131).
 *
 * The predicate is the PRESENCE OF THE FIELD, never a status. A failed attempt
 * heading for a retry writes it on a row that went back to `pending`, so a
 * status-keyed slot would have to suppress it. The two rules that pin this
 * are BR-4 (a `pending` row with a note shows it) and BR-8 (a board where
 * nothing carries one grows no slot); keying on status breaks one or the
 * other, so neither can be satisfied by accident.
 *
 * **Presence, not truthiness, and the value is rendered as stored.** BR-4 says
 * the predicate is the presence of the field and BR-3 says the field is
 * rendered as the row carries it. `feedback` is `z.string().optional()`, so an
 * empty or whitespace string reaches the board as a real stored note. A panel
 * whose job is to report what the substrate holds has no business deciding
 * that one is not worth showing, and trimming on the way out would silently
 * rewrite a stored value. The two `whitespace` cases below hold that line.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
      kind: "updated",
      task,
    },
  } as never as TaskStreamItem;
}

function renderBoard(...tasks: Task[]) {
  render(
    <TaskCollectionsView
      items={tasks.map((task, index) => taskItem(task, index))}
      dispatchRuns={[]}
      truncation="complete"
      onOpenDispatchRun={vi.fn()}
    />
  );
}

/** The reason slot of the row for `taskId`, found by task id rather than by text. */
function reasonCellOf(taskId: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`);
  expect(row).not.toBeNull();
  const slot = row!.querySelector<HTMLElement>('[data-slot="reason"]');
  expect(slot).not.toBeNull();
  return slot!;
}

/** Whether any row on the page carries a reason slot. */
function anyReasonSlot(): boolean {
  return document.querySelector('[data-slot="reason"]') !== null;
}

const notedRow: Task = {
  id: "task-a",
  goal: "ship the thing",
  status: "pending",
  feedback: "Needs your call on the retry budget",
};

/** A running task held on its worker's question. */
const heldOnQuestion: Task = {
  id: "task-q",
  goal: "pick a region",
  status: "in_progress",
  questions: [{ id: "q1", source: { kind: "row" }, ask: { kind: "question", prompt: "Which region, eu-west or us-east?" } }],
};

describe("the reason on a task row", () => {
  it("BR-1 · puts a row's reason on the row, with no expander opened", () => {
    renderBoard(notedRow);

    // Read with the row collapsed: the open row lists the reason too, so a
    // match there would not prove the collapsed row shows it.
    expect(reasonCellOf("task-a").textContent).toBe("Needs your call on the retry budget");
  });

  it("BR-2 · shows an explicit nothing for a row nobody gave a reason", () => {
    // The slot exists because the OTHER row has one. An empty slot here
    // would read as "no reason exists"; the dash says "this row carries
    // none", which is what the other slots already say when they have
    // nothing.
    renderBoard(notedRow, {
      id: "task-b",
      goal: "the other thing",
      status: "pending",
    });

    // Read the dash out of the reason slot specifically. Two other slots
    // render a dash of their own, so an unscoped match would pass without the
    // reason slot existing at all.
    expect(reasonCellOf("task-b").textContent).toBe("—");
  });

  it("BR-4 · shows the note on a `pending` row that failed and was retried", () => {
    // The case that forbids keying the slot on a status. `fail` patches the
    // row back to `pending` and captures the error on `feedback`, so this is
    // an ordinary board state and the note is the true explanation of it.
    renderBoard({
      id: "task-d",
      goal: "flaky step",
      status: "pending",
      feedback: "attempt 1 timed out",
    });

    expect(reasonCellOf("task-d").textContent).toBe("attempt 1 timed out");
  });

  it("BR-5 · shows the latest note, not the one it replaced", () => {
    // The fold holds the latest change per task id, so this asserts the view
    // reads that latest row rather than accumulating.
    render(
      <TaskCollectionsView
        items={[
          taskItem({ ...notedRow, feedback: "the old reason" }, 0),
          taskItem(
            {
              ...notedRow,
              status: "in_progress",
              feedback: "resumed: budget raised",
            },
            1
          ),
        ]}
        dispatchRuns={[]}
        truncation="complete"
        onOpenDispatchRun={vi.fn()}
      />
    );

    expect(screen.getByText("resumed: budget raised")).toBeInTheDocument();
    expect(screen.queryByText("the old reason")).not.toBeInTheDocument();
  });

  it("BR-4 · whitespace · summons the slot for a note that is only spaces", () => {
    // A blank note persists, because `feedback` is `z.string().optional()`.
    // So this is a row that genuinely carries a note, and the slot is keyed
    // on the field being there — not on the value being worth reading.
    //
    // Suppressing it would hide the caller's bug in the one surface whose job
    // is to show what is stored, and it would make BR-4's predicate
    // "presence of the field" false as written.
    renderBoard({
      id: "task-blank",
      goal: "a blank note",
      status: "pending",
      feedback: "   ",
    });

    expect(reasonCellOf("task-blank").textContent).toBe("   ");
  });

  it("BR-3 · whitespace · renders a note's surrounding spaces as stored", () => {
    // BR-3: "the field is rendered as the row carries it." Trimming here
    // would be a silent rewrite of a stored value — the same smoothing BR-3
    // forbids, arriving as a display convenience.
    renderBoard({ ...notedRow, feedback: "  see the thread  " });

    expect(reasonCellOf("task-a").textContent).toBe("  see the thread  ");
    expect(reasonCellOf("task-a").getAttribute("title")).toBe("  see the thread  ");
  });

  it("BR-6 · keeps a long, unbroken or marked-up reason readable and the full text reachable", () => {
    const long = `<b>blocked</b> on ${"supercalifragilistic".repeat(12)}`;
    renderBoard({ ...notedRow, feedback: long });

    const cell = reasonCellOf("task-a");
    // Rendered as text: the markup is content, not markup. Were this ever
    // `dangerouslySetInnerHTML` the tag would vanish from `textContent`.
    expect(cell.textContent).toContain("<b>blocked</b>");
    expect(cell.querySelector("b")).toBeNull();
    // The slot is clamped, so one unbroken token cannot stretch the row.
    expect(cell.className).toContain("truncate");
    // ...and the whole string is still one hover away, so nothing is lost.
    expect(cell.getAttribute("title")).toBe(long);
  });

  it("BR-7 · keeps the full record one open away, inside the row", async () => {
    // Amended by FIX-1629: no floating expander. The raw record is folded
    // inside the open row, complete (asserted in task-collections-rows).
    renderBoard(notedRow);

    expect(document.querySelector("details")).toBeNull();
    const row = document.querySelector<HTMLElement>('[data-task-id="task-a"]')!;
    await userEvent.click(within(row).getAllByRole("button")[0]!);
    expect(within(row).getByRole("button", { name: /raw json/i })).toBeInTheDocument();
  });

  it("BR-8 · grows no slot at all when no row on the board carries one", () => {
    // Including running rows. An always-present slot would be an empty
    // one apologising for itself on every board that never notes anything.
    renderBoard(
      { id: "task-e", goal: "a", status: "in_progress" },
      { id: "task-f", goal: "b", status: "completed" }
    );

    expect(anyReasonSlot()).toBe(false);
    expect(document.querySelector('[data-task-id="task-e"] [data-slot="status"]')).not.toBeNull();
  });
});

describe("a task waiting on a person", () => {
  it("shows the open question as the row's reason, over any note", () => {
    // A held task is `in_progress`, so its status says nothing about why it
    // stopped: the question is the only answer to "what is it waiting for".
    renderBoard({ ...heldOnQuestion, feedback: "attempt 1 timed out" });

    expect(reasonCellOf("task-q").textContent).toBe("Which region, eu-west or us-east?");
    expect(reasonCellOf("task-q").getAttribute("title")).toBe("Which region, eu-west or us-east?");
  });

  it("drops the question once a message answers it", () => {
    // An answered question no longer holds the task, so the reason must not
    // keep saying it waits: the answer closes the hold by naming its id.
    renderBoard({ ...heldOnQuestion, steers: [{ id: "s1", message: "eu-west", answers: "q1" }] });

    expect(anyReasonSlot()).toBe(false);
  });

  it("shows a run's stop for a review the same way", () => {
    renderBoard({
      id: "task-r",
      goal: "draft the post",
      status: "in_progress",
      questions: [{ id: "susp_1", source: { kind: "suspension" }, ask: { kind: "review", prompt: "Does this draft read right?" } }],
    });

    expect(reasonCellOf("task-r").textContent).toBe("Does this draft read right?");
  });

  it("shows nothing waiting on a settled task, whatever holds it kept", () => {
    renderBoard({ ...heldOnQuestion, status: "cancelled" });

    expect(anyReasonSlot()).toBe(false);
  });
});

describe("what row 4 may not do", () => {
  it("BR-18 · adds no Waiting-on-you slot and no status of its own", () => {
    // *Waiting on you* stays a READING over status-plus-reason (epic ER-2,
    // ER-8): the board shows the status and the reason, and the reader draws
    // the conclusion. The other half of BR-18 — that `TaskStatus` itself has
    // gained no value — is asserted on the exported union in
    // `packages/orchestration/test/schema/task.test.ts` ("status enum locks
    // the seven canonical statuses"), which is where a widening would have to
    // happen and where it already fails.
    renderBoard(heldOnQuestion);

    expect(document.body.textContent ?? "").not.toMatch(/waiting on you/i);
    expect(screen.getByText("in_progress")).toBeInTheDocument();
  });
});
