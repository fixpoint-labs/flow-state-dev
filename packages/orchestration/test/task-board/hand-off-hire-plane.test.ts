/**
 * A board drain cannot hand a claimed row to a hired seat its session is
 * outside.
 *
 * A hired seat is a flow instance registered with a pin, `{ orgId, userId? }`.
 * A board seat that names that instance hands its rows off through the
 * dispatch seam. The session running the drain is the principal the child
 * would run as, so a board in another organization, or a teammate's board
 * aimed at a private seat, must be refused at the seam: the seat's block never
 * runs, no session is minted on the seat, and the row is not left claimed by
 * a child that was never going to run it.
 *
 * Refused the way an address this process does not hold is refused, so the
 * board cannot tell a seat it may not use from a seat that does not exist.
 * The owner's drain through the same board and the same seats runs, so an
 * empty worker log below is the refusal and not a hand-off that never starts.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import { defineTaskCollection, type Task, type TaskWorkerInput } from "../../src/tasks";
import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";

const BOARD_ID = "org-work";
const LEDGER_ID = "org-work-ledger";
/** Pinned to the acme organization. */
const LEAD = "acme.eng.lead";
/** Pinned to alice inside acme. */
const RESEARCH = "acme.~alice.research";
/** Registered nowhere. */
const GHOST = "acme.eng.ghost";

type Who = { userId: string; orgId: string };
const ALICE: Who = { userId: "alice", orgId: "acme" };
const BOB: Who = { userId: "bob", orgId: "acme" };
const MALLORY: Who = { userId: "mallory", orgId: "globex" };

/** One org-scoped ledger, the same logical board on the board flow and on the seat. */
const ledger = () => defineTaskCollection({ id: LEDGER_ID, scope: "org" });

/** The hired seat kind. Its own board exists to bind the claim gate on `work`. */
function seatKind(ran: string[]) {
  const worker = handler({
    name: "seat-work",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ handled: z.string() }),
    execute: (input: TaskWorkerInput, ctx) => {
      const { userId, orgId } = ctx.session.identity;
      ran.push(`${(ctx.flow as { id: string }).id} ${input.taskId} as ${userId}@${orgId}`);
      return { handled: input.taskId };
    },
  });
  const board = taskBoard({
    name: "seat-board",
    boardId: BOARD_ID,
    collection: ledger(),
    workers: {
      work: dispatcher<TaskWorkerInput>({ name: "seat-hand-off", action: "work", session: "per-task" }),
    },
  });
  return defineFlow({
    kind: "seat",
    cardinality: "collection",
    actions: { drain: { block: board.drain } },
    task: { actions: { work: { block: worker } } },
  });
}

/** The org board. Each row's assignee is a seat that hands off to one hired instance. */
function boardFlow() {
  const seat = (name: string, flowKind: string) =>
    dispatcher<TaskWorkerInput>({ name, flowKind, action: "work", session: "per-task" });
  const board = taskBoard({
    name: "org-board",
    boardId: BOARD_ID,
    collection: ledger(),
    workers: {
      lead: seat("to-lead", LEAD),
      research: seat("to-research", RESEARCH),
      ghost: seat("to-ghost", GHOST),
    },
    initialTasks: [
      { id: "t-lead", goal: "lead work", assignee: "lead", input: {} },
      { id: "t-research", goal: "research work", assignee: "research", input: {} },
      { id: "t-ghost", goal: "work for nobody", assignee: "ghost", input: {} },
    ],
  });
  return defineFlow({ kind: "board", actions: { start: { block: board.drain } } })({ id: "board" });
}

async function boot() {
  const ran: string[] = [];
  const kind = seatKind(ran);
  const board = boardFlow();
  const state = createFlowState({
    flows: { board },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({}),
  });
  state.register(kind({ id: LEAD }), { pin: { orgId: "acme" } });
  state.register(kind({ id: RESEARCH }), { pin: { orgId: "acme", userId: "alice" } });
  const runtime: FlowStateRuntime = await state.getRuntime();

  const row = async (who: Who, taskId: string) =>
    (await runtime.stores.resourceState.get("org", who.orgId, `${LEDGER_ID}/${taskId}`))?.state as
      | Task
      | undefined;

  /** Drain the board as `who`, then wait until no row is still in flight. */
  const drain = async (who: Who) => {
    const parent = await runAction({
      orgId: who.orgId,
      flow: board,
      actionName: "start",
      input: {},
      userId: who.userId,
      sessionId: `s_${who.userId}`,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig },
    });
    expect(parent.error).toBeUndefined();
    for (let i = 0; i < 100; i++) {
      const rows = await Promise.all(["t-lead", "t-research"].map((id) => row(who, id)));
      if (rows.every((r) => r?.status !== "in_progress" && r?.status !== "pending")) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  /** Session records minted on a hired seat for `who`, by any drain. */
  const seatSessions = async (who: Who, seatId: string) =>
    (await runtime.stores.session.list({ userId: who.userId, parentage: "all" })).filter((s) => s.flowId === seatId);

  return { state, ran, row, drain, seatSessions };
}

/** A refused hand-off: nothing ran, nothing was minted, the row is not held. */
async function expectRefused(h: Awaited<ReturnType<typeof boot>>, who: Who, taskId: string, seatId: string) {
  expect(h.ran.filter((line) => line.startsWith(`${seatId} `))).toEqual([]);
  expect(await h.seatSessions(who, seatId)).toEqual([]);
  const settled = await h.row(who, taskId);
  expect(settled?.status).toBe("errored");
  expect(settled?.claimedBy).toBeUndefined();
  return settled;
}

describe("a board drain onto a hired seat", () => {
  it("refuses another organization's board, and the row is not held by the seat", async () => {
    const h = await boot();
    try {
      await h.drain(MALLORY);
      const lead = await expectRefused(h, MALLORY, "t-lead", LEAD);
      const research = await expectRefused(h, MALLORY, "t-research", RESEARCH);
      // The same answer an address this process does not hold gets.
      const ghost = await h.row(MALLORY, "t-ghost");
      expect(ghost?.error).toContain(`no flow instance "${GHOST}" is registered`);
      expect(lead?.error).toContain(`no flow instance "${LEAD}" is registered`);
      expect(research?.error).toContain(`no flow instance "${RESEARCH}" is registered`);
      expect(lead?.error?.replaceAll(LEAD, "X").replaceAll("lead", "S")).toBe(
        ghost?.error?.replaceAll(GHOST, "X").replaceAll("ghost", "S"),
      );
    } finally {
      await h.state.dispose();
    }
  });

  it("refuses a teammate's board aimed at a private seat, and runs the org seat for them", async () => {
    const h = await boot();
    try {
      await h.drain(BOB);
      const research = await expectRefused(h, BOB, "t-research", RESEARCH);
      expect(research?.error).toContain(`no flow instance "${RESEARCH}" is registered`);
      // Bob is inside the lead seat's pin, so his board hands off to it.
      expect((await h.row(BOB, "t-lead"))?.status).toBe("completed");
      expect(h.ran).toEqual([`${LEAD} t-lead as bob@acme`]);
    } finally {
      await h.state.dispose();
    }
  });

  it("hands the owner's rows to both seats", async () => {
    const h = await boot();
    try {
      await h.drain(ALICE);
      expect((await h.row(ALICE, "t-lead"))?.status).toBe("completed");
      expect((await h.row(ALICE, "t-research"))?.status).toBe("completed");
      expect([...h.ran].sort()).toEqual([
        `${RESEARCH} t-research as alice@acme`,
        `${LEAD} t-lead as alice@acme`,
      ].sort());
    } finally {
      await h.state.dispose();
    }
  });
});
