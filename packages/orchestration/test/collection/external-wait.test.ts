/**
 * An external wait (FIX-2578), on both backings: the turn holding a task's
 * claim waits on something outside the board, such as its pull request.
 *
 * What a person relies on, each against the committed row:
 *
 * - **It holds like a midway question.** The row stays `in_progress` on its
 *   attempt with no lease, the claim and the lease reclaim skip it, and a
 *   settle on the waiting turn is refused.
 * - **It is the system's, not a person's.** `actor: "system"`, never
 *   `midway`, so the filer is not told and the Inbox does not list it, and
 *   the readers that say "waiting on a user" don't say it of this row.
 * - **Any line wakes it.** A person's line typed in the task's session, or a
 *   delivered message (`"service"`), answers it, and the release owes the same
 *   attempt one more turn, which the claim takes.
 * - **It survives a restart**: a new ref over the same store reads it back.
 * - **A cancel ends it.**
 */
import { describe, expect, it } from "vitest";
import {
  externalHoldOf,
  isExternalHold,
  openHolds,
  ticketForClaim,
  holdActorOf,
  type ExternalWait,
  type Task,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createResourceBackedTaskCollection } from "../../src/tasks/collection/resource-backed";
import { createStateBackedTaskCollection } from "../../src/tasks/collection/state-backed";
import { taskHoldSchema } from "../../src/tasks/schema/hold";
import { steerFromLine, shownSteer } from "../../src/tasks/steers";
import { renderSteers } from "../../src/skills/steer-context";
import { waitsOnHold, waitsOnUser } from "../../src/task-board/shared";
import { openUserHolds } from "../../src/inbox/holds";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

const WAIT: ExternalWait = {
  prompt: "Waiting on pull request #7 to merge or close.",
  events: [{ event: "pull-request", key: "github.com/acme/app/7" }],
};

type Make = () => Promise<{ board: TaskCollectionRef; reopen: () => Promise<TaskCollectionRef> }>;

const sequencerBacking: Make = async () => {
  const state = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  const open = async () => createStateBackedTaskCollection({ collectionId: "tasks", state, now: () => 1_000 });
  return { board: await open(), reopen: open };
};

const resourceBacking: Make = async () => {
  const collection = createFakeResourceCollection();
  const open = () => createResourceBackedTaskCollection({ collectionId: "tasks", collection, now: () => 1_000 });
  return { board: await open(), reopen: open };
};

describe.each([
  ["sequencer-backed", sequencerBacking],
  ["resource-backed", resourceBacking],
])("a task waiting on something outside the board (%s)", (_name, make) => {
  /** Claimed, then waiting externally from the turn holding the claim. */
  async function waiting() {
    const made = await make();
    await made.board.createTask({ id: "t", goal: "fix the bug" });
    const claimed = (await made.board.claim("w", { leaseDurationMs: 10_000 }))!;
    const ticket = ticketForClaim("tasks", claimed);
    const outcome = await made.board.awaitExternal!("t", WAIT, { claim: ticket });
    return { ...made, ticket, outcome };
  }

  it("holds the row as a midway question does: running, no lease, unclaimable, unsettleable by its turn", async () => {
    const { board, ticket, outcome } = await waiting();
    expect(outcome).toMatchObject({ outcome: "recorded" });
    const row = board.get("t")!;
    expect(row).toMatchObject({ status: "in_progress", attempts: 1 });
    expect(row.leaseUntil).toBeUndefined();
    expect(openHolds(row)).toEqual([
      {
        id: outcome.questions![0],
        actor: "system",
        openedAt: 1_000,
        source: { kind: "row", closedBy: [{ by: "event", event: "pull-request", key: "github.com/acme/app/7" }] },
        ask: { kind: "external", prompt: WAIT.prompt },
      },
    ]);
    // Never midway: the filer is not told of it as a question.
    expect(openHolds(row)[0]).not.toHaveProperty("midway");
    expect(await board.claim("w")).toBeNull();
    expect(await board.reclaim()).toBe(0);
    // The waiting turn can't complete the task over its own wait.
    expect(await board.complete("t", { done: true }, { claim: ticket })).toMatchObject({ outcome: "declined" });
    expect(board.get("t")!.status).toBe("in_progress");
  });

  it("is the system's: the readers that say 'waiting on a user' don't say it, and the Inbox does not list it", async () => {
    const { board } = await waiting();
    const row = board.get("t")!;
    expect(holdActorOf(row)).toBe("system");
    expect(waitsOnUser(row)).toBe(false);
    // Nothing in a drain moves it, so it is excused as a user's wait is.
    expect(waitsOnHold(row)).toBe(true);
    expect(openUserHolds({ ...row, holder: null } as never, () => "flow")).toEqual([]);
  });

  it("a person's line typed in the session answers it, and the release owes the same attempt one more turn", async () => {
    const { board } = await waiting();
    const refused = await steerFromLine(board, "t", "fix the lint", { user: { identity: { userId: "alice" } }, request: { identity: { id: "req_line" } } });
    expect(refused).toBeUndefined();
    const row = board.get("t")!;
    expect(openHolds(row)).toEqual([]);
    expect(row.turnOwed).toBe(true);
    expect(row.steers).toEqual([expect.objectContaining({ message: "fix the lint", from: "user", by: "alice", answers: externalId(row) })]);
    // The owed turn, on the same attempt.
    expect(await board.claim("w", { leaseDurationMs: 10_000 })).toMatchObject({ id: "t", attempts: 1, turn: 2 });
  });

  it("a delivered message answers it as the service, its words shown quoted as the sender's, never as the user's", async () => {
    const { board } = await waiting();
    const holdId = externalHoldOf(board.get("t")!)!.id;
    const answered = await board.answer!("t", { questionId: holdId, message: "Requested changes: rename foo", from: "service", by: "octo-reviewer", key: "message:m1" });
    expect(answered).toMatchObject({ outcome: "recorded" });
    const row = board.get("t")!;
    expect(row.turnOwed).toBe(true);
    const steer = row.steers![0]!;
    expect(steer).toMatchObject({ from: "service", by: "octo-reviewer", answers: holdId });
    const line = renderSteers([shownSteer(row, steer)], "Messages:");
    expect(line).toContain('From octo-reviewer (outside this app), quoted: "Requested changes: rename foo"');
    expect(line).not.toContain("the user");
  });

  it("survives a restart: a new ref over the same store reads the wait back, and it still holds", async () => {
    const { reopen } = await waiting();
    const fresh = await reopen();
    const row = fresh.get("t")!;
    const hold = externalHoldOf(row);
    expect(hold?.actor).toBe("system");
    expect(hold !== undefined && isExternalHold(hold)).toBe(true);
    expect(taskHoldSchema.parse(hold)).toEqual(hold);
    expect(await fresh.claim("w")).toBeNull();
  });

  it("a cancel ends it", async () => {
    const { board } = await waiting();
    await board.cancel("t", "its pull request was closed without merging");
    const row = board.get("t")!;
    expect(row.status).toBe("cancelled");
    expect(openHolds(row)).toEqual([]);
    expect(holdActorOf(row)).toBeUndefined();
  });

  it("refuses a wait on nothing, writing nothing", async () => {
    const made = await make();
    await made.board.createTask({ id: "t", goal: "g" });
    const claimed = (await made.board.claim("w", { leaseDurationMs: 10_000 }))!;
    await expect(made.board.awaitExternal!("t", { prompt: "waiting", events: [] }, { claim: ticketForClaim("tasks", claimed) })).rejects.toThrow(/no event/);
    expect(made.board.get("t")!.holds).toBeUndefined();
  });
});

function externalId(row: Task): string | undefined {
  return row.holds?.find((hold) => hold.ask.kind === "external")?.id;
}
