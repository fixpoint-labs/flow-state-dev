// @vitest-environment happy-dom
/**
 * A workstream's Board as design v2 draws it (v2:526-548): the five columns in
 * v2's order, each headed by its state square and count, and DONE as one line
 * per task, its id and title, instead of a card. A person scanning the board
 * reads left to right toward done; NEEDS YOU sits beside DONE, as v2 puts it.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Board } from "../src/components/Board";
import { toBoardRow } from "../src/lib/reads";

afterEach(cleanup);

const row = (id: string, status: string) => toBoardRow("t.c.work", "t.c", id, { id, title: `${id} title`, status, assignee: "builder" });

describe("the Board's columns", () => {
  it("draws them in v2's order, each headed by its state square and count", () => {
    render(<Board rows={[row("a", "in_progress"), row("b", "parked"), row("c", "pending")]} inReviewGap="gap" />);
    const columns = screen.getAllByTestId("board-column");
    expect(columns.map((c) => c.getAttribute("data-column"))).toEqual(["QUEUED", "RUNNING", "IN REVIEW", "NEEDS YOU", "DONE"]);
    const head = (column: string) => columns.find((c) => c.getAttribute("data-column") === column)!.querySelector("[data-look=column-head]")!;
    expect(head("NEEDS YOU").querySelector("[data-state-square]")?.getAttribute("data-state-square")).toBe("needs");
    expect(head("NEEDS YOU").textContent).toBe("NEEDS YOU1");
    expect(head("DONE").textContent).toBe("DONE0");
  });
});

describe("DONE", () => {
  it("draws a done task as one line, its id and title, carrying its stored status", () => {
    render(<Board rows={[row("shipped", "completed"), row("dropped", "cancelled"), row("live", "in_progress")]} inReviewGap="gap" />);
    const done = within(screen.getAllByTestId("board-column").find((c) => c.getAttribute("data-column") === "DONE")!);
    const lines = done.getAllByTestId("board-card");
    expect(lines.map((l) => [l.getAttribute("data-look"), l.textContent, l.getAttribute("data-status")])).toEqual([
      ["done-line", "shippedshipped title", "completed"],
      ["done-line", "droppeddropped title", "cancelled"],
    ]);
    // A task still open is a full card, its status word on it.
    const live = screen.getAllByTestId("board-card").find((c) => c.getAttribute("data-task-id") === "live")!;
    expect(live.getAttribute("data-look")).toBeNull();
    expect(within(live).getByTestId("board-card-status").textContent).toBe("in_progress");
  });
});
