/**
 * The gate a drain's idle worker reads before it pays a touch (FIX-2096).
 *
 * Paying lists the store on a resource-backed board, so the gate must say yes
 * only when the payer would cancel something now: the same rule
 * `payOwedCascades` applies. A debt that isn't due yet is the ending's own
 * pass to pay, and a debt whose dependents are already settled (only its
 * filed half owed, which may not be payable) cancels nothing on this board.
 * Either one read as owed would cost a store list on every idle turn.
 */
import { describe, expect, it } from "vitest";
import { owesATouch } from "../../src/tasks/collection/cascade";
import type { Task } from "../../src/tasks";

const NOW = 10_000;
const row = (fields: Partial<Task> & Pick<Task, "id" | "status">): Task =>
  ({ goal: fields.id, attempts: 0, createdAt: 0, updatedAt: 0, ...fields }) as Task;

describe("owesATouch", () => {
  it("is owed for a dependent behind a dependency whose debt is due", () => {
    const rows = [
      row({ id: "a", status: "errored", cascadeOwed: { due: NOW } }),
      row({ id: "b", status: "pending", deps: ["a"] }),
    ];
    expect(owesATouch(rows, NOW)).toBe(true);
  });

  it("is owed for a dependent behind an ended dependency with no debt: the sweep cancels it", () => {
    const rows = [row({ id: "a", status: "cancelled" }), row({ id: "b", status: "held", deps: ["a"] })];
    expect(owesATouch(rows, NOW)).toBe(true);
  });

  it("is not owed while the dependency's debt isn't due: the ending's own pass is paying it", () => {
    const rows = [
      row({ id: "a", status: "errored", cascadeOwed: { due: NOW + 1 } }),
      row({ id: "b", status: "pending", deps: ["a"] }),
    ];
    expect(owesATouch(rows, NOW)).toBe(false);
  });

  it("is not owed for a due debt with no dependent left to cancel", () => {
    // Only the filed half is owed, and a payer that can't reach its board
    // leaves it owed for good: the gate must not open on every idle turn.
    const rows = [
      row({ id: "a", status: "errored", cascadeOwed: { due: NOW - 1 } }),
      row({ id: "b", status: "cancelled", deps: ["a"] }),
    ];
    expect(owesATouch(rows, NOW)).toBe(false);
  });
});
