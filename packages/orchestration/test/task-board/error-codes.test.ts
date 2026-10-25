/**
 * The task gate's refusals keep the `code` the README and the task-board page
 * document, so a caller's `.rescue()` (or a serialized request error) can
 * branch on it by value rather than by class identity across bundles.
 */
import { describe, expect, it } from "vitest";
import { StaleTaskClaimError, UnknownTaskLedgerError } from "../../src/task-board";

describe("the task gate's refusals carry their documented codes", () => {
  it("a stale dispatch is `stale-task-claim`, naming its task", () => {
    const error = new StaleTaskClaimError("t1", "the run link was refused (lost-claim)");
    expect(error.code).toBe("stale-task-claim");
    expect(error.taskId).toBe("t1");
  });

  it("a ledger the resolver doesn't answer for is `unknown-task-ledger`, naming the entry, task and ledger", () => {
    const error = new UnknownTaskLedgerError("implement", "t1", "list-x");
    expect(error.code).toBe("unknown-task-ledger");
    expect([error.entry, error.taskId, error.ledgerId]).toEqual(["implement", "t1", "list-x"]);
  });
});
