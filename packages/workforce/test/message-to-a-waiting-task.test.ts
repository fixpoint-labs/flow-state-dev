/**
 * A delivered message to a task waiting on something outside the board
 * (FIX-2578): in a task's session whose task holds an open `external` hold,
 * such as a coding task's wait on its pull request, the message answers that
 * wait instead of queueing behind it.
 *
 * Why it matters: the queue parks a message until the task's hold closes
 * (`./queue`). An external wait closes only when something answers it, so a
 * message queued behind one would never land, and the task would never hear
 * the news it waits for. The answer is the sender's, as `"service"`, so the
 * run reads the words quoted as theirs, never as the user's.
 *
 * Against a real sequencer-backed board, read off a hand-built context.
 */
import { describe, expect, it, vi } from "vitest";
import { createStateBackedTaskCollection } from "@flow-state-dev/orchestration/internal";
import { externalHoldOf, ticketForClaim } from "@flow-state-dev/orchestration/tasks";
import type { TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";

let ledger: TaskCollectionRef | undefined;

vi.mock("@flow-state-dev/orchestration/internal", async (original) => ({
  ...(await original<typeof import("@flow-state-dev/orchestration/internal")>()),
  findTaskPartitions: async () => ["alice"]
}));
vi.mock("../src/conversation-board/ledger", async (original) => ({
  ...(await original<typeof import("../src/conversation-board/ledger")>()),
  conversationLedgerAt: async () => ledger
}));

const { answerExternalWait } = await import("../src/messages/queue");

/** A board in memory: the two fields the sequencer backing reads. */
function memoryState() {
  let state: Record<string, unknown> = { tasks: {} };
  return {
    get state() {
      return state;
    },
    async atomicState(mutator: (s: Record<string, unknown>) => Record<string, unknown>) {
      state = { ...state, ...mutator(state) };
      return true;
    }
  };
}

/** Task `t1` running in session `s_task`, waiting on its pull request when `waiting`. */
async function board(waiting: boolean) {
  const ref = await createStateBackedTaskCollection({ collectionId: "conversations", state: memoryState() as never, now: () => 1_000 });
  await ref.createTask({ id: "t1", goal: "fix the bug" });
  const claimed = (await ref.claim("coder", { leaseDurationMs: 10_000 }))!;
  const claim = ticketForClaim("conversations", claimed);
  await ref.linkRun("t1", { sessionId: "s_task", requestId: "r_run", attempt: 1, startedAt: 1_000 } as never, { claim });
  if (waiting) {
    await ref.awaitExternal!("t1", { prompt: "Waiting for pull request #7 to merge or close.", events: [{ event: "pull-request", key: "github.com/acme/app/7" }] }, { claim });
  }
  ledger = ref;
  return ref;
}

const ctx = { session: { identity: { id: "s_task" }, state: { taskId: "t1" } }, resources: {} };
const message = { id: "msg_1", from: "github.reviewer", text: "Requested changes: rename foo" };

describe("a message to a task waiting on its pull request", () => {
  it("answers the wait with the sender's words, as the service, and owes the task its turn", async () => {
    const ref = await board(true);
    const holdId = externalHoldOf(ref.get("t1")!)!.id;
    expect(await answerExternalWait(ctx as never, message)).toBe(true);
    const row = ref.get("t1")!;
    expect(externalHoldOf(row)).toBeUndefined();
    expect(row.turnOwed).toBe(true);
    expect(row.steers).toEqual([expect.objectContaining({ message: message.text, from: "service", by: "github.reviewer", answers: holdId })]);
  });

  // A retry after the answer landed but delivery didn't finish (the item or the delivered mark
  // failed) must finish delivery, not run the message through an ordinary turn: its words
  // are on the task already.
  it("answers once for a copy sent again, and the copy still counts as taken by the wait", async () => {
    const ref = await board(true);
    expect(await answerExternalWait(ctx as never, message)).toBe(true);
    expect(await answerExternalWait(ctx as never, message)).toBe(true);
    expect(ref.get("t1")!.steers).toHaveLength(1);
  });

  it("counts a copy sent again as taken when another external wait opened meanwhile, leaving that wait open", async () => {
    const ref = await board(true);
    expect(await answerExternalWait(ctx as never, message)).toBe(true);
    const claim = ticketForClaim("conversations", ref.get("t1")! as never);
    await ref.awaitExternal!("t1", { prompt: "Waiting for pull request #8 to merge or close.", events: [{ event: "pull-request", key: "github.com/acme/app/8" }] }, { claim });
    const reopened = externalHoldOf(ref.get("t1")!);
    expect(reopened).toBeDefined();
    expect(await answerExternalWait(ctx as never, message)).toBe(true);
    expect(externalHoldOf(ref.get("t1")!)?.id).toBe(reopened!.id);
    expect(ref.get("t1")!.steers).toHaveLength(1);
  });

  it("leaves a task with no external wait to the queue, writing nothing", async () => {
    const ref = await board(false);
    expect(await answerExternalWait(ctx as never, message)).toBe(false);
    expect(ref.get("t1")!.steers ?? []).toEqual([]);
  });

  it("answers nothing from a session that runs no task", async () => {
    const ref = await board(true);
    expect(await answerExternalWait({ ...ctx, session: { identity: { id: "s_chat" }, state: {} } } as never, message)).toBe(false);
    expect(externalHoldOf(ref.get("t1")!)).toBeDefined();
  });
});
