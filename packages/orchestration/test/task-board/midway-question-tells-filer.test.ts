/**
 * A task's midway question is told to its filer only when it is the asking
 * turn's own (FIX-2241): the question was recorded, or a replay of that turn was
 * declined after it was. A decline for any other reason leaves the row's
 * questions to the turn that asked them. And the telling never fails the
 * question: a throwing hook is logged, and an unknown filer is skipped.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { askMidway } from "../../src/task-board";
import { openWorkerClaimScope, stampCurrentClaim } from "../../src/task-board/flow-policy-wiring";
import type { TaskClaimTicket } from "../../src/tasks/claim-ticket";
import type { TaskCollectionRef } from "../../src/tasks";
import { newRowHolds } from "../../src/tasks/collection/holds";
import { createDelivery } from "../../src/tasks/notice/delivery";
import type { Task } from "../../src/tasks/schema/task";

const ticket: TaskClaimTicket = { collectionId: "board", taskId: "t1", attempt: 1, createdAt: 1, turn: 2 };
const ctx = { request: { identity: { id: "r_worker" }, incarnation: "i1" } } as unknown as BlockContext;

/** A held row with one open midway question, opened in `questionTurn`; `null` files it with no filer. */
function heldRow(questionTurn: number, filer: string | null = "conv_a"): Task {
  return {
    id: "t1",
    status: "held",
    attempts: 1,
    turn: 2,
    askedInTurn: questionTurn,
    holds: newRowHolds([{ kind: "question", prompt: "which region?" }], 0, { midway: true }),
    ...(filer !== null ? { filer: { sessionId: filer } } : {}),
  } as unknown as Task;
}

/** A ledger that answers a question with `outcome`, whose committed row is `row`, and which records each telling. */
function fakeLedger(outcome: Awaited<ReturnType<NonNullable<TaskCollectionRef["ask"]>>>, row: Task) {
  const told: Task[] = [];
  const ledger = {
    collectionId: "board",
    ask: async () => outcome,
    get: () => row,
    getCommitted: async () => row,
    tellMidwayQuestions: async (r: Task) => void told.push(r),
  } as unknown as TaskCollectionRef;
  return { ledger, told };
}

/** Put the question from a request holding `ticket`, in an async context of its own so the stamp can't leak. */
function questionAsWorker(ledger: TaskCollectionRef) {
  return new Promise<Awaited<ReturnType<typeof askMidway>>>((resolve, reject) => {
    setImmediate(() => {
      openWorkerClaimScope();
      stampCurrentClaim(ticket, ctx);
      askMidway(ctx, ledger, [{ prompt: "which region?" }]).then(resolve, reject);
    });
  });
}

describe("askMidway tells the filer only the asking turn's questions", () => {
  it("tells after the question is recorded", async () => {
    const { ledger, told } = fakeLedger({ outcome: "recorded", holds: ["hold_1"] } as never, heldRow(2));
    expect((await questionAsWorker(ledger)).ok).toBe(true);
    expect(told).toHaveLength(1);
  });

  it("tells again when a replay of the same turn is declined after its question was recorded", async () => {
    const { ledger, told } = fakeLedger({ outcome: "declined", reason: "lost-claim", status: "held" } as never, heldRow(2));
    expect((await questionAsWorker(ledger)).ok).toBe(false);
    expect(told).toHaveLength(1);
  });

  it("tells nothing when declined and the row's questions were asked by another turn", async () => {
    // The open question is turn 1's; this request holds turn 2's ticket.
    const { ledger, told } = fakeLedger({ outcome: "declined", reason: "lost-claim", status: "held" } as never, heldRow(1));
    expect((await questionAsWorker(ledger)).ok).toBe(false);
    expect(told).toHaveLength(0);
  });
});

describe("askMidway keeps the question when the telling's row read fails", () => {
  afterEach(() => vi.restoreAllMocks());

  it("answers the recorded question and logs the failed read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { ledger, told } = fakeLedger({ outcome: "recorded", holds: ["hold_1"] } as never, heldRow(2));
    (ledger as { getCommitted: unknown }).getCommitted = async () => {
      throw new Error("store unavailable");
    };
    expect(await questionAsWorker(ledger)).toEqual({ ok: true, holds: ["hold_1"] });
    expect(told).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/couldn't be read.*store unavailable/));
  });
});

describe("a board's telling of midway questions", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs a throwing hook and never fails the question", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const hooks = createDelivery(ctx, { onMidwayQuestion: async () => { throw new Error("send failed"); } }, { collectionId: "board" });
    await expect(hooks.tellMidwayQuestions!(heldRow(2))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("couldn't be told"), expect.objectContaining({ taskId: "t1", error: "send failed" }));
  });

  it("skips a row with no known filer, with a debug line", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const hook = vi.fn(async () => undefined);
    const hooks = createDelivery(ctx, { onMidwayQuestion: hook }, { collectionId: "board" });
    await hooks.tellMidwayQuestions!(heldRow(2, null));
    expect(hook).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(expect.stringContaining("no filer to tell"), expect.objectContaining({ taskId: "t1" }));
  });
});
