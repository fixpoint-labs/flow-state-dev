/**
 * A message to a task's session while its task runs is plain conversation:
 * it runs after the task settles, outside the task. It holds no claim, so its
 * turn can't report progress on the task, and an error in it leaves the
 * task's ending as it was.
 *
 * Why it matters: the filer hears "done" when the work is done. A message
 * someone sends the busy session (a question, a note) doesn't change the
 * brief or the output, so it must not delay the task's settle, write onto its
 * row, or fail its attempt. Words meant to change open work are a steer.
 *
 * On the real engine, through the board host: `lead` files a task for
 * `eng.doer`, whose task turn sends a message to its own session while it
 * runs (a row in the message log, not yet taken, and its delivery dispatched), so
 * the message waits on the session's reply line behind the task's turn. The
 * message's turn calls `reportProgress`, built as Workforce builds it.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, markDispatcher } from "@flow-state-dev/core";
import { dispatchThroughSeam, type BlockContext } from "@flow-state-dev/core/types";
import { createReportProgress } from "@flow-state-dev/orchestration";
import { currentWorkerClaim } from "@flow-state-dev/orchestration/task-board";
import { runForTest } from "@flow-state-dev/testing";
import { z } from "zod";
import { defineSessionBoard, filingConversationBoard, workerConfigSchema, workerTaskEntry, type WorkerManifest } from "../src";
import { boardAboveOf } from "../src/conversation-board/board-above";
import { conversationLedgerAt } from "../src/conversation-board/ledger";
import { messageLogOf } from "../src/messages/message-log";
import { MESSAGE_RECEIVED_ENTRY } from "../src/messages/keys";
import type { WorkerInstallation } from "../src/workers/installation";
import { bootBoardHost, messageOf, type BoardHost, hearsMessages } from "./conversation-board-harness";
import { workerMessagesResources } from "../src/messages/message-log";

const worker = (id: string, declared: Record<string, unknown>): WorkerManifest => ({ id, declared, body: "", skills: [] });
const WORKERS = [
  worker("lead", { flow: "coordinator", delegates: ["eng.doer"] }),
  worker("eng.doer", { flow: "doer", delegates: ["eng.helper"] }),
  worker("eng.helper", { flow: "slowhelper" })
];

/** `reportProgress` as a task session's turn is offered it: on the board above the session. */
const reportProgress = createReportProgress({
  resolve: async (ctx: BlockContext) => {
    const filing = boardAboveOf(ctx);
    return filing === undefined ? undefined : conversationLedgerAt(ctx, filing);
  }
});

/** What the message's turn saw, from inside its own run. */
type Seen = { at: number; claimed: boolean; statuses: string[]; keptOpenBy: Array<string | undefined>; reported: { ok: boolean; error?: string } };

type Behaviour = {
  throwInMessage: boolean;
  /** The task's turn files one piece for `eng.helper`, which runs until this settles. */
  piece?: Promise<void>;
};

/** `eng.helper`'s flow: each task runs until the test lets the piece end. */
function slowHelperFlow(installation: WorkerInstallation, behaviour: Behaviour) {
  const doorInput = z.object({ message: z.string() });
  const turn = handler({
    name: "slow-helper-turn",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    execute: async () => {
      await behaviour.piece;
      return "piece done";
    }
  });
  return defineFlow({
    kind: "slowhelper",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources },
    internal: { actions: hearsMessages(installation, "slowhelper") },
    actions: { respond: { inputSchema: doorInput, block: turn, userMessage: (i: { message: string }) => i.message } },
    task: { actions: { work: workerTaskEntry({ name: "slow-helper-task", turn }) } }
  } as never);
}

function doerFlow(installation: WorkerInstallation, seen: Seen[], behaviour: Behaviour) {
  const board = defineSessionBoard({ installation, flowKind: "doer" });
  const doorInput = z.object({ message: z.string() });

  // The task's turn sends a message to its own session: a row the entry has
  // yet to take, and its delivery dispatched, so it queues behind this turn.
  const sendToSelf = async (ctx: BlockContext) => {
    const id = `msg_${Math.random().toString(16).slice(2, 10)}`;
    const sessionId = ctx.session.identity.id;
    await messageLogOf(ctx).getOrCreate(id, {
      id,
      from: "lead",
      to: "eng.doer",
      text: "A question while you work.",
      exchange: id,
      fromSession: sessionId,
      fromFlow: "doer",
      toSession: sessionId,
      toFlow: "doer",
      hop: 1,
      status: "unconfirmed",
      at: Date.now()
    } as never);
    await dispatchThroughSeam(ctx, {
      type: "internal",
      action: MESSAGE_RECEIVED_ENTRY,
      flowKind: "doer",
      session: { id: sessionId },
      payload: { messageId: id },
      from: "busy-task-session-test"
    });
  };

  const turn = markDispatcher(
    handler({
      name: "busy-doer-turn",
      inputSchema: doorInput,
      outputSchema: z.unknown(),
      execute: async (input, rawCtx) => {
        const ctx = rawCtx as unknown as BlockContext;
        if (input.message.startsWith("Message ")) {
          const above = await filingConversationBoard(ctx);
          const rows = (above?.tasks.list() ?? []).filter((row) => row.assignee === "eng.doer");
          const at = Date.now();
          // A turn holding the task's claim would land this checkpoint on the row.
          const reported = (await runForTest(reportProgress.tool, { output: "the message's checkpoint" }, ctx as never)) as Seen["reported"];
          seen.push({
            at,
            claimed: currentWorkerClaim(ctx) !== undefined,
            statuses: rows.map((row) => row.status),
            keptOpenBy: rows.map((row) => row.keptOpenBy ?? undefined),
            reported
          });
          if (behaviour.throwInMessage) throw new Error("the message's turn broke");
          // No text: a woken turn's text would be relayed back as an answer, a second message.
          return "";
        }
        // A piece's ending wakes this turn: its answer is the task's result.
        if (input.message.startsWith('Task "')) return "the woken turn's answer";
        if (behaviour.piece !== undefined) {
          const ref = await board.board.resolver(ctx as never);
          await ref!.addTask({ goal: "a piece of it", assignee: "eng.helper" });
        }
        await sendToSelf(ctx);
        // Still working when the message arrives.
        await new Promise((resolve) => setTimeout(resolve, 100));
        return "the work's answer";
      }
    }),
    { type: "internal", action: MESSAGE_RECEIVED_ENTRY }
  );

  return defineFlow({
    kind: "doer",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
    resources: { ...installation.resources, ...board.resources },
    actions: { respond: { inputSchema: doorInput.strict(), block: turn, userMessage: (i: { message: string }) => i.message }, ...board.actions },
    internal: { actions: board.entries(turn, () => "judgment") },
    task: { actions: { work: workerTaskEntry({ name: "busy-doer-task", turn }) } }
  } as never);
}

async function fileOne(h: BoardHost): Promise<string> {
  const lead = await h.conversation("alice", "lead");
  const filed = await h.act("alice", lead, "createTask_tasks", { goal: "Do the work", assignee: "eng.doer" });
  expect(filed.error, messageOf(filed.error)).toBeUndefined();
  return filed.output.taskId as string;
}

function boot(seen: Seen[], behaviour: Behaviour) {
  return bootBoardHost({
    standard: WORKERS,
    flows: (installation) => ({
      doer: { flow: doerFlow(installation, seen, behaviour), roles: ["contributor", "manager"] },
      slowhelper: { flow: slowHelperFlow(installation, behaviour), roles: ["contributor"] }
    })
  });
}

const NOT_A_TASK_TURN = { ok: false, error: expect.stringMatching(/^not_a_task_turn:/) };

describe("a message to a task's session while the task runs", () => {
  it("doesn't delay the settle: the task completes with its work's answer, and the message runs after, outside the task", async () => {
    const seen: Seen[] = [];
    const h = boot(seen, { throwInMessage: false });
    try {
      const taskId = await fileOne(h);
      await h.settled();

      const row = (await h.rows("alice")).find((r) => r.id === taskId)!;
      expect(row).toMatchObject({ status: "completed", output: "the work's answer", attempts: 1 });
      expect(row.checkpointed).toBeFalsy();
      // The message's turn ran once, after the task settled, holding no claim.
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ claimed: false, statuses: ["completed"], reported: NOT_A_TASK_TURN });
      expect(row.completedAt!).toBeLessThanOrEqual(seen[0]!.at);
    } finally {
      await h.dispose();
    }
  });

  it("leaves the task's ending unchanged when the message's turn errors", async () => {
    const seen: Seen[] = [];
    const h = boot(seen, { throwInMessage: true });
    try {
      const taskId = await fileOne(h);
      await h.settled();

      expect(seen).toHaveLength(1);
      const row = (await h.rows("alice")).find((r) => r.id === taskId)!;
      expect(row).toMatchObject({ status: "completed", output: "the work's answer", attempts: 1 });
      expect(row.error).toBeUndefined();
      expect(row.feedback).toBeUndefined();
    } finally {
      await h.dispose();
    }
  });

  it("holds no claim while a split task waits on its piece, and the task still settles on the piece's ending", async () => {
    let endPiece!: () => void;
    const piece = new Promise<void>((resolve) => (endPiece = resolve));
    const seen: Seen[] = [];
    const h = boot(seen, { throwInMessage: false, piece });
    try {
      const taskId = await fileOne(h);
      // The task's turn ended with its piece open: the session's reply line is
      // free, so the message runs now, while the task waits on the piece.
      for (let i = 0; i < 300 && seen.length === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ claimed: false, statuses: ["in_progress"], keptOpenBy: ["filed"], reported: NOT_A_TASK_TURN });

      endPiece();
      await h.settled();
      const row = (await h.rows("alice")).find((r) => r.id === taskId)!;
      expect(row).toMatchObject({ status: "completed", output: "the woken turn's answer", attempts: 1 });
      expect(row.checkpointed).toBeFalsy();
    } finally {
      endPiece();
      await h.dispose();
    }
  });
});
