/**
 * Control for the Inbox check's independence (FIX-2133): the list's own
 * helper is broken here (its status filter dropped, so a finished row's kept
 * mirror lists), and the check must go red. It can only, because its truth
 * reads the rows' fields itself and never calls that helper.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/inbox/questions", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/inbox/questions")>();
  return {
    ...real,
    // The broken helper: any row's holds are open, whatever its status.
    openUserQuestions: (row: Parameters<typeof real.openUserQuestions>[0], ...rest: unknown[]) =>
      (real.openUserQuestions as (...args: unknown[]) => unknown)({ ...row, status: "in_progress" }, ...rest),
  };
});

const { inboxItems } = await import("../src/inbox");
const { reconcileInbox, rowTruthOf, taskItemId } = await import("../src/inbox/check");

describe("control broken-list-helper", () => {
  it("a list helper that lists a cancelled row's kept stop turns the check red", () => {
    // A cancel keeps the row's mirror until the cancelled resume it owes is paid.
    const cancelled = {
      board: "b.tasks",
      id: "t1",
      status: "cancelled",
      run: { sessionId: "run_t1", requestId: "req_t1" },
      questions: [
        {
          id: "sp1",
          actor: "user" as const,
          openedAt: 1,
          source: { kind: "suspension" as const, requestId: "req_t1", suspensionId: "sp1" },
          ask: { kind: "approval" as const, prompt: "Ship it?" },
        },
      ],
    };
    const items = inboxItems({ rows: [cancelled], suspensions: [], flowOf: () => "asker" });
    expect(items.map((i) => i.id)).toEqual([taskItemId("b.tasks", "t1")]);
    const result = reconcileInbox(items, { rows: rowTruthOf([cancelled]), suspensions: [] });
    expect(result.green).toBe(false);
    expect(result.orphan).toEqual([taskItemId("b.tasks", "t1")]);
  });
});
